/**
 * Authoritative minimum-region road planning for declarative transport maps.
 *
 * The planner accepts only compiler-canonical simple polygons and a navigation
 * graph derived from their positive-length shared boundaries. It deliberately
 * fails closed when geometry exceeds the bounded v1 feature set: returning an
 * attractive but invalid road would silently charge the wrong construction
 * price and is therefore worse than rejecting the action.
 */
import { createHash } from "node:crypto";
import type {
  GameManifestCanonicalPoint,
  GameManifestTransportNetworkModel,
  GameManifestTransportRegion,
  GameManifestTransportRoadPlanning,
  GameManifestTransportRoadPortal
} from "@cubica/contracts-manifest";

export const REGION_ROAD_PLANNING_MODE = "region-segment-minimum" as const;
export const REGION_ROAD_PLANNING_ALGORITHM = "region-segment-minimum-v1" as const;
export const REGION_ROAD_BOUNDARY_POLICY = "lowest-region-id" as const;

const EPSILON = 1e-9;
const MAX_REGIONS = 512;
const MAX_VERTICES_PER_REGION = 512;
const MAX_TOTAL_VERTICES = 20_000;
const MAX_PORTALS = 4_096;
const MAX_BOUNDARY_COMPARISONS = 2_000_000;
const MAX_ROUTE_CANDIDATES = 128;
const MAX_PORTAL_COMBINATIONS = 128;
const MAX_VISIBILITY_WORK = 5_000_000;
const MAX_COORDINATE_MAGNITUDE = 1_000_000_000;

const codepointCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

type Point = GameManifestCanonicalPoint;
type Region = GameManifestTransportRegion;
type Portal = GameManifestTransportRoadPortal;

class InvalidRegionRoadCandidateError extends Error {}

export interface RegionRoadPassage {
  regionId: string;
  fromPointIndex: number;
  toPointIndex: number;
}

export interface RegionRoadCandidate {
  points: Array<Point>;
  regionSequence: Array<string>;
  passages: Array<RegionRoadPassage>;
}

export interface CompiledRegionRoadPlanning {
  planning: GameManifestTransportRoadPlanning;
  regions: Array<Region>;
  portals: Array<Portal>;
  regionsById: Map<string, Region>;
  portalsByPair: Map<string, Array<Portal>>;
}

const finitePoint = (raw: Point, label: string): Point => {
  if (!raw || typeof raw.x !== "number" || !Number.isFinite(raw.x) ||
      typeof raw.y !== "number" || !Number.isFinite(raw.y) ||
      Math.abs(raw.x) > MAX_COORDINATE_MAGNITUDE || Math.abs(raw.y) > MAX_COORDINATE_MAGNITUDE) {
    throw new Error(`${label} must contain finite bounded canonical coordinates`);
  }
  // JSON.stringify normalises -0, but doing it here makes point comparison and
  // the documented hash input explicit rather than engine-incidental.
  return { x: Object.is(raw.x, -0) ? 0 : raw.x, y: Object.is(raw.y, -0) ? 0 : raw.y };
};

const pointCompare = (left: Point, right: Point): number =>
  left.x === right.x ? left.y - right.y : left.x - right.x;
const pointEquals = (left: Point, right: Point): boolean =>
  left.x === right.x && left.y === right.y;
const pointNearlyEquals = (left: Point, right: Point): boolean =>
  Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
const pointKey = (point: Point): string => `${point.x},${point.y}`;
const subtract = (left: Point, right: Point): Point => ({ x: left.x - right.x, y: left.y - right.y });
const cross = (left: Point, right: Point): number => left.x * right.y - left.y * right.x;
const dot = (left: Point, right: Point): number => left.x * right.x + left.y * right.y;
const distance = (left: Point, right: Point): number => Math.hypot(left.x - right.x, left.y - right.y);
const interpolate = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t
});

const signedDoubleArea = (polygon: ReadonlyArray<Point>): number => polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return sum + point.x * next.y - point.y * next.x;
}, 0);

