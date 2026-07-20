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
        session: {
          phase: "construction",
          turnNumber: 3,
          locomotiveOrder: ["loco1"]
        },
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
            loco1: {
              facets: { availability: "active" },
              attributes: { nodeId: "a", ownerTeamId: "alpha" }
            }
          },
          wagons: {
            wagon1: {
              facets: { availability: "active" },
              attributes: { nodeId: "a", ownerTeamId: "alpha" }
            },
            wagon2: {
              facets: { availability: "active" },
              attributes: { nodeId: "b", ownerTeamId: "another-team" }
            }
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
  assert.deepEqual(projection.locomotiveOrder, [{
    id: "loco1",
    ownerLabel: "Альфа",
    nodeLabel: "A"
  }]);
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
  assert.deepEqual(projection.cargoOfferIds, ["cargo1"]);
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
  assert.deepEqual(projection.cargoOrders, []);
  assert.deepEqual(projection.cargoOfferIds, []);
  assert.deepEqual(projection.locomotiveOrder, []);
});

test("disables an authored action when the server projects it as unavailable", () => {
  const projection = projectBoardSession({
    actionAvailability: [
      {
        actionId: "news.draw",
        status: "unavailable",
        reasonCode: "state_condition_failed",
        basisStateVersion: 4
      },
      { actionId: "news.apply", status: "available", basisStateVersion: 4 }
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
      reasonCode: "state_condition_failed",
      basisStateVersion: 2
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
    preview: {
      kind: "transport-road",
      endpointParameters: { from: "fromNodeId", to: "toNodeId" }
    },
    disabled: true
  }]);
});

