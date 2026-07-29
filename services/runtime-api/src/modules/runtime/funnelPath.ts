/**
 * Exact shortest-path extraction inside a corridor of triangles ("string pulling").
 *
 * Why this module exists: navigation-mesh pathfinding is normally split into two
 * phases. Phase one walks the dual graph of triangles (or, in this platform's
 * case, the region/portal graph built by `regionRoadPlanner.ts`) to find *which*
 * sequence of triangles the road must cross. That phase answers "which rooms",
 * not "which pixels" — it gives a coarse corridor, not a walkable line. Phase
 * two — implemented here — takes that corridor and pulls a taut string through
 * it: the exact, shortest polyline from a start point to a goal point that
 * never leaves the corridor. This second phase is what turns a sequence of
 * triangles into an actual road shape, and it is the same problem regardless of
 * which game or which triangulation produced the corridor, so it is written as
 * one small, self-contained module rather than being folded into a specific
 * planner.
 *
 * Terms of art, defined once here because they are not obvious to a newcomer:
 * - "Corridor" (also called a "sleeve" in the navmesh literature): the chain of
 *   triangles the path must cross, described here purely by the edges shared
 *   between consecutive triangles.
 * - "Gate": one shared edge between two consecutive triangles of the corridor —
 *   the path must cross every gate, in order, to get from start to goal. A gate
 *   has a `left` and a `right` endpoint, named by which side of the direction of
 *   travel they fall on (see `orientGates` below for exactly how that is
 *   decided).
 * - "Funnel": the algorithm's working state while scanning gates left to right.
 *   Picture standing at a fixed point (the "apex") and looking through the
 *   corridor; the visible region narrows to a funnel shape bounded by a left
 *   ray and a right ray. Each new gate can narrow the funnel (tightened side
 *   moves) or reveal that the funnel has been pushed inside-out, which means
 *   the taut string must bend around the corner that caused it.
 * - "String pulling": the name for this whole family of algorithms — pulling an
 *   imaginary taut string through a channel gives exactly the shortest path,
 *   the same way a piece of string pulled tight in a bent corridor hugs every
 *   inside corner and ignores every outside one.
 * - "Apex": the current fixed vantage point of the funnel — the most recently
 *   confirmed vertex of the shortest path.
 *
 * The classic implementation of this idea is Mikko Mononen's "Simple Stupid
 * Funnel Algorithm". This module follows the same shape (an alternative that
 * was rejected: re-deriving the shortest path from a full visibility graph over
 * every corridor vertex, as `regionRoadPlanner.ts` does for a single simple
 * polygon — that approach is quadratic or worse in the number of corridor
 * vertices and would not scale to a long road corridor with many gates; the
 * funnel algorithm is linear in the number of gates, which is why it is the
 * standard choice for exactly this problem). Because the classic algorithm's
 * best-known failure mode is silently dropping a corridor corner when the
 * funnel has to restart at a new apex (an implementation that continues
 * scanning from "the next gate" instead of rescanning from "the gate right
 * after the new apex" misses corners that lie between the old and new apex),
 * this implementation is deliberately explicit about which index scanning
 * resumes from after a restart, and a dedicated test exercises exactly that
 * scenario.
 *
 * Reproducibility: this module is used to compute a road shape that is part of
 * a published, versioned planning algorithm, so its output must be identical
 * for identical input on every run and every machine. That rules out anything
 * that is not a pure function of the input coordinates: no `Math.random`, no
 * clock reads, no reliance on object key enumeration order (all state here is
 * built from arrays and numeric fields, never from object key iteration), and
 * every tie is resolved by a rule that is spelled out in comments below rather
 * than left to incidental floating-point behaviour.
 */

/** A point in the plane. Coordinates are plain numbers in the corridor's own units. */
export interface FunnelPoint {
  x: number;
  y: number;
}

/**
 * One gate the path must cross: the shared edge between two consecutive
 * triangles of the corridor.
 *
 * `left` and `right` are named by which side of the direction of travel (from
 * `start` toward `goal`) they lie on. The caller is responsible for supplying
 * them consistently — see `orientGates` for a helper that derives this from
 * raw, arbitrarily-ordered triangle edges.
 */
export interface FunnelGate {
  left: FunnelPoint;
  right: FunnelPoint;
}

// A single corridor cannot legitimately cross more triangle boundaries than
// exist in the whole walkable surface of a map. `navigationMesh.ts` bounds one
// corridor at 200 000 triangles; this cap sits at the same order of magnitude,
// so an ordinary corridor — always a small fraction of the map — passes freely,
// while one that somehow spanned most of the map is stopped with a clear error
// instead of doing unbounded linear work.
const MAX_GATES = 100_000;

