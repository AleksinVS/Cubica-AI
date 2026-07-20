/** Focused tests for game-local movement input shaping. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MOVEMENT_TRAVERSE_ACTION_ID,
  movementTraverseParams
} from "./movement-selection.ts";

test("dispatches only the selected public edge reference", () => {
  assert.equal(MOVEMENT_TRAVERSE_ACTION_ID, "movement.locomotive.traverse");
  assert.deepEqual(movementTraverseParams("road-east-west"), {
    edgeId: "road-east-west"
  });
});
