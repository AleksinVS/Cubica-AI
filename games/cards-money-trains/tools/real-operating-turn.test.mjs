/**
 * Server-side proof for the first operating slice built from real author data.
 *
 * The fixture deliberately supplies only unresolved setup facts such as the
 * starting vehicle positions. The normative manifest owns the rules, while
 * the ordinary Runtime dispatcher executes every action and persists the same
 * receipts that a future public session will use.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";

const Ajv = AjvImport.default ?? AjvImport;
const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const fixtureRoot = path.join(gameRoot, "authoring", "fixtures");
const credentialSha256 = "b".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/**
 * Builds a direct technical session without bypassing the runtime dispatcher.
 *
 * Public session creation remains blocked by runtimeReady=false. This helper is
 * intentionally test-local so the temporary setup cannot become a production
 * content source.
 */
const createTechnicalSession = async (
  manifest,
  fixture,
  newsId,
  { independentRoadBlocker = false } = {}
) => {
  const state = structuredClone(manifest.state);
  state.public.session.fixtureId = fixture.fixtureId;
  state.public.session.phase = "news";
  state.public.news.currentCardId = newsId;
  state.public.turnEffects.deliveryPayoutBonus = 0;
  state.public.objects = structuredClone(fixture.objects);
  if (independentRoadBlocker) {
    state.public.objects.networkEdges["road-1-9"].attributes.blockingReasons = [
      "manual-inspection"
    ];
  }

  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: state,
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "real-operating-turn-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatches one version-checked command through the production action path. */
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

const loadProof = async () => {
  const [manifestSource, fixture, schema, intake, network] = await Promise.all([
    readJson(path.join(gameRoot, "game.manifest.json")),
    readJson(path.join(fixtureRoot, "real-operating-turn.technical.json")),
    readJson(path.join(fixtureRoot, "real-operating-turn.technical.schema.json")),
    readJson(path.join(fixtureRoot, "cargo-news.intake.json")),
    readJson(path.join(gameRoot, "annotations", "initial-network.review.json"))
  ]);
  return {
    manifest: validateGameManifest(manifestSource),
    fixture,
    schema,
    intake,
    network
  };
};

test("technical replay fixture is schema-valid and traces every real source id", async () => {
  const { manifest, fixture, schema, intake, network } = await loadProof();
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  assert.equal(
    validate(fixture),
    true,
    ajv.errorsText(validate.errors, { separator: "\n" })
  );
  assert.equal(fixture.publishable, false);
  assert.equal(manifest.config.runtimeReady, false);
  assert.equal(manifest.state.public.session.fixtureId, "normal-start-policy");
  assert.equal(Object.keys(manifest.state.public.objects.cargoOrders).length, 174);
  assert.ok(manifest.state.public.objects.cargoOrders[fixture.sourceIds.cargoId]);
  const proof = manifest.content.data.realOperatingTurnProof;
  assert.equal(proof.status, "technical-review-only");
  assert.equal(proof.publishable, false);
  assert.equal(proof.cargoRecords[0].runtimeCardMultiplicity, 1);

  const cargo = intake.cargoRecords.find(
    (record) => record.id === fixture.sourceIds.cargoId
  );
  const positiveNews = intake.newsRecords.find(
    (record) => record.id === fixture.sourceIds.positiveNewsId
  );
  const negativeNews = intake.newsRecords.find(
    (record) => record.id === fixture.sourceIds.negativeNewsId
  );
  const edge = network.edges.find(
    (record) => record.id === fixture.sourceIds.edgeId
  );

  assert.deepEqual(
    {
      fromNodeId: cargo?.originNodeId,
      toNodeId: cargo?.destinationNodeId,
      payout: cargo?.bankPayout
    },
    {
      fromNodeId: fixture.sourceIds.fromNodeId,
      toNodeId: fixture.sourceIds.toNodeId,
      payout: fixture.objects.cargoOrders[fixture.sourceIds.cargoId].attributes.payout
    }
  );
  assert.equal(positiveNews?.number, 24);
  assert.equal(negativeNews?.number, 11);
  assert.deepEqual(
    proof.newsRecords.map((record) => record.id),
    [fixture.sourceIds.negativeNewsId, fixture.sourceIds.positiveNewsId]
  );
  assert.deepEqual(
    [edge?.fromNodeId, edge?.toNodeId],
    [fixture.sourceIds.fromNodeId, fixture.sourceIds.toNodeId]
  );
});

test("news 24, cargo 1 to 9 and one-edge tariff settle atomically", async () => {
  const { manifest, fixture } = await loadProof();
  const branch = fixture.branches.positive;
  const session = await createTechnicalSession(manifest, fixture, branch.newsId);

  for (const step of branch.steps) {
    const outcome = await dispatch({
      store: session.store,
      sessionId: session.sessionId,
      actionId: step.actionId,
      params: step.params
    });
    assert.equal(outcome.result.ok, true, `${step.actionId} must be applied`);
    assert.equal(outcome.receipt.status, "applied");
  }

  const current = await session.store.getSession(session.sessionId);
  const objects = current.state.public.objects;
  const expected = branch.expected;

  assert.equal(
    objects.teams["white-logistics"].attributes.coins,
    expected.logisticsCoins
  );
  assert.equal(
    objects.teams["purple-guild"].attributes.coins,
    expected.guildCoins
  );
  assert.equal(
    objects.locomotives["technical-locomotive-purple-1"].attributes.actionPoints,
    expected.locomotiveActionPoints
  );
  assert.equal(
    objects.locomotives["technical-locomotive-purple-1"].attributes.nodeId,
    expected.locomotiveNodeId
  );
  assert.equal(
    objects.wagons["technical-wagon-white-1"].attributes.nodeId,
    expected.locomotiveNodeId
  );
  assert.equal(objects.wagons["technical-wagon-white-1"].attributes.cargoId, null);
  assert.equal(
    objects.wagons["technical-wagon-white-1"].attributes.attachedVehicleId,
    null
  );
  assert.equal(
    objects.cargoOrders["cargo-source-row-005"].facets.status,
    expected.cargoStatus
  );
  assert.equal(
    objects.cargoOrders["cargo-source-row-005"].attributes.settledRouteLength,
    expected.settledRouteLength
  );
  assert.equal(current.version.stateVersion, branch.steps.length);
});

test("news 11 blocks only road 1 to 9 and rejected movement changes no state", async () => {
  const { manifest, fixture } = await loadProof();
  const branch = fixture.branches.negative;
  const session = await createTechnicalSession(
    manifest,
    fixture,
    branch.newsId,
    { independentRoadBlocker: true }
  );

  const applied = await dispatch({
    store: session.store,
    sessionId: session.sessionId,
    actionId: branch.steps[0].actionId
  });
  assert.equal(applied.result.ok, true);
  assert.equal(applied.receipt.status, "applied");

  const beforeRejected = await session.store.getSession(session.sessionId);
  const rejected = await dispatch({
    store: session.store,
    sessionId: session.sessionId,
    actionId: branch.steps[1].actionId,
    params: branch.steps[1].params
  });
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.receipt.status, "rejected");
  assert.match(
    `${rejected.result.error?.code ?? ""} ${rejected.result.error?.message ?? ""}`,
    /GRAPH|allowed state|unavailable/i
  );

  const afterRejected = await session.store.getSession(session.sessionId);
  assert.equal(
    afterRejected.version.stateVersion - beforeRejected.version.stateVersion,
    branch.expected.rejectedStateVersionDelta
  );
  assert.equal(
    afterRejected.state.public.objects.networkEdges["road-1-9"].facets.state,
    branch.expected.edgeState
  );
  assert.deepEqual(
    afterRejected.state.public.objects.networkEdges["road-1-9"].attributes
      .blockingReasons,
    ["manual-inspection", "news-11"]
  );
  assert.equal(
    afterRejected.state.public.objects.locomotives[
      "technical-locomotive-purple-1"
    ].attributes.nodeId,
    branch.expected.locomotiveNodeId
  );
  assert.equal(
    afterRejected.state.public.objects.locomotives[
      "technical-locomotive-purple-1"
    ].attributes.actionPoints,
    branch.expected.locomotiveActionPoints
  );
});

test("technical actions reject the ordinary normative fixture without mutation", async () => {
  const { manifest } = await loadProof();
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "ordinary-fixture-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });

  const outcome = await dispatch({
    store,
    sessionId: created.session.sessionId,
    actionId: "technical.news.apply.24"
  });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.receipt.status, "rejected");

  const current = await store.getSession(created.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.session.fixtureId, "normal-start-policy");
  assert.equal(current.state.public.turnEffects.deliveryPayoutBonus, 0);
});
