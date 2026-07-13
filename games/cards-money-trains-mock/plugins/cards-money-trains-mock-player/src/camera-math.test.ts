/** Focused camera geometry tests that do not require Phaser or a browser. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  fitCameraZoom,
  overviewCameraView,
  panCameraViewBy,
  resizeCameraView,
  zoomCameraViewAtPoint
} from "./camera-math.ts";

const world = { x: 0, y: 0, width: 1400, height: 1000 };
const viewport = { width: 1400, height: 1000 };
const limits = { min: 1, max: 3 };

test("fits the complete mock world into the initial view", () => {
  assert.equal(fitCameraZoom(viewport, world), 1);
  assert.deepEqual(overviewCameraView(viewport, world), {
    scrollX: 0,
    scrollY: 0,
    zoom: 1
  });
});

test("keeps the pointed world coordinate stable while zooming", () => {
  const pointer = { x: 350, y: 250 };
  const zoomed = zoomCameraViewAtPoint(
    overviewCameraView(viewport, world),
    pointer,
    2,
    viewport,
    world,
    limits
  );

  assert.deepEqual(zoomed, { scrollX: -175, scrollY: -125, zoom: 2 });
  assert.equal(zoomed.scrollX + 700 + (pointer.x - 700) / zoomed.zoom, pointer.x);
  assert.equal(zoomed.scrollY + 500 + (pointer.y - 500) / zoomed.zoom, pointer.y);
});

test("pans by screen distance adjusted for zoom and stops at world bounds", () => {
  const zoomed = { scrollX: 0, scrollY: 0, zoom: 2 };
  assert.deepEqual(
    panCameraViewBy(zoomed, { x: 100, y: -60 }, viewport, world),
    { scrollX: -50, scrollY: 30, zoom: 2 }
  );
  assert.deepEqual(
    panCameraViewBy(zoomed, { x: 10_000, y: 10_000 }, viewport, world),
    { scrollX: -350, scrollY: -250, zoom: 2 }
  );
});

test("preserves the viewed centre on resize", () => {
  const resized = resizeCameraView(
    { scrollX: 120, scrollY: 80, zoom: 2 },
    viewport,
    { width: 1000, height: 800 },
    world
  );
  assert.deepEqual(resized, { scrollX: 320, scrollY: 180, zoom: 2 });
});
