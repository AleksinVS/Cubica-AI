/**
 * Focused Runtime proof for the first normal operating-turn boundary.
 *
 * These tests execute public Game Intents through the production dispatcher.
 * Direct store edits are used only to create bounded later-turn or negative
 * conditions that are not yet reachable through the intentionally incomplete
 * market/cargo phases. Every rejected branch proves that state and version stay
 * unchanged.
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
import { buildConstructionCycleAuthoring } from "./build-construction-cycle.mjs";
import {
  buildSessionSetupAuthoring,
  contrastColorIds,
  supportedOddTeamCounts
} from "./build-session-setup.mjs";
import { buildTrainFormationAuthoring } from "./build-train-formation.mjs";
import {
  authoringPath,
  buildOperatingTurnAuthoring
} from "./build-operating-turn.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const intakePath = path.join(
  gameRoot,
  "authoring",
  "fixtures",
  "cargo-news.intake.json"
);
const networkPath = path.join(
  gameRoot,
  "annotations",
  "initial-network.review.json"
);
const credentialSha256 = "e".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;
const { compileAuthoringText } = authoringCompiler;
let generatedManifestPromise;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

/** Produce a valid unique command identifier for the ordinary dispatcher. */
const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/**
 * Compile the fresh operating-turn transformation entirely in memory.
 *
 * This keeps the focused test independent from the later shared integration
 * step that rewrites authoring, manifest and source-map artifacts.
 */
const loadManifest = async () => {
  generatedManifestPromise ??= (async () => {
    const generated = buildOperatingTurnAuthoring(await readJson(authoringPath));
    const output = compileAuthoringText(
      {
        kind: "game",
        sourceFile: authoringPath,
        outputFile: path.join(repoRoot, ".tmp", "cmt-operating-turn.manifest.json"),
        sourceMapFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-operating-turn.manifest.source-map.json"
        )
      },
      JSON.stringify(generated)
    );
    return validateGameManifest(output.manifest);
  })();
  return generatedManifestPromise;
};

/** Create one facilitator-owned normal session from the immutable game bundle. */
const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "operating-turn-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatch one optimistic-concurrency protected Game Intent. */
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
 * Create a narrow synthetic condition without bypassing the action under test.
 *
 * Store edits increment the version exactly once and remain local to a fresh
 * in-memory test session.
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

