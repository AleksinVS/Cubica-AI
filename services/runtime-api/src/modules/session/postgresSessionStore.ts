/**
 * PostgreSQL-backed authenticated session and command-ledger store.
 *
 * Every mutating operation uses one checked-out client. A gameplay command
 * locks its session row, authenticates the principal, reads any prior receipt,
 * and commits the next state plus the new receipt in the same transaction.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateSessionInput,
  CreatedSession,
  ImmutableGameBundle,
  LockedSessionOperation,
  SessionAuthenticationInput,
  SessionCommandReceipt,
  SessionCommandTransaction,
  SessionCommandTransactionInput,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord,
  SessionRole,
  SessionStorePort,
  SessionSystemCommandTransaction,
  SessionSystemCommandTransactionInput,
  SessionSystemSchedule,
  SessionSystemScheduleMutation,
  UpdateSessionOptions
} from "@cubica/contracts-session";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { isValidImmutableBundleInput } from "../content/immutableBundle.ts";
import { assertCommandTransactionResult } from "./commandTransactionValidation.ts";
import {
  createSystemCommandFingerprint,
  createSystemCommandId,
  requireProtectedMechanicsAudit
} from "./commandIdentity.ts";
import {
  assertNextSessionVersion,
  assertProtectedEventSequenceUnchanged,
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";

interface SessionRow extends QueryResultRow {
  session_id: string;
  game_id: string;
  bundle_hash: string;
  content_source_id: string | null;
  session_role: SessionRole | null;
  state: unknown;
  state_version: string | number;
  last_event_sequence: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PrincipalRow extends QueryResultRow {
  principal_id: string;
  session_id: string;
  principal_kind: SessionPrincipal["kind"];
  session_role: SessionRole;
  actor_scope: unknown;
  created_at: Date | string;
}

interface BundleRow extends QueryResultRow {
  bundle_hash: string;
  game_id: string;
  canonical_bytes: Uint8Array;
  canonical_bundle: unknown;
  created_at: Date | string;
}

interface ReceiptRow extends QueryResultRow {
  receipt_id: string;
  session_id: string;
  principal_id: string;
  command_id: string;
  fingerprint: string;
  action_id: string;
  actor_id: string | null;
  bundle_hash: string;
  definition_hash: string;
  plan_hash: string | null;
  state_version_before: string | number;
  state_version_after: string | number;
  status: SessionCommandReceipt["status"];
  event_refs: unknown;
  public_receipt: unknown;
  command_result: unknown | null;
  audit: unknown;
  created_at: Date | string;
}

interface EventRow extends QueryResultRow {
  event_id: string;
  session_id: string;
  sequence: string | number;
  receipt_id: string;
  command_id: string;
  action_id: string;
  principal_id: string;
  actor_id: string | null;
  audience: SessionEventRecord["audience"];
  event_type: string;
  summary: unknown;
  event_data: unknown;
  created_at: Date | string;
}

interface SystemScheduleRow extends QueryResultRow {
  schedule_id: string;
  session_id: string;
  bundle_hash: string;
  action_id: string;
  params: unknown;
  definition_hash: string;
  trigger: unknown;
  false_policy: SessionSystemSchedule["falsePolicy"];
  max_occurrences: string | number;
  next_occurrence: string | number;
  status: SessionSystemSchedule["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface SessionReadinessRow extends QueryResultRow {
  writable: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
}

/** Minimal node-postgres client surface used by the adapter and unit tests. */
export interface SessionDatabaseClient {
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TRow>>;
  release(error?: Error | boolean): void;
}

/** Minimal node-postgres pool surface used by the adapter and unit tests. */
export interface SessionDatabasePool {
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TRow>>;
  connect(): Promise<SessionDatabaseClient>;
  end(): Promise<void>;
}

const SESSION_COLUMNS = `
  id AS session_id,
  game_id,
  bundle_hash,
  content_source_id,
  session_role,
  state,
  state_version,
  last_event_sequence,
  created_at,
  updated_at
`;
const SELECT_SESSION = `SELECT ${SESSION_COLUMNS}
  FROM game_sessions
  WHERE id = $1 AND archived_at IS NULL AND bundle_hash IS NOT NULL`;
const SELECT_SESSION_FOR_UPDATE = `${SELECT_SESSION} FOR UPDATE NOWAIT`;
const SYSTEM_SCHEDULE_COLUMNS = `
  schedule_id,
  session_id,
  bundle_hash,
  action_id,
  params,
  definition_hash,
  trigger,
  false_policy,
  max_occurrences,
  next_occurrence,
  status,
  created_at,
  updated_at
`;

export class PostgresSessionStore<TState = unknown> implements SessionStorePort<TState> {
  readonly mode = "postgresql";
  private readonly pool: SessionDatabasePool;

  constructor(pool: SessionDatabasePool) {
    this.pool = pool;
  }

