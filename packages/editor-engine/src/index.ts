/**
 * Framework-agnostic editor primitives for ADR-034.
 *
 * This package treats authoring files as plain JSON documents. UI layers may
 * render graphs, inspectors, or text editors, but all edits return to the same
 * JSON Patch path so the package stays independent from React, Monaco, games,
 * and runtime-specific manifest shapes.
 */
import AjvModule, { type AnySchema, type ErrorObject, type Options as AjvOptions } from "ajv";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonSchema = AnySchema;

export type JsonPatchOperation =
  | { readonly op: "add"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "replace"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: JsonValue };

export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticSource = "syntax" | "schema" | "semantic" | "reverse-projection" | string;

export interface TextPosition {
  /** One-based text line for editor integrations. */
  readonly line: number;
  /** One-based UTF-16 column inside the line. */
  readonly column: number;
  /** Zero-based absolute UTF-16 offset in the JSON text. */
  readonly offset: number;
}

export interface TextRange {
  /** Inclusive start of the token or syntactic node. */
  readonly start: TextPosition;
  /** Exclusive end of the token or syntactic node. */
  readonly end: TextPosition;
}

export interface DocumentDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: DiagnosticSource;
  readonly pointer: string;
  readonly range?: TextRange;
  /** Backward-compatible shortcut for consumers that only need a marker point. */
  readonly line?: number;
  /** Backward-compatible shortcut for consumers that only need a marker point. */
  readonly column?: number;
}

export type TextLocationTarget = "value" | "key";

export interface TextLocationEntry {
  readonly pointer: string;
  readonly value: TextRange;
  readonly key?: TextRange;
}

/**
 * Maps JSON Pointer paths to source text ranges.
 *
 * `get(pointer)` keeps the original API and returns the value range. Consumers
 * that need property-name highlighting can pass `key` or read the full entry.
 */
export interface TextLocationMap {
  get(pointer: string, target?: TextLocationTarget): TextRange | undefined;
  getEntry(pointer: string): TextLocationEntry | undefined;
  entries(): readonly TextLocationEntry[];
}

export interface DocumentSnapshot {
  readonly filePath: string;
  readonly text: string;
  readonly json: JsonValue | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly selectedPointer: string | undefined;
  readonly locationMap: TextLocationMap;
}

export interface DocumentStore {
  snapshot(): DocumentSnapshot;
  applyPatch(operations: readonly JsonPatchOperation[]): DocumentSnapshot;
  selectPointer(pointer: string | undefined): DocumentSnapshot;
}

/**
 * User-facing edit request captured by the editor before an AI agent or local
 * planner turns it into bounded file operations.
 */
export interface EditorPatchIntent {
  readonly id: string;
  readonly kind: "preview-prompt" | "property-prompt" | "manual" | string;
  readonly prompt: string;
  readonly activeFilePath: string;
  readonly targetPointers: readonly string[];
  readonly createdAt: string;
  readonly selectionKind?: "entity" | "region" | "document" | string;
}

export interface EditorChangeSetJsonPatch {
  readonly filePath: string;
  readonly operations: readonly JsonPatchOperation[];
}

export interface EditorChangeSetTextPatch {
  readonly filePath: string;
  readonly description: string;
  readonly beforeText?: string;
  readonly afterText?: string;
}

export interface EditorChangeSetFileCreate {
  readonly filePath: string;
  readonly text: string;
}

export interface EditorChangeSetFileDelete {
  readonly filePath: string;
  readonly previousText?: string;
}

export interface EditorChangeSetFileRename {
  readonly fromFilePath: string;
  readonly toFilePath: string;
}

/**
 * Bounded editor mutation produced by an AI planner.
 *
 * Phase 8 applies JSON patches to the active authoring document. Text and file
 * operations are present in the contract so Phase 9 can cover project plugins
 * without changing the public shape again.
 */
export interface EditorChangeSet {
  readonly id: string;
  readonly intentId?: string;
  readonly summary: string;
  readonly jsonPatches: readonly EditorChangeSetJsonPatch[];
  readonly textPatches?: readonly EditorChangeSetTextPatch[];
  readonly fileCreates?: readonly EditorChangeSetFileCreate[];
  readonly fileDeletes?: readonly EditorChangeSetFileDelete[];
  readonly fileRenames?: readonly EditorChangeSetFileRename[];
}

export interface EditorDiffSummaryItem {
  readonly filePath: string;
  readonly pointer: string;
  readonly operation: JsonPatchOperation["op"];
  readonly before: JsonValue | undefined;
  readonly after: JsonValue | undefined;
  readonly description: string;
}

export interface PatchJournalStep {
  readonly id: string;
  readonly createdAt: string;
  readonly intent: EditorPatchIntent;
  readonly summary: string;
  readonly affectedFiles: readonly string[];
  readonly forward: EditorChangeSet;
  readonly inverse: EditorChangeSet;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface ApplyJsonPatchWithInverseResult {
  readonly value: JsonValue;
  readonly inverseOperations: readonly JsonPatchOperation[];
  readonly diffSummary: readonly Omit<EditorDiffSummaryItem, "filePath">[];
}

export interface DryRunEditorChangeSetInput {
  readonly snapshot: DocumentSnapshot;
  readonly changeSet: EditorChangeSet;
  readonly schemaRegistry?: SchemaRegistry;
  readonly schemaId?: string;
  readonly includeSemanticDiagnostics?: boolean;
}

export interface DryRunEditorChangeSetResult {
  readonly ok: boolean;
  readonly before: DocumentSnapshot;
  readonly after: DocumentSnapshot | undefined;
  readonly inverseChangeSet: EditorChangeSet | undefined;
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export type TreeViewNodeValueType = "array" | "object" | "string" | "number" | "boolean" | "null";

export type TreeViewNodeKind =
  /** Root of the JSON document (the empty pointer). */
  | "document"
  /** JSON object node. */
  | "object"
  /** JSON array node. */
  | "array"
  /** Scalar JSON value (string/number/boolean/null). */
  | "scalar"
  /**
   * Reference-ish value (a node that looks like a `$ref` container or a local
   * reference string).
   *
   * This is a UI hint only. The editable source of truth remains the authoring
   * JSON document, and all writes still route through JSON Patch operations.
   */
  | "reference";

export interface TreeViewNodeActionHints {
  /**
   * Whether the value is editable as a scalar replacement.
   *
   * This is intentionally conservative for the first tree slice: structural
   * operations (add/remove/rename/reorder) require schema-aware gating and are
   * left disabled until that policy is formalized.
   */
  readonly canSetValue: boolean;
  /** Whether this node should be treated as read-only by default. */
  readonly readOnly: boolean;
}

export interface TreeViewNode {
  /**
   * Stable node identifier for UI layers.
   *
   * For non-root nodes it matches the JSON Pointer. The root uses `$` to align
   * with graph projection node ids.
   */
  readonly id: string;
  /** JSON Pointer for this node (empty string is the document root). */
  readonly pointer: string;
  /** Parent JSON Pointer, or undefined for the document root. */
  readonly parentPointer: string | undefined;
  /**
   * Human-facing label for the node row.
   *
   * - Root: `/`
   * - Object property: the raw property key
   * - Array item: `[index]`
   */
  readonly label: string;
  readonly kind: TreeViewNodeKind;
  readonly valueType: TreeViewNodeValueType;
  /** Short value preview for tree rows and search. */
  readonly valuePreview: string;
  readonly childCount: number;
  /** Diagnostics that target this exact pointer. */
  readonly diagnostics: readonly DocumentDiagnostic[];
  /**
   * Total number of diagnostics targeting this node or any descendant pointer.
   *
   * Tree UIs typically render this as a badge so users can quickly discover
   * which branches contain errors or warnings.
   */
  readonly subtreeDiagnosticCount: number;
  /** Optional graph node id for selection sync when available. */
  readonly graphNodeId: string | undefined;
  readonly actions: TreeViewNodeActionHints;
  readonly children: readonly TreeViewNode[];
}

export interface TreeViewModel {
  readonly root: TreeViewNode;
  /** Pre-order list of all nodes for fast search. */
  readonly flatNodes: readonly TreeViewNode[];
  /** Lookup map for pointer-based selection sync. */
  readonly nodeByPointer: ReadonlyMap<string, TreeViewNode>;
}

export interface BuildTreeViewModelInput {
  readonly snapshot: DocumentSnapshot;
  /**
   * Diagnostics to attach to tree nodes.
   *
   * Callers usually pass `validateDocument(snapshot, ...)` output so the tree
   * can show schema and semantic errors, not only syntax parsing failures.
   */
  readonly diagnostics?: readonly DocumentDiagnostic[];
  /** Optional graph projection used to attach matching graph node ids. */
  readonly graphProjection?: AuthoringGraphProjection;
  /** Max length for scalar previews; longer values are truncated. */
  readonly maxValuePreviewLength?: number;
}

export interface BuildEntityTreeViewModelInput extends BuildTreeViewModelInput {}

/**
 * Builds a pointer-complete JSON tree view model for ADR-034.
 *
 * The model is framework-agnostic and immutable. UI layers are expected to keep
 * collapse/expand state separately (UI-only state), and route edits back into
 * the editor via JSON Patch operations rather than mutating this model.
 */
export class TreeViewModelBuilder {
  build(input: BuildTreeViewModelInput): TreeViewModel {
    const snapshot = input.snapshot;
    const maxPreview = Math.max(12, input.maxValuePreviewLength ?? 80);
    const diagnostics = input.diagnostics ?? snapshot.diagnostics;
    const diagnosticsByPointer = groupDiagnosticsByPointer(diagnostics);
    const graphNodeIdByPointer = input.graphProjection
      ? new Map(input.graphProjection.nodes.map((node) => [node.pointer, node.id]))
      : new Map<string, string>();

    const nodeByPointer = new Map<string, TreeViewNode>();
    const flatNodes: TreeViewNode[] = [];

    const buildNode = (
      value: JsonValue,
      pointer: string,
      parentPointer: string | undefined,
      label: string,
      kindOverride?: TreeViewNodeKind
    ): TreeViewNode => {
      const valueType = getTreeValueType(value);
      const kind = kindOverride ?? inferTreeKind(value, pointer);
      const childEntries = enumerateTreeChildren(value);
      const children = childEntries.map(({ segment, childValue, childLabel }) =>
        buildNode(childValue, buildJsonPointer([...parseJsonPointer(pointer), segment]), pointer, childLabel)
      );
      const directDiagnostics = diagnosticsByPointer.get(pointer) ?? [];
      const subtreeDiagnosticCount =
        directDiagnostics.length + children.reduce((sum, child) => sum + child.subtreeDiagnosticCount, 0);
      const canSetValue = pointer !== "" && kind === "scalar";

      const node: TreeViewNode = {
        id: pointer === "" ? "$" : pointer,
        pointer,
        parentPointer,
        label,
        kind,
        valueType,
        valuePreview: previewTreeValue(value, kind, maxPreview),
        childCount: children.length,
        diagnostics: directDiagnostics,
        subtreeDiagnosticCount,
        graphNodeId: graphNodeIdByPointer.get(pointer),
        actions: {
          canSetValue,
          readOnly: pointer === ""
        },
        children
      };

      nodeByPointer.set(pointer, node);
      flatNodes.push(node);
      return node;
    };

    if (snapshot.json === undefined) {
      const root: TreeViewNode = {
        id: "$",
        pointer: "",
        parentPointer: undefined,
        label: "/",
        kind: "document",
        valueType: "object",
        valuePreview: "Invalid JSON",
        childCount: 0,
        diagnostics: diagnosticsByPointer.get("") ?? [],
        subtreeDiagnosticCount: (diagnosticsByPointer.get("") ?? []).length,
        graphNodeId: graphNodeIdByPointer.get("") ?? "$",
        actions: { canSetValue: false, readOnly: true },
        children: []
      };
      nodeByPointer.set("", root);
      flatNodes.push(root);
      return { root, flatNodes, nodeByPointer };
    }

    const rootNode = buildNode(snapshot.json, "", undefined, "/", "document");
    return { root: rootNode, flatNodes, nodeByPointer };
  }
}

export function buildTreeViewModel(input: BuildTreeViewModelInput): TreeViewModel {
  return new TreeViewModelBuilder().build(input);
}

/**
 * Builds the default manifest entity tree for preview-first authoring.
 *
 * Unlike `buildTreeViewModel`, this projection is not pointer-complete. It
 * shows only tree-visible semantic entities and connects each entity to the
 * nearest visible semantic ancestor, so technical containers and scalar
 * parameters stay in Monaco/property panels instead of crowding navigation.
 */
export function buildEntityTreeViewModel(input: BuildEntityTreeViewModelInput): TreeViewModel {
  const snapshot = input.snapshot;
  const maxPreview = Math.max(12, input.maxValuePreviewLength ?? 80);
  const diagnostics = input.diagnostics ?? snapshot.diagnostics;
  const graphNodeIdByPointer = input.graphProjection
    ? new Map(input.graphProjection.nodes.map((node) => [node.pointer, node.id]))
    : new Map<string, string>();

  const nodeByPointer = new Map<string, TreeViewNode>();
  const flatNodes: TreeViewNode[] = [];

  if (snapshot.json === undefined) {
    return new TreeViewModelBuilder().build(input);
  }

  const entities = collectEntityTreeEntries(snapshot.json);
  const childrenByParentPointer = new Map<string, EntityTreeEntry[]>();
  for (const entity of entities) {
    const parent = entity.parentPointer ?? "";
    const children = childrenByParentPointer.get(parent);
    if (children === undefined) {
      childrenByParentPointer.set(parent, [entity]);
    } else {
      children.push(entity);
    }
  }

  const buildEntityNode = (entry: EntityTreeEntry): TreeViewNode => {
    const value = readJsonPointer(snapshot.json as JsonValue, entry.pointer) ?? {};
    const childEntries = childrenByParentPointer.get(entry.pointer) ?? [];
    const children = childEntries.map(buildEntityNode);
    const directDiagnostics = diagnostics.filter((diagnostic) => diagnostic.pointer === entry.pointer);
    const subtreeDiagnosticCount = diagnostics.filter((diagnostic) => isSameOrDescendantPointer(diagnostic.pointer, entry.pointer)).length;
    const node: TreeViewNode = {
      id: entry.pointer,
      pointer: entry.pointer,
      parentPointer: entry.parentPointer ?? "",
      label: entry.label,
      kind: inferTreeKind(value, entry.pointer),
      valueType: getTreeValueType(value),
      valuePreview: previewEntityTreeValue(value, maxPreview),
      childCount: children.length,
      diagnostics: directDiagnostics,
      subtreeDiagnosticCount,
      graphNodeId: graphNodeIdByPointer.get(entry.pointer),
      actions: {
        canSetValue: false,
        readOnly: false
      },
      children
    };
    nodeByPointer.set(node.pointer, node);
    flatNodes.push(node);
    return node;
  };

  const rootChildren = (childrenByParentPointer.get("") ?? []).map(buildEntityNode);
  const rootDiagnostics = diagnostics.filter((diagnostic) => diagnostic.pointer === "");
  const root: TreeViewNode = {
    id: "$entities",
    pointer: "",
    parentPointer: undefined,
    label: "Entities",
    kind: "document",
    valueType: getTreeValueType(snapshot.json),
    valuePreview: `${entities.length} entities`,
    childCount: rootChildren.length,
    diagnostics: rootDiagnostics,
    subtreeDiagnosticCount: diagnostics.length,
    graphNodeId: graphNodeIdByPointer.get("") ?? "$",
    actions: { canSetValue: false, readOnly: true },
    children: rootChildren
  };
  nodeByPointer.set("", root);
  flatNodes.unshift(root);

  return { root, flatNodes, nodeByPointer };
}

export type AuthoringGraphNodeRole =
  | "document"
  | "collection"
  | "definition"
  | "object"
  | "typed-object"
  | "reference"
  | "property";

export type AuthoringSemanticRole =
  | "manifest-root"
  | "definition"
  | "scenario"
  | "step"
  | "action"
  | "condition"
  | "state"
  | "metric"
  | "ui-screen"
  | "ui-component"
  | "asset"
  | "reference"
  | "collection"
  | "property";

export type AuthoringPresentationRole =
  | "root"
  | "branch"
  | "definition"
  | "flow"
  | "operation"
  | "decision"
  | "state"
  | "metric"
  | "screen"
  | "component"
  | "asset"
  | "reference"
  | "collection"
  | "property";

export interface AuthoringGraphNode {
  readonly id: string;
  readonly pointer: string;
  readonly role: AuthoringGraphNodeRole;
  /** Semantic role is editor-only meaning inferred from generic JSON signals. */
  readonly semanticRole: AuthoringSemanticRole;
  readonly semanticTitle: string;
  readonly semanticSummary: string;
  readonly presentationRole: AuthoringPresentationRole;
  readonly label: string;
  readonly valueType: "array" | "object" | "string" | "number" | "boolean" | "null";
  readonly parentId: string | undefined;
  readonly childIds: readonly string[];
  readonly hiddenByDefault: boolean;
  readonly expandable: boolean;
  readonly childCount: number;
}

export interface AuthoringGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly role: "contains" | "defines" | "references";
  readonly label?: string;
}

export interface AuthoringGraphProjection {
  readonly nodes: readonly AuthoringGraphNode[];
  readonly edges: readonly AuthoringGraphEdge[];
}

export interface AuthoringGraphExpansionState {
  readonly selectedNodeId?: string;
  readonly activeBranchRootId?: string;
  readonly expandedNodeIds?: readonly string[];
  readonly collapsedNodeIds?: readonly string[];
  readonly includeRawProperties?: boolean;
  readonly maxVisibleNodes?: number;
  readonly maxExpandedChildren?: number;
}

export interface VisibleAuthoringGraphProjection extends AuthoringGraphProjection {
  readonly activeBranchRootId: string | undefined;
  readonly selectedNodeId: string | undefined;
  readonly hiddenNodeCount: number;
}

export interface PreviewPoint {
  /** X coordinate in the adapter-declared preview coordinate space. */
  readonly x: number;
  /** Y coordinate in the adapter-declared preview coordinate space. */
  readonly y: number;
}

export interface PreviewRect extends PreviewPoint {
  /** Rectangle width. Negative values are normalized before hit-testing. */
  readonly width: number;
  /** Rectangle height. Negative values are normalized before hit-testing. */
  readonly height: number;
}

export interface PreviewEntityDescriptor {
  /**
   * Stable renderer-side id for selection and highlight commands.
   *
   * It does not replace authoring JSON Pointer: renderer adapters may need an
   * id that stays stable while runtime and authoring pointers are mapped.
   */
  readonly entityId: string;
  /** Authoring JSON Pointer for property panel and Monaco synchronization. */
  readonly authoringPointer: string;
  /** Optional generated-runtime JSON Pointer when the renderer can report it. */
  readonly runtimePointer?: string;
  /** Human-facing label shown in object pickers and preview overlays. */
  readonly label: string;
  /** Editor-only semantic role inferred by schema/projection or renderer metadata. */
  readonly semanticRole: AuthoringSemanticRole | string;
  /** Optional visual layer name, for example `hud`, `board`, or `modal`. */
  readonly layer?: string;
  /** Higher z-index values are hit-tested first. */
  readonly zIndex?: number;
  /** Stable render order inside the same z-index; higher values are later/on top. */
  readonly renderOrder?: number;
  /** Entity bounds in the adapter-declared coordinate space. */
  readonly bounds: PreviewRect;
  /** Invisible entities stay available for diagnostics but are skipped by default. */
  readonly visible: boolean;
  /** Non-selectable entities are skipped by default but may be included for diagnostics. */
  readonly selectable?: boolean;
  /** Small renderer-neutral metadata bag for tooling. Keep game data in manifests. */
  readonly metadata?: JsonObject;
}

export interface PreviewHitTestOptions {
  /** Include descriptors whose `visible` flag is false. */
  readonly includeHidden?: boolean;
  /** Include descriptors whose `selectable` flag is false. */
  readonly includeNonSelectable?: boolean;
  /** Restrict hit-test to selected visual layers. Empty or undefined means all layers. */
  readonly layers?: readonly string[];
  /** Maximum number of descriptors returned after topmost sorting. */
  readonly limit?: number;
}

export interface PreviewHitTestResult {
  /** Point used for point hit-test, if applicable. */
  readonly point?: PreviewPoint;
  /** Rectangle used for region hit-test, if applicable. */
  readonly rect?: PreviewRect;
  /** Matching entities sorted topmost first. */
  readonly entities: readonly PreviewEntityDescriptor[];
}

export type PreviewHighlightCommand =
  | {
      readonly type: "clearHighlight";
    }
  | {
      readonly type: "highlightEntities";
      readonly entityIds: readonly string[];
      /** Reason lets adapters style hover, selection and region highlights differently. */
      readonly reason?: "hover" | "selection" | "region";
      readonly style?: {
        readonly outlineColor?: string;
        readonly fillColor?: string;
      };
    };

export interface PreviewRendererAdapter {
  /**
   * Returns the latest renderer-neutral descriptors.
   *
   * Implementations can be DOM, canvas, WebGL, or a test double. The
   * editor core only depends on this descriptor list and explicit commands.
   */
  getEntities(): readonly PreviewEntityDescriptor[];
  hitTestPoint(point: PreviewPoint, options?: PreviewHitTestOptions): PreviewHitTestResult;
  hitTestRect(rect: PreviewRect, options?: PreviewHitTestOptions): PreviewHitTestResult;
  highlight(command: PreviewHighlightCommand): void;
  /** Optional invalidation hook for UI layers that subscribe to renderer changes. */
  subscribe?(listener: () => void): () => void;
}

export interface StaticPreviewRendererAdapter extends PreviewRendererAdapter {
  /** Replaces descriptors and notifies subscribers; useful for tests and adapters. */
  setEntities(entities: readonly PreviewEntityDescriptor[]): void;
  /** Last highlight command received by this adapter. */
  getHighlightCommand(): PreviewHighlightCommand;
  subscribe(listener: () => void): () => void;
}

export type EditorEntityDocumentKind = "game" | "ui" | "design" | "plugin" | "unknown";

export type EditorEntityKind =
  | "game-root"
  | "game-flow"
  | "game-step"
  | "game-action"
  | "content-block"
  | "state-model"
  | "metric"
  | "ui-root"
  | "ui-screen"
  | "ui-component"
  | "design-artifact"
  | "plugin-contribution"
  | "unknown";

export type EditorEntityFacetKind = "logic" | "content" | "state" | "view" | "design" | "plugin";

export type EditorEntityProjectionDiagnosticCode =
  | "stale-source-hash"
  | "unresolved-source-pointer"
  | "unresolved-action-link"
  | "unresolved-view-link"
  | "ambiguous-view-link"
  | "hidden-technical-field";

export interface EditorEntitySourcePointer {
  readonly filePath: string;
  readonly pointer: string;
  readonly documentKind: EditorEntityDocumentKind;
  readonly channel?: string;
  readonly label?: string;
  readonly role?: string;
}

export interface EditorEntity {
  readonly entityId: string;
  readonly kind: EditorEntityKind;
  readonly label: string;
  readonly primarySource: EditorEntitySourcePointer;
  readonly facets: Readonly<Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>>>;
  readonly diagnostics: readonly EditorEntityProjectionDiagnostic[];
}

export interface EditorEntityProjectionDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: EditorEntityProjectionDiagnosticCode;
  readonly message: string;
  readonly source: EditorEntitySourcePointer;
  readonly target?: EditorEntitySourcePointer;
}

