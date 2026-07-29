/**
 * Correctness, determinism and performance proofs for the standalone
 * constrained Delaunay triangulator.
 *
 * The module under test (`polygonTriangulation.ts`) is not wired into any
 * game yet — a later task does that — so these tests exercise it purely
 * against its own documented contract: it tiles the input polygon exactly,
 * never cuts through a declared ring edge, resolves every tie the same way
 * twice in a row, and stays fast on the largest real polygon the road
 * planner has measured (511 vertices; see `regionRoadPlanner.ts`).
 *
 * Two small helpers are duplicated here rather than imported from the
 * module under test: `shoelaceArea` (twice the signed polygon area) and
 * `pointInsideWithHoles` (a plain ray-casting membership test). Using an
 * independent implementation for the "does the output cover the right
 * area / stay inside the right region" checks is deliberate — it proves the
 * triangulator's output against a second, unrelated calculation of the same
 * geometric fact, not against its own internal logic.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  triangulatePolygon,
  type TriangulatedPolygon,
  type TriangulationPoint,
  type TriangulationTriangle
} from "../src/modules/runtime/polygonTriangulation.ts";

const AREA_TOLERANCE = 1e-6;

/** Twice the signed area of a ring, via the shoelace formula (independent of the module under test). */
const shoelaceDoubleArea = (ring: ReadonlyArray<TriangulationPoint>): number => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return sum + point.x * next.y - point.y * next.x;
}, 0);

/** Twice the signed area of one output triangle. */
const triangleDoubleArea = (
  vertices: ReadonlyArray<TriangulationPoint>, triangle: TriangulationTriangle
): number => {
  const a = vertices[triangle.a];
  const b = vertices[triangle.b];
  const c = vertices[triangle.c];
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
};

/** Sum of all triangle areas (unsigned), independent of the module's own bookkeeping. */
const totalTriangleArea = (result: TriangulatedPolygon): number =>
  result.triangles.reduce((sum, triangle) => sum + Math.abs(triangleDoubleArea(result.vertices, triangle)) / 2, 0);

/** Plain ray-casting point-in-ring test (boundary counts as inside), independent of the module under test. */
const pointInRing = (point: TriangulationPoint, ring: ReadonlyArray<TriangulationPoint>): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const before = ring[previous];
    const onEdge = Math.min(current.x, before.x) - 1e-9 <= point.x && point.x <= Math.max(current.x, before.x) + 1e-9 &&
      Math.min(current.y, before.y) - 1e-9 <= point.y && point.y <= Math.max(current.y, before.y) + 1e-9 &&
      Math.abs((current.x - before.x) * (point.y - before.y) - (current.y - before.y) * (point.x - before.x)) <= 1e-6;
    if (onEdge) return true;
    const crosses = (current.y > point.y) !== (before.y > point.y) &&
      point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

/** Whether `point` lies inside the polygon described by `outer` minus each of `holes`. */
const pointInsideWithHoles = (
  point: TriangulationPoint, outer: ReadonlyArray<TriangulationPoint>, holes: ReadonlyArray<Array<TriangulationPoint>>
): boolean => pointInRing(point, outer) && holes.every((hole) => !strictlyInsideHole(point, hole));

const strictlyInsideHole = (point: TriangulationPoint, hole: ReadonlyArray<TriangulationPoint>): boolean => {
  if (!pointInRing(point, hole)) return false;
  // Reject points that only "count as inside" because they sit on the hole
  // boundary; a triangle centroid exactly on a hole edge is not a violation.
  for (let index = 0; index < hole.length; index += 1) {
    const a = hole[index];
    const b = hole[(index + 1) % hole.length];
    const onEdge = Math.min(a.x, b.x) - 1e-9 <= point.x && point.x <= Math.max(a.x, b.x) + 1e-9 &&
      Math.min(a.y, b.y) - 1e-9 <= point.y && point.y <= Math.max(a.y, b.y) + 1e-9 &&
      Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) <= 1e-6;
    if (onEdge) return false;
  }
  return true;
};

/** Every triangle's centroid must land inside the polygon (outer minus holes). */
const assertTrianglesInsidePolygon = (
  result: TriangulatedPolygon, outer: ReadonlyArray<TriangulationPoint>, holes: ReadonlyArray<Array<TriangulationPoint>>
): void => {
  for (const triangle of result.triangles) {
    const a = result.vertices[triangle.a];
    const b = result.vertices[triangle.b];
    const c = result.vertices[triangle.c];
    const centroid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    assert.ok(
      pointInsideWithHoles(centroid, outer, holes),
      `triangle centroid (${centroid.x}, ${centroid.y}) is outside the polygon`
    );
  }
};

