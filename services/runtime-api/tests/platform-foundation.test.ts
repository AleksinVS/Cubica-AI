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
import { previewRuntimeTransportRoad } from "../src/modules/runtime/transportRoadPreview.ts";
import {
  canonicalizeRoadPlanningRegions,
  computeRegionRoadPlanningHash,
  deriveRoadPlanningPortalGeometry
} from "../src/modules/runtime/regionRoadPlanner.ts";

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
      facets: { status: { initial: "active", values: ["active", "reserve", "sold"] } }
    },
    "network.carrier": {
      collection: "carriers",
      scope: "session",
      facets: { status: { initial: "active", values: ["active", "reserve", "sold"] } }
    },
    "network.cargo": {
      collection: "cargo",
      scope: "session",
      facets: { status: { initial: "available", values: ["available", "in_transit", "delivered"] } }
    },
    "network.card": {
      collection: "cards",
      scope: "session",
      facets: { status: { initial: "available", values: ["available"] } }
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
        vehicleStateFacet: "status",
        movableVehicleStates: ["active"],
        locationAttribute: "nodeId",
        actionPointsAttribute: "actionPoints",
        traversableNodeStates: ["active"],
        traversableEdgeStates: ["open"],
        capacityCollection: "vehicles",
        capacityObjectTypes: ["network.vehicle"],
        capacityLocationAttribute: "nodeId",
        maxVehiclesPerNode: 1,
        coupledCollection: "carriers",
        coupledObjectTypes: ["network.carrier"],
        coupledStateFacet: "status",
        couplableVehicleStates: ["active"],
        coupledVehicleAttribute: "vehicleId",
        coupledLocationAttribute: "nodeId",
        compatibleCouplings: [{
          vehicleObjectType: "network.vehicle",
          coupledObjectTypes: ["network.carrier"]
        }],
        maxCoupledVehicles: 3
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
        cargoOriginAttribute: "originNodeId",
        cargoStateFacet: "status",
        loadableCargoStates: ["available"],
        loadedCargoState: "in_transit",
        deliverableCargoStates: ["in_transit"],
        deliveredCargoState: "delivered",
        payoutAttribute: "payout",
        ownerParticipantIdAttribute: "ownerId",
        participantCollectionPath: "/public/teams",
        participantBalanceAttribute: "coins",
        tariffPerEdge: 2,
        settledRouteLengthAttribute: "settledRouteLength"
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
      teams: { alpha: { coins: 3 }, beta: { coins: 4 } },
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
          d: {
            objectType: "network.node",
            facets: { status: "active" },
            attributes: { networkId: "grid", position: { x: 5, y: 5 } }
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
          },
          "edge-a-d": {
            objectType: "network.edge",
            facets: { status: "open" },
            attributes: { networkId: "grid", fromNodeId: "a", toNodeId: "d" }
          },
          "edge-d-b": {
            objectType: "network.edge",
            facets: { status: "open" },
            attributes: { networkId: "grid", fromNodeId: "d", toNodeId: "b" }
          }
        },
        vehicles: {
          mover: {
            objectType: "network.vehicle",
            facets: { status: "active" },
            attributes: { networkId: "grid", nodeId: "a", actionPoints: 2, ownerId: "beta", nominalValue: 10 }
          },
          reserveAtDestination: {
            objectType: "network.vehicle",
            facets: { status: "reserve" },
            attributes: { networkId: "grid", nodeId: "b", actionPoints: 0 }
          }
        },
        carriers: {
          carrier: {
            objectType: "network.carrier",
            facets: { status: "active" },
            attributes: {
              networkId: "grid", nodeId: "a", vehicleId: "mover", cargoId: "parcel",
              ownerId: "alpha", nominalValue: 5
            }
          },
          spareOne: {
            objectType: "network.carrier",
            facets: { status: "active" },
            attributes: {
              networkId: "grid", nodeId: "a", vehicleId: null, cargoId: null,
              ownerId: "alpha", nominalValue: 5
            }
          },
          spareTwo: {
            objectType: "network.carrier",
            facets: { status: "active" },
            attributes: {
              networkId: "grid", nodeId: "a", vehicleId: null, cargoId: null,
              ownerId: "alpha", nominalValue: 5
            }
          }
        },
        cargo: {
          parcel: {
            objectType: "network.cargo",
            facets: { status: "in_transit" },
            attributes: { networkId: "grid", originNodeId: "a", destinationNodeId: "b", payout: 7 }
          },
          waiting: {
            objectType: "network.cargo",
            facets: { status: "available" },
            attributes: { networkId: "grid", originNodeId: "a", destinationNodeId: "b", payout: 6 }
          }
        },
        cards: {
          first: { objectType: "network.card", facets: { status: "available" }, attributes: {} },
          second: { objectType: "network.card", facets: { status: "available" }, attributes: {} },
          third: { objectType: "network.card", facets: { status: "available" }, attributes: {} }
        }
      },
      log: []
    },
    secret: {
      random: { alg: "xoshiro128ss-v1", seed: "0123456789abcdeffedcba9876543210", counter: 0 }
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
    attachVehicles: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          vehicleId: refSchema("vehicles", ["network.vehicle"]),
          firstCarrierId: refSchema("carriers", ["network.carrier"]),
          secondCarrierId: refSchema("carriers", ["network.carrier"])
        },
        required: ["vehicleId", "firstCarrierId", "secondCarrierId"]
      },
      deterministic: { effects: [{
        op: "transport.vehicle.attach",
        networkId: "grid",
        vehicleParam: "vehicleId",
        coupledVehicleParams: ["firstCarrierId", "secondCarrierId"]
      }] }
    },
    detachVehicle: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          vehicleId: refSchema("vehicles", ["network.vehicle"]),
          carrierId: refSchema("carriers", ["network.carrier"])
        },
        required: ["vehicleId", "carrierId"]
      },
      deterministic: { effects: [{
        op: "transport.vehicle.detach",
        networkId: "grid",
        vehicleParam: "vehicleId",
        coupledVehicleParams: ["carrierId"]
      }] }
    },
    loadCargo: {
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
      deterministic: { effects: [{
        op: "transport.cargo.load", networkId: "grid", wagonParam: "wagonId", cargoParam: "cargoId"
      }] }
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
    shuffleCards: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      deterministic: { effects: [{ op: "deck.shuffle", deckId: "events", source: "collection:cards" }] }
    },
    drawCard: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      deterministic: { effects: [{
        op: "deck.draw", deckId: "events", storePath: "/public/drawnCardId", onEmpty: "reshuffle-discard"
      }] }
    },
    computeRanking: {
      handlerType: "manifest-data",
      allowedSessionRoles: ["facilitator"],
      deterministic: { effects: [{
        op: "ranking.compute",
        participantCollectionPath: "/public/teams",
        balanceAttribute: "coins",
        groups: [
          { id: "comparison", participantIds: ["alpha", "beta"] },
          { id: "operators", participantIds: ["alpha"] },
          { id: "owners", participantIds: ["beta"] }
        ],
        assetSources: [
          { collectionPath: "/public/objects/vehicles", ownerAttribute: "ownerId", valueAttribute: "nominalValue" },
          { collectionPath: "/public/objects/carriers", ownerAttribute: "ownerId", valueAttribute: "nominalValue" }
        ],
        storePath: "/public/ranking"
      }] }
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

const createStore = async (
  sessionRole: "player" | "facilitator" = "facilitator",
  mutateInitialState?: (state: Record<string, unknown>) => void
) => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const initialState = structuredClone(manifest.state) as unknown as Record<string, unknown>;
  mutateInitialState?.(initialState);
  const session = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole,
    initialState
  });
  return { store, session };
};

