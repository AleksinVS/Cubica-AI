/**
 * Admission of a road-planning map and derivation of the crossings between its
 * regions.
 *
 * These tests guard the properties a real author map made visible, and they
 * check them against expectations written down independently of the code rather
 * than against a second implementation of the same idea:
 *
 * 1. the number of regions is not limited — what is limited is the amount of
 *    geometry, so a map of many small areas must be admitted;
 * 2. a crossing is the whole shared border of two regions, as one polyline.
 *    Version 1 emitted each straight piece of that border separately and had to
 *    try their combinations, which on the first real author map meant up to
 *    7·10¹² combinations for a single road (ADR-100);
 * 3. the spatial prefilter that makes such a map affordable is exact — it may
 *    only skip pairs that could not have produced a border, and the derived
 *    graph must stay the one the published checksum was computed from;
 * 4. inner rings are supported, and a region that surrounds another shares a
 *    closed border with it;
 * 5. geometry outside the admitted class is refused with a reason, never
 *    silently repaired.
 *
 * The scale case is deliberately a plain grid: its complete set of borders can
 * be written down by hand.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GameManifestTransportRegion } from "@cubica/contracts-manifest";

import {
  canonicalizeRoadPlanningRegions,
  computeRegionRoadPlanningHash,
  deriveRegionCrossings,
  REGION_ROAD_BOUNDARY_POLICY,
  REGION_ROAD_PLANNING_ALGORITHM
} from "../src/modules/runtime/regionRoadGeometry.ts";

/**
 * The schema types a ring as a non-empty tuple, which a plain array literal
 * cannot prove. Fixtures are built as ordinary arrays and typed at this one
 * boundary, exactly as the runtime does after its own length check.
 */
const asRegions = (regions: ReadonlyArray<{
  id: string;
  polygon: Array<{ x: number; y: number }>;
  holes?: Array<Array<{ x: number; y: number }>>;
}>) => regions as unknown as ReadonlyArray<GameManifestTransportRegion>;

/** A `columns` × `rows` grid of square cells, each cell an independent region. */
const gridRegions = (columns: number, rows: number, size = 10) => {
  const regions = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const left = column * size;
      const top = row * size;
      regions.push({
        id: `region-${String(column).padStart(3, "0")}-${String(row).padStart(3, "0")}`,
        polygon: [
          { x: left, y: top },
          { x: left + size, y: top },
          { x: left + size, y: top + size },
          { x: left, y: top + size }
        ]
      });
    }
  }
  return regions;
};

const chainLength = (chain: ReadonlyArray<{ x: number; y: number }>): number => chain
  .slice(0, -1)
  .reduce((sum, point, index) => sum + Math.hypot(chain[index + 1].x - point.x, chain[index + 1].y - point.y), 0);

test("a map of nine hundred regions is admitted and keeps every shared border", () => {
  const columns = 30;
  const rows = 30;
  const regions = canonicalizeRoadPlanningRegions(asRegions(gridRegions(columns, rows)));
  assert.equal(regions.length, columns * rows);

  const crossings = deriveRegionCrossings(regions);

  // In a grid every pair of side-by-side cells shares exactly one border, and
  // cells touching only at a corner share none. That is
  // columns × (rows − 1) horizontal borders plus (columns − 1) × rows vertical
  // ones — an expectation derived from the shape of the map, not from the code.
  assert.equal(crossings.length, columns * (rows - 1) + (columns - 1) * rows);

  for (const crossing of crossings) {
    assert.notEqual(crossing.regionIds[0], crossing.regionIds[1]);
    assert.equal(crossing.chain.length, 2, "a border between two squares is one straight piece");
    assert.equal(chainLength(crossing.chain), 10, "a shared border spans the whole side of a cell");
  }
});

test("a bent border of many pieces becomes one crossing, not many", () => {
  // Two regions meeting along a staircase. Version 1 would report five separate
  // crossings here — one per step — and a road would then have to try each of
  // them. There is one border, so there is one crossing.
  const steps = 5;
  const leftBorder = [];
  const rightBorder = [];
  for (let step = 0; step <= steps; step += 1) {
    leftBorder.push({ x: 10 + step, y: step * 10 });
    rightBorder.push({ x: 10 + step, y: step * 10 });
  }
  const regions = canonicalizeRoadPlanningRegions(asRegions([
    {
      id: "west",
      polygon: [{ x: 0, y: 0 }, ...leftBorder, { x: 0, y: steps * 10 }]
    },
    {
      id: "east",
      polygon: [{ x: 40, y: 0 }, { x: 40, y: steps * 10 }, ...[...rightBorder].reverse()]
    }
  ]));
  const crossings = deriveRegionCrossings(regions);
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].chain.length, steps + 1, "the chain keeps every corner of the border");
  assert.deepEqual(crossings[0].regionIds, ["east", "west"]);
});

