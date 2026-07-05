/**
 * Editor agent (AI copilot) approval scopes and Cubica Surface builder.
 *
 * The editor exposes a small set of agent tools (plan/dry-run/apply a
 * ChangeSet, undo, save). Mutating tools require a signed Cubica approval
 * envelope whose scope hash must match the exact operation; the `*ApprovalScope`
 * helpers derive those scope strings and `validateEditorAgentApproval` checks an
 * incoming envelope against the expected scope. `buildEditorAgentSurface`
 * projects the current AI state into a declarative Cubica Surface (the schema
 * used to render agent output and action buttons in the copilot panel).
 */
import {
  validateAgentApprovalEnvelope,
  type CubicaAgentApprovalEnvelope,
  type CubicaSurface,
  type CubicaSurfaceComponent
} from "@cubica/contracts-ai";
import type { EditorDiffSummaryItem } from "@cubica/editor-engine";

import type { EditorAgentToolResult } from "@/components/editor-agent-ui";
import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";

import type { PlannedAiChangeSet, PlannedPrototypeExtractionProposal } from "./types.ts";

/** Names of the editor agent tools that mutate state and require approval. */
export type MutatingEditorToolName = "editor.applyChangeSet" | "editor.undoLastPatch" | "editor.saveSession";

/** Maps a routed diagnostic down to the minimal shape sent to the agent. */
export function toAgentDiagnostic(diagnostic: { readonly severity: string; readonly source: string; readonly pointer: string; readonly message: string }) {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    message: diagnostic.message
  };
}

/** Approval scope for applying a specific planned ChangeSet. */
export function editorApplyApprovalScope(planned: PlannedAiChangeSet | null): string {
  return planned === null ? "editor.applyChangeSet:none" : `editor.applyChangeSet:${planned.changeSet.id}`;
}

/** True when a prototype proposal has at least one gate and all gates pass. */
export function prototypeProposalGatesPassed(plannedProposal: PlannedPrototypeExtractionProposal): boolean {
  return plannedProposal.gates.length > 0 && plannedProposal.gates.every((gate) => gate.ok);
}

/** Approval scope for undoing the last AI patch (keyed by journal length). */
export function editorUndoApprovalScope(patchJournalLength: number): string {
  return `editor.undoLastPatch:${patchJournalLength}`;
}

/** Approval scope for saving the current document version in a session. */
export function editorSaveApprovalScope(documentVersionHash: string, sessionId: string | undefined): string {
  return `editor.saveSession:${documentVersionHash}:${sessionId ?? "no-session"}`;
}

/**
 * Validates an incoming agent approval envelope for a mutating tool. Returns a
 * failed tool result to short-circuit the caller when the envelope is missing,
 * expired, or scoped to a different operation; returns `null` when it is valid.
 */
export function validateEditorAgentApproval(
  approval: CubicaAgentApprovalEnvelope | undefined,
  toolName: MutatingEditorToolName,
  scopeHash: string
): EditorAgentToolResult | null {
  if (approval === undefined) {
    return {
      ok: false,
      summary: `${toolName} requires a Cubica approval envelope created by the editor UI.`
    };
  }

  const validation = validateAgentApprovalEnvelope(approval, {
    expectedToolName: toolName,
    expectedScopeHash: scopeHash,
    requireApproved: true
  });

  if (validation.ok) {
    return null;
  }

  return {
    ok: false,
    summary: `${toolName} approval envelope is missing, expired or scoped to another operation.`,
    diagnostics: validation.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      source: diagnostic.source,
      pointer: diagnostic.pointer,
      message: diagnostic.message
    }))
  };
}

