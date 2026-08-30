/**
 * Shared deterministic predicates for manifest geometry.
 *
 * Published coordinates live on a decimal grid of one millionth of a map
 * unit. Structural questions (orientation, collinearity, containment and
 * segment intersection) are therefore answered after converting coordinates
 * to exact integers and using `bigint`. This avoids a floating-point epsilon
 * whose meaning changed with the size and location of a shape.
 *
 * Metric operations such as distance and interpolation intentionally remain
 * ordinary numbers: they produce display/path coordinates rather than decide
 * whether a manifest topology is valid.
 */

export interface GeometryPoint {
  x: number;
  y: number;
}

/** A caller-owned counter that may throw as soon as its work limit is exceeded. */
export interface GeometryWorkMeter {
  charge(units: number): void;
}

/**
 * Geometry accounting groups tiny predicate/candidate examinations into fixed
 * chunks. One charged unit permits at most this many primitive examinations;
 * `ceil` charging before a scan remains a conservative bound without making a
 * 10-million-unit transaction mean only 10 million machine instructions.
 */
export const GEOMETRY_PRIMITIVES_PER_WORK_UNIT = 512;

/** Reserve a conservative number of fixed-size geometry work chunks. */
export function chargeGeometryWork(
  meter: GeometryWorkMeter | undefined,
  primitiveExaminations: number
): void {
  if (primitiveExaminations > 0) {
    meter?.charge(Math.ceil(primitiveExaminations / GEOMETRY_PRIMITIVES_PER_WORK_UNIT));
  }
}

export const GEOMETRY_GRID_SCALE = 1_000_000;
export const GEOMETRY_GRID_STEP = 1 / GEOMETRY_GRID_SCALE;
export const MAX_GEOMETRY_COORDINATE_MAGNITUDE = 10_000_000;

interface GridPoint {
  x: number;
  y: number;
  bigint?: { x: bigint; y: bigint };
}

// Canonical map vertices are immutable objects shared by all geometry passes.
// Remembering their integer form avoids repeating decimal validation and
// bigint allocation for every orientation query on a large author map.
const gridPointCache = new WeakMap<object, GridPoint>();
const gridEligibilityCache = new WeakMap<object, boolean>();

/** Convert one schema-declared coordinate to its exact grid integer. */
const coordinateToGridNumber = (value: number, label = "coordinate"): number => {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_GEOMETRY_COORDINATE_MAGNITUDE) {
    throw new Error(
      `${label} must be finite and have magnitude at most ${MAX_GEOMETRY_COORDINATE_MAGNITUDE}`
    );
  }
  const scaled = value * GEOMETRY_GRID_SCALE;
  const rounded = Math.round(scaled);
  // Decimal JSON values acquire a tiny binary representation error. Accept
  // only that representation noise, never a coordinate genuinely off-grid.
  const representationTolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > representationTolerance) {
    throw new Error(`${label} must use the ${GEOMETRY_GRID_STEP} coordinate grid`);
  }
  return rounded;
};

/** Convert one schema-declared coordinate to its exact grid integer. */
export function coordinateToGrid(value: number, label = "coordinate"): bigint {
  return BigInt(coordinateToGridNumber(value, label));
}

const isCoordinateOnGrid = (value: number): boolean => {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_GEOMETRY_COORDINATE_MAGNITUDE) return false;
  const scaled = value * GEOMETRY_GRID_SCALE;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) &&
    Math.abs(scaled - rounded) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
};

const isPointOnGrid = (point: GeometryPoint): boolean => {
  const cached = gridEligibilityCache.get(point);
  if (cached !== undefined) return cached;
  const result = isCoordinateOnGrid(point.x) && isCoordinateOnGrid(point.y);
  gridEligibilityCache.set(point, result);
  return result;
};

/** Validate and normalise one stored point without changing its grid value. */
export function canonicalGeometryPoint(point: GeometryPoint, label: string): GeometryPoint {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    throw new Error(`${label} must contain numeric x and y coordinates`);
  }
  coordinateToGrid(point.x, `${label}.x`);
  coordinateToGrid(point.y, `${label}.y`);
  return {
    x: Object.is(point.x, -0) ? 0 : point.x,
    y: Object.is(point.y, -0) ? 0 : point.y
  };
}

