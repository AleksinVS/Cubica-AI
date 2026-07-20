/**
 * Focused proof for the bounded normal-session setup.
 *
 * The tests execute public Game Intents through the ordinary Runtime
 * dispatcher. Direct store edits appear only where a test must create an
 * otherwise unreachable negative condition, such as a closed review terminal
 * or two already occupied locomotive slots.
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
import {
  buildLifecycleAuthoring
} from "./build-card-lifecycle.mjs";
import {
  authoringPath,
  buildFromDisk,
  contrastColorIds,
  supportedOddTeamCounts
} from "./build-session-setup.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const intakePath = path.join(gameRoot, "authoring", "fixtures", "cargo-news.intake.json");
const credentialSha256 = "d".repeat(64);
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

const loadManifest = async () =>
  validateGameManifest(await readJson(path.join(gameRoot, "game.manifest.json")));

const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "session-setup-test-facilitator",
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

/** Prove schema or Mechanics rejection cannot mutate the authoritative session. */
const assertRejectedWithoutMutation = async (session, input) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const outcome = await dispatch({ ...session, ...input });
    rejected = outcome.result.ok === false && outcome.receipt.status === "rejected";
  } catch {
    // Invalid JSON-Schema parameters are refused before a Mechanics receipt.
    rejected = true;
  }
  assert.equal(rejected, true, `${input.actionId} must reject invalid input`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

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
  assert.equal(outcome.result.ok, true, `${actionId} must accept team ${index + 1}`);
  return outcome;
};

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

const finalize = (session) => dispatch({
  ...session,
  actionId: "session.setup.finalize"
});

const publicObjects = (session) => session.state.public.objects;

const reserveAssetsForTeam = (session, teamId, collection) =>
  Object.entries(publicObjects(session)[collection])
    .filter(([, entity]) =>
      entity.attributes.ownerTeamId === teamId &&
      entity.facets.availability === "reserve"
    )
    .map(([id]) => id)
    .sort();

const currentTeam = (session) => {
  const teamId = session.state.public.setup.currentTeamId;
  return [teamId, publicObjects(session).teams[teamId]];
};

test("setup and card generators are idempotent and keep teams as entities", async () => {
  const [actual, expected, intake] = await Promise.all([
    readJson(authoringPath),
    buildFromDisk(),
    readJson(intakePath)
  ]);
  assert.deepEqual(actual, expected);
  assert.deepEqual(buildLifecycleAuthoring(actual, intake), actual);

  const root = actual.root;
  const teams = root.mechanics.stateModel.collections.teams;
  assert.equal(teams.itemShape, undefined);
  assert.deepEqual(teams.itemTypes, ["game.team"]);
  assert.deepEqual(teams.storage.segments, ["objects", "teams"]);
  assert.deepEqual(root.state.public.objects.teams, {});
  assert.equal(root.state.public.teams, undefined);
  assert.deepEqual(
    Object.keys(root.mechanics.stateModel.endpoints)
      .filter((endpointId) => endpointId.startsWith("public.teams."))
      .sort(),
    [
      "public.teams.bound.coins",
      "public.teams.bound.progressiveTaxLocomotiveCount",
      "public.teams.bound.progressiveTaxWagonCount"
    ]
  );
  assert.equal(root.mechanics.macros["cmt.construction.road"], undefined);
  assert.equal(root.mechanics.macros["cmt.construction.waypoint"], undefined);
  assert.equal(root.config.runtimeReady, false);
  assert.equal(root.content.data.sessionSetup.publishable, false);
  assert.equal(
    root.config.runtimeBlockers.includes("accessible free-text team-name entry"),
    false
  );
  assert.equal(
    root.content.data.sessionSetup.unresolved.includes(
      "accessible-free-text-team-name-field"
    ),
    false
  );
  assert.deepEqual(
    root.state.public.board.availableActions
      .filter((candidate) => candidate.actionId.startsWith("session.setup.team.add."))
      .map((candidate) => ({
        id: candidate.id,
        actionId: candidate.actionId,
        phase: candidate.phase,
        section: candidate.section
      })),
    [{
      id: "setup-add-logistics-company",
      actionId: "session.setup.team.add.logistics-company",
      phase: "setup",
      section: "setup"
    }, {
      id: "setup-add-locomotive-guild",
      actionId: "session.setup.team.add.locomotive-guild",
      phase: "setup",
      section: "setup"
    }]
  );
});

