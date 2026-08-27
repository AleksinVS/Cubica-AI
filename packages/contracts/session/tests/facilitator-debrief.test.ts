import { describe, expect, it } from "vitest";

import {
  getFacilitatorDebriefContractErrors,
  validateFacilitatorDebriefGenerationRequestShape,
  validateFacilitatorDebriefResponseShape
} from "../src/index.ts";

const base = {
  format: "cubica.facilitator-debrief",
  schemaVersion: "1.0.0",
  sessionId: "session-debrief",
  gameId: "neutral-game"
} as const;

const ready = {
  ...base,
  status: "ready",
  canGenerate: false,
  runId: "debrief_fixture123",
  requestedAt: "2026-08-27T10:00:00.000Z",
  completedAt: "2026-08-27T10:00:20.000Z",
  journalSha256: `sha256:${"a".repeat(64)}`,
  throughEventSequence: 2,
  provider: "z.ai",
  model: "glm-4.7",
  promptVersion: "facilitator-debrief-ru-v1",
  draft: {
    title: "Разбор",
    summary: "Краткий итог.",
    facts: [{ statement: "Раунд завершён.", eventSequences: [2] }],
    interpretations: [{ statement: "Решение могло снизить риск.", confidence: "low", eventSequences: [1, 2] }],
    reflectionQuestions: [{ question: "Что повлияло на решение?", eventSequences: [1] }]
  }
};

describe("facilitator debrief contract", () => {
  it("accepts the four exact lifecycle shapes", () => {
    expect(validateFacilitatorDebriefResponseShape({
      ...base,
      status: "absent",
      canGenerate: true
    })).toBe(true);
    expect(validateFacilitatorDebriefResponseShape({
      ...base,
      status: "generating",
      canGenerate: false,
      runId: "debrief_fixture123",
      requestedAt: "2026-08-27T10:00:00.000Z",
      journalSha256: `sha256:${"a".repeat(64)}`,
      throughEventSequence: 2,
      provider: "z.ai",
      model: "glm-4.7",
      promptVersion: "facilitator-debrief-ru-v1"
    })).toBe(true);
    expect(validateFacilitatorDebriefResponseShape(ready)).toBe(true);
    expect(validateFacilitatorDebriefResponseShape({
      ...ready,
      status: "failed",
      canGenerate: true,
      draft: null,
      error: { code: "provider_timeout", message: "Внешний сервис не ответил вовремя." }
    })).toBe(false);
    const { draft: _draft, ...withoutDraft } = ready;
    expect(validateFacilitatorDebriefResponseShape({
      ...withoutDraft,
      status: "failed",
      canGenerate: true,
      error: { code: "provider_timeout", message: "Внешний сервис не ответил вовремя." }
    })).toBe(true);
  });

  it("rejects lifecycle drift, unknown fields and malformed evidence references", () => {
    expect(validateFacilitatorDebriefResponseShape({ ...ready, canGenerate: true })).toBe(false);
    expect(validateFacilitatorDebriefResponseShape({ ...ready, extra: true })).toBe(false);
    expect(validateFacilitatorDebriefResponseShape({
      ...ready,
      draft: {
        ...ready.draft,
        facts: [{ statement: "Нет ссылки.", eventSequences: [] }]
      }
    })).toBe(false);
    expect(getFacilitatorDebriefContractErrors("response").length).toBeGreaterThan(0);
  });

  it("validates the generation request from the same canonical schema", () => {
    expect(validateFacilitatorDebriefGenerationRequestShape({ expectedStateVersion: 7 })).toBe(true);
    expect(validateFacilitatorDebriefGenerationRequestShape({ expectedStateVersion: -1 })).toBe(false);
    expect(validateFacilitatorDebriefGenerationRequestShape({ expectedStateVersion: 7, retry: true })).toBe(false);
    expect(getFacilitatorDebriefContractErrors("generation-request").length).toBeGreaterThan(0);
  });
});