  async createSession(input: CreateSessionInput<TState>): Promise<CreatedSession<TState>> {
    assertCreateInput(input);
    const sessionId = randomUUID();
    const now = new Date();
    let client: SessionDatabaseClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
    let transactionStarted = false;
    let releaseError: Error | boolean | undefined;

    try {
      await queryClient(client, sessionId, "BEGIN");
      transactionStarted = true;
      const bundleWrite = await queryClient<BundleRow>(
        client,
        sessionId,
        `INSERT INTO game_bundles (bundle_hash, game_id, canonical_bytes, canonical_bundle)
         VALUES ($1, $2, $3::bytea, $4::jsonb)
         ON CONFLICT (bundle_hash) DO UPDATE
           SET bundle_hash = EXCLUDED.bundle_hash
           WHERE game_bundles.game_id = EXCLUDED.game_id
             AND game_bundles.canonical_bytes = EXCLUDED.canonical_bytes
             AND game_bundles.canonical_bundle = EXCLUDED.canonical_bundle
         RETURNING bundle_hash, game_id, canonical_bytes, canonical_bundle, created_at`,
        [
          input.immutableBundle.bundleHash,
          input.immutableBundle.gameId,
          Buffer.from(input.immutableBundle.canonicalBytes),
          JSON.stringify(input.immutableBundle.canonicalBundle)
        ]
      );
      if (bundleWrite.rowCount !== 1) {
        throw new SessionStoreUnavailableError();
      }

      const sessionWrite = await queryClient<SessionRow>(
        client,
        sessionId,
        `INSERT INTO game_sessions (
           id, game_id, bundle_hash, content_source_id, session_role, state,
           state_version, last_event_sequence
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 0)
         RETURNING ${SESSION_COLUMNS}`,
        [
          sessionId,
          input.gameId,
          input.immutableBundle.bundleHash,
          input.contentSourceId ?? null,
          input.sessionRole ?? null,
          JSON.stringify(input.initialState)
        ]
      );
      const principalWrite = await queryClient<PrincipalRow>(
        client,
        sessionId,
        `INSERT INTO session_principals (
           principal_id, session_id, principal_kind, session_role,
           actor_scope, credential_sha256
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING principal_id, session_id, principal_kind, session_role, actor_scope, created_at`,
        [
          input.principal.principalId,
          sessionId,
          input.principal.kind,
          input.principal.role,
          JSON.stringify(input.principal.actorScope),
          input.principal.credentialSha256
        ]
      );
      await queryClient(client, sessionId, "COMMIT");
      return {
        session: mapSessionRow<TState>(requireSingleRow(sessionWrite)),
        principal: mapPrincipalRow(requireSingleRow(principalWrite))
      };
    } catch (error) {
      if (transactionStarted) {
        releaseError = await rollbackAfterFailure(client, error);
      }
      throw mapDatabaseOperationalError(error);
    } finally {
      client.release(releaseError);
    }
  }