const gridPoint = (point: GeometryPoint): GridPoint => {
  const cached = gridPointCache.get(point);
  if (cached) return cached;
  const converted = {
    x: coordinateToGridNumber(point.x),
    y: coordinateToGridNumber(point.y)
  };
  gridPointCache.set(point, converted);
  gridEligibilityCache.set(point, true);
  return converted;
};

const bigintPoint = (point: GridPoint): { x: bigint; y: bigint } => {
  point.bigint ??= { x: BigInt(point.x), y: BigInt(point.y) };
  return point.bigint;
};

const signOfBigint = (value: bigint): -1 | 0 | 1 =>
  value < 0n ? -1 : value > 0n ? 1 : 0;

const exactOrientationDeterminant = (a: GridPoint, b: GridPoint, c: GridPoint): bigint => {
  const first = bigintPoint(a);
  const second = bigintPoint(b);
  const third = bigintPoint(c);
  return (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x);
};

const gridOrientationSign = (first: GridPoint, second: GridPoint, third: GridPoint): -1 | 0 | 1 => {
  const left = (second.x - first.x) * (third.y - first.y);
  const right = (second.y - first.y) * (third.x - first.x);
  const approximate = left - right;
  const uncertainty = (Math.abs(left) + Math.abs(right)) * Number.EPSILON * 4;
  if (Math.abs(approximate) > uncertainty) return approximate < 0 ? -1 : 1;
  const exact = exactOrientationDeterminant(first, second, third);
  return exact < 0n ? -1 : exact > 0n ? 1 : 0;
};

/** Exact sign of the signed double area of triangle `a,b,c`. */
export function orientationSign(a: GeometryPoint, b: GeometryPoint, c: GeometryPoint): -1 | 0 | 1 {
  const first = gridPoint(a);
  const second = gridPoint(b);
  const third = gridPoint(c);
  // Most map turns are far from zero, where IEEE-754 has an unambiguous sign.
  // Only the numerically uncertain band pays for bigint. The returned answer
  // is still exact because every possibly rounded sign takes the exact branch.
  return gridOrientationSign(first, second, third);
}

/** Exact order of two coordinates declared on the public grid. */
export function compareGridCoordinates(left: number, right: number): -1 | 0 | 1 {
  const first = coordinateToGridNumber(left);
  const second = coordinateToGridNumber(right);
  return first < second ? -1 : first > second ? 1 : 0;
}

/**
 * An x coordinate represented as a rational grid value.
 *
 * Horizontal bridge rays usually hit the interior of an edge rather than a
 * stored vertex. Keeping numerator/denominator instead of rounding the hit to
 * `number` is what lets the triangulator choose the genuinely nearest edge.
 */
export interface ExactHorizontalRayIntersection {
  readonly xNumerator: bigint;
  readonly denominator: bigint;
  readonly y: bigint;
}

/** Exact intersection of the +x horizontal line through `origin` with an edge. */
export function horizontalRayIntersection(
  origin: GeometryPoint,
  from: GeometryPoint,
  to: GeometryPoint
): ExactHorizontalRayIntersection | undefined {
  const o = bigintPoint(gridPoint(origin));
  const a = bigintPoint(gridPoint(from));
  const b = bigintPoint(gridPoint(to));
  // The half-open straddle rule counts a vertex once, not once per incident
  // edge. It is the division-free form of the triangulator's former ray test.
  if ((a.y > o.y) === (b.y > o.y)) return undefined;
  let denominator = b.y - a.y;
  let numerator = a.x * denominator + (o.y - a.y) * (b.x - a.x);
  if (denominator < 0n) {
    denominator = -denominator;
    numerator = -numerator;
  }
  return { xNumerator: numerator, denominator, y: o.y };
}

/** Exact order of two rational horizontal-ray intersections by x. */
export function compareHorizontalRayIntersections(
  left: ExactHorizontalRayIntersection,
  right: ExactHorizontalRayIntersection
): -1 | 0 | 1 {
  return signOfBigint(
    left.xNumerator * right.denominator - right.xNumerator * left.denominator
  );
}

/** Exact order of an intersection x and one stored point x. */
export function compareHorizontalRayIntersectionToPoint(
  intersection: ExactHorizontalRayIntersection,
  point: GeometryPoint
): -1 | 0 | 1 {
  const x = bigintPoint(gridPoint(point)).x;
  return signOfBigint(intersection.xNumerator - x * intersection.denominator);
}