/** Build an opt-in neutral diamond with two equal three-region routes. */
const createPlannedRoadFixture = () => {
  const candidate = structuredClone(neutralManifest) as any;
  const regions = canonicalizeRoadPlanningRegions([
    { id: "region-a", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }] },
    { id: "region-b", polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }] },
    { id: "region-c", polygon: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }] },
    { id: "region-d", polygon: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 20 }] }
  ]);
  const portals = deriveRoadPlanningPortalGeometry(regions).map((portal, index) => ({
    id: `portal-${String(index + 1).padStart(2, "0")}`,
    ...portal
  }));
  const planning = {
    mode: "region-segment-minimum" as const,
    algorithmVersion: "region-segment-minimum-v1" as const,
    geometryVersion: "neutral-diamond-v1",
    geometryHash: computeRegionRoadPlanningHash({
      algorithmVersion: "region-segment-minimum-v1",
      boundaryPolicy: "lowest-region-id",
      regions,
      portals
    }),
    tieBreak: "session-random" as const,
    boundaryPolicy: "lowest-region-id" as const,
    excludedRegionIdsPath: "/public/excludedRoadRegions",
    navigationGraph: { portals }
  };
  candidate.networkModels.grid.regions = regions;
  candidate.networkModels.grid.roadPlanning = planning;
  candidate.state.public.excludedRoadRegions = [];
  candidate.state.public.balances.alpha = 20;
  candidate.state.public.objects.nodes.plannedFrom = {
    objectType: "network.node",
    facets: { status: "active" },
    attributes: { networkId: "grid", position: { x: 5, y: 10 } }
  };
  candidate.state.public.objects.nodes.plannedTo = {
    objectType: "network.node",
    facets: { status: "active" },
    attributes: { networkId: "grid", position: { x: 25, y: 10 } }
  };
  return candidate;
};

/**
 * Opt-in neutral proof for delayed construction activation. The base fixture
 * intentionally remains lifecycle-free so its existing assertions continue to
 * prove backwards compatibility for older manifests.
 */
