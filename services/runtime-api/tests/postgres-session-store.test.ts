/** Focused unit coverage for durable authentication and command transactions. */

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CreateSessionInput,
  SessionCommandReceipt,
  SessionEventRecord,
  SessionRecord,
  SessionSystemSchedule
} from "@cubica/contracts-session";
import type { QueryResult, QueryResultRow } from "pg";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import {
  createSystemCommandFingerprint,
  createSystemCommandId
} from "../src/modules/session/commandIdentity.ts";
import {
  PostgresSessionStore,
  type SessionDatabaseClient,
  type SessionDatabasePool
} from "../src/modules/session/postgresSessionStore.ts";
import {
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionWriteLockedError
} from "../src/modules/session/sessionStoreErrors.ts";
import {
  createSessionStoreFromEnvironment,
  installSafePoolErrorHandler
} from "../src/modules/session/sessionStoreFactory.ts";

const now = new Date("2026-07-11T12:00:00.000Z");
const sessionId = "11111111-1111-4111-8111-111111111111";
const principalId = "22222222-2222-4222-8222-222222222222";
const immutableBundle = createImmutableBundleContent("fixture-game", {});
const canonicalBundle = immutableBundle.canonicalBundle;
const bundleHash = immutableBundle.bundleHash;
const credentialSha256 = "b".repeat(64);
const commandId = "cli_AAAAAAAAAAAAAAAAAAAAAA";
const receiptId = "33333333-3333-4333-8333-333333333333";
const definitionHash = `sha256:${"d".repeat(64)}`;
const planHash = `sha256:${"e".repeat(64)}`;
const scheduleId = "S".repeat(22);
const scheduledActionId = "scheduled.advance";
const scheduledDefinitionHash = `sha256:${"f".repeat(64)}`;
const systemPrincipalId = `system-scheduler:${sessionId}`;
const systemCommandId = createSystemCommandId(sessionId, scheduleId, 1);
const persistedRow = {
  session_id: sessionId,
  game_id: "fixture-game",
  bundle_hash: bundleHash,
  content_source_id: "editor-source",
  session_role: "facilitator",
  state: { public: { step: 1 } },
  state_version: "4",
  last_event_sequence: "7",
  created_at: now,
  updated_at: now
};
const principalRow = {
  principal_id: principalId,
  session_id: sessionId,
  principal_kind: "local-controller",
  session_role: "facilitator",
  actor_scope: { kind: "all-session-actors" },
  created_at: now
};
const bundleRow = {
  bundle_hash: bundleHash,
  game_id: "fixture-game",
  canonical_bytes: immutableBundle.canonicalBytes,
  canonical_bundle: canonicalBundle,
  created_at: now
};

class ScriptedClient implements SessionDatabaseClient {
  readonly queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  releaseError: Error | boolean | undefined;
  private readonly responder: (
    text: string,
    values?: unknown[]
  ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>;

  constructor(responder: (
    text: string,
    values?: unknown[]
  ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>) {
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
  readonly client: ScriptedClient;
  private readonly directResponder: (
    text: string,
    values?: unknown[]
  ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>;
  ended = false;

  constructor(
    client: ScriptedClient,
    directResponder: (
      text: string,
      values?: unknown[]
    ) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>> = () => result([])
  ) {
    // Node's strip-types runner cannot parse TypeScript parameter properties,
    // so the test double assigns ordinary fields just like production JavaScript.
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

test("PostgreSQL creates immutable bundle, session and hashed principal atomically", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("INSERT INTO game_bundles")) return result([bundleRow], 1);
    if (text.includes("INSERT INTO game_sessions")) return result([persistedRow], 1);
    if (text.includes("INSERT INTO session_principals")) return result([principalRow], 1);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));
  const created = await store.createSession(createInput());

  assert.equal(created.session.bundleHash, bundleHash);
  assert.equal(created.principal.principalId, principalId);
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), [
    "BEGIN", "INSERT", "INSERT", "INSERT", "COMMIT"
  ]);
  const principalInsert = client.queries.find(({ text }) => text.includes("INSERT INTO session_principals"));
  assert.equal(principalInsert?.values?.[5], credentialSha256);
  assert.equal(JSON.stringify(client.queries).includes("ses_"), false);
});

