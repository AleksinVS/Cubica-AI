/**
 * Thin view adapter over @cubica/editor-engine.
 *
 * The core package stays framework-free. This adapter converts its neutral
 * document snapshot and graph projection into shapes convenient for React UI.
 */
import {
  applyJsonPatch,
  buildAuthoringGraphProjection,
  buildEntityTreeViewModel,
  buildManifestChronologyTimeline,
  buildVisibleAuthoringGraphProjection,
  buildTreeViewModel,
  createDocumentStore,
  createEditorEntityProjectionState,
  parseJsonPointer,
  readJsonPointer,
  reverseProjectIntent,
  updateEditorEntityProjection,
  validateDocument,
  type AuthoringGraphEdge,
  type AuthoringGraphExpansionState,
  type AuthoringGraphNode,
  type BuildEditorEntityProjectionInput,
  type ChangedPointersByFile,
  type DiagnosticSeverity,
  type DocumentDiagnostic,
  type DocumentSnapshot,
  type EditorEntityProjection,
  type EditorEntityProjectionDocument,
  type EditorEntityProjectionState,
  type IncrementalProjectionReport,
  type JsonPatchOperation,
  type SchemaRegistry,
  type JsonValue,
  type ManifestTimeline,
  type TextRange,
  type TreeViewModel,
  type TreeViewNode
} from "@cubica/editor-engine";

export type EditorViewNode = AuthoringGraphNode;
export type EditorViewEdge = AuthoringGraphEdge;

export interface EditorViewModel {
  readonly snapshot: DocumentSnapshot;
  /**
   * Canonical engine diagnostics in DocumentDiagnostic form.
   *
   * UI layers use this to attach badges to tree nodes and to keep Monaco
   * markers consistent with ADR-034 selection sync.
   */
  readonly documentDiagnostics: readonly DocumentDiagnostic[];
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
  /**
   * ADR-052 project-level entity projection.
   *
   * It is read-only editor context: runtime/player/compiler never consume it,
   * and all durable edits still go through EditorChangeSet.
   */
  readonly editorEntityProjection: EditorEntityProjection;
  /**
   * The projection paired with the input that produced it (ADR-057 §4.13,
   * Phase 2.1). Callers pass it back as `incremental.previousState` on the next
   * build so `updateEditorEntityProjection` can reuse untouched entity records
   * instead of rebuilding the whole projection. Additive: consumers that only
   * read `editorEntityProjection` are unaffected.
   */
  readonly projectionState: EditorEntityProjectionState;
  /**
   * Telemetry for how `editorEntityProjection` was produced (design-spec §5).
   *
   * `undefined` when the projection was built from scratch (no `incremental`
   * option). Present with `mode: "incremental"` when the fast path was taken and
   * `mode: "full"` when the updater fell back to a full rebuild.
   */
  readonly incrementalReport?: IncrementalProjectionReport;
  /** Default semantic entity tree model derived from the same authoring snapshot. */
  readonly tree: TreeViewModel;
  /** Advanced pointer-complete JSON tree for technical debugging. */
  readonly jsonTree: TreeViewModel;
  readonly timeline: ManifestTimeline;
  readonly fullNodes: readonly EditorViewNode[];
  readonly fullEdges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly role: EditorViewEdge["role"];
  }[];
  readonly nodes: readonly EditorViewNode[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly role: EditorViewEdge["role"];
  }[];
}

export interface RoutedEditorDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly source: string;
  readonly pointer: string;
  readonly label: string;
  readonly message: string;
  readonly range: TextRange | undefined;
  readonly filePath?: string;
  readonly generatedFile?: string;
  readonly generatedPointer?: string;
}

export type EditorTreeViewModel = TreeViewModel;
export type EditorTreeViewNode = TreeViewNode;

/**
 * Result of applying a single authoring edit through reverse projection.
 *
 * `operations` is the exact set of JSON Patch operations that were applied
 * (empty when the edit was rejected). Their `path`s are the authoritative
 * "changed pointers" the controller feeds into the incremental projection
 * updater (ADR-057 §4.13, Phase 2.1); reporting them from the operations that
 * really ran keeps the incremental input complete, never under-reported.
 */
export interface EditorAuthoringEditResult {
  readonly text: string;
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
  readonly operations: readonly JsonPatchOperation[];
}

export interface EditorProperty {
  readonly pointer: string;
  readonly label: string;
  readonly value: JsonValue;
  readonly valueType: "array" | "object" | "string" | "number" | "boolean" | "null";
  readonly editable: boolean;
  readonly enumValues: readonly string[] | undefined;
}