const createConstructionLifecycleFixture = () => {
  const candidate = structuredClone(neutralManifest) as any;
  candidate.objectModels["network.waypoint"].facets.status.values.push("building");
  candidate.networkModels.grid.buildableNodeStates = ["active", "building"];
  candidate.networkModels.grid.constructionLifecycle = {
    turnCounterPath: "/public/turnNumber",
    activationDelayTurns: 2,
    nodeStates: { pending: "building", active: "active" },
    edgeStates: { pending: "building", active: "open" },
    createdTurnAttribute: "createdTurn",
    activationTurnAttribute: "activationTurn",
    blockingReasonsAttribute: "blockingReasons",
    pendingReason: "construction-pending"
  };
  candidate.state.public.turnNumber = 3;
  candidate.actions.advanceConstructionTurn = {
    handlerType: "manifest-data",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      effects: [
        { op: "counter.add", path: "/public/turnNumber", delta: 1 },
        { op: "transport.construction.activateDue", networkId: "grid" }
      ]
    }
  };
  candidate.actions.activateDueAgain = {
    handlerType: "manifest-data",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      effects: [{ op: "transport.construction.activateDue", networkId: "grid" }]
    }
  };
  candidate.actions.addIndependentBlocker = {
    handlerType: "manifest-data",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      effects: [{
        op: "object.attribute.patch",
        visibility: "public",
        collection: "edges",
        objectId: "grid:edge:3",
        patches: [{
          op: "replace",
          path: "/blockingReasons",
          value: ["construction-pending", "weather-closed"]
        }]
      }]
    }
  };
  return candidate;
};

const createStoreForManifest = async (rawManifest: unknown) => {
  const plannedManifest = validateGameManifest(rawManifest) as GameManifest;
  const plannedStore = new InMemorySessionStore<Record<string, unknown>>();
  const plannedSession = await plannedStore.createSession({
    gameId: plannedManifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(plannedManifest.state) as unknown as Record<string, unknown>
  });
  return {
    store: plannedStore,
    session: plannedSession,
    bundle: { gameId: plannedManifest.meta.id, manifest: plannedManifest }
  };
};

test("params schema, trusted role and atomic nonnegative transfer are enforced", async () => {
  const { store, session } = await createStore();
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      expectedStateVersion: 0,
      actionId: "transfer",
      params: { amount: 4 }
    }
  });
  let current = await store.getSession(session.sessionId);
  assert.equal((current?.state as any).public.balances.alpha, 6);
  assert.equal((current?.state as any).public.balances.beta, 14);
  const afterAcceptedTransfer = structuredClone(current);

  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        expectedStateVersion: 0,
        actionId: "transfer",
        params: { amount: 4 }
      }
    }),
    /changed after version 0/
  );
  assert.deepEqual(await store.getSession(session.sessionId), afterAcceptedTransfer);

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
    () => parseDispatchActionRequest({ sessionId: "s", expectedStateVersion: 0, actionId: "a", role: "facilitator" }),
    /cannot be supplied by the client/
  );
});