const pointOnSegment = (point: Point, from: Point, to: Point): boolean => {
  const segment = subtract(to, from);
  const offset = subtract(point, from);
  const tolerance = EPSILON * Math.max(1, Math.hypot(segment.x, segment.y));
  return Math.abs(cross(offset, segment)) <= tolerance &&
    point.x >= Math.min(from.x, to.x) - EPSILON && point.x <= Math.max(from.x, to.x) + EPSILON &&
    point.y >= Math.min(from.y, to.y) - EPSILON && point.y <= Math.max(from.y, to.y) + EPSILON;
};

/** Inclusive membership is required because a terminal may belong to several regions. */
const pointInOrOnPolygon = (point: Point, polygon: ReadonlyArray<Point>): boolean => {
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
};

const orientation = (a: Point, b: Point, c: Point): number => cross(subtract(b, a), subtract(c, a));
const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (((first > EPSILON && second < -EPSILON) || (first < -EPSILON && second > EPSILON)) &&
      ((third > EPSILON && fourth < -EPSILON) || (third < -EPSILON && fourth > EPSILON))) return true;
  return (Math.abs(first) <= EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(second) <= EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(third) <= EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(fourth) <= EPSILON && pointOnSegment(b, c, d));
};

const segmentsProperlyCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return ((first > EPSILON && second < -EPSILON) || (first < -EPSILON && second > EPSILON)) &&
    ((third > EPSILON && fourth < -EPSILON) || (third < -EPSILON && fourth > EPSILON));
};

const pointStrictlyInsidePolygon = (point: Point, polygon: ReadonlyArray<Point>): boolean => {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return false;
  }
  return pointInOrOnPolygon(point, polygon);
};

/** Small inward samples expose aligned area overlaps that have no proper edge crossing. */
const interiorBoundaryProbes = (polygon: ReadonlyArray<Point>): Array<Point> => polygon.flatMap((from, index) => {
  const to = polygon[(index + 1) % polygon.length];
  const edge = subtract(to, from);
  const length = Math.hypot(edge.x, edge.y);
  const inward = { x: -edge.y / length, y: edge.x / length };
  const offset = Math.max(1, length) * 1e-7;
  return [0.25, 0.5, 0.75].map((t) => {
    const boundary = interpolate(from, to, t);
    return { x: boundary.x + inward.x * offset, y: boundary.y + inward.y * offset };
  });
});

const assertSimplePolygon = (polygon: ReadonlyArray<Point>, regionId: string) => {
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    if (pointNearlyEquals(polygon[first], polygon[firstNext])) {
      throw new Error(`Road-planning region "${regionId}" has a zero-length boundary edge`);
    }
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (!adjacent && segmentsIntersect(
        polygon[first], polygon[firstNext], polygon[second], polygon[secondNext]
      )) {
        throw new Error(`Road-planning region "${regionId}" is not a simple polygon`);
      }
    }
  }
};

/**
 * v1 supports a planar subdivision: region interiors must be disjoint, while
 * shared edges and isolated boundary touches are allowed. This prevents a
 * direct manifest from inventing ambiguous overlapping paid areas even if it
 * bypasses the authoring converter.
 */
const assertDisjointRegionInteriors = (regions: ReadonlyArray<Region>) => {
  let comparisons = 0;
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      for (let leftEdge = 0; leftEdge < left.polygon.length; leftEdge += 1) {
        for (let rightEdge = 0; rightEdge < right.polygon.length; rightEdge += 1) {
          comparisons += 1;
          if (comparisons > MAX_BOUNDARY_COMPARISONS) {
            throw new Error("Road-planning geometry exceeds the bounded cross-region work limit");
          }
          if (segmentsProperlyCross(
            left.polygon[leftEdge], left.polygon[(leftEdge + 1) % left.polygon.length],
            right.polygon[rightEdge], right.polygon[(rightEdge + 1) % right.polygon.length]
          )) {
            throw new Error(`Road-planning regions "${left.id}" and "${right.id}" have overlapping interiors`);
          }
        }
      }
      const hasInteriorVertex = left.polygon.some((point) => pointStrictlyInsidePolygon(point, right.polygon)) ||
        right.polygon.some((point) => pointStrictlyInsidePolygon(point, left.polygon));
      const hasInteriorProbe = interiorBoundaryProbes(left.polygon)
        .some((point) => pointStrictlyInsidePolygon(point, right.polygon)) ||
        interiorBoundaryProbes(right.polygon)
          .some((point) => pointStrictlyInsidePolygon(point, left.polygon));
      const sameBoundary = left.polygon.every((point) =>
        right.polygon.some((candidate, index) =>
          pointOnSegment(point, candidate, right.polygon[(index + 1) % right.polygon.length]))) &&
        right.polygon.every((point) =>
          left.polygon.some((candidate, index) =>
            pointOnSegment(point, candidate, left.polygon[(index + 1) % left.polygon.length])));
      if (hasInteriorVertex || hasInteriorProbe || sameBoundary) {
        throw new Error(`Road-planning regions "${left.id}" and "${right.id}" have overlapping interiors`);
      }
    }
  }
};

