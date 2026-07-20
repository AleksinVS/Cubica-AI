/**
 * Focused Runtime proof for dynamic normal-session construction and news 26/27.
 *
 * Authoring is compiled in memory so these tests exercise the exact generic
 * dispatcher and atomic Mechanics executor without rewriting the shared
 * generated manifest. Direct state setup supplies only upstream phase/card
 * conditions; every construction and news behavior runs through Game Intents.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import authoringCompiler from "../../../scripts/manifest-tools/authoring-compiler.cjs";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import {
  authoringPath,
  buildConstructionCycleAuthoring
} from "./build-construction-cycle.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const credentialSha256 = "b".repeat(64);
const { compileAuthoringText } = authoringCompiler;
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;
let manifestPromise;

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Compile once for all behavior tests; the output remains only in memory. */
const loadManifest = async () => {
  manifestPromise ??= (async () => {
    const output = compileAuthoringText(
      {
        kind: "game",
        sourceFile: authoringPath,
        outputFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-construction-cycle.manifest.json"
        ),
        sourceMapFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-construction-cycle.source-map.json"
        )
      },
      await readFile(authoringPath, "utf8")
    );
    return validateGameManifest(output.manifest);
  })();
  return manifestPromise;
};

const teamObject = (id, coins = 100) => ({
  objectType: "game.team",
  facets: { placementStatus: "placed" },
  attributes: {
    label: id,
    type: id.includes("guild")
      ? "locomotive_guild"
      : "logistics_company",
    colorId: "cobalt",
    coins,
    placementOrderKey: 0,
    constructionPledge: 0
  }
});

/** Build a bounded normal-session state with dynamic object-backed teams. */
const constructionState = (manifest, {
  turnNumber = 2,
  teamCoins = [100, 100, 100, 100]
} = {}) => {
  const state = structuredClone(manifest.state);
  state.public.session.fixtureId = "normal-start-policy";
  state.public.session.status = "running";
  state.public.session.phase = "construction";
  state.public.session.turnNumber = turnNumber;
  state.public.construction.available = true;
  state.public.construction.mode = null;
  state.public.construction.totalPledged = 0;
  state.public.turnEffects.firstRoadFreeSegments = 0;
  state.public.log = [];
  state.public.objects.teams = Object.fromEntries(
    teamCoins.map((coins, index) => {
      const id = index % 2 === 0
        ? `team-${index + 1}-logistics`
        : `team-${index + 1}-guild`;
      return [id, teamObject(id, coins)];
    })
  );
  return state;
};

const createSession = async (manifest, state) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "construction-cycle-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

const dispatch = async ({ store, sessionId, actionId, params = {} }) => {
  const current = await store.getSession(sessionId);
  return dispatchRuntimeAction({
    sessionStore: store,
    credentialSha256,
    admissionController,
    input: {
      sessionId,
      actionId,
      commandId: nextCommandId(),
      expectedStateVersion: current.version.stateVersion,
      params
    }
  });
};

/** Change only a bounded upstream fact while preserving state-version rules. */
const updateScenario = async ({ store, sessionId }, mutate) => {
  const current = await store.getSession(sessionId);
  const updated = structuredClone(current);
  mutate(updated.state);
  updated.version.stateVersion += 1;
  updated.updatedAt = new Date();
  await store.updateSession(updated, {
    expectedStateVersion: current.version.stateVersion
  });
};

