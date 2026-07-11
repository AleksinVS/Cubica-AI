#!/usr/bin/env node
/**
 * Convert a human-reviewed image annotation into a transport manifest fragment.
 *
 * The JSON Schema checks the portable shape. Cross-reference and geometry
 * checks deliberately remain in this game-local adapter because they compare
 * several records at once. The source image is evidence for an operator; no
 * pixel analysis is allowed to invent gameplay topology or rules.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

const Ajv = AjvImport.default ?? AjvImport;
const scriptFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptFile), "..");
const schemaPath = path.join(packageRoot, "annotations", "map-annotation.schema.json");

const fail = (message) => {
  throw new Error(message);
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const samePoint = (left, right) => left.x === right.x && left.y === right.y;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const unorderedEdgeKey = (left, right) => [left, right].sort().join("::");

const pointOnSegment = (point, start, end) =>
  Math.abs(cross(start, end, point)) < 1e-9 &&
  point.x >= Math.min(start.x, end.x) - 1e-9 &&
  point.x <= Math.max(start.x, end.x) + 1e-9 &&
  point.y >= Math.min(start.y, end.y) - 1e-9 &&
  point.y <= Math.max(start.y, end.y) + 1e-9;

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
  polygon.forEach((point, index) => assertPointInBounds(point, width, height, `region "${region.id}" point ${index}`));
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

/** Validate JSON Schema first, then relationships and geometry. */
export const validateAnnotation = async (annotation, inputPath = "annotation.json") => {
  const schema = await readJson(schemaPath);
  // Ajv strict mode detects misspelled or unsupported schema keywords. The
  // allErrors option gives the person annotating a map one complete correction list.
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
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

  for (const node of annotation.nodes) {
    assertPointInBounds(node.position, width, height, `node "${node.id}"`);
  }
  for (const region of annotation.regions) {
    assertSimpleClosedPolygon(region, width, height);
  }
  for (const node of annotation.nodes) {
    if (!annotation.regions.some((region) => pointInOrOnPolygon(node.position, region.polygon))) {
      fail(`node "${node.id}" is not inside any declared region`);
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

  if (annotation.sourceImage.sha256) {
    const absoluteImagePath = path.resolve(path.dirname(inputPath), annotation.sourceImage.file);
    const digest = createHash("sha256").update(await readFile(absoluteImagePath)).digest("hex");
    if (digest !== annotation.sourceImage.sha256) {
      fail(`source image hash mismatch: expected ${annotation.sourceImage.sha256}, got ${digest}`);
    }
  }
  return annotation;
};

/** Produce only generic manifest fields; no game-id-specific runtime branch is needed. */
export const toManifestFragment = (annotation) => {
  const nodes = Object.fromEntries(annotation.nodes.map((node) => [node.id, {
    objectType: node.kind === "waypoint" ? "transport.waypoint" : "transport.terminal",
    facets: { availability: node.state },
    attributes: {
      networkId: "main",
      label: node.label,
      position: { ...node.position },
      annotationEvidence: node.evidence ?? null
    }
  }]));
  const edges = Object.fromEntries(annotation.edges.map((edge) => {
    const from = nodes[edge.fromNodeId].attributes.position;
    const to = nodes[edge.toNodeId].attributes.position;
    return [edge.id, {
      objectType: "transport.edge",
      facets: { state: edge.state },
      attributes: {
        networkId: "main",
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
      main: {
        visibility: "public",
        nodeCollection: "networkNodes",
        edgeCollection: "networkEdges",
        waypointObjectType: "transport.waypoint",
        edgeObjectType: "transport.edge",
        nodeStateFacet: "availability",
        buildableNodeStates: ["open"],
        edgeStateFacet: "state",
        splittableEdgeStates: ["open", "building"],
        builtEdgeState: "building",
        sequencePath: "/public/transportNetworks/main/sequence",
        roadCostPerRegionSegment: 2,
        waypointCost: 5,
        // The runtime contract closes polygons implicitly; remove the explicit
        // review-only final duplicate point from the annotation.
        regions: annotation.regions.map((region) => ({
          id: region.id,
          polygon: region.polygon.slice(0, -1).map((point) => ({ ...point }))
        }))
      }
    },
    state: {
      public: {
        transportNetworks: { main: { sequence: 1000 } },
        objects: { networkNodes: nodes, networkEdges: edges },
        board: { canonicalBounds: { minX: 0, minY: 0, maxX: annotation.coordinateSystem.width, maxY: annotation.coordinateSystem.height } }
      }
    }
  };
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

/** Create a lightweight review overlay without converting pixels into rules. */
export const toReviewOverlaySvg = (annotation, options = {}) => {
  const { width, height } = annotation.coordinateSystem;
  const backgroundHref = options.backgroundHref;
  if (backgroundHref !== undefined &&
      (typeof backgroundHref !== "string" || backgroundHref.includes("\0") || /^[a-z][a-z0-9+.-]*:/iu.test(backgroundHref))) {
    fail("review overlay backgroundHref must be a local relative path without a URI scheme");
  }
  const nodes = new Map(annotation.nodes.map((node) => [node.id, node]));
  const regions = annotation.regions.map((region, index) =>
    `<polygon points="${region.polygon.map((point) => `${point.x},${point.y}`).join(" ")}" fill="hsl(${index * 115} 70% 55% / .14)" stroke="hsl(${index * 115} 55% 35%)" stroke-width="4"/>`
  ).join("\n  ");
  const edges = annotation.edges.map((edge) => {
    const from = nodes.get(edge.fromNodeId).position;
    const to = nodes.get(edge.toNodeId).position;
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${edge.state === "blocked" ? "#b83232" : "#263b46"}" stroke-width="8"/>`;
  }).join("\n  ");
  const nodeShapes = annotation.nodes.map((node) =>
    `<g><circle cx="${node.position.x}" cy="${node.position.y}" r="18" fill="#fff3cf" stroke="#17252d" stroke-width="4"/><text x="${node.position.x}" y="${node.position.y - 26}" text-anchor="middle" font-family="sans-serif" font-size="20">${escapeXml(node.label)}</text></g>`
  ).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f4ead6"/>
  ${backgroundHref ? `<image href="${escapeXml(backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity=".72"/>` : ""}
  <text x="24" y="38" font-family="sans-serif" font-weight="bold" font-size="24" fill="#a32323">${escapeXml(annotation.status.toUpperCase())}: review overlay, not a rules source</text>
  ${regions}
  ${edges}
  ${nodeShapes}
</svg>\n`;
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--output", "--overlay"].includes(name) || !value) {
      fail("Usage: convert-map-annotation.mjs --input FILE [--output FILE] [--overlay FILE]");
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  if (!options.input) fail("--input is required");
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv);
  const inputPath = path.resolve(options.input);
  const annotation = await validateAnnotation(await readJson(inputPath), inputPath);
  const fragment = toManifestFragment(annotation);
  if (options.output) await writeFile(path.resolve(options.output), `${JSON.stringify(fragment, null, 2)}\n`, "utf8");
  if (options.overlay) {
    const overlayPath = path.resolve(options.overlay);
    const imagePath = path.resolve(path.dirname(inputPath), annotation.sourceImage.file);
    const backgroundHref = path.relative(path.dirname(overlayPath), imagePath).split(path.sep).join("/");
    await writeFile(overlayPath, toReviewOverlaySvg(annotation, { backgroundHref }), "utf8");
  }
  process.stdout.write(`map-annotation: OK (${annotation.nodes.length} nodes, ${annotation.edges.length} edges, ${annotation.regions.length} regions)\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  main().catch((error) => {
    process.stderr.write(`map-annotation: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
