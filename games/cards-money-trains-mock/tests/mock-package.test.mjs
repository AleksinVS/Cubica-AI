/** Focused tests for the game-local annotation pipeline and runtime transcript. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import {
  getGameAssetFile,
  getGameAssetIndex,
  getPublishedPlayerWebPluginBundleSource,
  loadPlayerFacingContent
} from "../../../services/runtime-api/src/modules/content/contentService.ts";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { createCanonicalReplayFingerprint } from "../../../services/runtime-api/src/modules/runtime/replayFingerprint.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import {
  toManifestFragment,
  toReviewOverlaySvg,
  validateAnnotation
} from "../tools/convert-map-annotation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(packageRoot, relativePath), "utf8"));
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const testCredentialSha256 = "a".repeat(64);
// Gameplay transcript tests exercise the published rules, not HTTP admission.
// Passing the explicit port keeps the production dispatcher dependency honest
// while rate/quota behavior remains covered by command-admission.test.ts.
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

/** Creates a fully authenticated session over the same immutable bundle runtime will replay. */
const createFacilitatorSession = async (manifest, initialState = structuredClone(manifest.state)) => {
  const immutableBundle = createImmutableBundleContent(manifest.meta.id, manifest);
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState,
    immutableBundle,
    principal: {
      principalId: "mock-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256: testCredentialSha256
    }
  });
  return { store, session: created.session };
};

/** Dispatches one logical test command with a fresh idempotency identity. */
const dispatchTestAction = async ({ store, sessionId, actionId, params = {} }) => {
  const current = await store.getSession(sessionId);
  return dispatchRuntimeAction({
    sessionStore: store,
    credentialSha256: testCredentialSha256,
    admissionController: testAdmissionController,
    input: {
      sessionId,
      actionId,
      commandId: createTestCommandId(),
      expectedStateVersion: current.version.stateVersion,
      params
    }
  });
};

/**
 * Gameplay rule failures are durable terminal command outcomes, not transport
 * exceptions. Verify both the rejected receipt and the safe public diagnostic
 * while the surrounding assertions prove that state stayed unchanged.
 */
const assertRejectedAction = async (dispatch, messagePattern) => {
  const outcome = await dispatch;
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.receipt.status, "rejected");
  assert.match(
    `${outcome.result.error?.code ?? ""} ${outcome.result.error?.message ?? ""}`,
    messagePattern
  );
};

/**
 * Returns the complete published operation vocabulary used by this game.
 *
 * Keeping the assertion at the operation boundary prevents a domain-specific
 * train command from slipping into the platform language unnoticed.
 */
const collectMechanicsOperations = (mechanics) => [...new Set(
  Object.values(mechanics.plans).flatMap((plan) =>
    plan.transaction.steps.map((step) => step.op)
  )
)].sort();

/** Recursively collects typed state and collection references from one plan. */
const collectPlanReferences = (value, references = { endpoints: new Set(), collections: new Set() }) => {
  if (Array.isArray(value)) {
    for (const item of value) collectPlanReferences(item, references);
    return references;
  }
  if (!value || typeof value !== "object") return references;
  if (typeof value.endpoint === "string") references.endpoints.add(value.endpoint);
  if (typeof value.collection === "string") references.collections.add(value.collection);
  for (const child of Object.values(value)) collectPlanReferences(child, references);
  return references;
};

/**
 * Verifies compiler-owned identity and all Mechanics IR references shared by
 * every action. The hashes make a receipt name the exact immutable rule used.
 */
const assertPublishedMechanicsContract = (manifest) => {
  assert.equal(manifest.mechanics.apiVersion, "cubica.dev/mechanics/v1alpha1");
  assert.equal(Object.keys(manifest.actions).length, Object.keys(manifest.mechanics.plans).length);

  for (const [actionId, action] of Object.entries(manifest.actions)) {
    assert.deepEqual(action.binding, { kind: "mechanics-plan", planRef: actionId });
    assert.match(action.definitionHash, sha256Pattern, `${actionId} must have a compiler-owned definition hash`);
    assert.match(
      manifest.mechanics.plans[actionId].planHash,
      sha256Pattern,
      `${actionId} must address an immutable Mechanics plan`
    );
  }

  const operationModules = {
    "core.assert": "cubica.core",
    "core.collection.id.allocate": "cubica.core",
    "core.entities.order": "cubica.ordering",
    "core.entities.score": "cubica.core",
    "core.entities.select": "cubica.core",
    "core.entities.update": "cubica.core",
    "core.entity.attributes.patch": "cubica.core",
    "core.entity.create": "cubica.core",
    "core.entity.facet.set": "cubica.core",
    "core.event.emit": "cubica.core",
    "core.number.add": "cubica.core",
    "core.ranking.stable": "cubica.core",
    "core.resource.transfer": "cubica.core",
    "core.state.patch": "cubica.core",
    "deck.draw": "cubica.deck",
    "deck.extract": "cubica.deck",
    "deck.return": "cubica.deck",
    "deck.shuffle": "cubica.deck",
    "graph.edge.position.inspect": "cubica.graph",
    "graph.edge.split": "cubica.graph",
    "graph.entity.traverse": "cubica.graph",
    "graph.regions.route.plan": "cubica.graph",
    "graph.shortestPath": "cubica.graph",
    "relation.attach": "cubica.relations",
    "relation.detach": "cubica.relations"
  };
  assert.deepEqual(collectMechanicsOperations(manifest.mechanics), Object.keys(operationModules).sort());
  assert.deepEqual(
    Object.keys(manifest.mechanics.moduleLock),
    ["cubica.core", "cubica.random", "cubica.ordering", "cubica.deck", "cubica.graph", "cubica.relations"],
    "the compiler must publish the exact dependency-closed module lock"
  );
  for (const moduleId of Object.keys(manifest.mechanics.moduleLock)) {
    const lock = manifest.mechanics.moduleLock[moduleId];
    assert.equal(lock.moduleId, moduleId);
    assert.match(lock.moduleVersion, /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u);
    assert.match(lock.artifactHash, sha256Pattern);
  }

  const references = collectPlanReferences(manifest.mechanics.plans);
  for (const endpoint of references.endpoints) {
    assert.ok(manifest.mechanics.stateModel.endpoints[endpoint], `undeclared state endpoint: ${endpoint}`);
  }
  for (const collection of references.collections) {
    assert.ok(manifest.mechanics.stateModel.collections[collection], `undeclared collection: ${collection}`);
  }

  const rankingEndpoint = manifest.mechanics.stateModel.endpoints["public.ranking"];
  assert.equal(
    manifest.mechanics.stateModel.types[rankingEndpoint.valueType].kind,
    "record",
    "the neutral ranking composition must target a typed record"
  );
  const rankingResultType = manifest.mechanics.stateModel.types[rankingEndpoint.valueType];
  const groupMapType = manifest.mechanics.stateModel.types[rankingResultType.fields.groups.typeRef];
  const groupType = manifest.mechanics.stateModel.types[groupMapType.valueType];
  const standingListType = manifest.mechanics.stateModel.types[groupType.fields.standings.typeRef];
  const standingType = manifest.mechanics.stateModel.types[standingListType.itemType];
  assert.deepEqual(Object.keys(standingType.fields).sort(), [
    "baseValue",
    "entityId",
    "rank",
    "relatedItems",
    "relatedValue",
    "score"
  ]);
  assert.deepEqual(manifest.state.public.ranking, { groups: {} });
  assert.deepEqual(manifest.state.public.session.locomotiveOrder, []);
};

