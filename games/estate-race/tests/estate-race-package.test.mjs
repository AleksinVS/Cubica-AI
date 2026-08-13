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
import { buildPlayerSessionProjection } from "../../../services/runtime-api/src/modules/session/playerSessionProjection.ts";
import { materializeLocalSessionParticipants } from "../../../services/runtime-api/src/modules/session/sessionParticipants.ts";
import { initializeTurnBasedSessionState } from "../../../services/runtime-api/src/modules/session/turnBasedSessionState.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { compileAuthoringText } = require("../../../scripts/manifest-tools/authoring-compiler.cjs");
const testCredentialSha256 = "b".repeat(64);
const setupDeckSamples = Array(11).fill(0);
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

const compileClonedInitialManifest = async () => {
  const sourceFile = path.join(packageRoot, "authoring", "game.authoring.json");
  const clonedAuthoring = structuredClone(JSON.parse(await readFile(sourceFile, "utf8")));
  const compiled = compileAuthoringText({
    kind: "game",
    gameId: "estate-race",
    sourceFile,
    outputFile: path.join(packageRoot, "game.manifest.json"),
    sourceMapFile: path.join(packageRoot, "game.manifest.source-map.json")
  }, JSON.stringify(clonedAuthoring));
  return validateGameManifest(compiled.manifest);
};

const createReplay = async (mutateState, {
  participantCount = 2,
  samples = [0, 3, 0, 3],
  actorScope = { kind: "all-session-actors" },
  autoSetup = true,
  manifest: manifestOverride,
  setupSamples = Array.from(
    { length: participantCount - 1 },
    (_, index) => participantCount - index - 1
  )
} = {}) => {
  const manifest = manifestOverride ?? await loadManifest();
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
    participants: materializeLocalSessionParticipants(initialState, participantCount),
    immutableBundle,
    principal: {
      principalId: "estate-race-test-controller",
      kind: "local-controller",
      role: "player",
      actorScope,
      credentialSha256: testCredentialSha256
    }
  });
  const randomSamples = autoSetup
    ? [...setupSamples, ...setupDeckSamples, ...samples]
    : samples;
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

const s4Property = (state, cellId) => state.public.objects.boardCells[cellId];
const s4GroupIds = (state, cellId) => {
  const group = s4Property(state, cellId).attributes.group;
  return Object.values(state.public.objects.boardCells)
    .filter((cell) => cell.attributes.kind === "estate" && cell.attributes.group === group)
    .map((cell) => cell.attributes.id);
};
const s4SetOwner = (state, cellIds, ownerPlayerId) => {
  for (const cellId of cellIds) s4Property(state, cellId).attributes.ownerPlayerId = ownerPlayerId;
};
const s4SetTier = (state, cellId, improvementTier) => {
  s4Property(state, cellId).attributes.improvementTier = improvementTier;
};
const s4Bank = (state) => state.public.bankBuildings;
const s4BuildingCounts = (state, ownerPlayerId) => Object.values(state.public.objects.boardCells)
  .filter((cell) => cell.attributes.kind === "estate")
  .filter((cell) => ownerPlayerId === undefined || cell.attributes.ownerPlayerId === ownerPlayerId)
  .reduce((counts, cell) => {
    const tier = cell.attributes.improvementTier ?? 0;
    if (tier === 5) counts.hotels += 1;
    else counts.houses += tier;
    return counts;
  }, { houses: 0, hotels: 0 });
const s4Conservation = (state) => {
  const deployed = s4BuildingCounts(state);
  assert.equal(s4Bank(state).housesAvailable + deployed.houses, 32);
  assert.equal(s4Bank(state).hotelsAvailable + deployed.hotels, 12);
};
const s4ReconcileInventory = (state) => {
  const deployed = s4BuildingCounts(state);
  assert.ok(deployed.houses <= 32, "fixture cannot deploy more than 32 houses");
  assert.ok(deployed.hotels <= 12, "fixture cannot deploy more than 12 hotels");
  s4Bank(state).housesAvailable = 32 - deployed.houses;
  s4Bank(state).hotelsAvailable = 12 - deployed.hotels;
  s4Conservation(state);
};
const s4SetOwnedGroupTier = (state, cellId, ownerPlayerId, improvementTier) => {
  const groupIds = s4GroupIds(state, cellId);
  s4SetOwner(state, groupIds, ownerPlayerId);
  for (const id of groupIds) s4SetTier(state, id, improvementTier);
  return groupIds;
};
const s4ConfigureHouseStock = (state, housesAvailable, requests) => {
  const estateCells = Object.values(state.public.objects.boardCells)
    .filter((cell) => cell.attributes.kind === "estate");
  const groups = [...new Set(estateCells.map((cell) => cell.attributes.group))]
    .map((group) => estateCells.filter((cell) => cell.attributes.group === group));
  const requestByGroup = new Map(requests.map(({ cellId, playerId }) => [
    s4Property(state, cellId).attributes.group,
    { cellId, playerId }
  ]));

  for (const groupCells of groups) {
    const request = requestByGroup.get(groupCells[0].attributes.group);
    const ownerPlayerId = request?.playerId ?? "p1";
    for (const cell of groupCells) {
      cell.attributes.ownerPlayerId = ownerPlayerId;
      cell.attributes.improvementTier = 0;
    }
    if (request) {
      assert.equal(groupCells[0].attributes.id, request.cellId, "request target must remain the minimum-tier cell");
      state.players[ownerPlayerId].metrics.cash = 10_000;
    }
  }

  let housesToDeploy = 32 - housesAvailable;
  for (const groupCells of groups) {
    if (housesToDeploy === 0) break;
    const hasRequest = requestByGroup.has(groupCells[0].attributes.group);
    const capacity = groupCells.length * 4 - (hasRequest ? 1 : 0);
    const deployed = Math.min(housesToDeploy, capacity);
    const baseTier = Math.floor(deployed / groupCells.length);
    const raisedCells = deployed % groupCells.length;
    for (const [index, cell] of groupCells.entries()) {
      cell.attributes.improvementTier = baseTier + (index >= groupCells.length - raisedCells ? 1 : 0);
    }
    housesToDeploy -= deployed;
  }
  assert.equal(housesToDeploy, 0, "fixture must deploy the exact physical house stock");
  s4ReconcileInventory(state);
  assert.equal(s4Bank(state).housesAvailable, housesAvailable);
};
const s4PrepareOwnedGroup = (state, { cellId = "cell-01", owner = "p1", tier = 0 } = {}) => {
  const groupIds = s4SetOwnedGroupTier(state, cellId, owner, tier);
  state.players[owner].metrics.cash = 10_000;
  state.public.turn.phase = "finish";
  state.public.turn.activePlayerId = owner;
  state.public.board.availableActions = [];
  s4ReconcileInventory(state);
  return groupIds;
};
const s4Snapshot = async (replay) => structuredClone(
  await replay.store.getSession(replay.session.sessionId)
);
const s4AssertUnchanged = async (replay, before) => {
  const after = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
};

/** Complete a non-shortage request window while retaining exact actor order. */
const s4PassRemainingWindow = async (replay) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const current = await replay.store.getSession(replay.session.sessionId);
    if (current.state.public.turn.phase !== "buildingWindow") return current;
    await act(replay, "property.build.pass");
  }
  assert.fail("buildingWindow did not terminate within the participant bound");
};

const s4PassBuildingAuction = async (replay) => {
  for (let guard = 0; guard < 24; guard += 1) {
    const current = await replay.store.getSession(replay.session.sessionId);
    if (current.state.public.turn.phase !== "buildingAuction") return current;
    await act(replay, "property.build.auction.pass");
  }
  assert.fail("buildingAuction did not terminate within the lot and participant bound");
};

test("S4 manifest declares the building state, exact request slot, and mutation catalog", async () => {
  const manifest = await loadManifest();
  assert.deepEqual(
    Object.keys(manifest.actions).filter((id) => id.startsWith("property.")),
    [
      "property.buy",
      "property.decline",
      "property.rent",
      "property.auction.bid",
      "property.auction.pass",
      "property.build",
      "property.build.request",
      "property.build.pass",
      "property.build.auction.bid",
      "property.build.auction.pass",
      "property.sell",
      "property.mortgage",
      "property.redeem"
    ]
  );
  assert.deepEqual(manifest.state.public.bankBuildings, {
    housesAvailable: 32,
    hotelsAvailable: 12
  });
  assert.deepEqual(manifest.state.public.buildingWindow, {
    resumePlayerId: "",
    unitKind: ""
  });
  assert.deepEqual(manifest.state.public.buildingAuction, {
    currentBid: 0,
    minimumIncrement: 10,
    leaderPlayerId: ""
  });
  assert.equal(manifest.state.playersTemplate.objects.buildingRequestCellId, "");
  assert.equal(manifest.state.playersTemplate.objects.buildingRequestUnitKind, "");
  const estateCells = Object.values(manifest.state.public.objects.boardCells)
    .filter((cell) => cell.attributes.kind === "estate");
  assert.ok(estateCells.length > 0);
  assert.ok(estateCells.every((cell) => Array.isArray(cell.attributes.rentScale)));
  assert.ok(estateCells.every((cell) => cell.attributes.improvementTier === 0));
});

test("S4 builds and sells every tier with exact 32/12 conservation, including 4↔5", async () => {
  const cellId = "cell-01";
  for (const improvementTier of [1, 2, 3, 4, 5]) {
    const previousTier = improvementTier - 1;
    const replay = await createPhaseReplay((state) => {
      s4PrepareOwnedGroup(state, { cellId, tier: previousTier });
    }, { phase: "finish" });
    const before = await s4Snapshot(replay);
    const unitKind = improvementTier === 5 ? "hotel" : "house";
    const opened = await act(replay, "property.build", { unitKind });
    assert.equal(opened.result.ok, true, JSON.stringify(opened.result));
    await s4PassRemainingWindow(replay);
    let current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(s4Property(current.state, cellId).attributes.improvementTier, improvementTier);
    assert.equal(
      s4Property(current.state, cellId).attributes.rent,
      s4Property(current.state, cellId).attributes.rentScale[improvementTier]
    );
    s4Conservation(current.state);
    assert.equal(
      current.state.players.p1.metrics.cash,
      before.state.players.p1.metrics.cash - s4Property(before.state, cellId).attributes.buildCost
    );

    const sold = await act(replay, "property.sell", { cellId });
    assert.equal(sold.result.ok, true, JSON.stringify(sold.result));
    current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(s4Property(current.state, cellId).attributes.improvementTier, previousTier);
    assert.equal(
      s4Property(current.state, cellId).attributes.rent,
      s4Property(current.state, cellId).attributes.rentScale[previousTier]
    );
    s4Conservation(current.state);
    assert.equal(
      current.state.players.p1.metrics.cash,
      before.state.players.p1.metrics.cash
        - s4Property(before.state, cellId).attributes.buildCost
        + s4Property(before.state, cellId).attributes.sellValue
    );
  }
});

