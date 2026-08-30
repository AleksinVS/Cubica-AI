/**
 * Build a fail-closed topology-gap report for the author's vector map.
 *
 * The Illustrator-compatible source contains stroked paths, not ready-made
 * region polygons. This tool therefore records only facts that can be derived
 * without inventing geometry: formal `Z` closures, every included open path,
 * its endpoints, and nearby endpoint pairs. It never joins endpoints, flattens
 * Bézier curves, assigns regions, or writes a runtime manifest.
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

import { buildVectorMapClassificationReview } from
  "./render-vector-map-classification-review.mjs";

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
const DEFAULT_TOPOLOGY_SCHEMA = path.join(
  annotationsDirectory,
  "vector-map-topology-review.schema.json"
);
const DEFAULT_OUTPUT = path.join(
  annotationsDirectory,
  "vector-map.topology.review.json"
);

const JSON_LIMIT = 32 * 1024 * 1024;
const SCHEMA_LIMIT = 2 * 1024 * 1024;
const NEAR_ENDPOINT_REVIEW_THRESHOLD_PX = 3;
const validatedReports = new WeakSet();

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round = (value, digits = 6) => Number(value.toFixed(digits));
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);

const sameStableStats = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

/**
 * Read one bounded regular file as a stable snapshot.
 *
 * Provenance is meaningful only if the bytes hashed are the same bytes used
 * to build the report. The before/after identity check rejects concurrent
 * replacement and the no-follow flag rejects a final symbolic link.
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
      fail(`${filePath}: input changed while the topology snapshot was read`);
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

const applyAffine = (matrix, point) => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f
});

const pointCommands = (candidate) =>
  candidate.pdfCommands.filter((command) => command.points.length > 0);

const endpointPairKey = (left, right) => {
  const leftKey = `${left.candidateId}:${left.endpoint}`;
  const rightKey = `${right.candidateId}:${right.endpoint}`;
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
};

const endpointRef = (endpoint) => ({
  candidateId: endpoint.candidateId,
  endpoint: endpoint.endpoint,
  styleGroupId: endpoint.styleGroupId,
  proposedRole: endpoint.proposedRole,
  proposedCountryId: endpoint.proposedCountryId,
  point: endpoint.point
});

const buildEndpointInventory = (model) => {
  const matrix = model.rawReview.calibration.pdfToCanonical;
  const endpoints = [];
  const candidates = [];

  for (const candidate of model.rawReview.boundaryCandidates) {
    const classification = model.candidateClassificationById[candidate.id];
    const commands = pointCommands(candidate);
    if (commands.length === 0) fail(`${candidate.id}: path has no point commands`);
    const sourceStart = commands[0].points[0];
    const sourceEnd = commands.at(-1).points.at(-1);
    const common = {
      candidateId: candidate.id,
      styleGroupId: classification.styleGroupId,
      proposedRole: classification.proposedRole,
      proposedCountryId: classification.proposedCountryId,
      disposition: classification.disposition
    };
    const start = {
      ...common,
      endpoint: "start",
      sourcePoint: sourceStart,
      point: Object.fromEntries(
        Object.entries(applyAffine(matrix, sourceStart)).map(([key, value]) => [
          key,
          round(value)
        ])
      )
    };
    const end = {
      ...common,
      endpoint: "end",
      sourcePoint: sourceEnd,
      point: Object.fromEntries(
        Object.entries(applyAffine(matrix, sourceEnd)).map(([key, value]) => [
          key,
          round(value)
        ])
      )
    };
    candidates.push({
      candidate,
      classification,
      start,
      end,
      formallyClosed: candidate.pdfCommands.some((command) => command.op === "Z")
    });
    if (classification.disposition === "include") endpoints.push(start, end);
  }
  return { candidates, endpoints };
};

const buildNearEndpointPairs = (endpoints) => {
  const pairs = new Map();
  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
    const left = endpoints[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < endpoints.length; rightIndex += 1) {
      const right = endpoints[rightIndex];
      if (left.candidateId === right.candidateId) continue;
      const pairDistance = distance(left.point, right.point);
      if (pairDistance > NEAR_ENDPOINT_REVIEW_THRESHOLD_PX) continue;
      pairs.set(endpointPairKey(left, right), {
        left: endpointRef(left),
        right: endpointRef(right),
        distancePx: round(pairDistance),
        sameProposedCountry:
          left.proposedCountryId !== null &&
          left.proposedCountryId === right.proposedCountryId
      });
    }
  }
  return [...pairs.values()].sort(
    (left, right) =>
      left.distancePx - right.distancePx ||
      endpointPairKey(left.left, left.right)
        .localeCompare(endpointPairKey(right.left, right.right))
  );
};

const buildExactEndpointPairs = (endpoints) => {
  const pairs = new Set();
  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
    const left = endpoints[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < endpoints.length; rightIndex += 1) {
      const right = endpoints[rightIndex];
      if (left.candidateId === right.candidateId) continue;
      if (
        left.sourcePoint.x === right.sourcePoint.x &&
        left.sourcePoint.y === right.sourcePoint.y
      ) {
        pairs.add(endpointPairKey(left, right));
      }
    }
  }
  return pairs;
};

/**
 * Derive the review artifact from an already schema-checked classification.
 */