test("mock annotation validates and reproduces the committed manifest fragment", async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const annotation = await validateAnnotation(await readJson("annotations/map-annotation.mock.json"), annotationPath);
  const fragment = toManifestFragment(annotation);
  assert.deepEqual(fragment, await readJson("generated/network.manifest-fragment.json"));
  assert.equal(fragment.networkModels.main.regions[0].polygon.length, 4);
  assert.notDeepEqual(fragment.networkModels.main.regions[0].polygon[0], fragment.networkModels.main.regions[0].polygon.at(-1));
  assert.equal(fragment.networkModels.main.roadPlanning.mode, "region-segment-minimum");
  assert.equal(fragment.networkModels.main.roadPlanning.navigationGraph.portals.length, 2);
  assert.match(fragment.networkModels.main.roadPlanning.geometryHash, /^sha256:[0-9a-f]{64}$/u);
  for (const node of Object.values(fragment.state.public.objects.networkNodes)) {
    assert.equal(Object.hasOwn(node.attributes, "positionX"), false);
    assert.equal(Number.isFinite(node.attributes.position.x), true);
  }
});

test("mock adapter rejects author-confirmed data", async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const source = await readJson("annotations/map-annotation.mock.json");
  source.status = "author-confirmed";
  const annotation = await validateAnnotation(source, annotationPath);
  assert.throws(
    () => toManifestFragment(annotation),
    /author-confirmed annotation cannot produce a manifest fragment/
  );
});

test("review overlay contains the source image underneath regions, roads and nodes", async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const annotation = await validateAnnotation(
    await readJson("annotations/map-annotation.mock.json"),
    annotationPath
  );
  const svg = toReviewOverlaySvg(annotation, { backgroundHref: "../assets/images/mock-board.svg" });
  assert.match(svg, /<image href="\.\.\/assets\/images\/mock-board\.svg"/);
  assert.match(svg, /<polygon /);
  assert.match(svg, /<line /);
  assert.match(svg, /<circle /);
  assert.ok(svg.indexOf("<image ") < svg.indexOf("<polygon "), "background must be emitted before annotations");
  assert.throws(() => toReviewOverlaySvg(annotation, { backgroundHref: "https://example.invalid/map.png" }), /local relative path/);
});

test("semantic validation rejects dangling references, out-of-bounds points and self-intersections", async () => {
  const source = await readJson("annotations/map-annotation.mock.json");
  const inputPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");

  const dangling = structuredClone(source);
  dangling.edges[0].toNodeId = "missing-node";
  await assert.rejects(validateAnnotation(dangling, inputPath), /missing toNodeId/);

  const outside = structuredClone(source);
  outside.nodes[0].position.x = 99999;
  await assert.rejects(validateAnnotation(outside, inputPath), /outside/);

  const crossed = structuredClone(source);
  crossed.regions[0].polygon = [
    { x: 50, y: 50 }, { x: 400, y: 400 }, { x: 50, y: 400 }, { x: 350, y: 50 }, { x: 50, y: 50 }
  ];
  await assert.rejects(validateAnnotation(crossed, inputPath), /self-intersects/);
});

