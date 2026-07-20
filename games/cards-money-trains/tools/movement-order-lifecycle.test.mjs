/**
 * Focused Runtime proof for locomotive ordering and the explicit all-skip path.
 *
 * Public Game Intents are executed through the production dispatcher. Direct
 * store edits are limited to entering the not-yet-implemented market-to-
 * movement boundary and to constructing bounded negative/order fixtures. Every
 * rejected scenario proves that both state and optimistic version stay intact.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import { buildLifecycleAuthoring } from "./build-card-lifecycle.mjs";
import {
  buildSessionSetupAuthoring,
  contrastColorIds,
  supportedOddTeamCounts
} from "./build-session-setup.mjs";
import { buildOperatingTurnAuthoring } from "./build-operating-turn.mjs";
import {
  authoringPath,
  buildMovementOrderAuthoring
} from "./build-movement-order.mjs";

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
let commandSequence = 0;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

/** Produce a unique command identifier accepted by the normal dispatcher. */
const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Validate the compiled manifest through the same path used by Runtime. */
const loadManifest = async () =>
  validateGameManifest(await readJson(path.join(gameRoot, "game.manifest.json")));

/** Create one facilitator-owned session from the immutable compiled bundle. */
const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "movement-order-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatch one optimistic-concurrency protected public Game Intent. */
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
 * Create a narrow synthetic boundary or negative fixture.
 *
 * The store edit remains local to a fresh in-memory session and increments the
 * optimistic version exactly once, just like an ordinary accepted command.
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

/** Prove all dispatcher rejection modes leave the session completely intact. */
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

/** Add one dynamic team through its protected setup intent. */
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

/** Materialize the author-confirmed composition for one supported odd count. */
const addOddComposition = async (session, count) => {
  const logisticsCount = (count + 1) / 2;
  const guildCount = (count - 1) / 2;
  for (let index = 0; index < logisticsCount; index += 1) {
    await addTeam(session, "logistics_company", index);
  }
  for (let index = 0; index < guildCount; index += 1) {
    await addTeam(session, "locomotive_guild", logisticsCount + index);
  }
};

