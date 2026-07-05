/**
 * JSON tree view models for the editor.
 *
 * Two projections live here: `buildTreeViewModel` produces a pointer-complete
 * tree (every JSON node addressable), while `buildEntityTreeViewModel` produces
 * a preview-first tree that shows only tree-visible semantic entities and hides
 * technical containers. Both models are immutable and framework-agnostic; UI
 * layers keep collapse/expand state separately and route edits back through
 * JSON Patch.
 *
 * The entity tree separates NODE identity from ENTITY identity (ADR-057 §4.6):
 * one entity can surface at several nodes ("вхождения"/occurrences). When an
 * `EditorEntityProjection` (ADR-052) is supplied, each node carries the
 * `entityId` it belongs to and an `occurrenceKind` ("primary" for the canonical
 * position, "occurrence" for repeat appearances), and the model exposes an
 * `entityId -> nodes` inverse index. Entity links come only from the projection;
 * this module never builds its own entity index.
 */
import { isPlainJsonObject, compactSummary, shortTypeName, truncate } from "./shared.ts";
import { appendPointerSegment, buildJsonPointer, parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isSameOrDescendantPointer, isTreeVisibleSemanticEntity, resolveEntityTreeLabel } from "./semantics.ts";
import type {
  AuthoringGraphProjection,
  BuildEntityTreeViewModelInput,
  BuildTreeViewModelInput,
  DocumentDiagnostic,
  EditorEntityProjection,
  JsonObject,
  JsonValue,
  TreeViewModel,
  TreeViewNode,
  TreeViewNodeKind,
  TreeViewNodeOccurrenceKind,
  TreeViewNodeValueType
} from "./types.ts";

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

/**
 * Builds a pointer-complete JSON tree view model for ADR-034.
 *
 * The model is framework-agnostic and immutable. UI layers are expected to keep
 * collapse/expand state separately (UI-only state), and route edits back into
 * the editor via JSON Patch operations rather than mutating this model.
 *
 * NOTE: test-only export (LEGACY-0018): no production consumer imports this
 * class directly — `buildTreeViewModel` is the production entry point — but it
 * is exercised by `tests/index.test.ts`, so it stays exported.
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
        // The pointer-complete JSON tree carries no entity semantics: every
        // node is its own primary appearance and never maps to a projection
        // entity. Occurrence tagging lives in `buildEntityTreeViewModel`.
        occurrenceKind: "primary",
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
        occurrenceKind: "primary",
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
      return { root, flatNodes, nodeByPointer, nodesByEntityId: new Map() };
    }

    const rootNode = buildNode(snapshot.json, "", undefined, "/", "document");
    return { root: rootNode, flatNodes, nodeByPointer, nodesByEntityId: new Map() };
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
 *
 * When `input.projection` is supplied, nodes are additionally tagged with
 * `entityId`/`occurrenceKind` and grouped in `nodesByEntityId` so a UI layer can
 * treat every occurrence of one entity as "the same object" (ADR-057 §4.6).
 * Without a projection the output is byte-for-byte the previous behaviour: every
 * node `primary`, no `entityId`, and an empty `nodesByEntityId`.
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
  // Inverse index `entityId -> nodes`, so a UI layer can find and soft-highlight
  // every occurrence of one entity from a single selection (ADR-057 §4.6).
  const nodesByEntityId = new Map<string, TreeViewNode[]>();
  // Resolves which editor entity a tree node belongs to. The projection is the
  // single source of entity links (ADR-052/ADR-057 §4.6): the tree never builds
  // its own index. A node is `primary` when it sits at an entity's canonical
  // `primarySource`; otherwise, if the projection lists this pointer among an
  // entity's facet sources, the node is an additional `occurrence` of that
  // entity. Deterministic tie-break: lowest `entityId` wins.
  const resolveNodeEntity = createEntityTreeNodeResolver(input.projection, snapshot.filePath);

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
    const entityBinding = resolveNodeEntity(entry.pointer);
    const node: TreeViewNode = {
      id: entry.pointer,
      entityId: entityBinding.entityId,
      occurrenceKind: entityBinding.occurrenceKind,
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
    if (node.entityId !== undefined) {
      const siblings = nodesByEntityId.get(node.entityId);
      if (siblings === undefined) {
        nodesByEntityId.set(node.entityId, [node]);
      } else {
        siblings.push(node);
      }
    }
    return node;
  };

  const rootChildren = (childrenByParentPointer.get("") ?? []).map(buildEntityNode);
  const rootDiagnostics = diagnostics.filter((diagnostic) => diagnostic.pointer === "");
  const root: TreeViewNode = {
    id: "$entities",
    // The synthetic "Entities" root is a navigation container, not an entity.
    occurrenceKind: "primary",
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

  return { root, flatNodes, nodeByPointer, nodesByEntityId };
}

/**
 * Result of mapping one entity-tree node to its editor entity.
 *
 * `entityId` is shared by every occurrence of the same entity; `occurrenceKind`
 * distinguishes the canonical position from repeat appearances.
 */
interface EntityTreeNodeBinding {
  readonly entityId?: string;
  readonly occurrenceKind: TreeViewNodeOccurrenceKind;
}

/**
 * Builds the per-node entity resolver for the entity tree.
 *
 * Without a projection (or for the document root), every node is its own
 * `primary` appearance with no `entityId`, so the tree behaves exactly as it
 * did before this slice. With a projection, entity links come only from the
 * projection (ADR-052/ADR-057 §4.6): the tree does not build its own index.
 *
 * The projection keys source pointers as `"<filePath>#<pointer>"`, so a node is
 * matched only inside the document the projection was built over (matched by
 * `filePath`). Cross-document occurrences are out of scope for this
 * single-document tree.
 */
function createEntityTreeNodeResolver(
  projection: EditorEntityProjection | undefined,
  filePath: string
): (pointer: string) => EntityTreeNodeBinding {
  const primaryBinding: EntityTreeNodeBinding = { occurrenceKind: "primary" };

  if (projection === undefined) {
    return () => primaryBinding;
  }

  return (pointer: string): EntityTreeNodeBinding => {
    if (pointer === "") {
      return primaryBinding;
    }

    const candidates = projection.entitiesBySourcePointer.get(`${filePath}#${pointer}`);
    if (candidates === undefined || candidates.length === 0) {
      return primaryBinding;
    }

    // Prefer the entity whose canonical `primarySource` is exactly this node:
    // that entity owns the node as its `primary` appearance.
    const owner = candidates.find((entity) => entity.primarySource.pointer === pointer);
    if (owner !== undefined) {
      return { entityId: owner.entityId, occurrenceKind: "primary" };
    }

    // Otherwise this pointer is a facet source of one or more entities but the
    // canonical position of none, so it is an additional `occurrence`. Pick the
    // lowest `entityId` for a stable, deterministic binding.
    const occurrenceOwner = candidates.reduce((lowest, entity) =>
      entity.entityId.localeCompare(lowest.entityId) < 0 ? entity : lowest
    );
    return { entityId: occurrenceOwner.entityId, occurrenceKind: "occurrence" };
  };
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

function previewEntityTreeValue(value: JsonValue, maxLength: number): string {
  if (!isPlainJsonObject(value)) {
    return previewTreeValue(value, inferTreeKind(value, ""), maxLength);
  }

  const type = typeof value._type === "string" && value._type.trim() !== "" ? shortTypeName(value._type) : "entity";
  const semantics = typeof value._semantics === "string" && value._semantics.trim() !== "" ? compactSummary(value._semantics) : "";
  return truncate(semantics === "" ? type : `${type} · ${semantics}`, maxLength);
}