/** Apply the package compiler's hash-normalisation rules to region polygons. */
export const canonicalizeRoadPlanningRegions = (
  rawRegions: ReadonlyArray<GameManifestTransportRegion>
): Array<Region> => {
  if (rawRegions.length < 1 || rawRegions.length > MAX_REGIONS) {
    throw new Error(`Road planning supports 1..${MAX_REGIONS} regions`);
  }
  const ids = new Set<string>();
  let totalVertices = 0;
  const regions = rawRegions.map((rawRegion) => {
    if (typeof rawRegion.id !== "string" || rawRegion.id.length < 1 || rawRegion.id.length > 256) {
      throw new Error("Road-planning region ids must be non-empty bounded strings");
    }
    if (ids.has(rawRegion.id)) throw new Error(`Duplicate road-planning region id "${rawRegion.id}"`);
    ids.add(rawRegion.id);
    let polygon = rawRegion.polygon.map((point, index) =>
      finitePoint(point, `Road-planning region "${rawRegion.id}" point ${index}`));
    if (polygon.length > 1 && pointEquals(polygon[0], polygon[polygon.length - 1])) polygon = polygon.slice(0, -1);
    if (polygon.length < 3 || polygon.length > MAX_VERTICES_PER_REGION) {
      throw new Error(`Road-planning region "${rawRegion.id}" supports 3..${MAX_VERTICES_PER_REGION} vertices`);
    }
    totalVertices += polygon.length;
    if (totalVertices > MAX_TOTAL_VERTICES) {
      throw new Error(`Road planning supports at most ${MAX_TOTAL_VERTICES} polygon vertices`);
    }
    const vertexKeys = new Set(polygon.map(pointKey));
    if (vertexKeys.size !== polygon.length) {
      throw new Error(`Road-planning region "${rawRegion.id}" repeats a polygon vertex`);
    }
    const area = signedDoubleArea(polygon);
    if (Math.abs(area) <= EPSILON) throw new Error(`Road-planning region "${rawRegion.id}" has zero area`);
    if (area < 0) polygon.reverse();
    let firstIndex = 0;
    for (let index = 1; index < polygon.length; index += 1) {
      if (pointCompare(polygon[index], polygon[firstIndex]) < 0) firstIndex = index;
    }
    polygon = [...polygon.slice(firstIndex), ...polygon.slice(0, firstIndex)];
    assertSimplePolygon(polygon, rawRegion.id);
    return { id: rawRegion.id, polygon };
  });
  const sorted = regions.sort((left, right) => codepointCompare(left.id, right.id));
  assertDisjointRegionInteriors(sorted);
  return sorted;
};

/** Return the positive shared portion of two collinear polygon edges. */
const sharedBoundary = (a: Point, b: Point, c: Point, d: Point): { from: Point; to: Point } | undefined => {
  const ab = subtract(b, a);
  const scale = Math.max(1, distance(a, b));
  if (Math.abs(cross(ab, subtract(c, a))) > EPSILON * scale ||
      Math.abs(cross(ab, subtract(d, a))) > EPSILON * scale) return undefined;
  const shared = [a, b, c, d]
    .filter((point) => pointOnSegment(point, a, b) && pointOnSegment(point, c, d))
    .filter((point, index, all) => all.findIndex((candidate) => pointNearlyEquals(candidate, point)) === index)
    .sort(pointCompare);
  if (shared.length < 2) return undefined;
  const from = shared[0];
  const to = shared[shared.length - 1];
  if (distance(from, to) <= EPSILON) return undefined;
  return { from: { ...from }, to: { ...to } };
};

export interface DerivedPortalGeometry {
  regionIds: [string, string];
  from: Point;
  to: Point;
}

