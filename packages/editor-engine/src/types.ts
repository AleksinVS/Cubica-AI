/**
 * Shared public type contracts for the editor engine (ADR-034).
 *
 * This module holds every framework-agnostic type, interface, and type alias
 * that the editor engine exposes. Splitting the pure type surface out of the
 * behavioural modules keeps the value modules small and lets a newcomer read
 * the whole public data model in one place. There is NO runtime code here.
 *
 * These types are re-exported verbatim from `index.ts`, so the public import
 * surface (`@cubica/editor-engine`) is unchanged.
 */
import { type AnySchema, type Options as AjvOptions } from "ajv";

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
  /**
   * Optional stable diagnostic code from the editor diagnostic registry
   * (design-spec §4), for example `fixture-stale` or `fixture-unknown-ref`.
   * Absent for the older schema/semantic diagnostics that predate the registry;
   * present on newer checks so UI layers can group and navigate by code.
   */
  readonly code?: string;
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

/**
 * Operation risk level for an editor ChangeSet (ADR-057 §4.5, §5).
 *
 * - `safe`:       replace of a leaf value (text, label, style, number).
 * - `structural`: add/remove of collection elements or fields, reordering, or
 *                 file/text operations inside authoring/assets.
 * - `dangerous`:  id change, reference retargeting, deletion of an entity with
 *                 incoming references, or a file operation outside
 *                 authoring/assets. Dangerous changes require an approval
 *                 envelope (ADR-047) before apply.
 */
export type ChangeRisk = "safe" | "structural" | "dangerous";

