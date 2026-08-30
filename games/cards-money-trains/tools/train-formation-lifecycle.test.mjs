/**
 * Focused Runtime proof for refresh-safe group train formation.
 *
 * Public selection, unselection, confirmation and skip all execute through the
 * production dispatcher. Direct store edits are limited to the still-missing
 * market boundary and deliberately invalid negative fixtures. Every rejection
 * proves that state and optimistic version remain byte-for-byte unchanged.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import { materializeLocalSessionParticipants } from "../../../services/runtime-api/src/modules/session/sessionParticipants.ts";
import { buildLifecycleAuthoring } from "./build-card-lifecycle.mjs";
import { buildMovementOrderAuthoring } from "./build-movement-order.mjs";
import { buildOperatingTurnAuthoring } from "./build-operating-turn.mjs";
import {
  buildSessionSetupAuthoring,
  contrastColorIds
} from "./build-session-setup.mjs";
import {
  authoringPath,
  buildTrainFormationAuthoring
} from "./build-train-formation.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const networkPath = path.join(
  gameRoot,
  "annotations",
  "initial-network.review.json"
);
const intakePath = path.join(
  gameRoot,
  "authoring",
  "fixtures",
  "cargo-news.intake.json"
);
const credentialSha256 = "f".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
const require = createRequire(import.meta.url);
const { mechanicsSha256 } = require(
  "../../../scripts/manifest-tools/mechanics-canonicalize.cjs"
);
let commandSequence = 0;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

/** Produce a unique command identifier accepted by the normal dispatcher. */
const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Validate the compiled game through the same publication boundary as Runtime. */
const loadManifest = async () =>
  validateGameManifest(await readJson(path.join(gameRoot, "game.manifest.json")));

/**
 * Re-publish compiler-owned identities after a bounded in-memory capacity edit.
 *
 * This is used only by the negative capacity fixture. Production content is
 * never modified, and the dispatcher still receives a self-consistent immutable
 * bundle rather than an unchecked Mechanics plan.
 */
const republishFixtureHashes = (manifest) => {
  const networkModelsHash = mechanicsSha256(manifest.networkModels ?? {});
  for (const [planId, plan] of Object.entries(manifest.mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      budgetProfile: manifest.mechanics.budgetProfile,
      moduleLock: manifest.mechanics.moduleLock,
      stateModel: manifest.mechanics.stateModel,
      objectModels: manifest.objectModels ?? {},
      networkModelsHash,
      planId,
      transaction: plan.transaction
    });
  }
  for (const [actionId, action] of Object.entries(manifest.actions)) {
    const { definitionHash: _previousHash, ...definition } = action;
    const plan = manifest.mechanics.plans[action.binding.planRef];
    action.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: plan.planHash
    });
  }
};

/** Create one facilitator-owned session from a compiled immutable bundle. */
const createSession = async (manifest, initialState = manifest.state) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(initialState),
    participants: materializeLocalSessionParticipants(initialState, manifest.config.players.min),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "train-formation-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatch one public Game Intent with the current optimistic state version. */
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
 * Create a bounded upstream or negative fixture and advance its version once.
 *
 * Each edit is local to a fresh in-memory session. Gameplay behavior under
 * test still executes solely through the public dispatcher.
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

