/**
 * Authoring graph projection.
 *
 * Turns an arbitrary authoring JSON document into an addressable node/edge graph
 * for the editor canvas, and derives the canvas-ready visible subset from an
 * expansion state. Nodes stay addressable by JSON Pointer so the graph, JSON
 * tree, and inspector can share selection. Semantic roles/titles come from
 * `role-inference`; this module only walks structure and wires containment,
 * definition, and reference edges.
 */
import { getJsonValueType, isPlainJsonObject } from "./shared.ts";
import { appendPointerSegment, lastPointerSegmentOrRoot, localReferenceToPointer } from "./json-pointer-patch.ts";
import { isDefinitionPointer } from "./semantics.ts";
import {
  inferSemanticRole,
  inferSemanticSummary,
  inferSemanticTitle,
  presentationRoleForSemanticRole
} from "./role-inference.ts";
import type {
  AuthoringGraphEdge,
  AuthoringGraphExpansionState,
  AuthoringGraphNode,
  AuthoringGraphProjection,
  DocumentSnapshot,
  JsonObject,
  JsonValue,
  VisibleAuthoringGraphProjection
} from "./types.ts";

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

function hasDefinitionShape(value: JsonObject): boolean {
  return (
    typeof value.id === "string" ||
    typeof value.name === "string" ||
    typeof value.key === "string" ||
    typeof value.slug === "string"
  );
}