/** Result of classifying a ChangeSet: the highest risk plus its reasons. */
export interface ClassifyChangeSetResult {
  readonly risk: ChangeRisk;
  /** Human-readable reasons for the summary and approval envelope (English). */
  readonly reasons: readonly string[];
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

/**
 * Whether a tree node is an entity's canonical position or a repeat appearance.
 *
 * A single editor entity (ADR-057 §4.6) can surface at several places in the
 * entity tree. The one canonical position for the active grouping mode is
 * `primary`; every additional appearance of THE SAME entity is an `occurrence`
 * ("вхождение" — the same object shown again, never a copy). Nodes that map to
 * no entity default to `primary`, so single-appearance trees are unchanged.
 */
export type TreeViewNodeOccurrenceKind = "primary" | "occurrence";

/**
 * Marks a SYNTHETIC grouping/header node in the grouped entity tree
 * (`buildEntityGroupingTreeViewModel`, ADR-057 §4.6, editor-preview-first-ux §7).
 *
 * These nodes are containers, not entities, so they carry no `entityId`:
 * - `"prototype"` — a type/prototype header row in the "По типам" inventory; its
 *   children are the instances of that type. Prototype rows are deliberately
 *   distinguishable from instance rows (§7: «прототип против экземпляра»).
 * - `"screen-logic"` — the collapsed "Логика экрана" subgroup under a screen in
 *   the "По экранам" outliner; its children are the non-visual entities bound to
 *   the screen (editor-preview-first-ux §2.1).
 */
export type TreeViewNodeGroupingRole = "prototype" | "screen-logic";

/**
 * Per-entity diagnostic severity counts for a tree node's badge (design-spec
 * §5 «бейджи диагностик на узлах»). Pure DATA for the UI badge — this module
 * never renders. Counts come from the entity's projection diagnostics, keyed by
 * the node's `entityId`.
 */
export interface TreeViewNodeDiagnosticSeverityCounts {
  readonly error: number;
  readonly warning: number;
}

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
   *
   * This is the `nodeId` from ADR-057 §4.6: unique within the tree (it already
   * encodes the occurrence path via the JSON Pointer). Occurrences share an
   * `entityId` but always keep distinct `id`s.
   */
  readonly id: string;
  /**
   * Editor entity this node belongs to (ADR-057 §4.6), shared by every
   * occurrence of the same entity.
   *
   * Populated only for the entity tree and only when an
   * `EditorEntityProjection` (ADR-052) is supplied to the builder. The tree
   * reads this link from the projection and never builds its own entity index.
   * `undefined` means the node maps to no projection entity (or no projection
   * was given), which keeps the pointer-complete JSON tree unaffected.
   */
  readonly entityId?: string;
  /**
   * Whether this node is the entity's canonical position (`primary`) or a
   * repeat appearance of the same entity elsewhere (`occurrence`).
   *
   * Defaults to `primary` for every node — including nodes with no `entityId`
   * and every node of the pointer-complete JSON tree — so existing
   * single-appearance trees keep their behaviour.
   */
  readonly occurrenceKind: TreeViewNodeOccurrenceKind;
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
  /**
   * Projection kind of the entity this node represents (icons, screen-vs-element
   * styling). Populated by the grouped entity tree
   * (`buildEntityGroupingTreeViewModel`); `undefined` on synthetic grouping nodes
   * and on the pointer-complete/plain entity trees.
   */
  readonly entityKind?: EditorEntityKind;
  /**
   * Synthetic grouping-node marker (prototype header / "Логика экрана" subgroup).
   * `undefined` for real entity nodes and the document root. See
   * `TreeViewNodeGroupingRole`.
   */
  readonly groupingRole?: TreeViewNodeGroupingRole;
  /**
   * `true` when the node represents a NON-VISUAL entity or a non-visual type
   * group — an entity without its own display in the active channel (rule,
   * metric, action, timer, step). ADR-057 §4.2, editor-preview-first-ux §2.1.
   */
  readonly isNonVisual?: boolean;
  /**
   * `true` when the node is a UI element declared DECORATIVE (`_decorative`) in
   * the authoring manifest. Decorative elements are marked, never hidden, so they
   * do not add entity-orphan noise (editor-preview-first-ux §2.1).
   */
  readonly isDecorative?: boolean;
  /**
   * `true` on the active screen node in the "По экранам" grouping. A UI layer
   * auto-reveals/expands this node (auto-reveal itself is UI; this is just the
   * flag). ADR-057 §4.6, editor-preview-first-ux §7.
   */
  readonly isActiveContext?: boolean;
  /**
   * Location breadcrumb for an instance in the "По типам" grouping — the ordered
   * labels of the container ancestors (screen, flow, named parent instance),
   * outermost first, e.g. `["Экран Маршрут"]`. Data only; the UI renders the
   * «Экран Маршрут ›» crumb. editor-preview-first-ux §7, design-spec §3.1.
   */
  readonly locationBreadcrumb?: readonly string[];
  /**
   * Diagnostic severity counts for this node's entity, used for the tree badge
   * (design-spec §5). Present only when the entity has projection diagnostics.
   */
  readonly diagnosticSeverityCounts?: TreeViewNodeDiagnosticSeverityCounts;
  readonly actions: TreeViewNodeActionHints;
  readonly children: readonly TreeViewNode[];
}