/** Place all reserve assets in the server-selected team order. */
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
      wagon.attributes.ownerTeamId === teamId &&
      wagon.facets.availability === "reserve"
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
    const locomotiveId = Object.entries(objects.locomotives).find(([, locomotive]) =>
      locomotive.attributes.ownerTeamId === teamId &&
      locomotive.facets.availability === "reserve"
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
 * Reach the technical movement-order boundary.
 *
 * Market, cargo choice and their transition are intentionally still absent,
 * so the single direct phase edit is the bounded upstream substitution.
 */
const prepareMovementBoundary = async (manifest, count = 5) => {
  const session = await createSession(manifest);
  await addOddComposition(session, count);
  const finalized = await dispatch({
    ...session,
    actionId: "session.setup.finalize"
  });
  assert.equal(finalized.result.ok, true);
  await placeAllAssets(session);
  await updateScenario(session, (state) => {
    state.public.session.phase = "movement-order";
  });
  return session;
};

/** Dispatch movement preparation and return the accepted session state. */
const prepareOrder = async (session) => {
  const outcome = await dispatch({
    ...session,
    actionId: "movement.order.prepare"
  });
  assert.equal(outcome.result.ok, true);
  return session.store.getSession(session.sessionId);
};

/**
 * Attach one already active wagon to the server-selected locomotive.
 *
 * Train formation has its own focused Runtime proof. This direct edit keeps
 * the movement test isolated from that preceding action sequence; traversal
 * itself still goes exclusively through the public Game Intent.
 */
const attachWagonToCurrent = async (session) => {
  let attachment;
  await updateScenario(session, (state) => {
    const objects = state.public.objects;
    const locomotiveId = state.public.movement.currentLocomotiveId;
    assert.equal(typeof locomotiveId, "string");
    const locomotive = objects.locomotives[locomotiveId];
    assert.ok(locomotive);
    const wagonEntry = Object.entries(objects.wagons).find(
      ([, wagon]) => wagon.facets.availability === "active"
    );
    assert.ok(wagonEntry);
    const [wagonId, wagon] = wagonEntry;
    wagon.attributes.nodeId = locomotive.attributes.nodeId;
    wagon.attributes.attachedVehicleId = locomotiveId;
    attachment = {
      locomotiveId,
      wagonId,
      fromNodeId: locomotive.attributes.nodeId
    };
  });
  return attachment;
};

/**
 * Arrange all four order criteria without changing the authored collection
 * contract. An extra active locomotive gives one owner an aggregate count of
 * two; two other owners form the complete seeded-random tie.
 */
const arrangeOrderHierarchy = async (session) => {
  let expected;
  await updateScenario(session, (state) => {
    const objects = state.public.objects;
    const locomotiveIds = Object.keys(objects.locomotives).sort();
    assert.equal(locomotiveIds.length, 5);
    const ownerIds = locomotiveIds.map(
      (locomotiveId) => objects.locomotives[locomotiveId].attributes.ownerTeamId
    );
    const xCoordinates = [500, 400, 300, 300, 300, 50];
    for (let index = 0; index < 6; index += 1) {
      objects.networkNodes[`terminal-${index + 1}`].attributes.position.x =
        xCoordinates[index];
    }
    const coins = [1, 20, 10, 10, 10];
    ownerIds.forEach((ownerId, index) => {
      objects.teams[ownerId].attributes.coins = coins[index];
    });
    locomotiveIds.forEach((locomotiveId, index) => {
      const locomotive = objects.locomotives[locomotiveId];
      locomotive.attributes.nodeId = `terminal-${index + 1}`;
      locomotive.attributes.actionPoints = index;
      locomotive.attributes.turnOrderCount = 1;
      locomotive.attributes.movementResolvedTurn = 0;
    });
    const extraId = "locomotive:extra";
    objects.locomotives[extraId] = structuredClone(
      objects.locomotives[locomotiveIds[2]]
    );
    objects.locomotives[extraId].attributes.nodeId = "terminal-6";
    objects.locomotives[extraId].attributes.actionPoints = -1;
    state.secret.random.counters.unrelated = 7;
    expected = {
      east: locomotiveIds[0],
      rich: locomotiveIds[1],
      numerous: locomotiveIds[2],
      tied: [locomotiveIds[3], locomotiveIds[4]],
      extra: extraId
    };
  });
  return expected;
};

test("generator owns an exact bounded order contract and composes in either order", async () => {
  const [actual, network, intake] = await Promise.all([
    readJson(authoringPath),
    readJson(networkPath),
    readJson(intakePath)
  ]);

  const setupOwned = buildSessionSetupAuthoring(actual, network);
  assert.deepEqual(buildMovementOrderAuthoring(actual), actual);
  assert.deepEqual(setupOwned, actual);
  assert.deepEqual(buildOperatingTurnAuthoring(actual), actual);
  assert.deepEqual(buildLifecycleAuthoring(actual, intake), actual);
  assert.deepEqual(setupOwned.root.mechanics.stateModel.types["game.turn-order-count"], {
    kind: "integer",
    minimum: 0,
    maximum: 1
  });
  assert.equal(
    setupOwned.root.mechanics.stateModel.collections.locomotives
      .fields.turnOrderCount.valueType,
    "game.turn-order-count"
  );
  assert.deepEqual(
    buildMovementOrderAuthoring(
      buildOperatingTurnAuthoring(
        buildLifecycleAuthoring(buildSessionSetupAuthoring(actual, network), intake)
      )
    ),
    actual
  );
  assert.deepEqual(
    buildLifecycleAuthoring(
      buildSessionSetupAuthoring(
        buildOperatingTurnAuthoring(buildMovementOrderAuthoring(actual)),
        network
      ),
      intake
    ),
    actual
  );

  const stateModel = actual.root.mechanics.stateModel;
  assert.deepEqual(stateModel.collections.networkNodes.fields.positionX, {
    source: { kind: "nested-field", field: "position", path: ["x"] },
    valueType: "game.map-coordinate",
    access: "read-only"
  });
  assert.deepEqual(stateModel.types["game.map-coordinate"], {
    kind: "finite-number",
    minimum: -1_000_000_000,
    maximum: 1_000_000_000
  });
  assert.deepEqual(stateModel.types["game.locomotive-order"], {
    kind: "list",
    itemType: "core.string",
    maxItems: 64
  });
  assert.deepEqual(
    stateModel.endpoints["public.movement.currentLocomotiveId"].valueType,
    "core.optional-string"
  );
  assert.equal(
    stateModel.endpoints["projection.public.movement"].usage,
    "projection-only"
  );
  assert.deepEqual(
    stateModel.collections.locomotives.fields.lastMovedTurn,
    {
      storage: { kind: "attribute", name: "lastMovedTurn" },
      valueType: "core.integer",
      access: "read-write"
    }
  );
  assert.deepEqual(
    stateModel.types["game.movement-locomotive-skipped-event"]
      .fields.locomotiveId,
    { typeRef: "core.optional-string", optional: false }
  );
  const expectedMovementBoardActions = [
    {
      id: "movement-order-prepare",
      label: "Подготовить порядок движения",
      actionId: "movement.order.prepare",
      phase: "movement-order",
      section: "movement"
    },
    {
      id: "movement-locomotive-traverse",
      label: "Переместить текущий локомотив",
      actionId: "movement.locomotive.traverse",
      phase: "operations",
      section: "movement"
    },
    {
      id: "movement-train-wagon-select",
      label: "Отметить вагон",
      description:
        "Выберите один публичный вагон; текущий локомотив и допустимость проверит сервер.",
      actionId: "movement.train.wagon.select",
      phase: "operations",
      section: "movement"
    },
    {
      id: "movement-train-wagon-unselect",
      label: "Снять отметку с вагона",
      description: "Выберите ранее отмеченный вагон текущего локомотива.",
      actionId: "movement.train.wagon.unselect",
      phase: "operations",
      section: "movement"
    },
    {
      id: "movement-train-attach-selected",
      label: "Прицепить отмеченные вагоны",
      description:
        "Подтверждает всю серверную группу за одну единицу хода текущего локомотива.",
      actionId: "movement.train.attach.selected",
      phase: "operations",
      section: "movement"
    },
    {
      id: "movement-locomotive-skip",
      label: "Пропустить движение текущего локомотива",
      actionId: "movement.locomotive.skip",
      phase: "operations",
      section: "movement"
    }
  ];
  const movementBoardActions = actual.root.state.public.board.availableActions
    .filter((candidate) => candidate.actionId.startsWith("movement."));
  assert.deepEqual(movementBoardActions, expectedMovementBoardActions);
  assert.equal(
    new Set(movementBoardActions.map((candidate) => candidate.actionId)).size,
    6
  );
  assert.ok(movementBoardActions.every((candidate) => candidate.params === undefined));

  const unrelatedBoardAction = {
    id: "unrelated-control",
    label: "Независимое действие",
    actionId: "unrelated.action",
    phase: "operations",
    section: "other",
    params: { preserved: true }
  };
  const duplicatedBoardSource = structuredClone(actual);
  duplicatedBoardSource.root.state.public.board.availableActions = [
    unrelatedBoardAction,
    ...expectedMovementBoardActions,
    ...expectedMovementBoardActions
  ];
  const rebuiltBoardActions =
    buildMovementOrderAuthoring(duplicatedBoardSource)
      .root.state.public.board.availableActions;
  assert.deepEqual(rebuiltBoardActions, [
    unrelatedBoardAction,
    ...expectedMovementBoardActions
  ]);

  const prepareSteps =
    actual.root.mechanics.plans["movement.order.prepare"].transaction.steps;
  const orderStep = prepareSteps.find((step) => step.op === "core.entities.order");
  assert.deepEqual(orderStep.keys, [
    {
      source: {
        kind: "related-field",
        referenceField: "nodeId",
        collection: "networkNodes",
        field: "positionX"
      },
      direction: "descending",
      missing: "error"
    },
    {
      source: {
        kind: "related-field",
        referenceField: "ownerTeamId",
        collection: "teams",
        field: "coins"
      },
      direction: "descending",
      missing: "error"
    },
    {
      source: {
        kind: "related-aggregate",
        collection: "locomotives",
        join: {
          current: { kind: "field", field: "ownerTeamId" },
          relatedField: "ownerTeamId"
        },
        aggregate: "sum",
        valueField: "turnOrderCount"
      },
      direction: "descending",
      missing: "error"
    }
  ]);
  assert.deepEqual(orderStep.tieBreak, {
    kind: "seeded-random",
    stream: "locomotive-order"
  });
  const skipAction = actual.root.logic.actions.find(
    (candidate) => candidate.id === "movement.locomotive.skip"
  );
  assert.equal(skipAction.paramsSchema, undefined);
  const traverseAction = actual.root.logic.actions.find(
    (candidate) => candidate.id === "movement.locomotive.traverse"
  );
  assert.deepEqual(Object.keys(traverseAction.paramsSchema.properties), ["edgeId"]);
  assert.deepEqual(traverseAction.paramsSchema.required, ["edgeId"]);
  assert.equal(traverseAction.paramsSchema.additionalProperties, false);
  assert.equal(traverseAction.paramsSchema.properties.vehicleId, undefined);
  assert.deepEqual(
    traverseAction.paramsSchema.properties.edgeId["x-cubica-ref"],
    {
      kind: "object",
      collection: "networkEdges",
      network: "main",
      allowedTypes: ["transport.edge"],
      visibility: "public"
    }
  );
  const traverseSteps =
    actual.root.mechanics.plans["movement.locomotive.traverse"].transaction.steps;
  assert.equal(traverseSteps.some((step) => step.kind === "macro"), false);
  assert.deepEqual(
    traverseSteps.find((step) => step.id === "traverse"),
    {
      id: "traverse",
      kind: "command",
      op: "graph.entity.traverse",
      networkId: "main",
      entity: {
        op: "value.state",
        ref: { endpoint: "public.movement.currentLocomotiveId" }
      },
      edge: { op: "value.param", name: "edgeId" }
    }
  );
  assert.deepEqual(
    traverseSteps
      .filter((step) => step.id.startsWith("news-22-"))
      .map((step) => [step.id, step.op]),
    [
      ["news-22-first-movement-levy", "core.resource.transfer"],
      ["news-22-first-movement-journal", "core.event.emit"]
    ]
  );
  assert.equal(
    traverseSteps.find((step) => step.id === "mark-last-movement-turn").op,
    "core.entity.attributes.patch"
  );
  assert.deepEqual(
    stateModel.types["game.movement-locomotive-traversed-event"].fields,
    {
      kind: { typeRef: "core.string", optional: false },
      locomotiveId: { typeRef: "core.string", optional: false },
      edgeId: { typeRef: "core.string", optional: false },
      fromNodeId: { typeRef: "core.string", optional: false },
      toNodeId: { typeRef: "core.string", optional: false },
      relatedIds: {
        typeRef: "game.movement-related-ids",
        optional: false
      },
      ownerTeamId: { typeRef: "core.string", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false }
    }
  );
  assert.deepEqual(
    actual.root.logic.flows
      .find((flow) => flow.id === "facilitator")
      .steps.find((step) => step.id === "facilitator.movement-order-and-skip")
      .actionIds.slice(0, 6),
    [
      "movement.order.prepare",
      "movement.locomotive.traverse",
      "movement.train.wagon.select",
      "movement.train.wagon.unselect",
      "movement.train.attach.selected",
      "movement.locomotive.skip"
    ]
  );

  const placeLocomotiveSteps =
    actual.root.mechanics.plans["session.setup.place.locomotive"].transaction.steps;
  const placementPatch = placeLocomotiveSteps.find(
    (step) => step.id === "place-locomotive-node"
  );
  assert.deepEqual(
    placementPatch.patches.map((patch) => patch.path[0]),
    ["nodeId", "turnOrderCount"]
  );
  const placeWagonSteps =
    actual.root.mechanics.plans["session.setup.place.wagon"].transaction.steps;
  assert.deepEqual(
    placeWagonSteps.find((step) => step.id === "place-wagon-node")
      .patches.map((patch) => patch.path[0]),
    ["nodeId"]
  );
});

test("all confirmed odd setups prepare every active locomotive exactly once", async () => {
  const manifest = await loadManifest();
  for (const count of supportedOddTeamCounts) {
    const session = await prepareMovementBoundary(manifest, count);
    const prepared = await prepareOrder(session);
    const locomotives = prepared.state.public.objects.locomotives;
    const activeIds = Object.entries(locomotives)
      .filter(([, locomotive]) => locomotive.facets.availability === "active")
      .map(([locomotiveId]) => locomotiveId)
      .sort();
    assert.equal(activeIds.length, (count - 1) / 2);
    assert.deepEqual(
      [...prepared.state.public.movement.locomotiveOrder].sort(),
      activeIds
    );
    assert.ok(activeIds.every(
      (locomotiveId) =>
        locomotives[locomotiveId].attributes.turnOrderCount === 1 &&
        locomotives[locomotiveId].attributes.movementResolvedTurn === 0 &&
        locomotives[locomotiveId].attributes.lastMovedTurn === 0 &&
        locomotives[locomotiveId].attributes.actionPoints === 5
    ));
    assert.equal(prepared.state.public.session.phase, "operations");
    assert.equal(
      prepared.state.public.movement.currentLocomotiveId,
      prepared.state.public.movement.locomotiveOrder[0]
    );
  }
});

test("current locomotive and its attached wagon traverse twice without advancing order", async () => {
  const manifest = await loadManifest();
  const session = await prepareMovementBoundary(manifest, 5);
  const prepared = await prepareOrder(session);
  const attachment = await attachWagonToCurrent(session);
  assert.equal(attachment.fromNodeId, "terminal-1");

  const savedOrder = structuredClone(
    prepared.state.public.movement.locomotiveOrder
  );
  const savedRandom = structuredClone(prepared.state.secret.random);
  const ownerTeamId =
    prepared.state.public.objects.locomotives[attachment.locomotiveId]
      .attributes.ownerTeamId;
  const first = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });
  assert.equal(first.result.ok, true);
  const afterFirst = await session.store.getSession(session.sessionId);
  const firstLocomotive =
    afterFirst.state.public.objects.locomotives[attachment.locomotiveId];
  const firstWagon = afterFirst.state.public.objects.wagons[attachment.wagonId];
  assert.equal(firstLocomotive.attributes.nodeId, "terminal-2");
  assert.equal(firstWagon.attributes.nodeId, "terminal-2");
  assert.equal(firstLocomotive.attributes.actionPoints, 4);
  assert.equal(
    firstLocomotive.attributes.lastMovedTurn,
    afterFirst.state.public.session.turnNumber
  );
  assert.equal(
    afterFirst.state.public.movement.currentLocomotiveId,
    attachment.locomotiveId
  );
  assert.deepEqual(afterFirst.state.public.movement.locomotiveOrder, savedOrder);
  assert.deepEqual(afterFirst.state.secret.random, savedRandom);
  assert.equal(afterFirst.state.public.session.phase, "operations");
  assert.deepEqual(afterFirst.state.public.log.at(-1), {
    eventType: "movement.locomotive.traversed",
    summary: "Текущий локомотив перешёл по выбранной дороге",
    audience: "public",
    data: {
      kind: "locomotive-traverse",
      locomotiveId: attachment.locomotiveId,
      edgeId: "road-1-2",
      fromNodeId: "terminal-1",
      toNodeId: "terminal-2",
      relatedIds: [attachment.wagonId],
      ownerTeamId,
      turnNumber: afterFirst.state.public.session.turnNumber
    }
  });

  const second = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });
  assert.equal(second.result.ok, true);
  const afterSecond = await session.store.getSession(session.sessionId);
  assert.equal(
    afterSecond.state.public.objects.locomotives[attachment.locomotiveId]
      .attributes.nodeId,
    "terminal-1"
  );
  assert.equal(
    afterSecond.state.public.objects.wagons[attachment.wagonId]
      .attributes.nodeId,
    "terminal-1"
  );
  assert.equal(
    afterSecond.state.public.objects.locomotives[attachment.locomotiveId]
      .attributes.actionPoints,
    3
  );
  assert.equal(
    afterSecond.state.public.movement.currentLocomotiveId,
    attachment.locomotiveId
  );
  assert.deepEqual(afterSecond.state.public.movement.locomotiveOrder, savedOrder);
  assert.deepEqual(afterSecond.state.secret.random, savedRandom);
  assert.equal(afterSecond.state.public.session.phase, "operations");
  assert.deepEqual(afterSecond.state.public.log.at(-1).data, {
    kind: "locomotive-traverse",
    locomotiveId: attachment.locomotiveId,
    edgeId: "road-1-2",
    fromNodeId: "terminal-2",
    toNodeId: "terminal-1",
    relatedIds: [attachment.wagonId],
    ownerTeamId,
    turnNumber: afterSecond.state.public.session.turnNumber
  });
});

