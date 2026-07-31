#!/usr/bin/env node
/**
 * Compute, for every one of the ten hand-drawn initial roads of
 * "Cards, Money, Trains", which map regions the road's straight line
 * crosses, and where it enters and leaves each of them.
 *
 * WHY THIS TOOL EXISTS
 * ---------------------
 * In this game the price of building a road depends on how many separate
 * region "passages" (continuous pieces of the road inside one area of the
 * map) it is made of. Until now the manifest priced roads against a
 * placeholder partition: twenty vertical strips running the full height of
 * the board. That placeholder was never real geometry, so every historical
 * price computed from it was fictitious. The map now has a real partition
 * into 917 author-confirmed regions (see
 * `annotations/initial-network-with-regions.review.json`), and this tool
 * recomputes the true passages of the ten initial roads against it.
 *
 * WHAT THIS TOOL DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * The obvious-looking shortcut would be to feed the ten roads through the
 * authoritative route planner in `regionRoadPlanner.ts` and read its output.
 * That would be wrong. The planner is a *pathfinder*: given two regions it
 * invents a route through the middle of shared borders ("portals"), because
 * at runtime nobody has drawn the road yet. Applied to an already-drawn
 * author road, it would silently replace the author's straight line with a
 * zig-zag through dozens of portal midpoints — a different, invented
 * geometry that only coincidentally starts and ends at the same two points.
 * These ten roads are authoritative precisely because a human author drew
 * them, not because any algorithm "found" them. Their geometry is fixed: the
 * straight segment between the two node positions. The only thing left to
 * compute is bookkeeping — which regions that fixed segment passes through,
 * and at which points — and that is a one-shot geometric measurement, not a
 * planning problem.
 *
 * ALGORITHM
 * ---------
 * For each road (a straight segment from one node's position to another's):
 *   1. Intersect the segment with every side of every region polygon that
 *      could possibly touch it (see the bounding-box prefilter below).
 *   2. Merge intersection points that land on the same physical location
 *      (typically a polygon vertex shared by several regions) into one.
 *   3. Sort the surviving points along the segment and prepend the road's
 *      start and append its end. This ordered list is the `polyline`.
 *   4. For every consecutive pair of polyline points, look at the *midpoint*
 *      of that little piece and ask which single region contains it. That
 *      region owns the piece; the ordered pieces make up `passages` and
 *      `regionSequence`.
 *
 * A segment lying exactly along a shared border between two regions (rather
 * than crossing it) is a genuinely ambiguous case — it does not belong to
 * either region more than the other — so this tool refuses to guess and
 * reports it as a discrepancy instead of silently picking a side.
 *
 * GEOMETRY CONVENTIONS
 * --------------------
 * Coordinate comparisons use the same `1e-9` epsilon (a tiny tolerance below
 * which two floating-point numbers are treated as equal) as the rest of the
 * repository's map geometry code: `scripts/map-annotation/map-annotation.mjs`
 * and `services/runtime-api/src/modules/runtime/regionRoadPlanner.ts`. The
 * bounding-box prefilter (an axis-aligned rectangle test that cheaply rules
 * out region/segment pairs that cannot possibly intersect) is also copied
 * from the same two files rather than reinvented, for the reason explained
 * there: it is an *exact* filter (it never discards a pair that could
 * actually touch), so it only saves work and never changes the answer.
 *
 * USAGE
 * -----
 *   node games/cards-money-trains/tools/build-initial-road-passages.mjs
 *   node games/cards-money-trains/tools/build-initial-road-passages.mjs --check
 *
 * The first form (re)writes
 * `annotations/initial-network.road-passages.json`; the second only verifies
 * that the file on disk is exactly what a fresh run would produce, without
 * writing anything (used in CI-style checks). Exit code 0 means success; 1
 * means either a stale output file (`--check`) or a geometric discrepancy in
 * the source data (see the assertions below) — the message on stderr names
 * the offending road and coordinates in both cases.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateMapAnnotation } from "../../../scripts/map-annotation/map-annotation.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const annotationPath = path.join(
  gameRoot,
  "annotations",
  "initial-network-with-regions.review.json"
);
const outputPath = path.join(
  gameRoot,
  "annotations",
  "initial-network.road-passages.json"
);

/** Same tolerance the rest of the map geometry code uses; see file header. */
const EPSILON = 1e-9;
const ALGORITHM_VERSION = "initial-road-straight-line-region-crossing-v1";
/** Output coordinates are rounded for a clean, stable file; see roundPoint. */
const OUTPUT_DECIMALS = 6;

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

