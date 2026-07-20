/**
 * Focused Runtime proof for the complete economic news №16 and №22 slice.
 *
 * Scenario preparation creates teams and transport through their public setup
 * intents. Direct store edits only enter upstream phases that are still
 * intentionally disconnected by the unfinished market/reporting workflows.
 * Every news application, movement and skip is dispatched through the normal
 * protected Runtime boundary.
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
import { contrastColorIds } from "./build-session-setup.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const credentialSha256 = "9".repeat(64);
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

const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "news-economic-effects-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

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

/** Mutate only bounded upstream scenario facts under optimistic concurrency. */
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

const addTeam = async (session, type, colorIndex) => {
  const actionId = type === "logistics_company"
    ? "session.setup.team.add.logistics-company"
    : "session.setup.team.add.locomotive-guild";
  const result = await dispatch({
    ...session,
    actionId,
    params: {
      name: `${type === "logistics_company" ? "Перевозчик" : "Гильдия"} ${colorIndex + 1}`,
      colorId: contrastColorIds[colorIndex]
    }
  });
  assert.equal(result.result.ok, true);
};

const addOddFiveTeamComposition = async (session) => {
  for (let index = 0; index < 3; index += 1) {
    await addTeam(session, "logistics_company", index);
  }
  for (let index = 3; index < 5; index += 1) {
    await addTeam(session, "locomotive_guild", index);
  }
};

/** Place every reserve vehicle in the protected random team order. */
const placeAllAssets = async (session) => {
  const guildStations = new Map();
  let nextGuildStation = 1;
  while (true) {
    const current = await session.store.getSession(session.sessionId);
    if (current.state.public.session.phase === "setup-complete") return;
    assert.equal(current.state.public.session.phase, "setup-placement");
    const teamId = current.state.public.setup.currentTeamId;
    const { wagons, locomotives } = current.state.public.objects;
    const wagonId = Object.entries(wagons).find(([, wagon]) =>
      wagon.attributes.ownerTeamId === teamId &&
      wagon.facets.availability === "reserve"
    )?.[0];
    if (wagonId) {
      const placed = await dispatch({
        ...session,
        actionId: "session.setup.place.wagon",
        params: { wagonId, stationId: "terminal-1" }
      });
      assert.equal(placed.result.ok, true);
      continue;
    }
    const locomotiveId = Object.entries(locomotives).find(([, locomotive]) =>
      locomotive.attributes.ownerTeamId === teamId &&
      locomotive.facets.availability === "reserve"
    )?.[0];
    assert.ok(locomotiveId);
    if (!guildStations.has(teamId)) {
      guildStations.set(teamId, `terminal-${nextGuildStation++}`);
    }
    const placed = await dispatch({
      ...session,
      actionId: "session.setup.place.locomotive",
      params: {
        locomotiveId,
        stationId: guildStations.get(teamId)
      }
    });
    assert.equal(placed.result.ok, true);
  }
};

const initializeCards = async (session) => {
  const initialized = await dispatch({
    ...session,
    actionId: "cards.lifecycle.initialize"
  });
  assert.equal(initialized.result.ok, true);
};

/** Put one physical news card first, then use the real protected draw action. */
const drawNews = async (session, number, turnNumber) => {
  const newsId = `news-${String(number).padStart(2, "0")}`;
  await updateScenario(session, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = turnNumber;
    state.public.news.currentCardId = null;
    const deck = state.secret.decks.news;
    deck.order = [newsId, ...deck.order.filter((cardId) => cardId !== newsId)];
    deck.discard = deck.discard.filter((cardId) => cardId !== newsId);
    deck.held = deck.held.filter((cardId) => cardId !== newsId);
  });
  const drawn = await dispatch({
    ...session,
    actionId: "news.lifecycle.draw"
  });
  assert.equal(drawn.result.ok, true);
  const current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.news.currentCardId, newsId);
  return current;
};

const applyNews = (session, number) =>
  dispatch({
    ...session,
    actionId: `news.effect.apply.${String(number).padStart(2, "0")}`
  });

