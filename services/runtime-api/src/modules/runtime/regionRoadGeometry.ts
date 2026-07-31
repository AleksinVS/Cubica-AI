/**
 * Canonical geometry of a road-planning map: regions and the crossings between
 * them.
 *
 * This module owns everything that the published checksum covers, and nothing
 * else. It answers two questions and stops there:
 *
 * 1. is this set of region polygons an admissible map, and what is its
 *    canonical form (ordering, direction, starting vertex);
 * 2. which pairs of regions border each other, and along which line.
 *
 * Path finding lives elsewhere. The separation matters because the checksum in
 * a published package is computed over the answers to these two questions only:
 * a change in how roads are searched must not change the identity of the map,
 * and a change in the map must not be able to hide behind an unchanged search.
 *
 * Terms used here:
 *
 * - **crossing** (in the manifest schema: the navigation graph) — one maximal
 *   connected part of the border shared by two regions. It is a polyline, not a
 *   single straight piece, because a border between two hand-drawn areas is
 *   normally made of many short pieces. Version 1 of the planner treated each
 *   piece as a separate crossing and had to try their combinations; on the first
 *   real author map that meant up to 7·10¹² combinations for one road. See
 *   ADR-100.
 * - **ring** — one closed contour of a region: its outer boundary, or one of its
 *   inner boundaries (a hole).
 * - **spatial prefilter** — a cheap test that removes pairs of shapes which
 *   cannot possibly touch, so that the expensive exact test runs only on the
 *   pairs that might.
 */
import { createHash } from "node:crypto";
import type {
  GameManifestCanonicalPoint,
  GameManifestTransportRegion
} from "@cubica/contracts-manifest";

export const REGION_ROAD_PLANNING_MODE = "region-segment-minimum" as const;
export const REGION_ROAD_PLANNING_ALGORITHM = "region-segment-minimum-v2" as const;
export const REGION_ROAD_BOUNDARY_POLICY = "lowest-region-id" as const;
export const REGION_ROAD_TIE_BREAK = "shortest-then-codepoint" as const;

const EPSILON = 1e-9;

/**
 * The number of regions is deliberately unbounded (ADR-081 § 4.7): cost grows
 * with the number of polygon vertices, not with how those vertices are grouped.
 * The limits below are the ones that do bound the cost, and their values are
 * measured on the first real author map rather than guessed.
 *
 * That map was measured twice, and the second measurement is why the
 * per-ring limit is what it is. As first partitioned it held 917 areas with
 * 79 549 vertices, the widest ring having 511, producing 2 485 crossings from
 * about 1.2·10⁵ side comparisons — which is where a limit of 512 came from.
 * The author then declared some terrain impassable, and cutting that terrain
 * out gave 984 areas with 89 276 vertices: a region keeps its own outline and
 * gains the outline of every patch cut out of it, so the widest ring grew to
 * 1 508. A limit set to the largest thing seen so far is not a limit, it is a
 * coincidence; 2 048 leaves room for the same thing happening again while
 * still stopping a runaway map.
 */
const MAX_VERTICES_PER_RING = 2048;
// Kept in lockstep with `holes.maxItems` in
// docs/architecture/schemas/map-annotation.schema.json, which is the same
// limit expressed as "at most 64 holes" (1 outer ring + 64 holes = 65 rings).
// The schema is the source of truth for the shape; this constant is the
// source of truth for what runtime enforces, and
// `map-annotation.test.mjs` asserts the two numbers agree so they cannot
// silently drift apart.
export const MAX_RINGS_PER_REGION = 65;
const MAX_TOTAL_VERTICES = 200_000;
const MAX_CROSSINGS = 65_536;
const MAX_CROSSING_VERTICES = 400_000;
const MAX_BOUNDARY_COMPARISONS = 20_000_000;
const MAX_COORDINATE_MAGNITUDE = 1_000_000_000;

type Point = GameManifestCanonicalPoint;

/** A region after canonicalisation: an outer ring and zero or more holes. */
export interface CanonicalRegion {
  id: string;
  polygon: GameManifestTransportRegion["polygon"];
  holes?: GameManifestTransportRegion["holes"];
}

/**
 * One maximal connected part of the border shared by two regions.
 *
 * `chain` is the border as a polyline. When the shared border is closed — one
 * region completely surrounds the other — the last point repeats the first, and
 * that repetition is how a closed crossing is recognised.
 */
