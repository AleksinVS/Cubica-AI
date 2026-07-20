/**
 * Render the unconfirmed vector-map style classification as a review-only SVG.
 *
 * This tool deliberately stops before polygonization. It joins the immutable
 * raw line extraction with the separate human-review classification, checks
 * both JSON Schemas and their provenance link, and draws a scalable inspection
 * layer. The output helps a person verify proposed roles and country colours;
 * it is never runtime map data and cannot write the game manifest.
 */

import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

import { groupBoundaryCandidatesByStrokeStyle } from "./extract-vector-map-review.mjs";

const Ajv = AjvImport.default ?? AjvImport;
const moduleFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");
const annotationsDirectory = path.join(
  repoRoot,
  "games",
  "cards-money-trains",
  "annotations"
);

const DEFAULT_RAW_REVIEW = path.join(annotationsDirectory, "vector-map.review.json");
const DEFAULT_CLASSIFICATION = path.join(
  annotationsDirectory,
  "vector-map.classification.review.json"
);
const DEFAULT_RAW_SCHEMA = path.join(
  annotationsDirectory,
  "vector-map-review.schema.json"
);
const DEFAULT_CLASSIFICATION_SCHEMA = path.join(
  annotationsDirectory,
  "vector-map-classification.schema.json"
);
const DEFAULT_OUTPUT = path.join(
  annotationsDirectory,
  "vector-map.classification.review-overlay.svg"
);
const DEFAULT_BACKGROUND = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");

const JSON_LIMIT = 32 * 1024 * 1024;
const SCHEMA_LIMIT = 2 * 1024 * 1024;
const EXPECTED_WIDTH = 5079;
const EXPECTED_HEIGHT = 3627;
const validatedModels = new WeakSet();

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portablePath = (value) => value.split(path.sep).join("/");
const round = (value, digits = 3) => Number(value.toFixed(digits));
const xmlEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const sameIdentity = (left, right) =>
  left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;

const sameStableStats = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

/**
 * Read a small, stable regular-file snapshot without following a final symlink.
 *
 * Review inputs are intentionally bounded: an unexpectedly large replacement
 * must fail before JSON parsing rather than consume unbounded host memory.
 */
const readStableFile = async (filePath, limit) => {
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail(`${filePath}: expected a regular file`);
    if (before.size > BigInt(limit)) {
      fail(`${filePath}: ${before.size} bytes exceed the safe ${limit}-byte limit`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await stat(filePath, { bigint: true });
    if (!sameStableStats(before, after) || !sameStableStats(before, pathAfter)) {
      fail(`${filePath}: input changed while the review snapshot was being read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

const parseJson = (bytes, filePath) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${filePath}: invalid JSON (${error.message})`);
  }
};

const validateWithSchema = (value, schema, label) => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    fail(`${label} failed JSON Schema validation: ${details}`);
  }
};

const inspectPath = async (filePath, { mustExist }) => {
  const resolved = path.resolve(filePath);
  let linkStats;
  try {
    linkStats = await lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT" || mustExist) throw error;
    return {
      canonical: path.join(await realpath(path.dirname(resolved)), path.basename(resolved)),
      identity: null,
      symbolicLink: false
    };
  }
  if (linkStats.isSymbolicLink()) {
    return {
      canonical: resolved,
      identity: null,
      symbolicLink: true
    };
  }
  if (!linkStats.isFile()) fail(`${resolved}: expected a regular file`);
  return {
    canonical: await realpath(resolved),
    identity: { dev: linkStats.dev, ino: linkStats.ino },
    symbolicLink: false
  };
};

/**
 * Refuse symlink, hardlink and canonical-path collisions before any write.
 *
 * The classification file is a protected input in ordinary rendering. It may
 * be replaced only by the explicit provenance-refresh mode, and even then it
 * cannot alias the raw extraction, schemas, background or SVG output.
 */