const portalGeometryKey = (portal: Pick<Portal, "regionIds" | "from" | "to">): string =>
  JSON.stringify({ regionIds: portal.regionIds, from: portal.from, to: portal.to });

export const deriveRoadPlanningPortalGeometry = (
  regions: ReadonlyArray<Region>
): Array<DerivedPortalGeometry> => {
  const result: Array<DerivedPortalGeometry> = [];
  let comparisons = 0;
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      for (let leftEdge = 0; leftEdge < left.polygon.length; leftEdge += 1) {
        for (let rightEdge = 0; rightEdge < right.polygon.length; rightEdge += 1) {
          comparisons += 1;
          if (comparisons > MAX_BOUNDARY_COMPARISONS) {
            throw new Error("Road-planning geometry exceeds the bounded shared-boundary work limit");
          }
          const overlap = sharedBoundary(
            left.polygon[leftEdge], left.polygon[(leftEdge + 1) % left.polygon.length],
            right.polygon[rightEdge], right.polygon[(rightEdge + 1) % right.polygon.length]
          );
          if (overlap) result.push({ regionIds: [left.id, right.id], ...overlap });
        }
      }
    }
  }
  const unique = new Map(result.map((portal) => [portalGeometryKey(portal), portal]));
  const merged = [...unique.values()];
  // A compiler may simplify one side of a shared boundary differently from
  // the other. Merge touching collinear pieces so an extra intermediate vertex
  // cannot change graph topology or the advertised hash.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let firstIndex = 0; firstIndex < merged.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < merged.length; secondIndex += 1) {
        const first = merged[firstIndex];
        const second = merged[secondIndex];
        if (first.regionIds[0] !== second.regionIds[0] || first.regionIds[1] !== second.regionIds[1] ||
            !segmentsIntersect(first.from, first.to, second.from, second.to) ||
            Math.abs(orientation(first.from, first.to, second.from)) > EPSILON ||
            Math.abs(orientation(first.from, first.to, second.to)) > EPSILON) continue;
        const endpoints = [first.from, first.to, second.from, second.to].sort(pointCompare);
        merged.splice(firstIndex, 1, {
          regionIds: first.regionIds,
          from: { ...endpoints[0] },
          to: { ...endpoints[endpoints.length - 1] }
        });
        merged.splice(secondIndex, 1);
        changed = true;
        break outer;
      }
    }
  }
  return merged.sort((left, right) => codepointCompare(portalGeometryKey(left), portalGeometryKey(right)));
};

const canonicalizeDeclaredPortals = (rawPortals: ReadonlyArray<Portal>): Array<Portal> => {
  if (rawPortals.length > MAX_PORTALS) throw new Error(`Road planning supports at most ${MAX_PORTALS} portals`);
  const ids = new Set<string>();
  const portals = rawPortals.map((raw, index) => {
    if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 256 || ids.has(raw.id)) {
      throw new Error(`Road-planning portal ${index} must have a unique bounded id`);
    }
    ids.add(raw.id);
    const regionIds = [...raw.regionIds].sort(codepointCompare) as [string, string];
    if (regionIds.length !== 2 || regionIds[0] === regionIds[1]) {
      throw new Error(`Road-planning portal "${raw.id}" must join two different regions`);
    }
    let from = finitePoint(raw.from, `Road-planning portal "${raw.id}" from`);
    let to = finitePoint(raw.to, `Road-planning portal "${raw.id}" to`);
    if (pointCompare(from, to) > 0) [from, to] = [to, from];
    if (distance(from, to) <= EPSILON) {
      throw new Error(`Road-planning portal "${raw.id}" must have positive length`);
    }
    return { id: raw.id, regionIds, from, to };
  });
  return portals.sort((left, right) => codepointCompare(left.id, right.id));
};

/** Hash input is intentionally narrower than package metadata and state paths. */
export const computeRegionRoadPlanningHash = (options: {
  algorithmVersion: typeof REGION_ROAD_PLANNING_ALGORITHM;
  boundaryPolicy: typeof REGION_ROAD_BOUNDARY_POLICY;
  regions: ReadonlyArray<Region>;
  portals: ReadonlyArray<Portal>;
}): string => {
  const source = JSON.stringify({
    algorithmVersion: options.algorithmVersion,
    boundaryPolicy: options.boundaryPolicy,
    regions: options.regions,
    portals: options.portals
  });
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
};