test("PostgreSQL commits state, first receipt and ordered events in the same locked transaction", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM session_principals")) return result([principalRow]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("UPDATE game_sessions")) {
      return result([{ ...persistedRow, state_version: "5" }], 1);
    }
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));
  const committedEvent = event({ session: sessionId, sequence: 8 });
  const committedReceipt = receipt({
    before: 4,
    after: 5,
    eventRefs: [committedEvent.eventId]
  });
  const output = await store.withCommandTransaction({ sessionId, credentialSha256, commandId }, async (context) => {
    assert.equal(context.existingReceipt, undefined);
    assert.equal(context.principal.principalId, principalId);
    assert.equal(context.bundle.bundleHash, bundleHash);
    const updatedSession: SessionRecord<Record<string, unknown>> = {
      ...context.currentSession,
      state: { public: { step: 2 } },
      version: { sessionId, stateVersion: 5, lastEventSequence: 8 },
      updatedAt: new Date("2026-07-11T12:01:00.000Z")
    };
    return {
      result: "committed",
      updatedSession,
      receipt: committedReceipt,
      events: [committedEvent]
    };
  });

  assert.equal(output, "committed");
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), [
    "BEGIN", "SELECT", "SELECT", "SELECT", "SELECT", "UPDATE", "INSERT", "INSERT", "COMMIT"
  ]);
  assert.ok(client.queries.some(({ text }) => text.includes("INSERT INTO command_receipts")));
  const eventInsert = client.queries.find(({ text }) => text.includes("INSERT INTO session_events"));
  assert.equal(eventInsert?.values?.[0], `${sessionId}:8`);
  assert.equal(eventInsert?.values?.[2], 8);
  assert.equal(eventInsert?.values?.[3], receiptId);
  assert.equal(eventInsert?.values?.[10], JSON.stringify(committedEvent.summary));
  assert.equal(eventInsert?.values?.[11], JSON.stringify(committedEvent.data));
});

test("PostgreSQL registers a protected schedule and credential-free system principal in the command transaction", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM session_principals")) return result([principalRow]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("UPDATE game_sessions")) {
      return result([{ ...persistedRow, state_version: "5" }], 1);
    }
    if (text.includes("INSERT INTO session_principals")) {
      return result([{ principal_id: systemPrincipalId }], 1);
    }
    if (text.includes("INSERT INTO system_schedules")) return result([], 1);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));
  const schedule = systemSchedule();

  await store.withCommandTransaction({ sessionId, credentialSha256, commandId }, async ({ currentSession }) => ({
    result: undefined,
    updatedSession: {
      ...currentSession,
      state: { public: { step: 2 } },
      version: { sessionId, stateVersion: 5, lastEventSequence: 7 },
      updatedAt: new Date("2026-07-11T12:01:00.000Z")
    },
    receipt: receipt({ before: 4, after: 5 }),
    scheduleMutations: [{ kind: "register", schedule }]
  }));

  const principalInsert = client.queries.find(({ text }) => text.includes("INSERT INTO session_principals"));
  assert.equal(principalInsert?.values?.[0], systemPrincipalId);
  assert.match(principalInsert?.text ?? "", /credential_sha256[\s\S]*NULL/u);
  const scheduleInsert = client.queries.find(({ text }) => text.includes("INSERT INTO system_schedules"));
  assert.deepEqual(scheduleInsert?.values?.slice(0, 6), [
    scheduleId,
    sessionId,
    bundleHash,
    scheduledActionId,
    JSON.stringify(schedule.params),
    scheduledDefinitionHash
  ]);
  assert.equal(firstSqlWord(client.queries.at(-1)?.text ?? ""), "COMMIT");
});

test("PostgreSQL system defer locks the schedule after receipt lookup and performs no durable writes", async () => {
  const schedule = systemSchedule();
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("FROM system_schedules")) return result([systemScheduleRow(schedule)]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  const output = await store.withSystemCommandTransaction(
    { sessionId, scheduleId, occurrence: 1, commandId: systemCommandId },
    async ({ principal, schedule: loadedSchedule, existingReceipt }) => {
      assert.equal(principal.principalId, systemPrincipalId);
      assert.equal(principal.kind, "system");
      assert.equal(existingReceipt, undefined);
      assert.deepEqual(loadedSchedule, schedule);
      return { result: "deferred", scheduleDisposition: "defer" };
    }
  );

  assert.equal(output, "deferred");
  const receiptIndex = client.queries.findIndex(({ text }) => text.includes("FROM command_receipts"));
  const scheduleIndex = client.queries.findIndex(({ text }) => text.includes("FROM system_schedules"));
  assert.ok(receiptIndex >= 0 && receiptIndex < scheduleIndex);
  assert.match(client.queries[scheduleIndex]?.text ?? "", /FOR UPDATE/u);
  assert.equal(client.queries.some(({ text }) => /^(INSERT|UPDATE|DELETE)\b/u.test(text.trim())), false);
  assert.equal(firstSqlWord(client.queries.at(-1)?.text ?? ""), "COMMIT");
});