export const createVectorMapTopologyReview = ({
  model,
  classificationSha256
}) => {
  const { candidates, endpoints } = buildEndpointInventory(model);
  const includedCandidates = candidates.filter(
    ({ classification }) => classification.disposition === "include"
  );
  const formallyClosed = candidates.filter(({ formallyClosed: value }) => value);
  const exactEndpointPairs = buildExactEndpointPairs(endpoints);
  const nearEndpointPairs = buildNearEndpointPairs(endpoints);

  const formallyClosedContours = formallyClosed.map((entry) => ({
    candidateId: entry.candidate.id,
    styleGroupId: entry.classification.styleGroupId,
    proposedRole: entry.classification.proposedRole,
    proposedCountryId: entry.classification.proposedCountryId,
    disposition: entry.classification.disposition,
    start: entry.start.point,
    lastExplicitPoint: entry.end.point,
    closingSegmentLengthPx: round(distance(entry.start.point, entry.end.point)),
    canonicalBounds: entry.candidate.canonicalBounds
  }));

  const includedOpenCandidates = includedCandidates
    .filter(({ formallyClosed: value }) => !value)
    .map((entry) => ({
      candidateId: entry.candidate.id,
      styleGroupId: entry.classification.styleGroupId,
      proposedRole: entry.classification.proposedRole,
      proposedCountryId: entry.classification.proposedCountryId,
      start: entry.start.point,
      end: entry.end.point,
      selfGapPx: round(distance(entry.start.point, entry.end.point))
    }));

  const report = {
    $schema: "vector-map-topology-review.schema.json",
    schemaVersion: "1.0",
    status: "review-draft",
    publishable: false,
    warning:
      "ЧЕРНОВИК ПРОВЕРКИ: отчёт фиксирует разрывы исходных линий, но не " +
      "соединяет их, не создаёт области и не может быть входом runtime.",
    provenance: {
      rawReview: {
        file: "vector-map.review.json",
        sha256: model.rawReviewSha256
      },
      classification: {
        file: "vector-map.classification.review.json",
        sha256: classificationSha256
      },
      source: {
        file: model.rawReview.source.file,
        sha256: model.rawReview.source.sha256
      },
      calibration: {
        kind: model.rawReview.calibration.kind,
        coordinateSpace: "canonical-map-pixels",
        // The raw review already defines the canonical 5079 × 3627 design
        // plane as `coordinateSystem`; copying it avoids a second source of
        // map dimensions in this game-owned derivation.
        width: model.rawReview.coordinateSystem.width,
        height: model.rawReview.coordinateSystem.height,
        rmsErrorPx: model.rawReview.calibration.rmsErrorPx,
        maxErrorPx: model.rawReview.calibration.maxErrorPx,
        acceptanceThresholdPx:
          model.rawReview.calibration.acceptanceThresholdPx
      }
    },
    policy: {
      syntheticConnectionsAllowed: false,
      polygonizationPerformed: false,
      semanticAssignmentsConfirmed: false,
      exactEndpointRule: "source PDF coordinates must be numerically identical",
      nearEndpointReviewThresholdPx: NEAR_ENDPOINT_REVIEW_THRESHOLD_PX
    },
    summary: {
      sourceCandidateCount: candidates.length,
      includedCandidateCount: includedCandidates.length,
      includedOpenCandidateCount: includedOpenCandidates.length,
      includedFormallyClosedCandidateCount: includedCandidates.filter(
        ({ formallyClosed: value }) => value
      ).length,
      heldFormallyClosedCandidateCount: formallyClosed.filter(
        ({ classification }) => classification.disposition === "hold"
      ).length,
      excludedFormallyClosedCandidateCount: formallyClosed.filter(
        ({ classification }) => classification.disposition === "exclude"
      ).length,
      exactEndpointPairCount: exactEndpointPairs.size,
      nearEndpointPairCount: nearEndpointPairs.length,
      directlyPublishablePolygonCount: 0
    },
    formallyClosedContours,
    includedOpenCandidates,
    nearEndpointPairs,
    blockingQuestions: [
      {
        id: "confirm-country-style-classification",
        status: "open",
        question:
          "Подтверждены ли предложенные назначения 11 стилевых групп десяти странам?",
        evidence:
          "Классификация покрывает 965 внутренних линий, но все назначения " +
          "пока имеют confirmationStatus=unconfirmed."
      },
      {
        id: "classify-ambiguous-closed-contour-0978",
        status: "open",
        question:
          "Что обозначает формально замкнутый boundary-candidate-0978?",
        evidence:
          "Это единственный нерамочный путь с оператором Z; его disposition=hold, " +
          "поэтому он не может стать областью без визуального решения."
      },
      {
        id: "confirm-open-line-continuations",
        status: "open",
        question:
          "Какие разрывы являются намеренными, а какие границы продолжаются под " +
          "надписями, терминалами и декоративными элементами?",
        evidence:
          `${includedOpenCandidates.length} включаемых путей открыты; точных ` +
          `совпадений разных концов ${exactEndpointPairs.size}, а пар на расстоянии ` +
          `не более ${NEAR_ENDPOINT_REVIEW_THRESHOLD_PX} px — ` +
          `${nearEndpointPairs.length}. Ни одна пара автоматически не соединена.`
      },
      {
        id: "confirm-planar-face-semantics",
        status: "open",
        question:
          "Все ли замкнутые грани будущего планарного графа являются игровыми областями?",
        evidence:
          "Отдельные пути не дают готовых полигонов. Пересечения кривых и общие " +
          "грани ещё не вычислялись, чтобы аппроксимация кривых не стала скрытым " +
          "источником игровой геометрии."
      }
    ]
  };
  validatedReports.add(report);
  return report;
};