export interface EditorEntityProjectionDocument {
  readonly filePath: string;
  readonly json: JsonValue | undefined;
  readonly documentKind?: EditorEntityDocumentKind;
  readonly channel?: string;
  /** Optional caller-computed source hash used only for invalidating cached projections. */
  readonly sourceHash?: string;
}

export interface EditorEntityFieldDictionaryEntry {
  /** Match a concrete JSON Pointer when a field needs a precise user-facing label. */
  readonly pointer?: string;
  /** Match a property key across documents, for example `screenId`. */
  readonly key?: string;
  readonly label: string;
  /** `false` hides the field from human-facing YAML prompt projection. */
  readonly meaningful?: boolean;
}

export interface BuildEditorEntityProjectionInput {
  readonly gameId?: string;
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly previewEntities?: readonly PreviewEntityDescriptor[];
  readonly fieldDictionary?: readonly EditorEntityFieldDictionaryEntry[];
  /** Previously cached hashes by file path. Mismatches produce diagnostics only. */
  readonly expectedSourceHashes?: Readonly<Record<string, string>>;
}

export interface EditorEntityProjection {
  readonly projectionVersion: 1;
  readonly gameId: string | undefined;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly entities: readonly EditorEntity[];
  readonly entityById: ReadonlyMap<string, EditorEntity>;
  readonly entitiesBySourcePointer: ReadonlyMap<string, readonly EditorEntity[]>;
  readonly diagnostics: readonly EditorEntityProjectionDiagnostic[];
}

export interface BuildEditorEntityYamlProjectionInput {
  readonly entity: EditorEntity;
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly fieldDictionary?: readonly EditorEntityFieldDictionaryEntry[];
  /** Limits nested output so assistant context stays compact and deterministic. */
  readonly maxDepth?: number;
}

export interface EditorEntityYamlProjection {
  readonly text: string;
  readonly hiddenTechnicalPointers: readonly EditorEntitySourcePointer[];
  readonly diagnostics: readonly EditorEntityProjectionDiagnostic[];
}

export type ManifestTimelineEntryKind = "flow" | "step";

export interface ManifestTimelineEntry {
  /** Stable timeline id; currently equal to the authoring pointer. */
  readonly id: string;
  /** Authoring JSON Pointer for selection sync. */
  readonly pointer: string;
  readonly kind: ManifestTimelineEntryKind;
  readonly label: string;
  /** Zero-based order among entries of the same kind and parent. */
  readonly order: number;
  /** Parent flow id for steps. */
  readonly parentId?: string;
  readonly flowId?: string;
  readonly stepId?: string;
  readonly screenId?: string;
  readonly actionIds: readonly string[];
  readonly nextStepId?: string;
}

export interface ManifestTimeline {
  readonly entries: readonly ManifestTimelineEntry[];
  readonly entryById: ReadonlyMap<string, ManifestTimelineEntry>;
  readonly rootEntryIds: readonly string[];
}

export interface BuildManifestTimelineInput {
  readonly snapshot: DocumentSnapshot;
}

export type PreviewPlaythroughEventKind = "action" | "navigation" | "selection" | "system" | string;

export interface PreviewPlaythroughEvent {
  readonly id: string;
  /** Monotonic sequence number inside one preview trace. */
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: PreviewPlaythroughEventKind;
  readonly label: string;
  readonly payload?: JsonValue;
}

export interface PreviewPlaythroughSnapshot {
  readonly id: string;
  /** Sequence of the last event included in this snapshot. */
  readonly eventSequence: number;
  readonly state: JsonValue;
}

export interface PreviewPlaythroughTrace {
  readonly version: 1;
  readonly traceId: string;
  readonly gameId?: string;
  readonly events: readonly PreviewPlaythroughEvent[];
  readonly snapshots: readonly PreviewPlaythroughSnapshot[];
}

export interface PreviewTraceRestorePlan {
  readonly targetSequence: number;
  readonly snapshot: PreviewPlaythroughSnapshot | undefined;
  readonly replayEvents: readonly PreviewPlaythroughEvent[];
}

function groupDiagnosticsByPointer(diagnostics: readonly DocumentDiagnostic[]): Map<string, DocumentDiagnostic[]> {
  const grouped = new Map<string, DocumentDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    const list = grouped.get(diagnostic.pointer);
    if (list !== undefined) {
      list.push(diagnostic);
    } else {
      grouped.set(diagnostic.pointer, [diagnostic]);
    }
  }

  return grouped;
}

function getTreeValueType(value: JsonValue): TreeViewNodeValueType {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  if (isPlainJsonObject(value)) {
    return "object";
  }

  return typeof value as TreeViewNodeValueType;
}

function isLocalReferenceString(value: string): boolean {
  if (value === "#") {
    return true;
  }

  if (!value.startsWith("#/")) {
    return false;
  }

  try {
    parseJsonPointer(decodeURI(value.slice(1)));
    return true;
  } catch {
    return false;
  }
}