test("compiled mock executes the documented operating and construction transcript", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const transcript = await readJson("fixtures/control-transcript.json");
  const { store, session } = await createFacilitatorSession(manifest);

  for (const step of transcript.steps) {
    const outcome = await dispatchTestAction({
      store,
      sessionId: session.sessionId,
      actionId: step.actionId,
      params: step.params ?? {}
    });
    assert.equal(outcome.result.ok, true, `control step ${step.order} must be applied`);
    assert.equal(outcome.receipt.status, "applied", `control step ${step.order} must have an applied receipt`);
    if (step.order === 16) {
      const afterDelivery = await store.getSession(session.sessionId);
      assert.equal(afterDelivery.state.public.teams["white-logistics"].coins, 9);
      assert.equal(afterDelivery.state.public.teams["purple-guild"].coins, 11);
    }
  }

  const current = await store.getSession(session.sessionId);
  const publicState = current.state.public;
  assert.equal(current.version.stateVersion, transcript.steps.length);
  assert.equal(publicState.session.phase, "debrief");
  assert.equal(publicState.construction.available, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(publicState.teams).map(([id, team]) => [id, team.coins])),
    transcript.final.balances
  );
  assert.equal(publicState.objects.networkEdges["mock-edge-c-d"].facets.state, "blocked");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-c");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 1);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.attachedVehicleId, null);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.cargoId, null);
  assert.equal(publicState.objects.cargoOrders["mock-cargo-b-c"].facets.status, "delivered");
  assert.equal(publicState.objects.cargoOrders["mock-cargo-b-c"].attributes.settledRouteLength, 1);
  assert.equal(publicState.objects.wagons["mock-wagon-white-2"].attributes.cargoId, "mock-cargo-b-f");
  assert.equal(publicState.log.length, 18);
  assert.equal(publicState.objects.networkEdges["mock-edge-e-f"], undefined);
  const plannedRoad = publicState.objects.networkEdges["main:edge:1001"].attributes;
  assert.equal(plannedRoad.constructionCost, 6);
  assert.equal(plannedRoad.regionSegments, 3);
  assert.ok(plannedRoad.geometry.polyline.length >= 2);
  assert.equal(plannedRoad.routePlan.algorithmVersion, "region-segment-minimum-v1");
  assert.deepEqual(plannedRoad.routePlan.regionSequence, [
    "mock-region-west",
    "mock-region-central",
    "mock-region-east"
  ]);
  assert.equal(publicState.objects.networkEdges["main:edge:1001"].facets.state, "building");
  assert.equal(plannedRoad.createdTurn, 1);
  assert.equal(plannedRoad.activationTurn, 3);
  assert.deepEqual(plannedRoad.blockingReasons, ["construction-pending"]);
  assert.equal(publicState.objects.networkNodes["main:node:1002"].objectType, "transport.waypoint");
  assert.equal(publicState.objects.networkNodes["main:node:1002"].facets.availability, "building");
  assert.equal(publicState.objects.networkEdges["main:edge:1003"].facets.state, "building");
});

test("a waypoint created from exact geometry is immediately usable by typed locomotive ordering", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const constructionState = structuredClone(manifest.state);
  constructionState.public.session.phase = "construction";
  constructionState.public.construction.available = true;
  const construction = await createFacilitatorSession(manifest, constructionState);

  const build = await dispatchTestAction({
    store: construction.store,
    sessionId: construction.session.sessionId,
    actionId: "construction.waypoint.build",
    params: {
      edgeId: "mock-edge-e-f",
      positionT: 0.5,
      whiteContribution: 3,
      redContribution: 2,
      purpleContribution: 0,
      greenContribution: 0
    }
  });
  assert.equal(build.result.ok, true);

  const afterBuild = await construction.store.getSession(construction.session.sessionId);
  const [waypointId, waypoint] = Object.entries(
    afterBuild.state.public.objects.networkNodes
  ).find(([id, node]) =>
    id.startsWith("main:node:") && node.objectType === "transport.waypoint"
  ) ?? [];
  assert.equal(typeof waypointId, "string");
  assert.equal(Object.hasOwn(waypoint.attributes, "positionX"), false);
  assert.equal(Number.isFinite(waypoint.attributes.position.x), true);

  // Re-enter at the next cargo-order boundary using the durable state produced
  // by construction. The new node has only canonical `position`; Mechanics
  // must resolve the horizontal coordinate through its declared projection.
  const orderingState = structuredClone(afterBuild.state);
  orderingState.public.session.phase = "cargo";
  orderingState.public.objects.locomotives[
    "mock-locomotive-purple-1"
  ].attributes.nodeId = waypointId;
  const ordering = await createFacilitatorSession(manifest, orderingState);
  const finishCargo = await dispatchTestAction({
    store: ordering.store,
    sessionId: ordering.session.sessionId,
    actionId: "mock.cargo.finish"
  });
  assert.equal(finishCargo.result.ok, true);

  const afterOrdering = await ordering.store.getSession(ordering.session.sessionId);
  assert.deepEqual(afterOrdering.state.public.session.locomotiveOrder, [
    "mock-locomotive-green-1",
    "mock-locomotive-purple-1"
  ]);
});