export interface RegionCrossing {
  id: string;
  regionIds: [string, string];
  chain: Array<Point>;
}

export const codepointCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const pointCompare = (left: Point, right: Point): number =>
  left.x === right.x ? left.y - right.y : left.x - right.x;
export const pointEquals = (left: Point, right: Point): boolean =>
  left.x === right.x && left.y === right.y;
export const pointNearlyEquals = (left: Point, right: Point): boolean =>
  Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
export const pointKey = (point: Point): string => `${point.x},${point.y}`;
export const subtract = (left: Point, right: Point): Point =>
  ({ x: left.x - right.x, y: left.y - right.y });
export const cross = (left: Point, right: Point): number => left.x * right.y - left.y * right.x;
export const distance = (left: Point, right: Point): number =>
  Math.hypot(left.x - right.x, left.y - right.y);
export const interpolate = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t
});

export const finitePoint = (raw: Point, label: string): Point => {
  if (!raw || typeof raw.x !== "number" || !Number.isFinite(raw.x) ||
      typeof raw.y !== "number" || !Number.isFinite(raw.y) ||
      Math.abs(raw.x) > MAX_COORDINATE_MAGNITUDE || Math.abs(raw.y) > MAX_COORDINATE_MAGNITUDE) {
    throw new Error(`${label} must contain finite bounded canonical coordinates`);
  }
  // JSON.stringify normalises -0 anyway, but doing it here makes point
  // comparison and the documented checksum input explicit rather than an
  // accident of the engine.
  return { x: Object.is(raw.x, -0) ? 0 : raw.x, y: Object.is(raw.y, -0) ? 0 : raw.y };
};

const signedDoubleArea = (ring: ReadonlyArray<Point>): number => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return sum + point.x * next.y - point.y * next.x;
}, 0);

/**
 * Is the point on this straight piece of a border?
 *
 * The two tests are the same as before and give the same answer, but the cheap
 * one runs first. Almost every call in a real map is answered "no" by the
 * bounding box alone, and computing the length of the piece before finding that
 * out was more than half of all the work of validating a map.
 */
export const pointOnSegment = (point: Point, from: Point, to: Point): boolean => {
  if (point.x < (from.x < to.x ? from.x : to.x) - EPSILON) return false;
  if (point.x > (from.x > to.x ? from.x : to.x) + EPSILON) return false;
  if (point.y < (from.y < to.y ? from.y : to.y) - EPSILON) return false;
  if (point.y > (from.y > to.y ? from.y : to.y) + EPSILON) return false;
  const segment = subtract(to, from);
  const offset = subtract(point, from);
  const tolerance = EPSILON * Math.max(1, Math.hypot(segment.x, segment.y));
  return Math.abs(cross(offset, segment)) <= tolerance;
};

/** Inclusive membership: a terminal may sit exactly on a border of its region. */
export const pointInOrOnRing = (point: Point, ring: ReadonlyArray<Point>): boolean => {
  for (let index = 0; index < ring.length; index += 1) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length])) return true;
  }
  let inside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

export const pointStrictlyInsideRing = (point: Point, ring: ReadonlyArray<Point>): boolean => {
  for (let index = 0; index < ring.length; index += 1) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length])) return false;
  }
  return pointInOrOnRing(point, ring);
};

/** Every ring of a region: the outer boundary first, then each hole. */
export const regionRings = (region: CanonicalRegion): Array<ReadonlyArray<Point>> =>
  [region.polygon, ...(region.holes ?? [])];

/**
 * A point belongs to a region when it is inside the outer ring and not strictly
 * inside any hole. A point exactly on a hole's edge still belongs: the edge is
 * a border of the region, and a road is allowed to touch its own border.
 */
export const pointInOrOnRegion = (point: Point, region: CanonicalRegion): boolean => {
  if (!pointInOrOnRing(point, region.polygon)) return false;
  return !(region.holes ?? []).some((hole) => pointStrictlyInsideRing(point, hole));
};

export const pointStrictlyInsideRegion = (point: Point, region: CanonicalRegion): boolean => {
  if (!pointStrictlyInsideRing(point, region.polygon)) return false;
  return !(region.holes ?? []).some((hole) => pointInOrOnRing(point, hole));
};

