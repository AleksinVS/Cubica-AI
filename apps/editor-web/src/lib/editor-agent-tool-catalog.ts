/**
 * Cubica-owned tool catalog for the editor authoring assistant.
 *
 * The catalog is the single place where editor assistant tools get their name,
 * description, side-effect policy and audit level. UI adapters such as
 * CopilotKit may add framework-specific parameter schemas and handlers, but
 * they must not invent tools outside this catalog.
 */
import type { CubicaAgentAuditLevel, CubicaAgentSideEffectPolicy, CubicaAgentToolDefinition } from "@cubica/contracts-ai";

export type EditorAssistantToolName =
  | "editor.planChangeSet"
  | "editor.proposePrototypeExtraction"
  | "editor.preparePrototypeChangeSet"
  | "editor.dryRunChangeSet"
  | "editor.requestHumanApproval"
  | "editor.applyChangeSet"
  | "editor.undoLastPatch"
  | "editor.preparePreview"
  | "editor.saveSession";

export type EditorAssistantToolCatalogEntry = CubicaAgentToolDefinition & {
  readonly name: EditorAssistantToolName;
  readonly sideEffectPolicy: CubicaAgentSideEffectPolicy;
  readonly auditLevel: CubicaAgentAuditLevel;
  readonly requiresApproval: boolean;
};

export const editorAgentToolCatalog = {
  "editor.planChangeSet": {
    name: "editor.planChangeSet",
    description: "Plan a bounded EditorChangeSet for the selected authoring pointers without applying it.",
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.proposePrototypeExtraction": {
    name: "editor.proposePrototypeExtraction",
    description: "Build a read-only ADR-050 prototype extraction proposal with compiler, runtime diff and source-map gates, without applying it.",
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.preparePrototypeChangeSet": {
    name: "editor.preparePrototypeChangeSet",
    description: "Convert the latest approved prototype proposal into the editor's planned ChangeSet state without applying it.",
    sideEffectPolicy: "system-approved",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.dryRunChangeSet": {
    name: "editor.dryRunChangeSet",
    description: "Dry-run the latest planned EditorChangeSet or plan from the supplied prompt, returning diagnostics and diff summary.",
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.applyChangeSet": {
    name: "editor.applyChangeSet",
    description: "Apply a planned EditorChangeSet after dry-run validation. Requires a Cubica approval envelope.",
    sideEffectPolicy: "human-approved",
    auditLevel: "mutating",
    requiresApproval: true
  },
  "editor.requestHumanApproval": {
    name: "editor.requestHumanApproval",
    description: "Ask the editor user for a Cubica approval envelope for one scoped mutating editor operation.",
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.undoLastPatch": {
    name: "editor.undoLastPatch",
    description: "Undo the last AI patch through the existing Cubica undo journal.",
    sideEffectPolicy: "human-approved",
    auditLevel: "mutating",
    requiresApproval: true
  },
  "editor.preparePreview": {
    name: "editor.preparePreview",
    description: "Prepare the current editor session preview through the existing session-aware preview route.",
    sideEffectPolicy: "system-approved",
    auditLevel: "read",
    requiresApproval: false
  },
  "editor.saveSession": {
    name: "editor.saveSession",
    description: "Save the current editor session after a Cubica approval envelope is verified.",
    sideEffectPolicy: "human-approved",
    auditLevel: "mutating",
    requiresApproval: true
  }
} as const satisfies Record<EditorAssistantToolName, EditorAssistantToolCatalogEntry>;

export const editorAgentToolNames = Object.keys(editorAgentToolCatalog) as readonly EditorAssistantToolName[];

export function getEditorAgentToolDefinition(toolName: EditorAssistantToolName): EditorAssistantToolCatalogEntry {
  return editorAgentToolCatalog[toolName];
}

export function listEditorAgentToolDefinitions(): readonly EditorAssistantToolCatalogEntry[] {
  return editorAgentToolNames.map((toolName) => editorAgentToolCatalog[toolName]);
}
