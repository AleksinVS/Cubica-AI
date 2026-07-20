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
import {
  authoringPath,
  buildOperatingTurnAuthoring
} from "./build-operating-turn.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
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

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

/** Produce a valid unique command identifier for the ordinary dispatcher. */
const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Load the generated manifest only through the production validator. */
const loadManifest = async () =>
  validateGameManifest(await readJson(path.join(gameRoot, "game.manifest.json")));

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

test("setup, card, and operating-turn generators compose idempotently", async () => {
  const [actual, network, intake] = await Promise.all([
    readJson(authoringPath),
    readJson(networkPath),
    readJson(intakePath)
  ]);

  assert.deepEqual(buildSessionSetupAuthoring(actual, network), actual);
  assert.deepEqual(buildLifecycleAuthoring(actual, intake), actual);
  assert.deepEqual(buildOperatingTurnAuthoring(actual), actual);
  assert.deepEqual(
    buildOperatingTurnAuthoring(
      buildLifecycleAuthoring(buildSessionSetupAuthoring(actual, network), intake)
    ),
    actual
  );
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
    /remaining market and reporting workflows/u
  );
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