test("projects free waypoint choices as an accessible parameter form", () => {
  const session = {
    state: {
      public: {
        session: { phase: "construction" },
        objects: {
          networkNodes: {
            a: { attributes: { label: "Станция A", position: { x: 10, y: 20 } } },
            b: { attributes: { label: "Станция B", position: { x: 30, y: 40 } } }
          },
          networkEdges: {
            edge1: { attributes: { fromNodeId: "a", toNodeId: "b" } }
          }
        },
        board: {
          availableActions: [{
            id: "build-waypoint",
            label: "Построить полустанок",
            actionId: "construction.waypoint.build",
            params: { positionT: 0.5 }
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const [action] = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.deepEqual(action?.fields?.map((field) => field.name), ["edgeId", "positionT"]);
  const edge = action?.fields?.[0];
  assert.equal(edge?.kind, "select");
  if (edge?.kind === "select") {
    assert.deepEqual(edge.options, [{ value: "edge1", label: "Станция A — Станция B" }]);
  }
});

test("projects only explicitly active transport units", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        objects: {
          locomotives: {
            active: {
              facets: { availability: "active" },
              attributes: { nodeId: "a", ownerTeamId: "team-a" }
            },
            reserve: {
              facets: { availability: "reserve" },
              attributes: { nodeId: "a", ownerTeamId: "team-a" }
            },
            missingFacet: {
              attributes: { nodeId: "a", ownerTeamId: "team-a" }
            }
          },
          wagons: {
            sold: {
              facets: { availability: "sold" },
              attributes: { nodeId: "a", ownerTeamId: "team-a" }
            }
          }
        }
      }
    }
  });

  assert.deepEqual(projection.vehicles.map((vehicle) => vehicle.id), ["active"]);
});

test("provides dynamic locomotive and road choices without encoding movement legality", () => {
  const session = {
    state: {
      public: {
        session: { phase: "operations" },
        teams: {
          guild: { label: "Фиолетовая гильдия", type: "locomotive_guild", coins: 10 }
        },
        objects: {
          networkNodes: {
            a: { attributes: { label: "Станция A", position: { x: 10, y: 20 } } },
            b: { attributes: { label: "Станция B", position: { x: 30, y: 40 } } }
          },
          networkEdges: {
            closedEdge: {
              facets: { state: "blocked" },
              attributes: { fromNodeId: "a", toNodeId: "b" }
            }
          },
          locomotives: {
            activeLoco: {
              facets: { availability: "active" },
              attributes: { nodeId: "a", ownerTeamId: "guild" }
            },
            reserveLoco: {
              facets: { availability: "reserve" },
              attributes: { nodeId: "b", ownerTeamId: "guild" }
            }
          }
        },
        board: {
          availableActions: [{
            id: "move-locomotive",
            label: "Переместить локомотив",
            actionId: "mock.locomotive.move",
            phase: "operations"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const [action] = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.equal(action?.actionId, "mock.locomotive.move");
  assert.deepEqual(action?.fields?.map((field) => field.name), ["vehicleId", "edgeId"]);
  const vehicleField = action?.fields?.[0];
  const edgeField = action?.fields?.[1];
  assert.equal(vehicleField?.kind, "select");
  assert.equal(edgeField?.kind, "select");
  if (vehicleField?.kind === "select") {
    assert.deepEqual(vehicleField.options, [{
      value: "activeLoco",
      label: "Фиолетовая гильдия · Станция A · активен · activeLoco"
    }]);
  }
  if (edgeField?.kind === "select") {
    // The closed road remains a visible choice. Runtime, not this projection,
    // is responsible for refusing traversal through its current state.
    assert.deepEqual(edgeField.options, [{
      value: "closedEdge",
      label: "Станция A — Станция B"
    }]);
  }
});

test("projects cargo choices only from public orders and public offer slots", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        objects: {
          cargoOrders: {
            publicAvailable: {
              facets: { status: "available" },
              attributes: {
                fromNodeId: "a",
                toNodeId: "b",
                payout: 9
              }
            },
            publicDelivered: {
              facets: { status: "delivered" },
              attributes: {
                fromNodeId: "b",
                toNodeId: "a",
                payout: 4
              }
            }
          }
        },
        decks: {
          cargo: {
            offer: {
              firstCardId: "publicAvailable",
              secondCardId: "publicDelivered"
            }
          }
        }
      },
      secret: {
        objects: {
          cargoOrders: {
            futureSecret: {
              facets: { status: "available" },
              attributes: {
                fromNodeId: "a",
                toNodeId: "b",
                payout: 999
              }
            }
          }
        },
        decks: {
          cargo: {
            futureOrder: ["futureSecret"]
          }
        }
      }
    }
  });

  assert.deepEqual(projection.cargoOrders, [
    {
      id: "publicAvailable",
      fromNodeId: "a",
      toNodeId: "b",
      status: "available",
      payout: 9
    },
    {
      id: "publicDelivered",
      fromNodeId: "b",
      toNodeId: "a",
      status: "delivered",
      payout: 4
    }
  ]);
  assert.deepEqual(projection.cargoOfferIds, ["publicAvailable", "publicDelivered"]);
  assert.equal(
    projection.cargoOrders.some((cargo) => cargo.id === "futureSecret"),
    false
  );
});

test("provides public dynamic fields for cargo loading, coupling, and delivery", () => {
  const session = {
    state: {
      public: {
        session: { phase: "operations" },
        teams: {
          guild: { label: "Зелёная гильдия", type: "locomotive_guild", coins: 10 },
          carrier: { label: "Красный перевозчик", type: "logistics_company", coins: 10 }
        },
        objects: {
          networkNodes: {
            a: { attributes: { label: "Станция A", position: { x: 10, y: 20 } } },
            b: { attributes: { label: "Станция B", position: { x: 30, y: 40 } } }
          },
          locomotives: {
            activeLoco: {
              facets: { availability: "active" },
              attributes: { nodeId: "a", ownerTeamId: "guild" }
            },
            reserveLoco: {
              facets: { availability: "reserve" },
              attributes: { nodeId: "b", ownerTeamId: "guild" }
            }
          },
          wagons: {
            activeWagon: {
              facets: { availability: "active" },
              attributes: { nodeId: "b", ownerTeamId: "carrier" }
            },
            soldWagon: {
              facets: { availability: "sold" },
              attributes: { nodeId: "a", ownerTeamId: "carrier" }
            }
          },
          cargoOrders: {
            availableCargo: {
              facets: { status: "available" },
              attributes: { fromNodeId: "a", toNodeId: "b", payout: 9 }
            },
            deliveredCargo: {
              facets: { status: "delivered" },
              attributes: { fromNodeId: "b", toNodeId: "a", payout: 4 }
            }
          }
        },
        decks: {
          cargo: {
            offer: {
              firstCardId: "availableCargo",
              secondCardId: "deliveredCargo"
            }
          }
        },
        board: {
          availableActions: [
            {
              id: "load",
              label: "Загрузить",
              actionId: "mock.cargo.load.white"
            },
            {
              id: "attach",
              label: "Прицепить",
              actionId: "mock.operations.attach.white"
            },
            {
              id: "detach",
              label: "Отцепить",
              actionId: "mock.operations.detach.white"
            },
            {
              id: "deliver",
              label: "Доставить",
              actionId: "mock.cargo.deliver"
            }
          ]
        }
      },
      secret: {
        objects: {
          cargoOrders: {
            secretFutureCargo: {
              facets: { status: "available" },
              attributes: { fromNodeId: "a", toNodeId: "b", payout: 100 }
            }
          }
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  const byId = new Map(actions.map((action) => [action.actionId, action]));
  const load = byId.get("mock.cargo.load.white");
  const attach = byId.get("mock.operations.attach.white");
  const detach = byId.get("mock.operations.detach.white");
  const deliver = byId.get("mock.cargo.deliver");

  assert.deepEqual(load?.fields?.map((field) => field.name), ["wagonId", "cargoId"]);
  assert.deepEqual(attach?.fields?.map((field) => field.name), ["vehicleId", "wagonId"]);
  assert.deepEqual(detach?.fields?.map((field) => field.name), ["vehicleId", "wagonId"]);
  assert.deepEqual(deliver?.fields?.map((field) => field.name), ["wagonId", "cargoId"]);

  const loadWagons = load?.fields?.[0];
  const offeredCargo = load?.fields?.[1];
  const attachLocomotives = attach?.fields?.[0];
  const attachWagons = attach?.fields?.[1];
  const deliverCargo = deliver?.fields?.[1];

  if (loadWagons?.kind === "select") {
    assert.deepEqual(loadWagons.options, [{
      value: "activeWagon",
      label: "Красный перевозчик · Станция B · активен · activeWagon"
    }]);
  }
  if (offeredCargo?.kind === "select") {
    // A delivered offer is still shown: only runtime may reject its status.
    assert.deepEqual(offeredCargo.options, [
      {
        value: "availableCargo",
        label: "Станция A → Станция B · доступен · выплата 9 · availableCargo"
      },
      {
        value: "deliveredCargo",
        label: "Станция B → Станция A · доставлен · выплата 4 · deliveredCargo"
      }
    ]);
  }
  if (attachLocomotives?.kind === "select") {
    assert.deepEqual(attachLocomotives.options, [{
      value: "activeLoco",
      label: "Зелёная гильдия · Станция A · активен · activeLoco"
    }]);
  }
  if (attachWagons?.kind === "select") {
    assert.deepEqual(attachWagons.options.map((option) => option.value), ["activeWagon"]);
  }
  if (deliverCargo?.kind === "select") {
    assert.deepEqual(
      deliverCargo.options.map((option) => option.value),
      ["availableCargo", "deliveredCargo"]
    );
    assert.equal(
      deliverCargo.options.some((option) => option.value === "secretFutureCargo"),
      false
    );
  }
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