test("prototype-pollution property names are rejected before action validation", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const params = JSON.parse(`{"${key}":"unsafe"}`) as Record<string, unknown>;
    assert.throws(
      () => parseDispatchActionRequest({ sessionId: "s", expectedStateVersion: 0, actionId: "a", params }),
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

test("opt-in construction lifecycle keeps both build orders pending through N+1 and activates due objects at N+2", async () => {
  const target = await createStoreForManifest(createConstructionLifecycleFixture());
  const dispatch = async (actionId: string, params?: Record<string, unknown>) => dispatchRuntimeAction({
    sessionStore: target.store,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      actionId,
      ...(params ? { params } : {})
    }
  });

  // road -> waypoint: the split children are new construction and therefore
  // cannot inherit the original road's open/active state.
  await dispatch("buildRoad", { fromNodeId: "b", toNodeId: "c", contribution: 2 });
  let state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.equal(state.public.objects.edges["grid:edge:1"].facets.status, "building");
  assert.deepEqual(state.public.objects.edges["grid:edge:1"].attributes.blockingReasons, ["construction-pending"]);
  assert.equal(state.public.objects.edges["grid:edge:1"].attributes.createdTurn, 3);
  assert.equal(state.public.objects.edges["grid:edge:1"].attributes.activationTurn, 5);

  await dispatch("buildWaypoint", { edgeId: "grid:edge:1", positionT: 0.5, contribution: 5 });
  state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.equal(state.public.objects.nodes["grid:node:2"].facets.status, "building");
  assert.equal(state.public.objects.edges["grid:edge:3"].facets.status, "building");
  assert.equal(state.public.objects.edges["grid:edge:4"].facets.status, "building");
  assert.equal(state.public.objects.edges["grid:edge:3"].attributes.activationTurn, 5);

  // waypoint -> road: a pending waypoint can be declared buildable, while the
  // road it starts remains independently pending under the same lifecycle.
  await dispatch("buildRoad", { fromNodeId: "grid:node:2", toNodeId: "a", contribution: 2 });
  state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.equal(state.public.objects.edges["grid:edge:5"].facets.status, "building");
  assert.equal(state.public.objects.edges["grid:edge:5"].attributes.activationTurn, 5);
  await dispatch("addIndependentBlocker");

  await dispatch("advanceConstructionTurn");
  state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.equal(state.public.turnNumber, 4);
  assert.equal(state.public.objects.nodes["grid:node:2"].facets.status, "building");
  assert.equal(state.public.objects.edges["grid:edge:4"].facets.status, "building");

  await dispatch("advanceConstructionTurn");
  state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.equal(state.public.turnNumber, 5);
  assert.equal(state.public.objects.nodes["grid:node:2"].facets.status, "active");
  assert.equal(state.public.objects.edges["grid:edge:4"].facets.status, "open");
  assert.equal(state.public.objects.edges["grid:edge:5"].facets.status, "open");
  assert.deepEqual(state.public.objects.edges["grid:edge:4"].attributes.blockingReasons, []);
  assert.equal(state.public.objects.edges["grid:edge:3"].facets.status, "building");
  assert.deepEqual(state.public.objects.edges["grid:edge:3"].attributes.blockingReasons, ["weather-closed"]);

  const graphBeforeReplay = structuredClone(state.public.objects);
  await dispatch("activateDueAgain");
  state = (await target.store.getSession(target.session.sessionId))?.state as any;
  assert.deepEqual(state.public.objects, graphBeforeReplay, "replaying activation must not change the graph again");
});

test("authoritative planner chooses a replay-stable minimum region sequence and stores its exact polyline", async () => {
  const first = await createStoreForManifest(createPlannedRoadFixture());
  const second = await createStoreForManifest(createPlannedRoadFixture());
  for (const target of [first, second]) {
    await dispatchRuntimeAction({
      sessionStore: target.store,
      bundle: target.bundle,
      input: {
        sessionId: target.session.sessionId,
        actionId: "buildRoad",
        params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: 6 }
      }
    });
  }
  const firstState = (await first.store.getSession(first.session.sessionId))?.state as any;
  const secondState = (await second.store.getSession(second.session.sessionId))?.state as any;
  const firstEdge = firstState.public.objects.edges["grid:edge:1"].attributes;
  const secondEdge = secondState.public.objects.edges["grid:edge:1"].attributes;

  assert.equal(firstEdge.regionSegments, 3);
  assert.equal(firstEdge.constructionCost, 6);
  assert.equal(firstState.public.balances.alpha, 14);
  assert.equal(firstEdge.geometry.polyline.length, 4);
  assert.deepEqual(firstEdge.geometry, secondEdge.geometry);
  assert.deepEqual(firstEdge.routePlan.regionSequence, secondEdge.routePlan.regionSequence);
  assert.ok([
    "region-a,region-b,region-d",
    "region-a,region-c,region-d"
  ].includes(firstEdge.routePlan.regionSequence.join(",")));
  assert.equal(firstEdge.routePlan.tieBreak.candidateCount, 2);
  assert.equal(firstEdge.routePlan.tieBreak.randomCounterBefore, 0);
  assert.equal(firstEdge.routePlan.tieBreak.randomCounterAfter, 1);
  assert.equal(firstState.secret.random.counter, 1);
  assert.deepEqual(firstState.secret.random, secondState.secret.random);
});

test("road preview simulates the tied-route choice without consuming PRNG and matches same-version confirmation", async () => {
  const target = await createStoreForManifest(createPlannedRoadFixture());
  const before = await target.store.getSession(target.session.sessionId);
  assert.ok(before);
  const preview = previewRuntimeTransportRoad({
    snapshot: before,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      expectedStateVersion: before.version.stateVersion,
      actionId: "buildRoad",
      params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo" }
    }
  });
  const afterPreview = await target.store.getSession(target.session.sessionId);
  assert.deepEqual(afterPreview?.version, before.version);
  assert.deepEqual((afterPreview?.state as any).secret.random, (before.state as any).secret.random);
  assert.equal(preview.usedStateVersion, before.version.stateVersion);
  assert.equal(preview.candidateCount, 2);
  assert.equal(preview.cost, 6);
  assert.equal("seed" in (preview as unknown as Record<string, unknown>), false);
  assert.equal(JSON.stringify(preview).includes("randomCounter"), false);

  await dispatchRuntimeAction({
    sessionStore: target.store,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      expectedStateVersion: preview.usedStateVersion,
      actionId: "buildRoad",
      params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: preview.cost }
    }
  });
  const confirmed = (await target.store.getSession(target.session.sessionId))?.state as any;
  const edge = confirmed.public.objects.edges["grid:edge:1"].attributes;
  assert.deepEqual(edge.geometry.polyline, preview.polyline);
  assert.deepEqual(edge.routePlan.regionSequence, preview.regionSequence);
  assert.equal(confirmed.secret.random.counter, 1);
});

