/** Unit coverage for durable session transactions without requiring PostgreSQL. */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import {
  PostgresSessionStore,
  type SessionDatabaseClient,
  type SessionDatabasePool
} from "../src/modules/session/postgresSessionStore.ts";
import {
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "../src/modules/session/sessionStoreErrors.ts";
import {
  createSessionStoreFromEnvironment,
  installSafePoolErrorHandler
} from "../src/modules/session/sessionStoreFactory.ts";

const now = new Date("2026-07-11T12:00:00.000Z");
const persistedRow = {
  session_id: "11111111-1111-4111-8111-111111111111",
  game_id: "fixture-game",
  player_id: "player-1",
  content_source_id: "editor-source",
  session_role: "facilitator",
  state: { public: { step: 1 } },
  state_version: "4",
  last_event_sequence: "7",
  created_at: now,
  updated_at: now
};

class ScriptedClient implements SessionDatabaseClient {
  readonly queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  releaseError: Error | boolean | undefined;
  private readonly responder: (
    text: string,
    values?: unknown[]
  ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>;

  constructor(
    responder: (
      text: string,
      values?: unknown[]
    ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>
  ) {
    this.responder = responder;
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TRow>> {
    this.queries.push({ text, values });
    return await this.responder(text, values) as QueryResult<TRow>;
  }

  release(error?: Error | boolean): void {
    this.released = true;
    this.releaseError = error;
  }
}

class ScriptedPool implements SessionDatabasePool {
  readonly directQueries: Array<{ text: string; values?: unknown[] }> = [];
  ended = false;
  readonly client: ScriptedClient;
  private readonly directResponder: (
    text: string,
    values?: unknown[]
  ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>;

  constructor(
    client: ScriptedClient,
    directResponder: (
      text: string,
      values?: unknown[]
    ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>> = () => result([])
  ) {
    this.client = client;
    this.directResponder = directResponder;
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TRow>> {
    this.directQueries.push({ text, values });
    return await this.directResponder(text, values) as QueryResult<TRow>;
  }

  async connect(): Promise<SessionDatabaseClient> {
    return this.client;
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test("PostgreSQL transaction locks, maps metadata and atomically writes a full snapshot", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      return result([persistedRow]);
    }
    if (text.includes("UPDATE game_sessions")) {
      return result([{ ...persistedRow, state_version: "5", last_event_sequence: "8" }], 1);
    }
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  const outcome = await store.withLockedSession(persistedRow.session_id, async (current) => {
    assert.ok(current);
    assert.equal(current.contentSourceId, "editor-source");
    assert.equal(current.sessionRole, "facilitator");
    assert.equal(current.version.stateVersion, 4);
    const updatedSession = {
      ...current,
      state: { public: { step: 2 } },
      version: { sessionId: current.sessionId, stateVersion: 5, lastEventSequence: 8 },
      updatedAt: new Date("2026-07-11T12:01:00.000Z")
    };
    return { result: "committed", updatedSession };
  });

  assert.equal(outcome, "committed");
  assert.deepEqual(
    client.queries.map(({ text }) => firstSqlWord(text)),
    ["BEGIN", "SELECT", "UPDATE", "COMMIT"]
  );
  const update = client.queries[2];
  assert.equal(update.values?.[0], persistedRow.session_id);
  assert.equal(update.values?.[3], "editor-source");
  assert.equal(update.values?.[4], "facilitator");
  assert.equal(update.values?.[9], 4);
  assert.equal(client.released, true);
});

test("PostgreSQL lock contention becomes a typed 423 error and rolls back", async () => {
  const lockError = Object.assign(new Error("could not obtain lock"), { code: "55P03" });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      throw lockError;
    }
    return result([]);
  });
  const store = new PostgresSessionStore(new ScriptedPool(client));

  await assert.rejects(
    store.withLockedSession(persistedRow.session_id, async () => ({ result: undefined })),
    SessionWriteLockedError
  );
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), ["BEGIN", "SELECT", "ROLLBACK"]);
  assert.equal(client.released, true);
});

test("expected state version protects the direct update path from lost updates", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      return result([persistedRow]);
    }
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));
  const staleSnapshot = {
    sessionId: persistedRow.session_id,
    gameId: persistedRow.game_id,
    state: {},
    version: { sessionId: persistedRow.session_id, stateVersion: 5, lastEventSequence: 8 },
    createdAt: now,
    updatedAt: now
  };

  await assert.rejects(
    store.updateSession(staleSnapshot, { expectedStateVersion: 3 }),
    SessionVersionConflictError
  );
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), ["BEGIN", "SELECT", "ROLLBACK"]);
});