test("team creation is atomic, bounded, and rejects a reused contrast color", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addTeam(session, "logistics_company", 0);

  const afterCarrier = await session.store.getSession(session.sessionId);
  const teams = publicObjects(afterCarrier).teams;
  const wagons = publicObjects(afterCarrier).wagons;
  const [teamId] = Object.keys(teams);
  assert.equal(teams[teamId].attributes.coins, 10);
  assert.equal(teams[teamId].attributes.type, "logistics_company");
  assert.equal(teams[teamId].facets.placementStatus, "configured");
  assert.equal(Object.keys(wagons).length, 2);
  assert.ok(Object.values(wagons).every((wagon) =>
    wagon.attributes.ownerTeamId === teamId &&
    wagon.attributes.nodeId === null &&
    wagon.facets.availability === "reserve"
  ));

  const beforeRejected = await session.store.getSession(session.sessionId);
  const rejected = await dispatch({
    ...session,
    actionId: "session.setup.team.add.locomotive-guild",
    params: {
      name: "Повтор цвета",
      colorId: contrastColorIds[0]
    }
  });
  assert.equal(rejected.result.ok, false);
  const afterRejected = await session.store.getSession(session.sessionId);
  assert.equal(afterRejected.version.stateVersion, beforeRejected.version.stateVersion);
  assert.deepEqual(afterRejected.state.public.objects, beforeRejected.state.public.objects);
});

test("team names preserve exact text while the server rejects invalid strings atomically", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  const actionId = "session.setup.team.add.logistics-company";

  for (const name of ["", "   ", "x".repeat(81)]) {
    await assertRejectedWithoutMutation(session, {
      actionId,
      params: { name, colorId: contrastColorIds[0] }
    });
  }

  const exactName = "  Северный экспресс  ";
  const accepted = await dispatch({
    ...session,
    actionId,
    params: { name: exactName, colorId: contrastColorIds[0] }
  });
  assert.equal(accepted.result.ok, true);
  const current = await session.store.getSession(session.sessionId);
  const [team] = Object.values(publicObjects(current).teams);
  assert.equal(team.attributes.label, exactName);
});

test("all confirmed odd team counts finalize while an even composition fails closed", async () => {
  const manifest = await loadManifest();
  for (const count of supportedOddTeamCounts) {
    const session = await createSession(manifest);
    await addOddComposition(session, count);
    const finalized = await finalize(session);
    assert.equal(finalized.result.ok, true, `${count} teams must be supported`);
    const current = await session.store.getSession(session.sessionId);
    const setup = current.state.public.setup;
    assert.equal(setup.status, "placement");
    assert.equal(current.state.public.session.phase, "setup-placement");
    assert.equal(setup.placementOrder.length, count);
    assert.equal(new Set(setup.placementOrder).size, count);
    assert.equal(setup.currentTeamId, setup.placementOrder[0]);
  }

  const evenSession = await createSession(manifest);
  for (let index = 0; index < 3; index += 1) {
    await addTeam(evenSession, "logistics_company", index);
  }
  for (let index = 0; index < 3; index += 1) {
    await addTeam(evenSession, "locomotive_guild", 3 + index);
  }
  const beforeRejected = await evenSession.store.getSession(evenSession.sessionId);
  const rejected = await finalize(evenSession);
  assert.equal(rejected.result.ok, false);
  const afterRejected = await evenSession.store.getSession(evenSession.sessionId);
  assert.equal(afterRejected.version.stateVersion, beforeRejected.version.stateVersion);
  assert.equal(afterRejected.state.public.session.phase, "setup");
});

test("the same seed and setup commands reproduce the same random placement order", async () => {
  const manifest = await loadManifest();
  const first = await createSession(manifest);
  const second = await createSession(manifest);
  await addOddComposition(first, 5);
  await addOddComposition(second, 5);
  assert.equal((await finalize(first)).result.ok, true);
  assert.equal((await finalize(second)).result.ok, true);
  const [firstState, secondState] = await Promise.all([
    first.store.getSession(first.sessionId),
    second.store.getSession(second.sessionId)
  ]);
  assert.deepEqual(
    firstState.state.public.setup.placementOrder,
    secondState.state.public.setup.placementOrder
  );
});

