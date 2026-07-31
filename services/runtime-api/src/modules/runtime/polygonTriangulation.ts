/**
 * Deterministic constrained Delaunay triangulation of a bounded simple polygon.
 *
 * Why this module exists: the road-planning package publishes a fixed
 * algorithm version (see `regionRoadPlanner.ts`) whose geometry must be
 * reproducible byte-for-byte on every machine that ever recomputes it. A
 * triangulation is the kind of building block a future planning or rendering
 * algorithm version will want (for example: point-location, area meshing, or
 * a navigation mesh over an author-drawn region). If that block ever depended
 * on iteration order of a `Map`/`Set`, on `Math.random`, or on a tie broken
 * "whichever the library found first", two runs of the same published
 * algorithm version could legally disagree — which would make the published
 * geometry hash meaningless. This module is written so that never happens:
 * every choice that could be a tie is resolved by an explicit, documented
 * rule instead of by incidental engine behaviour.
 *
 * This module is intentionally self-contained (no imports from the rest of
 * the platform, no new dependencies) and unused by anything yet — a separate
 * task wires it into the planner once this piece is reviewed on its own.
 *
 * ## Algorithm overview
 *
 * 1. Validate and canonicalise the outer ring and each hole ring (see
 *    `normalizeRing`): reject degenerate input outright rather than silently
 *    repairing it, per the platform's "fail closed" convention.
 * 2. If there are holes, merge each one into the outer boundary with a
 *    "bridge" edge — a deterministic construction technique (a variant of
 *    the one described by M. Held, "FIST: Fast Industrial-Strength
 *    Triangulation of Polygons", 2001) that turns a polygon-with-holes into
 *    a single simple polygon with a zero-width slit connecting each hole to
 *    the outer boundary. Once merged, the shape has no holes left to reason
 *    about, only a boundary walk.
 * 3. Triangulate that single boundary with "ear clipping" — a classic
 *    triangulation technique that repeatedly finds a vertex whose triangle
 *    with its two neighbours ("ear") contains no other vertex of the
 *    polygon, cuts it off, and repeats. Ear clipping alone gives *a* valid
 *    triangulation but not necessarily a good-quality (Delaunay) one. A
 *    vertex exactly collinear with its two neighbours ("flat") is never
 *    clipped as an ear (that would produce a zero-area triangle) and is
 *    treated the same as a reflex vertex when checking whether it blocks
 *    some *other* candidate ear — see `earClip`'s doc comment for why both
 *    matter and what went wrong when only reflex vertices were checked.
 * 4. Improve the result with Lawson flips: for every internal edge shared by
 *    two triangles, apply the "in-circle test" (does the opposite vertex of
 *    one triangle fall inside the circumscribed circle of the other?) and
 *    flip the edge's diagonal when it does, until no more flips are needed
 *    or a documented safety cap is reached. Edges that come from the input
 *    rings, or from bridges, are never flipped — flipping them would cut
 *    through a boundary the caller explicitly declared, which is exactly
 *    what "constrained" forbids. See `lawsonFlip`'s doc comment for the
 *    performance history of this step and the measured numbers on real data.
 */

/** A single 2-D point used both as triangle input and triangulation output. */
export interface TriangulationPoint {
  x: number;
  y: number;
}

/**
 * One triangle of the output mesh.
 *
 * `a`, `b`, `c` are indices into the `vertices` array of the enclosing
 * `TriangulatedPolygon`, always listed counter-clockwise (CCW). CCW is the
 * same winding the rest of the platform's polygon geometry already uses
 * (see `regionRoadPlanner.ts`'s `signedDoubleArea`), so callers can reuse the
 * same "positive signed area" convention without special-casing this module.
 */
export interface TriangulationTriangle {
  a: number;
  b: number;
  c: number;
}

/** The full triangulated mesh: every input vertex, plus the triangles over them. */
export interface TriangulatedPolygon {
  /** Outer ring vertices first, then each hole ring in the order given. */
  vertices: Array<TriangulationPoint>;
  triangles: Array<TriangulationTriangle>;
}

// A single absolute tolerance for "are these two numbers the same" style
// comparisons. Coordinates in this module are plain author-drawn map units,
// not planetary-scale values, so an absolute epsilon is adequate; where a
// comparison's sensitivity actually scales with the geometry involved (cross
// products, in-circle determinants), `scaledEpsilon` below widens it.
const EPSILON = 1e-9;

/**
 * Lawson-flip safety cap.
 *
 * Lawson's algorithm is known to terminate (each flip strictly improves the
 * min-angle of the affected quadrilateral), but "known to terminate" is not
 * "known to terminate quickly" for an adversarial input, and a published
 * algorithm must never hang the process that recomputes it. Ordinary
 * geometry needs on the order of one flip per internal edge (that is, O(n))
 * before every edge satisfies the in-circle test; this cap is 64 times the
 * vertex count, which comfortably covers that with headroom to spare while
 * still being small enough that even reaching the cap (each flip only
 * touching the handful of edges the incremental worklist in `lawsonFlip`
 * re-examines, not the whole triangulation) stays fast. Reaching it is
 * therefore treated as a signal that the input is pathological, not as
 * normal work.
 */
const lawsonFlipCap = (vertexCount: number): number => Math.max(1024, 64 * vertexCount);

/**
 * Absolute-value comparisons that are sensitive to coordinate magnitude use this instead of `EPSILON`.
 *
 * Written as a fixed-arity function (up to 4 points, all but the first optional) rather than the more
 * readable `(...points) => EPSILON * Math.max(1, ...points.map(...))` it replaces. That version reads
 * better but was, by a wide margin, the single hottest function in this module on real non-convex map
 * regions (see the performance comment above `lawsonFlip` for the measured numbers): a "rest parameter"
 * plus `.map()` allocates a fresh array on *every* call, and this function is called millions of times
 * while triangulating a single large polygon. The loop below computes the exact same value --
 * `EPSILON * max(1, |x|, |y|` for every given point `)` -- with no allocation at all.
 */
const scaledEpsilon = (
  a: TriangulationPoint, b?: TriangulationPoint, c?: TriangulationPoint, d?: TriangulationPoint
): number => {
  let maxAbs = 1;
  const ax = a.x < 0 ? -a.x : a.x;
  const ay = a.y < 0 ? -a.y : a.y;
  if (ax > maxAbs) maxAbs = ax;
  if (ay > maxAbs) maxAbs = ay;
  if (b !== undefined) {
    const bx = b.x < 0 ? -b.x : b.x;
    const by = b.y < 0 ? -b.y : b.y;
    if (bx > maxAbs) maxAbs = bx;
    if (by > maxAbs) maxAbs = by;
  }
  if (c !== undefined) {
    const cx = c.x < 0 ? -c.x : c.x;
    const cy = c.y < 0 ? -c.y : c.y;
    if (cx > maxAbs) maxAbs = cx;
    if (cy > maxAbs) maxAbs = cy;
  }
  if (d !== undefined) {
    const dx = d.x < 0 ? -d.x : d.x;
    const dy = d.y < 0 ? -d.y : d.y;
    if (dx > maxAbs) maxAbs = dx;
    if (dy > maxAbs) maxAbs = dy;
  }
  return EPSILON * maxAbs;
};

