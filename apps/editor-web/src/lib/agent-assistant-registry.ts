/**
 * Registry for Cubica user-facing AI assistants.
 *
 * The registry is the local implementation of ADR-043 for editor-web. It keeps
 * every assistant explicit: which app owns it, what context it may see, and
 * which tools it may call. The stable record shape lives in
 * `@cubica/contracts-ai`; this file only provides editor-web's concrete
 * assistant records and tool allowlist.
 */
import type {
  CubicaAgentAuditLevel,
  CubicaAgentSideEffectPolicy,
  CubicaAssistantRecord,
  CubicaAssistantStatus,
  CubicaAssistantSurface
} from "@cubica/contracts-ai";

import { editorAgentToolNames, type EditorAssistantToolName } from "./editor-agent-tool-catalog";

export type AssistantStatus = CubicaAssistantStatus;

export type AssistantSurface = CubicaAssistantSurface;

export type AssistantSideEffectPolicy = CubicaAgentSideEffectPolicy;

export type AssistantAuditLevel = CubicaAgentAuditLevel;

export type AssistantContextKey =
  | "activeFile"
  | "selectedPointers"
  | "selectedPreviewEntities"
  | "diagnostics"
  | "previewTraceSummary"
  | "pluginDiagnostics"
  | "catalogVisibleEntries"
  | "launchSessionDraft"
  | "playerFacingContent"
  | "publicSessionState"
  | "operationalDiagnostics";

export type AssistantToolName =
  | EditorAssistantToolName
  | "portal.searchCatalog"
  | "portal.draftLaunchSession"
  | "facilitator.summarizeProgress"
  | "player.explainRules"
  | "admin.summarizeDiagnostics";

export type EditorAssistantRecord = CubicaAssistantRecord<AssistantToolName, AssistantContextKey>;

export interface AgentUiDependencyPolicy {
  readonly copilotKitVersion: string;
  readonly agUiVersion: string;
  readonly telemetryDefault: "disabled";
  readonly productionAuditRequired: boolean;
  readonly upgradePolicy: string;
}

export const EDITOR_AUTHORING_ASSISTANT_ID = "editor.authoring";

export const agentUiDependencyPolicy: AgentUiDependencyPolicy = {
  copilotKitVersion: "1.59.5",
  agUiVersion: "0.0.53",
  telemetryDefault: "disabled",
  productionAuditRequired: true,
  upgradePolicy: "Pin CopilotKit and AG-UI versions together and run typecheck, tests, build and npm audit before production enablement."
};

export const cubicaAssistantRegistry = [
  {
    agentId: EDITOR_AUTHORING_ASSISTANT_ID,
    ownerApp: "apps/editor-web",
    surface: "sidebar",
    allowedContext: [
      "activeFile",
      "selectedPointers",
      "selectedPreviewEntities",
      "diagnostics",
      "previewTraceSummary",
      "pluginDiagnostics"
    ],
    allowedTools: editorAgentToolNames,
    sideEffectPolicy: "human-approved",
    auditLevel: "mutating",
    version: "1.0.0",
    status: "implemented",
    description: "Authoring assistant for bounded EditorChangeSet planning, dry-run, apply, undo, preview and save."
  },
  {
    agentId: "portal.catalog",
    ownerApp: "apps/portal-nextjs",
    surface: "sidebar",
    allowedContext: ["catalogVisibleEntries", "launchSessionDraft"],
    allowedTools: ["portal.searchCatalog", "portal.draftLaunchSession"],
    sideEffectPolicy: "human-approved",
    auditLevel: "read",
    version: "0.1.0",
    status: "planned",
    description: "Future portal assistant for catalog guidance and launch-session drafting."
  },
  {
    agentId: "facilitator.session",
    ownerApp: "apps/player-web",
    surface: "panel",
    allowedContext: ["playerFacingContent", "publicSessionState"],
    allowedTools: ["facilitator.summarizeProgress"],
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    version: "0.1.0",
    status: "planned",
    description: "Future facilitator assistant for role-authorized session summaries."
  },
  {
    agentId: "player.helper",
    ownerApp: "apps/player-web",
    surface: "inline",
    allowedContext: ["playerFacingContent", "publicSessionState"],
    allowedTools: ["player.explainRules"],
    sideEffectPolicy: "read-only",
    auditLevel: "read",
    version: "0.1.0",
    status: "planned",
    description: "Future player helper for rules and manifest-authorized hints."
  },
  {
    agentId: "admin.operations",
    ownerApp: "apps/portal-nextjs",
    surface: "sidebar",
    allowedContext: ["operationalDiagnostics"],
    allowedTools: ["admin.summarizeDiagnostics"],
    sideEffectPolicy: "human-approved",
    auditLevel: "mutating",
    version: "0.1.0",
    status: "planned",
    description: "Future operations assistant for diagnostics and approved remediation drafts."
  }
] as const satisfies readonly EditorAssistantRecord[];

export function getAssistantRecord(agentId: string): EditorAssistantRecord | undefined {
  return cubicaAssistantRegistry.find((assistant) => assistant.agentId === agentId);
}

export function assertAssistantToolAllowed(agentId: string, toolName: AssistantToolName): void {
  const assistant = getAssistantRecord(agentId);
  if (assistant === undefined) {
    throw new Error(`Unknown assistant: ${agentId}`);
  }

  if (!assistant.allowedTools.includes(toolName)) {
    throw new Error(`Tool ${toolName} is not allowed for assistant ${agentId}.`);
  }
}

export function listImplementedAssistants(): readonly EditorAssistantRecord[] {
  return cubicaAssistantRegistry.filter((assistant) => assistant.status === "implemented");
}