test("forbidden waypoint, closed edge, full terminal, premature delivery and insufficient maintenance fail atomically", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const createSession = async (mutate) => {
    const state = structuredClone(manifest.state);
    mutate?.(state);
    return createFacilitatorSession(manifest, state);
  };

  const underfunded = await createSession((state) => {
    state.public.session.phase = "maintenance";
    state.public.teams["white-logistics"].coins = 1;
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: underfunded.store,
      sessionId: underfunded.session.sessionId,
      actionId: "mock.maintenance.pay"
    }),
    /negative|insufficient/i
  );
  let current = await underfunded.store.getSession(underfunded.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.deepEqual(
    Object.fromEntries(Object.entries(current.state.public.teams).map(([id, team]) => [id, team.coins])),
    { "white-logistics": 1, "red-logistics": 10, "purple-guild": 10, "green-guild": 10 }
  );

  const closed = await createSession((state) => {
    state.public.session.phase = "operations";
    state.public.objects.networkEdges["mock-edge-b-c"].facets.state = "blocked";
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: closed.store,
      sessionId: closed.session.sessionId,
      actionId: "mock.locomotive.move",
      params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
    }),
    /not in an allowed state|unavailable for movement/i
  );
  current = await closed.store.getSession(closed.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-b");
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 5);

  const full = await createSession((state) => {
    state.public.session.phase = "operations";
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: full.store,
      sessionId: full.session.sessionId,
      actionId: "mock.locomotive.move",
      params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
    }),
    /capacity/i
  );
  current = await full.store.getSession(full.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-b");

  const premature = await createSession((state) => {
    state.public.session.phase = "operations";
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: premature.store,
      sessionId: premature.session.sessionId,
      actionId: "mock.cargo.deliver",
      params: { wagonId: "mock-wagon-white-1", cargoId: "mock-cargo-b-c" }
    }),
    /CARGO_DELIVERY_INVALID|assertion/i
  );
  current = await premature.store.getSession(premature.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.teams["white-logistics"].coins, 10);
  assert.equal(current.state.public.teams["purple-guild"].coins, 10);
  assert.equal(current.state.public.objects.cargoOrders["mock-cargo-b-c"].facets.status, "in_transit");

  const incompatible = await createSession((state) => {
    state.public.session.phase = "operations";
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: incompatible.store,
      sessionId: incompatible.session.sessionId,
      actionId: "mock.operations.attach.incompatible",
      params: { vehicleId: "mock-locomotive-purple-1", wagonId: "mock-wagon-red-1" }
    }),
    /incompatible/i
  );
  current = await incompatible.store.getSession(incompatible.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 5);

  const marketCredit = await createSession((state) => {
    state.public.session.phase = "market";
    state.public.teams["green-guild"].coins = 9;
  });
  await assertRejectedAction(
    dispatchTestAction({
      store: marketCredit.store,
      sessionId: marketCredit.session.sessionId,
      actionId: "mock.market.buy.green-locomotive"
    }),
    /negative|insufficient/i
  );
  current = await marketCredit.store.getSession(marketCredit.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.teams["green-guild"].coins, 9);
  assert.equal(
    current.state.public.objects.locomotives["mock-market-locomotive-green-2"].facets.availability,
    "reserve"
  );

  const forbiddenWaypoint = await createSession((state) => {
    state.public.session.phase = "construction";
    state.public.construction.available = true;
  });
  const beforeForbiddenWaypoint = await forbiddenWaypoint.store.getSession(
    forbiddenWaypoint.session.sessionId
  );
  await assertRejectedAction(
    dispatchTestAction({
      store: forbiddenWaypoint.store,
      sessionId: forbiddenWaypoint.session.sessionId,
      actionId: "construction.waypoint.build",
      params: {
        edgeId: "mock-edge-a-b",
        positionT: 0.5,
        whiteContribution: 3,
        redContribution: 2,
        purpleContribution: 0,
        greenContribution: 0
      }
    }),
    /CONSTRUCTION_WAYPOINT_IN_ENDPOINT_REGION|assertion/i
  );
  current = await forbiddenWaypoint.store.getSession(forbiddenWaypoint.session.sessionId);
  assert.equal(current.version.stateVersion, beforeForbiddenWaypoint.version.stateVersion);
  assert.deepEqual(current.state, beforeForbiddenWaypoint.state);
});

test("closed cargo terminals reject loading and delivery without partial state changes", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));

  /**
   * A rejected cargo command must preserve the gameplay state it attempted to
   * change. Compare the complete team ledger plus the wagon and cargo order so
   * the test catches partial payment, loading, unloading or status transitions.
   */
  const assertCargoStateUnchanged = async ({ store, sessionId, before, wagonId, cargoId }) => {
    const after = await store.getSession(sessionId);
    assert.equal(after.version.stateVersion, before.version.stateVersion);
    assert.deepEqual(after.state.public.teams, before.state.public.teams);
    assert.deepEqual(
      after.state.public.objects.wagons[wagonId],
      before.state.public.objects.wagons[wagonId]
    );
    assert.deepEqual(
      after.state.public.objects.cargoOrders[cargoId],
      before.state.public.objects.cargoOrders[cargoId]
    );
  };

  const loadState = structuredClone(manifest.state);
  loadState.public.session.phase = "cargo";
  loadState.public.decks.cargo.offer.firstCardId = "mock-cargo-b-f";
  loadState.public.objects.networkNodes["mock-terminal-b"].facets.availability = "closed";
  const load = await createFacilitatorSession(manifest, loadState);
  const beforeLoad = await load.store.getSession(load.session.sessionId);

  await assertRejectedAction(
    dispatchTestAction({
      store: load.store,
      sessionId: load.session.sessionId,
      actionId: "mock.cargo.load.white",
      params: { wagonId: "mock-wagon-white-2", cargoId: "mock-cargo-b-f" }
    }),
    /CARGO_LOAD_INVALID|assertion/i
  );
  await assertCargoStateUnchanged({
    store: load.store,
    sessionId: load.session.sessionId,
    before: beforeLoad,
    wagonId: "mock-wagon-white-2",
    cargoId: "mock-cargo-b-f"
  });

  const deliveryState = structuredClone(manifest.state);
  deliveryState.public.session.phase = "operations";
  deliveryState.public.objects.wagons["mock-wagon-white-1"].attributes.nodeId = "mock-terminal-c";
  deliveryState.public.objects.networkNodes["mock-terminal-c"].facets.availability = "closed";
  const delivery = await createFacilitatorSession(manifest, deliveryState);
  const beforeDelivery = await delivery.store.getSession(delivery.session.sessionId);

  await assertRejectedAction(
    dispatchTestAction({
      store: delivery.store,
      sessionId: delivery.session.sessionId,
      actionId: "mock.cargo.deliver",
      params: { wagonId: "mock-wagon-white-1", cargoId: "mock-cargo-b-c" }
    }),
    /CARGO_DELIVERY_INVALID|assertion/i
  );
  await assertCargoStateUnchanged({
    store: delivery.store,
    sessionId: delivery.session.sessionId,
    before: beforeDelivery,
    wagonId: "mock-wagon-white-1",
    cargoId: "mock-cargo-b-c"
  });
});

