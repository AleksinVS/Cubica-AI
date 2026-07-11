/**
 * Generic deterministic transport-network construction primitives.
 *
 * The module knows only declared network models and authoritative object
 * collections. Game names, map labels and team identities remain manifest data.
 */
import jsonLogic from "json-logic-js";
import type {
  GameManifestConstructionPayment,
  GameManifestDeterministicEffect,
  GameManifestObjectFacetValue,
  GameManifestObjectModelMap,
  GameManifestNumericExpression,
  GameManifestTransportNetworkModel,
  GameManifestTransportNetworkModelMap
} from "@cubica/contracts-manifest";
import type { RuntimeResolvedReference } from "@cubica/contracts-runtime";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type Point = { x: number; y: number };

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const decodePointer = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");
const pointerParts = (path: string) => path.startsWith("/")
  ? path.slice(1).split("/").map(decodePointer)
  : [];

const safePointerParts = (path: string): Array<string> => {
  const parts = pointerParts(path);
  if (parts.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) {
    throw new Error("Transport path contains a forbidden segment");
  }
  return parts;
};

const readPointer = (root: JsonRecord, path: string): unknown => {
  let current: unknown = root;
  for (const part of safePointerParts(path)) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
};

const writePointer = (root: JsonRecord, path: string, value: unknown) => {
  const parts = safePointerParts(path);
  if (parts.length === 0 || (!path.startsWith("/public/") && !path.startsWith("/secret/"))) {
    throw new Error(`Transport network cannot write path "${path}"`);
  }
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as JsonRecord;
  }
  current[parts[parts.length - 1]] = value;
};

const stateCollection = (
  state: RuntimeState,
  model: GameManifestTransportNetworkModel,
  collectionId: string
): JsonRecord => {
  const root = isRecord(state[model.visibility]) ? state[model.visibility] as JsonRecord : {};
  const objects = isRecord(root.objects) ? root.objects : {};
  const collection = isRecord(objects[collectionId]) ? objects[collectionId] : {};
  objects[collectionId] = collection;
  root.objects = objects;
  state[model.visibility] = root;
  return collection;
};

const pointFromObject = (object: JsonRecord | undefined): Point => {
  const attributes = isRecord(object?.attributes) ? object.attributes : {};
  const position = isRecord(attributes.position) ? attributes.position : {};
  if (typeof position.x !== "number" || !Number.isFinite(position.x) ||
      typeof position.y !== "number" || !Number.isFinite(position.y)) {
    throw new Error("Transport node is missing a finite canonical position");
  }
  return { x: position.x, y: position.y };
};

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** Return the position `t` where AB crosses CD, ignoring parallel/collinear lines. */
const intersectionT = (a: Point, b: Point, c: Point, d: Point): number | undefined => {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const offset = subtract(c, a);
  const t = cross(offset, s) / denominator;
  const u = cross(offset, r) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
};

const interpolate = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});

const pointOnSegment = (point: Point, a: Point, b: Point): boolean => {
  const area = Math.abs(cross(subtract(point, a), subtract(b, a)));
  if (area > 1e-9) return false;
  return point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9 &&
    point.y >= Math.min(a.y, b.y) - 1e-9 && point.y <= Math.max(a.y, b.y) + 1e-9;
};

const pointInPolygon = (point: Point, polygon: Array<Point>): boolean => {
  // Boundary convention: a line lying on or merely touching a region boundary
  // does not create a paid inside-region segment. This removes vertex ambiguity.
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return false;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) /
        (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

/** Count continuous portions of AB lying inside declared regions. */
const countRegionSegments = (a: Point, b: Point, model: GameManifestTransportNetworkModel): number => {
  let count = 0;
  for (const region of model.regions) {
    const boundaries = [0, 1];
    for (let index = 0; index < region.polygon.length; index += 1) {
      const t = intersectionT(
        a,
        b,
        region.polygon[index],
        region.polygon[(index + 1) % region.polygon.length]
      );
      if (t !== undefined) boundaries.push(t);
    }
    const sorted = [...new Set(boundaries.map((value) => Math.round(value * 1e9) / 1e9))]
      .sort((left, right) => left - right);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const midpoint = (sorted[index] + sorted[index + 1]) / 2;
      if (pointInPolygon(interpolate(a, b, midpoint), region.polygon)) count += 1;
    }
  }
  return count;
};

const numericExpression = (
  value: GameManifestNumericExpression,
  state: RuntimeState,
  params: Record<string, unknown>
): number => {
  const raw = typeof value === "object" && value !== null
    ? jsonLogic.apply(value as Parameters<typeof jsonLogic.apply>[0], { ...state, params })
    : value;
  const amount = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Construction payment must be a finite non-negative integer");
  }
  return amount;
};