/** Assert either dispatcher rejection form and prove complete atomicity. */
const assertRejectedWithoutMutation = async (session, input) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const outcome = await dispatch({ ...session, ...input });
    rejected = outcome.result.ok === false && outcome.receipt.status === "rejected";
  } catch {
    // Parameter reference validation rejects some unknown/hidden resources
    // before a Mechanics receipt can be created. That is also a safe reject.
    rejected = true;
  }
  assert.equal(rejected, true, `${input.actionId} must be rejected`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

/** Add one team through the protected setup action matching its product type. */
const addTeam = async (session, type, index) => {
  const actionId = type === "logistics_company"
    ? "session.setup.team.add.logistics-company"
    : "session.setup.team.add.locomotive-guild";
  const outcome = await dispatch({
    ...session,
    actionId,
    params: {
      name: `${type === "logistics_company" ? "Перевозчик" : "Гильдия"} ${index + 1}`,
      colorId: contrastColorIds[index]
    }
  });
  assert.equal(outcome.result.ok, true);
};

/** Create one author-confirmed odd composition without assuming an even rule. */
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

/**
 * Place every reserve asset in the server-selected team order.
 *
 * Wagons may share terminal 1. Each guild receives a different terminal so the
 * test never relies on the two-locomotive capacity edge.
 */
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
    assert.ok(locomotiveId, `current team ${teamId} must still have one reserve asset`);
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

/** Build a normal unpublished party up to the completed placement boundary. */
const prepareSetup = async (manifest, count = 5, initializeCards = true) => {
  const session = await createSession(manifest);
  if (initializeCards) {
    const initialized = await dispatch({
      ...session,
      actionId: "cards.lifecycle.initialize"
    });
    assert.equal(initialized.result.ok, true);
  }
  await addOddComposition(session, count);
  const finalized = await dispatch({
    ...session,
    actionId: "session.setup.finalize"
  });
  assert.equal(finalized.result.ok, true);
  await placeAllAssets(session);
  return session;
};

/** Advance a prepared setup through the explicit first-turn news skip. */
const prepareMaintenance = async (manifest, count = 5) => {
  const session = await prepareSetup(manifest, count, true);
  const started = await dispatch({
    ...session,
    actionId: "session.play.start"
  });
  assert.equal(started.result.ok, true);
  const skipped = await dispatch({
    ...session,
    actionId: "news.lifecycle.first-turn.skip"
  });
  assert.equal(skipped.result.ok, true);
  return session;
};

/** Pay every active vehicle in the current normal session. */
const payAllActiveVehicles = async (session) => {
  const current = await session.store.getSession(session.sessionId);
  for (const [locomotiveId, locomotive] of Object.entries(
    current.state.public.objects.locomotives
  )) {
    if (
      locomotive.facets.availability !== "active" ||
      locomotive.attributes.maintenancePaidTurn ===
        current.state.public.session.turnNumber
    ) {
      continue;
    }
    const outcome = await dispatch({
      ...session,
      actionId: "maintenance.pay.locomotive",
      params: { locomotiveId }
    });
    assert.equal(outcome.result.ok, true);
  }
  for (const [wagonId, wagon] of Object.entries(current.state.public.objects.wagons)) {
    if (
      wagon.facets.availability !== "active" ||
      wagon.attributes.maintenancePaidTurn === current.state.public.session.turnNumber
    ) {
      continue;
    }
    const outcome = await dispatch({
      ...session,
      actionId: "maintenance.pay.wagon",
      params: { wagonId }
    });
    assert.equal(outcome.result.ok, true);
  }
};

/** Reach the repeatable market after paying all mandatory first-turn upkeep. */
const prepareMarket = async (manifest, count = 5) => {
  const session = await prepareMaintenance(manifest, count);
  await payAllActiveVehicles(session);
  const finished = await dispatch({
    ...session,
    actionId: "maintenance.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.session.phase, "market");
  return session;
};

/** Resolve one protected server-side team id by its confirmed product role. */
const findTeamId = (state, type) => {
  const teamId = Object.entries(state.public.objects.teams)
    .find(([, team]) => team.attributes.type === type)?.[0];
  assert.ok(teamId, `a ${type} team is required`);
  return teamId;
};

/** Resolve one active server-side vehicle owned by the requested team. */
const findOwnedActiveVehicleId = (state, collection, teamId) => {
  const vehicleId = Object.entries(state.public.objects[collection])
    .find(([, vehicle]) =>
      vehicle.facets.availability === "active" &&
      vehicle.attributes.ownerTeamId === teamId
    )?.[0];
  assert.ok(vehicleId, `an active ${collection} vehicle is required for ${teamId}`);
  return vehicleId;
};

/** Return the one id added to a protected object collection by an action. */
const findCreatedId = (before, after) => {
  const previous = new Set(Object.keys(before));
  const created = Object.keys(after).filter((id) => !previous.has(id));
  assert.equal(created.length, 1, "the market action must create exactly one vehicle");
  return created[0];
};

test("setup, card, and operating-turn generators compose idempotently", async () => {
  const [source, network, intake] = await Promise.all([
    readJson(authoringPath),
    readJson(networkPath),
    readJson(intakePath)
  ]);
  const withLateExtensions = buildLifecycleAuthoring(
    buildSessionSetupAuthoring(buildOperatingTurnAuthoring(source), network),
    intake
  );
  const actual = buildOperatingTurnAuthoring(withLateExtensions);

  assert.deepEqual(buildOperatingTurnAuthoring(actual), actual);
  assert.deepEqual(
    buildLifecycleAuthoring(
      buildSessionSetupAuthoring(buildOperatingTurnAuthoring(actual), network),
      intake
    ),
    actual
  );

  const root = actual.root;
  assert.equal(root.config.runtimeReady, false);
  assert.match(
    root.config.runtimeBlockers.join("\n"),
    /remaining reporting workflows/u
  );
  assert.doesNotMatch(
    root.config.runtimeBlockers.join("\n"),
    /remaining market/u
  );
  assert.equal(root.content.data.operatingTurn.market.status, "executable");
  for (const actionId of [
    "market.purchase.wagon",
    "market.purchase.locomotive",
    "market.sell.wagon",
    "market.sell.locomotive",
    "market.phase.finish"
  ]) {
    assert.ok(
      root.logic.actions.some((candidate) => candidate.id === actionId),
      `${actionId} must remain in the composed facilitator market`
    );
  }
  for (const collectionId of ["locomotives", "wagons", "cargoOrders"]) {
    assert.deepEqual(
      root.mechanics.stateModel.collections[collectionId].fields.maintenancePaidTurn,
      {
        storage: { kind: "attribute", name: "maintenancePaidTurn" },
        valueType: "core.integer",
        access: "read-write"
      }
    );
  }
  assert.ok(Object.values(root.state.public.objects.cargoOrders).every(
    (cargo) => cargo.attributes.maintenancePaidTurn === 0
  ));
});

test("late formation and construction rebuilds preserve the resolved market blocker", async () => {
  const source = await readJson(authoringPath);
  const marketReady = buildOperatingTurnAuthoring(source);
  const withLateGenerators = buildConstructionCycleAuthoring(
    buildTrainFormationAuthoring(marketReady)
  );
  const fixedPoint = buildOperatingTurnAuthoring(withLateGenerators);

  assert.deepEqual(buildTrainFormationAuthoring(fixedPoint), fixedPoint);
  assert.deepEqual(buildConstructionCycleAuthoring(fixedPoint), fixedPoint);
  assert.ok(
    fixedPoint.root.config.runtimeBlockers.includes(
      "remaining reporting workflows"
    )
  );
  assert.doesNotMatch(
    fixedPoint.root.config.runtimeBlockers.join("\n"),
    /remaining market/u
  );
});

test("all confirmed odd setups reach maintenance without consuming first-turn news", async () => {
  const manifest = await loadManifest();
  for (const count of supportedOddTeamCounts) {
    const session = await prepareSetup(manifest, count, true);
    const beforeStart = await session.store.getSession(session.sessionId);
    const secretBefore = structuredClone(beforeStart.state.secret);

    const started = await dispatch({
      ...session,
      actionId: "session.play.start"
    });
    assert.equal(started.result.ok, true, `${count} teams must start`);
    const afterStart = await session.store.getSession(session.sessionId);
    assert.equal(afterStart.state.public.session.status, "running");
    assert.equal(afterStart.state.public.session.phase, "news");

    const skipped = await dispatch({
      ...session,
      actionId: "news.lifecycle.first-turn.skip"
    });
    assert.equal(skipped.result.ok, true);
    const afterSkip = await session.store.getSession(session.sessionId);
    assert.equal(afterSkip.state.public.session.turnNumber, 1);
    assert.equal(afterSkip.state.public.session.phase, "maintenance");
    assert.equal(afterSkip.state.public.news.currentCardId, null);
    assert.equal(afterSkip.state.public.news.remaining, 34);
    assert.equal(afterSkip.state.public.news.status, "first-turn-skipped");
    assert.deepEqual(afterSkip.state.secret, secretBefore);
  }
});

test("start rejects incomplete placement or missing card initialization atomically", async () => {
  const manifest = await loadManifest();
  const incomplete = await createSession(manifest);
  assert.equal(
    (await dispatch({ ...incomplete, actionId: "cards.lifecycle.initialize" })).result.ok,
    true
  );
  await addOddComposition(incomplete, 5);
  await assertRejectedWithoutMutation(incomplete, {
    actionId: "session.play.start"
  });

  const noCards = await prepareSetup(manifest, 5, false);
  await assertRejectedWithoutMutation(noCards, {
    actionId: "session.play.start"
  });
});

test("maintenance charges each server-owned starting unit once and gates market", async () => {
  const manifest = await loadManifest();
  const session = await prepareMaintenance(manifest, 5);
  const before = await session.store.getSession(session.sessionId);
  const firstWagonId = Object.keys(before.state.public.objects.wagons).sort()[0];

  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.phase.finish"
  });

  const firstPayment = await dispatch({
    ...session,
    actionId: "maintenance.pay.wagon",
    params: { wagonId: firstWagonId }
  });
  assert.equal(firstPayment.result.ok, true);
  const afterFirst = await session.store.getSession(session.sessionId);
  const firstWagon = afterFirst.state.public.objects.wagons[firstWagonId];
  const ownerTeamId = firstWagon.attributes.ownerTeamId;
  assert.equal(firstWagon.attributes.maintenancePaidTurn, 1);
  assert.equal(afterFirst.state.public.objects.teams[ownerTeamId].attributes.coins, 9);

  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId: firstWagonId }
  });

  await payAllActiveVehicles(session);
  const paid = await session.store.getSession(session.sessionId);
  for (const team of Object.values(paid.state.public.objects.teams)) {
    assert.equal(
      team.attributes.coins,
      team.attributes.type === "logistics_company" ? 8 : 9
    );
  }

  const finished = await dispatch({
    ...session,
    actionId: "maintenance.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.session.phase, "market");
});

