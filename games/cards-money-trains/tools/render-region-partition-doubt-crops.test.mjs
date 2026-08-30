/**
 * Focused checks for the region-partition doubt-crop renderer.
 *
 * These tests deliberately avoid the real 8 MB region-partition draft and the
 * real 5079×3627 author raster (rendering dozens of real crops would be slow
 * and would tie the suite to whatever the draft currently contains). Instead
 * they build a tiny synthetic raster and a tiny synthetic draft in a
 * temporary directory under `.tmp/` (see the repository's temporary-files
 * rule in the root `CLAUDE.md`) and exercise the same code path the real CLI
 * run uses.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  buildCropOverlaySvg,
  buildDoubtCrops,
  buildIndexMarkdown,
  computeCropWindow,
  computeNumericStats,
  computeStateBorderEdges,
  countryNamesForDoubt,
  describeForeignAreaPopulation,
  selectDoubtsForCrop
} from "./render-region-partition-doubt-crops.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "..", "..", "..");

// ---------------------------------------------------------------------------
// Pure helpers: selection ordering and crop-window clamping. No files needed.
// ---------------------------------------------------------------------------

test("selection picks the largest --limit records by the given metric field and breaks ties by id", () => {
  const doubts = [
    { id: "doubt-0010", foreignAreaPx2: 30.0 },
    { id: "doubt-0001", foreignAreaPx2: 50.0 },
    { id: "doubt-0002", foreignAreaPx2: 50.0 }, // exact tie with doubt-0001
    { id: "doubt-0003", foreignAreaPx2: 45.0 },
    { id: "doubt-0004", foreignAreaPx2: 10.0 }
  ];

  const top3 = selectDoubtsForCrop(doubts, 3, "foreignAreaPx2");
  assert.deepEqual(top3.map((doubt) => doubt.id), ["doubt-0001", "doubt-0002", "doubt-0003"]);

  // Ties broken by id (ascending) regardless of the input order, so two runs
  // over the same data always agree on which record comes first.
  const reversedInput = [...doubts].reverse();
  const top3FromReversed = selectDoubtsForCrop(reversedInput, 3, "foreignAreaPx2");
  assert.deepEqual(top3FromReversed.map((doubt) => doubt.id), ["doubt-0001", "doubt-0002", "doubt-0003"]);

  // Limit larger than the population just returns everything, still sorted.
  const all = selectDoubtsForCrop(doubts, 100, "foreignAreaPx2");
  assert.equal(all.length, doubts.length);
  assert.deepEqual(all.map((doubt) => doubt.id), [
    "doubt-0001", "doubt-0002", "doubt-0003", "doubt-0010", "doubt-0004"
  ]);

  // The metric field is a parameter, not a hardcoded assumption: sorting the
  // same records by a different field gives a different order.
  const byWidth = selectDoubtsForCrop(
    [{ id: "a", foreignAreaPx2: 1, effectiveWidthPx: 9 }, { id: "b", foreignAreaPx2: 2, effectiveWidthPx: 1 }],
    2,
    "effectiveWidthPx"
  );
  assert.deepEqual(byWidth.map((doubt) => doubt.id), ["a", "b"]);
});

test("crop window is clamped at the raster edges and never negative", () => {
  const rasterWidth = 100;
  const rasterHeight = 80;

  // Doubt sitting exactly at the top-left corner of the raster.
  const nearOrigin = computeCropWindow(0, 0, 40, rasterWidth, rasterHeight);
  assert.ok(nearOrigin.x >= 0 && nearOrigin.y >= 0);
  assert.ok(nearOrigin.x + nearOrigin.width <= rasterWidth);
  assert.ok(nearOrigin.y + nearOrigin.height <= rasterHeight);

  // Doubt sitting exactly at the bottom-right corner.
  const nearFarCorner = computeCropWindow(rasterWidth, rasterHeight, 40, rasterWidth, rasterHeight);
  assert.ok(nearFarCorner.x + nearFarCorner.width <= rasterWidth);
  assert.ok(nearFarCorner.y + nearFarCorner.height <= rasterHeight);
  assert.ok(nearFarCorner.x >= 0 && nearFarCorner.y >= 0);

  // A window wider than the whole raster must fall back to the raster size,
  // not overflow it or go negative.
  const oversized = computeCropWindow(50, 40, 1000, rasterWidth, rasterHeight);
  assert.equal(oversized.width, rasterWidth);
  assert.equal(oversized.height, rasterHeight);
  assert.equal(oversized.x, 0);
  assert.equal(oversized.y, 0);

  // A doubt comfortably inside the raster gets a window centred on it.
  const centred = computeCropWindow(50, 40, 20, rasterWidth, rasterHeight);
  assert.equal(centred.width, 20);
  assert.equal(centred.height, 20);
  assert.equal(centred.x, 40);
  assert.equal(centred.y, 30);
});

test("state-border derivation on a 2x2 block is exactly the middle seam and the outer rim", () => {
  // Four 10x10 squares tiled 2x2: the left column belongs to country A, the
  // right column to country B. The only cross-country seam is the vertical
  // line x=10 (split into two edges, one per row); every other internal edge
  // (the horizontal seam at y=10 inside each country) must NOT be treated as
  // a state border, only as a plain region boundary. The whole perimeter of
  // the 20x20 block is the outer rim, which also counts as state border.
  const regions = [
    {
      id: "region-a-top", countryId: "country-a",
      exteriorRing: [[0, 0], [10, 0], [10, 10], [0, 10]]
    },
    {
      id: "region-a-bottom", countryId: "country-a",
      exteriorRing: [[0, 10], [10, 10], [10, 20], [0, 20]]
    },
    {
      id: "region-b-top", countryId: "country-b",
      exteriorRing: [[10, 0], [20, 0], [20, 10], [10, 10]]
    },
    {
      id: "region-b-bottom", countryId: "country-b",
      exteriorRing: [[10, 10], [20, 10], [20, 20], [10, 20]]
    }
  ];

  const edgeSetKey = (p1, p2) => {
    const a = p1.join(",");
    const b = p2.join(",");
    return a < b ? `${a}/${b}` : `${b}/${a}`;
  };

  const stateBorderEdges = computeStateBorderEdges(regions);
  const actualKeys = new Set(stateBorderEdges.map((edge) => edgeSetKey(edge.p1, edge.p2)));

  const middleSeam = [edgeSetKey([10, 0], [10, 10]), edgeSetKey([10, 10], [10, 20])];
  const outerRim = [
    edgeSetKey([0, 0], [10, 0]), edgeSetKey([0, 0], [0, 10]), edgeSetKey([0, 10], [0, 20]),
    edgeSetKey([0, 20], [10, 20]), edgeSetKey([10, 0], [20, 0]), edgeSetKey([20, 0], [20, 10]),
    edgeSetKey([20, 10], [20, 20]), edgeSetKey([20, 20], [10, 20])
  ];
  const internalSameCountrySeams = [edgeSetKey([0, 10], [10, 10]), edgeSetKey([10, 10], [20, 10])];

  const expectedKeys = new Set([...middleSeam, ...outerRim]);
  assert.deepEqual(actualKeys, expectedKeys);
  assert.equal(stateBorderEdges.length, 10);
  for (const seam of internalSameCountrySeams) {
    assert.ok(!actualKeys.has(seam), `same-country seam ${seam} must not be a state border`);
  }
});

test("state-border derivation fails loudly when an edge is shared by more than two regions", () => {
  // A degenerate/non-planar input: three regions all claim the same edge.
  // This must never happen in a real planar partition (an interior edge
  // borders at most two faces), so the tool refuses to guess instead of
  // silently drawing something misleading.
  const regions = [
    { id: "region-1", countryId: "country-a", exteriorRing: [[0, 0], [10, 0], [10, 10], [0, 10]] },
    { id: "region-2", countryId: "country-b", exteriorRing: [[10, 10], [10, 0], [20, 0], [20, 10]] },
    { id: "region-3", countryId: "country-c", exteriorRing: [[10, 0], [10, 10], [30, 10], [30, 0]] }
  ];
  assert.throws(() => computeStateBorderEdges(regions), /not a valid planar partition/);
});

// ---------------------------------------------------------------------------
// Country names: touchingCountryIds is gone from the schema. One side comes
// from mergedIntoRegionId, the other is recovered by testing the sliver's own
// outline against each country's author fill polygon.
// ---------------------------------------------------------------------------

test("country names for a border-gap doubt come from mergedIntoRegionId plus the outline's own fill test", () => {
  const regions = [
    {
      id: "map-region-0001", countryId: "cmt-country-a", countryName: "Страна А",
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 60 },
      exteriorRing: [[0, 0], [30, 0], [30, 60], [0, 60]]
    },
    {
      id: "map-region-0002", countryId: "cmt-country-b", countryName: "Страна Б",
      bounds: { minX: 30, minY: 0, maxX: 60, maxY: 60 },
      exteriorRing: [[30, 0], [60, 0], [60, 60], [30, 60]]
    }
  ];
  const countries = [
    { name: "Страна А", contour: [[[0, 0], [30, 0], [30, 60], [0, 60]]] },
    { name: "Страна Б", contour: [[[30, 0], [60, 0], [60, 60], [30, 60]]] }
  ];

  // Outline straddles the seam (x=30): part of it sits in A's fill, part in
  // B's — but the strip was merged into region 0001 (country A).
  const borderGapDoubt = {
    id: "doubt-0001", kind: "country-border-gap-merged", atX: 30, atY: 30,
    outline: [[28, 25], [34, 25], [34, 35], [28, 35]],
    mergedIntoRegionId: "map-region-0001"
  };
  assert.equal(countryNamesForDoubt(borderGapDoubt, regions, countries), "Страна А / Страна Б");

  // If the outline never touches a second country's fill (e.g. it sits
  // entirely inside the merge destination's own territory), only one name
  // comes back — that is an honest answer, not a bug.
  const oneSidedDoubt = {
    id: "doubt-0002", kind: "country-border-gap-merged", atX: 10, atY: 30,
    outline: [[9, 29], [11, 29], [11, 31], [9, 31]],
    mergedIntoRegionId: "map-region-0001"
  };
  assert.equal(countryNamesForDoubt(oneSidedDoubt, regions, countries), "Страна А");

  // Kinds without mergedIntoRegionId/outline (e.g. every kind except
  // country-border-gap-merged) fall back to whichever region contains the
  // doubt's own point.
  const otherKindDoubt = { id: "doubt-0003", kind: "removed-micro-hole", atX: 15, atY: 30 };
  assert.equal(countryNamesForDoubt(otherKindDoubt, regions, countries), "Страна А");
});

// ---------------------------------------------------------------------------
// The strip is actually drawn: buildCropOverlaySvg is a pure string builder,
// so this is checked without sharp or files.
// ---------------------------------------------------------------------------

test("the sliver outline is drawn as a filled shape, with its own outline stroke on top of the border, only for kinds that carry one", () => {
  const window = { x: 0, y: 0, width: 60, height: 60 };
  const doubtWithOutline = {
    id: "doubt-0001", atX: 30, atY: 30,
    outline: [[28, 28], [32, 28], [32, 32], [28, 32]]
  };
  const svgWithStrip = buildCropOverlaySvg({
    window, regionsInWindow: [], stateBorderEdgesInWindow: [], doubt: doubtWithOutline
  });
  assert.match(svgWithStrip, /class="sliver-fill"/);
  assert.match(svgWithStrip, /class="sliver-outline-stroke"/);
  // The drawn path must actually carry the outline's own coordinates, not an
  // empty placeholder, and it must appear in both passes.
  assert.equal([...svgWithStrip.matchAll(/M 28 28/g)].length, 2);
  // The outline stroke group must come after (render on top of) the state
  // border group — a thin sliver drawn only underneath a thick bordered line
  // would be invisible (this was the original, wrong version of this code).
  const strokeGroupIndex = svgWithStrip.indexOf('id="sliver-outline-stroke"');
  const borderGroupIndex = svgWithStrip.indexOf('id="state-borders"');
  assert.ok(strokeGroupIndex > borderGroupIndex, "sliver outline stroke must be drawn after the state border");

  const doubtWithoutOutline = { id: "doubt-0002", atX: 30, atY: 30 };
  const svgWithoutStrip = buildCropOverlaySvg({
    window, regionsInWindow: [], stateBorderEdgesInWindow: [], doubt: doubtWithoutOutline
  });
  assert.doesNotMatch(svgWithoutStrip, /class="sliver-fill"/);
  assert.doesNotMatch(svgWithoutStrip, /class="sliver-outline-stroke"/);
});

// ---------------------------------------------------------------------------
// Numeric stats and the population-scale sentence.
// ---------------------------------------------------------------------------

test("computeNumericStats: median for odd and even counts, total, and max", () => {
  assert.deepEqual(computeNumericStats([1, 2, 3]), { count: 3, total: 6, max: 3, median: 2 });
  assert.deepEqual(computeNumericStats([1, 2, 3, 4]), { count: 4, total: 10, max: 4, median: 2.5 });
  // Order of the input must not matter.
  assert.deepEqual(computeNumericStats([4, 1, 3, 2]), { count: 4, total: 10, max: 4, median: 2.5 });
});

test("describeForeignAreaPopulation reports the measured scale, not a guessed one", () => {
  const stats = computeNumericStats([10, 20, 700]);
  const sentence = describeForeignAreaPopulation({
    stats, mapAreaPx2: 1_000_000, over100Count: 1, over300Count: 1
  });
  assert.match(sentence, /730/); // total
  assert.match(sentence, /700/); // max
  assert.match(sentence, /0\.073/); // 730 / 1,000,000 * 100 = 0.073%
  assert.match(sentence, /Свыше 100 px² — 1/);
  assert.match(sentence, /свыше 300 px² — 1/);
});

// ---------------------------------------------------------------------------
// buildIndexMarkdown: pure formatting, no files.
// ---------------------------------------------------------------------------

const COUNTRY_BORDER_GAP_METRICS = {
  field: "foreignAreaPx2", label: "перенесено", unit: "px²", digits: 1,
  secondaryField: "effectiveWidthPx", secondaryLabel: "ширина щели", secondaryUnit: "px", secondaryDigits: 3,
  hasStrip: true, showTransferredAreaSummary: true
};

test("index markdown lists exactly the given rows, in the same order, sorted by the primary metric", () => {
  const markdown = buildIndexMarkdown({
    kind: "country-border-gap-merged",
    kindTitle: "Щель на границе стран",
    metrics: COUNTRY_BORDER_GAP_METRICS,
    matchingCount: 42,
    populationStatsSentence: "Во всём черновике таких записей 42.",
    rows: [
      { id: "doubt-0002", primaryValue: 100.5, secondaryValue: 5.1234, countries: "A / B", fileName: "doubt-0002.png" },
      { id: "doubt-0009", primaryValue: 4.0, secondaryValue: 0.5, countries: "C / D", fileName: "doubt-0009.png" }
    ]
  });

  assert.match(markdown, /42/);
  // The dropped author-contour line and its legend must not be mentioned
  // (only "авторской карты" — the map itself — is legitimate wording).
  assert.doesNotMatch(markdown, /авторская исходная|авторск\w* границ/i);
  const rows = markdown.split("\n").filter((line) => line.startsWith("| doubt-"));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /doubt-0002/);
  assert.match(rows[0], /100\.5/);
  assert.match(rows[0], /A \/ B/);
  assert.match(rows[0], /doubt-0002\.png/);
  assert.match(rows[1], /doubt-0009/);
});

// ---------------------------------------------------------------------------
// End-to-end runs against a tiny synthetic fixture (temporary directory).
// ---------------------------------------------------------------------------

/**
 * Minimal region-partition draft: two adjacent regions of different
 * countries, so country-name recovery via mergedIntoRegionId + outline has
 * something real to resolve against.
 */
