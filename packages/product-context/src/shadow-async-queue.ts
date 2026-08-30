/**
 * Durable enqueue and worker state machine for asynchronous shadow synthesis.
 *
 * The enqueue path performs no model work. A separately credentialed worker
 * leases one immutable turn, reauthorizes it, then crosses an explicit
 * `calling_model` boundary. Lease expiry before that boundary is retry-safe;
 * expiry after it is terminal because the provider outcome is unknowable.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

import { validateProductKnowledgeContract } from './contracts.ts';
import type { AppendExactTurnInput, AtomicShadowEnqueueStore, ShadowRunOutcome, ShadowRunRecord } from './conversation-postgres.ts';
import { ModelGatewayError, type ModelGateway, type ModelGatewayCall } from './model-gateway.ts';
import { modelGatewayValidationErrorCode, modelGatewayValidationStage } from './model-gateway-diagnostics.ts';
import type { ConversationMessage, ConversationTurn, ModelGatewayRequest, ModelGatewayResult, ShadowAuthorizationReceipt } from './generated/product-knowledge.ts';

const MAX_ATTEMPTS = 3;
const TERMINAL_SAFETY_MARGIN_MS = 5_000;

/** Provider codes are shared with the evaluator's closed diagnostic allowlist. */
const SHADOW_WORKER_RETRY_PROVIDER_CODES = ['1302', '1303', '1305', '1312'] as const;
const SHADOW_WORKER_BLOCKED_PROVIDER_CODES = ['1000', '1001', '1002', '1003', '1004', '1113', '1308', '1309', '1310', '1311', '1313'] as const;

export interface EnqueueShadowTurnInput {
  readonly receipt: ShadowAuthorizationReceipt;
  readonly threadRef: string;
  readonly stableTurnKey: string;
  readonly userBytes: Uint8Array;
  readonly agentBytes: Uint8Array;
  readonly retainedUntil: Date;
  readonly now?: Date;
}

/** Idempotently persists exact bytes and a pending run without calling a model. */
export async function enqueueShadowTurn(store: AtomicShadowEnqueueStore, input: EnqueueShadowTurnInput): Promise<ShadowRunRecord> {
  assertReceipt(input.receipt);
  const now = input.now ?? new Date();
  if (Date.parse(input.receipt.issued_at) > now.getTime() || Date.parse(input.receipt.expires_at) <= now.getTime()) {
    throw new TypeError('Shadow authorization receipt is not currently valid.');
  }
  const request = requestForBytes(input);
  const append: AppendExactTurnInput = {
    ownerRef: input.receipt.shadow_principal_ref,
    gameRef: input.receipt.applies_to[0]!,
    threadRef: input.threadRef,
    stableTurnKey: input.stableTurnKey,
    userBytes: new Uint8Array(input.userBytes),
    agentBytes: new Uint8Array(input.agentBytes),
    gatewayRequest: request,
    retainedUntil: input.retainedUntil,
    now
  };
  return store.appendExactTurnAndCreateRun(append, input.receipt);
}

export type ShadowWorkerErrorAction =
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'blocked'; readonly code: string }
  | { readonly kind: 'failed'; readonly code: string; readonly outcome: Exclude<ShadowRunOutcome, 'success' | 'no_change' | 'disabled' | 'gateway_retry_scheduled'> };