test("news 25 permits direct maintenance finish without debit or per-unit clicks", async () => {
  const manifest = await loadManifest();
  const session = await prepareSetup(manifest, 5, true);
  assert.equal(
    (await dispatch({ ...session, actionId: "session.play.start" })).result.ok,
    true
  );
  await updateScenario(session, (state) => {
    state.public.session.turnNumber = 2;
    state.public.session.phase = "news";
    state.public.news.currentCardId = "news-25";
    state.public.news.status = "current";
    state.public.objects.newsCards["news-25"].facets.availability = "current";
  });
  const applied = await dispatch({
    ...session,
    actionId: "news.effect.apply.25"
  });
  assert.equal(applied.result.ok, true);

  const beforePayment = await session.store.getSession(session.sessionId);
  assert.equal(
    beforePayment.state.public.turnEffects.vehicleAndCargoMaintenanceExempt,
    true
  );
  const coinsBefore = Object.fromEntries(
    Object.entries(beforePayment.state.public.objects.teams).map(([teamId, team]) => [
      teamId,
      team.attributes.coins
    ])
  );
  const maintenanceTurnsBefore = {
    locomotives: Object.fromEntries(
      Object.entries(beforePayment.state.public.objects.locomotives).map(
        ([entityId, entity]) => [entityId, entity.attributes.maintenancePaidTurn]
      )
    ),
    wagons: Object.fromEntries(
      Object.entries(beforePayment.state.public.objects.wagons).map(
        ([entityId, entity]) => [entityId, entity.attributes.maintenancePaidTurn]
      )
    )
  };

  const finished = await dispatch({
    ...session,
    actionId: "maintenance.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.session.phase, "market");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(current.state.public.objects.teams).map(([teamId, team]) => [
        teamId,
        team.attributes.coins
      ])
    ),
    coinsBefore
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(current.state.public.objects.locomotives).map(
        ([entityId, entity]) => [entityId, entity.attributes.maintenancePaidTurn]
      )
    ),
    maintenanceTurnsBefore.locomotives
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(current.state.public.objects.wagons).map(
        ([entityId, entity]) => [entityId, entity.attributes.maintenancePaidTurn]
      )
    ),
    maintenanceTurnsBefore.wagons
  );
});

