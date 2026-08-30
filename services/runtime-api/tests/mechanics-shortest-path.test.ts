/**
 * Neutral runtime proof for non-failing shortest-path results.
 *
 * The fixture contains no game-specific names or rules. It demonstrates the
 * platform distinction between a valid disconnected graph and invalid graph
 * data while exercising the same bounded canonical BFS as production.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  GameManifestTransportNetworkModelMap,
  StateModel,
  Step
} from "@cubica/contracts-manifest";

import { RUNTIME_BUDGETS } from "../src/modules/mechanics/budget.ts";
import { executeDomainOperation } from "../src/modules/mechanics/domainOperations.ts";
import { MechanicsExecutionError } from "../src/modules/mechanics/errors.ts";
import type {
  MechanicsExecutionContext,
  MechanicsRuntimeCost
} from "../src/modules/mechanics/types.ts";

type ShortestPathStep = Extract<Step, { op: "graph.shortestPath" }> & {
  onUnavailable?: "fail" | "return-unreachable";
};

const stateModel = {
  types: {
    "fixture.state": { kind: "enum", values: ["open", "closed"] },
    "fixture.string": { kind: "string" }
  },
  endpoints: {},
  collections: {
    nodes: {
      audienceRef: "public",
      storage: { root: "public", segments: ["nodes"] },
      capacity: 8,
      stableKey: "map-key",
      itemTypes: ["fixture.node"],
      fields: {
        availability: {
          storage: { kind: "facet", name: "availability" },
          valueType: "fixture.state",
          access: "read-only"
        },
        networkId: {
          storage: { kind: "attribute", name: "networkId" },
          valueType: "fixture.string",
          access: "read-only"
        }
      }
    },
    edges: {
      audienceRef: "public",
      storage: { root: "public", segments: ["edges"] },
      capacity: 8,
      stableKey: "map-key",
      itemTypes: ["fixture.edge"],
      fields: {
        availability: {
          storage: { kind: "facet", name: "availability" },
          valueType: "fixture.state",
          access: "read-only"
        },
        networkId: {
          storage: { kind: "attribute", name: "networkId" },
          valueType: "fixture.string",
          access: "read-only"
        },
        fromNodeId: {
          storage: { kind: "attribute", name: "fromNodeId" },
          valueType: "fixture.string",
          access: "read-only"
        },
        toNodeId: {
          storage: { kind: "attribute", name: "toNodeId" },
          valueType: "fixture.string",
          access: "read-only"
        }
      }
    }
  },
  events: {}
} satisfies StateModel;

const networkModels: GameManifestTransportNetworkModelMap = {
  neutral: {
    visibility: "public",
    nodeCollection: "nodes",
    edgeCollection: "edges",
    waypointObjectType: "fixture.node",
    edgeObjectType: "fixture.edge",
    nodeStateFacet: "availability",
    buildableNodeStates: ["open"],
    edgeStateFacet: "availability",
    splittableEdgeStates: ["open"],
    builtEdgeState: "open",
    sequenceEndpoint: "unused-sequence",
    regions: [{
      id: "fixture-region",
      polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
    }],
    movement: {
      vehicleCollection: "unused-vehicles",
      vehicleObjectTypes: ["fixture.vehicle"],
      locationAttribute: "nodeId",
      traversableNodeStates: ["open"],
      traversableEdgeStates: ["open"],
      capacityCollection: "unused-vehicles",
      capacityObjectTypes: ["fixture.vehicle"],
      capacityLocationAttribute: "nodeId",
      maxVehiclesPerNode: 1,
      coupledCollection: "unused-coupled",
      coupledObjectTypes: ["fixture.coupled"],
      coupledVehicleAttribute: "vehicleId",
      coupledLocationAttribute: "nodeId"
    }
  }
};

const state = {
  public: {
    nodes: {
      alpha: graphObject("fixture.node", "open", { networkId: "neutral" }),
      beta: graphObject("fixture.node", "open", { networkId: "neutral" }),
      isolated: graphObject("fixture.node", "open", { networkId: "neutral" }),
      closed: graphObject("fixture.node", "closed", { networkId: "neutral" })
    },
    edges: {
      "alpha-beta": graphObject("fixture.edge", "open", {
        networkId: "neutral",
        fromNodeId: "alpha",
        toNodeId: "beta"
      })
    }
  },
  secret: {}
};

function graphObject(
  objectType: string,
  availability: "open" | "closed",
  attributes: Record<string, unknown>
): Record<string, unknown> {
  return {
    objectType,
    facets: { availability },
    attributes
  };
}

function emptyCost(): MechanicsRuntimeCost {
  return {
    steps: 0,
    expressionNodes: 0,
    algorithmWork: 0,
    scannedEntities: 0,
    resultEntities: 0,
    writes: 0,
    events: 0,
    intermediateBytes: 0,
    eventBytes: 0,
    auditBytes: 0
  };
}

function createContext(): MechanicsExecutionContext {
  return {
    stateModel,
    state: structuredClone(state),
    preActionState: state,
    params: {},
    actor: { sessionRole: "facilitator" },
    results: new Map(),
    events: [],
    audit: [],
    cost: emptyCost(),
    limits: RUNTIME_BUDGETS["turn-based-standard-v1"],
    systemScheduleMutations: [],
    createScheduleId: () => {
      throw new Error("Shortest-path tests must not create schedule identities");
    },
    networkModels
  };
}

function shortestPathStep(
  fromNodeId: string,
  toNodeId: string,
  onUnavailable?: "fail" | "return-unreachable"
): ShortestPathStep {
  return {
    id: "find-route",
    kind: "algorithm",
    op: "graph.shortestPath",
    networkId: "neutral",
    fromNode: { op: "value.literal", value: fromNodeId },
    toNode: { op: "value.literal", value: toNodeId },
    ...(onUnavailable === undefined ? {} : { onUnavailable })
  };
}

function execute(step: ShortestPathStep): unknown {
  return executeDomainOperation(step, createContext());
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof MechanicsExecutionError && error.code === code;
}

test("shortest path marks a connected canonical route as reachable", () => {
  assert.deepEqual(execute(shortestPathStep("alpha", "beta")), {
    reachable: true,
    edgeIds: ["alpha-beta"],
    nodeIds: ["alpha", "beta"],
    length: 1
  });
});

test("shortest path preserves fail-closed behavior for a disconnected graph by default", () => {
  assert.throws(
    () => execute(shortestPathStep("alpha", "isolated")),
    (error) => hasErrorCode(error, "MECHANICS_GRAPH_ROUTE_UNAVAILABLE")
  );
});

test("shortest path may return a typed unreachable result for a disconnected graph", () => {
  assert.deepEqual(
    execute(shortestPathStep("alpha", "isolated", "return-unreachable")),
    { reachable: false, edgeIds: [], nodeIds: [], length: 0 }
  );
});

test("soft unavailability does not hide a closed endpoint", () => {
  assert.throws(
    () => execute(shortestPathStep("alpha", "closed", "return-unreachable")),
    (error) => hasErrorCode(error, "MECHANICS_GRAPH_STATE")
  );
});

test("a path from a node to itself is reachable with zero length", () => {
  assert.deepEqual(
    execute(shortestPathStep("alpha", "alpha", "return-unreachable")),
    { reachable: true, edgeIds: [], nodeIds: ["alpha"], length: 0 }
  );
});
