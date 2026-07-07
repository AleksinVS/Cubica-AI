/**
 * Tests for the shared approval-envelope gate the DANGEROUS entity refactor
 * operations reuse (Phase 6.2b, ADR-057 §4.5, ADR-047).
 *
 * A rename (always dangerous) and a delete-with-incoming-references funnel through
 * the SAME `editorApplyApprovalScope` + `buildEditorApprovalEnvelope` +
 * `validateEditorAgentApproval` gate the agent apply path uses. These tests assert
 * the round-trip accepts a correctly scoped envelope and rejects a mismatched one,
 * so the dangerous gate cannot be satisfied by an envelope minted for another
 * operation.
 */
import { describe, expect, it } from "vitest";
import type { ClassifyChangeSetResult, EditorChangeSet } from "@cubica/editor-engine";

import {
  buildEditorApprovalEnvelope,
  editorApplyApprovalScope,
  validateEditorAgentApproval
} from "./agent-surface";
import type { PlannedAiChangeSet } from "./types";

function dangerousPlan(id: string): { plan: PlannedAiChangeSet; classification: ClassifyChangeSetResult } {
  const changeSet: EditorChangeSet = { id, summary: `Rename ${id}`, jsonPatches: [] };
  const plan: PlannedAiChangeSet = {
    intent: {
      id: `intent-${id}`,
      kind: "entity-operation",
      prompt: changeSet.summary,
      activeFilePath: "game.authoring.json",
      targetPointers: [],
      createdAt: new Date().toISOString(),
      selectionKind: "entity"
    },
    changeSet,
    diagnostics: [],
    targetPointers: []
  };
  const classification: ClassifyChangeSetResult = { risk: "dangerous", reasons: ["changes identity field"] };
  return { plan, classification };
}

describe("dangerous entity-refactor approval gate", () => {
  it("accepts an envelope scoped to the exact dangerous operation", () => {
    const { plan, classification } = dangerousPlan("rename-entity-id:accept->confirm");
    const scopeHash = editorApplyApprovalScope(plan, classification);
    const approval = buildEditorApprovalEnvelope({ toolName: "editor.applyChangeSet", scopeHash, actionId: "entity-refactor:test" });

    expect(validateEditorAgentApproval(approval, "editor.applyChangeSet", scopeHash)).toBeNull();
  });

  it("scopes dangerous approvals so one operation cannot authorise another", () => {
    const a = dangerousPlan("rename-entity-id:accept->confirm");
    const b = dangerousPlan("delete-entity:orphan");
    const scopeA = editorApplyApprovalScope(a.plan, a.classification);
    const scopeB = editorApplyApprovalScope(b.plan, b.classification);
    expect(scopeA).not.toBe(scopeB);

    // An envelope minted for operation A must NOT validate against operation B.
    const approvalForA = buildEditorApprovalEnvelope({ toolName: "editor.applyChangeSet", scopeHash: scopeA, actionId: "a" });
    expect(validateEditorAgentApproval(approvalForA, "editor.applyChangeSet", scopeB)).not.toBeNull();
  });

  it("rejects a missing envelope for a dangerous operation", () => {
    const { plan, classification } = dangerousPlan("rename-entity-id:accept->confirm");
    const scopeHash = editorApplyApprovalScope(plan, classification);
    expect(validateEditorAgentApproval(undefined, "editor.applyChangeSet", scopeHash)).not.toBeNull();
  });
});