/**
 * Exact strict containment in triangle `(a, intersection, c)`.
 *
 * The rational intersection is never rounded onto the public grid: all three
 * orientation determinants are multiplied by its positive denominator, which
 * preserves their signs exactly.
 */
export function pointStrictlyInsideHorizontalRayTriangle(
  point: GeometryPoint,
  a: GeometryPoint,
  intersection: ExactHorizontalRayIntersection,
  c: GeometryPoint
): boolean {
  const p = bigintPoint(gridPoint(point));
  const first = bigintPoint(gridPoint(a));
  const third = bigintPoint(gridPoint(c));
  const denominator = intersection.denominator;
  const fromFirstX = intersection.xNumerator - first.x * denominator;
  const atFirst = signOfBigint(
    fromFirstX * (p.y - first.y) -
    (intersection.y - first.y) * (p.x - first.x) * denominator
  );
  const fromIntersectionToThirdX = third.x * denominator - intersection.xNumerator;
  const fromIntersectionToPointX = p.x * denominator - intersection.xNumerator;
  const atIntersection = signOfBigint(
    fromIntersectionToThirdX * (p.y - intersection.y) -
    (third.y - intersection.y) * fromIntersectionToPointX
  );
  const atThird = orientationSign(c, a, point);
  if (atFirst === 0 || atIntersection === 0 || atThird === 0) return false;
  const hasPositive = atFirst > 0 || atIntersection > 0 || atThird > 0;
  const hasNegative = atFirst < 0 || atIntersection < 0 || atThird < 0;
  return !(hasPositive && hasNegative);
}

/** Exact order of the absolute slopes from `origin` to two points to its right. */
export function compareAbsoluteSlopes(
  origin: GeometryPoint,
  left: GeometryPoint,
  right: GeometryPoint
): -1 | 0 | 1 {
  const o = bigintPoint(gridPoint(origin));
  const a = bigintPoint(gridPoint(left));
  const b = bigintPoint(gridPoint(right));
  const leftDx = a.x - o.x;
  const rightDx = b.x - o.x;
  if (leftDx <= 0n || rightDx <= 0n) {
    throw new Error("Absolute-slope comparison requires both points to lie right of the origin");
  }
  const leftDy = a.y >= o.y ? a.y - o.y : o.y - a.y;
  const rightDy = b.y >= o.y ? b.y - o.y : o.y - b.y;
  return signOfBigint(leftDy * rightDx - rightDy * leftDx);
}

/** Exact order of squared distances from one grid point. */
export function compareSquaredDistances(
  origin: GeometryPoint,
  left: GeometryPoint,
  right: GeometryPoint
): -1 | 0 | 1 {
  const o = bigintPoint(gridPoint(origin));
  const a = bigintPoint(gridPoint(left));
  const b = bigintPoint(gridPoint(right));
  const adx = a.x - o.x;
  const ady = a.y - o.y;
  const bdx = b.x - o.x;
  const bdy = b.y - o.y;
  return signOfBigint(adx * adx + ady * ady - bdx * bdx - bdy * bdy);
}

/**
 * Exact in-circle sign for a counter-clockwise triangle `(a,b,c)`.
 * Positive means `d` is strictly inside; zero means exactly cocircular.
 */
export function inCircleSign(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
  d: GeometryPoint
): -1 | 0 | 1 {
  const first = bigintPoint(gridPoint(a));
  const second = bigintPoint(gridPoint(b));
  const third = bigintPoint(gridPoint(c));
  const test = bigintPoint(gridPoint(d));
  const ax = first.x - test.x;
  const ay = first.y - test.y;
  const bx = second.x - test.x;
  const by = second.y - test.y;
  const cx = third.x - test.x;
  const cy = third.y - test.y;
  const aSquared = ax * ax + ay * ay;
  const bSquared = bx * bx + by * by;
  const cSquared = cx * cx + cy * cy;
  return signOfBigint(
    ax * (by * cSquared - bSquared * cy) -
    ay * (bx * cSquared - bSquared * cx) +
    aSquared * (bx * cy - by * cx)
  );
}

