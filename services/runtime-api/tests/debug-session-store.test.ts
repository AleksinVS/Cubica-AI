import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  validateDebugSessionControlResponse,
  validateDebugCheckpointListResponse,
  validateDebugCheckpointMetadata,
  type SessionCommandReceipt,
  type SessionSystemSchedule
} from "@cubica/contracts-session";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { hashSessionCredential } from "../src/modules/session/sessionAuthentication.ts";
import { processPendingSystemSchedules } from "../src/modules/runtime/systemScheduler.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { SessionService } from "../src/modules/session/session.service.ts";
import {
  DebugCheckpointLimitError,
  DebugCheckpointTooLargeError,
  DebugSessionPausedError,
  SessionAuthorizationError,
  SessionVersionConflictError
} from "../src/modules/session/sessionStoreErrors.ts";

type State = { public: { step: number }; secret: { seed: string } };
const accessToken = "ses_" + "A".repeat(43);
const digest = hashSessionCredential(accessToken);
const replacementDigest = "b".repeat(64);
const participants = [{ seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "local" as const }];

async function fixture(preview = true) {
  const store = new InMemorySessionStore<State>();
  const bundle = createImmutableBundleContent("neutral-debug-fixture", {});
  const created = await store.createSession({
    gameId: "neutral-debug-fixture",
    ...(preview ? { contentSourceId: "editor-preview" } : {}),
    participants,
    initialState: { public: { step: 1 }, secret: { seed: "hidden-rng-stream" } },
    immutableBundle: bundle,
    principal: {
      principalId: randomUUID(), kind: "local-controller", role: "player",
      actorScope: { kind: "all-session-actors" }, credentialSha256: digest
    }
  });
  return { store, sessionId: created.session.sessionId, bundle };
}

test("pause waits for an active transaction, then blocks every new mutation path", async () => {
  const { store, sessionId } = await fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const running = store.withLockedSession(sessionId, async (current) => {
    assert.ok(current);
    entered();
    await gate;
    return {
      result: undefined,
      updatedSession: {
        ...current, state: { ...current.state, public: { step: 2 } },
        version: { ...current.version, stateVersion: 1 }, updatedAt: new Date()
      }
    };
  });
  await started;
  const stalePause = store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  release();
  await running;
  await assert.rejects(stalePause, SessionVersionConflictError);
  const paused = await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 1, paused: true });
  assert.equal(paused.version.stateVersion, 2);
  assert.equal(paused.debugPaused, true);
  assert.equal((await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 1, paused: true })).version.stateVersion, 2);

  let enteredNewCommand = false;
  await assert.rejects(store.withCommandTransaction({
    sessionId, credentialSha256: digest, commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA"
  }, async () => { enteredNewCommand = true; return { result: undefined }; }), DebugSessionPausedError);
  assert.equal(enteredNewCommand, false);
  await assert.rejects(store.withLockedSession(sessionId, async (current) => ({
    result: undefined, updatedSession: { ...current!, version: { ...current!.version, stateVersion: 3 } }
  })), DebugSessionPausedError);
  assert.deepEqual(await store.listPendingSystemSchedules(sessionId), []);
});

