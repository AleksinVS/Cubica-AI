/**
 * Focused checks for the review-only Illustrator/PDF map extractor.
 *
 * These tests intentionally use the real author source because freshness of
 * calibration and review artifacts is the contract being protected. They do
 * not publish a manifest or assign any candidate to a country or region.
 */

import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertExpectedPublicLayerStructure,
  assertSafeArtifactPaths,
  buildVectorMapReview,
  createReviewOverlay,
  extractBoundaryCandidates,
  groupBoundaryCandidatesByStrokeStyle
} from "./extract-vector-map-review.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "..", "..", "..");
const annotationsDirectory = path.join(repoRoot, "games", "cards-money-trains", "annotations");
const artifactPath = path.join(annotationsDirectory, "vector-map.review.json");
const overlayPath = path.join(annotationsDirectory, "vector-map.review-overlay.svg");
const backgroundPath = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");
const sourcePath = path.join(repoRoot, "draft", "trains", "Карта Гвиней  а4.ai");
const referencePath = path.join(annotationsDirectory, "initial-network.review.json");
const schemaPath = path.join(annotationsDirectory, "vector-map-review.schema.json");

test("real vector review extraction is deterministic, calibrated, and non-publishable", async () => {
  const artifact = await buildVectorMapReview();
  const committedArtifact = JSON.parse(await readFile(artifactPath, "utf8"));

  assert.deepEqual(artifact, committedArtifact);
  assert.equal(artifact.status, "review-draft");
  assert.equal(artifact.publishable, false);
  assert.equal(artifact.source.illustratorPrivateDataParsed, false);
  assert.equal(artifact.backgroundImage.pixelWidth, 5079);
  assert.equal(artifact.backgroundImage.pixelHeight, 3627);
  assert.match(artifact.backgroundImage.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.summary.terminalCandidateCount, 23);
  assert.equal(artifact.summary.matchedTerminalCount, 23);
  assert.equal(new Set(artifact.terminalCandidates.map((item) => item.mappedReferenceId)).size, 23);
  assert.ok(artifact.calibration.maxErrorPx < 1);
  assert.equal(artifact.summary.boundaryCandidateCount, 981);
  assert.equal(artifact.summary.assignedRegionCount, 0);
  assert.equal(artifact.summary.assignedCountryCount, 0);
  assert.ok(artifact.boundaryCandidates.every((candidate) =>
    candidate.regionId === null && candidate.countryId === null));

  const styleGroups = groupBoundaryCandidatesByStrokeStyle(artifact.boundaryCandidates);
  assert.equal(styleGroups.length, 18);
  assert.deepEqual(
    styleGroups.map((group) => group.candidates.length),
    [117, 27, 86, 92, 107, 25, 26, 68, 51, 229, 1, 1, 5, 6, 137, 1, 1, 1]
  );
  assert.equal(
    styleGroups.reduce((total, group) => total + group.candidates.length, 0),
    artifact.summary.boundaryCandidateCount
  );
  assert.equal(new Set(styleGroups.map((group) => group.id)).size, styleGroups.length);
  assert.ok(styleGroups.every((group) => /^boundary-style-[a-f0-9]{16}$/.test(group.id)));

  const backgroundHref = path.relative(path.dirname(overlayPath), backgroundPath).split(path.sep).join("/");
  const regeneratedOverlay = createReviewOverlay(artifact, { backgroundHref });
  assert.equal(regeneratedOverlay, await readFile(overlayPath, "utf8"));
  assert.match(regeneratedOverlay, /role="img" aria-labelledby="title description"/);
  assert.match(regeneratedOverlay, /<desc id="description">/);
  assert.match(
    regeneratedOverlay,
    /Исходные стили линий · 18 групп · 981 кандидатов/
  );
  assert.equal(
    [...regeneratedOverlay.matchAll(
      /<g id="boundary-style-[a-f0-9]{16}" data-style-order="[0-9]{2}" data-candidate-count="[0-9]+"/g
    )].length,
    styleGroups.length
  );
  assert.equal(
    [...regeneratedOverlay.matchAll(/data-candidate-id="boundary-candidate-[0-9]{4}"/g)].length,
    artifact.summary.boundaryCandidateCount
  );
  assert.throws(
    () => createReviewOverlay(committedArtifact, { backgroundHref }),
    /immutable schema-validated artifact/
  );
  assert.throws(
    () => createReviewOverlay(artifact, { backgroundHref: "https://example.invalid/map.png" }),
    /relative and must not be a URI/
  );
  assert.throws(
    () => createReviewOverlay(artifact, { backgroundHref: "/tmp/map.png" }),
    /relative and must not be a URI/
  );
});