/** Projects current AI/prototype state into a declarative Cubica Surface. */
export function buildEditorAgentSurface(input: {
  readonly aiApplyState: "idle" | "planning" | "applying" | "applied" | "blocked" | "error" | "undone";
  readonly aiDiffSummary: readonly EditorDiffSummaryItem[];
  readonly aiDiagnostics: readonly RoutedEditorDiagnostic[];
  readonly prototypeExtractionProposal: PlannedPrototypeExtractionProposal | null;
  readonly hasPlannedChangeSet: boolean;
  readonly hasUndoPatch: boolean;
  readonly applyApprovalScopeHash: string;
  readonly undoApprovalScopeHash: string;
}): CubicaSurface {
  const children: CubicaSurfaceComponent[] = [
    {
      id: "editor-agent-progress",
      kind: "cubica.text",
      props: {
        text: `Tool state: ${input.aiApplyState}`
      }
    }
  ];

  if (input.aiDiagnostics.length > 0) {
    children.push({
      id: "editor-agent-diagnostics",
      kind: "cubica.diagnosticList",
      props: {
        title: "Diagnostics",
        items: input.aiDiagnostics.slice(0, 5).map((diagnostic) => `${diagnostic.source} ${diagnostic.pointer}: ${diagnostic.message}`)
      }
    });
  }

  if (input.aiDiffSummary.length > 0) {
    children.push({
      id: "editor-agent-diff",
      kind: "cubica.diffSummary",
      props: {
        title: "Diff summary",
        entries: input.aiDiffSummary.slice(0, 5).map((item) => item.description)
      }
    });
  }

  if (input.prototypeExtractionProposal !== null) {
    children.push({
      id: "editor-agent-prototype-proposal",
      kind: "cubica.text",
      props: {
        text: `Prototype proposal: ${input.prototypeExtractionProposal.proposal.definitionType} (${input.prototypeExtractionProposal.proposal.sourcePointers.length} sources)`
      }
    });
    children.push({
      id: "editor-agent-prototype-gates",
      kind: "cubica.diagnosticList",
      props: {
        title: "Prototype gates",
        items: input.prototypeExtractionProposal.gates
          .slice(0, 6)
          .map((gate) => `${gate.label}: ${gate.ok ? "OK" : "blocked"}`)
      }
    });

    if (prototypeProposalGatesPassed(input.prototypeExtractionProposal)) {
      children.push({
        id: "editor-agent-use-prototype-proposal",
        kind: "cubica.button",
        props: {
          label: "Use as planned ChangeSet"
        },
        actions: [
          {
            id: "editor-agent-use-prototype-proposal-action",
            kind: "editorTool",
            label: "Use as planned ChangeSet",
            target: "editor.preparePrototypeChangeSet",
            sideEffectPolicy: "system-approved"
          }
        ]
      });
    }
  }

  if (input.hasPlannedChangeSet) {
    children.push({
      id: "editor-agent-dry-run",
      kind: "cubica.button",
      props: {
        label: "Dry run"
      },
      actions: [
        {
          id: "editor-agent-dry-run-action",
          kind: "editorTool",
          label: "Dry run",
          target: "editor.dryRunChangeSet",
          sideEffectPolicy: "system-approved"
        }
      ]
    });
    children.push({
      id: "editor-agent-apply",
      kind: "cubica.button",
      props: {
        label: "Apply approved ChangeSet"
      },
      actions: [
        {
          id: "editor-agent-apply-action",
          kind: "editorTool",
          label: "Apply approved ChangeSet",
          target: "editor.applyChangeSet",
          sideEffectPolicy: "human-approved",
          requiresApproval: true,
          metadata: {
            approvalScopeHash: input.applyApprovalScopeHash
          }
        }
      ]
    });
  }

  if (input.hasUndoPatch) {
    children.push({
      id: "editor-agent-undo",
      kind: "cubica.button",
      props: {
        label: "Undo last AI patch"
      },
      actions: [
        {
          id: "editor-agent-undo-action",
          kind: "editorTool",
          label: "Undo last AI patch",
          target: "editor.undoLastPatch",
          sideEffectPolicy: "human-approved",
          requiresApproval: true,
          metadata: {
            approvalScopeHash: input.undoApprovalScopeHash
          }
        }
      ]
    });
  }

  return {
    schemaVersion: "1.0.0",
    surfaceId: "editor-agent-sidebar-surface",
    catalogVersion: "2026-06-11",
    mode: "helper",
    title: "Assistant surface",
    root: {
      id: "editor-agent-surface-root",
      kind: "cubica.approvalCard",
      props: {
        title: "Assistant surface",
        summary: "Agent tool output is shown through Cubica Surface and actions stay behind editor tools."
      },
      children
    }
  };
}
