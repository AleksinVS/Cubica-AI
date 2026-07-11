/** Neutral proof of participant-aware turn effects without concrete game rules. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";

import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";

const manifest = validateGameManifest({
  meta: {
    id: "neutral-turn-effects",
    version: "1.0.0",
    name: "Neutral turn effects",
    description: "Cross-game contract fixture.",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 2, max: 2 },
    settings: { mode: "hotseat", locale: "en-US" },
    turnModel: { phases: ["roll", "resolve"] }
  },
  state: {
    public: { log: [] },
    secret: {},
    playersTemplate: { metrics: { position: 0, score: 10 } }
  },
  actions: {
    roll: {
      handlerType: "manifest-data",
      deterministic: {
        guard: { turn: { actorIsActive: true, phase: "roll" } },
        effects: [
          { op: "random.roll", dice: "2d6", storePath: "/public/turn/lastRoll" },
          {
            op: "metric.set",
            scope: "player",
            playerId: "{{actor}}",
            metricId: "position",
            value: { "%": [{ "+": [{ var: "actor.metrics.position" }, { var: "public.turn.lastRoll.total" }] }, 12] }
          },
          {
            op: "metric.add",
            scope: "player",
            playerId: "{{actor}}",
            metricId: "score",
            delta: 1,
            when: { jsonLogic: { ">": [{ var: "public.turn.lastRoll.total" }, 0] } }
          },
          { op: "turn.phase.set", phase: "resolve" }
        ]
      }
    },
    next: {
      handlerType: "manifest-data",
      deterministic: {
        guard: { turn: { actorIsActive: true, phase: "resolve" } },
        effects: [{ op: "turn.next" }]
      }
    }
  }
});

const baseState = () => ({
  public: {
    turn: { order: ["p1", "p2"], activePlayerId: "p1", phase: "roll", turnNumber: 1 },
    log: []
  },
  players: {
    p1: { metrics: { position: 0, score: 10 }, flags: {}, objects: {}, status: "active" },
    p2: { metrics: { position: 0, score: 10 }, flags: {}, objects: {}, status: "active" }
  },
  secret: {
    random: { alg: "xoshiro128ss-v1", seed: "0123456789abcdeffedcba9876543210", counter: 0 }
  }
});

const contextFor = (
  actionId: "roll" | "next",
  state: ReturnType<typeof baseState>,
  actorPlayerId: string
): RuntimeActionContext<ReturnType<typeof baseState>> => ({
  sessionId: "session-1",
  gameId: manifest.meta.id,
  actionId,
  actorPlayerId,
  state,
  now: new Date("2026-07-11T12:00:00.000Z"),
  manifestAction: {
    actionId,
    handlerType: "manifest-data",
    raw: manifest.actions[actionId] as unknown as Record<string, unknown>
  }
});

test("random roll, participant metric expressions and turn progression compose deterministically", async () => {
  const handler = createDeterministicHandler("game.turn", {
    mode: "manifest-action",
    turnPhases: manifest.config.turnModel?.phases
  });

  const rolled = await handler(contextFor("roll", baseState(), "p1"));
  assert.equal(rolled.ok, true, rolled.error?.message);
  const afterRoll = rolled.delta?.state as any;
  assert.deepEqual(afterRoll.public.turn.lastRoll, { values: [3, 6], total: 9, isDouble: false });
  assert.equal(afterRoll.players.p1.metrics.position, 9);
  assert.equal(afterRoll.players.p1.metrics.score, 11);
  assert.equal(afterRoll.players.p2.metrics.score, 10);
  assert.equal(afterRoll.public.turn.phase, "resolve");
  assert.equal(afterRoll.secret.random.counter, 2);
  assert.equal(afterRoll.public.log[0].kind, "random.roll");

  const advanced = await handler(contextFor("next", afterRoll, "p1"));
  assert.equal(advanced.ok, true, advanced.error?.message);
  const afterNext = advanced.delta?.state as any;
  assert.deepEqual(afterNext.public.turn, {
    order: ["p1", "p2"],
    activePlayerId: "p2",
    phase: "roll",
    turnNumber: 2,
    lastRoll: { values: [3, 6], total: 9, isDouble: false }
  });
});

test("a non-active participant is rejected without mutating the input state", async () => {
  const handler = createDeterministicHandler("game.turn", {
    mode: "manifest-action",
    turnPhases: manifest.config.turnModel?.phases
  });
  const state = baseState();
  const before = structuredClone(state);
  const result = await handler(contextFor("roll", state, "p2"));

  assert.equal(result.ok, false);
  assert.match(result.error?.message ?? "", /turn actor active/u);
  assert.deepEqual(state, before);
});
