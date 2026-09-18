import { describe, expect, it } from "vitest";
import type { SessionAiDebriefArtifact } from "../src/index.ts";
import {
  validateSessionAiDebriefArtifact,
  validateSessionAiDebriefConfirmRequest,
  validateSessionAiDebriefGenerateRequest
} from "../src/index.ts";

const draft = {
  format: "cubica.session-ai-debrief",
  schemaVersion: "1.0.0",
  artifactId: "550e8400-e29b-41d4-a716-446655440000",
  requestId: "550e8400-e29b-41d4-a716-446655440001",
  sessionId: "neutral-session",
  gameId: "neutral-game",
  status: "draft",
  createdAt: "2026-09-04T10:00:00.000Z",
  provenance: {
    throughEventSequence: 7,
    journalSha256: `sha256:${"a".repeat(64)}`,
    methodologyVersion: "neutral-v1",
    promptVersion: "debrief-v1",
    provider: "openai",
    model: "model-snapshot-2026-09-01",
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 }
  },
  sections: {
    facts: [{ statement: "A confirmed choice occurred.", evidenceEventIds: ["evt-7"] }],
    interpretations: [{ statement: "The group may want to discuss the trade-off." }],
    facilitatorQuestions: [{ question: "What informed that choice?" }]
  },
  outputSha256: `sha256:${"b".repeat(64)}`
} satisfies SessionAiDebriefArtifact;

describe("session AI debrief schema", () => {
  it("accepts a neutral draft and exact request envelopes", () => {
    expect(validateSessionAiDebriefArtifact(draft)).toBe(true);
    expect(validateSessionAiDebriefGenerateRequest({ requestId: draft.requestId })).toBe(true);
    expect(validateSessionAiDebriefConfirmRequest({ outputSha256: draft.outputSha256 })).toBe(true);
  });

  it("requires confirmation time only for a confirmed artifact", () => {
    expect(validateSessionAiDebriefArtifact({ ...draft, confirmedAt: draft.createdAt })).toBe(false);
    expect(validateSessionAiDebriefArtifact({ ...draft, status: "confirmed" })).toBe(false);
    expect(validateSessionAiDebriefArtifact({
      ...draft,
      status: "confirmed",
      confirmedAt: "2026-09-04T10:05:00.000Z"
    })).toBe(true);
  });

  it("rejects mixed sections, empty evidence and protected unknown fields", () => {
    expect(validateSessionAiDebriefArtifact({
      ...draft,
      sections: {
        ...draft.sections,
        facts: [{ statement: "Unsupported", evidenceEventIds: [] }]
      }
    })).toBe(false);
    expect(validateSessionAiDebriefArtifact({ ...draft, commandId: "cli_protected" })).toBe(false);
    expect(validateSessionAiDebriefGenerateRequest({ requestId: draft.requestId, retry: true })).toBe(false);
  });
});