const buildSyntheticRegionPartition = (doubts) => ({
  regions: [
    {
      id: "map-region-0001",
      areaPx2: 1800,
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 60 },
      countryId: "cmt-country-a",
      countryName: "Страна А",
      exteriorRing: [[0, 0], [30, 0], [30, 60], [0, 60]],
      interiorRings: []
    },
    {
      id: "map-region-0002",
      areaPx2: 1800,
      bounds: { minX: 30, minY: 0, maxX: 60, maxY: 60 },
      countryId: "cmt-country-b",
      countryName: "Страна Б",
      exteriorRing: [[30, 0], [60, 0], [60, 60], [30, 60]],
      interiorRings: []
    }
  ],
  doubts
});

const buildSyntheticCountriesStations = () => ({
  countries: [
    {
      id: "country-fill-0001", gameCountryId: "cmt-country-a", name: "Страна А",
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 60 },
      contour: [[[0, 0], [30, 0], [30, 60], [0, 60]]]
    },
    {
      id: "country-fill-0002", gameCountryId: "cmt-country-b", name: "Страна Б",
      bounds: { minX: 30, minY: 0, maxX: 60, maxY: 60 },
      contour: [[[30, 0], [60, 0], [60, 60], [30, 60]]]
    }
  ]
});

/** A tiny sliver outline centred on (x, y), small enough to always fit the 60x60 fixture raster. */
const tinyOutlineAt = (x, y) => [[x - 2, y - 2], [x + 2, y - 2], [x + 2, y + 2], [x - 2, y + 2]];