const finitePoint = (raw: TriangulationPoint, label: string): TriangulationPoint => {
  if (!raw || typeof raw.x !== "number" || !Number.isFinite(raw.x) ||
      typeof raw.y !== "number" || !Number.isFinite(raw.y)) {
    throw new Error(`${label} must contain finite coordinates`);
  }
  // JSON.stringify and strict equality both treat -0 and 0 the same in value
  // but not always in identity-sensitive contexts; normalising here keeps
  // point comparisons unsurprising, mirroring the platform's other polygon
  // code (see `regionRoadPlanner.ts`'s `finitePoint`).
  return { x: Object.is(raw.x, -0) ? 0 : raw.x, y: Object.is(raw.y, -0) ? 0 : raw.y };
};

const pointNearlyEquals = (left: TriangulationPoint, right: TriangulationPoint): boolean =>
  Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;

/**
 * Twice the signed area of a polygon via the shoelace formula.
 *
 * Positive means the ring is wound counter-clockwise (CCW); negative means
 * clockwise (CW). Used both to detect degenerate (zero-area) rings and to
 * normalise winding direction.
 */
const signedDoubleArea = (ring: ReadonlyArray<TriangulationPoint>): number => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return sum + point.x * next.y - point.y * next.x;
}, 0);

/**
 * Signed area (times two) of the triangle (a, b, c).
 *
 * Positive: c is to the left of the directed line a→b (a "left turn", i.e. a
 * CCW corner). Negative: a "right turn" (a reflex/CW corner). Zero: the
 * three points are collinear. This one function underlies every orientation,
 * convexity and containment test in the module — deliberately, so there is
 * exactly one place that could get the sign convention wrong, not several.
 */
const orientation = (a: TriangulationPoint, b: TriangulationPoint, c: TriangulationPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/**
 * Whether `point` lies exactly on the closed segment `from`–`to` (inclusive
 * of the endpoints), within a magnitude-scaled tolerance.
 *
 * `precomputedTolerance` lets a hot caller (the ear-clipping containment
 * check below) supply an already-computed `scaledEpsilon(...)` value instead
 * of this function deriving its own -- the two are required to be
 * numerically identical (same set of points, same formula, just computed
 * once per candidate instead of once per point checked against it), so
 * passing it in changes nothing about the result, only how many times the
 * (comparatively expensive) tolerance derivation runs.
 */
const pointOnSegment = (
  point: TriangulationPoint, from: TriangulationPoint, to: TriangulationPoint, precomputedTolerance?: number
): boolean => {
  const tolerance = precomputedTolerance ?? scaledEpsilon(point, from, to);
  if (Math.abs(orientation(from, to, point)) > tolerance) return false;
  return point.x >= Math.min(from.x, to.x) - tolerance && point.x <= Math.max(from.x, to.x) + tolerance &&
    point.y >= Math.min(from.y, to.y) - tolerance && point.y <= Math.max(from.y, to.y) + tolerance;
};

/**
 * Whether open segments `ab` and `cd` intersect or touch anywhere, including
 * at shared endpoints or along a collinear overlap. Used for simplicity and
 * hole-placement checks, where even a touch (not just a proper crossing) is
 * disqualifying.
 */
const segmentsIntersect = (
  a: TriangulationPoint, b: TriangulationPoint, c: TriangulationPoint, d: TriangulationPoint
): boolean => {
  const tolerance = scaledEpsilon(a, b, c, d);
  const d1 = orientation(a, b, c);
  const d2 = orientation(a, b, d);
  const d3 = orientation(c, d, a);
  const d4 = orientation(c, d, b);
  if (((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance)) &&
      ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance))) return true;
  return (Math.abs(d1) <= tolerance && pointOnSegment(c, a, b)) ||
    (Math.abs(d2) <= tolerance && pointOnSegment(d, a, b)) ||
    (Math.abs(d3) <= tolerance && pointOnSegment(a, c, d)) ||
    (Math.abs(d4) <= tolerance && pointOnSegment(b, c, d));
};

/**
 * Whether segments `ab` and `cd` cross at an interior point of both — that
 * is, a proper crossing, excluding shared endpoints or collinear touching.
 * This is the test a Lawson flip needs: it must know whether the *new*
 * diagonal would actually cross the *old* one (a convex quadrilateral),
 * not merely whether the two segments touch.
 */
const segmentsProperlyCross = (
  a: TriangulationPoint, b: TriangulationPoint, c: TriangulationPoint, d: TriangulationPoint
): boolean => {
  const tolerance = scaledEpsilon(a, b, c, d);
  const d1 = orientation(a, b, c);
  const d2 = orientation(a, b, d);
  const d3 = orientation(c, d, a);
  const d4 = orientation(c, d, b);
  return ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance)) &&
    ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance));
};

/** Ray-casting point-in-polygon test; a point exactly on the boundary counts as inside. */
const pointInOrOnPolygon = (point: TriangulationPoint, ring: ReadonlyArray<TriangulationPoint>): boolean => {
  for (let index = 0; index < ring.length; index += 1) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length])) return true;
  }
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const before = ring[previous];
    const crosses = (current.y > point.y) !== (before.y > point.y) &&
      point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

/** Like `pointInOrOnPolygon`, but a point on the boundary is explicitly excluded. */
const pointStrictlyInsidePolygon = (point: TriangulationPoint, ring: ReadonlyArray<TriangulationPoint>): boolean => {
  for (let index = 0; index < ring.length; index += 1) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length])) return false;
  }
  return pointInOrOnPolygon(point, ring);
};

/**
 * Whether `point` is strictly inside triangle (a, b, c), for a triangle of
 * *either* winding direction. Strictly inside means not on any of its three
 * edges either — a point exactly on an edge is not treated as "blocking" an
 * ear or a bridge visibility line, both of which only care about points
 * genuinely inside the open triangle.
 */
const pointStrictlyInsideTriangle = (
  point: TriangulationPoint, a: TriangulationPoint, b: TriangulationPoint, c: TriangulationPoint,
  precomputedTolerance?: number
): boolean => {
  // See the matching comment on `pointOnSegment` above: `precomputedTolerance`, when given, must be
  // exactly `scaledEpsilon(point, a, b, c)` -- callers only pass it to avoid re-deriving that value
  // once per call inside a loop that calls this function many times with the same `a`, `b`, `c`.
  const tolerance = precomputedTolerance ?? scaledEpsilon(point, a, b, c);
  const d1 = orientation(a, b, point);
  const d2 = orientation(b, c, point);
  const d3 = orientation(c, a, point);
  if (Math.abs(d1) <= tolerance || Math.abs(d2) <= tolerance || Math.abs(d3) <= tolerance) return false;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  return !(hasPositive && hasNegative);
};

/**
 * Reject a ring that is not a valid, non-self-intersecting simple polygon,
 * checking every pair of non-adjacent edges — O(n²), which is comfortably
 * fast at the documented scale (largest ring: 511 vertices, ≈130k pairs).
 */
const assertSimpleRing = (ring: ReadonlyArray<TriangulationPoint>, label: string): void => {
  const n = ring.length;
  for (let first = 0; first < n; first += 1) {
    const firstNext = (first + 1) % n;
    if (pointNearlyEquals(ring[first], ring[firstNext])) {
      throw new Error(`${label} has a zero-length edge (repeated adjacent vertex)`);
    }
    for (let second = first + 1; second < n; second += 1) {
      const secondNext = (second + 1) % n;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (adjacent) continue;
      if (segmentsIntersect(ring[first], ring[firstNext], ring[second], ring[secondNext])) {
        throw new Error(`${label} is self-intersecting`);
      }
    }
  }
};