test("S4 build/sell success and every atomic rejection preserve state and inventory", async () => {
  const positive = await createPhaseReplay((state) => s4PrepareOwnedGroup(state), {
    phase: "finish"
  });
  const firstBuild = await act(positive, "property.build", { unitKind: "house" });
  assert.equal(firstBuild.result.ok, true, JSON.stringify(firstBuild.result));
  await s4PassRemainingWindow(positive);
  let current = await positive.store.getSession(positive.session.sessionId);
  assert.equal(s4Property(current.state, "cell-01").attributes.improvementTier, 1);
  const positiveSell = await act(positive, "property.sell", { cellId: "cell-01" });
  assert.equal(positiveSell.result.ok, true, JSON.stringify(positiveSell.result));
  current = await positive.store.getSession(positive.session.sessionId);
  assert.equal(s4Property(current.state, "cell-01").attributes.improvementTier, 0);
  s4Conservation(current.state);

  const cases = [
    {
      name: "not-full-group",
      mutate: (state) => {
        s4SetOwner(state, ["cell-01"], "p1");
        state.players.p1.metrics.cash = 10_000;
        state.public.turn.phase = "finish";
        state.public.turn.activePlayerId = "p1";
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /ACTION_PRECONDITION_FAILED/
    },
    {
      name: "uneven-group",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        s4SetTier(state, "cell-01", 1);
        s4ReconcileInventory(state);
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /ACTION_PRECONDITION_FAILED/
    },
    {
      name: "insufficient-cash",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        state.players.p1.metrics.cash = 0;
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /MECHANICS_RESOURCE_INSUFFICIENT/
    },
    {
      name: "house-stock",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        s4ConfigureHouseStock(state, 0, [{ cellId: "cell-01", playerId: "p1" }]);
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /MECHANICS_RESOURCE_INSUFFICIENT/
    },
    {
      name: "sell-not-max-tier",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        s4SetTier(state, "cell-01", 1);
        s4SetTier(state, "cell-02", 2);
        s4ReconcileInventory(state);
      },
      action: "property.sell",
      params: { cellId: "cell-01" },
      error: /ACTION_PRECONDITION_FAILED/
    }
  ];
  for (const rejected of cases) {
    const replay = await createPhaseReplay(rejected.mutate, { phase: "finish" });
    const before = await s4Snapshot(replay);
    await assertRejectedAction(act(replay, rejected.action, rejected.params), rejected.error);
    await s4AssertUnchanged(replay, before);
    assert.equal(replay.randomCallCount, 0, `${rejected.name}: no server randomness`);
  }
});

test("S4 rejects wrong actor, stale phase, mortgage/build conflicts, and stale ownership atomically", async () => {
  const cases = [
    {
      name: "wrong-actor",
      actorScope: { kind: "listed-actors", actorIds: ["p2"] },
      mutate: (state) => s4PrepareOwnedGroup(state),
      action: "property.build",
      params: { unitKind: "house" },
      error: /not allowed to perform this operation/
    },
    {
      name: "stale-phase",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        state.public.turn.phase = "roll";
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /ACTION_PRECONDITION_FAILED/
    },
    {
      name: "mortgaged-group",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        s4Property(state, "cell-01").attributes.mortgaged = true;
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /ACTION_PRECONDITION_FAILED/
    },
    {
      name: "wrong-ownership",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        s4Property(state, "cell-01").attributes.ownerPlayerId = "p2";
      },
      action: "property.build",
      params: { unitKind: "house" },
      error: /ACTION_PRECONDITION_FAILED/
    },
    {
      name: "stale-request-cell",
      mutate: (state) => {
        s4PrepareOwnedGroup(state);
        state.public.turn.phase = "buildingWindow";
        state.public.turn.activePlayerId = "p1";
        state.public.buildingWindow = { resumePlayerId: "p1", unitKind: "house" };
        state.players.p1.objects.buildingRequestCellId = "cell-02";
        state.players.p1.objects.buildingRequestUnitKind = "house";
      },
      action: "property.build.request",
      params: { cellId: "cell-01" },
      error: /ACTION_PRECONDITION_FAILED/
    }
  ];
  for (const rejected of cases) {
    const replay = await createPhaseReplay(rejected.mutate, {
      phase: rejected.name === "stale-phase" ? "roll" : "finish",
      actorScope: rejected.actorScope
    });
    const before = await s4Snapshot(replay);
    if (rejected.name === "wrong-actor") {
      await assert.rejects(act(replay, rejected.action, rejected.params), rejected.error);
    } else {
      await assertRejectedAction(act(replay, rejected.action, rejected.params), rejected.error);
    }
    await s4AssertUnchanged(replay, before);
  }
});

test("S4 mortgage/redeem is exact and mortgaged estate, transit, and utility pay no rent", async () => {
  for (const cellId of ["cell-01", "cell-06", "cell-12"]) {
    const replay = await createPhaseReplay((state) => {
      const cell = s4Property(state, cellId);
      cell.attributes.ownerPlayerId = "p1";
      cell.attributes.mortgaged = false;
      state.players.p1.metrics.cash = 10_000;
      state.players.p2.metrics.cash = 10_000;
      state.players.p2.metrics.position = cell.attributes.index;
      state.public.turn.phase = "finish";
      state.public.turn.activePlayerId = "p1";
    }, { phase: "finish" });
    const beforeMortgage = await s4Snapshot(replay);
    const mortgaged = await act(replay, "property.mortgage", { cellId });
    assert.equal(mortgaged.result.ok, true, `${cellId}: ${JSON.stringify(mortgaged.result)}`);
    let current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(s4Property(current.state, cellId).attributes.mortgaged, true);
    assert.ok(current.state.players.p1.metrics.cash > beforeMortgage.state.players.p1.metrics.cash);
    const cashAfterMortgage = current.state.players.p1.metrics.cash;
    state: {
      current.state.public.turn.phase = "rent";
      current.state.public.turn.activePlayerId = "p2";
      current.state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
      current.version.stateVersion += 1;
      current.updatedAt = new Date();
      await replay.store.updateSession(current, {
        expectedStateVersion: (await s4Snapshot(replay)).version.stateVersion
      });
    }
    await act(replay, "property.rent");
    current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.players.p2.metrics.cash, 10_000);
    assert.equal(current.state.players.p1.metrics.cash, cashAfterMortgage);
    current.state.public.turn.phase = "finish";
    current.state.public.turn.activePlayerId = "p1";
    current.version.stateVersion += 1;
    current.updatedAt = new Date();
    await replay.store.updateSession(current, {
      expectedStateVersion: (await s4Snapshot(replay)).version.stateVersion
    });
    const redeemed = await act(replay, "property.redeem", { cellId });
    assert.equal(redeemed.result.ok, true, `${cellId}: ${JSON.stringify(redeemed.result)}`);
    current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(s4Property(current.state, cellId).attributes.mortgaged, false);
    assert.ok(current.state.players.p1.metrics.cash < cashAfterMortgage);
  }
});

test("S4 monopoly doubles tier0 rent and uses exact rent1..5 with updated cell rent", async () => {
  for (const improvementTier of [0, 1, 2, 3, 4, 5]) {
    const replay = await createPhaseReplay((state) => {
      s4SetOwnedGroupTier(state, "cell-01", "p2", improvementTier);
      s4ReconcileInventory(state);
      state.players.p1.metrics.position = s4Property(state, "cell-01").attributes.index;
      state.public.turn.phase = "rent";
      state.public.turn.activePlayerId = "p1";
      state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    }, { phase: "rent" });
    await act(replay, "property.rent");
    const current = await replay.store.getSession(replay.session.sessionId);
    const cell = s4Property(current.state, "cell-01");
    const expectedRent = cell.attributes.rentScale[improvementTier] * (improvementTier === 0 ? 2 : 1);
    assert.equal(cell.attributes.rent, cell.attributes.rentScale[improvementTier]);
    assert.equal(current.state.players.p1.metrics.cash, 1200 - expectedRent);
    assert.equal(current.state.players.p2.metrics.cash, 1200 + expectedRent);
    s4Conservation(current.state);
  }
});

test("S4 building-assessment covers mixed, zero, insufficient rollback, and exact-retry charging", async () => {
  const assessment = async (cash, withBuildings = true) => {
    let expectedCharge;
    const replay = await createPhaseReplay((state) => {
      const groupIds = s4GroupIds(state, "cell-01");
      s4SetOwner(state, groupIds, "p1");
      s4SetTier(state, groupIds[0], withBuildings ? 5 : 0);
      s4SetTier(state, groupIds[1], withBuildings ? 4 : 0);
      s4ReconcileInventory(state);
      state.players.p1.metrics.cash = cash;
      state.players.p1.metrics.position = 4;
      installDecks(state, { fundOrder: orderedDeck(fundCardIds, "fund-assessment") });
      state.public.turn.phase = "roll";
      state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    }, { phase: "roll", samples: [0, 1] });
    const manifest = await loadManifest();
    const card = Object.values(manifest.state.public.objects.fundCards)
      .find((item) => item.attributes.effectKind === "building-assessment");
    assert.ok(card, "authoring must declare building-assessment");
    const before = await s4Snapshot(replay);
    const buildings = s4BuildingCounts(before.state, "p1");
    expectedCharge = (card.attributes.houseFee * buildings.houses)
      + (card.attributes.hotelFee * buildings.hotels);
    const commandId = createTestCommandId();
    const first = await act(replay, "turn.roll", {}, {
      commandId, expectedStateVersion: before.version.stateVersion
    });
    if (cash < expectedCharge) {
      assert.equal(first.result.ok, true, JSON.stringify(first.result));
      const retried = await act(replay, "turn.roll", {}, {
        commandId, expectedStateVersion: before.version.stateVersion
      });
      assert.deepEqual(retried.receipt, first.receipt);
      const current = await replay.store.getSession(replay.session.sessionId);
      assert.equal(current.state.players.p1.metrics.cash, cash);
      assert.equal(current.state.public.obligation.reason, "assessment");
      assert.equal(current.state.public.obligation.amount, expectedCharge);
      assert.equal(current.state.public.turn.phase, "obligation");
      assert.equal(current.state.public.board.lastCardId, card.attributes.id);
      s4Conservation(current.state);
    } else {
      assert.equal(first.result.ok, true, JSON.stringify(first.result));
      const retried = await act(replay, "turn.roll", {}, {
        commandId, expectedStateVersion: before.version.stateVersion
      });
      assert.deepEqual(retried.receipt, first.receipt);
      const current = await replay.store.getSession(replay.session.sessionId);
      assert.equal(current.state.players.p1.metrics.cash, cash - expectedCharge);
      assert.equal(current.state.public.board.lastCardId, card.attributes.id);
      s4Conservation(current.state);
    }
    return expectedCharge;
  };
  const expected = await assessment(10_000);
  await assessment(expected - 1);
  await assessment(0, false);
});

