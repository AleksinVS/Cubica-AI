/**
 * PostgreSQL adapter for exact non-production shadow conversations.
 *
 * Every call installs the shadow principal only inside a transaction and uses
 * a fixed non-owning role. Message actor, order, digest and bytes are bound by
 * one insert; the only permitted mutation is a one-way content tombstone.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

import { validateProductKnowledgeContract } from './contracts.ts';
import type {
  ConversationMessage,
  ConversationTurn,
  ModelGatewayRequest,
  ModelGatewayResult,
  ShadowAuthorizationReceipt,
  ShadowContentFreeMetric
} from './generated/product-knowledge.ts';
import { DEFAULT_MODEL_GATEWAY_MAX_REQUEST_BYTES } from './model-gateway.ts';

const THREADS = 'product_context_shadow.conversation_threads';
const MESSAGES = 'product_context_shadow.conversation_messages';
const RUNS = 'product_context_shadow.shadow_runs';
const METRICS = 'product_context_shadow.shadow_metrics';
const cubicaRefPattern = /^cubica:\/\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9._~-]+)+$/;

export type ShadowRunOutcome = ShadowContentFreeMetric['outcome'];
export type TerminalShadowRunOutcome = Exclude<ShadowRunOutcome, 'success' | 'no_change' | 'disabled' | 'gateway_retry_scheduled'>;
export type ShadowRunStatus = 'pending' | 'leased' | 'calling_model' | 'retry_wait' | 'succeeded' | 'denied' | 'failed' | 'blocked';

export interface ShadowRunRecord {
  readonly runId: string;
  readonly ownerRef: string;
  readonly threadRef: string;
  readonly stableTurnKey: string;
  readonly authorizationRevision: string;
  readonly receipt: ShadowAuthorizationReceipt;
  readonly userMessageRef: string;
  readonly userMessageRevision: string;
  readonly userMessageHash: string;
  readonly agentMessageRef: string;
  readonly agentMessageRevision: string;
  readonly agentMessageHash: string;
  readonly status: ShadowRunStatus;
  readonly outcome: ShadowRunOutcome | null;
  readonly requestId: string | null;
  readonly result: ModelGatewayResult | null;
  readonly leaseExpiresAt: string | null;
  readonly retainedUntil: string;
}

export interface AppendExactTurnInput {
  readonly ownerRef: string;
  readonly gameRef: string;
  readonly threadRef: string;
  readonly stableTurnKey: string;
  readonly userBytes: Uint8Array;
  readonly agentBytes: Uint8Array;
  /** Exact bounded request whose base64 messages are persisted by this call. */
  readonly gatewayRequest: ModelGatewayRequest;
  readonly retainedUntil: Date;
  readonly now?: Date;
}

/** Narrow store port used by the coordinator and replaceable in unit tests. */
export interface ShadowConversationStore {
  appendExactTurn(input: AppendExactTurnInput): Promise<ConversationTurn>;
  rereadExactTurn(ownerRef: string, turn: ConversationTurn): Promise<ConversationTurn | null>;
  createRun(receipt: ShadowAuthorizationReceipt, turn: ConversationTurn, retainedUntil: Date): Promise<ShadowRunRecord>;
  claimRun(ownerRef: string, runId: string, requestId: string, leaseMs: number, now?: Date): Promise<ClaimRunResult>;
  completeRun(ownerRef: string, runId: string, result: ModelGatewayResult, outcome: Extract<ShadowRunOutcome, 'success' | 'no_change'>, metric: ShadowContentFreeMetric, now?: Date): Promise<ShadowRunRecord>;
  failRun(ownerRef: string, runId: string, outcome: TerminalShadowRunOutcome, metric: ShadowContentFreeMetric, now?: Date): Promise<ShadowRunRecord>;
  cleanupExpired(limit?: number): Promise<ShadowCleanupResult>;
}

export interface ClaimRunResult { readonly kind: 'claimed' | 'in_progress' | 'terminal'; readonly run: ShadowRunRecord; }
export interface ShadowCleanupResult { readonly runsDeleted: number; readonly messagesTombstoned: number; readonly threadsTombstoned: number; }

export class ConversationConflictError extends Error {
  constructor() { super('Conversation operation conflicts with an existing immutable record.'); this.name = 'ConversationConflictError'; }
}
export class ConversationUnavailableError extends Error {
  constructor() { super('Conversation record is unavailable.'); this.name = 'ConversationUnavailableError'; }
}