test("the thirteenth team is rejected without a partial team or asset", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  for (let index = 0; index < 6; index += 1) {
    await addTeam(session, "logistics_company", index);
  }
  for (let index = 0; index < 6; index += 1) {
    await addTeam(session, "locomotive_guild", 6 + index);
  }
  const beforeRejected = await session.store.getSession(session.sessionId);
  const rejected = await dispatch({
    ...session,
    actionId: "session.setup.team.add.logistics-company",
    params: {
      name: "Тринадцатая",
      colorId: contrastColorIds[0]
    }
  });
  assert.equal(rejected.result.ok, false);
  const afterRejected = await session.store.getSession(session.sessionId);
  assert.equal(afterRejected.version.stateVersion, beforeRejected.version.stateVersion);
  assert.equal(Object.keys(publicObjects(afterRejected).teams).length, 12);
  assert.equal(Object.keys(publicObjects(afterRejected).wagons).length, 12);
  assert.equal(Object.keys(publicObjects(afterRejected).locomotives).length, 6);
});

test("facilitator placement validates ownership and target, then advances only after all team assets", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addOddComposition(session, 5);
  assert.equal((await finalize(session)).result.ok, true);

  let current = await session.store.getSession(session.sessionId);
  assert.equal(Object.keys(publicObjects(current).networkNodes).length, 25);
  assert.equal(Object.keys(publicObjects(current).networkEdges).length, 10);

  const [currentTeamId] = currentTeam(current);
  const foreignWagon = Object.entries(publicObjects(current).wagons)
    .find(([, wagon]) => wagon.attributes.ownerTeamId !== currentTeamId)?.[0];
  const foreignLocomotive = Object.entries(publicObjects(current).locomotives)
    .find(([, locomotive]) => locomotive.attributes.ownerTeamId !== currentTeamId)?.[0];
  const foreignAsset = foreignWagon
    ? { actionId: "session.setup.place.wagon", parameter: "wagonId", id: foreignWagon }
    : {
        actionId: "session.setup.place.locomotive",
        parameter: "locomotiveId",
        id: foreignLocomotive
      };
  const wrongOwner = await dispatch({
    ...session,
    actionId: foreignAsset.actionId,
    params: {
      [foreignAsset.parameter]: foreignAsset.id,
      stationId: "terminal-1"
    }
  });
  assert.equal(wrongOwner.result.ok, false);

  const currentWagon = reserveAssetsForTeam(current, currentTeamId, "wagons")[0];
  const currentLocomotive =
    reserveAssetsForTeam(current, currentTeamId, "locomotives")[0];
  const currentAsset = currentWagon
    ? { actionId: "session.setup.place.wagon", parameter: "wagonId", id: currentWagon }
    : {
        actionId: "session.setup.place.locomotive",
        parameter: "locomotiveId",
        id: currentLocomotive
      };
  const beforeWaypoint = await session.store.getSession(session.sessionId);
  await assert.rejects(
    () => dispatch({
      ...session,
      actionId: currentAsset.actionId,
      params: {
        [currentAsset.parameter]: currentAsset.id,
        stationId: "waypoint-9-3-4"
      }
    }),
    /does not reference an available resource/u
  );
  assert.equal(
    (await session.store.getSession(session.sessionId)).version.stateVersion,
    beforeWaypoint.version.stateVersion
  );

  await updateScenario(session, (state) => {
    state.public.objects.networkNodes["terminal-23"].facets.availability = "closed";
  });
  const beforeClosed = await session.store.getSession(session.sessionId);
  const closedRejected = await dispatch({
    ...session,
    actionId: currentAsset.actionId,
    params: {
      [currentAsset.parameter]: currentAsset.id,
      stationId: "terminal-23"
    }
  });
  assert.equal(closedRejected.result.ok, false);
  const afterClosed = await session.store.getSession(session.sessionId);
  assert.equal(afterClosed.version.stateVersion, beforeClosed.version.stateVersion);
  assert.deepEqual(afterClosed.state.public.objects, beforeClosed.state.public.objects);
  await updateScenario(session, (state) => {
    state.public.objects.networkNodes["terminal-23"].facets.availability = "open";
  });

  let terminalIndex = 1;
  let observedPartialCarrier = false;
  while (true) {
    current = await session.store.getSession(session.sessionId);
    if (current.state.public.session.phase === "setup-complete") break;
    const [teamId, team] = currentTeam(current);
    assert.ok(team, "the placement cursor must reference an existing team");
    const wagonIds = reserveAssetsForTeam(current, teamId, "wagons");
    const locomotiveIds = reserveAssetsForTeam(current, teamId, "locomotives");
    const assetIds = team.attributes.type === "logistics_company"
      ? wagonIds
      : locomotiveIds;
    const actionId = team.attributes.type === "logistics_company"
      ? "session.setup.place.wagon"
      : "session.setup.place.locomotive";
    const parameter = team.attributes.type === "logistics_company"
      ? "wagonId"
      : "locomotiveId";
    for (const [assetIndex, assetId] of assetIds.entries()) {
      const stationId = `terminal-${terminalIndex++}`;
      const placed = await dispatch({
        ...session,
        actionId,
        params: { [parameter]: assetId, stationId }
      });
      assert.equal(placed.result.ok, true);
      const afterPlacement = await session.store.getSession(session.sessionId);
      if (assetIndex < assetIds.length - 1) {
        observedPartialCarrier = true;
        assert.equal(afterPlacement.state.public.setup.currentTeamId, teamId);
      }
    }
  }

  const complete = await session.store.getSession(session.sessionId);
  assert.equal(observedPartialCarrier, true);
  assert.equal(complete.state.public.setup.status, "complete");
  assert.equal(complete.state.public.setup.currentTeamId, "");
  assert.ok(Object.values(publicObjects(complete).teams).every(
    (team) => team.facets.placementStatus === "placed"
  ));
  assert.ok(Object.values(publicObjects(complete).wagons).every(
    (wagon) => wagon.facets.availability === "active" &&
      typeof wagon.attributes.nodeId === "string"
  ));
  assert.ok(Object.values(publicObjects(complete).locomotives).every(
    (locomotive) => locomotive.facets.availability === "active" &&
      typeof locomotive.attributes.nodeId === "string"
  ));
});