test("S4 building windows cover 2/6 actors, demand <, =, > stock, exact 2/6 stock, lots, winners, pass, resume, and extra roll", async () => {
  const targetCellIds = ["cell-01", "cell-05", "cell-11", "cell-16", "cell-21", "cell-26"];
  for (const participantCount of [2, 6]) {
    for (const available of [participantCount - 1, participantCount, participantCount + 1]) {
      const requests = targetCellIds.slice(0, participantCount).map((cellId, index) => ({
        cellId,
        playerId: `p${index + 1}`
      }));
      const replay = await createPhaseReplay((state) => {
        s4ConfigureHouseStock(state, available, requests);
        state.public.turn.phase = "finish";
        state.public.turn.activePlayerId = "p1";
        state.public.board.availableActions = [];
        state.public.board.extraRollPending = true;
      }, { participantCount, phase: "finish" });
      const before = await s4Snapshot(replay);
      const first = await act(replay, "property.build", { unitKind: "house" });
      assert.equal(first.result.ok, true, JSON.stringify(first.result));
      let current = await replay.store.getSession(replay.session.sessionId);
      assert.equal(current.state.public.buildingWindow.unitKind, "house");
      assert.equal(current.state.public.buildingWindow.resumePlayerId, "p1");
      assert.equal(current.state.players.p1.objects.buildingRequestCellId, "cell-01");
      assert.equal(current.state.players.p1.objects.buildingRequestUnitKind, "house");
      for (let index = 1; index < participantCount; index += 1) {
        const requested = await act(replay, "property.build.request", {
          cellId: targetCellIds[index]
        });
        assert.equal(requested.result.ok, true, JSON.stringify(requested.result));
      }
      current = await replay.store.getSession(replay.session.sessionId);
      assert.equal(
        current.state.public.turn.phase,
        available < participantCount ? "buildingAuction" : "finish",
        JSON.stringify({
          available,
          participantCount,
          bank: current.state.public.bankBuildings,
          requests: Object.fromEntries(Object.entries(current.state.players).map(([id, player]) => [
            id,
            {
              cellId: player.objects.buildingRequestCellId,
              unitKind: player.objects.buildingRequestUnitKind,
              bidderStatus: player.flags.bidderStatus
            }
          ])),
          tiers: Object.fromEntries(requests.map(({ cellId }) => [
            cellId,
            s4Property(current.state, cellId).attributes.improvementTier
          ]))
        })
      );
      if (available < participantCount) current = await s4PassBuildingAuction(replay);

      assert.equal(current.state.public.turn.phase, "finish");
      for (const { cellId } of requests) {
        const expectedTier = s4Property(before.state, cellId).attributes.improvementTier
          + (available < participantCount ? 0 : 1);
        assert.equal(s4Property(current.state, cellId).attributes.improvementTier, expectedTier);
      }
      assert.equal(
        s4Bank(current.state).housesAvailable,
        available < participantCount ? available : available - participantCount
      );
      s4Conservation(current.state);
      assert.equal(current.state.public.board.extraRollPending, true);
      assert.equal(current.state.public.turn.activePlayerId, "p1");
      assert.deepEqual(current.state.public.board.availableActions, [
        {
          id: "trade-open",
          label: "Предложить сделку",
          actionId: "trade.open"
        },
        {
          id: "finish",
          label: "Завершить ход",
          actionId: "turn.finish"
        }
      ]);
      assert.deepEqual(current.state.public.buildingWindow, { resumePlayerId: "", unitKind: "" });
      assert.deepEqual(current.state.public.buildingAuction, {
        currentBid: 0,
        minimumIncrement: 10,
        leaderPlayerId: ""
      });
      assert.ok(Object.values(current.state.players).every((player) =>
        player.objects.buildingRequestCellId === "" && player.objects.buildingRequestUnitKind === ""
      ));
    }
  }
});

test("S4 every build/request/pass/sell/mortgage/redeem mutation is exact-retry idempotent", async () => {
  const replay = await createPhaseReplay((state) => {
    s4PrepareOwnedGroup(state);
    s4SetOwnedGroupTier(state, "cell-05", "p2", 0);
    state.players.p2.metrics.cash = 10_000;
    s4ReconcileInventory(state);
  }, { participantCount: 3, phase: "finish" });
  const mutations = [
    ["property.build", { unitKind: "house" }],
    ["property.build.request", { cellId: "cell-05" }],
    ["property.build.pass", {}],
    ["property.sell", { cellId: "cell-01" }],
    ["property.mortgage", { cellId: "cell-01" }],
    ["property.redeem", { cellId: "cell-01" }]
  ];
  for (const [actionId, params] of mutations) {
    const before = await s4Snapshot(replay);
    const commandId = createTestCommandId();
    const first = await act(replay, actionId, params, {
      commandId, expectedStateVersion: before.version.stateVersion
    });
    assert.equal(first.result.ok, true, `${actionId}: ${JSON.stringify(first.result)}`);
    const retry = await act(replay, actionId, params, {
      commandId, expectedStateVersion: before.version.stateVersion
    });
    assert.deepEqual(retry.receipt, first.receipt, actionId);
  }
});

test("S4 shortage auction resolves sequential lots with different winners, exact retry, and all-pass", async () => {
  const requests = [
    { cellId: "cell-01", playerId: "p1" },
    { cellId: "cell-05", playerId: "p2" },
    { cellId: "cell-11", playerId: "p3" }
  ];
  const replay = await createPhaseReplay((state) => {
    s4ConfigureHouseStock(state, 2, requests);
    state.public.turn.phase = "buildingAuction";
    state.public.turn.activePlayerId = "p2";
    state.public.buildingWindow = { resumePlayerId: "p1", unitKind: "house" };
    state.public.buildingAuction = { currentBid: 0, minimumIncrement: 10, leaderPlayerId: "" };
    for (const { cellId, playerId } of requests) {
      state.players[playerId].objects.buildingRequestCellId = cellId;
      state.players[playerId].objects.buildingRequestUnitKind = "house";
    }
  }, { participantCount: 3, phase: "buildingAuction" });
  const beforeBid = await s4Snapshot(replay);
  const bidCommandId = createTestCommandId();
  const firstBid = await act(replay, "property.build.auction.bid", { amount: 20 }, {
    commandId: bidCommandId,
    expectedStateVersion: beforeBid.version.stateVersion
  });
  assert.equal(firstBid.result.ok, true, JSON.stringify(firstBid.result));
  const retriedBid = await act(replay, "property.build.auction.bid", { amount: 20 }, {
    commandId: bidCommandId,
    expectedStateVersion: beforeBid.version.stateVersion
  });
  assert.deepEqual(retriedBid.receipt, firstBid.receipt);
  await act(replay, "property.build.auction.bid", { amount: 40 });
  await act(replay, "property.build.auction.bid", { amount: 60 });
  await act(replay, "property.build.auction.pass");
  await act(replay, "property.build.auction.pass");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(
    s4Property(current.state, "cell-01").attributes.improvementTier,
    s4Property(beforeBid.state, "cell-01").attributes.improvementTier + 1
  );
  assert.equal(current.state.public.bankBuildings.housesAvailable, 1);
  assert.equal(current.state.public.buildingAuction.currentBid, 0);
  assert.equal(current.state.public.turn.phase, "buildingAuction");
  assert.equal(current.state.players.p1.objects.buildingRequestCellId, "");
  assert.equal(current.state.players.p2.objects.buildingRequestCellId, "cell-05");
  assert.equal(current.state.players.p3.objects.buildingRequestCellId, "cell-11");

  await act(replay, "property.build.auction.bid", { amount: 30 });
  await act(replay, "property.build.auction.bid", { amount: 50 });
  await act(replay, "property.build.auction.pass");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(
    s4Property(current.state, "cell-05").attributes.improvementTier,
    s4Property(beforeBid.state, "cell-05").attributes.improvementTier
  );
  assert.equal(
    s4Property(current.state, "cell-11").attributes.improvementTier,
    s4Property(beforeBid.state, "cell-11").attributes.improvementTier + 1
  );
  assert.equal(current.state.public.bankBuildings.housesAvailable, 0);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.players.p1.metrics.cash, 10_000 - 60);
  assert.equal(current.state.players.p2.metrics.cash, 10_000);
  assert.equal(current.state.players.p3.metrics.cash, 10_000 - 50);
  assert.ok(Object.values(current.state.players).every((player) =>
    player.objects.buildingRequestCellId === "" && player.objects.buildingRequestUnitKind === ""
  ));
  s4Conservation(current.state);

  const allPass = await createPhaseReplay((state) => {
    const passRequests = requests.slice(0, 2);
    s4ConfigureHouseStock(state, 1, passRequests);
    state.public.turn.phase = "buildingAuction";
    state.public.turn.activePlayerId = "p1";
    state.public.buildingWindow = { resumePlayerId: "p1", unitKind: "house" };
    state.public.buildingAuction = { currentBid: 0, minimumIncrement: 10, leaderPlayerId: "" };
    for (const { cellId, playerId } of passRequests) {
      state.players[playerId].objects.buildingRequestCellId = cellId;
      state.players[playerId].objects.buildingRequestUnitKind = "house";
    }
  }, { phase: "buildingAuction" });
  const beforeAllPass = await s4Snapshot(allPass);
  await act(allPass, "property.build.auction.pass");
  await act(allPass, "property.build.auction.pass");
  current = await allPass.store.getSession(allPass.session.sessionId);
  assert.equal(current.state.public.bankBuildings.housesAvailable, 1);
  assert.equal(
    s4Property(current.state, "cell-01").attributes.improvementTier,
    s4Property(beforeAllPass.state, "cell-01").attributes.improvementTier
  );
  assert.equal(
    s4Property(current.state, "cell-05").attributes.improvementTier,
    s4Property(beforeAllPass.state, "cell-05").attributes.improvementTier
  );
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  s4Conservation(current.state);
});

const createPhaseReplay = async (mutateState, {
  participantCount = 2,
  phase = "acquire",
  actorScope = { kind: "all-session-actors" },
  manifest,
  samples = []
} = {}) => createReplay((state) => {
  const participantIds = Object.keys(state.players);
  state.public.setupComplete = true;
  state.public.turn.order = participantIds;
  state.public.turn.activePlayerId = participantIds[0];
  state.public.turn.phase = phase;
  state.public.board.availableActions = [];
  mutateState?.(state);
}, { participantCount, actorScope, autoSetup: false, manifest, samples });

