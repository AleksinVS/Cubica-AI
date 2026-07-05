"use client";

/**
 * Domain-grouped state hooks for the editor workspace.
 *
 * The former `EditorWorkspace` component declared 63 `useState` calls plus a
 * handful of refs inline. This module groups them by domain into small hooks so
 * the controller (`useEditorWorkspace`) reads one destructure per concern
 * instead of a flat wall of state:
 *
 *  - `useSessionDocumentState` — the open repository/session document, the file
 *    list, load/save/workflow status, diagnostics, and the prototype-audit notice.
 *  - `useSelectionGraphState`  — the selected node, graph expansion/collapse, the
 *    React Flow node list, and the persisted/local canvas layout.
 *  - `usePreviewRuntimeState`  — the prepared preview URL, selectable entities,
 *    inspect/play input modes, viewport mode, and the playthrough trace.
 *  - `useAiPatchState`         — AI ChangeSet apply state, undo/redo journals,
 *    diff summary, diagnostics, and the prototype extraction proposal.
 *  - `useLayoutUiState`        — sidebar visibility/width, resize drag state, and
 *    the Monaco editor handle.
 *
 * Grouping is purely structural: each `useState` keeps its original initializer,
 * so first-render values and update semantics are unchanged. The only cross-state
 * initializer (`savedText` seeded from `jsonText`) is kept inside a single hook.
 */
import { useRef, useState } from "react";
import type { Node, ReactFlowInstance } from "@xyflow/react";
import {
  createPreviewPlaythroughTrace,
  type EditorDiffSummaryItem,
  type PatchJournalStep,
  type PreviewEntityDescriptor,
  type PreviewPlaythroughTrace
} from "@cubica/editor-engine";

import { embeddedAuthoringSample } from "@/lib/authoring-sample";
import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";
import type { PreviewSelectionSourceMap } from "@/lib/preview-message-adapter";
import type { PreviewAiIntent, PreviewPromptContext } from "@/components/preview-selection-overlay";
import type { PrototypeAuditNoticeRecord } from "@/components/prototype-audit-notice";

import { defaultJsonSidebarWidth, defaultLeftSidebarWidth, embeddedFilePath } from "./constants.ts";
import { createEmptyEditorLayout } from "./workspace-helpers.ts";
import type {
  AuthoringFileSummary,
  CurrentDocument,
  EditorLayoutDocumentBody,
  EditorSessionListResult,
  EditorSessionSummary,
  LeftSidebarPanel,
  MonacoApi,
  MonacoEditorInstance,
  PlannedAiChangeSet,
  PlannedPrototypeExtractionProposal,
  PreviewViewportMode,
  SemanticFlowEdge,
  SidebarResizeState
} from "./types.ts";