const parseArguments = (argv) => {
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const key = {
      "--raw-review": "rawReviewPath",
      "--classification": "classificationPath",
      "--raw-schema": "rawSchemaPath",
      "--classification-schema": "classificationSchemaPath",
      "--topology-schema": "topologySchemaPath",
      "--output": "outputPath"
    }[argument];
    if (!key) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) fail(`${argument} requires a file path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
};

const inspectOutputPath = async (filePath, protectedPaths) => {
  const resolved = path.resolve(filePath);
  let outputStats = null;
  try {
    outputStats = await lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (outputStats?.isSymbolicLink()) fail("outputPath must not be a symbolic link");
  if (outputStats !== null && !outputStats.isFile()) {
    fail("outputPath must be a regular file");
  }
  const outputCanonical = outputStats === null
    ? path.join(await realpath(path.dirname(resolved)), path.basename(resolved))
    : await realpath(resolved);
  for (const protectedPath of protectedPaths) {
    const protectedCanonical = await realpath(protectedPath);
    const protectedStats = await stat(protectedPath, { bigint: true });
    if (
      outputCanonical === protectedCanonical ||
      (
        outputStats !== null &&
        outputStats.dev === protectedStats.dev &&
        outputStats.ino === protectedStats.ino
      )
    ) {
      fail(`outputPath must not overwrite ${protectedPath}`);
    }
  }
};

const removeTemporaryFile = async (filePath) => {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeAtomically = async (filePath, content) => {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.` +
    `${randomBytes(12).toString("hex")}.tmp`
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
    await handle.close();
    await rename(temporaryPath, filePath);
    const directoryHandle = await open(
      path.dirname(filePath),
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
    );
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
};

