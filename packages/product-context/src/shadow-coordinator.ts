/**
 * Server-only coordinator for one non-production shadow turn.
 *
 * It never produces or mutates the primary assistant response. Authorization
 * and exact stored bytes are reread immediately before the bounded gateway
 * call; every result remains an isolated shadow-run payload.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { validateProductKnowledgeContract } from './contracts.ts';
import type { ShadowConversationStore, ShadowRunOutcome, TerminalShadowRunOutcome } from './conversation-postgres.ts';
import { ModelGatewayError, type ModelGateway } from './model-gateway.ts';
import type {
  ConversationMessage,
  ConversationTurn,
  ModelGatewayRequest,
  ModelGatewayResult,
  ShadowAuthorizationReceipt,
  ShadowContentFreeMetric
} from './generated/product-knowledge.ts';

export interface ShadowAuthorizationAuthority {
  /** Must perform a fresh server-side authorization lookup; caller data is not authoritative. */
  /** Coordinator-enforced hard bound for each lookup. */
  readonly timeoutMs: number;
  current(previous: ShadowAuthorizationReceipt): Promise<unknown>;
}

export interface ShadowCoordinatorOptions {
  readonly enabled?: boolean;
  readonly environment: string;
  readonly retentionMs: number;
  readonly modelLeaseMs?: number;
  readonly now?: () => Date;
}

export interface ShadowTurnInput {
  readonly authorizationReceipt: unknown;
  readonly threadRef: string;
  readonly stableTurnKey: string;
  readonly userBytes: Uint8Array;
  readonly agentBytes: Uint8Array;
}

export type ShadowCoordinatorResult =
  | { readonly status: 'disabled' | 'in_progress' }
  | { readonly status: 'completed'; readonly runId: string; readonly result: ModelGatewayResult; readonly duplicate: boolean }
  | { readonly status: 'denied' | 'failed'; readonly runId: string | null; readonly outcome: TerminalShadowRunOutcome };

const allowedEnvironments = new Set(['test', 'staging']);
const MODEL_LEASE_SAFETY_MARGIN_MS = 5_000;

export class ShadowCoordinator {
  private readonly now: () => Date;
  private readonly modelLeaseMs: number;
  constructor(
    private readonly store: ShadowConversationStore,
    private readonly authority: ShadowAuthorizationAuthority,
    private readonly gateway: ModelGateway,
    private readonly options: ShadowCoordinatorOptions
  ) {
    if (!Number.isSafeInteger(options.retentionMs) || options.retentionMs <= 0) throw new TypeError('A positive shadow retention is required.');
    if (!Number.isSafeInteger(gateway.timeoutMs) || gateway.timeoutMs <= 0) throw new TypeError('A positive model timeout is required.');
    if (!Number.isSafeInteger(authority.timeoutMs) || authority.timeoutMs <= 0) throw new TypeError('A positive authorization timeout is required.');
    // Once claimed, the run performs one authorization check before the model
    // and one after it. The fixed margin covers both exact-message rereads and
    // the atomic terminal result+metric commit around those bounded calls.
    const minimumModelLeaseMs = gateway.timeoutMs + (2 * authority.timeoutMs) + MODEL_LEASE_SAFETY_MARGIN_MS;
    if (!Number.isSafeInteger(minimumModelLeaseMs)) throw new TypeError('The model timeout is too large for a safe lease.');
    this.modelLeaseMs = options.modelLeaseMs ?? minimumModelLeaseMs;
    if (!Number.isSafeInteger(this.modelLeaseMs) || this.modelLeaseMs < minimumModelLeaseMs) {
      throw new TypeError(`The model lease must cover both authorization checks, the full model timeout, and ${MODEL_LEASE_SAFETY_MARGIN_MS}ms terminal safety margin.`);
    }
    this.now = options.now ?? (() => new Date());
  }