/** Official Z.AI error policy. Unknown throttling fails closed without a hot retry. */
export function classifyShadowWorkerError(error: unknown): ShadowWorkerErrorAction {
  if (error instanceof ModelGatewayError) {
    if (error.providerCode && SHADOW_WORKER_RETRY_PROVIDER_CODES.includes(error.providerCode as typeof SHADOW_WORKER_RETRY_PROVIDER_CODES[number])) return { kind: 'retry', code: `zai_${error.providerCode}` };
    if (error.providerCode && SHADOW_WORKER_BLOCKED_PROVIDER_CODES.includes(error.providerCode as typeof SHADOW_WORKER_BLOCKED_PROVIDER_CODES[number])) return { kind: 'blocked', code: `zai_${error.providerCode}` };
    if (error.httpStatus === 429) return { kind: 'blocked', code: 'zai_http_429_unknown' };
    if (error.httpStatus === 401 || error.httpStatus === 403) return { kind: 'blocked', code: `zai_http_${error.httpStatus}` };
    if (error.code === 'policy_denied') return { kind: 'blocked', code: 'policy_denied' };
    if (error.code === 'timeout' || error.code === 'transport_error' || error.code === 'outcome_unknown') {
      return { kind: 'failed', code: `gateway_${error.code}`, outcome: 'gateway_outcome_unknown' };
    }
    if (error.code === 'oversize_output') return { kind: 'failed', code: 'gateway_oversize', outcome: 'gateway_oversize' };
    const validationCode = error.code === 'malformed_output'
      ? modelGatewayValidationErrorCode(modelGatewayValidationStage(error))
      : null;
    return { kind: 'failed', code: validationCode ?? `gateway_${error.code}`, outcome: 'gateway_malformed' };
  }
  return { kind: 'failed', code: 'gateway_unclassified', outcome: 'gateway_outcome_unknown' };
}

/**
 * Returns a worker failure code only for tuples that this classifier can
 * persist. This is intentionally content-free and is used by the local CLI
 * diagnostic after the report has already been written.
 */
export function shadowWorkerGatewayFailureCode(
  value: unknown,
  status: string,
  outcome: string | null
): string | null {
  if (typeof value !== 'string') return null;
  if (value === 'gateway_timeout' || value === 'gateway_transport_error' ||
      value === 'gateway_outcome_unknown' || value === 'gateway_unclassified') {
    return status === 'failed' && outcome === 'gateway_outcome_unknown' ? value : null;
  }
  if (value === 'gateway_oversize') return status === 'failed' && outcome === 'gateway_oversize' ? value : null;
  if (value === 'unsafe_timeout_configuration') return status === 'blocked' && outcome === 'gateway_error' ? value : null;
  if (value === 'policy_denied' || value === 'zai_http_429_unknown' || value === 'zai_http_401' || value === 'zai_http_403') {
    return status === 'blocked' && outcome === 'gateway_blocked' ? value : null;
  }
  if (!value.startsWith('zai_') || status !== 'blocked' || outcome !== 'gateway_blocked') return null;
  const providerCode = value.slice('zai_'.length);
  return SHADOW_WORKER_RETRY_PROVIDER_CODES.includes(providerCode as typeof SHADOW_WORKER_RETRY_PROVIDER_CODES[number]) ||
    SHADOW_WORKER_BLOCKED_PROVIDER_CODES.includes(providerCode as typeof SHADOW_WORKER_BLOCKED_PROVIDER_CODES[number]) ? value : null;
}

export interface ShadowWorkerLease {
  readonly token: string;
  readonly run: ShadowRunRecord;
  readonly turn: ConversationTurn;
  readonly attempt: number;
}

export interface ShadowWorkerStore {
  leaseNext(leaseMs: number, maxAttempts: number, now?: Date): Promise<ShadowWorkerLease | null>;
  reread(lease: ShadowWorkerLease): Promise<ConversationTurn | null>;
  prepareCall(lease: ShadowWorkerLease, requestId: string, callLeaseMs: number, now?: Date): Promise<ConversationTurn>;
  complete(lease: ShadowWorkerLease, call: ModelGatewayCall, now?: Date): Promise<'completed' | 'message_deleted' | 'message_changed' | 'retention_expired'>;
  retry(lease: ShadowWorkerLease, code: string, nextAttemptAt: Date, call?: ModelGatewayCall | null, now?: Date): Promise<void>;
  terminal(lease: ShadowWorkerLease, status: 'denied' | 'failed' | 'blocked', outcome: Exclude<ShadowRunOutcome, 'success' | 'no_change' | 'disabled' | 'gateway_retry_scheduled'>, code: string, call?: ModelGatewayCall | null, now?: Date): Promise<void>;
}