export const assertSafeClassificationReviewPaths = async ({
  rawReviewPath,
  classificationPath,
  rawSchemaPath,
  classificationSchemaPath,
  backgroundPath,
  outputPath,
  refreshClassification = false
}) => {
  const protectedPaths = {
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    backgroundPath
  };
  const protectedEntries = Object.fromEntries(await Promise.all(
    Object.entries(protectedPaths).map(async ([name, filePath]) => [
      name,
      await inspectPath(filePath, { mustExist: true })
    ])
  ));
  const output = await inspectPath(outputPath, { mustExist: false });
  if (output.symbolicLink) fail("outputPath must not be a symbolic link");

  for (const [name, inspected] of Object.entries(protectedEntries)) {
    if (inspected.symbolicLink) fail(`${name} must not be a symbolic link`);
    if (output.canonical === inspected.canonical ||
        sameIdentity(output.identity, inspected.identity)) {
      fail(`outputPath must not overwrite ${name}`);
    }
  }

  const classification = protectedEntries.classificationPath;
  for (const [name, inspected] of Object.entries(protectedEntries)) {
    if (name === "classificationPath") continue;
    if (classification.canonical === inspected.canonical ||
        sameIdentity(classification.identity, inspected.identity)) {
      fail(`classificationPath must not overwrite ${name}`);
    }
  }
  if (refreshClassification && protectedEntries.classificationPath.symbolicLink) {
    fail("classificationPath must not be a symbolic link in refresh mode");
  }
};

const styleKey = (style) => JSON.stringify({
  cmyk: style.cmyk,
  width: style.width,
  lineCap: style.lineCap,
  lineJoin: style.lineJoin
});

/**
 * Refresh only the immutable upstream reference in the manual classification.
 *
 * No country, role, disposition, issue or summary field is derived here. That
 * separation prevents a checksum refresh from silently becoming a semantic
 * classification generator.
 */
export const refreshClassificationProvenance = (
  classification,
  rawReview,
  rawReviewBytes
) => ({
  ...classification,
  rawReview: {
    ...classification.rawReview,
    sha256: sha256(rawReviewBytes),
    sourceFile: rawReview.source.file,
    sourceSha256: rawReview.source.sha256
  }
});

const assertProvenance = (classification, rawReview, rawReviewBytes) => {
  if (classification.rawReview.sha256 !== sha256(rawReviewBytes)) {
    fail(
      "classification rawReview.sha256 is stale; " +
      "run this tool with --refresh-upstream before rendering"
    );
  }
  if (classification.rawReview.sourceFile !== rawReview.source.file ||
      classification.rawReview.sourceSha256 !== rawReview.source.sha256) {
    fail("classification source provenance does not match the raw vector review");
  }
};

const buildCandidateClassification = (rawReview, classification) => {
  const groups = groupBoundaryCandidatesByStrokeStyle(rawReview.boundaryCandidates);
  const rawGroups = new Map(groups.map((group) => [group.id, group]));
  const seenGroups = new Set();
  // A plain null-prototype dictionary can be deeply frozen. A JavaScript Map
  // would remain mutable even after Object.freeze(map), weakening the
  // renderer's "validate once, then render" boundary.
  const candidateClassificationById = Object.create(null);

  for (const entry of classification.styleClassifications) {
    if (seenGroups.has(entry.styleGroupId)) {
      fail(`style group is classified more than once: ${entry.styleGroupId}`);
    }
    seenGroups.add(entry.styleGroupId);
    const group = rawGroups.get(entry.styleGroupId);
    if (!group) fail(`classification references unknown style group ${entry.styleGroupId}`);
    if (styleKey(group.style) !== styleKey(entry.strokeStyle)) {
      fail(`${entry.styleGroupId}: exact stroke style differs from the raw review`);
    }
    if (group.candidates.length !== entry.expectedCandidateCount) {
      fail(
        `${entry.styleGroupId}: expected ${entry.expectedCandidateCount} candidates, ` +
        `got ${group.candidates.length}`
      );
    }
    for (const candidate of group.candidates) {
      if (candidateClassificationById[candidate.id] !== undefined) {
        fail(`candidate is classified more than once: ${candidate.id}`);
      }
      candidateClassificationById[candidate.id] = entry;
    }
  }

  if (seenGroups.size !== rawGroups.size) {
    fail(`classification covers ${seenGroups.size} of ${rawGroups.size} raw style groups`);
  }
  const classifiedCandidateCount = Object.keys(candidateClassificationById).length;
  if (classifiedCandidateCount !== rawReview.boundaryCandidates.length) {
    fail(
      `classification covers ${classifiedCandidateCount} of ` +
      `${rawReview.boundaryCandidates.length} raw candidates`
    );
  }
  return { groups, candidateClassificationById };
};

