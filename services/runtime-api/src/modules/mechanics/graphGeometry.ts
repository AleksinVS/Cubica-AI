/**
 * Pure, versioned geometry primitives used by the neutral graph module.
 *
 * The helpers in this file deliberately know nothing about roads, stations,
 * prices, or phases. They only canonicalize bounded coordinates, locate a
 * normalized position on a polyline, classify closed-polygon membership, and
 * fingerprint every geometry input that can affect a later edge split.
 */
import type {
  GameManifestTransportRegion
} from "@cubica/contracts-manifest";
import { hashCanonicalJson } from "../content/canonicalJson.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";

export const GRAPH_GEOMETRY_EPSILON = 1e-9;
export const GRAPH_MAX_COORDINATE_MAGNITUDE = 1_000_000_000;
export const GRAPH_MAX_REGIONS = 512;
export const GRAPH_MAX_VERTICES_PER_REGION = 512;
export const GRAPH_MAX_TOTAL_REGION_VERTICES = 20_000;
export const GRAPH_MAX_POLYLINE_POINTS = 20_000;

export const GRAPH_EDGE_POSITION_ALGORITHM = "polyline-arc-length-v1" as const;
export const GRAPH_REGION_MEMBERSHIP_ALGORITHM = "closed-polygon-all-memberships-v1" as const;
export const GRAPH_GEOMETRY_FINGERPRINT_ALGORITHM = "canonical-json-sha256-v1" as const;
export const GRAPH_CANONICAL_JSON_ALGORITHM = "utf16-key-order-v1" as const;
export const GRAPH_EDGE_POSITION_PROOF_VERSION = "graph-edge-position-proof/v1" as const;
export const GRAPH_EDGE_GEOMETRY_FINGERPRINT_FORMAT =
  "cubica.graph/edge-geometry-fingerprint/v1" as const;

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphPolylineSplit {
  point: GraphPoint;
  first: Array<GraphPoint>;
  second: Array<GraphPoint>;
  splitSegmentIndex: number;
  splitVertexIndex?: number;
}

export interface CanonicalGraphRegion {
  id: string;
  polygon: Array<GraphPoint>;
}

/**
 * A deterministic geometry failure that the runtime maps to a stable public
 * Mechanics error code without exposing the rejected value.
 */
export class GraphGeometryError extends Error {
  readonly code:
    | "MECHANICS_GRAPH_EDGE_POSITION_INVALID"
    | "MECHANICS_GRAPH_GEOMETRY_INVALID";

  constructor(
    code: GraphGeometryError["code"],
    message: string
  ) {
    super(message);
    this.name = "GraphGeometryError";
    this.code = code;
  }
}

/** Normalize one JSON coordinate without introducing an unstated rounding grid. */
export function canonicalGraphPoint(raw: unknown, label: string): GraphPoint {
  if (!isRecord(raw) ||
      typeof raw.x !== "number" || !Number.isFinite(raw.x) ||
      typeof raw.y !== "number" || !Number.isFinite(raw.y) ||
      Math.abs(raw.x) > GRAPH_MAX_COORDINATE_MAGNITUDE ||
      Math.abs(raw.y) > GRAPH_MAX_COORDINATE_MAGNITUDE) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `${label} must contain finite bounded coordinates`
    );
  }
  return {
    x: Object.is(raw.x, -0) ? 0 : raw.x,
    y: Object.is(raw.y, -0) ? 0 : raw.y
  };
}

/**
 * Read the effective edge polyline.
 *
 * An edge without an explicit polyline is the direct segment between its
 * endpoint nodes. Explicit geometry must start and end at those same nodes so
 * graph topology and rendered geometry cannot diverge.
 */
export function readEffectiveGraphPolyline(
  rawGeometry: unknown,
  from: GraphPoint,
  to: GraphPoint
): Array<GraphPoint> {
  if (!isRecord(rawGeometry) || !Array.isArray(rawGeometry.polyline)) {
    assertPositiveSegment(from, to, "Edge endpoints");
    return [{ ...from }, { ...to }];
  }
  if (rawGeometry.polyline.length < 2 ||
      rawGeometry.polyline.length > GRAPH_MAX_POLYLINE_POINTS) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `Edge polyline must contain 2..${GRAPH_MAX_POLYLINE_POINTS} points`
    );
  }
  const points = rawGeometry.polyline.map((point, index) =>
    canonicalGraphPoint(point, `Edge polyline point ${index}`));
  if (!graphPointsNearlyEqual(points[0], from) ||
      !graphPointsNearlyEqual(points.at(-1) as GraphPoint, to)) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      "Edge polyline endpoints do not match its graph nodes"
    );
  }
  for (let index = 1; index < points.length; index += 1) {
    assertPositiveSegment(points[index - 1], points[index], `Edge polyline segment ${index - 1}`);
  }
  return points;
}