export interface ShadowWorkerTarget {
  readonly ownerRef: string;
  readonly gameRef: string;
  readonly stableTurnKey: string;
}

export interface ShadowAsyncWorkerOptions {
  readonly leaseMs: number;
  readonly authorizationTimeoutMs: number;
  readonly retryBaseMs: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface ShadowWorkerAuthority {
  current(previous: ShadowAuthorizationReceipt): Promise<unknown>;
}

export class ShadowAsyncWorker {
  private readonly now: () => Date;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: ShadowWorkerStore,
    private readonly authority: ShadowWorkerAuthority,
    private readonly gatewayFactory: (receipt: ShadowAuthorizationReceipt) => Promise<ModelGateway>,
    private readonly options: ShadowAsyncWorkerOptions
  ) {
    for (const [name, value] of [['lease', options.leaseMs], ['authorization timeout', options.authorizationTimeoutMs], ['retry base', options.retryBaseMs]] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`A positive ${name} is required.`);
    }
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 8) throw new TypeError('Worker attempts must be between 1 and 8.');
    this.now = options.now ?? (() => new Date());
  }

  async runOne(): Promise<'idle' | 'completed' | 'retry_wait' | 'blocked' | 'failed'> {
    const lease = await this.store.leaseNext(this.options.leaseMs, this.maxAttempts, this.now());
    if (!lease) return 'idle';
    const current = await this.reauthorize(lease.run.receipt);
    if (!current || !sameAuthorization(lease.run.receipt, current)) {
      await this.store.terminal(lease, 'denied', 'authorization_changed', 'authorization_changed', null, this.now());
      return 'blocked';
    }
    const bindingFailure = validateLeasedTurn(lease, this.now());
    if (bindingFailure) {
      await this.store.terminal(lease, 'failed', bindingFailure, bindingFailure, null, this.now());
      return 'failed';
    }

    let gateway: ModelGateway;
    try { gateway = await this.gatewayFactory(current); }
    catch (error) { return this.handleBeforeCallFailure(lease, error); }
    if (gateway.timeoutMs + this.options.authorizationTimeoutMs + TERMINAL_SAFETY_MARGIN_MS > this.options.leaseMs) {
      await this.store.terminal(lease, 'blocked', 'gateway_error', 'unsafe_timeout_configuration', null, this.now());
      return 'blocked';
    }
    const requestId = requestForTurn(lease.run, lease.turn).request_id;
    let preparedTurn: ConversationTurn;
    try { preparedTurn = await this.store.prepareCall(lease, requestId, this.options.leaseMs, this.now()); }
    catch { return 'failed'; }
    const finalRequest = requestForTurn(lease.run, preparedTurn);
    try {
      const call = await gateway.call(finalRequest);
      const checked = validateProductKnowledgeContract<ModelGatewayResult>('ModelGatewayResult', call.result);
      if (!checked.ok || checked.value.request_id !== finalRequest.request_id) throw new ModelGatewayError('malformed_output');
      const postCallAuthorization = await this.reauthorize(lease.run.receipt);
      if (!postCallAuthorization || !sameAuthorization(lease.run.receipt, postCallAuthorization)) {
        await this.store.terminal(lease, 'denied', 'authorization_changed', 'authorization_changed', call, this.now());
        return 'blocked';
      }
      const completion = await this.store.complete(lease, call, this.now());
      return completion === 'completed' ? 'completed' : 'failed';
    } catch (error) {
      const action = classifyShadowWorkerError(error);
      if (action.kind === 'retry' && lease.attempt < this.maxAttempts) {
        const delay = this.options.retryBaseMs * (2 ** (lease.attempt - 1));
        await this.store.retry(lease, action.code, new Date(this.now().getTime() + delay), null, this.now());
        return 'retry_wait';
      }
      const status = action.kind === 'blocked' || action.kind === 'retry' ? 'blocked' : 'failed';
      const outcome = action.kind === 'failed' ? action.outcome : 'gateway_blocked';
      await this.store.terminal(lease, status, outcome, action.code, null, this.now());
      return status;
    }
  }

  private async handleBeforeCallFailure(lease: ShadowWorkerLease, error: unknown): Promise<'retry_wait' | 'blocked' | 'failed'> {
    const action = classifyShadowWorkerError(error);
    if (action.kind === 'retry' && lease.attempt < this.maxAttempts) {
      const delay = this.options.retryBaseMs * (2 ** (lease.attempt - 1));
      await this.store.retry(lease, action.code, new Date(this.now().getTime() + delay), null, this.now());
      return 'retry_wait';
    }
    const status = action.kind === 'failed' ? 'failed' : 'blocked';
    await this.store.terminal(lease, status, action.kind === 'failed' ? action.outcome : 'gateway_blocked', action.code, null, this.now());
    return status;
  }

  private async reauthorize(previous: ShadowAuthorizationReceipt): Promise<ShadowAuthorizationReceipt | null> {
    try {
      const candidate = await bounded(() => this.authority.current(previous), this.options.authorizationTimeoutMs);
      const checked = validateProductKnowledgeContract<ShadowAuthorizationReceipt>('ShadowAuthorizationReceipt', candidate);
      const now = this.now().getTime();
      return checked.ok && Date.parse(checked.value.issued_at) <= now && Date.parse(checked.value.expires_at) > now ? checked.value : null;
    } catch { return null; }
  }
}