const countMatchingCandidates = (model, predicate) =>
  model.rawReview.boundaryCandidates.filter((candidate) =>
    predicate(model.candidateClassificationById[candidate.id], candidate)).length;

const assertExpectedReviewInventory = (model) => {
  const countryGroups = model.classification.styleClassifications.filter(
    (entry) => entry.proposedRole === "country-internal-boundary"
  );
  const countryIds = new Set(
    model.classification.countryCatalog.map((country) => country.id)
  );
  if (countryIds.size !== model.classification.countryCatalog.length) {
    fail("country proposal identifiers must be unique");
  }
  for (const entry of model.classification.styleClassifications) {
    if (entry.proposedRole === "country-internal-boundary") {
      if (!countryIds.has(entry.proposedCountryId) || entry.disposition !== "include") {
        fail(
          `${entry.styleGroupId}: a country boundary must reference one proposed ` +
          "country and remain included"
        );
      }
    } else if (entry.proposedCountryId !== null) {
      fail(`${entry.styleGroupId}: a non-country role must not reference a country`);
    }
    const expectedDisposition = {
      "major-boundary-fragment": "include",
      "outer-map-boundary": "include",
      "ambiguous-closed-contour": "hold",
      "page-frame": "exclude"
    }[entry.proposedRole];
    if (expectedDisposition !== undefined && entry.disposition !== expectedDisposition) {
      fail(
        `${entry.styleGroupId}: ${entry.proposedRole} must use disposition ` +
        expectedDisposition
      );
    }
  }
  const counts = {
    countryCandidates: countMatchingCandidates(
      model,
      (entry) => entry.proposedRole === "country-internal-boundary"
    ),
    majorBoundaryCandidates: countMatchingCandidates(
      model,
      (entry) => entry.proposedRole === "major-boundary-fragment"
    ),
    outerBoundaryCandidates: countMatchingCandidates(
      model,
      (entry) => entry.proposedRole === "outer-map-boundary"
    ),
    heldCandidates: countMatchingCandidates(
      model,
      (entry) => entry.disposition === "hold"
    ),
    excludedCandidates: countMatchingCandidates(
      model,
      (entry) => entry.disposition === "exclude"
    )
  };

  if (model.classification.countryCatalog.length !== 10 ||
      countryGroups.length !== 11 ||
      counts.countryCandidates !== 965 ||
      counts.majorBoundaryCandidates !== 12 ||
      counts.outerBoundaryCandidates !== 1 ||
      counts.heldCandidates !== 1 ||
      counts.excludedCandidates !== 2) {
    fail(`unexpected classification inventory: ${JSON.stringify({
      countryCount: model.classification.countryCatalog.length,
      countryStyleGroupCount: countryGroups.length,
      ...counts
    })}`);
  }

  const held = model.rawReview.boundaryCandidates.filter(
    (candidate) =>
      model.candidateClassificationById[candidate.id].disposition === "hold"
  );
  if (held.length !== 1 || held[0].id !== "boundary-candidate-0978") {
    fail("the single held candidate must remain boundary-candidate-0978");
  }
  if (model.rawReview.boundaryCandidates.some(
    (candidate) => candidate.regionId !== null || candidate.countryId !== null
  )) {
    fail("raw review unexpectedly contains runtime region or country assignments");
  }
  return counts;
};

/**
 * Load, schema-check and relationally validate the two review layers.
 */