const orientation = (a: Point, b: Point, c: Point): number => cross(subtract(b, a), subtract(c, a));

export const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
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

/* -------------------------------------------------------------------------- */
/* Spatial prefilter                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Validating regions and deriving crossings ask the same question of every pair
 * of regions, and then of every pair of their sides. Asking it of all pairs is
 * quadratic: the first real author map would need about three billion segment
 * comparisons. The prefilter removes exactly the pairs that cannot matter and
 * nothing else — two shapes whose axis-aligned bounds do not touch can neither
 * overlap nor share a border.
 *
 * Exactness is not optional. The derived graph is fixed by a published
 * checksum, so an acceleration that merged "almost touching" borders would
 * produce a different graph and break the package. Bounds are therefore
 * compared with the same epsilon as the geometry itself, and every surviving
 * pair is still tested exactly as before.
 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BoundedSide {
  from: Point;
  to: Point;
  bounds: Bounds;
  /**
   * Which way the inside of the region lies from this side.
   *
   * Every contour is stored counter-clockwise, so the area a contour encloses
   * is always to the left of its sides. For the outer boundary that enclosed
   * area is the region, so the inside is to the left (`+1`). For the boundary
   * of a hole the enclosed area is the hole, which is precisely what does not
   * belong to the region, so the inside is to the right (`-1`). Getting this
   * backwards makes a region that surrounds an enclave look as if it overlapped
   * it.
   */
  inwardSign: 1 | -1;
}

export const boundsOfPoints = (points: ReadonlyArray<Point>): Bounds => {
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

const ringSidesWithBounds = (
  ring: ReadonlyArray<Point>,
  inwardSign: 1 | -1 = 1
): Array<BoundedSide> =>
  ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return { from: point, to: next, bounds: boundsOfPoints([point, next]), inwardSign };
  });

const boundsOverlapInY = (left: Bounds, right: Bounds): boolean =>
  left.minY - EPSILON <= right.maxY && right.minY - EPSILON <= left.maxY;

