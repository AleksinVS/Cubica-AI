/**
 * Tests for the drawing of the author's transport network.
 *
 * The measured dimensions themselves are checked against the author's image
 * by `tools/measure-author-network-style.mjs`, and the whole redrawn network
 * is compared with that image by `tools/render-initial-network-check.mjs`.
 * What is left for a unit test is the geometry: that the shapes really have
 * the measured proportions, that the sleeper rhythm survives a bend, and that
 * empty or degenerate route data cannot produce a broken drawing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTHOR_STATION_STYLE,
  AUTHOR_TRACK_STYLE,
  printedNodeLabel,
  railwayTrackShapes,
  stationGearOutline
} from "./author-network-style.ts";

const measurement = JSON.parse(readFileSync(
  new URL("../../../annotations/initial-network.track-style.json", import.meta.url),
  "utf8"
));

/** Distance from a point to the straight line through `from` and `to`. */
const distanceToLine = (
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number }
) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x) / length;
};

test("the drawing constants repeat the values measured on the author board", () => {
  assert.equal(AUTHOR_TRACK_STYLE.railOffset, measurement.track.railOffsetPx);
  assert.equal(AUTHOR_TRACK_STYLE.railWidth, measurement.track.railWidthPx);
  assert.equal(AUTHOR_TRACK_STYLE.sleeperWidth, measurement.track.sleeperWidthPx);
  assert.equal(
    AUTHOR_TRACK_STYLE.sleeperHalfLength,
    measurement.track.sleeperHalfLengthPx
  );
  assert.equal(AUTHOR_TRACK_STYLE.sleeperSpacing, measurement.track.sleeperSpacingPx);
  assert.equal(AUTHOR_STATION_STYLE.teeth, measurement.station.teeth);
  assert.equal(AUTHOR_STATION_STYLE.rootRadius, measurement.station.rootRadiusPx);
  assert.equal(AUTHOR_STATION_STYLE.tipRadius, measurement.station.tipRadiusPx);
  assert.equal(AUTHOR_STATION_STYLE.discRadius, measurement.station.discRadiusPx);
  assert.equal(AUTHOR_STATION_STYLE.waypointRadius, measurement.station.waypointRadiusPx);
});

test("rails run parallel to the road at the measured distance", () => {
  const from = { x: 100, y: 100 };
  const to = { x: 600, y: 340 };
  const shapes = railwayTrackShapes([from, to]);

  assert.equal(shapes.rails.length, 2);
  for (const rail of shapes.rails) {
    assert.equal(rail.length, 2);
    for (const point of rail) {
      assert.ok(
        Math.abs(distanceToLine(point, from, to) - AUTHOR_TRACK_STYLE.railOffset) < 1e-9,
        "a rail point must sit exactly one rail offset away from the road"
      );
    }
  }
  // The two rails are on opposite sides, so the distance between them is the
  // full track gauge.
  const [left, right] = shapes.rails;
  assert.ok(Math.hypot(left[0].x - right[0].x, left[0].y - right[0].y)
    - AUTHOR_TRACK_STYLE.railOffset * 2 < 1e-9);
});

test("sleepers keep the measured rhythm and cross the track", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 350, y: 0 };
  const shapes = railwayTrackShapes([from, to]);

  assert.ok(shapes.sleepers.length > 15, "a long road carries many sleepers");
  const first = shapes.sleepers[0];
  assert.equal(first.from.x, AUTHOR_TRACK_STYLE.sleeperSpacing / 2);
  assert.equal(
    first.to.y - first.from.y,
    AUTHOR_TRACK_STYLE.sleeperHalfLength * 2
  );
  for (let index = 1; index < shapes.sleepers.length; index += 1) {
    const step = shapes.sleepers[index].from.x - shapes.sleepers[index - 1].from.x;
    assert.ok(
      Math.abs(step - AUTHOR_TRACK_STYLE.sleeperSpacing) < 1e-9,
      "the distance between sleepers must not drift along the road"
    );
  }
  // A sleeper is longer than the track is wide, so it shows past both rails.
  assert.ok(AUTHOR_TRACK_STYLE.sleeperHalfLength
    > AUTHOR_TRACK_STYLE.railOffset + AUTHOR_TRACK_STYLE.railWidth / 2);
});

test("the sleeper rhythm continues across a bend instead of restarting", () => {
  const straight = railwayTrackShapes([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
  const bent = railwayTrackShapes([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 400, y: 0 }
  ]);
  // The same road described with an extra collinear vertex — a technical
  // point of a planned route — must produce the same sleepers.
  assert.equal(bent.sleepers.length, straight.sleepers.length);
  bent.sleepers.forEach((sleeper, index) => {
    assert.ok(Math.abs(sleeper.from.x - straight.sleepers[index].from.x) < 1e-9);
  });
});

test("degenerate route data produces no drawing instead of failing", () => {
  assert.deepEqual(railwayTrackShapes([]), { rails: [[], []], sleepers: [] });
  assert.deepEqual(
    railwayTrackShapes([{ x: 10, y: 10 }]),
    { rails: [[], []], sleepers: [] }
  );
  const repeated = railwayTrackShapes([{ x: 10, y: 10 }, { x: 10, y: 10 }]);
  assert.deepEqual(repeated.sleepers, []);
  assert.deepEqual(repeated.rails, [[], []]);
});

test("the station gear has the measured teeth, one of them pointing up", () => {
  const centre = { x: 500, y: 500 };
  const outline = stationGearOutline(centre);

  assert.equal(outline.length, AUTHOR_STATION_STYLE.teeth * 4);
  const radii = outline.map((point) =>
    Math.hypot(point.x - centre.x, point.y - centre.y));
  assert.ok(Math.abs(Math.min(...radii) - AUTHOR_STATION_STYLE.rootRadius) < 1e-9);
  assert.ok(Math.abs(Math.max(...radii) - AUTHOR_STATION_STYLE.tipRadius) < 1e-9);

  // The middle of the first tooth is straight above the centre, which is how
  // the mark lines up with the icon printed on the map.
  const tipStart = outline[1];
  const tipEnd = outline[2];
  const middle = { x: (tipStart.x + tipEnd.x) / 2, y: (tipStart.y + tipEnd.y) / 2 };
  assert.ok(Math.abs(middle.x - centre.x) < 1e-9);
  assert.ok(middle.y < centre.y);
});

test("printed marks replace the long identifiers of the two special points", () => {
  assert.equal(printedNodeLabel("terminal-3-14", "3,14 (π)"), "π");
  assert.equal(printedNodeLabel("waypoint-9-3-4", "9¾"), "9¾");
  assert.equal(printedNodeLabel("terminal-7", "7"), "7");
});
