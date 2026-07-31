/**
 * Shared schema-first intake for transport networks drawn over map images.
 *
 * The module deliberately separates three responsibilities:
 * 1. JSON Schema owns the portable annotation shape.
 * 2. This file checks relationships and geometry that span several records.
 * 3. Each game supplies its own manifest settings such as costs and object types.
 *
 * This boundary lets a review draft remain useful for visual reconciliation
 * without accidentally turning uncertain pixels into publishable game rules.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

// Road-planning geometry (which regions border each other, and along which
// line — see ADR-100) is imported from the runtime module rather than
// re-derived here. The checksum this tool writes at publish time and the
// checksum runtime recomputes at load time must agree exactly, forever: two
// implementations of the same derivation are two things that can drift apart,
// one implementation cannot. Node 22 strips TypeScript types at import time
// (no flag, no build step needed — the `import type` in the source module is
// erased entirely, so the runtime-only workspace package it names is never
// actually resolved), which is what makes importing a `.ts` file straight
// from this `.mjs` script possible.
import {
  canonicalizeRoadPlanningRegions,
  computeRegionRoadPlanningHash,
  deriveRegionCrossings,
  REGION_ROAD_BOUNDARY_POLICY,
  REGION_ROAD_PLANNING_ALGORITHM,
  REGION_ROAD_PLANNING_MODE,
  REGION_ROAD_TIE_BREAK
} from "../../services/runtime-api/src/modules/runtime/regionRoadGeometry.ts";

const Ajv = AjvImport.default ?? AjvImport;
const moduleFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(moduleFile), "..", "..");

/** Canonical schema location; game packages must link here instead of copying it. */
export const MAP_ANNOTATION_SCHEMA_PATH = path.join(
  repoRoot,
  "docs",
  "architecture",
  "schemas",
  "map-annotation.schema.json"
);

const fail = (message) => {
  throw new Error(message);
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const samePoint = (left, right) => left.x === right.x && left.y === right.y;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const unorderedEdgeKey = (left, right) => [left, right].sort().join("::");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const comparePoint = (left, right) => left.x - right.x || left.y - right.y;
const GEOMETRY_EPSILON = 1e-9;

/** Freeze every JSON container so the validated value cannot change later. */
const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const pointOnSegment = (point, start, end) =>
  Math.abs(cross(start, end, point)) < GEOMETRY_EPSILON &&
  point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
  point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
  point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
  point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON;

const segmentsIntersect = (a, b, c, d) => {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-9 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) < 1e-9 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) < 1e-9 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) < 1e-9 && pointOnSegment(b, c, d));
};

const polygonArea = (points) => {
  let doubled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    doubled += points[index].x * points[index + 1].y - points[index + 1].x * points[index].y;
  }
  return Math.abs(doubled) / 2;
};

/**
 * Give one simple polygon a unique representation for hashing and replay.
 *
 * A human may start tracing at any vertex and in either direction. Those
 * authoring choices must not change the published geometry hash, so the
 * runtime polygon is counter-clockwise in mathematical coordinates and starts
 * at its lexicographically smallest point.
 */
const canonicalPolygon = (closedPolygon) => {
  const points = closedPolygon.slice(0, -1).map((point) => ({ ...point }));
  const signedDoubleArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (signedDoubleArea < 0) points.reverse();
  let firstIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (comparePoint(points[index], points[firstIndex]) < 0) firstIndex = index;
  }
  return [...points.slice(firstIndex), ...points.slice(0, firstIndex)];
};

const closedCanonicalPolygon = (polygon) => [...polygon, polygon[0]];

/** Strict containment excludes the boundary shared by legitimate neighbours. */
const pointStrictlyInPolygon = (point, closedPolygon) => {
  for (let index = 0; index < closedPolygon.length - 1; index += 1) {
    if (pointOnSegment(point, closedPolygon[index], closedPolygon[index + 1])) return false;
  }
  return pointInOrOnPolygon(point, closedPolygon);
};

const segmentsProperlyIntersect = (a, b, c, d) => {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON));
};