/** Prove a rejected public intent performs no partial transaction write. */
const assertRejectedWithoutMutation = async (session, input) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const outcome = await dispatch({ ...session, ...input });
    rejected = outcome.result.ok === false && outcome.receipt.status === "rejected";
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${input.actionId} must be rejected`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

/** Add one team through its protected normal-session setup intent. */
const addTeam = async (session, type, index) => {
  const outcome = await dispatch({
    ...session,
    actionId: type === "logistics_company"
      ? "session.setup.team.add.logistics-company"
      : "session.setup.team.add.locomotive-guild",
    params: {
      name: `${type === "logistics_company" ? "Перевозчик" : "Гильдия"} ${index + 1}`,
      colorId: contrastColorIds[index]
    }
  });
  assert.equal(outcome.result.ok, true);
};

/** Materialize the smallest accepted odd composition: 3 carriers and 2 guilds. */
const addFiveTeamComposition = async (session) => {
  for (let index = 0; index < 3; index += 1) {
    await addTeam(session, "logistics_company", index);
  }
  for (let index = 0; index < 2; index += 1) {
    await addTeam(session, "locomotive_guild", index + 3);
  }
};

/** Place all reserve assets in the authoritative randomized team order. */
const placeAllAssets = async (session) => {
  const guildStations = new Map();
  let nextGuildStation = 1;
  while (true) {
    const current = await session.store.getSession(session.sessionId);
    if (current.state.public.session.phase === "setup-complete") return;
    assert.equal(current.state.public.session.phase, "setup-placement");
    const teamId = current.state.public.setup.currentTeamId;
    const objects = current.state.public.objects;
    const wagonId = Object.entries(objects.wagons).find(([, wagon]) =>
      wagon.attributes.ownerTeamId === teamId
      && wagon.facets.availability === "reserve"
    )?.[0];
    if (wagonId) {
      const outcome = await dispatch({
        ...session,
        actionId: "session.setup.place.wagon",
        params: { wagonId, stationId: "terminal-1" }
      });
      assert.equal(outcome.result.ok, true);
      continue;
    }

    const locomotiveId = Object.entries(objects.locomotives).find(
      ([, locomotive]) =>
        locomotive.attributes.ownerTeamId === teamId
        && locomotive.facets.availability === "reserve"
    )?.[0];
    assert.ok(locomotiveId);
    if (!guildStations.has(teamId)) {
      guildStations.set(teamId, `terminal-${nextGuildStation++}`);
    }
    const outcome = await dispatch({
      ...session,
      actionId: "session.setup.place.locomotive",
      params: {
        locomotiveId,
        stationId: guildStations.get(teamId)
      }
    });
    assert.equal(outcome.result.ok, true);
  }
};

/**
 * Reach operations with a server-owned current locomotive and two free wagons.
 *
 * The direct phase change substitutes only the still-missing market boundary.
 * Order preparation and all formation behavior use public Game Intents.
 */
const prepareFormationState = async (manifest) => {
  const session = await createSession(manifest);
  await addFiveTeamComposition(session);
  const finalized = await dispatch({
    ...session,
    actionId: "session.setup.finalize"
  });
  assert.equal(finalized.result.ok, true);
  await placeAllAssets(session);
  await updateScenario(session, (state) => {
    state.public.session.phase = "movement-order";
  });
  const prepared = await dispatch({
    ...session,
    actionId: "movement.order.prepare"
  });
  assert.equal(prepared.result.ok, true);
  await updateScenario(session, (state) => {
    const currentId = state.public.movement.currentLocomotiveId;
    assert.equal(typeof currentId, "string");
    const current = state.public.objects.locomotives[currentId];
    const wagons = Object.values(state.public.objects.wagons);
    assert.ok(wagons.length >= 2);
    for (const wagon of wagons) {
      wagon.objectType = "transport.wagon";
      wagon.facets.availability = "active";
      wagon.attributes.networkId = "main";
      wagon.attributes.nodeId = current.attributes.nodeId;
      wagon.attributes.attachedVehicleId = null;
      wagon.attributes.formationTargetLocomotiveId = null;
    }
  });
  return (await session.store.getSession(session.sessionId)).state;
};

const formationIds = (state) => {
  const currentId = state.public.movement.currentLocomotiveId;
  const wagonIds = Object.keys(state.public.objects.wagons).sort().slice(0, 2);
  assert.equal(typeof currentId, "string");
  assert.equal(wagonIds.length, 2);
  return { currentId, wagonIds };
};

const selectWagon = async (session, wagonId) => {
  const outcome = await dispatch({
    ...session,
    actionId: "movement.train.wagon.select",
    params: { wagonId }
  });
  assert.equal(outcome.result.ok, true);
};

/**
 * Prepare one loaded and one empty attached wagon at terminal 1.
 *
 * Direct fixture edits only bridge setup/cargo phases that are outside this
 * focused test. Attachment, graph movement, tariff tracking, money transfer
 * and detach all still execute through protected public intents.
 */
const prepareManualTariffScenario = async (manifest, carrierCoins = 10) => {
  const baseState = await prepareFormationState(manifest);
  const session = await createSession(manifest, baseState);
  const { currentId, wagonIds } = formationIds(baseState);
  const loadedWagonId = wagonIds[0];
  const emptyWagonId = wagonIds[1];
  let cargoId;
  let logisticsTeamId;
  let guildTeamId;

  await updateScenario(session, (state) => {
    const objects = state.public.objects;
    const locomotive = objects.locomotives[currentId];
    const loadedWagon = objects.wagons[loadedWagonId];
    const emptyWagon = objects.wagons[emptyWagonId];
    cargoId = Object.keys(objects.cargoOrders)[0];
    assert.equal(typeof cargoId, "string");
    const cargo = objects.cargoOrders[cargoId];
    logisticsTeamId = loadedWagon.attributes.ownerTeamId;
    guildTeamId = locomotive.attributes.ownerTeamId;

    locomotive.attributes.nodeId = "terminal-1";
    loadedWagon.attributes.nodeId = "terminal-1";
    emptyWagon.attributes.nodeId = "terminal-1";
    loadedWagon.attributes.cargoId = cargoId;
    loadedWagon.attributes.manualTariffDestinationNodeId = "terminal-3";
    emptyWagon.attributes.cargoId = null;
    emptyWagon.attributes.manualTariffDestinationNodeId = null;

    cargo.objectType = "transport.cargo";
    cargo.facets.status = "in_transit";
    Object.assign(cargo.attributes, {
      networkId: "main",
      fromNodeId: "terminal-1",
      availableAtNodeId: "terminal-1",
      activeLegFromNodeId: "terminal-1",
      toNodeId: "terminal-3",
      holderTeamId: logisticsTeamId,
      carrierWagonId: loadedWagonId,
      originDeparted: false,
      originDepartureTurn: 0
    });

    objects.teams[logisticsTeamId].attributes.coins = carrierCoins;
    objects.teams[guildTeamId].attributes.coins = 10;
  });

  await selectWagon(session, loadedWagonId);
  await selectWagon(session, emptyWagonId);
  const attached = await dispatch({
    ...session,
    actionId: "movement.train.attach.selected"
  });
  assert.equal(attached.result.ok, true);

  return {
    session,
    currentId,
    loadedWagonId,
    emptyWagonId,
    cargoId,
    logisticsTeamId,
    guildTeamId
  };
};

test("generator owns explicit scalar selection and one bounded group transaction", async () => {
  const [actual, network, intake] = await Promise.all([
    readJson(authoringPath),
    readJson(networkPath),
    readJson(intakePath)
  ]);

  assert.deepEqual(buildTrainFormationAuthoring(actual), actual);
  assert.deepEqual(buildMovementOrderAuthoring(actual), actual);
  assert.deepEqual(buildOperatingTurnAuthoring(actual), actual);
  assert.deepEqual(buildSessionSetupAuthoring(actual, network), actual);
  assert.deepEqual(buildLifecycleAuthoring(actual, intake), actual);

  const actionIds = actual.root.logic.actions
    .filter((action) => action.id.startsWith("movement.train."))
    .map((action) => action.id);
  assert.deepEqual(actionIds, [
    "movement.train.wagon.select",
    "movement.train.wagon.unselect",
    "movement.train.attach.selected",
    "movement.train.attach.manual",
    "movement.train.detach.manual"
  ]);
  assert.equal(actionIds.includes("movement.train.wagon.toggle"), false);

  for (const actionId of [
    "movement.train.wagon.select",
    "movement.train.wagon.unselect",
    "movement.train.attach.manual",
    "movement.train.detach.manual"
  ]) {
    const action = actual.root.logic.actions.find(
      (candidate) => candidate.id === actionId
    );
    assert.deepEqual(Object.keys(action.paramsSchema.properties), ["wagonId"]);
    assert.deepEqual(action.paramsSchema.required, ["wagonId"]);
    assert.equal(action.paramsSchema.additionalProperties, false);
    assert.deepEqual(action.paramsSchema.properties.wagonId["x-cubica-ref"], {
      kind: "object",
      collection: "wagons",
      network: "main",
      allowedTypes: ["transport.wagon"],
      visibility: "public"
    });
  }
  assert.equal(
    actual.root.logic.actions.find(
      (candidate) => candidate.id === "movement.train.attach.selected"
    ).paramsSchema,
    undefined
  );

  const selectSteps =
    actual.root.mechanics.plans["movement.train.wagon.select"].transaction.steps;
  const unselectSteps =
    actual.root.mechanics.plans["movement.train.wagon.unselect"].transaction.steps;
  assert.deepEqual(
    selectSteps.find((step) => step.id === "formation-mark-one-selection")
      .patches,
    [{
      operation: "set",
      path: ["formationTargetLocomotiveId"],
      value: {
        op: "value.state",
        ref: { endpoint: "public.movement.currentLocomotiveId" }
      }
    }]
  );
  assert.deepEqual(
    unselectSteps.find((step) => step.id === "formation-clear-one-selection")
      .patches,
    [{
      operation: "set",
      path: ["formationTargetLocomotiveId"],
      value: { op: "value.literal", value: null }
    }]
  );

  const confirmSteps =
    actual.root.mechanics.plans["movement.train.attach.selected"].transaction.steps;
  const each = confirmSteps.find(
    (step) => step.id === "formation-attach-each-selected"
  );
  assert.deepEqual(each, {
    id: "formation-attach-each-selected",
    kind: "command",
    op: "core.entities.each",
    selection: {
      op: "value.result",
      stepId: "formation-selected-wagons-valid"
    },
    body: [
      {
        id: "formation-start-manual-tariff",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: {
          collection: "wagons",
          entityId: {
            op: "value.item",
            area: "identity",
            field: "id"
          }
        },
        patches: [
          {
            operation: "set",
            path: ["manualTariffOriginNodeId"],
            value: {
              op: "value.entity",
              entity: {
                collection: "locomotives",
                entityId: {
                  op: "value.state",
                  ref: {
                    endpoint: "public.movement.currentLocomotiveId"
                  }
                }
              },
              field: "nodeId"
            }
          },
          {
            operation: "set",
            path: ["manualTariffBillableEdgeCount"],
            value: { op: "value.literal", value: 0 }
          },
          {
            operation: "set",
            path: ["manualTariffTrackingActive"],
            value: { op: "value.literal", value: true }
          }
        ]
      },
      {
        id: "formation-attach-selected-item",
        kind: "command",
        op: "relation.attach",
        networkId: "main",
        primary: {
          op: "value.state",
          ref: { endpoint: "public.movement.currentLocomotiveId" }
        },
        related: [{
          op: "value.item",
          area: "identity",
          field: "id"
        }]
      }
    ]
  });
  assert.equal(
    confirmSteps.filter((step) =>
      step.id === "formation-spend-group-action").length,
    1
  );
  assert.deepEqual(
    confirmSteps.find((step) => step.id === "formation-spend-group-action")
      .patches,
    [{
      operation: "increment",
      path: ["actionPoints"],
      value: { op: "value.literal", value: -1 }
    }]
  );

  const skipSteps =
    actual.root.mechanics.plans["movement.locomotive.skip"].transaction.steps;
  const cleanupIndex = skipSteps.findIndex(
    (step) => step.id === "formation-clear-skipped-selection"
  );
  const resolvedIndex = skipSteps.findIndex(
    (step) => step.id === "mark-current-resolved"
  );
  assert.ok(cleanupIndex >= 0 && cleanupIndex < resolvedIndex);

  const wagonCreates = Object.values(actual.root.mechanics.plans)
    .flatMap((plan) => plan.transaction.steps)
    .filter((step) =>
      step.op === "core.entity.create" && step.collection === "wagons");
  assert.ok(wagonCreates.length > 0);
  assert.ok(wagonCreates.every((step) =>
    step.attributes.formationTargetLocomotiveId?.op === "value.literal"
    && step.attributes.formationTargetLocomotiveId.value === null
  ));
  assert.ok(wagonCreates.every((step) =>
    step.attributes.manualTariffOriginNodeId?.value === null
    && step.attributes.manualTariffDestinationNodeId?.value === null
    && step.attributes.manualTariffBillableEdgeCount?.value === 0
    && step.attributes.manualTariffTrackingActive?.value === false
  ));
});

test("select, unselect and two-wagon confirmation persist and spend one action point", async () => {
  const manifest = await loadManifest();
  const baseState = await prepareFormationState(manifest);
  const session = await createSession(manifest, baseState);
  const { currentId, wagonIds } = formationIds(baseState);
  const initial = await session.store.getSession(session.sessionId);
  const initialActionPoints =
    initial.state.public.objects.locomotives[currentId].attributes.actionPoints;
  assert.equal(initialActionPoints, 5);

  await selectWagon(session, wagonIds[0]);
  let current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.wagons[wagonIds[0]]
      .attributes.formationTargetLocomotiveId,
    currentId
  );
  assert.equal(
    current.state.public.objects.locomotives[currentId].attributes.actionPoints,
    5
  );

  const unselected = await dispatch({
    ...session,
    actionId: "movement.train.wagon.unselect",
    params: { wagonId: wagonIds[0] }
  });
  assert.equal(unselected.result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.wagons[wagonIds[0]]
      .attributes.formationTargetLocomotiveId,
    null
  );
  assert.equal(
    current.state.public.objects.locomotives[currentId].attributes.actionPoints,
    5
  );

  await selectWagon(session, wagonIds[1]);
  await selectWagon(session, wagonIds[0]);
  const beforeConfirm = await session.store.getSession(session.sessionId);
  const savedOrder = structuredClone(
    beforeConfirm.state.public.movement.locomotiveOrder
  );
  const savedPhase = beforeConfirm.state.public.session.phase;
  const ownerTeamId =
    beforeConfirm.state.public.objects.locomotives[currentId]
      .attributes.ownerTeamId;
  const confirmed = await dispatch({
    ...session,
    actionId: "movement.train.attach.selected"
  });
  assert.equal(confirmed.result.ok, true);

  const after = await session.store.getSession(session.sessionId);
  for (const wagonId of wagonIds) {
    const wagon = after.state.public.objects.wagons[wagonId];
    assert.equal(wagon.attributes.attachedVehicleId, currentId);
    assert.equal(wagon.attributes.formationTargetLocomotiveId, null);
  }
  assert.equal(
    after.state.public.objects.locomotives[currentId].attributes.actionPoints,
    4
  );
  assert.equal(after.state.public.movement.currentLocomotiveId, currentId);
  assert.deepEqual(after.state.public.movement.locomotiveOrder, savedOrder);
  assert.equal(after.state.public.session.phase, savedPhase);
  assert.equal(
    after.state.public.objects.locomotives[currentId]
      .attributes.movementResolvedTurn,
    0
  );
  assert.deepEqual(after.state.public.log.at(-1), {
    eventType: "movement.train.formed",
    summary: "Отмеченные вагоны прицеплены к текущему локомотиву",
    audience: "public",
    data: {
      kind: "train-formation",
      locomotiveId: currentId,
      wagonIds,
      wagonCount: 2,
      actionPointCost: 1,
      ownerTeamId,
      turnNumber: after.state.public.session.turnNumber
    }
  });
});

test("manual detach freezes loaded tariff at first deviation and bills every empty-wagon edge", async () => {
  const manifest = await loadManifest();
  const scenario = await prepareManualTariffScenario(manifest);
  const {
    session,
    currentId,
    loadedWagonId,
    emptyWagonId,
    cargoId,
    logisticsTeamId,
    guildTeamId
  } = scenario;

  // Destination 3 has the shortest route 1 → 2 → 3,14 → 3. Choosing
  // 1 → 9 is the first deviation; the following two edges must not increase
  // the loaded wagon's tariff. The empty wagon counts all three edges.
  for (const edgeId of [
    "road-1-9",
    "road-9-waypoint-9-3-4",
    "road-8-waypoint-9-3-4"
  ]) {
    const moved = await dispatch({
      ...session,
      actionId: "movement.locomotive.traverse",
      params: { edgeId }
    });
    assert.equal(moved.result.ok, true);
  }

  let current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.manualTariffBillableEdgeCount,
    1
  );
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.manualTariffTrackingActive,
    false
  );
  assert.equal(
    current.state.public.objects.wagons[emptyWagonId]
      .attributes.manualTariffBillableEdgeCount,
    3
  );
  assert.equal(
    current.state.public.objects.wagons[emptyWagonId]
      .attributes.manualTariffTrackingActive,
    true
  );
  const actionPointsBeforeDetach =
    current.state.public.objects.locomotives[currentId].attributes.actionPoints;

  const loadedDetached = await dispatch({
    ...session,
    actionId: "movement.train.detach.manual",
    params: { wagonId: loadedWagonId }
  });
  assert.equal(loadedDetached.result.ok, true);
  const emptyDetached = await dispatch({
    ...session,
    actionId: "movement.train.detach.manual",
    params: { wagonId: emptyWagonId }
  });
  assert.equal(emptyDetached.result.ok, true);

  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.teams[logisticsTeamId].attributes.coins,
    2
  );
  assert.equal(
    current.state.public.objects.teams[guildTeamId].attributes.coins,
    18
  );
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.attachedVehicleId,
    null
  );
  assert.equal(
    current.state.public.objects.wagons[emptyWagonId]
      .attributes.attachedVehicleId,
    null
  );
  assert.equal(
    current.state.public.objects.cargoOrders[cargoId]
      .attributes.activeLegFromNodeId,
    "terminal-8"
  );
  assert.equal(
    current.state.public.objects.locomotives[currentId].attributes.actionPoints,
    actionPointsBeforeDetach
  );

  const reattached = await dispatch({
    ...session,
    actionId: "movement.train.attach.manual",
    params: { wagonId: loadedWagonId }
  });
  assert.equal(reattached.result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.attachedVehicleId,
    currentId
  );
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.manualTariffOriginNodeId,
    "terminal-8"
  );
  assert.equal(
    current.state.public.objects.wagons[loadedWagonId]
      .attributes.manualTariffBillableEdgeCount,
    0
  );
  assert.equal(
    current.state.public.objects.locomotives[currentId].attributes.actionPoints,
    actionPointsBeforeDetach
  );
});

test("insufficient manual tariff rejects money transfer and detach atomically", async () => {
  const manifest = await loadManifest();
  const scenario = await prepareManualTariffScenario(manifest, 1);
  const { session, loadedWagonId } = scenario;

  const moved = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-9" }
  });
  assert.equal(moved.result.ok, true);
  await assertRejectedWithoutMutation(session, {
    actionId: "movement.train.detach.manual",
    params: { wagonId: loadedWagonId }
  });
});

test("temporarily disconnected cargo destination exposes the non-throwing path blocker", async () => {
  const manifest = await loadManifest();
  const scenario = await prepareManualTariffScenario(manifest);
  const { session } = scenario;

  await updateScenario(session, (state) => {
    // Destination 3 stays open, but its only road is temporarily closed.
    // The accepted graph language currently has no non-throwing reachability
    // query, so tariff inspection rejects and atomically rolls back an
    // otherwise legal movement into another open part of the network.
    state.public.objects.networkEdges["road-3-3-14"]
      .facets.availability = "blocked";
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-9" }
  });
});

test("manual coupling is unavailable before the current locomotive moves to a terminal", async () => {
  const manifest = await loadManifest();
  const baseState = await prepareFormationState(manifest);
  const session = await createSession(manifest, baseState);
  const { wagonIds } = formationIds(baseState);

  await assertRejectedWithoutMutation(session, {
    actionId: "movement.train.attach.manual",
    params: { wagonId: wagonIds[0] }
  });
});

test("skip clears the persisted draft before advancing the current locomotive", async () => {
  const manifest = await loadManifest();
  const baseState = await prepareFormationState(manifest);
  const session = await createSession(manifest, baseState);
  const { currentId, wagonIds } = formationIds(baseState);
  await selectWagon(session, wagonIds[0]);
  await selectWagon(session, wagonIds[1]);

  const skipped = await dispatch({
    ...session,
    actionId: "movement.locomotive.skip"
  });
  assert.equal(skipped.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.ok(wagonIds.every((wagonId) =>
    after.state.public.objects.wagons[wagonId]
      .attributes.formationTargetLocomotiveId === null
  ));
  assert.notEqual(after.state.public.movement.currentLocomotiveId, currentId);
});

test("invalid or stale formation choices reject atomically", async () => {
  const manifest = await loadManifest();
  const baseState = await prepareFormationState(manifest);
  const { currentId, wagonIds } = formationIds(baseState);
  const otherLocomotiveId = Object.keys(
    baseState.public.objects.locomotives
  ).find((id) => id !== currentId);
  assert.equal(typeof otherLocomotiveId, "string");

  const fresh = () => createSession(manifest, baseState);

  const empty = await fresh();
  await assertRejectedWithoutMutation(empty, {
    actionId: "movement.train.attach.selected"
  });

  const wrongPhase = await fresh();
  await updateScenario(wrongPhase, (state) => {
    state.public.session.phase = "construction";
  });
  await assertRejectedWithoutMutation(wrongPhase, {
    actionId: "movement.train.attach.selected"
  });

  const noActionPoints = await fresh();
  await updateScenario(noActionPoints, (state) => {
    state.public.objects.locomotives[currentId].attributes.actionPoints = 0;
  });
  await assertRejectedWithoutMutation(noActionPoints, {
    actionId: "movement.train.wagon.select",
    params: { wagonId: wagonIds[0] }
  });

  const selectedForOther = await fresh();
  await updateScenario(selectedForOther, (state) => {
    state.public.objects.wagons[wagonIds[0]]
      .attributes.formationTargetLocomotiveId = otherLocomotiveId;
  });
  await assertRejectedWithoutMutation(selectedForOther, {
    actionId: "movement.train.wagon.unselect",
    params: { wagonId: wagonIds[0] }
  });

  const moved = await fresh();
  await selectWagon(moved, wagonIds[0]);
  await updateScenario(moved, (state) => {
    state.public.objects.wagons[wagonIds[0]].attributes.nodeId = "terminal-99";
  });
  await assertRejectedWithoutMutation(moved, {
    actionId: "movement.train.attach.selected"
  });

  const alreadyAttached = await fresh();
  await selectWagon(alreadyAttached, wagonIds[0]);
  await updateScenario(alreadyAttached, (state) => {
    state.public.objects.wagons[wagonIds[0]]
      .attributes.attachedVehicleId = otherLocomotiveId;
  });
  await assertRejectedWithoutMutation(alreadyAttached, {
    actionId: "movement.train.attach.selected"
  });

  const incompatible = await fresh();
  await selectWagon(incompatible, wagonIds[0]);
  await updateScenario(incompatible, (state) => {
    state.public.objects.wagons[wagonIds[0]].objectType = "transport.locomotive";
  });
  await assertRejectedWithoutMutation(incompatible, {
    actionId: "movement.train.attach.selected"
  });

  const oneInvalid = await fresh();
  await selectWagon(oneInvalid, wagonIds[0]);
  await selectWagon(oneInvalid, wagonIds[1]);
  await updateScenario(oneInvalid, (state) => {
    state.public.objects.wagons[wagonIds[1]].attributes.nodeId = "terminal-99";
  });
  await assertRejectedWithoutMutation(oneInvalid, {
    actionId: "movement.train.attach.selected"
  });
});

test("relation capacity failure rolls back every loop iteration and the one-point charge", async () => {
  const manifest = await loadManifest();
  const baseState = await prepareFormationState(manifest);
  const limitedManifest = structuredClone(manifest);
  limitedManifest.networkModels.main.movement.maxCoupledVehicles = 1;
  republishFixtureHashes(limitedManifest);
  const session = await createSession(limitedManifest, baseState);
  const { currentId, wagonIds } = formationIds(baseState);
  await selectWagon(session, wagonIds[0]);
  await selectWagon(session, wagonIds[1]);

  const before = await session.store.getSession(session.sessionId);
  assert.equal(
    before.state.public.objects.locomotives[currentId].attributes.actionPoints,
    5
  );
  await assertRejectedWithoutMutation(session, {
    actionId: "movement.train.attach.selected"
  });
});