/** PostgreSQL worker adapter; its LOGIN must have only worker-role membership. */
export class PostgresShadowWorkerStore implements ShadowWorkerStore {
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    private readonly target: ShadowWorkerTarget | null = null
  ) {}

  async leaseNext(leaseMs: number, maxAttempts: number, now = new Date()): Promise<ShadowWorkerLease | null> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError('A positive lease is required.');
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) throw new TypeError('Attempts must be between 1 and 8.');
    return this.transaction(async (client) => {
      const result = await client.query<{ payload: WorkerPayload | null }>(
        'SELECT product_context_shadow.worker_claim($1,$2,$3,$4,$5,$6) AS payload',
        [leaseMs, maxAttempts, now.toISOString(), this.target?.ownerRef ?? null,
          this.target?.gameRef ?? null, this.target?.stableTurnKey ?? null]
      );
      return result.rows[0]?.payload ? leaseFromPayload(result.rows[0].payload) : null;
    });
  }

  /** Commits only terminal housekeeping; an unexpectedly claimable lease is rolled back. */
  async terminalizeExpiredTarget(leaseMs: number, maxAttempts: number, now = new Date()): Promise<boolean> {
    if (!this.target) throw new TypeError('An exact recovery target is required.');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError('A positive lease is required.');
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts !== 1) throw new TypeError('Recovery requires exactly one attempt.');
    try {
      await this.transaction(async (client) => {
        const result = await client.query<{ payload: WorkerPayload | null }>(
          'SELECT product_context_shadow.worker_claim($1,$2,$3,$4,$5,$6) AS payload',
          [leaseMs, maxAttempts, now.toISOString(), this.target!.ownerRef,
            this.target!.gameRef, this.target!.stableTurnKey]
        );
        if (result.rows[0]?.payload) throw new UnsafeRecoveryClaimError();
      });
      return true;
    } catch (error) {
      if (error instanceof UnsafeRecoveryClaimError) return false;
      throw error;
    }
  }

  async prepareCall(lease: ShadowWorkerLease, requestId: string, callLeaseMs: number, now = new Date()): Promise<ConversationTurn> {
    if (!Number.isSafeInteger(callLeaseMs) || callLeaseMs <= 0) throw new TypeError('A positive call lease is required.');
    const turn = await this.transaction(async (client) => {
      const result = await client.query<{ payload: WorkerPayload | null }>(
        'SELECT product_context_shadow.worker_prepare_call($1,$2,$3,$4,$5) AS payload',
        [lease.run.runId, lease.token, requestId, callLeaseMs, now.toISOString()]
      );
      return result.rows[0]?.payload ? turnFromPayload(result.rows[0].payload) : null;
    });
    if (!turn) throw new Error('Shadow worker lease was lost.');
    return turn;
  }

  async reread(lease: ShadowWorkerLease): Promise<ConversationTurn | null> {
    return this.transaction(async (client) => {
      const result = await client.query<{ payload: WorkerPayload | null }>(
        'SELECT product_context_shadow.worker_reread($1,$2) AS payload',
        [lease.run.runId, lease.token]
      );
      return result.rows[0]?.payload ? turnFromPayload(result.rows[0].payload) : null;
    });
  }

  async complete(lease: ShadowWorkerLease, call: ModelGatewayCall, now = new Date()): Promise<'completed' | 'message_deleted' | 'message_changed' | 'retention_expired'> {
    const outcome = call.result.outcome === 'proposal' ? 'success' : 'no_change';
    return this.transaction(async (client) => {
      const result = await client.query<{ completion: 'completed' | 'message_deleted' | 'message_changed' | 'retention_expired' | null }>(
        'SELECT product_context_shadow.worker_complete($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) AS completion',
        [lease.run.runId, lease.token, JSON.stringify(call.result), outcome, call.durationMs,
          call.inputBytes, call.outputBytes, call.result.proposal?.operations.length ?? 0, now.toISOString()]
      );
      const completion = result.rows[0]?.completion;
      if (!completion || !['completed', 'message_deleted', 'message_changed', 'retention_expired'].includes(completion)) {
        throw new Error('Shadow worker lease was lost.');
      }
      return completion;
    });
  }

  async retry(lease: ShadowWorkerLease, code: string, nextAttemptAt: Date, call: ModelGatewayCall | null = null, now = new Date()): Promise<void> {
    await this.requireFunctionResult(
      'SELECT product_context_shadow.worker_retry($1,$2,$3,$4,$5,$6,$7,$8) AS changed',
      [lease.run.runId, lease.token, code, nextAttemptAt.toISOString(), call?.durationMs ?? 0,
        call?.inputBytes ?? 0, call?.outputBytes ?? 0, now.toISOString()]
    );
  }

  async terminal(lease: ShadowWorkerLease, status: 'denied' | 'failed' | 'blocked', outcome: Exclude<ShadowRunOutcome, 'success' | 'no_change' | 'disabled' | 'gateway_retry_scheduled'>, code: string, call: ModelGatewayCall | null = null, now = new Date()): Promise<void> {
    await this.requireFunctionResult(
      'SELECT product_context_shadow.worker_terminal($1,$2,$3,$4,$5,$6,$7,$8,$9) AS changed',
      [lease.run.runId, lease.token, status, outcome, code, call?.durationMs ?? 0,
        call?.inputBytes ?? 0, call?.outputBytes ?? 0, now.toISOString()]
    );
  }

  private async requireFunctionResult(sql: string, values: readonly unknown[]): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query<{ changed: boolean }>(sql, [...values]);
      if (result.rows[0]?.changed !== true) throw new Error('Shadow worker lease was lost.');
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); let began = false; let discard = false;
    try {
      await client.query('BEGIN'); began = true;
      await client.query('SET LOCAL ROLE product_context_shadow_worker');
      const value = await work(client); await client.query('COMMIT'); began = false; return value;
    } catch (error) {
      if (began) try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }
}