  async getSession(sessionId: string): Promise<SessionRecord<TState> | null> {
    try {
      const result = await this.pool.query<SessionRow>(SELECT_SESSION, [sessionId]);
      return result.rows[0] === undefined ? null : mapSessionRow<TState>(result.rows[0]);
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async authenticateSession(input: SessionAuthenticationInput): Promise<SessionPrincipal | null> {
    try {
      const result = await this.pool.query<PrincipalRow>(
        `SELECT p.principal_id, p.session_id, p.principal_kind, p.session_role,
                p.actor_scope, p.created_at
         FROM session_principals p
         JOIN game_sessions s ON s.id = p.session_id
         WHERE p.session_id = $1 AND p.credential_sha256 = $2
           AND s.archived_at IS NULL AND s.bundle_hash IS NOT NULL`,
        [input.sessionId, input.credentialSha256]
      );
      return result.rows[0] === undefined ? null : mapPrincipalRow(result.rows[0]);
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async getImmutableBundle(bundleHash: string): Promise<ImmutableGameBundle | null> {
    try {
      const result = await this.pool.query<BundleRow>(
        `SELECT bundle_hash, game_id, canonical_bytes, canonical_bundle, created_at
         FROM game_bundles WHERE bundle_hash = $1`,
        [bundleHash]
      );
      return result.rows[0] === undefined ? null : mapBundleRow(result.rows[0]);
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async getSessionEvents(sessionId: string, afterSequence = 0): Promise<Array<SessionEventRecord>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new SessionStoreUnavailableError();
    try {
      const result = await this.pool.query<EventRow>(
        `${SELECT_EVENT} WHERE session_id = $1 AND sequence > $2 ORDER BY sequence ASC`,
        [sessionId, afterSequence]
      );
      return result.rows.map(mapEventRow);
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async listPendingSystemSchedules(sessionId: string, limit = 64): Promise<Array<SessionSystemSchedule>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new SessionStoreUnavailableError();
    }
    try {
      const result = await this.pool.query<SystemScheduleRow>(
        `SELECT ${SYSTEM_SCHEDULE_COLUMNS}
         FROM system_schedules
         WHERE session_id = $1 AND status = 'pending'
         ORDER BY created_at ASC, schedule_id ASC
         LIMIT $2`,
        [sessionId, limit]
      );
      return result.rows.map(mapSystemScheduleRow);
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async updateSession(
    session: SessionRecord<TState>,
    options: UpdateSessionOptions
  ): Promise<SessionRecord<TState>> {
    return this.withLockedSession(session.sessionId, async (current) => {
      if (current === null || current.version.stateVersion !== options.expectedStateVersion) {
        throw new SessionVersionConflictError(session.sessionId, options.expectedStateVersion);
      }
      return { result: session, updatedSession: session };
    });
  }

  async withLockedSession<TResult>(
    sessionId: string,
    operation: LockedSessionOperation<TState, TResult>
  ): Promise<TResult> {
    return this.runLockedTransaction(sessionId, async (client, current) => {
      const operationResult = await operation(current);
      if (operationResult.updatedSession !== undefined) {
        if (current === null) {
          throw new SessionVersionConflictError(sessionId, 0);
        }
        assertProtectedEventSequenceUnchanged(current, operationResult.updatedSession);
        await this.writeUpdatedSession(client, current, operationResult.updatedSession);
      }
      return operationResult.result;
    });
  }

  async withCommandTransaction<TResult>(
    input: SessionCommandTransactionInput,
    operation: SessionCommandTransaction<TState, TResult>
  ): Promise<TResult> {
    return this.runLockedTransaction(input.sessionId, async (client, current) => {
      if (current === null) {
        throw new SessionAuthenticationError();
      }
      const principalRead = await queryClient<PrincipalRow>(
        client,
        input.sessionId,
        `SELECT principal_id, session_id, principal_kind, session_role, actor_scope, created_at
         FROM session_principals
         WHERE session_id = $1 AND credential_sha256 = $2`,
        [input.sessionId, input.credentialSha256]
      );
      const principalRow = principalRead.rows[0];
      if (principalRow === undefined) {
        throw new SessionAuthenticationError();
      }
      const principal = mapPrincipalRow(principalRow);

      const bundleRead = await queryClient<BundleRow>(
        client,
        input.sessionId,
        `SELECT bundle_hash, game_id, canonical_bytes, canonical_bundle, created_at
         FROM game_bundles WHERE bundle_hash = $1`,
        [current.bundleHash]
      );
      const bundleRow = bundleRead.rows[0];
      if (bundleRow === undefined) {
        throw new SessionStoreUnavailableError();
      }
      const receiptRead = await queryClient<ReceiptRow>(
        client,
        input.sessionId,
        `${SELECT_RECEIPT}
         WHERE session_id = $1 AND principal_id = $2 AND command_id = $3`,
        [input.sessionId, principal.principalId, input.commandId]
      );
      const existingReceipt = receiptRead.rows[0] === undefined
        ? undefined
        : mapReceiptRow(receiptRead.rows[0]);
      const operationResult = await operation({
        currentSession: current,
        principal,
        bundle: mapBundleRow(bundleRow),
        ...(existingReceipt === undefined ? {} : { existingReceipt })
      });

      assertCommandTransactionResult({
        input,
        current,
        principal,
        existingReceipt,
        updatedSession: operationResult.updatedSession,
        receipt: operationResult.receipt,
        events: operationResult.events
      });
      if (operationResult.updatedSession !== undefined) {
        await this.writeUpdatedSession(client, current, operationResult.updatedSession);
      }
      if (operationResult.receipt !== undefined) {
        await insertReceipt(client, operationResult.receipt);
      }
      if (operationResult.events !== undefined && operationResult.events.length > 0) {
        await insertEvents(client, operationResult.events);
      }
      const scheduleMutations = operationResult.scheduleMutations ?? [];
      if (scheduleMutations.length > 0) {
        if (operationResult.receipt?.status !== "applied" || operationResult.updatedSession === undefined) {
          throw new SessionStoreUnavailableError();
        }
        assertScheduleMutationInputs(current, scheduleMutations);
        await applyScheduleMutations(client, current, scheduleMutations);
      }
      return operationResult.result;
    });
  }

  async withSystemCommandTransaction<TResult>(
    input: SessionSystemCommandTransactionInput,
    operation: SessionSystemCommandTransaction<TState, TResult>
  ): Promise<TResult> {
    if (!isExactSystemCommandId(input)) {
      throw new SessionAuthenticationError();
    }

    return this.runLockedTransaction(input.sessionId, async (client, current) => {
      if (current === null) {
        throw new SessionAuthenticationError();
      }

      const principalId = systemSchedulerPrincipalId(current.sessionId);
      // Idempotency wins over occurrence state: a delivery retried after the
      // occurrence was consumed must still recover its terminal receipt.
      const receiptRead = await queryClient<ReceiptRow>(
        client,
        input.sessionId,
        `${SELECT_RECEIPT}
         WHERE session_id = $1 AND principal_id = $2 AND command_id = $3`,
        [input.sessionId, principalId, input.commandId]
      );
      const existingReceipt = receiptRead.rows[0] === undefined
        ? undefined
        : mapReceiptRow(receiptRead.rows[0]);

      const scheduleRead = await queryClient<SystemScheduleRow>(
        client,
        input.sessionId,
        `SELECT ${SYSTEM_SCHEDULE_COLUMNS}
         FROM system_schedules
         WHERE session_id = $1 AND schedule_id = $2
         FOR UPDATE`,
        [input.sessionId, input.scheduleId]
      );
      const scheduleRow = scheduleRead.rows[0];
      if (scheduleRow === undefined) {
        throw new SessionAuthenticationError();
      }
      const schedule = mapSystemScheduleRow(scheduleRow);
      if (schedule.sessionId !== current.sessionId || schedule.bundleHash !== current.bundleHash) {
        throw new SessionAuthenticationError();
      }

      const bundleRead = await queryClient<BundleRow>(
        client,
        input.sessionId,
        `SELECT bundle_hash, game_id, canonical_bytes, canonical_bundle, created_at
         FROM game_bundles WHERE bundle_hash = $1`,
        [current.bundleHash]
      );
      const bundleRow = bundleRead.rows[0];
      if (bundleRow === undefined) {
        throw new SessionStoreUnavailableError();
      }

      const principal = systemSchedulerPrincipal(current.sessionId, schedule.createdAt);
      if (existingReceipt !== undefined) {
        assertSystemReceiptPins(input, schedule, existingReceipt);
      } else if (schedule.status !== "pending" || schedule.nextOccurrence !== input.occurrence) {
        throw new SessionAuthenticationError();
      }

      const operationResult = await operation({
        currentSession: current,
        principal,
        bundle: mapBundleRow(bundleRow),
        schedule,
        ...(existingReceipt === undefined ? {} : { existingReceipt })
      });
      assertSystemDisposition(existingReceipt, operationResult);
      assertCommandTransactionResult({
        input: { sessionId: input.sessionId, commandId: input.commandId, credentialSha256: "" },
        current,
        principal,
        existingReceipt,
        updatedSession: operationResult.updatedSession,
        receipt: operationResult.receipt,
        events: operationResult.events
      });
      if (operationResult.receipt !== undefined) {
        assertSystemReceiptPins(input, schedule, operationResult.receipt);
      }

      if (operationResult.updatedSession !== undefined) {
        await this.writeUpdatedSession(client, current, operationResult.updatedSession);
      }
      if (operationResult.receipt !== undefined) {
        await insertReceipt(client, operationResult.receipt);
      }
      if (operationResult.events !== undefined && operationResult.events.length > 0) {
        await insertEvents(client, operationResult.events);
      }
      if (existingReceipt === undefined && operationResult.scheduleDisposition !== "defer") {
        await consumeScheduleOccurrence(client, schedule);
      }
      return operationResult.result;
    });
  }

  async checkReadiness(): Promise<void> {
    try {
      const result = await this.pool.query<SessionReadinessRow>(`
        WITH session_probe AS (
          SELECT id, game_id, bundle_hash, content_source_id, session_role, state,
                 history, state_version, last_event_sequence, archived_at, created_at, updated_at
          FROM game_sessions LIMIT 0
        ), principal_probe AS (
          SELECT principal_id, session_id, principal_kind, session_role,
                 actor_scope, credential_sha256, created_at
          FROM session_principals LIMIT 0
        ), bundle_probe AS (
          SELECT bundle_hash, game_id, canonical_bytes, canonical_bundle, created_at
          FROM game_bundles LIMIT 0
        ), receipt_probe AS (
          SELECT receipt_id, session_id, principal_id, command_id, fingerprint,
                 action_id, actor_id, bundle_hash, definition_hash, plan_hash,
                 state_version_before, state_version_after, status, event_refs,
                 public_receipt, command_result, audit, created_at
          FROM command_receipts LIMIT 0
        ), event_probe AS (
          SELECT event_id, session_id, sequence, receipt_id, command_id, action_id,
                 principal_id, actor_id, audience, event_type, summary, event_data, created_at
          FROM session_events LIMIT 0
        ), schedule_probe AS (
          SELECT ${SYSTEM_SCHEDULE_COLUMNS}
          FROM system_schedules LIMIT 0
        )
        SELECT
          current_setting('transaction_read_only') = 'off' AS writable,
          has_table_privilege(current_user, 'game_sessions', 'SELECT')
            AND has_table_privilege(current_user, 'session_principals', 'SELECT')
            AND has_table_privilege(current_user, 'game_bundles', 'SELECT')
            AND has_table_privilege(current_user, 'command_receipts', 'SELECT')
            AND has_table_privilege(current_user, 'session_events', 'SELECT')
            AND has_table_privilege(current_user, 'system_schedules', 'SELECT') AS can_select,
          has_table_privilege(current_user, 'game_sessions', 'INSERT')
            AND has_table_privilege(current_user, 'session_principals', 'INSERT')
            AND has_table_privilege(current_user, 'game_bundles', 'INSERT')
            AND has_table_privilege(current_user, 'command_receipts', 'INSERT')
            AND has_table_privilege(current_user, 'session_events', 'INSERT')
            AND has_table_privilege(current_user, 'system_schedules', 'INSERT') AS can_insert,
          has_table_privilege(current_user, 'game_sessions', 'UPDATE')
            AND has_table_privilege(current_user, 'system_schedules', 'UPDATE') AS can_update
      `);
      const readiness = result.rows[0];
      if (
        readiness === undefined || readiness.writable !== true || readiness.can_select !== true ||
        readiness.can_insert !== true || readiness.can_update !== true
      ) {
        throw new SessionStoreUnavailableError();
      }
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async runLockedTransaction<TResult>(
    sessionId: string,
    operation: (client: SessionDatabaseClient, current: SessionRecord<TState> | null) => Promise<TResult>
  ): Promise<TResult> {
    let client: SessionDatabaseClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw mapDatabaseOperationalError(error);
    }
    let transactionStarted = false;
    let releaseError: Error | boolean | undefined;
    try {
      await queryClient(client, sessionId, "BEGIN");
      transactionStarted = true;
      const selected = await queryClient<SessionRow>(client, sessionId, SELECT_SESSION_FOR_UPDATE, [sessionId]);
      const current = selected.rows[0] === undefined ? null : mapSessionRow<TState>(selected.rows[0]);
      const result = await operation(client, current);
      await queryClient(client, sessionId, "COMMIT");
      return result;
    } catch (error) {
      if (transactionStarted) {
        releaseError = await rollbackAfterFailure(client, error);
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  private async writeUpdatedSession(
    client: SessionDatabaseClient,
    current: SessionRecord<TState>,
    updated: SessionRecord<TState>
  ): Promise<void> {
    assertNextSessionVersion(current.sessionId, current, updated);
    if (updated.bundleHash !== current.bundleHash || updated.gameId !== current.gameId) {
      throw new SessionStoreUnavailableError();
    }
    const write = await queryClient<SessionRow>(
      client,
      current.sessionId,
      `UPDATE game_sessions SET
         content_source_id = $2,
         session_role = $3,
         state = $4::jsonb,
         state_version = $5,
         last_event_sequence = $6,
         updated_at = $7
       WHERE id = $1 AND state_version = $8 AND archived_at IS NULL
       RETURNING ${SESSION_COLUMNS}`,
      [
        current.sessionId,
        updated.contentSourceId ?? null,
        updated.sessionRole ?? null,
        JSON.stringify(updated.state),
        updated.version.stateVersion,
        updated.version.lastEventSequence,
        updated.updatedAt,
        current.version.stateVersion
      ]
    );
    if (write.rowCount !== 1) {
      throw new SessionVersionConflictError(current.sessionId, current.version.stateVersion);
    }
  }
}

const SELECT_RECEIPT = `SELECT
  receipt_id, session_id, principal_id, command_id, fingerprint, action_id,
  actor_id, bundle_hash, definition_hash, plan_hash, state_version_before,
  state_version_after, status, event_refs, public_receipt, command_result, audit, created_at
  FROM command_receipts`;

const SELECT_EVENT = `SELECT
  event_id, session_id, sequence, receipt_id, command_id, action_id,
  principal_id, actor_id, audience, event_type, summary, event_data, created_at
  FROM session_events`;

async function insertReceipt(client: SessionDatabaseClient, receipt: SessionCommandReceipt): Promise<void> {
  await queryClient(
    client,
    receipt.sessionId,
    `INSERT INTO command_receipts (
       receipt_id, session_id, principal_id, command_id, fingerprint, action_id,
       actor_id, bundle_hash, definition_hash, plan_hash, state_version_before,
       state_version_after, status, event_refs, public_receipt, command_result, audit, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18
     )`,
    [
      receipt.receiptId,
      receipt.sessionId,
      receipt.principalId,
      receipt.commandId,
      receipt.fingerprint,
      receipt.actionId,
      receipt.actorId ?? null,
      receipt.bundleHash,
      receipt.definitionHash,
      receipt.planHash ?? null,
      receipt.stateVersionBefore,
      receipt.stateVersionAfter,
      receipt.status,
      JSON.stringify(receipt.eventRefs),
      JSON.stringify(receipt.publicReceipt),
      receipt.result === undefined ? null : JSON.stringify(receipt.result),
      JSON.stringify(receipt.audit),
      receipt.createdAt
    ]
  );
}

async function insertEvents(
  client: SessionDatabaseClient,
  events: ReadonlyArray<SessionEventRecord>
): Promise<void> {
  for (const event of events) {
    await queryClient(
      client,
      event.sessionId,
      `INSERT INTO session_events (
         event_id, session_id, sequence, receipt_id, command_id, action_id,
         principal_id, actor_id, audience, event_type, summary, event_data, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13
       )`,
      [
        event.eventId,
        event.sessionId,
        event.sequence,
        event.receiptId,
        event.commandId,
        event.actionId,
        event.principalId,
        event.actorId ?? null,
        event.audience,
        event.eventType,
        JSON.stringify(event.summary ?? null),
        JSON.stringify(event.data),
        event.createdAt
      ]
    );
  }
}

function isExactSystemCommandId(input: SessionSystemCommandTransactionInput): boolean {
  try {
    return input.commandId === createSystemCommandId(input.sessionId, input.scheduleId, input.occurrence);
  } catch {
    return false;
  }
}

function systemSchedulerPrincipalId(sessionId: string): string {
  return `system-scheduler:${sessionId}`;
}

/**
 * Build the scheduler identity from protected repository data.
 *
 * No credential or command prefix is consulted: reaching
 * `withSystemCommandTransaction` is the internal trust boundary, while the
 * stable principal exists so receipts and events retain referential integrity.
 */
function systemSchedulerPrincipal(sessionId: string, createdAt: Date): SessionPrincipal {
  return {
    principalId: systemSchedulerPrincipalId(sessionId),
    sessionId,
    kind: "system",
    role: "assistant",
    actorScope: { kind: "all-session-actors" },
    createdAt
  };
}

function assertScheduleMutationInputs<TState>(
  current: SessionRecord<TState>,
  mutations: ReadonlyArray<SessionSystemScheduleMutation>
): void {
  for (const mutation of mutations) {
    if (mutation.kind === "register") {
      assertValidSchedule(mutation.schedule);
      if (
        mutation.schedule.sessionId !== current.sessionId ||
        mutation.schedule.bundleHash !== current.bundleHash ||
        mutation.schedule.status !== "pending" ||
        mutation.schedule.nextOccurrence !== 1
      ) {
        throw new SessionStoreUnavailableError();
      }
    }
  }
}

function assertValidSchedule(schedule: SessionSystemSchedule): void {
  const validDate = (value: unknown): value is Date =>
    value instanceof Date && !Number.isNaN(value.getTime());
  const scalarParams = isRecord(schedule.params) &&
    Object.keys(schedule.params).length <= 16 &&
    Object.values(schedule.params).every((value) =>
      typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)
    );
  if (
    !/^[A-Za-z0-9_-]{22,128}$/u.test(schedule.scheduleId) ||
    typeof schedule.sessionId !== "string" || schedule.sessionId.length === 0 ||
    typeof schedule.bundleHash !== "string" || schedule.bundleHash.length === 0 ||
    typeof schedule.actionId !== "string" || schedule.actionId.length === 0 ||
    !scalarParams ||
    !/^sha256:[a-f0-9]{64}$/u.test(schedule.definitionHash) ||
    !isRecord(schedule.trigger) ||
    !["defer", "skip"].includes(schedule.falsePolicy) ||
    !Number.isSafeInteger(schedule.maxOccurrences) ||
    schedule.maxOccurrences < 1 || schedule.maxOccurrences > 64 ||
    !Number.isSafeInteger(schedule.nextOccurrence) ||
    schedule.nextOccurrence < 1 || schedule.nextOccurrence > schedule.maxOccurrences + 1 ||
    !["pending", "cancelled", "completed"].includes(schedule.status) ||
    !validDate(schedule.createdAt) || !validDate(schedule.updatedAt)
  ) {
    throw new SessionStoreUnavailableError();
  }
}

async function applyScheduleMutations<TState>(
  client: SessionDatabaseClient,
  current: SessionRecord<TState>,
  mutations: ReadonlyArray<SessionSystemScheduleMutation>
): Promise<void> {
  for (const mutation of mutations) {
    if (mutation.kind === "register") {
      const schedule = mutation.schedule;
      const principalWrite = await queryClient(
        client,
        current.sessionId,
        `INSERT INTO session_principals (
           principal_id, session_id, principal_kind, session_role,
           actor_scope, credential_sha256, created_at
         ) VALUES ($1, $2, 'system', 'assistant', $3::jsonb, NULL, $4)
         ON CONFLICT (session_id, principal_id) DO UPDATE
           SET principal_id = EXCLUDED.principal_id
           WHERE session_principals.principal_kind = 'system'
             AND session_principals.credential_sha256 IS NULL
         RETURNING principal_id`,
        [
          systemSchedulerPrincipalId(current.sessionId),
          current.sessionId,
          JSON.stringify({ kind: "all-session-actors" }),
          schedule.createdAt
        ]
      );
      if (principalWrite.rowCount !== 1) {
        throw new SessionStoreUnavailableError();
      }

      const scheduleWrite = await queryClient(
        client,
        current.sessionId,
        `INSERT INTO system_schedules (
           schedule_id, session_id, bundle_hash, action_id, params,
           definition_hash, trigger, false_policy, max_occurrences,
           next_occurrence, status, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12, $13
         )`,
        [
          schedule.scheduleId,
          schedule.sessionId,
          schedule.bundleHash,
          schedule.actionId,
          JSON.stringify(schedule.params),
          schedule.definitionHash,
          JSON.stringify(schedule.trigger),
          schedule.falsePolicy,
          schedule.maxOccurrences,
          schedule.nextOccurrence,
          schedule.status,
          schedule.createdAt,
          schedule.updatedAt
        ]
      );
      if (scheduleWrite.rowCount !== 1) {
        throw new SessionStoreUnavailableError();
      }
      continue;
    }

    const cancelled = await queryClient(
      client,
      current.sessionId,
      `UPDATE system_schedules
       SET status = 'cancelled', updated_at = $3
       WHERE session_id = $1 AND schedule_id = $2 AND status = 'pending'
       RETURNING schedule_id`,
      [current.sessionId, mutation.scheduleId, new Date()]
    );
    if (cancelled.rowCount !== 1) {
      throw new SessionStoreUnavailableError();
    }
  }
}

function mapSystemScheduleRow(row: SystemScheduleRow): SessionSystemSchedule {
  const schedule: SessionSystemSchedule = {
    scheduleId: row.schedule_id,
    sessionId: row.session_id,
    bundleHash: row.bundle_hash,
    actionId: row.action_id,
    params: parseScheduleParams(row.params),
    definitionHash: row.definition_hash,
    trigger: requireRecord(row.trigger),
    falsePolicy: row.false_policy,
    maxOccurrences: parseSafeInteger(row.max_occurrences),
    nextOccurrence: parseSafeInteger(row.next_occurrence),
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
  assertValidSchedule(schedule);
  return schedule;
}

function parseScheduleParams(value: unknown): Record<string, string | number | boolean> {
  const record = requireRecord(value);
  if (
    Object.keys(record).length > 16 ||
    Object.values(record).some((entry) =>
      typeof entry !== "string" && typeof entry !== "boolean" &&
      (typeof entry !== "number" || !Number.isFinite(entry))
    )
  ) {
    throw new SessionStoreUnavailableError();
  }
  return record as Record<string, string | number | boolean>;
}

function assertSystemDisposition(
  existingReceipt: SessionCommandReceipt | undefined,
  result: {
    scheduleDisposition: "apply" | "skip" | "defer";
    updatedSession?: unknown;
    receipt?: SessionCommandReceipt;
    events?: ReadonlyArray<SessionEventRecord>;
    scheduleMutations?: ReadonlyArray<SessionSystemScheduleMutation>;
  }
): void {
  if (existingReceipt !== undefined) {
    if (result.updatedSession || result.receipt || result.events?.length || result.scheduleMutations?.length) {
      throw new SessionStoreUnavailableError();
    }
    return;
  }
  if (result.scheduleMutations?.length) {
    throw new SessionStoreUnavailableError();
  }
  if (result.scheduleDisposition === "defer") {
    if (result.updatedSession || result.receipt || result.events?.length) {
      throw new SessionStoreUnavailableError();
    }
  } else if (result.scheduleDisposition === "apply") {
    if (result.receipt?.status !== "applied" || result.updatedSession === undefined) {
      throw new SessionStoreUnavailableError();
    }
  } else if (result.scheduleDisposition === "skip") {
    if (
      result.receipt?.status !== "rejected" ||
      result.updatedSession !== undefined ||
      result.events?.length
    ) {
      throw new SessionStoreUnavailableError();
    }
  } else {
    throw new SessionStoreUnavailableError();
  }
}

function assertSystemReceiptPins(
  input: SessionSystemCommandTransactionInput,
  schedule: SessionSystemSchedule,
  receipt: SessionCommandReceipt
): void {
  const expectedFingerprint = createSystemCommandFingerprint({
    sessionId: input.sessionId,
    scheduleId: input.scheduleId,
    occurrence: input.occurrence,
    actionId: schedule.actionId,
    params: schedule.params,
    bundleHash: schedule.bundleHash,
    definitionHash: schedule.definitionHash
  });
  if (
    receipt.principalId !== systemSchedulerPrincipalId(input.sessionId) ||
    receipt.actionId !== schedule.actionId ||
    receipt.bundleHash !== schedule.bundleHash ||
    receipt.definitionHash !== schedule.definitionHash ||
    receipt.fingerprint !== expectedFingerprint
  ) {
    throw new SessionStoreUnavailableError();
  }
}

async function consumeScheduleOccurrence(
  client: SessionDatabaseClient,
  schedule: SessionSystemSchedule
): Promise<void> {
  const nextOccurrence = schedule.nextOccurrence + 1;
  const status: SessionSystemSchedule["status"] =
    nextOccurrence > schedule.maxOccurrences ? "completed" : "pending";
  const consumed = await queryClient(
    client,
    schedule.sessionId,
    `UPDATE system_schedules
     SET next_occurrence = $3, status = $4, updated_at = $5
     WHERE session_id = $1 AND schedule_id = $2
       AND next_occurrence = $6 AND status = 'pending'
       AND bundle_hash = $7 AND action_id = $8 AND definition_hash = $9
     RETURNING schedule_id`,
    [
      schedule.sessionId,
      schedule.scheduleId,
      nextOccurrence,
      status,
      new Date(),
      schedule.nextOccurrence,
      schedule.bundleHash,
      schedule.actionId,
      schedule.definitionHash
    ]
  );
  if (consumed.rowCount !== 1) {
    throw new SessionStoreUnavailableError();
  }
}

/** Convert a real node-postgres Pool to the narrow injectable store surface. */
export function asSessionDatabasePool(pool: Pool): SessionDatabasePool {
  return {
    query: (text, values) => pool.query(text, values),
    connect: async () => asSessionDatabaseClient(await pool.connect()),
    end: () => pool.end()
  };
}

function asSessionDatabaseClient(client: PoolClient): SessionDatabaseClient {
  return {
    query: (text, values) => client.query(text, values),
    release: (error) => client.release(error)
  };
}

function requireSingleRow<TRow extends QueryResultRow>(result: QueryResult<TRow>): TRow {
  const row = result.rows[0];
  if (row === undefined) {
    throw new SessionStoreUnavailableError();
  }
  return row;
}

function mapSessionRow<TState>(row: SessionRow): SessionRecord<TState> {
  return {
    sessionId: row.session_id,
    gameId: row.game_id,
    bundleHash: row.bundle_hash,
    ...(row.content_source_id === null ? {} : { contentSourceId: row.content_source_id }),
    state: row.state as TState,
    ...(row.session_role === null ? {} : { sessionRole: row.session_role }),
    version: {
      sessionId: row.session_id,
      stateVersion: parseSafeInteger(row.state_version),
      lastEventSequence: parseSafeInteger(row.last_event_sequence)
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapPrincipalRow(row: PrincipalRow): SessionPrincipal {
  return {
    principalId: row.principal_id,
    sessionId: row.session_id,
    kind: row.principal_kind,
    role: row.session_role,
    actorScope: parseActorScope(row.actor_scope),
    createdAt: new Date(row.created_at)
  };
}

function mapBundleRow(row: BundleRow): ImmutableGameBundle {
  return {
    bundleHash: row.bundle_hash,
    gameId: row.game_id,
    canonicalBytes: new Uint8Array(row.canonical_bytes),
    canonicalBundle: row.canonical_bundle,
    createdAt: new Date(row.created_at)
  };
}

function mapReceiptRow(row: ReceiptRow): SessionCommandReceipt {
  const publicReceipt = requireRecord(row.public_receipt);
  const audit = requireRecord(row.audit);
  const eventRefs = requireStringArray(row.event_refs);
  return {
    receiptId: row.receipt_id,
    sessionId: row.session_id,
    principalId: row.principal_id,
    commandId: row.command_id,
    fingerprint: row.fingerprint,
    actionId: row.action_id,
    ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
    bundleHash: row.bundle_hash,
    definitionHash: row.definition_hash,
    ...(row.plan_hash === null ? {} : { planHash: row.plan_hash }),
    stateVersionBefore: parseSafeInteger(row.state_version_before),
    stateVersionAfter: parseSafeInteger(row.state_version_after),
    status: row.status,
    eventRefs,
    publicReceipt: publicReceipt as unknown as SessionCommandReceipt["publicReceipt"],
    ...(row.command_result === null ? {} : { result: row.command_result }),
    audit: {
      acceptedAt: new Date(String(audit.acceptedAt)),
      ...(typeof audit.requestId === "string" ? { requestId: audit.requestId } : {}),
      ...(audit.commandKind === "game-intent" || audit.commandKind === "agent-turn"
        ? { commandKind: audit.commandKind }
        : {}),
      ...(typeof audit.triggerActionId === "string" ? { triggerActionId: audit.triggerActionId } : {}),
      ...(typeof audit.selectedActionId === "string" ? { selectedActionId: audit.selectedActionId } : {}),
      ...(audit.mechanics === undefined
        ? {}
        : { mechanics: mapProtectedMechanicsAudit(audit.mechanics) })
    },
    createdAt: new Date(row.created_at)
  };
}

function mapProtectedMechanicsAudit(value: unknown): SessionCommandReceipt["audit"]["mechanics"] {
  try {
    return requireProtectedMechanicsAudit(value);
  } catch {
    throw new SessionStoreUnavailableError();
  }
}

function mapEventRow(row: EventRow): SessionEventRecord {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    sequence: parseSafeInteger(row.sequence),
    receiptId: row.receipt_id,
    commandId: row.command_id,
    actionId: row.action_id,
    principalId: row.principal_id,
    ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
    audience: row.audience,
    eventType: row.event_type,
    summary: row.summary,
    data: requireRecord(row.event_data),
    createdAt: new Date(row.created_at)
  };
}

function parseActorScope(value: unknown): SessionPrincipal["actorScope"] {
  const record = requireRecord(value);
  if (record.kind === "all-session-actors") {
    return { kind: "all-session-actors" };
  }
  if (record.kind === "listed-actors") {
    return { kind: "listed-actors", actorIds: requireStringArray(record.actorIds) };
  }
  throw new SessionStoreUnavailableError();
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SessionStoreUnavailableError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new SessionStoreUnavailableError();
  }
  return [...value];
}

function parseSafeInteger(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SessionStoreUnavailableError();
  }
  return parsed;
}

function assertCreateInput<TState>(input: CreateSessionInput<TState>): void {
  if (
    input.immutableBundle.gameId !== input.gameId ||
    !isValidImmutableBundleInput(input.immutableBundle) ||
    !/^[a-f0-9]{64}$/u.test(input.principal.credentialSha256)
  ) {
    throw new SessionStoreUnavailableError();
  }
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function queryClient<TRow extends QueryResultRow = QueryResultRow>(
  client: SessionDatabaseClient,
  sessionId: string,
  text: string,
  values?: unknown[]
): Promise<QueryResult<TRow>> {
  try {
    return await client.query<TRow>(text, values);
  } catch (error) {
    if (isPostgresErrorCode(error, "55P03")) {
      throw new SessionWriteLockedError(sessionId);
    }
    throw new SessionStoreUnavailableError();
  }
}

async function rollbackAfterFailure(
  client: SessionDatabaseClient,
  originalError: unknown
): Promise<Error | boolean | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (rollbackError) {
    return rollbackError instanceof Error ? rollbackError : originalError instanceof Error ? originalError : true;
  }
}

function mapDatabaseOperationalError(error: unknown): Error {
  if (
    error instanceof SessionAuthenticationError ||
    error instanceof SessionStoreUnavailableError ||
    error instanceof SessionVersionConflictError ||
    error instanceof SessionWriteLockedError
  ) {
    return error;
  }
  return new SessionStoreUnavailableError();
}