test("public road preview fails closed before resolving a secret network or endpoint reference", async () => {
  const target = await createStoreForManifest(createPlannedRoadFixture());
  const snapshot = await target.store.getSession(target.session.sessionId);
  assert.ok(snapshot);
  const privateBundle = structuredClone(target.bundle) as any;
  privateBundle.manifest.networkModels.grid.visibility = "secret";
  assert.throws(
    () => previewRuntimeTransportRoad({
      snapshot,
      bundle: privateBundle,
      input: {
        sessionId: target.session.sessionId,
        expectedStateVersion: snapshot.version.stateVersion,
        actionId: "buildRoad",
        params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo" }
      }
    }),
    /does not expose a public transport-road preview/
  );

  const privateReferenceBundle = structuredClone(target.bundle) as any;
  privateReferenceBundle.manifest.actions.buildRoad.paramsSchema.properties.fromNodeId["x-cubica-ref"].visibility = "secret";
  assert.throws(
    () => previewRuntimeTransportRoad({
      snapshot,
      bundle: privateReferenceBundle,
      input: {
        sessionId: target.session.sessionId,
        expectedStateVersion: snapshot.version.stateVersion,
        actionId: "buildRoad",
        // The id deliberately does not exist in secret state. Rejection must
        // happen from the declaration before resource existence is probed.
        params: { fromNodeId: "secret-probe", toNodeId: "plannedTo" }
      }
    }),
    /not declared for public preview visibility/
  );
  assert.equal((await target.store.getSession(target.session.sessionId))?.version.stateVersion, 0);
});

test("waypoint splits a planned road by polyline length without replanning its region passages", async () => {
  const target = await createStoreForManifest(createPlannedRoadFixture());
  await dispatchRuntimeAction({
    sessionStore: target.store,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      actionId: "buildRoad",
      params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: 6 }
    }
  });
  const builtState = (await target.store.getSession(target.session.sessionId))?.state as any;
  const originalPoints = builtState.public.objects.edges["grid:edge:1"].attributes.geometry.polyline;
  await dispatchRuntimeAction({
    sessionStore: target.store,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      actionId: "buildWaypoint",
      params: { edgeId: "grid:edge:1", positionT: 0.5, contribution: 5 }
    }
  });
  const state = (await target.store.getSession(target.session.sessionId))?.state as any;
  const firstEdge = state.public.objects.edges["grid:edge:3"].attributes;
  const secondEdge = state.public.objects.edges["grid:edge:4"].attributes;
  assert.deepEqual(
    [...firstEdge.geometry.polyline, ...secondEdge.geometry.polyline.slice(1)],
    [...originalPoints.slice(0, 2), firstEdge.geometry.polyline.at(-1), ...originalPoints.slice(2)]
  );
  assert.equal(firstEdge.geometry.polyline.at(-1).x, 15);
  assert.equal(secondEdge.geometry.polyline[0].x, 15);
  assert.equal(firstEdge.routePlan.geometryHash, secondEdge.routePlan.geometryHash);
  assert.equal(firstEdge.routePlan.splitFromEdgeId, "grid:edge:1");
  assert.equal(secondEdge.routePlan.splitFromEdgeId, "grid:edge:1");
  assert.deepEqual(firstEdge.routePlan.regionSequence.slice(-1), secondEdge.routePlan.regionSequence.slice(0, 1));
  assert.equal(state.secret.random.counter, 1, "splitting stored geometry must not consume randomness");
});

test("planned road payment and exclusions fail atomically before any route is persisted", async () => {
  const underpaid = await createStoreForManifest(createPlannedRoadFixture());
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: underpaid.store,
      bundle: underpaid.bundle,
      input: {
        sessionId: underpaid.session.sessionId,
        actionId: "buildRoad",
        params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: 5 }
      }
    }),
    /exactly cover calculated cost/
  );
  let state = (await underpaid.store.getSession(underpaid.session.sessionId))?.state as any;
  assert.equal(state.public.balances.alpha, 20);
  assert.equal(state.secret.random.counter, 0);
  assert.equal(state.public.objects.edges["grid:edge:1"], undefined);

  const excludedManifest = createPlannedRoadFixture();
  excludedManifest.state.public.excludedRoadRegions = ["region-b", "region-c"];
  const excluded = await createStoreForManifest(excludedManifest);
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: excluded.store,
      bundle: excluded.bundle,
      input: {
        sessionId: excluded.session.sessionId,
        actionId: "buildRoad",
        params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: 6 }
      }
    }),
    /No road route connects/
  );
  state = (await excluded.store.getSession(excluded.session.sessionId))?.state as any;
  assert.equal(state.public.balances.alpha, 20);
  assert.equal(state.secret.random.counter, 0);
});

