/**
 * Unit tests for the admin readiness helpers.
 *
 * These tests prove the readiness probe is HONEST:
 * - the content check actually executes a manifest-load probe and reports
 *   failure when that probe throws;
 * - the session-store mode reflects the REAL injected store rather than a
 *   hardcoded literal.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReadinessResponse,
  checkContentSubsystem,
  checkSessionStore,
  deriveSessionStoreMode,
  type ContentProbe
} from "../src/modules/admin/health.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

// A probe whose manifest load always throws, simulating a broken content subsystem.
const failingContentProbe: ContentProbe = {
  listGameIds: async () => ["broken-game"],
  loadManifest: async () => {
    throw new Error("manifest load failed");
  }
};

// A probe with no games available at all.
const emptyContentProbe: ContentProbe = {
  listGameIds: async () => [],
  loadManifest: async () => {
    throw new Error("should not be called");
  }
};

test("checkContentSubsystem probes a real manifest and reports ok by default", async () => {
  const result = await checkContentSubsystem();
  assert.equal(result.status, "ok");
  assert.equal(result.ready, true);
  // Confirms an actual game manifest was loaded rather than a no-op success.
  assert.equal(typeof result.probedGameId, "string");
});

test("checkContentSubsystem reports error when the manifest load fails", async () => {
  const result = await checkContentSubsystem(failingContentProbe);
  assert.equal(result.status, "error");
  assert.equal(result.ready, false);
  assert.match(String(result.message), /manifest load failed/);
});

test("checkContentSubsystem reports error when no games are available", async () => {
  const result = await checkContentSubsystem(emptyContentProbe);
  assert.equal(result.status, "error");
  assert.equal(result.ready, false);
});

test("buildReadinessResponse is not ready when the content probe fails", async () => {
  const readiness = await buildReadinessResponse(new InMemorySessionStore(), {
    contentProbe: failingContentProbe
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.dependencies.content.status, "error");
});

test("buildReadinessResponse is ready with the default (real) content probe", async () => {
  const readiness = await buildReadinessResponse(new InMemorySessionStore());
  assert.equal(readiness.ready, true);
  assert.equal(readiness.dependencies.content.status, "ok");
  assert.equal(readiness.dependencies.sessionStore.status, "ok");
});

test("session store mode reflects the injected in-memory store", () => {
  const check = checkSessionStore(new InMemorySessionStore());
  assert.equal(check.mode, "in-memory");
});

test("deriveSessionStoreMode reflects an alternate store class name", () => {
  // A hypothetical alternate backing store must be reported honestly, proving
  // the mode is not hardcoded to "in-memory".
  class RedisSessionStore {
    async createSession() {
      return {} as never;
    }
    async getSession() {
      return null;
    }
    async updateSession(session: unknown) {
      return session as never;
    }
  }

  assert.equal(deriveSessionStoreMode(new RedisSessionStore()), "redis");
});