/** Reach operations with the complete server-owned locomotive order. */
const prepareMovement = async (session) => {
  await updateScenario(session, (state) => {
    state.public.session.phase = "movement-order";
  });
  const prepared = await dispatch({
    ...session,
    actionId: "movement.order.prepare"
  });
  assert.equal(prepared.result.ok, true);
  return session.store.getSession(session.sessionId);
};

const incidentOpenEdgeId = (state, locomotiveId) => {
  const nodeId =
    state.public.objects.locomotives[locomotiveId].attributes.nodeId;
  const edge = Object.entries(state.public.objects.networkEdges).find(
    ([, candidate]) =>
      candidate.facets.state === "open" &&
      (
        candidate.attributes.fromNodeId === nodeId ||
        candidate.attributes.toNodeId === nodeId
      )
  );
  assert.ok(edge, `an open edge must be incident to ${nodeId}`);
  return edge[0];
};

test("news №16 atomically charges only balances above fifteen and resolves once", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addTeam(session, "logistics_company", 0);
  await addTeam(session, "locomotive_guild", 1);
  await addTeam(session, "logistics_company", 2);
  await initializeCards(session);

  let teamIds;
  await updateScenario(session, (state) => {
    teamIds = Object.keys(state.public.objects.teams).sort();
    assert.equal(teamIds.length, 3);
    const balances = [16, 15, 20];
    teamIds.forEach((teamId, index) => {
      state.public.objects.teams[teamId].attributes.coins = balances[index];
    });
  });
  await drawNews(session, 16, 2);

  await assertRejectedWithoutMutation(session, {
    actionId: "news.effect.apply.22"
  });
  await assertRejectedWithoutMutation(session, {
    actionId: "news.effect.apply.16",
    params: { teamId: teamIds[0] }
  });

  const applied = await applyNews(session, 16);
  assert.equal(applied.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.deepEqual(
    teamIds.map(
      (teamId) => after.state.public.objects.teams[teamId].attributes.coins
    ),
    [11, 15, 15]
  );
  assert.equal(after.state.public.news.currentCardId, null);
  assert.equal(after.state.public.news.status, "resolved");
  assert.equal(after.state.public.session.phase, "maintenance");
  assert.equal(
    after.state.public.objects.newsCards["news-16"].facets.availability,
    "resolved"
  );
  const feeEvents = after.state.public.log.filter(
    (event) => event.eventType === "news.budget.fee.paid"
  );
  assert.deepEqual(
    feeEvents.map((event) => event.data),
    [
      {
        newsId: "news-16",
        teamId: teamIds[0],
        threshold: 15,
        amount: 5,
        balanceAfter: 11,
        turnNumber: 2
      },
      {
        newsId: "news-16",
        teamId: teamIds[2],
        threshold: 15,
        amount: 5,
        balanceAfter: 15,
        turnNumber: 2
      }
    ]
  );

  await assertRejectedWithoutMutation(session, {
    actionId: "news.effect.apply.16"
  });
});

test("news №22 charges only the first successful movement and resets next news", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addOddFiveTeamComposition(session);
  await initializeCards(session);
  const finalized = await dispatch({
    ...session,
    actionId: "session.setup.finalize"
  });
  assert.equal(finalized.result.ok, true);
  await placeAllAssets(session);

  await drawNews(session, 22, 2);
  const applied = await applyNews(session, 22);
  assert.equal(applied.result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId))
      .state.public.turnEffects.locomotiveMovementLevy,
    1
  );
  const prepared = await prepareMovement(session);
  const locomotiveId = prepared.state.public.movement.currentLocomotiveId;
  assert.equal(typeof locomotiveId, "string");
  const locomotive = prepared.state.public.objects.locomotives[locomotiveId];
  const ownerTeamId = locomotive.attributes.ownerTeamId;
  const startingCoins =
    prepared.state.public.objects.teams[ownerTeamId].attributes.coins;
  const edgeId = incidentOpenEdgeId(prepared.state, locomotiveId);

  const first = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId }
  });
  assert.equal(first.result.ok, true);
  const afterFirst = await session.store.getSession(session.sessionId);
  assert.equal(
    afterFirst.state.public.objects.teams[ownerTeamId].attributes.coins,
    startingCoins - 1
  );
  assert.equal(
    afterFirst.state.public.objects.locomotives[locomotiveId]
      .attributes.lastMovedTurn,
    2
  );
  const firstLevyEvents = afterFirst.state.public.log.filter(
    (event) => event.eventType === "news.locomotive.levy.paid"
  );
  assert.deepEqual(firstLevyEvents.map((event) => event.data), [{
    newsId: "news-22",
    locomotiveId,
    ownerTeamId,
    edgeId,
    amount: 1,
    balanceAfter: startingCoins - 1,
    turnNumber: 2
  }]);

  const second = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId }
  });
  assert.equal(second.result.ok, true);
  const afterSecond = await session.store.getSession(session.sessionId);
  assert.equal(
    afterSecond.state.public.objects.teams[ownerTeamId].attributes.coins,
    startingCoins - 1
  );
  assert.equal(
    afterSecond.state.public.log.filter(
      (event) => event.eventType === "news.locomotive.levy.paid"
    ).length,
    1
  );

  await drawNews(session, 23, 3);
  const afterNextDraw = await session.store.getSession(session.sessionId);
  assert.equal(
    afterNextDraw.state.public.turnEffects.locomotiveMovementLevy,
    0
  );
});