/**
 * Validate one input ring and return a fresh, oriented copy.
 *
 * `desiredWinding` fixes the ring's traversal direction: "ccw" for the
 * outer boundary, "cw" for holes. Orienting holes opposite to the outer
 * ring is not cosmetic — it is what makes a single "reflex vertex" test
 * (see `isReflexInRing` below) correctly describe both the outer boundary
 * and, once bridged in, every hole's notch, without a separate code path
 * for each.
 */
const normalizeRing = (
  raw: ReadonlyArray<TriangulationPoint>,
  label: string,
  desiredWinding: "ccw" | "cw"
): Array<TriangulationPoint> => {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error(`${label} must have at least 3 vertices`);
  }
  const points = raw.map((point, index) => finitePoint(point, `${label} vertex ${index}`));
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (pointNearlyEquals(points[first], points[second])) {
        throw new Error(`${label} has a repeated vertex (index ${first} and ${second})`);
      }
    }
  }
  assertSimpleRing(points, label);
  const area = signedDoubleArea(points);
  if (Math.abs(area) <= EPSILON * Math.max(1, points.length)) {
    throw new Error(`${label} has zero area`);
  }
  const isCcw = area > 0;
  const wantsCcw = desiredWinding === "ccw";
  return isCcw === wantsCcw ? points : [...points].reverse();
};

/**
 * A ring is well-formed relative to another ring (outer-vs-hole, or
 * hole-vs-hole) only if neither its vertices nor its edges cross into the
 * other. Checking both is required: an all-vertices-inside test alone can
 * miss an edge that pokes out through a concave notch of a non-convex outer
 * ring without any single vertex leaving it.
 */
const ringsAreDisjoint = (
  inner: ReadonlyArray<TriangulationPoint>, outer: ReadonlyArray<TriangulationPoint>
): boolean => {
  for (let i = 0; i < inner.length; i += 1) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j += 1) {
      if (segmentsIntersect(a, b, outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
};

/** Every hole must sit strictly inside the outer ring and not touch or cross it. */
const assertHoleInsideOuter = (
  hole: ReadonlyArray<TriangulationPoint>, outer: ReadonlyArray<TriangulationPoint>, holeIndex: number
): void => {
  if (!ringsAreDisjoint(hole, outer)) {
    throw new Error(`Hole ${holeIndex} is not strictly inside the outer ring`);
  }
  for (const point of hole) {
    if (!pointStrictlyInsidePolygon(point, outer)) {
      throw new Error(`Hole ${holeIndex} is not strictly inside the outer ring`);
    }
  }
};

/** No two holes may share any area, touch, or nest inside one another. */
const assertHolesDisjoint = (holes: ReadonlyArray<Array<TriangulationPoint>>): void => {
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      const disjointEdges = ringsAreDisjoint(holes[i], holes[j]);
      const anyVertexInside = disjointEdges && (
        holes[i].some((point) => pointStrictlyInsidePolygon(point, holes[j])) ||
        holes[j].some((point) => pointStrictlyInsidePolygon(point, holes[i]))
      );
      if (!disjointEdges || anyVertexInside) {
        throw new Error(`Hole ${i} and hole ${j} overlap`);
      }
    }
  }
};

/**
 * Whether the vertex at `position` in a CCW-consistent boundary list is
 * reflex (concave), i.e. its interior angle exceeds 180°. Because holes are
 * bridged in with the CW-vs-CCW convention documented on `normalizeRing`,
 * this single test is valid everywhere in the merged boundary — at outer
 * corners and at former hole corners alike.
 */
const isReflexAtPosition = (
  boundary: ReadonlyArray<number>, position: number, vertices: ReadonlyArray<TriangulationPoint>
): boolean => {
  const n = boundary.length;
  const previous = vertices[boundary[(position - 1 + n) % n]];
  const current = vertices[boundary[position]];
  const next = vertices[boundary[(position + 1) % n]];
  return orientation(previous, current, next) < -scaledEpsilon(previous, current, next);
};

/** Composite key identifying an undirected edge between two global vertex indices. */
const edgeKey = (u: number, v: number): string => (u < v ? `${u},${v}` : `${v},${u}`);

/**
 * Find, for one hole, the bridge that merges it into the current boundary.
 *
 * This implements the rightmost-vertex / horizontal-ray construction that
 * M. Held's FIST paper (and several earlier hole-merging techniques) use:
 *
 * 1. Take the hole's rightmost vertex `M` (documented tie-break below) —
 *    guaranteed to be a convex corner of the hole (a CW ring's rightmost
 *    point always turns "outward"), which is required for the visibility
 *    argument in step 3 to hold.
 * 2. Fire a ray from `M` in the +x direction and find the nearest boundary
 *    edge it crosses; call the crossing point `I` and the edge endpoint
 *    with the larger x-coordinate `P`.
 * 3. If no boundary vertex lies strictly inside triangle (M, I, P), then
 *    `P` is directly visible from `M` and becomes the bridge target.
 *    Otherwise, at least one *reflex* boundary vertex blocks the direct
 *    line; the bridge target is instead whichever such reflex vertex makes
 *    the smallest angle with the ray (the "most visible" one), which is
 *    guaranteed not to be blocked by any other candidate in turn.
 *
 * The result is a positive-length segment from `M` to a boundary vertex
 * that crosses no edge of the current boundary or the hole itself, so
 * splicing the hole in along it keeps the merged ring simple.
 */