test("dynamic cargo and coupling actions use selected active objects and their actual owners", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));

  const loadState = structuredClone(manifest.state);
  loadState.public.session.phase = "cargo";
  loadState.public.decks.cargo.offer.firstCardId = "mock-cargo-b-f";
  loadState.public.decks.cargo.offer.secondCardId = "mock-cargo-f-a";
  loadState.secret.decks.cargo = {
    order: [],
    discard: [],
    held: ["mock-cargo-b-f", "mock-cargo-f-a"],
    stream: "deck.cargo"
  };
  const load = await createFacilitatorSession(manifest, loadState);
  const loadOutcome = await dispatchTestAction({
    store: load.store,
    sessionId: load.session.sessionId,
    actionId: "mock.cargo.load.white",
    params: {
      wagonId: "mock-wagon-red-2",
      cargoId: "mock-cargo-f-a"
    }
  });
  assert.equal(loadOutcome.result.ok, true);
  let current = await load.store.getSession(load.session.sessionId);
  assert.equal(
    current.state.public.objects.wagons["mock-wagon-red-2"].attributes.cargoId,
    "mock-cargo-f-a"
  );
  assert.equal(
    current.state.public.objects.cargoOrders["mock-cargo-f-a"].facets.status,
    "in_transit"
  );
  assert.equal(current.state.public.teams["red-logistics"].maintenanceDue, 3);
  assert.equal(current.state.public.teams["white-logistics"].maintenanceDue, 3);
  assert.equal(current.state.public.decks.cargo.offer.firstCardId, null);
  assert.equal(current.state.public.decks.cargo.offer.secondCardId, "mock-cargo-f-a");
  assert.deepEqual(current.state.secret.decks.cargo, {
    order: [],
    discard: ["mock-cargo-b-f"],
    held: ["mock-cargo-f-a"],
    stream: "deck.cargo"
  });

  const finishCargoOutcome = await dispatchTestAction({
    store: load.store,
    sessionId: load.session.sessionId,
    actionId: "mock.cargo.finish"
  });
  assert.equal(finishCargoOutcome.result.ok, true);
  current = await load.store.getSession(load.session.sessionId);
  assert.equal(current.state.public.session.phase, "operations");
  assert.deepEqual(current.state.public.session.locomotiveOrder, [
    "mock-locomotive-green-1",
    "mock-locomotive-purple-1"
  ]);
  assert.deepEqual(current.state.public.decks.cargo.offer, {
    firstCardId: null,
    secondCardId: null
  });
  assert.deepEqual(
    current.state.secret.decks.cargo.held,
    ["mock-cargo-f-a"],
    "a loaded cargo stays outside deck rotation until delivery"
  );

  const couplingState = structuredClone(manifest.state);
  couplingState.public.session.phase = "operations";
  couplingState.public.objects.wagons["mock-wagon-red-2"].attributes.nodeId = "mock-terminal-c";
  const coupling = await createFacilitatorSession(manifest, couplingState);
  const attachOutcome = await dispatchTestAction({
    store: coupling.store,
    sessionId: coupling.session.sessionId,
    actionId: "mock.operations.attach.white",
    params: {
      vehicleId: "mock-locomotive-green-1",
      wagonId: "mock-wagon-red-2"
    }
  });
  assert.equal(attachOutcome.result.ok, true);
  current = await coupling.store.getSession(coupling.session.sessionId);
  assert.equal(
    current.state.public.objects.wagons["mock-wagon-red-2"].attributes.attachedVehicleId,
    "mock-locomotive-green-1"
  );
  assert.equal(
    current.state.public.objects.locomotives["mock-locomotive-green-1"].attributes.actionPoints,
    4
  );

  const detachOutcome = await dispatchTestAction({
    store: coupling.store,
    sessionId: coupling.session.sessionId,
    actionId: "mock.operations.detach.white",
    params: {
      vehicleId: "mock-locomotive-green-1",
      wagonId: "mock-wagon-red-2"
    }
  });
  assert.equal(detachOutcome.result.ok, true);
  current = await coupling.store.getSession(coupling.session.sessionId);
  assert.equal(
    current.state.public.objects.wagons["mock-wagon-red-2"].attributes.attachedVehicleId,
    null
  );
  assert.equal(
    current.state.public.objects.locomotives["mock-locomotive-green-1"].attributes.actionPoints,
    3
  );

  const deliveryState = structuredClone(manifest.state);
  deliveryState.public.session.phase = "operations";
  deliveryState.public.objects.locomotives["mock-locomotive-green-1"].attributes.nodeId =
    "mock-terminal-e";
  Object.assign(deliveryState.public.objects.wagons["mock-wagon-red-2"].attributes, {
    nodeId: "mock-terminal-e",
    attachedVehicleId: "mock-locomotive-green-1",
    cargoId: "mock-cargo-c-e"
  });
  deliveryState.public.objects.cargoOrders["mock-cargo-c-e"].facets.status = "in_transit";
  deliveryState.public.teams["red-logistics"].maintenanceDue = 3;
  deliveryState.secret.decks.cargo = {
    order: [],
    discard: [],
    held: ["mock-cargo-c-e"],
    stream: "deck.cargo"
  };
  const delivery = await createFacilitatorSession(manifest, deliveryState);
  const deliveryOutcome = await dispatchTestAction({
    store: delivery.store,
    sessionId: delivery.session.sessionId,
    actionId: "mock.cargo.deliver",
    params: {
      wagonId: "mock-wagon-red-2",
      cargoId: "mock-cargo-c-e"
    }
  });
  assert.equal(deliveryOutcome.result.ok, true);
  current = await delivery.store.getSession(delivery.session.sessionId);
  assert.equal(current.state.public.teams["red-logistics"].coins, 13);
  assert.equal(current.state.public.teams["green-guild"].coins, 14);
  assert.equal(current.state.public.teams["red-logistics"].maintenanceDue, 2);
  assert.equal(current.state.public.teams["white-logistics"].maintenanceDue, 3);
  assert.equal(
    current.state.public.objects.wagons["mock-wagon-red-2"].attributes.cargoId,
    null
  );
  assert.equal(
    current.state.public.objects.wagons["mock-wagon-red-2"].attributes.attachedVehicleId,
    null
  );
  assert.equal(
    current.state.public.objects.cargoOrders["mock-cargo-c-e"].facets.status,
    "delivered"
  );
  assert.equal(
    current.state.public.objects.cargoOrders["mock-cargo-c-e"].attributes.settledRouteLength,
    2
  );
  assert.deepEqual(current.state.secret.decks.cargo, {
    order: [],
    discard: ["mock-cargo-c-e"],
    held: [],
    stream: "deck.cargo"
  });
});