test("locomotive placement rejects a third active locomotive at one terminal atomically", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addOddComposition(session, 5);
  assert.equal((await finalize(session)).result.ok, true);

  let current;
  while (true) {
    current = await session.store.getSession(session.sessionId);
    const [teamId, team] = currentTeam(current);
    if (team.attributes.type === "locomotive_guild") break;
    for (const wagonId of reserveAssetsForTeam(current, teamId, "wagons")) {
      const placed = await dispatch({
        ...session,
        actionId: "session.setup.place.wagon",
        params: { wagonId, stationId: "terminal-2" }
      });
      assert.equal(placed.result.ok, true);
    }
  }

  const [guildId] = currentTeam(current);
  const locomotiveId = reserveAssetsForTeam(current, guildId, "locomotives")[0];
  await updateScenario(session, (state) => {
    state.public.objects.locomotives["capacity-proof-1"] = {
      objectType: "transport.locomotive",
      facets: { availability: "active" },
      attributes: {
        networkId: "main",
        nodeId: "terminal-1",
        ownerTeamId: guildId,
        actionPoints: 5
      }
    };
    state.public.objects.locomotives["capacity-proof-2"] = {
      objectType: "transport.locomotive",
      facets: { availability: "active" },
      attributes: {
        networkId: "main",
        nodeId: "terminal-1",
        ownerTeamId: guildId,
        actionPoints: 5
      }
    };
  });

  const beforeRejected = await session.store.getSession(session.sessionId);
  const rejected = await dispatch({
    ...session,
    actionId: "session.setup.place.locomotive",
    params: { locomotiveId, stationId: "terminal-1" }
  });
  assert.equal(rejected.result.ok, false);
  const afterRejected = await session.store.getSession(session.sessionId);
  assert.equal(afterRejected.version.stateVersion, beforeRejected.version.stateVersion);
  assert.equal(
    publicObjects(afterRejected).locomotives[locomotiveId].facets.availability,
    "reserve"
  );
  assert.equal(
    publicObjects(afterRejected).locomotives[locomotiveId].attributes.nodeId,
    null
  );

  const accepted = await dispatch({
    ...session,
    actionId: "session.setup.place.locomotive",
    params: { locomotiveId, stationId: "terminal-3" }
  });
  assert.equal(accepted.result.ok, true);
});
