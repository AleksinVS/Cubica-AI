/**
 * Shared type contracts for the decomposed editor workspace.
 *
 * These interfaces and type aliases were previously declared inline inside the
 * monolithic `editor-workspace.tsx`. They describe the editor REST payloads
 * (authoring files, sessions, workflow responses), the React Flow node/edge
 * projection, the Monaco editor bridge, and the small UI enums used to drive
 * sidebar layout. Keeping them in one module lets every extracted panel,
 * helper, and hook depend on the same definitions without duplicating them.
 */
import type { Edge, Node } from "@xyflow/react";
import type {
  DocumentDiagnostic,
  EditorChangeSet,
  EditorDiffSummaryItem,
  EditorPatchIntent,
  PrototypeExtractionProposal,
  SerializedEditorEntityProjectionEnvelope
} from "@cubica/editor-engine";
import type {
  EditorViewEdge,
  EditorViewNode,
  RoutedEditorDiagnostic
} from "@/lib/editor-web-adapter";
import type { PreviewSelectionSourceMap } from "@/lib/preview-message-adapter";
import type {
  PrototypeAuditNoticeKind,
  PrototypeAuditNoticeRecord
} from "@/components/prototype-audit-notice";

export interface AuthoringFileSummary {
  readonly gameId: string;
  readonly filePath: string;
  readonly size: number;
  readonly versionHash: string;
}

export interface AuthoringListResult {
  readonly gameId: string;
  readonly games: readonly string[];
  readonly files: readonly AuthoringFileSummary[];
  readonly defaultFilePath: string | undefined;
}

/**
 * A sibling authoring document that participates in the project-level projection
 * (ADR-057 §4.1): its path, full text, and game-agnostic classification. The file
 * route ships every game+ui document of the game EXCEPT the active one (the client
 * already holds the active document via `AuthoringFileDocument.text`).
 */
export interface ProjectionSiblingDocument {
  readonly filePath: string;
  readonly text: string;
  readonly documentKind: "game" | "ui";
  readonly channel?: string;
}

export interface AuthoringFileDocument extends AuthoringFileSummary {
  readonly text: string;
  /**
   * Optional warm-start payload (ADR-057 §4.13 "Уровень 2"): the serialized PROJECT
   * entity projection (built over the game document plus every UI-channel document)
   * for the current texts, shipped by the file route so the client can hydrate its
   * first view model instead of rebuilding the projection. Absent when the cache
   * is disabled or a build failed — the client then rebuilds exactly as today.
   */
  readonly projection?: SerializedEditorEntityProjectionEnvelope;
  /**
   * The other authoring documents of the game that participate in the projection
   * (ADR-057 §4.1, Phase 3.a). Absent when the project payload could not be
   * gathered — the client then builds a single-document projection as before.
   */
  readonly projectionDocuments?: readonly ProjectionSiblingDocument[];
  /**
   * The active preview channel: the channel of the open UI document, or undefined
   * when a game document is open (ADR-057 §4.2, §7). The client passes it into the
   * projection so `entity-missing-view` is evaluated against the right channel.
   */
  readonly activeChannel?: string;
}

export interface EditorSessionSummary {
  readonly sessionId: string;
  readonly gameId: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EditorSessionListResult extends AuthoringListResult {
  readonly session: EditorSessionSummary;
}

export interface SavedAuthoringFileDocument extends AuthoringFileDocument {
  readonly sessionId?: string;
  readonly commit?: {
    readonly committed: boolean;
    readonly commitHash?: string;
    readonly changedPaths: readonly string[];
  };
  readonly pluginValidation?: EditorPluginValidationResult;
}

export interface EditorLayoutDocumentBody {
  readonly version: 1;
  readonly nodes: Record<string, { readonly position?: { readonly x: number; readonly y: number } }>;
}

export interface EditorLayoutDocument {
  readonly gameId: string;
  readonly authoringFilePath: string;
  readonly layoutFilePath: string;
  readonly layout: EditorLayoutDocumentBody;
  readonly versionHash: string;
}

export interface CurrentDocument {
  readonly source: "repository" | "embedded";
  readonly gameId: string;
  readonly filePath: string;
  readonly versionHash: string | undefined;
}

export interface EditorWorkflowResponse {
  readonly ok: boolean;
  readonly ready?: boolean;
  readonly diagnostics?: readonly RoutedEditorDiagnostic[];
  readonly pluginValidation?: EditorPluginValidationResult;
  readonly playerUrl?: string;
  readonly sessionId?: string;
  readonly sourceMaps?: readonly PreviewSelectionSourceMap[];
}

export interface PrototypeExtractionGate {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
}

export interface PrototypeExtractionWorkflowResponse {
  readonly ok: boolean;
  readonly diagnostics?: readonly RoutedEditorDiagnostic[];
  readonly proposal?: PrototypeExtractionProposal;
  readonly diffSummary?: readonly EditorDiffSummaryItem[];
  readonly gates?: readonly PrototypeExtractionGate[];
}

export interface PrototypeAuditStatusResponse {
  readonly ok: boolean;
  readonly notification: PrototypeAuditNoticeKind | null;
  readonly message: string;
  readonly status: {
    readonly lastCompletedAt?: string;
    readonly llmStatus?: string;
    readonly reportUrl?: string;
    readonly reportPath?: string;
    readonly workflowUrl?: string;
    readonly summary?: PrototypeAuditNoticeRecord["summary"];
  } | null;
}

export interface PlannedPrototypeExtractionProposal {
  readonly proposal: PrototypeExtractionProposal;
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly gates: readonly PrototypeExtractionGate[];
}

export interface EditorPreviewRollbackResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly targetEventSequence?: number;
  readonly session?: {
    readonly sessionId?: string;
    readonly version?: {
      readonly stateVersion?: number;
      readonly lastEventSequence?: number;
    };
  };
}

