/** Focused tests for mock map-to-form locomotive movement drafts. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCOMOTIVE_MOVE_ACTION_ID,
  selectMovementDraftEdge,
  selectMovementDraftVehicle
} from "./movement-selection.ts";

test("selects a locomotive first and clears a road chosen for another locomotive", () => {
  const first = selectMovementDraftVehicle(null, "locomotive-a");
  const withRoad = selectMovementDraftEdge(first, "edge-a");
  const switched = selectMovementDraftVehicle(withRoad, "locomotive-b");

  assert.deepEqual(withRoad, {
    actionId: LOCOMOTIVE_MOVE_ACTION_ID,
    params: { vehicleId: "locomotive-a", edgeId: "edge-a" }
  });
  assert.deepEqual(switched, {
    actionId: LOCOMOTIVE_MOVE_ACTION_ID,
    params: { vehicleId: "locomotive-b", edgeId: null }
  });
});

test("does not create an edge-only movement draft and toggles a selected locomotive off", () => {
  assert.equal(selectMovementDraftEdge(null, "edge-a"), null);

  const selected = selectMovementDraftVehicle({
    actionId: LOCOMOTIVE_MOVE_ACTION_ID,
    params: { vehicleId: "locomotive-a", edgeId: "edge-a" }
  }, "locomotive-a");

  assert.deepEqual(selected, {
    actionId: LOCOMOTIVE_MOVE_ACTION_ID,
    params: { vehicleId: null, edgeId: null }
  });
});