const assertRejectedWithoutMutation = async (session, input) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const outcome = await dispatch({ ...session, ...input });
    rejected =
      outcome.result.ok === false && outcome.receipt.status === "rejected";
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${input.actionId} must be rejected`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

const teamIds = async (session) =>
  Object.keys(
    (await session.store.getSession(session.sessionId)).state.public.objects.teams
  );

const pledge = async (session, teamId, amount) => {
  const outcome = await dispatch({
    ...session,
    actionId: "construction.contribution.set",
    params: { teamId, amount }
  });
  assert.equal(outcome.result.ok, true);
};

const chooseMode = async (session, mode) => {
  const outcome = await dispatch({
    ...session,
    actionId: `construction.mode.${mode}`
  });
  assert.equal(outcome.result.ok, true);
};

const currentEdges = (state) => state.public.objects.networkEdges;

const prepareCurrentNews = (state, number) => {
  const newsId = `news-${String(number).padStart(2, "0")}`;
  state.public.cards.initialized = true;
  state.public.session.phase = "news";
  state.public.session.turnNumber = 2;
  state.public.news.currentCardId = newsId;
  state.public.news.status = "current";
  state.public.objects.newsCards[newsId].facets.availability = "current";
};

test("construction generator is idempotent and publishes only six dynamic intents", async () => {
  const source = await readJson(authoringPath);
  assert.deepEqual(buildConstructionCycleAuthoring(source), source);

  const manifest = await loadManifest();
  const ids = Object.keys(manifest.actions)
    .filter((id) => id.startsWith("construction."))
    .sort();
  assert.deepEqual(ids, [
    "construction.contribution.set",
    "construction.mode.road",
    "construction.mode.waypoint",
    "construction.phase.finish",
    "construction.road.build",
    "construction.waypoint.build"
  ]);
  assert.deepEqual(
    Object.keys(manifest.actions["construction.road.build"].paramsSchema.properties)
      .sort(),
    ["fromNodeId", "toNodeId"]
  );
  assert.deepEqual(
    Object.keys(manifest.actions["construction.waypoint.build"].paramsSchema.properties)
      .sort(),
    ["edgeId", "positionT"]
  );
  assert.equal(manifest.config.runtimeReady, false);
  assert.equal(
    manifest.content.data.constructionCycle.regionData.replaceBeforePublication,
    true
  );
});

test("pledges are reversible agreements and all debit/create failures are atomic", async () => {
  const manifest = await loadManifest();
  const session = await createSession(
    manifest,
    constructionState(manifest, { teamCoins: [30, 100, 100, 100] })
  );
  const [firstTeam, secondTeam] = await teamIds(session);

  await pledge(session, firstTeam, 3);
  await pledge(session, firstTeam, 5);
  let snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.construction.totalPledged, 5);
  assert.equal(
    snapshot.state.public.objects.teams[firstTeam].attributes.constructionPledge,
    5
  );
  assert.equal(snapshot.state.public.objects.teams[firstTeam].attributes.coins, 30);

  await pledge(session, firstTeam, 0);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.construction.totalPledged, 0);

  await chooseMode(session, "road");
  await pledge(session, firstTeam, 31);
  await assertRejectedWithoutMutation(session, {
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-20",
      toNodeId: "terminal-14"
    }
  });

  await pledge(session, secondTeam, 1);
  await assertRejectedWithoutMutation(session, {
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-20",
      toNodeId: "terminal-14"
    }
  });

  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(Object.keys(currentEdges(snapshot.state)).length, 10);
  assert.equal(snapshot.state.public.turnEffects.firstRoadFreeSegments, 0);
  assert.equal(snapshot.state.public.objects.teams[firstTeam].attributes.coins, 30);
  assert.equal(snapshot.state.public.objects.teams[secondTeam].attributes.coins, 100);
});

test("a building road closes both endpoint stations for movement, loading and delivery", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, constructionState(manifest));
  const [logisticsTeamId, guildTeamId] = await teamIds(session);
  await chooseMode(session, "road");
  await pledge(session, logisticsTeamId, 32);
  const built = await dispatch({
    ...session,
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-20",
      toNodeId: "terminal-14"
    }
  });
  assert.equal(built.result.ok, true);

  let snapshot = await session.store.getSession(session.sessionId);
  for (const nodeId of ["terminal-20", "terminal-14"]) {
    const node = snapshot.state.public.objects.networkNodes[nodeId];
    assert.equal(node.facets.availability, "building");
    assert.equal(node.attributes.activationTurn, 4);
    assert.deepEqual(node.attributes.blockingReasons, ["construction-pending"]);
  }

  await updateScenario(session, (state) => {
    state.public.session.phase = "operations";
    state.public.movement.locomotiveOrder = ["closure-test-locomotive"];
    state.public.movement.currentLocomotiveId = "closure-test-locomotive";
    state.public.objects.locomotives["closure-test-locomotive"] = {
      objectType: "transport.locomotive",
      facets: { availability: "active" },
      attributes: {
        networkId: "main",
        nodeId: "terminal-20",
        ownerTeamId: guildTeamId,
        actionPoints: 5,
        maintenancePaidTurn: 0,
        turnOrderCount: 1,
        movementResolvedTurn: 0,
        lastMovedTurn: 0
      }
    };
    state.public.objects.networkEdges["closure-test-open-edge"] = {
      objectType: "transport.edge",
      facets: { state: "open" },
      attributes: {
        networkId: "main",
        fromNodeId: "terminal-20",
        toNodeId: "terminal-21",
        geometry: {
          from: { x: 921, y: 2329 },
          to: { x: 1012, y: 1322 },
          polyline: [
            { x: 921, y: 2329 },
            { x: 1012, y: 1322 }
          ]
        },
        constructionCost: 0,
        regionSegments: 1,
        discountedRegionSegments: 0,
        payableRegionSegments: 1,
        routePlan: {},
        splitFromEdgeId: "",
        createdTurn: 0,
        activationTurn: 0,
        blockingReasons: []
      }
    };
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "closure-test-open-edge" }
  });

  await updateScenario(session, (state) => {
    state.public.session.phase = "cargo";
    state.public.objects.wagons["closure-test-wagon"] = {
      objectType: "transport.wagon",
      facets: { availability: "active" },
      attributes: {
        networkId: "main",
        nodeId: "terminal-20",
        ownerTeamId: logisticsTeamId,
        attachedVehicleId: null,
        cargoId: null,
        maintenancePaidTurn: 0,
        formationTargetLocomotiveId: null
      }
    };
    const cargo = state.public.objects.cargoOrders["cargo-source-row-005"];
    cargo.facets.status = "held";
    cargo.attributes.fromNodeId = "terminal-20";
    cargo.attributes.toNodeId = "terminal-14";
    cargo.attributes.holderTeamId = logisticsTeamId;
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "cargo.load",
    params: {
      wagonId: "closure-test-wagon",
      cargoId: "cargo-source-row-005"
    }
  });

  await updateScenario(session, (state) => {
    state.public.session.phase = "settlement";
    const locomotive =
      state.public.objects.locomotives["closure-test-locomotive"];
    locomotive.attributes.nodeId = "terminal-14";
    const wagon = state.public.objects.wagons["closure-test-wagon"];
    wagon.attributes.nodeId = "terminal-14";
    wagon.attributes.attachedVehicleId = "closure-test-locomotive";
    wagon.attributes.cargoId = "cargo-source-row-005";
    const cargo = state.public.objects.cargoOrders["cargo-source-row-005"];
    cargo.facets.status = "in_transit";
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "settlement.cargo.deliver",
    params: { wagonId: "closure-test-wagon" }
  });
});

test("overlapping roads extend a shared station closure and preserve news blockers", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, constructionState(manifest));
  const [firstTeam] = await teamIds(session);
  await chooseMode(session, "road");
  await pledge(session, firstTeam, 32);
  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "construction.road.build",
        params: {
          fromNodeId: "terminal-20",
          toNodeId: "terminal-14"
        }
      })
    ).result.ok,
    true
  );

  await updateScenario(session, (state) => {
    state.public.session.turnNumber = 3;
    state.public.session.phase = "construction";
    state.public.construction.available = true;
    state.public.construction.mode = "road";
  });
  await pledge(session, firstTeam, 28);
  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "construction.road.build",
        params: {
          fromNodeId: "terminal-20",
          toNodeId: "terminal-15"
        }
      })
    ).result.ok,
    true
  );

  let snapshot = await session.store.getSession(session.sessionId);
  const sharedNode =
    snapshot.state.public.objects.networkNodes["terminal-20"];
  assert.equal(sharedNode.attributes.activationTurn, 5);
  assert.deepEqual(sharedNode.attributes.blockingReasons, [
    "construction-pending"
  ]);

  await dispatch({ ...session, actionId: "construction.phase.finish" });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.turnNumber, 4);
  assert.equal(
    snapshot.state.public.objects.networkNodes["terminal-14"]
      .facets.availability,
    "open"
  );
  assert.equal(
    snapshot.state.public.objects.networkNodes["terminal-20"]
      .facets.availability,
    "building"
  );
  assert.deepEqual(
    snapshot.state.public.objects.networkNodes["terminal-20"]
      .attributes.blockingReasons,
    ["construction-pending"]
  );

  await updateScenario(session, (state) => {
    state.public.session.phase = "reporting";
    state.public.construction.available = false;
    state.public.construction.mode = null;
    state.public.objects.networkNodes["terminal-20"]
      .attributes.blockingReasons.push("news-test");
  });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.turnNumber, 5);
  assert.deepEqual(
    snapshot.state.public.objects.networkNodes["terminal-20"]
      .attributes.blockingReasons,
    ["news-test"]
  );
  assert.notEqual(
    snapshot.state.public.objects.networkNodes["terminal-20"]
      .facets.availability,
    "open"
  );
  assert.equal(
    snapshot.state.public.objects.networkNodes["terminal-15"]
      .facets.availability,
    "open"
  );
});

test("news 26 survives a waypoint and a failed road, then discounts only the first successful road", async () => {
  const manifest = await loadManifest();
  const state = constructionState(manifest);
  prepareCurrentNews(state, 26);
  const session = await createSession(manifest, state);

  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "news.effect.apply.26"
      })
    ).result.ok,
    true
  );
  await updateScenario(session, (next) => {
    next.public.session.phase = "construction";
    next.public.construction.available = true;
  });
  const [firstTeam, secondTeam] = await teamIds(session);

  await chooseMode(session, "waypoint");
  await pledge(session, firstTeam, 3);
  await pledge(session, secondTeam, 2);
  const beforeSplit = await session.store.getSession(session.sessionId);
  const sourceEdgeCount = Object.keys(currentEdges(beforeSplit.state)).length;
  const waypointOutcome = await dispatch({
    ...session,
    actionId: "construction.waypoint.build",
    params: {
      edgeId: "road-6-waypoint-9-3-4",
      positionT: 0.5
    }
  });
  assert.equal(
    waypointOutcome.result.ok,
    true,
    JSON.stringify(waypointOutcome)
  );
  let snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.turnEffects.firstRoadFreeSegments, 6);
  assert.equal(Object.keys(currentEdges(snapshot.state)).length, sourceEdgeCount + 1);
  assert.equal(snapshot.state.public.session.phase, "construction");

  await chooseMode(session, "road");
  await pledge(session, firstTeam, 19);
  await assertRejectedWithoutMutation(session, {
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-20",
      toNodeId: "terminal-14"
    }
  });
  assert.equal(
    (await session.store.getSession(session.sessionId))
      .state.public.turnEffects.firstRoadFreeSegments,
    6
  );

  await pledge(session, firstTeam, 20);
  const firstRoad = await dispatch({
    ...session,
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-20",
      toNodeId: "terminal-14"
    }
  });
  assert.equal(firstRoad.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  const discountedRoad = Object.values(currentEdges(snapshot.state))
    .find((edge) =>
      edge.attributes.fromNodeId === "terminal-20"
      && edge.attributes.toNodeId === "terminal-14"
    );
  assert.ok(discountedRoad);
  assert.equal(discountedRoad.attributes.regionSegments, 16);
  assert.equal(discountedRoad.attributes.discountedRegionSegments, 6);
  assert.equal(discountedRoad.attributes.payableRegionSegments, 10);
  assert.equal(discountedRoad.attributes.constructionCost, 20);
  assert.equal(snapshot.state.public.turnEffects.firstRoadFreeSegments, 0);

  await pledge(session, firstTeam, 28);
  const secondRoad = await dispatch({
    ...session,
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-21",
      toNodeId: "terminal-15"
    }
  });
  assert.equal(secondRoad.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  const fullPriceRoad = Object.values(currentEdges(snapshot.state))
    .find((edge) =>
      edge.attributes.fromNodeId === "terminal-21"
      && edge.attributes.toNodeId === "terminal-15"
    );
  assert.ok(fullPriceRoad);
  assert.equal(fullPriceRoad.attributes.regionSegments, 14);
  assert.equal(fullPriceRoad.attributes.discountedRegionSegments, 0);
  assert.equal(fullPriceRoad.attributes.constructionCost, 28);
  assert.equal(snapshot.state.public.session.phase, "construction");

  await pledge(session, secondTeam, 4);
  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "construction.phase.finish"
      })
    ).result.ok,
    true
  );
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "reporting");
  assert.equal(snapshot.state.public.construction.totalPledged, 0);
  for (const team of Object.values(snapshot.state.public.objects.teams)) {
    assert.equal(team.attributes.constructionPledge, 0);
  }
});

test("news 26 makes a one-region first road free and expires unused at the next news boundary", async () => {
  const manifest = await loadManifest();
  const state = constructionState(manifest);
  prepareCurrentNews(state, 26);
  const session = await createSession(manifest, state);
  await dispatch({ ...session, actionId: "news.effect.apply.26" });
  await updateScenario(session, (next) => {
    next.public.session.phase = "construction";
    next.public.construction.available = true;
  });
  await chooseMode(session, "road");
  const built = await dispatch({
    ...session,
    actionId: "construction.road.build",
    params: {
      fromNodeId: "terminal-12",
      toNodeId: "terminal-22"
    }
  });
  assert.equal(built.result.ok, true);
  const snapshot = await session.store.getSession(session.sessionId);
  const edge = Object.values(currentEdges(snapshot.state))
    .find((candidate) =>
      candidate.attributes.fromNodeId === "terminal-12"
      && candidate.attributes.toNodeId === "terminal-22"
    );
  assert.equal(edge.attributes.regionSegments, 1);
  assert.equal(edge.attributes.discountedRegionSegments, 1);
  assert.equal(edge.attributes.payableRegionSegments, 0);
  assert.equal(edge.attributes.constructionCost, 0);
  assert.equal(snapshot.state.public.turnEffects.firstRoadFreeSegments, 0);

  const unusedState = constructionState(manifest);
  unusedState.public.turnEffects.firstRoadFreeSegments = 6;
  unusedState.public.cards.initialized = true;
  unusedState.public.session.phase = "news";
  unusedState.public.session.turnNumber = 3;
  unusedState.public.news.currentCardId = null;
  unusedState.public.news.remaining = 0;
  const unusedSession = await createSession(manifest, unusedState);
  assert.equal(
    (
      await dispatch({
        ...unusedSession,
        actionId: "news.lifecycle.stagnation"
      })
    ).result.ok,
    true
  );
  assert.equal(
    (await unusedSession.store.getSession(unusedSession.sessionId))
      .state.public.turnEffects.firstRoadFreeSegments,
    0
  );
});

test("waypoint validation and split remain atomic and preserve independent blockers", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, constructionState(manifest));
  const [firstTeam] = await teamIds(session);
  await chooseMode(session, "waypoint");
  await pledge(session, firstTeam, 5);
  await assertRejectedWithoutMutation(session, {
    actionId: "construction.waypoint.build",
    params: {
      edgeId: "road-1-2",
      positionT: 0.5
    }
  });

  await updateScenario(session, (state) => {
    const edge = state.public.objects.networkEdges["road-6-waypoint-9-3-4"];
    edge.attributes.blockingReasons = ["manual-review"];
    edge.facets.state = "blocked";
    // The generic graph declaration allows building/open edges. This test
    // uses a manual reason with an open facet so split eligibility remains
    // independent from the reason-set preservation being proved.
    edge.facets.state = "open";
  });
  const outcome = await dispatch({
    ...session,
    actionId: "construction.waypoint.build",
    params: {
      edgeId: "road-6-waypoint-9-3-4",
      positionT: 0.5
    }
  });
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome));
  const snapshot = await session.store.getSession(session.sessionId);
  const children = Object.values(currentEdges(snapshot.state))
    .filter((edge) =>
      edge.attributes.splitFromEdgeId === "road-6-waypoint-9-3-4"
    );
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.deepEqual(
      new Set(child.attributes.blockingReasons),
      new Set(["manual-review", "construction-pending"])
    );
    assert.equal(child.facets.state, "building");
  }
});

test("ordinary construction opens at N+2 while unrelated reasons remain closed", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, constructionState(manifest));
  const [firstTeam] = await teamIds(session);
  await chooseMode(session, "road");
  await pledge(session, firstTeam, 32);
  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "construction.road.build",
        params: {
          fromNodeId: "terminal-20",
          toNodeId: "terminal-14"
        }
      })
    ).result.ok,
    true
  );
  let snapshot = await session.store.getSession(session.sessionId);
  const [edgeId] = Object.entries(currentEdges(snapshot.state))
    .find(([, edge]) =>
      edge.attributes.fromNodeId === "terminal-20"
      && edge.attributes.toNodeId === "terminal-14"
    );
  await dispatch({ ...session, actionId: "construction.phase.finish" });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.turnNumber, 3);
  assert.equal(currentEdges(snapshot.state)[edgeId].facets.state, "building");
  assert.deepEqual(
    currentEdges(snapshot.state)[edgeId].attributes.blockingReasons,
    ["construction-pending"]
  );

  await updateScenario(session, (state) => {
    state.public.session.phase = "reporting";
    state.public.construction.available = false;
    state.public.construction.mode = null;
    const edge = state.public.objects.networkEdges[edgeId];
    edge.attributes.blockingReasons.push("manual-review");
  });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.turnNumber, 4);
  assert.deepEqual(
    currentEdges(snapshot.state)[edgeId].attributes.blockingReasons,
    ["manual-review"]
  );
  assert.equal(currentEdges(snapshot.state)[edgeId].facets.state, "building");

  await updateScenario(session, (state) => {
    state.public.session.phase = "reporting";
    state.public.objects.networkEdges[edgeId].attributes.blockingReasons = [
      "construction-pending"
    ];
  });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(currentEdges(snapshot.state)[edgeId].facets.state, "open");
  assert.deepEqual(
    currentEdges(snapshot.state)[edgeId].attributes.blockingReasons,
    []
  );
});

test("news 27 creates one N+1 road or resolves as an idempotent no-op", async () => {
  const manifest = await loadManifest();
  const state = constructionState(manifest);
  prepareCurrentNews(state, 27);
  const session = await createSession(manifest, state);
  const before = await session.store.getSession(session.sessionId);
  const beforeCount = Object.keys(currentEdges(before.state)).length;
  const applied = await dispatch({
    ...session,
    actionId: "news.effect.apply.27"
  });
  assert.equal(applied.result.ok, true);
  let snapshot = await session.store.getSession(session.sessionId);
  assert.equal(Object.keys(currentEdges(snapshot.state)).length, beforeCount + 1);
  const [governmentEdgeId, governmentEdge] = Object.entries(
    currentEdges(snapshot.state)
  ).find(([, edge]) =>
    edge.attributes.fromNodeId === "terminal-12"
    && edge.attributes.toNodeId === "terminal-22"
  );
  assert.equal(governmentEdge.facets.state, "building");
  assert.equal(governmentEdge.attributes.activationTurn, 3);
  assert.deepEqual(
    governmentEdge.attributes.blockingReasons,
    ["construction-pending"]
  );
  for (const nodeId of ["terminal-12", "terminal-22"]) {
    const node = snapshot.state.public.objects.networkNodes[nodeId];
    assert.equal(node.facets.availability, "building");
    assert.equal(node.attributes.activationTurn, 3);
    assert.deepEqual(node.attributes.blockingReasons, [
      "construction-pending"
    ]);
  }
  assert.equal(snapshot.state.public.news.currentCardId, null);
  assert.equal(snapshot.state.public.session.phase, "maintenance");

  await updateScenario(session, (next) => {
    next.public.session.phase = "reporting";
    next.public.construction.mode = null;
    next.public.construction.available = false;
  });
  await dispatch({ ...session, actionId: "reporting.phase.finish" });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.turnNumber, 3);
  assert.equal(currentEdges(snapshot.state)[governmentEdgeId].facets.state, "open");
  assert.equal(
    snapshot.state.public.objects.networkNodes["terminal-12"]
      .facets.availability,
    "open"
  );
  assert.equal(
    snapshot.state.public.objects.networkNodes["terminal-22"]
      .facets.availability,
    "open"
  );

  const noOpState = constructionState(manifest);
  noOpState.public.objects.networkEdges["existing-government-road"] = {
    objectType: "transport.edge",
    facets: { state: "open" },
    attributes: {
      networkId: "main",
      fromNodeId: "terminal-22",
      toNodeId: "terminal-12",
      geometry: {
        from: { x: 1854, y: 2109 },
        to: { x: 1885, y: 1533 },
        polyline: [
          { x: 1854, y: 2109 },
          { x: 1885, y: 1533 }
        ]
      },
      constructionCost: 0,
      regionSegments: 1,
      discountedRegionSegments: 0,
      payableRegionSegments: 0,
      routePlan: {},
      splitFromEdgeId: "",
      createdTurn: 0,
      activationTurn: 0,
      blockingReasons: []
    }
  };
  prepareCurrentNews(noOpState, 27);
  const noOpSession = await createSession(manifest, noOpState);
  const noOpBefore = await noOpSession.store.getSession(noOpSession.sessionId);
  const noOpResult = await dispatch({
    ...noOpSession,
    actionId: "news.effect.apply.27"
  });
  assert.equal(noOpResult.result.ok, true);
  const noOpAfter = await noOpSession.store.getSession(noOpSession.sessionId);
  assert.equal(
    Object.keys(currentEdges(noOpAfter.state)).length,
    Object.keys(currentEdges(noOpBefore.state)).length
  );
  assert.equal(
    noOpAfter.state.public.transportNetworks.main.sequence,
    noOpBefore.state.public.transportNetworks.main.sequence
  );
  assert.equal(noOpAfter.state.public.news.currentCardId, null);
  assert.equal(noOpAfter.state.public.objects.newsCards["news-27"].facets.availability, "resolved");
});