/** Every unordered pair of items whose bounds touch, each reported once. */
export const touchingSelfPairs = (items: ReadonlyArray<{ bounds: Bounds }>): Array<[number, number]> => {
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
export const touchingCrossPairs = (
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

/** A region prepared once and reused by every pairwise pass. */
interface PreparedRegion {
  region: CanonicalRegion;
  /** Sides of every ring of the region, flattened. */
  sides: Array<BoundedSide>;
  bounds: Bounds;
}

const prepareRegions = (regions: ReadonlyArray<CanonicalRegion>): Array<PreparedRegion> =>
  regions.map((region) => ({
    region,
    sides: [
      ...ringSidesWithBounds(region.polygon, 1),
      ...(region.holes ?? []).flatMap((hole) => ringSidesWithBounds(hole, -1))
    ],
    bounds: boundsOfPoints(region.polygon)
  }));

/* -------------------------------------------------------------------------- */
/* Canonicalisation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A contour must not cross itself.
 *
 * The sides are compared through the same spatial prefilter used between
 * regions, and for the same reason: comparing all pairs is quadratic, and on
 * the first real author map that meant 4.5 million comparisons for shapes whose
 * sides almost never come near each other. Sides that touch only because they
 * share a vertex are neighbours in the contour and are not a self-crossing.
 */
const assertSimpleRing = (ring: ReadonlyArray<Point>, label: string) => {
  const sides = ringSidesWithBounds(ring);
  for (let index = 0; index < ring.length; index += 1) {
    if (pointNearlyEquals(ring[index], ring[(index + 1) % ring.length])) {
      throw new Error(`${label} has a zero-length boundary edge`);
    }
  }
  for (const [first, second] of touchingSelfPairs(sides)) {
    const adjacent = (first + 1) % ring.length === second || (second + 1) % ring.length === first;
    if (adjacent) continue;
    if (segmentsIntersect(sides[first].from, sides[first].to, sides[second].from, sides[second].to)) {
      throw new Error(`${label} is not a simple contour`);
    }
  }
};

/**
 * One ring in canonical form: counter-clockwise, starting at its lowest vertex.
 *
 * Both normalisations exist so that two compilers which describe the same shape
 * differently — starting elsewhere, or walking the other way — produce the same
 * checksum. Without them the identity of a map would depend on how it was
 * written down rather than on what it is.
 */
const canonicalizeRing = (rawRing: ReadonlyArray<Point>, label: string): Array<Point> => {
  let ring = rawRing.map((point, index) => finitePoint(point, `${label} point ${index}`));
  if (ring.length > 1 && pointEquals(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
  if (ring.length < 3 || ring.length > MAX_VERTICES_PER_RING) {
    throw new Error(`${label} supports 3..${MAX_VERTICES_PER_RING} vertices`);
  }
  if (new Set(ring.map(pointKey)).size !== ring.length) {
    throw new Error(`${label} repeats a vertex`);
  }
  // Self-crossing is checked before area, because a contour that crosses itself
  // can have an area of zero — the two halves of a bow tie cancel out — and
  // "this contour has no area" is a true but useless thing to tell an author
  // whose real problem is that the contour crosses itself.
  assertSimpleRing(ring, label);
  const area = signedDoubleArea(ring);
  if (Math.abs(area) <= EPSILON) throw new Error(`${label} has zero area`);
  if (area < 0) ring.reverse();
  let firstIndex = 0;
  for (let index = 1; index < ring.length; index += 1) {
    if (pointCompare(ring[index], ring[firstIndex]) < 0) firstIndex = index;
  }
  return [...ring.slice(firstIndex), ...ring.slice(0, firstIndex)];
};

/**
 * A hole must be a real hole: strictly inside the outer ring, not overlapping
 * another hole, and touching neither in a way that would split the region in
 * two. Refusing is deliberate — a "nearly inside" hole silently repaired would
 * make a road's price unexplainable.
 */
const assertHolesAreInside = (outer: ReadonlyArray<Point>, holes: ReadonlyArray<ReadonlyArray<Point>>, regionId: string) => {
  const outerSides = ringSidesWithBounds(outer);
  const prepared = holes.map((hole) => ({ hole, sides: ringSidesWithBounds(hole), bounds: boundsOfPoints(hole) }));
  for (const [index, entry] of prepared.entries()) {
    for (const [outerSide, holeSide] of touchingCrossPairs(outerSides, entry.sides)) {
      const first = outerSides[outerSide];
      const second = entry.sides[holeSide];
      if (segmentsIntersect(first.from, first.to, second.from, second.to)) {
        throw new Error(`Road-planning region "${regionId}" hole ${index} touches its outer ring`);
      }
    }
    if (!entry.hole.every((point) => pointStrictlyInsideRing(point, outer))) {
      throw new Error(`Road-planning region "${regionId}" hole ${index} is not strictly inside the outer ring`);
    }
  }
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex];
    const right = prepared[rightIndex];
    for (const [leftSide, rightSide] of touchingCrossPairs(left.sides, right.sides)) {
      const first = left.sides[leftSide];
      const second = right.sides[rightSide];
      if (segmentsIntersect(first.from, first.to, second.from, second.to)) {
        throw new Error(`Road-planning region "${regionId}" holes ${leftIndex} and ${rightIndex} touch`);
      }
    }
    if (left.hole.some((point) => pointStrictlyInsideRing(point, right.hole)) ||
        right.hole.some((point) => pointStrictlyInsideRing(point, left.hole))) {
      throw new Error(`Road-planning region "${regionId}" holes ${leftIndex} and ${rightIndex} overlap`);
    }
  }
};

/**
 * Small inward samples along one side, used to expose an area overlap that has
 * no proper edge crossing.
 *
 * Such an overlap is real and must be caught: one region can lie along the
 * border of another, sharing part of it, with every one of its own vertices
 * sitting exactly on that border rather than strictly inside it. No pair of
 * sides properly crosses, and no vertex is strictly inside, yet the two claim
 * the same area. A point stepped a hair inward from the side does land strictly
 * inside, which is what makes the overlap visible.
 */
const sideInteriorProbes = (side: BoundedSide): Array<Point> => {
  const edge = subtract(side.to, side.from);
  const length = Math.hypot(edge.x, edge.y);
  const inward = {
    x: -edge.y / length * side.inwardSign,
    y: edge.x / length * side.inwardSign
  };
  const offset = Math.max(1, length) * 1e-7;
  return [0.25, 0.5, 0.75].map((t) => {
    const boundary = interpolate(side.from, side.to, t);
    return { x: boundary.x + inward.x * offset, y: boundary.y + inward.y * offset };
  });
};

const boundsContain = (bounds: Bounds, point: Point): boolean =>
  point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON &&
  point.y >= bounds.minY - EPSILON && point.y <= bounds.maxY + EPSILON;

/**
 * Region interiors must be disjoint: shared borders and single-point touches
 * are allowed, shared area is not. This prevents a hand-written manifest from
 * declaring ambiguous overlapping paid areas even if it bypasses the authoring
 * converter.
 */
const assertDisjointRegionInteriors = (regions: ReadonlyArray<CanonicalRegion>) => {
  const prepared = prepareRegions(regions);
  let comparisons = 0;
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex];
    const right = prepared[rightIndex];
    const overlap = () => new Error(
      `Road-planning regions "${left.region.id}" and "${right.region.id}" have overlapping interiors`
    );
    // Sides that come near the other region at all. Only these can carry a
    // probe that lands inside it, so only these are probed. Probing every side
    // of both regions instead — as this did before — cost fifty seconds on the
    // first real author map, because it asked an O(vertices) question of three
    // points per side of every touching pair.
    const nearLeft = new Set<number>();
    const nearRight = new Set<number>();
    for (const [leftSide, rightSide] of touchingCrossPairs(left.sides, right.sides)) {
      comparisons += 1;
      if (comparisons > MAX_BOUNDARY_COMPARISONS) {
        throw new Error(
          "Road-planning geometry exceeds the bounded cross-region work limit. "
          + "The limit counts side comparisons that survive the spatial prefilter, "
          + "so reaching it means the regions genuinely touch that much."
        );
      }
      nearLeft.add(leftSide);
      nearRight.add(rightSide);
      const first = left.sides[leftSide];
      const second = right.sides[rightSide];
      if (segmentsProperlyCross(first.from, first.to, second.from, second.to)) throw overlap();
    }
    // A vertex outside the other region's bounds cannot be inside it, and the
    // bounds test is a handful of comparisons against an O(vertices) one.
    const vertexInside = (source: PreparedRegion, target: PreparedRegion): boolean =>
      regionRings(source.region).some((ring) => ring.some((point) =>
        boundsContain(target.bounds, point) && pointStrictlyInsideRegion(point, target.region)));
    if (vertexInside(left, right) || vertexInside(right, left)) throw overlap();
    const probeInside = (source: PreparedRegion, near: Set<number>, target: PreparedRegion): boolean =>
      [...near].some((index) => sideInteriorProbes(source.sides[index]).some((point) =>
        boundsContain(target.bounds, point) && pointStrictlyInsideRegion(point, target.region)));
    if (probeInside(left, nearLeft, right) || probeInside(right, nearRight, left)) throw overlap();
  }
};