test("full mock data declares hidden decks and an immutable, fully typed Mechanics program", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const gameplay = await readJson("fixtures/mock-gameplay-data.json");
  const mechanicsSource = await readJson("authoring/mechanics.source.json");
  const textContent = await readJson("fixtures/mock-text-content.json");
  assert.deepEqual(gameplay.phaseOrder, [
    "setup", "news", "maintenance", "market", "cargo",
    "operations", "construction", "debrief", "finished"
  ]);
  assert.equal(textContent.newsCards.length >= 6, true);
  assert.equal(textContent.cargoCards.length >= 12, true);
  assert.deepEqual(Object.keys(manifest.state.secret).sort(), ["decks", "random"]);
  assert.equal(Object.keys(manifest.state.public.objects.newsCards).length, textContent.newsCards.length);
  assert.equal(Object.keys(manifest.state.public.objects.cargoCards).length, textContent.cargoCards.length);
  assert.deepEqual(manifest.content.data.mockGameplay.roles, textContent.roles);
  assert.equal(manifest.content.data.mockGameplay.newsCards[0].title, textContent.newsCards[0].title);
  assert.equal(manifest.config.runtimeReady, true);
  assert.equal(Object.hasOwn(manifest.config, "runtimeBlockers"), false);
  assert.equal(Object.hasOwn(manifest.content.data, "contentGates"), false);

  assertPublishedMechanicsContract(manifest);
  assert.equal(Object.hasOwn(mechanicsSource.mechanics, "moduleLock"), false);
  for (const collection of ["wagons", "locomotives"]) {
    assert.equal(
      Object.hasOwn(manifest.mechanics.stateModel.endpoints, `public.objects.${collection}`),
      false,
      "the collection is the typed source of truth; a concrete snapshot endpoint must not narrow later writes"
    );
  }
  for (const fieldId of ["cargoId", "attachedVehicleId"]) {
    assert.equal(manifest.mechanics.stateModel.collections.wagons.fields[fieldId].valueType, "core.optional-string");
  }
  assert.deepEqual(manifest.mechanics.stateModel.types["core.optional-string"], {
    kind: "option",
    itemType: "core.string"
  });
  assert.deepEqual(mechanicsSource.mechanics.macros["cmt.cargo.deliver"].inputs.tariffPerEdge, {
    kind: "value-expression"
  });
  const cargoDeliveryInvocations = Object.values(mechanicsSource.mechanics.plans).flatMap((plan) =>
    plan.transaction.steps.filter((step) => step.macro === "cmt.cargo.deliver")
  );
  assert.equal(cargoDeliveryInvocations.length, 2);
  for (const invocation of cargoDeliveryInvocations) {
    assert.deepEqual(invocation.args.tariffPerEdge, { op: "value.literal", value: 2 });
  }
  assert.deepEqual(Object.keys(mechanicsSource.mechanics.macros).sort(), [
    "cmt.cargo.deliver",
    "cmt.cargo.load",
    "cmt.construction.road",
    "cmt.construction.waypoint",
    "cmt.graph.traverse-with-action",
    "cmt.ranking.compute",
    "cmt.relation.attach-with-action",
    "cmt.relation.detach-with-action"
  ]);
  assert.equal(Object.hasOwn(manifest.mechanics, "macros"), false, "authoring macros must never reach runtime IR");

  const serializedMechanics = JSON.stringify(manifest.mechanics);
  for (const legacyTerm of [
    "graph.asset.traverse",
    "graph.regions.edge.insert",
    "inventory.item.load",
    "inventory.item.deliver",
    "ranking.groups.compute"
  ]) {
    assert.equal(serializedMechanics.includes(legacyTerm), false, `published Mechanics must not contain ${legacyTerm}`);
  }
  for (const removedField of [
    "cargoDelivery",
    "roadCostPerRegionSegment",
    "waypointCost",
    "constructionLifecycle"
  ]) {
    assert.equal(Object.hasOwn(manifest.networkModels.main, removedField), false, `graph model must not contain ${removedField}`);
  }
  assert.equal(Object.hasOwn(manifest.networkModels.main.movement, "actionPointsAttribute"), false);

  const planOps = (planId) => manifest.mechanics.plans[planId].transaction.steps.map((step) => step.op);
  assert.deepEqual(planOps("mock.cargo.load.white"), [
    "core.assert",
    "core.assert",
    "core.entity.attributes.patch",
    "core.entity.facet.set",
    "core.number.add",
    "deck.return",
    "core.state.patch",
    "deck.return",
    "core.state.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.cargo.finish"), [
    "core.assert",
    "deck.return",
    "deck.return",
    "core.entities.select",
    "core.entities.order",
    "core.state.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.cargo.draw-offer"), [
    "core.assert",
    "deck.draw",
    "deck.extract",
    "deck.draw",
    "deck.extract",
    "core.event.emit"
  ]);
  const cargoOfferDraws =
    manifest.mechanics.plans["mock.cargo.draw-offer"].transaction.steps
      .filter((step) => step.op === "deck.draw");
  assert.equal(cargoOfferDraws.length, 2);
  assert.ok(
    cargoOfferDraws.every((step) => step.onEmpty === "reshuffle-discard"),
    "a new cargo offer must recycle the discard instead of exhausting a finite test deck"
  );
  const locomotiveOrderStep =
    manifest.mechanics.plans["mock.cargo.finish"].transaction.steps
      .find((step) => step.op === "core.entities.order");
  assert.deepEqual(locomotiveOrderStep?.keys, [
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
  assert.deepEqual(locomotiveOrderStep?.tieBreak, {
    kind: "seeded-random",
    stream: "locomotive-order"
  });
  assert.deepEqual(planOps("mock.cargo.deliver"), [
    "core.assert",
    "core.assert",
    "graph.shortestPath",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.entity.attributes.patch",
    "core.entity.facet.set",
    "core.entity.attributes.patch",
    "core.number.add",
    "deck.return",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.locomotive.move"), [
    "core.assert",
    "core.assert",
    "graph.entity.traverse",
    "core.entity.attributes.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.operations.attach.white"), [
    "core.assert",
    "core.assert",
    "relation.attach",
    "core.entity.attributes.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.operations.detach.white"), [
    "core.assert",
    "core.assert",
    "relation.detach",
    "core.entity.attributes.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("mock.ranking.compute"), [
    "core.assert",
    "core.entities.score",
    "core.ranking.stable",
    "core.state.patch",
    "core.event.emit"
  ]);
  assert.deepEqual(planOps("construction.road.build"), [
    "core.assert",
    "graph.regions.route.plan",
    "core.assert",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.collection.id.allocate",
    "core.entity.create"
  ]);
  assert.deepEqual(planOps("construction.waypoint.build"), [
    "core.assert",
    "core.assert",
    "graph.edge.position.inspect",
    "core.assert",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.resource.transfer",
    "core.resource.transfer",
    "graph.edge.split",
    "core.entity.facet.set",
    "core.entity.attributes.patch",
    "core.entity.facet.set",
    "core.entity.attributes.patch",
    "core.entity.facet.set",
    "core.entity.attributes.patch"
  ]);
  const waypointSteps =
    manifest.mechanics.plans["construction.waypoint.build"].transaction.steps;
  const waypointInspect = waypointSteps.find(
    (step) => step.op === "graph.edge.position.inspect"
  );
  const waypointRegionGuard = waypointSteps.find(
    (step) => step.errorCode === "CONSTRUCTION_WAYPOINT_IN_ENDPOINT_REGION"
  );
  assert.equal(typeof waypointInspect?.id, "string");
  assert.deepEqual(waypointRegionGuard?.predicate, {
    op: "predicate.set.disjoint",
    left: {
      op: "value.result",
      stepId: waypointInspect.id,
      path: ["pointRegionIds"]
    },
    right: {
      op: "value.result",
      stepId: waypointInspect.id,
      path: ["endpoints", "regionIds"]
    }
  });
  const waypointSplit = waypointSteps.find((step) => step.op === "graph.edge.split");
  assert.deepEqual(waypointSplit?.proof, {
    op: "value.result",
    stepId: waypointInspect.id
  });
  const transfers = Object.values(manifest.mechanics.plans).flatMap((plan) =>
    plan.transaction.steps.filter((step) => step.op === "core.resource.transfer")
  );
  for (const transfer of transfers) {
    assert.equal(typeof transfer.from.kind, "string");
    assert.equal(typeof transfer.to.kind, "string");
    assert.equal(transfer.onInsufficient, "fail");
  }

  // Construction activation is ordinary bounded selection plus bulk update;
  // no train-specific platform command or hard-coded constructed object exists.
  const activationSteps = manifest.mechanics.plans["mock.construction.open-control-projects"].transaction.steps;
  assert.deepEqual(activationSteps.map((step) => step.op), [
    "core.assert",
    "core.entities.select",
    "core.entities.update",
    "core.entities.select",
    "core.entities.update",
    "core.entities.select",
    "core.entities.update",
    "core.entities.select",
    "core.entities.update",
    "core.event.emit"
  ]);
  assert.deepEqual(
    activationSteps.filter((step) => step.op === "core.entities.select").map((step) => step.selector.collection),
    ["networkNodes", "networkNodes", "networkEdges", "networkEdges"]
  );
  assert.equal(
    activationSteps.filter((step) => step.op === "core.entities.update").every((step) => step.selection.op === "value.result"),
    true
  );

  // The next-turn plan resets every currently active locomotive, including
  // locomotives bought after the game started, through one data-driven query.
  const nextTurnSteps = manifest.mechanics.plans["mock.debrief.next-turn"].transaction.steps;
  const activeLocomotives = nextTurnSteps.find((step) => step.id === "s013-active-assets");
  const resetLocomotives = nextTurnSteps.find((step) => step.id === "s014-reset-assets");
  assert.deepEqual(activeLocomotives, {
    id: "s013-active-assets",
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection: "locomotives",
      objectTypes: ["transport.locomotive"],
      facets: { availability: { op: "value.literal", value: "active" } },
      cardinality: { min: 0, max: 64 }
    }
  });
  assert.deepEqual(resetLocomotives, {
    id: "s014-reset-assets",
    kind: "command",
    op: "core.entities.update",
    selection: { op: "value.result", stepId: "s013-active-assets" },
    attributeValues: { actionPoints: { op: "value.literal", value: 5 } }
  });

  for (const collection of ["locomotives", "wagons"]) {
    for (const vehicle of Object.values(manifest.state.public.objects[collection])) {
      assert.equal(Number.isSafeInteger(vehicle.attributes.nominalValue), true);
      assert.equal(vehicle.attributes.nominalValue >= 0, true);
    }
  }
  assert.equal(
    manifest.state.public.objects.locomotives["mock-locomotive-green-1"].attributes.turnOrderCount,
    1
  );
  assert.equal(
    manifest.state.public.objects.locomotives["mock-market-locomotive-green-2"].attributes.turnOrderCount,
    0
  );
  assert.equal(manifest.mechanics.stateModel.collections.teams.itemShape, "record");
  assert.deepEqual(
    manifest.mechanics.stateModel.collections.teams.fields.coins.storage,
    { kind: "path", path: ["coins"] }
  );
  assert.deepEqual(
    manifest.mechanics.stateModel.collections.networkNodes.fields.positionX,
    {
      source: {
        kind: "nested-field",
        field: "position",
        path: ["x"]
      },
      valueType: "game.map-coordinate",
      access: "read-only"
    }
  );
  assert.deepEqual(
    manifest.mechanics.stateModel.types["game.map-coordinate"],
    {
      kind: "finite-number",
      minimum: -1_000_000_000,
      maximum: 1_000_000_000
    }
  );
  assert.equal(
    manifest.mechanics.stateModel.collections.locomotives.fields.turnOrderCount.valueType,
    "game.turn-order-count"
  );
  assert.ok(
    manifest.content.data.integrationReadiness.requiredMechanicsOperations.includes("core.entities.order")
  );

  const ui = await readJson("authoring/ui/web.authoring.json");
  const serializedUi = JSON.stringify(ui);
  for (const id of ["facilitator.board", "facilitator.team-status", "facilitator.log"]) {
    assert.match(serializedUi, new RegExp(`\\"${id}\\"`));
  }
});