test("planned geometry hash, derived portals and bounded simple polygons are fail-closed", () => {
  const wrongHash = createPlannedRoadFixture();
  wrongHash.networkModels.grid.roadPlanning.geometryHash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateGameManifest(wrongHash), /geometry hash mismatch/);

  const inventedPortal = createPlannedRoadFixture();
  inventedPortal.networkModels.grid.roadPlanning.navigationGraph.portals[0].to = { x: 10, y: 9 };
  const planning = inventedPortal.networkModels.grid.roadPlanning;
  planning.geometryHash = computeRegionRoadPlanningHash({
    algorithmVersion: planning.algorithmVersion,
    boundaryPolicy: planning.boundaryPolicy,
    regions: inventedPortal.networkModels.grid.regions,
    portals: planning.navigationGraph.portals
  });
  assert.throws(() => validateGameManifest(inventedPortal), /portals do not match derived shared boundaries/);

  const selfIntersecting = createPlannedRoadFixture();
  selfIntersecting.networkModels.grid.regions[0].polygon = [
    { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }, { x: 10, y: 0 }
  ];
  assert.throws(() => validateGameManifest(selfIntersecting), /not a simple polygon|zero area/);

  const overlapping = createPlannedRoadFixture();
  overlapping.networkModels.grid.regions[3].polygon = [
    { x: 19, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 19, y: 20 }
  ];
  assert.throws(() => validateGameManifest(overlapping), /overlapping interiors/);

  const wrongVisibility = createPlannedRoadFixture();
  wrongVisibility.networkModels.grid.roadPlanning.excludedRegionIdsPath = "/secret/excludedRoadRegions";
  assert.throws(() => validateGameManifest(wrongVisibility), /must use the network visibility branch/);
});

test("lowest-region-id boundary policy removes an ambiguous route along one shared boundary", async () => {
  const boundaryManifest = createPlannedRoadFixture();
  const regions = canonicalizeRoadPlanningRegions([
    { id: "region-a", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    { id: "region-b", polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }] }
  ]);
  const portals = deriveRoadPlanningPortalGeometry(regions).map((portal, index) => ({
    id: `portal-${index + 1}`,
    ...portal
  }));
  boundaryManifest.networkModels.grid.regions = regions;
  boundaryManifest.networkModels.grid.roadPlanning.navigationGraph.portals = portals;
  boundaryManifest.networkModels.grid.roadPlanning.geometryHash = computeRegionRoadPlanningHash({
    algorithmVersion: "region-segment-minimum-v1",
    boundaryPolicy: "lowest-region-id",
    regions,
    portals
  });
  boundaryManifest.state.public.objects.nodes.plannedFrom.attributes.position = { x: 10, y: 2 };
  boundaryManifest.state.public.objects.nodes.plannedTo.attributes.position = { x: 10, y: 8 };
  const target = await createStoreForManifest(boundaryManifest);
  await dispatchRuntimeAction({
    sessionStore: target.store,
    bundle: target.bundle,
    input: {
      sessionId: target.session.sessionId,
      actionId: "buildRoad",
      params: { fromNodeId: "plannedFrom", toNodeId: "plannedTo", contribution: 2 }
    }
  });
  const state = (await target.store.getSession(target.session.sessionId))?.state as any;
  const edge = state.public.objects.edges["grid:edge:1"].attributes;
  assert.deepEqual(edge.routePlan.regionSequence, ["region-a"]);
  assert.equal(edge.routePlan.tieBreak.candidateCount, 1);
  assert.equal(state.secret.random.counter, 0);
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
  assert.equal((current?.state as any).public.objects.cargo.parcel.attributes.settledRouteLength, 1);
  assert.equal((current?.state as any).public.teams.alpha.coins, 8);
  assert.equal((current?.state as any).public.teams.beta.coins, 6);
});

test("hidden decks shuffle and draw reproducibly without exposing their future order", async () => {
  const first = await createStore();
  const second = await createStore();
  for (const target of [first, second]) {
    await dispatchRuntimeAction({
      sessionStore: target.store,
      bundle,
      input: { sessionId: target.session.sessionId, actionId: "shuffleCards" }
    });
    for (let index = 0; index < 4; index += 1) {
      await dispatchRuntimeAction({
        sessionStore: target.store,
        bundle,
        input: { sessionId: target.session.sessionId, actionId: "drawCard" }
      });
    }
  }
  const firstState = (await first.store.getSession(first.session.sessionId))?.state as any;
  const secondState = (await second.store.getSession(second.session.sessionId))?.state as any;
  assert.equal(firstState.public.drawnCardId, secondState.public.drawnCardId);
  assert.deepEqual(firstState.secret.decks, secondState.secret.decks);
  assert.deepEqual(firstState.secret.random, secondState.secret.random);
  assert.equal(firstState.public.decks, undefined);
  assert.equal(new Set([
    ...firstState.secret.decks.events.order,
    ...firstState.secret.decks.events.discard
  ]).size, 3);
});