/** Apply the compiler's checksum-normalisation rules to every region. */
export const canonicalizeRoadPlanningRegions = (
  rawRegions: ReadonlyArray<GameManifestTransportRegion>
): Array<CanonicalRegion> => {
  if (rawRegions.length < 1) throw new Error("Road planning requires at least one region");
  const ids = new Set<string>();
  let totalVertices = 0;
  const regions = rawRegions.map((rawRegion) => {
    if (typeof rawRegion.id !== "string" || rawRegion.id.length < 1 || rawRegion.id.length > 256) {
      throw new Error("Road-planning region ids must be non-empty bounded strings");
    }
    if (ids.has(rawRegion.id)) throw new Error(`Duplicate road-planning region id "${rawRegion.id}"`);
    ids.add(rawRegion.id);
    const label = `Road-planning region "${rawRegion.id}"`;
    const rawHoles = rawRegion.holes ?? [];
    if (rawHoles.length + 1 > MAX_RINGS_PER_REGION) {
      throw new Error(`${label} supports at most ${MAX_RINGS_PER_REGION - 1} inner rings`);
    }
    const polygon = canonicalizeRing(rawRegion.polygon, label);
    const holes = rawHoles.map((hole, index) => canonicalizeRing(hole, `${label} hole ${index}`));
    totalVertices += polygon.length + holes.reduce((sum, hole) => sum + hole.length, 0);
    if (totalVertices > MAX_TOTAL_VERTICES) {
      throw new Error(`Road planning supports at most ${MAX_TOTAL_VERTICES} contour vertices`);
    }
    if (holes.length > 0) assertHolesAreInside(polygon, holes, rawRegion.id);
    // Holes are ordered by their canonical first vertex so that the checksum
    // does not depend on the order in which the author listed them.
    holes.sort((left, right) => pointCompare(left[0], right[0]));
    // The length checks above prove the schema's non-empty tuple; TypeScript
    // cannot carry that fact through array transforms, so the precise
    // schema-derived type is restored only at this validated boundary.
    const region: CanonicalRegion = {
      id: rawRegion.id,
      polygon: polygon as CanonicalRegion["polygon"]
    };
    if (holes.length > 0) region.holes = holes as unknown as CanonicalRegion["holes"];
    return region;
  });
  const sorted = regions.sort((left, right) => codepointCompare(left.id, right.id));
  assertDisjointRegionInteriors(sorted);
  return sorted;
};

