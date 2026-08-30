/** Focused tests for distance-based visual sampling of confirmed road paths. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  movementDurationMs,
  pointAtPolylineProgress,
  polylineLength,
  polylinePrefixAtProgress
} from "./motion-path.ts";

test("samples progress by travelled distance across unequal segments", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }];

  assert.equal(polylineLength(points), 40);
  assert.deepEqual(pointAtPolylineProgress(points, 0.5), { x: 10, y: 10 });
  assert.deepEqual(pointAtPolylineProgress(points, -1), { x: 0, y: 0 });
  assert.deepEqual(pointAtPolylineProgress(points, 2), { x: 10, y: 30 });
});

test("handles empty and repeated-point paths without invalid coordinates", () => {
  assert.equal(pointAtPolylineProgress([], 0.5), null);
  assert.deepEqual(
    pointAtPolylineProgress([{ x: 2, y: 3 }, { x: 2, y: 3 }], 0.5),
    { x: 2, y: 3 }
  );
});

test("bounds movement duration for short and long routes", () => {
  assert.equal(movementDurationMs([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 300);
  assert.equal(movementDurationMs([{ x: 0, y: 0 }, { x: 10_000, y: 0 }]), 900);
});

test("returns a distance-based prefix for construction tracing", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }];

  assert.deepEqual(polylinePrefixAtProgress(points, 0), [{ x: 0, y: 0 }]);
  assert.deepEqual(
    polylinePrefixAtProgress(points, 0.5),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
  );
  assert.deepEqual(polylinePrefixAtProgress(points, 1), points);
});
