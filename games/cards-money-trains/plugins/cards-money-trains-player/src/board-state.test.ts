/** Focused tests for public board projection without importing Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
import { projectBoardSession } from "./board-state.ts";
import { registerCardsMoneyTrainsPlayer } from "./registration.ts";
import { TEAM_MARKER_COLOR_IDS } from "./team-palette.ts";

test("projects only provided topology, geometry, actions, and team balances", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        session: { phase: "construction", turnNumber: 3 },
        news: { currentCardId: "news-24" },
        movement: {
          locomotiveOrder: ["loco1"],
          currentLocomotiveId: "loco1"
        },
        objects: {
          teams: {
            alpha: {
              objectType: "game.team",
              facets: { placementStatus: "placed" },
              attributes: {
                label: "Альфа",
                type: "logistics_company",
                colorId: "cobalt",
                coins: 7,
                placementOrderKey: 0
              }
            }
          },
          newsCards: {
            "news-24": {
              objectType: "content.news-card",
              facets: { availability: "revealed" },
              attributes: {
                number: 24,
                text: "В этот ход компании не платят за обслуживание."
              }
            }
          },
          networkNodes: {
            a: {
              objectType: "transport.terminal",
              facets: { availability: "open" },
              attributes: {
                label: "A",
                position: { x: 10, y: 20 },
                countryId: "cmt-country-central"
              }
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
          wagons: {
            wagon1: {
              attributes: {
                nodeId: "a",
                ownerTeamId: "alpha",
                attachedVehicleId: "loco1",
                cargoId: "cargo1",
                formationTargetLocomotiveId: "loco1"
              }
            }
          },
          cargoOrders: {
            cargo1: {
              facets: { status: "in_transit" },
              attributes: { fromNodeId: "a", toNodeId: "b", payout: 12 }
            }
          }
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
  assert.deepEqual(projection.locomotiveOrder, ["loco1"]);
  assert.equal(projection.currentLocomotiveId, "loco1");
  assert.equal(projection.currentNewsId, "news-24");
  assert.deepEqual(projection.currentNews, {
    id: "news-24",
    number: 24,
    text: "В этот ход компании не платят за обслуживание."
  });
  assert.deepEqual(projection.nodes.map((node) => node.id), ["a", "b"]);
  assert.equal(projection.nodes[0]?.countryId, "cmt-country-central");
  assert.equal(projection.nodes[1]?.countryId, null);
  assert.equal(projection.edges[0]?.visualState, "building");
  assert.deepEqual(projection.edges[0]?.points, [
    { x: 10, y: 20 },
    { x: 18, y: 35 },
    { x: 30, y: 40 }
  ]);
  assert.deepEqual(projection.edges[0]?.from, { x: 10, y: 20 });
  assert.deepEqual(projection.edges[0]?.to, { x: 30, y: 40 });
  assert.equal(projection.vehicles[0]?.ownerTeamId, "alpha");
  assert.equal(projection.vehicles.find((vehicle) => vehicle.id === "wagon1")?.attachedVehicleId, "loco1");
  assert.equal(projection.vehicles.find((vehicle) => vehicle.id === "wagon1")?.cargoId, "cargo1");
  assert.equal(
    projection.vehicles.find((vehicle) => vehicle.id === "wagon1")
      ?.formationTargetLocomotiveId,
    "loco1"
  );
  assert.deepEqual(projection.cargos, [{
    id: "cargo1",
    status: "in_transit",
    fromNodeId: "a",
    toNodeId: "b",
    payout: 12
  }]);
  assert.equal(projection.teams[0]?.coins, 7);
  assert.equal(projection.teams[0]?.colorId, "cobalt");
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

test("bounds country references before they enter persistent node bindings", () => {
  const projection = projectBoardSession({
    state: {
      public: {
        objects: {
          networkNodes: {
            valid: {
              attributes: {
                position: { x: 1, y: 2 },
                countryId: "cmt-country-central"
              }
            },
            malformed: {
              attributes: {
                position: { x: 3, y: 4 },
                countryId: "NOT A SAFE ID"
              }
            },
            oversized: {
              attributes: {
                position: { x: 5, y: 6 },
                countryId: "x".repeat(65)
              }
            }
          }
        }
      }
    }
  });

  assert.equal(projection.nodes[0]?.countryId, "cmt-country-central");
  assert.equal(projection.nodes[1]?.countryId, null);
  assert.equal(projection.nodes[2]?.countryId, null);
});

test("does not invent topology or actions when content is absent", () => {
  const projection = projectBoardSession({ state: { public: { session: { phase: "setup" } } } });

  assert.deepEqual(projection.nodes, []);
  assert.deepEqual(projection.edges, []);
  assert.deepEqual(projection.availableActions, []);
  assert.deepEqual(projection.locomotiveOrder, []);
  assert.equal(projection.currentLocomotiveId, null);
  assert.equal(projection.bounds, null);
  assert.equal(projection.currentNews, null);
});

test("sanitizes the bounded server movement view without calculating a client order", () => {
  const oversizedOrder = Array.from({ length: 70 }, (_, index) => `loco-${index}`);
  const projection = projectBoardSession({
    state: {
      public: {
        movement: {
          locomotiveOrder: [
            "loco-east",
            "",
            42,
            "loco-west",
            "loco-east",
            ...oversizedOrder
          ],
          currentLocomotiveId: "loco-west"
        }
      }
    }
  });

  assert.deepEqual(projection.locomotiveOrder.slice(0, 4), [
    "loco-east",
    "loco-west",
    "loco-0",
    "loco-1"
  ]);
  assert.equal(projection.locomotiveOrder.length, 64);
  assert.equal(projection.currentLocomotiveId, "loco-west");

  const missingCurrent = projectBoardSession({
    state: {
      public: {
        movement: {
          locomotiveOrder: ["loco-east", "loco-east"],
          currentLocomotiveId: "loco-not-in-order"
        }
      }
    }
  });
  assert.deepEqual(missingCurrent.locomotiveOrder, ["loco-east"]);
  assert.equal(missingCurrent.currentLocomotiveId, null);
});

test("keeps a safe news-id fallback when the public card object is absent", () => {
  const projection = projectBoardSession({
    state: { public: { news: { currentCardId: "news-missing" } } }
  });

  assert.deepEqual(projection.currentNews, {
    id: "news-missing",
    number: null,
    text: null
  });
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

test("projects both team creation intents with exact text and palette fields", () => {
  const actionIds = [
    "session.setup.team.add.logistics-company",
    "session.setup.team.add.locomotive-guild"
  ];
  const session = {
    actionAvailability: actionIds.map((actionId) => ({
      actionId,
      status: "parameter-dependent",
      reasonCode: "parameters_required",
      basisStateVersion: 0
    })),
    state: {
      public: {
        session: { phase: "setup" },
        board: {
          availableActions: actionIds.map((actionId, index) => ({
            id: `add-team-${index}`,
            label: index === 0
              ? "Добавить компанию-перевозчика"
              : "Добавить паровозную гильдию",
            actionId,
            phase: "setup",
            section: "setup"
          }))
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.deepEqual(actions.map((action) => action.actionId), actionIds);
  for (const action of actions) {
    assert.deepEqual(action.fields, [{
      name: "name",
      label: "Название команды",
      kind: "text",
      required: true,
      minLength: 1,
      maxLength: 80,
      pattern: ".*\\S.*"
    }, {
      name: "colorId",
      label: "Цвет команды",
      kind: "select",
      required: true,
      options: TEAM_MARKER_COLOR_IDS.map((colorId) => ({
        value: colorId,
        label: colorId
      }))
    }]);
  }
});

test("projects setup placement and maintenance forms only from public objects", () => {
  const actionIds = [
    "session.setup.place.wagon",
    "session.setup.place.locomotive",
    "maintenance.pay.locomotive",
    "maintenance.pay.wagon",
    "maintenance.pay.held-cargo"
  ];
  const session = {
    actionAvailability: actionIds.map((actionId) => ({
      actionId,
      status: "parameter-dependent",
      reasonCode: "parameters_required",
      basisStateVersion: 4
    })),
    state: {
      public: {
        objects: {
          networkNodes: {
            "terminal-1": {
              objectType: "transport.terminal",
              attributes: {
                label: "Терминал 1",
                position: { x: 10, y: 20 }
              }
            },
            "waypoint-1": {
              objectType: "transport.waypoint",
              attributes: {
                label: "Полустанок 1",
                position: { x: 30, y: 40 }
              }
            }
          },
          locomotives: {
            "locomotive-1": {
              attributes: {
                nodeId: "terminal-1",
                ownerTeamId: null
              }
            }
          },
          wagons: {
            "wagon-1": {
              attributes: {
                nodeId: "waypoint-1",
                ownerTeamId: null
              }
            }
          },
          cargoOrders: {
            "cargo-visible": {
              facets: { status: "in_transit" },
              attributes: {
                fromNodeId: "terminal-1",
                toNodeId: "waypoint-1",
                payout: 9
              }
            },
            "cargo-hidden": {
              facets: { status: "hidden" },
              attributes: {
                fromNodeId: "terminal-1",
                toNodeId: "waypoint-1",
                payout: 999
              }
            }
          }
        },
        board: {
          availableActions: actionIds.map((actionId) => ({
            id: actionId,
            label: actionId,
            actionId,
            // Explicit forms must not silently submit an authored shortcut.
            params: { staleFixtureValue: true }
          }))
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  const byActionId = new Map(actions.map((action) => [action.actionId, action]));
  const wagonOptions = [{ value: "wagon-1", label: "wagon-1" }];
  const locomotiveOptions = [{
    value: "locomotive-1",
    label: "locomotive-1"
  }];
  const stationOptions = [{
    value: "terminal-1",
    label: "Терминал 1"
  }, {
    value: "waypoint-1",
    label: "Полустанок 1"
  }];

  assert.deepEqual(actions.map((action) => action.actionId), actionIds);
  assert.deepEqual(
    byActionId.get("session.setup.place.wagon")?.fields,
    [{
      name: "wagonId",
      label: "Вагон",
      kind: "select",
      required: true,
      options: wagonOptions
    }, {
      name: "stationId",
      label: "Станция или полустанок",
      kind: "select",
      required: true,
      options: stationOptions
    }]
  );
  assert.deepEqual(
    byActionId.get("session.setup.place.locomotive")?.fields,
    [{
      name: "locomotiveId",
      label: "Локомотив",
      kind: "select",
      required: true,
      options: locomotiveOptions
    }, {
      name: "stationId",
      label: "Станция или полустанок",
      kind: "select",
      required: true,
      options: stationOptions
    }]
  );
  assert.deepEqual(
    byActionId.get("maintenance.pay.locomotive")?.fields,
    [{
      name: "locomotiveId",
      label: "Локомотив",
      kind: "select",
      required: true,
      options: locomotiveOptions
    }]
  );
  assert.deepEqual(
    byActionId.get("maintenance.pay.wagon")?.fields,
    [{
      name: "wagonId",
      label: "Вагон",
      kind: "select",
      required: true,
      options: wagonOptions
    }]
  );
  assert.deepEqual(
    byActionId.get("maintenance.pay.held-cargo")?.fields,
    [{
      name: "cargoId",
      label: "Удерживаемый груз",
      kind: "select",
      required: true,
      options: [{
        value: "cargo-visible",
        label: "Терминал 1 → Полустанок 1 · 9 монет"
      }]
    }]
  );
  for (const action of actions) {
    assert.equal("params" in action, false);
  }
});

test("keeps parameter-dependent and legacy actions but hides server-unavailable actions", () => {
  const session = {
    actionAvailability: [{
      actionId: "cards.lifecycle.initialize",
      status: "unavailable",
      reasonCode: "state_condition_failed",
      basisStateVersion: 8
    }, {
      actionId: "maintenance.pay.wagon",
      status: "parameter-dependent",
      reasonCode: "parameters_required",
      basisStateVersion: 8
    }, {
      actionId: "session.play.start",
      status: "available",
      basisStateVersion: 8
    }],
    state: {
      public: {
        objects: {
          wagons: {
            "wagon-1": { attributes: { nodeId: "terminal-1" } }
          }
        },
        board: {
          availableActions: [{
            id: "initialize",
            label: "Инициализировать колоды",
            actionId: "cards.lifecycle.initialize"
          }, {
            id: "pay-wagon",
            label: "Оплатить вагон",
            actionId: "maintenance.pay.wagon"
          }, {
            id: "start",
            label: "Начать игру",
            actionId: "session.play.start",
            params: { staleFixtureValue: true }
          }, {
            id: "legacy",
            label: "Действие старого снимка",
            actionId: "legacy.public.action"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const projection = projectBoardSession(session);
  assert.equal(
    projection.availableActions.find((action) =>
      action.actionId === "cards.lifecycle.initialize")?.availabilityStatus,
    "unavailable"
  );
  assert.equal(
    projection.availableActions.find((action) =>
      action.actionId === "maintenance.pay.wagon")?.availabilityStatus,
    "parameter-dependent"
  );

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.deepEqual(actions.map((action) => action.actionId), [
    "maintenance.pay.wagon",
    "session.play.start",
    "legacy.public.action"
  ]);
  assert.deepEqual(actions[0]?.fields, [{
    name: "wagonId",
    label: "Вагон",
    kind: "select",
    required: true,
    options: [{ value: "wagon-1", label: "wagon-1" }]
  }]);
  assert.equal(actions[1]?.params, undefined);
});

test("projects cargo queue and offers without client-owned wagon or team authority", () => {
  const actionIds = [
    "cargo.queue.prepare",
    "cargo.offer.draw",
    "cargo.offer.select",
    "cargo.offer.skip"
  ];
  const session = {
    state: {
      public: {
        session: { phase: "cargo" },
        objects: {
          networkNodes: {
            "terminal-23": {
              objectType: "transport.terminal",
              attributes: {
                label: "Терминал 23",
                position: { x: 230, y: 20 }
              }
            },
            "terminal-3-14": {
              objectType: "transport.terminal",
              attributes: {
                label: "3,14",
                position: { x: 31, y: 40 }
              }
            },
            "waypoint-9-3-4": {
              objectType: "transport.waypoint",
              attributes: {
                label: "9¾",
                position: { x: 93, y: 40 }
              }
            },
            "terminal-1": {
              objectType: "transport.terminal",
              attributes: {
                label: "Терминал 1",
                position: { x: 10, y: 20 }
              }
            },
            "terminal-24": {
              objectType: "transport.terminal",
              attributes: {
                label: "Неигровой терминал",
                position: { x: 240, y: 20 }
              }
            },
            "terminal-2": {
              objectType: "transport.waypoint",
              attributes: {
                label: "Не терминал",
                position: { x: 20, y: 20 }
              }
            }
          },
          cargoOrders: {
            "cargo-offered-a": {
              facets: { status: "offered" },
              attributes: {
                fromNodeId: "terminal-1",
                toNodeId: "terminal-23",
                payout: 7
              }
            },
            "cargo-offered-b": {
              facets: { status: "offered" },
              attributes: {
                fromNodeId: "terminal-23",
                toNodeId: "terminal-1",
                payout: 11
              }
            },
            "cargo-already-available": {
              facets: { status: "available" },
              attributes: {
                fromNodeId: "terminal-1",
                toNodeId: "terminal-23",
                payout: 99
              }
            }
          },
          teams: {
            "carrier-b": {
              attributes: {
                label: "Перевозчик Б",
                type: "logistics_company",
                coins: 10
              }
            },
            guild: {
              attributes: {
                label: "Паровозная гильдия",
                type: "locomotive_guild",
                coins: 10
              }
            },
            "carrier-a": {
              attributes: {
                label: "Перевозчик А",
                type: "logistics_company",
                coins: 10
              }
            }
          }
        },
        board: {
          availableActions: actionIds.map((actionId) => ({
            id: actionId,
            label: actionId,
            actionId,
            // A stale authored shortcut must never override the explicit form.
            params: { terminalId: "fixed-sentinel" }
          }))
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  const byActionId = new Map(actions.map((action) => [action.actionId, action]));
  const terminalField = {
    name: "terminalId",
    label: "Терминал",
    kind: "select",
    required: true,
    options: [{
      value: "terminal-1",
      label: "Терминал 1"
    }, {
      value: "terminal-23",
      label: "Терминал 23"
    }]
  };

  assert.deepEqual(actions.map((action) => action.actionId), actionIds);
  for (const action of actions) {
    assert.equal("params" in action, false);
  }
  assert.deepEqual(byActionId.get("cargo.offer.draw")?.fields, [terminalField]);
  assert.deepEqual(byActionId.get("cargo.offer.skip")?.fields, [terminalField]);
  assert.equal(byActionId.get("cargo.queue.prepare")?.fields, undefined);
  assert.deepEqual(byActionId.get("cargo.offer.select")?.fields, [
    terminalField,
    {
      name: "cargoId",
      label: "Открытая грузовая карта",
      kind: "select",
      required: true,
      options: [{
        value: "cargo-offered-a",
        label: "Терминал 1 → Терминал 23 · 7 монет"
      }, {
        value: "cargo-offered-b",
        label: "Терминал 23 → Терминал 1 · 11 монет"
      }]
    }
  ]);
});

test("projects free road choices as an accessible parameter form", () => {
  const session = {
    state: {
      public: {
        session: { phase: "construction" },
        objects: {
          teams: {
            carriers: {
              objectType: "game.team",
              facets: { placementStatus: "placed" },
              attributes: {
                label: "Перевозчики",
                type: "logistics_company",
                colorId: "cobalt",
                coins: 10,
                placementOrderKey: 0
              }
            }
          },
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
    "toNodeId"
  ]);
  assert.equal("params" in (action ?? {}), false);
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

test("projects one dynamic construction contribution form for every actual team", () => {
  const session = {
    state: {
      public: {
        session: { phase: "construction" },
        objects: {
          teams: {
            carrier: {
              attributes: {
                label: "Перевозчик",
                type: "logistics_company",
                coins: 10
              }
            },
            guild: {
              attributes: {
                label: "Паровозная гильдия",
                type: "locomotive_guild",
                coins: 10
              }
            }
          }
        },
        board: {
          availableActions: [{
            id: "construction-contribution",
            label: "Установить вклад",
            actionId: "construction.contribution.set",
            params: { obsoleteContribution: 99 }
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const [action] = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.equal("params" in (action ?? {}), false);
  assert.deepEqual(action?.fields, [{
    name: "teamId",
    label: "Команда",
    kind: "select",
    required: true,
    options: [{
      value: "carrier",
      label: "Перевозчик"
    }, {
      value: "guild",
      label: "Паровозная гильдия"
    }]
  }, {
    name: "amount",
    label: "Сумма вклада",
    kind: "number",
    required: true,
    min: 0,
    step: 1
  }]);
});

test("projects movement as a dynamic public-edge form without choosing a locomotive", () => {
  const session = {
    actionAvailability: [
      { actionId: "movement.order.prepare", status: "available" },
      { actionId: "movement.locomotive.traverse", status: "available" },
      { actionId: "movement.locomotive.skip", status: "available" }
    ],
    state: {
      public: {
        objects: {
          networkNodes: {
            east: {
              attributes: {
                label: "Восточный терминал",
                position: { x: 100, y: 20 }
              }
            },
            west: {
              attributes: {
                label: "Западный терминал",
                position: { x: 20, y: 20 }
              }
            },
            north: {
              attributes: {
                label: "Северный терминал",
                position: { x: 60, y: 5 }
              }
            }
          },
          networkEdges: {
            "runtime-edge-east-west": {
              attributes: {
                fromNodeId: "east",
                toNodeId: "west"
              }
            },
            "runtime-edge-west-north": {
              attributes: {
                fromNodeId: "west",
                toNodeId: "north"
              }
            }
          }
        },
        board: {
          availableActions: [
            {
              id: "prepare",
              label: "Подготовить порядок",
              actionId: "movement.order.prepare"
            },
            {
              id: "traverse",
              label: "Переместить текущий локомотив",
              actionId: "movement.locomotive.traverse"
            },
            {
              id: "skip",
              label: "Пропустить",
              actionId: "movement.locomotive.skip"
            }
          ]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  assert.equal(actions.find((action) => action.actionId === "movement.order.prepare")?.fields, undefined);
  assert.equal(actions.find((action) => action.actionId === "movement.locomotive.skip")?.fields, undefined);

  const traverse = actions.find(
    (action) => action.actionId === "movement.locomotive.traverse"
  );
  assert.equal(traverse?.params, undefined);
  assert.deepEqual(traverse?.fields, [{
    name: "edgeId",
    label: "Дорога для движения",
    kind: "select",
    required: true,
    options: [
      {
        value: "runtime-edge-east-west",
        label: "Восточный терминал — Западный терминал"
      },
      {
        value: "runtime-edge-west-north",
        label: "Западный терминал — Северный терминал"
      }
    ]
  }]);
});

test("projects explicit wagon selection forms and parameterless confirmation", () => {
  const session = {
    actionAvailability: [
      { actionId: "movement.train.wagon.select", status: "available" },
      { actionId: "movement.train.wagon.unselect", status: "available" },
      { actionId: "movement.train.attach.selected", status: "available" }
    ],
    state: {
      public: {
        objects: {
          locomotives: {
            locomotive1: {
              attributes: {
                nodeId: "terminal-1",
                ownerTeamId: "guild-1"
              }
            }
          },
          wagons: {
            wagon2: {
              attributes: {
                nodeId: "terminal-2",
                ownerTeamId: "carrier-1",
                formationTargetLocomotiveId: null
              }
            },
            wagon1: {
              attributes: {
                nodeId: "terminal-1",
                ownerTeamId: "carrier-1",
                formationTargetLocomotiveId: "locomotive1"
              }
            }
          }
        },
        board: {
          availableActions: [
            {
              id: "select-wagon",
              label: "Отметить вагон",
              actionId: "movement.train.wagon.select"
            },
            {
              id: "unselect-wagon",
              label: "Снять отметку",
              actionId: "movement.train.wagon.unselect"
            },
            {
              id: "attach-wagons",
              label: "Сцепить отмеченные",
              actionId: "movement.train.attach.selected"
            }
          ]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  for (const actionId of [
    "movement.train.wagon.select",
    "movement.train.wagon.unselect"
  ]) {
    assert.deepEqual(
      actions.find((action) => action.actionId === actionId)?.fields,
      [{
        name: "wagonId",
        label: actionId.endsWith(".select")
          ? "Вагон для отметки"
          : "Вагон для снятия отметки",
        kind: "select",
        required: true,
        options: [
          { value: "wagon2", label: "wagon2" },
          { value: "wagon1", label: "wagon1" }
        ]
      }]
    );
  }
  assert.equal(
    actions.find((action) =>
      action.actionId === "movement.train.attach.selected")?.fields,
    undefined
  );
});

test("keeps hidden cargo out of the board view and cargo action controls", () => {
  const session = {
    actionAvailability: [
      { actionId: "cargo.load", status: "available" },
      { actionId: "cargo.phase.finish", status: "available" },
      { actionId: "settlement.cargo.deliver", status: "available" },
      { actionId: "settlement.phase.finish", status: "available" }
    ],
    state: {
      public: {
        objects: {
          networkNodes: {
            origin: {
              attributes: {
                label: "Порт отправления",
                position: { x: 10, y: 20 }
              }
            },
            destination: {
              attributes: {
                label: "Порт назначения",
                position: { x: 30, y: 40 }
              }
            }
          },
          wagons: {
            wagon2: { attributes: { nodeId: "destination" } },
            wagon1: { attributes: { nodeId: "origin", cargoId: "in-transit" } }
          },
          cargoOrders: {
            hidden: {
              facets: { status: "hidden" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 999
              }
            },
            malformed: {
              facets: { status: "secret-future-state" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 888
              }
            },
            available: {
              facets: { status: "available" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 17
              }
            },
            offered: {
              facets: { status: "offered" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 15
              }
            },
            "in-transit": {
              facets: { status: "in_transit" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 20
              }
            },
            delivered: {
              facets: { status: "delivered" },
              attributes: {
                fromNodeId: "origin",
                toNodeId: "destination",
                payout: 21
              }
            }
          }
        },
        board: {
          availableActions: [
            {
              id: "load",
              label: "Загрузить",
              actionId: "cargo.load",
              params: {
                teamId: "must-not-be-sent",
                payout: 999,
                route: "must-not-be-sent"
              }
            },
            {
              id: "finish-cargo",
              label: "Завершить погрузку",
              actionId: "cargo.phase.finish",
              params: { phase: "must-not-be-sent" }
            },
            {
              id: "deliver",
              label: "Доставить",
              actionId: "settlement.cargo.deliver",
              params: {
                cargoId: "must-be-derived",
                bonus: 999,
                tariff: 999
              }
            },
            {
              id: "finish-settlement",
              label: "Завершить расчёты",
              actionId: "settlement.phase.finish",
              params: { phase: "must-not-be-sent" }
            }
          ]
        }
      }
    }
  } as unknown as Parameters<typeof provideCardsMoneyTrainsAccessibleBoardActions>[0];

  const projection = projectBoardSession(session);
  assert.deepEqual(projection.cargos?.map((cargo) => cargo.id), [
    "available",
    "offered",
    "in-transit",
    "delivered"
  ]);
  assert.equal(projection.cargos?.some((cargo) => cargo.id === "hidden"), false);
  assert.equal(projection.cargos?.some((cargo) => cargo.id === "malformed"), false);

  const actions = provideCardsMoneyTrainsAccessibleBoardActions(session);
  const load = actions.find((action) => action.actionId === "cargo.load");
  assert.equal(load?.params, undefined);
  assert.deepEqual(load?.fields, [
    {
      name: "wagonId",
      label: "Вагон",
      kind: "select",
      required: true,
      options: [
        { value: "wagon2", label: "wagon2" },
        { value: "wagon1", label: "wagon1" }
      ]
    },
    {
      name: "cargoId",
      label: "Груз",
      kind: "select",
      required: true,
      options: [{
        value: "available",
        label: "Порт отправления → Порт назначения · 17 монет"
      }]
    }
  ]);

  const deliver = actions.find(
    (action) => action.actionId === "settlement.cargo.deliver"
  );
  assert.equal(deliver?.params, undefined);
  assert.deepEqual(deliver?.fields, [{
    name: "wagonId",
    label: "Вагон с доставленным грузом",
    kind: "select",
    required: true,
    options: [
      { value: "wagon2", label: "wagon2" },
      { value: "wagon1", label: "wagon1" }
    ]
  }]);

  for (const actionId of ["cargo.phase.finish", "settlement.phase.finish"]) {
    const action = actions.find((candidate) => candidate.actionId === actionId);
    assert.equal(action?.params, undefined);
    assert.equal(action?.fields, undefined);
  }

  const forbiddenNames = new Set([
    "teamId",
    "locomotiveId",
    "route",
    "payout",
    "bonus",
    "tariff",
    "phase"
  ]);
  for (const action of actions) {
    assert.equal(
      action.fields?.some((field) => forbiddenNames.has(field.name)) ?? false,
      false
    );
  }
});

test("keeps the rejected server verdict in the board view but omits its accessible form", () => {
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

  assert.deepEqual(projectBoardSession(session).availableActions, [{
    id: "select-node",
    label: "Выбрать узел",
    description: "Действие недоступно для текущей роли.",
    actionId: "network.node.select",
    params: undefined,
    disabled: true,
    availabilityStatus: "unavailable"
  }]);
  assert.deepEqual(provideCardsMoneyTrainsAccessibleBoardActions(session), []);
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