/* -------------------------------------------------------------------------- */
/* Crossing derivation                                                         */
/* -------------------------------------------------------------------------- */

/** The positive-length shared part of two collinear ring sides, if any. */
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

interface SharedPiece {
  from: Point;
  to: Point;
}

/**
 * Join shared pieces into maximal connected polylines.
 *
 * The pieces come out of the pairwise comparison in no particular order, and
 * each is one straight bit of a border that is normally bent. Two pieces belong
 * to the same crossing exactly when they meet at a point. The result is one
 * polyline per connected group.
 *
 * The border between two areas of a planar map is a curve, so every point of it
 * belongs to at most two pieces. That is what makes this a simple walk rather
 * than a general graph problem, and a point shared by three pieces means the
 * map is not what it claims to be — it is refused rather than guessed at.
 */
const assembleChains = (pieces: ReadonlyArray<SharedPiece>, label: string): Array<Array<Point>> => {
  const byEndpoint = new Map<string, Array<number>>();
  const pointByKey = new Map<string, Point>();
  pieces.forEach((piece, index) => {
    for (const endpoint of [piece.from, piece.to]) {
      const key = pointKey(endpoint);
      pointByKey.set(key, endpoint);
      byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), index]);
    }
  });
  for (const [key, incident] of byEndpoint) {
    if (incident.length > 2) {
      throw new Error(`${label} meets itself at point ${key}: a shared border cannot branch`);
    }
  }

  const used = new Array<boolean>(pieces.length).fill(false);
  const chains: Array<Array<Point>> = [];

  /** Walk away from `startKey` through unused pieces, collecting points. */
  const walk = (startKey: string): Array<Point> => {
    const points = [pointByKey.get(startKey) as Point];
    let currentKey = startKey;
    for (;;) {
      const next = (byEndpoint.get(currentKey) ?? []).find((index) => !used[index]);
      if (next === undefined) return points;
      used[next] = true;
      const piece = pieces[next];
      const otherKey = pointKey(piece.from) === currentKey ? pointKey(piece.to) : pointKey(piece.from);
      points.push(pointByKey.get(otherKey) as Point);
      currentKey = otherKey;
    }
  };

  // Open chains first: they are the ones with an endpoint used by a single
  // piece, and starting there means the walk cannot stop in the middle.
  const openStarts = [...byEndpoint.entries()]
    .filter(([, incident]) => incident.length === 1)
    .map(([key]) => key)
    .sort(codepointCompare);
  for (const startKey of openStarts) {
    if ((byEndpoint.get(startKey) ?? []).every((index) => used[index])) continue;
    chains.push(walk(startKey));
  }
  // Whatever is left forms closed loops: one region completely surrounding
  // another. A loop is emitted starting from its lowest vertex so that the
  // checksum does not depend on where the walk happened to begin.
  for (let index = 0; index < pieces.length; index += 1) {
    if (used[index]) continue;
    const loop = walk(pointKey(pieces[index].from));
    if (loop.length < 2 || !pointNearlyEquals(loop[0], loop[loop.length - 1])) {
      throw new Error(`${label} has a shared border that neither ends nor closes`);
    }
    const body = loop.slice(0, -1);
    let lowest = 0;
    for (let position = 1; position < body.length; position += 1) {
      if (pointCompare(body[position], body[lowest]) < 0) lowest = position;
    }
    const rotated = [...body.slice(lowest), ...body.slice(0, lowest)];
    // Direction is fixed by the smaller of the two neighbours of the lowest
    // vertex, so that walking the loop the other way gives the same array.
    const forward = rotated[1];
    const backward = rotated[rotated.length - 1];
    const ordered = pointCompare(forward, backward) <= 0 ? rotated : [rotated[0], ...rotated.slice(1).reverse()];
    chains.push([...ordered, { ...ordered[0] }]);
  }

  // An open chain is emitted from its lower end, for the same reason.
  return chains.map((chain) => {
    const closed = pointNearlyEquals(chain[0], chain[chain.length - 1]);
    if (closed) return chain;
    return pointCompare(chain[0], chain[chain.length - 1]) <= 0 ? chain : [...chain].reverse();
  });
};