test("setup randomizes the exact 2/6 participant set once and is receipt-idempotent", async () => {
  for (const participantCount of [2, 6]) {
    const replay = await createReplay(undefined, {
      participantCount,
      autoSetup: false,
      samples: [
        ...Array.from({ length: participantCount - 1 }, () => 0),
        ...setupDeckSamples
      ]
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
    assert.equal(replay.totalRandomCallCount, participantCount - 1 + setupDeckSamples.length);

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
    assert.equal(replay.totalRandomCallCount, participantCount - 1 + setupDeckSamples.length);

    const beforeFreshSetup = structuredClone(configured);
    await assertRejectedAction(
      act(replay, "session.setup.finalize"),
      /SESSION_SETUP_ALREADY_FINALIZED/
    );
    const afterFreshSetup = await replay.store.getSession(replay.session.sessionId);
    assert.equal(replay.totalRandomCallCount, participantCount - 1 + setupDeckSamples.length);
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
  const landingSelection = rollSteps.find(
    (step) => step.op === "core.entities.select" && step.selector.collection === "boardCells"
  );
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

  const thirdDouble = await act(replay, "turn.roll");
  assert.equal(thirdDouble.result.ok, true, JSON.stringify(thirdDouble.result));
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [3, 3]);
  assert.equal(current.state.players.p1.metrics.position, 10);
  assert.equal(current.state.players.p1.flags.inJail, true);
  assert.equal(current.state.players.p1.metrics.cash, 1200);
  assert.equal(current.state.public.board.consecutiveDoubles, 0);
  assert.equal(current.state.public.board.extraRollPending, false);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.deepEqual(current.state.public.board.availableActions, [
    { id: "trade-open", label: "Предложить сделку", actionId: "trade.open" },
    { id: "finish", label: "Завершить ход", actionId: "turn.finish" }
  ]);

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
  assert.equal(current.state.public.turn.phase, "jail");
  assert.deepEqual(current.state.public.board.availableActions.map((item) => item.actionId), [
    "jail.pay",
    "jail.card.use.event",
    "jail.card.use.fund",
    "jail.roll"
  ]);

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
  assert.deepEqual(availability.find((entry) => entry.actionId === "jail.roll"), {
    actionId: "jail.roll",
    status: "available",
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
  assert.deepEqual(current.state.public.board.availableActions, [
    { id: "trade-open", label: "Предложить сделку", actionId: "trade.open" },
    { id: "finish", label: "Завершить ход", actionId: "turn.finish" }
  ]);
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
  const commandId = createTestCommandId();
  const started = await act(poorReplay, "tax.pay", {}, {
    commandId,
    expectedStateVersion: beforeTax.version.stateVersion
  });
  assert.equal(started.result.ok, true, JSON.stringify(started.result));
  const retried = await act(poorReplay, "tax.pay", {}, {
    commandId,
    expectedStateVersion: beforeTax.version.stateVersion
  });
  assert.deepEqual(retried.receipt, started.receipt);
  const afterTax = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.equal(afterTax.state.public.turn.phase, "obligation");
  assert.equal(afterTax.state.public.obligation.reason, "tax");
  assert.equal(afterTax.state.public.obligation.amount, 110);
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
  assert.deepEqual(current.state.public.board.availableActions, [
    { id: "trade-open", label: "Предложить сделку", actionId: "trade.open" },
    { id: "finish", label: "Завершить ход", actionId: "turn.finish" }
  ]);
});

const eventCardIds = [
  "event-credit",
  "event-advance",
  "event-retreat",
  "event-jail",
  "event-exit",
  "event-message"
];
const fundCardIds = [
  "fund-debit",
  "fund-pay-each",
  "fund-collect-each",
  "fund-start",
  "fund-message",
  "fund-exit",
  "fund-assessment"
];

const installDecks = (state, {
  eventOrder = eventCardIds,
  eventDiscard = [],
  eventHeld = [],
  fundOrder = fundCardIds,
  fundDiscard = [],
  fundHeld = []
} = {}) => {
  state.secret.decks = {
    event: {
      order: eventOrder,
      discard: eventDiscard,
      held: eventHeld,
      stream: "estate-race.deck.event"
    },
    fund: {
      order: fundOrder,
      discard: fundDiscard,
      held: fundHeld,
      stream: "estate-race.deck.fund"
    }
  };
};

const orderedDeck = (cardIds, first) => [first, ...cardIds.filter((id) => id !== first)];

const fixtureJailActor = async (replay, actorId = "p1") => {
  const current = await replay.store.getSession(replay.session.sessionId);
  const updated = structuredClone(current);
  updated.state.players[actorId].metrics.position = 10;
  updated.state.players[actorId].metrics.jailAttempts = 0;
  updated.state.players[actorId].flags.inJail = true;
  updated.state.public.turn.phase = "jail";
  updated.state.public.board.consecutiveDoubles = 0;
  updated.state.public.board.extraRollPending = false;
  updated.state.public.board.availableActions = [
    { id: "jail-card-event", label: "Использовать карту выхода", actionId: "jail.card.use.event" },
    { id: "jail-card-fund", label: "Использовать карту фонда", actionId: "jail.card.use.fund" }
  ];
  updated.version.stateVersion += 1;
  updated.updatedAt = new Date();
  return replay.store.updateSession(updated, {
    expectedStateVersion: current.version.stateVersion
  });
};

test("both hidden decks dispatch every neutral card effect and continue the authoritative landing", async () => {
  const cases = [
    { deck: "event", cardId: "event-credit", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.cash, 1290);
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "event", cardId: "event-advance", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.position, 9);
      assert.equal(state.players.p1.metrics.cash, 1200);
      assert.equal(state.public.turn.phase, "acquire");
    } },
    { deck: "event", cardId: "event-retreat", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.position, 38);
      assert.equal(state.players.p1.metrics.cash, 1200);
      assert.equal(state.public.turn.phase, "tax");
    } },
    { deck: "event", cardId: "event-jail", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.position, 10);
      assert.equal(state.players.p1.flags.inJail, true);
      assert.equal(state.players.p1.metrics.jailAttempts, 0);
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "event", cardId: "event-exit", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.objects.heldExitCardId, "event-exit");
      assert.deepEqual(state.secret.decks.event.held, ["event-exit"]);
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "event", cardId: "event-message", participantCount: 2, assertState: (state) => {
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "fund", cardId: "fund-debit", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.cash, 1160);
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "fund", cardId: "fund-pay-each", participantCount: 6, assertState: (state) => {
      assert.equal(state.players.p1.metrics.cash, 1150);
      assert.ok(["p2", "p3", "p4", "p5", "p6"].every((id) => state.players[id].metrics.cash === 1210));
    } },
    { deck: "fund", cardId: "fund-collect-each", participantCount: 6, assertState: (state) => {
      assert.equal(state.players.p1.metrics.cash, 1250);
      assert.ok(["p2", "p3", "p4", "p5", "p6"].every((id) => state.players[id].metrics.cash === 1190));
    } },
    { deck: "fund", cardId: "fund-start", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.position, 0);
      assert.equal(state.players.p1.metrics.cash, 1320);
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "fund", cardId: "fund-message", participantCount: 2, assertState: (state) => {
      assert.equal(state.public.turn.phase, "finish");
    } },
    { deck: "fund", cardId: "fund-assessment", participantCount: 2, assertState: (state) => {
      assert.equal(state.players.p1.metrics.cash, 1200);
      assert.equal(state.public.turn.phase, "finish");
    } }
  ];

  for (const cardCase of cases) {
    const targetIndex = cardCase.deck === "event" ? 3 : 7;
    const replay = await createPhaseReplay((state) => {
      state.players.p1.metrics.position = targetIndex - 3;
      state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
      installDecks(state, {
        eventOrder: orderedDeck(eventCardIds, cardCase.deck === "event" ? cardCase.cardId : "event-message"),
        fundOrder: orderedDeck(fundCardIds, cardCase.deck === "fund" ? cardCase.cardId : "fund-message")
      });
    }, { phase: "roll", participantCount: cardCase.participantCount, samples: [0, 1] });

    const outcome = await act(replay, "turn.roll");
    assert.equal(outcome.result.ok, true, `${cardCase.cardId}: ${JSON.stringify(outcome.result)}`);
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.board.lastCardId, cardCase.cardId);
    assert.equal(current.state.public.board.pendingDeckId, null);
    cardCase.assertState(current.state);
  }
});

test("relative cards cross zero in both directions and only forward movement awards one lap", async () => {
  const crossingCase = async ({ cardId, startPosition, samples, expectedPosition, expectedCash }) => {
    const replay = await createPhaseReplay((state) => {
      state.players.p1.metrics.position = startPosition;
      state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
      installDecks(state, { eventOrder: orderedDeck(eventCardIds, cardId) });
    }, { phase: "roll", samples });
    const outcome = await act(replay, "turn.roll");
    assert.equal(outcome.result.ok, true, JSON.stringify(outcome.result));
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.board.lastCardId, cardId);
    assert.equal(current.state.players.p1.metrics.position, expectedPosition);
    assert.equal(current.state.players.p1.metrics.cash, expectedCash);
  };

  await crossingCase({
    cardId: "event-advance",
    startPosition: 33,
    samples: [0, 1],
    expectedPosition: 2,
    expectedCash: 1320
  });
  await crossingCase({
    cardId: "event-retreat",
    startPosition: 0,
    samples: [0, 1],
    expectedPosition: 38,
    expectedCash: 1200
  });
});

test("discard exhaustion reshuffles once and exact retry neither reshuffles nor reapplies the card", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 0;
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    installDecks(state, { eventOrder: [], eventDiscard: eventCardIds });
  }, { phase: "roll", samples: [0, 1, 0, 0, 0, 0, 0] });
  const before = await replay.store.getSession(replay.session.sessionId);
  const commandId = createTestCommandId();
  const first = await act(replay, "turn.roll", {}, { commandId, expectedStateVersion: before.version.stateVersion });
  assert.equal(first.result.ok, true, JSON.stringify(first.result));
  assert.equal(replay.randomCallCount, 7);
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.secret.decks.event.order.length, 5);
  assert.equal(current.state.secret.decks.event.discard.length, 1);
  const afterFirst = structuredClone(current.state);

  const retried = await act(replay, "turn.roll", {}, { commandId, expectedStateVersion: before.version.stateVersion });
  assert.deepEqual(retried.receipt, first.receipt);
  assert.equal(replay.randomCallCount, 7);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state, afterFirst);

  await assertRejectedAction(act(replay, "turn.roll"), /ACTION_PRECONDITION_FAILED/);
  assert.equal(replay.randomCallCount, 7);
});