function inferTreeKind(value: JsonValue, pointer: string): TreeViewNodeKind {
  if (pointer === "") {
    return "document";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (isPlainJsonObject(value)) {
    return typeof value.$ref === "string" ? "reference" : "object";
  }

  if (typeof value === "string" && isLocalReferenceString(value)) {
    return "reference";
  }

  return "scalar";
}

type TreeChildEntry = {
  readonly segment: string;
  readonly childLabel: string;
  readonly childValue: JsonValue;
};

function enumerateTreeChildren(value: JsonValue): readonly TreeChildEntry[] {
  if (Array.isArray(value)) {
    return value.map((childValue, index) => ({
      segment: String(index),
      childLabel: `[${index}]`,
      childValue
    }));
  }

  if (isPlainJsonObject(value)) {
    return Object.entries(value).map(([key, childValue]) => ({ segment: key, childLabel: key, childValue }));
  }

  return [];
}

function previewTreeValue(value: JsonValue, kind: TreeViewNodeKind, maxLength: number): string {
  if (kind === "document") {
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }

    if (isPlainJsonObject(value)) {
      return `{${Object.keys(value).length} keys}`;
    }

    return previewTreeValue(value, "scalar", maxLength);
  }

  if (kind === "array" && Array.isArray(value)) {
    return `[${value.length} items]`;
  }

  if ((kind === "object" || kind === "reference") && isPlainJsonObject(value)) {
    const typeHint = typeof value._type === "string" ? value._type.trim() : "";
    const idHint = typeof value.id === "string" ? value.id.trim() : "";
    const titleHint = typeof value.title === "string" ? value.title.trim() : "";

    if (kind === "reference" && typeof value.$ref === "string") {
      return `$ref: ${truncate(value.$ref, maxLength)}`;
    }

    const hints = [typeHint ? `_type: ${typeHint}` : "", idHint ? `id: ${idHint}` : "", titleHint ? `title: ${titleHint}` : ""].filter(
      (hint) => hint !== ""
    );
    if (hints.length > 0) {
      return truncate(hints.join(" · "), maxLength);
    }

    return `{${Object.keys(value).length} keys}`;
  }

  if (typeof value === "string") {
    return truncate(JSON.stringify(value), maxLength);
  }

  return String(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}


export interface SchemaRegistryOptions {
  /**
   * Ajv is kept local and synchronous. No remote loader is configured, so `$ref`
   * values resolve only against schemas already registered in this registry.
   */
  readonly ajvOptions?: AjvOptions;
}

export interface ValidateValueInput {
  readonly schemaId: string;
  readonly value: JsonValue;
  readonly locationMap?: TextLocationMap;
  readonly source?: DiagnosticSource;
}

export interface SchemaRegistry {
  registerSchema(schemaId: string, schema: JsonSchema): void;
  hasSchema(schemaId: string): boolean;
  validateValue(input: ValidateValueInput): readonly DocumentDiagnostic[];
  validateDocument(snapshot: DocumentSnapshot, schemaId: string): readonly DocumentDiagnostic[];
}

type AjvValidationFunction = {
  (data: unknown): boolean | Promise<unknown>;
  readonly errors?: readonly ErrorObject[] | null;
};

interface LocalAjvInstance {
  removeSchema(schemaKeyRef?: string | RegExp | AnySchema): LocalAjvInstance;
  addSchema(schema: AnySchema, key?: string): LocalAjvInstance;
  getSchema(keyRef: string): AjvValidationFunction | undefined;
}

type LocalAjvConstructor = new (options?: AjvOptions) => LocalAjvInstance;

export interface ValidateDocumentOptions {
  readonly schemaRegistry?: SchemaRegistry;
  readonly schemaId?: string;
  readonly includeSemanticDiagnostics?: boolean;
}

export interface ValidateJsonValueOptions {
  readonly schemaRegistry?: SchemaRegistry;
  readonly schemaId?: string;
  readonly locationMap?: TextLocationMap;
  readonly includeSemanticDiagnostics?: boolean;
}

export type ReverseProjectIntent =
  | {
      readonly type: "setValue";
      readonly pointer: string;
      readonly value: JsonValue;
    }
  | {
      readonly type: "moveNode";
      readonly pointer: string;
      readonly position: { readonly x: number; readonly y: number };
    }
  | {
      readonly type: "addCollectionItem";
      readonly collectionPointer: string;
      readonly value: JsonValue;
      readonly index?: number | "end";
      readonly key?: string;
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
      readonly expectedTargetPointer?: string;
    };

export type ReverseProjectResult =
  | {
      readonly target: "authoring";
      readonly operations: readonly JsonPatchOperation[];
      readonly diagnostics?: readonly DocumentDiagnostic[];
    }
  | {
      readonly target: "layout";
      readonly operations: readonly JsonPatchOperation[];
      readonly diagnostics?: readonly DocumentDiagnostic[];
    }
  | {
      readonly target: "rejected";
      readonly operations: readonly [];
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

export type PrototypeExtractionClassification = "game-level" | "candidate-for-platform" | "rejected-over-extraction";
export type PrototypeExtractionRuntimeDiffExpectation = "must-be-zero" | "requires-separate-migration";
export type PrototypeExtractionRisk = "low" | "medium" | "high";

export interface PrototypeExtractionScore {
  readonly repetitionCount: number;
  readonly commonFieldCount: number;
  readonly overrideFieldCount: number;
  readonly sharedFieldRatio: number;
  readonly readabilityRisk: PrototypeExtractionRisk;
  readonly overExtractionRisk: PrototypeExtractionRisk;
  readonly summary: string;
}

export interface PrototypeExtractionCandidate {
  readonly signature: string;
  readonly pointers: readonly string[];
  readonly normalizedShape: JsonValue;
  readonly score: PrototypeExtractionScore;
}

export interface DiscoverPrototypeExtractionCandidatesInput {
  readonly snapshot: DocumentSnapshot;
  readonly rootPointer?: string;
  readonly knownVariantKeys?: readonly string[];
  readonly excludedPointers?: readonly string[];
  readonly minRepeatCount?: number;
  readonly minObjectFieldCount?: number;
}

export type DiscoverPrototypeExtractionCandidatesResult =
  | {
      readonly ok: true;
      readonly candidates: readonly PrototypeExtractionCandidate[];
      readonly diagnostics: readonly DocumentDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly candidates: readonly [];
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

export interface PrototypeInstanceOverride {
  readonly sourcePointer: string;
  readonly replacement: JsonObject;
  readonly overridePointers: readonly string[];
}

export interface PrototypeExtractionSourceMapImpact {
  readonly requiresPointerExistenceCheck: true;
  readonly affectedPointers: readonly string[];
}

export interface PrototypeExtractionProposal {
  readonly id: string;
  readonly classification: Exclude<PrototypeExtractionClassification, "rejected-over-extraction">;
  readonly definitionType: string;
  readonly definitionPointer: string;
  readonly definition: JsonObject;
  readonly commonBody: JsonObject;
  readonly sourcePointers: readonly string[];
  readonly knownVariantKeys: readonly string[];
  readonly instanceOverrides: readonly PrototypeInstanceOverride[];
  readonly score: PrototypeExtractionScore;
  readonly expectedRuntimeDiff: PrototypeExtractionRuntimeDiffExpectation;
  readonly sourceMapImpact: PrototypeExtractionSourceMapImpact;
  readonly validationGates: readonly string[];
  readonly changeSet: EditorChangeSet;
}

export interface CreatePrototypeExtractionProposalInput {
  readonly snapshot: DocumentSnapshot;
  readonly sourcePointers: readonly string[];
  readonly definitionType: string;
  readonly definitionSemantics: string;
  readonly promptTemplate?: JsonObject;
  readonly classification?: Exclude<PrototypeExtractionClassification, "rejected-over-extraction">;
  readonly knownVariantKeys?: readonly string[];
  readonly expectedRuntimeDiff?: PrototypeExtractionRuntimeDiffExpectation;
  readonly proposalId?: string;
  readonly changeSetId?: string;
  readonly intentId?: string;
}

export type CreatePrototypeExtractionProposalResult =
  | {
      readonly ok: true;
      readonly proposal: PrototypeExtractionProposal;
      readonly diagnostics: readonly DocumentDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly proposal?: undefined;
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

/** Encodes one JSON Pointer segment according to RFC 6901 escaping rules. */
export function encodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Decodes one JSON Pointer segment and rejects malformed escape sequences. */
export function decodeJsonPointerSegment(segment: string): string {
  if (/~(?![01])/u.test(segment)) {
    throw new Error(`Invalid JSON Pointer escape in segment: ${segment}`);
  }

  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Splits a JSON Pointer into decoded path segments. The empty pointer is root. */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer must be empty or start with "/": ${pointer}`);
  }

  return pointer.slice(1).split("/").map(decodeJsonPointerSegment);
}

/** Builds a JSON Pointer from raw path segments. */
export function buildJsonPointer(segments: readonly string[]): string {
  if (segments.length === 0) {
    return "";
  }

  return `/${segments.map(encodeJsonPointerSegment).join("/")}`;
}

/**
 * Reads a value by JSON Pointer.
 *
 * Missing object keys, out-of-range array indexes, and invalid array tokens
 * return undefined instead of throwing so inspectors can probe optional paths.
 */
export function readJsonPointer(root: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = root;

  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!isArrayIndex(segment)) {
        return undefined;
      }

      current = current[Number(segment)];
      continue;
    }

    if (isPlainJsonObject(current)) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

/** Applies add, replace, remove, and test JSON Patch operations without mutating input. */
export function applyJsonPatch(root: JsonValue, operations: readonly JsonPatchOperation[]): JsonValue {
  return operations.reduce<JsonValue>((current, operation) => applySinglePatch(current, operation), root);
}

/**
 * Applies a JSON Patch sequence and returns inverse operations for undo.
 *
 * The helper is stricter than the low-level patch applier: it validates every
 * operation against the current intermediate document and supports `test`
 * guards so AI-generated patches cannot silently apply to stale data.
 */
export function applyJsonPatchWithInverse(
  root: JsonValue,
  operations: readonly JsonPatchOperation[]
): ApplyJsonPatchWithInverseResult {
  let current = root;
  const inverseOperations: JsonPatchOperation[] = [];
  const diffSummary: Omit<EditorDiffSummaryItem, "filePath">[] = [];

  for (const operation of operations) {
    assertJsonPatchOperationCanApply(current, operation);

    if (operation.op === "test") {
      current = applySinglePatch(current, operation);
      continue;
    }

    const actualPath = actualMutationPath(current, operation);
    const existedBefore = jsonPointerExists(current, actualPath);
    const before = existedBefore ? cloneJsonValue(readJsonPointer(current, actualPath) as JsonValue) : undefined;
    current = applySinglePatch(current, operation);
    const existsAfter = jsonPointerExists(current, actualPath);
    const after = existsAfter ? cloneJsonValue(readJsonPointer(current, actualPath) as JsonValue) : undefined;

    inverseOperations.unshift(inverseOperationForMutation(operation, actualPath, existedBefore, before));
    diffSummary.push({
      pointer: actualPath,
      operation: operation.op,
      before,
      after,
      description: describePatchOperation(operation.op, actualPath, before, after)
    });
  }

  return {
    value: current,
    inverseOperations,
    diffSummary
  };
}

/**
 * Dry-runs a bounded ChangeSet against one open authoring document.
 *
 * This is the Phase 8 safety gate used before automatic apply: it checks that
 * the ChangeSet touches only the active document, applies JSON Patch with
 * inverse generation, reparses the document, and runs schema/semantic
 * validation before the UI mutates visible editor state.
 */
export function dryRunEditorChangeSet(input: DryRunEditorChangeSetInput): DryRunEditorChangeSetResult {
  const snapshot = input.snapshot;
  const diagnostics: DocumentDiagnostic[] = [];
  const unsupportedOperationCount =
    (input.changeSet.textPatches?.length ?? 0) +
    (input.changeSet.fileCreates?.length ?? 0) +
    (input.changeSet.fileDeletes?.length ?? 0) +
    (input.changeSet.fileRenames?.length ?? 0);

  if (unsupportedOperationCount > 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "This editor surface can dry-run only JSON patches; plugin/file operations are deferred to the project workspace gate."
      })
    );
  }

  const patchesForCurrentFile = input.changeSet.jsonPatches.filter((patch) => patch.filePath === snapshot.filePath);
  const patchesForOtherFiles = input.changeSet.jsonPatches.filter((patch) => patch.filePath !== snapshot.filePath);
  if (patchesForOtherFiles.length > 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: `ChangeSet touches ${patchesForOtherFiles.length} file(s) outside the active document.`
      })
    );
  }

  if (patchesForCurrentFile.length === 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "ChangeSet does not contain JSON Patch operations for the active document."
      })
    );
  }

  if (snapshot.json === undefined) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "Cannot apply a ChangeSet while the active document has invalid JSON."
      })
    );
  }

  if (diagnostics.length > 0 || snapshot.json === undefined) {
    return {
      ok: false,
      before: snapshot,
      after: undefined,
      inverseChangeSet: undefined,
      diffSummary: [],
      diagnostics
    };
  }

  try {
    const operations = patchesForCurrentFile.flatMap((patch) => [...patch.operations]);
    const applied = applyJsonPatchWithInverse(snapshot.json, operations);
    const nextText = `${JSON.stringify(applied.value, null, 2)}\n`;
    const after = createDocumentStore({ filePath: snapshot.filePath, text: nextText }).snapshot();
    const validationDiagnostics = validateDocument(after, {
      schemaRegistry: input.schemaRegistry,
      schemaId: input.schemaId,
      includeSemanticDiagnostics: input.includeSemanticDiagnostics
    });
    const allDiagnostics = [...validationDiagnostics];
    const ok = !allDiagnostics.some((diagnostic) => diagnostic.severity === "error");
    const inverseChangeSet: EditorChangeSet = {
      id: `${input.changeSet.id}:inverse`,
      intentId: input.changeSet.intentId,
      summary: `Undo: ${input.changeSet.summary}`,
      jsonPatches: [
        {
          filePath: snapshot.filePath,
          operations: applied.inverseOperations
        }
      ]
    };

    return {
      ok,
      before: snapshot,
      after,
      inverseChangeSet,
      diffSummary: applied.diffSummary.map((item) => ({ ...item, filePath: snapshot.filePath })),
      diagnostics: allDiagnostics
    };
  } catch (error) {
    return {
      ok: false,
      before: snapshot,
      after: undefined,
      inverseChangeSet: undefined,
      diffSummary: [],
      diagnostics: [
        makeDiagnostic({
          source: "change-set",
          pointer: "",
          message: error instanceof Error ? error.message : "ChangeSet dry-run failed."
        })
      ]
    };
  }
}

/** Creates a journal entry after a successful automatic ChangeSet apply. */
export function createPatchJournalStep(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly intent: EditorPatchIntent;
  readonly forward: EditorChangeSet;
  readonly inverse: EditorChangeSet;
  readonly beforeText: string;
  readonly afterText: string;
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly diagnostics?: readonly DocumentDiagnostic[];
}): PatchJournalStep {
  return {
    id: input.id,
    createdAt: input.createdAt,
    intent: input.intent,
    summary: input.forward.summary,
    affectedFiles: [...new Set(input.forward.jsonPatches.map((patch) => patch.filePath))],
    forward: input.forward,
    inverse: input.inverse,
    beforeHash: hashEditorText(input.beforeText),
    afterHash: hashEditorText(input.afterText),
    diffSummary: input.diffSummary,
    diagnostics: input.diagnostics ?? []
  };
}

/**
 * Small deterministic text hash for session journals.
 *
 * This is not a security primitive; it only lets the editor check that undo is
 * being applied to the text state the journal step expects.
 */
export function hashEditorText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Creates a small mutable document store whose snapshots remain immutable values. */
export function createDocumentStore(input: { readonly filePath: string; readonly text: string }): DocumentStore {
  let text = input.text;
  let selectedPointer: string | undefined;
  let parsed = parseDocument(text);

  const makeSnapshot = (): DocumentSnapshot => ({
    filePath: input.filePath,
    text,
    json: parsed.json,
    diagnostics: parsed.diagnostics,
    selectedPointer,
    locationMap: parsed.locationMap
  });

  return {
    snapshot: makeSnapshot,
    applyPatch(operations) {
      if (parsed.json === undefined) {
        return makeSnapshot();
      }

      const nextJson = applyJsonPatch(parsed.json, operations);
      text = `${JSON.stringify(nextJson, null, 2)}\n`;
      parsed = parseDocument(text);
      return makeSnapshot();
    },
    selectPointer(pointer) {
      if (pointer !== undefined) {
        parseJsonPointer(pointer);
      }

      selectedPointer = pointer;
      return makeSnapshot();
    }
  };
}

/**
 * Builds the full, addressable graph projection from arbitrary authoring JSON.
 *
 * The full model indexes semantic container nodes and raw scalar property
 * nodes. UI layers should normally render `buildVisibleAuthoringGraphProjection`
 * instead, because raw properties are hidden from the canvas by default while
 * remaining addressable by JSON Pointer for the inspector and Monaco.
 */
export function buildAuthoringGraphProjection(snapshot: DocumentSnapshot): AuthoringGraphProjection {
  const nodes: AuthoringGraphNode[] = [];
  const edges: AuthoringGraphEdge[] = [];
  const childIdsByNodeId = new Map<string, string[]>();

  if (snapshot.json === undefined) {
    return { nodes, edges };
  }

  const definitionPointersByType = collectDefinitionPointers(snapshot.json);

  const visit = (value: JsonValue, pointer: string, parentPointer: string | undefined): void => {
    const nodeId = pointer || "$";
    const parentId = parentPointer === undefined ? undefined : parentPointer || "$";
    const role = inferNodeRole(value, pointer);
    const semanticRole = inferSemanticRole(value, pointer);
    const semanticTitle = inferSemanticTitle(value, pointer, semanticRole);
    const childCount = countGraphChildren(value);
    const node: AuthoringGraphNode = {
      id: nodeId,
      pointer,
      role,
      semanticRole,
      semanticTitle,
      semanticSummary: inferSemanticSummary(value, pointer, semanticRole, childCount),
      presentationRole: presentationRoleForSemanticRole(semanticRole),
      label: semanticTitle,
      valueType: getJsonValueType(value),
      parentId,
      childIds: [],
      hiddenByDefault: semanticRole === "property",
      expandable: childCount > 0,
      childCount
    };

    nodes.push(node);
    childIdsByNodeId.set(node.id, []);

    if (parentId !== undefined) {
      childIdsByNodeId.get(parentId)?.push(node.id);
      edges.push({
        id: `${parentId}->${node.id}`,
        from: parentId,
        to: node.id,
        role: role === "definition" ? "defines" : "contains",
        label: lastPointerSegmentOrRoot(pointer)
      });
    }

    if (isPlainJsonObject(value) && typeof value._type === "string") {
      const targetPointer = definitionPointersByType.get(value._type);
      if (targetPointer !== undefined) {
        edges.push({
          id: `${node.id}->type:${value._type}`,
          from: node.id,
          to: targetPointer || "$",
          role: "references",
          label: value._type
        });
      }
    }

    collectLocalReferenceEdges(value, pointer, node.id, edges);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, appendPointerSegment(pointer, String(index)), pointer);
      });
      return;
    }

    if (isPlainJsonObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, appendPointerSegment(pointer, key), pointer);
      }
    }
  };

  visit(snapshot.json, "", undefined);

  return {
    nodes: nodes.map((node) => ({
      ...node,
      childIds: childIdsByNodeId.get(node.id) ?? []
    })),
    edges
  };
}

/**
 * Builds the canvas-ready graph from a full projection and expansion state.
 *
 * Visibility is driven by the active branch and expanded node ids rather than a
 * blind first-N slice of the full document. The optional limits apply inside
 * expanded branches so very large collections stay responsive by default.
 */
export function buildVisibleAuthoringGraphProjection(
  projection: AuthoringGraphProjection,
  state: AuthoringGraphExpansionState = {}
): VisibleAuthoringGraphProjection {
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const rootNode = nodesById.get("$") ?? projection.nodes[0];

  if (rootNode === undefined) {
    return {
      nodes: [],
      edges: [],
      activeBranchRootId: state.activeBranchRootId,
      selectedNodeId: state.selectedNodeId,
      hiddenNodeCount: 0
    };
  }

  const includeRawProperties = state.includeRawProperties === true;
  const maxVisibleNodes = state.maxVisibleNodes ?? (includeRawProperties ? Number.POSITIVE_INFINITY : 60);
  const maxExpandedChildren = state.maxExpandedChildren ?? (includeRawProperties ? Number.POSITIVE_INFINITY : 36);
  const expandedNodeIds = new Set(state.expandedNodeIds ?? []);
  const collapsedNodeIds = new Set(state.collapsedNodeIds ?? []);
  const selectedNodeId = nodesById.has(state.selectedNodeId ?? "") ? state.selectedNodeId : rootNode.id;
  const activeBranchRootId = resolveActiveBranchRootId(projection, selectedNodeId, state.activeBranchRootId);
  const selectedPathIds = selectedNodeId === undefined ? new Set<string>() : new Set(pathToRoot(nodesById, selectedNodeId));
  const visibleIds = new Set<string>([rootNode.id]);

  const canShowNode = (node: AuthoringGraphNode): boolean => includeRawProperties || !node.hiddenByDefault;
  const addVisible = (nodeId: string): boolean => {
    const node = nodesById.get(nodeId);
    if (node === undefined || !canShowNode(node) || visibleIds.size >= maxVisibleNodes) {
      return false;
    }

    visibleIds.add(nodeId);
    return true;
  };

  for (const childId of rootNode.childIds) {
    addVisible(childId);
  }

  if (activeBranchRootId !== undefined) {
    for (const ancestorId of pathToRoot(nodesById, activeBranchRootId)) {
      addVisible(ancestorId);
    }
  }

  for (const pathNodeId of selectedPathIds) {
    addVisible(pathNodeId);
  }

  const expandedQueue = [...visibleIds];
  for (let index = 0; index < expandedQueue.length; index += 1) {
    const currentId = expandedQueue[index] as string;
    const current = nodesById.get(currentId);
    if (current === undefined || collapsedNodeIds.has(currentId)) {
      continue;
    }

    const shouldExpand =
      current.id === "$" ||
      current.id === activeBranchRootId ||
      selectedPathIds.has(current.id) ||
      expandedNodeIds.has(current.id);

    if (!shouldExpand) {
      continue;
    }

    let shownChildren = 0;
    for (const childId of current.childIds) {
      if (shownChildren >= maxExpandedChildren) {
        break;
      }

      const child = nodesById.get(childId);
      if (child === undefined || !canShowNode(child)) {
        continue;
      }

      const beforeSize = visibleIds.size;
      if (!addVisible(childId)) {
        break;
      }

      if (visibleIds.size > beforeSize) {
        expandedQueue.push(childId);
      }
      shownChildren += 1;
    }
  }

  const visibleNodes = projection.nodes.filter((node) => visibleIds.has(node.id));
  const visibleEdges = projection.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    activeBranchRootId,
    selectedNodeId,
    hiddenNodeCount: Math.max(0, projection.nodes.length - visibleNodes.length)
  };
}

/** Normalizes rectangles so hit-tests work for drag selections in any direction. */
export function normalizePreviewRect(rect: PreviewRect): PreviewRect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;

  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  };
}

/** Returns true when a point lies inside the normalized rectangle boundaries. */
export function previewRectContainsPoint(rect: PreviewRect, point: PreviewPoint): boolean {
  const normalized = normalizePreviewRect(rect);
  return (
    point.x >= normalized.x &&
    point.y >= normalized.y &&
    point.x <= normalized.x + normalized.width &&
    point.y <= normalized.y + normalized.height
  );
}

/** Returns true when two normalized preview rectangles overlap. */
export function previewRectsIntersect(left: PreviewRect, right: PreviewRect): boolean {
  const a = normalizePreviewRect(left);
  const b = normalizePreviewRect(right);

  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/**
 * Sorts descriptors in the same order users expect from layered UIs: topmost
 * z-index first, then later render order, then later descriptor order.
 */
export function sortPreviewEntitiesTopmostFirst(
  entities: readonly PreviewEntityDescriptor[]
): readonly PreviewEntityDescriptor[] {
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort((left, right) => {
      const zIndexDelta = (right.entity.zIndex ?? 0) - (left.entity.zIndex ?? 0);
      if (zIndexDelta !== 0) {
        return zIndexDelta;
      }

      const leftRenderOrder = left.entity.renderOrder ?? left.index;
      const rightRenderOrder = right.entity.renderOrder ?? right.index;
      const renderOrderDelta = rightRenderOrder - leftRenderOrder;
      if (renderOrderDelta !== 0) {
        return renderOrderDelta;
      }

      return right.index - left.index;
    })
    .map(({ entity }) => entity);
}

/** Runs renderer-neutral point hit-testing over a descriptor list. */
export function hitTestPreviewPoint(
  entities: readonly PreviewEntityDescriptor[],
  point: PreviewPoint,
  options: PreviewHitTestOptions = {}
): PreviewHitTestResult {
  const matches = filterPreviewHitTestEntities(entities, options).filter((entity) => previewRectContainsPoint(entity.bounds, point));
  return {
    point,
    entities: limitPreviewHitTestEntities(sortPreviewEntitiesTopmostFirst(matches), options.limit)
  };
}

/** Runs renderer-neutral rectangle hit-testing over a descriptor list. */
export function hitTestPreviewRect(
  entities: readonly PreviewEntityDescriptor[],
  rect: PreviewRect,
  options: PreviewHitTestOptions = {}
): PreviewHitTestResult {
  const normalized = normalizePreviewRect(rect);
  const matches = filterPreviewHitTestEntities(entities, options).filter((entity) => previewRectsIntersect(entity.bounds, normalized));
  return {
    rect: normalized,
    entities: limitPreviewHitTestEntities(sortPreviewEntitiesTopmostFirst(matches), options.limit)
  };
}

/** Creates an in-memory adapter for tests and non-DOM preview simulations. */
export function createStaticPreviewRendererAdapter(
  initialEntities: readonly PreviewEntityDescriptor[] = []
): StaticPreviewRendererAdapter {
  let entities = [...initialEntities];
  let highlightCommand: PreviewHighlightCommand = { type: "clearHighlight" };
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getEntities() {
      return entities;
    },
    setEntities(nextEntities) {
      entities = [...nextEntities];
      notify();
    },
    hitTestPoint(point, options) {
      return hitTestPreviewPoint(entities, point, options);
    },
    hitTestRect(rect, options) {
      return hitTestPreviewRect(entities, rect, options);
    },
    highlight(command) {
      highlightCommand = command;
      notify();
    },
    getHighlightCommand() {
      return highlightCommand;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

/**
 * Builds the project-level editor entity projection accepted in ADR-052.
 *
 * The projection is intentionally an in-memory index. It stores source pointers
 * and derived labels, never nested copies of authoring objects, so deleting or
 * rebuilding it cannot change gameplay or UI output.
 */
export function buildEditorEntityProjection(input: BuildEditorEntityProjectionInput): EditorEntityProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const sourceHashes = buildProjectionSourceHashes(documents);
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const builders = new Map<string, MutableEditorEntityBuilder>();
  const actionRefsById = collectActionRefsById(documents);
  const contentRefsById = collectContentRefsById(documents);
  const uiScreenRefsById = collectUiScreenRefsById(documents);

  for (const document of documents) {
    const expectedHash = input.expectedSourceHashes?.[document.filePath];
    if (expectedHash !== undefined && document.sourceHash !== undefined && expectedHash !== document.sourceHash) {
      diagnostics.push({
        severity: "warning",
        code: "stale-source-hash",
        source: createProjectionSourcePointer(document, "", "document"),
        message: `Projection input hash for ${document.filePath} changed.`
      });
    }
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "game")) {
    collectGameEditorEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "ui")) {
    collectUiEditorEntities(document, builders, actionRefsById);
  }

  attachPreviewEntityFacets(input.previewEntities ?? [], documents, builders);

  const entities = [...builders.values()]
    .map(finalizeEditorEntityBuilder)
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const entitiesBySourcePointer = buildEntitiesBySourcePointer(entities);
  const entityDiagnostics = entities.flatMap((entity) => entity.diagnostics);

  return {
    projectionVersion: 1,
    gameId: input.gameId,
    sourceHashes,
    entities,
    entityById,
    entitiesBySourcePointer,
    diagnostics: [...diagnostics, ...entityDiagnostics]
  };
}

/**
 * Creates a compact YAML-like, human-facing projection for prompt assembly.
 *
 * Technical keys such as `_type`, `_label`, `_prompt` and `$schema` are hidden
 * by default. A field dictionary can still explicitly mark a technical key as
 * meaningful when product UX needs it.
 */
export function buildEditorEntityYamlProjection(input: BuildEditorEntityYamlProjectionInput): EditorEntityYamlProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const documentsByPath = new Map(documents.map((document) => [document.filePath, document]));
  const maxDepth = Math.max(1, input.maxDepth ?? 4);
  const hiddenTechnicalPointers: EditorEntitySourcePointer[] = [];
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const lines = [`Сущность: ${formatYamlScalar(input.entity.label)}`, `Тип: ${formatYamlScalar(input.entity.kind)}`];

  for (const facetKind of orderedEditorEntityFacetKinds) {
    const facetSources = input.entity.facets[facetKind] ?? [];
    if (facetSources.length === 0) {
      continue;
    }

    lines.push(`${editorEntityFacetLabel(facetKind)}:`);
    for (const source of facetSources) {
      const document = documentsByPath.get(source.filePath);
      const value = document?.json === undefined ? undefined : readJsonPointer(document.json, source.pointer);
      if (value === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "unresolved-source-pointer",
          source,
          message: `Cannot build YAML projection because ${source.filePath}#${source.pointer} does not resolve.`
        });
        lines.push(`  - ${formatYamlScalar(source.label ?? source.role ?? source.pointer)}: "[unavailable]"`);
        continue;
      }

      const sectionLabel = source.label ?? source.role ?? titleFromToken(lastPointerSegmentOrRoot(source.pointer));
      lines.push(`  - ${formatYamlScalar(sectionLabel)}:`);
      appendMeaningfulYamlLines({
        lines,
        value,
        pointer: source.pointer,
        indent: 6,
        fieldDictionary: input.fieldDictionary ?? [],
        hiddenTechnicalPointers,
        hiddenSourceBase: source,
        maxDepth
      });
    }
  }

  for (const hidden of hiddenTechnicalPointers) {
    diagnostics.push({
      severity: "warning",
      code: "hidden-technical-field",
      source: hidden,
      message: `Technical field ${hidden.filePath}#${hidden.pointer} is hidden from the user-facing YAML projection.`
    });
  }

  return {
    text: `${lines.join("\n")}\n`,
    hiddenTechnicalPointers,
    diagnostics
  };
}

