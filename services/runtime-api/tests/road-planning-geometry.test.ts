/**
 * Geometry admission and shared-boundary derivation for road planning.
 *
 * These tests guard three properties that a real author map made visible:
 *
 * 1. the number of regions is not limited — what is limited is the amount of
 *    geometry, so a map of many small areas must be admitted;
 * 2. the spatial prefilter that makes such a map affordable is exact — it may
 *    only skip pairs that could not have produced a border, and the derived
 *    graph must stay the one the published hash was computed from;
 * 3. an inner ring is refused with a clear reason instead of being ignored or
 *    silently repaired.
 *
 * The scale case is deliberately a plain grid: its complete set of borders can
 * be written down by hand, so the test compares the derivation against an
 * independent expectation rather than against another implementation of the
 * same idea.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GameManifestTransportRegion } from "@cubica/contracts-manifest";

import {
  canonicalizeRoadPlanningRegions,
  deriveRoadPlanningPortalGeometry
} from "../src/modules/runtime/regionRoadPlanner.ts";

/**
 * The schema types a polygon as a non-empty tuple, which a plain array literal
 * cannot prove. Fixtures are built as ordinary arrays and typed at this one
 * boundary, exactly as the runtime does after its own length check.
 */
const asRegions = (regions: ReadonlyArray<{ id: string; polygon: Array<{ x: number; y: number }>; holes?: Array<Array<{ x: number; y: number }>> }>) =>
  regions as unknown as ReadonlyArray<GameManifestTransportRegion>;

/** A `columns` × `rows` grid of unit cells, each cell an independent region. */
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

test("a map of nine hundred regions is admitted and keeps every shared border", () => {
  const columns = 30;
  const rows = 30;
  const regions = canonicalizeRoadPlanningRegions(asRegions(gridRegions(columns, rows)));
  assert.equal(regions.length, columns * rows);

  const portals = deriveRoadPlanningPortalGeometry(regions);

  // In a grid every pair of side-by-side cells shares exactly one border, and
  // cells touching only at a corner share none. That is
  // columns × (rows − 1) horizontal borders plus (columns − 1) × rows vertical
  // ones — an expectation derived from the shape of the map, not from the code.
  assert.equal(portals.length, columns * (rows - 1) + (columns - 1) * rows);

  for (const portal of portals) {
    assert.notEqual(portal.regionIds[0], portal.regionIds[1]);
    const horizontal = portal.from.y === portal.to.y;
    const vertical = portal.from.x === portal.to.x;
    assert.ok(horizontal !== vertical, "a grid border is either horizontal or vertical");
    const length = horizontal
      ? Math.abs(portal.to.x - portal.from.x)
      : Math.abs(portal.to.y - portal.from.y);
    assert.equal(length, 10, "a shared border spans the whole side of a cell");
  }
});

test("regions that only touch at a corner do not produce a border", () => {
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
  assert.deepEqual(deriveRoadPlanningPortalGeometry(regions), []);
});

test("distant regions are skipped without changing the result", () => {
  // The same two neighbours, once alone and once surrounded by far-away
  // regions the prefilter removes. The derived borders must be identical:
  // an acceleration that changed the graph would invalidate the package hash.
  const neighbours = [
    { id: "left", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    { id: "right", polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }] }
  ];
  const alone = deriveRoadPlanningPortalGeometry(canonicalizeRoadPlanningRegions(asRegions(neighbours)));
  const crowded = deriveRoadPlanningPortalGeometry(canonicalizeRoadPlanningRegions(asRegions([
    ...neighbours,
    ...gridRegions(5, 5).map((region) => ({
      id: `far-${region.id}`,
      polygon: region.polygon.map((point) => ({ x: point.x + 10_000, y: point.y + 10_000 }))
    }))
  ])));

  assert.equal(alone.length, 1);
  assert.deepEqual(
    crowded.filter((portal) => !portal.regionIds.some((id) => id.startsWith("far-"))),
    alone
  );
});

test("an inner ring is refused with a reason instead of being ignored", () => {
  assert.throws(
    () => canonicalizeRoadPlanningRegions(asRegions([
      {
        id: "ring",
        polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
        holes: [[{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]]
      }
    ])),
    /inner rings/u,
    "a hole must be named as the reason, not swallowed"
  );
});