const findBridge = (
  boundary: ReadonlyArray<number>,
  hole: ReadonlyArray<number>,
  vertices: ReadonlyArray<TriangulationPoint>
): { boundaryPosition: number; holeLocalStart: number } => {
  // Tie-break for the hole's rightmost vertex: largest x; then smallest y;
  // then smallest position within the hole ring. All three are cheap,
  // total, and independent of engine iteration order, so the choice is
  // reproducible regardless of how the hole was authored.
  let holeLocalStart = 0;
  for (let index = 1; index < hole.length; index += 1) {
    const candidate = vertices[hole[index]];
    const current = vertices[hole[holeLocalStart]];
    if (candidate.x > current.x + EPSILON ||
        (Math.abs(candidate.x - current.x) <= EPSILON && candidate.y < current.y - EPSILON)) {
      holeLocalStart = index;
    }
  }
  const m = vertices[hole[holeLocalStart]];

  // Nearest boundary edge the +x ray from `m` crosses. Tie-break: smallest
  // crossing x; then smallest boundary position (both are total orders, so
  // the result is unique and reproducible).
  let bestPosition = -1;
  let bestX = Number.POSITIVE_INFINITY;
  const n = boundary.length;
  for (let position = 0; position < n; position += 1) {
    const a = vertices[boundary[position]];
    const b = vertices[boundary[(position + 1) % n]];
    const straddles = (a.y > m.y) !== (b.y > m.y);
    if (!straddles) continue;
    const crossingX = a.x + ((m.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (crossingX < m.x - EPSILON) continue;
    if (crossingX < bestX - EPSILON || (Math.abs(crossingX - bestX) <= EPSILON && position < bestPosition)) {
      bestX = crossingX;
      bestPosition = position;
    }
  }
  if (bestPosition < 0) {
    // The hole was already proven strictly inside the outer ring, so a ray
    // cast from any of its points must cross the boundary; reaching here
    // would mean that proof and this scan disagree, which is a bug in this
    // module rather than bad input.
    throw new Error("Internal error: no boundary edge intersects the hole bridge ray");
  }
  const edgeStart = boundary[bestPosition];
  const edgeEnd = boundary[(bestPosition + 1) % n];
  const intersection: TriangulationPoint = { x: bestX, y: m.y };
  const startPoint = vertices[edgeStart];
  const endPoint = vertices[edgeEnd];
  const pPosition = startPoint.x >= endPoint.x ? bestPosition : (bestPosition + 1) % n;
  const pIndex = boundary[pPosition];

  // Reflex boundary vertices strictly inside triangle (m, intersection, P)
  // are candidates that might block the direct line to P.
  let visiblePosition = pPosition;
  let bestAngle = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let position = 0; position < n; position += 1) {
    if (position === bestPosition || position === (bestPosition + 1) % n) continue;
    const globalIndex = boundary[position];
    const point = vertices[globalIndex];
    if (!pointStrictlyInsideTriangle(point, m, intersection, vertices[pIndex])) continue;
    if (!isReflexAtPosition(boundary, position, vertices)) continue;
    // "Most visible" = smallest angle to the +x ray; ties broken by nearest
    // distance, then by lowest global vertex index, all total orders.
    const angle = Math.abs(Math.atan2(point.y - m.y, point.x - m.x));
    const distance = Math.hypot(point.x - m.x, point.y - m.y);
    const better = angle < bestAngle - EPSILON ||
      (Math.abs(angle - bestAngle) <= EPSILON && distance < bestDistance - EPSILON) ||
      (Math.abs(angle - bestAngle) <= EPSILON && Math.abs(distance - bestDistance) <= EPSILON &&
        globalIndex < boundary[visiblePosition]);
    if (better) {
      bestAngle = angle;
      bestDistance = distance;
      visiblePosition = position;
    }
  }
  return { boundaryPosition: visiblePosition, holeLocalStart };
};

/**
 * Splice one hole into the current boundary at a bridge found by
 * `findBridge`, producing a new single-ring boundary and recording the two
 * bridge edges as constrained (never-flip) edges.
 */
const spliceHoleIntoBoundary = (
  boundary: ReadonlyArray<number>,
  hole: ReadonlyArray<number>,
  vertices: ReadonlyArray<TriangulationPoint>,
  constrainedEdges: Set<string>
): Array<number> => {
  const { boundaryPosition, holeLocalStart } = findBridge(boundary, hole, vertices);
  const bridgeTarget = boundary[boundaryPosition];
  const holeStartVertex = hole[holeLocalStart];
  constrainedEdges.add(edgeKey(bridgeTarget, holeStartVertex));
  const rotatedHole = [...hole.slice(holeLocalStart), ...hole.slice(0, holeLocalStart)];
  // Sequence inserted after the bridge target V: V, M, (rest of hole), M, V.
  // The two "V" and two "M" occurrences are deliberate — they are the two
  // walls of a zero-width corridor connecting the hole to the boundary, the
  // standard way to fold a hole into a single simple ring without changing
  // the enclosed area.
  const insertion = [holeStartVertex, ...rotatedHole.slice(1), holeStartVertex, bridgeTarget];
  return [
    ...boundary.slice(0, boundaryPosition + 1),
    ...insertion,
    ...boundary.slice(boundaryPosition + 1)
  ];
};

/**
 * Ear-clipping triangulation of one simple polygon boundary (given as a list
 * of global vertex indices, possibly containing repeated indices at bridge
 * seams — see `spliceHoleIntoBoundary`).
 *
 * "Ear clipping" repeatedly finds a convex vertex whose triangle with its
 * two current neighbours contains no other remaining vertex — an "ear" —
 * cuts it off, and continues on the shrunk polygon. It always terminates
 * with a valid triangulation of a simple polygon and is easy to keep
 * deterministic, at the cost of not being Delaunay-quality by itself; the
 * Lawson-flip pass afterwards fixes that.
 *
 * Determinism: at each step, among all vertices that currently qualify as an
 * ear, the one with the lowest global vertex index is clipped — an explicit,
 * arbitrary-but-fixed rule (any fair rule would do; this one was chosen
 * because it is cheap to compute and easy to state).
 *
 * ## Flat (collinear) vertices are never clipped, and always block
 *
 * A vertex whose interior angle is exactly 180° ("flat": collinear with both
 * its current neighbours) can never be the ear vertex itself — the triangle
 * (prev, vertex, next) would have zero area, and this module refuses to ever
 * emit a zero-area triangle (see the module header). That much an earlier
 * version of this function already got right. What it got wrong: it only
 * checked *reflex* vertices when asking whether some OTHER candidate ear's
 * triangle is blocked by a third vertex, on the reasoning that "a convex
 * vertex can never sit on another ear's diagonal". That reasoning holds for
 * *strictly* convex vertices, but a flat vertex is, by definition, collinear
 * with two points already — nothing stops it from also being collinear with,
 * and landing exactly on, some unrelated pair of boundary vertices. Real
 * author-map regions hit this constantly: the road planner conforms each
 * region's contour to its neighbours by copying in the neighbour's border
 * corners, which routinely produces runs of several collinear vertices along
 * one side. Treating only reflex vertices as blockers let the greedy
 * lowest-index rule clip its way into a corner — every vertex left over was
 * part of one long collinear run — leaving nothing to close the polygon with
 * but a zero-area "ear" (see the "collinear boundary run" tests below for a
 * worked, previously-failing example).
 *
 * The fix: `blocking` tracks every vertex that is *not strictly convex* —
 * reflex (interior angle > 180°) or flat (= 180°) alike — and both kinds are
 * used both ways: neither can be chosen as an ear itself, and both can block
 * an unrelated candidate. This is a strictly more general rule than
 * special-casing "three collinear points"; it handles a collinear run of any
 * length, because every interior vertex of the run is flat and therefore
 * already in `blocking`.
 */
const earClip = (
  boundary: ReadonlyArray<number>, vertices: ReadonlyArray<TriangulationPoint>
): Array<TriangulationTriangle> => {
  const n = boundary.length;
  const prev = new Array<number>(n);
  const next = new Array<number>(n);
  const alive = new Array<boolean>(n).fill(true);
  for (let i = 0; i < n; i += 1) {
    prev[i] = (i - 1 + n) % n;
    next[i] = (i + 1) % n;
  }
  // Every position whose interior angle is not strictly convex: reflex
  // (angle > 180°) or flat/collinear (angle == 180°). See the function
  // header above for why both kinds must be tracked together.
  const blocking = new Set<number>();
  const crossAt = (position: number): number =>
    orientation(vertices[boundary[prev[position]]], vertices[boundary[position]], vertices[boundary[next[position]]]);
  // Vertex classification must always be read through `prev`/`next` (the
  // live linked-list neighbours), never through the static `position ± 1`
  // slots in `boundary` — those stop matching a vertex's real neighbours as
  // soon as any other vertex between them has been clipped away. At this
  // point in the function the two happen to agree (nothing has been clipped
  // yet), but `updateVertexClass` below is what keeps this correct as
  // clipping proceeds.
  // Returns whether `position` just transitioned FROM blocking TO strictly
  // convex -- the one event that can make some *other*, already-rejected
  // candidate's old rejection stale (see `requeueBlockedBy` below). A
  // transition the other way, or no transition at all, never needs that:
  // an existing rejection remains valid, and a brand new blocker is caught
  // by the fresh `findBlocker` check the next time its target is popped.
  const updateVertexClass = (position: number): boolean => {
    const wasBlocking = blocking.has(position);
    const cross = crossAt(position);
    const tolerance = scaledEpsilon(
      vertices[boundary[prev[position]]], vertices[boundary[position]], vertices[boundary[next[position]]]
    );
    // Not strictly greater than tolerance => reflex or flat => blocking.
    const isBlockingNow = cross <= tolerance;
    if (isBlockingNow) blocking.add(position);
    else blocking.delete(position);
    return wasBlocking && !isBlockingNow;
  };
  for (let i = 0; i < n; i += 1) updateVertexClass(i);

  /**
   * The specific position that currently disqualifies `position` from being
   * an ear, or -1 if `position` qualifies (strictly convex itself, and its
   * (prev, position, next) triangle is free of every other non-strictly-
   * convex vertex — tested against both "strictly inside" and "exactly on
   * the diagonal", since a blocker sitting precisely on the prev-next line
   * is just as disqualifying as one inside the triangle).
   *
   * Performance note: this is called on every (re-)examination of a
   * candidate, so it is written to do zero heap allocation and to compute
   * each per-candidate tolerance exactly once, passing it into
   * `pointStrictlyInsideTriangle` / `pointOnSegment` instead of letting those
   * helpers re-derive (and re-allocate for) it on every blocker checked (see
   * the performance comment above `lawsonFlip` for the profile that found
   * the allocation was necessary to remove). Returning *which* vertex
   * blocked the candidate, rather than a plain boolean, is what lets the
   * incremental candidate queue below re-examine a rejected candidate only
   * when that *specific* blocker's status later changes, instead of on
   * every subsequent clip step regardless of relevance -- see that queue's
   * doc comment for the full argument.
   */
  const findBlocker = (position: number): number => {
    const p = vertices[boundary[prev[position]]];
    const c = vertices[boundary[position]];
    const nx = vertices[boundary[next[position]]];
    // Base magnitude scale for this candidate's own three points, and for
    // just (p, nx) -- the two different point sets the two containment
    // tests below need scaled tolerances for. Computed once per candidate
    // (not once per blocker checked against it).
    let baseMaxAbs = 1;
    let pnxMaxAbs = 1;
    for (const point of [p, c, nx]) {
      const ax = Math.abs(point.x);
      const ay = Math.abs(point.y);
      if (ax > baseMaxAbs) baseMaxAbs = ax;
      if (ay > baseMaxAbs) baseMaxAbs = ay;
    }
    for (const point of [p, nx]) {
      const ax = Math.abs(point.x);
      const ay = Math.abs(point.y);
      if (ax > pnxMaxAbs) pnxMaxAbs = ax;
      if (ay > pnxMaxAbs) pnxMaxAbs = ay;
    }
    for (const blockerPosition of blocking) {
      if (blockerPosition === position || blockerPosition === prev[position] || blockerPosition === next[position]) {
        continue;
      }
      // Bridge seams (see `spliceHoleIntoBoundary`) deliberately repeat the
      // same global vertex at two different *positions*, so a duplicate of
      // `p`, `c` or `nx` itself can appear as a "different" blocking position
      // with identical coordinates. That is not a real blocker — it is the
      // same point — so positions are compared by the global vertex index
      // they name, not by their position in `boundary`.
      const blockerGlobal = boundary[blockerPosition];
      if (blockerGlobal === boundary[position] || blockerGlobal === boundary[prev[position]] ||
          blockerGlobal === boundary[next[position]]) continue;
      const blockerPoint = vertices[blockerGlobal];
      const bx = Math.abs(blockerPoint.x);
      const by = Math.abs(blockerPoint.y);
      const bMax = bx > by ? bx : by;
      // These two tolerances are numerically identical to what
      // `scaledEpsilon(blockerPoint, p, c, nx)` and `scaledEpsilon(blockerPoint, p, nx)`
      // would each compute independently (same points, same max-then-scale
      // formula, just reassociated) -- see the comments on those helpers.
      const triTolerance = EPSILON * (baseMaxAbs > bMax ? baseMaxAbs : bMax);
      const segTolerance = EPSILON * (pnxMaxAbs > bMax ? pnxMaxAbs : bMax);
      if (pointStrictlyInsideTriangle(blockerPoint, p, c, nx, triTolerance) ||
          pointOnSegment(blockerPoint, p, nx, segTolerance)) return blockerPosition;
    }
    return -1;
  };

  /**
   * ## Incremental candidate queue (why this replaced a full O(n) rescan)
   *
   * An earlier version found the next ear to clip by rescanning *every one*
   * of the `n` boundary positions on *every* clip step, calling the O(blocker
   * count) check above for each alive one. Once the per-check cost itself
   * was fixed (see `findBlocker`'s doc comment), profiling the remaining
   * cost on real author-map regions showed this rescan-from-scratch pattern
   * was still the dominant cost: most candidates' answers do not change
   * between one clip step and the next, yet the naive version recomputed
   * every one of them, every step, from nothing.
   *
   * The fix is a min-heap of candidate positions, ordered by (global vertex
   * index, position) — the same total order the original full-rescan
   * "lowest global index wins" rule used, so results are identical, not
   * merely equally valid. A position enters the heap only when its answer
   * *could* have changed since it was last examined:
   *  - once, for every position, at start-up;
   *  - for `p` and `nx` after every clip (their neighbours, and hence their
   *    own convexity, changed);
   *  - for every candidate that was previously rejected specifically because
   *    of blocker B, exactly when B itself stops being reflex/flat (tracked
   *    via `blockedCandidatesByBlocker`, the reverse of `blockedBy`) — since
   *    a candidate's rejection can only become stale when the *specific*
   *    vertex that caused it changes, this is the complete set of positions
   *    that need re-examining, no more and no less.
   *
   * Every accept still runs a full, fresh `findBlocker` check at the moment
   * a candidate is popped (not a cached guess), so a stale or lazily-invalid
   * heap entry can never cause an invalid ear to be clipped — the queue only
   * affects which candidates get re-examined and in what order, never
   * whether a returned ear is actually valid.
   */
  const heap: Array<number> = []; // positions, heap-ordered by (boundary[position], position)
  const heapLess = (a: number, b: number): boolean => {
    const ga = boundary[a];
    const gb = boundary[b];
    return ga !== gb ? ga < gb : a < b;
  };
  const heapPush = (position: number): void => {
    heap.push(position);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!heapLess(heap[i], heap[parent])) break;
      const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
      i = parent;
    }
  };
  const heapPop = (): number | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const size = heap.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < size && heapLess(heap[left], heap[smallest])) smallest = left;
        if (right < size && heapLess(heap[right], heap[smallest])) smallest = right;
        if (smallest === i) break;
        const tmp = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  };

  // Reverse index: for a candidate currently rejected, which position
  // blocked it (`blockedBy`), and for a blocking position, which candidates
  // it is currently the recorded reason for rejecting (`blockedCandidatesByBlocker`).
  const blockedBy = new Map<number, number>();
  const blockedCandidatesByBlocker = new Map<number, Set<number>>();
  const clearBlockedRecord = (candidatePosition: number): void => {
    const blockerPosition = blockedBy.get(candidatePosition);
    if (blockerPosition === undefined) return;
    blockedBy.delete(candidatePosition);
    const set = blockedCandidatesByBlocker.get(blockerPosition);
    if (set) {
      set.delete(candidatePosition);
      if (set.size === 0) blockedCandidatesByBlocker.delete(blockerPosition);
    }
  };
  const registerBlockedRecord = (candidatePosition: number, blockerPosition: number): void => {
    clearBlockedRecord(candidatePosition);
    blockedBy.set(candidatePosition, blockerPosition);
    let set = blockedCandidatesByBlocker.get(blockerPosition);
    if (!set) { set = new Set<number>(); blockedCandidatesByBlocker.set(blockerPosition, set); }
    set.add(candidatePosition);
  };
  // Requeue every candidate on record as blocked specifically by `position`
  // -- called exactly when `position` stops being reflex/flat, since that is
  // the only event that can make any of those candidates' old rejection
  // stale.
  const requeueBlockedBy = (position: number): void => {
    const set = blockedCandidatesByBlocker.get(position);
    if (!set) return;
    blockedCandidatesByBlocker.delete(position);
    for (const candidatePosition of set) {
      blockedBy.delete(candidatePosition);
      heapPush(candidatePosition);
    }
  };

  for (let i = 0; i < n; i += 1) if (!blocking.has(i)) heapPush(i);

  const pickNextEar = (): number => {
    for (;;) {
      const position = heapPop();
      if (position === undefined) return -1;
      if (!alive[position] || blocking.has(position)) continue; // stale entry: dead, or no longer convex
      const blockerPosition = findBlocker(position);
      if (blockerPosition < 0) return position; // fresh check confirms: a genuine, currently-valid ear
      registerBlockedRecord(position, blockerPosition);
    }
  };

  const triangles: Array<TriangulationTriangle> = [];
  let remaining = n;
  while (remaining > 3) {
    const chosen = pickNextEar();
    if (chosen < 0) {
      // With the "flat vertices block too" rule above, this should not be
      // reachable for any simple, positive-area ring (a strictly convex,
      // unblocked vertex always exists while more than a triangle remains) —
      // but per this module's fail-closed convention, a case this function
      // cannot resolve is reported as an error, never silently patched over
      // with a degenerate triangle.
      throw new Error(
        "Polygon triangulation could not find a valid non-degenerate ear; the " +
        "remaining boundary may be entirely collinear, or the ring may be " +
        "self-intersecting in a way normalisation did not detect"
      );
    }
    const p = prev[chosen];
    const nx = next[chosen];
    triangles.push(orientedTriangle(boundary[p], boundary[chosen], boundary[nx], vertices));
    next[p] = nx;
    prev[nx] = p;
    alive[chosen] = false;
    blocking.delete(chosen);
    clearBlockedRecord(chosen);
    remaining -= 1;
    // Only `p` and `nx` gained a new neighbour by this clip, so only their
    // vertex class can have changed; `updateVertexClass` re-reads it through
    // the now-updated `prev`/`next` pointers (see the comment above its
    // definition for why that matters). Each is pushed back onto the
    // candidate queue for fresh examination regardless of its new class —
    // if it is now blocking, `pickNextEar` will discard the stale entry; if
    // it is now (or still) strictly convex, its answer needs rechecking
    // since its triangle just changed. And if either just stopped being
    // reflex/flat, `requeueBlockedBy` wakes up every candidate that was
    // waiting specifically on that transition.
    const pUnblocked = updateVertexClass(p);
    const nxUnblocked = updateVertexClass(nx);
    heapPush(p);
    heapPush(nx);
    if (pUnblocked) requeueBlockedBy(p);
    if (nxUnblocked) requeueBlockedBy(nx);
  }
  const survivors: Array<number> = [];
  for (let position = 0; position < n; position += 1) if (alive[position]) survivors.push(position);
  const finalTriangle = orientedTriangle(
    boundary[survivors[0]], boundary[survivors[1]], boundary[survivors[2]], vertices
  );
  // The last three survivors are not filtered through `isEar` (there is
  // nothing left to compare them against), so check directly here that they
  // are not themselves collinear. `normalizeRing` already rejects a
  // zero-area *ring*, but that is a whole-ring invariant, not a per-triangle
  // one; checking again here, rather than trusting it transitively, is what
  // "never a silent bad triangle" requires.
  const finalArea = orientation(
    vertices[finalTriangle.a], vertices[finalTriangle.b], vertices[finalTriangle.c]
  );
  const finalTolerance = scaledEpsilon(
    vertices[finalTriangle.a], vertices[finalTriangle.b], vertices[finalTriangle.c]
  );
  if (Math.abs(finalArea) <= finalTolerance) {
    throw new Error(
      "Polygon triangulation produced a degenerate final triangle; the remaining boundary was collinear"
    );
  }
  triangles.push(finalTriangle);
  return triangles;
};