/** CLI entry point for generation and freshness checking. */
export const runVectorMapTopologyReviewCli = async (
  argv = process.argv.slice(2)
) => {
  const options = parseArguments(argv);
  const rawReviewPath = options.rawReviewPath ?? DEFAULT_RAW_REVIEW;
  const classificationPath = options.classificationPath ?? DEFAULT_CLASSIFICATION;
  const rawSchemaPath = options.rawSchemaPath ?? DEFAULT_RAW_SCHEMA;
  const classificationSchemaPath =
    options.classificationSchemaPath ?? DEFAULT_CLASSIFICATION_SCHEMA;
  const topologySchemaPath = options.topologySchemaPath ?? DEFAULT_TOPOLOGY_SCHEMA;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT;

  await inspectOutputPath(outputPath, [
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    topologySchemaPath
  ]);
  const [classificationBytes, topologySchemaBytes] = await Promise.all([
    readStableFile(classificationPath, JSON_LIMIT),
    readStableFile(topologySchemaPath, SCHEMA_LIMIT)
  ]);
  const classificationSnapshot = parseJson(
    classificationBytes,
    classificationPath
  );
  const model = await buildVectorMapClassificationReview({
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    // Use exactly the bytes whose digest is written into provenance. The
    // shared validator still checks the on-disk file and both schemas, while
    // this override prevents a concurrent edit from mixing two snapshots.
    classificationOverride: classificationSnapshot
  });
  const report = createVectorMapTopologyReview({
    model,
    classificationSha256: sha256(classificationBytes)
  });
  if (!validatedReports.has(report)) {
    fail("internal error: topology report was not built by the validated builder");
  }
  validateWithSchema(
    report,
    parseJson(topologySchemaBytes, topologySchemaPath),
    "vector topology review"
  );
  const expected = `${JSON.stringify(report, null, 2)}\n`;

  if (options.check) {
    const actual = await readFile(outputPath, "utf8");
    if (actual !== expected) {
      fail(`${outputPath} is stale; regenerate the topology review`);
    }
    process.stdout.write(
      `Vector topology review is current: ` +
      `${report.summary.includedOpenCandidateCount} open included paths, ` +
      `${report.summary.exactEndpointPairCount} exact endpoint pairs, ` +
      `${report.summary.nearEndpointPairCount} near pairs; publishable=false.\n`
    );
    return report;
  }

  await writeAtomically(outputPath, expected);
  process.stdout.write(
    `Wrote fail-closed topology review: ` +
    `${report.summary.includedOpenCandidateCount} open included paths, ` +
    `${report.summary.exactEndpointPairCount} exact endpoint pairs, ` +
    `${report.summary.nearEndpointPairCount} near pairs; publishable=false.\n`
  );
  return report;
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runVectorMapTopologyReviewCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
