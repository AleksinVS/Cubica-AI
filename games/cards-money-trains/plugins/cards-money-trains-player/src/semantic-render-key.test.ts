/** Focused tests for avoiding unnecessary semantic-network reconstruction. */

import assert from "node:assert/strict";
import test from "node:test";

import type { BoardProjection } from "./board-state.ts";
import { ROAD_BUILD_ACTION_ID } from "./construction-selection.ts";
import { MOVEMENT_TRAVERSE_ACTION_ID } from "./movement-selection.ts";
import {
  movementPresentationRenderKey,
  semanticRenderKey
} from "./semantic-render-key.ts";

const projection = (overrides: Partial<BoardProjection> = {}): BoardProjection => ({
  nodes: [{
    id: "a",
    label: "A",
    objectType: "transport.terminal",
    position: { x: 10, y: 20 },
    visualState: "open",
    countryId: null
  }],
  edges: [],
  vehicles: [],
  teams: [],
  highlights: [],
  availableActions: [],
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  phase: "movement",
  turnNumber: 1,
  locomotiveOrder: [],
  currentLocomotiveId: null,
  ...overrides
});

test("ignores vehicle, cargo, money, news and phase-only changes", () => {
  const before = projection();
  const after = projection({
    vehicles: [{
      id: "wagon",
      kind: "wagon",
      nodeId: "a",
      ownerTeamId: "team-a",
      cargoId: "cargo-a"
    }],
    cargos: [{
      id: "cargo-a",
      status: "in_transit",
      fromNodeId: "a",
      toNodeId: "b",
      payout: 10
    }],
    teams: [{ id: "team-a", label: "Team A", type: "carrier", coins: 99 }],
    phase: "construction",
    turnNumber: 2,
    currentNewsId: "news-12"
  });

  assert.equal(semanticRenderKey(before, null), semanticRenderKey(after, null));
});

test("changes when network geometry, input facts or visible selection changes", () => {
  const base = projection();
  const changedNode = projection({
    nodes: [{ ...base.nodes[0]!, position: { x: 11, y: 20 } }]
  });
  const linkedCountry = projection({
    nodes: [{ ...base.nodes[0]!, countryId: "country-central" }]
  });
  const selectable = projection({
    availableActions: [{
      id: "build-road",
      label: "Build road",
      actionId: ROAD_BUILD_ACTION_ID
    }]
  });

  assert.notEqual(semanticRenderKey(base, null), semanticRenderKey(changedNode, null));
  assert.notEqual(semanticRenderKey(base, null), semanticRenderKey(linkedCountry, null));
  assert.notEqual(semanticRenderKey(base, null), semanticRenderKey(selectable, null));
  assert.notEqual(
    semanticRenderKey(selectable, null),
    semanticRenderKey(selectable, {
      actionId: ROAD_BUILD_ACTION_ID,
      params: { fromNodeId: "a" }
    })
  );
});

test("isolates locomotive order decoration changes from the semantic network", () => {
  const first = projection({
    locomotiveOrder: ["loco-east", "loco-west"],
    currentLocomotiveId: "loco-east"
  });
  const nextCurrent = projection({
    locomotiveOrder: ["loco-east", "loco-west"],
    currentLocomotiveId: "loco-west"
  });
  const unrelatedNetworkChange = projection({
    locomotiveOrder: ["loco-east", "loco-west"],
    currentLocomotiveId: "loco-east",
    nodes: [{ ...projection().nodes[0]!, label: "Renamed station" }],
    teams: [{ id: "team", label: "Team", type: "carrier", coins: 999 }]
  });

  assert.equal(semanticRenderKey(first, null), semanticRenderKey(nextCurrent, null));
  assert.notEqual(
    movementPresentationRenderKey(first),
    movementPresentationRenderKey(nextCurrent)
  );
  assert.equal(
    movementPresentationRenderKey(first),
    movementPresentationRenderKey(unrelatedNetworkChange)
  );
});

test("changes only the network interaction key when traversal becomes available", () => {
  const unavailable = projection();
  const available = projection({
    availableActions: [{
      id: "movement-traverse",
      label: "Traverse",
      actionId: MOVEMENT_TRAVERSE_ACTION_ID
    }]
  });
  const serverDisabled = projection({
    availableActions: [{
      id: "movement-traverse",
      label: "Traverse",
      actionId: MOVEMENT_TRAVERSE_ACTION_ID,
      disabled: true
    }]
  });

  assert.notEqual(
    semanticRenderKey(unavailable, null),
    semanticRenderKey(available, null)
  );
  assert.equal(
    semanticRenderKey(unavailable, null),
    semanticRenderKey(serverDisabled, null)
  );
  assert.equal(
    movementPresentationRenderKey(unavailable),
    movementPresentationRenderKey(available)
  );
});