test("held exit card is actor-private and three return cycles are receipt-idempotent", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 0;
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    installDecks(state, { eventOrder: ["event-exit"] });
  }, { phase: "roll", samples: [0, 1, 2, 3, 2, 3] });

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const beforeDraw = await replay.store.getSession(replay.session.sessionId);
    const drawCommandId = createTestCommandId();
    const drawn = await act(replay, "turn.roll", {}, {
      commandId: drawCommandId,
      expectedStateVersion: beforeDraw.version.stateVersion
    });
    assert.equal(drawn.result.ok, true, JSON.stringify(drawn.result));
    const retriedDraw = await act(replay, "turn.roll", {}, {
      commandId: drawCommandId,
      expectedStateVersion: beforeDraw.version.stateVersion
    });
    assert.deepEqual(retriedDraw.receipt, drawn.receipt);
    assert.equal(replay.randomCallCount, (cycle + 1) * 2);
    let current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.board.lastCardId, "event-exit");
    assert.equal(current.state.players.p1.objects.heldExitCardId, "event-exit");
    assert.deepEqual(current.state.secret.decks.event, {
      order: [],
      discard: [],
      held: ["event-exit"],
      stream: "estate-race.deck.event"
    });

    const p1View = buildPlayerSessionProjection({
      state: current.state,
      stateModel: replay.manifest.mechanics.stateModel,
      actorPlayerId: "p1"
    });
    const p2View = buildPlayerSessionProjection({
      state: current.state,
      stateModel: replay.manifest.mechanics.stateModel,
      actorPlayerId: "p2"
    });
    const anonymousView = buildPlayerSessionProjection({
      state: current.state,
      stateModel: replay.manifest.mechanics.stateModel
    });
    assert.equal(p1View.state.players.p1.objects.heldExitCardId, "event-exit");
    assert.equal(p2View.state.players.p1.objects?.heldExitCardId, undefined);
    assert.equal(anonymousView.state.players.p1.objects?.heldExitCardId, undefined);
    assert.equal(p1View.state.secret, undefined);
    assert.equal(p2View.state.secret, undefined);

    const heldZones = structuredClone(current.state.secret.decks.event);
    await fixtureJailActor(replay);
    current = await replay.store.getSession(replay.session.sessionId);
    assert.deepEqual(current.state.secret.decks.event, heldZones);
    const beforeUse = current;
    const commandId = createTestCommandId();
    const used = await act(replay, "jail.card.use.event", {}, {
      commandId,
      expectedStateVersion: beforeUse.version.stateVersion
    });
    assert.equal(used.result.ok, true, JSON.stringify(used.result));
    const retried = await act(replay, "jail.card.use.event", {}, {
      commandId,
      expectedStateVersion: beforeUse.version.stateVersion
    });
    assert.deepEqual(retried.receipt, used.receipt);
    current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.players.p1.objects.heldExitCardId, null);
    assert.equal(current.state.players.p1.flags.inJail, false);
    assert.equal(current.state.players.p1.metrics.jailAttempts, 0);
    assert.deepEqual(current.state.secret.decks.event.held, []);
    assert.deepEqual(current.state.secret.decks.event, {
      order: [],
      discard: ["event-exit"],
      held: [],
      stream: "estate-race.deck.event"
    });
    assert.equal(current.state.public.board.lastCardId, "event-exit");
    assert.equal(current.state.public.turn.phase, "roll");

    await assertRejectedAction(act(replay, "jail.card.use.event"), /JAIL_EXIT_CARD_UNAVAILABLE/);
    assert.equal(replay.randomCallCount, (cycle + 1) * 2);
  }
});

test("both exit cards can be drawn into private slots and the fund card returns from its exact slot", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 0;
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    installDecks(state, { eventOrder: ["event-exit"], fundOrder: ["fund-exit"] });
  }, { phase: "roll", samples: [0, 1, 0, 1] });

  await act(replay, "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.players.p1.objects.heldExitCardId2, null);

  const nextDraw = structuredClone(current);
  nextDraw.state.players.p1.metrics.position = 4;
  nextDraw.state.public.turn.phase = "roll";
  nextDraw.state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
  nextDraw.version.stateVersion += 1;
  nextDraw.updatedAt = new Date();
  await replay.store.updateSession(nextDraw, {
    expectedStateVersion: current.version.stateVersion
  });

  const secondDraw = await act(replay, "turn.roll");
  assert.equal(secondDraw.result.ok, true, JSON.stringify(secondDraw.result));
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.board.lastCardId, "fund-exit");
  assert.equal(current.state.players.p1.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.players.p1.objects.heldExitCardId2, "fund-exit");
  assert.deepEqual(current.state.secret.decks.event.held, ["event-exit"]);
  assert.deepEqual(current.state.secret.decks.fund.held, ["fund-exit"]);

  const peerView = buildPlayerSessionProjection({
    state: current.state,
    stateModel: replay.manifest.mechanics.stateModel,
    actorPlayerId: "p2"
  });
  assert.equal(peerView.state.players.p1.objects?.heldExitCardId, undefined);
  assert.equal(peerView.state.players.p1.objects?.heldExitCardId2, undefined);

  await fixtureJailActor(replay);
  const beforeUse = await replay.store.getSession(replay.session.sessionId);
  const commandId = createTestCommandId();
  const used = await act(replay, "jail.card.use.fund", {}, {
    commandId,
    expectedStateVersion: beforeUse.version.stateVersion
  });
  const retried = await act(replay, "jail.card.use.fund", {}, {
    commandId,
    expectedStateVersion: beforeUse.version.stateVersion
  });
  assert.deepEqual(retried.receipt, used.receipt);
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.players.p1.objects.heldExitCardId2, null);
  assert.deepEqual(current.state.secret.decks.event.held, ["event-exit"]);
  assert.deepEqual(current.state.secret.decks.fund.held, []);
  assert.deepEqual(current.state.secret.decks.fund.discard, ["fund-exit"]);
  assert.equal(current.state.players.p1.flags.inJail, false);
  assert.equal(current.state.public.turn.phase, "roll");
});

test("multi-party card insolvency commits one explicit obligation and exact retry does not redraw", async () => {
  for (const cardId of ["fund-pay-each", "fund-collect-each"]) {
    const replay = await createPhaseReplay((state) => {
      state.players.p1.metrics.position = 4;
      state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
      if (cardId === "fund-pay-each") {
        state.players.p1.metrics.cash = 25;
      } else {
        state.players.p5.metrics.cash = 5;
      }
      installDecks(state, { fundOrder: orderedDeck(fundCardIds, cardId) });
    }, { participantCount: 6, phase: "roll", samples: [0, 1, 0, 1] });
    const before = structuredClone(await replay.store.getSession(replay.session.sessionId));
    const commandId = createTestCommandId();

    const first = await act(replay, "turn.roll", {}, {
      commandId,
      expectedStateVersion: before.version.stateVersion
    });
    assert.equal(first.result.ok, true, JSON.stringify(first.result));
    assert.equal(first.receipt.status, "applied");
    assert.equal(replay.randomCallCount, 2, `${cardId}: dice RNG is consumed once`);
    let current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.board.lastCardId, cardId);
    assert.equal(current.state.public.turn.phase, "obligation");
    assert.equal(current.state.public.obligation.status, "active");
    if (cardId === "fund-pay-each") {
      assert.equal(current.state.public.obligation.reason, "card-pay-each");
      assert.equal(current.state.public.obligation.amount, 50);
      assert.equal(current.state.players.p1.metrics.cash, 25);
      assert.ok(["p2", "p3", "p4", "p5", "p6"].every((id) => current.state.players[id].metrics.cash === 1200));
    } else {
      assert.equal(current.state.public.obligation.reason, "card-collect-each");
      assert.equal(current.state.public.obligation.amount, 10);
      assert.equal(current.state.public.turn.activePlayerId, "p5");
      assert.equal(current.state.players.p1.metrics.cash, 1240);
      assert.equal(current.state.players.p5.metrics.cash, 5);
    }

    const retried = await act(replay, "turn.roll", {}, {
      commandId,
      expectedStateVersion: before.version.stateVersion
    });
    assert.deepEqual(retried.receipt, first.receipt);
    assert.equal(replay.randomCallCount, 2, `${cardId}: exact retry must reuse the committed receipt`);

    const fresh = await act(replay, "turn.roll");
    assert.equal(fresh.result.ok, false);
    assert.equal(fresh.receipt.status, "rejected");
    assert.match(fresh.result.error?.code ?? "", /ACTION_PRECONDITION_FAILED/);
    assert.equal(replay.randomCallCount, 2, `${cardId}: fresh invalid command is rejected before RNG`);
  }
});

