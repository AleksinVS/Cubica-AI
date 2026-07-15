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
import { chooseSessionValue, type SessionRandomState } from "./sessionRandom.ts";
import {
  prepareMinimumRegionRoadCandidates,
  type RegionRoadPassage
} from "./regionRoadPlanner.ts";

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

/** Read a declared object collection without creating or changing state. */
const readStateCollection = (
  state: RuntimeState,
  model: GameManifestTransportNetworkModel,
  collectionId: string
): JsonRecord => {
  const root = isRecord(state[model.visibility]) ? state[model.visibility] as JsonRecord : {};
  const objects = isRecord(root.objects) ? root.objects : {};
  return isRecord(objects[collectionId]) ? objects[collectionId] : {};
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

const pointDistance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const pointsEqual = (a: Point, b: Point): boolean => pointDistance(a, b) <= 1e-9;

const finitePoint = (value: unknown, label: string): Point => {
  if (!isRecord(value) || typeof value.x !== "number" || !Number.isFinite(value.x) ||
      typeof value.y !== "number" || !Number.isFinite(value.y)) {
    throw new Error(`${label} must contain finite canonical coordinates`);
  }
  return { x: value.x, y: value.y };
};

/** Read legacy two-point geometry and the new canonical polyline uniformly. */
const edgePolyline = (edge: JsonRecord, nodeFrom: Point, nodeTo: Point): Array<Point> => {
  const attributes = isRecord(edge.attributes) ? edge.attributes : {};
  const geometry = attributes.geometry;
  if (geometry === undefined) return [nodeFrom, nodeTo];
  if (!isRecord(geometry)) throw new Error("Transport edge geometry has an unsupported shape");
  let points: Array<Point>;
  if (geometry.polyline !== undefined) {
    if (!Array.isArray(geometry.polyline) || geometry.polyline.length < 2 || geometry.polyline.length > 20_000) {
      throw new Error("Transport edge polyline must contain 2..20000 points");
    }
    points = geometry.polyline.map((point, index) => finitePoint(point, `Transport edge point ${index}`));
  } else {
    points = [
      finitePoint(geometry.from ?? nodeFrom, "Transport edge geometry.from"),
      finitePoint(geometry.to ?? nodeTo, "Transport edge geometry.to")
    ];
  }
  if (!pointsEqual(points[0], nodeFrom) || !pointsEqual(points[points.length - 1], nodeTo)) {
    throw new Error("Transport edge polyline endpoints do not match its network nodes");
  }
  if (points.some((point, index) => index > 0 && pointsEqual(point, points[index - 1]))) {
    throw new Error("Transport edge polyline contains a zero-length segment");
  }
  return points;
};

interface PolylineSplit {
  position: Point;
  firstPoints: Array<Point>;
  secondPoints: Array<Point>;
  splitSegmentIndex: number;
  splitVertexIndex?: number;
}

/** Interpret positionT as a fraction of total stored polyline length. */
const splitPolyline = (points: Array<Point>, positionT: number): PolylineSplit => {
  const lengths = points.slice(0, -1).map((point, index) => pointDistance(point, points[index + 1]));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= 1e-9) {
    throw new Error("Transport edge polyline has no positive length");
  }
  const target = totalLength * positionT;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const next = traversed + lengths[index];
    if (index < lengths.length - 1 && Math.abs(target - next) <= 1e-9) {
      const vertexIndex = index + 1;
      return {
        position: { ...points[vertexIndex] },
        firstPoints: points.slice(0, vertexIndex + 1),
        secondPoints: points.slice(vertexIndex),
        splitSegmentIndex: index,
        splitVertexIndex: vertexIndex
      };
    }
    if (target < next || index === lengths.length - 1) {
      const localT = (target - traversed) / lengths[index];
      const position = interpolate(points[index], points[index + 1], localT);
      return {
        position,
        firstPoints: [...points.slice(0, index + 1), position],
        secondPoints: [position, ...points.slice(index + 1)],
        splitSegmentIndex: index
      };
    }
    traversed = next;
  }
  throw new Error("Transport waypoint position could not be resolved on the polyline");
};

const passageAssignments = (
  routePlan: JsonRecord,
  pointCount: number
): Array<string> => {
  if (!Array.isArray(routePlan.passages)) throw new Error("Planned transport route is missing passages");
  const assignments = Array<string | undefined>(pointCount - 1).fill(undefined);
  for (const [index, rawPassage] of routePlan.passages.entries()) {
    if (!isRecord(rawPassage) || typeof rawPassage.regionId !== "string" ||
        !Number.isSafeInteger(rawPassage.fromPointIndex) || !Number.isSafeInteger(rawPassage.toPointIndex) ||
        (rawPassage.fromPointIndex as number) < 0 ||
        (rawPassage.toPointIndex as number) <= (rawPassage.fromPointIndex as number) ||
        (rawPassage.toPointIndex as number) >= pointCount) {
      throw new Error(`Planned transport passage ${index} is malformed`);
    }
    for (let segment = rawPassage.fromPointIndex as number;
      segment < (rawPassage.toPointIndex as number);
      segment += 1) {
      if (assignments[segment] !== undefined) throw new Error("Planned transport passages overlap");
      assignments[segment] = rawPassage.regionId;
    }
  }
  if (assignments.some((regionId) => regionId === undefined)) {
    throw new Error("Planned transport passages do not cover the complete polyline");
  }
  return assignments as Array<string>;
};

const passagesFromAssignments = (assignments: Array<string>): Array<RegionRoadPassage> => {
  if (assignments.length === 0) throw new Error("A split road must retain at least one region passage");
  const passages: Array<RegionRoadPassage> = [];
  let start = 0;
  for (let index = 1; index <= assignments.length; index += 1) {
    if (index < assignments.length && assignments[index] === assignments[start]) continue;
    passages.push({ regionId: assignments[start], fromPointIndex: start, toPointIndex: index });
    start = index;
  }
  return passages;
};

