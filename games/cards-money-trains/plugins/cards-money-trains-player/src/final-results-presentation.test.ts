/** Focused tests for the fail-closed, read-only final-results projection. */

import assert from "node:assert/strict";
import test from "node:test";

import type { TeamSummaryView } from "./board-state.ts";
import {
  finalStandingLabel,
  readFinalResults
} from "./final-results-presentation.ts";

const teams: readonly TeamSummaryView[] = [
  {
    id: "carrier-a",
    label: "Северный экспресс",
    type: "logistics_company",
    coins: 17,
    placementStatus: "placed",
    outstandingDebt: 2,
    colorId: "cobalt"
  },
  {
    id: "guild-a",
    label: "Гильдия А",
    type: "locomotive_guild",
    coins: 19,
    placementStatus: "placed",
    outstandingDebt: 0
  },
  {
    id: "guild-b",
    label: "Гильдия Б",
    type: "locomotive_guild",
    coins: 17,
    placementStatus: "placed",
    outstandingDebt: 0
  }
];

const validResults = () => ({
  status: "calculated",
  completedTurn: 7,
  purchasePrice: { wagon: 4, locomotive: 12 },
  rankings: {
    "logistics-companies": {
      standings: [{
        entityId: "carrier-a",
        baseValue: 15,
        relatedValue: 8,
        score: 23,
        relatedItems: [
          { entityId: "wagon-1", value: 4 },
          { entityId: "wagon-2", value: 4 }
        ],
        rank: 1
      }],
      winners: ["carrier-a"],
      tiedForFirst: false
    },
    "locomotive-guilds": {
      standings: [
        {
          entityId: "guild-a",
          baseValue: 19,
          relatedValue: 12,
          score: 31,
          relatedItems: [{ entityId: "locomotive-1", value: 12 }],
          rank: 1
        },
        {
          entityId: "guild-b",
          baseValue: 17,
          relatedValue: 14,
          score: 31,
          relatedItems: [{ entityId: "locomotive-2", value: 14 }],
          rank: 1
        }
      ],
      winners: ["guild-a", "guild-b"],
      tiedForFirst: true
    }
  }
});

test("projects authoritative standings and preserves their explanation", () => {
  const projected = readFinalResults(validResults(), teams, "finished");

  assert.equal(projected?.completedTurn, 7);
  assert.deepEqual(projected?.purchasePrice, { wagon: 4, locomotive: 12 });
  const carrier = projected?.rankings["logistics-companies"].standings[0];
  assert.deepEqual(carrier?.relatedItems, [
    { entityId: "wagon-1", value: 4 },
    { entityId: "wagon-2", value: 4 }
  ]);
  assert.equal(carrier?.label, "Северный экспресс");
  assert.equal(carrier?.winner, true);
  assert.equal(finalStandingLabel(carrier!), "★ 1. Северный экспресс — 23");
  assert.equal(
    projected?.rankings["locomotive-guilds"].standings.every(
      (standing) => standing.winner
    ),
    true
  );
  assert.equal(Object.isFrozen(projected), true);
});

test("never exposes provisional results before the finished phase", () => {
  assert.equal(readFinalResults(validResults(), teams, "reporting"), null);
});

test("rejects contradictory winners instead of ranking in the browser", () => {
  const contradictory = validResults();
  contradictory.rankings["locomotive-guilds"].winners = ["guild-a"];
  contradictory.rankings["locomotive-guilds"].tiedForFirst = false;

  assert.equal(readFinalResults(contradictory, teams, "finished"), null);
});

test("rejects malformed totals, unknown teams and oversized explanations", () => {
  const wrongTotal = validResults();
  wrongTotal.rankings["logistics-companies"].standings[0]!.score = 999;
  assert.equal(readFinalResults(wrongTotal, teams, "finished"), null);

  const unknownTeam = validResults();
  unknownTeam.rankings["logistics-companies"].standings[0]!.entityId = "missing";
  unknownTeam.rankings["logistics-companies"].winners = ["missing"];
  assert.equal(readFinalResults(unknownTeam, teams, "finished"), null);

  const oversized = validResults();
  oversized.rankings["logistics-companies"].standings[0]!.relatedItems =
    Array.from({ length: 65 }, (_, index) => ({
      entityId: `wagon-${index}`,
      value: 4
    }));
  assert.equal(readFinalResults(oversized, teams, "finished"), null);
});

test("rejects a result that silently omits an active placed team", () => {
  const incomplete = validResults();
  incomplete.rankings["locomotive-guilds"].standings.pop();
  incomplete.rankings["locomotive-guilds"].winners = ["guild-a"];
  incomplete.rankings["locomotive-guilds"].tiedForFirst = false;

  assert.equal(readFinalResults(incomplete, teams, "finished"), null);
});
