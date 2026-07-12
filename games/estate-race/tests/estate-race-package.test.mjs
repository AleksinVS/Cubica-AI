/**
 * End-to-end runtime proof for the first Estate Race gameplay slice.
 *
 * The replay uses a fixed runtime seed. No test-only game branch exists: the
 * same manifest actions, participant guards, reference validation and transfer
 * handler are used by the player UI.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import {
  getPublishedPlayerWebPluginBundleSource,
  loadPlayerFacingContent
} from "../../../services/runtime-api/src/modules/content/contentService.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import { initializeTurnBasedSessionState } from "../../../services/runtime-api/src/modules/session/turnBasedSessionState.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const replaySeed = "00000000000000000000000000000001";

const loadManifest = async () => validateGameManifest(
  JSON.parse(await readFile(path.join(packageRoot, "game.manifest.json"), "utf8"))
);

const createReplay = async (overrides = {}) => {
  const manifest = await loadManifest();
  const initialState = initializeTurnBasedSessionState(manifest, structuredClone(manifest.state), {
    participantCount: 2,
    randomSeed: replaySeed
  });
  Object.assign(initialState, overrides);
  const store = new InMemorySessionStore();
  const session = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "player",
    initialState
  });
  return { manifest, store, session, bundle: { gameId: manifest.meta.id, manifest } };
};

const act = (replay, playerId, actionId, params) => dispatchRuntimeAction({
  sessionStore: replay.store,
  bundle: replay.bundle,
  input: {
    sessionId: replay.session.sessionId,
    playerId,
    actionId,
    ...(params ? { params } : {})
  }
});

test("fixed replay completes first purchase and first rent", async () => {
  const replay = await createReplay();

  await act(replay, "p1", "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 1]);
  assert.equal(current.state.players.p1.metrics.position, 2);
  assert.equal(current.state.public.turn.phase, "acquire");

  await act(replay, "p1", "property.buy.cell-02", { cellId: "cell-02" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 780);
  assert.equal(current.state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId, "p1");

  await act(replay, "p1", "turn.finish");
  await act(replay, "p2", "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 1]);
  assert.equal(current.state.players.p2.metrics.position, 2);
  assert.equal(current.state.public.turn.phase, "rent");

  await act(replay, "p2", "property.rent.cell-02", { cellId: "cell-02" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 798);
  assert.equal(current.state.players.p2.metrics.cash, 882);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.ok(current.state.public.log.some((entry) => entry.kind === "purchase"));
  assert.ok(current.state.public.log.some((entry) => entry.kind === "rent"));
});

test("inactive actor and insufficient purchase leave state and version unchanged", async () => {
  const inactiveReplay = await createReplay();
  const inactiveBefore = await inactiveReplay.store.getSession(inactiveReplay.session.sessionId);
  await assert.rejects(act(inactiveReplay, "p2", "turn.roll"), /actor active expected true/);
  const inactiveAfter = await inactiveReplay.store.getSession(inactiveReplay.session.sessionId);
  assert.deepEqual(inactiveAfter.state, inactiveBefore.state);
  assert.equal(inactiveAfter.version.stateVersion, inactiveBefore.version.stateVersion);

  const poorReplay = await createReplay();
  let poor = await poorReplay.store.getSession(poorReplay.session.sessionId);
  poor.state.players.p1.metrics.cash = 100;
  await act(poorReplay, "p1", "turn.roll");
  const beforeBuy = structuredClone(await poorReplay.store.getSession(poorReplay.session.sessionId));
  await assert.rejects(
    act(poorReplay, "p1", "property.buy.cell-02", { cellId: "cell-02" }),
    /cannot make a source balance negative/
  );
  const afterBuy = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.deepEqual(afterBuy.state, beforeBuy.state);
  assert.equal(afterBuy.version.stateVersion, beforeBuy.version.stateVersion);
});

test("player-facing repository publishes the web screen and immutable field plugin", async () => {
  const { content } = await loadPlayerFacingContent({ gameId: "estate-race" });
  assert.equal(content.ui.id, "estate-race.ui.web");
  assert.equal(content.ui.entryPoint, "table");
  assert.equal(content.pluginBundles.length, 1);
  const plugin = content.pluginBundles[0];
  assert.equal(plugin.pluginId, "estate-race-player");

  const source = await getPublishedPlayerWebPluginBundleSource({
    gameId: plugin.gameId,
    pluginId: plugin.pluginId,
    contentHash: plugin.contentHash
  });
  assert.match(source, /estate-race/);
  assert.doesNotMatch(source, /state\.secret/u);
});