class UnsafeRecoveryClaimError extends Error {}

interface WorkerRunRow {
  run_id: string; owner_ref: string; thread_ref: string; stable_turn_key: string; authorization_revision: string;
  authorization_receipt: ShadowAuthorizationReceipt; user_message_ref: string; user_message_revision: string; user_message_hash: string;
  agent_message_ref: string; agent_message_revision: string; agent_message_hash: string; status: ShadowRunRecord['status'];
  outcome_code: ShadowRunOutcome | null; request_id: string | null; result_payload: ModelGatewayResult | null;
  lease_expires_at: string | null; retained_until: string; attempts: number; created_at: string;
  lease_token: string | null;
}
interface WorkerMessageRow { message_ref: string; thread_ref: string; stable_turn_key: string; sequence: string | number; actor: 'user'|'agent'; revision: string; content_hash: string; content_base64: string|null; byte_length: number; tombstone: boolean; retained_until: string; created_at: string; deleted_at: string|null; }
interface WorkerPayload { run: WorkerRunRow; messages: WorkerMessageRow[]; }

function turnFromPayload(payload: WorkerPayload): ConversationTurn|null {
  if (!payload || !payload.run || !Array.isArray(payload.messages) || payload.messages.length !== 2) return null;
  const messages = payload.messages.map(mapMessage);
  const user = messages.find((message) => message.actor === 'user'); const agent = messages.find((message) => message.actor === 'agent');
  if (!user || !agent) return null;
  return { schema_version:'1.0.0', turn_ref:`${payload.run.thread_ref}/turn/${digestId(payload.run.stable_turn_key)}`, thread_ref:payload.run.thread_ref, stable_turn_key:payload.run.stable_turn_key, user_message:user, agent_message:agent, created_at:user.created_at };
}
function leaseFromPayload(payload: WorkerPayload): ShadowWorkerLease|null {
  const turn = turnFromPayload(payload);
  if (!turn || !payload.run.lease_token) return null;
  return { token: payload.run.lease_token, run: mapWorkerRun(payload.run), turn, attempt: Number(payload.run.attempts) };
}
function mapMessage(row: WorkerMessageRow): ConversationMessage { return { schema_version:'1.0.0', message_ref:row.message_ref, thread_ref:row.thread_ref, stable_turn_key:row.stable_turn_key, sequence:Number(row.sequence), actor:row.actor, revision:row.revision, content_hash:row.content_hash, content_base64:row.content_base64, byte_length:row.byte_length, tombstone:row.tombstone, retained_until:new Date(row.retained_until).toISOString(), created_at:new Date(row.created_at).toISOString(), ...(row.deleted_at ? { deleted_at:new Date(row.deleted_at).toISOString() } : {}) }; }
function mapWorkerRun(row: WorkerRunRow): ShadowRunRecord { return { runId:row.run_id, ownerRef:row.owner_ref, threadRef:row.thread_ref, stableTurnKey:row.stable_turn_key, authorizationRevision:row.authorization_revision, receipt:row.authorization_receipt, userMessageRef:row.user_message_ref, userMessageRevision:row.user_message_revision, userMessageHash:row.user_message_hash, agentMessageRef:row.agent_message_ref, agentMessageRevision:row.agent_message_revision, agentMessageHash:row.agent_message_hash, status:row.status, outcome:row.outcome_code, requestId:row.request_id, result:row.result_payload, leaseExpiresAt:row.lease_expires_at ? new Date(row.lease_expires_at).toISOString():null, retainedUntil:new Date(row.retained_until).toISOString() }; }

