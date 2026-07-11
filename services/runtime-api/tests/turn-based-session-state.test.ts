/** Tests for manifest-template expansion into authoritative session state. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameManifest } from "@cubica/contracts-manifest";

import { initializeTurnBasedSessionState } from "../src/modules/session/turnBasedSessionState.ts";

const createManifest = (): GameManifest => ({
  meta: {
    id: "neutral-turn-fixture",
    version: "1.0.0",
    name: "Neutral turn fixture",
    description: "Contract fixture without concrete game rules.",
    schemaVersion: "2.0.0"
  },
  config: {
    players: { min: 2, max: 2 },
    settings: { mode: "hotseat", locale: "en" },
    turnModel: { phases: ["roll", "resolve"] }
  },
  state: {
    public: { log: [] },
    secret: {},
    playersTemplate: {
      metrics: { score: 10, position: 0 },
      flags: { ready: false },
      status: "active",
      visibility: { metrics: "public", flags: "private" }
    }
  },
  actions: {
    "turn.roll": {
      handlerType: "manifest-data",
      deterministic: {
        effects: [{ op: "random.roll", dice: "2d6", storePath: "/public/turn/lastRoll" }]
      }
    }
  }
});

const declaredState = (manifest: GameManifest): Record<string, unknown> =>
  structuredClone(manifest.state) as unknown as Record<string, unknown>;

test("participant template expands into isolated p1..pN state and an initial turn", () => {
  const manifest = createManifest();
  const state = initializeTurnBasedSessionState(
    manifest,
    declaredState(manifest),
    { randomSeed: "0123456789abcdeffedcba9876543210" }
  );

  assert.equal("playersTemplate" in state, false);
  assert.deepEqual(state.players, {
    p1: { metrics: { score: 10, position: 0 }, flags: { ready: false }, objects: {}, status: "active" },
    p2: { metrics: { score: 10, position: 0 }, flags: { ready: false }, objects: {}, status: "active" }
  });
  assert.deepEqual((state.public as Record<string, unknown>).turn, {
    order: ["p1", "p2"],
    activePlayerId: "p1",
    phase: "roll",
    turnNumber: 1
  });
  assert.deepEqual((state.secret as Record<string, unknown>).random, {
    alg: "xoshiro128ss-v1",
    seed: "0123456789abcdeffedcba9876543210",
    counter: 0
  });

  const players = state.players as Record<string, Record<string, any>>;
  players.p1.metrics.score = 1;
  assert.equal(players.p2.metrics.score, 10, "participant objects must not share nested references");
});

test("participant count outside manifest bounds is rejected", () => {
  const manifest = createManifest();
  assert.throws(
    () => initializeTurnBasedSessionState(manifest, declaredState(manifest), { participantCount: 3 }),
    /outside manifest bounds/u
  );
});