const editableKeys = new Set(["name", "description", "title", "body", "displayName", "summary", "systemPrompt"]);
// Full schema-pointer resolution is intentionally left for a later UI schema
// enrichment slice; this first pass exposes generic editing and a few canonical
// enum hints that are stable across authoring documents.
const enumHintsByKey = new Map<string, readonly string[]>([
  ["_manifestType", ["game", "ui"]],
  ["severity", ["error", "warning"]]
]);

export function createEditorViewModel(
  text: string,
  options: {
    readonly filePath?: string;
    readonly schemaRegistry?: SchemaRegistry;
    readonly schemaId?: string;
    readonly extraDiagnostics?: readonly RoutedEditorDiagnostic[];
    readonly graphState?: AuthoringGraphExpansionState;
    readonly gameId?: string;
    readonly editorEntityProjectionDocuments?: readonly EditorEntityProjectionDocument[];
    /**
     * Optional incremental-projection context (ADR-057 §4.13, Phase 2.1).
     *
     * When present, the entity projection is produced by
     * `updateEditorEntityProjection(previousState, …)`, which itself decides
     * between the incremental fast path and a full rebuild. When absent, the
     * projection is built from scratch exactly as before. Either way the returned
     * projection is deeply equal to a full rebuild of the same input, so behaviour
     * is unchanged on any miss.
     */
    readonly incremental?: {
      readonly previousState: EditorEntityProjectionState;
      readonly changedPointersByFile: ChangedPointersByFile;
    };
    /**
     * Optional warm-start hydration (ADR-057 §4.13, Phase 2.2b). When present, the
     * entity projection is taken AS-IS from this already-built value (revived from
     * the Level-2 disk cache) instead of being built or incrementally updated —
     * option (a) of the slice brief: "проекция берётся как есть без update-вызова".
     * It is paired with the input this build would have produced, so the NEXT edit
     * diffs against it through the normal incremental path. The caller is
     * responsible for verifying the projection matches the current text before
     * passing it (a mismatch must simply omit this and rebuild). Ignored when
     * `incremental` is also supplied — a fresh open never has a pending edit.
     */
    readonly hydratedProjection?: EditorEntityProjection;
  } = {}
): EditorViewModel {
  const store = createDocumentStore({ filePath: options.filePath ?? "embedded-sample.game.authoring.json", text });
  const snapshot = store.snapshot();
  const fullProjection = buildAuthoringGraphProjection(snapshot);
  const visibleProjection = buildVisibleAuthoringGraphProjection(fullProjection, options.graphState);
  const baseDocumentDiagnostics = validateDocument(snapshot, {
    schemaRegistry: options.schemaRegistry,
    schemaId: options.schemaId,
    includeSemanticDiagnostics: true
  });
  const extraDocumentDiagnostics = (options.extraDiagnostics ?? []).map(toDocumentDiagnostic);
  const documentDiagnostics = [...baseDocumentDiagnostics, ...extraDocumentDiagnostics];
  const diagnostics = documentDiagnostics.map(toRoutedDiagnostic);
  const tree = buildEntityTreeViewModel({ snapshot, diagnostics: documentDiagnostics, graphProjection: fullProjection });
  const jsonTree = buildTreeViewModel({ snapshot, diagnostics: documentDiagnostics, graphProjection: fullProjection });
  const timeline = buildManifestChronologyTimeline({ snapshot });
  const { editorEntityProjection, projectionState, incrementalReport } = buildViewModelProjection(
    {
      gameId: options.gameId,
      documents: buildEditorEntityProjectionDocuments(snapshot, options.editorEntityProjectionDocuments)
    },
    options.incremental,
    options.hydratedProjection
  );

  return {
    snapshot,
    documentDiagnostics,
    diagnostics,
    editorEntityProjection,
    projectionState,
    incrementalReport,
    tree,
    jsonTree,
    timeline,
    fullNodes: fullProjection.nodes,
    fullEdges: fullProjection.edges.map(toEditorEdge),
    nodes: visibleProjection.nodes,
    edges: visibleProjection.edges.map(toEditorEdge)
  };
}

/**
 * Produces the entity projection for the view model, plus the state needed for
 * the NEXT incremental step and its telemetry (ADR-057 §4.13, Phase 2.1).
 *
 * Without an `incremental` context the projection is built from scratch (the
 * historical behaviour). With one, `updateEditorEntityProjection` decides between
 * the incremental fast path and a full rebuild; either result is deeply equal to
 * a full rebuild of the same input, so callers never observe a difference.
 */
