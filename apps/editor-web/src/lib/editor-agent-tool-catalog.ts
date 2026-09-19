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
  | "editor.preparePreview";

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
  "editor.preparePreview": {
    name: "editor.preparePreview",
    description: "Prepare the current editor session preview through the existing session-aware preview route.",
    sideEffectPolicy: "system-approved",
    auditLevel: "read",
    requiresApproval: false
  }
} as const satisfies Record<EditorAssistantToolName, EditorAssistantToolCatalogEntry>;

export const editorAgentToolNames = Object.keys(editorAgentToolCatalog) as readonly EditorAssistantToolName[];

export function getEditorAgentToolDefinition(toolName: EditorAssistantToolName): EditorAssistantToolCatalogEntry {
  return editorAgentToolCatalog[toolName];
}

export function listEditorAgentToolDefinitions(): readonly EditorAssistantToolCatalogEntry[] {
  return editorAgentToolNames.map((toolName) => editorAgentToolCatalog[toolName]);
}