test("traversal rejects invalid turn, current, action and graph state atomically", async () => {
  const manifest = await loadManifest();

  const wrongPhase = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(wrongPhase);
  await updateScenario(wrongPhase, (state) => {
    state.public.session.phase = "construction";
  });
  await assertRejectedWithoutMutation(wrongPhase, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });

  const resolvedCurrent = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(resolvedCurrent);
  await updateScenario(resolvedCurrent, (state) => {
    const currentId = state.public.movement.currentLocomotiveId;
    state.public.objects.locomotives[currentId].attributes.movementResolvedTurn =
      state.public.session.turnNumber;
  });
  await assertRejectedWithoutMutation(resolvedCurrent, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });

  const missingFromOrder = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(missingFromOrder);
  await updateScenario(missingFromOrder, (state) => {
    state.public.movement.locomotiveOrder =
      state.public.movement.locomotiveOrder.slice(1);
  });
  await assertRejectedWithoutMutation(missingFromOrder, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });

  const exhausted = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(exhausted);
  await updateScenario(exhausted, (state) => {
    const currentId = state.public.movement.currentLocomotiveId;
    state.public.objects.locomotives[currentId].attributes.actionPoints = 0;
  });
  await assertRejectedWithoutMutation(exhausted, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });

  const nonincident = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(nonincident);
  await assertRejectedWithoutMutation(nonincident, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-2-3-14" }
  });

  const blocked = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(blocked);
  await updateScenario(blocked, (state) => {
    state.public.objects.networkEdges["road-1-2"].facets.state = "blocked";
  });
  await assertRejectedWithoutMutation(blocked, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });

  const fullDestination = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(fullDestination);
  await updateScenario(fullDestination, (state) => {
    const objects = state.public.objects;
    const currentId = state.public.movement.currentLocomotiveId;
    const template = structuredClone(objects.locomotives[currentId]);
    for (const suffix of ["a", "b"]) {
      objects.locomotives[`locomotive:capacity-${suffix}`] =
        structuredClone(template);
      objects.locomotives[
        `locomotive:capacity-${suffix}`
      ].attributes.nodeId = "terminal-2";
    }
  });
  await assertRejectedWithoutMutation(fullDestination, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId: "road-1-2" }
  });
});