// ---------------------------------------------------------------------------
// Small geometry primitives, deliberately mirroring the conventions already
// established in scripts/map-annotation/map-annotation.mjs and
// services/runtime-api/src/modules/runtime/regionRoadPlanner.ts so a reader
// familiar with either file recognises these immediately.
// ---------------------------------------------------------------------------

/** Twice the signed area of triangle (a, b, c); zero means the three are collinear. */
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const interpolate = (from, to, t) => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t
});

/** True if `point` lies on the closed segment [start, end], boundary included. */
const pointOnSegment = (point, start, end) =>
  Math.abs(cross(start, end, point)) < EPSILON &&
  point.x >= Math.min(start.x, end.x) - EPSILON &&
  point.x <= Math.max(start.x, end.x) + EPSILON &&
  point.y >= Math.min(start.y, end.y) - EPSILON &&
  point.y <= Math.max(start.y, end.y) + EPSILON;

const pointsNearlyEqual = (a, b) =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

/** Axis-aligned bounding rectangle of a list of points. */
const boundsOfPoints = (points) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Exact rectangle-overlap test used as a cheap prefilter: if two shapes'
 * bounds do not overlap, the shapes themselves cannot intersect, so the pair
 * can be skipped without ever changing the result (see file header).
 */
const boundsOverlap = (a, b) =>
  a.minX - EPSILON <= b.maxX && b.minX - EPSILON <= a.maxX &&
  a.minY - EPSILON <= b.maxY && b.minY - EPSILON <= a.maxY;

/**
 * Ray-casting containment test with an inclusive boundary: a point exactly
 * on an edge or vertex counts as "in" the polygon. `closedPolygon` must
 * repeat its first point as its last, matching the review annotation's
 * region format.
 */