test("jail pay, doubles, failed attempts, and third-attempt obligations are atomic", async () => {
  const jailedReplay = async ({ attempts = 0, cash = 1200, samples = [], mutate = () => {} } = {}) => createPhaseReplay((state) => {
    state.players.p1.metrics.position = 10;
    state.players.p1.metrics.cash = cash;
    state.players.p1.metrics.jailAttempts = attempts;
    state.players.p1.flags.inJail = true;
    state.public.board.availableActions = [
      { id: "jail-pay", label: "Оплатить освобождение", actionId: "jail.pay" },
      { id: "jail-roll", label: "Попытаться выбросить дубль", actionId: "jail.roll" }
    ];
    installDecks(state);
    mutate(state);
  }, { phase: "jail", samples });

  const paid = await jailedReplay({ samples: [0, 0] });
  const beforePay = await paid.store.getSession(paid.session.sessionId);
  const payCommandId = createTestCommandId();
  const firstPay = await act(paid, "jail.pay", {}, {
    commandId: payCommandId,
    expectedStateVersion: beforePay.version.stateVersion
  });
  const retriedPay = await act(paid, "jail.pay", {}, {
    commandId: payCommandId,
    expectedStateVersion: beforePay.version.stateVersion
  });
  assert.deepEqual(retriedPay.receipt, firstPay.receipt);
  let current = await paid.store.getSession(paid.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1150);
  assert.equal(current.state.players.p1.flags.inJail, false);
  assert.equal(current.state.public.turn.phase, "roll");
  await assertRejectedAction(act(paid, "jail.pay"), /JAIL_ACTION_UNAVAILABLE/);
  await act(paid, "turn.roll");
  current = await paid.store.getSession(paid.session.sessionId);
  assert.equal(current.state.public.board.lastRoll.isDouble, true);
  assert.equal(current.state.public.board.extraRollPending, true);

  const poorPay = await jailedReplay({
    cash: 49,
    mutate: (state) => {
      state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
    }
  });
  await act(poorPay, "jail.pay");
  let afterPoorPay = await poorPay.store.getSession(poorPay.session.sessionId);
  assert.equal(afterPoorPay.state.public.turn.phase, "obligation");
  assert.equal(afterPoorPay.state.public.obligation.reason, "jail-pay");
  assert.equal(afterPoorPay.state.players.p1.flags.inJail, true);
  assert.equal(poorPay.randomCallCount, 0);
  await act(poorPay, "property.mortgage", { cellId: "cell-01" });
  await act(poorPay, "obligation.resolve");
  afterPoorPay = await poorPay.store.getSession(poorPay.session.sessionId);
  assert.equal(afterPoorPay.state.players.p1.metrics.cash, 44);
  assert.equal(afterPoorPay.state.players.p1.flags.inJail, false);
  assert.equal(afterPoorPay.state.public.turn.phase, "roll");

  const doubled = await jailedReplay({ samples: [2, 2] });
  const beforeDouble = await doubled.store.getSession(doubled.session.sessionId);
  const commandId = createTestCommandId();
  const firstDouble = await act(doubled, "jail.roll", {}, { commandId, expectedStateVersion: beforeDouble.version.stateVersion });
  assert.equal(firstDouble.result.ok, true, JSON.stringify(firstDouble.result));
  const retriedDouble = await act(doubled, "jail.roll", {}, { commandId, expectedStateVersion: beforeDouble.version.stateVersion });
  assert.deepEqual(retriedDouble.receipt, firstDouble.receipt);
  assert.equal(doubled.randomCallCount, 2);
  current = await doubled.store.getSession(doubled.session.sessionId);
  assert.equal(current.state.players.p1.metrics.position, 16);
  assert.equal(current.state.players.p1.flags.inJail, false);
  assert.equal(current.state.public.turn.phase, "acquire");
  assert.equal(current.state.public.board.extraRollPending, false);

  for (const attempts of [0, 1]) {
    const failed = await jailedReplay({ attempts, samples: [0, 1] });
    await act(failed, "jail.roll");
    current = await failed.store.getSession(failed.session.sessionId);
    assert.equal(current.state.players.p1.metrics.position, 10);
    assert.equal(current.state.players.p1.metrics.jailAttempts, attempts + 1);
    assert.equal(current.state.players.p1.flags.inJail, true);
    assert.equal(current.state.public.turn.phase, "finish");
    await act(failed, "turn.finish");
    current = await failed.store.getSession(failed.session.sessionId);
    assert.equal(current.state.public.turn.activePlayerId, "p2");
  }

  const third = await jailedReplay({ attempts: 2, cash: 50, samples: [0, 1] });
  await act(third, "jail.roll");
  current = await third.store.getSession(third.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 0);
  assert.equal(current.state.players.p1.metrics.position, 13);
  assert.equal(current.state.players.p1.flags.inJail, false);
  assert.equal(current.state.players.p1.metrics.jailAttempts, 0);
  assert.equal(current.state.public.turn.phase, "acquire");

  const poorThird = await jailedReplay({
    attempts: 2,
    cash: 49,
    samples: [0, 1],
    mutate: (state) => {
      state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
    }
  });
  const beforePoorThird = await poorThird.store.getSession(poorThird.session.sessionId);
  const thirdCommandId = createTestCommandId();
  const thirdFailure = await act(poorThird, "jail.roll", {}, {
    commandId: thirdCommandId,
    expectedStateVersion: beforePoorThird.version.stateVersion
  });
  const thirdRetry = await act(poorThird, "jail.roll", {}, {
    commandId: thirdCommandId,
    expectedStateVersion: beforePoorThird.version.stateVersion
  });
  assert.deepEqual(thirdRetry.receipt, thirdFailure.receipt);
  let afterPoorThird = await poorThird.store.getSession(poorThird.session.sessionId);
  assert.equal(poorThird.randomCallCount, 2);
  assert.equal(afterPoorThird.state.public.turn.phase, "obligation");
  assert.equal(afterPoorThird.state.public.obligation.reason, "jail-third");
  assert.equal(afterPoorThird.state.players.p1.metrics.position, 10);
  assert.equal(afterPoorThird.state.players.p1.flags.inJail, true);
  await act(poorThird, "property.mortgage", { cellId: "cell-01" });
  await act(poorThird, "obligation.resolve");
  afterPoorThird = await poorThird.store.getSession(poorThird.session.sessionId);
  assert.equal(afterPoorThird.state.public.turn.phase, "jail");
  assert.deepEqual(afterPoorThird.state.public.board.availableActions.map((item) => item.actionId), ["jail.third.move"]);
  await act(poorThird, "jail.third.move");
  afterPoorThird = await poorThird.store.getSession(poorThird.session.sessionId);
  assert.equal(afterPoorThird.state.players.p1.metrics.cash, 44);
  assert.equal(afterPoorThird.state.players.p1.metrics.position, 13);
  assert.equal(afterPoorThird.state.players.p1.flags.inJail, false);
  assert.equal(afterPoorThird.state.public.turn.phase, "acquire");
});

test("turn.finish publishes jail-only actions for the exact next actor with 2/6 participants", async () => {
  for (const participantCount of [2, 6]) {
    const replay = await createPhaseReplay((state) => {
      state.players.p2.flags.inJail = true;
      state.players.p2.metrics.jailAttempts = 1;
      state.public.board.availableActions = [{ id: "finish", label: "Завершить ход", actionId: "turn.finish" }];
    }, { participantCount, phase: "finish" });
    await act(replay, "turn.finish");
    const current = await replay.store.getSession(replay.session.sessionId);
    assert.equal(current.state.public.turn.activePlayerId, "p2");
    assert.equal(current.state.public.turn.phase, "jail");
    assert.deepEqual(current.state.public.board.availableActions.map((item) => item.actionId), [
      "jail.pay",
      "jail.card.use.event",
      "jail.card.use.fund",
      "jail.roll"
    ]);
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
    "property.auction.pass",
    "property.build",
    "property.build.request",
    "property.build.pass",
    "property.build.auction.bid",
    "property.build.auction.pass",
    "property.sell",
    "property.mortgage",
    "property.redeem"
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
  assert.deepEqual(current.state.public.board.availableActions.map((entry) => entry.actionId), [
    "trade.open",
    "turn.finish"
  ]);
});

test("S5 trade atomically exchanges cash and unimproved assets then restores the turn", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.cash = 1000;
    state.players.p2.metrics.cash = 800;
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p2";
  }, { phase: "finish" });

  await act(replay, "trade.open", { targetPlayerId: "p2" });
  await act(replay, "trade.cash.set", { offeredCash: 100, requestedCash: 50 });
  await act(replay, "trade.asset.set", { cellId: "cell-01", side: "offered" });
  await act(replay, "trade.asset.set", { cellId: "cell-05", side: "requested" });
  await act(replay, "trade.propose");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.public.turn.phase, "tradeResponse");
  assert.equal(current.state.public.trade.status, "response");

  const beforeAccept = current;
  const commandId = createTestCommandId();
  const accepted = await act(replay, "trade.accept", {}, {
    commandId,
    expectedStateVersion: beforeAccept.version.stateVersion
  });
  assert.equal(accepted.result.ok, true, JSON.stringify(accepted.result));
  const retried = await act(replay, "trade.accept", {}, {
    commandId,
    expectedStateVersion: beforeAccept.version.stateVersion
  });
  assert.deepEqual(retried.receipt, accepted.receipt);

  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 950);
  assert.equal(current.state.players.p2.metrics.cash, 850);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId, "p2");
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId, "p1");
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.tradeSide, "");
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.tradeSide, "");
  assert.equal(current.state.public.trade.status, "idle");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "finish");
});

test("S5 trade transfers both held cards without exposing another actor-private slot", async () => {
  const replay = await createPhaseReplay((state) => {
    installDecks(state, {
      eventOrder: eventCardIds.filter((cardId) => cardId !== "event-exit"),
      eventHeld: ["event-exit"],
      fundOrder: fundCardIds.filter((cardId) => cardId !== "fund-exit"),
      fundHeld: ["fund-exit"]
    });
    state.players.p1.objects.heldExitCardId = "event-exit";
    state.players.p2.objects.heldExitCardId = "fund-exit";
  }, { phase: "finish" });

  await act(replay, "trade.open", { targetPlayerId: "p2" });
  await act(replay, "trade.card.offer", { cardId: "event-exit" });
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.objects.heldExitCardId, null);
  assert.equal(current.state.public.trade.offeredCardId, "event-exit");
  const p2Draft = buildPlayerSessionProjection({
    state: current.state,
    stateModel: replay.manifest.mechanics.stateModel,
    actorPlayerId: "p2"
  });
  assert.equal(p2Draft.state.players.p1.objects?.heldExitCardId, undefined);
  assert.equal(p2Draft.state.public.trade.offeredCardId, "event-exit");

  await act(replay, "trade.card.request", { cardId: "fund-exit" });
  await act(replay, "trade.propose");
  const beforeAccept = await replay.store.getSession(replay.session.sessionId);
  const acceptCommandId = createTestCommandId();
  const accepted = await act(replay, "trade.accept", {}, {
    commandId: acceptCommandId,
    expectedStateVersion: beforeAccept.version.stateVersion
  });
  assert.equal(accepted.result.ok, true, JSON.stringify(accepted.result));
  const retriedAccept = await act(replay, "trade.accept", {}, {
    commandId: acceptCommandId,
    expectedStateVersion: beforeAccept.version.stateVersion
  });
  assert.deepEqual(retriedAccept.receipt, accepted.receipt);

  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p2.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.players.p1.objects.heldExitCardId, null);
  assert.equal(current.state.public.trade.claimCardId, "fund-exit");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "tradeClaim");

  const beforeClaim = current;
  const claimCommandId = createTestCommandId();
  const claimed = await act(replay, "trade.card.claim", {}, {
    commandId: claimCommandId,
    expectedStateVersion: beforeClaim.version.stateVersion
  });
  assert.equal(claimed.result.ok, true, JSON.stringify(claimed.result));
  const retriedClaim = await act(replay, "trade.card.claim", {}, {
    commandId: claimCommandId,
    expectedStateVersion: beforeClaim.version.stateVersion
  });
  assert.deepEqual(retriedClaim.receipt, claimed.receipt);

  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.objects.heldExitCardId, "fund-exit");
  assert.equal(current.state.players.p2.objects.heldExitCardId, "event-exit");
  assert.deepEqual(current.state.secret.decks.event.held, ["event-exit"]);
  assert.deepEqual(current.state.secret.decks.fund.held, ["fund-exit"]);
  assert.equal(current.state.public.trade.status, "idle");
  assert.equal(current.state.public.turn.phase, "finish");
});

