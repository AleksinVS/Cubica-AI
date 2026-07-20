/**
 * Runtime proof for the confirmed scalar effects of CMT news cards.
 *
 * Every effect is executed through the production dispatcher. Test-only state
 * preparation merely chooses the next deterministic news card and advances the
 * phase; it does not bypass the action guard or execute a plan directly.
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

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const credentialSha256 = "e".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

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
      principalId: "news-scalar-effects-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

const dispatch = async ({ store, sessionId, actionId }) => {
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
      params: {}
    }
  });
};

/**
 * Change only test scenario facts while preserving the session store's normal
 * optimistic version contract.
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

const initialize = async (manifest) => {
  const session = await createSession(manifest);
  const initialized = await dispatch({
    ...session,
    actionId: "cards.lifecycle.initialize"
  });
  assert.equal(initialized.result.ok, true);
  return session;
};

const allDeckMembers = (deck) => [...deck.order, ...deck.discard, ...deck.held];

/**
 * Select the next card deterministically, then use the real draw action.
 *
 * This helper also exercises the production reset at the start of every later
 * news phase; callers can inspect the returned state before applying the card.
 */
const drawNews = async (session, newsNumber, turnNumber) => {
  const newsId = `news-${String(newsNumber).padStart(2, "0")}`;
  await updateScenario(session, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = turnNumber;
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
  assert.equal(
    current.state.public.objects.newsCards[newsId].facets.availability,
    "current"
  );
  return current;
};

const applyNews = async (session, newsNumber) =>
  dispatch({
    ...session,
    actionId: `news.effect.apply.${String(newsNumber).padStart(2, "0")}`
  });

const enterStagnation = async (session, turnNumber) => {
  await updateScenario(session, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = turnNumber;
    state.public.news.currentCardId = null;
    state.public.news.remaining = 0;
    const deck = state.secret.decks.news;
    deck.discard = allDeckMembers(deck);
    deck.order = [];
    deck.held = [];
  });
  return dispatch({
    ...session,
    actionId: "news.lifecycle.stagnation"
  });
};

test("payout modifiers resolve the exact one-shot card and reset next turn", async () => {
  const manifest = await loadManifest();
  const session = await initialize(manifest);

  await drawNews(session, 23, 2);
  const beforeWrongCard = await session.store.getSession(session.sessionId);
  const wrongCard = await applyNews(session, 24);
  assert.equal(wrongCard.result.ok, false);
  assert.deepEqual(
    (await session.store.getSession(session.sessionId)).state,
    beforeWrongCard.state
  );

  const reduced = await applyNews(session, 23);
  assert.equal(reduced.result.ok, true);
  const afterReduced = await session.store.getSession(session.sessionId);
  assert.equal(afterReduced.state.public.turnEffects.deliveryPayoutBonus, -2);
  assert.equal(afterReduced.state.public.news.currentCardId, null);
  assert.equal(afterReduced.state.public.news.status, "resolved");
  assert.equal(afterReduced.state.public.session.phase, "maintenance");
  assert.equal(
    afterReduced.state.public.objects.newsCards["news-23"].facets.availability,
    "resolved"
  );

  const duplicate = await applyNews(session, 23);
  assert.equal(duplicate.result.ok, false);
  assert.deepEqual(
    (await session.store.getSession(session.sessionId)).state,
    afterReduced.state
  );

  const nextDraw = await drawNews(session, 24, 3);
  assert.equal(nextDraw.state.public.turnEffects.deliveryPayoutBonus, 0);
  const increased = await applyNews(session, 24);
  assert.equal(increased.result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .deliveryPayoutBonus,
    3
  );

  const stagnation = await enterStagnation(session, 4);
  assert.equal(stagnation.result.ok, true);
  const afterStagnation = await session.store.getSession(session.sessionId);
  assert.equal(afterStagnation.state.public.turnEffects.deliveryPayoutBonus, 0);
});