/** Builds timeline entries from authoring v2 `root.logic.flows[].steps[]`. */
export function buildManifestChronologyTimeline(input: BuildManifestTimelineInput): ManifestTimeline {
  const snapshot = input.snapshot;
  const entries: ManifestTimelineEntry[] = [];
  const rootEntryIds: string[] = [];

  if (snapshot.json === undefined) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  const flows = readJsonPointer(snapshot.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowId = readStringProperty(flow, "id") ?? `flow-${flowIndex}`;
    const flowEntry: ManifestTimelineEntry = {
      id: flowPointer,
      pointer: flowPointer,
      kind: "flow",
      label: resolveEntityTreeLabel(flow, flowPointer),
      order: flowIndex,
      flowId,
      actionIds: []
    };
    entries.push(flowEntry);
    rootEntryIds.push(flowEntry.id);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      entries.push({
        id: stepPointer,
        pointer: stepPointer,
        kind: "step",
        label: resolveEntityTreeLabel(step, stepPointer),
        order: stepIndex,
        parentId: flowEntry.id,
        flowId,
        stepId: readStringProperty(step, "id") ?? `step-${stepIndex}`,
        screenId: readStringProperty(step, "screenId"),
        actionIds: readStringArrayProperty(step, "actionIds"),
        nextStepId: readStringProperty(step, "next")
      });
    });
  });

  return createManifestTimeline(entries, rootEntryIds);
}

/** Creates an immutable preview playthrough trace value. */
export function createPreviewPlaythroughTrace(input: {
  readonly traceId: string;
  readonly gameId?: string;
  readonly events?: readonly PreviewPlaythroughEvent[];
  readonly snapshots?: readonly PreviewPlaythroughSnapshot[];
}): PreviewPlaythroughTrace {
  return {
    version: 1,
    traceId: input.traceId,
    gameId: input.gameId,
    events: [...(input.events ?? [])].sort((left, right) => left.sequence - right.sequence),
    snapshots: [...(input.snapshots ?? [])].sort((left, right) => left.eventSequence - right.eventSequence)
  };
}

/** Appends an event and optional preview snapshot without mutating the trace. */
export function appendPreviewPlaythroughEvent(
  trace: PreviewPlaythroughTrace,
  event: Omit<PreviewPlaythroughEvent, "sequence"> & { readonly sequence?: number },
  snapshotState?: JsonValue
): PreviewPlaythroughTrace {
  const nextSequence = event.sequence ?? nextPreviewEventSequence(trace.events);
  const nextEvent: PreviewPlaythroughEvent = {
    ...event,
    sequence: nextSequence
  };
  const nextSnapshots =
    snapshotState === undefined
      ? trace.snapshots
      : [
          ...trace.snapshots,
          {
            id: `${trace.traceId}:snapshot:${nextSequence}`,
            eventSequence: nextSequence,
            state: snapshotState
          }
        ];

  return createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId,
    events: [...trace.events, nextEvent],
    snapshots: nextSnapshots
  });
}

/**
 * Plans preview rollback by finding the nearest snapshot and events to replay.
 *
 * The returned plan is intentionally preview-only: applying it is a renderer or
 * preview-session concern and must not mutate authoring JSON history.
 */
export function buildPreviewTraceRestorePlan(
  trace: PreviewPlaythroughTrace,
  targetSequence: number
): PreviewTraceRestorePlan {
  const snapshot = [...trace.snapshots]
    .filter((candidate) => candidate.eventSequence <= targetSequence)
    .sort((left, right) => right.eventSequence - left.eventSequence)[0];
  const fromSequence = snapshot?.eventSequence ?? Number.NEGATIVE_INFINITY;
  const replayEvents = trace.events.filter(
    (event) => event.sequence > fromSequence && event.sequence <= targetSequence
  );

  return {
    targetSequence,
    snapshot,
    replayEvents
  };
}

function filterPreviewHitTestEntities(
  entities: readonly PreviewEntityDescriptor[],
  options: PreviewHitTestOptions
): readonly PreviewEntityDescriptor[] {
  const layers = new Set(options.layers ?? []);

  return entities.filter((entity) => {
    if (options.includeHidden !== true && !entity.visible) {
      return false;
    }

    if (options.includeNonSelectable !== true && entity.selectable === false) {
      return false;
    }

    if (layers.size > 0 && (entity.layer === undefined || !layers.has(entity.layer))) {
      return false;
    }

    return true;
  });
}

function limitPreviewHitTestEntities(
  entities: readonly PreviewEntityDescriptor[],
  limit: number | undefined
): readonly PreviewEntityDescriptor[] {
  if (limit === undefined) {
    return entities;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  return entities.slice(0, Math.floor(limit));
}

const orderedEditorEntityFacetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "state", "view", "design", "plugin"];

type NormalizedEditorEntityProjectionDocument = EditorEntityProjectionDocument & {
  readonly documentKind: EditorEntityDocumentKind;
};

interface MutableEditorEntityBuilder {
  readonly entityId: string;
  readonly kind: EditorEntityKind;
  readonly label: string;
  readonly primarySource: EditorEntitySourcePointer;
  readonly facets: Map<EditorEntityFacetKind, EditorEntitySourcePointer[]>;
  readonly diagnostics: EditorEntityProjectionDiagnostic[];
}

function normalizeEditorEntityDocument(document: EditorEntityProjectionDocument): NormalizedEditorEntityProjectionDocument {
  const inferredKind = document.documentKind ?? inferEditorEntityDocumentKind(document.json);
  return {
    ...document,
    documentKind: inferredKind,
    channel: document.channel ?? inferEditorEntityDocumentChannel(document.json)
  };
}

function inferEditorEntityDocumentKind(json: JsonValue | undefined): EditorEntityDocumentKind {
  if (!isPlainJsonObject(json)) {
    return "unknown";
  }

  const manifestType = typeof json._manifestType === "string" ? json._manifestType : undefined;
  if (manifestType === "game" || manifestType === "ui") {
    return manifestType;
  }

  if (manifestType === "design") {
    return "design";
  }

  return "unknown";
}

function inferEditorEntityDocumentChannel(json: JsonValue | undefined): string | undefined {
  if (!isPlainJsonObject(json)) {
    return undefined;
  }

  return typeof json._channel === "string" && json._channel.trim() !== "" ? json._channel.trim() : undefined;
}

function buildProjectionSourceHashes(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): Readonly<Record<string, string>> {
  const sourceHashes: Record<string, string> = {};
  for (const document of documents) {
    if (document.sourceHash !== undefined) {
      sourceHashes[document.filePath] = document.sourceHash;
    }
  }
  return sourceHashes;
}

function collectGameEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  const root = document.json === undefined ? undefined : readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "game-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "game-root",
      label: rootSource.label ?? "Game",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "logic", rootSource);
  }

  collectGameFlowAndStepEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  collectGameActionEntities(document, builders, contentRefsById);
  collectGameMetricEntities(document, builders);
  collectGameStateModelEntities(document, builders);
}

function collectGameFlowAndStepEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const flows = readJsonPointer(document.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return;
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowSource = createProjectionSourcePointer(document, flowPointer, "flow", resolveEntityTreeLabel(flow, flowPointer));
    const flowEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-flow", document.filePath, flowPointer, readStringProperty(flow, "id")),
      kind: "game-flow",
      label: flowSource.label ?? "Flow",
      primarySource: flowSource
    });
    addEditorEntityFacet(flowEntity, "logic", flowSource);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      const stepSource = createProjectionSourcePointer(document, stepPointer, "step", resolveEntityTreeLabel(step, stepPointer));
      const stepEntity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("game-step", document.filePath, stepPointer, readStringProperty(step, "id")),
        kind: "game-step",
        label: stepSource.label ?? "Step",
        primarySource: stepSource
      });
      addEditorEntityFacet(stepEntity, "logic", stepSource);

      for (const actionId of collectLinkIds(step, ["actionId", "actionIds"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        if (actionRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-action-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing action ${actionId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        for (const actionRef of actionRefs) {
          addEditorEntityFacet(stepEntity, "logic", actionRef);
        }
      }

      for (const contentId of collectLinkIds(step, ["activeInfoId", "cardId", "choiceId", "contentId", "infoId"])) {
        const contentRefs = contentRefsById.get(contentId) ?? [];
        if (contentRefs.length === 0) {
          stepEntity.diagnostics.push(
            createProjectionDiagnostic(
              "warning",
              "unresolved-source-pointer",
              stepSource,
              `Step ${stepSource.label ?? stepPointer} references missing content ${contentId}.`
            )
          );
          continue;
        }

        for (const contentRef of contentRefs) {
          addEditorEntityFacet(stepEntity, "content", contentRef);
        }
      }

      const screenIds = collectLinkIds(step, ["screenId", "screen_id"]);
      for (const screenId of screenIds) {
        const viewRefs = uiScreenRefsById.get(screenId) ?? [];
        if (viewRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing UI screen ${screenId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        if (hasDuplicateProjectionChannels(viewRefs)) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "ambiguous-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} resolves screen ${screenId} to multiple screens in the same channel.`
          );
          stepEntity.diagnostics.push(diagnostic);
        }

        for (const viewRef of viewRefs) {
          addEditorEntityFacet(stepEntity, "view", viewRef);
        }
      }
    });
  });
}

function collectGameActionEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const actions = readJsonPointer(document.json, "/root/logic/actions");
  if (!Array.isArray(actions)) {
    return;
  }

  actions.forEach((action, index) => {
    if (!isPlainJsonObject(action)) {
      return;
    }

    const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
    const source = createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-action", document.filePath, pointer, readStringProperty(action, "id")),
      kind: "game-action",
      label: source.label ?? "Action",
      primarySource: source
    });
    addEditorEntityFacet(entity, "logic", source);

    for (const objectId of collectNestedLinkIds(action, ["objectId"])) {
      const contentRefs = contentRefsById.get(objectId) ?? [];
      for (const contentRef of contentRefs) {
        addEditorEntityFacet(entity, "content", contentRef);
      }
    }
  });
}

function collectGameMetricEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const metricsPointer = "/root/state/public/metrics";
  const metrics = readJsonPointer(document.json, metricsPointer);
  if (!isPlainJsonObject(metrics)) {
    return;
  }

  for (const [key] of Object.entries(metrics)) {
    const pointer = appendPointerSegment(metricsPointer, key);
    const source = createProjectionSourcePointer(document, pointer, "metric", titleFromToken(key));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("metric", document.filePath, pointer, key),
      kind: "metric",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectGameStateModelEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const objectTypesPointer = "/root/objectTypes";
  const objectTypes = readJsonPointer(document.json, objectTypesPointer);
  if (!isPlainJsonObject(objectTypes)) {
    return;
  }

  for (const [key, value] of Object.entries(objectTypes)) {
    const pointer = appendPointerSegment(objectTypesPointer, key);
    const label = isPlainJsonObject(value) ? resolveEntityTreeLabel(value, pointer) : titleFromToken(key);
    const source = createProjectionSourcePointer(document, pointer, "object-type", label);
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("state-model", document.filePath, pointer, key),
      kind: "state-model",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectUiEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const root = readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "ui-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "ui-root",
      label: rootSource.label ?? "UI",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "view", rootSource);
  }

  const screens = readJsonPointer(document.json, "/root/screens");
  if (!Array.isArray(screens)) {
    return;
  }

  screens.forEach((screen, screenIndex) => {
    if (!isPlainJsonObject(screen)) {
      return;
    }

    const screenPointer = buildJsonPointer(["root", "screens", String(screenIndex)]);
    const screenSource = createProjectionSourcePointer(document, screenPointer, "screen", resolveEntityTreeLabel(screen, screenPointer));
    const screenEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-screen", document.filePath, screenPointer, readStringProperty(screen, "id")),
      kind: "ui-screen",
      label: screenSource.label ?? "Screen",
      primarySource: screenSource
    });
    addEditorEntityFacet(screenEntity, "view", screenSource);
    collectUiComponentEntities(document, builders, actionRefsById, screenPointer, screenEntity);
  });
}

function collectUiComponentEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  rootPointer: string,
  screenEntity: MutableEditorEntityBuilder
): void {
  const visit = (value: JsonValue, pointer: string): void => {
    if (!isPlainJsonObject(value)) {
      return;
    }

    if (pointer !== rootPointer && isUiComponentLike(value)) {
      const source = createProjectionSourcePointer(document, pointer, "component", resolveEntityTreeLabel(value, pointer));
      const entity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("ui-component", document.filePath, pointer, readStringProperty(value, "id")),
        kind: "ui-component",
        label: source.label ?? "Component",
        primarySource: source
      });
      addEditorEntityFacet(entity, "view", source);
      addEditorEntityFacet(screenEntity, "view", source);

      for (const actionId of collectNestedLinkIds(value, ["actionId"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        for (const actionRef of actionRefs) {
          const actionEntity = builders.get(editorEntityId("game-action", actionRef.filePath, actionRef.pointer, actionId));
          if (actionEntity !== undefined) {
            addEditorEntityFacet(actionEntity, "view", source);
          }
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, appendPointerSegment(appendPointerSegment(pointer, key), String(index))));
      } else {
        visit(child, appendPointerSegment(pointer, key));
      }
    }
  };

  const root = document.json === undefined ? undefined : readJsonPointer(document.json, rootPointer);
  if (root !== undefined) {
    visit(root, rootPointer);
  }
}

