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

// road-planning contracts (ADR-100) no longer expose their navigation graph —
// only the region polygons and a checksum are published, and the graph is
// re-derived from them. These two functions are imported directly, the same
// way map-annotation.mjs itself imports them, so tests can inspect the
// crossings a fragment implies without the production code needing to expose
// them anywhere in its own output.
import {
  canonicalizeRoadPlanningRegions,
  deriveRegionCrossings
} from "../../services/runtime-api/src/modules/runtime/regionRoadGeometry.ts";

/** Total length of a polyline, used to check a crossing spans a whole border. */
const chainLength = (chain) => chain
  .slice(0, -1)
  .reduce((sum, point, index) => sum + Math.hypot(chain[index + 1].x - point.x, chain[index + 1].y - point.y), 0);

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
  sequenceEndpoint: "public.transportNetworks.neutral.sequence",
  roadPlanning: {
    geometryVersion: "neutral-regions-v1",
    excludedRegionIdsEndpoint: "public.transportNetworks.neutral.excludedRegionIds"
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

  assert.equal(Object.hasOwn(fragment.networkModels.neutral, "roadCostPerRegionSegment"), false);
  assert.equal(Object.hasOwn(fragment.networkModels.neutral, "waypointCost"), false);
  assert.equal(fragment.state.public.transportNetworks.neutral.sequence, 10);
  assert.equal(
    fragment.state.public.objects.networkNodes["neutral-node-west"].objectType,
    "transport.terminal"
  );
  assert.equal(fragment.networkModels.neutral.regions[0].polygon.length, 4);
  assert.equal(fragment.networkModels.neutral.roadPlanning.mode, "region-segment-minimum");
  assert.match(fragment.networkModels.neutral.roadPlanning.geometryHash, /^sha256:[0-9a-f]{64}$/u);
});

test("automatic planning derives stable positive shared-boundary crossings", async () => {
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

  // Equivalent authoring order and winding must compile to the same hash,
  // otherwise replay would depend on an editor-only detail. The navigation
  // graph itself is not stored (ADR-100 § 4.3), so the check below re-derives
  // crossings from each fragment's own published `regions` field with the
  // shared runtime module and compares those instead of a stored graph.
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
  const crossingsOf = (fragment) =>
    deriveRegionCrossings(canonicalizeRoadPlanningRegions(fragment.networkModels.neutral.regions));
  assert.deepEqual(crossingsOf(second), crossingsOf(first));
  assert.deepEqual(crossingsOf(first), [{
    id: "crossing:neutral-region-east:neutral-region-west:1",
    regionIds: ["neutral-region-east", "neutral-region-west"],
    chain: [
      { x: 320, y: 80 },
      { x: 320, y: 420 }
    ]
  }]);
});

test("the emitted roadPlanning contract carries no navigationGraph key", async () => {
  // ADR-100 § 4.3: the graph is derived at load time, not published. A key
  // that silently reappeared here — even accidentally, e.g. from a merge or a
  // copy-pasted branch — would resurrect the exact duplication the migration
  // to region-segment-minimum-v2 was meant to remove.
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const annotation = await validateMapAnnotation(
    await readFixture("neutral-map-annotation.json"),
    inputPath
  );
  const fragment = createTransportManifestFragment(annotation, neutralManifestOptions);
  assert.equal(Object.hasOwn(fragment.networkModels.neutral.roadPlanning, "navigationGraph"), false);
  assert.deepEqual(Object.keys(fragment.networkModels.neutral.roadPlanning).sort(), [
    "algorithmVersion",
    "boundaryPolicy",
    "excludedRegionIdsEndpoint",
    "geometryHash",
    "geometryVersion",
    "mode",
    "tieBreak"
  ]);
});

test("a bent shared border becomes exactly one crossing spanning its whole length", async () => {
  // Two regions meeting along a five-step staircase instead of one straight
  // line. Version 1 (region-segment-minimum-v1) reported one portal per
  // straight piece — five here — and had to try their combinations; version 2
  // reports the whole border as a single crossing (ADR-100 § 4.2). The
  // network nodes are moved into these two regions so validation's "every
  // node sits in some region" gate still passes; this test cares only about
  // the region shapes, not the network.
  const steps = 5;
  const unit = 10;
  const border = [];
  for (let step = 0; step <= steps; step += 1) border.push({ x: 10 + step, y: step * unit });
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.nodes[0].position = { x: 2, y: steps * unit - 5 };
  source.nodes[1].position = { x: 30, y: steps * unit - 5 };
  source.regions = [
    {
      id: "staircase-west",
      label: "West of the staircase",
      countryId: "neutral-country",
      polygon: [{ x: 0, y: 0 }, ...border, { x: 0, y: steps * unit }, { x: 0, y: 0 }],
      evidence: "Bent-border fixture"
    },
    {
      id: "staircase-east",
      label: "East of the staircase",
      countryId: "neutral-country",
      polygon: [
        { x: 40, y: 0 }, { x: 40, y: steps * unit },
        ...[...border].reverse(), { x: 40, y: 0 }
      ],
      evidence: "Bent-border fixture"
    }
  ];
  const fragment = createTransportManifestFragment(
    await validateMapAnnotation(source, inputPath),
    neutralManifestOptions
  );
  const crossings = deriveRegionCrossings(
    canonicalizeRoadPlanningRegions(fragment.networkModels.neutral.regions)
  );
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].chain.length, steps + 1, "the chain keeps every step of the border");
  assert.equal(chainLength(crossings[0].chain), Math.hypot(1, unit) * steps,
    "the crossing spans the whole staircase, not one step of it");
});