/** Validate and compile the immutable, schema-first planning contract. */
export const compileRegionRoadPlanning = (
  model: GameManifestTransportNetworkModel
): CompiledRegionRoadPlanning => {
  const planning = model.roadPlanning;
  if (!planning) throw new Error("Transport network did not opt in to authoritative road planning");
  if (planning.mode !== REGION_ROAD_PLANNING_MODE ||
      planning.algorithmVersion !== REGION_ROAD_PLANNING_ALGORITHM ||
      planning.tieBreak !== "session-random" || planning.boundaryPolicy !== REGION_ROAD_BOUNDARY_POLICY) {
    throw new Error("Transport network declares an unsupported road-planning contract");
  }
  if (planning.excludedRegionIdsPath && !planning.excludedRegionIdsPath.startsWith(`/${model.visibility}/`)) {
    throw new Error("Road-planning excluded regions path must use the network visibility branch");
  }
  const regions = canonicalizeRoadPlanningRegions(model.regions);
  const portals = canonicalizeDeclaredPortals(planning.navigationGraph.portals);
  // Planned content is required to be compiler-canonical. Silently normalising
  // at runtime would make the advertised package hash ambiguous.
  if (JSON.stringify(model.regions) !== JSON.stringify(regions) ||
      JSON.stringify(planning.navigationGraph.portals) !== JSON.stringify(portals)) {
    throw new Error("Road-planning regions and portals must use compiler-canonical ordering");
  }
  const regionIds = new Set(regions.map((region) => region.id));
  for (const portal of portals) {
    if (!portal.regionIds.every((regionId) => regionIds.has(regionId))) {
      throw new Error(`Road-planning portal "${portal.id}" references an unknown region`);
    }
  }
  const expectedGeometry = deriveRoadPlanningPortalGeometry(regions).map(portalGeometryKey);
  const declaredGeometry = portals.map(portalGeometryKey).sort(codepointCompare);
  if (JSON.stringify(declaredGeometry) !== JSON.stringify(expectedGeometry)) {
    throw new Error("Road-planning navigation portals do not match derived shared boundaries");
  }
  const geometryHash = computeRegionRoadPlanningHash({
    algorithmVersion: planning.algorithmVersion,
    boundaryPolicy: planning.boundaryPolicy,
    regions,
    portals
  });
  if (planning.geometryHash !== geometryHash) {
    throw new Error(`Road-planning geometry hash mismatch: expected ${geometryHash}`);
  }
  const portalsByPair = new Map<string, Array<Portal>>();
  for (const portal of portals) {
    const key = portal.regionIds.join("\u0000");
    portalsByPair.set(key, [...(portalsByPair.get(key) ?? []), portal]);
  }
  return {
    planning,
    regions,
    portals,
    regionsById: new Map(regions.map((region) => [region.id, region])),
    portalsByPair
  };
};

const boundaryParameters = (from: Point, to: Point, a: Point, b: Point): Array<number> => {
  const route = subtract(to, from);
  const edge = subtract(b, a);
  const denominator = cross(route, edge);
  if (Math.abs(denominator) > EPSILON) {
    const offset = subtract(a, from);
    const t = cross(offset, edge) / denominator;
    const u = cross(offset, route) / denominator;
    return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON
      ? [Math.max(0, Math.min(1, t))]
      : [];
  }
  if (Math.abs(cross(route, subtract(a, from))) > EPSILON) return [];
  const denominatorLength = dot(route, route);
  if (denominatorLength <= EPSILON) return [];
  return [a, b]
    .map((point) => dot(subtract(point, from), route) / denominatorLength)
    .filter((t) => t >= -EPSILON && t <= 1 + EPSILON)
    .map((t) => Math.max(0, Math.min(1, t)));
};

/** Check every interval between boundary crossings, not only one midpoint. */
const segmentInsidePolygon = (from: Point, to: Point, polygon: ReadonlyArray<Point>): boolean => {
  if (!pointInOrOnPolygon(from, polygon) || !pointInOrOnPolygon(to, polygon)) return false;
  const parameters = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    parameters.push(...boundaryParameters(from, to, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  const sorted = [...new Set(parameters.map((value) => Math.round(value * 1e12) / 1e12))]
    .sort((left, right) => left - right);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index + 1] - sorted[index] <= EPSILON) continue;
    if (!pointInOrOnPolygon(interpolate(from, to, (sorted[index] + sorted[index + 1]) / 2), polygon)) {
      return false;
    }
  }
  return true;
};