/**
 * Derive every crossing of the map from the region polygons.
 *
 * This is the function whose output the published checksum covers, so its
 * result must depend only on the shapes — never on their order in the file, on
 * object key order, or on floating-point accidents of the search.
 */
export const deriveRegionCrossings = (
  regions: ReadonlyArray<CanonicalRegion>
): Array<RegionCrossing> => {
  const prepared = prepareRegions(regions);
  const crossings: Array<RegionCrossing> = [];
  let comparisons = 0;
  let crossingVertices = 0;
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex];
    const right = prepared[rightIndex];
    const pieces: Array<SharedPiece> = [];
    const seen = new Set<string>();
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
      if (!overlap) continue;
      const key = `${pointKey(overlap.from)}|${pointKey(overlap.to)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push(overlap);
    }
    if (pieces.length === 0) continue;
    const pairIds: [string, string] = [left.region.id, right.region.id];
    const label = `Shared border of road-planning regions "${pairIds[0]}" and "${pairIds[1]}"`;
    const chains = assembleChains(pieces, label)
      .sort((first, second) => codepointCompare(JSON.stringify(first), JSON.stringify(second)));
    chains.forEach((chain, index) => {
      crossingVertices += chain.length;
      crossings.push({
        id: `crossing:${pairIds[0]}:${pairIds[1]}:${index + 1}`,
        regionIds: pairIds,
        chain
      });
    });
    if (crossings.length > MAX_CROSSINGS) {
      throw new Error(`Road planning supports at most ${MAX_CROSSINGS} crossings`);
    }
    if (crossingVertices > MAX_CROSSING_VERTICES) {
      throw new Error(`Road planning supports at most ${MAX_CROSSING_VERTICES} crossing vertices`);
    }
  }
  return crossings.sort((first, second) => codepointCompare(first.id, second.id));
};

/**
 * The identity of a map, as a checksum.
 *
 * The input is deliberately narrower than the package: it covers the shapes,
 * the crossings derived from them, and the two rules under which they were
 * derived. It does not cover names, prices or state paths, because a map is the
 * same map when those change.
 *
 * The crossings are included even though they are derived from the regions. The
 * point is not to detect a changed region — that would show in the regions
 * themselves — but to detect that the deriving rules have changed since the
 * package was published, which is exactly the case a runtime cannot notice by
 * looking at its own output.
 */
export const computeRegionRoadPlanningHash = (options: {
  algorithmVersion: typeof REGION_ROAD_PLANNING_ALGORITHM;
  boundaryPolicy: typeof REGION_ROAD_BOUNDARY_POLICY;
  regions: ReadonlyArray<CanonicalRegion>;
  crossings: ReadonlyArray<RegionCrossing>;
}): string => {
  // Hash the canonical semantic objects, not the incidental key insertion order
  // of a manifest after a database or bundle round trip.
  const source = JSON.stringify({
    algorithmVersion: options.algorithmVersion,
    boundaryPolicy: options.boundaryPolicy,
    regions: options.regions.map((region) => region.holes && region.holes.length > 0
      ? { id: region.id, polygon: region.polygon, holes: region.holes }
      : { id: region.id, polygon: region.polygon }),
    crossings: options.crossings.map((crossing) => ({
      id: crossing.id,
      regionIds: crossing.regionIds,
      chain: crossing.chain
    }))
  });
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
};
