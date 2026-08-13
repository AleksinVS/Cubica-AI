/**
 * Focused Runtime proof for explicit loans, manual money correction and team
 * exclusion in «Карты, деньги, поезда».
 *
 * The tests compile the game-local generator only in memory. They never
 * bypass Game Intent dispatch for the behavior under test; direct fixture
 * state supplies only a compact placed-team scenario.
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
  buildFacilitatorEconomyAuthoring,
  economyActionIds,
  maximumAdjustment
} from "./build-facilitator-economy.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const credentialSha256 = "e".repeat(64);
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

/** Compile once; all output paths remain descriptive and no file is written. */
const loadManifest = async () => {
  manifestPromise ??= (async () => {
    const source = await readJson(authoringPath);
    const built = buildFacilitatorEconomyAuthoring(source);
    const output = compileAuthoringText(
      {
        kind: "game",
        sourceFile: authoringPath,
        outputFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-facilitator-economy.manifest.json"
        ),
        sourceMapFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-facilitator-economy.source-map.json"
        )
      },
      JSON.stringify(built)
    );
    return validateGameManifest(output.manifest);
  })();
  return manifestPromise;
};

const team = (id, type, coins = 10, debt = 0) => ({
  objectType: "game.team",
  facets: { placementStatus: "placed" },
  attributes: {
    label: id,
    type,
    colorId: type === "logistics_company" ? "cobalt" : "orange",
    coins,
    constructionPledge: 0,
    outstandingDebt: debt,
    placementOrderKey: 0,
    progressiveTaxLocomotiveCount: 0,
    progressiveTaxWagonCount: 0,
    news19PreparedTurn: 0,
    news19VehicleCountSnapshot: 0,
    news19RemovalRequired: 0,
    news19RemovalRemaining: 0,
    news19ResolvedTurn: 0
  }
});

const locomotive = (ownerTeamId, nodeId) => ({
  objectType: "transport.locomotive",
  facets: { availability: "active" },
  attributes: {
    networkId: "main",
    nodeId,
    ownerTeamId,
    actionPoints: 5,
    maintenancePaidTurn: 0,
    turnOrderCount: 1,
    movementResolvedTurn: 0,
    lastMovedTurn: 0,
    news19ConfiscatedTurn: 0
  }
});

const wagon = ({
  ownerTeamId,
  nodeId,
  attachedVehicleId = null,
  cargoId = null,
  availability = "active"
}) => ({
  objectType: "transport.wagon",
  facets: { availability },
  attributes: {
    networkId: "main",
    nodeId,
    ownerTeamId,
    attachedVehicleId,
    cargoId,
    maintenancePaidTurn: 0,
    formationTargetLocomotiveId: null,
    cargoOfferEligibleTurn: 0,
    cargoOfferResolvedTurn: 0,
    cargoPriorityActiveCount: 0,
    news19ConfiscatedTurn: 0
  }
});

const economyState = (manifest) => {
  const state = structuredClone(manifest.state);
  state.public.session.fixtureId = "normal-start-policy";
  state.public.session.status = "running";
  state.public.session.phase = "maintenance";
  state.public.session.turnNumber = 3;
  state.public.log = [];
  state.public.objects.teams = {
    "team-logistics": team(
      "team-logistics",
      "logistics_company",
      10
    ),
    "team-guild": team("team-guild", "locomotive_guild", 20)
  };
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
      principalId: "facilitator-economy-test-controller",
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

/** Any rejected debit or repayment must leave the whole session unchanged. */
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

test("economy generator is idempotent and publishes only bounded facilitator intents", async () => {
  const source = await readJson(authoringPath);
  const once = buildFacilitatorEconomyAuthoring(source);
  const twice = buildFacilitatorEconomyAuthoring(once);
  assert.deepEqual(twice, once);

  const root = once.root;
  assert.deepEqual(
    root.logic.actions
      .filter((candidate) => candidate.id.startsWith("facilitator.economy."))
      .map((candidate) => candidate.id),
    economyActionIds
  );
  assert.deepEqual(
    root.state.public.board.availableActions
      .filter((candidate) =>
        candidate.actionId.startsWith("facilitator.economy."))
      .map((candidate) => ({
        id: candidate.id,
        actionId: candidate.actionId,
        phase: candidate.phase,
        section: candidate.section
      })),
    economyActionIds.map((actionId) => ({
      id: actionId.replaceAll(".", "-"),
      actionId,
      phase: "any",
      section: "economy"
    }))
  );
  for (const actionId of economyActionIds) {
    const candidate = root.logic.actions.find(
      (item) => item.id === actionId
    );
    assert.deepEqual(candidate.allowedSessionRoles, ["facilitator"]);
    assert.equal(candidate.paramsSchema.additionalProperties, false);
  }
  for (const actionId of economyActionIds.filter(
    (candidate) => !candidate.endsWith(".exclude")
  )) {
    assert.equal(
      root.logic.actions.find((item) => item.id === actionId)
        .paramsSchema.properties.amount.maximum,
      maximumAdjustment
    );
  }
  assert.equal(
    root.mechanics.stateModel.collections.teams.fields.outstandingDebt
      .valueType,
    "core.integer"
  );
  assert.equal(
    root.mechanics.stateModel.endpoints[
      "public.teams.bound.outstandingDebt"
    ].access,
    "read-write"
  );
});

test("manual corrections and loans are explicit, journaled and fail closed", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, economyState(manifest));
  const teamId = "team-logistics";

  for (const [actionId, amount] of [
    ["facilitator.economy.loan.issue", 7],
    ["facilitator.economy.adjust.debit", 3],
    ["facilitator.economy.adjust.credit", 2],
    ["facilitator.economy.loan.repay", 5]
  ]) {
    const outcome = await dispatch({
      ...session,
      actionId,
      params: { teamId, amount }
    });
    assert.equal(outcome.result.ok, true, actionId);
  }

  let snapshot = await session.store.getSession(session.sessionId);
  const attributes =
    snapshot.state.public.objects.teams[teamId].attributes;
  assert.equal(attributes.coins, 11);
  assert.equal(attributes.outstandingDebt, 2);
  assert.deepEqual(
    snapshot.state.public.log.slice(-4).map((entry) => entry.eventType),
    [
      "facilitator.economy.loan.issued",
      "facilitator.economy.adjustment.debited",
      "facilitator.economy.adjustment.credited",
      "facilitator.economy.loan.repaid"
    ]
  );

  await assertRejectedWithoutMutation(session, {
    actionId: "facilitator.economy.loan.repay",
    params: { teamId, amount: 3 }
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "facilitator.economy.adjust.debit",
    params: { teamId, amount: 12 }
  });
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(
    snapshot.state.public.objects.teams[teamId].attributes.coins,
    11
  );
});