// Coordinates are bounded, not just checked for finiteness, so that the cross
// products used throughout this module cannot themselves overflow to
// `Infinity` (a product of two values near this bound stays far below
// `Number.MAX_VALUE`). An overflowed intermediate would silently break both
// exactness and reproducibility, which matters more here than in most code
// because this module's whole reason to exist is an exact geometric answer.
const MAX_COORDINATE_MAGNITUDE = 1_000_000_000;

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MAGNITUDE;

/** Validate one point and return a plain, defensively-copied `{ x, y }`. */
const assertFinitePoint = (point: FunnelPoint | undefined, label: string): FunnelPoint => {
  if (!point || !isFiniteCoordinate(point.x) || !isFiniteCoordinate(point.y)) {
    throw new Error(`${label} must contain finite coordinates with magnitude at most ${MAX_COORDINATE_MAGNITUDE}`);
  }
  return { x: point.x, y: point.y };
};

/**
 * Two points are equal only when both coordinates match exactly (no epsilon).
 *
 * Every other geometry helper in this codebase (for example
 * `regionRoadPlanner.ts`) tolerates a small epsilon, because it works with
 * geometry that has already been through floating-point derivation (shared
 * boundaries computed from intersections, etc.). This module's input is
 * different: a gate list is a small, exactly-specified combinatorial
 * structure supplied by the caller, not something this module derives by
 * intersecting anything. Introducing a tolerance here would not make the
 * result more correct, only less reproducible (an epsilon comparison can flip
 * near its own boundary depending on argument order or accumulated rounding).
 * Exact equality is therefore both simpler and a strictly better fit for the
 * "byte-for-byte reproducible" requirement this module exists to satisfy.
 */
const pointsEqual = (a: FunnelPoint, b: FunnelPoint): boolean => a.x === b.x && a.y === b.y;

const subtract = (a: FunnelPoint, b: FunnelPoint): FunnelPoint => ({ x: a.x - b.x, y: a.y - b.y });

/** 2D cross product, i.e. the z-component of the 3D cross product of (a,0) and (b,0). */
const cross = (a: FunnelPoint, b: FunnelPoint): number => a.x * b.y - a.y * b.x;

/**
 * Twice the signed area of triangle (a, b, c).
 *
 * Positive when `c` is to the left of the ray from `a` through `b`; negative
 * when it is to the right; exactly zero when the three points are collinear.
 * This one function is the entire geometric primitive the funnel scan and the
 * orientation checks are built from, which keeps their sign conventions
 * trivially consistent with each other (both always call this same helper
 * rather than each rolling its own cross-product expression).
 */
const orientation = (a: FunnelPoint, b: FunnelPoint, c: FunnelPoint): number =>
  cross(subtract(b, a), subtract(c, a));

/** Deterministic total order over points, used only to break exact ties. */
const lexicographicallyBefore = (a: FunnelPoint, b: FunnelPoint): boolean =>
  a.x !== b.x ? a.x < b.x : a.y < b.y;

/**
 * Strict ("proper") segment intersection: the two segments cross through each
 * other's interior. Segments that merely touch at a shared endpoint, or that
 * are collinear and overlapping, are deliberately NOT reported as crossing —
 * sharing an endpoint is the normal, expected shape of two consecutive gates
 * whose corridor pinches to a point, not an orientation error.
 */
const segmentsProperlyCross = (a: FunnelPoint, b: FunnelPoint, c: FunnelPoint, d: FunnelPoint): boolean => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return ((first > 0 && second < 0) || (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) || (third < 0 && fourth > 0));
};

/**
 * Derive a consistent `left`/`right` assignment for raw, arbitrarily-ordered
 * triangle edges, so a caller can pass triangle sides straight from a
 * triangulation without first working out which endpoint is which.
 *
 * Decision rule: gates are processed in order, carrying forward a moving
 * "reference point" that starts at `start`. For each gate, the reference
 * point and the gate's own midpoint define a short trial direction of travel;
 * whichever endpoint lies to the left of that direction (using `orientation`,
 * i.e. positive means left) becomes `left`, and the other becomes `right`.
 * The reference point then advances to that gate's midpoint before the next
 * gate is processed, so the trial direction tracks the corridor gate by gate
 * instead of using one fixed direction for the whole corridor (which would
 * misclassify a corridor that bends more than ninety degrees).
 *
 * Tie-break rule (explicit, as required for determinism): if the endpoints
 * are exactly collinear with the trial direction — including the degenerate
 * case where the reference point coincides with the gate's midpoint, so
 * there is no trial direction at all — handedness cannot decide anything, so
 * the endpoint that is lexicographically smaller (by x, then by y) is always
 * chosen as `left`. This rule depends only on the two endpoints' own
 * coordinates, never on argument order or on which one happened to be named
 * `a`, so it is stable across runs and machines.
 */