test("only held available and in-transit cargo blocks maintenance completion", async () => {
  const manifest = await loadManifest();
  const session = await prepareMaintenance(manifest, 5);
  await payAllActiveVehicles(session);

  const current = await session.store.getSession(session.sessionId);
  const teamId = Object.entries(current.state.public.objects.teams)
    .find(([, team]) => team.attributes.type === "logistics_company")?.[0];
  assert.ok(teamId);
  const cargoIds = Object.keys(current.state.public.objects.cargoOrders).sort().slice(0, 5);
  const [availableId, transitId, hiddenId, offeredId, deliveredId] = cargoIds;
  await updateScenario(session, (state) => {
    const statuses = [
      [availableId, "available"],
      [transitId, "in_transit"],
      [hiddenId, "hidden"],
      [offeredId, "offered"],
      [deliveredId, "delivered"]
    ];
    for (const [cargoId, status] of statuses) {
      const cargo = state.public.objects.cargoOrders[cargoId];
      cargo.facets.status = status;
      cargo.attributes.holderTeamId = teamId;
      cargo.attributes.maintenancePaidTurn = 0;
    }
  });

  for (const cargoId of [hiddenId, offeredId, deliveredId]) {
    await assertRejectedWithoutMutation(session, {
      actionId: "maintenance.pay.held-cargo",
      params: { cargoId }
    });
  }
  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.phase.finish"
  });

  for (const cargoId of [availableId, transitId]) {
    const paid = await dispatch({
      ...session,
      actionId: "maintenance.pay.held-cargo",
      params: { cargoId }
    });
    assert.equal(paid.result.ok, true);
  }
  const finished = await dispatch({
    ...session,
    actionId: "maintenance.phase.finish"
  });
  assert.equal(finished.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.state.public.session.phase, "market");
});