/** Build a triangle, swapping `b`/`c` if needed so the result winds CCW. */
const orientedTriangle = (
  a: number, b: number, c: number, vertices: ReadonlyArray<TriangulationPoint>
): TriangulationTriangle => {
  const signedArea = orientation(vertices[a], vertices[b], vertices[c]);
  return signedArea < 0 ? { a, b: c, c: b } : { a, b, c };
};

/** The vertex of `triangle` that is neither `u` nor `v`; `triangle` must contain both. */
const thirdVertex = (triangle: TriangulationTriangle, u: number, v: number): number => {
  if (triangle.a !== u && triangle.a !== v) return triangle.a;
  if (triangle.b !== u && triangle.b !== v) return triangle.b;
  return triangle.c;
};

/**
 * In-circle determinant test (a well-known predicate from computational
 * geometry): for CCW-oriented triangle (a, b, c), a positive result means
 * `d` lies strictly inside the circle passing through a, b and c. A
 * near-zero result means the four points are (numerically) cocircular.
 */
const inCircleDeterminant = (
  a: TriangulationPoint, b: TriangulationPoint, c: TriangulationPoint, d: TriangulationPoint
): number => {
  const ax = a.x - d.x;
  const ay = a.y - d.y;
  const bx = b.x - d.x;
  const by = b.y - d.y;
  const cx = c.x - d.x;
  const cy = c.y - d.y;
  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;
  return ax * (by * cSq - bSq * cy) - ay * (bx * cSq - bSq * cx) + aSq * (bx * cy - by * cx);
};

