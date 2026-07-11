/** Security regression tests for player-facing session snapshots. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { projectPlayerSessionState } from "../src/modules/session/playerSessionProjection.ts";

test("player projection removes random and deck secrets without mutating stored state", () => {
  const stored = {
    public: { turn: { activePlayerId: "p1" } },
    secret: {
      random: { alg: "xoshiro128ss-v1", seed: "0123456789abcdeffedcba9876543210", counter: 2 },
      decks: { events: { order: ["a", "b"], discard: [] } },
      legacyOpening: { selectedId: "visible-until-migration" }
    }
  };

  const projected = projectPlayerSessionState(stored);
  assert.deepEqual(projected, {
    public: { turn: { activePlayerId: "p1" } },
    secret: { legacyOpening: { selectedId: "visible-until-migration" } }
  });
  assert.equal(stored.secret.random.seed, "0123456789abcdeffedcba9876543210");
  assert.deepEqual(stored.secret.decks.events.order, ["a", "b"]);
});

test("an empty secret branch is omitted from the player snapshot", () => {
  const projected = projectPlayerSessionState({
    public: {},
    secret: { random: { alg: "xoshiro128ss-v1", seed: "0".repeat(32), counter: 0 } }
  });
  assert.equal("secret" in projected, false);
});