test("wrong phase, forged owner, unavailable asset, unknown id, and insufficient funds reject", async () => {
  const manifest = await loadManifest();
  const session = await prepareSetup(manifest, 5, true);
  assert.equal(
    (await dispatch({ ...session, actionId: "session.play.start" })).result.ok,
    true
  );
  let current = await session.store.getSession(session.sessionId);
  const wagonId = Object.keys(current.state.public.objects.wagons).sort()[0];

  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId }
  });
  assert.equal(
    (await dispatch({ ...session, actionId: "news.lifecycle.first-turn.skip" })).result.ok,
    true
  );

  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId, teamId: "forged-owner" }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId: "wagon-does-not-exist" }
  });

  await updateScenario(session, (state) => {
    state.public.objects.wagons[wagonId].facets.availability = "reserve";
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId }
  });
  await updateScenario(session, (state) => {
    state.public.objects.wagons[wagonId].facets.availability = "sold";
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId }
  });

  await updateScenario(session, (state) => {
    const wagon = state.public.objects.wagons[wagonId];
    wagon.facets.availability = "active";
    wagon.attributes.maintenancePaidTurn = 0;
    state.public.objects.teams[wagon.attributes.ownerTeamId].attributes.coins = 0;
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "maintenance.pay.wagon",
    params: { wagonId }
  });
});

test("market buys both vehicle kinds at authoritative base prices", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  let current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  await updateScenario(session, (state) => {
    state.public.objects.teams[logisticsTeamId].attributes.coins = 30;
    state.public.objects.teams[guildTeamId].attributes.coins = 30;
  });

  const beforeWagon = await session.store.getSession(session.sessionId);
  const boughtWagon = await dispatch({
    ...session,
    actionId: "market.purchase.wagon",
    params: { teamId: logisticsTeamId, stationId: "terminal-3" }
  });
  assert.equal(boughtWagon.result.ok, true);
  const afterWagon = await session.store.getSession(session.sessionId);
  const wagonId = findCreatedId(
    beforeWagon.state.public.objects.wagons,
    afterWagon.state.public.objects.wagons
  );
  const wagon = afterWagon.state.public.objects.wagons[wagonId];
  assert.equal(afterWagon.state.public.objects.teams[logisticsTeamId].attributes.coins, 25);
  assert.equal(wagon.facets.availability, "active");
  assert.equal(wagon.attributes.ownerTeamId, logisticsTeamId);
  assert.equal(wagon.attributes.nodeId, "terminal-3");
  assert.equal(wagon.attributes.networkId, "main");
  assert.equal(wagon.attributes.maintenancePaidTurn, 1);
  assert.equal(wagon.attributes.attachedVehicleId, null);
  assert.equal(wagon.attributes.cargoId, null);
  assert.equal(wagon.attributes.cargoOfferEligibleTurn, 0);
  assert.equal(wagon.attributes.cargoOfferResolvedTurn, 0);
  assert.equal(wagon.attributes.cargoPriorityActiveCount, 0);
  if ("formationTargetLocomotiveId" in wagon.attributes) {
    assert.equal(wagon.attributes.formationTargetLocomotiveId, null);
  }
  assert.deepEqual(afterWagon.state.public.log.at(-1)?.data, {
    kind: "market-purchase",
    assetKind: "wagon",
    teamId: logisticsTeamId,
    vehicleId: wagonId,
    amount: 5,
    turnNumber: 1
  });

  const beforeLocomotive = afterWagon;
  const boughtLocomotive = await dispatch({
    ...session,
    actionId: "market.purchase.locomotive",
    params: { teamId: guildTeamId, stationId: "terminal-3" }
  });
  assert.equal(boughtLocomotive.result.ok, true);
  current = await session.store.getSession(session.sessionId);
  const locomotiveId = findCreatedId(
    beforeLocomotive.state.public.objects.locomotives,
    current.state.public.objects.locomotives
  );
  const locomotive = current.state.public.objects.locomotives[locomotiveId];
  assert.equal(current.state.public.objects.teams[guildTeamId].attributes.coins, 20);
  assert.equal(locomotive.facets.availability, "active");
  assert.equal(locomotive.attributes.ownerTeamId, guildTeamId);
  assert.equal(locomotive.attributes.nodeId, "terminal-3");
  assert.equal(locomotive.attributes.actionPoints, 5);
  assert.equal(locomotive.attributes.turnOrderCount, 1);
  assert.equal(locomotive.attributes.movementResolvedTurn, 0);
  assert.equal(locomotive.attributes.lastMovedTurn, 0);
  assert.equal(locomotive.attributes.maintenancePaidTurn, 1);
  assert.deepEqual(current.state.public.log.at(-1)?.data, {
    kind: "market-purchase",
    assetKind: "locomotive",
    teamId: guildTeamId,
    vehicleId: locomotiveId,
    amount: 10,
    turnNumber: 1
  });
});

