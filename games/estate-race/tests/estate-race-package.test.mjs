/**
 * End-to-end runtime proof for the first Estate Race gameplay slice.
 *
 * The replay injects a bounded server-random sampler through Runtime's internal
 * test seam. No test-only game branch exists: the same manifest actions,
 * participant guards, reference validation and transfer handler are used by
 * the player UI.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import {
  getPublishedPlayerWebPluginBundleSource,
  loadPlayerFacingContent
} from "../../../services/runtime-api/src/modules/content/contentService.ts";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { projectSessionActionAvailability } from "../../../services/runtime-api/src/modules/runtime/actionAvailability.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import { initializeTurnBasedSessionState } from "../../../services/runtime-api/src/modules/session/turnBasedSessionState.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testCredentialSha256 = "b".repeat(64);
// This package proof covers gameplay semantics. Admission limits are a
// platform boundary with their own focused HTTP/controller regression suite.
const testAdmissionController = {
  async assertNewCommandAdmitted() {}
};
let nextCommandSequence = 1;

const createTestCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(nextCommandSequence, 12);
  nextCommandSequence += 1;
  return `cli_${bytes.toString("base64url")}`;
};

const loadManifest = async () => validateGameManifest(
  JSON.parse(await readFile(path.join(packageRoot, "game.manifest.json"), "utf8"))
);

const createReplay = async (mutateState, {
  participantCount = 2,
  samples = [0, 3, 0, 3],
  actorScope = { kind: "all-session-actors" }
} = {}) => {
  const manifest = await loadManifest();
  const initialState = initializeTurnBasedSessionState(manifest, structuredClone(manifest.state), {
    participantCount
  });
  mutateState?.(initialState);
  const immutableBundle = createImmutableBundleContent(manifest.meta.id, manifest);
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "player",
    initialState,
    immutableBundle,
    principal: {
      principalId: "estate-race-test-controller",
      kind: "local-controller",
      role: "player",
      actorScope,
      credentialSha256: testCredentialSha256
    }
  });
  let randomCallCount = 0;
  return {
    manifest,
    bundle: {
      gameId: manifest.meta.id,
      bundleHash: immutableBundle.bundleHash,
      manifest
    },
    store,
    session: created.session,
    random: {
      sampleRange: () => {
        const sample = samples[randomCallCount];
        assert.notEqual(sample, undefined, "the bounded replay must provide every server sample");
        randomCallCount += 1;
        return sample;
      }
    },
    get randomCallCount() {
      return randomCallCount;
    }
  };
};

/** The server, not the caller, resolves the active hot-seat participant. */
const act = async (replay, actionId, params = {}, command = {}) => {
  const current = await replay.store.getSession(replay.session.sessionId);
  return dispatchRuntimeAction({
    sessionStore: replay.store,
    credentialSha256: testCredentialSha256,
    admissionController: testAdmissionController,
    random: replay.random,
    input: {
      sessionId: replay.session.sessionId,
      expectedStateVersion: command.expectedStateVersion ?? current.version.stateVersion,
      commandId: command.commandId ?? createTestCommandId(),
      actionId,
      params
    }
  });
};

/** A rules rejection is persisted and returned as a terminal receipt. */
const assertRejectedAction = async (dispatch, messagePattern) => {
  const outcome = await dispatch;
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.receipt.status, "rejected");
  assert.match(
    `${outcome.result.error?.code ?? ""} ${outcome.result.error?.message ?? ""}`,
    messagePattern
  );
};

test("bounded sampler replay completes first purchase and first rent", async () => {
  const replay = await createReplay();

  await act(replay, "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 4]);
  assert.equal(current.state.players.p1.metrics.position, 5);
  assert.equal(current.state.public.turn.phase, "acquire");

  await act(replay, "property.buy.cell-05", { cellId: "cell-05" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1040);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId, "p1");

  const finishedFirstTurn = await act(replay, "turn.finish");
  assert.equal(
    finishedFirstTurn.actorPlayerId,
    "p2",
    "the successful response must project the actor selected by the explicit turn plan"
  );
  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 4]);
  assert.equal(current.state.players.p2.metrics.position, 5);
  assert.equal(current.state.public.turn.phase, "rent");

  await act(replay, "property.rent.cell-05", { cellId: "cell-05" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1064);
  assert.equal(current.state.players.p2.metrics.cash, 1176);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "purchase"));
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "rent"));
});

test("compiled gameplay contains no legacy actor, resource or turn shortcuts", async () => {
  const manifest = await loadManifest();
  const serializedManifest = JSON.stringify(manifest);
  const turnSteps = manifest.mechanics.plans["turn.finish"].transaction.steps;

  assert.ok(turnSteps.some((step) => step.op === "core.sequence.next"));
  assert.doesNotMatch(serializedManifest, /"op":"turn\.advance"/u);
  assert.doesNotMatch(serializedManifest, /"kind":"player-metric"/u);
  assert.doesNotMatch(serializedManifest, /"op":"value\.param","name":"actor"/u);
});

test("server-selected actor and insufficient purchase preserve the trust and atomicity boundaries", async () => {
  const actorReplay = await createReplay();
  await act(actorReplay, "turn.roll");
  const actorState = await actorReplay.store.getSession(actorReplay.session.sessionId);
  assert.equal(actorState.state.players.p1.metrics.position, 5);
  assert.equal(actorState.state.players.p2.metrics.position, 0);

  const poorReplay = await createReplay((state) => {
    state.players.p1.metrics.cash = 100;
  });
  await act(poorReplay, "turn.roll");
  const beforeBuy = structuredClone(await poorReplay.store.getSession(poorReplay.session.sessionId));
  await assertRejectedAction(
    act(poorReplay, "property.buy.cell-05", { cellId: "cell-05" }),
    /MECHANICS_RESOURCE_INSUFFICIENT/
  );
  const afterBuy = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.deepEqual(afterBuy.state, beforeBuy.state);
  assert.equal(afterBuy.version.stateVersion, beforeBuy.version.stateVersion);
});