test("invalid snapshot versions and session ids are rejected before UPDATE", async () => {
  const cases = [
    { label: "same version", stateVersion: 4, versionSessionId: persistedRow.session_id },
    { label: "lower version", stateVersion: 3, versionSessionId: persistedRow.session_id },
    { label: "jumped version", stateVersion: 6, versionSessionId: persistedRow.session_id },
    { label: "mismatched version session", stateVersion: 5, versionSessionId: "other-session" }
  ];

  for (const invalid of cases) {
    const client = new ScriptedClient((text) => {
      if (text.includes("FOR UPDATE NOWAIT")) {
        return result([persistedRow]);
      }
      return result([]);
    });
    const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));
    await assert.rejects(
      store.withLockedSession(persistedRow.session_id, async (current) => {
        assert.ok(current);
        return {
          result: undefined,
          updatedSession: {
            ...current,
            version: {
              sessionId: invalid.versionSessionId,
              stateVersion: invalid.stateVersion,
              lastEventSequence: 8
            }
          }
        };
      }),
      SessionVersionConflictError,
      invalid.label
    );
    assert.deepEqual(
      client.queries.map(({ text }) => firstSqlWord(text)),
      ["BEGIN", "SELECT", "ROLLBACK"],
      invalid.label
    );
  }
});

test("rollback failure discards the broken client while preserving the original error", async () => {
  const rollbackError = new Error("secret database rollback detail");
  const operationError = new Error("gameplay operation failed");
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      return result([persistedRow]);
    }
    if (text === "ROLLBACK") {
      throw rollbackError;
    }
    return result([]);
  });
  const store = new PostgresSessionStore(new ScriptedPool(client));

  await assert.rejects(
    store.withLockedSession(persistedRow.session_id, async () => {
      throw operationError;
    }),
    (error) => error === operationError
  );
  assert.equal(client.releaseError, rollbackError);
});

test("readiness validates schema, write mode and required privileges before close", async () => {
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    () => result([{ writable: true, can_select: true, can_insert: true, can_update: true }])
  );
  const store = new PostgresSessionStore(pool);
  await store.checkReadiness();
  await store.close();
  const readinessSql = pool.directQueries[0]?.text ?? "";
  assert.match(readinessSql, /FROM game_sessions/u);
  assert.match(readinessSql, /LIMIT 0/u);
  assert.match(readinessSql, /history/u);
  assert.match(readinessSql, /transaction_read_only/u);
  assert.match(readinessSql, /has_table_privilege/u);
  assert.equal(pool.ended, true);
});

test("read-only or underprivileged PostgreSQL is not ready", async () => {
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    () => result([{ writable: false, can_select: true, can_insert: true, can_update: true }])
  );
  const store = new PostgresSessionStore(pool);
  await assert.rejects(store.checkReadiness(), SessionStoreUnavailableError);
});

test("database operational details are replaced by a neutral typed HTTP 503", async () => {
  const databaseError = Object.assign(new Error("password for db.internal.example was rejected"), {
    code: "ECONNREFUSED"
  });
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    () => { throw databaseError; }
  );
  const store = new PostgresSessionStore(pool);

  await assert.rejects(store.getSession(persistedRow.session_id), (error) => {
    assert.ok(error instanceof SessionStoreUnavailableError);
    assert.equal(error.statusCode, 503);
    assert.equal(error.message, "Session storage is temporarily unavailable.");
    assert.doesNotMatch(error.message, /password|internal\.example/u);
    return true;
  });
});

test("idle pool error handler logs only a safe fixed message", () => {
  let listener: ((error: Error) => void) | undefined;
  const messages: string[] = [];
  installSafePoolErrorHandler(
    {
      on(event, installedListener) {
        assert.equal(event, "error");
        listener = installedListener;
      }
    },
    (message) => messages.push(message)
  );
  listener?.(new Error("postgresql://user:secret@db.internal/cubica"));
  assert.deepEqual(messages, ["runtime-api PostgreSQL session pool lost an idle connection."]);
  assert.doesNotMatch(messages.join(" "), /secret|db\.internal/u);
});

test("production refuses volatile storage and missing PostgreSQL configuration", () => {
  assert.throws(
    () => createSessionStoreFromEnvironment({ NODE_ENV: "production", SESSION_STORE: "in-memory" }),
    /forbidden in production/u
  );
  assert.throws(
    () => createSessionStoreFromEnvironment({ NODE_ENV: "production", SESSION_STORE: "postgresql" }),
    /DATABASE_URL is required/u
  );
  assert.throws(() => createSessionStoreFromEnvironment({ NODE_ENV: "development" }), /SESSION_STORE must/u);
});

test("in-memory adapter rejects a concurrent mutation like FOR UPDATE NOWAIT", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession({ gameId: "fixture-game", initialState: {} });
  let unblock!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });

  const first = store.withLockedSession(created.sessionId, async (current) => {
    markEntered();
    await blocked;
    return { result: current };
  });
  await entered;
  await assert.rejects(
    store.withLockedSession(created.sessionId, async () => ({ result: undefined })),
    SessionWriteLockedError
  );
  unblock();
  await first;
});

function result<TRow extends QueryResultRow>(rows: TRow[], rowCount = rows.length): QueryResult<TRow> {
  return {
    command: "TEST",
    rowCount,
    oid: 0,
    fields: [],
    rows
  };
}

function firstSqlWord(sql: string): string {
  return sql.trim().split(/\s+/u)[0] ?? "";
}