const pointInOrOnPolygon = (point, closedPolygon) => {
  for (let index = 0; index < closedPolygon.length - 1; index += 1) {
    if (pointOnSegment(point, closedPolygon[index], closedPolygon[index + 1])) return true;
  }
  let inside = false;
  for (let current = 0, previous = closedPolygon.length - 2;
    current < closedPolygon.length - 1;
    previous = current++) {
    const a = closedPolygon[current];
    const b = closedPolygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * Point where the axis-aligned parametric line through (start, end) crosses
 * a given coordinate value on the dominant axis. Used only for collinear
 * overlaps, where the crossing point can be read directly off one axis.
 */
const pointAtAxisValue = (start, end, axis, value) => {
  const delta = end[axis] - start[axis];
  const t = Math.abs(delta) < EPSILON ? 0 : (value - start[axis]) / delta;
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
};

/**
 * The positive-length overlap of two *collinear* segments [a,b] and [c,d],
 * or null if they are not collinear or do not overlap. Mirrors
 * `sharedBoundaryPart` in map-annotation.mjs. Used both to detect the
 * degenerate "road runs along a region border" case and to prove that two
 * consecutive regions in a road's sequence truly share a border.
 */
const collinearOverlap = (a, b, c, d) => {
  if (Math.abs(cross(a, b, c)) >= EPSILON || Math.abs(cross(a, b, d)) >= EPSILON) return null;
  const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "x" : "y";
  const overlapStart = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const overlapEnd = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  if (overlapEnd - overlapStart <= EPSILON) return null;
  return {
    from: pointAtAxisValue(a, b, axis, overlapStart),
    to: pointAtAxisValue(a, b, axis, overlapEnd)
  };
};

/**
 * Parameter `t` along segment [a,b] (clamped to [0,1]) where it properly
 * crosses segment [c,d], or null if the segments are parallel (including
 * collinear — that case is handled separately by `collinearOverlap`) or the
 * crossing falls outside either segment.
 *
 * Standard two-line intersection by Cramer's rule: solving
 * a + t·(b-a) = c + u·(d-c) for t and u via cross products.
 */
const segmentCrossingParameter = (a, b, c, d) => {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const cdX = d.x - c.x;
  const cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < EPSILON) return null;
  const acX = c.x - a.x;
  const acY = c.y - a.y;
  const t = (acX * cdY - acY * cdX) / denominator;
  const u = (acX * abY - acY * abX) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return Math.min(1, Math.max(0, t));
};

// ---------------------------------------------------------------------------
// Region preparation: each region's polygon sides and bounds are computed
// once and reused across all ten roads.
// ---------------------------------------------------------------------------

/** Attach precomputed bounds and bounded sides to every region, once. */
const prepareRegions = (regions) => regions.map((region) => {
  const polygon = region.polygon;
  const sides = [];
  for (let index = 0; index < polygon.length - 1; index += 1) {
    const from = polygon[index];
    const to = polygon[index + 1];
    sides.push({ from, to, bounds: boundsOfPoints([from, to]) });
  }
  return {
    id: region.id,
    polygon,
    bounds: boundsOfPoints(polygon),
    sides
  };
});

/** Every prepared region whose (bounds-filtered) polygon contains `point`. */
const findContainingRegions = (point, regions) => regions.filter((region) => {
  const withinBounds =
    point.x >= region.bounds.minX - EPSILON && point.x <= region.bounds.maxX + EPSILON &&
    point.y >= region.bounds.minY - EPSILON && point.y <= region.bounds.maxY + EPSILON;
  return withinBounds && pointInOrOnPolygon(point, region.polygon);
});

/**
 * Whether two regions share a border of positive length, checked directly
 * against their polygons (not inferred from any precomputed navigation
 * graph). Bounds are checked first because two regions whose rectangles do
 * not even touch plainly cannot share an edge.
 */
const regionsShareBorder = (regionA, regionB) => {
  if (!boundsOverlap(regionA.bounds, regionB.bounds)) return false;
  for (const sideA of regionA.sides) {
    for (const sideB of regionB.sides) {
      if (!boundsOverlap(sideA.bounds, sideB.bounds)) continue;
      if (collinearOverlap(sideA.from, sideA.to, sideB.from, sideB.to)) return true;
    }
  }
  return false;
};

const formatPoint = (point) => `(${point.x}, ${point.y})`;

/**
 * Compute the ordered list of points a road's straight segment passes
 * through: its start, every place it crosses a region border (deduplicated),
 * and its end. Also collects any degenerate "runs along a border instead of
 * crossing it" discrepancies for `roadId`, without guessing an owner region
 * for them.
 */
const computeRoadPolyline = (roadId, from, to, regions) => {
  const roadBounds = boundsOfPoints([from, to]);
  const candidates = [{ t: 0, point: from }, { t: 1, point: to }];
  for (const region of regions) {
    if (!boundsOverlap(roadBounds, region.bounds)) continue;
    for (const side of region.sides) {
      if (!boundsOverlap(roadBounds, side.bounds)) continue;
      const overlap = collinearOverlap(from, to, side.from, side.to);
      if (overlap) {
        throw new Error(
          `road "${roadId}" runs exactly along a border of region "${region.id}" `
          + `from ${formatPoint(overlap.from)} to ${formatPoint(overlap.to)} instead of `
          + "crossing it; this piece cannot be assigned to one side without guessing "
          + "and must be resolved by the map author"
        );
      }
      const t = segmentCrossingParameter(from, to, side.from, side.to);
      if (t !== null) candidates.push({ t, point: interpolate(from, to, t) });
    }
  }
  candidates.sort((left, right) => left.t - right.t);
  const polyline = [];
  for (const candidate of candidates) {
    const previous = polyline[polyline.length - 1];
    if (previous && pointsNearlyEqual(previous, candidate.point)) continue;
    polyline.push(candidate.point);
  }
  return polyline;
};

/**
 * Assign every piece of a road's polyline to the one region whose polygon
 * contains that piece's midpoint, and check that consecutive regions in the
 * resulting sequence genuinely share a border. Throws with the road id and
 * offending coordinates on any violation instead of silently guessing.
 */
const assignPassages = (roadId, polyline, regions) => {
  const passages = [];
  const regionSequence = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    const midpoint = interpolate(from, to, 0.5);
    const matches = findContainingRegions(midpoint, regions);
    if (matches.length === 0) {
      throw new Error(
        `road "${roadId}" piece ${index} (between polyline points ${index} and ${index + 1}, `
        + `midpoint ${formatPoint(midpoint)}) is not inside any declared region; the road left `
        + "the partition"
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `road "${roadId}" piece ${index} (midpoint ${formatPoint(midpoint)}) lies inside `
        + `${matches.length} regions at once (${matches.map((region) => region.id).join(", ")}); `
        + "the regions overlap"
      );
    }
    const regionId = matches[0].id;
    passages.push({ regionId, fromPointIndex: index, toPointIndex: index + 1 });
    regionSequence.push(regionId);
  }
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  for (let index = 0; index < regionSequence.length - 1; index += 1) {
    const currentId = regionSequence[index];
    const nextId = regionSequence[index + 1];
    if (currentId === nextId) continue;
    if (!regionsShareBorder(regionsById.get(currentId), regionsById.get(nextId))) {
      throw new Error(
        `road "${roadId}" passes from region "${currentId}" to region "${nextId}" at polyline `
        + `point ${index + 1} ${formatPoint(polyline[index + 1])}, but the two regions do not `
        + "share a border of positive length"
      );
    }
  }
  return { passages, regionSequence };
};