export const orientGates = (
  start: FunnelPoint,
  gates: ReadonlyArray<{ a: FunnelPoint; b: FunnelPoint }>
): Array<FunnelGate> => {
  let reference = assertFinitePoint(start, "orientGates start point");
  return gates.map((gate, index) => {
    const a = assertFinitePoint(gate.a, `orientGates gate ${index} point a`);
    const b = assertFinitePoint(gate.b, `orientGates gate ${index} point b`);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const turn = orientation(reference, midpoint, a);
    const oriented = turn > 0
      ? { left: a, right: b }
      : turn < 0
        ? { left: b, right: a }
        : (lexicographicallyBefore(a, b) ? { left: a, right: b } : { left: b, right: a });
    reference = midpoint;
    return oriented;
  });
};

/**
 * Remove exactly the two artefacts the raw funnel scan does not itself
 * guarantee, so the published output invariants hold unconditionally rather
 * than "as long as the scan happens not to produce them":
 *
 * 1. Consecutive exact duplicates. These can appear at the very end of a scan
 *    when the funnel closes down to the goal point in the same step that also
 *    records a corner at that same point (both `left` and `right` of the
 *    final pseudo-gate are the goal, by construction).
 * 2. A "bend" that is not a genuine corner: three consecutive points that are
 *    exactly collinear, with the middle one strictly between its neighbours.
 *    Such a point is on the direct line already, so keeping it would violate
 *    "a bend only where the path genuinely turns around a corner of the
 *    corridor" without changing the path's shape or length at all.
 *
 * Both checks use exact equality/collinearity (no epsilon), consistent with
 * the exactness rationale documented on `pointsEqual` above.
 */