test("group coupling costs one action point and cargo loading enforces an empty wagon at origin", async () => {
  const coupling = await createStore();
  await dispatchRuntimeAction({
    sessionStore: coupling.store,
    bundle,
    input: {
      sessionId: coupling.session.sessionId,
      actionId: "detachVehicle",
      params: { vehicleId: "mover", carrierId: "carrier" }
    }
  });
  await dispatchRuntimeAction({
    sessionStore: coupling.store,
    bundle,
    input: {
      sessionId: coupling.session.sessionId,
      actionId: "attachVehicles",
      params: { vehicleId: "mover", firstCarrierId: "spareOne", secondCarrierId: "spareTwo" }
    }
  });
  const coupledState = (await coupling.store.getSession(coupling.session.sessionId))?.state as any;
  assert.equal(coupledState.public.objects.vehicles.mover.attributes.actionPoints, 0);
  assert.equal(coupledState.public.objects.carriers.carrier.attributes.vehicleId, null);
  assert.equal(coupledState.public.objects.carriers.spareOne.attributes.vehicleId, "mover");
  assert.equal(coupledState.public.objects.carriers.spareTwo.attributes.vehicleId, "mover");

  const loading = await createStore();
  await dispatchRuntimeAction({
    sessionStore: loading.store,
    bundle,
    input: {
      sessionId: loading.session.sessionId,
      actionId: "loadCargo",
      params: { wagonId: "spareOne", cargoId: "waiting" }
    }
  });
  const loadedState = (await loading.store.getSession(loading.session.sessionId))?.state as any;
  assert.equal(loadedState.public.objects.carriers.spareOne.attributes.cargoId, "waiting");
  assert.equal(loadedState.public.objects.cargo.waiting.facets.status, "in_transit");
});

test("server rejects reserve transport objects even when a caller supplies a valid reference id", async () => {
  const { store, session } = await createStore("facilitator", (state) => {
    (state as any).public.objects.vehicles.mover.facets.status = "reserve";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        actionId: "moveVehicle",
        params: { vehicleId: "mover", edgeId: "edge-a-b" }
      }
    }),
    /not in an allowed state/
  );
  assert.equal((await store.getSession(session.sessionId))?.version.stateVersion, 0);
});

test("reserve vehicles do not occupy destination capacity while active vehicles do", async () => {
  const reserve = await createStore();
  await dispatchRuntimeAction({
    sessionStore: reserve.store,
    bundle,
    input: {
      sessionId: reserve.session.sessionId,
      actionId: "moveVehicle",
      params: { vehicleId: "mover", edgeId: "edge-a-b" }
    }
  });
  assert.equal(
    ((await reserve.store.getSession(reserve.session.sessionId))?.state as any)
      .public.objects.vehicles.mover.attributes.nodeId,
    "b"
  );

  const active = await createStore("facilitator", (state) => {
    (state as any).public.objects.vehicles.reserveAtDestination.facets.status = "active";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: active.store,
      bundle,
      input: {
        sessionId: active.session.sessionId,
        actionId: "moveVehicle",
        params: { vehicleId: "mover", edgeId: "edge-a-b" }
      }
    }),
    /reached its vehicle capacity/
  );
  assert.equal((await active.store.getSession(active.session.sessionId))?.version.stateVersion, 0);
});

test("closed routes, insufficient settlement funds and wrong loading nodes fail atomically", async () => {
  const closed = await createStore("facilitator", (state) => {
    const publicState = (state as any).public;
    publicState.objects.vehicles.mover.attributes.nodeId = "b";
    publicState.objects.carriers.carrier.attributes.nodeId = "b";
    publicState.objects.edges["edge-a-b"].facets.status = "blocked";
    publicState.objects.edges["edge-a-d"].facets.status = "blocked";
    publicState.objects.edges["edge-d-b"].facets.status = "blocked";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: closed.store,
      bundle,
      input: {
        sessionId: closed.session.sessionId,
        actionId: "deliverCargo",
        params: { wagonId: "carrier", cargoId: "parcel" }
      }
    }),
    /not connected by an open route/
  );
  let state = (await closed.store.getSession(closed.session.sessionId))?.state as any;
  assert.equal((await closed.store.getSession(closed.session.sessionId))?.version.stateVersion, 0);
  assert.equal(state.public.teams.alpha.coins, 3);
  assert.equal(state.public.objects.carriers.carrier.attributes.cargoId, "parcel");

  const underfunded = await createStore("facilitator", (initial) => {
    const publicState = (initial as any).public;
    publicState.objects.vehicles.mover.attributes.nodeId = "b";
    publicState.objects.carriers.carrier.attributes.nodeId = "b";
    publicState.objects.cargo.parcel.attributes.payout = 0;
    publicState.teams.alpha.coins = 0;
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: underfunded.store,
      bundle,
      input: {
        sessionId: underfunded.session.sessionId,
        actionId: "deliverCargo",
        params: { wagonId: "carrier", cargoId: "parcel" }
      }
    }),
    /cannot make a participant balance negative/
  );
  state = (await underfunded.store.getSession(underfunded.session.sessionId))?.state as any;
  assert.equal((await underfunded.store.getSession(underfunded.session.sessionId))?.version.stateVersion, 0);
  assert.equal(state.public.teams.beta.coins, 4);
  assert.equal(state.public.objects.cargo.parcel.facets.status, "in_transit");

  const wrongOrigin = await createStore("facilitator", (initial) => {
    (initial as any).public.objects.carriers.spareOne.attributes.nodeId = "b";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: wrongOrigin.store,
      bundle,
      input: {
        sessionId: wrongOrigin.session.sessionId,
        actionId: "loadCargo",
        params: { wagonId: "spareOne", cargoId: "waiting" }
      }
    }),
    /declared origin/
  );
  assert.equal((await wrongOrigin.store.getSession(wrongOrigin.session.sessionId))?.version.stateVersion, 0);
});

