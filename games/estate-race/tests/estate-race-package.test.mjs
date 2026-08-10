/**
 * End-to-end runtime proof for the completed Estate Race S1 gameplay slice.
 *
 * The replay injects a bounded server-random sampler through Runtime's internal
 * test seam. No test-only game branch exists: the same manifest actions,
 * participant guards, reference validation and transfer handler are used by
 * the player UI.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
const require = createRequire(import.meta.url);
const { compileAuthoringText } = require("../../../scripts/manifest-tools/authoring-compiler.cjs");
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

let manifestPromise;
const loadManifest = async () => manifestPromise ??= (async () => {
  const sourceFile = path.join(packageRoot, "authoring", "game.authoring.json");
  const compiled = compileAuthoringText({
    kind: "game",
    gameId: "estate-race",
    sourceFile,
    outputFile: path.join(packageRoot, "game.manifest.json"),
    sourceMapFile: path.join(packageRoot, "game.manifest.source-map.json")
  }, await readFile(sourceFile, "utf8"));
  return validateGameManifest(compiled.manifest);
})();

const createReplay = async (mutateState, {
  participantCount = 2,
  samples = [0, 3, 0, 3],
  actorScope = { kind: "all-session-actors" },
  autoSetup = true,
  setupSamples = Array.from(
    { length: participantCount - 1 },
    (_, index) => participantCount - index - 1
  )
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
  const randomSamples = autoSetup ? [...setupSamples, ...samples] : samples;
  let totalRandomCallCount = 0;
  let randomCallBaseline = 0;
  const replay = {
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
        const sample = randomSamples[totalRandomCallCount];
        assert.notEqual(sample, undefined, "the bounded replay must provide every server sample");
        totalRandomCallCount += 1;
        return sample;
      }
    },
    get randomCallCount() {
      return totalRandomCallCount - randomCallBaseline;
    },
    get totalRandomCallCount() {
      return totalRandomCallCount;
    }
  };
  if (autoSetup) {
    const setup = await act(replay, "session.setup.finalize");
    assert.equal(setup.result.ok, true, JSON.stringify(setup.result));
    randomCallBaseline = totalRandomCallCount;
  }
  return replay;
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

const createPhaseReplay = async (mutateState, {
  participantCount = 2,
  phase = "acquire",
  actorScope = { kind: "all-session-actors" }
} = {}) => createReplay((state) => {
  const participantIds = Object.keys(state.players);
  state.public.setupComplete = true;
  state.public.turn.order = participantIds;
  state.public.turn.activePlayerId = participantIds[0];
  state.public.turn.phase = phase;
  state.public.board.availableActions = [];
  mutateState?.(state);
}, { participantCount, actorScope, autoSetup: false, samples: [] });

test("setup randomizes the exact 2/6 participant set once and is receipt-idempotent", async () => {
  for (const participantCount of [2, 6]) {
    const replay = await createReplay(undefined, {
      participantCount,
      autoSetup: false,
      samples: Array.from({ length: participantCount - 1 }, () => 0)
    });
    const before = await replay.store.getSession(replay.session.sessionId);
    const participantIds = Object.keys(before.state.players);
    assert.equal(before.state.public.turn.phase, "setup");
    assert.equal(before.state.public.setupComplete, false);
    assert.deepEqual(before.state.public.board.availableActions, [{
      id: "setup-finalize",
      label: "Определить порядок",
      actionId: "session.setup.finalize"
    }]);

    const commandId = createTestCommandId();
    const first = await act(replay, "session.setup.finalize", {}, {
      commandId,
      expectedStateVersion: before.version.stateVersion
    });
    assert.equal(first.result.ok, true, JSON.stringify(first.result));
    assert.equal(replay.totalRandomCallCount, participantCount - 1);

    const configured = await replay.store.getSession(replay.session.sessionId);
    assert.equal(configured.state.public.setupComplete, true);
    assert.equal(configured.state.public.turn.phase, "roll");
    assert.equal(configured.state.public.turn.order.length, participantCount);
    assert.deepEqual([...configured.state.public.turn.order].sort(), [...participantIds].sort());
    assert.equal(
      configured.state.public.turn.activePlayerId,
      configured.state.public.turn.order[0]
    );
    assert.deepEqual(configured.state.public.board.availableActions, [{
      id: "roll",
      label: "Бросить кости",
      actionId: "turn.roll"
    }]);

    const retried = await act(replay, "session.setup.finalize", {}, {
      commandId,
      expectedStateVersion: before.version.stateVersion
    });
    assert.deepEqual(retried.receipt, first.receipt);
    assert.equal(replay.totalRandomCallCount, participantCount - 1);

    const beforeFreshSetup = structuredClone(configured);
    await assertRejectedAction(
      act(replay, "session.setup.finalize"),
      /SESSION_SETUP_ALREADY_FINALIZED/
    );
    const afterFreshSetup = await replay.store.getSession(replay.session.sessionId);
    assert.equal(replay.totalRandomCallCount, participantCount - 1);
    assert.deepEqual(afterFreshSetup.state, beforeFreshSetup.state);
    assert.equal(afterFreshSetup.version.stateVersion, beforeFreshSetup.version.stateVersion);
  }
});

test("bounded sampler replay completes first purchase and first rent", async () => {
  const replay = await createReplay(undefined, { setupSamples: [0] });

  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.deepEqual(current.state.public.turn.order, ["p2", "p1"]);
  assert.equal(current.state.players.p1.metrics.position, 0);
  assert.equal(current.state.players.p2.metrics.position, 0);

  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 4]);
  assert.equal(current.state.players.p1.metrics.position, 0);
  assert.equal(current.state.players.p2.metrics.position, 5);
  assert.equal(current.state.public.turn.phase, "acquire");
  assert.deepEqual(current.state.public.board.availableActions.map((item) => item.actionId), [
    "property.buy",
    "property.decline"
  ]);

  await act(replay, "property.buy");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p2.metrics.cash, 1040);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId, "p2");

  const finishedFirstTurn = await act(replay, "turn.finish");
  assert.equal(
    finishedFirstTurn.actorPlayerId,
    "p1",
    "the successful response must project the actor selected by the explicit turn plan"
  );
  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 4]);
  assert.equal(current.state.players.p2.metrics.position, 5);
  assert.equal(current.state.public.turn.phase, "rent");

  await act(replay, "property.rent");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1176);
  assert.equal(current.state.players.p2.metrics.cash, 1064);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "purchase"));
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "rent"));
});

test("compiled gameplay contains no legacy actor, resource or turn shortcuts", async () => {
  const manifest = await loadManifest();
  const serializedManifest = JSON.stringify(manifest);
  const turnSteps = manifest.mechanics.plans["turn.finish"].transaction.steps;
  const setupSteps = manifest.mechanics.plans["session.setup.finalize"].transaction.steps;
  const rollSteps = manifest.mechanics.plans["turn.roll"].transaction.steps;
  const taxSteps = manifest.mechanics.plans["tax.pay"].transaction.steps;
  const landingSelection = rollSteps.find((step) => step.id === "s006-landing-cell");
  const taxTransfer = taxSteps.find((step) => step.op === "core.resource.transfer");

  assert.ok(turnSteps.some((step) => step.op === "core.sequence.next"));
  assert.ok(setupSteps.some((step) => step.op === "core.entities.select"));
  assert.ok(setupSteps.some((step) => step.op === "core.entities.order"));
  assert.ok(setupSteps.every((step) => step.op !== "core.entities.each"));
  assert.equal(landingSelection.op, "core.entities.select");
  assert.equal(landingSelection.selector.collection, "boardCells");
  assert.deepEqual(landingSelection.selector.attributes.index, {
    op: "value.state",
    ref: { endpoint: "actor.metrics.position" }
  });
  assert.equal(taxTransfer.to.kind, "bank");
  assert.equal(taxTransfer.amount.op, "value.entity");
  assert.equal(taxTransfer.amount.field, "taxAmount");
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
    act(poorReplay, "property.buy"),
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

  await act(replay, "property.buy");
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

  await act(replay, "property.rent");
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
    state.players.p1.metrics.position = 8;
  }, { samples: [0, 0, 3, 5] });

  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.board.consecutiveDoubles, 1);

  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [4, 6]);
  assert.equal(current.state.public.board.consecutiveDoubles, 0);
  assert.equal(current.state.public.board.extraRollPending, false);
  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.public.turn.turnNumber, 2);
});

test("the third consecutive double jails the actor and blocks a later roll before randomness", async () => {
  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 8;
  }, { samples: [0, 0, 4, 4, 2, 2, 3, 5] });

  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  await act(replay, "turn.roll");
  await act(replay, "turn.finish");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 20);
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
  assert.deepEqual(current.state.public.board.lastRoll.values, [4, 6]);
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
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.extraRollPending, true);
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "finish",
    label: "Завершить ход",
    actionId: "turn.finish"
  }]);
});

test("start reward and a second double tax are resolved from the selected cell", async () => {
  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 36;
  }, { samples: [1, 1, 1, 1] });

  await act(replay, "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 0);
  assert.equal(current.state.players.p1.metrics.cash, 1320);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.consecutiveDoubles, 1);
  assert.equal(current.state.public.board.extraRollPending, true);

  const continued = await act(replay, "turn.finish");
  assert.equal(continued.actorPlayerId, "p1");
  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 4);
  assert.equal(current.state.public.turn.phase, "tax");
  assert.equal(current.state.public.board.consecutiveDoubles, 2);
  assert.equal(current.state.public.board.extraRollPending, true);
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "pay-tax",
    label: "Оплатить налог",
    actionId: "tax.pay"
  }]);

  await act(replay, "tax.pay");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1250);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.extraRollPending, true);
});

test("the second authored tax amount transfers atomically and insufficient cash keeps the tax state", async () => {
  const paidReplay = await createReplay((state) => {
    state.players.p1.metrics.position = 32;
  }, { samples: [2, 2] });

  await act(paidReplay, "turn.roll");
  let current = await paidReplay.store.getSession(paidReplay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 38);
  assert.equal(current.state.public.turn.phase, "tax");
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "pay-tax",
    label: "Оплатить налог",
    actionId: "tax.pay"
  }]);
  await act(paidReplay, "tax.pay");
  current = await paidReplay.store.getSession(paidReplay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1090);
  assert.equal(current.state.public.turn.phase, "finish");

  const poorReplay = await createReplay((state) => {
    state.players.p1.metrics.position = 32;
    state.players.p1.metrics.cash = 109;
  }, { samples: [2, 2] });
  await act(poorReplay, "turn.roll");
  const beforeTax = structuredClone(await poorReplay.store.getSession(poorReplay.session.sessionId));
  await assertRejectedAction(act(poorReplay, "tax.pay"), /MECHANICS_RESOURCE_INSUFFICIENT/);
  const afterTax = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.deepEqual(afterTax.state, beforeTax.state);
  assert.equal(afterTax.version.stateVersion, beforeTax.version.stateVersion);
  assert.equal(afterTax.state.public.turn.phase, "tax");
  assert.equal(afterTax.state.players.p1.metrics.cash, 109);
});

test("neutral landing finishes while go-to-jail cancels a pending extra roll", async () => {
  const neutralReplay = await createReplay((state) => {
    state.players.p1.metrics.position = 17;
  }, { samples: [0, 1] });
  await act(neutralReplay, "turn.roll");
  let current = await neutralReplay.store.getSession(neutralReplay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 20);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.extraRollPending, false);

  const jailReplay = await createReplay((state) => {
    state.players.p1.metrics.position = 28;
  }, { samples: [0, 0] });
  await act(jailReplay, "turn.roll");
  current = await jailReplay.store.getSession(jailReplay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 10);
  assert.equal(current.state.players.p1.flags.inJail, true);
  assert.equal(current.state.public.board.consecutiveDoubles, 0);
  assert.equal(current.state.public.board.extraRollPending, false);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "finish",
    label: "Завершить ход",
    actionId: "turn.finish"
  }]);
});

test("only the still-deferred event and fund cells enter an explicit blocked phase", async () => {
  const manifest = await loadManifest();
  const blockedKinds = new Set(["event", "fund"]);
  const blockedCells = Object.values(manifest.state.public.objects.boardCells)
    .filter((cell) => blockedKinds.has(cell.attributes.kind));

  assert.equal(blockedCells.length, 6);
  for (const [cellIndex, cell] of blockedCells.entries()) {
    const targetIndex = cell.attributes.index;
    const replay = await createReplay((state) => {
      state.players.p1.metrics.position = (targetIndex + 37) % 40;
    }, { samples: [0, 1] });
    await act(replay, "turn.roll");
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.players.p1.metrics.position, targetIndex, cell.attributes.id);
    assert.equal(current.state.public.turn.activePlayerId, "p1", cell.attributes.id);
    assert.equal(current.state.public.turn.phase, "blocked", cell.attributes.id);
    assert.deepEqual(current.state.public.board.availableActions, [], cell.attributes.id);
    if (cellIndex === 0) {
      const beforeFinish = structuredClone(current);
      await assertRejectedAction(act(replay, "turn.finish"), /ACTION_PRECONDITION_FAILED/);
      const afterFinish = await replay.store.getSession(replay.session.sessionId);
      assert.deepEqual(afterFinish.state, beforeFinish.state);
      assert.equal(afterFinish.version.stateVersion, beforeFinish.version.stateVersion);
    }
  }
});

test("two-player auction rotates, rejects invalid bids, pays p2 once, and resumes the landing actor", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.public.board.extraRollPending = true;
  });

  await act(replay, "property.decline");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "auction");
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.deepEqual(current.state.public.auction, {
    resumePlayerId: "p1",
    cellId: "cell-01",
    currentBid: 0,
    minimumIncrement: 10,
    leaderPlayerId: ""
  });
  assert.deepEqual(Object.fromEntries(Object.entries(current.state.players)
    .map(([id, player]) => [id, player.objects.bidderStatus])), {
    p1: "eligible",
    p2: "eligible"
  });

  const beforeInvalid = structuredClone(current);
  await assertRejectedAction(act(replay, "property.auction.bid", { amount: 9 }), /ACTION_PRECONDITION_FAILED/);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state, beforeInvalid.state);
  assert.equal(current.version.stateVersion, beforeInvalid.version.stateVersion);

  await assert.rejects(
    act(replay, "property.auction.bid", { amount: 10.5 }),
    /params failed schema validation: \/amount must be integer/u
  );
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state, beforeInvalid.state);

  const bidCommandId = createTestCommandId();
  const firstBid = await act(replay, "property.auction.bid", { amount: 40 }, {
    commandId: bidCommandId,
    expectedStateVersion: current.version.stateVersion
  });
  const retriedBid = await act(replay, "property.auction.bid", { amount: 40 }, {
    commandId: bidCommandId,
    expectedStateVersion: current.version.stateVersion
  });
  assert.deepEqual(retriedBid.receipt, firstBid.receipt);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.auction.leaderPlayerId, "p2");
  assert.equal(current.state.public.auction.currentBid, 40);
  assert.equal(current.state.players.p2.objects.bidderStatus, "leading");

  const beforePass = structuredClone(current);
  const passCommandId = createTestCommandId();
  const firstPass = await act(replay, "property.auction.pass", {}, {
    commandId: passCommandId,
    expectedStateVersion: beforePass.version.stateVersion
  });
  const retriedPass = await act(replay, "property.auction.pass", {}, {
    commandId: passCommandId,
    expectedStateVersion: beforePass.version.stateVersion
  });
  assert.deepEqual(retriedPass.receipt, firstPass.receipt);

  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p2.metrics.cash, 1160);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId, "p2");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.board.extraRollPending, true);
  assert.deepEqual(current.state.public.auction, {
    resumePlayerId: "",
    cellId: "",
    currentBid: 0,
    minimumIncrement: 10,
    leaderPlayerId: ""
  });
  assert.ok(Object.values(current.state.players).every((player) => player.objects.bidderStatus === "idle"));

  await act(replay, "turn.finish");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "roll");
});

test("outbidding restores the previous leader to the preserved turn rotation", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 28;
  });
  await act(replay, "property.decline");
  await act(replay, "property.auction.bid", { amount: 20 });
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.players.p2.objects.bidderStatus, "leading");

  await act(replay, "property.auction.bid", { amount: 35 });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.players.p1.objects.bidderStatus, "leading");
  assert.equal(current.state.players.p2.objects.bidderStatus, "eligible");

  await act(replay, "property.auction.pass");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.players.p1.metrics.cash, 1165);
  assert.equal(current.state.players.p2.metrics.cash, 1200);
  assert.equal(current.state.public.objects.boardCells["cell-28"].attributes.ownerPlayerId, "p1");
});

test("six-player winning auction preserves the long order through bids, passes, and outbids", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 39;
  }, { participantCount: 6 });
  const expectedOrder = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const expectActive = async (playerId) => {
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.deepEqual(current.state.public.turn.order, expectedOrder);
    assert.equal(current.state.public.turn.activePlayerId, playerId);
    assert.equal(current.state.public.turn.phase, "auction");
    return current;
  };

  await act(replay, "property.decline");
  await expectActive("p2");

  await act(replay, "property.auction.bid", { amount: 20 });
  await expectActive("p3");
  await act(replay, "property.auction.pass");
  await expectActive("p4");

  await act(replay, "property.auction.bid", { amount: 40 });
  let current = await expectActive("p5");
  assert.equal(current.state.players.p2.objects.bidderStatus, "eligible");
  assert.equal(current.state.players.p4.objects.bidderStatus, "leading");
  await act(replay, "property.auction.pass");
  await expectActive("p6");

  await act(replay, "property.auction.bid", { amount: 60 });
  current = await expectActive("p1");
  assert.equal(current.state.players.p4.objects.bidderStatus, "eligible");
  assert.equal(current.state.players.p6.objects.bidderStatus, "leading");
  await act(replay, "property.auction.pass");
  await expectActive("p2");

  await act(replay, "property.auction.bid", { amount: 80 });
  current = await expectActive("p4");
  assert.equal(current.state.players.p2.objects.bidderStatus, "leading");
  assert.equal(current.state.players.p6.objects.bidderStatus, "eligible");
  await act(replay, "property.auction.pass");
  await expectActive("p6");
  await act(replay, "property.auction.pass");

  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.turn.order, expectedOrder);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.players.p2.metrics.cash, 1120);
  assert.ok(["p1", "p3", "p4", "p5", "p6"].every(
    (playerId) => current.state.players[playerId].metrics.cash === 1200
  ));
  assert.equal(current.state.public.objects.boardCells["cell-39"].attributes.ownerPlayerId, "p2");
  assert.deepEqual(current.state.public.auction, {
    resumePlayerId: "",
    cellId: "",
    currentBid: 0,
    minimumIncrement: 10,
    leaderPlayerId: ""
  });
  assert.ok(Object.values(current.state.players).every(
    (player) => player.objects.bidderStatus === "idle"
  ));
});

test("all-pass auctions preserve the bank for the exact 2/6 participants and normal turns advance", async () => {
  for (const participantCount of [2, 6]) {
    const replay = await createPhaseReplay((state) => {
      state.players.p1.metrics.position = 6;
      state.public.board.extraRollPending = false;
    }, { participantCount });
    const startingCash = Object.fromEntries(Object.entries((await replay.store.getSession(replay.session.sessionId)).state.players)
      .map(([id, player]) => [id, player.metrics.cash]));

    await act(replay, "property.decline");
    for (let index = 0; index < participantCount; index += 1) {
      const beforePass = await replay.store.getSession(replay.session.sessionId);
      assert.equal(beforePass.state.public.turn.phase, "auction");
      await act(replay, "property.auction.pass");
    }

    let current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.turn.phase, "finish");
    assert.equal(current.state.public.turn.activePlayerId, "p1");
    assert.equal(current.state.public.objects.boardCells["cell-06"].attributes.ownerPlayerId, undefined);
    assert.deepEqual(Object.fromEntries(Object.entries(current.state.players)
      .map(([id, player]) => [id, player.metrics.cash])), startingCash);
    assert.ok(Object.values(current.state.players).every((player) => player.objects.bidderStatus === "idle"));

    await act(replay, "turn.finish");
    current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.turn.activePlayerId, "p2");
  }
});

test("auction rejects untrusted actor, bad funds, and stale ownership without partial state", async () => {
  const poorReplay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 12;
    state.players.p2.metrics.cash = 9;
  });
  await act(poorReplay, "property.decline");
  let before = structuredClone(await poorReplay.store.getSession(poorReplay.session.sessionId));
  await assertRejectedAction(act(poorReplay, "property.auction.bid", { amount: 10 }), /ACTION_PRECONDITION_FAILED/);
  let after = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.version.stateVersion, before.version.stateVersion);

  const scopedReplay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 12;
  }, { actorScope: { kind: "listed-actors", actorIds: ["p1"] } });
  await act(scopedReplay, "property.decline");
  before = structuredClone(await scopedReplay.store.getSession(scopedReplay.session.sessionId));
  await assert.rejects(act(scopedReplay, "property.auction.bid", { amount: 10 }), /not allowed to perform this operation/u);
  after = await scopedReplay.store.getSession(scopedReplay.session.sessionId);
  assert.deepEqual(after.state, before.state);

  const staleReplay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 12;
    state.public.turn.phase = "auction";
    state.public.turn.activePlayerId = "p2";
    state.public.auction = {
      resumePlayerId: "p1", cellId: "cell-12", currentBid: 0,
      minimumIncrement: 10, leaderPlayerId: ""
    };
    state.players.p1.objects.bidderStatus = "eligible";
    state.players.p2.objects.bidderStatus = "eligible";
    state.public.objects.boardCells["cell-12"].attributes.ownerPlayerId = "p1";
  }, { phase: "auction" });
  before = structuredClone(await staleReplay.store.getSession(staleReplay.session.sessionId));
  await assertRejectedAction(act(staleReplay, "property.auction.pass"), /AUCTION_OBJECT_CHANGED/);
  after = await staleReplay.store.getSession(staleReplay.session.sessionId);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
});

test("estate, transit, and utility rent use authoritative ownership and saved landing roll", async () => {
  const rentCase = async ({ cellId, ownerIds, expectedRent, lastRollTotal = 7 }) => {
    const replay = await createPhaseReplay((state) => {
      const cell = state.public.objects.boardCells[cellId];
      state.players.p1.metrics.position = cell.attributes.index;
      state.public.turn.phase = "rent";
      state.public.board.lastRoll = { values: [3, 4], total: lastRollTotal, isDouble: false };
      for (const ownerId of ownerIds) {
        state.public.objects.boardCells[ownerId].attributes.ownerPlayerId = "p2";
      }
    }, { phase: "rent" });
    await act(replay, "property.rent");
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.players.p1.metrics.cash, 1200 - expectedRent, cellId);
    assert.equal(current.state.players.p2.metrics.cash, 1200 + expectedRent, cellId);
    assert.equal(current.state.public.turn.phase, "finish", cellId);
  };

  await rentCase({ cellId: "cell-01", ownerIds: ["cell-01"], expectedRent: 8 });
  await rentCase({ cellId: "cell-01", ownerIds: ["cell-01", "cell-02"], expectedRent: 16 });
  const transitIds = ["cell-06", "cell-15", "cell-25", "cell-35"];
  for (const [index, expectedRent] of [26, 52, 104, 208].entries()) {
    await rentCase({ cellId: "cell-06", ownerIds: transitIds.slice(0, index + 1), expectedRent });
  }
  await rentCase({ cellId: "cell-12", ownerIds: ["cell-12"], expectedRent: 35 });
  await rentCase({ cellId: "cell-12", ownerIds: ["cell-12", "cell-28"], expectedRent: 84 });

  const staleReplay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.public.turn.phase = "rent";
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
  }, { phase: "rent" });
  const before = structuredClone(await staleReplay.store.getSession(staleReplay.session.sessionId));
  await assertRejectedAction(act(staleReplay, "property.rent"), /ACTION_PRECONDITION_FAILED/);
  const after = await staleReplay.store.getSession(staleReplay.session.sessionId);
  assert.deepEqual(after.state, before.state);
});

test("all 28 purchasable cells share generic actions and an own landing requires no payment", async () => {
  const manifest = await loadManifest();
  const purchasable = Object.values(manifest.state.public.objects.boardCells)
    .filter((cell) => ["estate", "transit", "utility"].includes(cell.attributes.kind));
  assert.equal(purchasable.length, 28);
  assert.deepEqual(Object.keys(manifest.actions).filter((id) => id.startsWith("property.")), [
    "property.buy",
    "property.decline",
    "property.rent",
    "property.auction.bid",
    "property.auction.pass"
  ]);
  assert.ok(purchasable.every((cell) => cell.attributes.buildings === undefined));

  const replay = await createReplay((state) => {
    state.players.p1.metrics.position = 25;
    state.public.objects.boardCells["cell-28"].attributes.ownerPlayerId = "p1";
  }, { samples: [0, 1] });
  await act(replay, "turn.roll");
  const current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 28);
  assert.equal(current.state.players.p1.metrics.cash, 1200);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.deepEqual(current.state.public.board.availableActions, [{
    id: "finish",
    label: "Завершить ход",
    actionId: "turn.finish"
  }]);
});

test("a principal scoped to another actor cannot execute the active turn", async () => {
  const replay = await createReplay((state) => {
    state.public.setupComplete = true;
    state.public.turn.phase = "roll";
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
  }, {
    actorScope: { kind: "listed-actors", actorIds: ["p2"] },
    autoSetup: false
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