test("stroke-style grouping uses every exact source attribute and stable ordering", () => {
  const baseStyle = {
    cmyk: [0.1, 0.2, 0.3, 0.4],
    width: 1.25,
    lineCap: 0,
    lineJoin: 1
  };
  const candidates = [
    { id: "candidate-cmyk", strokeStyle: { ...baseStyle, cmyk: [0.1, 0.2, 0.3, 0.5] } },
    { id: "candidate-width", strokeStyle: { ...baseStyle, width: 1.5 } },
    { id: "candidate-cap", strokeStyle: { ...baseStyle, lineCap: 1 } },
    { id: "candidate-join", strokeStyle: { ...baseStyle, lineJoin: 2 } },
    { id: "candidate-base-a", strokeStyle: baseStyle },
    { id: "candidate-base-b", strokeStyle: { ...baseStyle, cmyk: [...baseStyle.cmyk] } }
  ];

  const grouped = groupBoundaryCandidatesByStrokeStyle(candidates);
  const regrouped = groupBoundaryCandidatesByStrokeStyle([...candidates].reverse());

  assert.equal(grouped.length, 5);
  assert.deepEqual(
    grouped.map((group) => group.candidates.length).sort((left, right) => left - right),
    [1, 1, 1, 1, 2]
  );
  assert.deepEqual(grouped.map((group) => group.id), regrouped.map((group) => group.id));
});

test("derived artifact paths cannot overwrite protected inputs or each other", async () => {
  const safe = {
    sourcePath,
    referencePath,
    schemaPath,
    backgroundPath,
    outputPath: artifactPath,
    overlayPath
  };
  await assert.doesNotReject(assertSafeArtifactPaths(safe));
  for (const protectedName of ["sourcePath", "referencePath", "schemaPath", "backgroundPath"]) {
    await assert.rejects(
      assertSafeArtifactPaths({ ...safe, outputPath: safe[protectedName] }),
      new RegExp(`outputPath must not overwrite ${protectedName}`)
    );
    await assert.rejects(
      assertSafeArtifactPaths({ ...safe, overlayPath: safe[protectedName] }),
      new RegExp(`overlayPath must not overwrite ${protectedName}`)
    );
  }
  await assert.rejects(
    assertSafeArtifactPaths({ ...safe, overlayPath: artifactPath }),
    /review JSON output and SVG overlay must use different paths/
  );
});

test("path guards reject output symlinks and hardlink aliases", async (context) => {
  const temporaryRoot = path.join(repoRoot, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, "vector-extractor-path-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = Object.fromEntries(
    ["sourcePath", "referencePath", "schemaPath", "backgroundPath", "outputPath", "overlayPath"]
      .map((name) => [name, path.join(directory, `${name}.bin`)])
  );
  await Promise.all(Object.entries(fixture).map(([name, filePath]) =>
    writeFile(filePath, `${name}\n`)));
  await assert.doesNotReject(assertSafeArtifactPaths(fixture));

  await rm(fixture.outputPath);
  await link(fixture.sourcePath, fixture.outputPath);
  await assert.rejects(
    assertSafeArtifactPaths(fixture),
    /outputPath must not overwrite sourcePath/
  );

  await rm(fixture.outputPath);
  await symlink(fixture.sourcePath, fixture.outputPath);
  await assert.rejects(
    assertSafeArtifactPaths(fixture),
    /outputPath must not be a symbolic link/
  );

  await rm(fixture.outputPath);
  await writeFile(fixture.outputPath, "output\n");
  await rm(fixture.overlayPath);
  await link(fixture.outputPath, fixture.overlayPath);
  await assert.rejects(
    assertSafeArtifactPaths(fixture),
    /review JSON output and SVG overlay must use different paths/
  );
});

test("unexpected XObjects and path paint operators fail closed", () => {
  const expectedMapLayer = [
    ...["Im0", "Fm0", "Fm1", "Fm2", "Fm3", "Fm4"].map((name) => `/${name} Do`),
    ...Array(3).fill("n"),
    ...Array(177).fill("f"),
    ...Array(981).fill("S")
  ].join("\n");
  const expectedTerminalLayer = [
    ...Array(3).fill("n"),
    ...Array(48).fill("f")
  ].join("\n");
  assert.doesNotThrow(() =>
    assertExpectedPublicLayerStructure(expectedMapLayer, expectedTerminalLayer));
  assert.throws(
    () => assertExpectedPublicLayerStructure(
      expectedMapLayer.replace("/Im0 Do", "/Unexpected Do"),
      expectedTerminalLayer
    ),
    /MC0 drawing XObjects changed/
  );
  assert.throws(
    () => assertExpectedPublicLayerStructure(
      expectedMapLayer.replace("\nf\n", "\nB\n"),
      expectedTerminalLayer
    ),
    /MC0 paint structure changed/
  );
  assert.throws(
    () => assertExpectedPublicLayerStructure(
      expectedMapLayer,
      `${expectedTerminalLayer}\n/Fm9 Do`
    ),
    /MC2 contains unsupported drawing XObjects/
  );
});

test("MC0 may carry one page-level clipping state into the next optional layer", () => {
  const mapLayer = [
    "q",
    "0.1 0.2 0.3 0.4 K",
    "1.5 w 1 j 2 J",
    "q 1 0 0 1 10 20 cm",
    "0 0 m",
    "5 7 l",
    "S",
    "Q"
  ].join("\n");
  const candidates = extractBoundaryCandidates(
    mapLayer,
    { a: 2, b: 0, c: 0, d: -2, e: 3, f: 100 },
    { expectedCount: 1 }
  );

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].pdfCommands, [
    { op: "M", points: [{ x: 10, y: 20 }] },
    { op: "L", points: [{ x: 15, y: 27 }] }
  ]);
  assert.deepEqual(candidates[0].canonicalBounds, {
    minX: 23,
    minY: 46,
    maxX: 33,
    maxY: 60
  });
});
