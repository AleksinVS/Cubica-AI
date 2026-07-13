/** Focused, game-neutral tests for the shared schema-first map intake. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMapAnnotationReviewOverlaySvg,
  createTransportManifestFragment,
  runMapAnnotationCli,
  validateMapAnnotation
} from "./map-annotation.mjs";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = async (name) =>
  JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));

const neutralManifestOptions = Object.freeze({
  networkId: "neutral",
  visibility: "public",
  nodeCollection: "networkNodes",
  edgeCollection: "networkEdges",
  terminalObjectType: "transport.terminal",
  waypointObjectType: "transport.waypoint",
  edgeObjectType: "transport.edge",
  nodeStateFacet: "availability",
  buildableNodeStates: ["open"],
  edgeStateFacet: "state",
  splittableEdgeStates: ["open", "building"],
  builtEdgeState: "building",
  sequencePath: "/public/transportNetworks/neutral/sequence",
  roadCostPerRegionSegment: 1,
  waypointCost: 1,
  roadPlanning: {
    geometryVersion: "neutral-regions-v1",
    excludedRegionIdsPath: "/public/transportNetworks/neutral/excludedRegionIds"
  },
  initialSequence: 10,
  allowedAnnotationStatuses: ["mock"]
});

test("strict neutral annotation validates and creates a configured fragment", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const annotation = await validateMapAnnotation(
    await readFixture("neutral-map-annotation.json"),
    inputPath
  );
  const fragment = createTransportManifestFragment(annotation, neutralManifestOptions);

  assert.equal(fragment.networkModels.neutral.roadCostPerRegionSegment, 1);
  assert.equal(fragment.state.public.transportNetworks.neutral.sequence, 10);
  assert.equal(
    fragment.state.public.objects.networkNodes["neutral-node-west"].objectType,
    "transport.terminal"
  );
  assert.equal(fragment.networkModels.neutral.regions[0].polygon.length, 4);
  assert.equal(fragment.networkModels.neutral.roadPlanning.mode, "region-segment-minimum");
  assert.match(fragment.networkModels.neutral.roadPlanning.geometryHash, /^sha256:[0-9a-f]{64}$/u);
});

test("automatic planning derives stable positive shared-boundary portals", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.regions = [
    {
      id: "neutral-region-west",
      label: "West",
      countryId: "neutral-country",
      polygon: [
        { x: 40, y: 80 }, { x: 320, y: 80 }, { x: 320, y: 420 },
        { x: 40, y: 420 }, { x: 40, y: 80 }
      ],
      evidence: "Neutral exact region"
    },
    {
      id: "neutral-region-east",
      label: "East",
      countryId: "neutral-country",
      polygon: [
        { x: 320, y: 80 }, { x: 600, y: 80 }, { x: 600, y: 420 },
        { x: 320, y: 420 }, { x: 320, y: 80 }
      ],
      evidence: "Neutral exact region"
    }
  ];
  const first = createTransportManifestFragment(
    await validateMapAnnotation(source, inputPath),
    neutralManifestOptions
  );

  // Equivalent authoring order and winding must compile to the same hash and
  // navigation graph, otherwise replay would depend on an editor-only detail.
  const reordered = structuredClone(source);
  reordered.regions.reverse();
  for (const region of reordered.regions) {
    const open = region.polygon.slice(0, -1).reverse();
    region.polygon = [...open, open[0]];
  }
  const second = createTransportManifestFragment(
    await validateMapAnnotation(reordered, inputPath),
    neutralManifestOptions
  );

  assert.equal(
    second.networkModels.neutral.roadPlanning.geometryHash,
    first.networkModels.neutral.roadPlanning.geometryHash
  );
  assert.deepEqual(
    second.networkModels.neutral.roadPlanning.navigationGraph,
    first.networkModels.neutral.roadPlanning.navigationGraph
  );
  assert.deepEqual(first.networkModels.neutral.roadPlanning.navigationGraph.portals, [{
    id: "portal:neutral-region-east:neutral-region-west:1",
    regionIds: ["neutral-region-east", "neutral-region-west"],
    from: { x: 320, y: 80 },
    to: { x: 320, y: 420 }
  }]);
});

test("automatic planning rejects overlapping regions and ignores point-only contact", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.regions.push({
    id: "overlap",
    label: "Overlap",
    countryId: "neutral-country",
    polygon: [
      { x: 300, y: 200 }, { x: 620, y: 200 }, { x: 620, y: 460 },
      { x: 300, y: 460 }, { x: 300, y: 200 }
    ],
    evidence: "Negative fixture"
  });
  const overlapping = await validateMapAnnotation(source, inputPath);
  assert.throws(
    () => createTransportManifestFragment(overlapping, neutralManifestOptions),
    /regions .* overlap/
  );

  const touching = await readFixture("neutral-map-annotation.json");
  touching.regions.push({
    id: "point-contact",
    label: "Point contact",
    countryId: "neutral-country",
    polygon: [
      { x: 600, y: 420 }, { x: 630, y: 420 }, { x: 630, y: 450 },
      { x: 600, y: 450 }, { x: 600, y: 420 }
    ],
    evidence: "Point-only adjacency fixture"
  });
  const fragment = createTransportManifestFragment(
    await validateMapAnnotation(touching, inputPath),
    neutralManifestOptions
  );
  assert.deepEqual(fragment.networkModels.neutral.roadPlanning.navigationGraph.portals, []);
});

test("review draft accepts independent network intake but cannot be published", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-review-draft.json");
  const annotation = await validateMapAnnotation(
    await readFixture("neutral-map-review-draft.json"),
    inputPath
  );

  assert.equal(annotation.regions.length, 0);
  assert.equal(annotation.nodes[1].state, "unknown");
  assert.throws(
    () => createTransportManifestFragment(annotation, neutralManifestOptions),
    /review-draft annotation cannot produce a manifest fragment/
  );

  const overlay = createMapAnnotationReviewOverlaySvg(annotation, {
    backgroundHref: "fixtures/neutral-map.svg"
  });
  assert.match(overlay, /REVIEW DRAFT: UNCONFIRMED, NOT PUBLISHABLE/);
  assert.match(overlay, /data-review-state="unknown"/);
  assert.match(overlay, /stroke-dasharray="18 12"/);
});

test("template status fails closed instead of producing runtime content", async () => {
  const source = await readFixture("neutral-map-annotation.json");
  source.status = "template";
  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-annotation.json")
  );

  assert.throws(
    () => createTransportManifestFragment(annotation, neutralManifestOptions),
    /template annotation cannot produce a manifest fragment/
  );
});

test("game adapter policy can reject a different globally publishable status", async () => {
  const source = await readFixture("neutral-map-annotation.json");
  source.status = "author-confirmed";
  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-annotation.json")
  );

  assert.throws(
    () => createTransportManifestFragment(annotation, neutralManifestOptions),
    /author-confirmed annotation cannot produce a manifest fragment/
  );
});

test("fragment factory accepts only the immutable snapshot returned by validation", async () => {
  const source = await readFixture("neutral-map-annotation.json");
  assert.throws(
    () => createTransportManifestFragment(source, neutralManifestOptions),
    /requires the immutable annotation snapshot/
  );

  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-annotation.json")
  );
  assert.notEqual(annotation, source);
  assert.equal(Object.isFrozen(annotation), true);
  assert.equal(Object.isFrozen(annotation.nodes[0]), true);
  assert.throws(
    () => { annotation.nodes[0].label = "Changed after validation"; },
    TypeError
  );
  assert.throws(
    () => createTransportManifestFragment(structuredClone(annotation), neutralManifestOptions),
    /requires the immutable annotation snapshot/
  );
});

test("validation snapshots caller getters before running any checks", async () => {
  const source = await readFixture("neutral-map-review-draft.json");
  let statusReads = 0;
  Object.defineProperty(source, "status", {
    enumerable: true,
    get() {
      statusReads += 1;
      return statusReads === 1 ? "review-draft" : "author-confirmed";
    }
  });

  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-review-draft.json")
  );
  assert.equal(statusReads, 1);
  assert.equal(annotation.status, "review-draft");
});

test("publishable statuses cannot retain unresolved review issues", async () => {
  const source = await readFixture("neutral-map-annotation.json");
  source.reviewIssues = [{ message: "Still unresolved" }];
  await assert.rejects(
    validateMapAnnotation(source, path.join(fixtureRoot, "neutral-map-annotation.json")),
    /must NOT have more than 0 items/
  );
});

test("strict statuses retain regions and known-state gates", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");

  const withoutRegions = structuredClone(source);
  withoutRegions.regions = [];
  await assert.rejects(
    validateMapAnnotation(withoutRegions, inputPath),
    /must NOT have fewer than 1 items/
  );

  const unknownState = structuredClone(source);
  unknownState.nodes[0].state = "unknown";
  await assert.rejects(
    validateMapAnnotation(unknownState, inputPath),
    /must be equal to one of the allowed values/
  );
});

test("semantic checks reject broken references and invalid geometry", async () => {
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");

  const dangling = structuredClone(source);
  dangling.edges[0].toNodeId = "missing-node";
  await assert.rejects(validateMapAnnotation(dangling, inputPath), /missing toNodeId/);

  const outside = structuredClone(source);
  outside.nodes[0].position.x = 99999;
  await assert.rejects(validateMapAnnotation(outside, inputPath), /outside/);

  const crossed = structuredClone(source);
  crossed.regions[0].polygon = [
    { x: 50, y: 50 },
    { x: 400, y: 400 },
    { x: 50, y: 400 },
    { x: 350, y: 50 },
    { x: 50, y: 50 }
  ];
  await assert.rejects(validateMapAnnotation(crossed, inputPath), /self-intersects/);
});

test("overlay rejects remote background references", async () => {
  const source = await readFixture("neutral-map-annotation.json");
  assert.throws(
    () => createMapAnnotationReviewOverlaySvg(source),
    /requires the immutable annotation snapshot/
  );
  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-annotation.json")
  );
  assert.throws(
    () => createMapAnnotationReviewOverlaySvg(annotation, {
      backgroundHref: "https://example.invalid/map.png"
    }),
    /local relative path/
  );
  assert.throws(
    () => createMapAnnotationReviewOverlaySvg(annotation, {
      backgroundHref: "/tmp/map.png"
    }),
    /local relative path/
  );
});

test("review draft supports an independent region-only intake", async () => {
  const source = await readFixture("neutral-map-review-draft.json");
  source.nodes = [];
  source.edges = [];
  source.reviewIssues = [];
  source.regions = [{
    id: "neutral-region-candidate",
    label: "Candidate",
    countryId: "neutral-country",
    polygon: [
      { x: 40, y: 80 },
      { x: 600, y: 80 },
      { x: 600, y: 420 },
      { x: 40, y: 420 },
      { x: 40, y: 80 }
    ],
    confidence: 0.5,
    reviewNote: "Confirm semantic ownership."
  }];
  const annotation = await validateMapAnnotation(
    source,
    path.join(fixtureRoot, "neutral-map-review-draft.json")
  );
  assert.equal(annotation.nodes.length, 0);
  assert.equal(annotation.regions.length, 1);
});

test("review issue targets and CLI destinations fail closed", async () => {
  const source = await readFixture("neutral-map-review-draft.json");
  source.reviewIssues[0].targetIds = ["missing-target"];
  await assert.rejects(
    validateMapAnnotation(source, path.join(fixtureRoot, "neutral-map-review-draft.json")),
    /references missing targetId/
  );

  const inputPath = path.join(fixtureRoot, "neutral-map-review-draft.json");
  await assert.rejects(
    runMapAnnotationCli({
      argv: ["node", "map-annotation", "--input", inputPath, "--overlay", inputPath],
      commandName: "map-annotation"
    }),
    /must be different files/
  );
});
