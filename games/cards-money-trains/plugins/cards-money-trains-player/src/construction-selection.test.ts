/** Focused tests for canvas-to-form construction drafts. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ROAD_BUILD_ACTION_ID,
  WAYPOINT_BUILD_ACTION_ID,
  selectRoadDraftNode,
  selectWaypointDraftPosition
} from "./construction-selection.ts";

test("selects two road endpoints without losing a contribution entered in the DOM", () => {
  const first = selectRoadDraftNode({
    actionId: ROAD_BUILD_ACTION_ID,
    params: { carriersContribution: 3 }
  }, "node-a");
  const second = selectRoadDraftNode(first, "node-b");
  const restarted = selectRoadDraftNode(second, "node-c");

  assert.deepEqual(second.params, {
    carriersContribution: 3,
    fromNodeId: "node-a",
    toNodeId: "node-b"
  });
  assert.deepEqual(restarted.params, {
    carriersContribution: 3,
    fromNodeId: "node-c",
    toNodeId: null
  });
});

test("selects an edge position without constructing or dispatching an action", () => {
  assert.deepEqual(selectWaypointDraftPosition(null, "edge-a", 0.625), {
    actionId: WAYPOINT_BUILD_ACTION_ID,
    params: { edgeId: "edge-a", positionT: 0.625 }
  });
});