function attachPreviewEntityFacets(
  previewEntities: readonly PreviewEntityDescriptor[],
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (previewEntities.length === 0) {
    return;
  }

  for (const previewEntity of previewEntities) {
    const source = findProjectionSourceForPreviewPointer(previewEntity.authoringPointer, documents, builders);
    if (source === undefined) {
      continue;
    }

    const owner = findProjectionOwnerForSourcePointer(source, builders);
    if (owner === undefined) {
      continue;
    }

    addEditorEntityFacet(owner, "view", {
      ...source,
      pointer: previewEntity.authoringPointer,
      label: previewEntity.label,
      role: `preview:${previewEntity.semanticRole}`
    });
  }
}

function collectActionRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const actions = readJsonPointer(document.json, "/root/logic/actions");
    if (!Array.isArray(actions)) {
      continue;
    }

    actions.forEach((action, index) => {
      if (!isPlainJsonObject(action)) {
        return;
      }

      const actionId = readStringProperty(action, "id");
      if (actionId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
      pushProjectionRef(refs, actionId, createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer)));
    });
  }

  return refs;
}

function collectContentRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const content = readJsonPointer(document.json, "/root/content");
    if (content === undefined) {
      continue;
    }

    visitProjectionJson(content, "/root/content", (value, pointer) => {
      if (!isPlainJsonObject(value)) {
        return;
      }

      const id = readStringProperty(value, "id");
      if (id === undefined) {
        return;
      }

      pushProjectionRef(refs, id, createProjectionSourcePointer(document, pointer, "content", resolveEntityTreeLabel(value, pointer)));
    });
  }

  return refs;
}

function collectUiScreenRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "ui" || document.json === undefined) {
      continue;
    }

    const screens = readJsonPointer(document.json, "/root/screens");
    if (!Array.isArray(screens)) {
      continue;
    }

    screens.forEach((screen, index) => {
      if (!isPlainJsonObject(screen)) {
        return;
      }

      const screenId = readStringProperty(screen, "id");
      if (screenId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "screens", String(index)]);
      pushProjectionRef(refs, screenId, createProjectionSourcePointer(document, pointer, "screen", resolveEntityTreeLabel(screen, pointer)));
    });
  }

  return refs;
}

function visitProjectionJson(value: JsonValue, pointer: string, visitor: (value: JsonValue, pointer: string) => void): void {
  visitor(value, pointer);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitProjectionJson(item, appendPointerSegment(pointer, String(index)), visitor));
    return;
  }

  if (!isPlainJsonObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitProjectionJson(child, appendPointerSegment(pointer, key), visitor);
  }
}

function pushProjectionRef(
  refs: Map<string, EditorEntitySourcePointer[]>,
  id: string,
  ref: EditorEntitySourcePointer
): void {
  const existing = refs.get(id);
  if (existing === undefined) {
    refs.set(id, [ref]);
  } else {
    existing.push(ref);
  }
}

function ensureEditorEntityBuilder(
  builders: Map<string, MutableEditorEntityBuilder>,
  input: {
    readonly entityId: string;
    readonly kind: EditorEntityKind;
    readonly label: string;
    readonly primarySource: EditorEntitySourcePointer;
  }
): MutableEditorEntityBuilder {
  const existing = builders.get(input.entityId);
  if (existing !== undefined) {
    return existing;
  }

  const builder: MutableEditorEntityBuilder = {
    entityId: input.entityId,
    kind: input.kind,
    label: input.label,
    primarySource: input.primarySource,
    facets: new Map(),
    diagnostics: []
  };
  builders.set(input.entityId, builder);
  return builder;
}

function addEditorEntityFacet(
  entity: MutableEditorEntityBuilder,
  facetKind: EditorEntityFacetKind,
  source: EditorEntitySourcePointer
): void {
  const existing = entity.facets.get(facetKind) ?? [];
  if (existing.some((candidate) => sourcePointerKey(candidate) === sourcePointerKey(source))) {
    return;
  }

  entity.facets.set(facetKind, [...existing, source]);
}

function finalizeEditorEntityBuilder(builder: MutableEditorEntityBuilder): EditorEntity {
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>> = {};
  for (const facetKind of orderedEditorEntityFacetKinds) {
    const values = builder.facets.get(facetKind);
    if (values !== undefined && values.length > 0) {
      facets[facetKind] = values;
    }
  }

  return {
    entityId: builder.entityId,
    kind: builder.kind,
    label: builder.label,
    primarySource: builder.primarySource,
    facets,
    diagnostics: builder.diagnostics
  };
}

function buildEntitiesBySourcePointer(entities: readonly EditorEntity[]): ReadonlyMap<string, readonly EditorEntity[]> {
  const result = new Map<string, EditorEntity[]>();
  for (const entity of entities) {
    for (const source of collectEntitySourcePointers(entity)) {
      const key = sourcePointerKey(source);
      const existing = result.get(key);
      if (existing === undefined) {
        result.set(key, [entity]);
      } else if (!existing.some((candidate) => candidate.entityId === entity.entityId)) {
        existing.push(entity);
      }
    }
  }

  return result;
}

function collectEntitySourcePointers(entity: EditorEntity): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets[facetKind] ?? []));
  }
  return sources;
}

function createProjectionSourcePointer(
  document: NormalizedEditorEntityProjectionDocument,
  pointer: string,
  role: string,
  label?: string
): EditorEntitySourcePointer {
  return {
    filePath: document.filePath,
    pointer,
    documentKind: document.documentKind,
    channel: document.channel,
    role,
    label
  };
}

function createProjectionDiagnostic(
  severity: DiagnosticSeverity,
  code: EditorEntityProjectionDiagnosticCode,
  source: EditorEntitySourcePointer,
  message: string,
  target?: EditorEntitySourcePointer
): EditorEntityProjectionDiagnostic {
  return {
    severity,
    code,
    source,
    target,
    message
  };
}

function editorEntityId(kind: EditorEntityKind, filePath: string, pointer: string, explicitId: string | undefined): string {
  const stablePart = explicitId === undefined || explicitId.trim() === "" ? `${filePath}#${pointer}` : explicitId.trim();
  return `${kind}:${stablePart}`;
}

function sourcePointerKey(source: EditorEntitySourcePointer): string {
  return `${source.filePath}#${source.pointer}`;
}

function collectLinkIds(value: JsonObject, keys: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      ids.push(candidate.trim());
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string" && item.trim() !== "") {
          ids.push(item.trim());
        }
      }
    }
  }
  return [...new Set(ids)];
}

function collectNestedLinkIds(value: JsonValue, keys: readonly string[]): readonly string[] {
  const ids = new Set<string>();
  visitProjectionJson(value, "", (candidate) => {
    if (!isPlainJsonObject(candidate)) {
      return;
    }

    for (const id of collectLinkIds(candidate, keys)) {
      ids.add(id);
    }
  });
  return [...ids];
}

