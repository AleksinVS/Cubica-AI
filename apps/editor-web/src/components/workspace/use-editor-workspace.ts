"use client";

/**
 * Controller hook module for the ADR-034 editor workspace.
 *
 * The editor treats repository authoring JSON as the editable source. React Flow
 * remains a derived projection: selection and drag state may change local canvas
 * layout, but manifest data is changed only through editor-engine JSON Patch
 * operations or direct Monaco text edits.
 *
 * `useEditorWorkspace` (below) owns all workspace state, effects, and handlers;
 * the presentational `EditorWorkspace` component and the panels in this folder
 * consume the returned controller object.
 */
import {
  applyNodeChanges,
  Position,
  type ReactFlowInstance,
  type Node,
  type NodeChange
} from "@xyflow/react";
import {
  buildAddViewFacetChangeSet,
  buildCreateEntityChangeSet,
  buildCreatePrototypeChangeSet,
  buildDeleteEntityChangeSet,
  buildRenameEntityIdChangeSet,
  buildEditorEntityYamlProjection,
  buildEntityGroupingTreeViewModel,
  buildPreviewTraceRestorePlan,
  changedPointersFromDiffSummary,
  classifyChangeSet,
  createPatchJournalStep,
  createPreviewPlaythroughTrace,
  createSchemaRegistry,
  detectIntentConflict,
  dryRunEditorChangeSet,
  enqueueIntent,
  hasActiveIntent,
  INTENT_STALE_DIAGNOSTIC_CODE,
  hashEditorText,
  interpretReturnedIntent,
  nextPendingIntentId,
  promoteNextRunnableIntent,
  readJsonPointer,
  refineIntentPointers,
  reviveEditorEntityProjection,
  transitionIntent,
  type ChangedPointersByFile,
  type ClassifyChangeSetResult,
  type EditorChangeSet,
  type EditorDiffSummaryItem,
  type EditorEntity,
  type EditorEntityProjection,
  type EditorEntityProjectionDocument,
  type EditorEntityProjectionState,
  type EditorEntitySourcePointer,
  type EditorPatchIntent,
  type IncrementalProjectionReport,
  type IntentJournalEntry,
  type IntentQueueEntry,
  type JsonValue,
  type PatchJournalStep,
  type QueuedIntentStatus,
  type PreviewEntityDescriptor,
  type PreviewPoint,
  type PreviewPlaythroughTrace,
  type PreviewRect,
  type PrototypeExtractionProposal,
  type ReturnedIntentInput
} from "@cubica/editor-engine";
import type {
  EntitySourceCapture,
  ReturnedIntentApplyOutcome
} from "@/components/workspace/entity-source-text-mode";
import { type CubicaAgentApprovalEnvelope } from "@cubica/contracts-ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { embeddedAuthoringSample } from "@/lib/authoring-sample";
import {
  registerLocalAuthoringSchemas,
  schemaIdForAuthoringDocument
} from "@/lib/editor-json-schema";
import {
  applyPropertyEditResult,
  applyJsonPropertyEditResult,
  applyWritableGraphOperation,
  coercePropertyValue,
  createEditorViewModel,
  findEditorNodeById,
  findEditorNodeForPointer,
  findTreeNodeForPointer,
  getBranchRootNode,
  getNodeAncestorIds,
  resolveActiveScreenEntityId,
  selectProperties,
  toRoutedDiagnostic,
  type EditorAuthoringEditResult,
  type EditorProperty,
  type EditorViewNode,
  type RoutedEditorDiagnostic,
  type WritableGraphOperation
} from "@/lib/editor-web-adapter";
import { createDefaultCollapsedTreePointers } from "@/components/json-tree-view";
import type { PrototypeAuditNoticeRecord } from "@/components/prototype-audit-notice";
import type { PreviewAiIntent, PreviewPromptContext } from "@/components/preview-selection-overlay";
import {
  isPlayerPreviewEntitiesMessage,
  isPlayerPreviewSessionSnapshotMessage,
  mapPlayerPreviewEntitiesToAuthoringDescriptors,
  type PreviewSelectionSourceMap
} from "@/lib/preview-message-adapter";
import { buildEditorAgentContextProjection } from "@/lib/agent-context-projection";
import {
  useEditorAgentConnection,
  type EditorAgentToolResult,
  type EditorAgentTools
} from "@/components/editor-agent-ui";

import {
  buildEditorAgentSurface,
  buildEditorApprovalEnvelope,
  editorApplyApprovalScope,
  editorSaveApprovalScope,
  editorUndoApprovalScope,
  prototypeProposalGatesPassed,
  toAgentDiagnostic,
  validateEditorAgentApproval
} from "@/components/workspace/agent-surface";
import type {
  EntityFacetSummary,
  IncomingReferenceSummary,
  RetargetOption
} from "@/components/workspace/entity-refactor-dialog";
import {
  applyEditorSiblingDocuments,
  createEditorSession,
  fetchAuthoringFile,
  fetchAuthoringList,
  fetchEditorLayout,
  fetchPrototypeAuditStatus,
  fetchStateFixtures,
  pinStateFixture,
  postEditorWorkflow,
  requestAiChangeSet,
  requestPrototypeExtractionProposal,
  saveEditorLayout,
  toPrototypeAuditNotice
} from "@/components/workspace/api-client";
import { dryRunMultiDocumentChangeSet } from "@/components/workspace/multi-document-apply";
import {
  deriveIntentJournalEntries,
  scopeActiveFilePointers,
  scopeChangeSetWritePointers
} from "@/components/workspace/intent-queue-controller";
import { collectEntityTypeOptions, type EntityTypeOption } from "@/components/workspace/entity-create-options";
import type { EntityTreeCreateRequest } from "@/components/workspace/entity-tree";
import {
  defaultJsonSidebarWidth,
  defaultLeftSidebarWidth,
  editorMarkerOwner,
  embeddedFilePath,
  jsonSidebarWidthMax,
  jsonSidebarWidthMin,
  leftSidebarWidthMax,
  leftSidebarWidthMin,
  semanticNodeColumnSpacing,
  semanticNodeDepthSpacing,
  semanticNodeHandles,
  semanticNodeHeight,
  semanticNodeRowsPerColumn,
  semanticNodeWidth,
  temporaryPlayPassthroughMs
} from "@/components/workspace/constants";
import {
  addPreviewReloadNonce,
  buildAiPatchTargetContexts,
  buildSelectedNodeAiPatchTargetContext,
  clampNumber,
  configureMonacoJson,
  createEmptyEditorLayout,
  derivePreviewFreshness,
  describePreviewFreshness,
  diagnosticsFromPluginValidation,
  filterServerOnlyDiagnostics,
  findNodeForPointer,
  getNodeDepth,
  getNodePosition,
  getSyncLabel,
  parentPointer,
  persistPreviewTraceSnapshot,
  persistPreviewTraceTruncation,
  planPreviewRecoveryLadder,
  pluginDiagnosticsFromWorkflowResponse,
  positionsFromLayout,
  prototypeSemanticsFromPrompt,
  readRuntimeEventVersion,
  readSessionIdFromPreviewUrl,
  safeUrlOrigin,
  shouldAutoApplyPreview,
  shouldOfferPreviewApply,
  summarizeNonVisualEntities,
  toMonacoMarker,
  toMonacoModelUri,
  toMonacoRange,
  toRepositoryAuthoringFilePath,
  truncatePreviewTrace,
  upsertRuntimeSnapshotInTrace
} from "@/components/workspace/workspace-helpers";
import type {
  AuthoringFileDocument,
  AuthoringFileSummary,
  CurrentDocument,
  EditorLayoutDocument,
  EditorLayoutDocumentBody,
  EditorPluginValidationResult,
  EditorPreviewRollbackResponse,
  EditorSessionListResult,
  EditorSessionSummary,
  LeftSidebarPanel,
  MonacoApi,
  MonacoEditorInstance,
  PlanCurrentAiChangeSetResult,
  PlannedAiChangeSet,
  PlannedPrototypeExtractionProposal,
  PreviewViewportMode,
  ProjectionSiblingDocument,
  RightSidebarPanel,
  SavedAuthoringFileDocument,
  SemanticFlowEdge,
  SemanticFlowNode,
  SidebarResizeState,
  StateFixtureSummary
} from "@/components/workspace/types";
import {
  useAiPatchState,
  useEntityTreeState,
  useLayoutUiState,
  usePreviewRuntimeState,
  useSelectionGraphState,
  useSessionDocumentState
} from "@/components/workspace/use-editor-workspace-state";


/**
 * Parses a sibling authoring document's text into projection JSON. An unparseable
 * sibling yields `undefined` json: the projection builder treats such a document
 * as contributing no entities (mirroring the active document, whose invalid JSON
 * also yields no projection), so a broken sibling never throws or blocks the open.
 */
function safeParseProjectionDocumentJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Running telemetry for the text-mode returned-intent interpreter (design-spec
 * §5): the share of deterministic vs agent paths, the share of stale returns, and
 * the cumulative size of each report bucket. Pure counters — no UI depends on them
 * in this slice; the controller exposes them for §5 telemetry / a future badge.
 */
export interface ReturnedIntentTelemetry {
  readonly deterministicCount: number;
  readonly agentCount: number;
  readonly staleCount: number;
  readonly totalCount: number;
  readonly appliedFragments: number;
  readonly recognizedNoChangeFragments: number;
  readonly unrecognizedFragments: number;
}

const emptyReturnedIntentTelemetry: ReturnedIntentTelemetry = {
  deterministicCount: 0,
  agentCount: 0,
  staleCount: 0,
  totalCount: 0,
  appliedFragments: 0,
  recognizedNoChangeFragments: 0,
  unrecognizedFragments: 0
};

/**
 * The execution side of a queued agent intent (ADR-057 §4.11). Kept in a ref, not
 * React state: `run` is the async closure that plans (if needed) and applies the
 * intent when it reaches the front of the queue; `cancelled` is set by a cancel
 * request so the runner skips the apply when it resumes; `plan` is the resolved
 * ChangeSet stashed when the intent went `stale`, so an "apply anyway" choice can
 * re-run the apply without re-planning.
 */
interface IntentRunnerRecord {
  cancelled: boolean;
  readonly run: (intentId: string) => void | Promise<void>;
  plan?: PlannedAiChangeSet;
}

/**
 * The open entity refactor dialog (Phase 6.2b, design-spec §3.2). `delete` carries
 * the scope the dialog lists (facets + incoming references + retarget candidates);
 * `rename` carries the current id + a slug seed and an optional refusal message
 * from a rejected `buildRenameEntityIdChangeSet`.
 */
export type EntityRefactorDialogState =
  | {
      readonly kind: "delete";
      readonly entityId: string;
      readonly entityLabel: string;
      readonly facets: readonly EntityFacetSummary[];
      readonly incomingReferences: readonly IncomingReferenceSummary[];
      readonly retargetOptions: readonly RetargetOption[];
    }
  | {
      readonly kind: "rename";
      readonly entityId: string;
      readonly entityLabel: string;
      readonly currentId: string;
      readonly suggestedId: string;
      readonly error?: string;
    };


/**
 * Controller hook for the ADR-034 editor workspace.
 *
 * This hook owns the entire behavioural surface of the workspace: repository /
 * session document state, the derived editor view model and graph projection,
 * preview runtime state and playthrough trace, AI ChangeSet planning/apply/undo,
 * layout/sidebar UI state, and every effect and event handler. It is a verbatim
 * extraction of the former `EditorWorkspace` component body — behaviour is
 * unchanged. The presentational `EditorWorkspace` component consumes the object
 * returned here and renders it through the panels in `./`.
 */