/** Open repository/session document, file list, workflow status, diagnostics. */
export function useSessionDocumentState() {
  const [jsonText, setJsonText] = useState(() => `${JSON.stringify(embeddedAuthoringSample, null, 2)}\n`);
  const [savedText, setSavedText] = useState(jsonText);
  const [currentDocument, setCurrentDocument] = useState<CurrentDocument>({
    source: "embedded",
    gameId: "embedded",
    filePath: embeddedFilePath,
    versionHash: undefined
  });
  const [availableGames, setAvailableGames] = useState<readonly string[]>([]);
  const [availableFiles, setAvailableFiles] = useState<readonly AuthoringFileSummary[]>([]);
  const [editorSession, setEditorSession] = useState<EditorSessionSummary | null>(null);
  const [lastEditSource, setLastEditSource] = useState<"repository" | "graph" | "json" | "property" | "ai">("repository");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [workflowState, setWorkflowState] = useState<"idle" | "validating" | "validated" | "compiling" | "compiled" | "previewing" | "ready" | "blocked" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("Loading repository files...");
  const [reverseDiagnostics, setReverseDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [workflowDiagnostics, setWorkflowDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [pluginDiagnostics, setPluginDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [prototypeAuditNotice, setPrototypeAuditNotice] = useState<PrototypeAuditNoticeRecord | null>(null);
  const [prototypeAuditSnoozed, setPrototypeAuditSnoozed] = useState(false);
  const editorSessionRef = useRef<EditorSessionSummary | null>(null);
  const openingSessionRef = useRef<{
    readonly gameId: string | null;
    readonly promise: Promise<EditorSessionListResult>;
  } | null>(null);

  return {
    jsonText,
    setJsonText,
    savedText,
    setSavedText,
    currentDocument,
    setCurrentDocument,
    availableGames,
    setAvailableGames,
    availableFiles,
    setAvailableFiles,
    editorSession,
    setEditorSession,
    lastEditSource,
    setLastEditSource,
    loadState,
    setLoadState,
    saveState,
    setSaveState,
    workflowState,
    setWorkflowState,
    statusMessage,
    setStatusMessage,
    reverseDiagnostics,
    setReverseDiagnostics,
    workflowDiagnostics,
    setWorkflowDiagnostics,
    pluginDiagnostics,
    setPluginDiagnostics,
    prototypeAuditNotice,
    setPrototypeAuditNotice,
    prototypeAuditSnoozed,
    setPrototypeAuditSnoozed,
    editorSessionRef,
    openingSessionRef
  };
}

/** Selected node, graph expansion/collapse, React Flow nodes, canvas layout. */
export function useSelectionGraphState() {
  const [selectedNodeId, setSelectedNodeId] = useState("$");
  const [editorLayout, setEditorLayout] = useState<EditorLayoutDocumentBody>(() => createEmptyEditorLayout());
  const [layoutVersionHash, setLayoutVersionHash] = useState<string | undefined>(undefined);
  const [localNodePositions, setLocalNodePositions] = useState<ReadonlyMap<string, { readonly x: number; readonly y: number }>>(
    () => new Map()
  );
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [activeBranchRootId, setActiveBranchRootId] = useState<string | undefined>(undefined);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [surfaceMode, setSurfaceMode] = useState<"graph" | "tree">("tree");
  const [treeDetailMode, setTreeDetailMode] = useState<"entities" | "json">("entities");
  const [treeCollapsedPointers, setTreeCollapsedPointers] = useState<ReadonlySet<string>>(() => new Set());
  const flowRef = useRef<ReactFlowInstance<Node, SemanticFlowEdge> | null>(null);

  return {
    selectedNodeId,
    setSelectedNodeId,
    editorLayout,
    setEditorLayout,
    layoutVersionHash,
    setLayoutVersionHash,
    localNodePositions,
    setLocalNodePositions,
    flowNodes,
    setFlowNodes,
    activeBranchRootId,
    setActiveBranchRootId,
    expandedNodeIds,
    setExpandedNodeIds,
    collapsedNodeIds,
    setCollapsedNodeIds,
    surfaceMode,
    setSurfaceMode,
    treeDetailMode,
    setTreeDetailMode,
    treeCollapsedPointers,
    setTreeCollapsedPointers,
    flowRef
  };
}

/** Prepared preview, selectable entities, input modes, viewport, trace. */
export function usePreviewRuntimeState() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRuntimeSessionId, setPreviewRuntimeSessionId] = useState<string | undefined>(undefined);
  const [previewSourceMaps, setPreviewSourceMaps] = useState<readonly PreviewSelectionSourceMap[]>([]);
  const [previewEntities, setPreviewEntities] = useState<readonly PreviewEntityDescriptor[]>([]);
  const [previewUnresolvedEntityCount, setPreviewUnresolvedEntityCount] = useState(0);
  const [selectedPreviewEntityId, setSelectedPreviewEntityId] = useState<string | undefined>(undefined);
  const [previewPromptContext, setPreviewPromptContext] = useState<PreviewPromptContext | null>(null);
  const [previewAiIntent, setPreviewAiIntent] = useState<PreviewAiIntent | null>(null);
  const [previewTrace, setPreviewTrace] = useState<PreviewPlaythroughTrace>(() =>
    createPreviewPlaythroughTrace({ traceId: "preview-trace-initial" })
  );
  const [selectedPreviewTraceSequence, setSelectedPreviewTraceSequence] = useState<number | undefined>(undefined);
  const [previewRollbackState, setPreviewRollbackState] = useState<"idle" | "restoring" | "restored" | "blocked" | "error">("idle");
  const [previewInspectMode, setPreviewInspectMode] = useState(false);
  const [altPlayActive, setAltPlayActive] = useState(false);
  const [previewPointerPlayMode, setPreviewPointerPlayMode] = useState(false);
  const [previewPointSelectionMode, setPreviewPointSelectionMode] = useState(false);
  const [previewViewportMode, setPreviewViewportMode] = useState<PreviewViewportMode>("desktop");
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewPointerPlayResetRef = useRef<number | undefined>(undefined);

  return {
    previewUrl,
    setPreviewUrl,
    previewRuntimeSessionId,
    setPreviewRuntimeSessionId,
    previewSourceMaps,
    setPreviewSourceMaps,
    previewEntities,
    setPreviewEntities,
    previewUnresolvedEntityCount,
    setPreviewUnresolvedEntityCount,
    selectedPreviewEntityId,
    setSelectedPreviewEntityId,
    previewPromptContext,
    setPreviewPromptContext,
    previewAiIntent,
    setPreviewAiIntent,
    previewTrace,
    setPreviewTrace,
    selectedPreviewTraceSequence,
    setSelectedPreviewTraceSequence,
    previewRollbackState,
    setPreviewRollbackState,
    previewInspectMode,
    setPreviewInspectMode,
    altPlayActive,
    setAltPlayActive,
    previewPointerPlayMode,
    setPreviewPointerPlayMode,
    previewPointSelectionMode,
    setPreviewPointSelectionMode,
    previewViewportMode,
    setPreviewViewportMode,
    previewIframeRef,
    previewPointerPlayResetRef
  };
}

/** AI ChangeSet apply state, undo/redo journals, diff, prototype proposal. */
export function useAiPatchState() {
  const [aiApplyState, setAiApplyState] = useState<"idle" | "planning" | "applying" | "applied" | "blocked" | "error" | "undone">("idle");
  const [aiPatchJournal, setAiPatchJournal] = useState<readonly PatchJournalStep[]>([]);
  const [aiRedoJournal, setAiRedoJournal] = useState<readonly PatchJournalStep[]>([]);
  const [aiDiffSummary, setAiDiffSummary] = useState<readonly EditorDiffSummaryItem[]>([]);
  const [aiDiagnostics, setAiDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [agentPlannedChangeSet, setAgentPlannedChangeSet] = useState<PlannedAiChangeSet | null>(null);
  const [prototypeExtractionProposal, setPrototypeExtractionProposal] = useState<PlannedPrototypeExtractionProposal | null>(null);

  return {
    aiApplyState,
    setAiApplyState,
    aiPatchJournal,
    setAiPatchJournal,
    aiRedoJournal,
    setAiRedoJournal,
    aiDiffSummary,
    setAiDiffSummary,
    aiDiagnostics,
    setAiDiagnostics,
    agentPlannedChangeSet,
    setAgentPlannedChangeSet,
    prototypeExtractionProposal,
    setPrototypeExtractionProposal
  };
}

/** Sidebar visibility/width, resize drag state, and the Monaco editor handle. */
export function useLayoutUiState() {
  const [leftSidebarPanel, setLeftSidebarPanel] = useState<LeftSidebarPanel | undefined>("tree");
  const [jsonPanelOpen, setJsonPanelOpen] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(defaultLeftSidebarWidth);
  const [jsonSidebarWidth, setJsonSidebarWidth] = useState(defaultJsonSidebarWidth);
  const [sidebarResizeState, setSidebarResizeState] = useState<SidebarResizeState | null>(null);
  const [propertyPanelOpen, setPropertyPanelOpen] = useState(false);
  const [pendingJsonRevealPointer, setPendingJsonRevealPointer] = useState<string | undefined>(undefined);
  const [monacoApi, setMonacoApi] = useState<MonacoApi | null>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);

  return {
    leftSidebarPanel,
    setLeftSidebarPanel,
    jsonPanelOpen,
    setJsonPanelOpen,
    leftSidebarWidth,
    setLeftSidebarWidth,
    jsonSidebarWidth,
    setJsonSidebarWidth,
    sidebarResizeState,
    setSidebarResizeState,
    propertyPanelOpen,
    setPropertyPanelOpen,
    pendingJsonRevealPointer,
    setPendingJsonRevealPointer,
    monacoApi,
    setMonacoApi,
    editorRef
  };
}