/**
 * Exact spatial prefilter for pairwise geometry work.
 *
 * Both the overlap check and the portal derivation ask the same question of
 * every pair of regions, and then of every pair of their sides. Asking it of
 * all pairs is quadratic: a map of nine hundred regions with eighty thousand
 * vertices would need about three billion segment comparisons, which is hours
 * of work for a result that is almost entirely "these two are nowhere near
 * each other".
 *
 * The prefilter removes exactly those pairs and nothing else. Two shapes whose
 * axis-aligned bounds do not touch cannot overlap and cannot share a boundary,
 * so skipping them cannot change the answer. This is important: the derived
 * navigation graph is fixed by its hash, so an acceleration is only allowed if
 * it is exact. No tolerance, no "close enough" merging of nearby borders — the
 * bounds are compared with the same epsilon the geometry itself uses, and every
 * surviving pair is still tested exactly as before.
 *
 * Pairs are found by sweeping along the x axis: shapes are visited in order of
 * their left edge, and a shape leaves the active set as soon as its right edge
 * falls behind the current left edge. Only shapes that are simultaneously
 * active can touch, and a cheap comparison of the y ranges removes the rest.
 */
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

/** Sides of a closed polygon, each with its own bounds. */
const polygonSidesWithBounds = (polygon) => polygon.map((point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return { from: point, to: next, bounds: boundsOfPoints([point, next]) };
});

const boundsOverlapInY = (left, right) =>
  left.minY - GEOMETRY_EPSILON <= right.maxY && right.minY - GEOMETRY_EPSILON <= left.maxY;

/** Every unordered pair of items whose bounds touch, each pair reported once. */
const touchingSelfPairs = (items) => {
  const order = items
    .map((item, index) => ({ index, bounds: item.bounds }))
    .sort((left, right) => left.bounds.minX - right.bounds.minX || left.index - right.index);
  const pairs = [];
  let active = [];
  for (const item of order) {
    active = active.filter((other) => other.bounds.maxX >= item.bounds.minX - GEOMETRY_EPSILON);
    for (const other of active) {
      if (!boundsOverlapInY(item.bounds, other.bounds)) continue;
      pairs.push(item.index < other.index
        ? [item.index, other.index]
        : [other.index, item.index]);
    }
    active.push(item);
  }
  return pairs;
};

/** Every pair of items from two different sets whose bounds touch. */
const touchingCrossPairs = (left, right) => {
  const order = [
    ...left.map((item, index) => ({ side: 0, index, bounds: item.bounds })),
    ...right.map((item, index) => ({ side: 1, index, bounds: item.bounds }))
  ].sort((first, second) =>
    first.bounds.minX - second.bounds.minX || first.side - second.side || first.index - second.index);
  const pairs = [];
  let active = [];
  for (const item of order) {
    active = active.filter((other) => other.bounds.maxX >= item.bounds.minX - GEOMETRY_EPSILON);
    for (const other of active) {
      if (other.side === item.side) continue;
      if (!boundsOverlapInY(item.bounds, other.bounds)) continue;
      pairs.push(item.side === 0 ? [item.index, other.index] : [other.index, item.index]);
    }
    active.push(item);
  }
  return pairs;
};