/** Resolve a strict internal position by travelled length, not by vertex index. */
export function splitGraphPolyline(
  points: ReadonlyArray<GraphPoint>,
  normalizedPosition: number
): GraphPolylineSplit {
  if (typeof normalizedPosition !== "number" || !Number.isFinite(normalizedPosition) ||
      normalizedPosition <= 0 || normalizedPosition >= 1) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_EDGE_POSITION_INVALID",
      "Edge position must be a finite number strictly inside (0, 1)"
    );
  }
  if (points.length < 2 || points.length > GRAPH_MAX_POLYLINE_POINTS) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `Edge polyline must contain 2..${GRAPH_MAX_POLYLINE_POINTS} points`
    );
  }
  const lengths = points.slice(0, -1).map((point, index) => {
    const length = distance(point, points[index + 1]);
    if (!(length > GRAPH_GEOMETRY_EPSILON)) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        "Edge polyline contains a zero-length segment"
      );
    }
    return length;
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      "Edge polyline has no finite positive length"
    );
  }

  const target = total * normalizedPosition;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const next = traversed + lengths[index];
    if (index < lengths.length - 1 && Math.abs(target - next) <= GRAPH_GEOMETRY_EPSILON) {
      const splitVertexIndex = index + 1;
      return {
        point: { ...points[splitVertexIndex] },
        first: points.slice(0, splitVertexIndex + 1).map((point) => ({ ...point })),
        second: points.slice(splitVertexIndex).map((point) => ({ ...point })),
        splitSegmentIndex: index,
        splitVertexIndex
      };
    }
    if (target < next || index === lengths.length - 1) {
      const localPosition = (target - traversed) / lengths[index];
      const point = canonicalGraphPoint({
        x: points[index].x + (points[index + 1].x - points[index].x) * localPosition,
        y: points[index].y + (points[index + 1].y - points[index].y) * localPosition
      }, "Calculated edge position");
      return {
        point,
        first: [...points.slice(0, index + 1).map((candidate) => ({ ...candidate })), point],
        second: [point, ...points.slice(index + 1).map((candidate) => ({ ...candidate }))],
        splitSegmentIndex: index
      };
    }
    traversed = next;
  }
  throw new GraphGeometryError(
    "MECHANICS_GRAPH_GEOMETRY_INVALID",
    "Edge position could not be resolved"
  );
}

/**
 * Validate and canonicalize region polygons without applying route-planner
 * ownership policy. A repeated terminal vertex is accepted as explicit polygon
 * closure and removed before the simple-polygon check.
 */
export function canonicalizeGraphRegions(
  rawRegions: ReadonlyArray<GameManifestTransportRegion>
): Array<CanonicalGraphRegion> {
  if (rawRegions.length < 1 || rawRegions.length > GRAPH_MAX_REGIONS) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `Graph geometry supports 1..${GRAPH_MAX_REGIONS} regions`
    );
  }
  const ids = new Set<string>();
  let totalVertices = 0;
  const regions = rawRegions.map((rawRegion) => {
    if (typeof rawRegion.id !== "string" || rawRegion.id.length < 1 || rawRegion.id.length > 256) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        "Graph region id must be a non-empty bounded string"
      );
    }
    if (ids.has(rawRegion.id)) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        `Graph region "${rawRegion.id}" is duplicated`
      );
    }
    ids.add(rawRegion.id);
    let polygon = rawRegion.polygon.map((point, index) =>
      canonicalGraphPoint(point, `Graph region "${rawRegion.id}" point ${index}`));
    if (polygon.length > 1 && graphPointsEqual(polygon[0], polygon.at(-1) as GraphPoint)) {
      polygon = polygon.slice(0, -1);
    }
    if (polygon.length < 3 || polygon.length > GRAPH_MAX_VERTICES_PER_REGION) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        `Graph region "${rawRegion.id}" must contain 3..${GRAPH_MAX_VERTICES_PER_REGION} vertices`
      );
    }
    totalVertices += polygon.length;
    if (totalVertices > GRAPH_MAX_TOTAL_REGION_VERTICES) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        `Graph geometry supports at most ${GRAPH_MAX_TOTAL_REGION_VERTICES} region vertices`
      );
    }
    assertSimplePolygon(polygon, rawRegion.id);
    return { id: rawRegion.id, polygon };
  });
  return regions.sort((left, right) => compareCanonicalIds(left.id, right.id));
}

/** Return every region whose closed polygon contains or touches the point. */
export function closedGraphRegionMembership(
  point: GraphPoint,
  regions: ReadonlyArray<CanonicalGraphRegion>
): Array<string> {
  return regions
    .filter((region) => pointInOrOnPolygon(point, region.polygon))
    .map((region) => region.id)
    .sort(compareCanonicalIds);
}

/**
 * Hash the complete mutation-relevant geometry corpus.
 *
 * The stored route plan is included because splitting it creates the child
 * route plans. Excluding it would permit a plan mutation between inspection
 * and split without changing the proof fingerprint.
 */
