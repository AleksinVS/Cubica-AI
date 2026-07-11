/**
 * Neutral proof for schema-validated params, local facilitator authorization,
 * nonnegative transfers, resource references and dynamic transport building.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameManifest } from "@cubica/contracts-manifest";

import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import { RequestValidationError } from "../src/modules/errors.ts";
import { parseDispatchActionRequest } from "../src/modules/player-api/requestValidation.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { dispatchRuntimeAction } from "../src/modules/runtime/actionDispatcher.ts";

const refSchema = (collection: string, allowedTypes: string[]) => ({
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection,
    network: "grid",
    allowedTypes,
    visibility: "public"
  }
});

const neutralManifest = {
  meta: {
    id: "neutral-network",
    version: "1.0.0",
    name: "Neutral Network",
    description: "Contract fixture without concrete game terminology",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 1, max: 1 },
    settings: { mode: "local", locale: "en-US" },
    sessionMode: "facilitated"
  },
  objectModels: {
    "network.node": {
      collection: "nodes",
      scope: "session",
      facets: { status: { initial: "active", values: ["active", "closed"] } }
    },
    "network.waypoint": {
      collection: "nodes",
      scope: "session",
      facets: { status: { initial: "active", values: ["active", "closed"] } }
    },
    "network.edge": {
      collection: "edges",
      scope: "session",
      facets: { status: { initial: "open", values: ["open", "building", "blocked"] } }
    },
    "network.vehicle": {
      collection: "vehicles",
      scope: "session",
      facets: { status: { initial: "active", values: ["active"] } }
    },
    "network.carrier": {
      collection: "carriers",
      scope: "session",
      facets: { status: { initial: "active", values: ["active"] } }
    },
    "network.cargo": {
      collection: "cargo",
      scope: "session",
      facets: { status: { initial: "in_transit", values: ["in_transit", "delivered"] } }
    }
  },
  networkModels: {
    grid: {
      visibility: "public",
      nodeCollection: "nodes",
      edgeCollection: "edges",
      waypointObjectType: "network.waypoint",
      edgeObjectType: "network.edge",
      nodeStateFacet: "status",
      buildableNodeStates: ["active"],
      edgeStateFacet: "status",
      splittableEdgeStates: ["open", "building"],
      builtEdgeState: "building",
      sequencePath: "/public/transportNetworks/grid/sequence",
      roadCostPerRegionSegment: 2,
      waypointCost: 5,
      movement: {
        vehicleCollection: "vehicles",
        vehicleObjectTypes: ["network.vehicle"],
        locationAttribute: "nodeId",
        actionPointsAttribute: "actionPoints",
        traversableNodeStates: ["active"],
        traversableEdgeStates: ["open"],
        capacityCollection: "vehicles",
        capacityObjectTypes: ["network.vehicle"],
        capacityLocationAttribute: "nodeId",
        maxVehiclesPerNode: 2,
        coupledCollection: "carriers",
        coupledObjectTypes: ["network.carrier"],
        coupledVehicleAttribute: "vehicleId",
        coupledLocationAttribute: "nodeId"
      },
      cargoDelivery: {
        wagonCollection: "carriers",
        wagonObjectTypes: ["network.carrier"],
        cargoCollection: "cargo",
        cargoObjectTypes: ["network.cargo"],
        locationAttribute: "nodeId",
        cargoReferenceAttribute: "cargoId",
        attachedVehicleAttribute: "vehicleId",
        cargoDestinationAttribute: "destinationNodeId",
        cargoStateFacet: "status",
        deliverableCargoStates: ["in_transit"],
        deliveredCargoState: "delivered"
      },
      regions: [{
        id: "region-a",
        polygon: [{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 11 }, { x: -1, y: 11 }]
      }]
    }
  },
  state: {
    public: {
      phase: "construction",
      balances: { alpha: 10, beta: 10 },
      transportNetworks: { grid: { sequence: 0 } },
      objects: {
        nodes: {
          a: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: 0, y: 0 } }
          },
          b: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: 5, y: 0 } }
          },
          c: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: 10, y: 0 } }
          },
          boundaryLeft: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: -1, y: -1 } }
          },
          boundaryRight: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: 11, y: -1 } }
          },
          outside: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: -2, y: -2 } }
          }
        },
        edges: {
          "edge-a-b": {
            objectType: "network.edge",
            facets: { status: "open" },
            attributes: {
              networkId: "grid",
              fromNodeId: "a",
              toNodeId: "b",
              geometry: { from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }
            }
          }
        },
        vehicles: {
          mover: {
            objectType: "network.vehicle",
            facets: { status: "active" },
            attributes: { networkId: "grid", nodeId: "a", actionPoints: 2 }
          }
        },
        carriers: {
          carrier: {
            objectType: "network.carrier",
            facets: { status: "active" },
            attributes: { networkId: "grid", nodeId: "a", vehicleId: "mover", cargoId: "parcel" }
          }
        },
        cargo: {
          parcel: {
            objectType: "network.cargo",
            facets: { status: "in_transit" },
            attributes: { networkId: "grid", destinationNodeId: "b" }
          }
        }
      },
      log: []
    }
  },
  actions: {
    transfer: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { amount: { type: "integer", minimum: 0 } },
        required: ["amount"]
      },
      deterministic: {
        effects: [{
          op: "metric.transfer",
          from: { scope: "state", path: "/public/balances/alpha" },
          to: { scope: "state", path: "/public/balances/beta" },
          amount: { var: "params.amount" },
          onInsufficient: "fail"
        }]
      }
    },
    fractionalTransfer: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      deterministic: {
        effects: [{
          op: "metric.transfer",
          from: { scope: "state", path: "/public/balances/alpha" },
          to: { scope: "state", path: "/public/balances/beta" },
          amount: { "/": [1, 2] },
          onInsufficient: "fail"
        }]
      }
    },
    buildRoad: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          fromNodeId: refSchema("nodes", ["network.node", "network.waypoint"]),
          toNodeId: refSchema("nodes", ["network.node", "network.waypoint"]),
          contribution: { type: "integer", minimum: 0 }
        },
        required: ["fromNodeId", "toNodeId", "contribution"]
      },
      deterministic: {
        guard: { stateConditions: [{ path: "/public/phase", operator: "==", value: "construction" }] },
        effects: [{
          op: "transport.road.build",
          networkId: "grid",
          fromNodeParam: "fromNodeId",
          toNodeParam: "toNodeId",
          payments: [{ balancePath: "/public/balances/alpha", amount: { var: "params.contribution" } }]
        }]
      }
    },
    buildWaypoint: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          edgeId: refSchema("edges", ["network.edge"]),
          positionT: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
          contribution: { type: "integer", minimum: 0 }
        },
        required: ["edgeId", "positionT", "contribution"]
      },
      deterministic: {
        effects: [{
          op: "transport.waypoint.build",
          networkId: "grid",
          edgeParam: "edgeId",
          positionParam: "positionT",
          payments: [{ balancePath: "/public/balances/beta", amount: { var: "params.contribution" } }]
        }]
      }
    },
    moveVehicle: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          vehicleId: refSchema("vehicles", ["network.vehicle"]),
          edgeId: refSchema("edges", ["network.edge"])
        },
        required: ["vehicleId", "edgeId"]
      },
      deterministic: {
        effects: [{
          op: "transport.vehicle.move",
          networkId: "grid",
          vehicleParam: "vehicleId",
          edgeParam: "edgeId"
        }]
      }
    },
    deliverCargo: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          wagonId: refSchema("carriers", ["network.carrier"]),
          cargoId: refSchema("cargo", ["network.cargo"])
        },
        required: ["wagonId", "cargoId"]
      },
      deterministic: {
        effects: [{
          op: "transport.cargo.deliver",
          networkId: "grid",
          wagonParam: "wagonId",
          cargoParam: "cargoId"
        }]
      }
    },
    finish: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      deterministic: {
        effects: [{ op: "state.patch", patches: [{ op: "replace", path: "/public/phase", value: "reporting" }] }]
      }
    }
  }
};

const manifest = validateGameManifest(neutralManifest) as GameManifest;
const bundle = { gameId: manifest.meta.id, manifest };

const createStore = async (sessionRole: "player" | "facilitator" = "facilitator") => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const session = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole,
    initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>
  });
  return { store, session };
};

test("params schema, trusted role and atomic nonnegative transfer are enforced", async () => {
  const { store, session } = await createStore();
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: { sessionId: session.sessionId, actionId: "transfer", params: { amount: 4 } }
  });
  let current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.balances.alpha, 6);
  assert.equal((current?.state as any).public.balances.beta, 14);

  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, actionId: "transfer", params: { amount: 99 } }
    }),
    RequestValidationError
  );
  current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.balances.alpha, 6);
  assert.equal(current?.version.stateVersion, 1);

  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, actionId: "transfer", params: { amount: 1, extra: true } }
    }),
    /params failed schema validation/
  );

  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, actionId: "fractionalTransfer" }
    }),
    /finite non-negative integer/
  );
  current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.balances.alpha, 6);
  assert.equal(current?.version.stateVersion, 1);
});

test("client cannot spoof facilitator and params are rejected for an action without a schema", async () => {
  const { store, session } = await createStore("player");
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, actionId: "transfer", params: { amount: 1 } }
    }),
    /not available to the current session role/
  );
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: { sessionId: session.sessionId, actionId: "finish", params: {} }
    }),
    /does not accept params/
  );
  assert.throws(
    () => parseDispatchActionRequest({ sessionId: "s", actionId: "a", role: "facilitator" }),
    /cannot be supplied by the client/
  );
});

test("prototype-pollution property names are rejected before action validation", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const params = JSON.parse(`{"${key}":"unsafe"}`) as Record<string, unknown>;
    assert.throws(
      () => parseDispatchActionRequest({ sessionId: "s", actionId: "a", params }),
      /forbidden property name/
    );
  }
});

test("schema-declared references build a road and split that dynamic edge with a waypoint", async () => {
  const { store, session } = await createStore();
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "buildRoad",
      params: { fromNodeId: "b", toNodeId: "c", contribution: 2 }
    }
  });
  let current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.phase, "construction");
  assert.equal((current?.state as any).public.balances.alpha, 8);
  assert.equal((current?.state as any).public.objects.edges["grid:edge:1"].facets.status, "building");

  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "buildWaypoint",
      params: { edgeId: "grid:edge:1", positionT: 0.5, contribution: 5 }
    }
  });
  current = await store.getSession(session.sessionId);
  const state = current?.state as any;
  assert.equal(state.public.phase, "construction");
  assert.equal(state.public.balances.beta, 5);
  assert.equal(state.public.objects.edges["grid:edge:1"], undefined);
  assert.equal(state.public.objects.nodes["grid:node:2"].objectType, "network.waypoint");
  assert.equal(state.public.objects.edges["grid:edge:3"].attributes.toNodeId, "grid:node:2");
  assert.equal(state.public.objects.edges["grid:edge:4"].attributes.fromNodeId, "grid:node:2");

  // The newly created waypoint is immediately a valid schema-declared node
  // reference for another construction in the same still-open phase.
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "buildRoad",
      params: { fromNodeId: "grid:node:2", toNodeId: "a", contribution: 2 }
    }
  });
  current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.phase, "construction");
  assert.equal((current?.state as any).public.objects.edges["grid:edge:5"].attributes.fromNodeId, "grid:node:2");
});

test("schema-declared vehicle movement carries coupled objects and completes cargo at destination", async () => {
  const { store, session } = await createStore();
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "moveVehicle",
      params: { vehicleId: "mover", edgeId: "edge-a-b" }
    }
  });
  let current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.objects.vehicles.mover.attributes.nodeId, "b");
  assert.equal((current?.state as any).public.objects.vehicles.mover.attributes.actionPoints, 1);
  assert.equal((current?.state as any).public.objects.carriers.carrier.attributes.nodeId, "b");

  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "deliverCargo",
      params: { wagonId: "carrier", cargoId: "parcel" }
    }
  });
  current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.objects.carriers.carrier.attributes.vehicleId, null);
  assert.equal((current?.state as any).public.objects.carriers.carrier.attributes.cargoId, null);
  assert.equal((current?.state as any).public.objects.cargo.parcel.facets.status, "delivered");
});

test("invalid live reference and underfunded construction leave graph and version unchanged", async () => {
  const { store, session } = await createStore();
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        actionId: "buildRoad",
        params: { fromNodeId: "b", toNodeId: "missing", contribution: 2 }
      }
    }),
    /does not reference an available resource/
  );
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        actionId: "buildRoad",
        params: { fromNodeId: "b", toNodeId: "c", contribution: 1 }
      }
    }),
    /exactly cover calculated cost/
  );
  const current = await store.getSession(session.sessionId);
  assert.equal(current?.version.stateVersion, 0);
  assert.equal((current?.state as any).public.balances.alpha, 10);
  assert.equal((current?.state as any).public.objects.edges["grid:edge:1"], undefined);
});

test("region boundary and vertex touches are deterministic and zero-region roads are rejected", async () => {
  for (const [fromNodeId, toNodeId] of [
    ["boundaryLeft", "boundaryRight"],
    ["outside", "boundaryLeft"]
  ]) {
    const { store, session } = await createStore();
    await assert.rejects(
      dispatchRuntimeAction({
        sessionStore: store,
        bundle,
        input: {
          sessionId: session.sessionId,
          actionId: "buildRoad",
          params: { fromNodeId, toNodeId, contribution: 0 }
        }
      }),
      /at least one segment inside a declared region/
    );
    const current = await store.getSession(session.sessionId);
    assert.equal(current?.version.stateVersion, 0);
    assert.equal((current?.state as any).public.transportNetworks.grid.sequence, 0);
  }
});

test("manifest literal paths reject prototype-pollution segments", () => {
  const unsafe = structuredClone(neutralManifest) as any;
  unsafe.actions.transfer.deterministic.effects[0].from.path = "/public/balances/constructor/value";
  assert.throws(() => validateGameManifest(unsafe), /Schema validation failed/);
});