const collapseRedundantPoints = (rawPath: ReadonlyArray<FunnelPoint>): Array<FunnelPoint> => {
  const result: Array<FunnelPoint> = [];
  for (const point of rawPath) {
    const previous = result[result.length - 1];
    if (previous && pointsEqual(previous, point)) continue;
    while (result.length >= 2) {
      const first = result[result.length - 2];
      const middle = result[result.length - 1];
      if (orientation(first, middle, point) !== 0) break;
      const span = subtract(point, first);
      const spanLengthSquared = span.x * span.x + span.y * span.y;
      if (spanLengthSquared === 0) break;
      const toMiddle = subtract(middle, first);
      const t = (toMiddle.x * span.x + toMiddle.y * span.y) / spanLengthSquared;
      // t in (0, 1) means `middle` lies strictly between `first` and `point`;
      // outside that range it is not a redundant waypoint (for example it
      // could be a legitimate back-and-forth pin through a degenerate gate).
      if (t <= 0 || t >= 1) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
};

/**
 * Compute the exact shortest polyline from `start` to `goal` that stays
 * inside the corridor described by `gates`, taken in order.
 *
 * This is the "simple stupid funnel algorithm": scan the gates left to right
 * while maintaining a funnel (`portalLeft`/`portalRight`) anchored at a fixed
 * `apex`. Each new gate either narrows one side of the funnel (the path can
 * still go straight from the current apex) or is found to lie beyond the
 * *other* side of the funnel, which proves the straight line from the apex
 * would leave the corridor — in that case the funnel has been pushed past its
 * far side, the near side's endpoint is recorded as a genuine bend, and
 * becomes the new apex.
 *
 * Restart correctness: after recording a new apex, scanning resumes from the
 * gate right after the new apex's own gate index — not from wherever the
 * scan currently was. This is the detail a careless port of this algorithm
 * gets wrong: continuing forward from the current position instead of
 * rewinding to just after the new apex silently skips re-testing the gates
 * between the old and new apex against the new vantage point, which is
 * exactly how a real corridor corner gets dropped from the output. The test
 * suite includes a scenario built specifically to fail under that mistake.
 */
export const funnelPath = (
  start: FunnelPoint,
  goal: FunnelPoint,
  gates: ReadonlyArray<FunnelGate>
): Array<FunnelPoint> => {
  const startPoint = assertFinitePoint(start, "funnelPath start point");
  const goalPoint = assertFinitePoint(goal, "funnelPath goal point");
  if (gates.length > MAX_GATES) {
    throw new Error(`funnelPath supports at most ${MAX_GATES} gates, received ${gates.length}`);
  }
  const validatedGates = gates.map((gate, index) => ({
    left: assertFinitePoint(gate.left, `funnelPath gate ${index} left point`),
    right: assertFinitePoint(gate.right, `funnelPath gate ${index} right point`)
  }));

  // Orientation consistency check (requirement: refuse a gate list whose
  // orientation is inconsistent). Two consecutive gates are inconsistent
  // exactly when their left-to-left and right-to-right connecting edges
  // properly cross: that "bowtie" shape can only happen if the two gates
  // disagree about which side is which, since a corridor's left wall and
  // right wall are each, on their own, a simple (non-self-crossing) chain.
  // Gates that merely share an endpoint (a corridor pinching to a point) are
  // explicitly not flagged, matching `segmentsProperlyCross`'s definition.
  for (let index = 0; index < validatedGates.length - 1; index += 1) {
    const current = validatedGates[index];
    const next = validatedGates[index + 1];
    if (segmentsProperlyCross(current.left, next.left, current.right, next.right)) {
      throw new Error(
        `funnelPath gates ${index} and ${index + 1} have inconsistent left/right orientation `
        + "(their left-side and right-side edges cross one another). Use orientGates to derive "
        + "a consistent left/right assignment from raw triangle edges."
      );
    }
  }

  // Start equals goal: the shortest path between a point and itself is that
  // point, full stop — no gate can make a shorter or more valid answer than
  // zero length, and the two-point encoding of "no movement" used everywhere
  // else in this module (start, goal) would otherwise report a single
  // repeated point, which the documented output invariant forbids. Collapsing
  // to a single point here is therefore not an approximation, it is what
  // "shortest path" already means when the two endpoints coincide.
  if (pointsEqual(startPoint, goalPoint)) return [startPoint];

  // No gates: nothing constrains the path, so the shortest path is the direct
  // segment. This is also exactly what the funnel scan below would compute
  // for an empty gate list, but stating it directly avoids running the scan
  // machinery for a case that has only one possible answer.
  if (validatedGates.length === 0) return [startPoint, goalPoint];

  // The funnel scan treats `start` and `goal` as degenerate zero-width gates
  // bracketing the real ones, which lets the same left/right update logic
  // handle the first and last step without special-casing them.
  const portals: Array<FunnelGate> = [
    { left: startPoint, right: startPoint },
    ...validatedGates,
    { left: goalPoint, right: goalPoint }
  ];

  const path: Array<FunnelPoint> = [startPoint];
  let apex = startPoint;
  let apexIndex = 0;
  let portalLeft = startPoint;
  let portalRight = startPoint;
  let leftIndex = 0;
  let rightIndex = 0;

  let index = 1;
  while (index < portals.length) {
    const gate = portals[index];

    // --- Right boundary update ---
    // orientation(apex, portalRight, gate.right) >= 0 means the new right
    // candidate has not swung further right than the current right boundary
    // (it is at or to the left of the ray apex->portalRight), so it is a
    // candidate to tighten the funnel rather than something the funnel can
    // safely ignore.
    if (orientation(apex, portalRight, gate.right) >= 0) {
      if (pointsEqual(apex, portalRight) || orientation(apex, portalLeft, gate.right) < 0) {
        // Either the right boundary has not been established yet (it still
        // equals the apex, as it does right after a restart), or the new
        // point is still to the right of the left boundary, so it narrows
        // the funnel without inverting it: tighten.
        portalRight = gate.right;
        rightIndex = index;
      } else {
        // The new right candidate has swung past the left boundary: going
        // straight from the apex can no longer reach it without leaving the
        // corridor. The left boundary is therefore a genuine corner the taut
        // string must bend around; record it and restart the funnel there.
        path.push(portalLeft);
        apex = portalLeft;
        apexIndex = leftIndex;
        portalLeft = apex;
        portalRight = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        // Resume scanning right after the new apex's own gate, not from
        // wherever this iteration was — see the restart-correctness note on
        // this function's doc comment for why that distinction matters.
        index = apexIndex + 1;
        continue;
      }
    }

    // --- Left boundary update --- (mirror image of the right boundary update)
    if (orientation(apex, portalLeft, gate.left) <= 0) {
      if (pointsEqual(apex, portalLeft) || orientation(apex, portalRight, gate.left) > 0) {
        portalLeft = gate.left;
        leftIndex = index;
      } else {
        path.push(portalRight);
        apex = portalRight;
        apexIndex = rightIndex;
        portalLeft = apex;
        portalRight = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        index = apexIndex + 1;
        continue;
      }
    }

    index += 1;
  }

  path.push(goalPoint);
  return collapseRedundantPoints(path);
};