/** Deterministic visibility-graph path inside one bounded simple polygon. */
const shortestInsidePath = (
  from: Point,
  to: Point,
  region: Region,
  forbiddenSharedBoundaries: ReadonlyArray<Pick<Portal, "from" | "to">>
): Array<Point> => {
  if (pointNearlyEquals(from, to)) return [{ ...from }];
  const nodes = [from, to, ...region.polygon].filter((point, index, all) =>
    all.findIndex((candidate) => pointNearlyEquals(candidate, point)) === index);
  const estimatedWork = nodes.length * Math.max(0, nodes.length - 1) / 2 * region.polygon.length;
  if (estimatedWork > MAX_VISIBILITY_WORK) {
    throw new Error(`Road route through region "${region.id}" exceeds bounded v1 visibility work`);
  }
  const adjacency: Array<Array<{ index: number; length: number }>> = nodes.map(() => []);
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (!segmentInsidePolygon(nodes[left], nodes[right], region.polygon)) continue;
      // Under the declared boundary policy, a positive-length line shared by
      // two regions belongs only to the lexicographically lower id. For the
      // higher region we remove that visibility edge rather than charging an
      // ambiguous passage to both sides.
      if (forbiddenSharedBoundaries.some((boundary) =>
        sharedBoundary(nodes[left], nodes[right], boundary.from, boundary.to) !== undefined)) continue;
      const length = distance(nodes[left], nodes[right]);
      if (length <= EPSILON) continue;
      adjacency[left].push({ index: right, length });
      adjacency[right].push({ index: left, length });
    }
  }
  const start = nodes.findIndex((point) => pointNearlyEquals(point, from));
  const end = nodes.findIndex((point) => pointNearlyEquals(point, to));
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const pathKeys = nodes.map(() => "");
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  distances[start] = 0;
  pathKeys[start] = pointKey(nodes[start]);
  while (!visited.has(end)) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (visited.has(index) || !Number.isFinite(distances[index])) continue;
      if (current < 0 || distances[index] < distances[current] - EPSILON ||
          (Math.abs(distances[index] - distances[current]) <= EPSILON && pathKeys[index] < pathKeys[current])) {
        current = index;
      }
    }
    if (current < 0) {
      throw new InvalidRegionRoadCandidateError(`No valid v1 route exists inside region "${region.id}"`);
    }
    visited.add(current);
    for (const next of adjacency[current]) {
      if (visited.has(next.index)) continue;
      const candidateDistance = distances[current] + next.length;
      const candidateKey = `${pathKeys[current]}|${pointKey(nodes[next.index])}`;
      if (candidateDistance < distances[next.index] - EPSILON ||
          (Math.abs(candidateDistance - distances[next.index]) <= EPSILON &&
            (!pathKeys[next.index] || candidateKey < pathKeys[next.index]))) {
        distances[next.index] = candidateDistance;
        pathKeys[next.index] = candidateKey;
        previous[next.index] = current;
      }
    }
  }
  const path: Array<Point> = [];
  let cursor = end;
  while (cursor >= 0) {
    path.push({ ...nodes[cursor] });
    if (cursor === start) break;
    cursor = previous[cursor];
  }
  if (path[path.length - 1] && !pointNearlyEquals(path[path.length - 1], from)) {
    throw new InvalidRegionRoadCandidateError(`Failed to reconstruct route inside region "${region.id}"`);
  }
  return path.reverse();
};

const pairKey = (left: string, right: string): string =>
  [left, right].sort(codepointCompare).join("\u0000");