test("PostgreSQL system apply commits state, receipt, events and occurrence consumption atomically", async () => {
  const schedule = systemSchedule({ maxOccurrences: 2 });
  const appliedReceipt = systemReceipt({ status: "applied", before: 4, after: 5, eventRefs: [`${sessionId}:8`] });
  const appliedEvent = systemEvent({ sequence: 8 });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("FROM system_schedules")) return result([systemScheduleRow(schedule)]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("UPDATE game_sessions")) {
      return result([{ ...persistedRow, state_version: "5", last_event_sequence: "8" }], 1);
    }
    if (text.includes("UPDATE system_schedules")) return result([{ schedule_id: scheduleId }], 1);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  const output = await store.withSystemCommandTransaction(
    { sessionId, scheduleId, occurrence: 1, commandId: systemCommandId },
    async ({ currentSession }) => ({
      result: "applied",
      scheduleDisposition: "apply",
      updatedSession: {
        ...currentSession,
        state: { public: { step: 2 } },
        version: { sessionId, stateVersion: 5, lastEventSequence: 8 },
        updatedAt: new Date("2026-07-11T12:01:00.000Z")
      },
      receipt: appliedReceipt,
      events: [appliedEvent]
    })
  );

  assert.equal(output, "applied");
  const consume = client.queries.find(({ text }) => text.includes("UPDATE system_schedules"));
  assert.equal(consume?.values?.[2], 2);
  assert.equal(consume?.values?.[3], "pending");
  assert.equal(consume?.values?.[5], 1);
  assert.ok(client.queries.some(({ text }) => text.includes("INSERT INTO command_receipts")));
  assert.ok(client.queries.some(({ text }) => text.includes("INSERT INTO session_events")));
  assert.equal(firstSqlWord(client.queries.at(-1)?.text ?? ""), "COMMIT");
});

test("PostgreSQL rolls back the complete system command if occurrence consumption fails", async () => {
  const schedule = systemSchedule({ maxOccurrences: 2 });
  const appliedReceipt = systemReceipt({ status: "applied", before: 4, after: 5, eventRefs: [`${sessionId}:8`] });
  const appliedEvent = systemEvent({ sequence: 8 });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("FROM system_schedules")) return result([systemScheduleRow(schedule)]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("UPDATE game_sessions")) {
      return result([{ ...persistedRow, state_version: "5", last_event_sequence: "8" }], 1);
    }
    if (text.includes("UPDATE system_schedules")) {
      throw Object.assign(new Error("schedule write failed"), { code: "XX000" });
    }
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  await assert.rejects(
    store.withSystemCommandTransaction(
      { sessionId, scheduleId, occurrence: 1, commandId: systemCommandId },
      async ({ currentSession }) => ({
        result: undefined,
        scheduleDisposition: "apply",
        updatedSession: {
          ...currentSession,
          state: { public: { step: 2 } },
          version: { sessionId, stateVersion: 5, lastEventSequence: 8 },
          updatedAt: new Date("2026-07-11T12:01:00.000Z")
        },
        receipt: appliedReceipt,
        events: [appliedEvent]
      })
    ),
    SessionStoreUnavailableError
  );

  assert.equal(firstSqlWord(client.queries.at(-1)?.text ?? ""), "ROLLBACK");
  assert.equal(client.queries.some(({ text }) => firstSqlWord(text) === "COMMIT"), false);
});

test("PostgreSQL system skip stores a rejected receipt and consumes the occurrence without state writes", async () => {
  const schedule = systemSchedule({ maxOccurrences: 1 });
  const skippedReceipt = systemReceipt({ status: "rejected", before: 4, after: 4 });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM command_receipts")) return result([]);
    if (text.includes("FROM system_schedules")) return result([systemScheduleRow(schedule)]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("UPDATE system_schedules")) return result([{ schedule_id: scheduleId }], 1);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  await store.withSystemCommandTransaction(
    { sessionId, scheduleId, occurrence: 1, commandId: systemCommandId },
    async () => ({
      result: "skipped",
      scheduleDisposition: "skip",
      receipt: skippedReceipt
    })
  );

  assert.equal(client.queries.some(({ text }) => text.includes("UPDATE game_sessions")), false);
  assert.equal(client.queries.some(({ text }) => text.includes("INSERT INTO session_events")), false);
  assert.ok(client.queries.some(({ text }) => text.includes("INSERT INTO command_receipts")));
  const consume = client.queries.find(({ text }) => text.includes("UPDATE system_schedules"));
  assert.equal(consume?.values?.[2], 2);
  assert.equal(consume?.values?.[3], "completed");
});

test("PostgreSQL system retry returns its receipt even after the schedule occurrence completed", async () => {
  const schedule = systemSchedule({ maxOccurrences: 1, nextOccurrence: 2, status: "completed" });
  const storedReceipt = systemReceipt({ status: "applied", before: 4, after: 5 });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      return result([{ ...persistedRow, state_version: "5" }]);
    }
    if (text.includes("FROM command_receipts")) return result([receiptRow(storedReceipt)]);
    if (text.includes("FROM system_schedules")) return result([systemScheduleRow(schedule)]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  const replay = await store.withSystemCommandTransaction(
    { sessionId, scheduleId, occurrence: 1, commandId: systemCommandId },
    async ({ existingReceipt }) => ({
      result: existingReceipt?.publicReceipt,
      scheduleDisposition: "apply"
    })
  );

  assert.equal(replay?.commandId, systemCommandId);
  assert.equal(client.queries.some(({ text }) => /^(INSERT|UPDATE|DELETE)\b/u.test(text.trim())), false);
});