const splitStoredRoutePlan = (options: {
  rawRoutePlan: unknown;
  pointCount: number;
  split: PolylineSplit;
  replacedEdgeId: string;
}): { first?: JsonRecord; second?: JsonRecord } => {
  if (options.rawRoutePlan === undefined) return {};
  if (!isRecord(options.rawRoutePlan)) throw new Error("Transport edge routePlan has an unsupported shape");
  // Capture the validated value before entering makeChild. TypeScript cannot
  // preserve a narrowing of a mutable object property across a nested closure.
  const routePlan = structuredClone(options.rawRoutePlan);
  const assignments = passageAssignments(routePlan, options.pointCount);
  const firstAssignments = options.split.splitVertexIndex === undefined
    ? assignments.slice(0, options.split.splitSegmentIndex + 1)
    : assignments.slice(0, options.split.splitVertexIndex);
  const secondAssignments = options.split.splitVertexIndex === undefined
    ? assignments.slice(options.split.splitSegmentIndex)
    : assignments.slice(options.split.splitVertexIndex);
  const makeChild = (childAssignments: Array<string>): JsonRecord => {
    const passages = passagesFromAssignments(childAssignments);
    return {
      ...structuredClone(routePlan),
      regionSequence: passages.map((passage) => passage.regionId),
      passages,
      splitFromEdgeId: options.replacedEdgeId
    };
  };
  return { first: makeChild(firstAssignments), second: makeChild(secondAssignments) };
};

const sessionRandomState = (state: RuntimeState): SessionRandomState => {
  const value = readPointer(state, "/secret/random");
  if (!isRecord(value) || typeof value.alg !== "string" || typeof value.seed !== "string" ||
      typeof value.counter !== "number") {
    throw new Error("Authoritative road planning requires runtime-owned session random state");
  }
  return value as unknown as SessionRandomState;
};

const excludedRegionIds = (state: RuntimeState, path: string | undefined): Array<string> => {
  if (!path) return [];
  const value = readPointer(state, path);
  if (!Array.isArray(value) || value.some((regionId) => typeof regionId !== "string") ||
      new Set(value).size !== value.length) {
    throw new Error("Road-planning excludedRegionIdsPath must resolve to an array of unique region ids");
  }
  return value as Array<string>;
};

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

type ConstructionLifecycle = NonNullable<GameManifestTransportNetworkModel["constructionLifecycle"]>;

/**
 * Read the manifest-declared turn counter before any payment or graph mutation.
 * Failing early preserves the composite effect's atomic behavior when authored
 * state does not match its lifecycle declaration.
 */
const constructionTurn = (state: RuntimeState, lifecycle: ConstructionLifecycle): number => {
  const turn = readPointer(state, lifecycle.turnCounterPath);
  if (!Number.isSafeInteger(turn) || (turn as number) < 0) {
    throw new Error(`Transport construction turn at "${lifecycle.turnCounterPath}" must be a non-negative integer`);
  }
  return turn as number;
};

const blockingReasons = (
  attributes: JsonRecord,
  lifecycle: ConstructionLifecycle,
  label: string
): Array<string> => {
  const raw = attributes[lifecycle.blockingReasonsAttribute];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((reason) => typeof reason !== "string")) {
    throw new Error(`${label} construction blocking reasons must be an array of strings`);
  }
  return raw as Array<string>;
};

/** Build the declarative lifecycle attributes without discarding unrelated blockers. */
const pendingConstructionAttributes = (
  currentAttributes: JsonRecord,
  lifecycle: ConstructionLifecycle,
  turn: number
): JsonRecord => ({
  [lifecycle.createdTurnAttribute]: turn,
  [lifecycle.activationTurnAttribute]: turn + lifecycle.activationDelayTurns,
  [lifecycle.blockingReasonsAttribute]: [
    ...new Set([
      ...blockingReasons(currentAttributes, lifecycle, "Transport object"),
      lifecycle.pendingReason
    ])
  ]
});

/** Ensure a lifecycle facet value is valid for the object's declarative model. */
const assertDeclaredFacetValue = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  facet: string,
  value: GameManifestObjectFacetValue
) => {
  const objectModel = objectModels?.[objectType];
  if (!objectModel || objectModel.collection !== collection || objectModel.scope !== "session") {
    throw new Error(`Transport object type "${objectType}" is not declared for collection "${collection}"`);
  }
  const definition = objectModel.facets[facet];
  if (!definition || !definition.values.includes(value)) {
    throw new Error(`Transport facet "${facet}" does not allow lifecycle state ${String(value)}`);
  }
};

const lifecycleFacetOverride = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  currentFacets: unknown,
  facet: string,
  value: GameManifestObjectFacetValue
): JsonRecord => {
  assertDeclaredFacetValue(objectModels, objectType, collection, facet, value);
  return {
    ...(isRecord(currentFacets) ? structuredClone(currentFacets) : {}),
    [facet]: value
  };
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
    throw new Error(`Selected transport ${resourceKind} is not in an allowed state`);
  }
};

const hasAllowedFacetState = (
  object: JsonRecord,
  facet: string,
  allowed: Array<GameManifestObjectFacetValue>
): boolean => {
  const facets = isRecord(object.facets) ? object.facets : {};
  return allowed.includes(facets[facet] as GameManifestObjectFacetValue);
};

const assertPrimaryVehicleState = (
  object: JsonRecord,
  movement: NonNullable<GameManifestTransportNetworkModel["movement"]>
) => {
  if (movement.vehicleStateFacet && movement.movableVehicleStates) {
    assertAllowedFacetState(object, movement.vehicleStateFacet, movement.movableVehicleStates, "primary vehicle");
  }
};

const assertCoupledVehicleState = (
  object: JsonRecord,
  movement: NonNullable<GameManifestTransportNetworkModel["movement"]>
) => {
  if (movement.coupledStateFacet && movement.couplableVehicleStates) {
    assertAllowedFacetState(object, movement.coupledStateFacet, movement.couplableVehicleStates, "coupled vehicle");
  }
};

const SAFE_IDENTIFIER_PATTERN = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const requireSafeIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
};

const finiteNonnegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a finite non-negative integer`);
  }
  return value as number;
};

/** Find one deterministic shortest open route in an unweighted graph. */
const shortestOpenRoute = (options: {
  nodes: JsonRecord;
  edges: JsonRecord;
  model: GameManifestTransportNetworkModel;
  originNodeId: string;
  destinationNodeId: string;
}): { edgeIds: Array<string>; nodeIds: Array<string> } => {
  const { nodes, edges, model, originNodeId, destinationNodeId } = options;
  const movement = model.movement;
  if (!movement) throw new Error("Shortest-route settlement requires declared movement rules");
  const origin = isRecord(nodes[originNodeId]) ? nodes[originNodeId] as JsonRecord : undefined;
  const destination = isRecord(nodes[destinationNodeId]) ? nodes[destinationNodeId] as JsonRecord : undefined;
  assertAllowedFacetState(origin, model.nodeStateFacet, movement.traversableNodeStates, "route origin node");
  assertAllowedFacetState(destination, model.nodeStateFacet, movement.traversableNodeStates, "route destination node");
  if (originNodeId === destinationNodeId) return { edgeIds: [], nodeIds: [originNodeId] };

  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const [edgeId, candidate] of Object.entries(edges).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isRecord(candidate)) continue;
    const facets = isRecord(candidate.facets) ? candidate.facets : {};
    if (!movement.traversableEdgeStates.includes(facets[model.edgeStateFacet] as GameManifestObjectFacetValue)) continue;
    const endpoints = edgeEndpoints(candidate);
    const from = isRecord(nodes[endpoints.fromNodeId]) ? nodes[endpoints.fromNodeId] as JsonRecord : undefined;
    const to = isRecord(nodes[endpoints.toNodeId]) ? nodes[endpoints.toNodeId] as JsonRecord : undefined;
    const fromFacets = isRecord(from?.facets) ? from.facets : {};
    const toFacets = isRecord(to?.facets) ? to.facets : {};
    if (!movement.traversableNodeStates.includes(fromFacets[model.nodeStateFacet] as GameManifestObjectFacetValue) ||
        !movement.traversableNodeStates.includes(toFacets[model.nodeStateFacet] as GameManifestObjectFacetValue)) continue;
    adjacency.set(endpoints.fromNodeId, [
      ...(adjacency.get(endpoints.fromNodeId) ?? []),
      { nodeId: endpoints.toNodeId, edgeId }
    ]);
    adjacency.set(endpoints.toNodeId, [
      ...(adjacency.get(endpoints.toNodeId) ?? []),
      { nodeId: endpoints.fromNodeId, edgeId }
    ]);
  }

  const queue = [originNodeId];
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const visited = new Set([originNodeId]);
  while (queue.length > 0 && !visited.has(destinationNodeId)) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next.nodeId)) continue;
      visited.add(next.nodeId);
      previous.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
      queue.push(next.nodeId);
    }
  }
  if (!visited.has(destinationNodeId)) {
    throw new Error("Cargo origin and destination are not connected by an open route");
  }

  const edgeIds: Array<string> = [];
  const nodeIds = [destinationNodeId];
  let cursor = destinationNodeId;
  while (cursor !== originNodeId) {
    const step = previous.get(cursor);
    if (!step) throw new Error("Shortest-route reconstruction failed");
    edgeIds.push(step.edgeId);
    cursor = step.nodeId;
    nodeIds.push(cursor);
  }
  edgeIds.reverse();
  nodeIds.reverse();
  return { edgeIds, nodeIds };
};

type RoadBuildEffect = Extract<GameManifestDeterministicEffect, { op: "transport.road.build" }>;

interface PreparedRoadBuild {
  fromRef: RuntimeResolvedReference;
  toRef: RuntimeResolvedReference;
  from: Point;
  to: Point;
  regionSegments: number;
  cost: number;
  prepared?: ReturnType<typeof prepareMinimumRegionRoadCandidates>;
}

/**
 * Perform every server-owned road precondition and geometry calculation before
 * payment or graph mutation. Both preview and confirmation use this function,
 * so a client cannot receive a price derived from rules different from the
 * rules that authorize the later transaction.
 */
const prepareRoadBuild = (options: {
  state: RuntimeState;
  effect: RoadBuildEffect;
  model: GameManifestTransportNetworkModel;
  nodes: JsonRecord;
  edges: JsonRecord;
  resolvedRefs: Record<string, RuntimeResolvedReference>;
}): PreparedRoadBuild => {
  const { state, effect, model, nodes, edges, resolvedRefs } = options;
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
  const prepared = model.roadPlanning
    ? prepareMinimumRegionRoadCandidates({
        model,
        from,
        to,
        excludedRegionIds: excludedRegionIds(state, model.roadPlanning.excludedRegionIdsPath)
      })
    : undefined;
  const regionSegments = prepared
    ? prepared.candidates[0].regionSequence.length
    : countRegionSegments(from, to, model);
  if (regionSegments === 0) {
    throw new Error("A transport road must contain at least one segment inside a declared region");
  }
  return {
    fromRef,
    toRef,
    from,
    to,
    regionSegments,
    cost: regionSegments * model.roadCostPerRegionSegment,
    prepared
  };
};

export interface TransportRoadPreviewPlan {
  networkId: string;
  fromNodeId: string;
  toNodeId: string;
  polyline: Array<Point>;
  regionSequence: Array<string>;
  regionSegments: number;
  cost: number;
  candidateCount: number;
  planning: {
    mode: "region-segment-minimum";
    algorithmVersion: string;
    geometryVersion: string;
    geometryHash: string;
    boundaryPolicy: string;
  };
}

/**
 * Calculate a road preview from an immutable session snapshot.
 *
 * A tied route is selected by running the same PRNG operation against the
 * current random tuple without persisting its returned tuple. Confirmation on
 * the same state version therefore shows the same polyline, while preview
 * itself consumes no session randomness.
 */
export const previewTransportRoadBuild = (options: {
  state: RuntimeState;
  effect: RoadBuildEffect;
  resolvedRefs: Record<string, RuntimeResolvedReference>;
  networkModels?: GameManifestTransportNetworkModelMap;
}): TransportRoadPreviewPlan => {
  const model = options.networkModels?.[options.effect.networkId];
  if (!model) throw new Error(`Transport network "${options.effect.networkId}" is not declared`);
  if (!model.roadPlanning) {
    throw new Error("Transport road preview requires an authoritative road-planning model");
  }
  const prepared = prepareRoadBuild({
    state: options.state,
    effect: options.effect,
    model,
    nodes: readStateCollection(options.state, model, model.nodeCollection),
    edges: readStateCollection(options.state, model, model.edgeCollection),
    resolvedRefs: options.resolvedRefs
  });
  if (!prepared.prepared) {
    throw new Error("Transport road preview could not prepare authoritative route candidates");
  }
  const selected = prepared.prepared.candidates.length > 1
    ? chooseSessionValue({ ...sessionRandomState(options.state) }, prepared.prepared.candidates)
    : { value: prepared.prepared.candidates[0], index: 0 };
  return {
    networkId: options.effect.networkId,
    fromNodeId: prepared.fromRef.id,
    toNodeId: prepared.toRef.id,
    polyline: structuredClone(selected.value.points),
    regionSequence: [...selected.value.regionSequence],
    regionSegments: prepared.regionSegments,
    cost: prepared.cost,
    candidateCount: prepared.prepared.candidates.length,
    planning: {
      mode: model.roadPlanning.mode,
      algorithmVersion: model.roadPlanning.algorithmVersion,
      geometryVersion: model.roadPlanning.geometryVersion,
      geometryHash: model.roadPlanning.geometryHash,
      boundaryPolicy: model.roadPlanning.boundaryPolicy
    }
  };
};

export interface ApplyTransportEffectOptions {
  state: RuntimeState;
  effect: Extract<GameManifestDeterministicEffect, {
    op: "transport.road.build" | "transport.waypoint.build" | "transport.vehicle.move" |
      "transport.vehicle.attach" | "transport.vehicle.detach" | "transport.cargo.load" |
      "transport.cargo.deliver" | "transport.construction.activateDue"
  }>;
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

  if (effect.op === "transport.construction.activateDue") {
    const lifecycle = model.constructionLifecycle;
    if (!lifecycle) {
      throw new Error(`Transport network "${effect.networkId}" does not declare a construction lifecycle`);
    }
    const turn = constructionTurn(state, lifecycle);
    type DueObject = {
      id: string;
      object: JsonRecord;
      collection: string;
      facet: string;
      activeState: GameManifestObjectFacetValue;
      remainingReasons: Array<string>;
    };
    const due: Array<DueObject> = [];
    const collectDue = (
      collection: JsonRecord,
      collectionId: string,
      facet: string,
      activeState: GameManifestObjectFacetValue
    ) => {
      for (const [id, rawObject] of Object.entries(collection)) {
        if (!isRecord(rawObject)) continue;
        const attributes = isRecord(rawObject.attributes) ? rawObject.attributes : {};
        if (attributes.networkId !== effect.networkId) continue;
        const activationTurn = attributes[lifecycle.activationTurnAttribute];
        if (!Number.isSafeInteger(activationTurn) || (activationTurn as number) > turn) continue;
        const reasons = blockingReasons(attributes, lifecycle, `Transport object "${id}"`);
        if (!reasons.includes(lifecycle.pendingReason)) continue;
        const remainingReasons = reasons.filter((reason) => reason !== lifecycle.pendingReason);
        if (remainingReasons.length === 0) {
          const objectType = rawObject.objectType;
          if (typeof objectType !== "string") {
            throw new Error(`Transport object "${id}" is missing its object type`);
          }
          assertDeclaredFacetValue(objectModels, objectType, collectionId, facet, activeState);
        }
        due.push({ id, object: rawObject, collection: collectionId, facet, activeState, remainingReasons });
      }
    };
    // Validate every due object before mutating any of them. The action-level
    // clone is already atomic; this two-pass shape also makes the helper safe
    // if it is reused in another deterministic context later.
    collectDue(nodes, model.nodeCollection, model.nodeStateFacet, lifecycle.nodeStates.active);
    collectDue(edges, model.edgeCollection, model.edgeStateFacet, lifecycle.edgeStates.active);

    const activatedNodeIds: Array<string> = [];
    const activatedEdgeIds: Array<string> = [];
    const stillBlockedNodeIds: Array<string> = [];
    const stillBlockedEdgeIds: Array<string> = [];
    for (const entry of due) {
      const attributes = isRecord(entry.object.attributes) ? entry.object.attributes : {};
      attributes[lifecycle.blockingReasonsAttribute] = entry.remainingReasons;
      entry.object.attributes = attributes;
      const isNode = entry.collection === model.nodeCollection;
      if (entry.remainingReasons.length === 0) {
        const facets = isRecord(entry.object.facets) ? entry.object.facets : {};
        facets[entry.facet] = entry.activeState;
        entry.object.facets = facets;
        (isNode ? activatedNodeIds : activatedEdgeIds).push(entry.id);
      } else {
        (isNode ? stillBlockedNodeIds : stillBlockedEdgeIds).push(entry.id);
      }
    }
    return { turn, activatedNodeIds, activatedEdgeIds, stillBlockedNodeIds, stillBlockedEdgeIds };
  }

  if (effect.op === "transport.road.build") {
    const preparedRoad = prepareRoadBuild({ state, effect, model, nodes, edges, resolvedRefs });
    const { fromRef, toRef, from, to, regionSegments, cost, prepared } = preparedRoad;
    const lifecycle = model.constructionLifecycle;
    const turn = lifecycle ? constructionTurn(state, lifecycle) : undefined;
    applyPayments(state, effect.payments, cost, params);
    // A unique minimum route is fully deterministic and must not even require
    // PRNG state. Only a genuine tie enters the replay-owned random stream.
    const randomBefore = prepared && prepared.candidates.length > 1 ? sessionRandomState(state) : undefined;
    const selected = prepared
      ? randomBefore
        ? chooseSessionValue(randomBefore, prepared.candidates)
        : { value: prepared.candidates[0], index: 0, random: undefined }
      : undefined;
    if (selected?.random) writePointer(state, "/secret/random", selected.random);
    const selectedCandidate = selected?.value;
    const geometry = selectedCandidate
      ? { from, to, polyline: selectedCandidate.points }
      : { from, to };
    const routePlan = selectedCandidate && model.roadPlanning
      ? {
          mode: model.roadPlanning.mode,
          algorithmVersion: model.roadPlanning.algorithmVersion,
          geometryVersion: model.roadPlanning.geometryVersion,
          geometryHash: model.roadPlanning.geometryHash,
          boundaryPolicy: model.roadPlanning.boundaryPolicy,
          regionSequence: selectedCandidate.regionSequence,
          passages: selectedCandidate.passages,
          costRule: {
            kind: "per-region-segment",
            rate: model.roadCostPerRegionSegment,
            segmentCount: selectedCandidate.regionSequence.length
          },
          tieBreak: {
            policy: model.roadPlanning.tieBreak,
            candidateCount: prepared?.candidates.length ?? 1,
            selectedCandidateIndex: selected?.index ?? 0,
            ...(randomBefore && selected?.random
              ? { randomCounterBefore: randomBefore.counter, randomCounterAfter: selected.random.counter }
              : {})
          }
        }
      : undefined;
    const edgeId = allocateId(state, model, effect.networkId, "edge", edges);
    const edgeState = lifecycle ? lifecycle.edgeStates.pending : model.builtEdgeState;
    edges[edgeId] = {
      objectType: model.edgeObjectType,
      facets: initialFacets(objectModels, model.edgeObjectType, model.edgeCollection, {
        facet: model.edgeStateFacet,
        value: edgeState
      }),
      attributes: {
        networkId: effect.networkId,
        fromNodeId: fromRef.id,
        toNodeId: toRef.id,
        geometry,
        constructionCost: cost,
        regionSegments,
        ...(routePlan ? { routePlan } : {}),
        ...(lifecycle && turn !== undefined ? pendingConstructionAttributes({}, lifecycle, turn) : {})
      }
    };
    return { edgeId, cost, regionSegments };
  }

  if (effect.op === "transport.waypoint.build") {
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
    const points = edgePolyline(edge, from, to);
    const split = splitPolyline(points, positionT);
    const position = split.position;
    const originalAttributes = isRecord(edge.attributes) ? edge.attributes : {};
    const splitRoutePlan = splitStoredRoutePlan({
      rawRoutePlan: originalAttributes.routePlan,
      pointCount: points.length,
      split,
      replacedEdgeId: edgeRef.id
    });
    const lifecycle = model.constructionLifecycle;
    const turn = lifecycle ? constructionTurn(state, lifecycle) : undefined;
    applyPayments(state, effect.payments, model.waypointCost, params);

    const nodeId = allocateId(state, model, effect.networkId, "node", nodes);
    const firstEdgeId = allocateId(state, model, effect.networkId, "edge", edges);
    const secondEdgeId = allocateId(state, model, effect.networkId, "edge", edges);
    nodes[nodeId] = {
      objectType: model.waypointObjectType,
      facets: initialFacets(
        objectModels,
        model.waypointObjectType,
        model.nodeCollection,
        lifecycle ? { facet: model.nodeStateFacet, value: lifecycle.nodeStates.pending } : undefined
      ),
      attributes: {
        networkId: effect.networkId,
        position,
        ...(lifecycle && turn !== undefined ? pendingConstructionAttributes({}, lifecycle, turn) : {})
      }
    };
    const originalFacets = isRecord(edge.facets) ? structuredClone(edge.facets) : {};
    const makeSplitEdge = (
      fromNodeId: string,
      toNodeId: string,
      edgePoints: Array<Point>,
      childRoutePlan?: JsonRecord
    ) => {
      const objectType = typeof edge.objectType === "string" ? edge.objectType : model.edgeObjectType;
      return {
        objectType,
        // A split child is new construction. With an enabled lifecycle it must
        // never inherit an open facet from the replaced edge.
        facets: lifecycle
          ? lifecycleFacetOverride(
              objectModels,
              objectType,
              model.edgeCollection,
              originalFacets,
              model.edgeStateFacet,
              lifecycle.edgeStates.pending
            )
          : structuredClone(originalFacets),
        attributes: {
          ...structuredClone(originalAttributes),
          networkId: effect.networkId,
          fromNodeId,
          toNodeId,
          geometry: { from: edgePoints[0], to: edgePoints[edgePoints.length - 1], polyline: edgePoints },
          splitFromEdgeId: edgeRef.id,
          ...(childRoutePlan
            ? { routePlan: childRoutePlan, regionSegments: (childRoutePlan.passages as Array<unknown>).length }
            : {}),
          ...(lifecycle && turn !== undefined
            ? pendingConstructionAttributes(originalAttributes, lifecycle, turn)
            : {})
        }
      };
    };
    edges[firstEdgeId] = makeSplitEdge(
      endpoints.fromNodeId,
      nodeId,
      split.firstPoints,
      splitRoutePlan.first
    );
    edges[secondEdgeId] = makeSplitEdge(
      nodeId,
      endpoints.toNodeId,
      split.secondPoints,
      splitRoutePlan.second
    );
    delete edges[edgeRef.id];
    return { nodeId, edgeIds: [firstEdgeId, secondEdgeId], cost: model.waypointCost, replacedEdgeId: edgeRef.id };
  }

  if (effect.op === "transport.vehicle.move") {
    const movement = model.movement;
    if (!movement) throw new Error(`Transport network "${effect.networkId}" does not declare movement rules`);
    const vehicleRef = requireReference(
      resolvedRefs,
      effect.vehicleParam,
      movement.vehicleCollection,
      effect.networkId
    );
    const edgeRef = requireReference(resolvedRefs, effect.edgeParam, model.edgeCollection, effect.networkId);
    const vehicles = stateCollection(state, model, movement.vehicleCollection);
    const capacityVehicles = stateCollection(state, model, movement.capacityCollection);
    const coupledVehicles = stateCollection(state, model, movement.coupledCollection);
    const vehicle = isRecord(vehicles[vehicleRef.id]) ? vehicles[vehicleRef.id] as JsonRecord : undefined;
    const edge = isRecord(edges[edgeRef.id]) ? edges[edgeRef.id] as JsonRecord : undefined;
    if (!vehicle || !movement.vehicleObjectTypes.includes(String(vehicle.objectType))) {
      throw new Error("Selected transport vehicle is unavailable for movement");
    }
    assertPrimaryVehicleState(vehicle, movement);
    if (!edge) throw new Error("Selected transport edge is unavailable for movement");
    assertAllowedFacetState(edge, model.edgeStateFacet, movement.traversableEdgeStates, "edge");
    const attributes = isRecord(vehicle.attributes) ? vehicle.attributes : {};
    const currentNodeId = attributes[movement.locationAttribute];
    const actionPoints = attributes[movement.actionPointsAttribute];
    if (typeof currentNodeId !== "string") throw new Error("Transport vehicle has no current node");
    if (!Number.isSafeInteger(actionPoints) || (actionPoints as number) <= 0) {
      throw new Error("Transport vehicle has no action points remaining");
    }
    const endpoints = edgeEndpoints(edge);
    const destinationNodeId = endpoints.fromNodeId === currentNodeId
      ? endpoints.toNodeId
      : endpoints.toNodeId === currentNodeId
        ? endpoints.fromNodeId
        : undefined;
    if (!destinationNodeId) throw new Error("Selected transport edge is not incident to the vehicle node");
    const destinationNode = isRecord(nodes[destinationNodeId]) ? nodes[destinationNodeId] as JsonRecord : undefined;
    if (!destinationNode) throw new Error("Transport destination node is unavailable");
    assertAllowedFacetState(destinationNode, model.nodeStateFacet, movement.traversableNodeStates, "node");

    const capacityStateFacet = movement.capacityStateFacet ??
      (movement.capacityCollection === movement.vehicleCollection ? movement.vehicleStateFacet : undefined);
    const capacityOccupyingStates = movement.capacityOccupyingStates ??
      (movement.capacityCollection === movement.vehicleCollection ? movement.movableVehicleStates : undefined);
    if (movement.capacityCollection !== movement.vehicleCollection &&
        (!capacityStateFacet || !capacityOccupyingStates)) {
      throw new Error("A separate transport capacity collection requires declared occupancy states");
    }
    const occupancy = Object.entries(capacityVehicles).filter(([id, candidate]) => {
      const isPrimaryVehicle = movement.capacityCollection === movement.vehicleCollection && id === vehicleRef.id;
      if (isPrimaryVehicle || !isRecord(candidate) ||
          !movement.capacityObjectTypes.includes(String(candidate.objectType))) {
        return false;
      }
      if (capacityStateFacet && capacityOccupyingStates &&
          !hasAllowedFacetState(candidate, capacityStateFacet, capacityOccupyingStates)) {
        return false;
      }
      const candidateAttributes = isRecord(candidate.attributes) ? candidate.attributes : {};
      return candidateAttributes[movement.capacityLocationAttribute] === destinationNodeId;
    }).length;
    if (occupancy >= movement.maxVehiclesPerNode) {
      throw new Error("Transport destination node has reached its vehicle capacity");
    }

    attributes[movement.locationAttribute] = destinationNodeId;
    attributes[movement.actionPointsAttribute] = (actionPoints as number) - 1;
    vehicle.attributes = attributes;
    const coupledVehicleIds: string[] = [];
    for (const [id, candidate] of Object.entries(coupledVehicles)) {
      if (!isRecord(candidate) || !movement.coupledObjectTypes.includes(String(candidate.objectType))) continue;
      const candidateAttributes = isRecord(candidate.attributes) ? candidate.attributes : {};
      if (candidateAttributes[movement.coupledVehicleAttribute] !== vehicleRef.id) continue;
      assertCoupledVehicleState(candidate, movement);
      candidateAttributes[movement.coupledLocationAttribute] = destinationNodeId;
      candidate.attributes = candidateAttributes;
      coupledVehicleIds.push(id);
    }
    return {
      vehicleId: vehicleRef.id,
      edgeId: edgeRef.id,
      fromNodeId: currentNodeId,
      toNodeId: destinationNodeId,
      actionPointsRemaining: (actionPoints as number) - 1,
      coupledVehicleIds
    };
  }

  if (effect.op === "transport.vehicle.attach" || effect.op === "transport.vehicle.detach") {
    const movement = model.movement;
    if (!movement || !movement.compatibleCouplings || movement.maxCoupledVehicles === undefined ||
        !movement.vehicleStateFacet || !movement.movableVehicleStates ||
        !movement.coupledStateFacet || !movement.couplableVehicleStates) {
      throw new Error(`Transport network "${effect.networkId}" does not declare coupling rules`);
    }
    const vehicleRef = requireReference(
      resolvedRefs,
      effect.vehicleParam,
      movement.vehicleCollection,
      effect.networkId
    );
    const coupledRefs = effect.coupledVehicleParams.map((paramName) =>
      requireReference(resolvedRefs, paramName, movement.coupledCollection, effect.networkId));
    if (new Set(coupledRefs.map((ref) => ref.id)).size !== coupledRefs.length) {
      throw new Error("A coupled vehicle may appear only once in one operation");
    }
    const vehicles = stateCollection(state, model, movement.vehicleCollection);
    const coupledVehicles = stateCollection(state, model, movement.coupledCollection);
    const vehicle = isRecord(vehicles[vehicleRef.id]) ? vehicles[vehicleRef.id] as JsonRecord : undefined;
    if (!vehicle || !movement.vehicleObjectTypes.includes(String(vehicle.objectType))) {
      throw new Error("Selected transport vehicle is unavailable for coupling");
    }
    assertPrimaryVehicleState(vehicle, movement);
    const compatibility = movement.compatibleCouplings.find(
      (rule) => rule.vehicleObjectType === vehicle.objectType
    );
    if (!compatibility) throw new Error("Selected transport vehicle does not accept coupled vehicles");
    const vehicleAttributes = isRecord(vehicle.attributes) ? vehicle.attributes : {};
    const vehicleNodeId = vehicleAttributes[movement.locationAttribute];
    const actionPoints = vehicleAttributes[movement.actionPointsAttribute];
    if (typeof vehicleNodeId !== "string") throw new Error("Transport vehicle has no current node");
    if (!Number.isSafeInteger(actionPoints) || (actionPoints as number) <= 0) {
      throw new Error("Transport vehicle has no action points remaining");
    }

    const selected = coupledRefs.map((ref) => {
      const object = isRecord(coupledVehicles[ref.id]) ? coupledVehicles[ref.id] as JsonRecord : undefined;
      if (!object || !movement.coupledObjectTypes.includes(String(object.objectType)) ||
          !compatibility.coupledObjectTypes.includes(String(object.objectType))) {
        throw new Error("Selected coupled vehicle is incompatible or unavailable");
      }
      assertCoupledVehicleState(object, movement);
      const attributes = isRecord(object.attributes) ? object.attributes : {};
      if (attributes[movement.coupledLocationAttribute] !== vehicleNodeId) {
        throw new Error("All coupled vehicles must be at the primary vehicle node");
      }
      if (effect.op === "transport.vehicle.attach" &&
          attributes[movement.coupledVehicleAttribute] !== null &&
          attributes[movement.coupledVehicleAttribute] !== undefined) {
        throw new Error("Selected coupled vehicle is already attached");
      }
      if (effect.op === "transport.vehicle.detach" &&
          attributes[movement.coupledVehicleAttribute] !== vehicleRef.id) {
        throw new Error("Selected coupled vehicle is not attached to the primary vehicle");
      }
      return { id: ref.id, object, attributes };
    });

    if (effect.op === "transport.vehicle.attach") {
      const alreadyAttached = Object.values(coupledVehicles).filter((candidate) => {
        if (!isRecord(candidate)) return false;
        const attributes = isRecord(candidate.attributes) ? candidate.attributes : {};
        return attributes[movement.coupledVehicleAttribute] === vehicleRef.id;
      }).length;
      if (alreadyAttached + selected.length > movement.maxCoupledVehicles) {
        throw new Error("Primary vehicle would exceed its coupled-vehicle capacity");
      }
    }

    for (const entry of selected) {
      entry.attributes[movement.coupledVehicleAttribute] =
        effect.op === "transport.vehicle.attach" ? vehicleRef.id : null;
      entry.object.attributes = entry.attributes;
    }
    vehicleAttributes[movement.actionPointsAttribute] = (actionPoints as number) - 1;
    vehicle.attributes = vehicleAttributes;
    return {
      vehicleId: vehicleRef.id,
      coupledVehicleIds: selected.map((entry) => entry.id),
      actionPointsRemaining: (actionPoints as number) - 1
    };
  }

  const delivery = model.cargoDelivery;
  if (!delivery) throw new Error(`Transport network "${effect.networkId}" does not declare cargo-delivery rules`);
  const wagonRef = requireReference(resolvedRefs, effect.wagonParam, delivery.wagonCollection, effect.networkId);
  const cargoRef = requireReference(resolvedRefs, effect.cargoParam, delivery.cargoCollection, effect.networkId);
  const wagons = stateCollection(state, model, delivery.wagonCollection);
  const cargos = stateCollection(state, model, delivery.cargoCollection);
  const wagon = isRecord(wagons[wagonRef.id]) ? wagons[wagonRef.id] as JsonRecord : undefined;
  const cargo = isRecord(cargos[cargoRef.id]) ? cargos[cargoRef.id] as JsonRecord : undefined;
  if (!wagon || !delivery.wagonObjectTypes.includes(String(wagon.objectType))) {
    throw new Error("Selected wagon is unavailable for cargo delivery");
  }
  if (!cargo || !delivery.cargoObjectTypes.includes(String(cargo.objectType))) {
    throw new Error("Selected cargo is unavailable for transport");
  }
  const wagonAttributes = isRecord(wagon.attributes) ? wagon.attributes : {};
  const cargoAttributes = isRecord(cargo.attributes) ? cargo.attributes : {};
  const movementForWagon = model.movement && model.movement.coupledCollection === delivery.wagonCollection
    ? model.movement
    : undefined;

  if (effect.op === "transport.cargo.load") {
    const { cargoOriginAttribute, loadableCargoStates, loadedCargoState } = delivery;
    if (!cargoOriginAttribute || !loadableCargoStates || loadedCargoState === undefined) {
      throw new Error(`Transport network "${effect.networkId}" does not declare cargo-loading rules`);
    }
    if (!movementForWagon?.coupledStateFacet || !movementForWagon.couplableVehicleStates) {
      throw new Error("Cargo loading requires declared wagon state constraints");
    }
    assertCoupledVehicleState(wagon, movementForWagon);
    assertAllowedFacetState(cargo, delivery.cargoStateFacet, loadableCargoStates, "cargo");
    if (wagonAttributes[delivery.cargoReferenceAttribute] !== null &&
        wagonAttributes[delivery.cargoReferenceAttribute] !== undefined) {
      throw new Error("Selected wagon already carries cargo");
    }
    const wagonNodeId = wagonAttributes[delivery.locationAttribute];
    const originNodeId = cargoAttributes[cargoOriginAttribute];
    if (typeof wagonNodeId !== "string" || wagonNodeId !== originNodeId) {
      throw new Error("Cargo can only be loaded into a wagon at its declared origin");
    }
    wagonAttributes[delivery.cargoReferenceAttribute] = cargoRef.id;
    wagon.attributes = wagonAttributes;
    const cargoFacets = isRecord(cargo.facets) ? cargo.facets : {};
    cargoFacets[delivery.cargoStateFacet] = loadedCargoState;
    cargo.facets = cargoFacets;
    return { wagonId: wagonRef.id, cargoId: cargoRef.id, originNodeId };
  }

  if (movementForWagon) assertCoupledVehicleState(wagon, movementForWagon);
  assertAllowedFacetState(cargo, delivery.cargoStateFacet, delivery.deliverableCargoStates, "cargo");
  if (wagonAttributes[delivery.cargoReferenceAttribute] !== cargoRef.id) {
    throw new Error("Selected wagon does not carry the selected cargo");
  }
  if (wagonAttributes[delivery.locationAttribute] !== cargoAttributes[delivery.cargoDestinationAttribute]) {
    throw new Error("Selected cargo has not reached its destination");
  }

  let settlementResult: Record<string, unknown> = {};
  const settlementValues = [
    delivery.payoutAttribute,
    delivery.ownerParticipantIdAttribute,
    delivery.participantCollectionPath,
    delivery.participantBalanceAttribute,
    delivery.tariffPerEdge,
    delivery.settledRouteLengthAttribute
  ];
  if (settlementValues.some((value) => value !== undefined)) {
    const payoutAttribute = delivery.payoutAttribute;
    const ownerParticipantIdAttribute = delivery.ownerParticipantIdAttribute;
    const participantCollectionPath = delivery.participantCollectionPath;
    const participantBalanceAttribute = delivery.participantBalanceAttribute;
    const tariffPerEdge = delivery.tariffPerEdge;
    const settledRouteLengthAttribute = delivery.settledRouteLengthAttribute;
    if (!payoutAttribute || !ownerParticipantIdAttribute || !participantCollectionPath ||
        !participantBalanceAttribute || tariffPerEdge === undefined || !settledRouteLengthAttribute) {
      throw new Error("Cargo settlement rules must be declared as one complete contract");
    }
    requireSafeIdentifier(payoutAttribute, "Cargo payout attribute");
    requireSafeIdentifier(ownerParticipantIdAttribute, "Transport owner attribute");
    requireSafeIdentifier(participantBalanceAttribute, "Participant balance attribute");
    requireSafeIdentifier(settledRouteLengthAttribute, "Settled route-length attribute");
    const movement = model.movement;
    if (!movement) throw new Error("Cargo settlement requires declared movement rules");
    const attachedVehicleId = wagonAttributes[delivery.attachedVehicleAttribute];
    if (typeof attachedVehicleId !== "string") {
      throw new Error("Cargo settlement requires the wagon to be attached to a primary vehicle");
    }
    const vehicles = stateCollection(state, model, movement.vehicleCollection);
    const vehicle = isRecord(vehicles[attachedVehicleId]) ? vehicles[attachedVehicleId] as JsonRecord : undefined;
    if (!vehicle || !movement.vehicleObjectTypes.includes(String(vehicle.objectType))) {
      throw new Error("Cargo settlement primary vehicle is unavailable");
    }
    assertPrimaryVehicleState(vehicle, movement);
    const vehicleAttributes = isRecord(vehicle.attributes) ? vehicle.attributes : {};
    const wagonNodeId = wagonAttributes[delivery.locationAttribute];
    const vehicleNodeId = vehicleAttributes[movement.locationAttribute];
    if (typeof wagonNodeId !== "string" || wagonNodeId !== vehicleNodeId) {
      throw new Error("Cargo settlement wagon and primary vehicle must share the destination node");
    }
    const wagonOwnerId = requireSafeIdentifier(
      wagonAttributes[ownerParticipantIdAttribute],
      "Wagon owner participant id"
    );
    const vehicleOwnerId = requireSafeIdentifier(
      vehicleAttributes[ownerParticipantIdAttribute],
      "Primary vehicle owner participant id"
    );
    const participants = readPointer(state, participantCollectionPath);
    if (!isRecord(participants)) throw new Error("Cargo settlement participant collection is unavailable");
    const wagonOwner = isRecord(participants[wagonOwnerId]) ? participants[wagonOwnerId] as JsonRecord : undefined;
    const vehicleOwner = isRecord(participants[vehicleOwnerId]) ? participants[vehicleOwnerId] as JsonRecord : undefined;
    if (!wagonOwner || !vehicleOwner) throw new Error("Cargo settlement owner is not a declared participant");

    const cargoOriginAttribute = delivery.cargoOriginAttribute;
    if (!cargoOriginAttribute) throw new Error("Shortest-route settlement requires a cargo origin attribute");
    const originNodeId = requireSafeIdentifier(cargoAttributes[cargoOriginAttribute], "Cargo origin node id");
    const destinationNodeId = requireSafeIdentifier(
      cargoAttributes[delivery.cargoDestinationAttribute],
      "Cargo destination node id"
    );
    const route = shortestOpenRoute({ nodes, edges, model, originNodeId, destinationNodeId });
    const payout = finiteNonnegativeInteger(cargoAttributes[payoutAttribute], "Cargo payout");
    const tariff = route.edgeIds.length * finiteNonnegativeInteger(tariffPerEdge, "Tariff per edge");
    const wagonOwnerBalance = finiteNonnegativeInteger(
      wagonOwner[participantBalanceAttribute],
      "Wagon owner balance"
    );
    const vehicleOwnerBalance = finiteNonnegativeInteger(
      vehicleOwner[participantBalanceAttribute],
      "Primary vehicle owner balance"
    );
    const deltas = new Map<string, number>();
    deltas.set(wagonOwnerId, (deltas.get(wagonOwnerId) ?? 0) + payout - tariff);
    deltas.set(vehicleOwnerId, (deltas.get(vehicleOwnerId) ?? 0) + tariff);
    const startingBalances = new Map([
      [wagonOwnerId, wagonOwnerBalance],
      [vehicleOwnerId, vehicleOwnerBalance]
    ]);
    for (const [participantId, delta] of deltas) {
      const next = (startingBalances.get(participantId) as number) + delta;
      if (!Number.isSafeInteger(next) || next < 0) {
        throw new Error("Cargo settlement cannot make a participant balance negative");
      }
    }
    for (const [participantId, delta] of deltas) {
      const participant = participants[participantId] as JsonRecord;
      participant[participantBalanceAttribute] = (startingBalances.get(participantId) as number) + delta;
    }
    cargoAttributes[settledRouteLengthAttribute] = route.edgeIds.length;
    settlementResult = {
      originNodeId,
      routeEdgeIds: route.edgeIds,
      routeNodeIds: route.nodeIds,
      routeLength: route.edgeIds.length,
      payout,
      tariff,
      wagonOwnerId,
      vehicleOwnerId
    };
  }

  wagonAttributes[delivery.cargoReferenceAttribute] = null;
  wagonAttributes[delivery.attachedVehicleAttribute] = null;
  wagon.attributes = wagonAttributes;
  const cargoFacets = isRecord(cargo.facets) ? cargo.facets : {};
  cargoFacets[delivery.cargoStateFacet] = delivery.deliveredCargoState;
  cargo.facets = cargoFacets;
  return {
    wagonId: wagonRef.id,
    cargoId: cargoRef.id,
    destinationNodeId: cargoAttributes[delivery.cargoDestinationAttribute],
    ...settlementResult
  };
};
