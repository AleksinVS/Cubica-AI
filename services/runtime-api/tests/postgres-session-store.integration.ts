/** Optional restart-recovery proof against a disposable real PostgreSQL database. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionCommandReceipt, SessionEventRecord } from "@cubica/contracts-session";
import { Pool } from "pg";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import {
  asSessionDatabasePool,
  PostgresSessionStore
} from "../src/modules/session/postgresSessionStore.ts";
import { SessionWriteLockedError } from "../src/modules/session/sessionStoreErrors.ts";

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;

test("PostgreSQL state, command receipt and event ledger survive a store restart", {
  skip: databaseUrl === undefined ? "set TEST_POSTGRES_DATABASE_URL to a disposable database" : false
}, async () => {
  assert.ok(databaseUrl);
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migration001 = await readFile(path.resolve(testDirectory, "../migrations/001_game_sessions.up.sql"), "utf8");
  const migration002 = await readFile(
    path.resolve(testDirectory, "../migrations/002_authenticated_command_ledger.up.sql"),
    "utf8"
  );
  const migration003 = await readFile(
    path.resolve(testDirectory, "../migrations/003_system_schedules.up.sql"),
    "utf8"
  );
  const migration004 = await readFile(
    path.resolve(testDirectory, "../migrations/004_session_participants.up.sql"),
    "utf8"
  );
  const migration005 = await readFile(
    path.resolve(testDirectory, "../migrations/005_session_event_metric_changes.up.sql"),
    "utf8"
  );
  const migration006 = await readFile(
    path.resolve(testDirectory, "../migrations/006_private_invite_claim.up.sql"),
    "utf8"
  );
  const migration007 = await readFile(
    path.resolve(testDirectory, "../migrations/007_private_seat_recovery.up.sql"),
    "utf8"
  );
  const setupPool = new Pool({ connectionString: databaseUrl });
  await setupPool.query(migration001);
  await setupPool.query(migration002);
  await setupPool.query(migration003);
  await setupPool.query(migration004);
  await setupPool.query(migration005);
  await setupPool.query(migration006);
  await setupPool.query(migration007);
  await setupPool.end();

  const firstPool = new Pool({ connectionString: databaseUrl });
  const firstStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(firstPool));
  const immutableBundle = createImmutableBundleContent("persistence-integration-fixture", {});
  const credentialSha256 = "b".repeat(64);
  const principalId = "22222222-2222-4222-8222-222222222222";
  const commandId = "cli_AAAAAAAAAAAAAAAAAAAAAA";
  const created = await firstStore.createSession({
    gameId: "persistence-integration-fixture",
    contentSourceId: "preview-source",
    sessionRole: "facilitator",
    participants: [{ seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }],
    initialState: { public: { step: 1 } },
    immutableBundle,
    principal: {
      principalId,
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  const receiptId = randomUUID();
  const eventId = `${created.session.sessionId}:1`;
  const committedAt = new Date();
  const commandReceipt: SessionCommandReceipt = {
    receiptId,
    sessionId: created.session.sessionId,
    principalId,
    commandId,
    fingerprint: "c".repeat(64),
    actionId: "advance",
    bundleHash: created.session.bundleHash,
    definitionHash: `sha256:${"d".repeat(64)}`,
    planHash: `sha256:${"e".repeat(64)}`,
    stateVersionBefore: 0,
    stateVersionAfter: 1,
    status: "applied",
    eventRefs: [eventId],
    publicReceipt: {
      commandId,
      actionId: "advance",
      status: "applied",
      stateVersionBefore: 0,
      stateVersionAfter: 1,
      eventRefs: [eventId],
      planHash: `sha256:${"e".repeat(64)}`
    },
    result: { formatVersion: "1.0.0", kind: "game-intent", value: { ok: true } },
    audit: {
      acceptedAt: committedAt,
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
    createdAt: committedAt
  };
  const commandEvent: SessionEventRecord = {
    eventId,
    sessionId: created.session.sessionId,
    sequence: 1,
    receiptId,
    commandId,
    actionId: "advance",
    principalId,
    audience: "public",
    eventType: "turn.advanced",
    summary: { messageKey: "turn.advanced" },
    data: { step: 2 },
    createdAt: committedAt
  };
  await firstStore.withCommandTransaction({
    sessionId: created.session.sessionId,
    credentialSha256,
    commandId
  }, async ({ currentSession, existingReceipt }) => {
    assert.equal(existingReceipt, undefined);
    return {
      result: undefined,
      updatedSession: {
        ...currentSession,
        state: { public: { step: 2 } },
        version: { sessionId: currentSession.sessionId, stateVersion: 1, lastEventSequence: 1 },
        updatedAt: new Date()
      },
      receipt: commandReceipt,
      events: [commandEvent]
    };
  });
  assert.deepEqual(await firstStore.getSessionEvents(created.session.sessionId), [commandEvent]);
  const privateInviteSha256 = "8".repeat(64);
  const privateCredentialSha256 = "9".repeat(64);
  const privateGuestPrincipalId = "55555555-5555-4555-8555-555555555555";
  const privateParticipants = [
    { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "joined" as const },
    { seatId: "p2", playerId: "p2", kind: "human" as const, joinState: "invited" as const }
  ];
  const privateCreated = await firstStore.createSession({
    gameId: "persistence-private-invite-fixture",
    sessionRole: "player",
    participants: privateParticipants,
    initialState: { public: { step: 1 } },
    immutableBundle: createImmutableBundleContent("persistence-private-invite-fixture", {}),
    principal: {
      principalId: "44444444-4444-4444-8444-444444444444",
      kind: "participant",
      role: "player",
      actorScope: { kind: "listed-actors", actorIds: ["p1"] },
      credentialSha256: "7".repeat(64)
    },
    additionalPrincipals: [{
      principalId: privateGuestPrincipalId,
      kind: "participant",
      role: "player",
      actorScope: { kind: "listed-actors", actorIds: ["p2"] },
      credentialSha256: privateInviteSha256,
      credentialExpiresAt: new Date("2030-01-01T00:00:00.000Z")
    }]
  });
  assert.equal(await firstStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: privateInviteSha256
  }), null);
  await firstStore.close();

  const secondPool = new Pool({ connectionString: databaseUrl });
  const secondStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(secondPool));
  const restored = await secondStore.getSession(created.session.sessionId);
  assert.deepEqual(restored?.state, { public: { step: 2 } });
  assert.equal(restored?.version.stateVersion, 1);
  assert.equal(restored?.contentSourceId, "preview-source");
  assert.equal(restored?.sessionRole, "facilitator");
  assert.deepEqual(restored?.participants, created.session.participants);
  assert.equal(restored?.version.lastEventSequence, 1);
  assert.equal((await secondStore.authenticateSession({
    sessionId: created.session.sessionId,
    credentialSha256
  }))?.principalId, principalId);
  assert.equal((await secondStore.getCommandReceipt({
    sessionId: created.session.sessionId,
    credentialSha256,
    commandId
  }))?.receiptId, receiptId);
  assert.deepEqual(await secondStore.getSessionEvents(created.session.sessionId), [commandEvent]);
  assert.deepEqual(await secondStore.getSessionEvents(created.session.sessionId, 1), []);

  const contenderPool = new Pool({ connectionString: databaseUrl });
  const contenderStore = new PostgresSessionStore<Record<string, unknown>>(
    asSessionDatabasePool(contenderPool)
  );
  const claimInputs = [privateCredentialSha256, "a".repeat(64)].map((participantCredentialSha256) => ({
    sessionId: privateCreated.session.sessionId,
    inviteCredentialSha256: privateInviteSha256,
    participantCredentialSha256,
    claimedAt: new Date("2026-08-25T12:00:00.000Z")
  }));
  const claimResults = await Promise.allSettled([
    secondStore.claimPrivateInvite(claimInputs[0]),
    contenderStore.claimPrivateInvite(claimInputs[1])
  ]);
  const winners = claimResults.filter((result) => result.status === "fulfilled" && result.value !== null);
  const losers = claimResults.filter((result) =>
    result.status === "fulfilled" && result.value === null ||
    result.status === "rejected" && result.reason instanceof SessionWriteLockedError
  );
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  const claimed = winners[0].status === "fulfilled" ? winners[0].value : null;
  assert.equal(claimed?.principal.principalId, privateGuestPrincipalId);
  assert.deepEqual(claimed?.session.participants.map(({ joinState }) => joinState), ["joined", "joined"]);
  assert.equal(claimed?.session.version.stateVersion, 1);
  const winningCredentialSha256 = claimResults.findIndex((result) =>
    result.status === "fulfilled" && result.value !== null
  ) === 0 ? claimInputs[0].participantCredentialSha256 : claimInputs[1].participantCredentialSha256;
  const losingCredentialSha256 = winningCredentialSha256 === claimInputs[0].participantCredentialSha256
    ? claimInputs[1].participantCredentialSha256
    : claimInputs[0].participantCredentialSha256;
  assert.equal(await secondStore.claimPrivateInvite({
    sessionId: privateCreated.session.sessionId,
    inviteCredentialSha256: privateInviteSha256,
    participantCredentialSha256: "b".repeat(64),
    claimedAt: new Date("2026-08-25T12:00:01.000Z")
  }), null);
  assert.equal((await secondStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: winningCredentialSha256
  }))?.principalId, privateGuestPrincipalId);
  assert.equal(await secondStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: losingCredentialSha256
  }), null);
  await contenderStore.close();

  const replayed = await secondStore.withCommandTransaction({
    sessionId: created.session.sessionId,
    credentialSha256,
    commandId
  }, async ({ existingReceipt }) => {
    assert.equal(existingReceipt?.receiptId, receiptId);
    assert.equal(existingReceipt?.definitionHash, commandReceipt.definitionHash);
    assert.equal(existingReceipt?.planHash, commandReceipt.planHash);
    assert.deepEqual(existingReceipt?.audit.mechanics, commandReceipt.audit.mechanics);
    return { result: existingReceipt?.result };
  });
  assert.deepEqual(replayed, commandReceipt.result);
  assert.equal((await secondStore.getSessionEvents(created.session.sessionId)).length, 1);
  const beforeRecovery = await secondStore.getSession(privateCreated.session.sessionId);
  assert.ok(beforeRecovery);
  const recoveryTokenSha256 = "6".repeat(64);
  const recoveryCredentialSha256 = "5".repeat(64);
  const recoveryIssued = await secondStore.issuePrivateSeatRecoveryInvite({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: "7".repeat(64),
    seatId: "p2",
    recoveryTokenSha256,
    issuedAt: new Date("2026-08-25T12:01:00.000Z"),
    recoveryTokenExpiresAt: new Date("2026-08-26T12:01:00.000Z")
  });
  assert.equal(recoveryIssued?.playerId, "p2");
  await secondStore.close();

  const thirdPool = new Pool({ connectionString: databaseUrl });
  const thirdStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(thirdPool));
  assert.equal(await thirdStore.claimPrivateInvite({
    sessionId: privateCreated.session.sessionId,
    inviteCredentialSha256: recoveryTokenSha256,
    participantCredentialSha256: "4".repeat(64),
    currentCredentialSha256: "7".repeat(64),
    claimedAt: new Date("2026-08-25T12:01:30.000Z")
  }), null, "a live host credential cannot claim a guest recovery capability");
  const recovered = await thirdStore.claimPrivateInvite({
    sessionId: privateCreated.session.sessionId,
    inviteCredentialSha256: recoveryTokenSha256,
    participantCredentialSha256: recoveryCredentialSha256,
    currentCredentialSha256: winningCredentialSha256,
    claimedAt: new Date("2026-08-25T12:02:00.000Z")
  });
  assert.equal(recovered?.transition, "credential-recovery");
  assert.deepEqual(recovered?.session, beforeRecovery);
  assert.equal(await thirdStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: winningCredentialSha256
  }), null);
  assert.equal((await thirdStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: recoveryCredentialSha256
  }))?.principalId, privateGuestPrincipalId);
  const retryRecoveryTokenSha256 = "8".repeat(64);
  assert.ok(await thirdStore.issuePrivateSeatRecoveryInvite({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: "7".repeat(64),
    seatId: "p2",
    recoveryTokenSha256: retryRecoveryTokenSha256,
    issuedAt: new Date("2026-08-25T12:03:00.000Z"),
    recoveryTokenExpiresAt: new Date("2026-08-26T12:03:00.000Z")
  }));
  const recoveredAfterLostResponse = await thirdStore.claimPrivateInvite({
    sessionId: privateCreated.session.sessionId,
    inviteCredentialSha256: retryRecoveryTokenSha256,
    participantCredentialSha256: "9".repeat(64),
    currentCredentialSha256: winningCredentialSha256,
    claimedAt: new Date("2026-08-25T12:04:00.000Z")
  });
  assert.equal(recoveredAfterLostResponse?.principal.principalId, privateGuestPrincipalId);
  assert.equal((await thirdStore.authenticateSession({
    sessionId: privateCreated.session.sessionId,
    credentialSha256: "9".repeat(64)
  }))?.principalId, privateGuestPrincipalId);
  await thirdPool.query("DELETE FROM game_sessions WHERE id = $1", [created.session.sessionId]);
  await thirdPool.query("DELETE FROM game_sessions WHERE id = $1", [privateCreated.session.sessionId]);
  await thirdStore.close();
});

test("PostgreSQL runtime HTTP restart resyncs private-invite peers", {
  skip: databaseUrl === undefined ? "set TEST_POSTGRES_DATABASE_URL to a disposable database" : false
}, async () => {
  assert.ok(databaseUrl);
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  let setupPool: Pool | undefined = new Pool({ connectionString: databaseUrl });
  const cleanupPool = new Pool({ connectionString: databaseUrl });
  let firstApi: ReturnType<typeof createRuntimeApiServer> | undefined;
  let secondApi: ReturnType<typeof createRuntimeApiServer> | undefined;
  let sessionId: string | undefined;
  const streamReaders: ReadableStreamDefaultReader<Uint8Array>[] = [];

  try {
    // Keep this proof runnable on its own against an already provisioned
    // disposable database, without creating or dropping a database here.
    const hasSessionsTable = await setupPool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.game_sessions') AS table_name"
    );
    if (hasSessionsTable.rows[0]?.table_name === null) {
      for (const migrationName of [
        "001_game_sessions.up.sql",
        "002_authenticated_command_ledger.up.sql",
        "003_system_schedules.up.sql",
        "004_session_participants.up.sql",
        "005_session_event_metric_changes.up.sql",
        "006_private_invite_claim.up.sql",
        "007_private_seat_recovery.up.sql"
      ]) {
        await setupPool.query(
          await readFile(path.resolve(testDirectory, "../migrations", migrationName), "utf8")
        );
      }
    } else {
      const hasInviteExpiry = await setupPool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'session_principals'
           AND column_name = 'credential_expires_at'`
      );
      if (hasInviteExpiry.rowCount === 0) {
        await setupPool.query(
          await readFile(path.resolve(testDirectory, "../migrations/006_private_invite_claim.up.sql"), "utf8")
        );
      }
      const hasRecoveryToken = await setupPool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'session_principals'
           AND column_name = 'recovery_token_sha256'`
      );
      if (hasRecoveryToken.rowCount === 0) {
        await setupPool.query(
          await readFile(path.resolve(testDirectory, "../migrations/007_private_seat_recovery.up.sql"), "utf8")
        );
      }
    }
    await setupPool.end();
    setupPool = undefined;

    const firstPool = new Pool({ connectionString: databaseUrl });
    const firstStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(firstPool));
    firstApi = createRuntimeApiServer({ port: 0, sessionStore: firstStore });
    await firstApi.start();
    const firstBaseUrl = `http://127.0.0.1:${firstApi.port}`;

    const createResponse = await fetch(`${firstBaseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId: "estate-race",
        participantCount: 2,
        accessMode: "private-invite"
      })
    });
    const created = await readJson<PrivateInviteRuntimeSession>(createResponse);
    assert.equal(createResponse.status, 201, JSON.stringify(created));
    sessionId = created.sessionId;
    assert.equal(created.participants.map(({ playerId }) => playerId).join(","), "p1,p2");
    const inviteToken = created.privateInvites?.[0]?.inviteToken;
    assert.ok(inviteToken);

    const claimResponse = await fetch(`${firstBaseUrl}/sessions/${sessionId}/private-invite-claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteToken })
    });
    const claimed = await readJson<PrivateInviteRuntimeSession>(claimResponse);
    assert.equal(claimResponse.status, 200, JSON.stringify(claimed));
    assert.deepEqual(
      claimed.participants.map(({ playerId, joinState }) => ({ playerId, joinState })),
      [
        { playerId: "p1", joinState: "joined" },
        { playerId: "p2", joinState: "joined" }
      ]
    );
    assert.equal(claimed.version.stateVersion, 1);
    const hostCredential = created.credential;
    const guestCredential = claimed.credential;
    assert.ok(hostCredential);
    assert.ok(guestCredential);

    // close() owns the complete first runtime lifecycle, including its store
    // and PostgreSQL pool, before a fresh process-local event hub is started.
    await firstApi.close();
    firstApi = undefined;

    const secondPool = new Pool({ connectionString: databaseUrl });
    const secondStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(secondPool));
    secondApi = createRuntimeApiServer({ port: 0, sessionStore: secondStore });
    await secondApi.start();
    const secondBaseUrl = `http://127.0.0.1:${secondApi.port}`;
    const authenticatedGet = async (credential: string): Promise<{
      response: Response;
      body: PrivateInviteRuntimeSession;
    }> => {
      const response = await fetch(`${secondBaseUrl}/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${credential}` }
      });
      return { response, body: await readJson<PrivateInviteRuntimeSession>(response) };
    };

    const hostGet = await authenticatedGet(hostCredential);
    const guestGet = await authenticatedGet(guestCredential);
    assert.equal(hostGet.response.status, 200, JSON.stringify(hostGet.body));
    assert.equal(guestGet.response.status, 200, JSON.stringify(guestGet.body));
    assert.equal(hostGet.body.version.stateVersion, 1);
    assert.equal(guestGet.body.version.stateVersion, 1);
    assert.equal(hostGet.body.state?.public?.setupComplete, false);
    assert.equal(guestGet.body.state?.public?.setupComplete, false);

    const hostStream = await openAuthenticatedSse(secondBaseUrl, sessionId, hostCredential);
    const guestStream = await openAuthenticatedSse(secondBaseUrl, sessionId, guestCredential);
    streamReaders.push(hostStream.reader, guestStream.reader);
    assert.deepEqual(hostStream.initial, {
      stateVersion: hostGet.body.version.stateVersion,
      lastEventSequence: hostGet.body.version.lastEventSequence
    });
    assert.deepEqual(guestStream.initial, {
      stateVersion: guestGet.body.version.stateVersion,
      lastEventSequence: guestGet.body.version.lastEventSequence
    });

    const setupResponse = await fetch(`${secondBaseUrl}/actions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${hostCredential}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId,
        actionId: "session.setup.finalize",
        commandId: `cli_${randomUUID().replaceAll("-", "").slice(0, 22)}`,
        expectedStateVersion: hostGet.body.version.stateVersion,
        params: {}
      })
    });
    const setup = await readJson<PrivateInviteRuntimeSession>(setupResponse);
    assert.equal(setupResponse.status, 200, JSON.stringify(setup));
    assert.equal(setup.receipt?.actionId, "session.setup.finalize");
    assert.ok(setup.version.stateVersion > guestStream.initial.stateVersion);

    const hostCursor = await readSseVersion(hostStream.reader);
    const guestCursor = await readSseVersion(guestStream.reader);
    const setupCursor = {
      stateVersion: setup.version.stateVersion,
      lastEventSequence: setup.version.lastEventSequence
    };
    assert.deepEqual(hostCursor, setupCursor);
    assert.deepEqual(guestCursor, setupCursor);

    const guestAfter = await authenticatedGet(guestCredential);
    assert.equal(guestAfter.response.status, 200, JSON.stringify(guestAfter.body));
    assert.deepEqual(guestAfter.body.version, setup.version);
    assert.equal(guestAfter.body.state?.public?.setupComplete, true);
  } finally {
    await Promise.all(streamReaders.map(async (reader) => {
      try {
        await reader.cancel();
      } catch {
        // The runtime may already have ended the stream during close().
      }
    }));
    if (firstApi !== undefined) {
      await firstApi.close();
    }
    if (secondApi !== undefined) {
      await secondApi.close();
    }
    await setupPool?.end();
    if (sessionId !== undefined) {
      await cleanupPool.query("DELETE FROM game_sessions WHERE id = $1", [sessionId]);
    }
    await cleanupPool.end();
  }
});

type PrivateInviteRuntimeSession = {
  sessionId: string;
  credential?: string;
  participants: Array<{ playerId: string; joinState: string }>;
  privateInvites?: Array<{ inviteToken: string }>;
  version: { sessionId?: string; stateVersion: number; lastEventSequence: number };
  state?: { public?: Record<string, unknown> };
  receipt?: { actionId: string };
};

async function openAuthenticatedSse(baseUrl: string, sessionId: string, credential: string): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  initial: { stateVersion: number; lastEventSequence: number };
}> {
  const response = await fetch(`${baseUrl}/sessions/${sessionId}/events`, {
    headers: { Authorization: `Bearer ${credential}` }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.ok(response.body);
  const reader = response.body.getReader();
  return { reader, initial: await readSseVersion(reader) };
}

async function readSseVersion(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{
  stateVersion: number;
  lastEventSequence: number;
}> {
  const decoder = new TextDecoder();
  let raw = "";
  while (!raw.includes("\n\n")) {
    const next = await reader.read();
    assert.equal(next.done, false, "SSE stream closed before a complete version message");
    raw += decoder.decode(next.value, { stream: true });
  }
  const data = raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  assert.ok(data);
  return JSON.parse(data) as { stateVersion: number; lastEventSequence: number };
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  return (body === "" ? {} : JSON.parse(body)) as T;
}