  async run(input: ShadowTurnInput): Promise<ShadowCoordinatorResult> {
    if (!this.options.enabled) return { status: 'disabled' };
    if (!allowedEnvironments.has(this.options.environment)) return { status: 'disabled' };
    const callerReceipt = validatedReceipt(input.authorizationReceipt);
    if (!callerReceipt || isExpired(callerReceipt, this.now())) return { status: 'denied', runId: null, outcome: 'authorization_changed' };
    const receipt = await this.freshAuthorization(callerReceipt);
    if (!receipt) return { status: 'denied', runId: null, outcome: 'authorization_changed' };

    const retainedUntil = new Date(this.now().getTime() + this.options.retentionMs);
    const requestId = requestIdFor(receipt.shadow_principal_ref, input.stableTurnKey);
    const boundedRequest = gatewayRequestForBytes(requestId, receipt, input);
    if (requestByteLength(boundedRequest) > this.gateway.maxRequestBytes) {
      return { status: 'failed', runId: null, outcome: 'gateway_oversize' };
    }
    const turn = await this.store.appendExactTurn({
      ownerRef: receipt.shadow_principal_ref,
      gameRef: receipt.applies_to[0]!,
      threadRef: input.threadRef,
      stableTurnKey: input.stableTurnKey,
      userBytes: new Uint8Array(input.userBytes),
      agentBytes: new Uint8Array(input.agentBytes),
      gatewayRequest: boundedRequest,
      retainedUntil,
      now: this.now()
    });
    const run = await this.store.createRun(receipt, turn, retainedUntil);
    if (run.status === 'succeeded' && run.result) return { status: 'completed', runId: run.runId, result: run.result, duplicate: true };
    if (run.status === 'denied' || run.status === 'failed' || run.status === 'blocked') return { status: run.status === 'blocked' ? 'failed' : run.status, runId: run.runId, outcome: run.outcome as TerminalShadowRunOutcome };
    const claim = await this.store.claimRun(receipt.shadow_principal_ref, run.runId, requestId, this.modelLeaseMs, this.now());
    if (claim.kind === 'in_progress') return { status: 'in_progress' };
    if (claim.kind === 'terminal') return terminalResult(claim.run);

    const reread = await this.store.rereadExactTurn(receipt.shadow_principal_ref, turn);
    const drift = classifyTurnDrift(turn, reread, this.now());
    if (drift) return this.fail(receipt, run.runId, requestId, drift, 0, 0, 0);
    const request = gatewayRequest(requestId, receipt, reread!);
    if (!isDeepStrictEqual(request, boundedRequest)) return this.fail(receipt, run.runId, requestId, 'message_changed', 0, 0, 0);
    // Authorization is checked again at the last local boundary before exact
    // conversation bytes can leave Cubica for the model gateway.
    const preGatewayAuthorization = await this.freshAuthorization(receipt);
    if (!preGatewayAuthorization) {
      return this.fail(receipt, run.runId, requestId, 'authorization_changed', 0, 0, 0);
    }
    const started = this.now().getTime();
    try {
      const call = await this.gateway.call(request);
      const postGatewayAuthorization = await this.freshAuthorization(receipt);
      if (!postGatewayAuthorization) {
        return this.fail(receipt, run.runId, requestId, 'authorization_changed', call.durationMs, call.inputBytes, call.outputBytes);
      }
      const postGatewayTurn = await this.store.rereadExactTurn(receipt.shadow_principal_ref, turn);
      const postGatewayDrift = classifyTurnDrift(turn, postGatewayTurn, this.now());
      if (postGatewayDrift) {
        return this.fail(receipt, run.runId, requestId, postGatewayDrift, call.durationMs, call.inputBytes, call.outputBytes);
      }
      const outcome = call.result.outcome === 'proposal' ? 'success' : 'no_change';
      const completed = await this.store.completeRun(receipt.shadow_principal_ref, run.runId, call.result, outcome, metric(receipt, run.runId, requestId, outcome, call.durationMs, call.inputBytes, call.outputBytes, call.result.proposal?.operations.length ?? 0, this.now()), this.now());
      if (completed.status !== 'succeeded') return terminalResult(completed);
      return { status: 'completed', runId: completed.runId, result: call.result, duplicate: false };
    } catch (error) {
      const outcome = gatewayOutcome(error);
      return this.fail(receipt, run.runId, requestId, outcome, Math.max(0, this.now().getTime() - started), requestByteLength(request), 0);
    }
  }