/** Exact sign of a ring's shoelace area. */
export function signedRingAreaSign(ring: ReadonlyArray<GeometryPoint>): -1 | 0 | 1 {
  let approximate = 0;
  let magnitude = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const point = gridPoint(ring[index]);
    const next = gridPoint(ring[(index + 1) % ring.length]);
    const left = point.x * next.y;
    const right = point.y * next.x;
    approximate += left - right;
    magnitude += Math.abs(left) + Math.abs(right);
  }
  // Shoelace accumulation performs work proportional to the ring length. Its
  // proven floating error therefore uses gamma_n rather than a fixed epsilon;
  // otherwise a long, almost-cancelling contour could take an unsafe fast
  // path. Values inside the bound always fall back to exact bigint summation.
  const operationCount = ring.length * 4 + 1;
  const gamma = (operationCount * Number.EPSILON) /
    (1 - operationCount * Number.EPSILON);
  if (Math.abs(approximate) > magnitude * gamma * 2) {
    return approximate < 0 ? -1 : 1;
  }
  let exact = 0n;
  for (let index = 0; index < ring.length; index += 1) {
    const point = gridPoint(ring[index]);
    const next = gridPoint(ring[(index + 1) % ring.length]);
    exact += BigInt(point.x) * BigInt(next.y) - BigInt(point.y) * BigInt(next.x);
  }
  return exact < 0n ? -1 : exact > 0n ? 1 : 0;
}

export const pointsEqual = (left: GeometryPoint, right: GeometryPoint): boolean =>
  left.x === right.x && left.y === right.y;

export const pointKey = (point: GeometryPoint): string => `${point.x},${point.y}`;

export const subtract = (left: GeometryPoint, right: GeometryPoint): GeometryPoint => ({
  x: left.x - right.x,
  y: left.y - right.y
});

export const cross = (left: GeometryPoint, right: GeometryPoint): number =>
  left.x * right.y - left.y * right.x;

export const distance = (left: GeometryPoint, right: GeometryPoint): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

export const interpolate = (from: GeometryPoint, to: GeometryPoint, t: number): GeometryPoint => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t
});

