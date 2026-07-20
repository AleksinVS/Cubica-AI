/**
 * Neutral proof for the versioned graph geometry algorithms.
 *
 * These fixtures deliberately avoid any concrete game's roads, stations, or
 * regions. They pin the reusable contract: arc-length positions, closed
 * polygon membership, canonical fingerprints, and bounded invalid inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  GraphGeometryError,
  canonicalGraphPoint,
  canonicalizeGraphRegions,
  closedGraphRegionMembership,
  graphEdgeGeometryFingerprint,
  readEffectiveGraphPolyline,
  splitGraphPolyline
} from "../src/modules/mechanics/graphGeometry.ts";

test("straight and bent polylines resolve positions by travelled arc length", () => {
  const straight = splitGraphPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1 / 3);
  // Multiplication by the normalized IEEE-754 input can differ from `10 / 3`
  // by one representable bit; the contract promises no decimal quantization,
  // not an alternative arbitrary-precision number system.
  assert.ok(Math.abs(straight.point.x - (10 / 3)) <= Number.EPSILON * 2);
  assert.equal(Number.isFinite(straight.point.x), true);
  assert.notEqual(straight.point.x, Math.round(straight.point.x * 1_000_000) / 1_000_000);
  assert.deepEqual(straight.point.y, 0);

  const bent = splitGraphPolyline([
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 4 }
  ], 0.5);
  assert.deepEqual(bent.point, { x: 3, y: 0.5 });
  assert.deepEqual(bent.first, [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0.5 }
  ]);
  assert.deepEqual(bent.second, [
    { x: 3, y: 0.5 },
    { x: 3, y: 4 }
  ]);
});

test("explicit polygon closure is normalized and a boundary reports every touching region", () => {
  const regions = canonicalizeGraphRegions([
    {
      id: "left",
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 }
      ]
    },
    {
      id: "right",
      polygon: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 }
      ]
    }
  ]);

  assert.equal(regions[0].polygon.length, 4);
  assert.deepEqual(closedGraphRegionMembership({ x: 1, y: 0.5 }, regions), [
    "left",
    "right"
  ]);
});

test("geometry fingerprints are key-order independent and cover every mutation input", () => {
  const common = {
    networkId: "network",
    edgeId: "edge",
    fromNodeId: "from",
    toNodeId: "to",
    from: { x: 0, y: 0 },
    to: { x: 2, y: 0 },
    polyline: [{ x: 0, y: 0 }, { x: 2, y: 0 }]
  };
  const first = graphEdgeGeometryFingerprint({
    ...common,
    routePlan: { beta: [2, 3], alpha: 1 }
  });
  const reordered = graphEdgeGeometryFingerprint({
    ...common,
    routePlan: { alpha: 1, beta: [2, 3] }
  });
  const changedPlan = graphEdgeGeometryFingerprint({
    ...common,
    routePlan: { alpha: 1, beta: [2, 4] }
  });
  const changedGeometry = graphEdgeGeometryFingerprint({
    ...common,
    polyline: [{ x: 0, y: 0 }, { x: 1, y: 0.25 }, { x: 2, y: 0 }],
    routePlan: { alpha: 1, beta: [2, 3] }
  });

  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first, reordered);
  assert.notEqual(first, changedPlan);
  assert.notEqual(first, changedGeometry);
});

test("coordinates, zero-length segments, and self-intersecting polygons fail closed", () => {
  assert.throws(
    () => canonicalGraphPoint({ x: 1_000_000_001, y: 0 }, "point"),
    (error) => error instanceof GraphGeometryError &&
      error.code === "MECHANICS_GRAPH_GEOMETRY_INVALID"
  );
  assert.throws(
    () => readEffectiveGraphPolyline(
      { polyline: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
      { x: 0, y: 0 },
      { x: 0, y: 0 }
    ),
    (error) => error instanceof GraphGeometryError &&
      error.code === "MECHANICS_GRAPH_GEOMETRY_INVALID"
  );
  assert.throws(
    () => canonicalizeGraphRegions([{
      id: "crossed",
      polygon: [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 2, y: 0 }
      ]
    }]),
    (error) => error instanceof GraphGeometryError &&
      error.code === "MECHANICS_GRAPH_GEOMETRY_INVALID"
  );
});
