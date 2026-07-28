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
import { isDeepStrictEqual } from "node:util";
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

/**
 * Stable internal stream owned by one declared transport network.
 *
 * Both preview and authoritative execution use this helper. Keeping the name
 * derivation beside the route algorithm prevents a UI preview and the later
 * command from silently resolving an exact tie through different streams.
 */
export const regionRoadRandomStreamId = (networkId: string): string =>
  `graph.${networkId}.road-planning`;

const EPSILON = 1e-9;
// The number of regions is deliberately unbounded; see graphGeometry.ts. What
// bounds the work are the limits below.
//
// Their values are measured on the first real author map rather than guessed:
// a partition of 917 areas with 78 352 vertices produces 33 470 portals, and
// the spatial prefilter reduces the shared-boundary work on it to about
// 1.2e5 comparisons. Each limit sits well above the measured value, so an
// ordinary map passes and a runaway one is still stopped.
const MAX_VERTICES_PER_REGION = 512;
const MAX_TOTAL_VERTICES = 200_000;
const MAX_PORTALS = 131_072;
const MAX_BOUNDARY_COMPARISONS = 20_000_000;
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

/**
 * Deterministic resource hook used by the Mechanics executor.
 *
 * The planner keeps geometry-specific hard ceilings as a final defence, while
 * this hook makes its work visible to the transaction-wide algorithm budget.
 */
export interface RegionRoadPlannerWorkMeter {
  charge(units: number): void;
}

const chargePlannerWork = (meter: RegionRoadPlannerWorkMeter | undefined, units: number): void => {
  if (units > 0) meter?.charge(units);
};

/**
 * Price immutable geometry validation before doing the work.
 *
 * The charge must reflect the work that will actually happen. Charging the
 * quadratic upper bound over all region pairs — as this did before — priced a
 * cost that the spatial prefilter never pays: on the first real author map the
 * estimate exceeded its own budget twelve thousand times while the real work
 * was four orders of magnitude smaller. A budget that refuses ordinary maps
 * measures the wrong thing.
 *
 * The estimate therefore runs the same prefilter first. The prefilter itself
 * is cheap — one sort and one sweep — and it is charged too, so no work is
 * unmetered.
 */
const estimateCompilationWork = (model: GameManifestTransportNetworkModel): number => {
  const vertexCounts = model.regions.map((region) => region.polygon.length);
  const totalVertices = vertexCounts.reduce((sum, count) => sum + count, 0);
  const selfComparisons = vertexCounts.reduce((sum, count) => sum + count * Math.max(0, count - 1) / 2, 0);
  const bounds = model.regions.map((region) => ({ bounds: boundsOfPoints(region.polygon) }));
  let crossComparisons = 0;
  for (const [left, right] of touchingSelfPairs(bounds)) {
    crossComparisons += vertexCounts[left] * vertexCounts[right];
  }
  // Touching pairs are visited by overlap validation, shared-boundary
  // derivation and bounded interior probes, hence the constant factor. The
  // sweep that found those pairs costs about one unit per region.
  return model.regions.length + totalVertices + selfComparisons +
    crossComparisons * 8 + (model.roadPlanning?.navigationGraph.portals.length ?? 0);
};

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

/**
 * Exact spatial prefilter for pairwise geometry work.
 *
 * Validating regions, deriving portals and pricing that work all ask the same
 * question of every pair of regions, and then of every pair of their sides.
 * Asking it of all pairs is quadratic: the first real author map — 917 areas
 * with 78 352 vertices — would need about three billion segment comparisons,
 * and the cost estimate alone would exceed its own budget twelve thousand
 * times over. In other words the platform refused real cartography by
 * construction, not by accident.
 *
 * The prefilter removes exactly the pairs that cannot matter and nothing else.
 * Two shapes whose axis-aligned bounds do not touch can neither overlap nor
 * share a boundary, so skipping them cannot change any answer. Exactness is
 * not optional here: the derived navigation graph is fixed by its published
 * hash, so an acceleration that merged "almost touching" borders would produce
 * a different graph and break the package. Bounds are therefore compared with
 * the same epsilon as the geometry itself, and every surviving pair is still
 * tested exactly as before.
 *
 * Pairs are found by sweeping along the x axis: shapes are visited in order of
 * their left edge and leave the active set once their right edge falls behind
 * the current left edge. On the map above this leaves 2 828 region pairs out of
 * 419 986 and about 1.2e5 side comparisons instead of 3.1e9.
 */
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface BoundedSide {
  from: Point;
  to: Point;
  bounds: Bounds;
}

