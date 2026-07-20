/**
 * Focused Runtime proof for normal cargo loading and atomic settlement.
 *
 * The still-unimplemented market boundary is represented only by a direct
 * initial phase in fresh in-memory sessions. Every behavior under test then
 * executes through the normal protected dispatcher and the compiled immutable
 * game bundle. Rejected commands must leave both state and optimistic version
 * byte-for-byte unchanged.
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
import { buildLifecycleAuthoring } from "./build-card-lifecycle.mjs";
import {
  authoringPath,
  buildCargoSettlementAuthoring
} from "./build-cargo-settlement.mjs";
import { buildMovementOrderAuthoring } from "./build-movement-order.mjs";
import { buildOperatingTurnAuthoring } from "./build-operating-turn.mjs";
import { buildSessionSetupAuthoring } from "./build-session-setup.mjs";
import { buildTrainFormationAuthoring } from "./build-train-formation.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const fixtureRoot = path.join(gameRoot, "authoring", "fixtures");
const credentialSha256 = "c".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

/** Produce one valid command id for the real dispatcher. */
const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

const { compileAuthoringText } = authoringCompiler;
const loadManifest = async () => {
  const output = compileAuthoringText(
    {
      kind: "game",
      sourceFile: authoringPath,
      outputFile: path.join(repoRoot, ".tmp", "cmt-cargo-settlement.manifest.json"),
      sourceMapFile: path.join(
        repoRoot,
        ".tmp",
        "cmt-cargo-settlement.manifest.source-map.json"
      )
    },
    await readFile(authoringPath, "utf8")
  );
  return validateGameManifest(output.manifest);
};

const loadTechnicalObjects = async () => {
  const fixture = await readJson(
    path.join(fixtureRoot, "real-operating-turn.technical.json")
  );
  return structuredClone(fixture.objects);
};

/**
 * Build the smallest normal-fixture state at an explicitly selected boundary.
 *
 * The fixture supplies real author cargo and real network ids. Setting a phase
 * here substitutes only the missing market transition; it does not perform or
 * bypass the load/delivery behavior under test.
 */
const stateAtPhase = async (manifest, phase) => {
  const state = structuredClone(manifest.state);
  state.public.session.fixtureId = "normal-start-policy";
  state.public.session.phase = phase;
  state.public.session.turnNumber = 2;
  state.public.session.status = "running";
  state.public.objects = await loadTechnicalObjects();
  for (const wagon of Object.values(state.public.objects.wagons)) {
    wagon.attributes.cargoOfferEligibleTurn ??= 0;
    wagon.attributes.cargoOfferResolvedTurn ??= 0;
    wagon.attributes.cargoPriorityActiveCount ??= 0;
  }
  for (const [nodeId, node] of Object.entries(state.public.objects.networkNodes)) {
    node.attributes.cargoDeckId =
      /^terminal-(?:[1-9]|1[0-9]|2[0-3])$/u.test(nodeId)
        ? nodeId
        : null;
  }
  state.public.log = [];
  state.public.cards.cargo.offer.terminalId = null;
  state.public.cards.cargo.offer.firstCardId = null;
  state.public.cards.cargo.offer.secondCardId = null;
  state.public.turnEffects.deliveryPayoutBonus = 0;
  return state;
};

/** Materialize a cargo already carried by the fixture train at destination. */
const prepareDeliveryState = async (manifest) => {
  const state = await stateAtPhase(manifest, "settlement");
  const cargo =
    state.public.objects.cargoOrders["cargo-source-row-005"];
  const wagon =
    state.public.objects.wagons["technical-wagon-white-1"];
  const locomotive =
    state.public.objects.locomotives["technical-locomotive-purple-1"];
  cargo.facets.status = "in_transit";
  cargo.attributes.holderTeamId = "white-logistics";
  wagon.attributes.cargoId = "cargo-source-row-005";
  wagon.attributes.attachedVehicleId = "technical-locomotive-purple-1";
  wagon.attributes.nodeId = "terminal-9";
  locomotive.attributes.nodeId = "terminal-9";
  return state;
};

const createSession = async (manifest, initialState) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(initialState),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "cargo-settlement-test-facilitator",
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

/**
 * Move only between test scenario boundaries while preserving optimistic
 * versioning. Gameplay effects themselves still run through Runtime actions.
 */
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