export const buildVectorMapClassificationReview = async ({
  rawReviewPath = DEFAULT_RAW_REVIEW,
  classificationPath = DEFAULT_CLASSIFICATION,
  rawSchemaPath = DEFAULT_RAW_SCHEMA,
  classificationSchemaPath = DEFAULT_CLASSIFICATION_SCHEMA,
  classificationOverride
} = {}) => {
  const [rawReviewBytes, classificationBytes, rawSchemaBytes, classificationSchemaBytes] =
    await Promise.all([
      readStableFile(rawReviewPath, JSON_LIMIT),
      readStableFile(classificationPath, JSON_LIMIT),
      readStableFile(rawSchemaPath, SCHEMA_LIMIT),
      readStableFile(classificationSchemaPath, SCHEMA_LIMIT)
    ]);
  const rawReview = parseJson(rawReviewBytes, rawReviewPath);
  const classification = classificationOverride ??
    parseJson(classificationBytes, classificationPath);
  const rawSchema = parseJson(rawSchemaBytes, rawSchemaPath);
  const classificationSchema = parseJson(
    classificationSchemaBytes,
    classificationSchemaPath
  );

  validateWithSchema(rawReview, rawSchema, "raw vector review");
  validateWithSchema(classification, classificationSchema, "classification review");
  assertProvenance(classification, rawReview, rawReviewBytes);
  const { groups, candidateClassificationById } =
    buildCandidateClassification(rawReview, classification);
  const model = {
    rawReview,
    // Keep only the digest in the public model. A Node.js Buffer is a mutable
    // binary view and cannot be frozen; retaining it would defeat the
    // process-local immutability brand used by the renderer.
    rawReviewSha256: sha256(rawReviewBytes),
    classification,
    groups,
    candidateClassificationById
  };
  model.counts = assertExpectedReviewInventory(model);
  deepFreeze(model);
  validatedModels.add(model);
  return model;
};

const applyAffine = (matrix, point) => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f
});

const commandToSvg = (command, matrix) => {
  if (command.op === "Z") return "Z";
  const points = command.points.map((point) => applyAffine(matrix, point));
  return `${command.op} ${points
    .map((point) => `${round(point.x)} ${round(point.y)}`)
    .join(" ")}`;
};

const candidateEndpoints = (candidate, matrix) => {
  const pointCommands = candidate.pdfCommands.filter(
    (command) => command.points.length > 0
  );
  if (pointCommands.length === 0) fail(`${candidate.id}: path has no points`);
  const start = applyAffine(matrix, pointCommands[0].points[0]);
  const lastCommand = pointCommands.at(-1);
  const end = applyAffine(matrix, lastCommand.points.at(-1));
  return { start, end };
};

const COUNTRY_PALETTE = [
  "#e63946",
  "#3a86ff",
  "#f7f7f2",
  "#00a896",
  "#8338ec",
  "#fb8500",
  "#2ec4b6",
  "#ef476f",
  "#8ac926",
  "#ffca3a"
];

const buildCountryColourMap = (classification) => new Map(
  classification.countryCatalog.map((country, index) => [
    country.id,
    COUNTRY_PALETTE[index]
  ])
);

const rolePresentation = (entry, countryColours) => {
  if (entry.proposedRole === "country-internal-boundary") {
    return {
      colour: countryColours.get(entry.proposedCountryId),
      width: 5,
      dash: null,
      opacity: 0.94,
      className: "country-boundary-proposal"
    };
  }
  if (entry.proposedRole === "major-boundary-fragment") {
    return {
      colour: "#ff006e",
      width: 11,
      dash: null,
      opacity: 0.98,
      className: "major-boundary-proposal"
    };
  }
  if (entry.proposedRole === "outer-map-boundary") {
    return {
      colour: "#00e5ff",
      width: 15,
      dash: null,
      opacity: 0.98,
      className: "outer-boundary-proposal"
    };
  }
  if (entry.proposedRole === "ambiguous-closed-contour") {
    return {
      colour: "#ffe600",
      width: 18,
      dash: "28 18",
      opacity: 1,
      className: "held-ambiguous-proposal"
    };
  }
  return {
    colour: "#6b7280",
    width: 9,
    dash: "16 14",
    opacity: 0.58,
    className: "excluded-page-frame"
  };
};