test("paused checkpoint forks full hidden state, pinned rules and schedule progress without prior receipts", async () => {
  const { store, sessionId, bundle } = await fixture();
  const commandId = "cli_BBBBBBBBBBBBBBBBBBBBBB";
  const principal = (await store.authenticateSession({ sessionId, credentialSha256: digest }))!;
  const schedule: SessionSystemSchedule = {
    scheduleId: "S".repeat(22), sessionId, bundleHash: bundle.bundleHash,
    actionId: "system.advance", params: { amount: 2 },
    definitionHash: `sha256:${"c".repeat(64)}`,
    trigger: { op: "predicate.literal", value: true }, falsePolicy: "defer",
    maxOccurrences: 3, nextOccurrence: 1, status: "pending", createdAt: new Date(), updatedAt: new Date()
  };
  await store.withCommandTransaction({ sessionId, credentialSha256: digest, commandId }, async ({ currentSession }) => {
    const afterVersion = currentSession.version.stateVersion + 1;
    const receipt: SessionCommandReceipt = {
      receiptId: randomUUID(), sessionId, principalId: principal.principalId, commandId,
      fingerprint: "d".repeat(64), actionId: "advance", bundleHash: bundle.bundleHash,
      definitionHash: `sha256:${"e".repeat(64)}`, planHash: `sha256:${"f".repeat(64)}`,
      stateVersionBefore: currentSession.version.stateVersion, stateVersionAfter: afterVersion,
      status: "applied", eventRefs: [],
      publicReceipt: { commandId, actionId: "advance", status: "applied",
        stateVersionBefore: currentSession.version.stateVersion, stateVersionAfter: afterVersion,
        eventRefs: [], planHash: `sha256:${"f".repeat(64)}` },
      result: { formatVersion: "1.0.0", kind: "game-intent", value: { ok: true } },
      audit: { acceptedAt: new Date(), commandKind: "game-intent", triggerActionId: "advance" },
      createdAt: new Date()
    };
    return {
      result: undefined,
      updatedSession: {
        ...currentSession, state: { public: { step: 2 }, secret: { seed: "advanced-hidden-stream" } },
        version: { ...currentSession.version, stateVersion: afterVersion }, updatedAt: new Date()
      },
      receipt,
      scheduleMutations: [{ kind: "register" as const, schedule }]
    };
  });
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 1, paused: true });
  assert.equal((await processPendingSystemSchedules(store as never, sessionId)).attempted, 0);
  assert.equal((store as unknown as { schedules: Map<string, unknown> }).schedules.size, 1);
  const saved = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "current run" });
  assert.equal(validateDebugCheckpointMetadata(saved), true);
  assert.equal(typeof saved.createdAt, "string");
  assert.equal(saved.compatibility, "unavailable");
  assert.equal(saved.sourceStateVersion, 2);
  assert.equal((await store.listDebugCheckpoints({ sessionId, credentialSha256: digest })).length, 1);
  const restored = await store.restoreDebugCheckpoint({
    sessionId, credentialSha256: digest, checkpointId: saved.checkpointId,
    targetImmutableBundle: bundle, targetContentSourceId: "editor-preview", validateCheckpoint: () => {},
    principal: { principalId: randomUUID(), kind: "local-controller", role: "player",
      actorScope: { kind: "all-session-actors" }, credentialSha256: replacementDigest }
  });
  assert.notEqual(restored.session.sessionId, sessionId);
  assert.equal(restored.session.debugPaused, true);
  assert.equal(restored.session.bundleHash, bundle.bundleHash);
  assert.deepEqual(restored.session.state, { public: { step: 2 }, secret: { seed: "advanced-hidden-stream" } });
  assert.deepEqual(restored.session.version, { sessionId: restored.session.sessionId, stateVersion: 0, lastEventSequence: 0 });
  assert.deepEqual(await store.listPendingSystemSchedules(restored.session.sessionId), []);
  await store.setDebugPaused({ sessionId: restored.session.sessionId, credentialSha256: replacementDigest,
    expectedStateVersion: 0, paused: false });
  assert.equal((await store.listPendingSystemSchedules(restored.session.sessionId))[0]?.scheduleId, schedule.scheduleId);
  assert.equal(await store.getCommandReceipt({ sessionId: restored.session.sessionId, credentialSha256: replacementDigest, commandId }), null);
  assert.notEqual(await store.getCommandReceipt({ sessionId, credentialSha256: digest, commandId }), null);
  assert.equal((await store.getSession(sessionId))?.debugPaused, true);
});

test("debug store requires a preview local controller and enforces saved-point bounds", async () => {
  const normal = await fixture(false);
  await assert.rejects(normal.store.readDebugControl({ sessionId: normal.sessionId, credentialSha256: digest }), SessionAuthorizationError);
  const { store, sessionId } = await fixture();
  await assert.rejects(store.readDebugControl({ sessionId, credentialSha256: replacementDigest }));
  await assert.rejects(store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "too soon" }));
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  for (let index = 0; index < 20; index += 1) {
    await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: `point ${index}` });
  }
  const checkpoints = await store.listDebugCheckpoints({ sessionId, credentialSha256: digest });
  assert.equal(validateDebugCheckpointListResponse({ checkpoints }), true);
  assert.equal(validateDebugCheckpointListResponse({ checkpoints: [...checkpoints, checkpoints[0]] }), false);
  await assert.rejects(store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "overflow" }), DebugCheckpointLimitError);
});