test("PostgreSQL rejects a forged system id before opening a transaction", async () => {
  const client = new ScriptedClient(() => result([]));
  const store = new PostgresSessionStore(new ScriptedPool(client));
  await assert.rejects(
    store.withSystemCommandTransaction(
      { sessionId, scheduleId, occurrence: 1, commandId: `sys_${"A".repeat(43)}` },
      async () => ({ result: undefined, scheduleDisposition: "defer" })
    ),
    SessionAuthenticationError
  );
  assert.deepEqual(client.queries, []);
});

test("PostgreSQL exact retry reads its receipt and never inserts duplicate events", async () => {
  const storedEvent = event({ session: sessionId, sequence: 8 });
  const storedReceipt = receipt({ before: 4, after: 5, eventRefs: [storedEvent.eventId] });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) {
      return result([{ ...persistedRow, state_version: "5", last_event_sequence: "8" }]);
    }
    if (text.includes("FROM session_principals")) return result([principalRow]);
    if (text.includes("FROM game_bundles")) return result([bundleRow]);
    if (text.includes("FROM command_receipts")) return result([receiptRow(storedReceipt)]);
    return result([]);
  });
  const store = new PostgresSessionStore<Record<string, unknown>>(new ScriptedPool(client));

  const replayed = await store.withCommandTransaction(
    { sessionId, credentialSha256, commandId },
    async ({ existingReceipt }) => {
      assert.deepEqual(existingReceipt?.eventRefs, [storedEvent.eventId]);
      assert.equal(existingReceipt?.definitionHash, definitionHash);
      assert.equal(existingReceipt?.planHash, planHash);
      assert.equal(existingReceipt?.audit.mechanics?.steps[0]?.operation, "core.assert");
      return { result: existingReceipt?.publicReceipt };
    }
  );

  assert.deepEqual(replayed?.eventRefs, [storedEvent.eventId]);
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), [
    "BEGIN", "SELECT", "SELECT", "SELECT", "SELECT", "COMMIT"
  ]);
  assert.equal(client.queries.some(({ text }) => text.includes("INSERT INTO session_events")), false);
  assert.equal(client.queries.some(({ text }) => text.includes("INSERT INTO command_receipts")), false);
});

test("invalid credential is rejected under the session lock before command execution", async () => {
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) return result([persistedRow]);
    if (text.includes("FROM session_principals")) return result([]);
    return result([]);
  });
  const store = new PostgresSessionStore(new ScriptedPool(client));
  let executed = false;
  await assert.rejects(
    store.withCommandTransaction({ sessionId, credentialSha256, commandId }, async () => {
      executed = true;
      return { result: undefined };
    }),
    SessionAuthenticationError
  );
  assert.equal(executed, false);
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), [
    "BEGIN", "SELECT", "SELECT", "ROLLBACK"
  ]);
});

test("PostgreSQL lock contention becomes a typed 423 error", async () => {
  const lockError = Object.assign(new Error("could not obtain lock"), { code: "55P03" });
  const client = new ScriptedClient((text) => {
    if (text.includes("FOR UPDATE NOWAIT")) throw lockError;
    return result([]);
  });
  const store = new PostgresSessionStore(new ScriptedPool(client));
  await assert.rejects(
    store.withLockedSession(sessionId, async () => ({ result: undefined })),
    SessionWriteLockedError
  );
  assert.deepEqual(client.queries.map(({ text }) => firstSqlWord(text)), ["BEGIN", "SELECT", "ROLLBACK"]);
});

test("in-memory exact retry sees the durable receipt and does not mutate twice", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  const actualSessionId = created.session.sessionId;
  const firstEvent = event({ session: actualSessionId, sequence: 1 });
  const firstReceipt = receipt({
    session: actualSessionId,
    before: 0,
    after: 1,
    eventRefs: [firstEvent.eventId]
  });
  await store.withCommandTransaction({ sessionId: actualSessionId, credentialSha256, commandId }, async ({ currentSession }) => ({
    result: undefined,
    updatedSession: {
      ...currentSession,
      state: { public: { applied: 1 } },
      version: { sessionId: actualSessionId, stateVersion: 1, lastEventSequence: 1 },
      updatedAt: new Date()
    },
    receipt: firstReceipt,
    events: [firstEvent]
  }));

  let retriedRule = false;
  const retry = await store.withCommandTransaction(
    { sessionId: actualSessionId, credentialSha256, commandId },
    async ({ currentSession, existingReceipt }) => {
      assert.equal(currentSession.version.stateVersion, 1);
      assert.equal(existingReceipt?.fingerprint, firstReceipt.fingerprint);
      if (existingReceipt === undefined) {
        retriedRule = true;
      }
      return { result: existingReceipt?.publicReceipt };
    }
  );
  assert.equal(retriedRule, false);
  assert.equal(retry?.commandId, commandId);
  assert.equal((await store.getSession(actualSessionId))?.version.stateVersion, 1);
  assert.deepEqual((await store.getSessionEvents(actualSessionId)).map(({ eventId }) => eventId), [firstEvent.eventId]);
  assert.deepEqual(await store.getSessionEvents(actualSessionId, 1), []);
});

