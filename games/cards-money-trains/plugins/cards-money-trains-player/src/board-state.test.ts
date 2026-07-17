/** Focused tests for public board projection without importing Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
import { projectBoardSession } from "./board-state.ts";
import { registerCardsMoneyTrainsPlayer } from "./registration.ts";

test("projects only provided topology, geometry, actions, and team balances", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        session: { phase: "construction", turnNumber: 3 },
        teams: {
          alpha: { label: "Альфа", type: "logistics_company", coins: 7 }
        },
        objects: {
          networkNodes: {
            a: {
              objectType: "transport.terminal",
              facets: { availability: "open" },
              attributes: { label: "A", position: { x: 10, y: 20 } }
            },
            b: {
              objectType: "transport.waypoint",
              facets: { availability: "open" },
              attributes: { label: "B", position: { x: 30, y: 40 } }
            },
            missingPosition: {
              objectType: "transport.terminal",
              facets: { availability: "open" },
              attributes: { label: "Not renderable" }
            }
          },
          networkEdges: {
            edge1: {
              objectType: "transport.edge",
              facets: { state: "building" },
              attributes: {
                fromNodeId: "a",
                toNodeId: "b",
                geometry: {
                  // The planned route takes priority over legacy endpoint
                  // fields, so the client does not straighten the server path.
                  polyline: [{ x: 10, y: 20 }, { x: 18, y: 35 }, { x: 30, y: 40 }],
                  from: { x: 1, y: 2 },
                  to: { x: 3, y: 4 }
                }
              }
            }
          },
          locomotives: {
            loco1: { attributes: { nodeId: "a", ownerTeamId: "alpha" } }
          },
          wagons: {}
        },
        board: {
          canonicalBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          highlights: [{ targetType: "node", targetId: "b", actionId: "select.b", params: { nodeId: "b" } }],
          availableActions: [{ id: "select-b", label: "Выбрать B", actionId: "select.b", params: { nodeId: "b" } }]
        }
      }
    }
  });

  assert.equal(projection.phase, "construction");
  assert.equal(projection.turnNumber, 3);
  assert.deepEqual(projection.nodes.map((node) => node.id), ["a", "b"]);
  assert.equal(projection.edges[0]?.visualState, "building");
  assert.deepEqual(projection.edges[0]?.points, [
    { x: 10, y: 20 },
    { x: 18, y: 35 },
    { x: 30, y: 40 }
  ]);
  assert.deepEqual(projection.edges[0]?.from, { x: 10, y: 20 });
  assert.deepEqual(projection.edges[0]?.to, { x: 30, y: 40 });
  assert.equal(projection.vehicles[0]?.ownerTeamId, "alpha");
  assert.equal(projection.teams[0]?.coins, 7);
  assert.equal(projection.highlights[0]?.actionId, "select.b");
  assert.equal(projection.availableActions[0]?.params?.nodeId, "b");
});

test("falls back from malformed planned geometry to legacy endpoints and node positions", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        objects: {
          networkNodes: {
            a: { attributes: { position: { x: 10, y: 20 } } },
            b: { attributes: { position: { x: 30, y: 40 } } }
          },
          networkEdges: {
            legacy: {
              attributes: {
                fromNodeId: "a",
                toNodeId: "b",
                geometry: {
                  polyline: [{ x: 10, y: 20 }, { x: Number.NaN, y: 25 }],
                  from: { x: 12, y: 22 },
                  to: { x: 28, y: 38 }
                }
              }
            },
            nodeFallback: {
              attributes: { fromNodeId: "a", toNodeId: "b" }
            }
          }
        }
      }
    }
  });

  assert.deepEqual(projection.edges.find((edge) => edge.id === "legacy")?.points, [
    { x: 12, y: 22 },
    { x: 28, y: 38 }
  ]);
  assert.deepEqual(projection.edges.find((edge) => edge.id === "nodeFallback")?.points, [
    { x: 10, y: 20 },
    { x: 30, y: 40 }
  ]);
});

test("does not invent topology or actions when content is absent", () => {
  const projection = projectBoardSession({ state: { public: { session: { phase: "setup" } } } });

  assert.deepEqual(projection.nodes, []);
  assert.deepEqual(projection.edges, []);
  assert.deepEqual(projection.availableActions, []);
  assert.equal(projection.bounds, null);
});

test("provides only server-published controls without constructing a Phaser scene", () => {
  const params = { nodeId: "b" };
  const session = {
    state: {
      public: {
        session: { phase: "construction" },
        board: {
          availableActions: [{
            id: "select-node",
            label: "Выбрать узел",
            actionId: "network.node.select",
            params
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);

  assert.deepEqual(actions, [{
    id: "select-node",
    label: "Выбрать узел",
    actionId: "network.node.select",
    params: { nodeId: "b" },
    disabled: false
  }]);
  assert.notEqual(actions[0]?.params, params);
});

test("projects free road choices as an accessible parameter form", () => {
  const session = {
    state: {
      public: {
        session: { phase: "construction" },
        teams: {
          carriers: { label: "Перевозчики", type: "logistics_company", coins: 10 }
        },
        objects: {
          networkNodes: {
            a: { attributes: { label: "Станция A", position: { x: 10, y: 20 } } },
            b: { attributes: { label: "Станция B", position: { x: 30, y: 40 } } }
          }
        },
        board: {
          availableActions: [{
            id: "build-road",
            label: "Построить дорогу",
            actionId: "construction.road.build",
            params: { carriersContribution: 0 }
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const [action] = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.deepEqual(action?.fields?.map((field) => field.name), [
    "fromNodeId",
    "toNodeId",
    "carriersContribution"
  ]);
  assert.deepEqual(action?.preview, {
    kind: "transport-road",
    endpointParameters: { from: "fromNodeId", to: "toNodeId" }
  });
  const fromNode = action?.fields?.[0];
  assert.equal(fromNode?.kind, "select");
  if (fromNode?.kind === "select") {
    assert.deepEqual(fromNode.options, [
      { value: "a", label: "Станция A" },
      { value: "b", label: "Станция B" }
    ]);
  }
});

test("disables a board control when canonical server availability rejects it", () => {
  const session = {
    actionAvailability: [{
      actionId: "network.node.select",
      status: "unavailable",
      reasonCode: "role_not_allowed",
      basisStateVersion: 3
    }],
    state: {
      public: {
        board: {
          availableActions: [{
            id: "select-node",
            label: "Выбрать узел",
            actionId: "network.node.select"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  assert.deepEqual(provideCardsMoneyTrainsAccessibleBoardActions(session), [{
    id: "select-node",
    label: "Выбрать узел",
    description: "Действие недоступно для текущей роли.",
    actionId: "network.node.select",
    disabled: true
  }]);
});

test("keeps an API 2.0 plugin loadable when an older host lacks the new capability", () => {
  let disposed = false;
  const legacyApi = {
    registerGameConfigData() {},
    registerGameConfigFactory() {},
    registerPhaserSceneFactory() {
      return () => { disposed = true; };
    }
  } as unknown as Parameters<typeof registerCardsMoneyTrainsPlayer>[0];

  const sceneFactory = ((() => {
    throw new Error("Scene is not created during registration.");
  }) as Parameters<typeof registerCardsMoneyTrainsPlayer>[1]);
  const dispose = registerCardsMoneyTrainsPlayer(legacyApi, sceneFactory);
  dispose();

  assert.equal(disposed, true);
});
