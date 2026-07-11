/**
 * PostgreSQL-backed runtime session store.
 *
 * A complete state transition runs on one checked-out client and one database
 * transaction. `SELECT ... FOR UPDATE NOWAIT` holds an exclusive row lock from
 * the initial read until the replacement JSONB snapshot commits, preventing two
 * long-running turns from computing from the same state.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateSessionInput,
  LockedSessionOperation,
  SessionRecord,
  SessionRole,
  SessionStorePort,
  UpdateSessionOptions
} from "@cubica/contracts-session";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  assertNextSessionVersion,
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";

interface SessionRow extends QueryResultRow {
  session_id: string;
  game_id: string;
  player_id: string | null;
  content_source_id: string | null;
  session_role: SessionRole | null;
  state: unknown;
  state_version: string | number;
  last_event_sequence: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SessionReadinessRow extends QueryResultRow {
  writable: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
}

/** Minimal node-postgres client surface used by the adapter and its unit tests. */
export interface SessionDatabaseClient {
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TRow>>;
  release(error?: Error | boolean): void;
}

/** Minimal node-postgres pool surface used by the adapter and its unit tests. */
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
  player_id,
  content_source_id,
  session_role,
  state,
  state_version,
  last_event_sequence,
  created_at,
  updated_at
`;

const SELECT_SESSION = `SELECT ${SESSION_COLUMNS} FROM game_sessions WHERE id = $1`;
const SELECT_SESSION_FOR_UPDATE = `${SELECT_SESSION} FOR UPDATE NOWAIT`;

export class PostgresSessionStore<TState = unknown> implements SessionStorePort<TState> {
  readonly mode = "postgresql";
  private readonly pool: SessionDatabasePool;

  constructor(pool: SessionDatabasePool) {
    this.pool = pool;
  }

  async createSession(input: CreateSessionInput<TState>): Promise<SessionRecord<TState>> {
    const sessionId = randomUUID();
    try {
      const result = await this.pool.query<SessionRow>(
        `INSERT INTO game_sessions (
        id, game_id, player_id, content_source_id, session_role, state,
        state_version, last_event_sequence
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 0)
      RETURNING ${SESSION_COLUMNS}`,
        [
          sessionId,
          input.gameId,
          input.playerId ?? null,
          input.contentSourceId ?? null,
          input.sessionRole ?? null,
          JSON.stringify(input.initialState)
        ]
      );
      return mapSessionRow<TState>(requireSingleRow(result));
    } catch (error) {
      throw mapDatabaseOperationalError(error);
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
    // node-postgres requires all statements in a transaction to use the same
    // checked-out client; pool.query() here would allow a different connection
    // and silently release the row-level lock boundary.
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
      const operationResult = await operation(current);

      if (operationResult.updatedSession !== undefined) {
        if (current === null) {
          throw new SessionVersionConflictError(sessionId, 0);
        }

        const updated = operationResult.updatedSession;
        assertNextSessionVersion(sessionId, current, updated);
        const write = await queryClient<SessionRow>(
          client,
          sessionId,
          `UPDATE game_sessions SET
            game_id = $2,
            player_id = $3,
            content_source_id = $4,
            session_role = $5,
            state = $6::jsonb,
            state_version = $7,
            last_event_sequence = $8,
            updated_at = $9
          WHERE id = $1 AND state_version = $10
          RETURNING ${SESSION_COLUMNS}`,
          [
            sessionId,
            updated.gameId,
            updated.playerId ?? null,
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
          throw new SessionVersionConflictError(sessionId, current.version.stateVersion);
        }
      }

      await queryClient(client, sessionId, "COMMIT");
      return operationResult.result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          // Preserve the original operation error. The broken connection is
          // removed from the pool via release(error), while readiness exposes
          // a wider database outage without leaking driver details.
          releaseError = asReleaseError(rollbackError);
        }
      } else if (error instanceof SessionStoreUnavailableError) {
        releaseError = error;
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async checkReadiness(): Promise<void> {
    try {
      // The CTE validates the exact columns without reading session contents.
      // Privilege and read-only checks ensure readiness means the process can
      // perform its real SELECT/INSERT/UPDATE workload, not only open a socket.
      const result = await this.pool.query<SessionReadinessRow>(`
        WITH schema_probe AS (
          SELECT id, game_id, player_id, content_source_id, session_role, state,
                 history, state_version, last_event_sequence, created_at, updated_at
          FROM game_sessions
          LIMIT 0
        )
        SELECT
          current_setting('transaction_read_only') = 'off' AS writable,
          has_table_privilege(current_user, 'game_sessions', 'SELECT') AS can_select,
          has_table_privilege(current_user, 'game_sessions', 'INSERT') AS can_insert,
          has_table_privilege(current_user, 'game_sessions', 'UPDATE') AS can_update
      `);
      const readiness = result.rows[0];
      if (
        readiness === undefined ||
        readiness.writable !== true ||
        readiness.can_select !== true ||
        readiness.can_insert !== true ||
        readiness.can_update !== true
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
  const stateVersion = parseSafeInteger(row.state_version, "state_version");
  const lastEventSequence = parseSafeInteger(row.last_event_sequence, "last_event_sequence");
  return {
    sessionId: row.session_id,
    gameId: row.game_id,
    ...(row.player_id === null ? {} : { playerId: row.player_id }),
    ...(row.content_source_id === null ? {} : { contentSourceId: row.content_source_id }),
    state: row.state as TState,
    ...(row.session_role === null ? {} : { sessionRole: row.session_role }),
    version: {
      sessionId: row.session_id,
      stateVersion,
      lastEventSequence
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function parseSafeInteger(value: string | number, column: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SessionStoreUnavailableError();
  }
  return parsed;
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

function mapDatabaseOperationalError(error: unknown): Error {
  if (
    error instanceof SessionStoreUnavailableError ||
    error instanceof SessionVersionConflictError ||
    error instanceof SessionWriteLockedError
  ) {
    return error;
  }
  return new SessionStoreUnavailableError();
}

function asReleaseError(error: unknown): Error | boolean {
  return error instanceof Error ? error : true;
}