test("S5 trade decline returns escrow and accept revalidates funds without partial changes", async () => {
  const declined = await createPhaseReplay((state) => {
    installDecks(state, { eventHeld: ["event-exit"] });
    state.players.p1.objects.heldExitCardId = "event-exit";
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
  }, { phase: "finish" });
  await act(declined, "trade.open", { targetPlayerId: "p2" });
  await act(declined, "trade.card.offer", { cardId: "event-exit" });
  await act(declined, "trade.asset.set", { cellId: "cell-01", side: "offered" });
  await act(declined, "trade.propose");
  await act(declined, "trade.decline");
  let current = await declined.store.getSession(declined.session.sessionId);
  assert.equal(current.state.public.turn.phase, "tradeClaim");
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  await act(declined, "trade.card.claim");
  current = await declined.store.getSession(declined.session.sessionId);
  assert.equal(current.state.players.p1.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId, "p1");
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.tradeSide, "");

  const stale = await createPhaseReplay((state) => {
    state.players.p1.metrics.cash = 500;
    state.players.p2.metrics.cash = 100;
  }, { phase: "finish" });
  await act(stale, "trade.open", { targetPlayerId: "p2" });
  await act(stale, "trade.cash.set", { offeredCash: 25, requestedCash: 80 });
  await act(stale, "trade.propose");
  current = await stale.store.getSession(stale.session.sessionId);
  const corrupted = structuredClone(current);
  corrupted.state.players.p2.metrics.cash = 50;
  corrupted.version.stateVersion += 1;
  corrupted.updatedAt = new Date();
  await stale.store.updateSession(corrupted, { expectedStateVersion: current.version.stateVersion });
  const beforeReject = structuredClone(await stale.store.getSession(stale.session.sessionId));
  await assertRejectedAction(act(stale, "trade.accept"), /ACTION_PRECONDITION_FAILED/);
  const afterReject = await stale.store.getSession(stale.session.sessionId);
  assert.deepEqual(afterReject.state, beforeReject.state);
  assert.equal(afterReject.version.stateVersion, beforeReject.version.stateVersion);
});

test("S5 tax, rent, and jail fees enter explicit obligations and resume after liquidity", async () => {
  const tax = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p1.metrics.cash = 30;
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
  }, { phase: "tax" });
  const taxStarted = await act(tax, "tax.pay");
  assert.equal(taxStarted.result.ok, true, JSON.stringify(taxStarted.result));
  let current = await tax.store.getSession(tax.session.sessionId);
  assert.equal(current.state.public.turn.phase, "obligation");
  assert.deepEqual({
    status: current.state.public.obligation.status,
    debtor: current.state.public.obligation.debtorPlayerId,
    creditor: current.state.public.obligation.creditorKind,
    amount: current.state.public.obligation.amount,
    reason: current.state.public.obligation.reason
  }, { status: "active", debtor: "p1", creditor: "bank", amount: 70, reason: "tax" });
  assert.equal(current.state.players.p1.metrics.cash, 30);
  await act(tax, "property.mortgage", { cellId: "cell-01" });
  await act(tax, "obligation.resolve");
  current = await tax.store.getSession(tax.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 5);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.obligation.status, "idle");

  const rent = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 5;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
  }, { phase: "rent" });
  await act(rent, "property.rent");
  current = await rent.store.getSession(rent.session.sessionId);
  assert.equal(current.state.public.obligation.amount, 8);
  assert.equal(current.state.public.obligation.creditorPlayerId, "p2");
  assert.equal(current.state.players.p2.metrics.cash, 1200);
  await act(rent, "property.mortgage", { cellId: "cell-05" });
  const rentResolved = await act(rent, "obligation.resolve");
  assert.equal(rentResolved.result.ok, true, JSON.stringify(rentResolved.result));
  current = await rent.store.getSession(rent.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 77);
  assert.equal(current.state.players.p2.metrics.cash, 1208);
  assert.equal(current.state.public.turn.phase, "finish");

  const jail = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 10;
    state.players.p1.metrics.cash = 20;
    state.players.p1.flags.inJail = true;
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
  }, { phase: "jail" });
  await act(jail, "jail.pay");
  current = await jail.store.getSession(jail.session.sessionId);
  assert.equal(current.state.public.turn.phase, "obligation");
  assert.equal(current.state.players.p1.flags.inJail, true);
  await act(jail, "property.mortgage", { cellId: "cell-01" });
  await act(jail, "obligation.resolve");
  current = await jail.store.getSession(jail.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 15);
  assert.equal(current.state.players.p1.flags.inJail, false);
  assert.equal(current.state.public.turn.phase, "roll");
});

test("S5 pay-each and collect-each obligations preserve full multi-party payment semantics", async () => {
  const payEach = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p1.metrics.cash = 5;
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
    installDecks(state, { fundOrder: orderedDeck(fundCardIds, "fund-pay-each") });
  }, { participantCount: 6, phase: "roll", samples: [0, 1] });
  await act(payEach, "turn.roll");
  let current = await payEach.store.getSession(payEach.session.sessionId);
  assert.equal(current.state.public.obligation.reason, "card-pay-each");
  assert.equal(current.state.public.obligation.amount, 50);
  assert.ok(["p2", "p3", "p4", "p5", "p6"].every((id) => current.state.players[id].metrics.cash === 1200));
  await act(payEach, "property.mortgage", { cellId: "cell-05" });
  const beforeResolve = await payEach.store.getSession(payEach.session.sessionId);
  const commandId = createTestCommandId();
  const resolved = await act(payEach, "obligation.resolve", {}, {
    commandId,
    expectedStateVersion: beforeResolve.version.stateVersion
  });
  assert.equal(resolved.result.ok, true, JSON.stringify(resolved.result));
  const retried = await act(payEach, "obligation.resolve", {}, {
    commandId,
    expectedStateVersion: beforeResolve.version.stateVersion
  });
  assert.deepEqual(retried.receipt, resolved.receipt);
  current = await payEach.store.getSession(payEach.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 35);
  assert.ok(["p2", "p3", "p4", "p5", "p6"].every((id) => current.state.players[id].metrics.cash === 1210));
  assert.equal(current.state.public.turn.phase, "finish");

  const collectEach = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p2.metrics.cash = 5;
    state.public.board.availableActions = [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }];
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p2";
    installDecks(state, { fundOrder: orderedDeck(fundCardIds, "fund-collect-each") });
  }, { phase: "roll", samples: [0, 1] });
  await act(collectEach, "turn.roll");
  current = await collectEach.store.getSession(collectEach.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.public.turn.phase, "obligation");
  assert.equal(current.state.public.obligation.reason, "card-collect-each");
  assert.equal(current.state.players.p1.metrics.cash, 1200);
  await act(collectEach, "property.mortgage", { cellId: "cell-05" });
  await act(collectEach, "obligation.resolve");
  current = await collectEach.store.getSession(collectEach.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 1210);
  assert.equal(current.state.players.p2.metrics.cash, 75);
  assert.equal(current.state.public.turn.activePlayerId, "p1");
  assert.equal(current.state.public.turn.phase, "finish");
  assert.equal(current.state.public.obligation.status, "idle");
});

test("S5 bankruptcy rejects remaining liquidity, transfers to a player or bank, and skips eliminated turns", async () => {
  const liquid = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
  }, { phase: "rent" });
  await act(liquid, "property.rent");
  await assertRejectedAction(act(liquid, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" }), /BANKRUPTCY_LIQUIDITY_REMAINS/);

  const creditor = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
    state.public.objects.boardCells["cell-05"].attributes.mortgaged = true;
  }, { participantCount: 3, phase: "rent" });
  const creditorRent = await act(creditor, "property.rent");
  assert.equal(creditorRent.result.ok, true, JSON.stringify(creditorRent.result));
  let current = await creditor.store.getSession(creditor.session.sessionId);
  assert.equal(current.state.public.turn.phase, "obligation", JSON.stringify(current.state.public.obligation));
  await act(creditor, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  current = await creditor.store.getSession(creditor.session.sessionId);
  assert.equal(current.state.players.p1.status, "eliminated");
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId, "p2");
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.public.turn.phase, "liquidationMortgage");
  assert.equal(current.state.public.liquidation.pendingCellId, "cell-05");
  const transferFee = current.state.public.objects.boardCells["cell-05"].attributes.transferFee;
  await act(creditor, "mortgage.transfer.keep");
  current = await creditor.store.getSession(creditor.session.sessionId);
  assert.equal(current.state.players.p2.metrics.cash, 1200 - transferFee);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.mortgaged, true);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.mortgageTransferPending, false);
  assert.equal(current.state.public.turn.phase, "finish");

  const bank = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p1.metrics.cash = 0;
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p1";
    state.public.objects.boardCells["cell-01"].attributes.mortgaged = true;
  }, { participantCount: 3, phase: "tax" });
  await act(bank, "tax.pay");
  const bankBaseDeclared = await act(bank, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  assert.equal(bankBaseDeclared.result.ok, true, JSON.stringify(bankBaseDeclared));
  current = await bank.store.getSession(bank.session.sessionId);
  assert.equal(current.state.players.p1.status, "eliminated");
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId, null);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.mortgaged, false);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.liquidationPending, true);
  assert.equal(current.state.public.turn.phase, "auction");
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  await act(bank, "property.auction.pass");
  await act(bank, "property.auction.pass");
  current = await bank.store.getSession(bank.session.sessionId);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId, null);
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.liquidationPending, false);
  assert.equal(current.state.public.liquidation.status, "idle");
  assert.equal(current.state.public.turn.phase, "finish");

  const skip = await createPhaseReplay((state) => {
    state.players.p2.status = "eliminated";
  }, { participantCount: 3, phase: "finish" });
  await act(skip, "turn.finish");
  current = await skip.store.getSession(skip.session.sessionId);
  assert.equal(current.state.public.turn.activePlayerId, "p3");
});