const boundsOfPoints = (points: ReadonlyArray<Point>): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

const polygonSidesWithBounds = (polygon: ReadonlyArray<Point>): Array<BoundedSide> =>
  polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return { from: point, to: next, bounds: boundsOfPoints([point, next]) };
  });

const boundsOverlapInY = (left: Bounds, right: Bounds): boolean =>
  left.minY - EPSILON <= right.maxY && right.minY - EPSILON <= left.maxY;

/** Every unordered pair of items whose bounds touch, each reported once. */
const touchingSelfPairs = (items: ReadonlyArray<{ bounds: Bounds }>): Array<[number, number]> => {
  const order = items
    .map((item, index) => ({ index, bounds: item.bounds }))
    .sort((left, right) => left.bounds.minX - right.bounds.minX || left.index - right.index);
  const pairs: Array<[number, number]> = [];
  let active: Array<{ index: number; bounds: Bounds }> = [];
  for (const item of order) {
    active = active.filter((other) => other.bounds.maxX >= item.bounds.minX - EPSILON);
    for (const other of active) {
      if (!boundsOverlapInY(item.bounds, other.bounds)) continue;
      pairs.push(item.index < other.index ? [item.index, other.index] : [other.index, item.index]);
    }
    active.push(item);
  }
  return pairs;
};

/** Every pair of items from two different sets whose bounds touch. */
const touchingCrossPairs = (
  left: ReadonlyArray<{ bounds: Bounds }>,
  right: ReadonlyArray<{ bounds: Bounds }>
): Array<[number, number]> => {
  const order = [
    ...left.map((item, index) => ({ set: 0, index, bounds: item.bounds })),
    ...right.map((item, index) => ({ set: 1, index, bounds: item.bounds }))
  ].sort((first, second) =>
    first.bounds.minX - second.bounds.minX || first.set - second.set || first.index - second.index);
  const pairs: Array<[number, number]> = [];
  let active: Array<{ set: number; index: number; bounds: Bounds }> = [];
  for (const item of order) {
    active = active.filter((other) => other.bounds.maxX >= item.bounds.minX - EPSILON);
    for (const other of active) {
      if (other.set === item.set) continue;
      if (!boundsOverlapInY(item.bounds, other.bounds)) continue;
      pairs.push(item.set === 0 ? [item.index, other.index] : [other.index, item.index]);
    }
    active.push(item);
  }
  return pairs;
};

/** Regions prepared once and reused by every pairwise pass. */
interface PreparedRegion {
  region: Region;
  sides: Array<BoundedSide>;
  bounds: Bounds;
}

const prepareRegions = (regions: ReadonlyArray<Region>): Array<PreparedRegion> =>
  regions.map((region) => ({
    region,
    sides: polygonSidesWithBounds(region.polygon),
    bounds: boundsOfPoints(region.polygon)
  }));