test("market applies turn discounts and rejects news-prohibited purchases", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  let current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  await updateScenario(session, (state) => {
    state.public.objects.teams[logisticsTeamId].attributes.coins = 30;
    state.public.objects.teams[guildTeamId].attributes.coins = 30;
    state.public.turnEffects.purchasePriceOverrides.wagon = 4;
    state.public.turnEffects.purchasePriceOverrides.locomotive = 8;
  });

  assert.equal((await dispatch({
    ...session,
    actionId: "market.purchase.wagon",
    params: { teamId: logisticsTeamId, stationId: "terminal-3" }
  })).result.ok, true);
  assert.equal((await dispatch({
    ...session,
    actionId: "market.purchase.locomotive",
    params: { teamId: guildTeamId, stationId: "terminal-3" }
  })).result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.objects.teams[logisticsTeamId].attributes.coins, 26);
  assert.equal(current.state.public.objects.teams[guildTeamId].attributes.coins, 22);

  await updateScenario(session, (state) => {
    state.public.turnEffects.purchasePermissions.wagon = false;
    state.public.turnEffects.purchasePermissions.locomotive = false;
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.wagon",
    params: { teamId: logisticsTeamId, stationId: "terminal-4" }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.locomotive",
    params: { teamId: guildTeamId, stationId: "terminal-4" }
  });
});

test("market rejects purchases by the wrong team type", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  const current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  await updateScenario(session, (state) => {
    state.public.objects.teams[logisticsTeamId].attributes.coins = 30;
    state.public.objects.teams[guildTeamId].attributes.coins = 30;
  });

  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.locomotive",
    params: { teamId: logisticsTeamId, stationId: "terminal-3" }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.wagon",
    params: { teamId: guildTeamId, stationId: "terminal-3" }
  });
});

test("market purchase rejects insufficient funds without consuming id or creating an asset", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  const current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  await updateScenario(session, (state) => {
    state.public.objects.teams[logisticsTeamId].attributes.coins = 4;
  });

  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.wagon",
    params: { teamId: logisticsTeamId, stationId: "terminal-3" }
  });
});

test("market rejects a third locomotive at one terminal atomically", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  const current = await session.store.getSession(session.sessionId);
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  const activeLocomotiveIds = Object.entries(current.state.public.objects.locomotives)
    .filter(([, locomotive]) => locomotive.facets.availability === "active")
    .map(([locomotiveId]) => locomotiveId);
  assert.ok(activeLocomotiveIds.length >= 2);
  await updateScenario(session, (state) => {
    state.public.objects.teams[guildTeamId].attributes.coins = 30;
    for (const locomotiveId of activeLocomotiveIds.slice(0, 2)) {
      state.public.objects.locomotives[locomotiveId].attributes.nodeId = "terminal-3";
    }
  });

  await assertRejectedWithoutMutation(session, {
    actionId: "market.purchase.locomotive",
    params: { teamId: guildTeamId, stationId: "terminal-3" }
  });
});

