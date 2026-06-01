"use client";

/**
 * Primary ADR-034 editor workspace.
 *
 * The component treats repository authoring JSON as the editable source. React
 * Flow remains a derived projection: selection and drag state may change local
 * canvas layout, but manifest data is changed only through editor-engine JSON
 * Patch operations or direct Monaco text edits.
 */
import Editor from "@monaco-editor/react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import {
  appendPreviewPlaythroughEvent,
  buildPreviewTraceRestorePlan,
  createPatchJournalStep,
  createPreviewPlaythroughTrace,
  createSchemaRegistry,
  dryRunEditorChangeSet,
  hashEditorText,
  readJsonPointer,
  type DocumentDiagnostic,
  type EditorChangeSet,
  type EditorDiffSummaryItem,
  type EditorPatchIntent,
  type JsonValue,
  type PatchJournalStep,
  type PreviewEntityDescriptor,
  type PreviewPoint,
  type PreviewPlaythroughTrace,
  type PreviewRect,
  type TextRange
} from "@cubica/editor-engine";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { embeddedAuthoringSample } from "@/lib/authoring-sample";
import {
  localAuthoringSchemas,
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
  formatPropertyJson,
  getBranchRootNode,
  getNodeAncestorIds,
  getVisibleGraphBudgetLabel,
  isLocalReferenceValue,
  safeDefaultCollectionValue,
  selectProperties,
  toRoutedDiagnostic,
  type EditorProperty,
  type EditorViewEdge,
  type EditorViewNode,
  type RoutedEditorDiagnostic,
  type WritableGraphOperation
} from "@/lib/editor-web-adapter";
import { createDefaultCollapsedTreePointers, JsonTreeView } from "@/components/json-tree-view";
import { PluginDiagnosticsJournal } from "@/components/plugin-diagnostics-journal";
import {
  PreviewSelectionOverlay,
  type PreviewAiIntent,
  type PreviewPromptContext
} from "@/components/preview-selection-overlay";
import {
  isPlayerPreviewEntitiesMessage,
  isPlayerPreviewSessionSnapshotMessage,
  mapPlayerPreviewEntitiesToAuthoringDescriptors,
  type PlayerPreviewSessionSnapshotMessage,
  type PreviewSelectionSourceMap
} from "@/lib/preview-message-adapter";

interface AuthoringFileSummary {
  readonly gameId: string;
  readonly filePath: string;
  readonly size: number;
  readonly versionHash: string;
}

interface AuthoringListResult {
  readonly gameId: string;
  readonly games: readonly string[];
  readonly files: readonly AuthoringFileSummary[];
  readonly defaultFilePath: string | undefined;
}

interface AuthoringFileDocument extends AuthoringFileSummary {
  readonly text: string;
}