const assertDisjointRegionInteriors = (regions: ReadonlyArray<Region>) => {
  const prepared = prepareRegions(regions);
  let comparisons = 0;
  // Regions whose bounds do not touch cannot share interior points, so only
  // touching pairs are examined; each examination is unchanged.
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex].region;
    const right = prepared[rightIndex].region;
    for (const [leftSide, rightSide] of
      touchingCrossPairs(prepared[leftIndex].sides, prepared[rightIndex].sides)) {
      comparisons += 1;
      if (comparisons > MAX_BOUNDARY_COMPARISONS) {
        throw new Error(
          "Road-planning geometry exceeds the bounded cross-region work limit. "
          + "The limit counts side comparisons that survive the spatial prefilter, "
          + "so reaching it means the regions genuinely touch that much."
        );
      }
      const first = prepared[leftIndex].sides[leftSide];
      const second = prepared[rightIndex].sides[rightSide];
      if (segmentsProperlyCross(first.from, first.to, second.from, second.to)) {
        throw new Error(`Road-planning regions "${left.id}" and "${right.id}" have overlapping interiors`);
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
};

/** Apply the package compiler's hash-normalisation rules to region polygons. */
export const canonicalizeRoadPlanningRegions = (
  rawRegions: ReadonlyArray<GameManifestTransportRegion>
): Array<Region> => {
  if (rawRegions.length < 1) {
    throw new Error("Road planning requires at least one region");
  }
  const ids = new Set<string>();
  let totalVertices = 0;
  const regions = rawRegions.map((rawRegion) => {
    if (typeof rawRegion.id !== "string" || rawRegion.id.length < 1 || rawRegion.id.length > 256) {
      throw new Error("Road-planning region ids must be non-empty bounded strings");
    }
    if (ids.has(rawRegion.id)) throw new Error(`Duplicate road-planning region id "${rawRegion.id}"`);
    ids.add(rawRegion.id);
    // A hole can be written down in the contract so that a map with an enclave
    // is recorded truthfully, but this algorithm version plans only simple
    // rings. Refusing is deliberate: silently ignoring an inner ring would let
    // a road cross an area the author excluded, and silently "repairing" the
    // geometry would make the price unexplainable.
    if (Array.isArray(rawRegion.holes) && rawRegion.holes.length > 0) {
      throw new Error(
        `Road-planning region "${rawRegion.id}" declares inner rings, which `
        + `${REGION_ROAD_PLANNING_ALGORITHM} does not support. A wider geometry `
        + "class requires a new planning algorithm version."
      );
    }
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
    // The length check above proves the schema-generated non-empty tuple.
    // Array transforms cannot preserve that fact in TypeScript's inference, so
    // restore the precise schema-derived type only at this validated boundary.
    return { id: rawRegion.id, polygon: polygon as Region["polygon"] };
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
  const prepared = prepareRegions(regions);
  const result: Array<DerivedPortalGeometry> = [];
  let comparisons = 0;
  // Only regions whose bounds touch can share a border, and inside such a pair
  // only sides whose own bounds touch can overlap. Both filters are exact, so
  // the derived graph and its hash are the same as after comparing every pair.
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex];
    const right = prepared[rightIndex];
    const pairParts: Array<DerivedPortalGeometry> = [];
    for (const [leftSide, rightSide] of touchingCrossPairs(left.sides, right.sides)) {
      comparisons += 1;
      if (comparisons > MAX_BOUNDARY_COMPARISONS) {
        throw new Error(
          "Road-planning geometry exceeds the bounded shared-boundary work limit. "
          + "The limit counts side comparisons that survive the spatial prefilter, "
          + "so reaching it means the regions genuinely share that much border."
        );
      }
      const first = left.sides[leftSide];
      const second = right.sides[rightSide];
      const overlap = sharedBoundary(first.from, first.to, second.from, second.to);
      if (overlap) {
        pairParts.push({ regionIds: [left.region.id, right.region.id], ...overlap });
      }
    }
    // A compiler may simplify one side of a shared boundary differently from
    // the other. Touching collinear pieces are merged so that an extra
    // intermediate vertex cannot change graph topology or the advertised hash.
    // Merging is scoped to the one region pair the pieces belong to, which is
    // where it was always confined: pieces of different pairs never merge.
    const unique = new Map(pairParts.map((portal) => [portalGeometryKey(portal), portal]));
    const merged = [...unique.values()];
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let firstIndex = 0; firstIndex < merged.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < merged.length; secondIndex += 1) {
          const first = merged[firstIndex];
          const second = merged[secondIndex];
          if (!segmentsIntersect(first.from, first.to, second.from, second.to) ||
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
    result.push(...merged);
  }
  const unique = new Map(result.map((portal) => [portalGeometryKey(portal), portal]));
  return [...unique.values()]
    .sort((left, right) => codepointCompare(portalGeometryKey(left), portalGeometryKey(right)));
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
  // Hash the planner's canonical semantic objects, not the incidental key
  // insertion order of a manifest after a JSONB or immutable-bundle round trip.
  // Arrays retain their meaningful canonical order; object property order does
  // not become part of the game's geometry identity.
  const source = JSON.stringify({
    algorithmVersion: options.algorithmVersion,
    boundaryPolicy: options.boundaryPolicy,
    regions: canonicalizeRoadPlanningRegions(options.regions),
    portals: canonicalizeDeclaredPortals(options.portals)
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
      planning.tieBreak !== "server-random" || planning.boundaryPolicy !== REGION_ROAD_BOUNDARY_POLICY) {
    throw new Error("Transport network declares an unsupported road-planning contract");
  }
  const regions = canonicalizeRoadPlanningRegions(model.regions);
  const portals = canonicalizeDeclaredPortals(planning.navigationGraph.portals);
  // Planned content is required to be compiler-canonical. Silently normalising
  // at runtime would make the advertised package hash ambiguous.
  if (!isDeepStrictEqual(model.regions, regions) ||
      !isDeepStrictEqual(planning.navigationGraph.portals, portals)) {
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
  forbiddenSharedBoundaries: ReadonlyArray<Pick<Portal, "from" | "to">>,
  workMeter?: RegionRoadPlannerWorkMeter
): Array<Point> => {
  if (pointNearlyEquals(from, to)) return [{ ...from }];
  const nodes = [from, to, ...region.polygon].filter((point, index, all) =>
    all.findIndex((candidate) => pointNearlyEquals(candidate, point)) === index);
  const estimatedWork = nodes.length * Math.max(0, nodes.length - 1) / 2 * region.polygon.length;
  if (estimatedWork > MAX_VISIBILITY_WORK) {
    throw new Error(`Road route through region "${region.id}" exceeds bounded v1 visibility work`);
  }
  // Include the visibility graph and the bounded shortest-path scan. The
  // estimate is charged before either loop, so a transaction budget rejects
  // the route without first performing the expensive work.
  chargePlannerWork(workMeter, estimatedWork + nodes.length * nodes.length);
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
  workMeter?: RegionRoadPlannerWorkMeter;
}): Array<Array<string>> => {
  chargePlannerWork(options.workMeter, options.compiled.regions.length + options.compiled.portals.length);
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
    const neighbours = [...(adjacency.get(current) ?? [])].sort(codepointCompare);
    chargePlannerWork(options.workMeter, neighbours.length);
    for (const next of neighbours) {
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
    chargePlannerWork(options.workMeter, 1);
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
  selectedPortals: Array<Portal>,
  workMeter?: RegionRoadPlannerWorkMeter
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
    const localPath = shortestInsidePath(entry, exit, region, forbiddenSharedBoundaries, workMeter);
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

/**
 * Choose the shortest valid midpoint route; exact ties use codepoint geometry
 * order.
 *
 * This is where algorithm version `region-segment-minimum-v1` fixes its own
 * rule, which ADR-081 deliberately does not: the route crosses a shared border
 * at its middle, and when one pair of regions has several separate shared
 * borders, a bounded number of combinations is tried and the shortest valid
 * polyline between those middles wins. The rule makes the result finite and
 * reproducible. Choosing the crossing point freely along the border would give
 * shorter roads, but it is a different answer, so it may only arrive as a new
 * algorithm version — already stored roads must stay explainable by the version
 * recorded in them.
 */
const buildCandidate = (
  compiled: CompiledRegionRoadPlanning,
  sequence: Array<string>,
  from: Point,
  to: Point,
  workMeter?: RegionRoadPlannerWorkMeter
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
      candidates.push(buildCandidateForPortals(compiled, sequence, from, to, portals, workMeter));
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
  workMeter?: RegionRoadPlannerWorkMeter;
}): { compiled: CompiledRegionRoadPlanning; candidates: Array<RegionRoadCandidate> } => {
  const from = finitePoint(options.from, "Road origin");
  const to = finitePoint(options.to, "Road destination");
  if (pointNearlyEquals(from, to)) throw new Error("Road endpoints must have different positions");
  chargePlannerWork(options.workMeter, estimateCompilationWork(options.model));
  const compiled = compileRegionRoadPlanning(options.model);
  const excluded = new Set(options.excludedRegionIds ?? []);
  for (const regionId of excluded) {
    if (typeof regionId !== "string" || !compiled.regionsById.has(regionId)) {
      throw new Error(`Excluded road-planning region "${String(regionId)}" is not declared`);
    }
  }
  const sequences = enumerateMinimumSequences({ compiled, from, to, excluded, workMeter: options.workMeter });
  const candidates: Array<RegionRoadCandidate> = [];
  for (const sequence of sequences) {
    try {
      candidates.push(buildCandidate(compiled, sequence, from, to, options.workMeter));
    } catch (error) {
      if (!(error instanceof InvalidRegionRoadCandidateError)) throw error;
    }
  }
  if (candidates.length === 0) throw new Error("No geometrically valid minimum-region road exists");
  chargePlannerWork(
    options.workMeter,
    candidates.reduce((sum, candidate) => sum + candidate.points.length + candidate.regionSequence.length, 0)
  );
  return { compiled, candidates };
};