test("market sells eligible wagon and locomotive for fixed prices", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  let current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  const wagonId = findOwnedActiveVehicleId(
    current.state,
    "wagons",
    logisticsTeamId
  );
  const locomotiveId = findOwnedActiveVehicleId(
    current.state,
    "locomotives",
    guildTeamId
  );
  const logisticsCoins = current.state.public.objects.teams[
    logisticsTeamId
  ].attributes.coins;
  const guildCoins = current.state.public.objects.teams[guildTeamId].attributes.coins;

  assert.equal((await dispatch({
    ...session,
    actionId: "market.sell.wagon",
    params: { wagonId }
  })).result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.teams[logisticsTeamId].attributes.coins,
    logisticsCoins + 2
  );
  assert.equal(current.state.public.objects.wagons[wagonId].facets.availability, "sold");
  assert.equal(current.state.public.objects.wagons[wagonId].attributes.nodeId, null);
  assert.equal(current.state.public.objects.wagons[wagonId].attributes.cargoOfferEligibleTurn, 0);
  assert.equal(current.state.public.objects.wagons[wagonId].attributes.cargoOfferResolvedTurn, 0);
  assert.deepEqual(current.state.public.log.at(-1)?.data, {
    kind: "market-sale",
    assetKind: "wagon",
    teamId: logisticsTeamId,
    vehicleId: wagonId,
    amount: 2,
    turnNumber: 1
  });

  assert.equal((await dispatch({
    ...session,
    actionId: "market.sell.locomotive",
    params: { locomotiveId }
  })).result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.teams[guildTeamId].attributes.coins,
    guildCoins + 4
  );
  const locomotive = current.state.public.objects.locomotives[locomotiveId];
  assert.equal(locomotive.facets.availability, "sold");
  assert.equal(locomotive.attributes.nodeId, null);
  assert.equal(locomotive.attributes.actionPoints, 0);
  assert.equal(locomotive.attributes.turnOrderCount, 0);
  assert.equal(locomotive.attributes.movementResolvedTurn, 0);
  assert.equal(locomotive.attributes.lastMovedTurn, 0);
  assert.deepEqual(current.state.public.log.at(-1)?.data, {
    kind: "market-sale",
    assetKind: "locomotive",
    teamId: guildTeamId,
    vehicleId: locomotiveId,
    amount: 4,
    turnNumber: 1
  });
});

test("market rejects loaded or attached wagons and locomotives with attached wagons", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  let current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  const guildTeamId = findTeamId(current.state, "locomotive_guild");
  const wagonId = findOwnedActiveVehicleId(
    current.state,
    "wagons",
    logisticsTeamId
  );
  const locomotiveId = findOwnedActiveVehicleId(
    current.state,
    "locomotives",
    guildTeamId
  );
  const cargoId = Object.keys(current.state.public.objects.cargoOrders)[0];
  assert.ok(cargoId);

  await updateScenario(session, (state) => {
    state.public.objects.wagons[wagonId].attributes.cargoId = cargoId;
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.sell.wagon",
    params: { wagonId }
  });

  await updateScenario(session, (state) => {
    state.public.objects.wagons[wagonId].attributes.cargoId = null;
    state.public.objects.wagons[wagonId].attributes.attachedVehicleId =
      locomotiveId;
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.sell.wagon",
    params: { wagonId }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "market.sell.locomotive",
    params: { locomotiveId }
  });
});

test("market supports repeated trades with deterministic distinct vehicle ids", async () => {
  const manifest = await loadManifest();
  const session = await prepareMarket(manifest);
  let current = await session.store.getSession(session.sessionId);
  const logisticsTeamId = findTeamId(current.state, "logistics_company");
  await updateScenario(session, (state) => {
    state.public.objects.teams[logisticsTeamId].attributes.coins = 30;
  });
  current = await session.store.getSession(session.sessionId);
  const sequenceBefore = current.state.public.setup.assetSequence;
  const wagonIdsBefore = new Set(Object.keys(current.state.public.objects.wagons));

  for (const stationId of ["terminal-3", "terminal-4"]) {
    const purchased = await dispatch({
      ...session,
      actionId: "market.purchase.wagon",
      params: { teamId: logisticsTeamId, stationId }
    });
    assert.equal(purchased.result.ok, true);
  }

  current = await session.store.getSession(session.sessionId);
  const createdIds = Object.keys(current.state.public.objects.wagons)
    .filter((wagonId) => !wagonIdsBefore.has(wagonId));
  assert.equal(createdIds.length, 2);
  assert.equal(new Set(createdIds).size, 2);
  assert.equal(current.state.public.setup.assetSequence, sequenceBefore + 2);
  assert.equal(current.state.public.objects.teams[logisticsTeamId].attributes.coins, 20);
  assert.ok(createdIds.every((wagonId) => wagonId.startsWith("wagon:")));
});
