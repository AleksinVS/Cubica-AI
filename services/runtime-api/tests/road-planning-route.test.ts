/**
 * The rule by which a road is planned, checked on maps small enough to work out
 * by hand.
 *
 * Version 2 promises three things and this file checks each of them separately
 * (ADR-100 § 4.5):
 *
 * 1. the road crosses the smallest possible number of regions — that number is
 *    what a game charges for, so it is the promise that matters most;
 * 2. inside the corridor it chose, the line is the shortest one that stays
 *    inside — it bends only where a corner forces it to;
 * 3. the answer is the same every time, with nothing decided by chance.
 *
 * The maps here are deliberately tiny. A real author map has nine hundred
 * regions and no one can say by hand what the right answer on it is; on two
 * squares and an L-shaped strip anyone can.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  GameManifestTransportNetworkModel,
  GameManifestTransportRegion
} from "@cubica/contracts-manifest";

import {
  canonicalizeRoadPlanningRegions,
  computeRegionRoadPlanningHash,
  deriveRegionCrossings,
  pointInOrOnRegion,
  REGION_ROAD_BOUNDARY_POLICY,
  REGION_ROAD_PLANNING_ALGORITHM,
  REGION_ROAD_PLANNING_MODE,
  REGION_ROAD_TIE_BREAK
} from "../src/modules/runtime/regionRoadGeometry.ts";
import { planMinimumRegionRoad } from "../src/modules/runtime/regionRoadPlanner.ts";

type RawRegion = { id: string; polygon: Array<{ x: number; y: number }> };

/**
 * Build the network model a real manifest would declare, with the checksum
 * computed the same way the package compiler computes it.
 */
const modelOf = (raw: ReadonlyArray<RawRegion>): GameManifestTransportNetworkModel => {
  const regions = canonicalizeRoadPlanningRegions(
    raw as unknown as ReadonlyArray<GameManifestTransportRegion>
  );
  const crossings = deriveRegionCrossings(regions);
  return {
    regions,
    roadPlanning: {
      mode: REGION_ROAD_PLANNING_MODE,
      algorithmVersion: REGION_ROAD_PLANNING_ALGORITHM,
      geometryVersion: "test-map-v1",
      geometryHash: computeRegionRoadPlanningHash({
        algorithmVersion: REGION_ROAD_PLANNING_ALGORITHM,
        boundaryPolicy: REGION_ROAD_BOUNDARY_POLICY,
        regions,
        crossings
      }),
      tieBreak: REGION_ROAD_TIE_BREAK,
      boundaryPolicy: REGION_ROAD_BOUNDARY_POLICY
    }
  } as unknown as GameManifestTransportNetworkModel;
};

const box = (id: string, left: number, top: number, right: number, bottom: number): RawRegion => ({
  id,
  polygon: [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ]
});

const lineLength = (points: ReadonlyArray<{ x: number; y: number }>): number => points
  .slice(0, -1)
  .reduce((sum, point, index) => sum + Math.hypot(points[index + 1].x - point.x, points[index + 1].y - point.y), 0);

/**
 * Every paid stretch of the road must really lie in the region it is charged
 * to. Checking the corner points is not enough — a line can leave a bent region
 * between two points that are both inside it — so the stretch is sampled.
 */
const assertPassagesStayInsideTheirRegions = (
  model: GameManifestTransportNetworkModel,
  road: { points: Array<{ x: number; y: number }>; passages: Array<{ regionId: string; fromPointIndex: number; toPointIndex: number }> }
) => {
  const byId = new Map(model.regions.map((region) => [region.id, region]));
  for (const passage of road.passages) {
    const region = byId.get(passage.regionId);
    assert.ok(region, `passage names region ${passage.regionId}, which is not on the map`);
    for (let index = passage.fromPointIndex; index < passage.toPointIndex; index += 1) {
      const from = road.points[index];
      const to = road.points[index + 1];
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const sample = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        assert.ok(
          pointInOrOnRegion(sample, region),
          `road leaves region ${passage.regionId} it is charged for, at ${sample.x},${sample.y}`
        );
      }
    }
  }
  assert.equal(road.passages[0].fromPointIndex, 0);
  assert.equal(road.passages[road.passages.length - 1].toPointIndex, road.points.length - 1);
  for (let index = 1; index < road.passages.length; index += 1) {
    assert.equal(
      road.passages[index].fromPointIndex,
      road.passages[index - 1].toPointIndex,
      "one stretch must begin exactly where the previous ended"
    );
  }
};

test("across two squares the road is a straight line through both", () => {
  const model = modelOf([box("west", 0, 0, 10, 10), box("east", 10, 0, 20, 10)]);
  const { road } = planMinimumRegionRoad({ model, from: { x: 2, y: 5 }, to: { x: 18, y: 5 } });

  assert.deepEqual(road.regionSequence, ["west", "east"]);
  assert.equal(road.passages.length, 2);
  // Nothing is in the way, so the line is straight — three points, because the
  // moment it changes region has to be written down.
  assert.deepEqual(road.points, [{ x: 2, y: 5 }, { x: 10, y: 5 }, { x: 18, y: 5 }]);
  assertPassagesStayInsideTheirRegions(model, road);
});

test("a bent region bends the road exactly once, at the corner", () => {
  // An L-shaped strip: from the far end of one arm to the far end of the other,
  // the shortest line inside it touches the inner corner and nothing else.
  const model = modelOf([
    {
      id: "elbow",
      polygon: [
        { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 },
        { x: 20, y: 30 }, { x: 20, y: 10 }, { x: 0, y: 10 }
      ]
    }
  ]);
  const { road } = planMinimumRegionRoad({ model, from: { x: 2, y: 5 }, to: { x: 25, y: 28 } });

  assert.deepEqual(road.regionSequence, ["elbow"]);
  assert.equal(road.points.length, 3, "one bend, so three points");
  assert.deepEqual(road.points[1], { x: 20, y: 10 }, "the bend is the inner corner itself");
  assertPassagesStayInsideTheirRegions(model, road);
});