test("settlement chooses the shortest currently open route instead of a closed direct edge", async () => {
  const { store, session } = await createStore("facilitator", (initial) => {
    const publicState = (initial as any).public;
    publicState.objects.vehicles.mover.attributes.nodeId = "b";
    publicState.objects.carriers.carrier.attributes.nodeId = "b";
    publicState.objects.edges["edge-a-b"].facets.status = "blocked";
  });
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: {
      sessionId: session.sessionId,
      actionId: "deliverCargo",
      params: { wagonId: "carrier", cargoId: "parcel" }
    }
  });
  const state = (await store.getSession(session.sessionId))?.state as any;
  assert.equal(state.public.objects.cargo.parcel.attributes.settledRouteLength, 2);
  assert.equal(state.public.teams.alpha.coins, 6);
  assert.equal(state.public.teams.beta.coins, 8);
});

test("settlement rejects a corrupted remote attachment without paying either owner", async () => {
  const { store, session } = await createStore("facilitator", (initial) => {
    (initial as any).public.objects.carriers.carrier.attributes.nodeId = "b";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        actionId: "deliverCargo",
        params: { wagonId: "carrier", cargoId: "parcel" }
      }
    }),
    /must share the destination node/
  );
  const snapshot = await store.getSession(session.sessionId);
  assert.equal(snapshot?.version.stateVersion, 0);
  assert.equal((snapshot?.state as any).public.teams.alpha.coins, 3);
  assert.equal((snapshot?.state as any).public.teams.beta.coins, 4);
});

test("ranking explains asset values and preserves equal first place inside each declared group", async () => {
  const { store, session } = await createStore("facilitator", (state) => {
    (state as any).public.teams.alpha.coins = 0;
    (state as any).public.teams.beta.coins = 5;
  });
  await dispatchRuntimeAction({
    sessionStore: store,
    bundle,
    input: { sessionId: session.sessionId, actionId: "computeRanking" }
  });
  const ranking = ((await store.getSession(session.sessionId))?.state as any).public.ranking;
  assert.equal(ranking.groups.comparison.tiedForFirst, true);
  assert.deepEqual(ranking.groups.comparison.winners, ["alpha", "beta"]);
  assert.deepEqual(ranking.groups.comparison.standings.map((entry: any) => entry.rank), [1, 1]);
  assert.equal(ranking.groups.comparison.standings[0].assetValue, 15);
  assert.equal(ranking.groups.comparison.standings[1].assetValue, 10);
});

test("schema rejects partial loading, coupling and settlement model declarations", () => {
  for (const mutate of [
    (candidate: any) => { delete candidate.networkModels.grid.movement.maxCoupledVehicles; },
    (candidate: any) => { delete candidate.networkModels.grid.cargoDelivery.loadedCargoState; },
    (candidate: any) => { delete candidate.networkModels.grid.cargoDelivery.tariffPerEdge; }
  ]) {
    const candidate = structuredClone(neutralManifest) as any;
    mutate(candidate);
    assert.throws(() => validateGameManifest(candidate), /Schema validation failed/);
  }
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

  for (const mutate of [
    (candidate: any) => {
      candidate.networkModels.grid.constructionLifecycle.turnCounterPath = "/public/constructor/turn";
    },
    (candidate: any) => {
      candidate.networkModels.grid.constructionLifecycle.createdTurnAttribute = "__proto__";
    },
    (candidate: any) => {
      candidate.networkModels.grid.constructionLifecycle.pendingReason = "";
    }
  ]) {
    const lifecycleUnsafe = createConstructionLifecycleFixture();
    mutate(lifecycleUnsafe);
    assert.throws(() => validateGameManifest(lifecycleUnsafe), /Schema validation failed/);
  }
});
