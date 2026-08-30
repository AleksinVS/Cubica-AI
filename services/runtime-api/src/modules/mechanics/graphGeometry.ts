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
import {
  MAX_GEOMETRY_COORDINATE_MAGNITUDE,
  canonicalGeometryPoint,
  distance,
  pointsEqual
} from "../geometryPredicates.ts";
import {
  canonicalizeRoadPlanningRegions,
  pointInOrOnRegion
} from "../runtime/regionRoadGeometry.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";

export const GRAPH_GEOMETRY_EPSILON = 1e-9;
export const GRAPH_MAX_COORDINATE_MAGNITUDE = MAX_GEOMETRY_COORDINATE_MAGNITUDE;
// The number of regions is deliberately not bounded here. Geometry work scales
// with the total number of polygon vertices, which stays bounded below, and not
// with how those vertices are grouped into regions: an author map of nine
// hundred small areas is no more work than one of five hundred larger ones with
// the same outline detail.
export const GRAPH_MAX_VERTICES_PER_REGION = 2048;
// Measured against the current real author map: a partition of 982 areas holds
// 89 331 vertices. The limit sits well above it so an ordinary map passes,
// while a runaway one is still stopped.
export const GRAPH_MAX_TOTAL_REGION_VERTICES = 200_000;
export const GRAPH_MAX_POLYLINE_POINTS = 20_000;

export const GRAPH_EDGE_POSITION_ALGORITHM = "polyline-arc-length-v1" as const;
// Version 3 retains version 2's inner-ring support and adds unique ownership
// for authoritative boundary decisions. A region's inner
// rings (holes) are honoured. A point strictly inside a hole is no longer a
// member of the region around it, because the hole is not part of that region —
// it is a separate area cut out of it (an enclave, a lake, a patch of terrain).
// Version 1 rejected any region with holes outright, so no stored proof can
// have been produced under version 1 for a map that has them, and the version
// is bumped rather than reused so a fingerprint always states which rule
// produced it.
export const GRAPH_REGION_MEMBERSHIP_ALGORITHM = "closed-polygon-all-memberships-v3" as const;
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
  /**
   * Inner rings cut out of the region: a lake, an enclave, a patch of terrain
   * declared impassable. Absent on a region that has none, so a map without
   * holes canonicalizes to exactly the value it did before holes existed.
   */
  holes?: Array<Array<GraphPoint>>;
}

/** Optional transaction budget hook for immutable geometry work. */
export interface GraphGeometryWorkMeter {
  charge(units: number): void;
}

const canonicalGraphRegionsCache = new WeakMap<
  ReadonlyArray<GameManifestTransportRegion>,
  Array<CanonicalGraphRegion>
>();

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
  try {
    return canonicalGeometryPoint({ x: raw.x, y: raw.y }, label);
  } catch (error) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      error instanceof Error ? error.message : `${label} is not on the canonical coordinate grid`
    );
  }
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
      // This is a metric interpolation result, not stored manifest topology;
      // it intentionally keeps full IEEE-754 precision instead of snapping to
      // the structural 1e-6 grid.
      const point = {
        x: points[index].x + (points[index + 1].x - points[index].x) * localPosition,
        y: points[index].y + (points[index + 1].y - points[index].y) * localPosition
      };
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
  rawRegions: ReadonlyArray<GameManifestTransportRegion>,
  workMeter?: GraphGeometryWorkMeter
): Array<CanonicalGraphRegion> {
  const cached = canonicalGraphRegionsCache.get(rawRegions);
  if (cached) {
    workMeter?.charge(1);
    return cached;
  }
  // Charge before immutable validation starts. The bound follows the actual
  // rings supplied, includes holes, and is intentionally conservative so a
  // budget rejection happens before the expensive pass rather than after it.
  const validationWork = rawRegions.reduce((sum, region) => {
    const rings = [region.polygon, ...(region.holes ?? [])];
    return sum + rings.reduce((ringSum, ring) => ringSum + ring.length * ring.length + ring.length, 0);
  }, rawRegions.length);
  workMeter?.charge(validationWork);
  try {
    const canonical = canonicalizeRoadPlanningRegions(rawRegions) as Array<CanonicalGraphRegion>;
    canonicalGraphRegionsCache.set(rawRegions, canonical);
    return canonical;
  } catch (error) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      error instanceof Error ? error.message : "Graph geometry is invalid"
    );
  }
}

/**
 * Return every region whose closed shape contains or touches the point.
 *
 * A region's shape is its outer ring MINUS its holes. A point strictly inside
 * a hole therefore does not belong to the region around it: the hole is a
 * separate area cut out of that region — a lake, an enclave, a patch of
 * impassable terrain — and is published as a region in its own right. A point
 * exactly ON a hole's border does belong to both, exactly as a point on the
 * border between two ordinary neighbouring regions belongs to both.
 */
export function closedGraphRegionMembership(
  point: GraphPoint,
  regions: ReadonlyArray<CanonicalGraphRegion>,
  workMeter?: GraphGeometryWorkMeter
): Array<string> {
  return regions
    .filter((region) => {
      workMeter?.charge(
        region.polygon.length + (region.holes ?? []).reduce((sum, hole) => sum + hole.length, 0)
      );
      return pointInOrOnRegion(point, region as Parameters<typeof pointInOrOnRegion>[1]);
    })
    .map((region) => region.id)
    .sort(compareCanonicalIds);
}

/** Apply the declared boundary owner after computing informative memberships. */
export function ownedGraphRegionMembership(
  point: GraphPoint,
  regions: ReadonlyArray<CanonicalGraphRegion>,
  workMeter?: GraphGeometryWorkMeter
): Array<string> {
  const memberships = closedGraphRegionMembership(point, regions, workMeter);
  return memberships.length === 0 ? [] : [memberships[0]];
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
  return pointsEqual(left, right);
}

export function graphPointsNearlyEqual(left: GraphPoint, right: GraphPoint): boolean {
  return distance(left, right) <= GRAPH_GEOMETRY_EPSILON;
}

function assertPositiveSegment(from: GraphPoint, to: GraphPoint, label: string): void {
  if (graphPointsEqual(from, to)) {
    throw new GraphGeometryError(
      "MECHANICS_GRAPH_GEOMETRY_INVALID",
      `${label} must have positive length`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
