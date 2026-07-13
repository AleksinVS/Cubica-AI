/** Focused tests for the Estate Race public projection without loading Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import { provideEstateRaceAccessibleBoardActions } from "../src/accessible-actions.ts";
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
                x: 100,
                y: 200,
                width: 240,
                height: 140,
                price: 160,
                rent: 24,
                ownerPlayerId: "p1"
              }
            }
          }
        }
      },
      players: {
        p1: { metrics: { cash: 764, position: 5 } },
        p2: { metrics: { cash: 900, position: 5 } }
      }
    }
  });

  assert.equal(projection.phase, "rent");
  assert.equal(projection.turnNumber, 4);
  assert.equal(projection.lastRoll?.total, 5);
  assert.equal(projection.cells[0]?.ownerPlayerId, "p1");
  assert.equal(projection.players[1]?.active, true);
  assert.equal(projection.availableActions[0]?.actionId, "property.rent.cell-05");
  assert.deepEqual(projection.availableActions[0]?.params, { cellId: "cell-05" });
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
      reasonCode: "state_condition_failed"
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
