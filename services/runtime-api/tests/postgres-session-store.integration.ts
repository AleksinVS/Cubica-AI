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
import {
  asSessionDatabasePool,
  PostgresSessionStore
} from "../src/modules/session/postgresSessionStore.ts";

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
  const setupPool = new Pool({ connectionString: databaseUrl });
  await setupPool.query(migration001);
  await setupPool.query(migration002);
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
  await firstStore.close();

  const secondPool = new Pool({ connectionString: databaseUrl });
  const secondStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(secondPool));
  const restored = await secondStore.getSession(created.session.sessionId);
  assert.deepEqual(restored?.state, { public: { step: 2 } });
  assert.equal(restored?.version.stateVersion, 1);
  assert.equal(restored?.contentSourceId, "preview-source");
  assert.equal(restored?.sessionRole, "facilitator");
  assert.equal(restored?.version.lastEventSequence, 1);
  assert.equal((await secondStore.authenticateSession({
    sessionId: created.session.sessionId,
    credentialSha256
  }))?.principalId, principalId);
  assert.deepEqual(await secondStore.getSessionEvents(created.session.sessionId), [commandEvent]);
  assert.deepEqual(await secondStore.getSessionEvents(created.session.sessionId, 1), []);

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
  await secondPool.query("DELETE FROM game_sessions WHERE id = $1", [created.session.sessionId]);
  await secondStore.close();
});