/** Reject ambiguous interior overlaps instead of guessing which region owns them. */
const assertRegionsDoNotOverlap = (regions) => {
  const prepared = regions.map((region) => ({
    region,
    closed: closedCanonicalPolygon(region.polygon),
    sides: polygonSidesWithBounds(region.polygon),
    bounds: boundsOfPoints(region.polygon),
    samples: region.polygon.flatMap((point, index) => {
      const next = region.polygon[(index + 1) % region.polygon.length];
      return [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }];
    })
  }));
  // Regions whose bounds do not touch cannot overlap, so only touching pairs
  // are examined. The examination itself is unchanged.
  for (const [leftIndex, rightIndex] of touchingSelfPairs(prepared)) {
    const left = prepared[leftIndex];
    const right = prepared[rightIndex];
    if (JSON.stringify(left.region.polygon) === JSON.stringify(right.region.polygon) ||
        left.samples.some((point) => pointStrictlyInPolygon(point, right.closed)) ||
        right.samples.some((point) => pointStrictlyInPolygon(point, left.closed))) {
      fail(`regions "${left.region.id}" and "${right.region.id}" overlap`);
    }
    for (const [leftSideIndex, rightSideIndex] of touchingCrossPairs(left.sides, right.sides)) {
      const leftSide = left.sides[leftSideIndex];
      const rightSide = right.sides[rightSideIndex];
      if (segmentsProperlyIntersect(leftSide.from, leftSide.to, rightSide.from, rightSide.to)) {
        fail(`regions "${left.region.id}" and "${right.region.id}" cross each other`);
      }
    }
  }
};

/**
 * Refuse a map whose regions cannot carry a road between two network nodes.
 *
 * Regions are neighbours only where they share an exact border of positive
 * length. If a strip of space belongs to no region — the painted border of a
 * country, a lost face, a sliver — the regions on either side are not
 * neighbours, and the navigation graph silently falls apart into islands. The
 * package still compiles, the map still looks right, and only much later does
 * a road refuse to be built because no route exists at all.
 *
 * The first real author map failed exactly this way: 917 regions formed six
 * islands along country borders, and four countries were cut off completely.
 * Nothing in the pipeline noticed.
 *
 * The check is deliberately phrased in game terms rather than in graph terms.
 * A map may legitimately consist of separate land masses; what may not happen
 * is two network nodes sitting in different islands, because then a road
 * between them can never be planned. That is the condition tested here.
 *
 * Version 2 (ADR-100) reports one crossing per whole shared border instead of
 * one portal per straight piece of it, but the island question only ever
 * needed `regionIds` — which two regions the graph edge connects, not its
 * exact line — so walking crossings instead of portals changes nothing else
 * about this check.
 */