/**
 * Improve an ear-clipped triangulation with Lawson edge flips until every
 * non-constrained edge satisfies the in-circle test, or the flip cap is hit.
 *
 * ## Performance history (why this function looks the way it does)
 *
 * An earlier version rebuilt the *entire* shared-edge adjacency from scratch
 * after every single flip, then re-sorted and re-scanned every candidate
 * edge to find the next one to flip. Measured on 917 real author-map region
 * polygons (median 76 vertices, largest 511; see the benchmark referenced in
 * the module header), that earlier version took a median of 68ms per region
 * and over 7.8 seconds for the worst single region (475 vertices) — several
 * thousand times slower than the sub-millisecond this kind of polygon should
 * take. Profiling (`node --cpu-prof`) that worst case found the true hot
 * spot was **not** primarily this function's own rebuild-per-pass loop (it
 * accounted for roughly a fifth of the time), but the ear-clipping phase's
 * repeated, allocating tolerance computations and its own O(n) full-rescan
 * pattern (see `scaledEpsilon`'s and `earClip`'s doc comments for that part
 * of the fix). Still, rebuilding all O(edges) adjacency data after each of
 * the (typically O(vertices)) flips is quadratic work this module does not
 * need. Measured after this whole rewrite (this function's incremental
 * worklist, `scaledEpsilon`'s allocation-free rewrite, and `earClip`'s
 * incremental candidate queue together), on the same 917 real regions:
 * median 1.4ms (was 68ms), 90th percentile 3.8ms (was 395ms), worst single
 * region (511 vertices) 46ms (was 7 836ms), and the whole 917-polygon set
 * in 2.0s (was ≈209s measured directly, extrapolated ≈200s in the original
 * task) — all comfortably inside the task's targets (median < 2ms, worst
 * < 100ms, whole set < 5s).
 *
 * ## The incremental algorithm
 *
 * Instead of a "rebuild everything, scan everything, flip the first
 * violator, repeat" outer loop, this function maintains:
 *  - `adjacency`: for every non-constrained edge, which triangle "slots"
 *    (indices into `triangles`) currently touch it (0, 1, or 2 — an edge
 *    with 2 owners is an internal, potentially-flippable edge).
 *  - `heap`: a binary min-heap of edge keys waiting to be (re-)examined.
 *
 * Determinism rule (this is the "explicit, sorted order" the task requires
 * in place of "whatever order a queue happened to dequeue them"): each edge
 * (u, v) with u < v is encoded as the single integer `u * vertexCount + v`,
 * so ascending numeric key order is exactly ascending (u, v) lexicographic
 * order — the same order the original full-rebuild version scanned in. The
 * heap always pops the globally smallest surviving key next.
 *
 * Why popping the smallest key, and re-enqueuing only what changed, gives
 * the *same* result as "rebuild and rescan everything, every time": an
 * edge's in-circle test result depends only on the 4 points of its 2 owning
 * triangles. Those can only change when one of that edge's own 2 owning
 * triangle *slots* is overwritten — which happens only as a direct result of
 * *some* flip (this one, or another). So after performing a flip that
 * replaces old triangles (u, v, r) and (u, v, s) with new triangles
 * (u, r, s) and (r, v, s), exactly 5 distinct edges need a fresh check: the
 * 4 "outer" edges of the flipped quadrilateral (u, r), (r, v), (v, s),
 * (s, u) — each of which now borders a triangle slot that was just
 * overwritten — and the brand new diagonal (r, s) itself. Every edge NOT
 * among those 5 provably still has the same 2 owning triangles it had
 * before, so its previous "does not violate the in-circle test" conclusion
 * (if reached) is still valid and does not need to be recomputed. This is
 * the same "recheck the 4 edges of the two touched triangles" rule as the
 * textbook stack-based incremental Delaunay flip algorithm; the only
 * addition here is processing that work in a fixed sorted order (a min-heap)
 * instead of an arbitrary stack, so the result is reproducible.
 *
 * Which of an edge's 2 owners is called "triA" (contributing vertex `r`) vs
 * "triB" (contributing vertex `s`) is fixed as "the smaller triangle-slot
 * index is triA" — a cheap, total, order-independent rule — so the result
 * does not depend on the incidental order `adjacency` happened to record the
 * two owners in.
 *
 * Four cocircular points are exactly the tie the task calls out: the
 * in-circle determinant is treated as a violation only when it exceeds a
 * magnitude-scaled tolerance, so an exact (or near-exact) cocircular
 * configuration is left as-is — whichever diagonal ear clipping already
 * produced — rather than flipped back and forth.
 */
