/**
 * Unit tests for game-owned visual transition derivation.
 *
 * These tests intentionally avoid Phaser and runtime internals. They prove
 * that confirmed public board snapshots are compared deterministically and
 * that ambiguous topology never produces a fabricated movement path.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  BoardEdgeView,
  BoardNodeView,
  BoardProjection,
  BoardVehicleView,
  TeamSummaryView
} from "./board-state.ts";
import { deriveBoardTransitions } from "./board-transition.ts";

const node = (
  id: string,
  visualState = "open",
  x = 0,
  y = 0
): BoardNodeView => ({
  id,
  label: id,
  objectType: "transport.terminal",
  position: { x, y },
  visualState,
  countryId: null
});

const edge = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
  points: BoardEdgeView["points"],
  visualState = "open"
): BoardEdgeView => ({
  id,
  fromNodeId,
  toNodeId,
  points,
  from: points[0] ?? { x: 0, y: 0 },
  to: points.at(-1) ?? { x: 0, y: 0 },
  visualState
});

const vehicle = (
  id: string,
  nodeId: string | null,
  kind: BoardVehicleView["kind"] = "locomotive",
  relations: Pick<BoardVehicleView, "attachedVehicleId" | "cargoId"> = {}
): BoardVehicleView => ({
  id,
  kind,
  nodeId,
  ownerTeamId: "team-a",
  ...relations
});

const team = (id: string, coins: number | null): TeamSummaryView => ({
  id,
  label: id,
  type: "logistics_company",
  coins
});

const projection = (
  overrides: Partial<BoardProjection> = {}
): BoardProjection => ({
  nodes: [],
  edges: [],
  vehicles: [],
  teams: [],
  highlights: [],
  availableActions: [],
  bounds: null,
  phase: "movement",
  turnNumber: 1,
  locomotiveOrder: [],
  currentLocomotiveId: null,
  ...overrides
});

test("does not replay animations for the initial confirmed snapshot", () => {
  const initial = projection({
    nodes: [node("a")],
    edges: [edge("a-b", "a", "b", [{ x: 0, y: 0 }, { x: 10, y: 0 }])],
    vehicles: [vehicle("loco", "a")],
    teams: [team("team-a", 10)]
  });

  assert.deepEqual(deriveBoardTransitions(null, initial), []);
});

test("returns the unique road polyline in forward and reverse directions", () => {
  const roadPoints = [
    { x: 0, y: 0 },
    { x: 5, y: 2 },
    { x: 10, y: 0 }
  ] as const;
  const board = {
    nodes: [node("a", "open", 0, 0), node("b", "open", 10, 0)],
    edges: [edge("road", "a", "b", roadPoints)]
  };

  const forward = deriveBoardTransitions(
    projection({ ...board, vehicles: [vehicle("loco", "a")] }),
    projection({ ...board, vehicles: [vehicle("loco", "b")] })
  );
  const reverse = deriveBoardTransitions(
    projection({ ...board, vehicles: [vehicle("loco", "b")] }),
    projection({ ...board, vehicles: [vehicle("loco", "a")] })
  );

  assert.deepEqual(forward, [{
    kind: "vehicle-moved",
    vehicleId: "loco",
    fromNodeId: "a",
    toNodeId: "b",
    path: roadPoints
  }]);
  assert.deepEqual(reverse, [{
    kind: "vehicle-moved",
    vehicleId: "loco",
    fromNodeId: "b",
    toNodeId: "a",
    path: [...roadPoints].reverse()
  }]);
});

test("returns no path when parallel roads make the movement ambiguous", () => {
  const nodes = [node("a"), node("b")];
  const edges = [
    edge("north", "a", "b", [{ x: 0, y: 0 }, { x: 5, y: -2 }, { x: 10, y: 0 }]),
    edge("south", "a", "b", [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }])
  ];

  assert.deepEqual(
    deriveBoardTransitions(
      projection({ nodes, edges, vehicles: [vehicle("loco", "a")] }),
      projection({ nodes, edges, vehicles: [vehicle("loco", "b")] })
    ),
    [{
      kind: "vehicle-moved",
      vehicleId: "loco",
      fromNodeId: "a",
      toNodeId: "b",
      path: null
    }]
  );
});

test("reports additions, visual-state changes, removals, and coin deltas", () => {
  const existingNode = node("existing-node", "open");
  const existingEdge = edge(
    "existing-edge",
    "existing-node",
    "new-node",
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    "building"
  );
  const before = projection({
    nodes: [existingNode],
    edges: [existingEdge],
    vehicles: [vehicle("removed-vehicle", "existing-node")],
    teams: [team("team-b", 10), team("team-a", 7), team("unknown", null)]
  });
  const addedNode = node("new-node", "open", 10, 0);
  const addedEdge = edge(
    "new-edge",
    "existing-node",
    "new-node",
    [{ x: 0, y: 0 }, { x: 10, y: 0 }]
  );
  const after = projection({
    nodes: [node("existing-node", "blocked"), addedNode],
    edges: [
      edge(
        "existing-edge",
        "existing-node",
        "new-node",
        [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        "open"
      ),
      addedEdge
    ],
    vehicles: [vehicle("added-vehicle", "new-node", "wagon")],
    teams: [team("team-a", 4), team("team-b", 12), team("unknown", 5)]
  });

  assert.deepEqual(deriveBoardTransitions(before, after), [
    { kind: "edge-added", edgeId: "new-edge", edge: addedEdge },
    {
      kind: "edge-visual-state-changed",
      edgeId: "existing-edge",
      fromVisualState: "building",
      toVisualState: "open"
    },
    { kind: "node-added", nodeId: "new-node", node: addedNode },
    {
      kind: "node-visual-state-changed",
      nodeId: "existing-node",
      fromVisualState: "open",
      toVisualState: "blocked"
    },
    {
      kind: "team-coins-changed",
      teamId: "team-a",
      fromCoins: 7,
      toCoins: 4,
      delta: -3
    },
    {
      kind: "team-coins-changed",
      teamId: "team-b",
      fromCoins: 10,
      toCoins: 12,
      delta: 2
    },
    {
      kind: "vehicle-added",
      vehicleId: "added-vehicle",
      vehicle: after.vehicles[0]
    },
    {
      kind: "vehicle-removed",
      vehicleId: "removed-vehicle",
      vehicle: before.vehicles[0]
    }
  ]);
});

test("emits no false events for unchanged entities or unrelated board metadata", () => {
  const shared = {
    nodes: [node("a"), node("b")],
    edges: [edge("road", "a", "b", [{ x: 0, y: 0 }, { x: 10, y: 0 }])],
    vehicles: [vehicle("loco", "a")],
    teams: [team("team-a", 10)]
  };
  const before = projection({
    ...shared,
    phase: "movement",
    turnNumber: 2,
    highlights: [{
      id: "before-highlight",
      targetType: "node",
      targetId: "a",
      actionId: null,
      params: {}
    }]
  });
  const after = projection({
    ...shared,
    phase: "construction",
    turnNumber: 3,
    highlights: []
  });

  assert.deepEqual(deriveBoardTransitions(before, after), []);
});

test("reports confirmed attachment and cargo relation changes", () => {
  const before = projection({
    vehicles: [vehicle("wagon", "a", "wagon")]
  });
  const loadedAndAttached = projection({
    vehicles: [vehicle("wagon", "a", "wagon", {
      attachedVehicleId: "locomotive",
      cargoId: "cargo-a-b"
    })]
  });

  assert.deepEqual(deriveBoardTransitions(before, loadedAndAttached), [
    {
      kind: "vehicle-attachment-changed",
      vehicleId: "wagon",
      fromVehicleId: null,
      toVehicleId: "locomotive"
    },
    {
      kind: "vehicle-cargo-changed",
      vehicleId: "wagon",
      fromCargoId: null,
      toCargoId: "cargo-a-b"
    }
  ]);
  assert.deepEqual(deriveBoardTransitions(loadedAndAttached, before), [
    {
      kind: "vehicle-attachment-changed",
      vehicleId: "wagon",
      fromVehicleId: "locomotive",
      toVehicleId: null
    },
    {
      kind: "vehicle-cargo-changed",
      vehicleId: "wagon",
      fromCargoId: "cargo-a-b",
      toCargoId: null
    }
  ]);
});

test("keeps delivery, detach and payout as confirmed visual transition facts", () => {
  const before = projection({
    vehicles: [vehicle("wagon", "destination", "wagon", {
      attachedVehicleId: "locomotive",
      cargoId: "cargo-a-b"
    })],
    teams: [team("carrier", 10)]
  });
  const settled = projection({
    vehicles: [vehicle("wagon", "destination", "wagon")],
    teams: [team("carrier", 27)]
  });

  assert.deepEqual(deriveBoardTransitions(before, settled), [
    {
      kind: "team-coins-changed",
      teamId: "carrier",
      fromCoins: 10,
      toCoins: 27,
      delta: 17
    },
    {
      kind: "vehicle-attachment-changed",
      vehicleId: "wagon",
      fromVehicleId: "locomotive",
      toVehicleId: null
    },
    {
      kind: "vehicle-cargo-changed",
      vehicleId: "wagon",
      fromCargoId: "cargo-a-b",
      toCargoId: null
    }
  ]);
});

test("reports a newly confirmed news card but not initial-page history", () => {
  const before = projection({ currentNewsId: null });
  const after = projection({ currentNewsId: "news-24" });

  assert.deepEqual(deriveBoardTransitions(before, after), [{
    kind: "news-changed",
    fromNewsId: null,
    toNewsId: "news-24"
  }]);
  assert.deepEqual(deriveBoardTransitions(null, after), []);
});