const applyPayments = (
  state: RuntimeState,
  payments: Array<GameManifestConstructionPayment>,
  expectedCost: number,
  params: Record<string, unknown>
) => {
  const resolved = payments.map((payment) => ({
    path: payment.balancePath,
    amount: numericExpression(payment.amount, state, params),
    balance: readPointer(state, payment.balancePath)
  }));
  const total = resolved.reduce((sum, payment) => sum + payment.amount, 0);
  if (Math.abs(total - expectedCost) > 1e-9) {
    throw new Error(`Construction payments must exactly cover calculated cost ${expectedCost}`);
  }
  for (const payment of resolved) {
    if (typeof payment.balance !== "number" || !Number.isFinite(payment.balance) || payment.balance < payment.amount) {
      throw new Error("Construction payment cannot make a balance negative");
    }
  }
  for (const payment of resolved) {
    writePointer(state, payment.path, (payment.balance as number) - payment.amount);
  }
};

const initialFacets = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  override?: { facet: string; value: GameManifestObjectFacetValue }
): Record<string, GameManifestObjectFacetValue> => {
  const objectModel = objectModels?.[objectType];
  if (!objectModel || objectModel.collection !== collection || objectModel.scope !== "session") {
    throw new Error(`Transport object type "${objectType}" is not declared for collection "${collection}"`);
  }
  const facets = Object.fromEntries(
    Object.entries(objectModel.facets).map(([facet, definition]) => [facet, definition.initial])
  );
  if (override) {
    const definition = objectModel.facets[override.facet];
    if (!definition || !definition.values.includes(override.value)) {
      throw new Error(`Transport facet "${override.facet}" does not allow built state`);
    }
    facets[override.facet] = override.value;
  }
  return facets;
};

const allocateId = (
  state: RuntimeState,
  model: GameManifestTransportNetworkModel,
  networkId: string,
  kind: "node" | "edge",
  collection: JsonRecord
): string => {
  let sequence = Number(readPointer(state, model.sequencePath));
  if (!Number.isSafeInteger(sequence) || sequence < 0) sequence = 0;
  let id: string;
  do {
    sequence += 1;
    id = `${networkId}:${kind}:${sequence}`;
  } while (collection[id] !== undefined);
  writePointer(state, model.sequencePath, sequence);
  return id;
};

const requireReference = (
  refs: Record<string, RuntimeResolvedReference>,
  paramName: string,
  collection: string,
  networkId: string
): RuntimeResolvedReference => {
  const ref = refs[paramName];
  if (!ref || ref.collection !== collection || ref.network !== networkId) {
    throw new Error(`Transport parameter "${paramName}" is not a validated network reference`);
  }
  return ref;
};

const edgeEndpoints = (edge: JsonRecord): { fromNodeId: string; toNodeId: string } => {
  const attributes = isRecord(edge.attributes) ? edge.attributes : {};
  if (typeof attributes.fromNodeId !== "string" || typeof attributes.toNodeId !== "string") {
    throw new Error("Transport edge is missing endpoints");
  }
  return { fromNodeId: attributes.fromNodeId, toNodeId: attributes.toNodeId };
};

const assertAllowedFacetState = (
  object: JsonRecord | undefined,
  facet: string,
  allowed: Array<GameManifestObjectFacetValue>,
  resourceKind: string
) => {
  const facets = isRecord(object?.facets) ? object.facets : {};
  if (!allowed.includes(facets[facet] as GameManifestObjectFacetValue)) {
    throw new Error(`Selected transport ${resourceKind} is not available for construction`);
  }
};

export interface ApplyTransportEffectOptions {
  state: RuntimeState;
  effect: Extract<GameManifestDeterministicEffect, { op: "transport.road.build" | "transport.waypoint.build" }>;
  params: Record<string, unknown>;
  resolvedRefs: Record<string, RuntimeResolvedReference>;
  networkModels?: GameManifestTransportNetworkModelMap;
  objectModels?: GameManifestObjectModelMap;
}