test("in-memory system transaction rejects a forged receipt before consuming its occurrence", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  const actualSessionId = created.session.sessionId;
  const schedule: SessionSystemSchedule = {
    ...systemSchedule(),
    sessionId: actualSessionId
  };
  const firstReceipt = receipt({
    session: actualSessionId,
    before: 0,
    after: 1
  });
  await store.withCommandTransaction(
    { sessionId: actualSessionId, credentialSha256, commandId },
    async ({ currentSession }) => ({
      result: undefined,
      updatedSession: {
        ...currentSession,
        version: { sessionId: actualSessionId, stateVersion: 1, lastEventSequence: 0 },
        updatedAt: now
      },
      receipt: firstReceipt,
      scheduleMutations: [{ kind: "register", schedule }]
    })
  );

  const actualSystemCommandId = createSystemCommandId(actualSessionId, scheduleId, 1);
  const forgedReceipt = systemReceipt({ status: "rejected", before: 1, after: 1 });
  forgedReceipt.sessionId = actualSessionId;
  forgedReceipt.principalId = `system-scheduler:${actualSessionId}`;
  forgedReceipt.commandId = actualSystemCommandId;
  forgedReceipt.publicReceipt.commandId = actualSystemCommandId;
  forgedReceipt.fingerprint = createSystemCommandFingerprint({
    sessionId: actualSessionId,
    scheduleId,
    occurrence: 1,
    actionId: schedule.actionId,
    params: schedule.params,
    bundleHash,
    definitionHash: schedule.definitionHash
  });
  // Generic receipt validation does not own the action-definition pin. The
  // system store boundary must reject this mismatch just like PostgreSQL.
  forgedReceipt.definitionHash = `sha256:${"0".repeat(64)}`;

  await assert.rejects(
    store.withSystemCommandTransaction(
      {
        sessionId: actualSessionId,
        scheduleId,
        occurrence: 1,
        commandId: actualSystemCommandId
      },
      async () => ({
        result: undefined,
        scheduleDisposition: "skip",
        receipt: forgedReceipt
      })
    ),
    SessionStoreUnavailableError
  );

  assert.equal((await store.listPendingSystemSchedules(actualSessionId))[0]?.nextOccurrence, 1);
  await store.withSystemCommandTransaction(
    {
      sessionId: actualSessionId,
      scheduleId,
      occurrence: 1,
      commandId: actualSystemCommandId
    },
    async ({ existingReceipt }) => {
      assert.equal(existingReceipt, undefined);
      return { result: undefined, scheduleDisposition: "defer" };
    }
  );
});

test("in-memory malformed system occurrence fails as authentication instead of escaping identity validation", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());

  await assert.rejects(
    store.withSystemCommandTransaction(
      {
        sessionId: created.session.sessionId,
        scheduleId,
        occurrence: 0,
        commandId: `sys_${"A".repeat(43)}`
      },
      async () => ({ result: undefined, scheduleDisposition: "defer" })
    ),
    SessionAuthenticationError
  );
});

test("generic locked snapshot updates cannot advance the protected event ledger", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());

  await assert.rejects(
    store.withLockedSession(created.session.sessionId, async (current) => {
      assert.ok(current);
      return {
        result: undefined,
        updatedSession: {
          ...current,
          version: {
            sessionId: current.sessionId,
            stateVersion: current.version.stateVersion + 1,
            lastEventSequence: current.version.lastEventSequence + 1
          },
          updatedAt: new Date()
        }
      };
    }),
    SessionStoreUnavailableError
  );

  assert.deepEqual(await store.getSession(created.session.sessionId), created.session);
});

test("in-memory direct snapshot updates cannot advance the protected event ledger", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  const corrupted: SessionRecord<Record<string, unknown>> = {
    ...created.session,
    version: {
      sessionId: created.session.sessionId,
      stateVersion: 1,
      lastEventSequence: 1
    },
    updatedAt: new Date()
  };

  await assert.rejects(
    store.updateSession(corrupted, { expectedStateVersion: 0 }),
    SessionStoreUnavailableError
  );
  assert.deepEqual(await store.getSession(created.session.sessionId), created.session);
});

test("in-memory command callback failure leaves both state and receipt absent", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  await assert.rejects(
    store.withCommandTransaction({
      sessionId: created.session.sessionId,
      credentialSha256,
      commandId
    }, async () => {
      throw new Error("operation failed");
    }),
    /operation failed/u
  );
  assert.equal((await store.getSession(created.session.sessionId))?.version.stateVersion, 0);
  assert.deepEqual(await store.getSessionEvents(created.session.sessionId), []);
});