test("exclusion returns equipment, grounds cargo and advances an affected movement queue", async () => {
  const manifest = await loadManifest();
  const state = economyState(manifest);
  state.public.objects.teams["team-guild-2"] = team(
    "team-guild-2",
    "locomotive_guild",
    20
  );
  state.public.objects.teams["team-guild-2"].attributes.colorId = "emerald";
  state.public.session.phase = "operations";
  state.public.movement.locomotiveOrder = ["locomotive-a", "locomotive-b"];
  state.public.movement.currentLocomotiveId = "locomotive-a";
  state.public.objects.locomotives = {
    "locomotive-a": locomotive("team-guild", "terminal-1"),
    "locomotive-b": locomotive("team-guild-2", "terminal-2")
  };
  state.public.objects.wagons = {
    "wagon-logistics": wagon({
      ownerTeamId: "team-logistics",
      nodeId: "terminal-1",
      attachedVehicleId: "locomotive-a",
      cargoId: "cargo-source-row-002"
    }),
    "wagon-foreign": wagon({
      ownerTeamId: "team-guild-2",
      nodeId: "terminal-1",
      attachedVehicleId: "locomotive-a"
    }),
    "wagon-reserve": wagon({
      ownerTeamId: "team-logistics",
      nodeId: null,
      availability: "reserve"
    })
  };
  const cargo = state.public.objects.cargoOrders["cargo-source-row-002"];
  cargo.facets.status = "in_transit";
  cargo.attributes.holderTeamId = "team-logistics";
  cargo.attributes.carrierWagonId = "wagon-logistics";
  cargo.attributes.availableAtNodeId = cargo.attributes.fromNodeId;
  cargo.attributes.activeLegFromNodeId = cargo.attributes.fromNodeId;
  state.public.objects.teams["team-logistics"].attributes.outstandingDebt = 9;

  const session = await createSession(manifest, state);
  const outcome = await dispatch({
    ...session,
    actionId: "facilitator.economy.team.exclude",
    params: { teamId: "team-logistics" }
  });
  assert.equal(outcome.result.ok, true);

  let snapshot = await session.store.getSession(session.sessionId);
  const excluded =
    snapshot.state.public.objects.teams["team-logistics"];
  assert.equal(excluded.facets.placementStatus, "excluded");
  assert.equal(excluded.attributes.outstandingDebt, 0);
  for (const wagonId of ["wagon-logistics", "wagon-reserve"]) {
    assert.equal(
      snapshot.state.public.objects.wagons[wagonId].facets.availability,
      "sold"
    );
  }
  const releasedCargo =
    snapshot.state.public.objects.cargoOrders["cargo-source-row-002"];
  assert.equal(releasedCargo.facets.status, "available");
  assert.equal(releasedCargo.attributes.holderTeamId, null);
  assert.equal(releasedCargo.attributes.carrierWagonId, null);
  assert.equal(releasedCargo.attributes.availableAtNodeId, "terminal-1");

  const guildExclusion = await dispatch({
    ...session,
    actionId: "facilitator.economy.team.exclude",
    params: { teamId: "team-guild" }
  });
  assert.equal(guildExclusion.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(
    snapshot.state.public.objects.locomotives["locomotive-a"]
      .facets.availability,
    "sold"
  );
  assert.equal(
    snapshot.state.public.objects.wagons["wagon-foreign"]
      .attributes.attachedVehicleId,
    null
  );
  assert.equal(
    snapshot.state.public.movement.currentLocomotiveId,
    "locomotive-b"
  );

  const finalGuildExclusion = await dispatch({
    ...session,
    actionId: "facilitator.economy.team.exclude",
    params: { teamId: "team-guild-2" }
  });
  assert.equal(finalGuildExclusion.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "settlement");
  assert.equal(snapshot.state.public.session.canRequestFinish, false);

  await assertRejectedWithoutMutation(session, {
    actionId: "facilitator.economy.adjust.credit",
    params: { teamId: "team-logistics", amount: 1 }
  });
});
