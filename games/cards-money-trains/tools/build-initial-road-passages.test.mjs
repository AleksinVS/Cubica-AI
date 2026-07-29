/**
 * Focused proof for the straight-line region-crossing computation used to
 * price the ten hand-drawn initial roads (see build-initial-road-passages.mjs
 * for why this is a one-shot measurement and not a route-planning problem).
 *
 * The synthetic fixture below is two or three unit squares, small enough to
 * reason about by hand, standing in for the real 917-region map partition.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildFromAnnotation } from "./build-initial-road-passages.mjs";

/** Two square regions sharing the full border at x=10, spanning y in [0,10]. */
const twoSquareRegions = [
  {
    id: "region-a",
    countryId: "test",
    polygon: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }
    ]
  },
  {
    id: "region-b",
    countryId: "test",
    polygon: [
      { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }
    ]
  }
];

/** A third square glued to the right of region-b, sharing the border at x=20. */
const threeSquareRegions = [
  ...twoSquareRegions,
  {
    id: "region-c",
    countryId: "test",
    polygon: [
      { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }
    ]
  }
];

const annotationWith = (regions, nodes, edges) => ({ nodes, edges, regions });

test("a road crossing two regions produces two passages in order", () => {
  const result = buildFromAnnotation(annotationWith(
    twoSquareRegions,
    [
      { id: "n1", position: { x: 2, y: 5 } },
      { id: "n2", position: { x: 18, y: 5 } }
    ],
    [{ id: "road-crossing", fromNodeId: "n1", toNodeId: "n2" }]
  ));

  assert.equal(result.roads.length, 1);
  const road = result.roads[0];
  assert.deepEqual(road.regionSequence, ["region-a", "region-b"]);
  assert.equal(road.passages.length, 2);
  assert.deepEqual(road.passages, [
    { regionId: "region-a", fromPointIndex: 0, toPointIndex: 1 },
    { regionId: "region-b", fromPointIndex: 1, toPointIndex: 2 }
  ]);
  // The crossing point must sit exactly on the shared border (x = 10).
  assert.deepEqual(road.polyline, [
    { x: 2, y: 5 }, { x: 10, y: 5 }, { x: 18, y: 5 }
  ]);
  assert.equal(result.summary.totalPassages, 2);
});

test("a road crossing three regions produces three ordered passages", () => {
  const result = buildFromAnnotation(annotationWith(
    threeSquareRegions,
    [
      { id: "n1", position: { x: 2, y: 5 } },
      { id: "n2", position: { x: 28, y: 5 } }
    ],
    [{ id: "road-three-regions", fromNodeId: "n1", toNodeId: "n2" }]
  ));

  const road = result.roads[0];
  assert.deepEqual(road.regionSequence, ["region-a", "region-b", "region-c"]);
  assert.equal(road.passages.length, 3);
  assert.deepEqual(road.polyline, [
    { x: 2, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }, { x: 28, y: 5 }
  ]);
});

test("a road entirely inside one region produces exactly one passage", () => {
  const result = buildFromAnnotation(annotationWith(
    twoSquareRegions,
    [
      { id: "n3", position: { x: 2, y: 2 } },
      { id: "n4", position: { x: 8, y: 8 } }
    ],
    [{ id: "road-inside", fromNodeId: "n3", toNodeId: "n4" }]
  ));

  const road = result.roads[0];
  assert.deepEqual(road.regionSequence, ["region-a"]);
  assert.equal(road.passages.length, 1);
  assert.deepEqual(road.passages, [
    { regionId: "region-a", fromPointIndex: 0, toPointIndex: 1 }
  ]);
  assert.deepEqual(road.polyline, [{ x: 2, y: 2 }, { x: 8, y: 8 }]);
});

test("a road that leaves the declared partition throws instead of guessing", () => {
  // region-b only covers x in [10, 20]; the segment continues to x = 30 where
  // no region is declared, so its last piece has no owning region at all.
  assert.throws(
    () => buildFromAnnotation(annotationWith(
      twoSquareRegions,
      [
        { id: "n1", position: { x: 2, y: 5 } },
        { id: "n5", position: { x: 30, y: 5 } }
      ],
      [{ id: "road-out-of-bounds", fromNodeId: "n1", toNodeId: "n5" }]
    )),
    /is not inside any declared region/
  );
});

test("a road ending outside every region is rejected by the endpoint check", () => {
  // Same geometry as above, phrased so the failing endpoint check (not the
  // piece-midpoint check) is what's exercised: the destination itself is
  // outside both squares.
  assert.throws(
    () => buildFromAnnotation(annotationWith(
      twoSquareRegions,
      [
        { id: "n1", position: { x: 2, y: 5 } },
        { id: "n6", position: { x: 25, y: 5 } }
      ],
      [{ id: "road-endpoint-outside", fromNodeId: "n1", toNodeId: "n6" }]
    )),
    /end .* is not inside any declared region/
  );
});

test("a road running exactly along a shared border is reported, not guessed", () => {
  // The whole segment lies on the line y = 0, which is the shared border
  // between region-a/region-b (below y=0 there is nothing declared) as well
  // as each square's own bottom edge. This is the degenerate case the tool
  // must name explicitly instead of assigning it to one side.
  assert.throws(
    () => buildFromAnnotation(annotationWith(
      twoSquareRegions,
      [
        { id: "n1", position: { x: 2, y: 0 } },
        { id: "n2", position: { x: 8, y: 0 } }
      ],
      [{ id: "road-along-border", fromNodeId: "n1", toNodeId: "n2" }]
    )),
    /runs exactly along a border/
  );
});