interface EditorSessionSummary {
  readonly sessionId: string;
  readonly gameId: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface EditorSessionListResult extends AuthoringListResult {
  readonly session: EditorSessionSummary;
}

interface SavedAuthoringFileDocument extends AuthoringFileDocument {
  readonly sessionId?: string;
  readonly commit?: {
    readonly committed: boolean;
    readonly commitHash?: string;
    readonly changedPaths: readonly string[];
  };
  readonly pluginValidation?: EditorPluginValidationResult;
}

interface EditorLayoutDocumentBody {
  readonly version: 1;
  readonly nodes: Record<string, { readonly position?: { readonly x: number; readonly y: number } }>;
}

interface EditorLayoutDocument {
  readonly gameId: string;
  readonly authoringFilePath: string;
  readonly layoutFilePath: string;
  readonly layout: EditorLayoutDocumentBody;
  readonly versionHash: string;
}

interface CurrentDocument {
  readonly source: "repository" | "embedded";
  readonly gameId: string;
  readonly filePath: string;
  readonly versionHash: string | undefined;
}

interface EditorWorkflowResponse {
  readonly ok: boolean;
  readonly ready?: boolean;
  readonly diagnostics?: readonly RoutedEditorDiagnostic[];
  readonly pluginValidation?: EditorPluginValidationResult;
  readonly playerUrl?: string;
  readonly sessionId?: string;
  readonly sourceMaps?: readonly PreviewSelectionSourceMap[];
}

interface EditorPreviewRollbackResponse {
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

interface EditorPluginValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
}

interface AiPatchPlanResponse {
  readonly ok: boolean;
  readonly changeSet?: EditorChangeSet;
  readonly diagnostics?: readonly DocumentDiagnostic[];
}

interface MonacoModel {
  readonly uri: unknown;
  getLineMaxColumn(lineNumber: number): number;
}

interface MonacoEditorInstance {
  getModel(): MonacoModel | null;
  setSelection(range: MonacoRange): void;
  revealRangeInCenter(range: MonacoRange): void;
  focus(): void;
}

interface MonacoApi {
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

interface MonacoRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

interface MonacoMarker extends MonacoRange {
  readonly severity: number;
  readonly message: string;
  readonly source: string;
}

const embeddedFilePath = "embedded-sample.game.authoring.json";
const editorMarkerOwner = "cubica-editor";

interface SemanticNodeData extends Record<string, unknown> {
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

type SemanticFlowNode = Node<SemanticNodeData, "semantic">;
type SemanticFlowEdge = Edge<{ readonly role: EditorViewEdge["role"]; readonly label?: string }, "semantic">;

const semanticNodeWidth = 250;
const semanticNodeHeight = 132;
const semanticHandleSize = 9;
const semanticNodeRowsPerColumn = 8;
const semanticNodeRowSpacing = 168;
const semanticNodeColumnSpacing = 300;
const semanticNodeDepthSpacing = 80;
const semanticNodeHandles: NonNullable<SemanticFlowNode["handles"]> = [
  {
    type: "target",
    position: Position.Left,
    x: 0,
    y: (semanticNodeHeight - semanticHandleSize) / 2,
    width: semanticHandleSize,
    height: semanticHandleSize
  },
  {
    type: "source",
    position: Position.Right,
    x: semanticNodeWidth - semanticHandleSize,
    y: (semanticNodeHeight - semanticHandleSize) / 2,
    width: semanticHandleSize,
    height: semanticHandleSize
  }
];

const SemanticGraphNode = memo(function SemanticGraphNode({ data, selected }: NodeProps<SemanticFlowNode>) {
  return (
    <div className={`semantic-node semantic-node-${data.presentationRole} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="semantic-node-handle" />
      <div className="semantic-node-header">
        <span className="semantic-node-role">{data.semanticRole}</span>
        {data.expandable ? (
          <button
            aria-label={data.expanded ? "Collapse branch" : "Expand branch"}
            className="semantic-node-toggle"
            data-node-action="toggle"
            title={data.expanded ? "Collapse branch" : "Expand branch"}
            type="button"
          >
            {data.expanded ? "-" : "+"}
          </button>
        ) : null}
      </div>
      <strong>{data.semanticTitle}</strong>
      <p>{data.semanticSummary}</p>
      <span className="semantic-node-meta">
        {data.valueType}
        {data.childCount > 0 ? ` · ${data.childCount} children` : ""}
      </span>
      <Handle type="source" position={Position.Right} className="semantic-node-handle" />
    </div>
  );
});

const SemanticGraphEdge = memo(function SemanticGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data
}: EdgeProps<SemanticFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
  const role = data?.role ?? "contains";

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className={`semantic-edge semantic-edge-${role}`} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <span className={`semantic-edge-label semantic-edge-label-${role}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const nodeTypes = {
  semantic: SemanticGraphNode
};

const edgeTypes = {
  semantic: SemanticGraphEdge
};

export function EditorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedGameId = searchParams.get("gameId");
  const requestedFilePath = searchParams.get("file");

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
  const [selectedNodeId, setSelectedNodeId] = useState("$");
  const [lastEditSource, setLastEditSource] = useState<"repository" | "graph" | "json" | "property" | "ai">("repository");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [workflowState, setWorkflowState] = useState<"idle" | "validating" | "validated" | "compiling" | "compiled" | "previewing" | "ready" | "blocked" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("Loading repository files...");
  const [reverseDiagnostics, setReverseDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [workflowDiagnostics, setWorkflowDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [pluginDiagnostics, setPluginDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
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
  const [previewRollbackState, setPreviewRollbackState] = useState<"idle" | "restoring" | "restored" | "blocked" | "error">("idle");
  const [aiApplyState, setAiApplyState] = useState<"idle" | "planning" | "applying" | "applied" | "blocked" | "error" | "undone">("idle");
  const [aiPatchJournal, setAiPatchJournal] = useState<readonly PatchJournalStep[]>([]);
  const [aiRedoJournal, setAiRedoJournal] = useState<readonly PatchJournalStep[]>([]);
  const [aiDiffSummary, setAiDiffSummary] = useState<readonly EditorDiffSummaryItem[]>([]);
  const [aiDiagnostics, setAiDiagnostics] = useState<readonly RoutedEditorDiagnostic[]>([]);
  const [previewInspectMode, setPreviewInspectMode] = useState(true);
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
  const [manifestPanelOpen, setManifestPanelOpen] = useState(true);
  const [treeCollapsedPointers, setTreeCollapsedPointers] = useState<ReadonlySet<string>>(() => new Set());
  const [jsonPanelOpen, setJsonPanelOpen] = useState(true);
  const [propertyPanelOpen, setPropertyPanelOpen] = useState(false);
  const [pendingJsonRevealPointer, setPendingJsonRevealPointer] = useState<string | undefined>(undefined);
  const [monacoApi, setMonacoApi] = useState<MonacoApi | null>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const flowRef = useRef<ReactFlowInstance<Node, SemanticFlowEdge> | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const editorSessionRef = useRef<EditorSessionSummary | null>(null);
  const openingSessionRef = useRef<{
    readonly gameId: string | null;
    readonly promise: Promise<EditorSessionListResult>;
  } | null>(null);

  const schemaRegistry = useMemo(() => {
    const registry = createSchemaRegistry();
    registerLocalAuthoringSchemas(registry);
    return registry;
  }, []);

  const schemaId = useMemo(
    () => schemaIdForAuthoringDocument(currentDocument.filePath, undefined),
    [currentDocument.filePath]
  );
  const monacoModelUri = useMemo(() => toMonacoModelUri(currentDocument), [currentDocument]);
  const viewModel = useMemo(
    () =>
      createEditorViewModel(jsonText, {
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
          .concat(workflowDiagnostics)
      }),
    [
      activeBranchRootId,
      collapsedNodeIds,
      currentDocument.filePath,
      expandedNodeIds,
      jsonText,
      aiDiagnostics,
      reverseDiagnostics,
      schemaId,
      schemaRegistry,
      selectedNodeId,
      workflowDiagnostics
    ]
  );
  const selectedNode = findEditorNodeById(viewModel.fullNodes, selectedNodeId) ?? viewModel.fullNodes[0];
  const activeTree = treeDetailMode === "entities" ? viewModel.tree : viewModel.jsonTree;
  const selectedValue = selectedNode === undefined || viewModel.snapshot.json === undefined ? undefined : readJsonPointer(viewModel.snapshot.json, selectedNode.pointer);
  const properties = selectedNode ? selectProperties(viewModel.snapshot, selectedNode.pointer) : [];
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
  const timelinePreviewEntries = viewModel.timeline.entries.filter((entry) => entry.kind === "step").slice(0, 8);
  const previewTraceEntries = previewTrace.events.slice(-8);

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
  }, [fitViewDependency, jsonPanelOpen, manifestPanelOpen, propertyPanelOpen, flowNodes.length]);

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
    if (monacoApi === null) {
      return;
    }

    configureMonacoJson(monacoApi, monacoModelUri, schemaId);
  }, [monacoApi, monacoModelUri, schemaId]);

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
    if (selectedNode !== undefined) {
      revealJsonPointer(selectedNode.pointer);
    }
  }, [selectedNode?.pointer, viewModel.snapshot.locationMap]);

  useEffect(() => {
    if (!jsonPanelOpen || pendingJsonRevealPointer === undefined || editorRef.current === null) {
      return;
    }

    revealJsonPointer(pendingJsonRevealPointer);
    setPendingJsonRevealPointer(undefined);
  }, [jsonPanelOpen, monacoApi, pendingJsonRevealPointer, viewModel.snapshot.locationMap]);

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

        setPreviewRuntimeSessionId(event.data.sessionId);
        setPreviewTrace((currentTrace) => upsertRuntimeSnapshotInTrace(currentTrace, event.data));
        setPreviewRollbackState((current) => (current === "restoring" ? "restored" : current));
      }
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [currentDocument.filePath, currentDocument.gameId, previewRuntimeSessionId, previewSourceMaps, previewUrl]);

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
    setPreviewInspectMode(true);
    setPreviewTrace(createPreviewPlaythroughTrace({ traceId: "preview-trace-initial", gameId: currentDocument.gameId }));
    setPreviewRollbackState("idle");
  }

  function clearAiSessionState() {
    setAiApplyState("idle");
    setAiPatchJournal([]);
    setAiRedoJournal([]);
    setAiDiffSummary([]);
    setAiDiagnostics([]);
  }

  function clearWorkflowAndPluginDiagnostics() {
    setWorkflowDiagnostics([]);
    setPluginDiagnostics([]);
  }

  function handleJsonChange(value: string | undefined) {
    setJsonText(value ?? "");
    setReverseDiagnostics([]);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    clearPreparedPreview();
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
    setPropertyPanelOpen(true);

    if (options.openJson) {
      setJsonPanelOpen(true);
      setPendingJsonRevealPointer(pointer);
      revealJsonPointer(pointer);
    }
  }

