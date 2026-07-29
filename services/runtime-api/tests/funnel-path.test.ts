/**
 * Correctness and determinism tests for the funnel ("string pulling") shortest
 * path extractor used by road planning.
 *
 * Each geometric fixture below is built so that its expected answer can be
 * checked two independent ways: once by looking at the shape of the corridor
 * (which point is the one genuine inner corner the path must bend around) and
 * once by hand-computing the total path length from the Pythagorean distances
 * between those corner coordinates. Where a test only needs to check that the
 * bend happened at the right point, the exact coordinates are asserted with
 * `assert.deepEqual`; the L-shaped-corridor test additionally cross-checks the
 * total length against a value computed by hand from the corner it names, so
 * the test is pinned to the actual geometry rather than only to the shape
 * (point count) of the answer.
 *
 * The "funnel restart" fixture further down was not designed by hand: it was
 * found by comparing this module's rescanning restart (which resumes the scan
 * right after the *new* apex) against a deliberately mistaken variant that
 * resumes right after wherever the scan currently was. That mistaken variant
 * is the textbook failure mode for this algorithm — it silently cuts a corner
 * and produces a shorter-looking but invalid path that leaves the corridor.
 * The fixture is the smallest case found where the two disagree, so it
 * exercises exactly the bug this module's doc comment warns about.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { funnelPath, orientGates, type FunnelPoint } from "../src/modules/runtime/funnelPath.ts";

/** Straight-line distance, used only by tests to hand-check total path length. */
const distance = (a: FunnelPoint, b: FunnelPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Sum of segment lengths along a polyline, used only by tests. */
const pathLength = (path: ReadonlyArray<FunnelPoint>): number =>
  path.slice(0, -1).reduce((sum, point, index) => sum + distance(point, path[index + 1]), 0);

test("an empty gate list returns the direct start-to-goal segment", () => {
  const result = funnelPath({ x: 0, y: 0 }, { x: 5, y: 5 }, []);
  assert.deepEqual(result, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
});

test("a straight corridor returns exactly two points: start and goal", () => {
  // The gate is wide and centred on the direct line, so it constrains
  // nothing: the shortest path is the direct segment with no bend recorded.
  const result = funnelPath(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    [{ left: { x: 5, y: 2 }, right: { x: 5, y: -2 } }]
  );
  assert.deepEqual(result, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
});

test("an L-shaped corridor bends exactly once, at the inner corner, exactly", () => {
  // Two rooms forming an L: a full-width bottom strip (0<=x<=10, 0<=y<=4) and
  // an upper-right strip (4<=x<=10, 4<=y<=10), sharing the boundary segment
  // from (4,4) to (10,4). (4,4) is the reflex ("inner") corner of the L: the
  // direct line from start to goal passes to the left of it (outside both
  // rooms), so the shortest path must hug that corner exactly.
  const innerCorner = { x: 4, y: 4 };
  const start = { x: 1, y: 2 };
  const goal = { x: 9, y: 9 };
  const result = funnelPath(start, goal, [{ left: innerCorner, right: { x: 10, y: 4 } }]);

  assert.deepEqual(result, [start, innerCorner, goal]);

  // Hand-computed check: the two legs are exact 3-4-5-style right triangles.
  // start -> corner: dx=3, dy=2 -> length sqrt(13).
  // corner -> goal:  dx=5, dy=5 -> length sqrt(50).
  const handComputedLength = Math.sqrt(13) + Math.sqrt(50);
  assert.ok(
    Math.abs(pathLength(result) - handComputedLength) < 1e-12,
    `expected length ${handComputedLength}, got ${pathLength(result)}`
  );
});

test("a zig-zag corridor forces two bends, one to each side", () => {
  // Two narrow gates, one offset up and one offset down, so the shortest
  // path must weave: up to (4,1), then down to (8,-1), then to the goal.
  const start = { x: 0, y: 0 };
  const goal = { x: 12, y: 0 };
  const result = funnelPath(start, goal, [
    { left: { x: 4, y: 2 }, right: { x: 4, y: 1 } },
    { left: { x: 8, y: -1 }, right: { x: 8, y: -2 } }
  ]);
  assert.deepEqual(result, [start, { x: 4, y: 1 }, { x: 8, y: -1 }, goal]);
});

test("funnel restart does not drop the corner a naive resume would cut", () => {
  // This fixture was found by searching for a gate sequence where resuming
  // the scan from "current index + 1" after a restart (the classic mistake)
  // disagrees with resuming from "new apex index + 1" (what this module
  // does). The naive variant produces [start, (4.25,-0.5), goal] — a path
  // that looks shorter but actually exits the corridor between x=8.5 and
  // x=17, because it never re-tests the third gate against the new apex.
  const start = { x: 0, y: 0 };
  const goal = { x: 17, y: -3 };
  const gates = [
    { left: { x: 4.25, y: -0.5 }, right: { x: 4.25, y: -5 } },
    { left: { x: 8.5, y: 3 }, right: { x: 8.5, y: -3 } },
    { left: { x: 12.75, y: 0.5 }, right: { x: 12.75, y: -1 } }
  ];
  const result = funnelPath(start, goal, gates);
  const firstBend = { x: 4.25, y: -0.5 };
  const secondBend = { x: 12.75, y: -1 };
  assert.deepEqual(result, [start, firstBend, secondBend, goal]);

  const handComputedLength = distance(start, firstBend) + distance(firstBend, secondBend) +
    distance(secondBend, goal);
  assert.ok(
    Math.abs(pathLength(result) - handComputedLength) < 1e-9,
    `expected length ${handComputedLength}, got ${pathLength(result)}`
  );
  // The naive (buggy) resume rule computes a strictly shorter length here
  // (~17.272) precisely because it cuts outside the corridor; the correct
  // answer is strictly longer than that invalid shortcut.
  assert.ok(pathLength(result) > 17.28, "the corner-dropping shortcut must not win");
});

test("a degenerate zero-length gate pins the path through that single point", () => {
  const pinnedPoint = { x: 5, y: 3 };
  const start = { x: 0, y: 0 };
  const goal = { x: 10, y: 0 };
  const result = funnelPath(start, goal, [{ left: pinnedPoint, right: pinnedPoint }]);
  assert.deepEqual(result, [start, pinnedPoint, goal]);
});

test("gates that repeat the same endpoints do not confuse the scan", () => {
  const start = { x: 0, y: 0 };
  const goal = { x: 12, y: 0 };
  const repeatedGate = { left: { x: 4, y: 2 }, right: { x: 4, y: -2 } };
  const result = funnelPath(start, goal, [repeatedGate, repeatedGate, { left: { x: 8, y: 2 }, right: { x: 8, y: -2 } }]);
  // All three gates are wide and centred on the direct line, so nothing
  // constrains the path regardless of the repeat.
  assert.deepEqual(result, [start, goal]);
});

test("start equal to goal collapses to a single point, even with gates present", () => {
  const point = { x: 3, y: 3 };
  const result = funnelPath(point, point, [{ left: { x: 1, y: 1 }, right: { x: 1, y: -1 } }]);
  assert.deepEqual(result, [point]);
});

test("identical input produces an identical result (determinism)", () => {
  const start = { x: 0, y: 0 };
  const goal = { x: 12, y: 0 };
  const gates = [
    { left: { x: 4, y: 2 }, right: { x: 4, y: 1 } },
    { left: { x: 8, y: -1 }, right: { x: 8, y: -2 } }
  ];
  const first = funnelPath(start, goal, gates);
  const second = funnelPath(start, goal, gates);
  assert.deepEqual(first, second);
});

test("a non-finite start coordinate is refused with a clear error", () => {
  assert.throws(
    () => funnelPath({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, []),
    /finite coordinates/
  );
});

test("a non-finite goal coordinate is refused with a clear error", () => {
  assert.throws(
    () => funnelPath({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }, []),
    /finite coordinates/
  );
});

test("a non-finite gate coordinate is refused with a clear error", () => {
  assert.throws(
    () => funnelPath({ x: 0, y: 0 }, { x: 1, y: 1 }, [
      { left: { x: Number.NaN, y: 0 }, right: { x: 1, y: -1 } }
    ]),
    /gate 0 left point must contain finite coordinates/
  );
});

test("a gate list with inconsistent left/right orientation is refused", () => {
  // The second gate's left/right are swapped relative to the first: their
  // left-to-left and right-to-right connecting edges cross, forming a bowtie
  // that no single consistent direction of travel could have produced.
  assert.throws(
    () => funnelPath({ x: 0, y: 0 }, { x: 10, y: 0 }, [
      { left: { x: 4, y: 2 }, right: { x: 4, y: -2 } },
      { left: { x: 8, y: -2 }, right: { x: 8, y: 2 } }
    ]),
    /inconsistent left\/right orientation/
  );
});

test("a gate list exceeding the bounded cap is refused with a clear error", () => {
  const gates = Array.from({ length: 100_001 }, (_, index) => ({
    left: { x: index, y: 1 },
    right: { x: index, y: -1 }
  }));
  assert.throws(
    () => funnelPath({ x: 0, y: 0 }, { x: 100_001, y: 0 }, gates),
    /at most 100000 gates/
  );
});

test("orientGates assigns left/right consistently with the direction of travel", () => {
  // Direction of travel is +x (start at the origin, gate straight ahead).
  // "Left" of facing +x, in this module's convention, is +y.
  const oriented = orientGates({ x: 0, y: 0 }, [{ a: { x: 5, y: -1 }, b: { x: 5, y: 1 } }]);
  assert.deepEqual(oriented, [{ left: { x: 5, y: 1 }, right: { x: 5, y: -1 } }]);
});

test("orientGates breaks an exact collinear tie by lexicographic point order", () => {
  // The gate's midpoint coincides with start, so there is no trial direction
  // to decide handedness; the documented fallback picks the lexicographically
  // smaller endpoint (by x, then y) as left, independent of argument order.
  const oriented = orientGates({ x: 5, y: 0 }, [{ a: { x: 6, y: 0 }, b: { x: 4, y: 0 } }]);
  assert.deepEqual(oriented, [{ left: { x: 4, y: 0 }, right: { x: 6, y: 0 } }]);

  const swappedArgumentOrder = orientGates({ x: 5, y: 0 }, [{ a: { x: 4, y: 0 }, b: { x: 6, y: 0 } }]);
  assert.deepEqual(swappedArgumentOrder, oriented);
});

test("funnelPath accepts orientGates' output directly for a bent corridor", () => {
  // Integration check: raw, arbitrarily-ordered triangle edges go into
  // orientGates, and its output is valid input to funnelPath end to end.
  const start = { x: 1, y: 2 };
  const goal = { x: 9, y: 9 };
  const rawGate = { a: { x: 10, y: 4 }, b: { x: 4, y: 4 } }; // arbitrary order
  const gates = orientGates(start, [rawGate]);
  const result = funnelPath(start, goal, gates);
  assert.deepEqual(result, [start, { x: 4, y: 4 }, goal]);
});