function requestForBytes(input: EnqueueShadowTurnInput): ModelGatewayRequest {
  const message = (actor:'user'|'agent', bytes:Uint8Array) => ({ message_ref:`${input.threadRef}/message/${digestId(`${input.receipt.shadow_principal_ref}\n${input.stableTurnKey}\n${actor}`)}`, actor, revision:sha256(`cubica-shadow-conversation-message/v1\n${actor}\n`,bytes), content_hash:sha256('',bytes), content_base64:Buffer.from(bytes).toString('base64') });
  return requestFromMessages(input.receipt,input.stableTurnKey,[message('user',input.userBytes),message('agent',input.agentBytes)]);
}
function validateLeasedTurn(lease:ShadowWorkerLease,now:Date):'message_deleted'|'message_changed'|'retention_expired'|null {
  if(Date.parse(lease.run.retainedUntil)<=now.getTime()||[lease.turn.user_message,lease.turn.agent_message].some(message=>Date.parse(message.retained_until)<=now.getTime()))return 'retention_expired';
  const exact=(message:ConversationMessage,actor:'user'|'agent',ref:string,revision:string,hash:string)=>{
    if(message.actor!==actor||message.message_ref!==ref||message.revision!==revision||message.content_hash!==hash||message.tombstone||message.content_base64===null)return false;
    const bytes=Buffer.from(message.content_base64,'base64');
    return bytes.toString('base64')===message.content_base64&&bytes.byteLength===message.byte_length&&sha256('',bytes)===hash;
  };
  if([lease.turn.user_message,lease.turn.agent_message].some(message=>message.tombstone||message.content_base64===null))return 'message_deleted';
  return exact(lease.turn.user_message,'user',lease.run.userMessageRef,lease.run.userMessageRevision,lease.run.userMessageHash)&&exact(lease.turn.agent_message,'agent',lease.run.agentMessageRef,lease.run.agentMessageRevision,lease.run.agentMessageHash)?null:'message_changed';
}
function requestForTurn(run:ShadowRunRecord, turn:ConversationTurn):ModelGatewayRequest { return requestFromMessages(run.receipt,run.stableTurnKey,[turn.user_message,turn.agent_message].map(message=>({message_ref:message.message_ref,actor:message.actor,revision:message.revision,content_hash:message.content_hash,content_base64:message.content_base64!}))); }
function requestFromMessages(receipt:ShadowAuthorizationReceipt,stableTurnKey:string,messages:ModelGatewayRequest['messages']):ModelGatewayRequest { const runId=`shadowrun_${digestId(`${receipt.shadow_principal_ref}\n${stableTurnKey}`)}`; return { schema_version:'1.0.0',request_id:`modelreq_${digestId(runId)}`,authorization_revision:receipt.authorization_revision,shadow_principal_ref:receipt.shadow_principal_ref,applies_to:receipt.applies_to,access_policy_ref:receipt.access_policy_ref,access_policy_revision:receipt.access_policy_revision,retention_policy_ref:receipt.retention_policy_ref,retention_policy_revision:receipt.retention_policy_revision,external_processing_policy_ref:receipt.external_processing_policy_ref,external_processing_policy_revision:receipt.external_processing_policy_revision,external_processing_decision:'allow',messages }; }
function assertReceipt(value:unknown):asserts value is ShadowAuthorizationReceipt { if(!validateProductKnowledgeContract<ShadowAuthorizationReceipt>('ShadowAuthorizationReceipt',value).ok) throw new TypeError('Invalid shadow authorization receipt.'); }
function sameAuthorization(left:ShadowAuthorizationReceipt,right:ShadowAuthorizationReceipt):boolean { return isDeepStrictEqual({decision:left.decision,p:left.shadow_principal_ref,g:left.applies_to,r:left.role_scope,a:[left.access_policy_ref,left.access_policy_revision],retention:[left.retention_policy_ref,left.retention_policy_revision],x:[left.external_processing_policy_ref,left.external_processing_policy_revision],v:left.authorization_revision},{decision:right.decision,p:right.shadow_principal_ref,g:right.applies_to,r:right.role_scope,a:[right.access_policy_ref,right.access_policy_revision],retention:[right.retention_policy_ref,right.retention_policy_revision],x:[right.external_processing_policy_ref,right.external_processing_policy_revision],v:right.authorization_revision}); }
function bounded<T>(work:()=>Promise<T>,timeoutMs:number):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('authorization timeout')),timeoutMs);timer.unref?.();Promise.resolve().then(work).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
function sha256(prefix:string,bytes:Uint8Array):`sha256:${string}`{return `sha256:${createHash('sha256').update(prefix,'utf8').update(bytes).digest('hex')}`;}
function digestId(value:string):string{return createHash('sha256').update(value,'utf8').digest('hex').slice(0,32);}