test("east, coins, owner count and seeded ties produce one saved reproducible order", async () => {
  const manifest = await loadManifest();
  const first = await prepareMovementBoundary(manifest, 11);
  const second = await prepareMovementBoundary(manifest, 11);
  const firstExpected = await arrangeOrderHierarchy(first);
  const secondExpected = await arrangeOrderHierarchy(second);
  assert.deepEqual(firstExpected, secondExpected);

  const firstPrepared = await prepareOrder(first);
  const secondPrepared = await prepareOrder(second);
  const order = firstPrepared.state.public.movement.locomotiveOrder;
  assert.deepEqual(order, secondPrepared.state.public.movement.locomotiveOrder);
  assert.deepEqual(order.slice(0, 3), [
    firstExpected.east,
    firstExpected.rich,
    firstExpected.numerous
  ]);
  assert.deepEqual(
    [...order.slice(3, 5)].sort(),
    [...firstExpected.tied].sort()
  );
  assert.equal(order[5], firstExpected.extra);
  assert.equal(firstPrepared.state.secret.random.counters.unrelated, 7);
  assert.equal(
    firstPrepared.state.secret.random.counters["locomotive-order"],
    1,
    "the complete tie must consume its dedicated named stream exactly once"
  );

  // The saved order, rather than a new sort, drives at least two and then all
  // explicit skips. No skip may consume any random stream.
  const randomAfterPrepare = structuredClone(firstPrepared.state.secret.random);
  for (let index = 0; index < order.length; index += 1) {
    const before = await first.store.getSession(first.sessionId);
    assert.equal(before.state.public.movement.currentLocomotiveId, order[index]);
    const outcome = await dispatch({
      ...first,
      actionId: "movement.locomotive.skip"
    });
    assert.equal(outcome.result.ok, true);
    const after = await first.store.getSession(first.sessionId);
    assert.equal(
      after.state.public.objects.locomotives[order[index]]
        .attributes.movementResolvedTurn,
      after.state.public.session.turnNumber
    );
    const skipEvent = after.state.public.log.at(-1);
    if (index < order.length - 1) {
      assert.equal(skipEvent.eventType, "movement.locomotive.skipped");
    } else {
      // The final skip also emits the phase-finished event after it.
      assert.equal(skipEvent.eventType, "movement.phase.finished");
    }
    const latestSkipped = [...after.state.public.log]
      .reverse()
      .find((event) => event.eventType === "movement.locomotive.skipped");
    assert.equal(latestSkipped?.data?.locomotiveId, order[index]);
    assert.equal(
      latestSkipped?.data?.ownerTeamId,
      after.state.public.objects.locomotives[order[index]].attributes.ownerTeamId
    );
    assert.deepEqual(after.state.secret.random, randomAfterPrepare);
    if (index < order.length - 1) {
      assert.equal(after.state.public.session.phase, "operations");
      assert.equal(
        after.state.public.movement.currentLocomotiveId,
        order[index + 1]
      );
    } else {
      assert.equal(after.state.public.session.phase, "settlement");
      assert.equal(after.state.public.movement.currentLocomotiveId, null);
    }
  }
  const finalState = await first.store.getSession(first.sessionId);
  const events = finalState.state.public.log;
  assert.equal(
    events.filter((event) => event.eventType === "movement.locomotive.skipped").length,
    order.length
  );
  assert.equal(events.at(-1).eventType, "movement.phase.finished");
});

