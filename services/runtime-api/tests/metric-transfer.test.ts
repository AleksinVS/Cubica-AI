/**
 * Neutral contract proof for cross-scope economic transfers.
 *
 * The fixture deliberately avoids concrete game names and rules. It proves the
 * reusable platform primitive with bank, participant and shared-state balances.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";

import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";

const manifestInput = {
  meta: {
    id: "neutral-economic-transfer",
    version: "1.0.0",
    name: "Neutral economic transfer",
    description: "Cross-game economic contract fixture.",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 2, max: 2 },
    settings: { mode: "hotseat", locale: "en-US" }
  },
  state: {
    public: { ownerPlayerId: "p1", balances: { shared: 10 }, log: [] },
    secret: { balances: { reserve: 0 } },
    playersTemplate: { metrics: { cash: 100 } }
  },
  actions: {
    award: {
      handlerType: "manifest-data",
      deterministic: {
        effects: [{
          op: "metric.transfer",
          from: { scope: "bank" },
          to: { scope: "player", playerId: "{{actor}}", metricId: "cash" },
          amount: 25,
          onInsufficient: "fail"
        }]
      }
    },
    payOwner: {
      handlerType: "manifest-data",
      deterministic: {
        effects: [{
          op: "metric.transfer",
          from: { scope: "player", playerId: "{{actor}}", metricId: "cash" },
          to: {
            scope: "player",
            playerId: { fromPath: "/public/ownerPlayerId" },
            metricId: "cash"
          },
          amount: 30,
          onInsufficient: "fail"
        }]
      }
    },
    moveReserve: {
      handlerType: "manifest-data",
      deterministic: {
        effects: [{
          op: "metric.transfer",
          from: { scope: "state", path: "/public/balances/shared" },
          to: { scope: "state", path: "/secret/balances/reserve" },
          amount: 4,
          onInsufficient: "fail"
        }]
      }
    },
    atomicFailure: {
      handlerType: "manifest-data",
      deterministic: {
        effects: [
          {
            op: "metric.transfer",
            from: { scope: "bank" },
            to: { scope: "player", playerId: "p1", metricId: "cash" },
            amount: 10,
            onInsufficient: "fail"
          },
          {
            op: "metric.transfer",
            from: { scope: "player", playerId: "p2", metricId: "cash" },
            to: { scope: "player", playerId: "p1", metricId: "cash" },
            amount: 999,
            onInsufficient: "fail"
          }
        ]
      }
    }
  }
} as const;

const manifest = validateGameManifest(manifestInput);

const initialState = () => ({
  public: { ownerPlayerId: "p1", balances: { shared: 10 }, log: [] },
  secret: { balances: { reserve: 0 } },
  players: {
    p1: { metrics: { cash: 100 }, flags: {}, objects: {}, status: "active" },
    p2: { metrics: { cash: 70 }, flags: {}, objects: {}, status: "active" }
  }
});

type ActionId = keyof typeof manifestInput.actions;

const contextFor = (
  actionId: ActionId,
  state: ReturnType<typeof initialState>,
  actorPlayerId: string | null = "p2"
): RuntimeActionContext<ReturnType<typeof initialState>> => ({
  sessionId: "session-1",
  gameId: manifest.meta.id,
  actionId,
  ...(actorPlayerId ? { actorPlayerId } : {}),
  state,
  now: new Date("2026-07-11T12:00:00.000Z"),
  manifestAction: {
    actionId,
    handlerType: "manifest-data",
    raw: manifest.actions[actionId] as unknown as Record<string, unknown>
  }
});

const handler = createDeterministicHandler("economy.transfer", { mode: "manifest-action" });

test("bank, participant and shared-state endpoints transfer through one contract", async () => {
  const awarded = await handler(contextFor("award", initialState()));
  assert.equal(awarded.ok, true, awarded.error?.message);
  const afterAward = awarded.delta?.state as ReturnType<typeof initialState>;
  assert.equal(afterAward.players.p2.metrics.cash, 95);

  const paid = await handler(contextFor("payOwner", afterAward));
  assert.equal(paid.ok, true, paid.error?.message);
  const afterPayment = paid.delta?.state as ReturnType<typeof initialState>;
  assert.equal(afterPayment.players.p2.metrics.cash, 65);
  assert.equal(afterPayment.players.p1.metrics.cash, 130);

  const reserved = await handler(contextFor("moveReserve", afterPayment));
  assert.equal(reserved.ok, true, reserved.error?.message);
  const afterReserve = reserved.delta?.state as ReturnType<typeof initialState>;
  assert.equal(afterReserve.public.balances.shared, 6);
  assert.equal(afterReserve.secret.balances.reserve, 4);
});

test("an underfunded later effect rolls back the complete action", async () => {
  const state = initialState();
  const before = structuredClone(state);
  const result = await handler(contextFor("atomicFailure", state));

  assert.equal(result.ok, false);
  assert.match(result.error?.message ?? "", /cannot make a source balance negative/u);
  assert.deepEqual(state, before);
  assert.equal(result.delta, undefined);
});

test("client params cannot supply a missing trusted actor", async () => {
  const state = initialState();
  const before = structuredClone(state);
  const context = contextFor("award", state, null);
  context.params = { actor: "p1" };

  const result = await handler(context);

  assert.equal(result.ok, false);
  assert.match(result.error?.message ?? "", /could not resolve a participant id/u);
  assert.deepEqual(state, before);
});

test("the removed kind and insufficientFunds transfer contract is rejected", () => {
  const legacy = structuredClone(manifestInput) as any;
  legacy.actions.award.deterministic.effects[0] = {
    op: "metric.transfer",
    from: { kind: "bank" },
    to: { kind: "state", path: "/public/balances/shared" },
    amount: 1,
    insufficientFunds: "fail"
  };
  assert.throws(() => validateGameManifest(legacy), /Schema validation failed/u);

  const legacyMarker = structuredClone(manifestInput) as any;
  legacyMarker.actions.award.deterministic.effects[0].insufficientFunds = "fail";
  assert.throws(() => validateGameManifest(legacyMarker), /Schema validation failed/u);
});

test("player tokens and shared-state paths cannot be built from client parameters", () => {
  const dynamicPlayer = structuredClone(manifestInput) as any;
  dynamicPlayer.actions.award.deterministic.effects[0].to.playerId = "{{targetPlayerId}}";
  assert.throws(() => validateGameManifest(dynamicPlayer), /Schema validation failed/u);

  const dynamicPath = structuredClone(manifestInput) as any;
  dynamicPath.actions.moveReserve.deterministic.effects[0].from.path = "/public/balances/{{source}}";
  assert.throws(() => validateGameManifest(dynamicPath), /Schema validation failed/u);
});
