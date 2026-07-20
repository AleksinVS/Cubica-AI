/** Focused tests for the facilitator's read-only map overlay. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFacilitatorTeamSummaries,
  facilitatorTeamSummaryLabel,
  isFacilitatorHudPhase,
  readFinalReflectionGuide
} from "./facilitator-hud.ts";

test("shows the facilitator HUD only at discussion boundaries", () => {
  assert.equal(isFacilitatorHudPhase("reporting"), true);
  assert.equal(isFacilitatorHudPhase("methodology-pause"), true);
  assert.equal(isFacilitatorHudPhase("movement"), false);
  assert.equal(isFacilitatorHudPhase("methodology_pause"), false);
});

test("counts only equipment actually owned by public teams", () => {
  const summaries = buildFacilitatorTeamSummaries({
    teams: [
      { id: "alpha", label: "Альфа", type: "logistics", coins: 12 },
      { id: "beta", label: "Бета", type: "guild", coins: null }
    ],
    vehicles: [
      { id: "l-1", kind: "locomotive", nodeId: "1", ownerTeamId: "alpha" },
      { id: "l-2", kind: "locomotive", nodeId: "1", ownerTeamId: "beta" },
      { id: "w-1", kind: "wagon", nodeId: "1", ownerTeamId: "alpha" },
      { id: "w-market", kind: "wagon", nodeId: null, ownerTeamId: null },
      { id: "w-unknown", kind: "wagon", nodeId: "2", ownerTeamId: "missing" }
    ]
  });

  assert.deepEqual(summaries, [
    {
      id: "alpha",
      label: "Альфа",
      coins: 12,
      locomotives: 1,
      wagons: 1
    },
    {
      id: "beta",
      label: "Бета",
      coins: null,
      locomotives: 1,
      wagons: 0
    }
  ]);
  assert.equal(facilitatorTeamSummaryLabel(summaries[0]!), "Альфа · 12 мон. · Л 1 · В 1");
  assert.equal(facilitatorTeamSummaryLabel(summaries[1]!), "Бета · — мон. · Л 1 · В 0");
  assert.equal(Object.isFrozen(summaries), true);
  assert.equal(summaries.every(Object.isFrozen), true);
});

test("reads only the bounded confirmed final-reflection guide", () => {
  const content = {
    finalReflectionGuide: {
      workflowStatus: "pending-author-answers",
      preparationMinutes: { min: 5, max: 15 },
      presentationMinutesMax: 2,
      conclusionCount: { min: 2, max: 3 },
      questions: [
        "Какая была стратегия изначально?",
        "К чему нужно было адаптироваться?",
        "К чему удалось адаптироваться? За счет чего?",
        "К чему адаптироваться не удалось? Почему?",
        "Как бы вы оценили результаты игры для вас и для других команд?"
      ]
    }
  };

  const guide = readFinalReflectionGuide(content);

  assert.deepEqual(guide, content.finalReflectionGuide);
  assert.equal(Object.isFrozen(guide), true);
  assert.equal(Object.isFrozen(guide?.questions), true);
  assert.equal(readFinalReflectionGuide({
    finalReflectionGuide: {
      ...content.finalReflectionGuide,
      workflowStatus: "complete"
    }
  }), null);
  assert.equal(readFinalReflectionGuide({
    finalReflectionGuide: {
      ...content.finalReflectionGuide,
      questions: content.finalReflectionGuide.questions.slice(0, 4)
    }
  }), null);
});