const renderCandidateGroups = (model, countryColours) => {
  const matrix = model.rawReview.calibration.pdfToCanonical;
  const entriesByGroup = new Map(
    model.classification.styleClassifications.map((entry) => [entry.styleGroupId, entry])
  );
  const roleOrder = new Map([
    ["page-frame", 0],
    ["country-internal-boundary", 1],
    ["major-boundary-fragment", 2],
    ["outer-map-boundary", 3],
    ["ambiguous-closed-contour", 4]
  ]);
  const groups = [...model.groups].sort((left, right) => {
    const leftEntry = entriesByGroup.get(left.id);
    const rightEntry = entriesByGroup.get(right.id);
    return (
      roleOrder.get(leftEntry.proposedRole) - roleOrder.get(rightEntry.proposedRole) ||
      left.id.localeCompare(right.id)
    );
  });

  return groups.map((group) => {
    const entry = entriesByGroup.get(group.id);
    const presentation = rolePresentation(entry, countryColours);
    const countryAttribute = entry.proposedCountryId === null
      ? ""
      : ` data-proposed-country="${xmlEscape(entry.proposedCountryId)}"`;
    const dashAttribute = presentation.dash === null
      ? ""
      : ` stroke-dasharray="${presentation.dash}"`;
    const paths = group.candidates.map((candidate) => {
      const data = candidate.pdfCommands
        .map((command) => commandToSvg(command, matrix))
        .join(" ");
      return [
        `      <path class="candidate-path ${presentation.className}" ` +
          `id="classified-${xmlEscape(candidate.id)}" ` +
          `data-candidate-id="${xmlEscape(candidate.id)}" ` +
          `data-proposed-role="${xmlEscape(entry.proposedRole)}" d="${data}">`,
        `        <title>${xmlEscape(candidate.id)} · ${xmlEscape(entry.rationale)}</title>`,
        "      </path>"
      ].join("\n");
    }).join("\n");
    return [
      `    <g id="classified-${group.id}" data-style-group-id="${group.id}" ` +
        `data-candidate-count="${group.candidates.length}" ` +
        `data-proposed-role="${entry.proposedRole}"${countryAttribute} fill="none" ` +
        `stroke="${presentation.colour}" stroke-width="${presentation.width}" ` +
        `stroke-linecap="round" stroke-linejoin="round"${dashAttribute} ` +
        `opacity="${presentation.opacity}" vector-effect="non-scaling-stroke">`,
      paths,
      "    </g>"
    ].join("\n");
  }).join("\n");
};

const renderOpenEndpoints = (model) => {
  const matrix = model.rawReview.calibration.pdfToCanonical;
  return model.rawReview.boundaryCandidates
    .filter((candidate) => !candidate.pdfCommands.some((command) => command.op === "Z"))
    .map((candidate) => {
      const { start, end } = candidateEndpoints(candidate, matrix);
      return [
        `    <rect class="open-start" data-candidate-id="${candidate.id}" ` +
          `data-open-endpoint="start" x="${round(start.x - 5)}" y="${round(start.y - 5)}" ` +
          `width="10" height="10"><title>${candidate.id}: начало открытой линии</title></rect>`,
        `    <circle class="open-end" data-candidate-id="${candidate.id}" ` +
          `data-open-endpoint="end" cx="${round(end.x)}" cy="${round(end.y)}" r="5">` +
          `<title>${candidate.id}: конец открытой линии</title></circle>`
      ].join("\n");
    }).join("\n");
};

const renderCandidateLabels = (model) => model.rawReview.boundaryCandidates
  .map((candidate) => {
    const entry = model.candidateClassificationById[candidate.id];
    const label = candidate.id.replace("boundary-candidate-", "");
    const x = round(candidate.canonicalBounds.minX + 6);
    const y = round(candidate.canonicalBounds.minY - 7);
    return (
      `    <text class="candidate-label" data-candidate-id="${candidate.id}" ` +
      `data-proposed-role="${entry.proposedRole}" x="${x}" y="${y}">` +
      `${label}<title>${candidate.id}</title></text>`
    );
  }).join("\n");