test("two regions touching in two separate places produce two crossings", async () => {
  // A C-shaped bracket and the bar that closes it touch along the top arm and
  // along the bottom arm, with a gap between the arms. Those are two distinct
  // borders, so two crossings — collapsing them into one would claim a
  // passage straight across the gap, which the map does not have.
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.nodes[0].position = { x: 2, y: 2 };
  source.nodes[1].position = { x: 23, y: 10 };
  source.regions = [
    {
      id: "bracket",
      label: "Bracket",
      countryId: "neutral-country",
      polygon: [
        { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 4 }, { x: 6, y: 4 },
        { x: 6, y: 16 }, { x: 20, y: 16 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }
      ],
      evidence: "Two-crossings fixture"
    },
    {
      id: "bar",
      label: "Bar",
      countryId: "neutral-country",
      polygon: [
        { x: 20, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 20 }, { x: 20, y: 20 },
        { x: 20, y: 16 }, { x: 20, y: 4 }, { x: 20, y: 0 }
      ],
      evidence: "Two-crossings fixture"
    }
  ];
  const fragment = createTransportManifestFragment(
    await validateMapAnnotation(source, inputPath),
    neutralManifestOptions
  );
  const crossings = deriveRegionCrossings(
    canonicalizeRoadPlanningRegions(fragment.networkModels.neutral.regions)
  );
  assert.equal(crossings.length, 2);
  const lengths = crossings.map((crossing) => chainLength(crossing.chain)).sort((left, right) => left - right);
  assert.deepEqual(lengths, [4, 4], "each arm contributes its own four-unit border");
});

test("planning scales to a map of many regions without changing its answer", async () => {
  // A real author map turned out to hold nine hundred areas, which used to be
  // impossible: comparing every pair of regions and every pair of their sides
  // is quadratic. The pairwise work is now filtered spatially, and this test
  // fixes both halves of the claim — that such a map compiles at all, and that
  // filtering did not change the result.
  //
  // A plain grid is used on purpose: its complete set of borders follows from
  // the shape of the map, so the expectation below is independent of the code
  // that derives them.
  // The grid covers the whole neutral plane, so both fixture nodes fall inside
  // a cell: a node outside every region is a different failure than the one
  // this test is about.
  const columns = 32;
  const rows = 24;
  const size = 20;
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.regions = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const left = column * size;
      const top = row * size;
      source.regions.push({
        id: `neutral-region-${String(column).padStart(3, "0")}-${String(row).padStart(3, "0")}`,
        label: `Cell ${column}-${row}`,
        countryId: "neutral-country",
        polygon: [
          { x: left, y: top },
          { x: left + size, y: top },
          { x: left + size, y: top + size },
          { x: left, y: top + size },
          { x: left, y: top }
        ],
        evidence: "Neutral exact region"
      });
    }
  }

  const fragment = createTransportManifestFragment(
    await validateMapAnnotation(source, inputPath),
    neutralManifestOptions
  );
  const crossings = deriveRegionCrossings(
    canonicalizeRoadPlanningRegions(fragment.networkModels.neutral.regions)
  );

  assert.equal(fragment.networkModels.neutral.regions.length, columns * rows);
  // Side-by-side cells share one border; cells meeting at a corner share none.
  // A grid cell's border with its neighbour is one straight side, so each
  // crossing here is also exactly one border — the count is unaffected by the
  // move from portals (v1) to crossings (v2, ADR-100 § 4.2).
  assert.equal(crossings.length, columns * (rows - 1) + (columns - 1) * rows);
  for (const crossing of crossings) {
    assert.equal(crossing.chain.length, 2, "a border between two grid cells is one straight piece");
    const [from, to] = crossing.chain;
    const horizontal = from.y === to.y;
    const vertical = from.x === to.x;
    assert.ok(horizontal !== vertical);
  }
});

test("regions split into islands cannot produce a manifest fragment", async () => {
  // The first real author map failed exactly this way: a strip of space that
  // belonged to no region ran along every country border, so regions on either
  // side were not neighbours and the navigation graph fell apart. Nothing
  // noticed, because each region on its own was valid.
  //
  // Here the two network nodes sit in two squares separated by a one-pixel
  // strip. Every region is valid, they do not overlap, and they touch nothing —
  // exactly the shape of the real fault.
  const inputPath = path.join(fixtureRoot, "neutral-map-annotation.json");
  const source = await readFixture("neutral-map-annotation.json");
  source.regions = [
    {
      id: "neutral-region-west",
      label: "West",
      countryId: "neutral-country",
      polygon: [
        { x: 40, y: 80 }, { x: 319, y: 80 }, { x: 319, y: 420 },
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
  const annotation = await validateMapAnnotation(source, inputPath);

  assert.throws(
    () => createTransportManifestFragment(annotation, neutralManifestOptions),
    /separate region islands/u
  );
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
  const crossings = deriveRegionCrossings(
    canonicalizeRoadPlanningRegions(fragment.networkModels.neutral.regions)
  );
  assert.deepEqual(crossings, []);
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