function buildViewModelProjection(
  input: BuildEditorEntityProjectionInput,
  incremental:
    | { readonly previousState: EditorEntityProjectionState; readonly changedPointersByFile: ChangedPointersByFile }
    | undefined,
  hydratedProjection: EditorEntityProjection | undefined
): {
  readonly editorEntityProjection: EditorEntityProjection;
  readonly projectionState: EditorEntityProjectionState;
  readonly incrementalReport: IncrementalProjectionReport | undefined;
} {
  // Warm-start hydration (option a): substitute the revived projection directly
  // and pair it with this build's input so the NEXT edit diffs against it through
  // the normal incremental path. No build, no `updateEditorEntityProjection` call.
  if (hydratedProjection !== undefined) {
    return {
      editorEntityProjection: hydratedProjection,
      projectionState: { projection: hydratedProjection, input },
      incrementalReport: undefined
    };
  }

  if (incremental === undefined) {
    const projectionState = createEditorEntityProjectionState(input);
    return { editorEntityProjection: projectionState.projection, projectionState, incrementalReport: undefined };
  }

  const update = updateEditorEntityProjection(incremental.previousState, {
    input,
    changedPointersByFile: incremental.changedPointersByFile
  });
  return {
    editorEntityProjection: update.state.projection,
    projectionState: update.state,
    incrementalReport: update.report
  };
}

function buildEditorEntityProjectionDocuments(
  snapshot: DocumentSnapshot,
  extraDocuments: readonly EditorEntityProjectionDocument[] | undefined
): readonly EditorEntityProjectionDocument[] {
  const documentsByPath = new Map<string, EditorEntityProjectionDocument>();

  if (snapshot.json !== undefined) {
    documentsByPath.set(snapshot.filePath, {
      filePath: snapshot.filePath,
      json: snapshot.json
    });
  }

  for (const document of extraDocuments ?? []) {
    const activeDocument = documentsByPath.get(document.filePath);
    documentsByPath.set(
      document.filePath,
      activeDocument === undefined
        ? document
        : {
            ...document,
            json: activeDocument.json
          }
    );
  }

  return [...documentsByPath.values()];
}

function toEditorEdge(edge: AuthoringGraphEdge): EditorViewModel["edges"][number] {
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    role: edge.role
  };
}

export function getBranchRootNode(
  nodes: readonly EditorViewNode[],
  selectedNodeId: string | undefined
): EditorViewNode | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let current = selectedNodeId === undefined ? undefined : nodesById.get(selectedNodeId);

  while (current !== undefined && current.parentId !== undefined && current.parentId !== "$") {
    current = nodesById.get(current.parentId);
  }

  return current?.parentId === "$" ? current : undefined;
}

export function getNodeAncestorIds(nodes: readonly EditorViewNode[], nodeId: string | undefined): readonly string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const ancestors: string[] = [];
  let current = nodeId === undefined ? undefined : nodesById.get(nodeId);

  while (current !== undefined) {
    ancestors.unshift(current.id);
    current = current.parentId === undefined ? undefined : nodesById.get(current.parentId);
  }

  return ancestors;
}

export function findEditorNodeById(nodes: readonly EditorViewNode[], nodeId: string): EditorViewNode | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function findEditorNodeForPointer(nodes: readonly EditorViewNode[], pointer: string): EditorViewNode | undefined {
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

export function getVisibleGraphBudgetLabel(viewModel: EditorViewModel): string {
  const hiddenCount = Math.max(0, viewModel.fullNodes.length - viewModel.nodes.length);
  return hiddenCount === 0 ? `${viewModel.nodes.length} visible` : `${viewModel.nodes.length} visible · ${hiddenCount} hidden`;
}

function parentPointer(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }

  const segments = parseJsonPointer(pointer);
  return segments.length <= 1
    ? ""
    : `/${segments
        .slice(0, -1)
        .map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1"))
        .join("/")}`;
}

export function toRoutedDiagnostic(diagnostic: {
  readonly severity: DiagnosticSeverity;
  readonly source: string;
  readonly pointer: string;
  readonly message: string;
  readonly range?: RoutedEditorDiagnostic["range"];
  readonly filePath?: string;
  readonly generatedFile?: string;
  readonly generatedPointer?: string;
}): RoutedEditorDiagnostic {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    label: diagnostic.pointer === "" ? "/" : diagnostic.pointer,
    message: diagnostic.message,
    range: diagnostic.range,
    filePath: diagnostic.filePath,
    generatedFile: diagnostic.generatedFile,
    generatedPointer: diagnostic.generatedPointer
  };
}

