/** Focused content invariants for the unconfirmed initial-network intake. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  toManifestFragment,
  toReviewOverlaySvg,
  validateAnnotation
} from "./convert-map-annotation.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const annotationPath = path.resolve(
  toolsRoot,
  "..",
  "annotations",
  "initial-network.review.json"
);

const readAnnotation = async () =>
  JSON.parse(await readFile(annotationPath, "utf8"));

test("initial network review draft preserves the extracted topology without publishing it", async () => {
  const annotation = await validateAnnotation(await readAnnotation(), annotationPath);
  const nodeIds = new Set(annotation.nodes.map((node) => node.id));
  const connectedNodeIds = new Set(
    annotation.edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId])
  );

  assert.equal(annotation.status, "review-draft");
  assert.deepEqual(annotation.coordinateSystem, {
    origin: "top-left",
    units: "design-pixel",
    width: 5079,
    height: 3627
  });
  assert.equal(annotation.nodes.length, 25);
  assert.equal(annotation.edges.length, 10);
  assert.equal(annotation.regions.length, 0);
  assert.deepEqual(
    annotation.reviewIssues.map((issue) => issue.code),
    ["confirm-overlay-alignment"]
  );
  assert.equal(connectedNodeIds.size, 11);

  for (let number = 1; number <= 23; number += 1) {
    assert.equal(nodeIds.has(`terminal-${number}`), true);
  }
  assert.equal(nodeIds.has("terminal-3-14"), true);
  assert.equal(nodeIds.has("waypoint-9-3-4"), true);
  assert.equal(
    annotation.nodes.find((node) => node.id === "terminal-3-14")?.kind,
    "terminal"
  );
  assert.equal(
    annotation.nodes.find((node) => node.id === "waypoint-9-3-4")?.kind,
    "waypoint"
  );
  assert.equal(
    annotation.edges.some((edge) =>
      edge.id === "road-3-3-14" &&
      edge.fromNodeId === "terminal-3" &&
      edge.toNodeId === "terminal-3-14"),
    true
  );
  assert.equal(annotation.nodes.every((node) => node.state === "open"), true);
  assert.equal(annotation.edges.every((edge) => edge.state === "open"), true);

  assert.throws(
    () => toManifestFragment(annotation),
    /review-draft annotation cannot produce a manifest fragment/
  );
  assert.match(
    toReviewOverlaySvg(annotation),
    /REVIEW DRAFT: UNCONFIRMED, NOT PUBLISHABLE · 1 OPEN ISSUE/
  );
});

test("normative adapter rejects mock data even after common validation", async () => {
  const neutralMockPath = path.resolve(
    toolsRoot,
    "..",
    "..",
    "..",
    "scripts",
    "map-annotation",
    "fixtures",
    "neutral-map-annotation.json"
  );
  const source = JSON.parse(await readFile(neutralMockPath, "utf8"));
  const annotation = await validateAnnotation(source, neutralMockPath);
  assert.throws(
    () => toManifestFragment(annotation),
    /mock annotation cannot produce a manifest fragment/
  );
});