test("complete seven-turn gameplay is replay-stable and finishes only after facilitator confirmation", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const transcript = await readJson("fixtures/complete-session-transcript.json");
  assert.equal(transcript.steps.filter((step) => step.restartAfter === true).length, 2);
  assert.equal(transcript.rejectionProbes.length, 7);

  const replay = async () => {
    const { store, session } = await createFacilitatorSession(manifest);
    let current = session;
    for (const step of transcript.steps) {
      const outcome = await dispatchTestAction({
        store,
        sessionId: session.sessionId,
        actionId: step.actionId,
        params: step.params ?? {}
      });
      assert.equal(
        outcome.result.ok,
        true,
        `replay step ${step.order} must be applied: ${JSON.stringify({
          result: outcome.result,
          receipt: outcome.receipt
        })}`
      );
      assert.equal(
        outcome.receipt.status,
        "applied",
        `replay step ${step.order} must have an applied receipt: ${JSON.stringify({
          result: outcome.result,
          receipt: outcome.receipt
        })}`
      );
      current = await store.getSession(session.sessionId);
      assert.ok(current);
      assert.equal(current.state.public.session.phase, step.expected.phase, `phase after step ${step.order}`);
      assert.equal(current.state.public.session.turnNumber, step.expected.turnNumber, `turn after step ${step.order}`);
      if (step.order === 45) {
        assert.equal(
          current.state.public.objects.networkEdges["main:edge:1001"].facets.state,
          "building",
          "construction from N must stay closed throughout N+1"
        );
        assert.equal(
          current.state.public.objects.networkNodes["main:node:1002"].facets.availability,
          "building"
        );
        assert.equal(current.state.public.objects.networkEdges["main:edge:1003"].facets.state, "building");
      }
      if (step.order === 54) {
        assert.equal(
          current.state.public.objects.networkEdges["main:edge:1001"].facets.state,
          "open",
          "construction from N must open at the beginning of N+2"
        );
        assert.equal(current.state.public.objects.networkNodes["main:node:1002"].facets.availability, "open");
        assert.equal(current.state.public.objects.networkEdges["main:edge:1003"].facets.state, "open");
      }
    }
    return current;
  };

  const first = await replay();
  const second = await replay();
  assert.equal(
    createCanonicalReplayFingerprint(first.state),
    createCanonicalReplayFingerprint(second.state)
  );
  assert.equal(first.state.public.session.phase, "finished");
  assert.equal(first.state.public.session.turnNumber, 7);
  assert.deepEqual(
    Object.fromEntries(Object.entries(first.state.public.teams).map(([id, team]) => [id, team.coins])),
    transcript.final.balances
  );
  assert.deepEqual(first.state.public.ranking.groups.logistics.winners, transcript.final.winners.logistics);
  assert.deepEqual(first.state.public.ranking.groups.guilds.winners, transcript.final.winners.guilds);
});

