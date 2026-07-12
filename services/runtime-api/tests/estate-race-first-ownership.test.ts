/**
 * Game-level replay for GSR-034: first purchase followed by first rent.
 *
 * The platform primitives have neutral contract tests elsewhere. This test
 * proves that the concrete game composes them without a game-specific runtime
 * branch and locks one deterministic seed as an executable product scenario.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { GameManifest } from "@cubica/contracts-manifest";

import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { initializeTurnBasedSessionState } from "../src/modules/session/turnBasedSessionState.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CONTROL_SEED = "00000000000000000000000000000001";

test("Estate Race replay reaches first ownership and first rent atomically", async () => {
  const raw = await readFile(path.join(repoRoot, "games/estate-race/game.manifest.json"), "utf8");
  const manifest = validateGameManifest(JSON.parse(raw)) as GameManifest;
  const bundle = { gameId: manifest.meta.id, manifest };
  const initialState = initializeTurnBasedSessionState(
    manifest,
    structuredClone(manifest.state) as unknown as Record<string, unknown>,
    { randomSeed: CONTROL_SEED }
  );
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const session = await store.createSession({
    gameId: manifest.meta.id,
    initialState,
    sessionRole: "player"
  });

  const act = async (playerId: string, actionId: string, params?: Record<string, unknown>) => {
    await dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, playerId, actionId, params }
    });
    const current = await store.getSession(session.sessionId);
    assert.ok(current);
    return current.state as any;
  };

  let state = await act("p1", "turn.roll");
  assert.deepEqual(state.public.board.lastRoll, { values: [1, 1], total: 2, isDouble: true });
  assert.equal(state.players.p1.metrics.position, 2);
  assert.equal(state.public.turn.phase, "acquire");

  state = await act("p1", "property.buy.cell-02", { cellId: "cell-02" });
  assert.equal(state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId, "p1");
  assert.equal(state.players.p1.metrics.cash, 780);

  state = await act("p1", "turn.finish");
  assert.equal(state.public.turn.activePlayerId, "p2");
  assert.equal(state.public.turn.phase, "roll");

  state = await act("p2", "turn.roll");
  assert.deepEqual(state.public.board.lastRoll, { values: [1, 1], total: 2, isDouble: true });
  assert.equal(state.players.p2.metrics.position, 2);
  assert.equal(state.public.turn.phase, "rent");

  state = await act("p2", "property.rent.cell-02", { cellId: "cell-02" });
  assert.equal(state.players.p1.metrics.cash, 798);
  assert.equal(state.players.p2.metrics.cash, 882);
  assert.equal(state.public.turn.phase, "finish");
  assert.equal(state.public.log.at(-1)?.kind, "rent");
});

test("Estate Race purchase and rent never partially apply when cash is insufficient", async () => {
  const raw = await readFile(path.join(repoRoot, "games/estate-race/game.manifest.json"), "utf8");
  const manifest = validateGameManifest(JSON.parse(raw)) as GameManifest;
  const bundle = { gameId: manifest.meta.id, manifest };

  const createControlledSession = async (mutate: (state: any) => void) => {
    const initialState = initializeTurnBasedSessionState(
      manifest,
      structuredClone(manifest.state) as unknown as Record<string, unknown>,
      { randomSeed: CONTROL_SEED }
    );
    mutate(initialState);
    const store = new InMemorySessionStore<Record<string, unknown>>();
    const session = await store.createSession({ gameId: manifest.meta.id, initialState, sessionRole: "player" });
    return { store, session };
  };

  const purchase = await createControlledSession((state) => {
    state.players.p1.metrics.position = 2;
    state.players.p1.metrics.cash = 100;
    state.public.turn.phase = "acquire";
  });
  await assert.rejects(dispatchRuntimeAction({
    sessionStore: purchase.store,
    bundle,
    input: {
      sessionId: purchase.session.sessionId,
      playerId: "p1",
      actionId: "property.buy.cell-02",
      params: { cellId: "cell-02" }
    }
  }), /negative|insufficient|balance/u);
  let snapshot = await purchase.store.getSession(purchase.session.sessionId);
  assert.equal((snapshot?.state as any).players.p1.metrics.cash, 100);
  assert.equal((snapshot?.state as any).public.objects.boardCells["cell-02"].attributes.ownerPlayerId, undefined);
  assert.equal(snapshot?.version.stateVersion, 0);

  const rent = await createControlledSession((state) => {
    state.public.turn.activePlayerId = "p2";
    state.public.turn.phase = "rent";
    state.players.p2.metrics.position = 2;
    state.players.p2.metrics.cash = 10;
    state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId = "p1";
  });
  await assert.rejects(dispatchRuntimeAction({
    sessionStore: rent.store,
    bundle,
    input: {
      sessionId: rent.session.sessionId,
      playerId: "p2",
      actionId: "property.rent.cell-02",
      params: { cellId: "cell-02" }
    }
  }), /negative|insufficient|balance/u);
  snapshot = await rent.store.getSession(rent.session.sessionId);
  assert.equal((snapshot?.state as any).players.p1.metrics.cash, 900);
  assert.equal((snapshot?.state as any).players.p2.metrics.cash, 10);
  assert.equal(snapshot?.version.stateVersion, 0);
});