export function graphEdgeGeometryFingerprint(input: {
  networkId: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  from: GraphPoint;
  to: GraphPoint;
  polyline: ReadonlyArray<GraphPoint>;
  routePlan: unknown;
}): string {
  return `sha256:${hashCanonicalJson({
    format: GRAPH_EDGE_GEOMETRY_FINGERPRINT_FORMAT,
    algorithms: {
      edgePosition: GRAPH_EDGE_POSITION_ALGORITHM,
      regionMembership: GRAPH_REGION_MEMBERSHIP_ALGORITHM,
      canonicalJson: GRAPH_CANONICAL_JSON_ALGORITHM
    },
    networkId: input.networkId,
    edgeId: input.edgeId,
    endpoints: {
      from: { id: input.fromNodeId, point: input.from },
      to: { id: input.toNodeId, point: input.to }
    },
    polyline: input.polyline,
    routePlan: input.routePlan ?? null
  })}`;
}

export function graphPointsEqual(left: GraphPoint, right: GraphPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

export function graphPointsNearlyEqual(left: GraphPoint, right: GraphPoint): boolean {
  return distance(left, right) <= GRAPH_GEOMETRY_EPSILON;
}

function assertPositiveSegment(from: GraphPoint, to: GraphPoint, label: string): void {
  if (!(distance(from, to) > GRAPH_GEOMETRY_EPSILON)) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `${label} must have positive length`
    );
  }
}

function pointInOrOnPolygon(point: GraphPoint, polygon: ReadonlyArray<GraphPoint>): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) /
        (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function assertSimplePolygon(polygon: ReadonlyArray<GraphPoint>, regionId: string): void {
  const keys = new Set<string>();
  for (const point of polygon) {
    const key = `${point.x},${point.y}`;
    if (keys.has(key)) {
      throw new GraphGeometryError(
        "MECHANICS_GRAPH_GEOMETRY_INVALID",
        `Graph region "${regionId}" repeats a polygon vertex`
      );
    }
    keys.add(key);
  }
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    assertPositiveSegment(polygon[first], polygon[firstNext], `Graph region "${regionId}" boundary`);
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (!adjacent && segmentsIntersect(
        polygon[first],
        polygon[firstNext],
        polygon[second],
        polygon[secondNext]
      )) {
        throw new GraphGeometryError(
          "MECHANICS_GRAPH_GEOMETRY_INVALID",
          `Graph region "${regionId}" is not a simple polygon`
        );
      }
    }
  }
}

function pointOnSegment(point: GraphPoint, from: GraphPoint, to: GraphPoint): boolean {
  const segment = subtract(to, from);
  const offset = subtract(point, from);
  const tolerance = GRAPH_GEOMETRY_EPSILON * Math.max(1, Math.hypot(segment.x, segment.y));
  return Math.abs(cross(offset, segment)) <= tolerance &&
    point.x >= Math.min(from.x, to.x) - GRAPH_GEOMETRY_EPSILON &&
    point.x <= Math.max(from.x, to.x) + GRAPH_GEOMETRY_EPSILON &&
    point.y >= Math.min(from.y, to.y) - GRAPH_GEOMETRY_EPSILON &&
    point.y <= Math.max(from.y, to.y) + GRAPH_GEOMETRY_EPSILON;
}

function segmentsIntersect(
  firstFrom: GraphPoint,
  firstTo: GraphPoint,
  secondFrom: GraphPoint,
  secondTo: GraphPoint
): boolean {
  const first = orientation(firstFrom, firstTo, secondFrom);
  const second = orientation(firstFrom, firstTo, secondTo);
  const third = orientation(secondFrom, secondTo, firstFrom);
  const fourth = orientation(secondFrom, secondTo, firstTo);
  if (((first > GRAPH_GEOMETRY_EPSILON && second < -GRAPH_GEOMETRY_EPSILON) ||
       (first < -GRAPH_GEOMETRY_EPSILON && second > GRAPH_GEOMETRY_EPSILON)) &&
      ((third > GRAPH_GEOMETRY_EPSILON && fourth < -GRAPH_GEOMETRY_EPSILON) ||
       (third < -GRAPH_GEOMETRY_EPSILON && fourth > GRAPH_GEOMETRY_EPSILON))) {
    return true;
  }
  return (Math.abs(first) <= GRAPH_GEOMETRY_EPSILON &&
      pointOnSegment(secondFrom, firstFrom, firstTo)) ||
    (Math.abs(second) <= GRAPH_GEOMETRY_EPSILON &&
      pointOnSegment(secondTo, firstFrom, firstTo)) ||
    (Math.abs(third) <= GRAPH_GEOMETRY_EPSILON &&
      pointOnSegment(firstFrom, secondFrom, secondTo)) ||
    (Math.abs(fourth) <= GRAPH_GEOMETRY_EPSILON &&
      pointOnSegment(firstTo, secondFrom, secondTo));
}

function orientation(first: GraphPoint, second: GraphPoint, third: GraphPoint): number {
  return cross(subtract(second, first), subtract(third, first));
}

function subtract(left: GraphPoint, right: GraphPoint): GraphPoint {
  return { x: left.x - right.x, y: left.y - right.y };
}

function cross(left: GraphPoint, right: GraphPoint): number {
  return left.x * right.y - left.y * right.x;
}

function distance(left: GraphPoint, right: GraphPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