test("event sequence and receipt references are validated before an in-memory commit", async () => {
  const corruptions = [
    {
      name: "non-contiguous event sequence",
      mutate(input: { receipt: SessionCommandReceipt; events: SessionEventRecord[] }) {
        const wrongEvent = event({ session: input.receipt.sessionId, sequence: 2 });
        input.receipt.eventRefs = [wrongEvent.eventId];
        input.receipt.publicReceipt.eventRefs = [wrongEvent.eventId];
        input.events = [wrongEvent];
      }
    },
    {
      name: "receipt points at another event",
      mutate(input: { receipt: SessionCommandReceipt; events: SessionEventRecord[] }) {
        input.receipt.eventRefs = [`${input.receipt.sessionId}:999`];
        input.receipt.publicReceipt.eventRefs = [`${input.receipt.sessionId}:999`];
      }
    }
  ];

  for (const corruption of corruptions) {
    const store = new InMemorySessionStore<Record<string, unknown>>();
    const created = await store.createSession(createInput());
    const actualSessionId = created.session.sessionId;
    const committedEvent = event({ session: actualSessionId, sequence: 1 });
    const transaction = {
      receipt: receipt({
        session: actualSessionId,
        before: 0,
        after: 1,
        eventRefs: [committedEvent.eventId]
      }),
      events: [committedEvent]
    };
    corruption.mutate(transaction);

    await assert.rejects(
      store.withCommandTransaction(
        { sessionId: actualSessionId, credentialSha256, commandId },
        async ({ currentSession }) => ({
          result: undefined,
          updatedSession: {
            ...currentSession,
            state: { public: { applied: 1 } },
            version: { sessionId: actualSessionId, stateVersion: 1, lastEventSequence: 1 },
            updatedAt: new Date()
          },
          receipt: transaction.receipt,
          events: transaction.events
        })
      ),
      SessionStoreUnavailableError,
      corruption.name
    );
    assert.equal((await store.getSession(actualSessionId))?.version.stateVersion, 0, corruption.name);
    assert.deepEqual(await store.getSessionEvents(actualSessionId), [], corruption.name);
    await store.withCommandTransaction(
      { sessionId: actualSessionId, credentialSha256, commandId },
      async ({ existingReceipt }) => {
        assert.equal(existingReceipt, undefined, corruption.name);
        return { result: undefined };
      }
    );
  }
});

test("command transaction rejects contradictory status and public receipt projections", async () => {
  const corruptions = [
    {
      name: "rejected receipt attempts to commit state",
      mutate(value: SessionCommandReceipt) {
        value.status = "rejected";
        value.publicReceipt.status = "rejected";
        value.publicReceipt.rejectionCode = "FIXTURE_REJECTED";
      }
    },
    {
      name: "public receipt names another action",
      mutate(value: SessionCommandReceipt) {
        value.publicReceipt.actionId = "different-action";
      }
    },
    {
      name: "public receipt changes event references",
      mutate(value: SessionCommandReceipt) {
        value.publicReceipt.eventRefs = [`${value.sessionId}:999`];
      }
    },
    {
      name: "protected Mechanics audit contains an invalid counter",
      mutate(value: SessionCommandReceipt) {
        assert.ok(value.audit.mechanics);
        value.audit.mechanics.cost.steps = -1;
      }
    }
  ];

  for (const corruption of corruptions) {
    const store = new InMemorySessionStore<Record<string, unknown>>();
    const created = await store.createSession(createInput());
    const actualSessionId = created.session.sessionId;
    const committedEvent = event({ session: actualSessionId, sequence: 1 });
    const corruptedReceipt = receipt({
      session: actualSessionId,
      before: 0,
      after: 1,
      eventRefs: [committedEvent.eventId]
    });
    corruption.mutate(corruptedReceipt);

    await assert.rejects(
      store.withCommandTransaction(
        { sessionId: actualSessionId, credentialSha256, commandId },
        async ({ currentSession }) => ({
          result: undefined,
          updatedSession: {
            ...currentSession,
            version: { sessionId: actualSessionId, stateVersion: 1, lastEventSequence: 1 },
            updatedAt: new Date()
          },
          receipt: corruptedReceipt,
          events: [committedEvent]
        })
      ),
      SessionStoreUnavailableError,
      corruption.name
    );
    assert.deepEqual(await store.getSession(actualSessionId), created.session, corruption.name);
  }
});

test("command transaction rejects an applied receipt without a committed snapshot", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  const appliedReceipt = receipt({
    session: created.session.sessionId,
    before: 0,
    after: 0
  });
  appliedReceipt.publicReceipt.stateVersionAfter = 0;

  await assert.rejects(
    store.withCommandTransaction(
      { sessionId: created.session.sessionId, credentialSha256, commandId },
      async () => ({ result: undefined, receipt: appliedReceipt })
    ),
    SessionStoreUnavailableError
  );
});