/** Rejection includes schema, plan and runtime failures, but never mutation. */
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

test("six game-local generators preserve the complete cargo-settlement authoring", async () => {
  const [actual, intake, network] = await Promise.all([
    readJson(authoringPath),
    readJson(path.join(fixtureRoot, "cargo-news.intake.json")),
    readJson(path.join(gameRoot, "annotations", "initial-network.review.json"))
  ]);

  assert.deepEqual(buildSessionSetupAuthoring(actual, network), actual);
  assert.deepEqual(buildLifecycleAuthoring(actual, intake), actual);
  assert.deepEqual(buildOperatingTurnAuthoring(actual), actual);
  assert.deepEqual(buildMovementOrderAuthoring(actual), actual);
  assert.deepEqual(buildTrainFormationAuthoring(actual), actual);
  assert.deepEqual(buildCargoSettlementAuthoring(actual), actual);

  const actionById = new Map(
    actual.root.logic.actions.map((candidate) => [candidate.id, candidate])
  );
  assert.deepEqual(
    actionById.get("cargo.load").paramsSchema.required,
    ["wagonId", "cargoId"]
  );
  assert.deepEqual(
    actionById.get("settlement.cargo.deliver").paramsSchema.required,
    ["wagonId"]
  );
  assert.equal(
    actionById.get("cargo.load").paramsSchema.additionalProperties,
    false
  );
  assert.equal(
    actual.root.content.data.cargoSettlement.tariffPerShortestOpenEdge,
    2
  );
  assert.equal(
    actual.root.config.runtimeBlockers.includes(
      "remaining market and reporting workflows"
    ),
    true
  );
  assert.equal(actual.root.logic.actions.length, 82);
  assert.equal(Object.keys(actual.root.mechanics.plans).length, 82);
});

test("normal load derives ownership and journals the confirmed cargo relation", async () => {
  const manifest = await loadManifest();
  const session = await createSession(
    manifest,
    await stateAtPhase(manifest, "cargo")
  );
  const outcome = await dispatch({
    ...session,
    actionId: "cargo.load",
    params: {
      wagonId: "technical-wagon-white-1",
      cargoId: "cargo-source-row-005"
    }
  });
  assert.equal(outcome.result.ok, true);

  const after = await session.store.getSession(session.sessionId);
  assert.equal(
    after.state.public.objects.wagons["technical-wagon-white-1"]
      .attributes.cargoId,
    "cargo-source-row-005"
  );
  assert.equal(
    after.state.public.objects.cargoOrders["cargo-source-row-005"]
      .facets.status,
    "in_transit"
  );
  assert.deepEqual(after.state.public.log.at(-1), {
    eventType: "cargo.loaded",
    summary: "Груз загружен в вагон логистической компании",
    audience: "public",
    data: {
      kind: "cargo-load",
      cargoId: "cargo-source-row-005",
      wagonId: "technical-wagon-white-1",
      logisticsTeamId: "white-logistics",
      originNodeId: "terminal-1",
      turnNumber: 2
    }
  });
});

test("load rejects forged, incompatible and closed-state inputs atomically", async () => {
  const manifest = await loadManifest();
  const variants = [
    {
      name: "wrong phase",
      mutate: (state) => { state.public.session.phase = "operations"; },
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005"
      }
    },
    {
      name: "forged extra authority",
      mutate: () => {},
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005",
        teamId: "white-logistics"
      }
    },
    {
      name: "holder does not own wagon",
      mutate: (state) => {
        state.public.objects.cargoOrders["cargo-source-row-005"]
          .attributes.holderTeamId = "purple-guild";
      },
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005"
      }
    },
    {
      name: "closed origin",
      mutate: (state) => {
        state.public.objects.networkNodes["terminal-1"]
          .facets.availability = "blocked";
      },
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005"
      }
    },
    {
      name: "occupied wagon",
      mutate: (state) => {
        state.public.objects.wagons["technical-wagon-white-1"]
          .attributes.cargoId = "another-cargo";
      },
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005"
      }
    }
  ];

  for (const variant of variants) {
    const state = await stateAtPhase(manifest, "cargo");
    variant.mutate(state);
    const session = await createSession(manifest, state);
    await assertRejectedWithoutMutation(session, {
      actionId: "cargo.load",
      params: variant.params
    });
  }
});