/** Apply one schema-validated composite graph mutation to the cloned action state. */
export const applyTransportEffect = (options: ApplyTransportEffectOptions): Record<string, unknown> => {
  const { state, effect, params, resolvedRefs, objectModels } = options;
  const model = options.networkModels?.[effect.networkId];
  if (!model) throw new Error(`Transport network "${effect.networkId}" is not declared`);
  const nodes = stateCollection(state, model, model.nodeCollection);
  const edges = stateCollection(state, model, model.edgeCollection);

  if (effect.op === "transport.road.build") {
    const fromRef = requireReference(resolvedRefs, effect.fromNodeParam, model.nodeCollection, effect.networkId);
    const toRef = requireReference(resolvedRefs, effect.toNodeParam, model.nodeCollection, effect.networkId);
    if (fromRef.id === toRef.id) throw new Error("A transport road requires two different nodes");
    const fromNode = isRecord(nodes[fromRef.id]) ? nodes[fromRef.id] as JsonRecord : undefined;
    const toNode = isRecord(nodes[toRef.id]) ? nodes[toRef.id] as JsonRecord : undefined;
    assertAllowedFacetState(fromNode, model.nodeStateFacet, model.buildableNodeStates, "node");
    assertAllowedFacetState(toNode, model.nodeStateFacet, model.buildableNodeStates, "node");
    const from = pointFromObject(fromNode);
    const to = pointFromObject(toNode);
    for (const candidate of Object.values(edges)) {
      if (!isRecord(candidate)) continue;
      const endpoints = edgeEndpoints(candidate);
      if ((endpoints.fromNodeId === fromRef.id && endpoints.toNodeId === toRef.id) ||
          (endpoints.fromNodeId === toRef.id && endpoints.toNodeId === fromRef.id)) {
        throw new Error("A transport road already connects the selected nodes");
      }
    }
    const regionSegments = countRegionSegments(from, to, model);
    if (regionSegments === 0) {
      throw new Error("A transport road must contain at least one segment inside a declared region");
    }
    const cost = regionSegments * model.roadCostPerRegionSegment;
    applyPayments(state, effect.payments, cost, params);
    const edgeId = allocateId(state, model, effect.networkId, "edge", edges);
    edges[edgeId] = {
      objectType: model.edgeObjectType,
      facets: initialFacets(objectModels, model.edgeObjectType, model.edgeCollection, {
        facet: model.edgeStateFacet,
        value: model.builtEdgeState
      }),
      attributes: {
        networkId: effect.networkId,
        fromNodeId: fromRef.id,
        toNodeId: toRef.id,
        geometry: { from, to },
        constructionCost: cost,
        regionSegments
      }
    };
    return { edgeId, cost, regionSegments };
  }

  const edgeRef = requireReference(resolvedRefs, effect.edgeParam, model.edgeCollection, effect.networkId);
  const edge = isRecord(edges[edgeRef.id]) ? edges[edgeRef.id] as JsonRecord : undefined;
  if (!edge) throw new Error("Selected transport edge is unavailable");
  assertAllowedFacetState(edge, model.edgeStateFacet, model.splittableEdgeStates, "edge");
  const positionT = params[effect.positionParam];
  if (typeof positionT !== "number" || !Number.isFinite(positionT) || positionT <= 0 || positionT >= 1) {
    throw new Error("Waypoint position must be strictly inside the selected edge");
  }
  const endpoints = edgeEndpoints(edge);
  const fromNode = isRecord(nodes[endpoints.fromNodeId]) ? nodes[endpoints.fromNodeId] as JsonRecord : undefined;
  const toNode = isRecord(nodes[endpoints.toNodeId]) ? nodes[endpoints.toNodeId] as JsonRecord : undefined;
  const from = pointFromObject(fromNode);
  const to = pointFromObject(toNode);
  const position = interpolate(from, to, positionT);
  applyPayments(state, effect.payments, model.waypointCost, params);

  const nodeId = allocateId(state, model, effect.networkId, "node", nodes);
  const firstEdgeId = allocateId(state, model, effect.networkId, "edge", edges);
  const secondEdgeId = allocateId(state, model, effect.networkId, "edge", edges);
  nodes[nodeId] = {
    objectType: model.waypointObjectType,
    facets: initialFacets(objectModels, model.waypointObjectType, model.nodeCollection),
    attributes: { networkId: effect.networkId, position }
  };
  const originalFacets = isRecord(edge.facets) ? structuredClone(edge.facets) : {};
  const originalAttributes = isRecord(edge.attributes) ? edge.attributes : {};
  const makeSplitEdge = (fromNodeId: string, toNodeId: string, geometryFrom: Point, geometryTo: Point) => ({
    objectType: typeof edge.objectType === "string" ? edge.objectType : model.edgeObjectType,
    facets: structuredClone(originalFacets),
    attributes: {
      ...structuredClone(originalAttributes),
      networkId: effect.networkId,
      fromNodeId,
      toNodeId,
      geometry: { from: geometryFrom, to: geometryTo },
      splitFromEdgeId: edgeRef.id
    }
  });
  edges[firstEdgeId] = makeSplitEdge(endpoints.fromNodeId, nodeId, from, position);
  edges[secondEdgeId] = makeSplitEdge(nodeId, endpoints.toNodeId, position, to);
  delete edges[edgeRef.id];
  return { nodeId, edgeIds: [firstEdgeId, secondEdgeId], cost: model.waypointCost, replacedEdgeId: edgeRef.id };
};
