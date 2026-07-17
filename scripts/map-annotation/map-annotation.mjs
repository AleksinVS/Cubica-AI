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

/** Reject ambiguous interior overlaps instead of guessing which region owns them. */
const assertRegionsDoNotOverlap = (regions) => {
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    const leftClosed = closedCanonicalPolygon(left.polygon);
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      const rightClosed = closedCanonicalPolygon(right.polygon);
      const leftSamples = left.polygon.flatMap((point, index) => {
        const next = left.polygon[(index + 1) % left.polygon.length];
        return [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }];
      });
      const rightSamples = right.polygon.flatMap((point, index) => {
        const next = right.polygon[(index + 1) % right.polygon.length];
        return [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }];
      });
      if (JSON.stringify(left.polygon) === JSON.stringify(right.polygon) ||
          leftSamples.some((point) => pointStrictlyInPolygon(point, rightClosed)) ||
          rightSamples.some((point) => pointStrictlyInPolygon(point, leftClosed))) {
        fail(`regions "${left.id}" and "${right.id}" overlap`);
      }
      for (let leftSide = 0; leftSide < left.polygon.length; leftSide += 1) {
        const a = left.polygon[leftSide];
        const b = left.polygon[(leftSide + 1) % left.polygon.length];
        for (let rightSide = 0; rightSide < right.polygon.length; rightSide += 1) {
          const c = right.polygon[rightSide];
          const d = right.polygon[(rightSide + 1) % right.polygon.length];
          if (segmentsProperlyIntersect(a, b, c, d)) {
            fail(`regions "${left.id}" and "${right.id}" cross each other`);
          }
        }
      }
    }
  }
};

const pointAtAxisValue = (start, end, axis, value) => {
  const delta = end[axis] - start[axis];
  const t = Math.abs(delta) < GEOMETRY_EPSILON ? 0 : (value - start[axis]) / delta;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
};

/** Return the positive-length collinear overlap of two boundary sides. */
const sharedBoundaryPart = (a, b, c, d) => {
  if (Math.abs(cross(a, b, c)) >= GEOMETRY_EPSILON ||
      Math.abs(cross(a, b, d)) >= GEOMETRY_EPSILON) return null;
  const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "x" : "y";
  const overlapStart = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const overlapEnd = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  if (overlapEnd - overlapStart <= GEOMETRY_EPSILON) return null;
  const endpoints = [
    pointAtAxisValue(a, b, axis, overlapStart),
    pointAtAxisValue(a, b, axis, overlapEnd)
  ].sort(comparePoint);
  return { from: endpoints[0], to: endpoints[1] };
};

const segmentsAreMergeable = (left, right) =>
  Math.abs(cross(left.from, left.to, right.from)) < GEOMETRY_EPSILON &&
  Math.abs(cross(left.from, left.to, right.to)) < GEOMETRY_EPSILON &&
  (pointOnSegment(left.to, right.from, right.to) ||
    pointOnSegment(right.from, left.from, left.to) ||
    samePoint(left.to, right.from) || samePoint(right.to, left.from));

/**
 * Merge authoring sides into one portal: an exact positive-length border
 * through which the planner may move from one region to its neighbour.
 */
const mergeBoundaryParts = (parts) => {
  const pending = parts
    .map((part) => ({ from: { ...part.from }, to: { ...part.to } }))
    .sort((left, right) => comparePoint(left.from, right.from) || comparePoint(left.to, right.to));
  const merged = [];
  for (const part of pending) {
    const previous = merged.at(-1);
    if (!previous || !segmentsAreMergeable(previous, part)) {
      merged.push(part);
      continue;
    }
    const endpoints = [previous.from, previous.to, part.from, part.to].sort(comparePoint);
    previous.from = endpoints[0];
    previous.to = endpoints.at(-1);
  }
  return merged;
};

/** Compile the finite navigation graph from exact shared polygon boundaries. */
const deriveRegionPortals = (regions) => {
  const portals = [];
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      const parts = [];
      for (let leftSide = 0; leftSide < left.polygon.length; leftSide += 1) {
        const a = left.polygon[leftSide];
        const b = left.polygon[(leftSide + 1) % left.polygon.length];
        for (let rightSide = 0; rightSide < right.polygon.length; rightSide += 1) {
          const c = right.polygon[rightSide];
          const d = right.polygon[(rightSide + 1) % right.polygon.length];
          const shared = sharedBoundaryPart(a, b, c, d);
          if (shared) parts.push(shared);
        }
      }
      mergeBoundaryParts(parts).forEach((part, index) => portals.push({
        id: `portal:${left.id}:${right.id}:${index + 1}`,
        regionIds: [left.id, right.id],
        from: part.from,
        to: part.to
      }));
    }
  }
  return portals.sort((left, right) => compareText(left.id, right.id));
};

const createRoadPlanningContract = (regions, options) => {
  const portals = deriveRegionPortals(regions);
  const algorithmVersion = "region-segment-minimum-v1";
  const boundaryPolicy = "lowest-region-id";
  const geometryHash = createHash("sha256")
    .update(JSON.stringify({ algorithmVersion, boundaryPolicy, regions, portals }))
    .digest("hex");
  return {
    mode: "region-segment-minimum",
    algorithmVersion,
    geometryVersion: options.geometryVersion,
    geometryHash: `sha256:${geometryHash}`,
    tieBreak: "session-random",
    boundaryPolicy,
    ...(options.excludedRegionIdsEndpoint
      ? { excludedRegionIdsEndpoint: options.excludedRegionIdsEndpoint }
      : {}),
    navigationGraph: { portals }
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
          ? { roadPlanning: createRoadPlanningContract(regions, options.roadPlanning) }
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f4ead6"/>
  ${backgroundHref ? `<image href="${escapeXml(backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity=".72"/>` : ""}
${headerMarkup}  ${regions}
  ${edges}
  ${nodeShapes}
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