const enumerateMinimumSequences = (options: {
  compiled: CompiledRegionRoadPlanning;
  from: Point;
  to: Point;
  excluded: Set<string>;
}): Array<Array<string>> => {
  const available = options.compiled.regions.filter((region) => !options.excluded.has(region.id));
  const directBoundaryOwner = options.compiled.portals
    .filter((portal) => pointOnSegment(options.from, portal.from, portal.to) &&
      pointOnSegment(options.to, portal.from, portal.to))
    .map((portal) => portal.regionIds[0])
    .sort(codepointCompare)[0];
  const startRegions = available.filter((region) => pointInOrOnPolygon(options.from, region.polygon) &&
      (!directBoundaryOwner || region.id === directBoundaryOwner))
    .map((region) => region.id).sort(codepointCompare);
  const endRegions = new Set(available.filter((region) => pointInOrOnPolygon(options.to, region.polygon) &&
      (!directBoundaryOwner || region.id === directBoundaryOwner))
    .map((region) => region.id));
  if (startRegions.length === 0 || endRegions.size === 0) {
    throw new Error("Road endpoints must lie inside non-excluded declared regions");
  }
  const adjacency = new Map<string, Set<string>>();
  for (const portal of options.compiled.portals) {
    const [left, right] = portal.regionIds;
    if (options.excluded.has(left) || options.excluded.has(right)) continue;
    adjacency.set(left, new Set([...(adjacency.get(left) ?? []), right]));
    adjacency.set(right, new Set([...(adjacency.get(right) ?? []), left]));
  }
  const distanceByRegion = new Map<string, number>();
  const predecessors = new Map<string, Set<string>>();
  const queue: Array<string> = [];
  for (const start of startRegions) {
    distanceByRegion.set(start, 1);
    queue.push(start);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const nextDistance = (distanceByRegion.get(current) as number) + 1;
    for (const next of [...(adjacency.get(current) ?? [])].sort(codepointCompare)) {
      const known = distanceByRegion.get(next);
      if (known === undefined) {
        distanceByRegion.set(next, nextDistance);
        predecessors.set(next, new Set([current]));
        queue.push(next);
      } else if (known === nextDistance) {
        predecessors.set(next, new Set([...(predecessors.get(next) ?? []), current]));
      }
    }
  }
  const reachableEnds = [...endRegions].filter((regionId) => distanceByRegion.has(regionId));
  if (reachableEnds.length === 0) throw new Error("No road route connects the selected regions");
  const minimum = Math.min(...reachableEnds.map((regionId) => distanceByRegion.get(regionId) as number));
  const sequences: Array<Array<string>> = [];
  const collect = (regionId: string, suffix: Array<string>) => {
    if (sequences.length >= MAX_ROUTE_CANDIDATES) {
      throw new Error(`Road planning exceeds ${MAX_ROUTE_CANDIDATES} equal minimum route candidates`);
    }
    const distanceValue = distanceByRegion.get(regionId);
    if (distanceValue === 1) {
      sequences.push([regionId, ...suffix]);
      return;
    }
    for (const predecessor of [...(predecessors.get(regionId) ?? [])]
      .sort(codepointCompare)) {
      collect(predecessor, [regionId, ...suffix]);
    }
  };
  for (const end of reachableEnds.filter((regionId) => distanceByRegion.get(regionId) === minimum)
    .sort(codepointCompare)) collect(end, []);
  const unique = new Map(sequences.map((sequence) => [sequence.join("\u0000"), sequence]));
  return [...unique.values()].sort((left, right) => codepointCompare(left.join("\u0000"), right.join("\u0000")));
};

const buildCandidateForPortals = (
  compiled: CompiledRegionRoadPlanning,
  sequence: Array<string>,
  from: Point,
  to: Point,
  selectedPortals: Array<Portal>
): RegionRoadCandidate => {
  const transitionPoints = selectedPortals.map((portal) => interpolate(portal.from, portal.to, 0.5));
  const points: Array<Point> = [];
  const passages: Array<RegionRoadPassage> = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const region = compiled.regionsById.get(sequence[index]);
    if (!region) throw new Error(`Road-planning sequence references unknown region "${sequence[index]}"`);
    const entry = index === 0 ? from : transitionPoints[index - 1];
    const exit = index === sequence.length - 1 ? to : transitionPoints[index];
    const forbiddenSharedBoundaries = compiled.portals.filter((portal) =>
      portal.regionIds[1] === region.id).map((portal) => ({ from: portal.from, to: portal.to }));
    const localPath = shortestInsidePath(entry, exit, region, forbiddenSharedBoundaries);
    const startIndex = points.length === 0 ? 0 : points.length - 1;
    if (points.length === 0) points.push(...localPath);
    else points.push(...localPath.slice(1));
    const endIndex = points.length - 1;
    if (endIndex <= startIndex || distance(entry, exit) <= EPSILON) {
      throw new InvalidRegionRoadCandidateError(
        `Minimum sequence contains a zero-length passage through region "${region.id}"`
      );
    }
    passages.push({ regionId: region.id, fromPointIndex: startIndex, toPointIndex: endIndex });
  }
  return { points, regionSequence: sequence, passages };
};