function hasDuplicateProjectionChannels(refs: readonly EditorEntitySourcePointer[]): boolean {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    const key = `${ref.filePath}:${ref.channel ?? "default"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function isUiComponentLike(value: JsonObject): boolean {
  const type = readStringProperty(value, "_type") ?? readStringProperty(value, "type");
  return type !== undefined && normalizeToken(type).includes("component");
}

function findProjectionSourceForPreviewPointer(
  authoringPointer: string,
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): EditorEntitySourcePointer | undefined {
  for (const document of documents) {
    if (document.json === undefined || readJsonPointer(document.json, authoringPointer) === undefined) {
      continue;
    }

    const owner = [...builders.values()].find((entity) =>
      collectMutableEntitySourcePointers(entity).some((source) => source.filePath === document.filePath && isSameOrDescendantPointer(authoringPointer, source.pointer))
    );
    if (owner !== undefined) {
      return createProjectionSourcePointer(document, authoringPointer, "preview", owner.label);
    }
  }

  return undefined;
}

function findProjectionOwnerForSourcePointer(
  source: EditorEntitySourcePointer,
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): MutableEditorEntityBuilder | undefined {
  return [...builders.values()].find((entity) =>
    collectMutableEntitySourcePointers(entity).some(
      (candidate) => candidate.filePath === source.filePath && isSameOrDescendantPointer(source.pointer, candidate.pointer)
    )
  );
}

function collectMutableEntitySourcePointers(entity: MutableEditorEntityBuilder): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets.get(facetKind) ?? []));
  }
  return sources;
}

function appendMeaningfulYamlLines(input: {
  readonly lines: string[];
  readonly value: JsonValue;
  readonly pointer: string;
  readonly indent: number;
  readonly fieldDictionary: readonly EditorEntityFieldDictionaryEntry[];
  readonly hiddenTechnicalPointers: EditorEntitySourcePointer[];
  readonly hiddenSourceBase: EditorEntitySourcePointer;
  readonly maxDepth: number;
}): void {
  if (input.maxDepth <= 0) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(summarizeYamlValue(input.value))}`);
    return;
  }

  if (Array.isArray(input.value)) {
    if (input.value.length === 0) {
      input.lines.push(`${" ".repeat(input.indent)}[]`);
      return;
    }

    input.value.forEach((item, index) => {
      const childPointer = appendPointerSegment(input.pointer, String(index));
      if (isScalar(item) || item === null) {
        input.lines.push(`${" ".repeat(input.indent)}- ${formatYamlScalar(item)}`);
      } else {
        input.lines.push(`${" ".repeat(input.indent)}-`);
        appendMeaningfulYamlLines({ ...input, value: item, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
      }
    });
    return;
  }

  if (!isPlainJsonObject(input.value)) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(input.value)}`);
    return;
  }

  const entries = Object.entries(input.value).filter(([key]) => shouldIncludeMeaningfulYamlField(key, appendPointerSegment(input.pointer, key), input.fieldDictionary));
  if (entries.length === 0) {
    input.lines.push(`${" ".repeat(input.indent)}{}`);
  }

  for (const [key, child] of Object.entries(input.value)) {
    const childPointer = appendPointerSegment(input.pointer, key);
    if (!shouldIncludeMeaningfulYamlField(key, childPointer, input.fieldDictionary)) {
      if (isTechnicalProjectionField(key)) {
        input.hiddenTechnicalPointers.push({
          ...input.hiddenSourceBase,
          pointer: childPointer,
          role: key,
          label: resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary)
        });
      }
      continue;
    }

    const label = resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary);
    if (isScalar(child) || child === null) {
      input.lines.push(`${" ".repeat(input.indent)}${label}: ${formatYamlScalar(child)}`);
    } else {
      input.lines.push(`${" ".repeat(input.indent)}${label}:`);
      appendMeaningfulYamlLines({ ...input, value: child, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
    }
  }
}

function shouldIncludeMeaningfulYamlField(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): boolean {
  const dictionaryEntry = resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary);
  if (dictionaryEntry?.meaningful === false) {
    return false;
  }

  if (isTechnicalProjectionField(key)) {
    return dictionaryEntry?.meaningful === true;
  }

  return true;
}

function resolveProjectionFieldLabel(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): string {
  return resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary)?.label ?? titleFromToken(key);
}

function resolveProjectionFieldDictionaryEntry(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): EditorEntityFieldDictionaryEntry | undefined {
  return fieldDictionary.find((entry) => entry.pointer === pointer) ?? fieldDictionary.find((entry) => entry.key === key);
}

function isTechnicalProjectionField(key: string): boolean {
  return key === "$schema" || key.startsWith("_");
}

function editorEntityFacetLabel(facetKind: EditorEntityFacetKind): string {
  switch (facetKind) {
    case "logic":
      return "Логика";
    case "content":
      return "Содержание";
    case "state":
      return "Состояние";
    case "view":
      return "Отображение";
    case "design":
      return "Дизайн";
    case "plugin":
      return "Плагин";
  }
}

function formatYamlScalar(value: JsonValue | string): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value) || isPlainJsonObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function summarizeYamlValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }

  if (isPlainJsonObject(value)) {
    return `${Object.keys(value).length} fields`;
  }

  return String(value);
}

interface EntityTreeEntry {
  readonly pointer: string;
  readonly parentPointer: string | undefined;
  readonly label: string;
}

function collectEntityTreeEntries(root: JsonValue): readonly EntityTreeEntry[] {
  const entries: EntityTreeEntry[] = [];

  const visit = (value: JsonValue, pointer: string, parentEntityPointer: string | undefined): void => {
    if (isTreeVisibleSemanticEntity(value, pointer)) {
      const entry: EntityTreeEntry = {
        pointer,
        parentPointer: parentEntityPointer,
        label: resolveEntityTreeLabel(value, pointer)
      };
      entries.push(entry);
      parentEntityPointer = pointer;
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, appendPointerSegment(pointer, String(index)), parentEntityPointer);
      });
      return;
    }

    if (!isPlainJsonObject(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (!shouldTraverseEntityTreeKey(key)) {
        continue;
      }

      visit(child, appendPointerSegment(pointer, key), parentEntityPointer);
    }
  };

  visit(root, "", undefined);
  return entries;
}

function isTreeVisibleSemanticEntity(value: JsonValue, pointer: string): value is JsonObject {
  if (!isPlainJsonObject(value) || isDefinitionPointer(pointer)) {
    return false;
  }

  if (pointer === "/root") {
    return true;
  }

  return typeof value._type === "string" && value._type.trim() !== "";
}

function shouldTraverseEntityTreeKey(key: string): boolean {
  if (key === "_definitions") {
    return false;
  }

  if (key === "$schema") {
    return false;
  }

  if (key.startsWith("_")) {
    return false;
  }

  return true;
}

function resolveEntityTreeLabel(value: JsonObject, pointer: string): string {
  for (const key of ["_label", "title", "name", "id"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return compactTitle(candidate);
    }
  }

  return pointer === "" ? "Entities" : titleFromToken(lastPointerSegmentOrRoot(pointer));
}

function previewEntityTreeValue(value: JsonValue, maxLength: number): string {
  if (!isPlainJsonObject(value)) {
    return previewTreeValue(value, inferTreeKind(value, ""), maxLength);
  }

  const type = typeof value._type === "string" && value._type.trim() !== "" ? shortTypeName(value._type) : "entity";
  const semantics = typeof value._semantics === "string" && value._semantics.trim() !== "" ? compactSummary(value._semantics) : "";
  return truncate(semantics === "" ? type : `${type} · ${semantics}`, maxLength);
}

function isSameOrDescendantPointer(pointer: string, ancestorPointer: string): boolean {
  return ancestorPointer === "" || pointer === ancestorPointer || pointer.startsWith(`${ancestorPointer}/`);
}

function createManifestTimeline(
  entries: readonly ManifestTimelineEntry[],
  rootEntryIds: readonly string[]
): ManifestTimeline {
  return {
    entries,
    rootEntryIds,
    entryById: new Map(entries.map((entry) => [entry.id, entry]))
  };
}

function readStringProperty(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

function readStringArrayProperty(value: JsonObject, key: string): readonly string[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function nextPreviewEventSequence(events: readonly PreviewPlaythroughEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), -1) + 1;
}

/**
 * Creates a local JSON Schema registry.
 *
 * Ajv performs the standards-based structural validation. The registry does
 * not configure remote schema loading, which keeps authoring validation
 * deterministic and tied to schemas explicitly registered by the caller.
 */
export function createSchemaRegistry(options: SchemaRegistryOptions = {}): SchemaRegistry {
  const AjvConstructor =
    (AjvModule as unknown as { readonly default?: LocalAjvConstructor }).default ??
    (AjvModule as unknown as LocalAjvConstructor);
  const ajv = new AjvConstructor({
    allErrors: true,
    strict: false,
    ...options.ajvOptions
  });
  const registered = new Set<string>();

  return {
    registerSchema(schemaId, schema) {
      ajv.removeSchema(schemaId);
      ajv.addSchema(schema, schemaId);
      registered.add(schemaId);
    },
    hasSchema(schemaId) {
      return registered.has(schemaId) || ajv.getSchema(schemaId) !== undefined;
    },
    validateValue(input) {
      const validate = ajv.getSchema(input.schemaId);
      if (validate === undefined) {
        return [
          makeDiagnostic({
            source: "schema",
            pointer: "",
            message: `Schema is not registered: ${input.schemaId}`
          })
        ];
      }

      const valid = validate(input.value);
      if (valid instanceof Promise) {
        return [
          makeDiagnostic({
            source: "schema",
            pointer: "",
            message: `Async schema validation is not supported by the local editor registry: ${input.schemaId}`
          })
        ];
      }

      if (valid) {
        return [];
      }

      return [...(validate.errors ?? [])].map((error: ErrorObject) =>
        diagnosticFromAjvError(error, input.schemaId, input.locationMap, input.source ?? "schema")
      );
    },
    validateDocument(snapshot, schemaId) {
      if (snapshot.json === undefined) {
        return snapshot.diagnostics;
      }

      return this.validateValue({
        schemaId,
        value: snapshot.json,
        locationMap: snapshot.locationMap
      });
    }
  };
}

/** Runs syntax, optional schema, and optional semantic validation for a snapshot. */
export function validateDocument(
  snapshot: DocumentSnapshot,
  options: ValidateDocumentOptions = {}
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [...snapshot.diagnostics];

  if (snapshot.json === undefined) {
    return diagnostics;
  }

  if (options.schemaRegistry !== undefined && options.schemaId !== undefined) {
    diagnostics.push(...options.schemaRegistry.validateDocument(snapshot, options.schemaId));
  }

  if (options.includeSemanticDiagnostics ?? true) {
    diagnostics.push(...collectSemanticDiagnostics(snapshot.json, snapshot.locationMap));
  }

  return diagnostics;
}

/** Validates a parsed JSON value without requiring a DocumentStore. */
export function validateJsonValue(
  value: JsonValue,
  options: ValidateJsonValueOptions = {}
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  if (options.schemaRegistry !== undefined && options.schemaId !== undefined) {
    diagnostics.push(
      ...options.schemaRegistry.validateValue({
        schemaId: options.schemaId,
        value,
        locationMap: options.locationMap
      })
    );
  }

  if (options.includeSemanticDiagnostics ?? true) {
    diagnostics.push(...collectSemanticDiagnostics(value, options.locationMap));
  }

  return diagnostics;
}

/**
 * Finds repeated authoring object shapes that can become local prototypes.
 *
 * The comparison is structural: variant fields such as ids, labels, prompts and
 * text are ignored by key name, while stable discriminator fields such as
 * `kind`, `type`, `handler` and `templateId` keep their literal values. The
 * result is only a candidate list; applying extraction still requires an
 * explicit proposal and dry-run.
 */
export function discoverPrototypeExtractionCandidates(
  input: DiscoverPrototypeExtractionCandidatesInput
): DiscoverPrototypeExtractionCandidatesResult {
  if (input.snapshot.json === undefined) {
    return {
      ok: false,
      candidates: [],
      diagnostics: [
        makeDiagnostic({
          source: "prototype-extraction",
          pointer: "",
          message: "Cannot discover prototype candidates while the authoring document has invalid JSON."
        })
      ]
    };
  }

  const rootPointer = input.rootPointer ?? (jsonPointerExists(input.snapshot.json, "/root") ? "/root" : "");
  const rootValue = readJsonPointer(input.snapshot.json, rootPointer);
  if (rootValue === undefined) {
    return {
      ok: false,
      candidates: [],
      diagnostics: [
        makeDiagnostic({
          source: "prototype-extraction",
          pointer: rootPointer,
          message: `Prototype discovery root does not exist: ${rootPointer || "/"}`
        })
      ]
    };
  }

  const variantKeys = prototypeVariantKeySet(input.knownVariantKeys);
  const excludedPointers = new Set(["/_definitions", ...(input.excludedPointers ?? [])]);
  const minRepeatCount = input.minRepeatCount ?? 2;
  const minObjectFieldCount = input.minObjectFieldCount ?? 2;
  const groups = new Map<
    string,
    {
      readonly normalizedShape: JsonValue;
      readonly pointers: string[];
      readonly values: JsonObject[];
    }
  >();

  const visit = (value: JsonValue, pointer: string): void => {
    if (isExcludedPrototypePointer(pointer, excludedPointers)) {
      return;
    }

    if (isPlainJsonObject(value)) {
      const normalizedShape = normalizePrototypeShape(value, variantKeys);
      if (countPrototypeFields(normalizedShape) >= minObjectFieldCount && pointer !== rootPointer) {
        const signature = stableJsonSignature(normalizedShape);
        const group = groups.get(signature) ?? { normalizedShape, pointers: [], values: [] };
        group.pointers.push(pointer);
        group.values.push(value);
        groups.set(signature, group);
      }

      for (const [key, child] of Object.entries(value)) {
        visit(child, appendPointerSegment(pointer, key));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, appendPointerSegment(pointer, String(index)));
      });
    }
  };

  visit(rootValue, rootPointer);

  const candidates = [...groups.entries()]
    .filter(([, group]) => group.pointers.length >= minRepeatCount)
    .map(([signature, group]) => {
      const commonBody = buildPrototypeCommonBody(group.values, variantKeys);
      const overrideFieldCount = group.values.reduce(
        (total, value) => total + countPrototypeFields(diffPrototypeOverride(value, commonBody, undefined)),
        0
      );
      return {
        signature,
        pointers: group.pointers,
        normalizedShape: group.normalizedShape,
        score: buildPrototypeExtractionScore({
          repetitionCount: group.pointers.length,
          commonFieldCount: countPrototypeFields(commonBody),
          overrideFieldCount
        })
      };
    })
    .sort((left, right) => {
      if (right.score.repetitionCount !== left.score.repetitionCount) {
        return right.score.repetitionCount - left.score.repetitionCount;
      }
      return right.score.commonFieldCount - left.score.commonFieldCount;
    });

  return {
    ok: true,
    candidates,
    diagnostics: []
  };
}

/**
 * Builds a local game-level prototype extraction proposal and its ChangeSet.
 *
 * The proposal does not compile manifests itself. Instead it records the
 * mandatory gates from ADR-050 so editor-web or CI can run JSON Schema,
 * compiler, runtime diff and source-map checks before apply.
 */
export function createPrototypeExtractionProposal(
  input: CreatePrototypeExtractionProposalInput
): CreatePrototypeExtractionProposalResult {
  if (input.snapshot.json === undefined) {
    return rejectPrototypeExtraction("", "Cannot create a prototype proposal while the authoring document has invalid JSON.");
  }

  const definitionType = input.definitionType.trim();
  if (definitionType === "") {
    return rejectPrototypeExtraction("/_definitions", "Prototype definition type must be a non-empty string.");
  }

  if (input.definitionSemantics.trim() === "") {
    return rejectPrototypeExtraction("/_definitions", "Prototype definition must include non-empty _semantics.");
  }

  const definitionPointer = appendPointerSegment("/_definitions", definitionType);
  if (jsonPointerExists(input.snapshot.json, definitionPointer)) {
    return rejectPrototypeExtraction(definitionPointer, `Prototype definition already exists: ${definitionType}`);
  }

  const sourcePointers = uniquePrototypePointers(input.sourcePointers);
  if (sourcePointers.length < 2) {
    return rejectPrototypeExtraction("", "Prototype extraction requires at least two source pointers.");
  }

  const sourceValues: JsonObject[] = [];
  for (const pointer of sourcePointers) {
    const value = readJsonPointer(input.snapshot.json, pointer);
    if (!isPlainJsonObject(value)) {
      return rejectPrototypeExtraction(pointer, `Prototype source must point to a JSON object: ${pointer || "/"}`);
    }
    if (isDefinitionPointer(pointer)) {
      return rejectPrototypeExtraction(pointer, "Prototype extraction sources must be concrete authoring instances, not _definitions.");
    }
    sourceValues.push(value);
  }

  const inheritedType = commonPrototypeType(sourceValues);
  if (inheritedType === "mixed") {
    return rejectPrototypeExtraction(
      "",
      "Prototype extraction cannot merge sources with different _type values. Extract each semantic type separately."
    );
  }

  const variantKeys = prototypeVariantKeySet(input.knownVariantKeys);
  const commonBody = buildPrototypeCommonBody(sourceValues, variantKeys);
  if (countPrototypeFields(commonBody) === 0) {
    return rejectPrototypeExtraction(
      "",
      "Prototype extraction found no stable common body after removing known variant fields."
    );
  }

  const definition = buildPrototypeDefinition({
    inheritedType,
    definitionSemantics: input.definitionSemantics,
    promptTemplate: input.promptTemplate,
    commonBody
  });
  const instanceOverrides = sourceValues.map((value, index) => {
    const sourcePointer = sourcePointers[index] as string;
    const replacement = buildPrototypeInstanceReplacement({
      original: value,
      commonBody,
      definitionType,
      inheritedType
    });
    return {
      sourcePointer,
      replacement,
      overridePointers: collectOverridePointers(replacement, sourcePointer)
    };
  });
  const overrideFieldCount = instanceOverrides.reduce(
    (total, override) => total + Math.max(0, countPrototypeFields(override.replacement) - 1),
    0
  );
  const score = buildPrototypeExtractionScore({
    repetitionCount: sourcePointers.length,
    commonFieldCount: countPrototypeFields(commonBody),
    overrideFieldCount
  });
  const operations: JsonPatchOperation[] = [
    ...definitionPatchOperations(input.snapshot.json, definitionPointer, definition),
    ...sourcePointers.flatMap((pointer, index) => [
      { op: "test" as const, path: pointer, value: sourceValues[index] as JsonValue },
      { op: "replace" as const, path: pointer, value: instanceOverrides[index]?.replacement as JsonValue }
    ])
  ];

  const proposalId = input.proposalId ?? `prototype-extraction:${hashPrototypeProposalId(sourcePointers, definitionType)}`;
  const changeSet: EditorChangeSet = {
    id: input.changeSetId ?? `${proposalId}:change-set`,
    intentId: input.intentId,
    summary: `Extract local authoring prototype ${definitionType} from ${sourcePointers.length} instance(s).`,
    jsonPatches: [
      {
        filePath: input.snapshot.filePath,
        operations
      }
    ],
    textPatches: [],
    fileCreates: [],
    fileDeletes: [],
    fileRenames: []
  };
  const proposal: PrototypeExtractionProposal = {
    id: proposalId,
    classification: input.classification ?? "game-level",
    definitionType,
    definitionPointer,
    definition,
    commonBody,
    sourcePointers,
    knownVariantKeys: [...variantKeys].sort(),
    instanceOverrides,
    score,
    expectedRuntimeDiff: input.expectedRuntimeDiff ?? "must-be-zero",
    sourceMapImpact: {
      requiresPointerExistenceCheck: true,
      affectedPointers: sourcePointers
    },
    validationGates: [
      "authoring-json-schema",
      "editor-change-set-dry-run",
      "compiler-dry-run",
      "generated-runtime-schema",
      "authoring-only-leakage-scan",
      "canonical-runtime-diff",
      "source-map-pointer-existence",
      "manual-approval"
    ],
    changeSet
  };

  return {
    ok: true,
    proposal,
    diagnostics: []
  };
}

const defaultPrototypeVariantKeys = [
  "_label",
  "_prompt",
  "_semantics",
  "actionId",
  "asset",
  "body",
  "caption",
  "description",
  "id",
  "key",
  "label",
  "left",
  "name",
  "order",
  "slug",
  "src",
  "target",
  "targetId",
  "text",
  "title",
  "top",
  "x",
  "y"
] as const;

const stablePrototypeLiteralKeys = new Set([
  "_type",
  "channel",
  "component",
  "effect",
  "handler",
  "kind",
  "layout",
  "method",
  "mode",
  "scope",
  "templateId",
  "type",
  "variant"
]);

function rejectPrototypeExtraction(pointer: string, message: string): CreatePrototypeExtractionProposalResult {
  return {
    ok: false,
    diagnostics: [
      makeDiagnostic({
        source: "prototype-extraction",
        pointer,
        message
      })
    ]
  };
}

function prototypeVariantKeySet(extraKeys: readonly string[] | undefined): ReadonlySet<string> {
  return new Set([...defaultPrototypeVariantKeys, ...(extraKeys ?? [])]);
}

function isExcludedPrototypePointer(pointer: string, excludedPointers: ReadonlySet<string>): boolean {
  for (const excludedPointer of excludedPointers) {
    if (isSameOrDescendantPointer(pointer, excludedPointer)) {
      return true;
    }
  }
  return false;
}

function normalizePrototypeShape(value: JsonValue, variantKeys: ReadonlySet<string>, keyHint = ""): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePrototypeShape(item, variantKeys));
  }

  if (isPlainJsonObject(value)) {
    const normalized: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      if (variantKeys.has(key)) {
        continue;
      }
      normalized[key] = normalizePrototypeShape(child, variantKeys, key);
    }
    return normalized;
  }

  if (stablePrototypeLiteralKeys.has(keyHint)) {
    return value;
  }

  return {
    $scalar: value === null ? "null" : typeof value
  };
}

function stableJsonSignature(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonSignature).join(",")}]`;
  }

  if (isPlainJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonSignature(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function uniquePrototypePointers(pointers: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pointer of pointers) {
    parseJsonPointer(pointer);
    if (!seen.has(pointer)) {
      seen.add(pointer);
      result.push(pointer);
    }
  }
  return result;
}

function commonPrototypeType(values: readonly JsonObject[]): string | undefined | "mixed" {
  const types = values.map((value) => value._type).filter((value): value is string => typeof value === "string");
  if (types.length === 0) {
    return undefined;
  }
  if (types.length !== values.length) {
    return "mixed";
  }
  const [first] = types;
  return types.every((type) => type === first) ? first : "mixed";
}

function buildPrototypeCommonBody(values: readonly JsonObject[], variantKeys: ReadonlySet<string>): JsonObject {
  const common = commonPrototypeValue(values as readonly JsonValue[], variantKeys);
  if (!isPlainJsonObject(common)) {
    return {};
  }

  const { _type: _type, ...withoutType } = common as Record<string, JsonValue>;
  return withoutType;
}

function commonPrototypeValue(values: readonly JsonValue[], variantKeys: ReadonlySet<string>, keyHint = ""): JsonValue | undefined {
  const [first] = values;
  if (first === undefined || variantKeys.has(keyHint)) {
    return undefined;
  }

  if (values.every((value) => jsonValuesEqual(value, first))) {
    return cloneJsonValue(first);
  }

  if (values.every(isPlainJsonObject)) {
    const objects = values as readonly JsonObject[];
    const commonKeys = Object.keys(objects[0] ?? {})
      .filter((key) => !variantKeys.has(key))
      .filter((key) => objects.every((object) => Object.hasOwn(object, key)))
      .sort();
    const common: Record<string, JsonValue> = {};
    for (const key of commonKeys) {
      const child = commonPrototypeValue(
        objects.map((object) => object[key] as JsonValue),
        variantKeys,
        key
      );
      if (child !== undefined) {
        common[key] = child;
      }
    }
    return Object.keys(common).length === 0 ? undefined : common;
  }

  return undefined;
}

function buildPrototypeDefinition(input: {
  readonly inheritedType: string | undefined;
  readonly definitionSemantics: string;
  readonly promptTemplate: JsonObject | undefined;
  readonly commonBody: JsonObject;
}): JsonObject {
  const definition: Record<string, JsonValue> = {
    _semantics: input.definitionSemantics.trim()
  };
  if (input.inheritedType !== undefined) {
    definition._extends = input.inheritedType;
  }
  if (input.promptTemplate !== undefined) {
    definition._promptTemplate = input.promptTemplate;
  }

  for (const [key, value] of Object.entries(input.commonBody)) {
    definition[key] = value;
  }
  return definition;
}

function buildPrototypeInstanceReplacement(input: {
  readonly original: JsonObject;
  readonly commonBody: JsonObject;
  readonly definitionType: string;
  readonly inheritedType: string | undefined;
}): JsonObject {
  const replacement: Record<string, JsonValue> = {
    _type: input.definitionType
  };
  const override = diffPrototypeOverride(input.original, input.commonBody, input.inheritedType);
  for (const [key, value] of Object.entries(override)) {
    replacement[key] = value;
  }
  return replacement;
}

function diffPrototypeOverride(original: JsonObject, commonBody: JsonObject, inheritedType: string | undefined): JsonObject {
  const override: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(original)) {
    if (key === "_type" && inheritedType !== undefined && value === inheritedType) {
      continue;
    }

    const commonValue = commonBody[key];
    if (commonValue === undefined) {
      override[key] = value;
      continue;
    }

    if (stablePrototypeLiteralKeys.has(key)) {
      override[key] = value;
      continue;
    }

    if (jsonValuesEqual(value, commonValue)) {
      continue;
    }

    if (isPlainJsonObject(value) && isPlainJsonObject(commonValue)) {
      const childOverride = diffPrototypeOverride(value, commonValue, undefined);
      if (Object.keys(childOverride).length > 0) {
        override[key] = childOverride;
      }
      continue;
    }

    override[key] = value;
  }
  return override;
}

function collectOverridePointers(value: JsonObject, sourcePointer: string): readonly string[] {
  const pointers: string[] = [];
  const visit = (child: JsonValue, pointer: string): void => {
    if (!isPlainJsonObject(child) && !Array.isArray(child)) {
      pointers.push(pointer);
      return;
    }

    if (isPlainJsonObject(child)) {
      for (const [key, nested] of Object.entries(child)) {
        if (key === "_type") {
          continue;
        }
        visit(nested, appendPointerSegment(pointer, key));
      }
      return;
    }

    child.forEach((nested, index) => visit(nested, appendPointerSegment(pointer, String(index))));
  };

  visit(value, sourcePointer);
  return pointers;
}

function definitionPatchOperations(root: JsonValue, definitionPointer: string, definition: JsonObject): readonly JsonPatchOperation[] {
  if (!jsonPointerExists(root, "/_definitions")) {
    return [
      {
        op: "add",
        path: "/_definitions",
        value: {
          [lastPointerSegment(definitionPointer)]: definition
        }
      }
    ];
  }

  return [
    {
      op: "add",
      path: definitionPointer,
      value: definition
    }
  ];
}

function buildPrototypeExtractionScore(input: {
  readonly repetitionCount: number;
  readonly commonFieldCount: number;
  readonly overrideFieldCount: number;
}): PrototypeExtractionScore {
  const totalFields = input.commonFieldCount + input.overrideFieldCount;
  const sharedFieldRatio = totalFields === 0 ? 0 : Number((input.commonFieldCount / totalFields).toFixed(3));
  const readabilityRisk: PrototypeExtractionRisk =
    sharedFieldRatio < 0.35 || input.overrideFieldCount > input.commonFieldCount * 2 ? "high" : sharedFieldRatio < 0.55 ? "medium" : "low";
  const overExtractionRisk: PrototypeExtractionRisk =
    input.repetitionCount < 3 && sharedFieldRatio < 0.65 ? "high" : input.repetitionCount < 3 ? "medium" : "low";

  return {
    repetitionCount: input.repetitionCount,
    commonFieldCount: input.commonFieldCount,
    overrideFieldCount: input.overrideFieldCount,
    sharedFieldRatio,
    readabilityRisk,
    overExtractionRisk,
    summary: `${input.repetitionCount} instance(s), ${input.commonFieldCount} shared field(s), ${input.overrideFieldCount} override field(s), shared ratio ${sharedFieldRatio}.`
  };
}

function countPrototypeFields(value: JsonValue | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + countPrototypeFields(child), 0);
  }

  if (isPlainJsonObject(value)) {
    return Object.values(value).reduce<number>((total, child) => total + 1 + countPrototypeFields(child), 0);
  }

  return 1;
}

function hashPrototypeProposalId(sourcePointers: readonly string[], definitionType: string): string {
  return hashEditorText(`${definitionType}\n${sourcePointers.join("\n")}`);
}

/**
 * Converts UI-neutral edit intent back into JSON Patch.
 *
 * Unsafe operations return diagnostics instead of inventing missing containers
 * or rewriting unrelated authoring data. `moveNode` intentionally edits only a
 * layout sidecar target so graph layout gestures cannot mutate authoring JSON.
 */