test("news №22 insufficient funds rolls back movement while explicit skip remains usable", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addOddFiveTeamComposition(session);
  await initializeCards(session);
  assert.equal(
    (await dispatch({
      ...session,
      actionId: "session.setup.finalize"
    })).result.ok,
    true
  );
  await placeAllAssets(session);
  await drawNews(session, 22, 2);
  assert.equal((await applyNews(session, 22)).result.ok, true);
  const prepared = await prepareMovement(session);
  const locomotiveId = prepared.state.public.movement.currentLocomotiveId;
  const ownerTeamId =
    prepared.state.public.objects.locomotives[locomotiveId].attributes.ownerTeamId;
  const edgeId = incidentOpenEdgeId(prepared.state, locomotiveId);
  await updateScenario(session, (state) => {
    state.public.objects.teams[ownerTeamId].attributes.coins = 0;
  });

  await assertRejectedWithoutMutation(session, {
    actionId: "movement.locomotive.traverse",
    params: { edgeId }
  });
  const skipped = await dispatch({
    ...session,
    actionId: "movement.locomotive.skip"
  });
  assert.equal(skipped.result.ok, true);
  const afterSkip = await session.store.getSession(session.sessionId);
  assert.equal(
    afterSkip.state.public.objects.locomotives[locomotiveId]
      .attributes.lastMovedTurn,
    0
  );
  assert.equal(
    afterSkip.state.public.log.some(
      (event) => event.eventType === "news.locomotive.levy.paid"
    ),
    false
  );
  assert.notEqual(
    afterSkip.state.public.movement.currentLocomotiveId,
    locomotiveId
  );
});

test("ordinary movement records the turn without charging when news №22 is inactive", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest);
  await addOddFiveTeamComposition(session);
  assert.equal(
    (await dispatch({
      ...session,
      actionId: "session.setup.finalize"
    })).result.ok,
    true
  );
  await placeAllAssets(session);
  const prepared = await prepareMovement(session);
  const locomotiveId = prepared.state.public.movement.currentLocomotiveId;
  const ownerTeamId =
    prepared.state.public.objects.locomotives[locomotiveId].attributes.ownerTeamId;
  const startingCoins =
    prepared.state.public.objects.teams[ownerTeamId].attributes.coins;
  const edgeId = incidentOpenEdgeId(prepared.state, locomotiveId);

  const moved = await dispatch({
    ...session,
    actionId: "movement.locomotive.traverse",
    params: { edgeId }
  });
  assert.equal(moved.result.ok, true);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(
    after.state.public.objects.teams[ownerTeamId].attributes.coins,
    startingCoins
  );
  assert.equal(
    after.state.public.objects.locomotives[locomotiveId]
      .attributes.lastMovedTurn,
    after.state.public.session.turnNumber
  );
  assert.equal(
    after.state.public.log.some(
      (event) => event.eventType === "news.locomotive.levy.paid"
    ),
    false
  );
});