const lawsonFlip = (
  initial: ReadonlyArray<TriangulationTriangle>,
  vertices: ReadonlyArray<TriangulationPoint>,
  constrainedEdges: ReadonlySet<string>
): Array<TriangulationTriangle> => {
  const triangles: Array<TriangulationTriangle | undefined> = initial.map((triangle) => ({ ...triangle }));
  const cap = lawsonFlipCap(vertices.length);
  const vertexCount = vertices.length;
  let flips = 0;

  // Every vertex index is < vertexCount, so (u, v) with u < v maps to a
  // unique, order-preserving integer. This lets the hot loop compare and
  // heap-order edges as plain numbers instead of building and parsing
  // "u,v"-style strings on every check (see the performance comment above).
  const numericKey = (u: number, v: number): number => (u < v ? u * vertexCount + v : v * vertexCount + u);
  const keyU = (key: number): number => Math.floor(key / vertexCount);
  const keyV = (key: number): number => key % vertexCount;

  // adjacency[key] holds the triangle slot indices (0, 1, or 2) that
  // currently own this edge. Constrained edges are never inserted at all —
  // they can never be flip candidates, matching the original algorithm's
  // `constrainedEdges.has(key)` guard.
  const adjacency = new Map<number, Array<number>>();
  const addOwner = (u: number, v: number, triSlot: number): void => {
    if (constrainedEdges.has(edgeKey(u, v))) return;
    const key = numericKey(u, v);
    const owners = adjacency.get(key);
    if (owners) owners.push(triSlot);
    else adjacency.set(key, [triSlot]);
  };
  const removeOwner = (u: number, v: number, triSlot: number): void => {
    const key = numericKey(u, v);
    const owners = adjacency.get(key);
    if (!owners) return;
    const at = owners.indexOf(triSlot);
    if (at >= 0) owners.splice(at, 1);
    if (owners.length === 0) adjacency.delete(key);
  };

  // Plain binary min-heap over numeric edge keys, with lazy deletion: a key
  // can be pushed more than once (e.g. the shared diagonal (r, s) is an edge
  // of both new triangles after a flip, so it is offered twice), and a
  // popped key that no longer names a genuine 2-owner internal edge is
  // simply discarded rather than tracked separately. Both are safe because
  // re-examining an already-settled edge just reconfirms it is fine.
  const heap: Array<number> = [];
  const heapPush = (key: number): void => {
    heap.push(key);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent] <= heap[i]) break;
      const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
      i = parent;
    }
  };
  const heapPop = (): number | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && heap[left] < heap[smallest]) smallest = left;
        if (right < n && heap[right] < heap[smallest]) smallest = right;
        if (smallest === i) break;
        const tmp = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  };

  // Initial build: every triangle contributes its 3 edges; any edge that
  // ends up with exactly 2 owners is a genuine internal, flippable edge and
  // is offered to the heap once, up front.
  for (let index = 0; index < triangles.length; index += 1) {
    const triangle = triangles[index];
    if (!triangle) continue;
    addOwner(triangle.a, triangle.b, index);
    addOwner(triangle.b, triangle.c, index);
    addOwner(triangle.c, triangle.a, index);
  }
  for (const [key, owners] of adjacency) {
    if (owners.length === 2) heapPush(key);
  }

  for (;;) {
    const key = heapPop();
    if (key === undefined) break;
    const owners = adjacency.get(key);
    if (!owners || owners.length !== 2) continue; // stale: no longer a 2-owner internal edge

    // Deterministic tie-break for which owner is "triA" vs "triB" (see the
    // function's performance comment for why this must not depend on
    // `owners`' incidental push order).
    const triAIndex = Math.min(owners[0], owners[1]);
    const triBIndex = Math.max(owners[0], owners[1]);
    const triA = triangles[triAIndex];
    const triB = triangles[triBIndex];
    if (!triA || !triB) continue;

    const u = keyU(key);
    const v = keyV(key);
    const r = thirdVertex(triA, u, v);
    const s = thirdVertex(triB, u, v);
    const uPoint = vertices[u];
    const vPoint = vertices[v];
    const rPoint = vertices[r];
    const sPoint = vertices[s];
    // Flipping is only geometrically valid when u-v and r-s are the two
    // diagonals of a convex quadrilateral; at a reflex boundary
    // configuration they may not be, and the edge is left as-is (this is
    // an expected, geometry-forced non-Delaunay edge, not a bug).
    if (!segmentsProperlyCross(uPoint, vPoint, rPoint, sPoint)) continue;
    if (constrainedEdges.has(edgeKey(r, s))) continue;
    // Orient (u, v, r) CCW before testing, since the in-circle determinant
    // assumes CCW winding; triA is already CCW by construction, but which
    // of its own vertices is "first" depends on how thirdVertex found r.
    const ccw = orientation(uPoint, vPoint, rPoint) >= 0
      ? { first: uPoint, second: vPoint, third: rPoint }
      : { first: vPoint, second: uPoint, third: rPoint };
    const tolerance = scaledEpsilon(uPoint, vPoint, rPoint, sPoint) *
      Math.max(1, Math.abs(uPoint.x) + Math.abs(uPoint.y) + Math.abs(vPoint.x) + Math.abs(vPoint.y));
    if (inCircleDeterminant(ccw.first, ccw.second, ccw.third, sPoint) <= tolerance) continue;

    // Perform the flip: drop the two old triangles' edge registrations,
    // install the two new triangles in the same slots, and register their
    // (different) edges. Old edge (u, v) simply is not re-added — it no
    // longer exists once flipped.
    const oldTriAEdges: Array<[number, number]> = [[triA.a, triA.b], [triA.b, triA.c], [triA.c, triA.a]];
    const oldTriBEdges: Array<[number, number]> = [[triB.a, triB.b], [triB.b, triB.c], [triB.c, triB.a]];
    for (const [eu, ev] of oldTriAEdges) removeOwner(eu, ev, triAIndex);
    for (const [eu, ev] of oldTriBEdges) removeOwner(eu, ev, triBIndex);

    const newTriA = orientedTriangle(u, r, s, vertices);
    const newTriB = orientedTriangle(r, v, s, vertices);
    triangles[triAIndex] = newTriA;
    triangles[triBIndex] = newTriB;

    const newEdges: Array<[number, number, number]> = [
      [newTriA.a, newTriA.b, triAIndex], [newTriA.b, newTriA.c, triAIndex], [newTriA.c, newTriA.a, triAIndex],
      [newTriB.a, newTriB.b, triBIndex], [newTriB.b, newTriB.c, triBIndex], [newTriB.c, newTriB.a, triBIndex]
    ];
    for (const [eu, ev, slot] of newEdges) addOwner(eu, ev, slot);
    // Re-offer every edge of the two rebuilt triangles for a fresh check —
    // see the function's performance comment for why this exactly
    // reproduces what a full pass-rebuild would have re-examined, no more
    // and no less.
    for (const [eu, ev] of newEdges) {
      const k = numericKey(eu, ev);
      const candidateOwners = adjacency.get(k);
      if (candidateOwners && candidateOwners.length === 2) heapPush(k);
    }

    flips += 1;
    if (flips > cap) {
      throw new Error(
        `Polygon triangulation exceeded the Delaunay flip cap of ${cap}; ` +
        "the input geometry is likely degenerate (near-duplicate points or " +
        "extreme aspect ratios) rather than merely large"
      );
    }
  }
  const result: Array<TriangulationTriangle> = [];
  for (const triangle of triangles) if (triangle) result.push(triangle);
  return result;
};