export function reverseProjectIntent(
  snapshot: DocumentSnapshot,
  intent: ReverseProjectIntent
): ReverseProjectResult {
  if (snapshot.json === undefined) {
    return rejectReverseProjection(snapshot, "", "Cannot edit a document with invalid JSON.");
  }

  switch (intent.type) {
    case "setValue":
      return reverseSetValue(snapshot, intent.pointer, intent.value);
    case "moveNode":
      return reverseMoveNode(snapshot, intent.pointer, intent.position);
    case "addCollectionItem":
      return reverseAddCollectionItem(snapshot, intent);
    case "removeCollectionItem":
      return reverseRemoveCollectionItem(snapshot, intent.itemPointer);
    case "connectReference":
      return reverseConnectReference(snapshot, intent.referencePointer, intent.targetPointer);
    case "disconnectReference":
      return reverseDisconnectReference(snapshot, intent.referencePointer, intent.expectedTargetPointer);
  }
}

function reverseSetValue(snapshot: DocumentSnapshot, pointer: string, value: JsonValue): ReverseProjectResult {
  if (pointer === "") {
    return { target: "authoring", operations: [{ op: "replace", path: "", value }] };
  }

  const parent = readParentValue(snapshot.json as JsonValue, pointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, pointer, `Cannot set value because the parent path does not exist.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, pointer);
  const key = lastPointerSegment(pointer);

  if (Array.isArray(parent)) {
    if (current === undefined || !isArrayIndex(key)) {
      return rejectReverseProjection(snapshot, pointer, `Cannot set value because the array item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "replace", path: pointer, value }] };
  }

  if (isPlainJsonObject(parent)) {
    return {
      target: "authoring",
      operations: [{ op: current === undefined ? "add" : "replace", path: pointer, value }]
    };
  }

  return rejectReverseProjection(snapshot, pointer, `Cannot set value below a primitive parent.`);
}

function reverseMoveNode(
  snapshot: DocumentSnapshot,
  pointer: string,
  position: { readonly x: number; readonly y: number }
): ReverseProjectResult {
  if (readJsonPointer(snapshot.json as JsonValue, pointer) === undefined) {
    return rejectReverseProjection(snapshot, pointer, `Cannot move a node that does not exist.`);
  }

  const layoutPointer = buildJsonPointer(["nodes", pointer, "position"]);

  return {
    target: "layout",
    operations: [
      {
        op: "add",
        path: layoutPointer,
        value: { x: position.x, y: position.y }
      }
    ]
  };
}

function reverseAddCollectionItem(
  snapshot: DocumentSnapshot,
  intent: Extract<ReverseProjectIntent, { readonly type: "addCollectionItem" }>
): ReverseProjectResult {
  const collection = readJsonPointer(snapshot.json as JsonValue, intent.collectionPointer);
  if (collection === undefined) {
    return rejectReverseProjection(snapshot, intent.collectionPointer, `Cannot add item because collection is missing.`);
  }

  if (Array.isArray(collection)) {
    if (intent.key !== undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Array collection items cannot use object keys.`);
    }

    const index = intent.index ?? "end";
    if (index === "end") {
      return {
        target: "authoring",
        operations: [{ op: "add", path: appendPointerSegment(intent.collectionPointer, "-"), value: intent.value }]
      };
    }

    if (!Number.isInteger(index) || index < 0 || index > collection.length) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Array insertion index is out of range.`);
    }

    return {
      target: "authoring",
      operations: [
        {
          op: "add",
          path: appendPointerSegment(intent.collectionPointer, String(index)),
          value: intent.value
        }
      ]
    };
  }

  if (isPlainJsonObject(collection)) {
    if (intent.index !== undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Object collection items cannot use indexes.`);
    }

    if (intent.key === undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Object collection insert requires a key.`);
    }

    if (Object.hasOwn(collection, intent.key)) {
      return rejectReverseProjection(snapshot, appendPointerSegment(intent.collectionPointer, intent.key), `Collection key already exists.`);
    }

    return {
      target: "authoring",
      operations: [
        {
          op: "add",
          path: appendPointerSegment(intent.collectionPointer, intent.key),
          value: intent.value
        }
      ]
    };
  }

  return rejectReverseProjection(snapshot, intent.collectionPointer, `Cannot add item to a primitive value.`);
}

function reverseRemoveCollectionItem(snapshot: DocumentSnapshot, itemPointer: string): ReverseProjectResult {
  if (itemPointer === "") {
    return rejectReverseProjection(snapshot, itemPointer, `Removing the document root is not a safe collection edit.`);
  }

  const parent = readParentValue(snapshot.json as JsonValue, itemPointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, itemPointer, `Cannot remove item because the parent path does not exist.`);
  }

  const key = lastPointerSegment(itemPointer);
  if (Array.isArray(parent)) {
    if (!isArrayIndex(key) || Number(key) >= parent.length) {
      return rejectReverseProjection(snapshot, itemPointer, `Array item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "remove", path: itemPointer }] };
  }

  if (isPlainJsonObject(parent)) {
    if (!Object.hasOwn(parent, key)) {
      return rejectReverseProjection(snapshot, itemPointer, `Object item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "remove", path: itemPointer }] };
  }

  return rejectReverseProjection(snapshot, itemPointer, `Cannot remove an item below a primitive parent.`);
}

function reverseConnectReference(
  snapshot: DocumentSnapshot,
  referencePointer: string,
  targetPointer: string
): ReverseProjectResult {
  if (readJsonPointer(snapshot.json as JsonValue, targetPointer) === undefined) {
    return rejectReverseProjection(snapshot, targetPointer, `Cannot connect reference to a missing target.`);
  }

  const parent = readParentValue(snapshot.json as JsonValue, referencePointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, referencePointer, `Cannot connect reference because the field parent is missing.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, referencePointer);
  if (current !== undefined && current !== null && typeof current !== "string") {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field must be a string or null before connecting.`);
  }

  const refValue = pointerToLocalReference(targetPointer);
  if (current === refValue) {
    return { target: "authoring", operations: [] };
  }

  if (current === undefined && !isPlainJsonObject(parent)) {
    return rejectReverseProjection(snapshot, referencePointer, `Missing reference fields can only be added to objects.`);
  }

  return {
    target: "authoring",
    operations: [{ op: current === undefined ? "add" : "replace", path: referencePointer, value: refValue }]
  };
}

