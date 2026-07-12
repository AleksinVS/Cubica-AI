/** Focused tests for the Estate Race public projection without loading Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import { projectEstateRaceSession } from "../src/board-state.ts";

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