test("in-memory inspection visits only the requested snapshot and cannot mutate the saved state", async () => {
  const { store, sessionId } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "other" });
  const target = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "target" });
  let inspected = 0;
  const entries = await store.inspectDebugCheckpoints(
    { sessionId, credentialSha256: digest, checkpointId: target.checkpointId },
    (snapshot) => {
      inspected += 1;
      assert.equal(snapshot.metadata.checkpointId, target.checkpointId);
      snapshot.state.secret.seed = "mutated-copy";
      return target;
    }
  );
  assert.equal(inspected, 1);
  assert.deepEqual(entries, [target]);
  const again = await store.inspectDebugCheckpoints(
    { sessionId, credentialSha256: digest, checkpointId: target.checkpointId },
    (snapshot) => {
      assert.equal(snapshot.state.secret.seed, "hidden-rng-stream");
      return target;
    }
  );
  assert.deepEqual(again, [target]);
  await assert.rejects(store.inspectDebugCheckpoints(
    { sessionId, credentialSha256: replacementDigest }, () => target
  ));
});

test("saving one checkpoint inspects only its new snapshot", async () => {
  const { store, sessionId } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "older" });
  const inspectedIds: Array<string | undefined> = [];
  const originalInspect = store.inspectDebugCheckpoints.bind(store);
  store.inspectDebugCheckpoints = async (input, inspect) => {
    inspectedIds.push(input.checkpointId);
    return originalInspect(input, inspect);
  };
  const service = new SessionService({ sessionStore: store as never });
  const saved = await service.saveDebugCheckpoint(sessionId, accessToken, "new");
  assert.deepEqual(inspectedIds, [saved.checkpointId]);
  assert.equal(saved.compatibility, "unavailable");
});

test("authenticated activity preserves old checkpoints across sessions without revealing foreign points", async () => {
  const { store, sessionId, bundle } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  const older = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "old" });
  const foreign = await store.createSession({
    gameId: "neutral-debug-fixture", contentSourceId: "editor-preview", participants,
    initialState: { public: { step: 1 }, secret: { seed: "other" } }, immutableBundle: bundle,
    principal: { principalId: randomUUID(), kind: "local-controller", role: "player",
      actorScope: { kind: "all-session-actors" }, credentialSha256: replacementDigest }
  });
  const foreignId = foreign.session.sessionId;
  await store.setDebugPaused({ sessionId: foreignId, credentialSha256: replacementDigest,
    expectedStateVersion: 0, paused: true });
  const live = await store.saveDebugCheckpoint({ sessionId: foreignId, credentialSha256: replacementDigest, label: "live" });
  const stored = (store as unknown as {
    debugCheckpoints: Map<string, { metadata: { createdAt: Date } }>;
  }).debugCheckpoints;
  stored.get(older.checkpointId)!.metadata.createdAt = new Date(0);
  await assert.rejects(store.listDebugCheckpoints({ sessionId: foreignId, credentialSha256: digest }));
  assert.equal(stored.has(older.checkpointId), true);
  await store.listDebugCheckpoints({ sessionId: foreignId, credentialSha256: replacementDigest });
  assert.equal(stored.has(older.checkpointId), true);
  assert.equal(stored.has(live.checkpointId), true);
});

test("checkpoint size rejects complete protected payload above 8 MiB", async () => {
  const { store, sessionId } = await fixture();
  await store.withLockedSession(sessionId, async (current) => ({
    result: undefined,
    updatedSession: {
      ...current!,
      state: { ...current!.state, secret: { seed: "x".repeat(8 * 1024 * 1024) } },
      version: { ...current!.version, stateVersion: 1 },
      updatedAt: new Date()
    }
  }));
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 1, paused: true });
  await assert.rejects(store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "large" }), DebugCheckpointTooLargeError);
  assert.deepEqual(await store.listDebugCheckpoints({ sessionId, credentialSha256: digest }), []);
});

test("old checkpoint remains available and can be restored", async () => {
  const { store, sessionId, bundle } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  const saved = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "old" });
  const stored = (store as unknown as {
    debugCheckpoints: Map<string, { metadata: { createdAt: Date } }>;
  }).debugCheckpoints.get(saved.checkpointId)!;
  stored.metadata.createdAt = new Date(0);
  assert.equal((await store.listDebugCheckpoints({ sessionId, credentialSha256: digest })).length, 1);
  const restored = await store.restoreDebugCheckpoint({
    sessionId, credentialSha256: digest, checkpointId: saved.checkpointId,
    targetImmutableBundle: bundle, targetContentSourceId: "editor-preview", validateCheckpoint: () => {},
    principal: { principalId: randomUUID(), kind: "local-controller", role: "player",
      actorScope: { kind: "all-session-actors" }, credentialSha256: replacementDigest }
  });
  assert.equal(restored.session.debugPaused, true);
});