  function handleTreeSetScalar(pointer: string, rawValue: string) {
    if (viewModel.snapshot.json === undefined) {
      return;
    }

    const current = readJsonPointer(viewModel.snapshot.json, pointer);
    if (current === undefined || Array.isArray(current) || (typeof current === "object" && current !== null)) {
      return;
    }

    const trimmed = rawValue.trim();
    const nextValue: JsonValue =
      typeof current === "number"
        ? Number.isFinite(Number(trimmed))
          ? Number(trimmed)
          : current
        : typeof current === "boolean"
          ? trimmed === "true"
          : current === null
            ? trimmed === "" || trimmed === "null"
              ? null
              : rawValue
            : rawValue;

    const result = applyPropertyEditResult(viewModel.snapshot, pointer, nextValue);
    applyAuthoringEditResult(result, "property", pointer);
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

  async function handlePreview() {
    if (currentDocument.source !== "repository" || isDirty || hasLocalSchemaBlockingDiagnostics) {
      return;
    }

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
        setPreviewInspectMode(true);
        setPreviewTrace(createPreviewPlaythroughTrace({
          traceId: runtimeSessionId === undefined ? `preview-${Date.now()}` : `preview-${runtimeSessionId}`,
          gameId: currentDocument.gameId
        }));
        setPreviewRollbackState("idle");
        setWorkflowState("ready");
        setStatusMessage("Preview session is ready");
      } else {
        clearPreparedPreview();
        setWorkflowState("blocked");
        setStatusMessage("Preview is not ready");
      }
    } catch (error) {
      setWorkflowState("error");
      setStatusMessage(error instanceof Error ? error.message : "Preview failed.");
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

      setPreviewTrace((currentTrace) => truncatePreviewTrace(currentTrace, targetSequence));
      setSelectedPreviewEntityId(undefined);
      setPreviewPromptContext(null);
      setPreviewAiIntent(null);
      setPreviewEntities([]);
      setPreviewUnresolvedEntityCount(0);
      setPreviewRollbackState("restored");
      setPreviewUrl(addPreviewReloadNonce(previewUrl, targetSequence));
      setStatusMessage(`Preview restored to event ${targetSequence}; future trace was discarded.`);
    } catch (error) {
      setPreviewRollbackState("error");
      setStatusMessage(error instanceof Error ? error.message : "Preview rollback failed.");
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
    setPropertyPanelOpen(true);
    updateActiveBranchForSelection(node.id);

    if (options.openJson === true) {
      setJsonPanelOpen(true);
      setPendingJsonRevealPointer(node.pointer);
    }

    revealJsonPointer(node.pointer);
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
    const topEntity = entities[0];
    if (topEntity !== undefined) {
      setSelectedPreviewEntityId(topEntity.entityId);
      selectAuthoringPointerFromPreview(topEntity);
    }

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

    if (viewModel.snapshot.json === undefined) {
      setAiApplyState("blocked");
      setStatusMessage("AI ChangeSet was not applied because the active JSON is invalid.");
      return;
    }

    const targetPointers = [...new Set(context.entities.map((entity) => entity.authoringPointer))];
    const now = new Date().toISOString();
    const previewIntent: PreviewAiIntent = {
      id: `preview-ai-${Date.now()}`,
      kind: context.kind,
      prompt: context.draft.trim(),
      targetPointers,
      createdAt: now
    };
    const intent: EditorPatchIntent = {
      id: previewIntent.id,
      kind: "preview-prompt",
      prompt: previewIntent.prompt,
      activeFilePath: currentDocument.filePath,
      targetPointers,
      createdAt: now,
      selectionKind: context.kind
    };
    const targets = buildAiPatchTargetContexts(context.entities, currentDocument.gameId, currentDocument.filePath, viewModel.snapshot.json);

    if (targets.length === 0) {
      setAiApplyState("blocked");
      setAiDiagnostics([
        {
          severity: "error",
          source: "ai-planner",
          pointer: "",
          label: "/",
          message: "No target entities from the active authoring file were available for AI editing.",
          range: undefined
        }
      ]);
      setStatusMessage("AI ChangeSet was not applied because no active-file targets were found.");
      return;
    }

    setPreviewAiIntent(previewIntent);
    setAiApplyState("planning");
    setAiDiagnostics([]);
    setStatusMessage(`Planning AI ChangeSet for ${targets.length} target pointer${targets.length === 1 ? "" : "s"}...`);

    try {
      const plan = await requestAiChangeSet(intent, targets);
      if (!plan.ok || plan.changeSet === undefined) {
        const diagnostics = (plan.diagnostics ?? []).map(toRoutedDiagnostic);
        setAiDiagnostics(diagnostics);
        setAiApplyState("blocked");
        setStatusMessage(diagnostics[0]?.message ?? "AI planner did not return an applicable ChangeSet.");
        return;
      }

      setAiApplyState("applying");
      const dryRun = dryRunEditorChangeSet({
        snapshot: viewModel.snapshot,
        changeSet: plan.changeSet,
        schemaRegistry,
        schemaId,
        includeSemanticDiagnostics: true
      });
      const routedDiagnostics = dryRun.diagnostics.map(toRoutedDiagnostic);
      setAiDiagnostics(routedDiagnostics);
      if (!dryRun.ok || dryRun.after === undefined || dryRun.inverseChangeSet === undefined) {
        setAiApplyState("blocked");
        setStatusMessage(routedDiagnostics[0]?.message ?? "AI ChangeSet failed dry-run validation.");
        return;
      }

      const step = createPatchJournalStep({
        id: `patch-step-${Date.now()}`,
        createdAt: now,
        intent,
        forward: plan.changeSet,
        inverse: dryRun.inverseChangeSet,
        beforeText: viewModel.snapshot.text,
        afterText: dryRun.after.text,
        diffSummary: dryRun.diffSummary,
        diagnostics: dryRun.diagnostics
      });

      setJsonText(dryRun.after.text);
      setAiPatchJournal((current) => [...current, step]);
      setAiRedoJournal([]);
      setAiDiffSummary(dryRun.diffSummary);
      clearWorkflowAndPluginDiagnostics();
      setReverseDiagnostics([]);
      clearPreparedPreview();
      setWorkflowState("idle");
      setLastEditSource("ai");
      setSaveState("idle");
      setAiApplyState("applied");
      setStatusMessage(`Applied AI ChangeSet: ${plan.changeSet.summary}`);
      selectFirstPointerAfterAiApply(targetPointers);
    } catch (error) {
      setAiApplyState("error");
      setStatusMessage(error instanceof Error ? error.message : "AI ChangeSet apply failed.");
    }
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
    clearPreparedPreview();
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
    clearPreparedPreview();
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

    setPropertyPanelOpen(true);
    setJsonPanelOpen(true);
    setPendingJsonRevealPointer(pointer);
    revealJsonPointer(pointer);
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

    setJsonPanelOpen(true);
    setPendingJsonRevealPointer(diagnostic.pointer);
    revealJsonPointer(diagnostic.pointer);
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
    const nextLayout = layoutDocument?.layout ?? createEmptyEditorLayout();
    setEditorLayout(nextLayout);
    setLayoutVersionHash(layoutDocument?.versionHash);
    setLocalNodePositions(positionsFromLayout(nextLayout));
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

  function loadEmbeddedFallback(error?: unknown) {
    const fallbackText = `${JSON.stringify(embeddedAuthoringSample, null, 2)}\n`;
    setAvailableGames([]);
    setAvailableFiles([]);
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

  function applyAuthoringEditResult(
    result: { readonly text: string; readonly diagnostics: readonly RoutedEditorDiagnostic[] },
    source: "graph" | "property",
    pointer: string
  ) {
    setJsonText(result.text);
    setReverseDiagnostics(result.diagnostics);
    clearWorkflowAndPluginDiagnostics();
    clearAiSessionState();
    clearPreparedPreview();
    setWorkflowState("idle");
    setLastEditSource(source);
    setSaveState("idle");
    revealJsonPointer(pointer);
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

  return (
    <main className="editor-shell">
      <header className="top-toolbar" aria-label="Editor toolbar">
        <div className="toolbar-title">
          <strong>Cubica Editor</strong>
          <span>{currentDocument.source === "repository" ? `${currentDocument.gameId}/${currentDocument.filePath}` : "embedded sample"}</span>
          {editorSession !== null ? <span>{editorSession.branchName}</span> : null}
        </div>
        <div className="toolbar-actions">
          <select
            aria-label="Game"
            disabled={availableGames.length === 0}
            value={currentDocument.source === "repository" ? currentDocument.gameId : ""}
            onChange={(event) => handleGameChange(event.target.value)}
          >
            {availableGames.length === 0 ? <option value="">embedded</option> : null}
            {availableGames.map((gameId) => (
              <option value={gameId} key={gameId}>
                {gameId}
              </option>
            ))}
          </select>
          <select
            aria-label="Authoring file"
            disabled={availableFiles.length === 0}
            value={currentDocument.source === "repository" ? currentDocument.filePath : ""}
            onChange={(event) => handleFileChange(event.target.value)}
          >
            {availableFiles.length === 0 ? <option value="">embedded sample</option> : null}
            {availableFiles.map((file) => (
              <option value={file.filePath} key={`${file.gameId}:${file.filePath}`}>
                {file.filePath}
              </option>
            ))}
          </select>
          <button type="button" onClick={resetCurrentFile} disabled={loadState === "loading"}>
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              currentDocument.source !== "repository" ||
              !isDirty ||
              hasBlockingDiagnostics ||
              saveState === "saving" ||
              loadState === "loading"
            }
          >
            Save
          </button>
          <button type="button" onClick={handleUndoAiChange} disabled={aiPatchJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
            Undo AI
          </button>
          <button type="button" onClick={handleRedoAiChange} disabled={aiRedoJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
            Redo AI
          </button>
          <button type="button" onClick={handleValidate} disabled={currentDocument.source !== "repository" || workflowState === "validating"}>
            Validate
          </button>
          <button
            type="button"
            onClick={handleCompile}
            disabled={
              currentDocument.source !== "repository" ||
              isDirty ||
              hasLocalSchemaBlockingDiagnostics ||
              workflowState === "compiling" ||
              workflowState === "previewing"
            }
          >
            Compile
          </button>
          <button
            type="button"
            onClick={handlePreview}
            disabled={
              currentDocument.source !== "repository" ||
              isDirty ||
              hasLocalSchemaBlockingDiagnostics ||
              workflowState === "compiling" ||
              workflowState === "previewing"
            }
          >
            Preview
          </button>
          {previewUrl !== null ? (
            <a href={previewUrl} target="_blank" rel="noreferrer">
              Open preview
            </a>
          ) : null}
          <span className={`sync-state ${hasBlockingDiagnostics || saveState === "error" || saveState === "conflict" ? "sync-invalid" : "sync-valid"}`}>
            {syncLabel}
          </span>
        </div>
      </header>

      <section className="entity-toolbar" aria-label="Non-visual entities">
        <strong>Entities</strong>
        {nonVisualEntityCounts.map((item) => (
          <button
            key={item.role}
            type="button"
            onClick={() => {
              setManifestPanelOpen(true);
              setSurfaceMode("tree");
            }}
          >
            <span>{item.role}</span>
            <b>{item.count}</b>
          </button>
        ))}
      </section>

      <section className="timeline-band" aria-label="Timeline">
        <strong>Timeline</strong>
        <span>{viewModel.timeline.entries.length} chronology entries</span>
        <span>{previewTrace.events.length} runtime events</span>
        <span>{workflowState}</span>
        <span>{previewRollbackState}</span>
        <span>{selectedNode?.semanticTitle ?? "No selection"}</span>
        {timelinePreviewEntries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              const node = findNodeForPointer(viewModel.fullNodes, entry.pointer);
              if (node !== undefined) {
                selectPointerNode(node);
              }
            }}
          >
            {entry.order + 1}. {entry.label}
          </button>
        ))}
        {previewTraceEntries.map((event) => (
          <button
            key={event.id}
            type="button"
            disabled={previewRollbackState === "restoring"}
            title={`Restore runtime preview to event ${event.sequence}`}
            onClick={() => void handlePreviewRollback(event.sequence)}
          >
            T{event.sequence}: {event.label}
          </button>
        ))}
      </section>

      <section
        className={`workspace-grid ${jsonPanelOpen ? "" : "json-collapsed"} ${manifestPanelOpen ? "" : "manifest-collapsed"} ${previewUrl !== null && !previewInspectMode ? "preview-play-mode" : ""}`}
        aria-label="Authoring editor workspace"
      >
        <aside className={`manifest-panel ${manifestPanelOpen ? "" : "is-collapsed"}`} aria-label="Manifest navigation">
          {manifestPanelOpen ? (
            <>
              <div className="panel-heading manifest-heading">
                <strong>Manifest</strong>
                <button type="button" onClick={() => setManifestPanelOpen(false)}>
                  Collapse
                </button>
              </div>
              <div className="flow-surface">
                <div className="flow-toolbar" aria-label="Manifest view controls">
                  <div className="surface-tabs" role="tablist" aria-label="Manifest views">
                    <button
                      type="button"
                      className={surfaceMode === "tree" ? "is-active" : ""}
                      role="tab"
                      aria-selected={surfaceMode === "tree"}
                      onClick={() => setSurfaceMode("tree")}
                    >
                      Tree
                    </button>
                    <button
                      type="button"
                      className={surfaceMode === "graph" ? "is-active" : ""}
                      role="tab"
                      aria-selected={surfaceMode === "graph"}
                      onClick={() => setSurfaceMode("graph")}
                    >
                      Graph
                    </button>
                  </div>
                  <span>{getVisibleGraphBudgetLabel(viewModel)}</span>
                  <span>{flowEdges.length} edges</span>
                  {activeBranchRootId !== undefined ? (
                    <span>Branch: {findEditorNodeById(viewModel.fullNodes, activeBranchRootId)?.semanticTitle ?? activeBranchRootId}</span>
                  ) : null}
                  {surfaceMode === "tree" ? (
                    <div className="surface-tabs" role="tablist" aria-label="Tree detail">
                      <button
                        type="button"
                        className={treeDetailMode === "entities" ? "is-active" : ""}
                        role="tab"
                        aria-selected={treeDetailMode === "entities"}
                        onClick={() => {
                          setTreeDetailMode("entities");
                          setTreeCollapsedPointers(createDefaultCollapsedTreePointers(viewModel.tree));
                        }}
                      >
                        Entities
                      </button>
                      <button
                        type="button"
                        className={treeDetailMode === "json" ? "is-active" : ""}
                        role="tab"
                        aria-selected={treeDetailMode === "json"}
                        onClick={() => {
                          setTreeDetailMode("json");
                          setTreeCollapsedPointers(createDefaultCollapsedTreePointers(viewModel.jsonTree));
                        }}
                      >
                        JSON
                      </button>
                    </div>
                  ) : null}
                </div>
                {surfaceMode === "graph" ? (
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.18 }}
                    minZoom={0.35}
                    maxZoom={1.6}
                    nodesDraggable
                    onlyRenderVisibleElements={flowNodes.length > 40}
                    onInit={(instance) => {
                      flowRef.current = instance;
                    }}
                    onNodesChange={onNodesChange}
                    onNodeDragStop={(_, node) => void persistNodePosition(node)}
                    onNodeClick={handleFlowNodeClick}
                    colorMode="light"
                  >
                    <Background variant={BackgroundVariant.Lines} gap={28} color="#d6dde8" lineWidth={1} />
                    <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(247, 249, 252, 0.7)" />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                ) : (
                  <JsonTreeView
                    tree={activeTree}
                    selectedPointer={selectedNode?.pointer ?? ""}
                    collapsedPointers={treeCollapsedPointers}
                    onCollapsedPointersChange={setTreeCollapsedPointers}
                    onSelectPointer={(pointer) => handleTreeSelectPointer(pointer)}
                    onRevealPointerInJson={(pointer) => handleTreeSelectPointer(pointer, { openJson: true })}
                    readValue={(pointer) => (viewModel.snapshot.json === undefined ? undefined : readJsonPointer(viewModel.snapshot.json, pointer))}
                    onSetScalarValue={handleTreeSetScalar}
                  />
                )}
              </div>
            </>
          ) : (
            <button className="manifest-rail" type="button" onClick={() => setManifestPanelOpen(true)}>
              <strong>Manifest</strong>
              <span>{activeTree.flatNodes.length}</span>
              <small>{selectedNode?.semanticTitle ?? "No selection"}</small>
            </button>
          )}
        </aside>

        <section className="preview-stage" aria-label="Game preview">
          <div className="preview-stage-toolbar">
            <strong>Preview</strong>
            <span>{previewUrl === null ? "not prepared" : "ready"}</span>
            {previewRuntimeSessionId !== undefined ? <span>session {previewRuntimeSessionId.slice(0, 18)}</span> : null}
            {previewUrl !== null ? <span>{previewEntities.length} selectable</span> : null}
            {previewUrl !== null ? <span>{previewTrace.events.length} trace events</span> : null}
            {previewUrl !== null ? (
              <button
                type="button"
                aria-pressed={previewInspectMode}
                onClick={() => {
                  if (previewInspectMode) {
                    setPreviewPromptContext(null);
                    setPreviewAiIntent(null);
                    setPropertyPanelOpen(false);
                  }
                  setPreviewInspectMode((current) => !current);
                }}
              >
                {previewInspectMode ? "Inspect" : "Play"}
              </button>
            ) : null}
            {previewUrl !== null ? (
              <a href={previewUrl} target="_blank" rel="noreferrer">
                Open tab
              </a>
            ) : null}
          </div>
          <div className="preview-frame-shell">
            {previewUrl !== null ? (
              <>
                <iframe ref={previewIframeRef} title="Game preview" src={previewUrl} allow="fullscreen" />
                <PreviewSelectionOverlay
                  disabled={!previewInspectMode}
                  entities={previewEntities}
                  selectedEntityId={selectedPreviewEntityId}
                  promptContext={previewPromptContext}
                  proposedIntent={previewAiIntent}
                  unresolvedCount={previewUnresolvedEntityCount}
                  onSelectEntity={handlePreviewEntitySelect}
                  onSelectRegion={handlePreviewRegionSelect}
                  onClearContext={() => {
                    setPreviewPromptContext(null);
                    setPreviewAiIntent(null);
                  }}
                  onPromptDraftChange={(draft) =>
                    setPreviewPromptContext((current) => (current === null ? current : { ...current, draft }))
                  }
                  onPromptSubmit={handlePreviewPromptSubmit}
                  onPromptClose={() => {
                    setPreviewPromptContext(null);
                    setPreviewAiIntent(null);
                  }}
                />
              </>
            ) : (
              <div className="preview-empty-state">
                <strong>{selectedNode?.semanticTitle ?? "No selection"}</strong>
                <span>{selectedNode?.pointer ?? "/"}</span>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={
                    currentDocument.source !== "repository" ||
                    isDirty ||
                    hasLocalSchemaBlockingDiagnostics ||
                    workflowState === "compiling" ||
                    workflowState === "previewing"
                  }
                >
                  Prepare preview
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className={`json-panel ${jsonPanelOpen ? "" : "is-collapsed"}`} aria-label="Authoring JSON editor">
          {jsonPanelOpen ? (
            <>
              <div className="panel-heading">
                <strong>Authoring JSON</strong>
                <span>{hasBlockingDiagnostics ? `${viewModel.diagnostics.length} diagnostics` : "No blocking diagnostics"}</span>
                <button type="button" onClick={() => setJsonPanelOpen(false)}>
                  Collapse
                </button>
              </div>
              <Editor
                height="100%"
                language="json"
                path={monacoModelUri}
                value={jsonText}
                theme="light"
                beforeMount={(monaco) => configureMonacoJson(monaco as MonacoApi, monacoModelUri, schemaId)}
                onMount={(editor, monaco) => handleEditorMount(editor as MonacoEditorInstance, monaco as MonacoApi)}
                onChange={handleJsonChange}
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on"
                }}
              />
            </>
          ) : (
            <button
              className="json-rail"
              type="button"
              onClick={() => {
                setJsonPanelOpen(true);
                setPendingJsonRevealPointer(selectedNode?.pointer ?? "");
              }}
            >
              <strong>JSON</strong>
              <span>{viewModel.diagnostics.length}</span>
              <small>{selectedNode?.pointer || "/"}</small>
            </button>
          )}
        </aside>

        <PropertyPanel
          node={selectedNode}
          open={propertyPanelOpen}
          properties={properties}
          diagnostics={viewModel.diagnostics}
          onChange={handlePropertyChange}
          onJsonChange={handlePropertyJsonChange}
          onGraphOperation={handleWritableGraphOperation}
          onCollapse={() => setPropertyPanelOpen(false)}
          onOpen={() => setPropertyPanelOpen(true)}
          onReveal={(pointer) => {
            setJsonPanelOpen(true);
            setPendingJsonRevealPointer(pointer);
            revealJsonPointer(pointer);
          }}
          selectedValue={selectedValue}
          targetNodes={graphTargetNodes}
        />
      </section>

      <footer className="diagnostics-strip" aria-label="Diagnostics">
        <strong>Diagnostics</strong>
        <PluginDiagnosticsJournal diagnostics={pluginDiagnostics} onSelectDiagnostic={handleDiagnosticClick} />
        {aiDiffSummary.length > 0 ? (
          <span className="ai-diff-summary" title={aiDiffSummary.map((item) => item.description).join("\n")}>
            AI {aiApplyState}: {aiDiffSummary.slice(0, 2).map((item) => humanizeDiffSummaryItem(item, viewModel.fullNodes)).join("; ")}
            {aiDiffSummary.length > 2 ? `; +${aiDiffSummary.length - 2} more` : ""}
          </span>
        ) : null}
        {viewModel.diagnostics.length === 0 ? (
          <span className="diagnostic diagnostic-info">No blocking diagnostics</span>
        ) : (
          viewModel.diagnostics.map((diagnostic, index) => (
            <button
              className={`diagnostic diagnostic-${diagnostic.severity}`}
              key={`${diagnostic.source}-${diagnostic.pointer}-${diagnostic.message}-${index}`}
              type="button"
              onClick={() => handleDiagnosticClick(diagnostic)}
              title={`${diagnostic.source} ${diagnostic.label}: ${diagnostic.message}`}
            >
              <span>{diagnostic.source}</span>
              <strong>{diagnostic.label}</strong>
              {diagnostic.message}
            </button>
          ))
        )}
      </footer>
    </main>
  );
}

