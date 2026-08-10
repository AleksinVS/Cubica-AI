/** Focused tests for the Estate Race public projection without loading Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTATE_AUCTION_BID_MAX,
  isStructurallyValidEstateAuctionBid,
  provideEstateRaceAccessibleBoardActions
} from "../src/accessible-actions.ts";
import { projectEstateRaceSession } from "../src/board-state.ts";
import { activate } from "../src/index.ts";

test("projects cells, participants, roll and only runtime-declared actions", () => {
  const projection = projectEstateRaceSession({
    state: {
      public: {
        turn: { activePlayerId: "p2", phase: "rent", turnNumber: 4 },
        board: {
          lastRoll: { values: [2, 3], total: 5, isDouble: false },
          availableActions: [{
            id: "pay",
            label: "Оплатить ренту",
            actionId: "property.rent.cell-05",
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
        p1: { metrics: { cash: 764, position: 5 }, flags: { inJail: true } },
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
  assert.equal(projection.players[1]?.inJail, false);
  assert.equal(projection.availableActions[0]?.actionId, "property.rent.cell-05");
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
            label: "Купить участок",
            description: "Подтверждение выполнит сервер",
            actionId: "property.buy.cell-02",
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
    label: "Купить участок",
    description: "Подтверждение выполнит сервер",
    actionId: "property.buy.cell-02",
    params: { cellId: "cell-02" },
    disabled: false
  }]);
  assert.notEqual(actions[0]?.params, params);
});

test("disables a board control when canonical server availability rejects it", () => {
  const session = {
    actionAvailability: [{
      actionId: "property.buy.cell-02",
      status: "unavailable",
      reasonCode: "state_condition_failed",
      basisStateVersion: 5
    }],
    state: {
      public: {
        board: {
          availableActions: [{
            id: "buy-cell",
            label: "Купить участок",
            actionId: "property.buy.cell-02"
          }]
        }
      }
    }
  } as unknown as Parameters<typeof provideEstateRaceAccessibleBoardActions>[0];

  assert.deepEqual(provideEstateRaceAccessibleBoardActions(session), [{
    id: "buy-cell",
    label: "Купить участок",
    description: "Действие недоступно в текущем состоянии игры.",
    actionId: "property.buy.cell-02",
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
