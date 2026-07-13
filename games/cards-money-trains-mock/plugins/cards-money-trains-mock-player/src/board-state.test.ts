/** Focused tests for public board projection without importing Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
import { projectBoardSession } from "./board-state.ts";
import { activate } from "./index.ts";

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
          wagons: {
            wagon1: { attributes: { nodeId: "a", ownerTeamId: "alpha" } },
            wagon2: { attributes: { nodeId: "b", ownerTeamId: "another-team" } }
          },
          newsCards: {
            news1: { attributes: { summary: "Дорога временно закрыта" } }
          },
          cargoCards: {
            cargo1: { attributes: { fromNodeId: "a", toNodeId: "b" } }
          }
        },
        decks: {
          news: { currentCardId: "news1" },
          cargo: { offer: { firstCardId: "cargo1", secondCardId: null } }
        },
        board: {
          canonicalBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          highlights: [{ targetType: "node", targetId: "b", actionId: "select.b", params: { nodeId: "b" } }],
          availableActions: [
            { id: "select-b", label: "Выбрать B", actionId: "select.b", params: { nodeId: "b" } },
            {
              id: "closed-road",
              label: "Проехать по закрытой дороге",
              actionId: "move.closed",
              phase: ["construction", "operations"],
              section: "network",
              disabled: true,
              disabledReason: "Дорога закрыта новостью"
            },
            { id: "future", label: "Будущее действие", actionId: "future.action", phase: "market" }
          ]
        },
        log: [{ kind: "movement", summary: "Локомотив прибыл на станцию B" }]
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
  assert.equal(projection.teams[0]?.locomotives, 1);
  assert.equal(projection.teams[0]?.wagons, 1);
  assert.equal(projection.highlights[0]?.actionId, "select.b");
  assert.equal(projection.availableActions[0]?.params?.nodeId, "b");
  assert.equal(projection.availableActions[1]?.disabled, true);
  assert.equal(projection.availableActions[1]?.description, "Дорога закрыта новостью");
  assert.equal(projection.availableActions[1]?.section, "network");
  assert.deepEqual(projection.availableActions[1]?.phases, ["construction", "operations"]);
  assert.equal(projection.availableActions.some((action) => action.id === "future"), false);
  assert.deepEqual(projection.actionSections.map((section) => section.id), ["actions", "network"]);
  assert.equal(projection.actionSections[1]?.actions[0]?.id, "closed-road");
  assert.equal(projection.log[0]?.summary, "Локомотив прибыл на станцию B");
  assert.equal(projection.currentNewsSummary, "Дорога временно закрыта");
  assert.deepEqual(projection.cargoOfferLabels, ["A → B"]);
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
                  polyline: [{ x: 10, y: 20 }, { x: Number.POSITIVE_INFINITY, y: 25 }],
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
  assert.deepEqual(projection.actionSections, []);
  assert.deepEqual(projection.teams, []);
  assert.deepEqual(projection.log, []);
  assert.equal(projection.bounds, null);
  assert.equal(projection.status, "unknown");
  assert.equal(projection.contentMode, "unknown");
  assert.equal(projection.currentNewsSummary, null);
  assert.deepEqual(projection.cargoOfferLabels, []);
});

test("disables an authored action when the server projects it as unavailable", () => {
  const projection = projectBoardSession({
    actionAvailability: [
      { actionId: "news.draw", status: "unavailable", reasonCode: "state_condition_failed" },
      { actionId: "news.apply", status: "available" }
    ],
    state: {
      public: {
        session: { phase: "news" },
        board: {
          availableActions: [
            {
              id: "draw",
              label: "Открыть новость",
              actionId: "news.draw",
              phase: "news",
              disabledReason: "Сначала примените уже открытую новость."
            },
            { id: "apply", label: "Применить новость", actionId: "news.apply", phase: "news" }
          ]
        }
      }
    }
  });

  assert.equal(projection.availableActions[0]?.disabled, true);
  assert.equal(
    projection.availableActions[0]?.disabledReason,
    "Сначала примените уже открытую новость."
  );
  assert.equal(projection.availableActions[1]?.disabled, false);
});

test("ignores malformed optional facilitator fields without inventing values", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        session: { turnNumber: "not-a-number", contentMode: null },
        teams: { alpha: "not-an-object" },
        log: [{ summary: "" }, null, "not-an-entry"],
        board: {
          availableActions: [
            { label: "No runtime action id" },
            { label: "Disabled", actionId: "disabled.action", disabled: true, reason: "Не хватает данных" }
          ]
        }
      }
    }
  });

  assert.equal(projection.turnNumber, 0);
  assert.deepEqual(projection.teams, []);
  assert.deepEqual(projection.log, []);
  assert.equal(projection.availableActions.length, 1);
  assert.equal(projection.availableActions[0]?.disabledReason, "Не хватает данных");
});

test("provides controls using the server-projected availability", () => {
  const session = {
    actionAvailability: [{
      actionId: "construction.road.build",
      status: "unavailable",
      reasonCode: "state_condition_failed"
    }],
    state: {
      public: {
        session: { phase: "construction" },
        board: {
          availableActions: [{
            id: "build-road",
            label: "Построить дорогу",
            actionId: "construction.road.build",
            params: { edgeId: "edge-1" },
            disabledReason: "Сначала выберите конечный узел."
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  assert.deepEqual(provideCardsMoneyTrainsAccessibleBoardActions(session), [{
    id: "build-road",
    label: "Построить дорогу",
    description: "Сначала выберите конечный узел.",
    actionId: "construction.road.build",
    params: { edgeId: "edge-1" },
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
  } as unknown as Parameters<typeof activate>[0];

  const dispose = activate(legacyApi);
  dispose();

  assert.equal(disposed, true);
});