/** Exact inclusive test for a grid point on a closed grid segment. */
export function pointOnSegment(point: GeometryPoint, from: GeometryPoint, to: GeometryPoint): boolean {
  if (!isPointOnGrid(point) || !isPointOnGrid(from) || !isPointOnGrid(to)) {
    const determinant = (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    // Interpolated route samples are metric results, not stored topology, and
    // therefore need a scale-aware representation tolerance when tested
    // against an exact stored edge. The edge itself remains grid-exact.
    const scale = Math.max(
      1,
      Math.abs(to.x - from.x) * Math.abs(point.y - from.y),
      Math.abs(to.y - from.y) * Math.abs(point.x - from.x)
    );
    const coordinateScale = Math.max(
      1,
      Math.abs(point.x), Math.abs(point.y),
      Math.abs(from.x), Math.abs(from.y),
      Math.abs(to.x), Math.abs(to.y)
    );
    const tolerance = Number.EPSILON * Math.max(scale, coordinateScale) *
      Math.max(1, Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) * 256;
    return Math.abs(determinant) <= tolerance &&
      point.x >= Math.min(from.x, to.x) - tolerance &&
      point.x <= Math.max(from.x, to.x) + tolerance &&
      point.y >= Math.min(from.y, to.y) - tolerance &&
      point.y <= Math.max(from.y, to.y) + tolerance;
  }
  const p = gridPoint(point);
  const a = gridPoint(from);
  const b = gridPoint(to);
  return gridOrientationSign(a, b, p) === 0 &&
    p.x >= (a.x < b.x ? a.x : b.x) && p.x <= (a.x > b.x ? a.x : b.x) &&
    p.y >= (a.y < b.y ? a.y : b.y) && p.y <= (a.y > b.y ? a.y : b.y);
}

/** Exact closed-segment intersection, including touching and overlap. */
export function segmentsIntersect(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
  d: GeometryPoint
): boolean {
  const first = orientationSign(a, b, c);
  const second = orientationSign(a, b, d);
  const third = orientationSign(c, d, a);
  const fourth = orientationSign(c, d, b);
  if (first !== 0 && second !== 0 && first !== second &&
      third !== 0 && fourth !== 0 && third !== fourth) return true;
  return (first === 0 && pointOnSegment(c, a, b)) ||
    (second === 0 && pointOnSegment(d, a, b)) ||
    (third === 0 && pointOnSegment(a, c, d)) ||
    (fourth === 0 && pointOnSegment(b, c, d));
}

/** Exact intersection through both segment interiors. */
export function segmentsProperlyCross(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
  d: GeometryPoint
): boolean {
  const first = orientationSign(a, b, c);
  const second = orientationSign(a, b, d);
  const third = orientationSign(c, d, a);
  const fourth = orientationSign(c, d, b);
  return first !== 0 && second !== 0 && first !== second &&
    third !== 0 && fourth !== 0 && third !== fourth;
}

/**
 * Exact even/odd containment on the grid; boundary is included.
 *
 * The upward/downward crossing form avoids division entirely, so a ray that
 * passes a vertex is counted once and cannot be perturbed by rounding.
 */
const pointOnQuantizedSegment = (
  point: GeometryPoint,
  from: GeometryPoint,
  to: GeometryPoint
): boolean => {
  if (!isPointOnGrid(point) || !isPointOnGrid(from) || !isPointOnGrid(to)) {
    return pointOnSegment(point, from, to);
  }
  const p = gridPoint(point);
  const a = gridPoint(from);
  const b = gridPoint(to);
  const determinant = exactOrientationDeterminant(a, b, p);
  const absoluteDeterminant = determinant < 0n ? -determinant : determinant;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A computed crossing serialized to the public grid represents the closed
  // half-step cell around that value. This exact integer interval test admits
  // the shared edge when that cell intersects it; it is not a floating epsilon
  // and is used only for membership queries, never topology validation.
  if (absoluteDeterminant * 2n > BigInt(Math.abs(dx) + Math.abs(dy))) return false;
  return p.x * 2 >= Math.min(a.x, b.x) * 2 - 1 &&
    p.x * 2 <= Math.max(a.x, b.x) * 2 + 1 &&
    p.y * 2 >= Math.min(a.y, b.y) * 2 - 1 &&
    p.y * 2 <= Math.max(a.y, b.y) * 2 + 1;
};

const classifyPointInRing = (
  point: GeometryPoint,
  ring: ReadonlyArray<GeometryPoint>,
  boundaryTest: typeof pointOnSegment = pointOnSegment
): -1 | 0 | 1 => {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index];
    const to = ring[(index + 1) % ring.length];
    if (boundaryTest(point, from, to)) return 0;
    const turn = isPointOnGrid(point)
      ? orientationSign(from, to, point)
      : Math.sign((to.x - from.x) * (point.y - from.y) -
          (to.y - from.y) * (point.x - from.x));
    if (from.y <= point.y) {
      if (to.y > point.y && turn > 0) inside = !inside;
    } else if (to.y <= point.y && turn < 0) {
      inside = !inside;
    }
  }
  return inside ? 1 : -1;
};

export function pointInOrOnRing(
  point: GeometryPoint,
  ring: ReadonlyArray<GeometryPoint>
): boolean {
  return classifyPointInRing(point, ring) >= 0;
}

export function pointStrictlyInsideRing(
  point: GeometryPoint,
  ring: ReadonlyArray<GeometryPoint>
): boolean {
  return classifyPointInRing(point, ring) > 0;
}

/** Closed membership for grid-serialized derived points such as crossings. */
export function pointInOrOnQuantizedRing(
  point: GeometryPoint,
  ring: ReadonlyArray<GeometryPoint>
): boolean {
  return classifyPointInRing(point, ring, pointOnQuantizedSegment) >= 0;
}

/** Strict membership complementary to `pointInOrOnQuantizedRing`. */
export function pointStrictlyInsideQuantizedRing(
  point: GeometryPoint,
  ring: ReadonlyArray<GeometryPoint>
): boolean {
  return classifyPointInRing(point, ring, pointOnQuantizedSegment) > 0;
}

/** Exact strict containment in a triangle of either winding. */
export function pointStrictlyInsideTriangle(
  point: GeometryPoint,
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint
): boolean {
  const first = orientationSign(a, b, point);
  const second = orientationSign(b, c, point);
  const third = orientationSign(c, a, point);
  if (first === 0 || second === 0 || third === 0) return false;
  const hasPositive = first > 0 || second > 0 || third > 0;
  const hasNegative = first < 0 || second < 0 || third < 0;
  return !(hasPositive && hasNegative);
}