const renderLegend = (model, countryColours) => {
  const countryRows = model.classification.countryCatalog.map((country, index) => {
    const y = 238 + index * 38;
    return [
      `      <rect x="3688" y="${y - 22}" width="27" height="27" rx="4" ` +
        `fill="${countryColours.get(country.id)}" stroke="#111827" stroke-width="2" />`,
      `      <text x="3730" y="${y}" font-size="25">${xmlEscape(country.title)}</text>`
    ].join("\n");
  }).join("\n");
  return `  <g id="classification-legend" role="group" aria-labelledby="classification-legend-title" font-family="sans-serif">
    <rect x="3625" y="34" width="1418" height="670" rx="22" fill="#101827" fill-opacity="0.94" stroke="#dbeafe" stroke-width="4" />
    <text id="classification-legend-title" x="3670" y="91" fill="#ffffff" font-size="34" font-weight="700">Неподтверждённая классификация</text>
    <text x="3670" y="139" fill="#dbeafe" font-size="26">965 линий стран · 10 стран · 11 групп стилей</text>
    <text x="3670" y="178" fill="#dbeafe" font-size="26">12 крупных границ · 1 внешний контур</text>
    <g fill="#ffffff">
${countryRows}
    </g>
    <line x1="4420" y1="243" x2="4520" y2="243" stroke="#ff006e" stroke-width="11" />
    <text x="4540" y="251" fill="#ffffff" font-size="25">крупная граница</text>
    <line x1="4420" y1="298" x2="4520" y2="298" stroke="#00e5ff" stroke-width="15" />
    <text x="4540" y="306" fill="#ffffff" font-size="25">внешний контур</text>
    <line x1="4420" y1="353" x2="4520" y2="353" stroke="#ffe600" stroke-width="15" stroke-dasharray="24 14" />
    <text x="4540" y="361" fill="#ffffff" font-size="25">0978: проверить</text>
    <line x1="4420" y1="408" x2="4520" y2="408" stroke="#6b7280" stroke-width="9" stroke-dasharray="16 14" />
    <text x="4540" y="416" fill="#ffffff" font-size="25">2 рамки: исключить</text>
    <rect x="4420" y="460" width="14" height="14" fill="#39ff88" stroke="#052e16" stroke-width="2" />
    <text x="4452" y="475" fill="#ffffff" font-size="24">начало открытой линии</text>
    <circle cx="4427" cy="522" r="7" fill="#ff5263" stroke="#450a0a" stroke-width="2" />
    <text x="4452" y="530" fill="#ffffff" font-size="24">конец открытой линии</text>
    <text x="4420" y="588" fill="#cbd5e1" font-size="22">Четыре цифры у линии — суффикс</text>
    <text x="4420" y="620" fill="#cbd5e1" font-size="22">boundary-candidate-####.</text>
    <text x="4420" y="662" fill="#fde68a" font-size="22">Все предложения ожидают проверки человеком.</text>
  </g>`;
};

/**
 * Convert the validated review model into deterministic, scalable SVG bytes.
 */