test("in-memory bundle is content-addressed and cannot be mutated through a read", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession(createInput());
  const firstRead = await store.getImmutableBundle(created.session.bundleHash);
  assert.ok(firstRead);
  (firstRead.canonicalBundle as { manifest: Record<string, unknown> }).manifest.changed = true;
  const secondRead = await store.getImmutableBundle(created.session.bundleHash);
  assert.deepEqual(secondRead?.canonicalBundle, canonicalBundle);

  const mismatched = createInput();
  mismatched.immutableBundle = {
    ...mismatched.immutableBundle,
    canonicalBundle: { gameId: "fixture-game", manifest: { changed: true } }
  };
  await assert.rejects(store.createSession(mismatched), SessionStoreUnavailableError);
});

test("readiness checks every command-ledger table and required privileges", async () => {
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    () => result([{ writable: true, can_select: true, can_insert: true, can_update: true }])
  );
  const store = new PostgresSessionStore(pool);
  await store.checkReadiness();
  const sql = pool.directQueries[0]?.text ?? "";
  for (const table of [
    "game_sessions",
    "game_bundles",
    "session_principals",
    "command_receipts",
    "session_events",
    "system_schedules"
  ]) {
    assert.match(sql, new RegExp(table, "u"));
  }
});

test("PostgreSQL reads session events after a cursor in canonical sequence order", async () => {
  const storedEvent = event({ session: sessionId, sequence: 8 });
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    (text, values) => {
      assert.match(text, /FROM session_events/u);
      assert.match(text, /sequence > \$2 ORDER BY sequence ASC/u);
      assert.deepEqual(values, [sessionId, 7]);
      return result([eventRow(storedEvent)]);
    }
  );
  const store = new PostgresSessionStore(pool);

  const events = await store.getSessionEvents(sessionId, 7);

  assert.deepEqual(events, [storedEvent]);
});

test("database details are replaced by a neutral typed HTTP 503", async () => {
  const pool = new ScriptedPool(
    new ScriptedClient(() => result([])),
    () => { throw Object.assign(new Error("password for db.internal"), { code: "ECONNREFUSED" }); }
  );
  const store = new PostgresSessionStore(pool);
  await assert.rejects(store.getSession(sessionId), (error) => {
    assert.ok(error instanceof SessionStoreUnavailableError);
    assert.doesNotMatch(error.message, /password|db\.internal/u);
    return true;
  });
});

test("factory and idle-pool logging keep production storage safe", () => {
  let listener: ((error: Error) => void) | undefined;
  const messages: string[] = [];
  installSafePoolErrorHandler({
    on(event, installedListener) {
      assert.equal(event, "error");
      listener = installedListener;
    }
  }, (message) => messages.push(message));
  listener?.(new Error("postgresql://user:secret@db.internal/cubica"));
  assert.deepEqual(messages, ["runtime-api PostgreSQL session pool lost an idle connection."]);
  assert.throws(
    () => createSessionStoreFromEnvironment({ NODE_ENV: "production", SESSION_STORE: "in-memory" }),
    /forbidden in production/u
  );
  assert.throws(
    () => createSessionStoreFromEnvironment({ NODE_ENV: "production", SESSION_STORE: "postgresql" }),
    /DATABASE_URL is required/u
  );
});