test("cargo finish permits a held card but rejects every unresolved offer", async () => {
  const manifest = await loadManifest();
  const cleanState = await stateAtPhase(manifest, "cargo");
  cleanState.public.cards.cargo.preparedTurn =
    cleanState.public.session.turnNumber;
  const cleanSession = await createSession(
    manifest,
    cleanState
  );
  const finished = await dispatch({
    ...cleanSession,
    actionId: "cargo.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const cleanAfter = await cleanSession.store.getSession(cleanSession.sessionId);
  assert.equal(cleanAfter.state.public.session.phase, "movement-order");
  assert.equal(cleanAfter.state.public.log.at(-1).eventType, "cargo.phase.finished");

  const unresolvedState = await stateAtPhase(manifest, "cargo");
  unresolvedState.public.cards.cargo.preparedTurn =
    unresolvedState.public.session.turnNumber;
  unresolvedState.public.objects.cargoOrders["cargo-source-row-005"]
    .facets.status = "offered";
  unresolvedState.public.cards.cargo.offer.terminalId = "terminal-1";
  unresolvedState.public.cards.cargo.offer.firstCardId = "cargo-source-row-005";
  const unresolvedSession = await createSession(manifest, unresolvedState);
  await assertRejectedWithoutMutation(unresolvedSession, {
    actionId: "cargo.phase.finish"
  });
});

test("delivery pays bank then tariff, explains the route and releases ownership", async () => {
  const manifest = await loadManifest();
  const state = await prepareDeliveryState(manifest);
  state.public.turnEffects.deliveryPayoutBonus = 3;
  const session = await createSession(manifest, state);
  const outcome = await dispatch({
    ...session,
    actionId: "settlement.cargo.deliver",
    params: { wagonId: "technical-wagon-white-1" }
  });
  assert.equal(outcome.result.ok, true);

  const after = await session.store.getSession(session.sessionId);
  const objects = after.state.public.objects;
  assert.equal(objects.teams["white-logistics"].attributes.coins, 24);
  assert.equal(objects.teams["purple-guild"].attributes.coins, 12);
  assert.equal(
    objects.wagons["technical-wagon-white-1"].attributes.cargoId,
    null
  );
  assert.equal(
    objects.wagons["technical-wagon-white-1"].attributes.attachedVehicleId,
    null
  );
  assert.equal(
    objects.cargoOrders["cargo-source-row-005"].facets.status,
    "delivered"
  );
  assert.equal(
    objects.cargoOrders["cargo-source-row-005"].attributes.holderTeamId,
    null
  );
  assert.equal(
    objects.cargoOrders["cargo-source-row-005"].attributes.settledRouteLength,
    1
  );
  assert.deepEqual(after.state.public.log.at(-1), {
    eventType: "cargo.delivered",
    summary: "Груз доставлен, банковская выплата и тариф рассчитаны",
    audience: "public",
    data: {
      kind: "cargo-delivery",
      cargoId: "cargo-source-row-005",
      wagonId: "technical-wagon-white-1",
      locomotiveId: "technical-locomotive-purple-1",
      logisticsTeamId: "white-logistics",
      guildTeamId: "purple-guild",
      originNodeId: "terminal-1",
      destinationNodeId: "terminal-9",
      basePayout: 13,
      payoutBonus: 3,
      grossPayout: 16,
      routeLength: 1,
      tariffPerEdge: 2,
      tariffTotal: 2,
      turnNumber: 2
    }
  });
});

test("news 23 reduces the same turn delivery payout through the normal action path", async () => {
  const manifest = await loadManifest();
  const state = await prepareDeliveryState(manifest);
  state.public.session.phase = "news";
  state.public.cards.initialized = true;
  // The compact operating-turn fixture intentionally omits news objects.
  // Reattach the real compiled catalogue solely to select the exact card; the
  // effect and later settlement remain ordinary protected commands.
  state.public.objects.newsCards = structuredClone(
    manifest.state.public.objects.newsCards
  );
  state.public.news.currentCardId = "news-23";
  state.public.news.status = "drawn";
  state.public.objects.newsCards["news-23"].facets.availability = "current";

  const session = await createSession(manifest, state);
  const applied = await dispatch({
    ...session,
    actionId: "news.effect.apply.23"
  });
  assert.equal(applied.result.ok, true);
  let current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.turnEffects.deliveryPayoutBonus, -2);
  assert.equal(current.state.public.session.phase, "maintenance");

  await updateScenario(session, (nextState) => {
    nextState.public.session.phase = "settlement";
  });
  const delivered = await dispatch({
    ...session,
    actionId: "settlement.cargo.deliver",
    params: { wagonId: "technical-wagon-white-1" }
  });
  assert.equal(delivered.result.ok, true);

  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.teams["white-logistics"].attributes.coins,
    19
  );
  assert.equal(
    current.state.public.objects.teams["purple-guild"].attributes.coins,
    12
  );
  assert.deepEqual(current.state.public.log.at(-1).data, {
    kind: "cargo-delivery",
    cargoId: "cargo-source-row-005",
    wagonId: "technical-wagon-white-1",
    locomotiveId: "technical-locomotive-purple-1",
    logisticsTeamId: "white-logistics",
    guildTeamId: "purple-guild",
    originNodeId: "terminal-1",
    destinationNodeId: "terminal-9",
    basePayout: 13,
    payoutBonus: -2,
    grossPayout: 11,
    routeLength: 1,
    tariffPerEdge: 2,
    tariffTotal: 2,
    turnNumber: 2
  });
});

