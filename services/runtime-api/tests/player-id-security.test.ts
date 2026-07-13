/**
 * Verifies that public runtime requests cannot use JavaScript prototype names
 * as player identifiers while ordinary product-defined identifiers still work.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseAgentTurnRequest,
  parseCreateSessionRequest,
  parseDispatchActionRequest
} from "../src/modules/player-api/requestValidation.ts";

const reservedPropertyNames = ["__proto__", "constructor", "prototype"] as const;

test("all player-facing write requests reject reserved object property names", () => {
  for (const playerId of reservedPropertyNames) {
    assert.throws(
      () => parseCreateSessionRequest({ gameId: "neutral-game", playerId }),
      /playerId uses forbidden property name/u
    );
    assert.throws(
      () => parseDispatchActionRequest({
        sessionId: "session-1",
        expectedStateVersion: 0,
        actionId: "advance",
        playerId
      }),
      /playerId uses forbidden property name/u
    );
    assert.throws(
      () => parseAgentTurnRequest({ sessionId: "session-1", playerId }),
      /playerId uses forbidden property name/u
    );
  }
});

test("ordinary player identifiers remain valid across public write requests", () => {
  const playerId = "participant-1";

  assert.equal(parseCreateSessionRequest({ gameId: "neutral-game", playerId }).playerId, playerId);
  assert.equal(parseDispatchActionRequest({
    sessionId: "session-1",
    expectedStateVersion: 0,
    actionId: "advance",
    playerId
  }).playerId, playerId);
  assert.equal(parseAgentTurnRequest({ sessionId: "session-1", playerId }).playerId, playerId);
});
