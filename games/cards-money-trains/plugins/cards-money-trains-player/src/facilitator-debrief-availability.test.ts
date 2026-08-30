import assert from "node:assert/strict";
import test from "node:test";

import { provideCardsMoneyTrainsFacilitatorDebriefAvailability } from "./facilitator-debrief-availability.ts";

type AvailabilitySession = Parameters<typeof provideCardsMoneyTrainsFacilitatorDebriefAvailability>[0];

const teams = {
  "carrier-a": {
    objectType: "game.team",
    facets: { placementStatus: "placed" },
    attributes: { label: "Северный экспресс", type: "logistics_company", coins: 17, outstandingDebt: 2 }
  },
  "guild-a": {
    objectType: "game.team",
    facets: { placementStatus: "placed" },
    attributes: { label: "Гильдия А", type: "locomotive_guild", coins: 19, outstandingDebt: 0 }
  },
  "guild-b": {
    objectType: "game.team",
    facets: { placementStatus: "placed" },
    attributes: { label: "Гильдия Б", type: "locomotive_guild", coins: 17, outstandingDebt: 0 }
  }
};

const validFinalResults = {
  status: "calculated",
  completedTurn: 7,
  purchasePrice: { wagon: 4, locomotive: 12 },
  rankings: {
    "logistics-companies": {
      standings: [{ entityId: "carrier-a", baseValue: 15, relatedValue: 8, score: 23, relatedItems: [], rank: 1 }],
      winners: ["carrier-a"],
      tiedForFirst: false
    },
    "locomotive-guilds": {
      standings: [
        { entityId: "guild-a", baseValue: 19, relatedValue: 12, score: 31, relatedItems: [], rank: 1 },
        { entityId: "guild-b", baseValue: 17, relatedValue: 14, score: 31, relatedItems: [], rank: 1 }
      ],
      winners: ["guild-a", "guild-b"],
      tiedForFirst: true
    }
  }
};

const sessionWith = (phase: string, finalResults: unknown): AvailabilitySession => ({
  sessionId: "cmt-finished-session",
  gameId: "cards-money-trains",
  state: {
    public: {
      session: { phase },
      objects: { teams },
      finalResults
    }
  }
}) as unknown as AvailabilitySession;

test("keeps the debrief hidden before final results are available", () => {
  assert.equal(provideCardsMoneyTrainsFacilitatorDebriefAvailability(sessionWith("construction", validFinalResults)), false);
  assert.equal(provideCardsMoneyTrainsFacilitatorDebriefAvailability(sessionWith("finished", { status: "not-calculated" })), false);
});

test("fails closed for malformed snapshots", () => {
  assert.equal(provideCardsMoneyTrainsFacilitatorDebriefAvailability({ state: { public: { session: { phase: "finished" }, finalResults: validFinalResults } } } as unknown as AvailabilitySession), false);
  assert.equal(provideCardsMoneyTrainsFacilitatorDebriefAvailability(sessionWith("finished", { ...validFinalResults, rankings: {} })), false);
});

test("enables the debrief only for a complete finished projection", () => {
  assert.equal(provideCardsMoneyTrainsFacilitatorDebriefAvailability(sessionWith("finished", validFinalResults)), true);
});