test("regions that only touch at a corner do not produce a crossing", () => {
  // Two cells on a diagonal share exactly one point. A point is not a crossing,
  // and the prefilter must not turn "bounds touch" into "border exists".
  const regions = canonicalizeRoadPlanningRegions(asRegions([
    {
      id: "south-west",
      polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    },
    {
      id: "north-east",
      polygon: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]
    }
  ]));
  assert.deepEqual(deriveRegionCrossings(regions), []);
});

test("two regions touching in two separate places produce two crossings", () => {
  // A C-shaped region and the bar that closes it touch along the top arm and
  // along the bottom arm, with a gap between. Those are two borders, so two
  // crossings — merging them would claim a passage across the gap.
  const regions = canonicalizeRoadPlanningRegions(asRegions([
    {
      id: "bracket",
      polygon: [
        { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 4 }, { x: 6, y: 4 },
        { x: 6, y: 16 }, { x: 20, y: 16 }, { x: 20, y: 20 }, { x: 0, y: 20 }
      ]
    },
    {
      id: "bar",
      polygon: [
        { x: 20, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 20 }, { x: 20, y: 20 },
        { x: 20, y: 16 }, { x: 20, y: 4 }
      ]
    }
  ]));
  const crossings = deriveRegionCrossings(regions);
  assert.equal(crossings.length, 2);
  const lengths = crossings.map((crossing) => chainLength(crossing.chain)).sort((left, right) => left - right);
  assert.deepEqual(lengths, [4, 4], "each arm contributes its own four-unit border");
});

test("a region inside another shares one closed border with it", () => {
  // An enclave: the outer region has a hole, and the inner region fills it. The
  // whole boundary of the inner region is shared, so the crossing is a closed
  // loop whose last point repeats its first.
  const inner = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
  const regions = canonicalizeRoadPlanningRegions(asRegions([
    {
      id: "enclave",
      polygon: inner
    },
    {
      id: "surrounding",
      polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
      holes: [inner]
    }
  ]));
  const crossings = deriveRegionCrossings(regions);
  assert.equal(crossings.length, 1);
  const chain = crossings[0].chain;
  assert.deepEqual(chain[0], chain[chain.length - 1], "a closed border repeats its first point last");
  assert.equal(chainLength(chain), 40, "the whole boundary of the enclave is shared");
});

test("distant regions are skipped without changing the result", () => {
  // The same two neighbours, once alone and once surrounded by far-away
  // regions the prefilter removes. The derived borders must be identical: an
  // acceleration that changed the graph would invalidate the package checksum.
  const neighbours = [
    { id: "left", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    { id: "right", polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }] }
  ];
  const alone = deriveRegionCrossings(canonicalizeRoadPlanningRegions(asRegions(neighbours)));
  const crowded = deriveRegionCrossings(canonicalizeRoadPlanningRegions(asRegions([
    ...neighbours,
    ...gridRegions(5, 5).map((region) => ({
      id: `far-${region.id}`,
      polygon: region.polygon.map((point) => ({ x: point.x + 10_000, y: point.y + 10_000 }))
    }))
  ])));

  assert.equal(alone.length, 1);
  assert.deepEqual(
    crowded.filter((crossing) => !crossing.regionIds.some((id) => id.startsWith("far-"))),
    alone
  );
});

test("the checksum ignores how the map was written down, not what it is", () => {
  const canonical = [
    { id: "left", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    { id: "right", polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }] }
  ];
  // The same two squares: listed in the other order, each walked the other way
  // round, and started from a different corner.
  const rewritten = [
    { id: "right", polygon: [{ x: 20, y: 10 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    { id: "left", polygon: [{ x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }] }
  ];
  const hashOf = (raw: ReadonlyArray<{ id: string; polygon: Array<{ x: number; y: number }> }>) => {
    const regions = canonicalizeRoadPlanningRegions(asRegions(raw));
    return computeRegionRoadPlanningHash({
      algorithmVersion: REGION_ROAD_PLANNING_ALGORITHM,
      boundaryPolicy: REGION_ROAD_BOUNDARY_POLICY,
      regions,
      crossings: deriveRegionCrossings(regions)
    });
  };
  assert.equal(hashOf(rewritten), hashOf(canonical));

  // Moving a single corner is a different map and must be a different checksum.
  const moved = canonical.map((region) => region.id === "left"
    ? { ...region, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 11 }] }
    : region);
  assert.notEqual(hashOf(moved), hashOf(canonical));
});

test("overlapping regions are refused with a reason", () => {
  assert.throws(
    () => canonicalizeRoadPlanningRegions(asRegions([
      { id: "wide", polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] },
      { id: "narrow", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
    ])),
    /overlapping interiors/u
  );
});

test("a hole that is not inside its region is refused with a reason", () => {
  assert.throws(
    () => canonicalizeRoadPlanningRegions(asRegions([
      {
        id: "ring",
        polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
        holes: [[{ x: 40, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 50 }, { x: 40, y: 50 }]]
      }
    ])),
    /not strictly inside the outer ring/u
  );
});

test("a self-crossing contour is refused with a reason", () => {
  assert.throws(
    () => canonicalizeRoadPlanningRegions(asRegions([
      { id: "bowtie", polygon: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }
    ])),
    /not a simple contour/u
  );
});