const assertNetworkNodesShareOneRegionIsland = (regions, crossings, nodes) => {
  if (nodes.length < 2) return;
  const island = new Map(regions.map((region) => [region.id, region.id]));
  const find = (id) => {
    let root = id;
    while (island.get(root) !== root) root = island.get(root);
    let cursor = id;
    while (island.get(cursor) !== root) {
      const next = island.get(cursor);
      island.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const crossing of crossings) {
    const left = find(crossing.regionIds[0]);
    const right = find(crossing.regionIds[1]);
    if (left !== right) island.set(left, right);
  }

  const closed = regions.map((region) => ({
    id: region.id,
    polygon: closedCanonicalPolygon(region.polygon),
    bounds: boundsOfPoints(region.polygon)
  }));
  const nodeIsland = new Map();
  for (const node of nodes) {
    const host = closed.find((region) =>
      node.position.x >= region.bounds.minX - GEOMETRY_EPSILON &&
      node.position.x <= region.bounds.maxX + GEOMETRY_EPSILON &&
      node.position.y >= region.bounds.minY - GEOMETRY_EPSILON &&
      node.position.y <= region.bounds.maxY + GEOMETRY_EPSILON &&
      pointInOrOnPolygon(node.position, region.polygon));
    // A node outside every region is a different fault, reported elsewhere.
    if (host) nodeIsland.set(node.id, find(host.id));
  }
  const islands = new Map();
  for (const [nodeId, root] of nodeIsland) {
    if (!islands.has(root)) islands.set(root, []);
    islands.get(root).push(nodeId);
  }
  if (islands.size <= 1) return;
  const summary = [...islands.values()]
    .map((group) => group.slice().sort(compareText))
    .sort((left, right) => compareText(left[0], right[0]))
    .map((group) => `${group[0]} (+${group.length - 1})`)
    .join(", ");
  fail(
    `network nodes fall into ${islands.size} separate region islands, so no road can ` +
    `be planned between them: ${summary}. Regions are neighbours only where they ` +
    "share an exact border of positive length; a strip belonging to no region " +
    "splits the navigation graph"
  );
};

/**
 * Build the `roadPlanning` contract block (ADR-100).
 *
 * The geometry work — canonicalising the regions, finding the crossings
 * between them, and hashing the result — is delegated entirely to the same
 * module runtime loads at play time. This function's own job is narrow: run
 * the shared island check, then shape the runtime's answer into the six
 * declared fields. It must not compute anything about the shapes itself,
 * because the whole point of sharing the implementation is that there is
 * exactly one place a mistake in that computation could live.
 *
 * `regions` here are already this file's own canonical form (see
 * `canonicalPolygon` above) — the same value written to the manifest's
 * `regions` field. Feeding the runtime module that exact value, rather than
 * some other representation, is what guarantees its checksum matches the one
 * runtime recomputes from the published manifest: canonicalisation is
 * idempotent, so re-canonicalising an already-canonical shape is a no-op.
 */
const createRoadPlanningContract = (regions, options, nodes) => {
  const canonicalRegions = canonicalizeRoadPlanningRegions(regions);
  const crossings = deriveRegionCrossings(canonicalRegions);
  assertNetworkNodesShareOneRegionIsland(regions, crossings, nodes);
  const geometryHash = computeRegionRoadPlanningHash({
    algorithmVersion: REGION_ROAD_PLANNING_ALGORITHM,
    boundaryPolicy: REGION_ROAD_BOUNDARY_POLICY,
    regions: canonicalRegions,
    crossings
  });
  return {
    mode: REGION_ROAD_PLANNING_MODE,
    algorithmVersion: REGION_ROAD_PLANNING_ALGORITHM,
    geometryVersion: options.geometryVersion,
    geometryHash,
    tieBreak: REGION_ROAD_TIE_BREAK,
    boundaryPolicy: REGION_ROAD_BOUNDARY_POLICY,
    ...(options.excludedRegionIdsEndpoint
      ? { excludedRegionIdsEndpoint: options.excludedRegionIdsEndpoint }
      : {})
    // No navigationGraph: ADR-100 removes it from the contract entirely. The
    // graph is derived, not declared — runtime re-derives it from `regions`
    // and checks `geometryHash`, so storing it here would only duplicate data
    // that is, by the geometryHash comparison itself, already proven correct.
  };
};

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

const assertUniqueIds = (items, label) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${label}: duplicate id "${item.id}"`);
    seen.add(item.id);
  }
};

const assertPointInBounds = (point, width, height, label) => {
  if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) {
    fail(`${label}: point (${point.x}, ${point.y}) is outside 0..${width} × 0..${height}`);
  }
};

const assertSimpleClosedPolygon = (region, width, height) => {
  const polygon = region.polygon;
  if (!samePoint(polygon[0], polygon[polygon.length - 1])) {
    fail(`region "${region.id}" must repeat its first point as the last point`);
  }
  polygon.forEach((point, index) =>
    assertPointInBounds(point, width, height, `region "${region.id}" point ${index}`));
  for (let index = 0; index < polygon.length - 1; index += 1) {
    if (samePoint(polygon[index], polygon[index + 1])) {
      fail(`region "${region.id}" contains a zero-length side at point ${index}`);
    }
  }
  if (polygonArea(polygon) < 1) fail(`region "${region.id}" has zero area`);

  const sideCount = polygon.length - 1;
  for (let left = 0; left < sideCount; left += 1) {
    for (let right = left + 1; right < sideCount; right += 1) {
      const adjacent = right === left + 1 || (left === 0 && right === sideCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(polygon[left], polygon[left + 1], polygon[right], polygon[right + 1])) {
        fail(`region "${region.id}" self-intersects between sides ${left} and ${right}`);
      }
    }
  }
};

let schemaValidatorPromise;
const validatedAnnotations = new WeakSet();

const getSchemaValidator = async () => {
  schemaValidatorPromise ??= (async () => {
    const schema = await readJson(MAP_ANNOTATION_SCHEMA_PATH);
    // Strict mode catches unsupported or misspelled schema keywords. allErrors
    // returns one useful correction list to the person reviewing the map.
    const ajv = new Ajv({ allErrors: true, strict: true });
    return ajv.compile(schema);
  })();
  return schemaValidatorPromise;
};

/**
 * Validate the common schema, then cross-record references and geometry.
 *
 * A review draft may omit all regions because network and region intake are
 * independent review activities. Every publishable status keeps the stricter
 * invariant that each node belongs to at least one declared region.
 */
export const validateMapAnnotation = async (annotation, inputPath = "annotation.json") => {
  try {
    // Snapshot caller-owned data before any validation reads. All schema,
    // relationship and hash checks below operate on this one plain value, so a
    // getter or later caller mutation cannot create a check/use race.
    annotation = structuredClone(annotation);
  } catch (error) {
    fail(`map annotation must be plain structured-clone-compatible data: ${error instanceof Error ? error.message : String(error)}`);
  }
  const validate = await getSchemaValidator();
  if (!validate(annotation)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    fail(`${inputPath} failed map-annotation schema validation: ${details}`);
  }

  const { width, height } = annotation.coordinateSystem;
  assertUniqueIds(annotation.nodes, "nodes");
  assertUniqueIds(annotation.edges, "edges");
  assertUniqueIds(annotation.regions, "regions");
  const nodes = new Map(annotation.nodes.map((node) => [node.id, node]));
  const endpointPairs = new Set();
  const reviewTargetIds = new Set([
    ...annotation.nodes.map((node) => node.id),
    ...annotation.edges.map((edge) => edge.id),
    ...annotation.regions.map((region) => region.id)
  ]);

  for (const node of annotation.nodes) {
    assertPointInBounds(node.position, width, height, `node "${node.id}"`);
  }
  for (const region of annotation.regions) {
    assertSimpleClosedPolygon(region, width, height);
  }
  if (annotation.status !== "review-draft") {
    for (const node of annotation.nodes) {
      if (!annotation.regions.some((region) => pointInOrOnPolygon(node.position, region.polygon))) {
        fail(`node "${node.id}" is not inside any declared region`);
      }
    }
  }
  for (const edge of annotation.edges) {
    if (!nodes.has(edge.fromNodeId)) fail(`edge "${edge.id}" references missing fromNodeId "${edge.fromNodeId}"`);
    if (!nodes.has(edge.toNodeId)) fail(`edge "${edge.id}" references missing toNodeId "${edge.toNodeId}"`);
    if (edge.fromNodeId === edge.toNodeId) fail(`edge "${edge.id}" cannot connect a node to itself`);
    const key = unorderedEdgeKey(edge.fromNodeId, edge.toNodeId);
    if (endpointPairs.has(key)) fail(`edge "${edge.id}" duplicates an existing endpoint pair ${key}`);
    endpointPairs.add(key);
  }
  for (const issue of annotation.reviewIssues ?? []) {
    for (const targetId of issue.targetIds ?? []) {
      if (!reviewTargetIds.has(targetId)) {
        fail(`review issue "${issue.code ?? issue.message}" references missing targetId "${targetId}"`);
      }
    }
  }

  if (annotation.sourceImage.sha256) {
    const absoluteImagePath = path.resolve(path.dirname(inputPath), annotation.sourceImage.file);
    const digest = createHash("sha256").update(await readFile(absoluteImagePath)).digest("hex");
    if (digest !== annotation.sourceImage.sha256) {
      fail(`source image hash mismatch: expected ${annotation.sourceImage.sha256}, got ${digest}`);
    }
  }
  // The candidate was cloned before validation; freezing it now preserves the
  // exact value that passed every check.
  const validatedSnapshot = deepFreeze(annotation);
  validatedAnnotations.add(validatedSnapshot);
  return validatedSnapshot;
};

const requiredManifestOptionNames = [
  "networkId",
  "visibility",
  "nodeCollection",
  "edgeCollection",
  "terminalObjectType",
  "waypointObjectType",
  "edgeObjectType",
  "nodeStateFacet",
  "edgeStateFacet",
  "builtEdgeState",
  "sequenceEndpoint",
  "initialSequence",
  "allowedAnnotationStatuses"
];

const assertTransportManifestOptions = (options) => {
  if (!options || typeof options !== "object") fail("transport manifest options are required");
  for (const name of requiredManifestOptionNames) {
    if (options[name] === undefined) fail(`transport manifest option "${name}" is required`);
  }
  if (!Array.isArray(options.buildableNodeStates) || !Array.isArray(options.splittableEdgeStates)) {
    fail("transport manifest state allowlists must be arrays");
  }
  const globallyPublishableStatuses = new Set(["mock", "author-confirmed"]);
  if (!Array.isArray(options.allowedAnnotationStatuses) ||
      options.allowedAnnotationStatuses.length === 0 ||
      options.allowedAnnotationStatuses.some((status) => !globallyPublishableStatuses.has(status))) {
    fail("allowedAnnotationStatuses must be a non-empty subset of mock and author-confirmed");
  }
  if (options.roadPlanning !== undefined) {
    if (!options.roadPlanning || typeof options.roadPlanning !== "object" ||
        typeof options.roadPlanning.geometryVersion !== "string" ||
        options.roadPlanning.geometryVersion.length === 0) {
      fail("roadPlanning.geometryVersion is required when automatic planning is enabled");
    }
    if (options.roadPlanning.excludedRegionIdsEndpoint !== undefined &&
        (typeof options.roadPlanning.excludedRegionIdsEndpoint !== "string" ||
          options.roadPlanning.excludedRegionIdsEndpoint.length === 0)) {
      fail("roadPlanning.excludedRegionIdsEndpoint must be a non-empty Mechanics endpoint id");
    }
  }
};

/**
 * Convert a confirmed annotation into generic transport-manifest fields.
 *
 * Costs, state allowlists and object types are required options because they
 * are game rules, not facts inferred from an image. The converter refuses a
 * review draft even when its geometry is technically valid.
 */
export const createTransportManifestFragment = (annotation, options) => {
  if (!annotation || typeof annotation !== "object" || !validatedAnnotations.has(annotation)) {
    fail("manifest fragment requires the immutable annotation snapshot returned by validateMapAnnotation");
  }
  assertTransportManifestOptions(options);
  // Each thin game adapter narrows the global publishable statuses. This keeps
  // mock data out of normative packages and confirmed author data out of the
  // deliberately synthetic mock package.
  if (!options.allowedAnnotationStatuses.includes(annotation.status)) {
    fail(
      `${annotation.status} annotation cannot produce a manifest fragment; ` +
      `this adapter allows only: ${options.allowedAnnotationStatuses.join(", ")}`
    );
  }
  if (annotation.nodes.some((node) => node.state === "unknown") ||
      annotation.edges.some((edge) => edge.state === "unknown")) {
    fail("annotation with unknown runtime states cannot produce a manifest fragment");
  }
  const regions = annotation.regions
    .map((region) => ({ id: region.id, polygon: canonicalPolygon(region.polygon) }))
    .sort((left, right) => compareText(left.id, right.id));
  assertRegionsDoNotOverlap(regions);
  const nodes = Object.fromEntries(annotation.nodes.map((node) => [node.id, {
    objectType: node.kind === "waypoint" ? options.waypointObjectType : options.terminalObjectType,
    facets: { [options.nodeStateFacet]: node.state },
    attributes: {
      networkId: options.networkId,
      label: node.label,
      position: { ...node.position },
      annotationEvidence: node.evidence ?? null
    }
  }]));
  const edges = Object.fromEntries(annotation.edges.map((edge) => {
    const from = nodes[edge.fromNodeId].attributes.position;
    const to = nodes[edge.toNodeId].attributes.position;
    return [edge.id, {
      objectType: options.edgeObjectType,
      facets: { [options.edgeStateFacet]: edge.state },
      attributes: {
        networkId: options.networkId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        geometry: { from: { ...from }, to: { ...to } },
        annotationEvidence: edge.evidence ?? null
      }
    }];
  }));
  return {
    generatedFrom: {
      annotationSchemaVersion: annotation.schemaVersion,
      annotationStatus: annotation.status,
      warning: annotation.warning ?? null,
      sourceImage: { ...annotation.sourceImage },
      coordinateSystem: { ...annotation.coordinateSystem }
    },
    networkModels: {
      [options.networkId]: {
        visibility: options.visibility,
        nodeCollection: options.nodeCollection,
        edgeCollection: options.edgeCollection,
        waypointObjectType: options.waypointObjectType,
        edgeObjectType: options.edgeObjectType,
        nodeStateFacet: options.nodeStateFacet,
        buildableNodeStates: [...options.buildableNodeStates],
        edgeStateFacet: options.edgeStateFacet,
        splittableEdgeStates: [...options.splittableEdgeStates],
        builtEdgeState: options.builtEdgeState,
        sequenceEndpoint: options.sequenceEndpoint,
        // Annotation polygons repeat the first point for human review. Runtime
        // uses a canonical implicit closure so equivalent tracing choices have
        // one hash and replay identity.
        regions,
        ...(options.roadPlanning
          ? { roadPlanning: createRoadPlanningContract(regions, options.roadPlanning, annotation.nodes) }
          : {})
      }
    },
    state: {
      public: {
        transportNetworks: { [options.networkId]: { sequence: options.initialSequence } },
        objects: {
          [options.nodeCollection]: nodes,
          [options.edgeCollection]: edges
        },
        board: {
          canonicalBounds: {
            minX: 0,
            minY: 0,
            maxX: annotation.coordinateSystem.width,
            maxY: annotation.coordinateSystem.height
          }
        }
      }
    }
  };
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

/**
 * Create an SVG review layer without deriving topology or state from pixels.
 * Unknown draft records use amber dashed marks so a reviewer cannot mistake
 * them for accepted roads or stations.
 */
export const createMapAnnotationReviewOverlaySvg = (annotation, options = {}) => {
  if (!annotation || typeof annotation !== "object" || !validatedAnnotations.has(annotation)) {
    fail("review overlay requires the immutable annotation snapshot returned by validateMapAnnotation");
  }
  const { width, height } = annotation.coordinateSystem;
  const backgroundHref = options.backgroundHref;
  if (backgroundHref !== undefined &&
      (typeof backgroundHref !== "string" || backgroundHref.includes("\0") ||
       path.isAbsolute(backgroundHref) || path.win32.isAbsolute(backgroundHref) ||
       /^[a-z][a-z0-9+.-]*:/iu.test(backgroundHref))) {
    fail("review overlay backgroundHref must be a local relative path without a URI scheme");
  }
  const nodes = new Map(annotation.nodes.map((node) => [node.id, node]));
  const regions = annotation.regions.map((region, index) =>
    `<polygon points="${region.polygon.map((point) => `${point.x},${point.y}`).join(" ")}" fill="hsl(${index * 115} 70% 55% / .14)" stroke="hsl(${index * 115} 55% 35%)" stroke-width="4"/>`
  ).join("\n  ");
  const edges = annotation.edges.map((edge) => {
    const from = nodes.get(edge.fromNodeId).position;
    const to = nodes.get(edge.toNodeId).position;
    const unknown = edge.state === "unknown";
    const stroke = unknown ? "#d97706" : edge.state === "blocked" ? "#b83232" : "#263b46";
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="8"${unknown ? ' stroke-dasharray="18 12" data-review-state="unknown"' : ""}/>`;
  }).join("\n  ");
  const nodeShapes = annotation.nodes.map((node) => {
    const unknown = node.state === "unknown";
    const title = node.reviewNote ? `<title>${escapeXml(node.reviewNote)}</title>` : "";
    return `<g${unknown ? ' data-review-state="unknown"' : ""}>${title}<circle cx="${node.position.x}" cy="${node.position.y}" r="18" fill="${unknown ? "#f9c74f" : "#fff3cf"}" stroke="${unknown ? "#9c5310" : "#17252d"}" stroke-width="4"${unknown ? ' stroke-dasharray="7 5"' : ""}/><text x="${node.position.x}" y="${node.position.y - 26}" text-anchor="middle" font-family="sans-serif" font-size="20">${unknown ? "? " : ""}${escapeXml(node.label)}</text></g>`;
  }).join("\n  ");
  const isReviewDraft = annotation.status === "review-draft";
  const issueCount = annotation.reviewIssues?.length ?? 0;
  const header = isReviewDraft
    ? `REVIEW DRAFT: UNCONFIRMED, NOT PUBLISHABLE · ${issueCount} OPEN ISSUE${issueCount === 1 ? "" : "S"}`
    : `${annotation.status.toUpperCase()}: review overlay, not a rules source`;
  const headerMarkup = isReviewDraft
    ? `  <rect x="10" y="8" width="${Math.max(0, width - 20)}" height="72" fill="#ffedd5" stroke="#c2410c" stroke-width="3"/>
  <text x="24" y="38" font-family="sans-serif" font-weight="bold" font-size="24" fill="#a32323">${escapeXml(header)}</text>
  <text x="24" y="68" font-family="sans-serif" font-size="18" fill="#7c2d12">${escapeXml(annotation.warning ?? "Resolve unknown records and review issues before confirmation.")}</text>\n`
    : `  <text x="24" y="38" font-family="sans-serif" font-weight="bold" font-size="24" fill="#a32323">${escapeXml(header)}</text>\n`;
  // Optional empty sections must disappear completely. Emitting indentation
  // for an absent region list creates trailing whitespace in generated review
  // artifacts and makes an otherwise semantic update fail `git diff --check`.
  const sceneMarkup = [regions, edges, nodeShapes]
    .filter((section) => section.length > 0)
    .map((section) => `  ${section}`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f4ead6"/>
  ${backgroundHref ? `<image href="${escapeXml(backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity=".72"/>` : ""}
${headerMarkup}${sceneMarkup}
</svg>\n`;
};

const parseArgs = (argv, commandName) => {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--output", "--overlay"].includes(name) || !value) {
      fail(`Usage: ${commandName} --input FILE [--output FILE] [--overlay FILE]`);
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  if (!options.input) fail("--input is required");
  return options;
};

/**
 * Shared CLI plumbing used by thin game adapters.
 *
 * A review draft can be validated and rendered as an overlay. The fragment
 * factory is called only when --output is requested, where it must enforce
 * the publication gate.
 */
export const runMapAnnotationCli = async ({
  argv = process.argv,
  fragmentFactory,
  commandName = "map-annotation"
}) => {
  const options = parseArgs(argv, commandName);
  const inputPath = path.resolve(options.input);
  const outputPath = options.output ? path.resolve(options.output) : undefined;
  const overlayPath = options.overlay ? path.resolve(options.overlay) : undefined;
  const destinations = [outputPath, overlayPath].filter(Boolean);
  if (destinations.includes(inputPath) || new Set(destinations).size !== destinations.length) {
    fail("input, output and overlay paths must be different files");
  }
  const annotation = await validateMapAnnotation(await readJson(inputPath), inputPath);
  if (options.output) {
    if (typeof fragmentFactory !== "function") fail("fragmentFactory is required when --output is used");
    const fragment = fragmentFactory(annotation);
    await writeFile(outputPath, `${JSON.stringify(fragment, null, 2)}\n`, "utf8");
  }
  if (options.overlay) {
    const imagePath = path.resolve(path.dirname(inputPath), annotation.sourceImage.file);
    const backgroundHref = path.relative(path.dirname(overlayPath), imagePath).split(path.sep).join("/");
    await writeFile(
      overlayPath,
      createMapAnnotationReviewOverlaySvg(annotation, { backgroundHref }),
      "utf8"
    );
  }
  process.stdout.write(
    `map-annotation: OK (${annotation.nodes.length} nodes, ${annotation.edges.length} edges, ${annotation.regions.length} regions)\n`
  );
};