/** Every triangle must wind counter-clockwise, per the documented output contract. */
const assertAllTrianglesCcw = (result: TriangulatedPolygon): void => {
  for (const triangle of result.triangles) {
    assert.ok(
      triangleDoubleArea(result.vertices, triangle) > 0,
      `triangle (${triangle.a}, ${triangle.b}, ${triangle.c}) is not wound counter-clockwise`
    );
  }
};

/**
 * No output triangle may have zero (or numerically-negligible) area. A
 * zero-area triangle is a degenerate "sliver" -- geometrically a line, not a
 * triangle -- and downstream consumers (for example a navigation-mesh path
 * search) treat a shared triangle edge as a walkable "gate" between two
 * regions of the mesh; a zero-area triangle silently turns that gate into a
 * zero-width pinch point.
 */
const assertNoZeroAreaTriangles = (result: TriangulatedPolygon): void => {
  for (const triangle of result.triangles) {
    const area = Math.abs(triangleDoubleArea(result.vertices, triangle)) / 2;
    assert.ok(
      area > 1e-9,
      `triangle (${triangle.a}, ${triangle.b}, ${triangle.c}) has zero (or near-zero) area: ${area}`
    );
  }
};

/**
 * Every vertex of the input ring(s) must appear in at least one output
 * triangle. A vertex that never appears in any triangle has effectively been
 * dropped from the mesh -- for example by the ear-clipping loop clipping
 * straight past it without ever using it as a triangle corner.
 */
const assertAllVerticesUsed = (result: TriangulatedPolygon): void => {
  const used = new Set<number>();
  for (const triangle of result.triangles) {
    used.add(triangle.a);
    used.add(triangle.b);
    used.add(triangle.c);
  }
  for (let index = 0; index < result.vertices.length; index += 1) {
    assert.ok(used.has(index), `vertex ${index} (${JSON.stringify(result.vertices[index])}) is not used by any triangle`);
  }
};

/** Collect every undirected edge that appears in some output triangle. */
const collectTriangleEdges = (triangles: ReadonlyArray<TriangulationTriangle>): Set<string> => {
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  const edges = new Set<string>();
  for (const triangle of triangles) {
    edges.add(key(triangle.a, triangle.b));
    edges.add(key(triangle.b, triangle.c));
    edges.add(key(triangle.c, triangle.a));
  }
  return edges;
};

/** Assert that every edge of `ring` (using global indices starting at `offset`) is an edge of some triangle. */
const assertRingEdgesPreserved = (
  edges: ReadonlySet<string>, ring: ReadonlyArray<TriangulationPoint>, offset: number
): void => {
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (let index = 0; index < ring.length; index += 1) {
    const u = offset + index;
    const v = offset + ((index + 1) % ring.length);
    assert.ok(edges.has(key(u, v)), `ring edge (${u}, ${v}) was not preserved as a triangle edge`);
  }
};

const unitSquare: Array<TriangulationPoint> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
];

test("unit square: two CCW triangles covering exactly the square's area", () => {
  const result = triangulatePolygon(unitSquare);
  assert.equal(result.vertices.length, 4);
  assert.equal(result.triangles.length, 2);
  assertAllTrianglesCcw(result);
  assert.ok(Math.abs(totalTriangleArea(result) - 1) <= AREA_TOLERANCE);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), unitSquare, 0);
  assertTrianglesInsidePolygon(result, unitSquare, []);
});

test("non-convex L shape: area coverage and edge preservation hold at the reflex corner", () => {
  // An L made from a 10x10 square with a 5x5 notch removed from its
  // top-right corner; the notch introduces one reflex (concave) vertex,
  // which is what an ordinary square never exercises.
  const lShape: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 }
  ];
  const result = triangulatePolygon(lShape);
  assert.equal(result.triangles.length, lShape.length - 2);
  assertAllTrianglesCcw(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(lShape)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= AREA_TOLERANCE);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), lShape, 0);
  assertTrianglesInsidePolygon(result, lShape, []);
});