const candidateLength = (candidate: RegionRoadCandidate): number => candidate.points
  .slice(0, -1)
  .reduce((sum, point, index) => sum + distance(point, candidate.points[index + 1]), 0);

/** Choose the shortest valid midpoint route; exact ties use codepoint geometry order. */
const buildCandidate = (
  compiled: CompiledRegionRoadPlanning,
  sequence: Array<string>,
  from: Point,
  to: Point
): RegionRoadCandidate => {
  const portalOptions: Array<Array<Portal>> = [];
  let combinationCount = 1;
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const portals = compiled.portalsByPair.get(pairKey(sequence[index], sequence[index + 1]));
    if (!portals?.length) throw new Error("Road-planning sequence is missing a compiled portal");
    const ordered = [...portals].sort((left, right) => codepointCompare(left.id, right.id));
    combinationCount *= ordered.length;
    if (combinationCount > MAX_PORTAL_COMBINATIONS) {
      throw new Error(`Road route exceeds ${MAX_PORTAL_COMBINATIONS} portal combinations`);
    }
    portalOptions.push(ordered);
  }
  const combinations: Array<Array<Portal>> = [];
  const collect = (index: number, selected: Array<Portal>) => {
    if (index === portalOptions.length) {
      combinations.push(selected);
      return;
    }
    for (const portal of portalOptions[index]) collect(index + 1, [...selected, portal]);
  };
  collect(0, []);
  const candidates: Array<RegionRoadCandidate> = [];
  for (const portals of combinations) {
    try {
      candidates.push(buildCandidateForPortals(compiled, sequence, from, to, portals));
    } catch (error) {
      if (!(error instanceof InvalidRegionRoadCandidateError)) throw error;
    }
  }
  if (candidates.length === 0) {
    throw new InvalidRegionRoadCandidateError("Minimum region sequence has no boundary-policy-safe polyline");
  }
  return candidates.sort((left, right) => {
    const lengthDelta = candidateLength(left) - candidateLength(right);
    return Math.abs(lengthDelta) > EPSILON
      ? lengthDelta
      : codepointCompare(JSON.stringify(left.points), JSON.stringify(right.points));
  })[0];
};

/**
 * Compile all unique, geometrically valid minimum region sequences. Randomness
 * is intentionally left to the caller so it can be persisted in session state
 * only after every candidate and exclusion has been validated.
 */
export const prepareMinimumRegionRoadCandidates = (options: {
  model: GameManifestTransportNetworkModel;
  from: Point;
  to: Point;
  excludedRegionIds?: ReadonlyArray<string>;
}): { compiled: CompiledRegionRoadPlanning; candidates: Array<RegionRoadCandidate> } => {
  const from = finitePoint(options.from, "Road origin");
  const to = finitePoint(options.to, "Road destination");
  if (pointNearlyEquals(from, to)) throw new Error("Road endpoints must have different positions");
  const compiled = compileRegionRoadPlanning(options.model);
  const excluded = new Set(options.excludedRegionIds ?? []);
  for (const regionId of excluded) {
    if (typeof regionId !== "string" || !compiled.regionsById.has(regionId)) {
      throw new Error(`Excluded road-planning region "${String(regionId)}" is not declared`);
    }
  }
  const sequences = enumerateMinimumSequences({ compiled, from, to, excluded });
  const candidates: Array<RegionRoadCandidate> = [];
  for (const sequence of sequences) {
    try {
      candidates.push(buildCandidate(compiled, sequence, from, to));
    } catch (error) {
      if (!(error instanceof InvalidRegionRoadCandidateError)) throw error;
    }
  }
  if (candidates.length === 0) throw new Error("No geometrically valid minimum-region road exists");
  return { compiled, candidates };
};
