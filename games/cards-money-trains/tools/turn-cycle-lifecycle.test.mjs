/**
 * Focused proof for the repeatable no-purchase/no-build turn skeleton.
 *
 * The real market inventory, construction objects and learning reflection are
 * intentionally unfinished. These tests prove only the protected phase
 * boundaries that let a facilitator continue a technical party without
 * inventing those rules. Direct store edits create upstream conditions; every
 * action under test still runs through the production Runtime dispatcher.
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
import { buildCargoSettlementAuthoring } from "./build-cargo-settlement.mjs";
import {
  authoringPath,
  buildOperatingTurnAuthoring
} from "./build-operating-turn.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const credentialSha256 = "7".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const loadManifest = async () =>
  validateGameManifest(await readJson(path.join(gameRoot, "game.manifest.json")));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Create one facilitator session from the exact immutable compiled package. */
const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "turn-cycle-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatch one optimistic-concurrency protected Game Intent. */
const dispatch = async ({
  store,
  sessionId,
  actionId,
  params = {}
}) => {
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

/** Mutate only bounded upstream facts while preserving state-version rules. */
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

/** Prove both supported rejection forms leave state and version untouched. */
const assertRejectedWithoutMutation = async (session, input) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const result = await dispatch({ ...session, ...input });
    rejected = result.result.ok === false && result.receipt.status === "rejected";
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${input.actionId} must be rejected`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

/** Prepare protected physical decks before entering a later synthetic phase. */
const initializeCards = async (session) => {
  const initialized = await dispatch({
    ...session,
    actionId: "cards.lifecycle.initialize"
  });
  assert.equal(initialized.result.ok, true);
};

test("turn-cycle intents and flow remain closed, unique and composition-safe", async () => {
  const source = await readJson(authoringPath);
  const first = buildOperatingTurnAuthoring(source);
  const second = buildOperatingTurnAuthoring(first);
  assert.deepEqual(second, first);

  // A later cargo rebuild must preserve the market/reporting boundaries and
  // must not restore the already resolved market-to-cargo metadata blocker.
  const composed = buildCargoSettlementAuthoring(second);
  const rebuilt = buildOperatingTurnAuthoring(composed);
  const root = rebuilt.root;
  const actionIds = root.logic.actions.map((candidate) => candidate.id);
  const planIds = Object.keys(root.mechanics.plans);
  // Cargo terminal actions are now one generic authoring intent expanded by
  // the compiler, while dynamic construction contributes six source intents.
  // Keep this source-level count explicit so a generator cannot silently
  // restore per-terminal or fixed-team action duplication.
  assert.equal(actionIds.length, 82);
  assert.equal(new Set(actionIds).size, actionIds.length);
  assert.equal(new Set(planIds).size, planIds.length);

  const emptyParams = {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: []
  };
  for (const actionId of ["market.phase.finish", "reporting.phase.finish"]) {
    assert.deepEqual(
      root.logic.actions.find((candidate) => candidate.id === actionId)
        ?.paramsSchema,
      emptyParams
    );
    assert.ok(root.mechanics.plans[actionId]);
  }

  const flow = root.logic.flows.find((candidate) => candidate.id === "facilitator");
  const stepIds = flow.steps.map((step) => step.id);
  assert.deepEqual(stepIds, [
    "facilitator.setup",
    "facilitator.news-lifecycle",
    "facilitator.operating-turn-start-maintenance",
    "facilitator.market-boundary",
    "facilitator.cargo-loading",
    "facilitator.movement-order-and-skip",
    "facilitator.cargo-settlement",
    "facilitator.construction",
    "facilitator.reporting-boundary",
    "facilitator.methodology-pauses"
  ]);
  assert.equal(new Set(stepIds).size, stepIds.length);
  assert.equal(
    flow.steps
      .flatMap((step) => step.actionIds)
      .filter((actionId) => actionId === "news.lifecycle.first-turn.skip")
      .length,
    1
  );
  assert.deepEqual(
    root.content.data.cargoSettlement.unresolvedBeforeFullTurn,
    ["single-remaining-card-policy"]
  );
});

test("market and reporting boundaries preserve game state and start turn two once", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await initializeCards(session);
  await updateScenario(session, (state) => {
    state.public.session.phase = "market";
  });

  await assertRejectedWithoutMutation(session, {
    actionId: "market.phase.finish",
    params: { forgedPurchase: true }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "reporting.phase.finish"
  });

  const beforeMarket = await session.store.getSession(session.sessionId);
  const finishedMarket = await dispatch({
    ...session,
    actionId: "market.phase.finish"
  });
  assert.equal(finishedMarket.result.ok, true);
  const afterMarket = await session.store.getSession(session.sessionId);
  assert.equal(afterMarket.state.public.session.phase, "cargo");
  assert.deepEqual(
    afterMarket.state.public.objects,
    beforeMarket.state.public.objects
  );
  assert.deepEqual(
    afterMarket.state.public.market,
    beforeMarket.state.public.market
  );

  await updateScenario(session, (state) => {
    state.public.session.phase = "construction";
    state.public.construction.mode = "road";
    state.public.construction.available = true;
    state.public.construction.sequence = 17;
    state.public.market.basePurchasePrices = {
      wagon: 6,
      locomotive: 12
    };
    state.public.turnEffects = {
      ...state.public.turnEffects,
      deliveryPayoutBonus: 3,
      locomotiveMovementLevy: 1,
      vehicleAndCargoMaintenanceExempt: true,
      purchasePermissions: {
        wagon: false,
        locomotive: false
      },
      purchasePriceOverrides: {
        wagon: 4,
        locomotive: 8
      }
    };
  });
  const constructionFinished = await dispatch({
    ...session,
    actionId: "construction.phase.finish"
  });
  assert.equal(constructionFinished.result.ok, true);
  const beforeReporting = await session.store.getSession(session.sessionId);
  assert.equal(beforeReporting.state.public.session.phase, "reporting");
  assert.equal(beforeReporting.state.public.construction.mode, null);
  assert.equal(beforeReporting.state.public.construction.available, false);

  await assertRejectedWithoutMutation(session, {
    actionId: "reporting.phase.finish",
    params: { turnNumber: 99 }
  });
  const reportingFinished = await dispatch({
    ...session,
    actionId: "reporting.phase.finish"
  });
  assert.equal(reportingFinished.result.ok, true);
  const afterReporting = await session.store.getSession(session.sessionId);
  assert.equal(afterReporting.state.public.session.phase, "news");
  assert.equal(afterReporting.state.public.session.turnNumber, 2);
  assert.equal(afterReporting.state.public.construction.sequence, 17);
  assert.deepEqual(
    afterReporting.state.public.objects,
    beforeReporting.state.public.objects
  );
  assert.deepEqual(
    afterReporting.state.public.market,
    beforeReporting.state.public.market
  );
  assert.deepEqual(
    afterReporting.state.public.turnEffects,
    beforeReporting.state.public.turnEffects
  );
  assert.deepEqual(
    afterReporting.state.public.log.at(-2)?.data,
    {
      kind: "phase",
      phase: "reporting",
      turnNumber: 1
    }
  );
  assert.deepEqual(
    afterReporting.state.public.log.at(-1)?.data,
    {
      kind: "construction-activation",
      turnNumber: 2
    }
  );
  await assertRejectedWithoutMutation(session, {
    actionId: "reporting.phase.finish"
  });

  const beforeDraw = await session.store.getSession(session.sessionId);
  const drawn = await dispatch({
    ...session,
    actionId: "news.lifecycle.draw"
  });
  assert.equal(drawn.result.ok, true);
  const afterDraw = await session.store.getSession(session.sessionId);
  assert.equal(beforeDraw.state.public.news.remaining, 34);
  assert.equal(afterDraw.state.public.news.remaining, 33);
  assert.equal(typeof afterDraw.state.public.news.currentCardId, "string");
  assert.deepEqual(
    afterDraw.state.public.market.basePurchasePrices,
    { wagon: 6, locomotive: 12 }
  );
  assert.deepEqual(afterDraw.state.public.turnEffects, {
    deliveryPayoutBonus: 0,
    locomotiveMovementLevy: 0,
    vehicleAndCargoMaintenanceExempt: false,
    firstRoadFreeSegments: 0,
    purchasePermissions: {
      wagon: true,
      locomotive: true
    },
    purchasePriceOverrides: {
      wagon: null,
      locomotive: null
    }
  });
});

test("technical fixtures are rejected and stagnation resets only temporary news effects", async () => {
  const manifest = await loadManifest();
  const technical = await createSession(manifest);
  await updateScenario(technical, (state) => {
    state.public.session.fixtureId = "real-operating-turn-technical";
    state.public.session.phase = "market";
  });
  await assertRejectedWithoutMutation(technical, {
    actionId: "market.phase.finish"
  });

  const session = await createSession(manifest);
  await initializeCards(session);
  await updateScenario(session, (state) => {
    state.public.session.phase = "construction";
    state.public.session.turnNumber = 7;
    state.public.news.currentCardId = null;
    state.public.news.remaining = 0;
    state.public.construction.mode = "waypoint";
    state.public.construction.available = true;
    state.public.construction.sequence = 23;
    state.public.market.basePurchasePrices = {
      wagon: 6,
      locomotive: 12
    };
    state.public.turnEffects.deliveryPayoutBonus = -2;
    state.public.turnEffects.locomotiveMovementLevy = 1;
    state.public.turnEffects.vehicleAndCargoMaintenanceExempt = true;
    state.public.turnEffects.purchasePermissions = {
      wagon: false,
      locomotive: false
    };
    state.public.turnEffects.purchasePriceOverrides = {
      wagon: 4,
      locomotive: 8
    };
  });
  assert.equal(
    (await dispatch({
      ...session,
      actionId: "construction.phase.finish"
    })).result.ok,
    true
  );
  assert.equal(
    (await dispatch({
      ...session,
      actionId: "reporting.phase.finish"
    })).result.ok,
    true
  );
  const beforeStagnation = await session.store.getSession(session.sessionId);
  assert.equal(beforeStagnation.state.public.session.turnNumber, 8);
  assert.equal(beforeStagnation.state.public.session.phase, "news");

  const stagnation = await dispatch({
    ...session,
    actionId: "news.lifecycle.stagnation"
  });
  assert.equal(stagnation.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.state.public.session.phase, "maintenance");
  assert.equal(after.state.public.news.status, "stagnation");
  assert.equal(after.state.public.construction.sequence, 23);
  assert.deepEqual(
    after.state.public.market.basePurchasePrices,
    { wagon: 6, locomotive: 12 }
  );
  assert.deepEqual(after.state.public.turnEffects, {
    deliveryPayoutBonus: 0,
    locomotiveMovementLevy: 0,
    vehicleAndCargoMaintenanceExempt: false,
    firstRoadFreeSegments: 0,
    purchasePermissions: {
      wagon: true,
      locomotive: true
    },
    purchasePriceOverrides: {
      wagon: null,
      locomotive: null
    }
  });
});