test("square with a square hole: area coverage excludes the hole and both rings survive intact", () => {
  const outer: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const hole: Array<TriangulationPoint> = [
    { x: 3, y: 3 },
    { x: 3, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 3 }
  ];
  const result = triangulatePolygon(outer, [hole]);
  assert.equal(result.vertices.length, outer.length + hole.length);
  assertAllTrianglesCcw(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(outer)) / 2 - Math.abs(shoelaceDoubleArea(hole)) / 2;
  assert.ok(
    Math.abs(totalTriangleArea(result) - expectedArea) <= AREA_TOLERANCE,
    `expected area ${expectedArea}, got ${totalTriangleArea(result)}`
  );
  const edges = collectTriangleEdges(result.triangles);
  assertRingEdgesPreserved(edges, outer, 0);
  assertRingEdgesPreserved(edges, hole, outer.length);
  assertTrianglesInsidePolygon(result, outer, [hole]);
});

test("511-vertex convex polygon (approximated circle): correct area and measured timing", () => {
  const n = 511;
  const radius = 1000;
  const circle: Array<TriangulationPoint> = Array.from({ length: n }, (_, index) => {
    const angle = (2 * Math.PI * index) / n;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const startedAt = Date.now();
  const result = triangulatePolygon(circle);
  const elapsedMs = Date.now() - startedAt;
  // A convex polygon has no reflex or flat vertices at all, so this case
  // alone was never a good proxy for real map regions -- see the
  // "non-convex star" test below and the performance comments on
  // `lawsonFlip` / `earClip` for the real (non-convex) numbers this module
  // is actually held to. The assertion below is deliberately generous — 1
  // second, as originally specified — so it never flakes on a slower CI
  // machine; in practice this convex case now runs in low single-digit
  // milliseconds.
  assert.ok(elapsedMs < 1000, `triangulating a 511-gon took ${elapsedMs}ms, expected well under 1000ms`);
  assert.equal(result.triangles.length, n - 2);
  assertAllTrianglesCcw(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(circle)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= expectedArea * 1e-6);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), circle, 0);
});

test("collinear vertices along one side do not block triangulation or leave a degenerate gap", () => {
  // A 10x10 square with an extra vertex exactly halfway along its bottom
  // edge; that vertex's interior angle is exactly 180 degrees.
  const withCollinearPoint: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const result = triangulatePolygon(withCollinearPoint);
  assert.equal(result.triangles.length, withCollinearPoint.length - 2);
  assertAllTrianglesCcw(result);
  assertNoZeroAreaTriangles(result);
  assertAllVerticesUsed(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(withCollinearPoint)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= AREA_TOLERANCE);
  // Both sub-edges of the split bottom side must individually survive —
  // the algorithm must not merge or skip the collinear vertex.
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), withCollinearPoint, 0);
});

test("collinear boundary run (regression): a rectangle with two extra collinear top vertices " +
  "must not produce zero-area triangles or drop vertices", () => {
  // Reproduction of a real integration bug: a rectangle whose top side
  // carries two extra vertices exactly on the same straight line. A prior
  // version of `earClip` only treated *reflex* vertices as capable of
  // blocking an unrelated candidate ear, reasoning that a convex vertex can
  // never sit on another ear's diagonal -- true for strictly convex
  // vertices, but false for these two *flat* (collinear) ones. That let the
  // greedy "lowest global index first" rule clip both bottom corners before
  // touching the top, stranding the four remaining vertices as one
  // perfectly collinear run with nothing left to close it but a zero-area
  // "ear". See `earClip`'s doc comment for the general fix (flat vertices
  // block too, of any run length, not just this specific 2-point case).
  const hexagon: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 10 },
    { x: 30, y: 10 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const result = triangulatePolygon(hexagon);
  assert.equal(result.triangles.length, hexagon.length - 2);
  assertAllTrianglesCcw(result);
  assertNoZeroAreaTriangles(result);
  assertAllVerticesUsed(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(hexagon)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= AREA_TOLERANCE);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), hexagon, 0);
});

test("collinear boundary run (general case): 50 extra collinear vertices along one side, " +
  "not just 3, still triangulate cleanly", () => {
  // Same bug class as the hexagon regression above, but with a much longer
  // collinear run -- the task this fix responds to explicitly warns that
  // real conformed contours in production carry runs far longer than two or
  // three points, so the fix must be general (every flat vertex blocks,
  // regardless of how many appear in a row), not special-cased to a small
  // fixed count. A rectangle's top side, from (0, 10) to (100, 10), gets 50
  // extra vertices evenly spaced along it.
  const extraPointCount = 50;
  const top: Array<TriangulationPoint> = Array.from({ length: extraPointCount }, (_, index) => ({
    x: 100 - (100 * (index + 1)) / (extraPointCount + 1),
    y: 10
  }));
  const rectangleWithLongCollinearRun: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 10 },
    ...top,
    { x: 0, y: 10 }
  ];
  const result = triangulatePolygon(rectangleWithLongCollinearRun);
  assert.equal(result.triangles.length, rectangleWithLongCollinearRun.length - 2);
  assertAllTrianglesCcw(result);
  assertNoZeroAreaTriangles(result);
  assertAllVerticesUsed(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(rectangleWithLongCollinearRun)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= expectedArea * 1e-6);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), rectangleWithLongCollinearRun, 0);
});