/**
 * A row of four narrow strips with one wide region running along the top.
 *
 * Straight from one end of the row to the other crosses all four strips; going
 * up into the wide region and back down crosses three regions. The wide region
 * is what makes the two routes cost differently, which is what these two tests
 * need in order to prove anything.
 */
const stripRowWithBypass = () => [
  box("south-1", 0, 10, 10, 20),
  box("south-2", 10, 10, 20, 20),
  box("south-3", 20, 10, 30, 20),
  box("south-4", 30, 10, 40, 20),
  { id: "north", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }] }
];

test("the road takes the way through fewer regions even when it is longer", () => {
  const model = modelOf(stripRowWithBypass());
  const { road } = planMinimumRegionRoad({ model, from: { x: 5, y: 15 }, to: { x: 35, y: 15 } });

  // Four strips straight across, or three regions by going up and over. Fewer
  // regions wins even though the line is longer: the number of regions is what
  // the game charges for, and length is only appearance.
  assert.deepEqual(road.regionSequence, ["south-1", "north", "south-4"]);
  assert.ok(
    lineLength(road.points) > 30,
    "the chosen line is longer than the straight one it rejected, which is 30 long"
  );
  assertPassagesStayInsideTheirRegions(model, road);
});

test("an excluded region is not used, and the road goes round it", () => {
  const model = modelOf(stripRowWithBypass());
  const avoiding = planMinimumRegionRoad({
    model,
    from: { x: 5, y: 15 },
    to: { x: 35, y: 15 },
    excludedRegionIds: ["north"]
  }).road;

  // With the way over the top closed, the only way left is straight along the
  // row, and it costs one region more.
  assert.deepEqual(avoiding.regionSequence, ["south-1", "south-2", "south-3", "south-4"]);
  assertPassagesStayInsideTheirRegions(model, avoiding);
});

test("both ends inside one region give a single straight stretch", () => {
  const model = modelOf([box("only", 0, 0, 10, 10), box("next-door", 10, 0, 20, 10)]);
  const { road } = planMinimumRegionRoad({ model, from: { x: 2, y: 2 }, to: { x: 8, y: 8 } });

  assert.deepEqual(road.regionSequence, ["only"]);
  assert.deepEqual(road.points, [{ x: 2, y: 2 }, { x: 8, y: 8 }]);
  assert.deepEqual(road.passages, [{ regionId: "only", fromPointIndex: 0, toPointIndex: 1 }]);
});

/** A two-by-two grid of squares, whose four corners meet at one point. */
const fourWayGrid = () => [
  box("a", 0, 0, 10, 10), box("b", 10, 0, 20, 10),
  box("c", 0, 10, 10, 20), box("d", 10, 10, 20, 20)
];

test("the same request twice gives the identical road", () => {
  const model = modelOf(fourWayGrid());
  // From the far side of one square to the far side of the diagonally opposite
  // one. There are two ways round of equal cost — through "b" or through "c" —
  // which is exactly the case version 1 settled by chance.
  const first = planMinimumRegionRoad({ model, from: { x: 2, y: 5 }, to: { x: 18, y: 12 } }).road;
  const second = planMinimumRegionRoad({ model, from: { x: 2, y: 5 }, to: { x: 18, y: 12 } }).road;
  assert.deepEqual(second, first);
  assert.equal(first.regionSequence.length, 3, "two equal ways round, both three regions long");
  assertPassagesStayInsideTheirRegions(model, first);
});

test("a road straight through the point where four regions meet is refused", () => {
  // The straight line here passes exactly through the one point all four
  // squares share, entering neither "b" nor "c". Touching a border at a single
  // point is not a paid stretch and not a crossing either (ADR-081 § 4.2), so
  // there is no shortest valid road along this diagonal — only ever-shorter
  // ones. The planner says so instead of inventing an answer.
  const model = modelOf(fourWayGrid());
  assert.throws(
    () => planMinimumRegionRoad({ model, from: { x: 5, y: 5 }, to: { x: 15, y: 15 } }),
    /without entering region/u
  );
});

test("regions that do not connect are refused with a reason", () => {
  const model = modelOf([box("island-west", 0, 0, 10, 10), box("island-east", 100, 0, 110, 10)]);
  assert.throws(
    () => planMinimumRegionRoad({ model, from: { x: 5, y: 5 }, to: { x: 105, y: 5 } }),
    /No road route connects/u
  );
});

test("an endpoint outside every region is refused with a reason", () => {
  const model = modelOf([box("only", 0, 0, 10, 10)]);
  assert.throws(
    () => planMinimumRegionRoad({ model, from: { x: 5, y: 5 }, to: { x: 500, y: 500 } }),
    /must lie inside non-excluded declared regions/u
  );
});

test("a declared checksum that does not match the regions is refused", () => {
  const model = modelOf([box("west", 0, 0, 10, 10), box("east", 10, 0, 20, 10)]);
  const tampered = {
    ...model,
    roadPlanning: {
      ...model.roadPlanning,
      geometryHash: `sha256:${"0".repeat(64)}`
    }
  } as GameManifestTransportNetworkModel;
  assert.throws(
    () => planMinimumRegionRoad({ model: tampered, from: { x: 2, y: 5 }, to: { x: 18, y: 5 } }),
    /geometry hash mismatch/u
  );
});