function reverseDisconnectReference(
  snapshot: DocumentSnapshot,
  referencePointer: string,
  expectedTargetPointer: string | undefined
): ReverseProjectResult {
  const parent = readParentValue(snapshot.json as JsonValue, referencePointer);
  if (!isPlainJsonObject(parent)) {
    return rejectReverseProjection(snapshot, referencePointer, `Reference fields can only be disconnected from objects.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, referencePointer);
  if (typeof current !== "string") {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field is not a string.`);
  }

  const currentTargetPointer = localReferenceToPointer(current);
  if (currentTargetPointer === undefined) {
    return rejectReverseProjection(snapshot, referencePointer, `Only local reference fields can be disconnected safely.`);
  }

  if (expectedTargetPointer !== undefined && currentTargetPointer !== expectedTargetPointer) {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field points to a different target.`);
  }

  return { target: "authoring", operations: [{ op: "remove", path: referencePointer }] };
}

function rejectReverseProjection(snapshot: DocumentSnapshot, pointer: string, message: string): ReverseProjectResult {
  return {
    target: "rejected",
    operations: [],
    diagnostics: [
      makeDiagnostic({
        source: "reverse-projection",
        pointer,
        message,
        range: snapshot.locationMap.get(pointer) ?? snapshot.locationMap.get(parentPointer(pointer) ?? "")
      })
    ]
  };
}

function collectSemanticDiagnostics(
  root: JsonValue,
  locationMap: TextLocationMap | undefined
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  const visit = (value: JsonValue, pointer: string): void => {
    if (Array.isArray(value)) {
      checkArrayCollectionIds(value, pointer, diagnostics, locationMap);
      value.forEach((item, index) => {
        visit(item, appendPointerSegment(pointer, String(index)));
      });
      return;
    }

    if (!isPlainJsonObject(value)) {
      return;
    }

    checkObjectCollectionIds(value, pointer, diagnostics, locationMap);

    if (typeof value.$ref === "string") {
      const refPointer = localReferenceToPointer(value.$ref);
      if (refPointer !== undefined && readJsonPointer(root, refPointer) === undefined) {
        const diagnosticPointer = appendPointerSegment(pointer, "$ref");
        diagnostics.push(
          makeDiagnostic({
            source: "semantic",
            pointer: diagnosticPointer,
            message: `Local reference does not resolve: ${value.$ref}`,
            range: locationMap?.get(diagnosticPointer)
          })
        );
      }
    }

    if (isTreeVisibleSemanticEntity(value, pointer)) {
      const label = value._label;
      if (typeof label !== "string" || label.trim() === "") {
        const diagnosticPointer = appendPointerSegment(pointer, "_label");
        diagnostics.push(
          makeDiagnostic({
            source: "semantic",
            pointer: diagnosticPointer,
            message: `Tree-visible semantic entity must define a non-empty _label.`,
            range: locationMap?.get(diagnosticPointer)
          })
        );
      }
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, appendPointerSegment(pointer, key));
    }
  };

  visit(root, "");
  return diagnostics;
}

function checkArrayCollectionIds(
  value: readonly JsonValue[],
  pointer: string,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const seen = new Map<string, string>();

  value.forEach((item, index) => {
    if (!isPlainJsonObject(item) || typeof item.id !== "string") {
      return;
    }

    const itemPointer = appendPointerSegment(pointer, String(index));
    const idPointer = appendPointerSegment(itemPointer, "id");
    addDuplicateIdDiagnostic(item.id, idPointer, seen, diagnostics, locationMap);
  });
}

function checkObjectCollectionIds(
  value: JsonObject,
  pointer: string,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const seen = new Map<string, string>();

  for (const [key, child] of Object.entries(value)) {
    if (!isPlainJsonObject(child) || typeof child.id !== "string") {
      continue;
    }

    const idPointer = appendPointerSegment(appendPointerSegment(pointer, key), "id");
    addDuplicateIdDiagnostic(child.id, idPointer, seen, diagnostics, locationMap);
  }
}

function addDuplicateIdDiagnostic(
  id: string,
  idPointer: string,
  seen: Map<string, string>,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const firstPointer = seen.get(id);
  if (firstPointer === undefined) {
    seen.set(id, idPointer);
    return;
  }

  diagnostics.push(
    makeDiagnostic({
      source: "semantic",
      pointer: idPointer,
      message: `Duplicate id "${id}" in the same collection. First occurrence: ${firstPointer}.`,
      range: locationMap?.get(idPointer)
    })
  );
}

function diagnosticFromAjvError(
  error: ErrorObject,
  schemaId: string,
  locationMap: TextLocationMap | undefined,
  source: DiagnosticSource
): DocumentDiagnostic {
  const pointer = pointerFromAjvError(error);
  return makeDiagnostic({
    source,
    pointer,
    message: `${schemaId}: ${error.message ?? error.keyword}`,
    range: locationMap?.get(pointer)
  });
}

function pointerFromAjvError(error: ErrorObject): string {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return appendPointerSegment(error.instancePath, error.params.missingProperty);
  }

  if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") {
    return appendPointerSegment(error.instancePath, error.params.additionalProperty);
  }

  if (error.keyword === "propertyNames" && typeof error.propertyName === "string") {
    return appendPointerSegment(error.instancePath, error.propertyName);
  }

  return error.instancePath || "";
}

function makeDiagnostic(input: {
  readonly severity?: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly pointer: string;
  readonly message: string;
  readonly range?: TextRange;
}): DocumentDiagnostic {
  return {
    severity: input.severity ?? "error",
    source: input.source,
    pointer: input.pointer,
    message: input.message,
    range: input.range,
    line: input.range?.start.line,
    column: input.range?.start.column
  };
}

function applySinglePatch(root: JsonValue, operation: JsonPatchOperation): JsonValue {
  const segments = parseJsonPointer(operation.path);

  if (segments.length === 0) {
    if (operation.op === "test") {
      assertJsonValuesEqual(root, operation.value, operation.path);
      return root;
    }

    if (operation.op === "remove") {
      throw new Error("Removing the document root is not supported by editor-engine.");
    }

    return operation.value;
  }

  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];

  if (key === undefined) {
    throw new Error(`Invalid JSON Patch path: ${operation.path}`);
  }

  return updateAtPath(root, parentSegments, (parent) => applyToParent(parent, key, operation));
}

function updateAtPath(
  value: JsonValue,
  segments: readonly string[],
  update: (target: JsonValue) => JsonValue
): JsonValue {
  if (segments.length === 0) {
    return update(value);
  }

  const [head, ...tail] = segments;

  if (head === undefined) {
    return update(value);
  }

  if (Array.isArray(value)) {
    if (!isArrayIndex(head) || Number(head) >= value.length) {
      throw new Error(`JSON Patch path does not exist: ${buildJsonPointer(segments)}`);
    }

    const index = Number(head);
    const copy = [...value];
    copy[index] = updateAtPath(copy[index] as JsonValue, tail, update);
    return copy;
  }

  if (isPlainJsonObject(value)) {
    if (!Object.hasOwn(value, head)) {
      const nextChild = buildMissingContainer(tail);
      return {
        ...value,
        [head]: updateAtPath(nextChild, tail, update)
      };
    }

    return {
      ...value,
      [head]: updateAtPath(value[head] as JsonValue, tail, update)
    };
  }

  throw new Error(`JSON Patch path crosses a primitive value: ${buildJsonPointer(segments)}`);
}

function applyToParent(parent: JsonValue, key: string, operation: JsonPatchOperation): JsonValue {
  if (Array.isArray(parent)) {
    return applyToArrayParent(parent, key, operation);
  }

  if (isPlainJsonObject(parent)) {
    return applyToObjectParent(parent, key, operation);
  }

  throw new Error(`JSON Patch target parent is not a container: ${operation.path}`);
}

function applyToArrayParent(parent: readonly JsonValue[], key: string, operation: JsonPatchOperation): JsonValue {
  const copy = [...parent];

  if (operation.op === "add") {
    const index = key === "-" ? copy.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > copy.length) {
      throw new Error(`Invalid array add index: ${key}`);
    }

    copy.splice(index, 0, operation.value);
    return copy;
  }

  if (!isArrayIndex(key) || Number(key) >= copy.length) {
    throw new Error(`Array path does not exist: ${key}`);
  }

  const index = Number(key);
  if (operation.op === "test") {
    assertJsonValuesEqual(copy[index] as JsonValue, operation.value, operation.path);
    return parent;
  }

  if (operation.op === "replace") {
    copy[index] = operation.value;
    return copy;
  }

  copy.splice(index, 1);
  return copy;
}

function applyToObjectParent(parent: JsonObject, key: string, operation: JsonPatchOperation): JsonValue {
  if (operation.op === "add") {
    return { ...parent, [key]: operation.value };
  }

  if (!Object.hasOwn(parent, key)) {
    throw new Error(`Object path does not exist: ${key}`);
  }

  if (operation.op === "test") {
    assertJsonValuesEqual(parent[key] as JsonValue, operation.value, operation.path);
    return parent;
  }

  if (operation.op === "replace") {
    return { ...parent, [key]: operation.value };
  }

  const { [key]: _removed, ...rest } = parent;
  return rest;
}

function assertJsonPatchOperationCanApply(root: JsonValue, operation: JsonPatchOperation): void {
  const segments = parseJsonPointer(operation.path);
  if (segments.length === 0) {
    if (operation.op === "remove") {
      throw new Error("Removing the document root is not supported by editor-engine.");
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(root, operation.value, operation.path);
    }

    return;
  }

  const parent = readParentValue(root, operation.path);
  if (parent === undefined) {
    throw new Error(`JSON Patch parent path does not exist: ${parentPointer(operation.path) ?? "/"}`);
  }

  const key = lastPointerSegment(operation.path);
  if (Array.isArray(parent)) {
    if (operation.op === "add") {
      if (key === "-") {
        return;
      }

      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) {
        throw new Error(`Invalid array add index: ${key}`);
      }

      return;
    }

    if (!isArrayIndex(key) || Number(key) >= parent.length) {
      throw new Error(`Array path does not exist: ${key}`);
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(parent[Number(key)] as JsonValue, operation.value, operation.path);
    }

    return;
  }

  if (isPlainJsonObject(parent)) {
    if (operation.op === "add") {
      return;
    }

    if (!Object.hasOwn(parent, key)) {
      throw new Error(`Object path does not exist: ${key}`);
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(parent[key] as JsonValue, operation.value, operation.path);
    }

    return;
  }

  throw new Error(`JSON Patch target parent is not a container: ${operation.path}`);
}

function actualMutationPath(root: JsonValue, operation: Exclude<JsonPatchOperation, { readonly op: "test" }>): string {
  if (operation.op === "add" && operation.path !== "") {
    const key = lastPointerSegment(operation.path);
    if (key === "-") {
      const parent = readParentValue(root, operation.path);
      if (Array.isArray(parent)) {
        return appendPointerSegment(parentPointer(operation.path) ?? "", String(parent.length));
      }
    }
  }

  return operation.path;
}

function inverseOperationForMutation(
  operation: Exclude<JsonPatchOperation, { readonly op: "test" }>,
  actualPath: string,
  existedBefore: boolean,
  before: JsonValue | undefined
): JsonPatchOperation {
  if (operation.op === "add") {
    return existedBefore && before !== undefined
      ? { op: "replace", path: actualPath, value: before }
      : { op: "remove", path: actualPath };
  }

  if (operation.op === "replace") {
    if (before === undefined) {
      throw new Error(`Cannot build inverse replace without previous value: ${actualPath}`);
    }

    return { op: "replace", path: actualPath, value: before };
  }

  if (before === undefined) {
    throw new Error(`Cannot build inverse remove without previous value: ${actualPath}`);
  }

  return { op: "add", path: actualPath, value: before };
}

function jsonPointerExists(root: JsonValue, pointer: string): boolean {
  let current: JsonValue | undefined = root;
  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!isArrayIndex(segment) || Number(segment) >= current.length) {
        return false;
      }

      current = current[Number(segment)];
      continue;
    }

    if (isPlainJsonObject(current)) {
      if (!Object.hasOwn(current, segment)) {
        return false;
      }

      current = current[segment];
      continue;
    }

    return false;
  }

  return true;
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertJsonValuesEqual(left: JsonValue, right: JsonValue, pointer: string): void {
  if (!jsonValuesEqual(left, right)) {
    throw new Error(`JSON Patch test failed at ${pointer || "/"}.`);
  }
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => jsonValuesEqual(item, right[index] as JsonValue));
  }

  if (isPlainJsonObject(left) || isPlainJsonObject(right)) {
    if (!isPlainJsonObject(left) || !isPlainJsonObject(right)) {
      return false;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
      return false;
    }

    return leftKeys.every((key) => jsonValuesEqual(left[key] as JsonValue, right[key] as JsonValue));
  }

  return false;
}

function describePatchOperation(
  operation: Exclude<JsonPatchOperation["op"], "test">,
  pointer: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined
): string {
  const target = pointer || "/";
  if (operation === "add") {
    return `Added ${previewDiffValue(after)} at ${target}`;
  }

  if (operation === "remove") {
    return `Removed ${previewDiffValue(before)} from ${target}`;
  }

  return `Changed ${target} from ${previewDiffValue(before)} to ${previewDiffValue(after)}`;
}

function previewDiffValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "missing value";
  }

  if (typeof value === "string") {
    return JSON.stringify(truncate(value, 80));
  }

  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }

  if (isPlainJsonObject(value)) {
    return `{${Object.keys(value).length} keys}`;
  }

  return String(value);
}

function parseDocument(text: string): {
  readonly json: JsonValue | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly locationMap: TextLocationMap;
} {
  try {
    const json = JSON.parse(text) as JsonValue;
    return {
      json,
      diagnostics: [],
      locationMap: buildTextLocationMap(text)
    };
  } catch (error) {
    const range = rangeFromJsonParseError(text, error);
    return {
      json: undefined,
      diagnostics: [
        makeDiagnostic({
          source: "syntax",
          pointer: "",
          message: error instanceof Error ? error.message : "Invalid JSON",
          range
        })
      ],
      locationMap: emptyLocationMap
    };
  }
}

function rangeFromJsonParseError(text: string, error: unknown): TextRange | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const positionMatch = /\bposition\s+(\d+)\b/u.exec(error.message);
  if (positionMatch === null) {
    return undefined;
  }

  const offset = Number(positionMatch[1]);
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return undefined;
  }

  const lineStarts = computeLineStarts(text);
  const start = positionForOffset(lineStarts, offset);
  const end = positionForOffset(lineStarts, Math.min(text.length, offset + 1));
  return { start, end };
}

function buildTextLocationMap(text: string): TextLocationMap {
  const parser = new JsonTextLocationParser(text);
  return parser.parse();
}

class JsonTextLocationParser {
  private readonly entriesByPointer = new Map<string, TextLocationEntry>();
  private readonly lineStarts: readonly number[];
  private index = 0;

  constructor(private readonly text: string) {
    this.lineStarts = computeLineStarts(text);
  }

  parse(): TextLocationMap {
    this.skipWhitespace();
    this.parseValue("", undefined);
    this.skipWhitespace();
    return createTextLocationMap(this.entriesByPointer);
  }

  private parseValue(pointer: string, key: TextRange | undefined): void {
    this.skipWhitespace();
    const start = this.index;
    const current = this.text[this.index];

    if (current === "{") {
      this.parseObject(pointer);
    } else if (current === "[") {
      this.parseArray(pointer);
    } else if (current === "\"") {
      this.parseStringToken();
    } else if (current === "-" || isDigit(current)) {
      this.parseNumberToken();
    } else if (this.text.startsWith("true", this.index)) {
      this.index += "true".length;
    } else if (this.text.startsWith("false", this.index)) {
      this.index += "false".length;
    } else if (this.text.startsWith("null", this.index)) {
      this.index += "null".length;
    } else {
      throw new Error(`Unexpected JSON token at offset ${this.index}.`);
    }

    this.entriesByPointer.set(pointer, {
      pointer,
      key,
      value: this.range(start, this.index)
    });
  }

  private parseObject(pointer: string): void {
    this.expect("{");
    this.skipWhitespace();

    if (this.peek() === "}") {
      this.index += 1;
      return;
    }

    while (this.index < this.text.length) {
      const keyToken = this.parseStringToken();
      this.skipWhitespace();
      this.expect(":");
      const childPointer = appendPointerSegment(pointer, keyToken.value);
      this.parseValue(childPointer, keyToken.range);
      this.skipWhitespace();

      if (this.peek() === "}") {
        this.index += 1;
        return;
      }

      this.expect(",");
      this.skipWhitespace();
    }

    throw new Error(`Unterminated object at offset ${this.index}.`);
  }

  private parseArray(pointer: string): void {
    this.expect("[");
    this.skipWhitespace();

    if (this.peek() === "]") {
      this.index += 1;
      return;
    }

    let itemIndex = 0;
    while (this.index < this.text.length) {
      this.parseValue(appendPointerSegment(pointer, String(itemIndex)), undefined);
      itemIndex += 1;
      this.skipWhitespace();

      if (this.peek() === "]") {
        this.index += 1;
        return;
      }

      this.expect(",");
      this.skipWhitespace();
    }

    throw new Error(`Unterminated array at offset ${this.index}.`);
  }

  private parseStringToken(): { readonly value: string; readonly range: TextRange } {
    const start = this.index;
    this.expect("\"");

    while (this.index < this.text.length) {
      const current = this.text[this.index];
      if (current === "\"") {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        return {
          value: JSON.parse(raw) as string,
          range: this.range(start, this.index)
        };
      }

      if (current === "\\") {
        this.index += 1;
        if (this.text[this.index] === "u") {
          this.index += 5;
        } else {
          this.index += 1;
        }
        continue;
      }

      this.index += 1;
    }

    throw new Error(`Unterminated string at offset ${start}.`);
  }

  private parseNumberToken(): void {
    const numberMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(this.text.slice(this.index));
    if (numberMatch === null) {
      throw new Error(`Invalid number at offset ${this.index}.`);
    }

    this.index += numberMatch[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek() ?? "")) {
      this.index += 1;
    }
  }

  private expect(expected: string): void {
    if (this.text[this.index] !== expected) {
      throw new Error(`Expected "${expected}" at offset ${this.index}.`);
    }

    this.index += 1;
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private range(start: number, end: number): TextRange {
    return {
      start: positionForOffset(this.lineStarts, start),
      end: positionForOffset(this.lineStarts, end)
    };
  }
}

function createTextLocationMap(entries: ReadonlyMap<string, TextLocationEntry>): TextLocationMap {
  const copiedEntries = new Map(entries);
  const orderedEntries = [...copiedEntries.values()].sort((left, right) => left.value.start.offset - right.value.start.offset);

  return {
    get(pointer, target = "value") {
      const entry = copiedEntries.get(pointer);
      return target === "key" ? entry?.key : entry?.value;
    },
    getEntry(pointer) {
      return copiedEntries.get(pointer);
    },
    entries() {
      return orderedEntries;
    }
  };
}

function computeLineStarts(text: string): readonly number[] {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

function positionForOffset(lineStarts: readonly number[], offset: number): TextPosition {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] as number;

    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] as number;
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
    offset
  };
}

function collectDefinitionPointers(root: JsonValue): ReadonlyMap<string, string> {
  const pointers = new Map<string, string>();
  const definitions = isPlainJsonObject(root) ? root._definitions : undefined;

  if (!isPlainJsonObject(definitions)) {
    return pointers;
  }

  for (const key of Object.keys(definitions)) {
    pointers.set(key, appendPointerSegment("/_definitions", key));
  }

  return pointers;
}

function countGraphChildren(value: JsonValue): number {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isPlainJsonObject(value)) {
    return Object.keys(value).length;
  }

  return 0;
}

function collectLocalReferenceEdges(
  value: JsonValue,
  pointer: string,
  ownerNodeId: string,
  edges: AuthoringGraphEdge[]
): void {
  if (typeof value === "string") {
    const targetPointer = localReferenceToPointer(value);
    if (targetPointer !== undefined) {
      edges.push({
        id: `${ownerNodeId}->ref:${value}`,
        from: ownerNodeId,
        to: targetPointer || "$",
        role: "references",
        label: value
      });
    }
    return;
  }

  if (!isPlainJsonObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== "string") {
      continue;
    }

    const targetPointer = localReferenceToPointer(child);
    if (targetPointer === undefined) {
      continue;
    }

    edges.push({
      id: `${ownerNodeId}->${appendPointerSegment(pointer, key)}:ref`,
      from: ownerNodeId,
      to: targetPointer || "$",
      role: "references",
      label: key
    });
  }
}

function resolveActiveBranchRootId(
  projection: AuthoringGraphProjection,
  selectedNodeId: string | undefined,
  explicitActiveBranchRootId: string | undefined
): string | undefined {
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  if (explicitActiveBranchRootId !== undefined && nodesById.has(explicitActiveBranchRootId)) {
    return explicitActiveBranchRootId;
  }

  if (selectedNodeId === undefined || selectedNodeId === "$") {
    return undefined;
  }

  const selectedPath = pathToRoot(nodesById, selectedNodeId);
  return selectedPath.find((nodeId) => nodesById.get(nodeId)?.parentId === "$");
}

function pathToRoot(nodesById: ReadonlyMap<string, AuthoringGraphNode>, nodeId: string): readonly string[] {
  const path: string[] = [];
  let current = nodesById.get(nodeId);

  while (current !== undefined) {
    path.unshift(current.id);
    current = current.parentId === undefined ? undefined : nodesById.get(current.parentId);
  }

  return path;
}

function inferNodeRole(value: JsonValue, pointer: string): AuthoringGraphNode["role"] {
  if (pointer === "") {
    return "document";
  }

  if (Array.isArray(value)) {
    return "collection";
  }

  if (isPlainJsonObject(value)) {
    if (isDefinitionPointer(pointer)) {
      return "definition";
    }

    if (typeof value.$ref === "string") {
      return "reference";
    }

    if (typeof value.type === "string" || typeof value.kind === "string") {
      return "typed-object";
    }

    if (hasDefinitionShape(value)) {
      return "definition";
    }

    return "object";
  }

  return "property";
}

function inferSemanticRole(value: JsonValue, pointer: string): AuthoringSemanticRole {
  if (pointer === "") {
    return "manifest-root";
  }

  const segments = parseJsonPointer(pointer);
  const last = normalizeToken(segments.at(-1));
  const parent = normalizeToken(segments.at(-2));
  const normalizedPath = segments.map(normalizeToken);
  const typeHint = isPlainJsonObject(value) && typeof value._type === "string" ? normalizeToken(value._type) : "";
  const semanticsHint = isPlainJsonObject(value) && typeof value._semantics === "string" ? normalizeToken(value._semantics) : "";
  const joinedSignals = `${typeHint} ${semanticsHint} ${normalizedPath.join(" ")}`;

  if (isDefinitionPointer(pointer)) {
    return "definition";
  }

  if (typeof value === "string" && localReferenceToPointer(value) !== undefined) {
    return "reference";
  }

  if (last === "$ref") {
    return "reference";
  }

  if (!Array.isArray(value) && !isPlainJsonObject(value)) {
    if (matchesAny(joinedSignals, ["metric", "score", "stat", "counter"]) || parent === "metrics") {
      return "metric";
    }

    return "property";
  }

  if (matchesAny(joinedSignals, ["asset", "image", "media", "sprite", "background", "audio", "video"])) {
    return "asset";
  }

  if (matchesAny(joinedSignals, ["screen", "page", "view"])) {
    return "ui-screen";
  }

  if (matchesAny(joinedSignals, ["component", "widget", "block", "button", "area", "layout", "panel", "topbar", "sidebar"])) {
    return "ui-component";
  }

  if (matchesAny(joinedSignals, ["action", "command", "handler", "operation"]) || parent === "actions") {
    return "action";
  }

  if (matchesAny(joinedSignals, ["condition", "guard", "predicate", "branch", "when", "if"]) || parent === "conditions") {
    return "condition";
  }

  if (matchesAny(joinedSignals, ["metric", "score", "stat", "counter"]) || parent === "metrics") {
    return "metric";
  }

  if (matchesAny(joinedSignals, ["state", "timeline"]) || parent === "state") {
    return "state";
  }

  if (matchesAny(joinedSignals, ["scenario", "flow", "root", "story", "content"])) {
    return "scenario";
  }

  if (matchesAny(joinedSignals, ["step", "stage", "sequence", "scene", "info", "choice"]) || matchesAny(parent, ["steps", "stages", "scenes", "infos", "choices"])) {
    return "step";
  }

  if (Array.isArray(value) || isPlainJsonObject(value)) {
    return "collection";
  }

  return "property";
}

function inferSemanticTitle(value: JsonValue, pointer: string, semanticRole: AuthoringSemanticRole): string {
  if (pointer === "") {
    const rootName = isPlainJsonObject(value) ? findNestedString(value, ["meta", "name"]) ?? findNestedString(value, ["name"]) : undefined;
    return rootName ?? "Authoring manifest";
  }

  if (isPlainJsonObject(value)) {
    for (const key of ["title", "name", "displayName", "id", "key", "_type"] as const) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim() !== "") {
        return compactTitle(candidate);
      }
    }
  }

  const last = lastPointerSegmentOrRoot(pointer);
  if (last !== "/" && !isArrayIndex(last)) {
    return titleFromToken(last);
  }

  const parent = parentPointer(pointer);
  const parentLabel = parent === undefined ? "item" : titleFromToken(lastPointerSegmentOrRoot(parent));
  return `${parentLabel} ${last}`;
}

function inferSemanticSummary(
  value: JsonValue,
  pointer: string,
  semanticRole: AuthoringSemanticRole,
  childCount: number
): string {
  if (isPlainJsonObject(value) && typeof value._semantics === "string" && value._semantics.trim() !== "") {
    return compactSummary(value._semantics);
  }

  if (Array.isArray(value)) {
    return `${childCount} items`;
  }

  if (isPlainJsonObject(value)) {
    const type = typeof value._type === "string" ? ` · ${shortTypeName(value._type)}` : "";
    return `${semanticRole}${type} · ${childCount} fields`;
  }

  return `${semanticRole} · ${getJsonValueType(value)}`;
}

function presentationRoleForSemanticRole(role: AuthoringSemanticRole): AuthoringPresentationRole {
  switch (role) {
    case "manifest-root":
      return "root";
    case "definition":
      return "definition";
    case "scenario":
    case "step":
      return "flow";
    case "action":
      return "operation";
    case "condition":
      return "decision";
    case "state":
      return "state";
    case "metric":
      return "metric";
    case "ui-screen":
      return "screen";
    case "ui-component":
      return "component";
    case "asset":
      return "asset";
    case "reference":
      return "reference";
    case "property":
      return "property";
    case "collection":
      return "collection";
  }
}

function isDefinitionPointer(pointer: string): boolean {
  const segments = parseJsonPointer(pointer);
  return segments.length >= 2 && segments[0] === "_definitions";
}

function hasDefinitionShape(value: JsonObject): boolean {
  return (
    typeof value.id === "string" ||
    typeof value.name === "string" ||
    typeof value.key === "string" ||
    typeof value.slug === "string"
  );
}

function normalizeToken(value: string | undefined): string {
  return (value ?? "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .toLowerCase();
}

function matchesAny(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function titleFromToken(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .trim();

  if (normalized === "") {
    return value;
  }

  return normalized
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 72) {
    return trimmed;
  }

  return `${trimmed.slice(0, 69)}...`;
}

function compactSummary(value: string): string {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (trimmed.length <= 140) {
    return trimmed;
  }

  return `${trimmed.slice(0, 137)}...`;
}

function shortTypeName(value: string): string {
  const parts = value.split(".");
  return parts[parts.length - 1] ?? value;
}

function findNestedString(value: JsonObject, path: readonly string[]): string | undefined {
  let current: JsonValue | undefined = value;

  for (const segment of path) {
    if (!isPlainJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" && current.trim() !== "" ? current : undefined;
}

function lastPointerSegmentOrRoot(pointer: string): string {
  if (pointer === "") {
    return "/";
  }

  const segments = parseJsonPointer(pointer);
  return segments[segments.length - 1] ?? "/";
}

function getJsonValueType(value: JsonValue): AuthoringGraphNode["valueType"] {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value as AuthoringGraphNode["valueType"];
}

function buildMissingContainer(remainingSegments: readonly string[]): JsonValue {
  const next = remainingSegments[0];
  return next !== undefined && (next === "-" || isArrayIndex(next)) ? [] : {};
}

function appendPointerSegment(pointer: string, segment: string): string {
  return buildJsonPointer([...parseJsonPointer(pointer), segment]);
}

function lastPointerSegment(pointer: string): string {
  const segments = parseJsonPointer(pointer);
  const last = segments.at(-1);
  if (last === undefined) {
    throw new Error("Root pointer does not have a last segment.");
  }

  return last;
}

function parentPointer(pointer: string): string | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments.length === 0) {
    return undefined;
  }

  return buildJsonPointer(segments.slice(0, -1));
}

function readParentValue(root: JsonValue, pointer: string): JsonValue | undefined {
  const parent = parentPointer(pointer);
  return parent === undefined ? undefined : readJsonPointer(root, parent);
}

function pointerToLocalReference(pointer: string): string {
  parseJsonPointer(pointer);
  return pointer === "" ? "#" : `#${pointer}`;
}

function localReferenceToPointer(ref: string): string | undefined {
  if (ref === "#") {
    return "";
  }

  if (!ref.startsWith("#/")) {
    return undefined;
  }

  try {
    return decodeURI(ref.slice(1));
  } catch {
    return ref.slice(1);
  }
}

function isArrayIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/u.test(segment);
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9]$/u.test(value);
}

function isPlainJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: JsonValue | undefined): value is Exclude<JsonPrimitive, null> {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

const emptyLocationMap: TextLocationMap = {
  get() {
    return undefined;
  },
  getEntry() {
    return undefined;
  },
  entries() {
    return [];
  }
};