async function withTemporaryFixture(run) {
  const temporaryRoot = path.join(repoRoot, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, "doubt-crop-fixture-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A tiny (60×60) uniform-colour raster, fast to create and to crop. */
async function writeSyntheticRaster(filePath) {
  const buffer = await sharp({
    create: { width: 60, height: 60, channels: 3, background: { r: 200, g: 180, b: 150 } }
  }).png().toBuffer();
  await writeFile(filePath, buffer);
}

test("a doubt kind with no records exits with a clear message and writes nothing", async () => {
  await withTemporaryFixture(async (directory) => {
    const regionPartitionPath = path.join(directory, "region-partition.json");
    const countriesStationsPath = path.join(directory, "countries-stations.json");
    const backgroundPath = path.join(directory, "background.png");
    const outputDirectory = path.join(directory, "out");

    await writeFile(regionPartitionPath, JSON.stringify(buildSyntheticRegionPartition([
      { id: "doubt-0001", kind: "unresolved-gap", atX: 10, atY: 10, lengthPx: 5 }
    ])));
    await writeFile(countriesStationsPath, JSON.stringify(buildSyntheticCountriesStations()));
    await writeSyntheticRaster(backgroundPath);

    const result = await buildDoubtCrops({
      regionPartitionPath,
      countriesStationsPath,
      backgroundPath,
      kind: "country-border-gap-merged",
      limit: 20,
      outputDirectory
    });

    assert.equal(result.status, "empty");
    assert.equal(result.matchingCount, 0);
    assert.match(result.message, /No doubts of kind/);

    await assert.rejects(readdir(outputDirectory), /ENOENT/);
  });
});

test("an unsupported doubt kind is rejected with a clear message", async () => {
  await withTemporaryFixture(async (directory) => {
    const regionPartitionPath = path.join(directory, "region-partition.json");
    const countriesStationsPath = path.join(directory, "countries-stations.json");
    const backgroundPath = path.join(directory, "background.png");
    const outputDirectory = path.join(directory, "out");
    await writeFile(regionPartitionPath, JSON.stringify(buildSyntheticRegionPartition([])));
    await writeFile(countriesStationsPath, JSON.stringify(buildSyntheticCountriesStations()));
    await writeSyntheticRaster(backgroundPath);

    // unresolved-gap has no defined size metric in DOUBT_KIND_METRICS (it
    // measures gap length, not something comparable to a "widest/largest"
    // selection) — the tool must say so, not silently fall back to guessing.
    await assert.rejects(
      buildDoubtCrops({
        regionPartitionPath, countriesStationsPath, backgroundPath,
        kind: "unresolved-gap", limit: 5, outputDirectory
      }),
      /no defined size metric/
    );
  });
});

test("real run selects by foreignAreaPx2 (not effectiveWidthPx), clamps at the edge, draws the strip, and writes a matching index", async () => {
  await withTemporaryFixture(async (directory) => {
    const regionPartitionPath = path.join(directory, "region-partition.json");
    const countriesStationsPath = path.join(directory, "countries-stations.json");
    const backgroundPath = path.join(directory, "background.png");
    const outputDirectory = path.join(directory, "out");

    const doubts = [
      {
        // Large effectiveWidthPx but modest foreignAreaPx2 — must NOT rank
        // first if selection genuinely uses foreignAreaPx2.
        id: "doubt-0001", kind: "country-border-gap-merged", atX: 30, atY: 30,
        areaPx2: 20, effectiveWidthPx: 99, foreignAreaPx2: 20,
        outline: tinyOutlineAt(30, 30), mergedIntoRegionId: "map-region-0001", merged: true
      },
      {
        // Sits right at the raster's top-left corner, exercising the clamp.
        id: "doubt-0002", kind: "country-border-gap-merged", atX: 0, atY: 0,
        areaPx2: 15, effectiveWidthPx: 1, foreignAreaPx2: 15,
        outline: tinyOutlineAt(0, 0), mergedIntoRegionId: "map-region-0001", merged: true
      },
      {
        // Tiny effectiveWidthPx but the largest foreignAreaPx2 — must rank
        // first.
        id: "doubt-0003", kind: "country-border-gap-merged", atX: 32, atY: 40,
        areaPx2: 99, effectiveWidthPx: 0.5, foreignAreaPx2: 99,
        outline: tinyOutlineAt(32, 40), mergedIntoRegionId: "map-region-0002", merged: true
      },
      {
        // Different kind: must never be selected when --kind targets border gaps.
        id: "doubt-0004", kind: "collapsed-sliver", atX: 20, atY: 20,
        effectiveWidthPx: 1000, areaPx2: 1, merged: true
      }
    ];
    await writeFile(regionPartitionPath, JSON.stringify(buildSyntheticRegionPartition(doubts)));
    await writeFile(countriesStationsPath, JSON.stringify(buildSyntheticCountriesStations()));
    await writeSyntheticRaster(backgroundPath);

    const result = await buildDoubtCrops({
      regionPartitionPath,
      countriesStationsPath,
      backgroundPath,
      kind: "country-border-gap-merged",
      limit: 2,
      outputDirectory,
      // Small window/upscale for a fast test; production defaults are much
      // larger and are not exercised here (see the sizing comments in the
      // tool itself for why they are what they are).
      windowSidePx: 20,
      upscaleFactor: 2
    });

    assert.equal(result.status, "ok");
    assert.equal(result.matchingCount, 3);
    assert.equal(result.croppedCount, 2);
    assert.equal(result.metricField, "foreignAreaPx2");
    assert.deepEqual(result.metricRange, { min: 20, max: 99 });

    const entries = (await readdir(outputDirectory)).sort();
    // doubt-0003 (area 99) and doubt-0001 (area 20) win; doubt-0002 (area 15,
    // despite sitting at the clamped corner) and doubt-0004 (wrong kind) do not.
    assert.deepEqual(entries, ["doubt-0001.png", "doubt-0003.png", "index.md"]);

    const imageMeta = await sharp(path.join(outputDirectory, "doubt-0003.png")).metadata();
    assert.equal(imageMeta.width, 20 * 2);
    // 185 mirrors the tool's own CAPTION_HEIGHT_PX constant.
    assert.equal(imageMeta.height, 20 * 2 + 185);

    const index = await readFile(path.join(outputDirectory, "index.md"), "utf8");
    const rows = index.split("\n").filter((line) => line.startsWith("| doubt-"));
    // Sorted by foreignAreaPx2 descending: doubt-0003 (99) before doubt-0001 (20).
    assert.deepEqual(rows.map((line) => line.split("|")[1].trim()), ["doubt-0003", "doubt-0001"]);
    assert.match(index, /doubt-0003\.png/);
    assert.match(index, /doubt-0001\.png/);
    assert.doesNotMatch(index, /doubt-0002/);
    assert.doesNotMatch(index, /doubt-0004/);
    // The population-scale paragraph is computed from all 3 matching records
    // (not just the 2 cropped ones) and must not mention the dropped author line.
    assert.match(index, /Во всём черновике таких записей 3/);
    assert.doesNotMatch(index, /авторская исходная|авторск\w* границ/i);
  });
});

test("output directory guards reject protected locations and symlinks", async () => {
  await withTemporaryFixture(async (directory) => {
    const regionPartitionPath = path.join(directory, "region-partition.json");
    const countriesStationsPath = path.join(directory, "countries-stations.json");
    const backgroundPath = path.join(directory, "background.png");

    await writeFile(regionPartitionPath, JSON.stringify(buildSyntheticRegionPartition([
      {
        id: "doubt-0001", kind: "country-border-gap-merged", atX: 10, atY: 10,
        areaPx2: 10, effectiveWidthPx: 5, foreignAreaPx2: 10,
        outline: tinyOutlineAt(10, 10), mergedIntoRegionId: "map-region-0001", merged: true
      }
    ])));
    await writeFile(countriesStationsPath, JSON.stringify(buildSyntheticCountriesStations()));
    await writeSyntheticRaster(backgroundPath);

    const baseOptions = {
      regionPartitionPath, countriesStationsPath, backgroundPath,
      kind: "country-border-gap-merged", limit: 5
    };

    await assert.rejects(
      buildDoubtCrops({
        ...baseOptions,
        outputDirectory: path.join(repoRoot, "games", "cards-money-trains", "annotations", "doubt-crops")
      }),
      /protected read-only area/
    );
    await assert.rejects(
      buildDoubtCrops({
        ...baseOptions,
        outputDirectory: path.join(repoRoot, "draft", "doubt-crops")
      }),
      /protected read-only area/
    );

    const realDirectory = path.join(directory, "real-out");
    const linkDirectory = path.join(directory, "linked-out");
    await mkdir(realDirectory, { recursive: true });
    await symlink(realDirectory, linkDirectory);
    await assert.rejects(
      buildDoubtCrops({ ...baseOptions, outputDirectory: linkDirectory }),
      /must not be a symbolic link/
    );
  });
});