function toDocumentDiagnostic(diagnostic: RoutedEditorDiagnostic): DocumentDiagnostic {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    pointer: diagnostic.pointer,
    range: diagnostic.range
  };
}

export function findTreeNodeForPointer(tree: EditorTreeViewModel, pointer: string): EditorTreeViewNode | undefined {
  let current: string | undefined = pointer;

  while (current !== undefined) {
    const node = tree.nodeByPointer.get(current);
    if (node !== undefined) {
      return node;
    }

    current = parentPointer(current);
  }

  return undefined;
}

export function selectProperties(snapshot: DocumentSnapshot, pointer: string): readonly EditorProperty[] {
  if (snapshot.json === undefined) {
    return [];
  }

  const selected = readJsonPointer(snapshot.json, pointer);
  if (selected !== undefined && (isScalar(selected) || selected === null)) {
    return [
      {
        pointer,
        label: lastPointerLabel(pointer) ?? "value",
        value: selected,
        valueType: getJsonValueType(selected),
        editable: pointer !== "",
        enumValues: enumHintsByKey.get(lastPointerLabel(pointer) ?? "")
      }
    ];
  }

  if (Array.isArray(selected)) {
    return selected.map((value, index) => ({
      pointer: joinPointer(pointer, String(index)),
      label: `[${index}]`,
      value,
      valueType: getJsonValueType(value),
      editable: true,
      enumValues: undefined
    }));
  }

  if (!isJsonObject(selected)) {
    return [];
  }

  return Object.entries(selected)
    .map(([key, value]) => ({
      pointer: joinPointer(pointer, key),
      label: key,
      value,
      valueType: getJsonValueType(value),
      editable: editableKeys.has(key) || isScalar(value) || value === null || Array.isArray(value) || isJsonObject(value),
      enumValues: enumHintsByKey.get(key)
    }));
}

export function applyPropertyEdit(snapshot: DocumentSnapshot, pointer: string, value: JsonValue): string {
  return applyPropertyEditResult(snapshot, pointer, value).text;
}

export function applyPropertyEditResult(
  snapshot: DocumentSnapshot,
  pointer: string,
  value: JsonValue
): EditorAuthoringEditResult {
  const result = reverseProjectIntent(snapshot, { type: "setValue", pointer, value });
  if (snapshot.json === undefined) {
    return { text: snapshot.text, diagnostics: [], operations: [] };
  }

  if (result.target !== "authoring") {
    return { text: snapshot.text, diagnostics: (result.diagnostics ?? []).map(toRoutedDiagnostic), operations: [] };
  }

  return {
    text: `${JSON.stringify(applyJsonPatch(snapshot.json, result.operations), null, 2)}\n`,
    diagnostics: (result.diagnostics ?? []).map(toRoutedDiagnostic),
    operations: result.operations
  };
}

export function applyJsonPropertyEditResult(
  snapshot: DocumentSnapshot,
  pointer: string,
  rawJson: string
): EditorAuthoringEditResult {
  try {
    return applyPropertyEditResult(snapshot, pointer, JSON.parse(rawJson) as JsonValue);
  } catch (error) {
    return {
      text: snapshot.text,
      diagnostics: [
        {
          severity: "error",
          source: "property-json",
          pointer,
          label: pointer === "" ? "/" : pointer,
          message: error instanceof Error ? error.message : "Invalid JSON value.",
          range: snapshot.locationMap.get(pointer)
        }
      ],
      operations: []
    };
  }
}

export type WritableGraphOperation =
  | {
      readonly type: "addCollectionItem";
      readonly collectionPointer: string;
      readonly key?: string;
      readonly rawJson?: string;
    }
  | {
      readonly type: "removeCollectionItem";
      readonly itemPointer: string;
    }
  | {
      readonly type: "connectReference";
      readonly referencePointer: string;
      readonly targetPointer: string;
    }
  | {
      readonly type: "disconnectReference";
      readonly referencePointer: string;
    };

