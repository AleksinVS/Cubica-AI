/**
 * Neutral proof for the versioned graph geometry algorithms.
 *
 * These fixtures deliberately avoid any concrete game's roads, stations, or
 * regions. They pin the reusable contract: arc-length positions, closed
 * polygon membership, canonical fingerprints, and bounded invalid inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GameManifestTransportRegion } from "@cubica/contracts-manifest";

import {
  GraphGeometryError,
  canonicalGraphPoint,
  canonicalizeGraphRegions,
  closedGraphRegionMembership,
  graphEdgeGeometryFingerprint,
  readEffectiveGraphPolyline,
  splitGraphPolyline
} from "../src/modules/mechanics/graphGeometry.ts";

/** One closed ring of a region — its outline or one of its holes. */
type RegionRing = GameManifestTransportRegion["polygon"];

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

test("a region's hole is not part of it, but its border still belongs to both", () => {
  // A lake cut out of a region, published as its own enclave region — the shape
  // real author maps now carry. Version 1 of this geometry rejected any region
  // with an inner ring outright; version 2 must instead answer the membership
  // question correctly for every point around and inside the hole.
  // The contract types a ring as "at least three points", which an ordinary
  // array literal assigned to a `const` widens away; naming the type keeps the
  // fixture honest instead of casting it back at every use.
  const lake: RegionRing = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 }
  ];
  const regions = canonicalizeGraphRegions([
    {
      id: "shore",
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ],
      holes: [lake]
    },
    { id: "lake", polygon: lake }
  ]);
  assert.equal(regions.find((region) => region.id === "shore")?.holes?.length, 1);
  // A region without holes must not gain an empty `holes` field: an unchanged
  // canonical value is what keeps every existing map's fingerprint unchanged.
  assert.equal("holes" in (regions.find((region) => region.id === "lake") ?? {}), false);

  // Strictly inside the hole: the surrounding region no longer contains it.
  assert.deepEqual(closedGraphRegionMembership({ x: 5, y: 5 }, regions), ["lake"]);
  // On the hole's border: both, exactly as on a border between two neighbours.
  assert.deepEqual(closedGraphRegionMembership({ x: 5, y: 3 }, regions), ["lake", "shore"]);
  // Outside the hole but inside the region: only the surrounding region.
  assert.deepEqual(closedGraphRegionMembership({ x: 1, y: 1 }, regions), ["shore"]);
});

test("a hole is held to the same ring rules as the outline it sits in", () => {
  const square: RegionRing = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const selfIntersecting: RegionRing = [
    { x: 3, y: 3 }, { x: 7, y: 7 }, { x: 7, y: 3 }, { x: 3, y: 7 }
  ];
  // Deliberately fewer points than a ring may have. The contract's own type
  // forbids writing this, which is the point: the check under test is the
  // runtime one, guarding against a value that reached the manifest without
  // passing through TypeScript at all.
  const tooShort = [{ x: 3, y: 3 }, { x: 7, y: 3 }] as unknown as RegionRing;
  assert.throws(
    () => canonicalizeGraphRegions([{ id: "shore", polygon: square, holes: [selfIntersecting] }]),
    (error: unknown) =>
      error instanceof GraphGeometryError && /hole 0.*simple polygon/su.test(error.message)
  );
  assert.throws(
    () => canonicalizeGraphRegions([
      { id: "shore", polygon: square, holes: [tooShort] }
    ]),
    (error: unknown) =>
      error instanceof GraphGeometryError && /hole 0.*3\.\./su.test(error.message)
  );
});