test("non-convex star (300+ vertices): correct area and measured timing on a realistically " +
  "non-convex shape, not just a convex approximated circle", () => {
  // The 511-vertex "approximated circle" test above is convex and has no
  // reflex vertices at all, so it barely exercises the ear-clipping
  // containment check or the Lawson-flip pass -- both of which do real work
  // only when reflex (or flat) vertices exist. Real author-map regions are
  // strongly non-convex. This is a 150-point star (300 vertices total,
  // alternating an outer "spike" radius and an inner "valley" radius), which
  // has 150 genuinely reflex vertices -- one at every valley.
  const spikeCount = 150;
  const outerRadius = 1000;
  const innerRadius = 400;
  const star: Array<TriangulationPoint> = Array.from({ length: spikeCount * 2 }, (_, index) => {
    const angle = (Math.PI * index) / spikeCount;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const startedAt = Date.now();
  const result = triangulatePolygon(star);
  const elapsedMs = Date.now() - startedAt;
  // Measured on the development machine after the performance rewrite: well
  // under 50ms for this 300-vertex, heavily non-convex shape (see the
  // performance comments on `lawsonFlip` / `earClip` for the real-world
  // numbers this module is held to: worst measured region, 511 vertices,
  // under 100ms). The assertion here is deliberately generous to avoid
  // flaking on a slower CI machine while still catching a regression back
  // toward the previous multi-second behaviour.
  assert.ok(elapsedMs < 500, `triangulating a 300-vertex star took ${elapsedMs}ms, expected well under 500ms`);
  assert.equal(result.triangles.length, star.length - 2);
  assertAllTrianglesCcw(result);
  assertNoZeroAreaTriangles(result);
  assertAllVerticesUsed(result);
  const expectedArea = Math.abs(shoelaceDoubleArea(star)) / 2;
  assert.ok(Math.abs(totalTriangleArea(result) - expectedArea) <= expectedArea * 1e-6);
  assertRingEdgesPreserved(collectTriangleEdges(result.triangles), star, 0);
});

test("determinism: triangulating the same input twice yields identical output", () => {
  const outer: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 }
  ];
  const hole: Array<TriangulationPoint> = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 1 }
  ];
  const first = triangulatePolygon(outer, [hole]);
  const second = triangulatePolygon(outer, [hole]);
  assert.deepEqual(first, second);
});

test("refuses a ring with fewer than 3 vertices", () => {
  assert.throws(
    () => triangulatePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
    /at least 3 vertices/
  );
});

test("refuses a ring with a repeated vertex", () => {
  assert.throws(
    () => triangulatePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]),
    /repeated vertex/
  );
});

test("refuses a self-intersecting ring", () => {
  // A bowtie: going 0 -> 1 -> 2 -> 3 crosses itself between edges (0,1) and (2,3).
  const bowtie: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 }
  ];
  assert.throws(() => triangulatePolygon(bowtie), /self-intersecting/);
});

test("refuses a zero-area ring", () => {
  const collinear: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 }
  ];
  assert.throws(() => triangulatePolygon(collinear), /zero area/);
});

test("refuses a hole that is not strictly inside the outer ring", () => {
  const outer: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  // This hole straddles the outer ring's right edge instead of sitting inside it.
  const escapingHole: Array<TriangulationPoint> = [
    { x: 8, y: 3 },
    { x: 8, y: 7 },
    { x: 12, y: 7 },
    { x: 12, y: 3 }
  ];
  assert.throws(() => triangulatePolygon(outer, [escapingHole]), /not strictly inside/);
});

test("refuses two holes that overlap", () => {
  const outer: Array<TriangulationPoint> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const holeA: Array<TriangulationPoint> = [
    { x: 1, y: 1 },
    { x: 1, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 1 }
  ];
  const holeB: Array<TriangulationPoint> = [
    { x: 4, y: 4 },
    { x: 4, y: 8 },
    { x: 8, y: 8 },
    { x: 8, y: 4 }
  ];
  assert.throws(() => triangulatePolygon(outer, [holeA, holeB]), /overlap/);
});