test("prepare and skip fail closed on phase, fixture, marker and reference drift", async () => {
  const manifest = await loadManifest();

  const wrongPhase = await prepareMovementBoundary(manifest, 5);
  await updateScenario(wrongPhase, (state) => {
    state.public.session.phase = "market";
  });
  await assertRejectedWithoutMutation(wrongPhase, {
    actionId: "movement.order.prepare"
  });

  const wrongFixture = await prepareMovementBoundary(manifest, 5);
  await updateScenario(wrongFixture, (state) => {
    state.public.session.fixtureId = "technical-preview";
  });
  await assertRejectedWithoutMutation(wrongFixture, {
    actionId: "movement.order.prepare"
  });

  const markerDrift = await prepareMovementBoundary(manifest, 5);
  await updateScenario(markerDrift, (state) => {
    const locomotive = Object.values(state.public.objects.locomotives)[0];
    locomotive.attributes.turnOrderCount = 0;
  });
  await assertRejectedWithoutMutation(markerDrift, {
    actionId: "movement.order.prepare"
  });

  for (const missingField of ["nodeId", "ownerTeamId"]) {
    const missingReference = await prepareMovementBoundary(manifest, 5);
    await updateScenario(missingReference, (state) => {
      const locomotive = Object.values(state.public.objects.locomotives)[0];
      locomotive.attributes[missingField] = "missing-reference";
    });
    await assertRejectedWithoutMutation(missingReference, {
      actionId: "movement.order.prepare"
    });
  }

  const repeated = await prepareMovementBoundary(manifest, 5);
  const prepared = await prepareOrder(repeated);
  const resolvedId = prepared.state.public.movement.currentLocomotiveId;
  const firstSkip = await dispatch({
    ...repeated,
    actionId: "movement.locomotive.skip"
  });
  assert.equal(firstSkip.result.ok, true);
  await updateScenario(repeated, (state) => {
    state.public.movement.currentLocomotiveId = resolvedId;
  });
  await assertRejectedWithoutMutation(repeated, {
    actionId: "movement.locomotive.skip"
  });

  const malformedCurrent = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(malformedCurrent);
  await updateScenario(malformedCurrent, (state) => {
    const objects = state.public.objects;
    const template = Object.values(objects.locomotives)[0];
    objects.locomotives["locomotive:not-in-order"] = structuredClone(template);
    objects.locomotives["locomotive:not-in-order"].attributes.movementResolvedTurn = 0;
    state.public.movement.currentLocomotiveId = "locomotive:not-in-order";
  });
  await assertRejectedWithoutMutation(malformedCurrent, {
    actionId: "movement.locomotive.skip"
  });

  const wrongSkipPhase = await prepareMovementBoundary(manifest, 5);
  await prepareOrder(wrongSkipPhase);
  await updateScenario(wrongSkipPhase, (state) => {
    state.public.session.phase = "construction";
  });
  await assertRejectedWithoutMutation(wrongSkipPhase, {
    actionId: "movement.locomotive.skip"
  });
});