test("a double survives landing resolution and exact retry does not roll again", async () => {
  const replay = await createReplay(undefined, { samples: [0, 0] });
  const before = await replay.store.getSession(replay.session.sessionId);
  const commandId = createTestCommandId();

  const first = await act(replay, "turn.roll", {}, {
    commandId,
    expectedStateVersion: before.version.stateVersion
  });
  assert.equal(first.result.ok, true);
  assert.equal(replay.randomCallCount, 2);

  const retried = await act(replay, "turn.roll", {}, {
    commandId,
    expectedStateVersion: before.version.stateVersion
  });
  assert.equal(replay.randomCallCount, 2, "a receipt retry must not consume fresh server randomness");
  assert.deepEqual(retried.receipt, first.receipt);

  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.board.consecutiveDoubles, 1);
  assert.equal(current.state.public.board.extraRollPending, true);
  assert.equal(current.state.public.turn.phase, "acquire");

  const beforeWrongPhase = structuredClone(current);
  await assertRejectedAction(act(replay, "turn.roll"), /ACTION_PRECONDITION_FAILED/);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state, beforeWrongPhase.state);
  assert.equal(current.version.stateVersion, beforeWrongPhase.version.stateVersion);

  await act(replay, "property.buy.cell-02", { cellId: "cell-02" });
  const continued = await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(continued.actorPlayerId, "p1");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.turnNumber, 1);
  assert.equal(current.state.public.turn.phase, "roll");
  assert.equal(current.state.public.board.extraRollPending, false);
  assert.equal(current.state.public.board.consecutiveDoubles, 1);
});

test("rent resolution also preserves the pending extra roll", async () => {
  const replay = await createReplay((state) => {
    state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId = "p2";
  }, { samples: [0, 0] });

  await act(replay, "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "rent");
  assert.equal(current.state.public.board.extraRollPending, true);

  await act(replay, "property.rent.cell-02", { cellId: "cell-02" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.extraRollPending, true);

  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.turnNumber, 1);
  assert.equal(current.state.public.turn.phase, "roll");
});

test("a normal roll resets the double chain and passes the turn after landing", async () => {
  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 30;
  }, { samples: [0, 0, 0, 1] });

  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.board.consecutiveDoubles, 1);

  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 2]);
  assert.equal(current.state.public.board.consecutiveDoubles, 0);
  assert.equal(current.state.public.board.extraRollPending, false);
  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.public.turn.turnNumber, 2);
});

test("the third consecutive double jails the actor and blocks a later roll before randomness", async () => {
  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 33;
  }, { samples: [0, 0, 1, 1, 2, 2, 0, 1] });

  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 39);
  assert.equal(current.state.public.board.consecutiveDoubles, 2);

  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [3, 3]);
  assert.equal(current.state.players.p1.metrics.position, 10);
  assert.equal(current.state.players.p1.flags.inJail, true);
  assert.equal(current.state.players.p1.metrics.cash, 1200);
  assert.equal(current.state.public.board.consecutiveDoubles, 0);
  assert.equal(current.state.public.board.extraRollPending, false);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "finish",
    label: "Завершить ход",
    actionId: "turn.finish"
  }]);

  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");

  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 2]);
  assert.equal(current.state.public.turn.phase, "finish");
  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "roll");

  const availability = projectSessionActionAvailability(current, replay.bundle, {
    actorPlayerId: "p1",
    sessionRole: "player"
  });
  assert.deepEqual(availability.find((entry) => entry.actionId === "turn.roll"), {
    actionId: "turn.roll",
    status: "unavailable",
    reasonCode: "state_condition_failed",
    basisStateVersion: current.version.stateVersion
  });

  const beforeBlockedRoll = structuredClone(current);
  const randomCallsBeforeBlockedRoll = replay.randomCallCount;
  await assertRejectedAction(act(replay, "turn.roll"), /ACTION_PRECONDITION_FAILED/);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(replay.randomCallCount, randomCallsBeforeBlockedRoll);
  assert.deepEqual(current.state, beforeBlockedRoll.state);
  assert.equal(current.version.stateVersion, beforeBlockedRoll.version.stateVersion);
});

test("visiting the jail cell does not mark the participant as imprisoned", async () => {
  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 8;
  }, { samples: [0, 0] });

  await act(replay, "turn.roll");
  const current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 10);
  assert.equal(current.state.players.p1.flags.inJail, false);
});

test("a principal scoped to another actor cannot execute the active turn", async () => {
  const replay = await createReplay(undefined, {
    actorScope: { kind: "listed-actors", actorIds: ["p2"] }
  });
  const before = structuredClone(await replay.store.getSession(replay.session.sessionId));

  await assert.rejects(act(replay, "turn.roll"), /not allowed to perform this operation/u);
  const after = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.equal(replay.randomCallCount, 0);
});

test("player-facing repository publishes the web screen and immutable field plugin", async () => {
  const { content } = await loadPlayerFacingContent({ gameId: "estate-race" });
  assert.equal(content.ui.id, "estate-race.ui.web");
  assert.equal(content.ui.entryPoint, "table");
  assert.equal(content.pluginBundles.length, 1);
  const plugin = content.pluginBundles[0];
  assert.equal(plugin.pluginId, "estate-race-player");

  const source = await getPublishedPlayerWebPluginBundleSource({
    gameId: plugin.gameId,
    pluginId: plugin.pluginId,
    contentHash: plugin.contentHash
  });
  assert.match(source, /estate-race/);
  assert.doesNotMatch(source, /state\.secret/u);
});