test("compatible restore atomically pins current rules and rejects validation before creating a fork", async () => {
  const { store, sessionId } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  const saved = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "old model" });
  const current = createImmutableBundleContent("neutral-debug-fixture", { changed: true });
  const sessions = (store as unknown as { sessions: Map<string, unknown> }).sessions;
  const count = sessions.size;
  const input = {
    sessionId, credentialSha256: digest, checkpointId: saved.checkpointId,
    targetImmutableBundle: current, targetContentSourceId: "editor-preview",
    principal: { principalId: randomUUID(), kind: "local-controller" as const, role: "player" as const,
      actorScope: { kind: "all-session-actors" as const }, credentialSha256: replacementDigest }
  };
  await assert.rejects(store.restoreDebugCheckpoint({ ...input, validateCheckpoint: () => {
    throw new Error("current model rejects saved state");
  } }), /current model rejects/u);
  assert.equal(sessions.size, count);
  const restored = await store.restoreDebugCheckpoint({ ...input,
    validateCheckpoint: (checkpoint) => assert.equal(checkpoint.bundleHash !== current.bundleHash, true) });
  assert.equal(restored.session.bundleHash, current.bundleHash);
  assert.deepEqual(restored.session.state, { public: { step: 1 }, secret: { seed: "hidden-rng-stream" } });
  assert.equal((await store.getSession(sessionId))?.bundleHash === current.bundleHash, false);
});

test("restore rejects unavailable current preview before creating any fork", async () => {
  const { store, sessionId } = await fixture();
  await store.setDebugPaused({ sessionId, credentialSha256: digest, expectedStateVersion: 0, paused: true });
  const saved = await store.saveDebugCheckpoint({ sessionId, credentialSha256: digest, label: "old rules" });
  const sessions = (store as unknown as { sessions: Map<string, unknown> }).sessions;
  const countBefore = sessions.size;
  const service = new SessionService({ sessionStore: store as never });
  await assert.rejects(service.restoreDebugCheckpoint(sessionId, accessToken, saved.checkpointId),
    /Current preview content is unavailable/u);
  assert.equal(sessions.size, countBefore);
});


test("HTTP debug control enforces authentication, canonical responses and protected checkpoint metadata", async (t) => {
  const { store, sessionId } = await fixture();
  const api = createRuntimeApiServer({ port: 0, sessionStore: store });
  t.after(() => api.close());
  await api.start();
  const url = `http://127.0.0.1:${api.port}/sessions/${sessionId}/debug`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ses_${"B".repeat(43)}` } })).status, 401);
  assert.equal((await fetch(`${url}/pause`, { method: "POST", headers, body: '{"expectedStateVersion":-1}' })).status, 400);
  const pause = await fetch(`${url}/pause`, { method: "POST", headers, body: '{"expectedStateVersion":0}' });
  assert.equal(pause.status, 200);
  const control = await pause.json();
  assert.equal(validateDebugSessionControlResponse(control), true);
  assert.equal(control.paused, true);
  const saved = await fetch(`${url}/checkpoints`, { method: "POST", headers, body: '{"label":"Before choice"}' });
  assert.equal(saved.status, 201);
  const metadata = await saved.json();
  assert.equal(validateDebugCheckpointMetadata(metadata), true);
  assert.equal(JSON.stringify(metadata).includes("hidden-rng-stream"), false);
  const listed = await fetch(`${url}/checkpoints`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { checkpoints: [metadata] });
  // An unavailable preview source must not expose or fork the hidden state.
  const restore = await fetch(`${url}/checkpoints/${metadata.checkpointId}/restore`, { method: "POST", headers });
  assert.equal(restore.status, 409);
  assert.equal(JSON.stringify(await restore.json()).includes("hidden-rng-stream"), false);
  assert.equal((await fetch(`${url}/checkpoints/${metadata.checkpointId}`, { method: "DELETE", headers })).status, 204);
  assert.deepEqual(await (await fetch(`${url}/checkpoints`, { headers })).json(), { checkpoints: [] });
});
