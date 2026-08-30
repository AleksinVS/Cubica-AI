/**
 * Focused integrity checks for the manual style-classification review.
 *
 * The raw extractor remains the immutable source of geometry. This test only
 * proves that the separate human-review layer covers every exact raw style
 * once, preserves all counts, and stays fail-closed until confirmation.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

import Ajv from "ajv";

import { groupBoundaryCandidatesByStrokeStyle } from "./extract-vector-map-review.mjs";
import {
  assertSafeClassificationReviewPaths,
  buildVectorMapClassificationReview,
  createClassificationReviewOverlay,
  refreshClassificationProvenance,
  runClassificationReviewCli
} from "./render-vector-map-classification-review.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "..", "..", "..");
const annotationsDirectory = path.join(repoRoot, "games", "cards-money-trains", "annotations");
const rawReviewPath = path.join(annotationsDirectory, "vector-map.review.json");
const classificationPath = path.join(
  annotationsDirectory,
  "vector-map.classification.review.json"
);
const classificationSchemaPath = path.join(
  annotationsDirectory,
  "vector-map-classification.schema.json"
);
const rawSchemaPath = path.join(
  annotationsDirectory,
  "vector-map-review.schema.json"
);
const classificationOverlayPath = path.join(
  annotationsDirectory,
  "vector-map.classification.review-overlay.svg"
);
const backgroundPath = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Exact style identity deliberately includes every Illustrator stroke
 * attribute used by the extractor. Approximate colour matching would silently
 * merge distinct source groups and make later polygon review irreproducible.
 */
const styleKey = (style) => JSON.stringify({
  cmyk: style.cmyk,
  width: style.width,
  lineCap: style.lineCap,
  lineJoin: style.lineJoin
});

test("classification review satisfies its local JSON Schema and immutable references", async () => {
  const [schema, classification, rawReviewBytes] = await Promise.all([
    readJson(classificationSchemaPath),
    readJson(classificationPath),
    readFile(rawReviewPath)
  ]);
  const rawReview = JSON.parse(rawReviewBytes.toString("utf8"));
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  assert.equal(
    validate(classification),
    true,
    JSON.stringify(validate.errors, null, 2)
  );
  assert.equal(classification.rawReview.sha256, sha256(rawReviewBytes));
  assert.equal(classification.rawReview.sourceFile, rawReview.source.file);
  assert.equal(classification.rawReview.sourceSha256, rawReview.source.sha256);
  assert.equal(classification.status, "review-draft");
  assert.equal(classification.publishable, false);
});

test("all 18 exact raw style groups are classified once with unchanged counts", async () => {
  const [classification, rawReview] = await Promise.all([
    readJson(classificationPath),
    readJson(rawReviewPath)
  ]);

  const rawGroups = new Map();
  for (const candidate of rawReview.boundaryCandidates) {
    const key = styleKey(candidate.strokeStyle);
    const group = rawGroups.get(key) ?? [];
    group.push(candidate.id);
    rawGroups.set(key, group);
  }
  const classificationsByStyle = new Map();
  for (const entry of classification.styleClassifications) {
    const key = styleKey(entry.strokeStyle);
    assert.equal(
      classificationsByStyle.has(key),
      false,
      `raw stroke style is classified more than once: ${key}`
    );
    classificationsByStyle.set(key, entry);
  }

  assert.equal(rawGroups.size, 18);
  assert.equal(classificationsByStyle.size, rawGroups.size);
  const rawStyleGroupIds = new Map(
    groupBoundaryCandidatesByStrokeStyle(rawReview.boundaryCandidates)
      .map((group) => [styleKey(group.style), group.id])
  );
  for (const [key, candidateIds] of rawGroups) {
    const entry = classificationsByStyle.get(key);
    assert.ok(entry, `raw stroke style is not classified: ${key}`);
    assert.equal(entry.expectedCandidateCount, candidateIds.length);
    assert.equal(entry.styleGroupId, rawStyleGroupIds.get(key));
  }
  for (const key of classificationsByStyle.keys()) {
    assert.ok(rawGroups.has(key), `classification does not match any raw style: ${key}`);
  }

  // Candidate-level proof makes the fail-closed intent explicit: exact style
  // matching assigns every raw candidate to one and only one review entry.
  for (const candidate of rawReview.boundaryCandidates) {
    const matches = classification.styleClassifications.filter(
      (entry) => styleKey(entry.strokeStyle) === styleKey(candidate.strokeStyle)
    );
    assert.equal(matches.length, 1, `${candidate.id} must have exactly one classification`);
  }
  assert.equal(
    classification.styleClassifications.reduce(
      (total, entry) => total + entry.expectedCandidateCount,
      0
    ),
    rawReview.boundaryCandidates.length
  );
});

