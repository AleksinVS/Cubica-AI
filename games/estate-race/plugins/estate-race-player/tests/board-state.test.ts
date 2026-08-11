/** Focused tests for the Estate Race public projection without loading Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTATE_AUCTION_BID_MAX,
  isStructurallyValidEstateAuctionBid,
  provideEstateRaceAccessibleBoardActions
} from "../src/accessible-actions.ts";
import { projectEstateRaceSession, traceEstateTokenPath } from "../src/board-state.ts";
import { activate } from "../src/index.ts";

test("projects cells, participants, roll and only runtime-declared actions", () => {
  const projection = projectEstateRaceSession({
    actorPlayerId: "p1",
    state: {
      public: {
        turn: { activePlayerId: "p2", phase: "rent", turnNumber: 4 },
        board: {
          lastRoll: { values: [2, 3], total: 5, isDouble: false },
          availableActions: [{
            id: "pay",
            label: "Оплатить ренту",
            actionId: "property.rent",
            params: { cellId: "cell-05" }
          }]
        },
        objects: {
          boardCells: {
            "cell-05": {
              objectType: "estate.cell",
              attributes: {
                index: 5,
                label: "Медная улица",
                shortLabel: "Медная",
                kind: "estate",
                group: "coral",
                x: 100,
                y: 200,
                width: 240,
                height: 140,
                price: 160,
                rent: 24,
                rentScale: [24, 48, 132, 310, 500, 700],
                ownerPlayerId: "p1"
              }
            }
          }
        }
      },
      players: {
        p1: {
          metrics: { cash: 764, position: 5, jailAttempts: 2 },
          flags: { inJail: true },
          objects: { heldExitCardId: "event-exit" }
        },
        p2: { metrics: { cash: 900, position: 5 }, flags: { inJail: false } }
      }
    }
  });

  assert.equal(projection.phase, "rent");
  assert.equal(projection.turnNumber, 4);
  assert.equal(projection.lastRoll?.total, 5);
  assert.equal(projection.cells[0]?.ownerPlayerId, "p1");
  assert.equal(projection.cells[0]?.group, "coral");
  assert.deepEqual(projection.cells[0]?.rentScale, [24, 48, 132, 310, 500, 700]);
  assert.equal(projection.players[1]?.active, true);
  assert.equal(projection.players[0]?.inJail, true);
  assert.equal(projection.players[0]?.jailAttempts, 2);
  assert.equal(projection.players[0]?.heldExitCardId, "event-exit");
  assert.equal(projection.players[1]?.inJail, false);
  assert.equal(projection.players[1]?.heldExitCardId, null);
  assert.equal(projection.availableActions[0]?.actionId, "property.rent");
  assert.deepEqual(projection.availableActions[0]?.params, { cellId: "cell-05" });
});

test("keeps tax as a server-declared action without client parameters", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        turn: { phase: "tax" },
        board: { availableActions: [{ id: "tax", label: "Оплатить налог", actionId: "tax.pay" }] }
      }
    }
  });

  assert.equal(projection.phase, "tax");
  assert.deepEqual(projection.availableActions, [{
    id: "tax",
    label: "Оплатить налог",
    description: undefined,
    actionId: "tax.pay",
    params: undefined,
    disabled: false
  }]);
});

test("projects the complete server-owned auction state without deriving a bid threshold", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        turn: { activePlayerId: "p2", phase: "auction", turnNumber: 5 },
        auction: {
          resumePlayerId: "p1",
          cellId: "cell-05",
          currentBid: 40,
          minimumIncrement: 10,
          leaderPlayerId: "p2"
        },
        board: {
          availableActions: [
            { id: "auction-bid", label: "Сделать ставку", actionId: "property.auction.bid" },
            { id: "auction-pass", label: "Пас", actionId: "property.auction.pass" }
          ]
        }
      }
    }
  });

  assert.deepEqual(projection.auction, {
    resumePlayerId: "p1",
    cellId: "cell-05",
    currentBid: 40,
    minimumIncrement: 10,
    minimumNextBid: null,
    leaderPlayerId: "p2"
  });
  assert.deepEqual(projection.availableActions.map(({ actionId }) => actionId), [
    "property.auction.bid",
    "property.auction.pass"
  ]);
});

test("keeps a server-declared next-bid value display-only when present", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        auction: { currentBid: 40, minimumIncrement: 10, minimumNextBid: 75 }
      }
    }
  });

  assert.equal(projection.auction.minimumNextBid, 75);
});

test("projects S4 buildings, bank, window, auction and public request slots", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        bankBuildings: { housesAvailable: 30, hotelsAvailable: 11 },
        buildingWindow: { resumePlayerId: "p2", unitKind: "house" },
        buildingAuction: { currentBid: 75, minimumIncrement: 10, leaderPlayerId: "p1" },
        objects: { boardCells: {
          "cell-01": { attributes: {
            index: 1, kind: "estate", label: "A", improvementTier: 5, mortgaged: true
          } }
        } }
      },
      players: {
        p1: { objects: { bidderStatus: "leading", buildingRequestCellId: "cell-01", buildingRequestUnitKind: "hotel" } },
        p2: { objects: { bidderStatus: "passed" } }
      },
      secret: { players: { p1: { buildingRequestCellId: "secret-cell" } } }
    }
  });

  assert.deepEqual(projection.bankBuildings, { housesAvailable: 30, hotelsAvailable: 11 });
  assert.deepEqual(projection.buildingWindow, { resumePlayerId: "p2", unitKind: "house" });
  assert.deepEqual(projection.buildingAuction, {
    resumePlayerId: null,
    cellId: null,
    currentBid: 75,
    minimumIncrement: 10,
    minimumNextBid: null,
    leaderPlayerId: "p1"
  });
  assert.equal(projection.cells[0]?.improvementTier, 5);
  assert.equal(projection.cells[0]?.mortgaged, true);
  assert.equal(projection.players[0]?.bidderStatus, "leading");
  assert.equal(projection.players[0]?.buildingRequestCellId, "cell-01");
  assert.equal(projection.players[1]?.buildingRequestCellId, null);
  assert.equal("secret" in projection, false);
});

test("fails closed for malformed S4 projection values", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        bankBuildings: { housesAvailable: "32", hotelsAvailable: -1 },
        buildingWindow: { resumePlayerId: 7, unitKind: {} },
        buildingAuction: { currentBid: Infinity, minimumIncrement: "10", leaderPlayerId: [] },
        objects: { boardCells: { bad: { attributes: { index: 0, improvementTier: 9, mortgaged: "yes" } } } }
      }
    }
  });

  assert.deepEqual(projection.bankBuildings, { housesAvailable: 0, hotelsAvailable: 0 });
  assert.deepEqual(projection.buildingWindow, { resumePlayerId: null, unitKind: null });
  assert.equal(projection.buildingAuction.currentBid, 0);
  assert.equal(projection.cells[0]?.improvementTier, 0);
  assert.equal(projection.cells[0]?.mortgaged, false);
});

test("projects public S5 trade, obligation, liquidation and nullable ownership", () => {
  const projection = projectEstateRaceSession({
    actorPlayerId: "p2",
    state: {
      public: {
        trade: {
          status: "proposed", proposerPlayerId: "p1", targetPlayerId: "p2", resumePlayerId: "p1",
          offeredCash: 100, requestedCash: 40, offeredCardId: "event-exit", requestedCardId: null,
          claimCardId: null, claimPlayerId: ""
        },
        obligation: {
          status: "active", debtorPlayerId: "p2", creditorKind: "player", creditorPlayerId: "p1",
          amount: 250, perPartyAmount: 0, reason: "rent", resumePlayerId: "p1"
        },
        liquidation: {
          status: "pending", resumePlayerId: "p2", debtorPlayerId: "p1", creditorPlayerId: "",
          pendingCellId: "cell-05", claimCardId: null, claimCardId2: null
        },
        objects: { boardCells: {
          "cell-05": { attributes: { index: 5, kind: "estate", ownerPlayerId: null, tradeSide: "offered", liquidationPending: true } }
        } }
      },
      players: {
        p1: { objects: { heldExitCardId: "event-exit", heldExitCardId2: "fund-exit" } },
        p2: { objects: { heldExitCardId: "fund-exit", heldExitCardId2: "event-exit" } }
      }
    }
  });

  assert.equal(projection.trade.status, "proposed");
  assert.equal(projection.trade.offeredCardId, "event-exit");
  assert.equal(projection.obligation.amount, 250);
  assert.equal(projection.obligation.creditorKind, "player");
  assert.equal(projection.liquidation.pendingCellId, "cell-05");
  assert.equal(projection.cells[0]?.ownerPlayerId, null);
  assert.equal(projection.cells[0]?.tradeSide, "offered");
  assert.equal(projection.cells[0]?.liquidationPending, true);
  assert.equal(projection.players[0]?.heldExitCardId, null);
  assert.equal(projection.players[0]?.heldExitCardId2, null);
  assert.equal(projection.players[1]?.heldExitCardId, "fund-exit");
  assert.equal(projection.players[1]?.heldExitCardId2, "event-exit");
});

test("presents setup as the server-declared first action without client parameters", () => {
  const actions = provideEstateRaceAccessibleBoardActions({
    state: {
      public: {
        turn: { phase: "setup" },
        board: {
          availableActions: [{
            id: "setup-finalize",
            label: "Определить порядок",
            actionId: "session.setup.finalize"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.deepEqual(actions, [{
    id: "setup-finalize",
    label: "Определить порядок",
    actionId: "session.setup.finalize",
    disabled: false
  }]);
});

test("projects blocked phase as actionless server state", () => {
  const projection = projectEstateRaceSession({
    state: { public: { turn: { phase: "blocked" }, board: { availableActions: [] } } }
  });

  assert.equal(projection.phase, "blocked");
  assert.deepEqual(projection.availableActions, []);
});

test("keeps a jailed roll disabled from canonical action availability", () => {
  const actions = provideEstateRaceAccessibleBoardActions({
    actionAvailability: [{ actionId: "turn.roll", status: "unavailable", reasonCode: "state_condition_failed" }],
    state: {
      public: {
        turn: { phase: "roll" },
        board: { availableActions: [{ id: "roll", label: "Бросить кости", actionId: "turn.roll" }] }
      },
      players: { p1: { flags: { inJail: true } } }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.deepEqual(actions, [{
    id: "roll",
    label: "Бросить кости",
    description: "Действие недоступно в текущем состоянии игры.",
    actionId: "turn.roll",
    disabled: true
  }]);
});

test("projects only server-declared jail controls and actor-visible held state", () => {
  const projection = projectEstateRaceSession({
    actorPlayerId: "p1",
    state: {
      public: {
        turn: { activePlayerId: "p1", phase: "jail", turnNumber: 7 },
        board: {
          lastCardId: "event-exit",
          availableActions: [
            { id: "jail-pay", label: "Оплатить освобождение", actionId: "jail.pay" },
            { id: "jail-card-event", label: "Использовать карту выхода", actionId: "jail.card.use.event" },
            { id: "jail-roll", label: "Попытаться выбросить дубль", actionId: "jail.roll" }
          ]
        }
      },
      players: {
        p1: {
          metrics: { cash: 1200, position: 10, jailAttempts: 1 },
          flags: { inJail: true },
          objects: { heldExitCardId: "event-exit" }
        },
        p2: { metrics: { cash: 1200, position: 0, jailAttempts: 0 }, flags: { inJail: false } }
      }
    }
  });

  assert.equal(projection.lastCardId, "event-exit");
  assert.equal(projection.players[0]?.jailAttempts, 1);
  assert.equal(projection.players[0]?.heldExitCardId, "event-exit");
  assert.equal(projection.players[1]?.heldExitCardId, null);
  assert.deepEqual(projection.availableActions.map(({ actionId }) => actionId), [
    "jail.pay",
    "jail.card.use.event",
    "jail.roll"
  ]);

  const peerProjection = projectEstateRaceSession({
    state: {
      public: { turn: { activePlayerId: "p1", phase: "jail" }, board: { lastCardId: "event-exit" } },
      players: {
        p1: { metrics: { jailAttempts: 1 }, flags: { inJail: true }, objects: {} },
        p2: { metrics: { jailAttempts: 0 }, flags: { inJail: false } }
      },
      secret: { decks: { event: { held: ["event-exit"] } } }
    }
  });
  assert.equal(peerProjection.players[0]?.heldExitCardId, null);
  assert.equal("secret" in peerProjection, false);
});

test("keeps an unavailable auction bid disabled while exposing only the amount field", () => {
  const actions = provideEstateRaceAccessibleBoardActions({
    actionAvailability: [{
      actionId: "property.auction.bid",
      status: "unavailable",
      reasonCode: "state_condition_failed"
    }],
    state: {
      public: {
        turn: { phase: "auction" },
        auction: { currentBid: 40, minimumIncrement: 10 },
        board: {
          availableActions: [{
            id: "auction-bid",
            label: "Сделать ставку",
            actionId: "property.auction.bid",
            params: { cellId: "must-not-be-forwarded", amount: 999 }
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.equal(actions[0]?.disabled, true);
  assert.deepEqual(actions[0]?.params, undefined);
  assert.deepEqual(actions[0]?.fields, [{
    name: "amount",
    label: "Сумма ставки",
    kind: "number",
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    step: 1
  }]);
});

test("projects S4 building window, request and shortage-bid forms without forwarding params", () => {
  const actions = provideEstateRaceAccessibleBoardActions({
    actionAvailability: [{
      actionId: "property.build.auction.bid",
      status: "available"
    }],
    state: {
      public: {
        turn: { activePlayerId: "p2", phase: "buildingWindow" },
        board: {
          availableActions: [
            {
              id: "building-open",
              label: "Открыть окно застройки",
              actionId: "property.build",
              params: { unitKind: "hotel" }
            },
            {
              id: "building-request",
              label: "Подать заявку",
              actionId: "property.build.request",
              params: { cellId: "server-must-not-bypass-form" }
            },
            {
              id: "building-bid",
              label: "Сделать ставку",
              actionId: "property.build.auction.bid",
              params: { amount: 999 }
            },
            {
              id: "building-pass",
              label: "Пас",
              actionId: "property.build.auction.pass"
            },
            {
              id: "building-sell",
              label: "Продать строение",
              actionId: "property.sell",
              params: { cellId: "server-must-not-bypass-form" }
            },
            {
              id: "building-mortgage",
              label: "Заложить объект",
              actionId: "property.mortgage"
            },
            {
              id: "building-redeem",
              label: "Выкупить объект",
              actionId: "property.redeem"
            }
          ]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.deepEqual(actions.map(({ actionId }) => actionId), [
    "property.build",
    "property.build.request",
    "property.build.auction.bid",
    "property.build.auction.pass",
    "property.sell",
    "property.mortgage",
    "property.redeem"
  ]);
  assert.deepEqual(actions[0]?.params, undefined);
  assert.deepEqual(actions[0]?.fields, [{
    name: "unitKind",
    label: "Тип строения",
    kind: "select",
    required: true,
    options: [
      { value: "house", label: "Дом" },
      { value: "hotel", label: "Отель" }
    ]
  }]);
  assert.deepEqual(actions[1]?.params, undefined);
  assert.deepEqual(actions[1]?.fields, [{
    name: "cellId",
    label: "Идентификатор участка",
    kind: "text",
    required: true,
    minLength: 1,
    maxLength: 128
  }]);
  assert.deepEqual(actions[2]?.params, undefined);
  assert.deepEqual(actions[2]?.fields, [{
    name: "amount",
    label: "Сумма ставки",
    kind: "number",
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    step: 1
  }]);
  assert.deepEqual(actions[3], {
    id: "building-pass",
    label: "Пас",
    actionId: "property.build.auction.pass",
    disabled: false
  });
  for (const action of actions.slice(4)) {
    assert.deepEqual(action.params, undefined);
    assert.deepEqual(action.fields, [{
      name: "cellId",
      label: "Идентификатор участка",
      kind: "text",
      required: true,
      minLength: 1,
      maxLength: 128
    }]);
  }
});

test("projects S5 parameter forms from schemas without forwarding server params", () => {
  const actionIds = [
    "trade.open", "trade.cash.set", "trade.asset.set", "trade.asset.remove",
    "trade.card.offer", "trade.card.request", "bankruptcy.declare"
  ];
  const actions = provideEstateRaceAccessibleBoardActions({
    state: {
      public: { board: { availableActions: actionIds.map((actionId) => ({
        id: actionId, label: actionId, actionId,
        params: { targetPlayerId: "server", offeredCash: 999, requestedCash: 999, cellId: "server", side: "server", cardId: "server", heldCardId: "server", heldCardId2: "server" }
      })) } }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.deepEqual(actions.map(({ params }) => params), actionIds.map(() => undefined));
  assert.deepEqual(actions[0]?.fields, [{
    name: "targetPlayerId", label: "Участник сделки", kind: "text", required: true, minLength: 1, maxLength: 128
  }]);
  assert.deepEqual(actions[1]?.fields?.map(({ name }) => name), ["offeredCash", "requestedCash"]);
  assert.deepEqual(actions[2]?.fields?.map(({ name }) => name), ["cellId", "side"]);
  assert.deepEqual(actions[3]?.fields?.map(({ name }) => name), ["cellId"]);
  assert.deepEqual(actions[4]?.fields?.map(({ name }) => name), ["cardId"]);
  assert.deepEqual(actions[5]?.fields?.map(({ name }) => name), ["cardId"]);
  assert.deepEqual(actions[6]?.fields?.map(({ name }) => name), ["heldCardId", "heldCardId2"]);
  assert.deepEqual(actions[6]?.fields?.map(({ required, defaultValue }) => ({ required, defaultValue })), [
    { required: false, defaultValue: "" },
    { required: false, defaultValue: "" }
  ]);
});

test("validates only the bid JSON-schema boundary in the client", () => {
  assert.equal(isStructurallyValidEstateAuctionBid(0), true);
  assert.equal(isStructurallyValidEstateAuctionBid(ESTATE_AUCTION_BID_MAX), true);
  assert.equal(isStructurallyValidEstateAuctionBid(-1), false);
  assert.equal(isStructurallyValidEstateAuctionBid(10.5), false);
  assert.equal(isStructurallyValidEstateAuctionBid(ESTATE_AUCTION_BID_MAX + 1), false);
  assert.equal(isStructurallyValidEstateAuctionBid("50"), false);
});

test("does not invent auction, buy, rent or decline actions absent from the public snapshot", () => {
  const actions = provideEstateRaceAccessibleBoardActions({
    state: {
      public: {
        turn: { phase: "auction" },
        board: { availableActions: [{ id: "pass", label: "Пас", actionId: "property.auction.pass" }] }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0]);

  assert.deepEqual(actions.map(({ actionId }) => actionId), ["property.auction.pass"]);
});

test("projects all six hotseat participants without assuming fixed player ids", () => {
  const players = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
    `seat-${index + 1}`,
    { metrics: { cash: 1200 - index * 10, position: index } }
  ]));
  const projection = projectEstateRaceSession({
    state: {
      public: { turn: { activePlayerId: "seat-6", phase: "roll", turnNumber: 8 } },
      players
    }
  });

  assert.equal(projection.players.length, 6);
  assert.equal(projection.players[5]?.id, "seat-6");
  assert.equal(projection.players[5]?.active, true);
});

test("animates the shortest confirmed arc for forward and backward card movement", () => {
  const cells = projectEstateRaceSession({
    state: {
      public: {
        objects: {
          boardCells: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
            `cell-${index}`,
            { attributes: { index, kind: "neutral" } }
          ]))
        }
      }
    }
  }).cells;

  assert.deepEqual(traceEstateTokenPath(cells, 3, 38).map(({ index }) => index), [2, 1, 0, 39, 38]);
  assert.deepEqual(traceEstateTokenPath(cells, 36, 2).map(({ index }) => index), [37, 38, 39, 0, 1, 2]);
});

test("does not invent legal actions or expose malformed state", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        turn: { activePlayerId: "p1", phase: "roll", turnNumber: 1 },
        board: { availableActions: [{ label: "Missing id" }] },
        objects: { boardCells: { broken: { attributes: { index: "bad" } } } }
      },
      players: { p1: { metrics: { cash: "secret", position: null } } },
      secret: { random: { seed: "must-not-project" } }
    }
  });

  assert.deepEqual(projection.availableActions, []);
  assert.equal(projection.players[0]?.cash, 0);
  assert.equal(projection.lastRoll, null);
  assert.equal("secret" in projection, false);
});

test("provides server-declared controls without constructing a Phaser scene", () => {
  const params = { cellId: "cell-02" };
  const session = {
    state: {
      public: {
        turn: { phase: "acquire" },
        board: {
          availableActions: [{
            id: "buy-cell",
            label: "Купить объект",
            description: "Подтверждение выполнит сервер",
            actionId: "property.buy",
            params,
            disabled: false
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0];

  const actions = provideEstateRaceAccessibleBoardActions(session);

  assert.deepEqual(actions, [{
    id: "buy-cell",
    label: "Купить объект",
    description: "Подтверждение выполнит сервер",
    actionId: "property.buy",
    params: { cellId: "cell-02" },
    disabled: false
  }]);
  assert.notEqual(actions[0]?.params, params);
});

test("disables a board control when canonical server availability rejects it", () => {
  const session = {
    actionAvailability: [{
      actionId: "property.buy",
      status: "unavailable",
      reasonCode: "state_condition_failed",
      basisStateVersion: 5
    }],
    state: {
      public: {
        board: {
          availableActions: [{
            id: "buy-cell",
            label: "Купить объект",
            actionId: "property.buy"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0];

  assert.deepEqual(provideEstateRaceAccessibleBoardActions(session), [{
    id: "buy-cell",
    label: "Купить объект",
    description: "Действие недоступно в текущем состоянии игры.",
    actionId: "property.buy",
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