export function applyWritableGraphOperation(
  snapshot: DocumentSnapshot,
  operation: WritableGraphOperation
): EditorAuthoringEditResult {
  if (snapshot.json === undefined) {
    return { text: snapshot.text, diagnostics: [], operations: [] };
  }

  const intent = toReverseProjectionIntent(snapshot, operation);
  if (intent === undefined) {
    return {
      text: snapshot.text,
      diagnostics: [
        {
          severity: "error",
          source: "reverse-projection",
          pointer: operation.type === "addCollectionItem" ? operation.collectionPointer : operation.type === "removeCollectionItem" ? operation.itemPointer : operation.referencePointer,
          label: operation.type === "addCollectionItem" ? operation.collectionPointer : operation.type === "removeCollectionItem" ? operation.itemPointer : operation.referencePointer,
          message: "The selected value is not compatible with this graph operation.",
          range: undefined
        }
      ],
      operations: []
    };
  }

  const result = reverseProjectIntent(snapshot, intent);
  if (result.target !== "authoring") {
    return { text: snapshot.text, diagnostics: (result.diagnostics ?? []).map(toRoutedDiagnostic), operations: [] };
  }

  return {
    text: `${JSON.stringify(applyJsonPatch(snapshot.json, result.operations), null, 2)}\n`,
    diagnostics: (result.diagnostics ?? []).map(toRoutedDiagnostic),
    operations: result.operations
  };
}

export function coercePropertyValue(currentValue: JsonValue, rawValue: string): JsonValue {
  if (typeof currentValue === "number") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : currentValue;
  }

  if (typeof currentValue === "boolean") {
    return rawValue === "true";
  }

  return rawValue;
}

export function formatPropertyJson(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

export function safeDefaultCollectionValue(collectionValue: JsonValue | undefined): JsonValue {
  if (Array.isArray(collectionValue) && collectionValue.length > 0) {
    return defaultValueFromPeer(collectionValue[collectionValue.length - 1]);
  }

  if (isJsonObject(collectionValue)) {
    const firstObject = Object.values(collectionValue).find((value) => isJsonObject(value));
    return firstObject === undefined ? {} : defaultValueFromPeer(firstObject);
  }

  return {};
}

export function isLocalReferenceValue(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.startsWith("#/");
}

export function localReferenceToPointer(value: string): string | undefined {
  return value.startsWith("#/") ? value.slice(1) : undefined;
}

function joinPointer(parent: string, key: string): string {
  const encodedKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return parent === "" ? `/${encodedKey}` : `${parent}/${encodedKey}`;
}

function toReverseProjectionIntent(snapshot: DocumentSnapshot, operation: WritableGraphOperation) {
  switch (operation.type) {
    case "addCollectionItem": {
      const collection = readJsonPointer(snapshot.json as JsonValue, operation.collectionPointer);
      const key = operation.key?.trim();
      let value: JsonValue;
      try {
        value = operation.rawJson === undefined || operation.rawJson.trim() === "" ? safeDefaultCollectionValue(collection) : (JSON.parse(operation.rawJson) as JsonValue);
      } catch {
        return undefined;
      }

      return {
        type: "addCollectionItem" as const,
        collectionPointer: operation.collectionPointer,
        key: isJsonObject(collection) ? key : undefined,
        value
      };
    }
    case "removeCollectionItem":
      return {
        type: "removeCollectionItem" as const,
        itemPointer: operation.itemPointer
      };
    case "connectReference":
      return {
        type: "connectReference" as const,
        referencePointer: operation.referencePointer,
        targetPointer: operation.targetPointer
      };
    case "disconnectReference":
      return {
        type: "disconnectReference" as const,
        referencePointer: operation.referencePointer
      };
  }
}

function defaultValueFromPeer(value: JsonValue | undefined): JsonValue {
  if (Array.isArray(value)) {
    return [];
  }

  if (isJsonObject(value)) {
    const next: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string") {
        next[key] = "";
      } else if (isScalar(child) || child === null) {
        next[key] = defaultScalarValue(child);
      }
    }

    return next;
  }

  return defaultScalarValue(value);
}

function defaultScalarValue(value: JsonValue | undefined): JsonValue {
  switch (typeof value) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function getJsonValueType(value: JsonValue): EditorProperty["valueType"] {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "object") {
    return "object";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "null";
}

function lastPointerLabel(pointer: string): string | undefined {
  const segments = parseJsonPointer(pointer);
  const last = segments[segments.length - 1];
  if (last === undefined) {
    return undefined;
  }

  return Number.isInteger(Number(last)) && String(Number(last)) === last ? `[${last}]` : last;
}

function isScalar(value: JsonValue): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