export const createClassificationReviewOverlay = (model, { backgroundHref }) => {
  if (!validatedModels.has(model)) {
    fail(
      "createClassificationReviewOverlay requires the immutable validated model " +
      "returned by buildVectorMapClassificationReview"
    );
  }
  if (typeof backgroundHref !== "string" ||
      backgroundHref.length === 0 ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(backgroundHref) ||
      path.posix.isAbsolute(backgroundHref) ||
      path.win32.isAbsolute(backgroundHref) ||
      backgroundHref.startsWith("\\\\")) {
    fail("backgroundHref must be a non-empty relative path and must not be a URI");
  }

  const countryColours = buildCountryColourMap(model.classification);
  const ambiguous = model.rawReview.boundaryCandidates.find(
    (candidate) => candidate.id === "boundary-candidate-0978"
  );
  const ambiguousX = round(
    (ambiguous.canonicalBounds.minX + ambiguous.canonicalBounds.maxX) / 2
  );
  const ambiguousY = round(
    (ambiguous.canonicalBounds.minY + ambiguous.canonicalBounds.maxY) / 2
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${EXPECTED_WIDTH}" height="${EXPECTED_HEIGHT}" viewBox="0 0 ${EXPECTED_WIDTH} ${EXPECTED_HEIGHT}" role="img" aria-labelledby="title description" data-status="review-draft" data-publishable="false">
  <title id="title">Проверочный слой классификации векторной карты</title>
  <desc id="description">Непубликационный SVG для ручной проверки 981 исходной линии. Предложены цвета десяти стран, роли крупных границ, внешнего контура, спорного кандидата 0978 и двух рамок. Линии не являются областями, полигонами или данными runtime.</desc>
  <image href="${xmlEscape(backgroundHref)}" x="0" y="0" width="${EXPECTED_WIDTH}" height="${EXPECTED_HEIGHT}" preserveAspectRatio="none" opacity="0.42" />
  <g id="classified-line-candidates" aria-label="Неподтверждённые роли исходных линий">
${renderCandidateGroups(model, countryColours)}
  </g>
  <g id="open-line-endpoints" aria-label="Начала и концы открытых линий" fill-opacity="0.94" stroke-width="2" vector-effect="non-scaling-stroke">
    <style>
      .open-start { fill: #39ff88; stroke: #052e16; }
      .open-end { fill: #ff5263; stroke: #450a0a; }
    </style>
${renderOpenEndpoints(model)}
  </g>
  <g id="candidate-id-labels" aria-label="Четырёхзначные идентификаторы кандидатов" fill="#101827" font-family="monospace" font-size="12" font-weight="700" stroke="#ffffff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">
${renderCandidateLabels(model)}
  </g>
  <g id="ambiguous-candidate-callout" font-family="sans-serif">
    <circle cx="${ambiguousX}" cy="${ambiguousY}" r="34" fill="none" stroke="#ffe600" stroke-width="9" />
    <text x="${ambiguousX + 46}" y="${ambiguousY - 14}" fill="#151515" stroke="#ffffff" stroke-width="7" paint-order="stroke" font-size="31" font-weight="800">boundary-candidate-0978</text>
    <text x="${ambiguousX + 46}" y="${ambiguousY + 25}" fill="#151515" stroke="#ffffff" stroke-width="6" paint-order="stroke" font-size="25">отложен до ручного подтверждения</text>
  </g>
  <g id="review-warning" font-family="sans-serif">
    <rect x="34" y="34" width="3538" height="218" rx="22" fill="#2b102f" fill-opacity="0.95" stroke="#ff4df5" stroke-width="6" />
    <text x="78" y="92" fill="#ffffff" font-size="38" font-weight="800">ЧЕРНОВИК ПРОВЕРКИ — НЕ ДАННЫЕ ИГРЫ</text>
    <text x="78" y="145" fill="#ffe5fb" font-size="29">Цветные границы извлечены как линии (в основном открытые), а не как области или полигоны.</text>
    <text x="78" y="194" fill="#ffe5fb" font-size="29">Названия стран и роли — неподтверждённые предложения; runtime-манифест здесь не создаётся.</text>
  </g>
${renderLegend(model, countryColours)}
</svg>
`;
};

const parseArguments = (argv) => {
  const options = { check: false, refreshUpstream: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--refresh-upstream") {
      options.refreshUpstream = true;
      continue;
    }
    const key = {
      "--raw-review": "rawReviewPath",
      "--classification": "classificationPath",
      "--raw-schema": "rawSchemaPath",
      "--classification-schema": "classificationSchemaPath",
      "--background": "backgroundPath",
      "--output": "outputPath"
    }[argument];
    if (!key) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) fail(`${argument} requires a file path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  if (options.check && options.refreshUpstream) {
    fail("--check and --refresh-upstream cannot be used together");
  }
  return options;
};

const assertFileEquals = async (filePath, expected) => {
  let actual;
  try {
    actual = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`${filePath} is missing; run the renderer without --check`);
    }
    throw error;
  }
  if (actual !== expected) {
    fail(`${filePath} is stale; regenerate the classification review overlay`);
  }
};

const removeTemporaryFile = async (filePath) => {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeExclusiveTemporaryFile = async (targetPath, content) => {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`
  );
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o644
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
  await handle.close();
  return temporaryPath;
};

const syncDirectories = async (directories) => {
  for (const directory of new Set(directories)) {
    const handle = await open(
      directory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

const writeArtifactsAtomically = async (artifacts) => {
  const temporaryFiles = [];
  try {
    for (const artifact of artifacts) {
      temporaryFiles.push({
        targetPath: artifact.targetPath,
        temporaryPath: await writeExclusiveTemporaryFile(
          artifact.targetPath,
          artifact.content
        )
      });
    }
    for (const temporary of temporaryFiles) {
      await rename(temporary.temporaryPath, temporary.targetPath);
      temporary.temporaryPath = null;
    }
    await syncDirectories(artifacts.map((artifact) => path.dirname(artifact.targetPath)));
  } finally {
    await Promise.all(
      temporaryFiles.map((temporary) => removeTemporaryFile(temporary.temporaryPath))
    );
  }
};

/** CLI entry point for generation, freshness checking and provenance refresh. */
export const runClassificationReviewCli = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  const rawReviewPath = options.rawReviewPath ?? DEFAULT_RAW_REVIEW;
  const classificationPath = options.classificationPath ?? DEFAULT_CLASSIFICATION;
  const rawSchemaPath = options.rawSchemaPath ?? DEFAULT_RAW_SCHEMA;
  const classificationSchemaPath =
    options.classificationSchemaPath ?? DEFAULT_CLASSIFICATION_SCHEMA;
  const backgroundPath = options.backgroundPath ?? DEFAULT_BACKGROUND;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT;

  await assertSafeClassificationReviewPaths({
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    backgroundPath,
    outputPath,
    refreshClassification: options.refreshUpstream
  });

  let classificationOverride;
  let classificationJson;
  if (options.refreshUpstream) {
    const [rawReviewBytes, classificationBytes, classificationSchemaBytes] =
      await Promise.all([
        readStableFile(rawReviewPath, JSON_LIMIT),
        readStableFile(classificationPath, JSON_LIMIT),
        readStableFile(classificationSchemaPath, SCHEMA_LIMIT)
      ]);
    const rawReview = parseJson(rawReviewBytes, rawReviewPath);
    const classification = parseJson(classificationBytes, classificationPath);
    const classificationSchema = parseJson(
      classificationSchemaBytes,
      classificationSchemaPath
    );
    validateWithSchema(
      classification,
      classificationSchema,
      "classification review before provenance refresh"
    );
    classificationOverride = refreshClassificationProvenance(
      classification,
      rawReview,
      rawReviewBytes
    );
    classificationJson = `${JSON.stringify(classificationOverride, null, 2)}\n`;
  }

  const model = await buildVectorMapClassificationReview({
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    classificationOverride
  });
  const backgroundHref = portablePath(
    path.relative(path.dirname(outputPath), backgroundPath)
  );
  const overlay = createClassificationReviewOverlay(model, { backgroundHref });

  if (options.check) {
    await assertFileEquals(outputPath, overlay);
    process.stdout.write(
      `Vector classification review is current: ` +
      `${model.counts.countryCandidates} country candidates, ` +
      `${model.counts.majorBoundaryCandidates} major boundaries, ` +
      `${model.counts.heldCandidates} held candidate.\n`
    );
    return model;
  }

  const artifacts = [{
    targetPath: outputPath,
    content: overlay
  }];
  if (classificationJson !== undefined) {
    artifacts.unshift({
      targetPath: classificationPath,
      content: classificationJson
    });
  }
  await writeArtifactsAtomically(artifacts);
  process.stdout.write(
    `Wrote review-only classification overlay: ` +
    `${model.counts.countryCandidates} country candidates, ` +
    `${model.counts.majorBoundaryCandidates} major boundaries, ` +
    `${model.counts.outerBoundaryCandidates} outer contour; ` +
    `publishable=false.\n`
  );
  return model;
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runClassificationReviewCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