export interface EditorPluginValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
}

export interface AiPatchPlanResponse {
  readonly ok: boolean;
  readonly changeSet?: EditorChangeSet;
  readonly diagnostics?: readonly DocumentDiagnostic[];
}

export interface PlannedAiChangeSet {
  readonly intent: EditorPatchIntent;
  readonly changeSet: EditorChangeSet;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly targetPointers: readonly string[];
}

export type PlanCurrentAiChangeSetResult =
  | {
      readonly ok: true;
      readonly plan: PlannedAiChangeSet;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly RoutedEditorDiagnostic[];
      readonly summary: string;
    };

export interface MonacoModel {
  readonly uri: unknown;
  getLineMaxColumn(lineNumber: number): number;
}

export interface MonacoEditorInstance {
  getModel(): MonacoModel | null;
  setSelection(range: MonacoRange): void;
  revealRangeInCenter(range: MonacoRange): void;
  focus(): void;
}

export interface MonacoApi {
  readonly MarkerSeverity: { readonly Error: number; readonly Warning: number; readonly Info: number };
  readonly editor: {
    setModelMarkers(model: MonacoModel, owner: string, markers: readonly MonacoMarker[]): void;
  };
  readonly languages: {
    readonly json: {
      readonly jsonDefaults: {
        setDiagnosticsOptions(options: unknown): void;
      };
    };
  };
}

export interface MonacoRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface MonacoMarker extends MonacoRange {
  readonly severity: number;
  readonly message: string;
  readonly source: string;
}

export interface SemanticNodeData extends Record<string, unknown> {
  readonly semanticRole: EditorViewNode["semanticRole"];
  readonly semanticTitle: string;
  readonly semanticSummary: string;
  readonly presentationRole: EditorViewNode["presentationRole"];
  readonly pointer: string;
  readonly valueType: EditorViewNode["valueType"];
  readonly childCount: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export type SemanticFlowNode = Node<SemanticNodeData, "semantic">;
export type SemanticFlowEdge = Edge<{ readonly role: EditorViewEdge["role"]; readonly label?: string }, "semantic">;
export type LeftSidebarPanel = "tree" | "timeline" | "chat";
export type RightSidebarPanel = "properties" | "json";
export type PreviewViewportMode = "desktop" | "tablet" | "mobile";

export interface SidebarResizeState {
  readonly side: "left" | "json";
  readonly startX: number;
  readonly startWidth: number;
}

/**
 * A pinned state fixture as returned by `/api/editor/fixtures` (ADR-057 §9.3).
 * Browser-safe mirror of the server `ListedStateFixture`; it never carries the
 * node-only hashing code, only its comparison verdict (`stale`).
 */
export interface StateFixtureSummary {
  readonly id: string;
  readonly _label: string;
  readonly screenRef?: string;
  readonly stepRef?: string;
  readonly state: Record<string, unknown>;
  readonly manifestHash: string;
  readonly sourceTraceRef?: string;
  readonly note?: string;
  readonly stale: boolean;
}

export interface StateFixtureListResult {
  readonly ok: boolean;
  readonly fixtures: readonly StateFixtureSummary[];
  readonly manifestHash: string;
}

export interface PinStateFixtureResult {
  readonly ok: boolean;
  readonly fixture: StateFixtureSummary;
}