export function useEditorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedGameId = searchParams.get("gameId");
  const requestedFilePath = searchParams.get("file");

  // State is grouped by domain into small hooks (see use-editor-workspace-state).
  // Grouping is structural only: initializers and update semantics are unchanged.
  const {
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
  } = useSessionDocumentState();

  const {
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
  } = useSelectionGraphState();

  const {
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
    editorMode,
    setEditorMode,
    previewAppliedVersionHash,
    setPreviewAppliedVersionHash,
    previewIframeRef,
    previewPointerPlayResetRef
  } = usePreviewRuntimeState();

  const {
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
  } = useAiPatchState();

  const {
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
  } = useLayoutUiState();

  const {
    entityTreeGrouping,
    setEntityTreeGrouping,
    entityTreeSelectedEntityId,
    setEntityTreeSelectedEntityId
  } = useEntityTreeState();

  const schemaRegistry = useMemo(() => {
    const registry = createSchemaRegistry();
    registerLocalAuthoringSchemas(registry);
    return registry;
  }, []);

  // --- Incremental entity-projection wiring (ADR-057 §4.13, Phase 2.1) --------
  //
  // `projectionStateRef` holds the projection state (projection + its build
  // input) from the LAST COMMITTED view model; the next build diffs against it.
  // It is updated in a post-commit effect so it only ever reflects a state React
  // actually kept.
  const projectionStateRef = useRef<EditorEntityProjectionState | null>(null);
  // A ONE-SHOT context describing the pointers a just-applied JSON Patch touched,
  // paired with the exact `text` those pointers apply to. The view-model memo
  // reads-and-clears it, and only uses it when `text === jsonText`, so any stale
  // context (a no-op edit, a Monaco free-text edit, a file reload) is ignored and
  // the build falls back to a full rebuild — identical to the previous behaviour.
  const pendingProjectionEditRef = useRef<{ readonly changedPointersByFile: ChangedPointersByFile; readonly text: string } | null>(null);
  // A ONE-SHOT warm-start hydration (ADR-057 §4.13, Phase 2.2b): a projection
  // revived from the Level-2 disk cache and shipped with a freshly opened
  // document, paired with the exact `text` it was built from. The view-model memo
  // reads-and-clears it and only uses it when `text === jsonText` and there is no
  // pending edit, so a stale envelope (a reload, an edit that raced the open)
  // silently falls back to a full rebuild — identical to today's behaviour.
  const pendingHydrationRef = useRef<{ readonly projection: EditorEntityProjection; readonly text: string } | null>(null);
  // Telemetry-only: the report of the most recent incremental/full projection
  // update (design-spec §5). No UI depends on it in this slice; it is exposed on
  // the controller for the status data and future surfacing.
  const [projectionIncrementalReport, setProjectionIncrementalReport] = useState<IncrementalProjectionReport | null>(null);

  // --- Returned-intent telemetry (design-spec §5, Phase 4.2) ------------------
  //
  // Running tallies for the text-mode interpreter: how often the deterministic vs
  // agent path is taken, how often the projection was stale, and the total size of
  // each report bucket. No UI depends on it in this slice; it is exposed on the
  // controller (and a compact badge could read it) for the §5 telemetry.
  const [returnedIntentTelemetry, setReturnedIntentTelemetry] = useState<ReturnedIntentTelemetry>(emptyReturnedIntentTelemetry);

  // --- Agent intent queue with optimistic concurrency (ADR-057 §4.11; UX §9.5;
  //     design-spec §2.4) --------------------------------------------------------
  //
  // Only AGENT intents (preview entity/region prompt, text-mode "apply as
  // intent") enter this queue; MANUAL form edits (property edit, «+» create,
  // delete/rename) apply immediately and never queue (§9.5). Each queued intent
  // captures the journal sequence + the pointers it read/writes; at apply time it
  // is dry-run against the LIVE document and its captured pointers are checked for
  // conflict against journal edits committed since capture (`intent-stale`).
  //
  // `intentQueue` is the render mirror; `intentQueueRef` is the synchronous truth
  // the runners read. `intentRunnersRef` holds each intent's execution closure and
  // its cancel flag (kept off React state — closures are not serialisable and must
  // not trigger renders). `intentStartedRef` guards against double-invoking a
  // runner if the promotion effect fires twice for the same commit.
  const [intentQueue, setIntentQueue] = useState<readonly IntentQueueEntry[]>([]);
  const intentQueueRef = useRef<readonly IntentQueueEntry[]>([]);
  const intentRunnersRef = useRef(new Map<string, IntentRunnerRecord>());
  const intentStartedRef = useRef(new Set<string>());
  const intentSeqRef = useRef(0);
  // A queued runner is a closure from the render that submitted it, but it runs
  // later (from the promotion effect), so it must NOT apply against that old
  // render's snapshot — it would dry-run against a stale document and clobber an
  // intervening non-overlapping edit. This ref always points at the LATEST apply
  // pipeline, which dry-runs against the CURRENT `viewModel.snapshot` (§2.4
  // "dry-run против актуального состояния"). Assigned after the function exists.
  const latestApplyPlannedRef = useRef<
    ((plan: PlannedAiChangeSet, options?: { readonly approval?: CubicaAgentApprovalEnvelope; readonly classification?: ClassifyChangeSetResult }) => EditorAgentToolResult) | null
  >(null);
  // Render-synced mirror of the session AI-patch journal so a runner (which fires
  // from a post-commit effect) always reads the CURRENT journal for conflict
  // detection, even after an earlier serialized intent committed its edit.
  const aiPatchJournalRef = useRef<readonly PatchJournalStep[]>(aiPatchJournal);
  aiPatchJournalRef.current = aiPatchJournal;

  // --- Pinned state fixtures (ADR-057 §4.9, §9.3; design-spec §3.3) ------------
  //
  // The game's pinned fixtures, listed from `games/<id>/authoring/fixtures/` with
  // their `fixture-stale` verdict. Selecting one seeds the Design-mode preview
  // state through the EXISTING preview-only restore path; pinning writes a new
  // fixture into the session worktree (committed on Save). `selectedFixtureId` is
  // the author's explicit pick; the effective selection falls back to the §9.3
  // default order (pinned fixture for the active screen → first pinned → none).
  const [stateFixtures, setStateFixtures] = useState<readonly StateFixtureSummary[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | undefined>(undefined);

  // --- Project-level projection wiring (ADR-057 §4.1, Phase 3.a) --------------
  //
  // The editor now builds ONE cross-document entity projection over the whole
  // game: the active edited document (via `jsonText`) plus every SIBLING authoring
  // document (game + each ui/<channel>), shipped by the file route. A UI element
  // referencing a game entity contributes its view facet to that game entity, so
  // the projection carries all facets and cross-document occurrences.
  const [projectionSiblingDocuments, setProjectionSiblingDocuments] = useState<readonly ProjectionSiblingDocument[]>([]);
  // The active preview channel (the open UI document's channel, or undefined for a
  // game document). Server-derived and stable per open; a projection input, so it
  // is in the incremental/full-rebuild decision AND the warm-start cache key.
  const [activeChannel, setActiveChannel] = useState<string | undefined>(undefined);
  // The sibling documents parsed into projection inputs ONCE per open (not per
  // render): the active document is supplied separately by `createEditorViewModel`
  // from its live snapshot, so it is intentionally not in this list.
  const projectionDocumentInputs = useMemo<readonly EditorEntityProjectionDocument[]>(
    () =>
      projectionSiblingDocuments.map((document) => ({
        filePath: document.filePath,
        json: safeParseProjectionDocumentJson(document.text),
        documentKind: document.documentKind,
        ...(document.channel !== undefined ? { channel: document.channel } : {})
      })),
    [projectionSiblingDocuments]
  );
  // The projection inputs (text + channel + sibling set) that produced the LAST
  // COMMITTED projection. When a render recomputes the view model for a reason
  // that does NOT touch the projection (selection, expand/collapse), these still
  // match, so the previous projection is reused verbatim instead of rebuilt. The
  // match is by value/reference equality, so a reused projection is provably equal
  // to a rebuild (ADR-057 §5 transparency). Updated in the post-commit effect.
  const committedProjectionInputsRef = useRef<{
    readonly text: string;
    readonly activeChannel: string | undefined;
    readonly documents: readonly EditorEntityProjectionDocument[];
  } | null>(null);

  const schemaId = useMemo(
    () => schemaIdForAuthoringDocument(currentDocument.filePath, undefined),
    [currentDocument.filePath]
  );
  const monacoModelUri = useMemo(() => toMonacoModelUri(currentDocument), [currentDocument]);
  const viewModel = useMemo(
    () => {
      // Consume the one-shot changed-pointer context for THIS build only. It is
      // used solely when it matches the current text and a previous state exists;
      // every miss falls back to a full rebuild (unchanged behaviour).
      const pending = pendingProjectionEditRef.current;
      pendingProjectionEditRef.current = null;
      const previousState = projectionStateRef.current;
      const incremental =
        pending !== null && previousState !== null && pending.text === jsonText
          ? { previousState, changedPointersByFile: pending.changedPointersByFile }
          : undefined;

      // Consume the one-shot warm-start hydration for THIS build only. It wins
      // over a pending edit (a fresh open has no edit) and is used only when its
      // text still matches; a stale envelope falls back to a normal build.
      const hydration = pendingHydrationRef.current;
      pendingHydrationRef.current = null;

      // Choose the projection substitute (built-as-is, not rebuilt): the hydrated
      // warm-start projection, or — when the projection inputs are byte-identical
      // to the last committed build (a selection/expand recompute) — the previous
      // projection reused verbatim. Both are provably equal to a rebuild.
      const committed = committedProjectionInputsRef.current;
      let hydratedProjection: EditorEntityProjection | undefined;
      if (hydration !== null && incremental === undefined && hydration.text === jsonText) {
        hydratedProjection = hydration.projection;
      } else if (
        pending === null &&
        incremental === undefined &&
        previousState !== null &&
        committed !== null &&
        committed.text === jsonText &&
        committed.activeChannel === activeChannel &&
        committed.documents === projectionDocumentInputs
      ) {
        hydratedProjection = previousState.projection;
      }

      return createEditorViewModel(jsonText, {
        filePath: currentDocument.filePath,
        schemaRegistry,
        schemaId,
        graphState: {
          selectedNodeId,
          activeBranchRootId,
          expandedNodeIds: [...expandedNodeIds],
          collapsedNodeIds: [...collapsedNodeIds],
          maxVisibleNodes: activeBranchRootId === undefined ? 25 : 60,
          maxExpandedChildren: 36
        },
        extraDiagnostics: reverseDiagnostics
          .concat(aiDiagnostics)
          .concat(workflowDiagnostics),
        editorEntityProjectionDocuments: projectionDocumentInputs,
        activeChannel,
        incremental,
        hydratedProjection
      });
    },
    [
      activeBranchRootId,
      activeChannel,
      collapsedNodeIds,
      currentDocument.filePath,
      expandedNodeIds,
      jsonText,
      aiDiagnostics,
      projectionDocumentInputs,
      reverseDiagnostics,
      schemaId,
      schemaRegistry,
      selectedNodeId,
      workflowDiagnostics
    ]
  );

  // Post-commit: remember the committed projection state so the NEXT edit can
  // diff against it, and surface the update telemetry (design-spec §5). Reading
  // the ref during render and writing it here (not during render) keeps the
  // "previous state" strictly a value React actually kept.
  useEffect(() => {
    projectionStateRef.current = viewModel.projectionState;
    // Remember the exact projection inputs this committed build used, so a later
    // recompute that leaves them untouched can reuse the projection verbatim.
    committedProjectionInputsRef.current = { text: jsonText, activeChannel, documents: projectionDocumentInputs };
    if (viewModel.incrementalReport !== undefined) {
      setProjectionIncrementalReport(viewModel.incrementalReport);
    }
  }, [viewModel]);

  const selectedNode = findEditorNodeById(viewModel.fullNodes, selectedNodeId) ?? viewModel.fullNodes[0];
  const activeTree = treeDetailMode === "entities" ? viewModel.tree : viewModel.jsonTree;
  const selectedValue = selectedNode === undefined || viewModel.snapshot.json === undefined ? undefined : readJsonPointer(viewModel.snapshot.json, selectedNode.pointer);
  const properties = selectedNode ? selectProperties(viewModel.snapshot, selectedNode.pointer) : [];

  // --- Grouped entity tree wiring (Phase 3.b.2, design-spec §3.1) -------------
  //
  // The entity the CURRENT authoring selection resolves to (mirrors the
  // pointer -> entities lookup `agentSelectedEditorEntities` uses below) — the
  // "selection/preview" half of "activeScreenEntityId = активный экран из
  // preview/selection, если доступен".
  const selectedPointer = selectedNode?.pointer;
  const selectionDerivedEntityId =
    selectedPointer === undefined || selectedPointer === ""
      ? undefined
      : viewModel.editorEntityProjection.entitiesBySourcePointer.get(`${currentDocument.filePath}#${selectedPointer}`)?.[0]?.entityId;
  // Entity the tree treats as "selected" for occurrence soft-highlighting: the
  // last one picked THROUGH the tree wins (covers cross-document entities the
  // authoritative selection above cannot resolve), else the current selection.
  const entityTreeActiveEntityId = entityTreeSelectedEntityId ?? selectionDerivedEntityId;
  // --- Floating entity inspector (Phase 3.c, design-spec §3.2) ----------------
  //
  // The inspector opens for whichever entity the tree/preview selection resolves
  // to (`entityTreeActiveEntityId`). Esc "closes" it by remembering the dismissed
  // entity id: selecting a DIFFERENT entity re-opens the same window (design-spec
  // §3.2 "переключение сущности переиспользует окно"); re-selecting the dismissed
  // one keeps it closed until the selection actually moves.
  const [dismissedInspectorEntityId, setDismissedInspectorEntityId] = useState<string | undefined>(undefined);
  const inspectorEntityId =
    entityTreeActiveEntityId !== undefined && entityTreeActiveEntityId !== dismissedInspectorEntityId
      ? entityTreeActiveEntityId
      : undefined;
  const handleInspectorClose = useCallback(() => {
    setDismissedInspectorEntityId(entityTreeActiveEntityId);
  }, [entityTreeActiveEntityId]);
  // --- Entity refactor dialogs (Phase 6.2b, design-spec §3.2; §9.1) -----------
  //
  // The open delete/rename dialog, or `null`. Opening the delete dialog probes the
  // incoming references with the `abort` policy; opening the rename dialog seeds
  // the new-id input. The dangerous confirm flows through the SAME approval-envelope
  // gate the agent apply path uses (see `applyEntityOperationChangeSet`).
  const [entityRefactorDialog, setEntityRefactorDialog] = useState<EntityRefactorDialogState | null>(null);
  const activeScreenEntityId = useMemo(
    () => resolveActiveScreenEntityId(viewModel.editorEntityProjection, entityTreeActiveEntityId),
    [viewModel.editorEntityProjection, entityTreeActiveEntityId]
  );
  const entityGroupingTree = useMemo(
    () =>
      buildEntityGroupingTreeViewModel({
        projection: viewModel.editorEntityProjection,
        grouping: entityTreeGrouping,
        documents: viewModel.entityProjectionDocuments,
        activeChannel,
        activeScreenEntityId
      }),
    [viewModel.editorEntityProjection, entityTreeGrouping, viewModel.entityProjectionDocuments, activeChannel, activeScreenEntityId]
  );
  // --- «+» create menu inputs (Phase 6.2a, part B; design-spec §3.1) ----------
  //
  // The UI-facet channel for a newly created visual entity: the active channel,
  // else the first UI channel the project declares (game-agnostic). The searchable
  // menu lists every type + local prototype the project declares.
  const entityCreateChannel = useMemo(() => {
    if (activeChannel !== undefined) {
      return activeChannel;
    }
    return viewModel.entityProjectionDocuments.find((document) => document.documentKind === "ui" && document.channel !== undefined)?.channel;
  }, [activeChannel, viewModel.entityProjectionDocuments]);
  const entityCreateOptions = useMemo<readonly EntityTypeOption[]>(
    () => collectEntityTypeOptions({ documents: viewModel.entityProjectionDocuments, channel: entityCreateChannel }),
    [viewModel.entityProjectionDocuments, entityCreateChannel]
  );
  // In «По экранам», a selected entity in the ACTIVE document becomes the drop
  // container (a component in that container); otherwise the new node is top-level
  // (a new screen). Cross-document containers are out of scope for this slice.
  const entityCreateContainerPointer = useMemo(() => {
    if (entityTreeGrouping !== "byScreen" || entityTreeActiveEntityId === undefined) {
      return undefined;
    }
    const entity = viewModel.editorEntityProjection.entityById.get(entityTreeActiveEntityId);
    if (entity === undefined || entity.primarySource.filePath !== currentDocument.filePath) {
      return undefined;
    }
    return `${entity.primarySource.pointer}/children`;
  }, [entityTreeGrouping, entityTreeActiveEntityId, viewModel.editorEntityProjection.entityById, currentDocument.filePath]);
  const graphTargetNodes = useMemo(
    () =>
      viewModel.fullNodes.filter(
        (node) => node.pointer !== selectedNode?.pointer && node.role !== "property" && (node.valueType === "object" || node.valueType === "array")
      ),
    [selectedNode?.pointer, viewModel.fullNodes]
  );
  const hasBlockingDiagnostics = viewModel.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasLocalSchemaBlockingDiagnostics = viewModel.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && (diagnostic.source === "syntax" || diagnostic.source === "schema")
  );
  const isDirty = jsonText !== savedText;
  const nonVisualEntityCounts = useMemo(() => summarizeNonVisualEntities(viewModel.fullNodes), [viewModel.fullNodes]);
  const previewTraceEntries = previewTrace.events.slice(-8);
  const currentPreviewTraceEvent = previewTrace.events.length === 0
    ? undefined
    : previewTrace.events[previewTrace.events.length - 1];
  const selectedPreviewTraceEvent = selectedPreviewTraceSequence === undefined
    ? currentPreviewTraceEvent
    : previewTrace.events.find((event) => event.sequence === selectedPreviewTraceSequence) ?? currentPreviewTraceEvent;
  const selectedPreviewTraceSnapshot = selectedPreviewTraceEvent === undefined
    ? undefined
    : previewTrace.snapshots.find((snapshot) => snapshot.eventSequence === selectedPreviewTraceEvent.sequence);
  // The runtime snapshot a "Закрепить как фикстуру" action would capture: the
  // selected trace point, or the latest snapshot when nothing is selected.
  const pinnableTraceSnapshot = selectedPreviewTraceSnapshot ?? previewTrace.snapshots[previewTrace.snapshots.length - 1];
  const pinnableFixtureState =
    pinnableTraceSnapshot !== undefined &&
    typeof pinnableTraceSnapshot.state === "object" &&
    pinnableTraceSnapshot.state !== null &&
    !Array.isArray(pinnableTraceSnapshot.state)
      ? (pinnableTraceSnapshot.state as Record<string, unknown>)
      : undefined;
  // Pinning needs a session worktree (so the file commits on Save) and a runtime
  // snapshot to capture. Both together gate the "Закрепить как фикстуру" control.
  const canPinFixture = editorSession !== null && pinnableFixtureState !== undefined;
  // §9.3 default order: a pinned fixture bound to the active screen wins, else the
  // first pinned fixture; when none exist the preview keeps its synthetic/auto seed.
  const defaultFixtureId = useMemo(() => {
    if (stateFixtures.length === 0) {
      return undefined;
    }
    const forScreen =
      activeScreenEntityId === undefined ? undefined : stateFixtures.find((fixture) => fixture.screenRef === activeScreenEntityId);
    return (forScreen ?? stateFixtures[0]).id;
  }, [stateFixtures, activeScreenEntityId]);
  const effectiveSelectedFixtureId = selectedFixtureId ?? defaultFixtureId;
  const agentConnection = useEditorAgentConnection();
  const agentSelectedPointers = useMemo(() => {
    const pointers = new Set<string>();
    if (selectedNode?.pointer !== undefined && selectedNode.pointer !== "") {
      pointers.add(selectedNode.pointer);
    }
    for (const entity of previewPromptContext?.entities ?? []) {
      if (entity.authoringPointer !== "") {
        pointers.add(entity.authoringPointer);
      }
    }
    return [...pointers];
  }, [previewPromptContext?.entities, selectedNode?.pointer]);
  const agentSelectedPreviewEntities = useMemo(
    () =>
      (previewPromptContext?.entities ?? (selectedPreviewEntityId === undefined ? [] : previewEntities.filter((entity) => entity.entityId === selectedPreviewEntityId))).map(
        (entity) => ({
          entityId: entity.entityId,
          label: entity.label,
          semanticRole: entity.semanticRole,
          authoringPointer: entity.authoringPointer
        })
      ),
    [previewEntities, previewPromptContext?.entities, selectedPreviewEntityId]
  );
  const agentSelectedEditorEntities = useMemo(() => {
    const entitiesById = new Map<string, (typeof viewModel.editorEntityProjection.entities)[number]>();
    for (const pointer of agentSelectedPointers) {
      const sourceKey = `${currentDocument.filePath}#${pointer}`;
      for (const entity of viewModel.editorEntityProjection.entitiesBySourcePointer.get(sourceKey) ?? []) {
        entitiesById.set(entity.entityId, entity);
      }
    }

    return [...entitiesById.values()];
  }, [agentSelectedPointers, currentDocument.filePath, viewModel.editorEntityProjection.entities, viewModel.editorEntityProjection.entitiesBySourcePointer]);
  const editorAgentContext = useMemo(
    () =>
      buildEditorAgentContextProjection({
        sessionId: editorSession?.sessionId,
        gameId: currentDocument.gameId,
        activeFilePath: currentDocument.filePath,
        activeFileVersionHash: currentDocument.versionHash,
        document: viewModel.snapshot.json,
        selectedPointers: agentSelectedPointers,
        selectedPreviewEntities: agentSelectedPreviewEntities,
        selectedEditorEntities: agentSelectedEditorEntities,
        diagnostics: viewModel.documentDiagnostics,
        previewTraceSummary:
          previewTrace.events.length === 0
            ? undefined
            : {
                traceId: previewTrace.traceId,
                eventCount: previewTrace.events.length,
                currentEventLabel: currentPreviewTraceEvent?.label,
                selectedEventLabel: selectedPreviewTraceEvent?.label
              }
      }),
    [
      agentSelectedPointers,
      agentSelectedPreviewEntities,
      agentSelectedEditorEntities,
      currentDocument.filePath,
      currentDocument.gameId,
      currentDocument.versionHash,
      currentPreviewTraceEvent?.label,
      editorSession?.sessionId,
      previewTrace.events.length,
      previewTrace.traceId,
      selectedPreviewTraceEvent?.label,
      viewModel.documentDiagnostics,
      viewModel.snapshot.json
    ]
  );
  // Single risk classification (ADR-057 §4.5) for the currently planned agent
  // ChangeSet. It feeds BOTH the approval scope shown to the human and the
  // apply-time gate, so the scope the user approves matches the scope enforced.
  const agentPlannedChangeClassification = useMemo<ClassifyChangeSetResult | null>(
    () =>
      agentPlannedChangeSet === null
        ? null
        : classifyChangeSet(agentPlannedChangeSet.changeSet, viewModel.editorEntityProjection),
    [agentPlannedChangeSet, viewModel.editorEntityProjection]
  );
  const editorAgentSurface = useMemo(
    () =>
      buildEditorAgentSurface({
        aiApplyState,
        aiDiffSummary,
        aiDiagnostics,
        prototypeExtractionProposal,
        hasPlannedChangeSet: agentPlannedChangeSet !== null,
        hasUndoPatch: aiPatchJournal.length > 0,
        applyApprovalScopeHash: editorApplyApprovalScope(agentPlannedChangeSet, agentPlannedChangeClassification ?? undefined),
        undoApprovalScopeHash: editorUndoApprovalScope(aiPatchJournal.length)
      }),
    [
      agentPlannedChangeSet,
      agentPlannedChangeClassification,
      aiApplyState,
      aiDiagnostics,
      aiDiffSummary,
      aiPatchJournal.length,
      prototypeExtractionProposal
    ]
  );
  const leftSidebarOpen = leftSidebarPanel !== undefined;
  const rightSidebarPanel: RightSidebarPanel | undefined = propertyPanelOpen ? "properties" : jsonPanelOpen ? "json" : undefined;
  const rightSidebarOpen = rightSidebarPanel !== undefined;
  const effectivePreviewInspectMode = previewInspectMode && !altPlayActive && !previewPointerPlayMode;
  const previewModeLabel = effectivePreviewInspectMode ? "Inspect" : "Play";
  // Playthrough-axis freshness (editor-preview-first-ux §9.6). A prepared preview
  // lags behind edits when there are unsaved edits (`isDirty`) or saved content
  // has moved past what the preview was applied at. "Blocked" reflects a broken
  // compile that hides any valid edit behind the last valid render.
  const previewCompileBlocked = hasBlockingDiagnostics || hasLocalSchemaBlockingDiagnostics;
  const previewHasUnappliedEdits =
    previewUrl !== null &&
    currentDocument.source === "repository" &&
    (isDirty || (currentDocument.versionHash !== undefined && currentDocument.versionHash !== previewAppliedVersionHash));
  const previewFreshness = derivePreviewFreshness({
    previewPrepared: previewUrl !== null,
    compileBlocked: previewCompileBlocked,
    hasUnappliedEdits: previewHasUnappliedEdits
  });
  const previewFreshnessDescriptor = describePreviewFreshness(previewFreshness);
  // "Применить" is offered only in "Превью" when the preview is genuinely behind
  // VALID edits and the apply pipeline can run (not mid-workflow).
  const canApplyEditsToPreview = shouldOfferPreviewApply({
    editorMode,
    freshness: previewFreshness,
    workflowBusy: workflowState === "compiling" || workflowState === "previewing"
  });
  const workspaceStyle = {
    "--left-sidebar-width": `${leftSidebarOpen ? leftSidebarWidth : 0}px`,
    "--json-sidebar-width": `${rightSidebarOpen ? jsonSidebarWidth : 0}px`
  } as CSSProperties;
  const editorAgentTools: EditorAgentTools = {
    planChangeSet: (input) => runAgentPlanTool(input.prompt),
    proposePrototypeExtraction: (input) => runAgentPrototypeExtractionTool(input),
    preparePrototypeChangeSet: () => runAgentPreparePrototypeChangeSetTool(),
    dryRunChangeSet: (input) => runAgentDryRunTool(input.prompt),
    applyChangeSet: (input) => runAgentApplyTool(input.prompt, input.approval),
    undoLastPatch: async (input) => runAgentUndoTool(input?.approval),
    preparePreview: async () => {
      await handlePreview();
      return {
        ok: true,
        summary: "Preview preparation requested through the existing editor preview route."
      };
    },
    saveSession: async (input) => {
      const approvalError = validateEditorAgentApproval(
        input.approval,
        "editor.saveSession",
        editorSaveApprovalScope(currentDocument.versionHash ?? "no-version-hash", editorSession?.sessionId)
      );
      if (approvalError !== null) {
        return approvalError;
      }

      await handleSave();
      return {
        ok: true,
        summary: "Save requested through the existing editor file route."
      };
    }
  };

  const projectedNodes = useMemo<SemanticFlowNode[]>(
    () => {
      const countByDepth = new Map<number, number>();
      for (const node of viewModel.nodes) {
        const depth = getNodeDepth(node);
        countByDepth.set(depth, (countByDepth.get(depth) ?? 0) + 1);
      }

      const xByDepth = new Map<number, number>();
      let nextDepthX = 0;
      for (const depth of [...countByDepth.keys()].sort((left, right) => left - right)) {
        const nodeCount = countByDepth.get(depth) ?? 0;
        const columnCount = Math.max(1, Math.ceil(nodeCount / semanticNodeRowsPerColumn));
        xByDepth.set(depth, nextDepthX);
        nextDepthX += columnCount * semanticNodeColumnSpacing + semanticNodeDepthSpacing;
      }

      const slotByDepth = new Map<number, number>();

      return viewModel.nodes.map((node) => {
        const depth = getNodeDepth(node);
        const slot = slotByDepth.get(depth) ?? 0;
        slotByDepth.set(depth, slot + 1);

        return {
          id: node.id,
          type: "semantic",
          position: localNodePositions.get(node.id) ?? editorLayout.nodes[node.id]?.position ?? getNodePosition(xByDepth.get(depth) ?? 0, slot),
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          handles: semanticNodeHandles,
          initialWidth: semanticNodeWidth,
          initialHeight: semanticNodeHeight,
          width: semanticNodeWidth,
          height: semanticNodeHeight,
          selected: node.id === selectedNodeId,
          className: `presentation-${node.presentationRole} semantic-role-${node.semanticRole}`,
          data: {
            semanticRole: node.semanticRole,
            semanticTitle: node.semanticTitle,
            semanticSummary: node.semanticSummary,
            presentationRole: node.presentationRole,
            pointer: node.pointer,
            valueType: node.valueType,
            childCount: node.childCount,
            expandable: node.expandable,
            expanded: expandedNodeIds.has(node.id) && !collapsedNodeIds.has(node.id)
          }
        };
      });
    },
    [collapsedNodeIds, editorLayout.nodes, expandedNodeIds, localNodePositions, selectedNodeId, viewModel.nodes]
  );

  useEffect(() => {
    setFlowNodes(projectedNodes);
  }, [projectedNodes]);

  useEffect(() => {
    editorSessionRef.current = editorSession;
  }, [editorSession]);

  const visibleNodeIds = useMemo(() => new Set(flowNodes.map((node) => node.id)), [flowNodes]);
  const flowEdges = useMemo<SemanticFlowEdge[]>(
    () =>
      viewModel.edges
        .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: "semantic",
          animated: edge.role === "references",
          data: {
            role: edge.role,
            label: edge.label
          }
        })),
    [viewModel.edges, visibleNodeIds]
  );

  const fitViewDependency = useMemo(
    () => flowNodes.map((node) => node.id).join("\u001f"),
    [flowNodes]
  );

  useEffect(() => {
    const flow = flowRef.current;
    if (flow === null || flowNodes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.18, duration: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitViewDependency, leftSidebarOpen, rightSidebarOpen, flowNodes.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadFromRepository() {
      setLoadState("loading");
      setStatusMessage("Opening editor session...");

      try {
        const list = await openSessionFileList(requestedGameId);
        const session = list.session;
        if (cancelled) {
          return;
        }

        if (session !== null) {
          setEditorSession(session);
          editorSessionRef.current = session;
        }

        const filePath =
          requestedFilePath !== null && list.files.some((file) => file.filePath === requestedFilePath)
            ? requestedFilePath
            : list.defaultFilePath;

        if (filePath === undefined) {
          throw new Error(`No editable authoring files were found for ${list.gameId}.`);
        }

        const document = await fetchAuthoringFile(list.gameId, filePath, session?.sessionId);
        if (cancelled) {
          return;
        }

        setAvailableGames(list.games);
        setAvailableFiles(list.files);
        const layout = await fetchEditorLayout(list.gameId, filePath, session?.sessionId).catch(() => undefined);
        if (cancelled) {
          return;
        }

        applyLoadedDocument(document, layout);
        setLoadState("ready");
        setSaveState("idle");
        setStatusMessage(session === null ? "Loaded from repository" : `Loaded session ${session.branchName}`);

        if (requestedGameId !== list.gameId || requestedFilePath !== filePath) {
          replaceUrlState(list.gameId, filePath);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        loadEmbeddedFallback(error);
      }
    }

    void loadFromRepository();

    return () => {
      cancelled = true;
    };
  }, [requestedFilePath, requestedGameId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPrototypeAuditStatus() {
      if (currentDocument.source !== "repository") {
        setPrototypeAuditNotice(null);
        setPrototypeAuditSnoozed(false);
        return;
      }

      try {
        const response = await fetchPrototypeAuditStatus();
        if (cancelled) {
          return;
        }
        setPrototypeAuditNotice(toPrototypeAuditNotice(response));
        setPrototypeAuditSnoozed(false);
      } catch {
        if (!cancelled) {
          setPrototypeAuditNotice({
            notification: "missing",
            message: "Weekly prototype audit status is unavailable."
          });
          setPrototypeAuditSnoozed(false);
        }
      }
    }

    void loadPrototypeAuditStatus();

    return () => {
      cancelled = true;
    };
  }, [currentDocument.filePath, currentDocument.source, currentDocument.versionHash]);

  // Load the game's pinned fixtures on open and whenever the game/session changes
  // (design-spec §3.3). A saved edit changes `versionHash`, refreshing the list so
  // the `fixture-stale` badges re-evaluate against the new manifest hash.
  useEffect(() => {
    void loadStateFixtures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocument.gameId, currentDocument.source, currentDocument.versionHash, editorSession?.sessionId]);

  useEffect(() => {
    if (monacoApi === null) {
      return;
    }

    configureMonacoJson(monacoApi, monacoModelUri, schemaId);
  }, [monacoApi, monacoModelUri, schemaId]);

  useEffect(() => {
    if (rightSidebarPanel !== "json") {
      editorRef.current = null;
    }
  }, [rightSidebarPanel]);

  useEffect(() => {
    if (monacoApi === null || editorRef.current === null) {
      return;
    }

    const model = editorRef.current.getModel();
    if (model === null) {
      return;
    }

    monacoApi.editor.setModelMarkers(
      model,
      editorMarkerOwner,
      viewModel.diagnostics.map((diagnostic) => toMonacoMarker(monacoApi, model, diagnostic))
    );
  }, [monacoApi, monacoModelUri, viewModel.diagnostics]);

  useEffect(() => {
    if (rightSidebarPanel === "json" && selectedNode !== undefined) {
      revealJsonPointer(selectedNode.pointer);
    }
  }, [rightSidebarPanel, selectedNode?.pointer, viewModel.snapshot.locationMap]);

  useEffect(() => {
    if (rightSidebarPanel !== "json" || pendingJsonRevealPointer === undefined || editorRef.current === null) {
      return;
    }

    revealJsonPointer(pendingJsonRevealPointer);
    setPendingJsonRevealPointer(undefined);
  }, [monacoApi, pendingJsonRevealPointer, rightSidebarPanel, viewModel.snapshot.locationMap]);

  useEffect(() => {
    if (previewUrl === null) {
      return;
    }

    const expectedOrigin = safeUrlOrigin(previewUrl);

    function handlePreviewMessage(event: MessageEvent) {
      const frameWindow = previewIframeRef.current?.contentWindow;
      if (frameWindow === undefined || event.source !== frameWindow) {
        return;
      }

      if (expectedOrigin !== undefined && event.origin !== expectedOrigin) {
        return;
      }

      if (isPlayerPreviewEntitiesMessage(event.data)) {
        const mapped = mapPlayerPreviewEntitiesToAuthoringDescriptors(event.data.entities, previewSourceMaps, {
          currentAuthoringFile: currentDocument.filePath,
          gameId: currentDocument.gameId
        });

        setPreviewEntities(mapped.descriptors);
        setPreviewUnresolvedEntityCount(mapped.unresolved.length);
        return;
      }

      if (isPlayerPreviewSessionSnapshotMessage(event.data)) {
        if (previewRuntimeSessionId !== undefined && event.data.sessionId !== previewRuntimeSessionId) {
          return;
        }
        if (event.data.gameId !== undefined && event.data.gameId !== currentDocument.gameId) {
          return;
        }

        setSelectedPreviewTraceSequence(event.data.sessionVersion.lastEventSequence);
        setPreviewRuntimeSessionId(event.data.sessionId);
        setPreviewTrace((currentTrace) => {
          const nextTrace = upsertRuntimeSnapshotInTrace(currentTrace, event.data);
          void persistPreviewTraceSnapshot(nextTrace, event.data, editorSessionRef.current?.sessionId).catch(() => {
            setStatusMessage("Preview trace persistence failed.");
          });
          return nextTrace;
        });
        setPreviewRollbackState((current) => (current === "restoring" ? "restored" : current));
      }
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [currentDocument.filePath, currentDocument.gameId, previewRuntimeSessionId, previewSourceMaps, previewUrl]);

  // Design-mode auto-apply (ADR-057 §4.8; design-spec §3.3). In "Дизайн" a valid
  // (compilable) edit applies to the preview automatically after a debounce,
  // reusing the same persist+compile+preview pipeline as the manual path. Keyed
  // on the freshness axis so it fires only when the preview genuinely lags valid
  // edits; "Превью" is excluded (edits there wait for explicit "Применить").
  useEffect(() => {
    if (!shouldAutoApplyPreview({ editorMode, freshness: previewFreshness })) {
      return;
    }
    const handle = window.setTimeout(() => {
      void applyEditsToPreview("design");
    }, 800);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, previewFreshness, jsonText, currentDocument.versionHash]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Alt") {
        setAltPlayActive(true);
        setPreviewPointerPlayMode(false);
      }

      if (event.key === "Control") {
        setPreviewPointSelectionMode(true);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Alt") {
        setAltPlayActive(false);
        setPreviewPointerPlayMode(false);
        clearPreviewPointerPlayReset();
      }

      if (event.key === "Control") {
        setPreviewPointSelectionMode(false);
      }
    }

    function resetTransientModes() {
      setAltPlayActive(false);
      setPreviewPointerPlayMode(false);
      setPreviewPointSelectionMode(false);
      clearPreviewPointerPlayReset();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetTransientModes);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetTransientModes);
    };
  }, []);

  useEffect(() => {
    return () => clearPreviewPointerPlayReset();
  }, []);

  useEffect(() => {
    if (sidebarResizeState === null) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent) {
      if (sidebarResizeState === null) {
        return;
      }

      const deltaX = event.clientX - sidebarResizeState.startX;
      if (sidebarResizeState.side === "left") {
        setLeftSidebarWidth(
          clampNumber(sidebarResizeState.startWidth + deltaX, leftSidebarWidthMin, leftSidebarWidthMax)
        );
        return;
      }

      setJsonSidebarWidth(
        clampNumber(sidebarResizeState.startWidth - deltaX, jsonSidebarWidthMin, jsonSidebarWidthMax)
      );
    }

    function stopResize() {
      setSidebarResizeState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("blur", stopResize);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("blur", stopResize);
    };
  }, [sidebarResizeState]);

  useEffect(() => {
    if (selectedPreviewEntityId === undefined) {
      return;
    }

    if (!previewEntities.some((entity) => entity.entityId === selectedPreviewEntityId)) {
      setSelectedPreviewEntityId(undefined);
    }
  }, [previewEntities, selectedPreviewEntityId]);

  useEffect(() => {
    const pointer = selectedNode?.pointer;
    if (pointer === undefined) {
      return;
    }

    const entity = previewEntities.find((candidate) => candidate.authoringPointer === pointer);
    if (entity !== undefined && entity.entityId !== selectedPreviewEntityId) {
      setSelectedPreviewEntityId(entity.entityId);
      return;
    }

    if (entity === undefined && selectedPreviewEntityId !== undefined) {
      const selectedEntity = previewEntities.find((candidate) => candidate.entityId === selectedPreviewEntityId);
      if (selectedEntity === undefined || selectedEntity.authoringPointer !== pointer) {
        setSelectedPreviewEntityId(undefined);
      }
    }
  }, [previewEntities, selectedNode?.pointer, selectedPreviewEntityId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
    setLocalNodePositions((currentPositions) => {
      const nextPositions = new Map(currentPositions);

      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          nextPositions.set(change.id, change.position);
        }
      }

      return nextPositions;
    });
  }, []);

  function clearPreviewPointerPlayReset() {
    if (previewPointerPlayResetRef.current === undefined) {
      return;
    }

    window.clearTimeout(previewPointerPlayResetRef.current);
    previewPointerPlayResetRef.current = undefined;
  }

  function handlePreviewTemporaryPlayChange(active: boolean) {
    clearPreviewPointerPlayReset();
    setPreviewPointerPlayMode(active);
    if (!active) {
      return;
    }

    /*
     * When focus is inside the preview iframe, the parent window may not receive
     * the Alt keyup. A short timeout prevents the inspect overlay from getting
     * stuck in pass-through mode after an Alt-assisted preview gesture.
     */
    previewPointerPlayResetRef.current = window.setTimeout(() => {
      previewPointerPlayResetRef.current = undefined;
      setPreviewPointerPlayMode(false);
    }, temporaryPlayPassthroughMs);
  }

  function handleSidebarResizeStart(side: SidebarResizeState["side"], event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setSidebarResizeState({
      side,
      startX: event.clientX,
      startWidth: side === "left" ? leftSidebarWidth : jsonSidebarWidth
    });
  }

  function openPropertiesSidebar() {
    setJsonPanelOpen(false);
    setPropertyPanelOpen(true);
  }

  function openJsonSidebar(pointer: string | undefined = selectedNode?.pointer) {
    setPropertyPanelOpen(false);
    setJsonPanelOpen(true);
    if (pointer !== undefined) {
      setPendingJsonRevealPointer(pointer);
    }
  }

  function handleEditorMount(editor: MonacoEditorInstance, monaco: MonacoApi) {
    editorRef.current = editor;
    setMonacoApi(monaco);
  }

  async function openSessionFileList(gameId: string | null): Promise<EditorSessionListResult> {
    const existingSession = editorSessionRef.current;
    if (existingSession !== null && (gameId === null || existingSession.gameId === gameId)) {
      return {
        ...(await fetchAuthoringList(existingSession.gameId, existingSession.sessionId)),
        session: existingSession
      };
    }

    const pending = openingSessionRef.current;
    if (pending !== null && pending.gameId === gameId) {
      return pending.promise;
    }

    const promise = createEditorSession(gameId).finally(() => {
      if (openingSessionRef.current?.promise === promise) {
        openingSessionRef.current = null;
      }
    });
    openingSessionRef.current = { gameId, promise };
    return promise;
  }

  function clearPreparedPreview() {
    setPreviewUrl(null);
    setPreviewRuntimeSessionId(undefined);
    setPreviewSourceMaps([]);
    setPreviewEntities([]);
    setPreviewUnresolvedEntityCount(0);
    setSelectedPreviewEntityId(undefined);
    setPreviewPromptContext(null);
    setPreviewAiIntent(null);
    setPreviewInspectMode(false);
    setAltPlayActive(false);
    setPreviewPointerPlayMode(false);
    setPreviewPointSelectionMode(false);
    clearPreviewPointerPlayReset();
    setPreviewTrace(createPreviewPlaythroughTrace({ traceId: "preview-trace-initial", gameId: currentDocument.gameId }));
    setSelectedPreviewTraceSequence(undefined);
    setPreviewRollbackState("idle");
  }

  /**
   * Reaction to a document EDIT while a preview is prepared (ADR-057 §4.8;
   * editor-preview-first-ux §9.2). Unlike {@link clearPreparedPreview}, this does
   * NOT yank the running preview/playthrough: the prepared URL, runtime session,
   * and trace stay, so the last valid render remains on screen and the freshness
   * axis reports "предпросмотр отстаёт" until the author applies the edits. Only
   * transient selection/prompt overlay state (which may now point at pre-edit
   * entities) is dropped. No-op when no preview is prepared.
   */
  function softenPreviewForEdit() {
    if (previewUrl === null) {
      return;
    }
    setSelectedPreviewEntityId(undefined);
    setPreviewPromptContext(null);
    setPreviewAiIntent(null);
    setPreviewPointSelectionMode(false);
  }

  function clearAiSessionState() {
    setAiApplyState("idle");
    setAiPatchJournal([]);
    setAiRedoJournal([]);
    setAiDiffSummary([]);
    setAiDiagnostics([]);
    setAgentPlannedChangeSet(null);
  }

  function clearWorkflowAndPluginDiagnostics() {
    setWorkflowDiagnostics([]);
    setPluginDiagnostics([]);
  }

  function handleJsonChange(value: string | undefined) {
    // Monaco free-text edits carry no known pointers: force a full projection
    // rebuild by clearing any pending incremental context (Phase 2.1).
    pendingProjectionEditRef.current = null;
    setJsonText(value ?? "");
    setReverseDiagnostics([]);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("json");
    setSaveState("idle");
  }

  function handlePropertyChange(property: EditorProperty, rawValue: string) {
    const nextValue = coercePropertyValue(property.value, rawValue);
    const result = applyPropertyEditResult(viewModel.snapshot, property.pointer, nextValue);
    applyAuthoringEditResult(result, "property", property.pointer);
  }

  function handlePropertyJsonChange(property: EditorProperty, rawJson: string) {
    const result = applyJsonPropertyEditResult(viewModel.snapshot, property.pointer, rawJson);
    applyAuthoringEditResult(result, "property", property.pointer);
  }

  function handleWritableGraphOperation(operation: WritableGraphOperation) {
    const result = applyWritableGraphOperation(viewModel.snapshot, operation);
    const revealPointer =
      operation.type === "addCollectionItem"
        ? operation.collectionPointer
        : operation.type === "removeCollectionItem"
          ? parentPointer(operation.itemPointer) ?? ""
          : operation.referencePointer;
    applyAuthoringEditResult(result, "graph", revealPointer);

    if (operation.type === "removeCollectionItem" && result.diagnostics.length === 0) {
      const parent = parentPointer(operation.itemPointer) ?? "";
      const parentNode = findEditorNodeForPointer(viewModel.fullNodes, parent);
      setSelectedNodeId(parentNode?.id ?? "$");
    }
  }

  function handleTreeSelectPointer(pointer: string, options: { readonly openJson?: boolean } = {}) {
    const treeNode = findTreeNodeForPointer(viewModel.tree, pointer);
    if (treeNode === undefined) {
      return;
    }

    const graphNode =
      treeNode.graphNodeId !== undefined
        ? findEditorNodeById(viewModel.fullNodes, treeNode.graphNodeId) ?? findEditorNodeForPointer(viewModel.fullNodes, pointer)
        : findEditorNodeForPointer(viewModel.fullNodes, pointer);
    setSelectedNodeId(graphNode?.id ?? "$");
    if (graphNode !== undefined) {
      updateActiveBranchForSelection(graphNode.id);
    }

    if (options.openJson) {
      openJsonSidebar(pointer);
      return;
    }

    openPropertiesSidebar();
  }

  /**
   * Selects an entity picked from the grouped entity tree (Phase 3.b.2).
   *
   * Always records it for the tree's own occurrence soft-highlight. When its
   * primary source lives in the CURRENTLY OPEN document, this also reuses the
   * existing pointer-selection path so preview/graph/properties stay in sync,
   * same as the JSON tree. A SIBLING-document entity still gets the tree
   * highlight; opening its document is out of scope here (belongs to the
   * entity panel, Phase 3.c).
   */
  function handleEntityTreeSelectEntity(entityId: string) {
    setEntityTreeSelectedEntityId(entityId);
    const entity = viewModel.editorEntityProjection.entityById.get(entityId);
    if (entity !== undefined && entity.primarySource.filePath === currentDocument.filePath) {
      handleTreeSelectPointer(entity.primarySource.pointer);
    }
  }

  async function handleSave() {
    if (currentDocument.source !== "repository" || currentDocument.versionHash === undefined || hasBlockingDiagnostics) {
      return;
    }

    setSaveState("saving");
    setStatusMessage("Saving...");
    setPluginDiagnostics([]);

    try {
      const response = await fetch("/api/editor/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId: currentDocument.gameId,
          filePath: currentDocument.filePath,
          text: jsonText,
          versionHash: currentDocument.versionHash,
          sessionId: editorSession?.sessionId,
          commitMessage: `Save ${currentDocument.gameId}/${currentDocument.filePath}`
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Partial<SavedAuthoringFileDocument> & {
          readonly error?: string;
          readonly pluginValidation?: EditorPluginValidationResult;
        };
        if (response.status === 422 && body.pluginValidation !== undefined) {
          const nextPluginDiagnostics = body.pluginValidation.diagnostics;
          adoptSavedDocumentVersion(body);
          setPluginDiagnostics(nextPluginDiagnostics);
          setWorkflowDiagnostics(nextPluginDiagnostics);
          setSaveState("error");
          setWorkflowState("blocked");
          setStatusMessage(nextPluginDiagnostics[0]?.message ?? "Plugin validation blocked save.");
          return;
        }

        throw new Error(body.error ?? `Save failed with HTTP ${response.status}.`);
      }

      const saved = (await response.json()) as SavedAuthoringFileDocument;
      const nextPluginDiagnostics = diagnosticsFromPluginValidation(saved.pluginValidation);
      applyLoadedDocument(saved);
      setSaveState("saved");
      setWorkflowDiagnostics(nextPluginDiagnostics);
      setPluginDiagnostics(nextPluginDiagnostics);
      clearAiSessionState();
      clearPreparedPreview();
      setWorkflowState("idle");
      const commitLabel = saved.commit?.committed === true && saved.commit.commitHash !== undefined
        ? ` commit ${saved.commit.commitHash.slice(0, 8)}`
        : "";
      setStatusMessage(editorSession === null ? "Saved to repository" : `Saved to session${commitLabel}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setSaveState(message.includes("changed on disk") ? "conflict" : "error");
      setStatusMessage(message);
    }
  }

  async function handleValidate() {
    if (currentDocument.source !== "repository") {
      return;
    }

    setWorkflowState("validating");
    setStatusMessage("Validating authoring text...");
    setPluginDiagnostics([]);

    try {
      const result = await postEditorWorkflow("/api/editor/validate", {
        gameId: currentDocument.gameId,
        filePath: currentDocument.filePath,
        text: jsonText,
        sessionId: editorSession?.sessionId
      });
      setWorkflowDiagnostics(filterServerOnlyDiagnostics(result.diagnostics ?? []));
      setPluginDiagnostics(pluginDiagnosticsFromWorkflowResponse(result));
      setWorkflowState(result.ok ? "validated" : "blocked");
      setStatusMessage(result.ok ? "Validation passed" : "Validation found blocking diagnostics");
    } catch (error) {
      setWorkflowState("error");
      setStatusMessage(error instanceof Error ? error.message : "Validation failed.");
    }
  }

  async function handleCompile() {
    if (currentDocument.source !== "repository" || isDirty || hasLocalSchemaBlockingDiagnostics) {
      return;
    }

    setWorkflowState("compiling");
    setStatusMessage("Compiling generated manifests...");
    setPluginDiagnostics([]);

    try {
      const result = await postEditorWorkflow("/api/editor/compile", {
        gameId: currentDocument.gameId,
        checkOnly: false,
        sessionId: editorSession?.sessionId
      });
      setWorkflowDiagnostics(result.diagnostics ?? []);
      setPluginDiagnostics(pluginDiagnosticsFromWorkflowResponse(result));
      setWorkflowState(result.ok ? "compiled" : "blocked");
      setStatusMessage(result.ok ? "Compiled generated manifests" : "Compile found blocking diagnostics");
    } catch (error) {
      setWorkflowState("error");
      setStatusMessage(error instanceof Error ? error.message : "Compile failed.");
    }
  }

  /**
   * Compiles the session manifests and (re)prepares a runtime preview session on
   * the CURRENT worktree content, resetting the on-screen preview + trace to that
   * fresh session. Returns the prepared session descriptor so callers that need
   * the new `sessionId`/`playerUrl` (the recovery ladder) can act on it without
   * waiting for React state to flush. Carries NO dirty/blocking guard — that is
   * the caller's responsibility (`handlePreview` guards; the apply pipeline saves
   * first). On success it records the applied document version so the freshness
   * axis (editor-preview-first-ux §9.6) resets to "актуален".
   */
  async function preparePreviewSession(): Promise<{
    readonly ready: boolean;
    readonly sessionId?: string;
    readonly playerUrl?: string;
  }> {
    setWorkflowState("previewing");
    setStatusMessage("Preparing player preview...");
    setPluginDiagnostics([]);

    try {
      const result = await postEditorWorkflow("/api/editor/preview", {
        gameId: currentDocument.gameId,
        sessionId: editorSession?.sessionId
      });
      setWorkflowDiagnostics(result.diagnostics ?? []);
      setPluginDiagnostics(pluginDiagnosticsFromWorkflowResponse(result));

      if (result.ready && typeof result.playerUrl === "string") {
        const runtimeSessionId = typeof result.sessionId === "string" ? result.sessionId : readSessionIdFromPreviewUrl(result.playerUrl);
        setPreviewUrl(result.playerUrl);
        setPreviewRuntimeSessionId(runtimeSessionId);
        setPreviewSourceMaps(result.sourceMaps ?? []);
        setPreviewEntities([]);
        setPreviewUnresolvedEntityCount(0);
        setSelectedPreviewEntityId(undefined);
        setPreviewPromptContext(null);
        setPreviewAiIntent(null);
        setPreviewInspectMode(false);
        setAltPlayActive(false);
        setPreviewPointerPlayMode(false);
        setPreviewPointSelectionMode(false);
        clearPreviewPointerPlayReset();
        setPreviewTrace(createPreviewPlaythroughTrace({
          traceId: runtimeSessionId === undefined ? `preview-${Date.now()}` : `preview-${runtimeSessionId}`,
          gameId: currentDocument.gameId
        }));
        setSelectedPreviewTraceSequence(undefined);
        setPreviewRollbackState("idle");
        setPreviewAppliedVersionHash(currentDocument.versionHash);
        setWorkflowState("ready");
        setStatusMessage("Preview session is ready");
        return { ready: true, sessionId: runtimeSessionId, playerUrl: result.playerUrl };
      }

      clearPreparedPreview();
      setWorkflowState("blocked");
      setStatusMessage("Preview is not ready");
      return { ready: false };
    } catch (error) {
      setWorkflowState("error");
      setStatusMessage(error instanceof Error ? error.message : "Preview failed.");
      return { ready: false };
    }
  }

  async function handlePreview() {
    if (currentDocument.source !== "repository" || isDirty || hasLocalSchemaBlockingDiagnostics) {
      return;
    }

    await preparePreviewSession();
  }

  /**
   * Persists the current buffer to the session worktree WITHOUT the full
   * document-reload reset that the Save button performs (`applyLoadedDocument`),
   * so the apply pipeline can push edits into the worktree while keeping the
   * author's selection, tree, and (about-to-be-rebuilt) preview stable. Reuses
   * the existing `/api/editor/file` route; returns whether the worktree now
   * holds the current buffer.
   */
  async function persistBufferForApply(): Promise<{ readonly ok: boolean; readonly error?: string }> {
    if (currentDocument.source !== "repository" || currentDocument.versionHash === undefined) {
      return { ok: false, error: "Правки можно применить только для файла сессии." };
    }
    if (!isDirty) {
      return { ok: true };
    }
    if (hasBlockingDiagnostics) {
      return { ok: false, error: "Компиляция заблокирована ошибками." };
    }

    try {
      const response = await fetch("/api/editor/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId: currentDocument.gameId,
          filePath: currentDocument.filePath,
          text: jsonText,
          versionHash: currentDocument.versionHash,
          sessionId: editorSession?.sessionId,
          commitMessage: `Apply ${currentDocument.gameId}/${currentDocument.filePath}`
        })
      });
      const body = (await response.json().catch(() => ({}))) as Partial<SavedAuthoringFileDocument> & { readonly error?: string };
      if (!response.ok) {
        return { ok: false, error: body.error ?? `Save failed with HTTP ${response.status}.` };
      }
      adoptSavedDocumentVersion(body);
      setSaveState("saved");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Save failed." };
    }
  }

  /**
   * Applies the author's edits to the preview along the PLAYTHROUGH axis
   * (ADR-057 §4.8; editor-preview-first-ux §9.2). Both modes persist the buffer
   * and rebuild the preview on the new content; "design" stops there (the state
   * context is re-seeded), while "preview" then walks the recovery ladder to keep
   * the running playthrough as close as possible to where the author was. This is
   * never triggered silently by an edit — only by the debounced design-mode path
   * or the explicit "Применить" action — so a running playthrough is not yanked.
   */
  async function applyEditsToPreview(mode: "design" | "preview") {
    if (previewUrl === null) {
      return;
    }
    // Capture the pre-apply playthrough position + snapshots BEFORE re-preparing
    // resets the trace; the ladder restores against these.
    const preApplyTrace = previewTrace;
    const targetSequence = currentPreviewTraceEvent?.sequence;

    setStatusMessage("Собираем правки и обновляем предпросмотр…");
    const persisted = await persistBufferForApply();
    if (!persisted.ok) {
      setStatusMessage(`Правки не применены: ${persisted.error ?? "не удалось сохранить."}`);
      return;
    }

    const prepared = await preparePreviewSession();
    if (!prepared.ready || prepared.sessionId === undefined || prepared.playerUrl === undefined) {
      setStatusMessage("Правки не применены — компиляция заблокирована.");
      return;
    }

    if (mode === "design") {
      setStatusMessage("Правки применены к предпросмотру.");
      return;
    }

    await walkPreviewRecoveryLadder(preApplyTrace, targetSequence, prepared.sessionId, prepared.playerUrl);
  }

  /**
   * Walks the recovery ladder rungs (editor-preview-first-ux §9.2) against a
   * freshly prepared session, attempting a runtime restore per restorable rung
   * via the EXISTING preview-restore route. The first rung whose restore succeeds
   * wins; its plain-language message is surfaced. The terminal `restart` rung
   * leaves the fresh playthrough at its start. State compatibility is inferred
   * from the available signals (which snapshots the pre-apply trace holds and
   * whether the restore route accepts them) — no new runtime contract.
   */
  async function walkPreviewRecoveryLadder(
    preApplyTrace: typeof previewTrace,
    targetSequence: number | undefined,
    sessionId: string,
    playerUrl: string
  ) {
    const rungs = planPreviewRecoveryLadder(preApplyTrace, targetSequence);
    for (const rung of rungs) {
      if (rung.kind === "restart") {
        setPreviewRollbackState("restored");
        setStatusMessage(rung.message);
        return;
      }

      setPreviewRollbackState("restoring");
      try {
        const response = await fetch("/api/editor/preview/rollback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gameId: currentDocument.gameId,
            sessionId,
            state: rung.snapshotState,
            version: rung.version,
            targetEventSequence: rung.sequence
          })
        });
        const result = (await response.json().catch(() => ({}))) as EditorPreviewRollbackResponse;
        if (!response.ok || !result.ok) {
          continue;
        }
        setSelectedPreviewTraceSequence(rung.sequence);
        setPreviewUrl(addPreviewReloadNonce(playerUrl, rung.sequence));
        setPreviewRollbackState("restored");
        setStatusMessage(rung.message);
        return;
      } catch {
        // Restore failed for this rung; fall through to the next degradation.
      }
    }
  }

  async function handlePreviewRollback(targetSequence: number) {
    if (previewUrl === null || previewRuntimeSessionId === undefined) {
      setPreviewRollbackState("blocked");
      setStatusMessage("Preview rollback requires a prepared runtime session.");
      return;
    }

    const plan = buildPreviewTraceRestorePlan(previewTrace, targetSequence);
    if (plan.snapshot === undefined || plan.snapshot.eventSequence !== targetSequence) {
      setPreviewRollbackState("blocked");
      setStatusMessage("Preview rollback requires a runtime snapshot for the selected trace point.");
      return;
    }
    const runtimeVersion = readRuntimeEventVersion(previewTrace, targetSequence) ?? {
      stateVersion: targetSequence,
      lastEventSequence: targetSequence
    };

    setPreviewRollbackState("restoring");
    setStatusMessage(`Restoring preview to event ${targetSequence}...`);

    try {
      const response = await fetch("/api/editor/preview/rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId: currentDocument.gameId,
          sessionId: previewRuntimeSessionId,
          state: plan.snapshot.state,
          version: runtimeVersion,
          targetEventSequence: targetSequence
        })
      });
      const result = (await response.json().catch(() => ({}))) as EditorPreviewRollbackResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? `Preview rollback failed with HTTP ${response.status}.`);
      }

      const truncatedTrace = truncatePreviewTrace(previewTrace, targetSequence);
      setPreviewTrace(truncatedTrace);
      void persistPreviewTraceTruncation(truncatedTrace, previewRuntimeSessionId, editorSession?.sessionId, targetSequence).catch(() => {
        setStatusMessage("Preview trace persistence failed after rollback.");
      });
      setSelectedPreviewEntityId(undefined);
      setPreviewPromptContext(null);
      setPreviewAiIntent(null);
      setPreviewEntities([]);
      setPreviewUnresolvedEntityCount(0);
      setSelectedPreviewTraceSequence(targetSequence);
      setPreviewRollbackState("restored");
      setPreviewUrl(addPreviewReloadNonce(previewUrl, targetSequence));
      setStatusMessage(`Preview restored to event ${targetSequence}; future trace was discarded.`);
    } catch (error) {
      setPreviewRollbackState("error");
      setStatusMessage(error instanceof Error ? error.message : "Preview rollback failed.");
    }
  }

  function handlePreviewResetToStart() {
    const firstEvent = previewTrace.events[0];
    if (firstEvent !== undefined) {
      void handlePreviewRollback(firstEvent.sequence);
    }
  }

  function handlePreviewReplayCurrent() {
    if (previewUrl === null || currentPreviewTraceEvent === undefined) {
      return;
    }

    setPreviewUrl(addPreviewReloadNonce(previewUrl, currentPreviewTraceEvent.sequence));
    setStatusMessage(`Replaying current preview event ${currentPreviewTraceEvent.sequence}.`);
  }

  // --- Pinned state fixtures (ADR-057 §9.3; design-spec §3.3) ------------------

  /** Loads the game's pinned fixtures (with their stale verdict) into state. */
  async function loadStateFixtures() {
    if (currentDocument.source !== "repository") {
      setStateFixtures([]);
      return;
    }
    try {
      const result = await fetchStateFixtures(currentDocument.gameId, editorSessionRef.current?.sessionId);
      setStateFixtures(result.fixtures);
    } catch {
      // A missing fixtures directory or a listing failure just yields no fixtures;
      // the selector falls back to the auto-checkpoint / synthetic seed (§9.3).
      setStateFixtures([]);
    }
  }

  /**
   * Derives an ASCII-first fixture id from a (possibly Cyrillic) label plus a
   * short uniqueness suffix, mirroring the authoring entity id rule (design-spec
   * §2.8). Non-ASCII labels collapse to the `fixture` stem; the `_label` keeps the
   * human-readable Cyrillic name.
   */
  function slugifyFixtureId(label: string): string {
    const stem = label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60);
    return `${stem === "" ? "fixture" : stem}-${Date.now().toString(36)}`;
  }

  /**
   * Pins the current preview state as a reviewable fixture (mockup zone 6). The
   * server stamps the fresh manifest hash, validates (Ajv + semantics), and writes
   * the file into the session worktree so it commits on Save like any edit.
   */
  async function handlePinFixture(input: { readonly label: string; readonly note?: string }) {
    const label = input.label.trim();
    if (label === "") {
      return;
    }
    if (editorSession === null) {
      setStatusMessage("Закрепить фикстуру можно только в сессии редактора.");
      return;
    }
    if (pinnableFixtureState === undefined) {
      setStatusMessage("Нет состояния предпросмотра для закрепления.");
      return;
    }

    try {
      const result = await pinStateFixture({
        gameId: currentDocument.gameId,
        sessionId: editorSession.sessionId,
        id: slugifyFixtureId(label),
        label,
        state: pinnableFixtureState,
        note: input.note,
        ...(pinnableTraceSnapshot !== undefined
          ? { sourceTraceRef: `.tmp/editor-playthroughs/${previewTrace.traceId}#${pinnableTraceSnapshot.eventSequence}` }
          : {})
      });
      await loadStateFixtures();
      setSelectedFixtureId(result.fixture.id);
      setStatusMessage(`Закреплена фикстура «${result.fixture._label}».`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? `Не удалось закрепить фикстуру: ${error.message}` : "Не удалось закрепить фикстуру.");
    }
  }

  /**
   * Seeds the preview with a fixture's captured state through the EXISTING
   * preview-only restore endpoint — the same path a trace-checkpoint restore
   * uses, so no new runtime contract is introduced (ADR-057 §5). A fresh runtime
   * session is prepared first when none is running.
   */
  async function applyFixtureToPreview(fixtureId: string) {
    const fixture = stateFixtures.find((candidate) => candidate.id === fixtureId);
    if (fixture === undefined) {
      return;
    }
    setSelectedFixtureId(fixtureId);

    let sessionId = previewRuntimeSessionId;
    let playerUrl = previewUrl;
    if (sessionId === undefined || playerUrl === null) {
      const prepared = await preparePreviewSession();
      if (!prepared.ready || prepared.sessionId === undefined || prepared.playerUrl === undefined) {
        setStatusMessage("Не удалось подготовить предпросмотр для фикстуры.");
        return;
      }
      sessionId = prepared.sessionId;
      playerUrl = prepared.playerUrl;
    }

    setPreviewRollbackState("restoring");
    setStatusMessage(`Загружаем состояние фикстуры «${fixture._label}»…`);
    try {
      const response = await fetch("/api/editor/preview/rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId: currentDocument.gameId,
          sessionId,
          state: fixture.state,
          version: { stateVersion: 0, lastEventSequence: 0 },
          targetEventSequence: 0
        })
      });
      const result = (await response.json().catch(() => ({}))) as EditorPreviewRollbackResponse;
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? `Fixture restore failed with HTTP ${response.status}.`);
      }
      setPreviewUrl(addPreviewReloadNonce(playerUrl, 0));
      setPreviewRollbackState("restored");
      setStatusMessage(`Состояние фикстуры «${fixture._label}» загружено в предпросмотр.`);
    } catch (error) {
      setPreviewRollbackState("error");
      setStatusMessage(error instanceof Error ? error.message : "Не удалось загрузить фикстуру.");
    }
  }

  async function resetCurrentFile() {
    if (currentDocument.source !== "repository") {
      loadEmbeddedFallback();
      return;
    }

    setLoadState("loading");
    setStatusMessage("Reloading current file...");

    try {
      const document = await fetchAuthoringFile(currentDocument.gameId, currentDocument.filePath, editorSession?.sessionId);
      const layout = await fetchEditorLayout(currentDocument.gameId, currentDocument.filePath, editorSession?.sessionId).catch(() => undefined);
      applyLoadedDocument(document, layout);
      setLoadState("ready");
      setSaveState("idle");
      setStatusMessage(editorSession === null ? "Reloaded from repository" : "Reloaded from session worktree");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reload failed.";
      setLoadState("error");
      setSaveState("error");
      setStatusMessage(message);
    }
  }

  function handleGameChange(gameId: string) {
    const next = new URLSearchParams();
    next.set("gameId", gameId);
    router.replace(`?${next.toString()}`);
  }

  function handleFileChange(filePath: string) {
    replaceUrlState(currentDocument.gameId, filePath);
  }

  function selectPointerNode(node: EditorViewNode, options: { readonly openJson?: boolean } = {}) {
    setSelectedNodeId(node.id);
    updateActiveBranchForSelection(node.id);

    if (options.openJson === true) {
      openJsonSidebar(node.pointer);
      return;
    }

    openPropertiesSidebar();
  }

  function handlePreviewEntitySelect(
    entity: PreviewEntityDescriptor,
    point: PreviewPoint,
    layeredEntities: readonly PreviewEntityDescriptor[]
  ) {
    setSelectedPreviewEntityId(entity.entityId);
    selectAuthoringPointerFromPreview(entity);
    setPreviewPromptContext({
      kind: "entity",
      point,
      entities: layeredEntities,
      draft: previewPromptContext?.draft ?? ""
    });
    setPreviewAiIntent(null);
  }

  function handlePreviewRegionSelect(entities: readonly PreviewEntityDescriptor[], rect: PreviewRect, point: PreviewPoint) {
    setSelectedPreviewEntityId(undefined);
    setPropertyPanelOpen(false);
    setPreviewPromptContext({
      kind: "region",
      point,
      rect,
      entities,
      draft: previewPromptContext?.draft ?? ""
    });
    setPreviewAiIntent(null);
  }

  async function handlePreviewPromptSubmit() {
    const context = previewPromptContext;
    if (context === null || context.draft.trim() === "") {
      return;
    }

    // Build the plan context (intent + targets) SYNCHRONOUSLY now, so the queued
    // runner is self-contained and does not read `previewPromptContext` later (it
    // may have moved on by the time a serialized intent is promoted). The entity/
    // region preview prompt is an AGENT intent → it goes through the queue (§9.5).
    const planContext = buildCurrentAiPlanContext(context.draft.trim());
    if (!planContext.ok) {
      setAiDiagnostics(planContext.diagnostics);
      setAiApplyState("blocked");
      setStatusMessage(planContext.summary);
      return;
    }

    setPreviewAiIntent(planContext.previewIntent);
    const readWritePointers = scopeActiveFilePointers(currentDocument.filePath, planContext.intent.targetPointers);
    enqueueAgentIntent({
      readPointers: readWritePointers,
      writePointers: readWritePointers,
      run: async (intentId) => {
        setAiApplyState("planning");
        setAiDiagnostics([]);
        setStatusMessage(
          `Planning AI ChangeSet for ${planContext.targets.length} target pointer${planContext.targets.length === 1 ? "" : "s"}...`
        );
        try {
          const response = await requestAiChangeSet(planContext.intent, planContext.targets);
          if (isIntentCancelled(intentId)) {
            forgetIntentRunner(intentId);
            return;
          }
          if (!response.ok || response.changeSet === undefined) {
            const diagnostics = (response.diagnostics ?? []).map(toRoutedDiagnostic);
            setAiDiagnostics(diagnostics);
            failIntent(intentId, diagnostics[0]?.message ?? "AI planner did not return an applicable ChangeSet.");
            return;
          }
          setAgentPlannedChangeSet(null);
          reconcileAndApplyIntent(intentId, {
            intent: planContext.intent,
            changeSet: response.changeSet,
            diagnostics: response.diagnostics ?? [],
            targetPointers: planContext.intent.targetPointers
          });
        } catch (error) {
          failIntent(intentId, error instanceof Error ? error.message : "AI ChangeSet apply failed.");
        }
      }
    });
  }

  async function runAgentPlanTool(prompt: string | undefined): Promise<EditorAgentToolResult> {
    setPrototypeExtractionProposal(null);
    const planned = await planCurrentAiChangeSet(prompt);
    if (!planned.ok) {
      return {
        ok: false,
        summary: planned.summary,
        diagnostics: planned.diagnostics.map(toAgentDiagnostic)
      };
    }

    return {
      ok: true,
      summary: planned.plan.changeSet.summary,
      diagnostics: planned.plan.diagnostics.map(toAgentDiagnostic),
      changeSetId: planned.plan.changeSet.id
    };
  }

  async function runAgentPrototypeExtractionTool(input: {
    readonly prompt?: string;
    readonly sourcePointers?: readonly string[];
    readonly definitionType?: string;
    readonly definitionSemantics?: string;
  }): Promise<EditorAgentToolResult> {
    if (currentDocument.source !== "repository") {
      return {
        ok: false,
        summary: "Prototype extraction proposals are available only for repository-backed authoring files."
      };
    }

    if (viewModel.snapshot.json === undefined) {
      return {
        ok: false,
        summary: "Prototype extraction proposal requires valid authoring JSON."
      };
    }

    setAiApplyState("planning");
    setAiDiagnostics([]);
    setAgentPlannedChangeSet(null);
    setStatusMessage("Planning prototype extraction proposal...");

    try {
      const response = await requestPrototypeExtractionProposal({
        gameId: currentDocument.gameId,
        filePath: currentDocument.filePath,
        text: jsonText,
        sessionId: editorSession?.sessionId,
        sourcePointers: input.sourcePointers ?? currentPrototypeExtractionSourcePointers(),
        definitionType: input.definitionType,
        definitionSemantics: input.definitionSemantics ?? prototypeSemanticsFromPrompt(input.prompt)
      });
      const diagnostics = (response.diagnostics ?? []).map(toRoutedDiagnostic);
      const diffSummary = response.diffSummary ?? [];
      setAiDiagnostics(diagnostics);
      setAiDiffSummary(diffSummary);

      if (!response.ok || response.proposal === undefined) {
        setPrototypeExtractionProposal(null);
        setAiApplyState("blocked");
        const summary = diagnostics[0]?.message ?? "Prototype extraction proposal was blocked by validation gates.";
        setStatusMessage(summary);
        return {
          ok: false,
          summary,
          diagnostics: diagnostics.map(toAgentDiagnostic),
          diffSummary: diffSummary.map((item) => item.description)
        };
      }

      const plannedProposal: PlannedPrototypeExtractionProposal = {
        proposal: response.proposal,
        diagnostics,
        diffSummary,
        gates: response.gates ?? []
      };
      setPrototypeExtractionProposal(plannedProposal);
      setAiApplyState("idle");
      setStatusMessage(`Prototype proposal ready: ${response.proposal.definitionType}`);

      return {
        ok: true,
        summary: `Prototype proposal ready: ${response.proposal.definitionType}. Apply is intentionally not automatic.`,
        diagnostics: diagnostics.map(toAgentDiagnostic),
        diffSummary: [
          ...diffSummary.map((item) => item.description),
          ...(response.gates ?? []).map((gate) => `${gate.label}: ${gate.ok ? "OK" : "blocked"}`)
        ],
        changeSetId: response.proposal.changeSet.id,
        data: {
          changeSetId: response.proposal.changeSet.id,
          prototypeProposal: {
            id: response.proposal.id,
            definitionType: response.proposal.definitionType,
            definitionPointer: response.proposal.definitionPointer,
            sourcePointers: response.proposal.sourcePointers,
            gates: (response.gates ?? []).map((gate) => ({ id: gate.id, label: gate.label, ok: gate.ok })),
            expectedRuntimeDiff: response.proposal.expectedRuntimeDiff
          }
        }
      };
    } catch (error) {
      setPrototypeExtractionProposal(null);
      setAiApplyState("error");
      const summary = error instanceof Error ? error.message : "Prototype extraction proposal failed.";
      setStatusMessage(summary);
      return {
        ok: false,
        summary
      };
    }
  }

  async function runAgentPreparePrototypeChangeSetTool(): Promise<EditorAgentToolResult> {
    const plannedProposal = prototypeExtractionProposal;
    if (plannedProposal === null) {
      return {
        ok: false,
        summary: "Prototype ChangeSet preparation requires a current prototype proposal."
      };
    }

    if (!prototypeProposalGatesPassed(plannedProposal)) {
      const blocked = plannedProposal.gates.filter((gate) => !gate.ok).map((gate) => `${gate.label}: blocked`);
      const summary = blocked[0] ?? "Prototype proposal gates are not complete.";
      setAiApplyState("blocked");
      setStatusMessage(summary);
      return {
        ok: false,
        summary,
        diagnostics: plannedProposal.diagnostics.map(toAgentDiagnostic),
        diffSummary: blocked
      };
    }

    const plan = prototypeProposalToPlannedChangeSet(plannedProposal.proposal, currentDocument.filePath);
    const dryRun = dryRunPlannedAiChangeSet(plan);
    const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
    setAiDiagnostics(routedDiagnostics);
    setAiDiffSummary(dryRun.diffSummary);

    if (!dryRun.ok) {
      const summary = routedDiagnostics[0]?.message ?? "Prototype proposal is no longer applicable to the current document.";
      setAiApplyState("blocked");
      setStatusMessage(summary);
      return {
        ok: false,
        summary,
        diagnostics: routedDiagnostics.map(toAgentDiagnostic),
        diffSummary: dryRun.diffSummary.map((item) => item.description),
        changeSetId: plan.changeSet.id
      };
    }

    setAgentPlannedChangeSet(plan);
    setPrototypeExtractionProposal(null);
    setAiApplyState("idle");
    setStatusMessage(`Prototype proposal prepared as planned ChangeSet: ${plan.changeSet.summary}`);
    return {
      ok: true,
      summary: `Prototype proposal prepared as planned ChangeSet: ${plan.changeSet.summary}`,
      diagnostics: routedDiagnostics.map(toAgentDiagnostic),
      diffSummary: dryRun.diffSummary.map((item) => item.description),
      changeSetId: plan.changeSet.id
    };
  }

  async function runAgentDryRunTool(prompt: string | undefined): Promise<EditorAgentToolResult> {
    let planned = agentPlannedChangeSet;
    if (prompt !== undefined && prompt.trim() !== "") {
      const plannedFromPrompt = await planCurrentAiChangeSet(prompt);
      if (!plannedFromPrompt.ok) {
        return {
          ok: false,
          summary: plannedFromPrompt.summary,
          diagnostics: plannedFromPrompt.diagnostics.map(toAgentDiagnostic)
        };
      }
      planned = plannedFromPrompt.plan;
    }

    if (planned === null) {
      return {
        ok: false,
        summary: "Dry-run requires a planned ChangeSet or a prompt for the current selection."
      };
    }

    const dryRun = dryRunPlannedAiChangeSet(planned);
    setAiDiagnostics(dryRun.diagnostics.map(toRoutedDiagnostic));
    setAiDiffSummary(dryRun.diffSummary);
    setStatusMessage(dryRun.ok ? `Dry-run passed: ${planned.changeSet.summary}` : "AI ChangeSet failed dry-run validation.");

    return {
      ok: dryRun.ok,
      summary: dryRun.ok ? `Dry-run passed: ${planned.changeSet.summary}` : "AI ChangeSet failed dry-run validation.",
      diagnostics: dryRun.diagnostics.map(toAgentDiagnostic),
      diffSummary: dryRun.diffSummary.map((item) => item.description),
      changeSetId: planned.changeSet.id
    };
  }

  async function runAgentApplyTool(
    prompt: string | undefined,
    approval: CubicaAgentApprovalEnvelope | undefined
  ): Promise<EditorAgentToolResult> {
    if (prompt !== undefined && prompt.trim() !== "") {
      return {
        ok: false,
        summary: "Apply requires an already planned ChangeSet. Plan and dry-run first, then approve the returned ChangeSet scope."
      };
    }

    const planned = agentPlannedChangeSet;
    if (planned === null) {
      return {
        ok: false,
        summary: "Apply requires a planned ChangeSet or a prompt for the current selection."
      };
    }

    const classification = classifyChangeSet(planned.changeSet, viewModel.editorEntityProjection);
    const approvalError = validateEditorAgentApproval(
      approval,
      "editor.applyChangeSet",
      editorApplyApprovalScope(planned, classification)
    );
    if (approvalError !== null) {
      return approvalError;
    }

    // The panel/session chat apply is an AGENT intent (§9.5) → it goes through the
    // queue so it serializes behind any other running intent and is conflict-checked
    // against journal edits since it was planned. The approval already validated
    // above is carried into the deferred apply. The tool returns "queued": the diff
    // and any `intent-stale` verdict surface in the session journal on apply.
    const readPointers = scopeActiveFilePointers(currentDocument.filePath, planned.targetPointers);
    enqueueAgentIntent({
      readPointers,
      writePointers: scopeChangeSetWritePointers(planned.changeSet),
      run: (intentId) => reconcileAndApplyIntent(intentId, planned, { approval, classification })
    });
    return {
      ok: true,
      summary: `ChangeSet queued for apply: ${planned.changeSet.summary}`,
      changeSetId: planned.changeSet.id
    };
  }

  function runAgentUndoTool(approval: CubicaAgentApprovalEnvelope | undefined): EditorAgentToolResult {
    const step = aiPatchJournal.at(-1);
    if (step === undefined) {
      return {
        ok: false,
        summary: "No AI patch is available to undo."
      };
    }

    const approvalError = validateEditorAgentApproval(
      approval,
      "editor.undoLastPatch",
      editorUndoApprovalScope(aiPatchJournal.length)
    );
    if (approvalError !== null) {
      return approvalError;
    }

    handleUndoAiChange();
    return {
      ok: true,
      summary: `Undo requested for ${step.summary}.`
    };
  }

  async function requirePlannedAiChangeSet(prompt: string): Promise<PlannedAiChangeSet | null> {
    const planned = await planCurrentAiChangeSet(prompt);
    return planned.ok ? planned.plan : null;
  }

  async function planCurrentAiChangeSet(promptOverride?: string): Promise<PlanCurrentAiChangeSetResult> {
    if (viewModel.snapshot.json === undefined) {
      return rejectedPlan("AI ChangeSet was not planned because the active JSON is invalid.");
    }

    const prompt = (promptOverride ?? previewPromptContext?.draft ?? "").trim();
    if (prompt === "") {
      return rejectedPlan("AI ChangeSet planning requires a prompt for the current selection.");
    }

    const context = buildCurrentAiPlanContext(prompt);
    if (!context.ok) {
      return {
        ok: false,
        diagnostics: context.diagnostics,
        summary: context.summary
      };
    }

    setPreviewAiIntent(context.previewIntent);
    setAiApplyState("planning");
    setAiDiagnostics([]);
    setStatusMessage(`Planning AI ChangeSet for ${context.targets.length} target pointer${context.targets.length === 1 ? "" : "s"}...`);

    const response = await requestAiChangeSet(context.intent, context.targets);
    if (!response.ok || response.changeSet === undefined) {
      const diagnostics = (response.diagnostics ?? []).map(toRoutedDiagnostic);
      return {
        ok: false,
        diagnostics,
        summary: diagnostics[0]?.message ?? "AI planner did not return an applicable ChangeSet."
      };
    }

    const plan: PlannedAiChangeSet = {
      intent: context.intent,
      changeSet: response.changeSet,
      diagnostics: response.diagnostics ?? [],
      targetPointers: context.intent.targetPointers
    };
    setAgentPlannedChangeSet(plan);
    setAiApplyState("idle");
    setStatusMessage(`Planned AI ChangeSet: ${response.changeSet.summary}`);
    return { ok: true, plan };
  }

  function buildCurrentAiPlanContext(prompt: string):
    | {
        readonly ok: true;
        readonly intent: EditorPatchIntent;
        readonly previewIntent: PreviewAiIntent;
        readonly targets: ReturnType<typeof buildAiPatchTargetContexts>;
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly RoutedEditorDiagnostic[];
        readonly summary: string;
      } {
    const now = new Date().toISOString();
    const targetPointers = [...new Set((previewPromptContext?.entities.map((entity) => entity.authoringPointer) ?? [selectedNode?.pointer ?? ""]).filter((pointer) => pointer !== ""))];
    const previewKind = previewPromptContext?.kind ?? "entity";
    const previewIntent: PreviewAiIntent = {
      id: `preview-ai-${Date.now()}`,
      kind: previewKind,
      prompt,
      targetPointers,
      createdAt: now
    };
    const intent: EditorPatchIntent = {
      id: previewIntent.id,
      kind: previewPromptContext === null ? "property-prompt" : "preview-prompt",
      prompt,
      activeFilePath: currentDocument.filePath,
      targetPointers,
      createdAt: now,
      selectionKind: previewPromptContext?.kind ?? "entity"
    };
    const targets =
      previewPromptContext === null
        ? buildSelectedNodeAiPatchTargetContext(currentDocument.filePath, selectedNode, selectedValue)
        : buildAiPatchTargetContexts(previewPromptContext.entities, currentDocument.gameId, currentDocument.filePath, viewModel.snapshot.json as JsonValue);

    if (targets.length === 0) {
      return rejectedPlanContext("No active-file target was available for AI editing.");
    }

    return { ok: true, intent, previewIntent, targets };
  }

  function currentPrototypeExtractionSourcePointers(): readonly string[] | undefined {
    const previewPointers = previewPromptContext?.entities
      .map((entity) => entity.authoringPointer)
      .filter((pointer) => pointer !== "") ?? [];
    const selectedPointer = selectedNode?.pointer !== undefined && selectedNode.pointer !== "" ? [selectedNode.pointer] : [];
    const uniquePointers = [...new Set([...previewPointers, ...selectedPointer])];
    return uniquePointers.length >= 2 ? uniquePointers : undefined;
  }

  function prototypeProposalToPlannedChangeSet(
    proposal: PrototypeExtractionProposal,
    activeFilePath: string
  ): PlannedAiChangeSet {
    const createdAt = new Date().toISOString();
    const intent: EditorPatchIntent = {
      id: `${proposal.id}:manual-review:${Date.now()}`,
      kind: "prototype-extraction-review",
      prompt: `Use prototype extraction proposal ${proposal.definitionType}.`,
      activeFilePath,
      targetPointers: [...new Set([...proposal.sourcePointers, proposal.definitionPointer])],
      createdAt,
      selectionKind: "document"
    };

    return {
      intent,
      changeSet: {
        ...proposal.changeSet,
        intentId: intent.id
      },
      diagnostics: [],
      targetPointers: proposal.sourcePointers
    };
  }

  function dryRunPlannedAiChangeSet(plan: PlannedAiChangeSet) {
    return dryRunEditorChangeSet({
      snapshot: viewModel.snapshot,
      changeSet: plan.changeSet,
      schemaRegistry,
      schemaId,
      includeSemanticDiagnostics: true
    });
  }

  /**
   * The single convergence point for applying any agent-produced ChangeSet.
   *
   * Every agent input channel funnels through here: the agent panel apply
   * (`runAgentApplyTool`) and the preview entity/region/text prompt
   * (`handlePreviewPromptSubmit`). Per ADR-057 §5 the risk classification runs
   * ONCE, right before the shared dry-run / validation / undo-journal pipeline.
   * A `dangerous` ChangeSet may not apply without a matching ADR-047 approval
   * envelope; a rejected dangerous apply is recorded and never mutates the doc.
   */
  function applyPlannedAiChangeSet(
    plan: PlannedAiChangeSet,
    options: { readonly approval?: CubicaAgentApprovalEnvelope; readonly classification?: ClassifyChangeSetResult } = {}
  ): EditorAgentToolResult {
    const classification = options.classification ?? classifyChangeSet(plan.changeSet, viewModel.editorEntityProjection);
    if (classification.risk === "dangerous") {
      const approvalError = validateEditorAgentApproval(
        options.approval,
        "editor.applyChangeSet",
        editorApplyApprovalScope(plan, classification)
      );
      if (approvalError !== null) {
        return recordRejectedDangerousChange(plan, classification, approvalError);
      }
    }

    setAiApplyState("applying");
    const dryRun = dryRunPlannedAiChangeSet(plan);
    const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
    setAiDiagnostics(routedDiagnostics);
    if (!dryRun.ok || dryRun.after === undefined || dryRun.inverseChangeSet === undefined) {
      setAiApplyState("blocked");
      const summary = routedDiagnostics[0]?.message ?? "AI ChangeSet failed dry-run validation.";
      setStatusMessage(summary);
      return {
        ok: false,
        summary,
        diagnostics: routedDiagnostics.map(toAgentDiagnostic)
      };
    }

    const step = createPatchJournalStep({
      id: `patch-step-${Date.now()}`,
      createdAt: plan.intent.createdAt,
      intent: plan.intent,
      forward: plan.changeSet,
      inverse: dryRun.inverseChangeSet,
      beforeText: viewModel.snapshot.text,
      afterText: dryRun.after.text,
      diffSummary: dryRun.diffSummary,
      diagnostics: dryRun.diagnostics
    });

    // Feed the incremental projection updater the pointers this ChangeSet touches
    // in the ACTIVE document (Phase 2.1). Only JSON Patch ops map to pointers; if
    // the ChangeSet also carries an active-file text patch (no pointer form), the
    // empty set forces a full rebuild.
    const activeFilePath = currentDocument.filePath;
    const changedPointers = (plan.changeSet.textPatches ?? []).some((patch) => patch.filePath === activeFilePath)
      ? []
      : plan.changeSet.jsonPatches
          .filter((patch) => patch.filePath === activeFilePath)
          .flatMap((patch) => patch.operations.map((operation) => operation.path));
    stashIncrementalProjectionEdit(changedPointers, dryRun.after.text);
    setJsonText(dryRun.after.text);
    setAiPatchJournal((current) => [...current, step]);
    setAiRedoJournal([]);
    setAiDiffSummary(dryRun.diffSummary);
    setAgentPlannedChangeSet(null);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState("applied");
    // Structural changes get an emphasized summary (ADR-057 §4.5) so the author
    // notices add/remove/reorder edits; safe leaf edits keep the plain message.
    const appliedSummary =
      classification.risk === "structural"
        ? `Applied structural ChangeSet — review the changes: ${plan.changeSet.summary}`
        : `Applied AI ChangeSet: ${plan.changeSet.summary}`;
    setStatusMessage(appliedSummary);
    selectFirstPointerAfterAiApply(plan.targetPointers);

    return {
      ok: true,
      summary: appliedSummary,
      diagnostics: dryRun.diagnostics.map(toAgentDiagnostic),
      diffSummary: dryRun.diffSummary.map((item) => item.description),
      changeSetId: plan.changeSet.id
    };
  }

  // === Agent intent queue integration (ADR-057 §4.11; UX §9.5; design-spec §2.4)
  //
  // The queue WRAPS the agent apply path; it never replaces the safety pipeline.
  // `applyPlannedAiChangeSet` above stays the single convergence point
  // (classify → approval → dry-run → validation → undo journal). A queued intent
  // adds, in front of that point, optimistic-concurrency conflict detection and
  // MVP one-at-a-time serialization; manual form edits bypass all of this.

  // Keep the ref pointing at the current-render apply pipeline so a deferred
  // runner applies against the LIVE document (see the ref's declaration).
  latestApplyPlannedRef.current = applyPlannedAiChangeSet;

  /** Updates the queue ref (synchronous truth) and the render mirror together. */
  function updateIntentQueue(
    reducer: (entries: readonly IntentQueueEntry[]) => readonly IntentQueueEntry[]
  ): readonly IntentQueueEntry[] {
    const next = reducer(intentQueueRef.current);
    intentQueueRef.current = next;
    setIntentQueue(next);
    return next;
  }

  /**
   * Enqueues an agent intent (pending) and stores its execution closure. The
   * intent captures the CURRENT journal length as its `baseJournalSeq` plus the
   * pointers it read and (best-known) writes. The promotion effect starts it once
   * nothing else is active (MVP one running). Returns the new intent id.
   */
  function enqueueAgentIntent(input: {
    readonly readPointers: readonly string[];
    readonly writePointers: readonly string[];
    readonly run: (intentId: string) => void | Promise<void>;
  }): string {
    intentSeqRef.current += 1;
    const id = `intent-${Date.now()}-${intentSeqRef.current}`;
    intentRunnersRef.current.set(id, { cancelled: false, run: input.run });
    updateIntentQueue((entries) =>
      enqueueIntent(entries, {
        id,
        baseJournalSeq: aiPatchJournalRef.current.length,
        readPointers: input.readPointers,
        writePointers: input.writePointers
      })
    );
    return id;
  }

  /** True when a cancel request arrived for this intent (flag or queue status). */
  function isIntentCancelled(intentId: string): boolean {
    if (intentRunnersRef.current.get(intentId)?.cancelled === true) {
      return true;
    }
    return intentQueueRef.current.find((entry) => entry.id === intentId)?.status === "cancelled";
  }

  /** Drops a finished intent's runner bookkeeping (keeps the queue entry for the UI). */
  function forgetIntentRunner(intentId: string): void {
    intentRunnersRef.current.delete(intentId);
    intentStartedRef.current.delete(intentId);
  }

  /**
   * Reconciles a running intent against the live document and either applies it or
   * marks it `stale` (design-spec §2.4). The intent's write set is first refined to
   * the ChangeSet's real pointers; then, if any journal edit committed since the
   * intent was captured overlaps its read ∪ write pointers, the intent goes
   * `stale` and the author chooses (apply anyway / cancel) — the ChangeSet is
   * stashed for a later "apply anyway". No conflict → the normal apply runs.
   */
  function reconcileAndApplyIntent(
    intentId: string,
    plan: PlannedAiChangeSet,
    options: { readonly approval?: CubicaAgentApprovalEnvelope; readonly classification?: ClassifyChangeSetResult } = {}
  ): void {
    if (isIntentCancelled(intentId)) {
      forgetIntentRunner(intentId);
      return;
    }
    const writePointers = scopeChangeSetWritePointers(plan.changeSet);
    const entries = updateIntentQueue((current) => refineIntentPointers(current, intentId, { writePointers }));
    const entry = entries.find((candidate) => candidate.id === intentId);
    if (entry !== undefined && detectIntentConflict(entry, deriveIntentJournalEntries(aiPatchJournalRef.current))) {
      const runner = intentRunnersRef.current.get(intentId);
      if (runner !== undefined) {
        runner.plan = plan;
      }
      updateIntentQueue((current) => transitionIntent(current, intentId, "stale"));
      setStatusMessage(`Правки в журнале затронули цели интента — интент устарел (${INTENT_STALE_DIAGNOSTIC_CODE}). Выберите действие.`);
      return;
    }
    performIntentApply(intentId, plan, options);
  }

  /** Runs the shared apply pipeline for an intent and records the terminal status. */
  function performIntentApply(
    intentId: string,
    plan: PlannedAiChangeSet,
    options: { readonly approval?: CubicaAgentApprovalEnvelope; readonly classification?: ClassifyChangeSetResult } = {}
  ): void {
    updateIntentQueue((current) => transitionIntent(current, intentId, "applying"));
    // Use the LATEST apply pipeline (not the runner's capture) so the dry-run
    // runs against the current document (§2.4 "dry-run против актуального").
    const applied = (latestApplyPlannedRef.current ?? applyPlannedAiChangeSet)(plan, options);
    updateIntentQueue((current) => transitionIntent(current, intentId, applied.ok ? "done" : "failed"));
    forgetIntentRunner(intentId);
  }

  /** Marks an intent `failed` (its planning/agent step was blocked) and cleans up. */
  function failIntent(intentId: string, message: string): void {
    updateIntentQueue((current) => transitionIntent(current, intentId, "failed"));
    setAiApplyState("blocked");
    setStatusMessage(message);
    forgetIntentRunner(intentId);
  }

  /**
   * Cancels a queued intent (design-spec §2.4; UX §9.5 «отмена в полёте»). A
   * pending/running/stale intent transitions to `cancelled` and, if it is still
   * planning, its runner's cancel flag makes it skip the apply when it resumes.
   * The provider fetch is not aborted (that would change the api-client contract);
   * cancel is enforced at the queue level by never applying the result. `applying`
   * (durable mutation underway) and terminal intents are left untouched.
   */
  function handleCancelIntent(intentId: string): void {
    const runner = intentRunnersRef.current.get(intentId);
    if (runner !== undefined) {
      runner.cancelled = true;
    }
    const status = intentQueueRef.current.find((entry) => entry.id === intentId)?.status;
    if (status === "pending" || status === "running" || status === "stale") {
      updateIntentQueue((current) => transitionIntent(current, intentId, "cancelled"));
      forgetIntentRunner(intentId);
      setStatusMessage("Интент отменён.");
    }
  }

  /**
   * Resolves a `stale` intent by the author's choice (design-spec §2.4):
   * "apply" re-runs the apply against the current document with the stashed plan;
   * "cancel" drops it.
   */
  function handleResolveStaleIntent(intentId: string, choice: "apply" | "cancel"): void {
    const runner = intentRunnersRef.current.get(intentId);
    if (choice === "cancel" || runner?.plan === undefined) {
      updateIntentQueue((current) => transitionIntent(current, intentId, "cancelled"));
      forgetIntentRunner(intentId);
      setStatusMessage("Устаревший интент отменён.");
      return;
    }
    performIntentApply(intentId, runner.plan);
  }

  // Promotion effect: when nothing is active, start the oldest pending intent
  // (MVP one running). Effects run AFTER commit, so a serialized follow-up intent
  // sees the previous intent's journal edit for conflict detection. `intentStarted`
  // guards against a double-fire starting the same runner twice.
  useEffect(() => {
    if (hasActiveIntent(intentQueue)) {
      return;
    }
    const id = nextPendingIntentId(intentQueue);
    if (id === undefined || intentStartedRef.current.has(id)) {
      return;
    }
    const runner = intentRunnersRef.current.get(id);
    if (runner === undefined) {
      return;
    }
    intentStartedRef.current.add(id);
    updateIntentQueue((current) => transitionIntent(current, id, "running"));
    if (runner.cancelled) {
      updateIntentQueue((current) => transitionIntent(current, id, "cancelled"));
      forgetIntentRunner(id);
      return;
    }
    void runner.run(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; only the queue drives promotion.
  }, [intentQueue]);

  /**
   * Stashes a MULTI-FILE incremental-projection context (ADR-057 §4.13, Phase
   * 2.1b). Unlike `stashIncrementalProjectionEdit` (active document only), this
   * carries the changed JSON-Patch pointers of EVERY touched document, so a
   * cross-manifest entity operation feeds the projection updater the pointers it
   * changed in the game AND the UI facet at once. Paired with the active text so
   * the view-model memo ignores a stale context (same guard as the single-file
   * stash).
   */
  function stashIncrementalProjectionEditByFile(changedPointersByFile: ChangedPointersByFile, activeNextText: string) {
    pendingProjectionEditRef.current =
      Object.keys(changedPointersByFile).length === 0 ? null : { changedPointersByFile, text: activeNextText };
  }

  /** Outcome of {@link commitMultiDocumentChangeSet}: active facet texts + inverse. */
  type MultiDocumentCommitResult =
    | {
        readonly ok: true;
        readonly activeBeforeText: string;
        readonly activeAfterText: string;
        readonly inverseChangeSet: EditorChangeSet;
        readonly diffSummary: readonly EditorDiffSummaryItem[];
      }
    | { readonly ok: false; readonly diagnostics: readonly RoutedEditorDiagnostic[] };

  /**
   * Applies a (possibly multi-document) ChangeSet ATOMICALLY (ADR-057 §4.10, §5;
   * Phase 6.2a, part A).
   *
   * Atomicity model chosen for this slice (see the task report for the rationale):
   *   1. Dry-run/validate EVERY touched document IN MEMORY first
   *      (`dryRunMultiDocumentChangeSet`). Any failure → apply NOTHING.
   *   2. Persist the SIBLING facets to the session worktree via `/api/editor/apply`
   *      (durable; commits on Save like every other edit — ADR-052). A server
   *      failure → apply nothing (the active facet is still untouched).
   *   3. Only AFTER the durable sibling write succeeds, apply the ACTIVE facet
   *      in-memory (synchronous, cannot fail — it was already dry-run) and mirror
   *      the persisted sibling texts into the projection inputs.
   * The single async boundary is crossed BEFORE the active facet mutates, so a
   * half-applied facet split is never observable. Undo replays this routine with
   * the inverse ChangeSet, reverting siblings on disk and the active in memory.
   */
  async function commitMultiDocumentChangeSet(changeSet: EditorChangeSet): Promise<MultiDocumentCommitResult> {
    const activeFilePath = currentDocument.filePath;
    const activeBeforeText = jsonText;
    const dryRun = dryRunMultiDocumentChangeSet({
      changeSet,
      documentTextByPath: liveAuthoringTextByFilePath(),
      schemaRegistry,
      resolveSchemaId: (filePath) => schemaIdForAuthoringDocument(filePath, undefined),
      includeSemanticDiagnostics: true
    });
    const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
    setAiDiagnostics(routedDiagnostics);
    if (!dryRun.ok) {
      return { ok: false, diagnostics: routedDiagnostics };
    }

    const siblingAfters = [...dryRun.afterTextByPath]
      .filter(([filePath]) => filePath !== activeFilePath)
      .map(([filePath, text]) => ({ filePath, text }));
    const activeAfterText = dryRun.afterTextByPath.get(activeFilePath) ?? activeBeforeText;

    // Step 2: durable sibling write BEFORE the active facet changes.
    if (siblingAfters.length > 0) {
      try {
        await applyEditorSiblingDocuments({
          gameId: currentDocument.gameId,
          sessionId: editorSession?.sessionId,
          files: siblingAfters
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Applying entity operation to the worktree failed.";
        const diagnostics: RoutedEditorDiagnostic[] = [
          { severity: "error", source: "change-set", pointer: "", label: "/", message, range: undefined }
        ];
        setAiDiagnostics(diagnostics);
        return { ok: false, diagnostics };
      }
      // Mirror the persisted sibling texts into the projection inputs (Phase 3.a).
      setProjectionSiblingDocuments((current) =>
        current.map((document) => {
          const after = siblingAfters.find((entry) => entry.filePath === document.filePath);
          return after === undefined ? document : { ...document, text: after.text };
        })
      );
    }

    // Step 3: apply the active facet in-memory + feed the incremental projection
    // updater the pointers changed across ALL documents (Phase 2.1b).
    stashIncrementalProjectionEditByFile(dryRun.changedPointersByFile, activeAfterText);
    if (dryRun.afterTextByPath.has(activeFilePath)) {
      setJsonText(activeAfterText);
    }
    return { ok: true, activeBeforeText, activeAfterText, inverseChangeSet: dryRun.inverseChangeSet, diffSummary: dryRun.diffSummary };
  }

  /**
   * «+» entity/prototype creation from the entity tree (Phase 6.2a, part B;
   * design-spec §3.1). «По экранам» → a new entity (`buildCreateEntityChangeSet`),
   * «По типам» → a new local prototype (`buildCreatePrototypeChangeSet`, ADR-050).
   * The deterministic builder generates the `id` from the label; the resulting
   * (possibly multi-document) ChangeSet flows through the SHARED atomic apply
   * (`commitMultiDocumentChangeSet`) and is recorded on the undo journal. On
   * success the new entity is auto-selected in the tree.
   */
  async function handleCreateEntityFromTree(request: EntityTreeCreateRequest) {
    const documents = viewModel.entityProjectionDocuments;
    const projection = viewModel.editorEntityProjection;
    const label = request.label.trim();

    const build =
      entityTreeGrouping === "byType"
        ? buildCreatePrototypeChangeSet({ baseType: request.typeKey }, projection, documents)
        : buildCreateEntityChangeSet(
            {
              typeOrPrototype: request.typeKey,
              channel: entityCreateChannel ?? "",
              ...(entityCreateContainerPointer !== undefined ? { containerPointer: entityCreateContainerPointer } : {}),
              ...(label !== "" ? { label } : {})
            },
            projection,
            documents
          );
    if (!build.ok) {
      setAiApplyState("blocked");
      setStatusMessage(build.reason);
      setAiDiagnostics([{ severity: "error", source: "change-set", pointer: "", label: "/", message: build.reason, range: undefined }]);
      return;
    }

    setAiApplyState("applying");
    const committed = await commitMultiDocumentChangeSet(build.changeSet);
    if (!committed.ok) {
      setAiApplyState("blocked");
      setStatusMessage(committed.diagnostics[0]?.message ?? "Не удалось выполнить создание.");
      return;
    }

    const now = new Date().toISOString();
    const step = createPatchJournalStep({
      id: `create-step-${Date.now()}`,
      createdAt: now,
      intent: {
        id: `entity-operation:${Date.now()}`,
        kind: "entity-operation",
        prompt: build.changeSet.summary,
        activeFilePath: currentDocument.filePath,
        targetPointers: [],
        createdAt: now,
        selectionKind: "document"
      },
      forward: build.changeSet,
      inverse: committed.inverseChangeSet,
      beforeText: committed.activeBeforeText,
      afterText: committed.activeAfterText,
      diffSummary: committed.diffSummary,
      diagnostics: []
    });
    setAiPatchJournal((current) => [...current, step]);
    setAiRedoJournal([]);
    setAiDiffSummary(committed.diffSummary);
    setAgentPlannedChangeSet(null);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState("applied");

    // Auto-select the newly created entity in the tree (design-spec §3.1). A new
    // prototype surfaces as a header (no entity id) and is left simply visible.
    if ("entityId" in build) {
      setEntityTreeSelectedEntityId(build.entityId);
      setStatusMessage(`Создана сущность «${label === "" ? build.entityId : label}» (${build.entityId}).`);
    } else {
      setStatusMessage(`Создан прототип ${build.definitionType}.`);
    }
  }

  // --- Entity refactor operations (Phase 6.2b, design-spec §3.2; §9.1) ---------

  /** Closes the open delete/rename dialog. */
  function closeEntityRefactorDialog() {
    setEntityRefactorDialog(null);
  }

  /**
   * Opens the delete "область действия" dialog for an entity: it probes the
   * incoming references with the `abort` policy (which refuses AND returns the
   * reference list) and lists the entity's facets and retarget candidates.
   */
  function handleRequestDeleteEntity(entity: EditorEntity) {
    const probe = buildDeleteEntityChangeSet(
      { entityId: entity.entityId, referencePolicy: "abort" },
      viewModel.editorEntityProjection,
      viewModel.entityProjectionDocuments
    );
    if (!probe.ok && probe.reason !== "abort") {
      setStatusMessage(probe.reason);
      return;
    }
    const incoming = probe.ok ? [] : probe.incomingReferences;
    setEntityRefactorDialog({
      kind: "delete",
      entityId: entity.entityId,
      entityLabel: entity.label,
      facets: summarizeEntityFacets(entity),
      incomingReferences: incoming.map((reference) => ({ key: reference.key, source: `${reference.filePath}#${reference.pointer}` })),
      retargetOptions: collectRetargetOptions(entity.entityId)
    });
  }

  /** Opens the rename-id dialog, seeding the input with the entity's current id. */
  function handleRequestRenameEntity(entity: EditorEntity) {
    const currentId = publicEntityIdOf(entity);
    if (currentId === undefined) {
      setStatusMessage(`Сущность «${entity.label}» не имеет id для переименования.`);
      return;
    }
    setEntityRefactorDialog({ kind: "rename", entityId: entity.entityId, entityLabel: entity.label, currentId, suggestedId: currentId });
  }

  /**
   * «Создать вид» (design-spec §3.2): adds ONLY the UI (view) facet for an existing
   * game entity in the active channel via `buildAddViewFacetChangeSet`, then applies
   * it through the shared atomic commit. Never dangerous (a structural UI add).
   */
  async function handleCreateEntityView(entity: EditorEntity) {
    const channel = activeChannel ?? entityCreateChannel;
    if (channel === undefined) {
      setStatusMessage("Нет активного канала для создания вида.");
      return;
    }
    const build = buildAddViewFacetChangeSet(
      { entityId: entity.entityId, channel },
      viewModel.editorEntityProjection,
      viewModel.entityProjectionDocuments
    );
    if (!build.ok) {
      setAiApplyState("blocked");
      setStatusMessage(build.reason);
      setAiDiagnostics([{ severity: "error", source: "change-set", pointer: "", label: "/", message: build.reason, range: undefined }]);
      return;
    }
    const applied = await applyEntityOperationChangeSet(build.changeSet, {
      successMessage: `Создан вид для «${entity.label}» в канале ${channel}.`
    });
    if (applied) {
      setEntityTreeSelectedEntityId(entity.entityId);
    }
  }

  /**
   * Confirms the delete dialog with a `clean` or `retarget` policy. Builds the
   * final ChangeSet, then routes it through the shared apply (which enforces the
   * approval envelope when the operation is dangerous — i.e. it has incoming
   * references). An invalid retarget target surfaces as a refusal message.
   */
  async function confirmDeleteEntity(policy: "clean" | "retarget", retargetTo?: string) {
    const dialog = entityRefactorDialog;
    if (dialog === null || dialog.kind !== "delete") {
      return;
    }
    const build = buildDeleteEntityChangeSet(
      { entityId: dialog.entityId, referencePolicy: policy, ...(retargetTo !== undefined ? { retargetTo } : {}) },
      viewModel.editorEntityProjection,
      viewModel.entityProjectionDocuments
    );
    if (!build.ok) {
      setAiApplyState("blocked");
      setStatusMessage(build.reason);
      setAiDiagnostics([{ severity: "error", source: "change-set", pointer: "", label: "/", message: build.reason, range: undefined }]);
      return;
    }
    const cleaned = dialog.incomingReferences.length > 0;
    const applied = await applyEntityOperationChangeSet(build.changeSet, {
      successMessage: `Удалена сущность «${dialog.entityLabel}»${
        cleaned ? (policy === "retarget" ? " (ссылки перенацелены)" : " (ссылки вычищены)") : ""
      }.`
    });
    if (applied) {
      setEntityRefactorDialog(null);
      setEntityTreeSelectedEntityId(undefined);
      setDismissedInspectorEntityId(dialog.entityId);
    }
  }

  /**
   * Confirms the rename-id dialog. `buildRenameEntityIdChangeSet` is ALWAYS
   * dangerous, so the shared apply demands the approval envelope. A taken/invalid
   * id yields `ok: false`, surfaced as a refusal message inside the dialog.
   */
  async function confirmRenameEntityId(newId: string) {
    const dialog = entityRefactorDialog;
    if (dialog === null || dialog.kind !== "rename") {
      return;
    }
    const build = buildRenameEntityIdChangeSet(
      { entityId: dialog.entityId, newId },
      viewModel.editorEntityProjection,
      viewModel.entityProjectionDocuments
    );
    if (!build.ok) {
      setEntityRefactorDialog({ ...dialog, error: build.reason });
      return;
    }
    const applied = await applyEntityOperationChangeSet(build.changeSet, {
      successMessage: `Переименован id: «${dialog.currentId}» → «${newId}».`
    });
    if (applied) {
      setEntityRefactorDialog(null);
      // Re-select the renamed entity by its NEW projection id (`<kind>:<newId>`).
      setEntityTreeSelectedEntityId(`${dialog.entityId.slice(0, dialog.entityId.length - dialog.currentId.length)}${newId}`);
    }
  }

  /**
   * Shared apply for a deterministic entity refactor ChangeSet (create-view,
   * delete, rename). It runs the SAME risk → approval → dry-run → validation →
   * undo-journal pipeline the agent apply uses, but over the multi-document commit:
   *
   *   1. Classify the ChangeSet ONCE (ADR-057 §4.5).
   *   2. If `dangerous` (a rename, or a delete-with-incoming-references), record the
   *      human's dialog confirmation as an ADR-047 approval envelope and run it
   *      through the EXISTING `validateEditorAgentApproval` gate; a rejected/invalid
   *      envelope records the block and applies nothing.
   *   3. Commit atomically via `commitMultiDocumentChangeSet` and push an undo step.
   *
   * Returns `true` on a durable apply. The operation report is always surfaced
   * through the status log and the diff summary (no silent apply).
   */
  async function applyEntityOperationChangeSet(
    changeSet: EditorChangeSet,
    options: { readonly successMessage: string }
  ): Promise<boolean> {
    const classification = classifyChangeSet(changeSet, viewModel.editorEntityProjection);
    if (classification.risk === "dangerous") {
      const plan = plannedFromEntityChangeSet(changeSet);
      const scopeHash = editorApplyApprovalScope(plan, classification);
      // The human already confirmed the dangerous operation in the refactor dialog;
      // record that decision as an approval envelope and pass it through the SAME
      // gate the agent apply path uses (no second approval mechanism — ADR-047).
      const approval = buildEditorApprovalEnvelope({
        toolName: "editor.applyChangeSet",
        scopeHash,
        actionId: `entity-refactor:${changeSet.id}`
      });
      const approvalError = validateEditorAgentApproval(approval, "editor.applyChangeSet", scopeHash);
      if (approvalError !== null) {
        recordRejectedDangerousChange(plan, classification, approvalError);
        return false;
      }
    }

    setAiApplyState("applying");
    const committed = await commitMultiDocumentChangeSet(changeSet);
    if (!committed.ok) {
      setAiApplyState("blocked");
      setStatusMessage(committed.diagnostics[0]?.message ?? "Операция не выполнена.");
      return false;
    }

    const now = new Date().toISOString();
    const step = createPatchJournalStep({
      id: `entity-refactor-step-${Date.now()}`,
      createdAt: now,
      intent: plannedFromEntityChangeSet(changeSet).intent,
      forward: changeSet,
      inverse: committed.inverseChangeSet,
      beforeText: committed.activeBeforeText,
      afterText: committed.activeAfterText,
      diffSummary: committed.diffSummary,
      diagnostics: []
    });
    setAiPatchJournal((current) => [...current, step]);
    setAiRedoJournal([]);
    setAiDiffSummary(committed.diffSummary);
    setAgentPlannedChangeSet(null);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState("applied");
    // The report is on view (ADR-057 §5): the risk-aware status line plus the diff
    // summary in the journal — never a silent apply.
    setStatusMessage(
      classification.risk === "dangerous" ? `${options.successMessage} (опасная операция — approval envelope записан)` : options.successMessage
    );
    return true;
  }

  /** Wraps an entity-refactor ChangeSet as a minimal `PlannedAiChangeSet`. */
  function plannedFromEntityChangeSet(changeSet: EditorChangeSet): PlannedAiChangeSet {
    const createdAt = new Date().toISOString();
    const targetPointers = [...new Set(changeSet.jsonPatches.flatMap((patch) => patch.operations.map((operation) => operation.path)))];
    const intent: EditorPatchIntent = {
      id: `entity-refactor:${changeSet.id}`,
      kind: "entity-operation",
      prompt: changeSet.summary,
      activeFilePath: currentDocument.filePath,
      targetPointers,
      createdAt,
      selectionKind: "entity"
    };
    return { intent, changeSet: { ...changeSet, intentId: intent.id }, diagnostics: [], targetPointers };
  }

  /** Human-readable facet lines for the delete dialog (one per owned facet source). */
  function summarizeEntityFacets(entity: EditorEntity): readonly EntityFacetSummary[] {
    const facetLabels: Record<string, string> = {
      logic: "Логика",
      state: "Состояние",
      content: "Содержание",
      view: "Вид",
      design: "Дизайн",
      plugin: "Плагин"
    };
    const seen = new Set<string>();
    const summaries: EntityFacetSummary[] = [];
    for (const [kind, sources] of Object.entries(entity.facets)) {
      for (const source of (sources ?? []) as readonly EditorEntitySourcePointer[]) {
        const key = `${source.filePath}#${source.pointer}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const base = facetLabels[kind] ?? kind;
        summaries.push({ label: source.channel !== undefined ? `${base} · ${source.channel}` : base, source: key });
      }
    }
    return summaries;
  }

  /** Existing public entity ids (with labels) a deletion may retarget references to. */
  function collectRetargetOptions(excludeEntityId: string): readonly RetargetOption[] {
    const options: RetargetOption[] = [];
    const seen = new Set<string>();
    for (const entity of viewModel.editorEntityProjection.entities) {
      if (entity.entityId === excludeEntityId) {
        continue;
      }
      const publicId = publicEntityIdOf(entity);
      if (publicId === undefined || seen.has(publicId)) {
        continue;
      }
      seen.add(publicId);
      options.push({ id: publicId, label: entity.label });
    }
    return options;
  }

  /** The entity's explicit PUBLIC id (`<kind>:<publicId>`), or `undefined` if synthetic. */
  function publicEntityIdOf(entity: EditorEntity): string | undefined {
    const publicId = entity.entityId.slice(entity.kind.length + 1);
    return publicId === "" || publicId.includes("#") ? undefined : publicId;
  }

  /**
   * Records a dangerous ChangeSet that was blocked for lack of a matching
   * ADR-047 approval envelope. The rejection is surfaced through the existing
   * diagnostics/status log (the "Проверки" tab and status bar); it never
   * mutates the document, matching the ADR-047 rejected-turn invariant.
   */
  function recordRejectedDangerousChange(
    plan: PlannedAiChangeSet,
    classification: ClassifyChangeSetResult,
    approvalError: EditorAgentToolResult
  ): EditorAgentToolResult {
    const reasonText = classification.reasons.join("; ");
    const diagnostics: RoutedEditorDiagnostic[] = [
      {
        severity: "error",
        source: "change-risk",
        pointer: "",
        label: "/",
        message: `Dangerous ChangeSet "${plan.changeSet.summary}" needs an approval envelope before apply: ${reasonText}`,
        range: undefined
      }
    ];
    setAiDiagnostics(diagnostics);
    setAiDiffSummary([]);
    setAiApplyState("blocked");
    setStatusMessage(`Blocked dangerous ChangeSet pending approval: ${reasonText || classification.risk}`);
    return {
      ...approvalError,
      diagnostics: diagnostics.map(toAgentDiagnostic)
    };
  }

  // --- Text-mode returned intent (Phase 4.2, design-spec §2.2, §3.2) ----------

  /**
   * Live authoring text by file path: the OPEN document (`jsonText`) plus every
   * sibling projection document. This is the "живой DocumentStore" the source
   * hashes are computed from, both at capture and at apply time.
   */
  function liveAuthoringTextByFilePath(): Map<string, string> {
    const byPath = new Map<string, string>([[currentDocument.filePath, jsonText]]);
    for (const sibling of projectionSiblingDocuments) {
      byPath.set(sibling.filePath, sibling.text);
    }
    return byPath;
  }

  /**
   * Source hashes for one entity's authoring files (primary source + every facet
   * source), computed from the live texts. Used both when the text mode opens
   * (captured hashes) and when it applies (fresh hashes) so the interpreter's
   * prompt-stale check (ADR-049) compares the same file set on both sides.
   */
  function computeEntitySourceHashes(entity: EditorEntity): Record<string, string> {
    const texts = liveAuthoringTextByFilePath();
    const filePaths = new Set<string>([entity.primarySource.filePath]);
    for (const facetSources of Object.values(entity.facets)) {
      for (const facetSource of facetSources ?? []) {
        filePaths.add(facetSource.filePath);
      }
    }
    const hashes: Record<string, string> = {};
    for (const filePath of filePaths) {
      const text = texts.get(filePath);
      if (text !== undefined) {
        hashes[filePath] = hashEditorText(text);
      }
    }
    return hashes;
  }

  /**
   * Captures the text-mode context for an entity when the «источник» mode opens:
   * the prompt-projection text, its hidden facet source map, and the source hashes
   * of the entity's authoring documents (design-spec §2.2 "Захват контекста").
   */
  function captureEntitySource(entity: EditorEntity): EntitySourceCapture | undefined {
    const projection = buildEditorEntityYamlProjection({ entity, documents: viewModel.entityProjectionDocuments });
    return {
      entityId: entity.entityId,
      projectionYaml: projection.text,
      facetSourceMap: projection.facetSourceMap,
      sourceHashes: computeEntitySourceHashes(entity)
    };
  }

  /** Folds one interpreter result into the running §5 telemetry tallies. */
  function recordReturnedIntentTelemetry(path: "deterministic" | "agent", stale: boolean, report: readonly { readonly bucket: string }[]) {
    setReturnedIntentTelemetry((current) => ({
      deterministicCount: current.deterministicCount + (!stale && path === "deterministic" ? 1 : 0),
      agentCount: current.agentCount + (!stale && path === "agent" ? 1 : 0),
      staleCount: current.staleCount + (stale ? 1 : 0),
      totalCount: current.totalCount + 1,
      appliedFragments: current.appliedFragments + report.filter((line) => line.bucket === "applied").length,
      recognizedNoChangeFragments: current.recognizedNoChangeFragments + report.filter((line) => line.bucket === "recognized-no-change").length,
      unrecognizedFragments: current.unrecognizedFragments + report.filter((line) => line.bucket === "unrecognized").length
    }));
  }

  /**
   * Applies an edited returned intent (text mode). Order per design-spec §2.2:
   * recompute FRESH source hashes from the live store → `interpretReturnedIntent`
   * → prompt-stale stops before apply → the deterministic ChangeSet flows through
   * the SHARED single point `applyPlannedAiChangeSet` (risk → dry-run → validation
   * → undo journal → apply) → the agent path forwards to the existing agent
   * contour. Telemetry (§5) and the three-bucket report are always surfaced.
   */
  function applyEntityReturnedIntent(input: ReturnedIntentInput): ReturnedIntentApplyOutcome {
    const entity = viewModel.editorEntityProjection.entityById.get(input.entityId);
    const currentSourceHashes = entity === undefined ? undefined : computeEntitySourceHashes(entity);
    const result = interpretReturnedIntent(input, { currentSourceHashes });
    recordReturnedIntentTelemetry(result.path, result.stale === true, result.report);

    if (result.stale === true) {
      setStatusMessage("Источник изменился — обновите проекцию перед применением.");
      return { path: result.path, stale: true, report: [], applied: false, forwarded: false };
    }

    if (result.path === "deterministic") {
      if (result.changeSet === null) {
        // Only recognized-no-change fragments (deleted scalar defaults to "keep"):
        // nothing to apply, but the report still shows every fragment.
        setStatusMessage("Намерение распознано, изменений значений нет.");
        return { path: "deterministic", stale: false, report: result.report, applied: false, forwarded: false };
      }
      const applied = applyPlannedAiChangeSet(plannedChangeSetFromReturnedIntent(result.changeSet, input.entityId));
      return {
        path: "deterministic",
        stale: false,
        report: result.report,
        applied: applied.ok,
        forwarded: false,
        message: applied.summary
      };
    }

    // Agent path: forward the captured context to the EXISTING agent contour (the
    // server AI-patch planner used by the preview prompt); it returns a ChangeSet
    // that flows through the same single point. No new LLM tool/prompt is added.
    const forwarded = forwardReturnedIntentToAgent(input, entity);
    return {
      path: "agent",
      stale: false,
      report: result.report,
      applied: false,
      forwarded,
      message: forwarded
        ? "Правку нельзя свести к простой замене значений — передано агенту (существующий контур)."
        : "Правку нельзя свести к простой замене значений. Откройте файл-источник сущности и передайте правку агенту через «Чат»."
    };
  }

  /** Wraps an interpreter ChangeSet as a `PlannedAiChangeSet` for the shared point. */
  function plannedChangeSetFromReturnedIntent(changeSet: EditorChangeSet, entityId: string): PlannedAiChangeSet {
    const createdAt = new Date().toISOString();
    const targetPointers = [...new Set(changeSet.jsonPatches.flatMap((patch) => patch.operations.map((operation) => operation.path)))];
    const intent: EditorPatchIntent = {
      id: `returned-intent:${entityId}:${Date.now()}`,
      kind: "returned-intent",
      prompt: `Применено текстовое намерение для ${entityId}.`,
      activeFilePath: currentDocument.filePath,
      targetPointers,
      createdAt,
      selectionKind: "entity"
    };
    return { intent, changeSet: { ...changeSet, intentId: intent.id }, diagnostics: [], targetPointers };
  }

  /**
   * Forwards a returned intent that the deterministic path could not handle to the
   * existing server AI-patch planner (the same contour `handlePreviewPromptSubmit`
   * uses): the returned text becomes the prompt and the entity's ACTIVE-document
   * source object is the target. A returned ChangeSet is applied through the shared
   * single point. Requires the entity to have a facet in the open document (the
   * planner can only edit the active file); otherwise nothing is forwarded and the
   * author escalates the visible returned text manually. Fire-and-forget: the UI
   * shows the report immediately and status/diagnostics update on completion.
   */
  function forwardReturnedIntentToAgent(input: ReturnedIntentInput, entity: EditorEntity | undefined): boolean {
    if (entity === undefined || viewModel.snapshot.json === undefined) {
      return false;
    }
    const activePointers = [entity.primarySource, ...Object.values(entity.facets).flat()]
      .filter((source): source is NonNullable<typeof source> => source !== undefined && source.filePath === currentDocument.filePath)
      .map((source) => source.pointer);
    const targetPointer = activePointers[0];
    if (targetPointer === undefined) {
      return false;
    }

    const now = new Date().toISOString();
    const intent: EditorPatchIntent = {
      id: `returned-intent-agent:${entity.entityId}:${Date.now()}`,
      kind: "property-prompt",
      prompt: input.returnedText,
      activeFilePath: currentDocument.filePath,
      targetPointers: [targetPointer],
      createdAt: now,
      selectionKind: "entity"
    };
    const targets = [
      {
        filePath: currentDocument.filePath,
        pointer: targetPointer,
        label: entity.label,
        value: readJsonPointer(viewModel.snapshot.json, targetPointer) ?? null
      }
    ];

    // The agent sub-path of the text mode is a genuine AGENT intent → it goes
    // through the queue (§9.5): captured base journal seq + read/write pointers,
    // conflict-checked at apply, cancellable in flight.
    const readWritePointers = scopeActiveFilePointers(currentDocument.filePath, intent.targetPointers);
    setStatusMessage("Передача намерения агенту (существующий контур)...");
    enqueueAgentIntent({
      readPointers: readWritePointers,
      writePointers: readWritePointers,
      run: async (intentId) => {
        setAiApplyState("planning");
        try {
          const response = await requestAiChangeSet(intent, targets);
          if (isIntentCancelled(intentId)) {
            forgetIntentRunner(intentId);
            return;
          }
          if (!response.ok || response.changeSet === undefined) {
            const diagnostics = (response.diagnostics ?? []).map(toRoutedDiagnostic);
            setAiDiagnostics(diagnostics);
            failIntent(intentId, diagnostics[0]?.message ?? "Агент не вернул применимое изменение.");
            return;
          }
          reconcileAndApplyIntent(intentId, {
            intent,
            changeSet: response.changeSet,
            diagnostics: response.diagnostics ?? [],
            targetPointers: intent.targetPointers
          });
        } catch (error) {
          failIntent(intentId, error instanceof Error ? error.message : "Передача намерения агенту не удалась.");
        }
      }
    });
    return true;
  }

  function rejectedPlan(summary: string): PlanCurrentAiChangeSetResult {
    const diagnostics = [
      {
        severity: "error",
        source: "ai-planner",
        pointer: "",
        label: "/",
        message: summary,
        range: undefined
      } satisfies RoutedEditorDiagnostic
    ];
    setAiDiagnostics(diagnostics);
    setAiApplyState("blocked");
    setStatusMessage(summary);
    return { ok: false, diagnostics, summary };
  }

  function rejectedPlanContext(summary: string): Extract<PlanCurrentAiChangeSetResult, { readonly ok: false }> {
    const rejected = rejectedPlan(summary);
    if (!rejected.ok) {
      return rejected;
    }

    throw new Error("Unexpected successful rejected plan.");
  }

  function selectFirstPointerAfterAiApply(targetPointers: readonly string[]) {
    const firstPointer = targetPointers[0];
    if (firstPointer === undefined) {
      return;
    }

    const node = findNodeForPointer(viewModel.fullNodes, firstPointer);
    if (node !== undefined) {
      selectPointerNode(node);
    }
  }

  /** True when a journal step touched any document other than the active one. */
  function isMultiDocumentStep(step: PatchJournalStep): boolean {
    return step.affectedFiles.some((filePath) => filePath !== currentDocument.filePath);
  }

  /**
   * Undo/redo of a MULTI-DOCUMENT journal step (Phase 6.2a). Replays the shared
   * atomic apply with the step's inverse (undo) or forward (redo) ChangeSet, which
   * reverts/re-applies the sibling facets on disk and the active facet in memory
   * together, then moves the step between the undo and redo journals.
   */
  async function reapplyMultiDocumentStep(step: PatchJournalStep, direction: "undo" | "redo") {
    setAiApplyState("applying");
    const committed = await commitMultiDocumentChangeSet(direction === "undo" ? step.inverse : step.forward);
    if (!committed.ok) {
      setAiApplyState("blocked");
      setStatusMessage(committed.diagnostics[0]?.message ?? `AI ${direction} failed validation.`);
      return;
    }

    if (direction === "undo") {
      setAiPatchJournal((current) => current.slice(0, -1));
      setAiRedoJournal((current) => [...current, step]);
    } else {
      setAiPatchJournal((current) => [...current, step]);
      setAiRedoJournal((current) => current.slice(0, -1));
    }
    setAiDiffSummary(committed.diffSummary);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState(direction === "undo" ? "undone" : "applied");
    setStatusMessage(`${direction === "undo" ? "Undid" : "Reapplied"} AI ChangeSet: ${step.summary}`);
  }

  function handleUndoAiChange() {
    const step = aiPatchJournal.at(-1);
    if (step === undefined) {
      return;
    }

    if (hashEditorText(jsonText) !== step.afterHash) {
      setAiApplyState("blocked");
      setStatusMessage("Undo is blocked because the document changed outside the AI journal.");
      return;
    }

    if (isMultiDocumentStep(step)) {
      void reapplyMultiDocumentStep(step, "undo");
      return;
    }

    const dryRun = dryRunEditorChangeSet({
      snapshot: viewModel.snapshot,
      changeSet: step.inverse,
      schemaRegistry,
      schemaId,
      includeSemanticDiagnostics: true
    });
    const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
    setAiDiagnostics(routedDiagnostics);
    if (!dryRun.ok || dryRun.after === undefined) {
      setAiApplyState("blocked");
      setStatusMessage(routedDiagnostics[0]?.message ?? "AI undo failed validation.");
      return;
    }

    setJsonText(dryRun.after.text);
    setAiPatchJournal((current) => current.slice(0, -1));
    setAiRedoJournal((current) => [...current, step]);
    setAiDiffSummary(dryRun.diffSummary);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState("undone");
    setStatusMessage(`Undid AI ChangeSet: ${step.summary}`);
  }

  function handleRedoAiChange() {
    const step = aiRedoJournal.at(-1);
    if (step === undefined) {
      return;
    }

    if (hashEditorText(jsonText) !== step.beforeHash) {
      setAiApplyState("blocked");
      setStatusMessage("Redo is blocked because the document changed outside the AI journal.");
      return;
    }

    if (isMultiDocumentStep(step)) {
      void reapplyMultiDocumentStep(step, "redo");
      return;
    }

    const dryRun = dryRunEditorChangeSet({
      snapshot: viewModel.snapshot,
      changeSet: step.forward,
      schemaRegistry,
      schemaId,
      includeSemanticDiagnostics: true
    });
    const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
    setAiDiagnostics(routedDiagnostics);
    if (!dryRun.ok || dryRun.after === undefined) {
      setAiApplyState("blocked");
      setStatusMessage(routedDiagnostics[0]?.message ?? "AI redo failed validation.");
      return;
    }

    setJsonText(dryRun.after.text);
    setAiPatchJournal((current) => [...current, step]);
    setAiRedoJournal((current) => current.slice(0, -1));
    setAiDiffSummary(dryRun.diffSummary);
    clearWorkflowAndPluginDiagnostics();
    setReverseDiagnostics([]);
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource("ai");
    setSaveState("idle");
    setAiApplyState("applied");
    setStatusMessage(`Reapplied AI ChangeSet: ${step.summary}`);
  }

  function selectAuthoringPointerFromPreview(entity: PreviewEntityDescriptor) {
    const pointer = entity.authoringPointer;
    const sourceFile = typeof entity.metadata?.sourceFile === "string" ? entity.metadata.sourceFile : undefined;
    const sourceFilePath = sourceFile === undefined ? undefined : toRepositoryAuthoringFilePath(sourceFile, currentDocument.gameId);
    if (
      sourceFilePath !== undefined &&
      currentDocument.source === "repository" &&
      sourceFilePath !== currentDocument.filePath &&
      availableFiles.some((file) => file.filePath === sourceFilePath)
    ) {
      setStatusMessage(`Switching to ${sourceFilePath} for preview selection.`);
      replaceUrlState(currentDocument.gameId, sourceFilePath);
      return;
    }

    const node = findNodeForPointer(viewModel.fullNodes, pointer);
    if (node !== undefined) {
      selectPointerNode(node);
      return;
    }

    openJsonSidebar(pointer);
  }

  function handleFlowNodeClick(event: ReactMouseEvent, node: Node) {
    const target = event.target instanceof Element ? event.target : undefined;
    if (target?.closest("[data-node-action='toggle']") !== null) {
      toggleGraphNode(node.id);
      return;
    }

    const graphNode = findEditorNodeById(viewModel.fullNodes, node.id);
    if (graphNode !== undefined) {
      selectPointerNode(graphNode);
    }
  }

  function toggleGraphNode(nodeId: string) {
    const node = findEditorNodeById(viewModel.fullNodes, nodeId);
    if (node === undefined || !node.expandable) {
      return;
    }

    const nextActiveBranchRootId = node.id === "$" ? undefined : node.id;
    setActiveBranchRootId(nextActiveBranchRootId);
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (expandedNodeIds.has(nodeId)) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return next;
    });
  }

  function updateActiveBranchForSelection(nodeId: string) {
    const node = findEditorNodeById(viewModel.fullNodes, nodeId);
    const branchRoot = getBranchRootNode(viewModel.fullNodes, nodeId);
    const ancestorIds = getNodeAncestorIds(viewModel.fullNodes, nodeId).filter((id) => id !== "$");
    const nextActiveBranchRootId = node !== undefined && node.expandable && node.id !== "$" ? node.id : branchRoot?.id;

    setActiveBranchRootId(nextActiveBranchRootId);
    setExpandedNodeIds(new Set(nextActiveBranchRootId === undefined ? ancestorIds : [nextActiveBranchRootId, ...ancestorIds]));
    setCollapsedNodeIds(() => {
      const next = new Set<string>();
      if (activeBranchRootId !== undefined && activeBranchRootId !== nextActiveBranchRootId) {
        next.add(activeBranchRootId);
      }

      if (node !== undefined && node.expandable && branchRoot !== undefined && branchRoot.id !== node.id) {
        next.add(branchRoot.id);
      }

      return next;
    });
  }

  function handleDiagnosticClick(diagnostic: RoutedEditorDiagnostic) {
    const node = findEditorNodeForPointer(viewModel.fullNodes, diagnostic.pointer);
    if (node !== undefined) {
      selectPointerNode(node, { openJson: true });
      return;
    }

    openJsonSidebar(diagnostic.pointer);
  }

  function replaceUrlState(gameId: string, filePath: string) {
    const next = new URLSearchParams();
    next.set("gameId", gameId);
    next.set("file", filePath);
    router.replace(`?${next.toString()}`);
  }

  function adoptSavedDocumentVersion(document: Partial<SavedAuthoringFileDocument>) {
    const versionHash = document.versionHash;
    const text = document.text;
    if (typeof versionHash !== "string" || typeof text !== "string") {
      return;
    }

    setCurrentDocument((current) =>
      current.source === "repository"
        ? {
            ...current,
            versionHash
          }
        : current
    );
    setSavedText(text);
  }

  function applyLoadedDocument(document: AuthoringFileDocument, layoutDocument?: EditorLayoutDocument) {
    setCurrentDocument({
      source: "repository",
      gameId: document.gameId,
      filePath: document.filePath,
      versionHash: document.versionHash
    });
    // Adopt the project-level projection inputs shipped with the document: the
    // sibling authoring documents and the active channel (ADR-057 §4.1, Phase 3.a).
    // Absent fields degrade to a single-document projection, exactly as before.
    setProjectionSiblingDocuments(document.projectionDocuments ?? []);
    setActiveChannel(document.activeChannel);
    const nextLayout = layoutDocument?.layout ?? createEmptyEditorLayout();
    setEditorLayout(nextLayout);
    setLayoutVersionHash(layoutDocument?.versionHash);
    setLocalNodePositions(positionsFromLayout(nextLayout));
    stashHydrationFromDocument(document);
    setJsonText(document.text);
    setSavedText(document.text);
    setSelectedNodeId("$");
    setActiveBranchRootId(undefined);
    setExpandedNodeIds(new Set());
    setCollapsedNodeIds(new Set());
    setSurfaceMode("tree");
    setTreeDetailMode("entities");
    setTreeCollapsedPointers(createDefaultCollapsedTreePointers(createEditorViewModel(document.text, { filePath: document.filePath }).tree));
    setPropertyPanelOpen(false);
    setReverseDiagnostics([]);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    clearPreparedPreview();
    setWorkflowState("idle");
    setLastEditSource("repository");
  }

  /**
   * Stashes the warm-start hydration (ADR-057 §4.13, Phase 2.2b/3.a) for a
   * just-loaded document, if the server shipped a serialized PROJECT projection.
   * The projection is REVIVED strictly (a corrupt/foreign/version-mismatched
   * envelope revives to `null`) and then VERIFIED against the current text of
   * EVERY document it was built over — the active document plus every sibling —
   * via the envelope's per-document hashes. The hash key set must match the client
   * document set EXACTLY (no missing or extra document), so the hydrated projection
   * can never differ from a client rebuild. Any mismatch clears the ref and the
   * next build rebuilds the projection exactly as today.
   */
  function stashHydrationFromDocument(document: AuthoringFileDocument) {
    pendingHydrationRef.current = null;
    const envelope = document.projection;
    if (envelope === undefined) {
      return;
    }
    const projection = reviveEditorEntityProjection(envelope);
    if (projection === null) {
      return;
    }
    const documentHashes = envelope.documentHashes;
    if (documentHashes === undefined) {
      return;
    }
    const siblings = document.projectionDocuments ?? [];
    // Exact coverage: one hash per document the client will use, no more, no less.
    if (Object.keys(documentHashes).length !== siblings.length + 1) {
      return;
    }
    if (documentHashes[document.filePath] !== hashEditorText(document.text)) {
      return;
    }
    for (const sibling of siblings) {
      if (documentHashes[sibling.filePath] !== hashEditorText(sibling.text)) {
        return;
      }
    }
    pendingHydrationRef.current = { projection, text: document.text };
  }

  function loadEmbeddedFallback(error?: unknown) {
    const fallbackText = `${JSON.stringify(embeddedAuthoringSample, null, 2)}\n`;
    setAvailableGames([]);
    setAvailableFiles([]);
    setProjectionSiblingDocuments([]);
    setActiveChannel(undefined);
    setEditorSession(null);
    editorSessionRef.current = null;
    setCurrentDocument({
      source: "embedded",
      gameId: "embedded",
      filePath: embeddedFilePath,
      versionHash: undefined
    });
    setJsonText(fallbackText);
    setSavedText(fallbackText);
    setEditorLayout(createEmptyEditorLayout());
    setLayoutVersionHash(undefined);
    setLocalNodePositions(new Map());
    setSelectedNodeId("$");
    setActiveBranchRootId(undefined);
    setExpandedNodeIds(new Set());
    setCollapsedNodeIds(new Set());
    setSurfaceMode("tree");
    setTreeDetailMode("entities");
    setTreeCollapsedPointers(createDefaultCollapsedTreePointers(createEditorViewModel(fallbackText, { filePath: embeddedFilePath }).tree));
    setPropertyPanelOpen(false);
    setReverseDiagnostics([]);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    clearPreparedPreview();
    setWorkflowState("idle");
    setLoadState("fallback");
    setSaveState("idle");
    setLastEditSource("repository");
    setStatusMessage(error instanceof Error ? `Repository unavailable: ${error.message}` : "Using embedded sample");
  }

  /**
   * Stashes the one-shot incremental-projection context for the edit about to be
   * committed (ADR-057 §4.13, Phase 2.1). `changedPointers` are the paths of the
   * JSON Patch operations that actually ran, keyed to the active document; an
   * empty set clears the context so the next build is a full rebuild. Pairing the
   * pointers with `nextText` lets the view-model memo ignore any stale context.
   */
  function stashIncrementalProjectionEdit(changedPointers: readonly string[], nextText: string) {
    pendingProjectionEditRef.current =
      changedPointers.length === 0
        ? null
        : { changedPointersByFile: { [currentDocument.filePath]: [...changedPointers] }, text: nextText };
  }

  function applyAuthoringEditResult(
    result: EditorAuthoringEditResult,
    source: "graph" | "property",
    pointer: string
  ) {
    stashIncrementalProjectionEdit(
      result.operations.map((operation) => operation.path),
      result.text
    );
    setJsonText(result.text);
    setReverseDiagnostics(result.diagnostics);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    softenPreviewForEdit();
    setWorkflowState("idle");
    setLastEditSource(source);
    setSaveState("idle");
    if (rightSidebarPanel === "json") {
      revealJsonPointer(pointer);
    }
  }

  async function persistNodePosition(node: Node) {
    if (currentDocument.source !== "repository") {
      return;
    }

    const position = { x: node.position.x, y: node.position.y };
    const nextLayout: EditorLayoutDocumentBody = {
      version: 1,
      nodes: {
        ...editorLayout.nodes,
        [node.id]: {
          ...(editorLayout.nodes[node.id] ?? {}),
          position
        }
      }
    };

    setEditorLayout(nextLayout);

    try {
      const savedLayout = await saveEditorLayout(currentDocument.gameId, currentDocument.filePath, nextLayout, layoutVersionHash, editorSession?.sessionId);
      setEditorLayout(savedLayout.layout);
      setLayoutVersionHash(savedLayout.versionHash);
      setStatusMessage(`Saved editor layout ${savedLayout.layoutFilePath}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Layout save failed.");
    }
  }

  function revealJsonPointer(pointer: string) {
    const editor = editorRef.current;
    if (editor === null) {
      return;
    }

    const range = viewModel.snapshot.locationMap.get(pointer) ?? viewModel.snapshot.locationMap.get(parentPointer(pointer) ?? "");
    if (range === undefined) {
      return;
    }

    const monacoRange = toMonacoRange(range);
    editor.setSelection(monacoRange);
    editor.revealRangeInCenter(monacoRange);
  }

  const syncLabel = getSyncLabel({
    loadState,
    saveState,
    isDirty,
    hasBlockingDiagnostics,
    currentDocument,
    statusMessage
  });


  return {
    agentConnection,
    editorAgentContext,
    editorAgentTools,
    editorAgentSurface,
    effectivePreviewInspectMode,
    previewModeLabel,
    // Design/Preview axis (ADR-057 §4.8; design-spec §3.3): mode + apply policy.
    editorMode,
    setEditorMode,
    previewFreshness,
    previewFreshnessDescriptor,
    canApplyEditsToPreview,
    handleApplyEditsToPreview: () => applyEditsToPreview("preview"),
    previewViewportMode,
    setPreviewViewportMode,
    setPreviewInspectMode,
    setAltPlayActive,
    setPreviewPointerPlayMode,
    setPreviewPointSelectionMode,
    clearPreviewPointerPlayReset,
    setPreviewPromptContext,
    setPreviewAiIntent,
    setPropertyPanelOpen,
    availableGames,
    availableFiles,
    currentDocument,
    handleGameChange,
    handleFileChange,
    resetCurrentFile,
    loadState,
    saveState,
    workflowState,
    statusMessage,
    syncLabel,
    handleSave,
    handleUndoAiChange,
    handleRedoAiChange,
    handleValidate,
    handleCompile,
    handlePreview,
    isDirty,
    hasBlockingDiagnostics,
    hasLocalSchemaBlockingDiagnostics,
    aiPatchJournal,
    aiRedoJournal,
    aiApplyState,
    aiDiffSummary,
    // Agent intent queue (ADR-057 §4.11; UX §9.5; design-spec §2.4): the live
    // queue for the "Журнал" surface, plus cancel + stale-resolution handlers.
    intentQueue,
    handleCancelIntent,
    handleResolveStaleIntent,
    rightSidebarOpen,
    leftSidebarOpen,
    rightSidebarPanel,
    leftSidebarPanel,
    setLeftSidebarPanel,
    setJsonPanelOpen,
    openJsonSidebar,
    openPropertiesSidebar,
    previewUrl,
    sidebarResizeState,
    workspaceStyle,
    selectedNode,
    selectedValue,
    properties,
    graphTargetNodes,
    surfaceMode,
    setSurfaceMode,
    flowNodes,
    flowEdges,
    flowRef,
    onNodesChange,
    persistNodePosition,
    handleFlowNodeClick,
    activeTree,
    treeCollapsedPointers,
    setTreeCollapsedPointers,
    handleTreeSelectPointer,
    entityTreeGrouping,
    setEntityTreeGrouping,
    entityGroupingTree,
    entityTreeActiveEntityId,
    handleEntityTreeSelectEntity,
    // «+» entity/prototype creation (Phase 6.2a, part B; design-spec §3.1).
    entityCreateOptions,
    canCreateEntity: currentDocument.source === "repository",
    handleCreateEntityFromTree,
    // Floating entity inspector wiring (Phase 3.c).
    activeChannel,
    inspectorEntityId,
    handleInspectorClose,
    // Entity refactor: «создать вид» / «Переименовать» / «Удалить» (Phase 6.2b).
    entityRefactorDialog,
    closeEntityRefactorDialog,
    handleRequestDeleteEntity,
    handleRequestRenameEntity,
    handleCreateEntityView,
    confirmDeleteEntity,
    confirmRenameEntityId,
    // Text mode «источник» + returned-intent apply (Phase 4.2).
    captureEntitySource,
    applyEntityReturnedIntent,
    returnedIntentTelemetry,
    previewTraceEntries,
    selectedPreviewTraceEvent,
    selectedPreviewTraceSnapshot,
    currentPreviewTraceEvent,
    previewRollbackState,
    setSelectedPreviewTraceSequence,
    handlePreviewRollback,
    handlePreviewResetToStart,
    handlePreviewReplayCurrent,
    previewAiIntent,
    // Pinned state fixtures (ADR-057 §9.3; design-spec §3.3): Design-mode state
    // selector + "Закрепить как фикстуру" timeline action.
    stateFixtures,
    selectedFixtureId: effectiveSelectedFixtureId,
    canPinFixture,
    handleSelectFixture: applyFixtureToPreview,
    handlePinFixture,
    prototypeExtractionProposal,
    runAgentPreparePrototypeChangeSetTool,
    handleSidebarResizeStart,
    previewIframeRef,
    previewEntities,
    selectedPreviewEntityId,
    previewPointSelectionMode,
    previewPromptContext,
    previewUnresolvedEntityCount,
    handlePreviewEntitySelect,
    handlePreviewRegionSelect,
    setSelectedPreviewEntityId,
    handlePreviewPromptSubmit,
    handlePreviewTemporaryPlayChange,
    viewModel,
    monacoModelUri,
    jsonText,
    schemaId,
    handleEditorMount,
    handleJsonChange,
    handlePropertyChange,
    handlePropertyJsonChange,
    handleWritableGraphOperation,
    altPlayActive,
    previewPointerPlayMode,
    previewTrace,
    nonVisualEntityCounts,
    pluginDiagnostics,
    handleDiagnosticClick,
    prototypeAuditSnoozed,
    prototypeAuditNotice,
    setPrototypeAuditSnoozed,
    // Telemetry for the last entity-projection update (design-spec §5, Phase 2.1).
    // No UI consumes it yet; it is available on the controller for status data.
    projectionIncrementalReport
  };
}

/**
 * The full controller object returned by {@link useEditorWorkspace}. The
 * presentational panels accept this and read the slice of state/handlers they
 * render, which keeps their prop lists in sync with the controller by construction.
 */
export type EditorWorkspaceController = ReturnType<typeof useEditorWorkspace>;