  private async fail(
    receipt: ShadowAuthorizationReceipt,
    runId: string,
    requestId: string | null,
    outcome: TerminalShadowRunOutcome,
    durationMs: number,
    inputBytes: number,
    outputBytes: number
  ): Promise<ShadowCoordinatorResult> {
    await this.store.failRun(receipt.shadow_principal_ref, runId, outcome, metric(receipt, runId, requestId, outcome, durationMs, inputBytes, outputBytes, 0, this.now()), this.now());
    return { status: outcome === 'policy_denied' || outcome === 'authorization_changed' ? 'denied' : 'failed', runId, outcome };
  }

  private async freshAuthorization(previous: ShadowAuthorizationReceipt): Promise<ShadowAuthorizationReceipt | null> {
    try {
      const current = validatedReceipt(await boundedAuthorityCall(
        () => this.authority.current(previous),
        this.authority.timeoutMs
      ));
      return current && !isExpired(current, this.now()) && sameAuthorization(previous, current) ? current : null;
    } catch { return null; }
  }
}

function boundedAuthorityCall<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Shadow authorization timed out.')), timeoutMs);
    timer.unref?.();
    Promise.resolve()
      .then(work)
      .then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error); }
      );
  });
}

function validatedReceipt(candidate: unknown): ShadowAuthorizationReceipt | null {
  const result = validateProductKnowledgeContract<ShadowAuthorizationReceipt>('ShadowAuthorizationReceipt', candidate);
  return result.ok ? result.value : null;
}
function isExpired(receipt: ShadowAuthorizationReceipt, now: Date): boolean {
  const issued = Date.parse(receipt.issued_at); const expires = Date.parse(receipt.expires_at);
  return !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now.getTime() || expires <= now.getTime() || issued >= expires;
}
function sameAuthorization(left: ShadowAuthorizationReceipt, right: ShadowAuthorizationReceipt): boolean {
  return isDeepStrictEqual({
    decision: left.decision, principal: left.shadow_principal_ref, role: left.role_scope,
    appliesTo: left.applies_to, access: [left.access_policy_ref, left.access_policy_revision],
    retention: [left.retention_policy_ref, left.retention_policy_revision],
    external: [left.external_processing_policy_ref, left.external_processing_policy_revision],
    authorization: left.authorization_revision
  }, {
    decision: right.decision, principal: right.shadow_principal_ref, role: right.role_scope,
    appliesTo: right.applies_to, access: [right.access_policy_ref, right.access_policy_revision],
    retention: [right.retention_policy_ref, right.retention_policy_revision],
    external: [right.external_processing_policy_ref, right.external_processing_policy_revision],
    authorization: right.authorization_revision
  });
}
function classifyTurnDrift(expected: ConversationTurn, actual: ConversationTurn | null, now: Date): 'message_deleted' | 'message_changed' | 'retention_expired' | null {
  if (!actual || actual.user_message.tombstone || actual.agent_message.tombstone || actual.user_message.content_base64 === null || actual.agent_message.content_base64 === null) return 'message_deleted';
  if ([actual.user_message, actual.agent_message].some((message) => Date.parse(message.retained_until) <= now.getTime())) return 'retention_expired';
  const exact = (actor: 'user' | 'agent', left: ConversationMessage, right: ConversationMessage) =>
    left.actor === actor && right.actor === actor && left.message_ref === right.message_ref &&
    left.revision === right.revision && left.content_hash === right.content_hash &&
    left.byte_length === right.byte_length && left.content_base64 === right.content_base64;
  return exact('user', expected.user_message, actual.user_message) && exact('agent', expected.agent_message, actual.agent_message) ? null : 'message_changed';
}
function gatewayRequestForBytes(requestId: string, receipt: ShadowAuthorizationReceipt, input: ShadowTurnInput): ModelGatewayRequest {
  const message = (actor: 'user' | 'agent', bytes: Uint8Array) => ({
    message_ref: `${input.threadRef}/message/${digestId(`${receipt.shadow_principal_ref}\n${input.stableTurnKey}\n${actor}`)}`,
    actor,
    revision: sha256(`cubica-shadow-conversation-message/v1\n${actor}\n`, bytes),
    content_hash: sha256('', bytes),
    content_base64: Buffer.from(bytes).toString('base64')
  });
  return gatewayRequestFromMessages(requestId, receipt, [message('user', input.userBytes), message('agent', input.agentBytes)]);
}
function gatewayRequest(requestId: string, receipt: ShadowAuthorizationReceipt, turn: ConversationTurn): ModelGatewayRequest {
  const message = (value: ConversationMessage) => ({
    message_ref: value.message_ref, actor: value.actor, revision: value.revision,
    content_hash: value.content_hash, content_base64: value.content_base64!
  });
  return gatewayRequestFromMessages(requestId, receipt, [message(turn.user_message), message(turn.agent_message)]);
}
function gatewayRequestFromMessages(requestId: string, receipt: ShadowAuthorizationReceipt, messages: ModelGatewayRequest['messages']): ModelGatewayRequest {
  return {
    schema_version: '1.0.0', request_id: requestId,
    authorization_revision: receipt.authorization_revision,
    shadow_principal_ref: receipt.shadow_principal_ref, applies_to: receipt.applies_to,
    access_policy_ref: receipt.access_policy_ref, access_policy_revision: receipt.access_policy_revision,
    retention_policy_ref: receipt.retention_policy_ref, retention_policy_revision: receipt.retention_policy_revision,
    external_processing_policy_ref: receipt.external_processing_policy_ref,
    external_processing_policy_revision: receipt.external_processing_policy_revision,
    external_processing_decision: 'allow',
    messages
  };
}
function metric(receipt: ShadowAuthorizationReceipt, runId: string, requestId: string | null, outcome: ShadowRunOutcome, durationMs: number, inputBytes: number, outputBytes: number, operations: number, now: Date): ShadowContentFreeMetric {
  return {
    schema_version: '1.0.0', metric_id: `metric_${digestId(runId)}`, run_id: runId,
    request_id: requestId, outcome, duration_ms: Math.max(0, Math.round(durationMs)),
    input_bytes: inputBytes, output_bytes: outputBytes, proposal_operation_count: operations,
    authorization_revision: receipt.authorization_revision,
    external_processing_policy_ref: receipt.external_processing_policy_ref,
    external_processing_policy_revision: receipt.external_processing_policy_revision,
    recorded_at: now.toISOString()
  };
}
function gatewayOutcome(error: unknown): TerminalShadowRunOutcome {
  if (!(error instanceof ModelGatewayError)) return 'gateway_error';
  if (error.code === 'policy_denied') return 'policy_denied';
  if (error.code === 'timeout') return 'gateway_timeout';
  if (error.code === 'oversize_output') return 'gateway_oversize';
  if (error.code === 'malformed_output' || error.code === 'invalid_request') return 'gateway_malformed';
  return 'gateway_error';
}
function requestByteLength(request: ModelGatewayRequest): number { return new TextEncoder().encode(JSON.stringify(request)).byteLength; }
function requestIdFor(ownerRef: string, stableTurnKey: string): string {
  const runId = `shadowrun_${digestId(`${ownerRef}\n${stableTurnKey}`)}`;
  return `modelreq_${digestId(runId)}`;
}
function terminalResult(run: import('./conversation-postgres.ts').ShadowRunRecord): ShadowCoordinatorResult {
  if (run.status === 'succeeded' && run.result) return { status: 'completed', runId: run.runId, result: run.result, duplicate: true };
  if (run.status === 'denied' || run.status === 'failed' || run.status === 'blocked') {
    return { status: run.status === 'blocked' ? 'failed' : run.status, runId: run.runId, outcome: run.outcome as TerminalShadowRunOutcome };
  }
  return { status: 'in_progress' };
}
function sha256(prefix: string, bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(prefix, 'utf8').update(bytes).digest('hex')}`;
}
function digestId(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32); }
