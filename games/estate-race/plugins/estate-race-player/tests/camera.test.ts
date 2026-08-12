/** Focused camera geometry checks without Phaser, a browser or gameplay state. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  clampEstateRaceCameraView,
  clampEstateRaceZoom,
  estateRaceOverviewCameraView,
  fitEstateRaceOverviewZoom
} from "../src/scene.ts";

test("fits the unchanged desktop world exactly and resets to its origin", () => {
  const viewport = { width: 1400, height: 1000 };

  assert.equal(fitEstateRaceOverviewZoom(viewport), 1);
  assert.deepEqual(estateRaceOverviewCameraView(viewport), {
    scrollX: 0,
    scrollY: 0,
    zoom: 1
  });
});

test("centres the complete 1400 by 1000 board in a 320 by 800 viewport", () => {
  const viewport = { width: 320, height: 800 };
  const overview = estateRaceOverviewCameraView(viewport);

  assert.equal(overview.zoom, 8 / 35);
  assert.equal(overview.scrollX, 540);
  assert.equal(overview.scrollY, 100);

  // Phaser zooms around the viewport centre. These derived edges prove the
  // complete world is visible, with equal spare space above and below it.
  const visibleWidth = viewport.width / overview.zoom;
  const visibleHeight = viewport.height / overview.zoom;
  const midpointX = overview.scrollX + viewport.width / 2;
  const midpointY = overview.scrollY + viewport.height / 2;
  assert.equal(midpointX - visibleWidth / 2, 0);
  assert.equal(midpointX + visibleWidth / 2, 1400);
  assert.equal(midpointY - visibleHeight / 2, -1250);
  assert.equal(midpointY + visibleHeight / 2, 2250);
});

test("clamps zoom and scroll so controls cannot lose the board irretrievably", () => {
  const viewport = { width: 320, height: 800 };
  const overviewZoom = 8 / 35;

  assert.equal(clampEstateRaceZoom(viewport, 0), overviewZoom);
  assert.equal(clampEstateRaceZoom(viewport, Number.NaN), overviewZoom);
  assert.equal(clampEstateRaceZoom(viewport, Number.POSITIVE_INFINITY), overviewZoom);
  assert.equal(clampEstateRaceZoom(viewport, 99), 3);
  assert.deepEqual(
    clampEstateRaceCameraView({ scrollX: -99_999, scrollY: 99_999, zoom: 2 }, viewport),
    { scrollX: -80, scrollY: 400, zoom: 2 }
  );

  assert.deepEqual(
    estateRaceOverviewCameraView(viewport),
    { scrollX: 540, scrollY: 100, zoom: overviewZoom }
  );
});
