/** Focused tests for bounded facilitator money-corrector presentation. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ECONOMY_CREDIT_ACTION_ID,
  ECONOMY_DEBIT_ACTION_ID,
  economyDraftLabel,
  economyTeamLabel,
  parseEconomyDraftInput,
  projectEconomyCorrector
} from "./economy-corrector.ts";

const action = (actionId: string, disabled = false) => ({
  id: actionId,
  label: actionId,
  actionId,
  disabled
});

const teams = [
  {
    id: "alpha",
    label: "Альфа",
    type: "logistics_company",
    coins: 15,
    placementStatus: "placed",
    outstandingDebt: 2
  },
  {
    id: "excluded",
    label: "Исключённая",
    type: "locomotive_guild",
    coins: 0,
    placementStatus: "excluded",
    outstandingDebt: 0
  }
];

test("projects placed teams only from server-published available actions", () => {
  assert.equal(projectEconomyCorrector({
    teams,
    availableActions: []
  }), null);

  assert.deepEqual(projectEconomyCorrector({
    teams,
    availableActions: [
      action(ECONOMY_CREDIT_ACTION_ID),
      action(ECONOMY_DEBIT_ACTION_ID, true)
    ]
  }), {
    rows: [{
      teamId: "alpha",
      label: "Альфа",
      coins: 15,
      outstandingDebt: 2
    }],
    creditAvailable: true,
    debitAvailable: false
  });
});

test("parses only bounded unsigned decimal integers", () => {
  assert.deepEqual(parseEconomyDraftInput(null), { kind: "cancel" });
  assert.deepEqual(parseEconomyDraftInput("  "), { kind: "clear" });
  assert.deepEqual(parseEconomyDraftInput("0"), { kind: "valid", amount: 0 });
  assert.deepEqual(
    parseEconomyDraftInput("1000000"),
    { kind: "valid", amount: 1_000_000 }
  );
  for (const invalid of ["-1", "1.5", "1e3", "+2", "1000001", "abc"]) {
    assert.equal(parseEconomyDraftInput(invalid).kind, "invalid");
  }
});

test("formats compact labels without confusing an empty cell with zero", () => {
  assert.equal(economyDraftLabel(null), "—");
  assert.equal(economyDraftLabel(0), "0");
  assert.equal(economyTeamLabel("Короткое имя"), "Короткое имя");
  assert.equal(economyTeamLabel("Очень длинное название команды", 12), "Очень длинн…");
});

test("fails closed when placed-team capacity is exceeded", () => {
  const oversized = Array.from({ length: 13 }, (_, index) => ({
    ...teams[0]!,
    id: `team-${index}`
  }));
  assert.equal(projectEconomyCorrector({
    teams: oversized,
    availableActions: [action(ECONOMY_CREDIT_ACTION_ID)]
  }), null);
});