test("semantic proposals remain unconfirmed and unsafe groups stay out of polygon work", async () => {
  const classification = await readJson(classificationPath);
  const countryIds = new Set(classification.countryCatalog.map((country) => country.id));

  assert.equal(countryIds.size, 10);
  assert.ok(classification.countryCatalog.every(
    (country) =>
      country.reviewStatus === "proposed" &&
      country.confirmationStatus === "unconfirmed"
  ));
  assert.ok(classification.styleClassifications.every(
    (entry) =>
      entry.reviewStatus === "proposed" &&
      entry.confirmationStatus === "unconfirmed"
  ));
  for (const entry of classification.styleClassifications) {
    if (entry.proposedCountryId !== null) {
      assert.ok(countryIds.has(entry.proposedCountryId));
      assert.equal(entry.proposedRole, "country-internal-boundary");
    }
  }

  const frames = classification.styleClassifications.filter(
    (entry) => entry.proposedRole === "page-frame"
  );
  assert.equal(frames.length, 2);
  assert.deepEqual(
    frames.map((entry) => entry.strokeStyle.width).sort(),
    [0.815, 0.822]
  );
  assert.ok(frames.every((entry) => entry.disposition === "exclude"));

  const ambiguous = classification.styleClassifications.find(
    (entry) => entry.proposedRole === "ambiguous-closed-contour"
  );
  assert.ok(ambiguous);
  assert.equal(ambiguous.disposition, "hold");
  assert.ok(classification.openIssues.some(
    (issue) =>
      issue.kind === "ambiguous-closed-contour" &&
      issue.styleGroupId === ambiguous.styleGroupId &&
      issue.status === "open"
  ));
  assert.equal(classification.publishable, false);
  assert.equal(classification.summary.confirmedSemanticAssignmentCount, 0);
});

test("classification overlay is deterministic, complete, and explicitly non-publishable", async () => {
  const model = await buildVectorMapClassificationReview();
  const backgroundHref = path
    .relative(path.dirname(classificationOverlayPath), backgroundPath)
    .split(path.sep)
    .join("/");
  const first = createClassificationReviewOverlay(model, { backgroundHref });
  const second = createClassificationReviewOverlay(model, { backgroundHref });

  assert.equal(first, second);
  assert.equal(first, await readFile(classificationOverlayPath, "utf8"));
  assert.deepEqual(model.counts, {
    countryCandidates: 965,
    majorBoundaryCandidates: 12,
    outerBoundaryCandidates: 1,
    heldCandidates: 1,
    excludedCandidates: 2
  });
  assert.equal(
    model.counts.countryCandidates +
      model.counts.majorBoundaryCandidates +
      model.counts.outerBoundaryCandidates,
    978
  );
  assert.deepEqual(model.classification.summary, {
    rawStyleGroupCount: 18,
    classifiedCandidateCount: 981,
    proposedBoundaryCandidateCount: 978,
    heldCandidateCount: 1,
    excludedCandidateCount: 2,
    confirmedSemanticAssignmentCount: 0
  });
  assert.equal(
    [...first.matchAll(/<path class="candidate-path /g)].length,
    981
  );
  assert.equal(
    [...first.matchAll(/data-open-endpoint="start"/g)].length,
    978
  );
  assert.equal(
    [...first.matchAll(/data-open-endpoint="end"/g)].length,
    978
  );
  assert.equal(
    [...first.matchAll(/<text class="candidate-label"/g)].length,
    981
  );
  assert.match(first, /boundary-candidate-0978/);
  assert.match(first, /965 линий стран · 10 стран · 11 групп стилей/);
  assert.match(first, /12 крупных границ · 1 внешний контур/);
  assert.match(first, /ЧЕРНОВИК ПРОВЕРКИ — НЕ ДАННЫЕ ИГРЫ/);
  assert.match(first, /не как области или полигоны/);
  assert.match(first, /runtime-манифест здесь не создаётся/);
  assert.doesNotMatch(first, /<polygon\b/);
  assert.doesNotMatch(first, /\b(?:regionId|countryId)=/);
  await assert.doesNotReject(runClassificationReviewCli(["--check"]));
});

test("provenance refresh changes no manual semantic proposal", async () => {
  const [classification, rawReviewBytes] = await Promise.all([
    readJson(classificationPath),
    readFile(rawReviewPath)
  ]);
  const rawReview = JSON.parse(rawReviewBytes.toString("utf8"));
  const stale = structuredClone(classification);
  stale.rawReview.sha256 = "0".repeat(64);
  stale.rawReview.sourceFile = "stale-source.ai";
  stale.rawReview.sourceSha256 = "1".repeat(64);
  const refreshed = refreshClassificationProvenance(stale, rawReview, rawReviewBytes);
  const { rawReview: refreshedReference, ...refreshedSemantics } = refreshed;
  const { rawReview: currentReference, ...currentSemantics } = classification;

  assert.deepEqual(refreshedSemantics, currentSemantics);
  assert.deepEqual(refreshedReference, currentReference);
  assert.equal(refreshedReference.sha256, sha256(rawReviewBytes));
});

test("classification renderer path guards reject symlink and hardlink output aliases", async (context) => {
  const temporaryRoot = path.join(repoRoot, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, "classification-renderer-path-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = Object.fromEntries(
    [
      "rawReviewPath",
      "classificationPath",
      "rawSchemaPath",
      "classificationSchemaPath",
      "backgroundPath",
      "outputPath"
    ].map((name) => [name, path.join(directory, `${name}.bin`)])
  );
  await Promise.all(
    Object.entries(fixture).map(([name, filePath]) => writeFile(filePath, `${name}\n`))
  );

  await assert.doesNotReject(assertSafeClassificationReviewPaths(fixture));

  await rm(fixture.outputPath);
  await link(fixture.rawReviewPath, fixture.outputPath);
  await assert.rejects(
    assertSafeClassificationReviewPaths(fixture),
    /outputPath must not overwrite rawReviewPath/
  );

  await rm(fixture.outputPath);
  await symlink(fixture.rawReviewPath, fixture.outputPath);
  await assert.rejects(
    assertSafeClassificationReviewPaths(fixture),
    /outputPath must not be a symbolic link/
  );
});