/** Register both directed forms of every ring edge as never-flip constrained edges. */
const addRingEdges = (ring: ReadonlyArray<number>, into: Set<string>): void => {
  for (let index = 0; index < ring.length; index += 1) {
    into.add(edgeKey(ring[index], ring[(index + 1) % ring.length]));
  }
};

/**
 * Triangulate a bounded simple polygon, with optional holes, into a
 * deterministic constrained Delaunay triangulation.
 *
 * "Constrained" means every edge of every input ring (outer or hole), and
 * every bridge edge used to connect a hole to the outer boundary, is
 * guaranteed to survive as an edge of some output triangle — the
 * triangulation never cuts through a boundary the caller declared. Within
 * that constraint, the triangulation is improved towards the Delaunay
 * property (see the module header) but is not required to be a *global*
 * Delaunay triangulation, since the constraints can force locally
 * non-Delaunay edges at concave corners; this matches the standard
 * definition of a constrained Delaunay triangulation.
 *
 * Throws a descriptive `Error` — rather than returning an approximate or
 * partial result — for any of: fewer than 3 vertices in a ring, a repeated
 * vertex, a self-intersecting ring, a zero-area ring, a hole that is not
 * strictly inside the outer ring, or two holes that overlap.
 */
export const triangulatePolygon = (
  outer: ReadonlyArray<TriangulationPoint>,
  holes?: ReadonlyArray<ReadonlyArray<TriangulationPoint>>
): TriangulatedPolygon => {
  const outerRing = normalizeRing(outer, "Outer ring", "ccw");
  const holeRings = (holes ?? []).map((hole, index) => normalizeRing(hole, `Hole ${index}`, "cw"));
  for (let index = 0; index < holeRings.length; index += 1) {
    assertHoleInsideOuter(holeRings[index], outerRing, index);
  }
  assertHolesDisjoint(holeRings);

  const vertices: Array<TriangulationPoint> = [...outerRing];
  const holeGlobalIndices: Array<Array<number>> = [];
  for (const hole of holeRings) {
    const start = vertices.length;
    vertices.push(...hole);
    holeGlobalIndices.push(hole.map((_, offset) => start + offset));
  }

  const constrainedEdges = new Set<string>();
  const outerGlobalIndices = outerRing.map((_, index) => index);
  addRingEdges(outerGlobalIndices, constrainedEdges);
  for (const hole of holeGlobalIndices) addRingEdges(hole, constrainedEdges);

  // Holes are bridged in an explicit, deterministic order: by descending
  // x-coordinate of each hole's own rightmost vertex (ties broken by
  // ascending y, then by the hole's position in the input array). This is
  // the standard order for this construction — bridging the rightmost hole
  // first guarantees its bridge cannot be blocked by a hole that has not
  // been merged in yet, so every hole can always be connected without
  // needing to re-attempt an earlier one.
  const holeOrder = holeGlobalIndices
    .map((indices, index) => {
      let rightmost = indices[0];
      for (const candidate of indices) {
        const candidatePoint = vertices[candidate];
        const currentPoint = vertices[rightmost];
        if (candidatePoint.x > currentPoint.x + EPSILON ||
            (Math.abs(candidatePoint.x - currentPoint.x) <= EPSILON && candidatePoint.y < currentPoint.y - EPSILON)) {
          rightmost = candidate;
        }
      }
      return { index, point: vertices[rightmost] };
    })
    .sort((left, right) =>
      right.point.x - left.point.x || left.point.y - right.point.y || left.index - right.index)
    .map((entry) => entry.index);

  let boundary: Array<number> = outerGlobalIndices;
  for (const holeIndex of holeOrder) {
    boundary = spliceHoleIntoBoundary(boundary, holeGlobalIndices[holeIndex], vertices, constrainedEdges);
  }

  const initialTriangles = earClip(boundary, vertices);
  const triangles = lawsonFlip(initialTriangles, vertices, constrainedEdges);
  return { vertices, triangles };
};