export interface TreeViewModel {
  readonly root: TreeViewNode;
  /** Pre-order list of all nodes for fast search. */
  readonly flatNodes: readonly TreeViewNode[];
  /** Lookup map for pointer-based selection sync. */
  readonly nodeByPointer: ReadonlyMap<string, TreeViewNode>;
  /**
   * All nodes grouped by their `entityId` (ADR-057 §4.6).
   *
   * Selecting an entity uses this inverse index to find and soft-highlight
   * every occurrence at once. Exactly one node per entity is `primary`; the
   * rest are `occurrence`. Empty when no `EditorEntityProjection` was supplied
   * (for example the pointer-complete JSON tree always leaves it empty).
   */
  readonly nodesByEntityId: ReadonlyMap<string, readonly TreeViewNode[]>;
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

/**
 * Input for the entity tree projection.
 *
 * Extends `BuildTreeViewModelInput` with the optional editor entity projection.
 * When `projection` is supplied, entity-tree nodes are tagged with
 * `entityId`/`occurrenceKind` and grouped in `TreeViewModel.nodesByEntityId`;
 * without it the tree behaves exactly as before (every node `primary`, no
 * `entityId`). The tree reads entity links from the projection and never builds
 * its own entity index (ADR-057 §4.6).
 */
export interface BuildEntityTreeViewModelInput extends BuildTreeViewModelInput {
  /**
   * Editor entity projection (ADR-052) used to connect tree nodes to entities.
   *
   * The projection's source pointers must address the same document as
   * `snapshot` (matched by `snapshot.filePath`). Cross-document occurrences are
   * out of scope for this single-document tree.
   */
  readonly projection?: EditorEntityProjection;
}

/**
 * Grouping mode for the grouped entity tree (ADR-057 §4.6,
 * editor-preview-first-ux §7):
 * - `"byScreen"` — outliner: top level is every screen of the active channel;
 *   nesting inside a screen mirrors the display; non-visual entities bound to the
 *   screen live in a collapsed "Логика экрана" subgroup.
 * - `"byType"` — inventory: top level is prototypes/types; each holds its
 *   instances (with a location breadcrumb) which expand into their UI structure.
 */
export type EntityTreeGrouping = "byScreen" | "byType";

/**
 * Input for `buildEntityGroupingTreeViewModel`.
 *
 * The grouped tree is built OVER an `EditorEntityProjection` (the single source
 * of entity identity, links and diagnostics; ADR-052/ADR-057 §4.6). The
 * `documents` that produced the projection are also passed — exactly as
 * `buildEditorEntityYamlProjection` takes them — because the DECLARATIVE authoring
 * fields the grouping needs (`_type` for the type/prototype bucket, `_decorative`
 * for the decorative flag) live in the authoring JSON, not in the projection
 * records. The node ≠ entity separation (occurrences) is preserved.
 */
export interface BuildEntityGroupingTreeViewModelInput {
  readonly projection: EditorEntityProjection;
  readonly grouping: EntityTreeGrouping;
  /** The same authoring documents used to build `projection`. */
  readonly documents: readonly EditorEntityProjectionDocument[];
  /**
   * Active preview channel key. In `"byScreen"` the top level is exactly the
   * screens of this channel; when omitted every UI screen is shown.
   */
  readonly activeChannel?: string;
  /**
   * Entity id of the active screen for the `"byScreen"` auto-reveal flag. When
   * omitted the first screen (document order) is treated as active.
   */
  readonly activeScreenEntityId?: string;
  /** Max length for scalar previews; longer values are truncated. */
  readonly maxValuePreviewLength?: number;
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
  | "hidden-technical-field"
  // Identity-discipline diagnostics (ADR-057 §4.2; editor-preview-first-ux §2.1).
  // Both are driven by the DECLARATIVE authoring flags `_requiresView` /
  // `_decorative`, never by a hardcoded list of types in engine code (ADR-057 §5).
  | "entity-view-orphan"
  | "entity-missing-view";

/**
 * Declarative "requires view" annotation for a game entity type/prototype
 * (`_requiresView` in authoring manifests; SSOT in
 * manifest-authoring-common.schema.json). `true` requires a view in every
 * preview channel; the object form limits the requirement to named channels.
 * Authoring-only: the compiler strips it and it never reaches runtime manifests.
 */
export type RequiresViewDeclaration = boolean | { readonly channels: readonly string[] };

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
  /**
   * Active preview channel key (for example "web", "telegram"). The
   * `entity-missing-view` diagnostic is computed per channel: a game entity that
   * declares `_requiresView` for this channel but has no `view` facet resolving
   * there is reported. When omitted, "requires a view" degrades to "has any view
   * facet in any channel" (ADR-057 §4.2, editor-preview-first-ux §2.1).
   */
  readonly activeChannel?: string;
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

/**
 * Read-dependency declaration for one projection lens (ADR-057 §4.13, UX §10).
 *
 * A "projection lens" (линза проекции) is one bounded reader inside the
 * entity-projection builder: it walks a fixed part of an authoring document and
 * emits editor entities plus their source pointers. Declaring WHICH pointer
 * subtrees a lens reads is the foundation for the future incremental cache
 * (Phase 2.1): a changed pointer only needs to re-run the lenses whose declared
 * subtrees it touches, instead of rebuilding the whole projection.
 *
 * This is a pure DECLARATION contract; on its own it drives no caching yet.
 */
export interface ProjectionLens {
  /** Stable lens identifier, unique inside the lens set. */
  readonly id: string;
  /**
   * Document kinds this lens applies to. Absent means "any document kind" and
   * is used by input-driven lenses that can touch several documents at once.
   */
  readonly documentKinds?: readonly EditorEntityDocumentKind[];
  /**
   * JSON Pointer prefixes the lens reads inside each matching document.
   *
   * A prefix is a JSON Pointer to the root of a subtree the lens reads. The
   * empty string `""` means the lens can read the whole document; it is used
   * when the read set is not expressible as fixed subtrees (for example
   * runtime-supplied pointers). Over-declaring a broader prefix is always SAFE:
   * it can only cause an extra rebuild, never a missed invalidation.
   */
  readonly readPointerPrefixes: readonly string[];
}

/**
 * Changed JSON Pointers grouped by authoring file path.
 *
 * This is exactly the shape `collectAffectedEntities` consumes and the shape a
 * DocumentStore/JSON Patch edit naturally produces: the editor knows which
 * pointers a patch touched. An empty array for a file means "this file changed
 * but the touched pointers are unknown" — the incremental updater treats that as
 * a signal to fall back to a full rebuild (UX §10). The empty pointer `""` means
 * the whole file changed.
 */
export type ChangedPointersByFile = Readonly<Record<string, readonly string[]>>;

/**
 * A projection paired with the input that produced it (ADR-057 §4.13, UX §10
 * "Уровень 1").
 *
 * `updateEditorEntityProjection` diffs the NEXT input against this state to
 * decide what to rebuild. The state is a plain value and is NEVER mutated: the
 * incremental cache is not a source of truth (ADR-057 §5), so each update returns
 * a fresh state that reuses untouched entity records by reference.
 */
export interface EditorEntityProjectionState {
  readonly projection: EditorEntityProjection;
  /** The build input that produced `projection`; used only to diff the next input. */
  readonly input: BuildEditorEntityProjectionInput;
}

/** How `updateEditorEntityProjection` produced its result (telemetry, design-spec §5). */
export type IncrementalProjectionMode = "full" | "incremental";

/**
 * Telemetry for one incremental projection update (design-spec §5: "длительность
 * инкрементальной инвалидации" + rebuilt-entities counter). Mirrors the shape of
 * the Level-3 compile telemetry.
 */
export interface IncrementalProjectionReport {
  readonly mode: IncrementalProjectionMode;
  /** Machine-readable reason the mode was chosen (for example "full:link-change"). */
  readonly reason: string;
  /** Entity ids whose records were recomputed this update (empty for a no-op or a full rebuild). */
  readonly rebuiltEntityIds: readonly string[];
  /** Count of previous entity records reused by reference (0 for a full rebuild). */
  readonly reusedEntityCount: number;
  /** Wall-clock duration of the update in milliseconds. */
  readonly durationMs: number;
}

/** Result of `updateEditorEntityProjection`: the new state plus its telemetry. */
export interface UpdateEditorEntityProjectionResult {
  readonly state: EditorEntityProjectionState;
  readonly report: IncrementalProjectionReport;
}

/** Next-step input for `updateEditorEntityProjection`. */
export interface UpdateEditorEntityProjectionInput {
  /** The new build input (new document snapshots plus options). */
  readonly input: BuildEditorEntityProjectionInput;
  /** Pointers touched since the previous state, grouped by file. */
  readonly changedPointersByFile: ChangedPointersByFile;
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
