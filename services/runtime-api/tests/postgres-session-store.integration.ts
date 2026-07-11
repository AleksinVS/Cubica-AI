/** Optional restart-recovery proof against a disposable real PostgreSQL database. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  asSessionDatabasePool,
  PostgresSessionStore
} from "../src/modules/session/postgresSessionStore.ts";

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;

test("PostgreSQL session survives closing and recreating the store", {
  skip: databaseUrl === undefined ? "set TEST_POSTGRES_DATABASE_URL to a disposable database" : false
}, async () => {
  assert.ok(databaseUrl);
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migration = await readFile(path.resolve(testDirectory, "../migrations/001_game_sessions.up.sql"), "utf8");
  const setupPool = new Pool({ connectionString: databaseUrl });
  await setupPool.query(migration);
  await setupPool.end();

  const firstPool = new Pool({ connectionString: databaseUrl });
  const firstStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(firstPool));
  const created = await firstStore.createSession({
    gameId: "persistence-integration-fixture",
    playerId: "player-1",
    contentSourceId: "preview-source",
    sessionRole: "facilitator",
    initialState: { public: { step: 1 } }
  });
  await firstStore.withLockedSession(created.sessionId, async (current) => {
    assert.ok(current);
    return {
      result: undefined,
      updatedSession: {
        ...current,
        state: { public: { step: 2 } },
        version: { sessionId: current.sessionId, stateVersion: 1, lastEventSequence: 1 },
        updatedAt: new Date()
      }
    };
  });
  await firstStore.close();

  const secondPool = new Pool({ connectionString: databaseUrl });
  const secondStore = new PostgresSessionStore<Record<string, unknown>>(asSessionDatabasePool(secondPool));
  const restored = await secondStore.getSession(created.sessionId);
  assert.deepEqual(restored?.state, { public: { step: 2 } });
  assert.equal(restored?.version.stateVersion, 1);
  assert.equal(restored?.contentSourceId, "preview-source");
  assert.equal(restored?.sessionRole, "facilitator");
  await secondPool.query("DELETE FROM game_sessions WHERE id = $1", [created.sessionId]);
  await secondStore.close();
});