test("published repository loads mock UI, immutable plugin and registered WebP map by ordinary gameId", async () => {
  const { content } = await loadPlayerFacingContent({ gameId: "cards-money-trains-mock" });
  assert.equal(content.gameId, "cards-money-trains-mock");
  assert.equal(content.ui.id, "cards-money-trains-mock.ui.web");
  const plugin = content.pluginBundles[0];
  assert.equal(plugin.pluginId, "cards-money-trains-mock-player");
  const pluginSource = await getPublishedPlayerWebPluginBundleSource({
    gameId: plugin.gameId,
    pluginId: plugin.pluginId,
    contentHash: plugin.contentHash
  });
  assert.match(pluginSource, /cards-money-trains-mock/);

  const assetIndex = await getGameAssetIndex("cards-money-trains-mock");
  const asset = assetIndex.assets["board-guinea-optimized"];
  assert.ok(asset);
  const match = asset.url.match(/\/([a-f0-9]{64})\.(webp)$/u);
  assert.ok(match);
  const delivery = await getGameAssetFile({
    gameId: "cards-money-trains-mock",
    assetId: "board-guinea-optimized",
    contentHash: match[1],
    extension: match[2]
  });
  assert.equal(delivery.contentType, "image/webp");
  const normativeMap = await readFile(
    path.join(packageRoot, "..", "cards-money-trains", "assets", "images", "guinea-map.webp")
  );
  assert.deepEqual(delivery.bytes, normativeMap);
});

test("normative manifest remains separately addressed and keeps its platform network model", async () => {
  const normative = JSON.parse(await readFile(path.join(packageRoot, "..", "cards-money-trains", "game.manifest.json"), "utf8"));
  assert.equal(normative.meta.id, "cards-money-trains");
  assert.equal(normative.content.data.mockNotice, undefined);
  assert.ok(normative.networkModels.main);
});