function createInput(): CreateSessionInput<Record<string, unknown>> {
  return {
    gameId: "fixture-game",
    contentSourceId: "editor-source",
    sessionRole: "facilitator",
    initialState: { public: { step: 1 } },
    immutableBundle: {
      bundleHash,
      gameId: "fixture-game",
      canonicalBytes: bundleRow.canonical_bytes,
      canonicalBundle: bundleRow.canonical_bundle
    },
    principal: {
      principalId,
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  };
}

function systemSchedule(
  overrides: Partial<Pick<SessionSystemSchedule, "maxOccurrences" | "nextOccurrence" | "status">> = {}
): SessionSystemSchedule {
  return {
    scheduleId,
    sessionId,
    bundleHash,
    actionId: scheduledActionId,
    params: { target: "fixture", amount: 2 },
    definitionHash: scheduledDefinitionHash,
    trigger: { op: "predicate.literal", value: true },
    falsePolicy: "defer",
    maxOccurrences: overrides.maxOccurrences ?? 1,
    nextOccurrence: overrides.nextOccurrence ?? 1,
    status: overrides.status ?? "pending",
    createdAt: now,
    updatedAt: now
  };
}

function systemScheduleRow(value: SessionSystemSchedule): QueryResultRow {
  return {
    schedule_id: value.scheduleId,
    session_id: value.sessionId,
    bundle_hash: value.bundleHash,
    action_id: value.actionId,
    params: value.params,
    definition_hash: value.definitionHash,
    trigger: value.trigger,
    false_policy: value.falsePolicy,
    max_occurrences: String(value.maxOccurrences),
    next_occurrence: String(value.nextOccurrence),
    status: value.status,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

function systemReceipt(input: {
  status: "applied" | "rejected";
  before: number;
  after: number;
  eventRefs?: string[];
}): SessionCommandReceipt {
  const value = receipt({
    before: input.before,
    after: input.after,
    eventRefs: input.eventRefs
  });
  value.principalId = systemPrincipalId;
  value.commandId = systemCommandId;
  value.fingerprint = createSystemCommandFingerprint({
    sessionId,
    scheduleId,
    occurrence: 1,
    actionId: scheduledActionId,
    params: systemSchedule().params,
    bundleHash,
    definitionHash: scheduledDefinitionHash
  });
  value.actionId = scheduledActionId;
  value.definitionHash = scheduledDefinitionHash;
  value.status = input.status;
  value.publicReceipt.commandId = systemCommandId;
  value.publicReceipt.actionId = scheduledActionId;
  value.publicReceipt.status = input.status;
  value.audit.triggerActionId = scheduledActionId;
  if (input.status === "rejected") {
    value.publicReceipt.rejectionCode = "SYSTEM_TRIGGER_SKIPPED";
    value.result = {
      formatVersion: "1.0.0",
      kind: "game-intent",
      value: { ok: false, error: { code: "SYSTEM_TRIGGER_SKIPPED" } }
    };
  }
  return value;
}

function systemEvent(input: { sequence: number }): SessionEventRecord {
  return {
    eventId: `${sessionId}:${input.sequence}`,
    sessionId,
    sequence: input.sequence,
    receiptId,
    commandId: systemCommandId,
    actionId: scheduledActionId,
    principalId: systemPrincipalId,
    audience: "public",
    eventType: "scheduled.applied",
    summary: { messageKey: "scheduled.applied" },
    data: { source: "system" },
    createdAt: now
  };
}

function receipt(input: {
  session?: string;
  before: number;
  after: number;
  eventRefs?: string[];
}): SessionCommandReceipt {
  const scopedSessionId = input.session ?? sessionId;
  const eventRefs = input.eventRefs ?? [];
  return {
    receiptId,
    sessionId: scopedSessionId,
    principalId,
    commandId,
    fingerprint: "c".repeat(64),
    actionId: "advance",
    bundleHash,
    definitionHash,
    planHash,
    stateVersionBefore: input.before,
    stateVersionAfter: input.after,
    status: "applied",
    eventRefs,
    publicReceipt: {
      commandId,
      actionId: "advance",
      status: "applied",
      stateVersionBefore: input.before,
      stateVersionAfter: input.after,
      eventRefs,
      planHash
    },
    result: { formatVersion: "1.0.0", kind: "game-intent", value: { ok: true } },
    audit: {
      acceptedAt: now,
      commandKind: "game-intent",
      triggerActionId: "advance",
      mechanics: {
        formatVersion: "1.0.0",
        steps: [{ stepId: "s001", operation: "core.assert", result: true }],
        cost: {
          steps: 1,
          expressionNodes: 1,
          scannedEntities: 0,
          resultEntities: 0,
          writes: 0,
          events: 0,
          intermediateBytes: 4,
          eventBytes: 0,
          auditBytes: 72
        }
      }
    },
    createdAt: now
  };
}

function event(input: { session: string; sequence: number }): SessionEventRecord {
  return {
    eventId: `${input.session}:${input.sequence}`,
    sessionId: input.session,
    sequence: input.sequence,
    receiptId,
    commandId,
    actionId: "advance",
    principalId,
    audience: "public",
    eventType: "turn.advanced",
    summary: { messageKey: "turn.advanced" },
    data: { step: 2 },
    createdAt: now
  };
}

function receiptRow(value: SessionCommandReceipt): QueryResultRow {
  return {
    receipt_id: value.receiptId,
    session_id: value.sessionId,
    principal_id: value.principalId,
    command_id: value.commandId,
    fingerprint: value.fingerprint,
    action_id: value.actionId,
    actor_id: value.actorId ?? null,
    bundle_hash: value.bundleHash,
    definition_hash: value.definitionHash,
    plan_hash: value.planHash ?? null,
    state_version_before: String(value.stateVersionBefore),
    state_version_after: String(value.stateVersionAfter),
    status: value.status,
    event_refs: value.eventRefs,
    public_receipt: value.publicReceipt,
    command_result: value.result ?? null,
    audit: value.audit,
    created_at: value.createdAt
  };
}

function eventRow(value: SessionEventRecord): QueryResultRow {
  return {
    event_id: value.eventId,
    session_id: value.sessionId,
    sequence: String(value.sequence),
    receipt_id: value.receiptId,
    command_id: value.commandId,
    action_id: value.actionId,
    principal_id: value.principalId,
    actor_id: value.actorId ?? null,
    audience: value.audience,
    event_type: value.eventType,
    summary: value.summary,
    event_data: value.data,
    created_at: value.createdAt
  };
}

function result<TRow extends QueryResultRow>(rows: TRow[], rowCount = rows.length): QueryResult<TRow> {
  return { command: "TEST", rowCount, oid: 0, fields: [], rows };
}

function firstSqlWord(sql: string): string {
  return sql.trim().split(/\s+/u)[0] ?? "";
}