/** Both road endpoints must lie inside at least one declared region. */
const assertEndpointsInsideRegions = (roadId, from, to, regions) => {
  if (findContainingRegions(from, regions).length === 0) {
    throw new Error(`road "${roadId}" start ${formatPoint(from)} is not inside any declared region`);
  }
  if (findContainingRegions(to, regions).length === 0) {
    throw new Error(`road "${roadId}" end ${formatPoint(to)} is not inside any declared region`);
  }
};

const roundNumber = (value) => {
  const factor = 10 ** OUTPUT_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundPoint = (point) => ({ x: roundNumber(point.x), y: roundNumber(point.y) });

/** Full computation for one road: polyline, passages, region sequence, length. */
const buildRoadRecord = (edge, nodesById, regions) => {
  const fromNode = nodesById.get(edge.fromNodeId);
  const toNode = nodesById.get(edge.toNodeId);
  assert.ok(fromNode, `road "${edge.id}" references missing fromNodeId "${edge.fromNodeId}"`);
  assert.ok(toNode, `road "${edge.id}" references missing toNodeId "${edge.toNodeId}"`);
  const from = fromNode.position;
  const to = toNode.position;
  assertEndpointsInsideRegions(edge.id, from, to, regions);

  const polyline = computeRoadPolyline(edge.id, from, to, regions);
  assert.ok(polyline.length >= 2, `road "${edge.id}" produced a degenerate polyline`);
  const { passages, regionSequence } = assignPassages(edge.id, polyline, regions);

  let length = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    length += distance(polyline[index], polyline[index + 1]);
  }

  return {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    length: roundNumber(length),
    polyline: polyline.map(roundPoint),
    passages,
    regionSequence
  };
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/**
 * Pure entry point over an in-memory `{ nodes, edges, regions }` document
 * (the shape shared with the full map annotation, but with no other fields
 * required). Kept independent of any file I/O so tests can exercise it on
 * small synthetic partitions.
 */
export const buildFromAnnotation = (annotation) => {
  const nodesById = new Map(annotation.nodes.map((node) => [node.id, node]));
  const regions = prepareRegions(annotation.regions);
  const roads = annotation.edges.map((edge) => buildRoadRecord(edge, nodesById, regions));
  const passageCounts = roads.map((road) => road.passages.length);
  return {
    summary: {
      roadCount: roads.length,
      minPassages: Math.min(...passageCounts),
      medianPassages: median(passageCounts),
      maxPassages: Math.max(...passageCounts),
      totalPassages: passageCounts.reduce((sum, count) => sum + count, 0)
    },
    roads
  };
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Read, schema-validate and geometrically process the real annotation. */
const buildFromDisk = async () => {
  const annotationRaw = await readFile(annotationPath, "utf8");
  // The annotation's own JSON Schema and cross-record checks (unique ids,
  // simple closed polygons, edge endpoints existing, ...) are the schema's
  // job, not this tool's; re-validating here avoids re-implementing them by
  // hand and keeps this generator honest about only trusting a document that
  // already passed the platform's declarative source of truth.
  const annotation = await validateMapAnnotation(JSON.parse(annotationRaw), annotationPath);
  const sha256 = createHash("sha256").update(annotationRaw).digest("hex");
  const built = buildFromAnnotation(annotation);
  return {
    generatedFrom: {
      annotation: path.relative(gameRoot, annotationPath).split(path.sep).join("/"),
      sha256,
      algorithmVersion: ALGORITHM_VERSION,
      epsilon: EPSILON
    },
    summary: built.summary,
    roads: built.roads
  };
};

const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-initial-road-passages.mjs [--check]");
  }
  const built = serialize(await buildFromDisk());
  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8").catch(() => {
      throw new Error(`${outputPath} does not exist; run without --check to build it`);
    });
    assert.equal(
      existing,
      built,
      `${outputPath} is stale relative to its sources; rerun without --check to rebuild it`
    );
  } else {
    await writeAtomically(outputPath, built);
  }
  const roadCount = JSON.parse(built).summary.roadCount;
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} initial road region passages `
    + `(${roadCount} roads)\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  annotationPath,
  buildFromDisk,
  outputPath,
  readJson
};