test("maintenance, purchase permissions and temporary prices reset independently", async () => {
  const manifest = await loadManifest();
  const session = await initialize(manifest);

  await drawNews(session, 25, 2);
  assert.equal((await applyNews(session, 25)).result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .vehicleAndCargoMaintenanceExempt,
    true
  );

  const beforeWagonBan = await drawNews(session, 30, 3);
  assert.equal(
    beforeWagonBan.state.public.turnEffects.vehicleAndCargoMaintenanceExempt,
    false
  );
  assert.equal((await applyNews(session, 30)).result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .purchasePermissions.wagon,
    false
  );

  const beforeLocomotiveBan = await drawNews(session, 31, 4);
  assert.deepEqual(beforeLocomotiveBan.state.public.turnEffects.purchasePermissions, {
    wagon: true,
    locomotive: true
  });
  assert.equal((await applyNews(session, 31)).result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .purchasePermissions.locomotive,
    false
  );

  const beforeWagonDiscount = await drawNews(session, 32, 5);
  assert.deepEqual(beforeWagonDiscount.state.public.turnEffects.purchasePermissions, {
    wagon: true,
    locomotive: true
  });
  assert.equal((await applyNews(session, 32)).result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .purchasePriceOverrides.wagon,
    4
  );

  const beforeLocomotiveDiscount = await drawNews(session, 33, 6);
  assert.equal(
    beforeLocomotiveDiscount.state.public.turnEffects.purchasePriceOverrides.wagon,
    null
  );
  assert.equal((await applyNews(session, 33)).result.ok, true);
  assert.equal(
    (await session.store.getSession(session.sessionId)).state.public.turnEffects
      .purchasePriceOverrides.locomotive,
    8
  );

  assert.equal((await enterStagnation(session, 7)).result.ok, true);
  const reset = await session.store.getSession(session.sessionId);
  assert.deepEqual(reset.state.public.turnEffects.purchasePriceOverrides, {
    wagon: null,
    locomotive: null
  });
});

test("news 34 base prices survive temporary news 32 and 33 in both orders", async () => {
  const manifest = await loadManifest();
  const session = await initialize(manifest);

  assert.deepEqual(manifest.state.public.market.basePurchasePrices, {
    wagon: 5,
    locomotive: 10
  });

  await drawNews(session, 34, 2);
  assert.equal((await applyNews(session, 34)).result.ok, true);
  let current = await session.store.getSession(session.sessionId);
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });

  current = await drawNews(session, 32, 3);
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });
  assert.equal((await applyNews(session, 32)).result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.equal(current.state.public.turnEffects.purchasePriceOverrides.wagon, 4);
  assert.equal(current.state.public.turnEffects.purchasePriceOverrides.locomotive, null);

  current = await drawNews(session, 33, 4);
  assert.equal(current.state.public.turnEffects.purchasePriceOverrides.wagon, null);
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });
  assert.equal((await applyNews(session, 33)).result.ok, true);

  assert.equal((await enterStagnation(session, 5)).result.ok, true);
  current = await session.store.getSession(session.sessionId);
  assert.deepEqual(current.state.public.turnEffects.purchasePriceOverrides, {
    wagon: null,
    locomotive: null
  });
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });

  const reverseSession = await initialize(manifest);
  await drawNews(reverseSession, 32, 2);
  assert.equal((await applyNews(reverseSession, 32)).result.ok, true);
  current = await reverseSession.store.getSession(reverseSession.sessionId);
  assert.equal(current.state.public.turnEffects.purchasePriceOverrides.wagon, 4);
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 5,
    locomotive: 10
  });

  current = await drawNews(reverseSession, 34, 3);
  assert.deepEqual(current.state.public.turnEffects.purchasePriceOverrides, {
    wagon: null,
    locomotive: null
  });
  assert.equal((await applyNews(reverseSession, 34)).result.ok, true);

  current = await drawNews(reverseSession, 33, 4);
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });
  assert.equal((await applyNews(reverseSession, 33)).result.ok, true);
  assert.equal((await enterStagnation(reverseSession, 5)).result.ok, true);
  current = await reverseSession.store.getSession(reverseSession.sessionId);
  assert.deepEqual(current.state.public.turnEffects.purchasePriceOverrides, {
    wagon: null,
    locomotive: null
  });
  assert.deepEqual(current.state.public.market.basePurchasePrices, {
    wagon: 6,
    locomotive: 12
  });
});