test("S5 creditor inherits held cards and bank bankruptcy returns both cards then auctions every asset", async () => {
  const creditor = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.players.p1.objects.heldExitCardId = "event-exit";
    state.players.p1.objects.heldExitCardId2 = "fund-exit";
    installDecks(state, {
      eventOrder: eventCardIds.filter((cardId) => cardId !== "event-exit"),
      eventHeld: ["event-exit"],
      fundOrder: fundCardIds.filter((cardId) => cardId !== "fund-exit"),
      fundHeld: ["fund-exit"]
    });
  }, { participantCount: 3, phase: "rent" });
  await act(creditor, "property.rent");
  const declared = await act(creditor, "bankruptcy.declare", {
    heldCardId: "event-exit",
    heldCardId2: "fund-exit"
  });
  assert.equal(declared.result.ok, true, JSON.stringify(declared.result));
  let current = await creditor.store.getSession(creditor.session.sessionId);
  assert.equal(current.state.public.turn.phase, "liquidationClaim");
  assert.equal(current.state.public.turn.activePlayerId, "p2");
  assert.equal(current.state.players.p1.objects.heldExitCardId, null);
  assert.equal(current.state.players.p1.objects.heldExitCardId2, null);
  await act(creditor, "liquidation.card.claim");
  current = await creditor.store.getSession(creditor.session.sessionId);
  assert.equal(current.state.players.p2.objects.heldExitCardId, "event-exit");
  assert.equal(current.state.players.p2.objects.heldExitCardId2, "fund-exit");
  assert.deepEqual(current.state.secret.decks.event.held, ["event-exit"]);
  assert.deepEqual(current.state.secret.decks.fund.held, ["fund-exit"]);
  assert.equal(current.state.public.turn.phase, "finish");

  const bank = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p1.metrics.cash = 0;
    for (const cellId of ["cell-01", "cell-05"]) {
      state.public.objects.boardCells[cellId].attributes.ownerPlayerId = "p1";
      state.public.objects.boardCells[cellId].attributes.mortgaged = true;
    }
    state.players.p1.objects.heldExitCardId = "event-exit";
    state.players.p1.objects.heldExitCardId2 = "fund-exit";
    installDecks(state, {
      eventOrder: eventCardIds.filter((cardId) => cardId !== "event-exit"),
      eventHeld: ["event-exit"],
      fundOrder: fundCardIds.filter((cardId) => cardId !== "fund-exit"),
      fundHeld: ["fund-exit"]
    });
  }, { participantCount: 3, phase: "tax" });
  await act(bank, "tax.pay");
  const bankDeclared = await act(bank, "bankruptcy.declare", {
    heldCardId: "event-exit",
    heldCardId2: "fund-exit"
  });
  assert.equal(bankDeclared.result.ok, true, JSON.stringify(bankDeclared.result));
  current = await bank.store.getSession(bank.session.sessionId);
  assert.deepEqual(current.state.secret.decks.event.held, []);
  assert.deepEqual(current.state.secret.decks.fund.held, []);
  assert.deepEqual(current.state.secret.decks.event.discard, ["event-exit"]);
  assert.deepEqual(current.state.secret.decks.fund.discard, ["fund-exit"]);
  for (let lotPass = 0; lotPass < 4; lotPass += 1) {
    await act(bank, "property.auction.pass");
  }
  current = await bank.store.getSession(bank.session.sessionId);
  assert.equal(current.state.public.liquidation.status, "idle");
  assert.equal(current.state.public.turn.phase, "finish");
  for (const cellId of ["cell-01", "cell-05"]) {
    assert.equal(current.state.public.objects.boardCells[cellId].attributes.ownerPlayerId, null);
    assert.equal(current.state.public.objects.boardCells[cellId].attributes.liquidationPending, false);
  }
});

test("S5 mortgage transfer accepts exact cash and resumes liquidation after a fee obligation", async () => {
  const createTransferReplay = (creditorCash) => createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.players.p2.metrics.cash = creditorCash;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
    state.public.objects.boardCells["cell-05"].attributes.mortgaged = true;
  }, { participantCount: 3, phase: "rent" });

  const exact = await createTransferReplay(8);
  await act(exact, "property.rent");
  await act(exact, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  await act(exact, "mortgage.transfer.keep");
  let current = await exact.store.getSession(exact.session.sessionId);
  assert.equal(current.state.players.p2.metrics.cash, 0);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.mortgageTransferPending, false);
  assert.equal(current.state.public.turn.phase, "finish");

  const obligated = await createTransferReplay(0);
  let session = await obligated.store.getSession(obligated.session.sessionId);
  session.state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId = "p2";
  session.version.stateVersion += 1;
  session.updatedAt = new Date();
  await obligated.store.updateSession(session, {
    expectedStateVersion: session.version.stateVersion - 1
  });
  await act(obligated, "property.rent");
  await act(obligated, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  await act(obligated, "mortgage.transfer.keep");
  current = await obligated.store.getSession(obligated.session.sessionId);
  assert.equal(current.state.public.turn.phase, "obligation");
  assert.equal(current.state.public.obligation.reason, "mortgage-transfer");
  assert.equal(current.state.public.obligation.amount, 8);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.mortgageTransferPending, true);
  await act(obligated, "property.mortgage", { cellId: "cell-02" });
  await act(obligated, "obligation.resolve");
  current = await obligated.store.getSession(obligated.session.sessionId);
  assert.equal(current.state.players.p2.metrics.cash, 52);
  assert.equal(current.state.public.obligation.status, "idle");
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.mortgageTransferPending, false);
  assert.equal(current.state.public.turn.phase, "finish");
});

test("S6 bankruptcy keeps 3-to-2 active and terminals a bounded creditor transcript exactly once", async () => {
  const nonterminal = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
  }, { participantCount: 3, phase: "rent" });
  await act(nonterminal, "property.rent");
  await act(nonterminal, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  let current = await nonterminal.store.getSession(nonterminal.session.sessionId);
  assert.equal(current.state.players.p1.status, "eliminated");
  assert.equal(current.state.public.outcome.status, "active");
  assert.equal(current.state.public.outcome.winnerPlayerId, null);
  assert.equal(current.state.public.outcome.reason, "none");
  assert.equal(current.state.public.turn.phase, "finish");
  assert.deepEqual(current.state.public.board.availableActions.map(({ actionId }) => actionId), [
    "trade.open",
    "turn.finish"
  ]);
  assert.equal((await nonterminal.store.getSessionEvents(nonterminal.session.sessionId))
    .filter(({ eventType }) => eventType === "estate-race.terminal").length, 0);

  const clonedInitialManifest = await compileClonedInitialManifest();
  const transcript = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 1;
    state.players.p1.metrics.cash = 0;
    state.players.p2.metrics.cash = 0;
    state.public.board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
    state.public.objects.boardCells["cell-01"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId = "p2";
    state.public.objects.boardCells["cell-05"].attributes.ownerPlayerId = "p1";
    state.public.objects.boardCells["cell-05"].attributes.mortgaged = true;
    state.players.p1.objects.heldExitCardId = "event-exit";
    installDecks(state, {
      eventOrder: eventCardIds.filter((cardId) => cardId !== "event-exit"),
      eventHeld: ["event-exit"]
    });
  }, { manifest: clonedInitialManifest, phase: "rent" });

  await act(transcript, "property.rent");
  await act(transcript, "bankruptcy.declare", {
    heldCardId: "event-exit",
    heldCardId2: ""
  });
  await act(transcript, "mortgage.transfer.keep");
  current = await transcript.store.getSession(transcript.session.sessionId);
  assert.equal(current.state.public.turn.phase, "obligation");
  assert.equal(current.state.public.outcome.status, "active");
  await act(transcript, "property.mortgage", { cellId: "cell-02" });
  await act(transcript, "obligation.resolve");
  current = await transcript.store.getSession(transcript.session.sessionId);
  assert.equal(
    current.state.public.turn.phase,
    "liquidationClaim",
    JSON.stringify({
      liquidation: current.state.public.liquidation,
      obligation: current.state.public.obligation,
      creditorCards: current.state.players.p2.objects
    })
  );
  assert.equal(current.state.public.outcome.status, "active");

  const beforeClaim = await transcript.store.getSession(transcript.session.sessionId);
  const commandId = createTestCommandId();
  const first = await act(transcript, "liquidation.card.claim", {}, {
    commandId,
    expectedStateVersion: beforeClaim.version.stateVersion
  });
  assert.equal(first.result.ok, true, JSON.stringify(first.result));
  const retry = await act(transcript, "liquidation.card.claim", {}, {
    commandId,
    expectedStateVersion: beforeClaim.version.stateVersion
  });
  assert.deepEqual(retry.receipt, first.receipt);

  current = await transcript.store.getSession(transcript.session.sessionId);
  assert.equal(current.state.players.p1.status, "eliminated");
  assert.equal(current.state.public.outcome.status, "terminal");
  assert.equal(current.state.public.outcome.winnerPlayerId, "p2");
  assert.equal(current.state.public.outcome.reason, "last-active-player");
  assert.equal(current.state.public.turn.phase, "terminal");
  assert.deepEqual(current.state.public.board.availableActions, []);
  assert.equal(current.state.players.p2.objects.heldExitCardId, "event-exit");
  const terminalEvents = (await transcript.store.getSessionEvents(transcript.session.sessionId))
    .filter(({ eventType }) => eventType === "estate-race.terminal");
  assert.equal(terminalEvents.length, 1);
  assert.equal(terminalEvents[0].data.winnerPlayerId, "p2");
  assert.equal(terminalEvents[0].data.reason, "last-active-player");
});

test("S6 bank liquidation finishes every lot before terminal and rejects a prior action unchanged", async () => {
  const replay = await createPhaseReplay((state) => {
    state.players.p1.metrics.position = 4;
    state.players.p1.metrics.cash = 0;
    for (const cellId of ["cell-01", "cell-05"]) {
      state.public.objects.boardCells[cellId].attributes.ownerPlayerId = "p1";
      state.public.objects.boardCells[cellId].attributes.mortgaged = true;
    }
  }, { phase: "tax" });
  await act(replay, "tax.pay");
  await act(replay, "bankruptcy.declare", { heldCardId: "", heldCardId2: "" });
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "auction");
  assert.equal(current.state.public.outcome.status, "active");

  await act(replay, "property.auction.pass");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.turn.phase, "auction");
  assert.equal(current.state.public.outcome.status, "active");
  assert.equal(current.state.public.objects.boardCells["cell-01"].attributes.liquidationPending, false);
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.liquidationPending, true);
  assert.equal((await replay.store.getSessionEvents(replay.session.sessionId))
    .filter(({ eventType }) => eventType === "estate-race.terminal").length, 0);

  await act(replay, "property.auction.pass");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.public.liquidation.status, "idle");
  assert.equal(current.state.public.objects.boardCells["cell-05"].attributes.liquidationPending, false);
  assert.equal(current.state.public.outcome.status, "terminal");
  assert.equal(current.state.public.outcome.winnerPlayerId, "p2");
  assert.equal(current.state.public.turn.phase, "terminal");
  assert.deepEqual(current.state.public.board.availableActions, []);
  assert.equal((await replay.store.getSessionEvents(replay.session.sessionId))
    .filter(({ eventType }) => eventType === "estate-race.terminal").length, 1);

  const terminalSnapshot = structuredClone(current);
  await assertRejectedAction(
    act(replay, "property.auction.pass"),
    /ACTION|available|terminal/iu
  );
  const afterRejected = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(afterRejected.state, terminalSnapshot.state);
  assert.equal(afterRejected.version.stateVersion, terminalSnapshot.version.stateVersion);
  assert.equal((await replay.store.getSessionEvents(replay.session.sessionId))
    .filter(({ eventType }) => eventType === "estate-race.terminal").length, 1);
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