export class PostgresConversationStore implements ShadowConversationStore {
  constructor(private readonly pool: Pick<Pool, 'connect'>, private readonly maxRequestBytes = DEFAULT_MODEL_GATEWAY_MAX_REQUEST_BYTES) {
    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) throw new TypeError('A positive request byte limit is required.');
  }

  async appendExactTurn(input: AppendExactTurnInput): Promise<ConversationTurn> {
    assertAppendInput(input, this.maxRequestBytes);
    const now = input.now ?? new Date();
    if (input.retainedUntil.getTime() <= now.getTime()) throw new TypeError('Retention must end after creation.');
    const user = messageIdentity(input, 'user', input.userBytes);
    const agent = messageIdentity(input, 'agent', input.agentBytes);

    return this.withPrincipal(input.ownerRef, async (client) => {
      await client.query(`
        INSERT INTO ${THREADS} AS thread (thread_ref, owner_ref, game_ref, retained_until, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (thread_ref) DO UPDATE
          SET retained_until = GREATEST(thread.retained_until, EXCLUDED.retained_until),
              updated_at = EXCLUDED.updated_at
      `, [input.threadRef, input.ownerRef, input.gameRef, input.retainedUntil.toISOString(), now.toISOString()]);
      const thread = await client.query<{ owner_ref: string; game_ref: string; status: string; retained_until: Date }>(`
        SELECT owner_ref, game_ref, status, retained_until FROM ${THREADS}
        WHERE thread_ref = $1 FOR UPDATE
      `, [input.threadRef]);
      const row = thread.rows[0];
      if (!row || row.owner_ref !== input.ownerRef || row.game_ref !== input.gameRef || row.status !== 'active' || new Date(row.retained_until).getTime() < input.retainedUntil.getTime()) {
        throw new ConversationConflictError();
      }

      const existing = await client.query<MessageRow>(`
        SELECT * FROM ${MESSAGES}
        WHERE thread_ref = $1 AND stable_turn_key = $2
        ORDER BY sequence
      `, [input.threadRef, input.stableTurnKey]);
      if (existing.rows.length > 0) {
        if (existing.rows.length !== 2) throw new ConversationConflictError();
        const turn = turnFromRows(input.threadRef, input.stableTurnKey, existing.rows);
        if (!exactTurnMatches(turn, input.userBytes, input.agentBytes)) throw new ConversationConflictError();
        return turn;
      }

      const sequence = await client.query<{ next_sequence: string }>(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM ${MESSAGES} WHERE thread_ref = $1
      `, [input.threadRef]);
      const first = Number(sequence.rows[0]?.next_sequence ?? 1);
      await client.query(`
        INSERT INTO ${MESSAGES} (
          message_ref, thread_ref, owner_ref, stable_turn_key, sequence, actor,
          revision, content_hash, content_bytes, byte_length, retained_until,
          created_at, updated_at
        ) VALUES
          ($1, $2, $3, $4, $5, 'user', $6, $7, $8, $9, $10, $11, $11),
          ($12, $2, $3, $4, $13, 'agent', $14, $15, $16, $17, $10, $11, $11)
      `, [
        user.ref, input.threadRef, input.ownerRef, input.stableTurnKey, first,
        user.revision, user.contentHash, Buffer.from(input.userBytes), input.userBytes.byteLength,
        input.retainedUntil.toISOString(), now.toISOString(), agent.ref, first + 1,
        agent.revision, agent.contentHash, Buffer.from(input.agentBytes), input.agentBytes.byteLength
      ]);
      const inserted = await client.query<MessageRow>(`
        SELECT * FROM ${MESSAGES} WHERE thread_ref = $1 AND stable_turn_key = $2 ORDER BY sequence
      `, [input.threadRef, input.stableTurnKey]);
      return turnFromRows(input.threadRef, input.stableTurnKey, inserted.rows);
    });
  }

  async rereadExactTurn(ownerRef: string, turn: ConversationTurn): Promise<ConversationTurn | null> {
    return this.withPrincipal(ownerRef, async (client) => {
      const result = await client.query<MessageRow>(`
        SELECT * FROM ${MESSAGES}
        WHERE thread_ref = $1 AND stable_turn_key = $2
          AND message_ref = ANY($3::text[])
        ORDER BY sequence
      `, [turn.thread_ref, turn.stable_turn_key, [turn.user_message.message_ref, turn.agent_message.message_ref]]);
      if (result.rows.length !== 2) return null;
      return turnFromRows(turn.thread_ref, turn.stable_turn_key, result.rows);
    });
  }

  async tombstoneMessage(ownerRef: string, messageRef: string, deletedAt = new Date()): Promise<ConversationMessage> {
    return this.withPrincipal(ownerRef, async (client) => {
      const current = await client.query<MessageRow>(`SELECT * FROM ${MESSAGES} WHERE message_ref = $1 FOR UPDATE`, [messageRef]);
      if (!current.rows[0] || current.rows[0].tombstone) throw new ConversationUnavailableError();
      const revision = sha256('cubica-shadow-message-tombstone/v1\n', new TextEncoder().encode(`${current.rows[0].revision}\n${deletedAt.toISOString()}`));
      const result = await client.query<MessageRow>(`
        UPDATE ${MESSAGES}
        SET content_bytes = NULL, tombstone = true, revision = $2,
            deleted_at = $3, updated_at = $3
        WHERE message_ref = $1 AND NOT tombstone
        RETURNING *
      `, [messageRef, revision, deletedAt.toISOString()]);
      return mapMessage(result.rows[0]!);
    });
  }

  async createRun(receipt: ShadowAuthorizationReceipt, turn: ConversationTurn, retainedUntil: Date): Promise<ShadowRunRecord> {
    assertReceipt(receipt);
    assertTurn(turn);
    const ownerRef = receipt.shadow_principal_ref;
    const runId = `shadowrun_${digestId(`${ownerRef}\n${turn.stable_turn_key}`)}`;
    return this.withPrincipal(ownerRef, async (client) => {
      await client.query(`
        INSERT INTO ${RUNS} (
          run_id, owner_ref, thread_ref, stable_turn_key, authorization_revision,
          authorization_receipt, user_message_ref, user_message_revision,
          user_message_hash, agent_message_ref, agent_message_revision,
          agent_message_hash, retained_until
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (owner_ref, stable_turn_key) DO NOTHING
      `, [
        runId, ownerRef, turn.thread_ref, turn.stable_turn_key, receipt.authorization_revision,
        JSON.stringify(receipt), turn.user_message.message_ref, turn.user_message.revision,
        turn.user_message.content_hash, turn.agent_message.message_ref, turn.agent_message.revision,
        turn.agent_message.content_hash, retainedUntil.toISOString()
      ]);
      const row = await client.query<RunRow>(`SELECT * FROM ${RUNS} WHERE owner_ref = $1 AND stable_turn_key = $2`, [ownerRef, turn.stable_turn_key]);
      const run = mapRun(row.rows[0]!);
      if (run.runId !== runId || !sameReceiptAuthorization(run.receipt, receipt) || !runMatchesTurn(run, turn)) throw new ConversationConflictError();
      if (isTerminal(run.status)) {
        const terminalMetric = await client.query(`SELECT metric_id FROM ${METRICS} WHERE run_id = $1`, [run.runId]);
        if ((terminalMetric.rowCount ?? 0) < 1) throw new ConversationUnavailableError();
      }
      return run;
    });
  }

  async claimRun(ownerRef: string, runId: string, requestId: string, leaseMs: number, now = new Date()): Promise<ClaimRunResult> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError('A positive model lease is required.');
    return this.withPrincipal(ownerRef, async (client) => {
      const selected = await client.query<RunRow>(`SELECT * FROM ${RUNS} WHERE run_id = $1 FOR UPDATE`, [runId]);
      const row = selected.rows[0];
      if (!row) throw new ConversationUnavailableError();
      if (isTerminal(row.status)) return { kind: 'terminal', run: mapRun(row) };
      if (row.status === 'calling_model') {
        if (row.lease_expires_at && new Date(row.lease_expires_at).getTime() > now.getTime()) {
          return { kind: 'in_progress', run: mapRun(row) };
        }
        const terminal = await terminalizeRun(client, row, 'failed', 'gateway_outcome_unknown', metricFromRun(row, 'gateway_outcome_unknown', row.request_id, now), now);
        return { kind: 'terminal', run: terminal };
      }

      const bindingOutcome = await classifyRunBinding(client, row, now);
      if (bindingOutcome) {
        const terminal = await terminalizeRun(client, row, 'failed', bindingOutcome, metricFromRun(row, bindingOutcome, null, now), now);
        return { kind: 'terminal', run: terminal };
      }
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const claimed = await client.query<RunRow>(`
        UPDATE ${RUNS} SET status = 'calling_model', request_id = $2,
          started_at = $3, lease_expires_at = $4, updated_at = $3
        WHERE run_id = $1 AND status = 'pending'
        RETURNING *
      `, [runId, requestId, now.toISOString(), leaseExpiresAt.toISOString()]);
      if (!claimed.rows[0]) throw new ConversationUnavailableError();
      return { kind: 'claimed', run: mapRun(claimed.rows[0]) };
    });
  }

  async completeRun(ownerRef: string, runId: string, result: ModelGatewayResult, outcome: Extract<ShadowRunOutcome, 'success' | 'no_change'>, metric: ShadowContentFreeMetric, now = new Date()): Promise<ShadowRunRecord> {
    if (!validateProductKnowledgeContract<ModelGatewayResult>('ModelGatewayResult', result).ok) throw new TypeError('Invalid gateway result.');
    assertMetric(metric, runId, outcome);
    return this.withPrincipal(ownerRef, async (client) => {
      const selected = await client.query<RunRow>(`SELECT * FROM ${RUNS} WHERE run_id = $1 FOR UPDATE`, [runId]);
      const row = selected.rows[0];
      if (!row || row.status !== 'calling_model') throw new ConversationUnavailableError();
      const bindingOutcome = await classifyRunBinding(client, row, now);
      if (bindingOutcome) {
        return terminalizeRun(client, row, 'failed', bindingOutcome, { ...metric, outcome: bindingOutcome, proposal_operation_count: 0 }, now);
      }
      const completed = await client.query<RunRow>(`
        UPDATE ${RUNS} SET status = 'succeeded', outcome_code = $2,
          result_payload = $3::jsonb, lease_expires_at = NULL,
          completed_at = $4, updated_at = $4
        WHERE run_id = $1 AND status = 'calling_model'
        RETURNING *
      `, [runId, outcome, JSON.stringify(result), now.toISOString()]);
      if (!completed.rows[0]) throw new ConversationUnavailableError();
      await insertMetric(client, ownerRef, metric);
      return mapRun(completed.rows[0]);
    });
  }

  async failRun(ownerRef: string, runId: string, outcome: TerminalShadowRunOutcome, metric: ShadowContentFreeMetric, now = new Date()): Promise<ShadowRunRecord> {
    assertMetric(metric, runId, outcome);
    const status = outcome === 'policy_denied' || outcome === 'authorization_changed' ? 'denied' : 'failed';
    return this.withPrincipal(ownerRef, async (client) => {
      const selected = await client.query<RunRow>(`SELECT * FROM ${RUNS} WHERE run_id = $1 FOR UPDATE`, [runId]);
      const row = selected.rows[0];
      if (!row || (row.status !== 'pending' && row.status !== 'calling_model')) throw new ConversationUnavailableError();
      return terminalizeRun(client, row, status, outcome, metric, now);
    });
  }

  async cleanupExpired(limit = 100): Promise<ShadowCleanupResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('Cleanup limit must be between 1 and 1000.');
    const client = await this.pool.connect();
    let began = false;
    let discard = false;
    try {
      await client.query('BEGIN'); began = true;
      await client.query('SET LOCAL ROLE product_context_shadow_app');
      const result = await client.query<{ runs_deleted: number; messages_tombstoned: number; threads_tombstoned: number }>(
        'SELECT * FROM product_context_shadow.cleanup_expired($1)', [limit]
      );
      await client.query('COMMIT'); began = false;
      const row = result.rows[0]!;
      return { runsDeleted: Number(row.runs_deleted), messagesTombstoned: Number(row.messages_tombstoned), threadsTombstoned: Number(row.threads_tombstoned) };
    } catch (error) {
      if (began) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
      throw error;
    } finally { client.release(discard); }
  }

  private async withPrincipal<T>(ownerRef: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!cubicaRefPattern.test(ownerRef)) throw new TypeError('Invalid shadow principal reference.');
    const client = await this.pool.connect();
    let began = false;
    let discard = false;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query('SET LOCAL ROLE product_context_shadow_app');
      await client.query("SELECT set_config('cubica.shadow_principal_ref', $1, true)", [ownerRef]);
      const value = await work(client);
      await client.query('COMMIT');
      began = false;
      return value;
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
}

interface MessageRow {
  message_ref: string; thread_ref: string; stable_turn_key: string; sequence: string | number;
  actor: 'user' | 'agent'; revision: string; content_hash: string; content_bytes: Buffer | null;
  byte_length: number; tombstone: boolean; retained_until: Date | string; created_at: Date | string; deleted_at: Date | string | null;
}
interface RunRow {
  run_id: string; owner_ref: string; thread_ref: string; stable_turn_key: string; authorization_revision: string;
  authorization_receipt: ShadowAuthorizationReceipt; user_message_ref: string; user_message_revision: string; user_message_hash: string;
  agent_message_ref: string; agent_message_revision: string; agent_message_hash: string; status: ShadowRunStatus;
  outcome_code: ShadowRunOutcome | null; request_id: string | null; result_payload: ModelGatewayResult | null;
  started_at: Date | string | null; lease_expires_at: Date | string | null; retained_until: Date | string;
}
interface ThreadRow { thread_ref: string; owner_ref: string; game_ref: string; status: 'active' | 'tombstoned'; retained_until: Date | string; }

function mapMessage(row: MessageRow): ConversationMessage {
  const value: ConversationMessage = {
    schema_version: '1.0.0', message_ref: row.message_ref, thread_ref: row.thread_ref,
    stable_turn_key: row.stable_turn_key, sequence: Number(row.sequence), actor: row.actor,
    revision: row.revision, content_hash: row.content_hash, byte_length: row.byte_length,
    content_base64: row.content_bytes ? row.content_bytes.toString('base64') : null,
    tombstone: row.tombstone, retained_until: new Date(row.retained_until).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    ...(row.deleted_at ? { deleted_at: new Date(row.deleted_at).toISOString() } : {})
  };
  if (!validateProductKnowledgeContract<ConversationMessage>('ConversationMessage', value).ok) throw new ConversationUnavailableError();
  return value;
}

function turnFromRows(threadRef: string, stableTurnKey: string, rows: readonly MessageRow[]): ConversationTurn {
  const messages = rows.map(mapMessage);
  const user = messages.find((message) => message.actor === 'user');
  const agent = messages.find((message) => message.actor === 'agent');
  if (!user || !agent || user.sequence >= agent.sequence) throw new ConversationConflictError();
  const turn: ConversationTurn = {
    schema_version: '1.0.0', turn_ref: `${threadRef}/turn/${digestId(stableTurnKey)}`,
    thread_ref: threadRef, stable_turn_key: stableTurnKey,
    user_message: user, agent_message: agent, created_at: user.created_at
  };
  assertTurn(turn);
  return turn;
}

function mapRun(row: RunRow): ShadowRunRecord {
  return {
    runId: row.run_id, ownerRef: row.owner_ref, threadRef: row.thread_ref,
    stableTurnKey: row.stable_turn_key, authorizationRevision: row.authorization_revision,
    receipt: row.authorization_receipt, userMessageRef: row.user_message_ref,
    userMessageRevision: row.user_message_revision, userMessageHash: row.user_message_hash,
    agentMessageRef: row.agent_message_ref, agentMessageRevision: row.agent_message_revision,
    agentMessageHash: row.agent_message_hash, status: row.status, outcome: row.outcome_code,
    requestId: row.request_id, result: row.result_payload,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    retainedUntil: new Date(row.retained_until).toISOString()
  };
}

async function classifyRunBinding(client: PoolClient, run: RunRow, now: Date): Promise<'message_deleted' | 'message_changed' | 'retention_expired' | null> {
  const threadResult = await client.query<ThreadRow>(`SELECT * FROM ${THREADS} WHERE thread_ref = $1 FOR UPDATE`, [run.thread_ref]);
  const messagesResult = await client.query<MessageRow>(`
    SELECT * FROM ${MESSAGES} WHERE message_ref = ANY($1::text[]) ORDER BY sequence FOR UPDATE
  `, [[run.user_message_ref, run.agent_message_ref]]);
  const thread = threadResult.rows[0];
  if (!thread || thread.status !== 'active' || messagesResult.rows.length !== 2) return 'message_deleted';
  if (new Date(run.retained_until).getTime() <= now.getTime() ||
      new Date(thread.retained_until).getTime() <= now.getTime() ||
      messagesResult.rows.some((message) => new Date(message.retained_until).getTime() <= now.getTime())) return 'retention_expired';
  if (thread.game_ref !== run.authorization_receipt.applies_to[0]) return 'message_changed';
  const user = messagesResult.rows.find((message) => message.message_ref === run.user_message_ref);
  const agent = messagesResult.rows.find((message) => message.message_ref === run.agent_message_ref);
  if (!user || !agent || user.tombstone || agent.tombstone || !user.content_bytes || !agent.content_bytes) return 'message_deleted';
  const exact = (message: MessageRow, actor: 'user' | 'agent', revision: string, contentHash: string) =>
    message.actor === actor && message.revision === revision && message.content_hash === contentHash &&
    message.byte_length === message.content_bytes!.byteLength && sha256('', message.content_bytes!) === contentHash;
  return exact(user, 'user', run.user_message_revision, run.user_message_hash) &&
    exact(agent, 'agent', run.agent_message_revision, run.agent_message_hash) ? null : 'message_changed';
}

async function terminalizeRun(
  client: PoolClient,
  run: RunRow,
  status: 'denied' | 'failed',
  outcome: TerminalShadowRunOutcome,
  metric: ShadowContentFreeMetric,
  now: Date
): Promise<ShadowRunRecord> {
  assertMetric(metric, run.run_id, outcome);
  const updated = await client.query<RunRow>(`
    UPDATE ${RUNS} SET status = $2, outcome_code = $3, result_payload = NULL,
      lease_expires_at = NULL, completed_at = $4, updated_at = $4
    WHERE run_id = $1 AND status IN ('pending', 'calling_model')
    RETURNING *
  `, [run.run_id, status, outcome, now.toISOString()]);
  if (!updated.rows[0]) throw new ConversationUnavailableError();
  await insertMetric(client, run.owner_ref, metric);
  return mapRun(updated.rows[0]);
}

async function insertMetric(client: PoolClient, ownerRef: string, metric: ShadowContentFreeMetric): Promise<void> {
  await client.query(`
    INSERT INTO ${METRICS} (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms,
      input_bytes, output_bytes, proposal_operation_count,
      authorization_revision, external_processing_policy_ref,
      external_processing_policy_revision, recorded_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [
    metric.metric_id, metric.run_id, ownerRef, metric.request_id, metric.outcome,
    metric.duration_ms, metric.input_bytes, metric.output_bytes,
    metric.proposal_operation_count, metric.authorization_revision,
    metric.external_processing_policy_ref, metric.external_processing_policy_revision,
    metric.recorded_at
  ]);
}

function metricFromRun(run: RunRow, outcome: TerminalShadowRunOutcome, requestId: string | null, now: Date): ShadowContentFreeMetric {
  return {
    schema_version: '1.0.0', metric_id: `metric_${digestId(run.run_id)}`, run_id: run.run_id,
    request_id: requestId, outcome, duration_ms: 0, input_bytes: 0, output_bytes: 0,
    proposal_operation_count: 0, authorization_revision: run.authorization_revision,
    external_processing_policy_ref: run.authorization_receipt.external_processing_policy_ref,
    external_processing_policy_revision: run.authorization_receipt.external_processing_policy_revision,
    recorded_at: now.toISOString()
  };
}

function assertMetric(metric: ShadowContentFreeMetric, runId: string, outcome: ShadowRunOutcome): void {
  if (!validateProductKnowledgeContract<ShadowContentFreeMetric>('ShadowContentFreeMetric', metric).ok ||
      metric.run_id !== runId || metric.outcome !== outcome) throw new TypeError('Invalid content-free metric.');
}

function isTerminal(status: ShadowRunStatus): boolean { return status === 'succeeded' || status === 'denied' || status === 'failed' || status === 'blocked'; }

function messageIdentity(input: AppendExactTurnInput, actor: 'user' | 'agent', bytes: Uint8Array) {
  return {
    ref: `${input.threadRef}/message/${digestId(`${input.ownerRef}\n${input.stableTurnKey}\n${actor}`)}`,
    contentHash: sha256('', bytes),
    revision: sha256(`cubica-shadow-conversation-message/v1\n${actor}\n`, bytes)
  };
}
function sha256(prefix: string, bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(prefix, 'utf8').update(bytes).digest('hex')}`;
}
function digestId(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32); }
function decoded(message: ConversationMessage): Uint8Array | null { return message.content_base64 === null ? null : Buffer.from(message.content_base64, 'base64'); }
function exactTurnMatches(turn: ConversationTurn, userBytes: Uint8Array, agentBytes: Uint8Array): boolean {
  const user = decoded(turn.user_message); const agent = decoded(turn.agent_message);
  return Boolean(user && agent && Buffer.from(user).equals(Buffer.from(userBytes)) && Buffer.from(agent).equals(Buffer.from(agentBytes)));
}
function runMatchesTurn(run: ShadowRunRecord, turn: ConversationTurn): boolean {
  return run.threadRef === turn.thread_ref && run.userMessageRef === turn.user_message.message_ref &&
    run.userMessageRevision === turn.user_message.revision && run.userMessageHash === turn.user_message.content_hash &&
    run.agentMessageRef === turn.agent_message.message_ref && run.agentMessageRevision === turn.agent_message.revision &&
    run.agentMessageHash === turn.agent_message.content_hash;
}
function sameReceiptAuthorization(left: ShadowAuthorizationReceipt, right: ShadowAuthorizationReceipt): boolean {
  const securityBinding = (receipt: ShadowAuthorizationReceipt) => ({
    decision: receipt.decision, principal: receipt.shadow_principal_ref, role: receipt.role_scope,
    appliesTo: receipt.applies_to, access: [receipt.access_policy_ref, receipt.access_policy_revision],
    retention: [receipt.retention_policy_ref, receipt.retention_policy_revision],
    external: [receipt.external_processing_policy_ref, receipt.external_processing_policy_revision],
    authorization: receipt.authorization_revision
  });
  return isDeepStrictEqual(securityBinding(left), securityBinding(right));
}
function assertAppendInput(input: AppendExactTurnInput, maxRequestBytes: number): void {
  if (!cubicaRefPattern.test(input.ownerRef) || !cubicaRefPattern.test(input.threadRef) || !/^cubica:\/\/game-project\/[A-Za-z0-9._~-]+$/.test(input.gameRef)) throw new TypeError('Invalid conversation partition reference.');
  if (input.stableTurnKey.length < 16 || input.stableTurnKey.length > 200) throw new TypeError('Invalid stable turn key.');
  if (!(input.userBytes instanceof Uint8Array) || !(input.agentBytes instanceof Uint8Array)) throw new TypeError('Invalid message bytes.');
  const validated = validateProductKnowledgeContract<ModelGatewayRequest>('ModelGatewayRequest', input.gatewayRequest);
  if (!validated.ok || requestByteLength(input.gatewayRequest) > maxRequestBytes ||
      input.gatewayRequest.shadow_principal_ref !== input.ownerRef || input.gatewayRequest.applies_to[0] !== input.gameRef) {
    throw new TypeError('Invalid or oversized gateway request.');
  }
  const user = messageIdentity(input, 'user', input.userBytes);
  const agent = messageIdentity(input, 'agent', input.agentBytes);
  const exact = (index: number, actor: 'user' | 'agent', identity: ReturnType<typeof messageIdentity>, bytes: Uint8Array) => {
    const message = input.gatewayRequest.messages[index];
    return message?.actor === actor && message.message_ref === identity.ref && message.revision === identity.revision &&
      message.content_hash === identity.contentHash && Buffer.from(message.content_base64, 'base64').equals(Buffer.from(bytes));
  };
  if (!exact(0, 'user', user, input.userBytes) || !exact(1, 'agent', agent, input.agentBytes)) throw new TypeError('Gateway request does not bind the exact turn.');
}
function requestByteLength(request: ModelGatewayRequest): number { return new TextEncoder().encode(JSON.stringify(request)).byteLength; }
function assertReceipt(candidate: unknown): asserts candidate is ShadowAuthorizationReceipt {
  if (!validateProductKnowledgeContract<ShadowAuthorizationReceipt>('ShadowAuthorizationReceipt', candidate).ok) throw new TypeError('Invalid shadow authorization receipt.');
}
function assertTurn(candidate: unknown): asserts candidate is ConversationTurn {
  if (!validateProductKnowledgeContract<ConversationTurn>('ConversationTurn', candidate).ok) throw new TypeError('Invalid exact conversation turn.');
}