function PropertyPanel({
  node,
  open,
  selectedValue,
  properties,
  diagnostics,
  targetNodes,
  onChange,
  onJsonChange,
  onGraphOperation,
  onCollapse,
  onOpen,
  onReveal
}: {
  node: EditorViewNode | undefined;
  open: boolean;
  selectedValue: JsonValue | undefined;
  properties: readonly EditorProperty[];
  diagnostics: readonly RoutedEditorDiagnostic[];
  targetNodes: readonly EditorViewNode[];
  onChange: (property: EditorProperty, rawValue: string) => void;
  onJsonChange: (property: EditorProperty, rawJson: string) => void;
  onGraphOperation: (operation: WritableGraphOperation) => void;
  onCollapse: () => void;
  onOpen: () => void;
  onReveal: (pointer: string) => void;
}) {
  const isCollection = Array.isArray(selectedValue) || isPlainJsonObject(selectedValue);
  const isReferenceField = typeof selectedValue === "string" || selectedValue === null;
  const defaultAddJson = formatPropertyJson(safeDefaultCollectionValue(selectedValue));

  if (!open) {
    return (
      <aside className="property-rail" aria-label="Selected node properties">
        <button type="button" onClick={onOpen}>
          <strong>Properties</strong>
          <span>{node?.semanticTitle ?? "No selection"}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="property-panel" aria-label="Selected node properties">
      <div className="panel-heading">
        <strong>Properties</strong>
        <span>{node?.semanticRole ?? "No selection"}</span>
        <button type="button" onClick={onCollapse}>
          Collapse
        </button>
      </div>
      {node ? (
        <button className="selection-summary" type="button" onClick={() => onReveal(node.pointer)}>
          <span>{node.pointer || "/"}</span>
          <strong>{node.semanticTitle}</strong>
          <p>{node.semanticSummary}</p>
        </button>
      ) : null}
      <div className="property-list">
        {properties.length === 0 ? (
          <p className="empty-state">Select a JSON node with editable fields.</p>
        ) : (
          properties.map((property) => {
            const propertyDiagnostics = diagnostics.filter((diagnostic) => diagnostic.pointer === property.pointer);
            return (
              <PropertyField
                key={property.pointer}
                property={property}
                diagnostics={propertyDiagnostics}
                onChange={onChange}
                onJsonChange={onJsonChange}
                onReveal={onReveal}
              />
            );
          })
        )}
      </div>
      {node && node.role !== "property" ? (
        <GraphOperations
          node={node}
          selectedValue={selectedValue}
          isCollection={isCollection}
          isReferenceField={isReferenceField}
          defaultAddJson={defaultAddJson}
          targetNodes={targetNodes}
          onGraphOperation={onGraphOperation}
          onReveal={onReveal}
        />
      ) : null}
    </aside>
  );
}

function PropertyField({
  property,
  diagnostics,
  onChange,
  onJsonChange,
  onReveal
}: {
  property: EditorProperty;
  diagnostics: readonly RoutedEditorDiagnostic[];
  onChange: (property: EditorProperty, rawValue: string) => void;
  onJsonChange: (property: EditorProperty, rawJson: string) => void;
  onReveal: (pointer: string) => void;
}) {
  const [draftJson, setDraftJson] = useState(() => formatPropertyJson(property.value));

  useEffect(() => {
    setDraftJson(formatPropertyJson(property.value));
  }, [property.pointer, property.value]);

  const complexValue = property.valueType === "array" || property.valueType === "object" || property.valueType === "null";

  return (
    <label className="property-field">
      <span>{property.label}</span>
      {property.enumValues !== undefined && typeof property.value === "string" ? (
        <select
          value={property.value}
          disabled={!property.editable}
          onFocus={() => onReveal(property.pointer)}
          onChange={(event) => onChange(property, event.target.value)}
        >
          {property.enumValues.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      ) : property.valueType === "boolean" ? (
        <input
          type="checkbox"
          checked={property.value === true}
          disabled={!property.editable}
          onFocus={() => onReveal(property.pointer)}
          onChange={(event) => onChange(property, event.target.checked ? "true" : "false")}
        />
      ) : property.valueType === "number" ? (
        <input
          type="number"
          value={String(property.value)}
          disabled={!property.editable}
          onFocus={() => onReveal(property.pointer)}
          onChange={(event) => onChange(property, event.target.value)}
        />
      ) : complexValue ? (
        <div className="json-value-editor">
          <textarea
            value={draftJson}
            disabled={!property.editable}
            rows={Math.min(8, Math.max(3, draftJson.split("\n").length))}
            onFocus={() => onReveal(property.pointer)}
            onChange={(event) => setDraftJson(event.target.value)}
          />
          <button type="button" disabled={!property.editable} onClick={() => onJsonChange(property, draftJson)}>
            Apply JSON
          </button>
        </div>
      ) : (
        <input
          value={String(property.value)}
          disabled={!property.editable}
          onFocus={() => onReveal(property.pointer)}
          onChange={(event) => onChange(property, event.target.value)}
        />
      )}
      <button className="open-json-button" type="button" onClick={() => onReveal(property.pointer)}>
        Open in JSON
      </button>
      {diagnostics.map((diagnostic) => (
        <small className={`property-diagnostic property-diagnostic-${diagnostic.severity}`} key={diagnostic.message}>
          {diagnostic.source}: {diagnostic.message}
        </small>
      ))}
    </label>
  );
}

function GraphOperations({
  node,
  selectedValue,
  isCollection,
  isReferenceField,
  defaultAddJson,
  targetNodes,
  onGraphOperation,
  onReveal
}: {
  node: EditorViewNode;
  selectedValue: JsonValue | undefined;
  isCollection: boolean;
  isReferenceField: boolean;
  defaultAddJson: string;
  targetNodes: readonly EditorViewNode[];
  onGraphOperation: (operation: WritableGraphOperation) => void;
  onReveal: (pointer: string) => void;
}) {
  const [itemKey, setItemKey] = useState("");
  const [itemJson, setItemJson] = useState(defaultAddJson);
  const [targetPointer, setTargetPointer] = useState(firstConnectableTargetPointer(targetNodes));

  useEffect(() => {
    setItemJson(defaultAddJson);
  }, [defaultAddJson, node.pointer]);

  useEffect(() => {
    setTargetPointer(firstConnectableTargetPointer(targetNodes));
  }, [targetNodes]);

  return (
    <section className="graph-operations" aria-label="Graph operations">
      <div className="panel-heading">
        <strong>Graph</strong>
        <button type="button" onClick={() => onReveal(node.pointer)}>
          Open in JSON
        </button>
      </div>

      {isCollection ? (
        <div className="graph-operation-block">
          <span>Add collection item</span>
          {isPlainJsonObject(selectedValue) ? (
            <input value={itemKey} placeholder="item key" onChange={(event) => setItemKey(event.target.value)} />
          ) : null}
          <textarea rows={4} value={itemJson} onChange={(event) => setItemJson(event.target.value)} />
          <button
            type="button"
            onClick={() =>
              onGraphOperation({
                type: "addCollectionItem",
                collectionPointer: node.pointer,
                key: itemKey,
                rawJson: itemJson
              })
            }
          >
            Add
          </button>
        </div>
      ) : null}

      {node.pointer !== "" ? (
        <button
          className="danger-button"
          type="button"
          onClick={() => onGraphOperation({ type: "removeCollectionItem", itemPointer: node.pointer })}
        >
          Remove selected
        </button>
      ) : null}

      {isReferenceField ? (
        <div className="graph-operation-block">
          <span>Reference</span>
          <select value={targetPointer} onChange={(event) => setTargetPointer(event.target.value)}>
            {targetNodes.map((target) => (
              <option value={target.pointer} key={target.id}>
                {target.pointer || "/"} · {target.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={targetPointer === ""}
            onClick={() =>
              onGraphOperation({
                type: "connectReference",
                referencePointer: node.pointer,
                targetPointer
              })
            }
          >
            Connect
          </button>
          {typeof selectedValue === "string" && isLocalReferenceValue(selectedValue) ? (
            <button
              type="button"
              onClick={() =>
                onGraphOperation({
                  type: "disconnectReference",
                  referencePointer: node.pointer
                })
              }
            >
              Disconnect
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function buildAiPatchTargetContexts(
  entities: readonly PreviewEntityDescriptor[],
  gameId: string,
  activeFilePath: string,
  document: JsonValue
): readonly {
  readonly filePath: string;
  readonly pointer: string;
  readonly label?: string;
  readonly value: JsonValue;
}[] {
  const seen = new Set<string>();
  const targets: {
    readonly filePath: string;
    readonly pointer: string;
    readonly label?: string;
    readonly value: JsonValue;
  }[] = [];

  for (const entity of entities) {
    const sourceFile = typeof entity.metadata?.sourceFile === "string" ? entity.metadata.sourceFile : undefined;
    const sourceFilePath = sourceFile === undefined ? activeFilePath : toRepositoryAuthoringFilePath(sourceFile, gameId);
    if (sourceFilePath !== undefined && sourceFilePath !== activeFilePath) {
      continue;
    }

    const key = `${activeFilePath}\u001f${entity.authoringPointer}`;
    if (seen.has(key)) {
      continue;
    }

    const value = readJsonPointer(document, entity.authoringPointer);
    if (value === undefined) {
      continue;
    }

    seen.add(key);
    targets.push({
      filePath: activeFilePath,
      pointer: entity.authoringPointer,
      label: entity.label,
      value
    });
  }

  return targets;
}

async function fetchAuthoringList(gameId: string | null, sessionId?: string): Promise<AuthoringListResult> {
  const params = new URLSearchParams();
  if (gameId !== null && gameId !== "") {
    params.set("gameId", gameId);
  }
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }

  const response = await fetch(`/api/editor/files?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `File list failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AuthoringListResult;
}

async function createEditorSession(gameId: string | null): Promise<EditorSessionListResult> {
  const response = await fetch("/api/editor/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Session open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorSessionListResult;
}

async function requestAiChangeSet(
  intent: EditorPatchIntent,
  targets: readonly {
    readonly filePath: string;
    readonly pointer: string;
    readonly label?: string;
    readonly value: JsonValue;
  }[]
): Promise<AiPatchPlanResponse> {
  const response = await fetch("/api/editor/ai/patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent, targets })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `AI patch planner failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AiPatchPlanResponse;
}

async function fetchAuthoringFile(gameId: string, filePath: string, sessionId?: string): Promise<AuthoringFileDocument> {
  const params = new URLSearchParams({ gameId, filePath });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/file?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `File open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AuthoringFileDocument;
}

async function fetchEditorLayout(gameId: string, filePath: string, sessionId?: string): Promise<EditorLayoutDocument> {
  const params = new URLSearchParams({ gameId, filePath });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/layout?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Layout open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorLayoutDocument;
}

async function saveEditorLayout(
  gameId: string,
  filePath: string,
  layout: EditorLayoutDocumentBody,
  versionHash: string | undefined,
  sessionId?: string
): Promise<EditorLayoutDocument> {
  const response = await fetch("/api/editor/layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId,
      filePath,
      layout,
      versionHash,
      sessionId
    })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `Layout save failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorLayoutDocument;
}

async function postEditorWorkflow(path: string, body: Record<string, unknown>): Promise<EditorWorkflowResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `${path} failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorWorkflowResponse;
}

function filterServerOnlyDiagnostics(diagnostics: readonly RoutedEditorDiagnostic[]): readonly RoutedEditorDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.source !== "syntax" && diagnostic.source !== "schema" && diagnostic.source !== "semantic"
  );
}

function diagnosticsFromPluginValidation(
  pluginValidation: EditorPluginValidationResult | undefined
): readonly RoutedEditorDiagnostic[] {
  return pluginValidation?.diagnostics ?? [];
}

function pluginDiagnosticsFromWorkflowResponse(result: EditorWorkflowResponse): readonly RoutedEditorDiagnostic[] {
  return result.pluginValidation?.diagnostics ?? (result.diagnostics ?? []).filter(isPluginDiagnostic);
}

function isPluginDiagnostic(diagnostic: RoutedEditorDiagnostic): boolean {
  return diagnostic.source === "plugin-schema" || diagnostic.source === "plugin-validation";
}

function humanizeDiffSummaryItem(item: EditorDiffSummaryItem, nodes: readonly EditorViewNode[]): string {
  const node = findNodeForPointer(nodes, item.pointer);
  const label = node?.semanticTitle ?? (item.pointer || "/");
  if (item.operation === "add") {
    return `added ${label}`;
  }

  if (item.operation === "remove") {
    return `removed ${label}`;
  }

  return `changed ${label}`;
}

function getNodePosition(depthX: number, slot: number): { x: number; y: number } {
  const column = Math.floor(slot / semanticNodeRowsPerColumn);
  const row = slot % semanticNodeRowsPerColumn;
  return {
    x: depthX + column * semanticNodeColumnSpacing,
    y: row * semanticNodeRowSpacing
  };
}

function getNodeDepth(node: EditorViewNode): number {
  return node.pointer === "" ? 0 : node.pointer.split("/").length - 1;
}

function createEmptyEditorLayout(): EditorLayoutDocumentBody {
  return {
    version: 1,
    nodes: {}
  };
}

function positionsFromLayout(layout: EditorLayoutDocumentBody): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  for (const [nodeId, node] of Object.entries(layout.nodes)) {
    if (node.position !== undefined) {
      positions.set(nodeId, node.position);
    }
  }

  return positions;
}

function configureMonacoJson(monaco: MonacoApi, modelUri: string, schemaId: string | undefined) {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    schemas: localAuthoringSchemas.map((item) => ({
      uri: item.uri,
      fileMatch: item.uri === schemaId ? [modelUri] : [],
      schema: item.schema
    }))
  });
}

function toMonacoModelUri(document: CurrentDocument): string {
  if (document.source === "embedded") {
    return `file:///cubica/editor/${embeddedFilePath}`;
  }

  return `file:///cubica/games/${encodeURIComponent(document.gameId)}/authoring/${document.filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function toMonacoMarker(monaco: MonacoApi, model: MonacoModel, diagnostic: RoutedEditorDiagnostic): MonacoMarker {
  const range = diagnostic.range === undefined ? fallbackMarkerRange(model) : toMonacoRange(diagnostic.range);

  return {
    ...range,
    severity: diagnostic.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `${diagnostic.label}: ${diagnostic.message}`,
    source: diagnostic.source
  };
}

function toMonacoRange(range: TextRange): MonacoRange {
  return {
    startLineNumber: range.start.line,
    startColumn: range.start.column,
    endLineNumber: range.end.line,
    endColumn: Math.max(range.end.column, range.start.column + 1)
  };
}

function fallbackMarkerRange(model: MonacoModel): MonacoRange {
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: Math.max(2, model.getLineMaxColumn(1))
  };
}

function upsertRuntimeSnapshotInTrace(
  trace: PreviewPlaythroughTrace,
  message: PlayerPreviewSessionSnapshotMessage
): PreviewPlaythroughTrace {
  const sequence = message.sessionVersion.lastEventSequence;
  const action = message.action;
  const baseTrace = createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId ?? message.gameId,
    events: trace.events.filter((event) => event.sequence !== sequence),
    snapshots: trace.snapshots.filter((snapshot) => snapshot.eventSequence !== sequence)
  });

  return appendPreviewPlaythroughEvent(
    baseTrace,
    {
      id: `runtime:${message.sessionId}:${sequence}`,
      sequence,
      timestamp: action?.timestamp ?? new Date().toISOString(),
      kind: action === undefined ? "system" : "action",
      label: action?.actionId ?? (sequence === 0 ? "Initial runtime state" : `Runtime state ${sequence}`),
      payload: {
        sessionId: message.sessionId,
        sessionVersion: {
          stateVersion: message.sessionVersion.stateVersion,
          lastEventSequence: message.sessionVersion.lastEventSequence
        },
        action: action === undefined
          ? undefined
          : {
              actionId: action.actionId,
              payload: action.payload ?? {},
              timestamp: action.timestamp
            }
      } as unknown as JsonValue
    },
    message.state as unknown as JsonValue
  );
}

function truncatePreviewTrace(trace: PreviewPlaythroughTrace, targetSequence: number): PreviewPlaythroughTrace {
  return createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId,
    events: trace.events.filter((event) => event.sequence <= targetSequence),
    snapshots: trace.snapshots.filter((snapshot) => snapshot.eventSequence <= targetSequence)
  });
}

function readRuntimeEventVersion(
  trace: PreviewPlaythroughTrace,
  targetSequence: number
): { readonly stateVersion: number; readonly lastEventSequence: number } | undefined {
  const payload = trace.events.find((event) => event.sequence === targetSequence)?.payload;
  if (!isPlainJsonObject(payload)) {
    return undefined;
  }

  const sessionVersion = payload.sessionVersion;
  if (!isPlainJsonObject(sessionVersion)) {
    return undefined;
  }

  const stateVersion = sessionVersion.stateVersion;
  const lastEventSequence = sessionVersion.lastEventSequence;
  if (
    typeof stateVersion !== "number" ||
    typeof lastEventSequence !== "number" ||
    !Number.isSafeInteger(stateVersion) ||
    !Number.isSafeInteger(lastEventSequence) ||
    stateVersion < 0 ||
    lastEventSequence < 0
  ) {
    return undefined;
  }

  return { stateVersion, lastEventSequence };
}

function readSessionIdFromPreviewUrl(value: string): string | undefined {
  try {
    return new URL(value).searchParams.get("sessionId") ?? undefined;
  } catch {
    return undefined;
  }
}

function addPreviewReloadNonce(value: string, targetSequence: number): string {
  try {
    const url = new URL(value);
    url.searchParams.set("restoreSequence", String(targetSequence));
    url.searchParams.set("restoreNonce", String(Date.now()));
    return url.toString();
  } catch {
    return value;
  }
}

function safeUrlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function toRepositoryAuthoringFilePath(sourceFile: string, gameId: string): string | undefined {
  const normalized = sourceFile.replaceAll("\\", "/");
  const marker = `games/${gameId}/authoring/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  return normalized.slice(markerIndex + marker.length);
}

function findNodeForPointer(nodes: readonly EditorViewNode[], pointer: string): EditorViewNode | undefined {
  let current: string | undefined = pointer;

  while (current !== undefined) {
    const node = nodes.find((candidate) => candidate.pointer === current);
    if (node !== undefined) {
      return node;
    }

    current = parentPointer(current);
  }

  return undefined;
}

function parentPointer(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }

  const lastSlashIndex = pointer.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "" : pointer.slice(0, lastSlashIndex);
}

function isPlainJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstConnectableTargetPointer(nodes: readonly EditorViewNode[]): string {
  return nodes.find((node) => node.pointer !== "")?.pointer ?? nodes[0]?.pointer ?? "";
}

function summarizeNonVisualEntities(nodes: readonly EditorViewNode[]): readonly { readonly role: string; readonly count: number }[] {
  const targetRoles: readonly EditorViewNode["semanticRole"][] = ["action", "condition", "state", "metric", "asset", "reference"];
  return targetRoles
    .map((role) => ({
      role,
      count: nodes.filter((node) => node.semanticRole === role).length
    }))
    .filter((item) => item.count > 0);
}

function getSyncLabel(input: {
  readonly loadState: "loading" | "ready" | "fallback" | "error";
  readonly saveState: "idle" | "saving" | "saved" | "error" | "conflict";
  readonly isDirty: boolean;
  readonly hasBlockingDiagnostics: boolean;
  readonly currentDocument: CurrentDocument;
  readonly statusMessage: string;
}): string {
  if (input.loadState === "loading") {
    return "Loading";
  }

  if (input.loadState === "fallback") {
    return "Sample fallback";
  }

  if (input.saveState === "saving") {
    return "Saving";
  }

  if (input.saveState === "conflict") {
    return "Conflict";
  }

  if (input.saveState === "error" || input.loadState === "error") {
    return "Error";
  }

  if (input.hasBlockingDiagnostics) {
    return "Blocked";
  }

  if (input.isDirty) {
    return "Dirty";
  }

  if (input.saveState === "saved") {
    return "Saved";
  }

  return input.currentDocument.source === "repository" ? "Clean" : input.statusMessage;
}