test("delivery failures roll bank credit, tariff, relation and journal back together", async () => {
  const manifest = await loadManifest();
  const variants = [
    {
      name: "insufficient after bank payout",
      mutate: (state) => {
        state.public.objects.cargoOrders["cargo-source-row-005"]
          .attributes.payout = 0;
        state.public.objects.teams["white-logistics"].attributes.coins = 0;
      },
      params: { wagonId: "technical-wagon-white-1" }
    },
    {
      name: "blocked destination",
      mutate: (state) => {
        state.public.objects.networkNodes["terminal-9"]
          .facets.availability = "blocked";
      },
      params: { wagonId: "technical-wagon-white-1" }
    },
    {
      name: "blocked only route",
      mutate: (state) => {
        state.public.objects.networkEdges["road-1-9"].facets.state = "blocked";
      },
      params: { wagonId: "technical-wagon-white-1" }
    },
    {
      name: "holder mismatch",
      mutate: (state) => {
        state.public.objects.cargoOrders["cargo-source-row-005"]
          .attributes.holderTeamId = "purple-guild";
      },
      params: { wagonId: "technical-wagon-white-1" }
    },
    {
      name: "missing locomotive relation",
      mutate: (state) => {
        state.public.objects.wagons["technical-wagon-white-1"]
          .attributes.attachedVehicleId = null;
      },
      params: { wagonId: "technical-wagon-white-1" }
    },
    {
      name: "forged cargo parameter",
      mutate: () => {},
      params: {
        wagonId: "technical-wagon-white-1",
        cargoId: "cargo-source-row-005"
      }
    }
  ];

  for (const variant of variants) {
    const state = await prepareDeliveryState(manifest);
    variant.mutate(state);
    const session = await createSession(manifest, state);
    await assertRejectedWithoutMutation(session, {
      actionId: "settlement.cargo.deliver",
      params: variant.params
    });
  }
});

test("settlement finish never deadlocks on an undeliverable cargo", async () => {
  const manifest = await loadManifest();
  const state = await prepareDeliveryState(manifest);
  state.public.objects.cargoOrders["cargo-source-row-005"].attributes.payout = 0;
  state.public.objects.teams["white-logistics"].attributes.coins = 0;
  const session = await createSession(manifest, state);

  await assertRejectedWithoutMutation(session, {
    actionId: "settlement.cargo.deliver",
    params: { wagonId: "technical-wagon-white-1" }
  });
  const finished = await dispatch({
    ...session,
    actionId: "settlement.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.state.public.session.phase, "construction");
  assert.equal(
    after.state.public.objects.cargoOrders["cargo-source-row-005"].facets.status,
    "in_transit"
  );
  assert.deepEqual(after.state.public.log.at(-1), {
    eventType: "settlement.phase.finished",
    summary: "Ведущий завершил расчёты и открыл строительство",
    audience: "public",
    data: {
      kind: "phase",
      turnNumber: 2
    }
  });
});
