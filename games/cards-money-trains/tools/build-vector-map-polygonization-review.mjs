/**
 * Build a fail-closed, review-only polygonization report for the CMT map.
 *
 * Node.js owns trust boundaries: it validates all persistent JSON with Ajv,
 * anchors the 15 visually approved endpoint pairs to the reviewed topology
 * artifact, invokes the pinned Python/Shapely worker without a shell, validates
 * the result again, and replaces diagnostic JSON and SVG with rollback on
 * failure. Two separate files cannot be switched simultaneously for readers.
 *
 * The output is never a runtime manifest and always remains
 * `publishable: false`.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
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
const toolsDirectory = path.dirname(moduleFile);
const repoRoot = path.resolve(toolsDirectory, "..", "..", "..");
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
const DEFAULT_TOPOLOGY = path.join(
  annotationsDirectory,
  "vector-map.topology.review.json"
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
const DEFAULT_OUTPUT_SCHEMA = path.join(
  annotationsDirectory,
  "vector-map-polygonization-review.schema.json"
);
const DEFAULT_OUTPUT = path.join(
  annotationsDirectory,
  "vector-map.polygonization.review.json"
);
const DEFAULT_OVERLAY = path.join(
  annotationsDirectory,
  "vector-map.polygonization.review-overlay.svg"
);
const DEFAULT_WORKER = path.join(toolsDirectory, "vector_map_polygonizer.py");
const DEFAULT_PYTHON = path.join(
  process.env.HOME ?? "/home/abc",
  ".local",
  "share",
  "cubica",
  "venvs",
  "cmt-map-tools",
  "bin",
  "python"
);

const JSON_LIMIT = 64 * 1024 * 1024;
const SCHEMA_LIMIT = 2 * 1024 * 1024;
const WORKER_OUTPUT_LIMIT = 128 * 1024 * 1024;
const WORKER_ERROR_LIMIT = 2 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 180_000;
const FLATTEN_TOLERANCE_PX = 0.25;
const SNAP_THRESHOLD_PX = 3;

// The visual audit approved exactly the pairs in this artifact. A regenerated
// topology report must be reviewed again instead of silently changing which
// endpoints this build step is allowed to replace.
const APPROVED_TOPOLOGY_SHA256 =
  "a7e4addef930ab335a4335b5342506fa3a150505591eb1e2ec6d917228b607dc";

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portablePath = (value) => value.split(path.sep).join("/");

const sameStableStats = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

/** Read one bounded regular file from a stable descriptor snapshot. */
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
      fail(`${filePath}: input changed while it was read`);
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
      "--topology": "topologyPath",
      "--raw-schema": "rawSchemaPath",
      "--classification-schema": "classificationSchemaPath",
      "--topology-schema": "topologySchemaPath",
      "--output-schema": "outputSchemaPath",
      "--output": "outputPath",
      "--overlay": "overlayPath",
      "--worker": "workerPath",
      "--python": "pythonPath"
    }[argument];
    if (!key) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) fail(`${argument} requires a file path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
};

const inspectRegularInput = async (filePath, label) => {
  const fileStats = await lstat(filePath);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    fail(`${label} must be a regular non-symbolic-link file`);
  }
};

const inspectPythonInterpreter = async (filePath) => {
  // A Python virtual environment intentionally exposes `bin/python` as a
  // symlink while using that path to select the environment's site-packages.
  // Resolve it only for inspection; spawning the venv path is required.
  const target = await realpath(filePath);
  const targetStats = await stat(target);
  if (!targetStats.isFile()) {
    fail("polygonization Python interpreter must resolve to a regular file");
  }
};

const inspectOutputPath = async (filePath, protectedPaths) => {
  const resolved = path.resolve(filePath);
  const parent = await realpath(path.dirname(resolved));
  let outputStats = null;
  try {
    outputStats = await lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (outputStats?.isSymbolicLink()) {
    fail(`${filePath}: output must not be a symbolic link`);
  }
  if (outputStats !== null && !outputStats.isFile()) {
    fail(`${filePath}: output must be a regular file`);
  }
  const canonical = outputStats === null
    ? path.join(parent, path.basename(resolved))
    : await realpath(resolved);
  for (const protectedPath of protectedPaths) {
    const protectedCanonical = await realpath(protectedPath);
    const protectedStats = await stat(protectedPath, { bigint: true });
    if (
      canonical === protectedCanonical ||
      (
        outputStats !== null &&
        outputStats.dev === protectedStats.dev &&
        outputStats.ino === protectedStats.ino
      )
    ) {
      fail(`${filePath}: output must not overwrite ${protectedPath}`);
    }
  }
  return { resolved, canonical, stats: outputStats };
};

const removeTemporaryFile = async (filePath) => {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

/**
 * Stage a complete file under repository `.tmp`.
 *
 * The subsequent rename is atomic because this function verifies that `.tmp`
 * and the destination live on the same filesystem. Temporary build material
 * never appears beside persistent annotations.
 */
const stageTemporaryFile = async (destination, content) => {
  const temporaryDirectory = path.join(repoRoot, ".tmp");
  await mkdir(temporaryDirectory, { recursive: true });
  const [temporaryDirectoryStats, destinationDirectoryStats] = await Promise.all([
    stat(temporaryDirectory, { bigint: true }),
    stat(path.dirname(destination), { bigint: true })
  ]);
  if (temporaryDirectoryStats.dev !== destinationDirectoryStats.dev) {
    fail(".tmp and polygonization outputs must be on the same filesystem");
  }
  const temporaryPath = path.join(
    temporaryDirectory,
    `cmt-polygonization-${process.pid}-${randomBytes(12).toString("hex")}.tmp`
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
  } finally {
    await handle.close();
  }
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

/**
 * Preserve an existing destination inode before pair replacement.
 *
 * A hard link is both bounded and byte-exact: it does not duplicate a
 * multi-megabyte artifact, and it remains valid after a later rename replaces
 * the destination. Missing outputs are valid for the first generation.
 */
const backupExistingFile = async (destination) => {
  const temporaryDirectory = path.join(repoRoot, ".tmp");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const backupPath = path.join(
      temporaryDirectory,
      `cmt-polygonization-${process.pid}-${randomBytes(12).toString("hex")}.bak`
    );
    try {
      await link(destination, backupPath);
      return backupPath;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail("could not reserve a unique polygonization backup path");
};

const writeArtifactPairWithRollback = async ({
  outputPath,
  json,
  overlayPath,
  overlay
}) => {
  let jsonTemporary = null;
  let overlayTemporary = null;
  let jsonBackup = null;
  let overlayBackup = null;
  let jsonReplaced = false;
  let overlayReplaced = false;
  let pairCommitted = false;
  let preserveBackups = false;
  try {
    jsonTemporary = await stageTemporaryFile(outputPath, json);
    overlayTemporary = await stageTemporaryFile(overlayPath, overlay);
    jsonBackup = await backupExistingFile(outputPath);
    overlayBackup = await backupExistingFile(overlayPath);
    await syncDirectories([path.join(repoRoot, ".tmp")]);

    await rename(jsonTemporary, outputPath);
    jsonTemporary = null;
    jsonReplaced = true;
    await rename(overlayTemporary, overlayPath);
    overlayTemporary = null;
    overlayReplaced = true;
    await syncDirectories([
      path.dirname(outputPath),
      path.dirname(overlayPath),
      path.join(repoRoot, ".tmp")
    ]);
    pairCommitted = true;
    await Promise.all([
      removeTemporaryFile(jsonBackup),
      removeTemporaryFile(overlayBackup)
    ]);
    jsonBackup = null;
    overlayBackup = null;
    await syncDirectories([path.join(repoRoot, ".tmp")]);
  } catch (replacementError) {
    if (pairCommitted) {
      // Both destinations already contain the new durable pair. A later backup
      // cleanup failure must not roll one or both artifacts back independently.
      throw replacementError;
    }
    const rollbackErrors = [];
    for (const replacement of [
      {
        destination: overlayPath,
        backup: overlayBackup,
        replaced: overlayReplaced,
        clearBackup: () => {
          overlayBackup = null;
        }
      },
      {
        destination: outputPath,
        backup: jsonBackup,
        replaced: jsonReplaced,
        clearBackup: () => {
          jsonBackup = null;
        }
      }
    ]) {
      try {
        if (replacement.backup && replacement.replaced) {
          await rename(replacement.backup, replacement.destination);
          replacement.clearBackup();
        } else if (replacement.backup) {
          await removeTemporaryFile(replacement.backup);
          replacement.clearBackup();
        } else if (replacement.replaced) {
          await removeTemporaryFile(replacement.destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await syncDirectories([
        path.dirname(outputPath),
        path.dirname(overlayPath),
        path.join(repoRoot, ".tmp")
      ]);
    } catch (rollbackSyncError) {
      rollbackErrors.push(rollbackSyncError);
    }
    if (rollbackErrors.length > 0) {
      // A surviving backup is the last byte-exact recovery copy; retain it and
      // report both failures instead of deleting the only rollback material.
      preserveBackups = true;
      throw new AggregateError(
        [replacementError, ...rollbackErrors],
        "polygonization artifact replacement and rollback both failed"
      );
    }
    throw replacementError;
  } finally {
    await Promise.all([
      removeTemporaryFile(jsonTemporary),
      removeTemporaryFile(overlayTemporary),
      preserveBackups ? Promise.resolve() : removeTemporaryFile(jsonBackup),
      preserveBackups ? Promise.resolve() : removeTemporaryFile(overlayBackup)
    ]);
  }
};

const collectBoundedStream = (stream, limit, label, onOverflow) => {
  const chunks = [];
  let length = 0;
  stream.on("data", (chunk) => {
    length += chunk.length;
    if (length > limit) {
      onOverflow();
      return;
    }
    chunks.push(chunk);
  });
  return new Promise((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (error) => reject(new Error(`${label}: ${error.message}`)));
  });
};

/** Invoke the pinned geometry worker without a shell and with bounded I/O. */
const runGeometryWorker = async ({ pythonPath, workerPath, payload }) => {
  await Promise.all([
    inspectRegularInput(workerPath, "polygonization worker"),
    inspectPythonInterpreter(pythonPath)
  ]);
  const child = spawn(pythonPath, [workerPath], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      PYTHONHASHSEED: "0",
      LC_ALL: "C.UTF-8",
      LANG: "C.UTF-8"
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let overflow = null;
  const stopForOverflow = (channel) => {
    overflow ??= `${channel} exceeded its safe output limit`;
    child.kill("SIGKILL");
  };
  const stdoutPromise = collectBoundedStream(
    child.stdout,
    WORKER_OUTPUT_LIMIT,
    "geometry worker stdout",
    () => stopForOverflow("geometry worker stdout")
  );
  const stderrPromise = collectBoundedStream(
    child.stderr,
    WORKER_ERROR_LIMIT,
    "geometry worker stderr",
    () => stopForOverflow("geometry worker stderr")
  );
  const timeout = setTimeout(() => {
    overflow ??= `geometry worker exceeded ${WORKER_TIMEOUT_MS}ms`;
    child.kill("SIGKILL");
  }, WORKER_TIMEOUT_MS);
  child.stdin.end(`${JSON.stringify(payload)}\n`, "utf8");
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (overflow) fail(overflow);
  if (exit.code !== 0) {
    fail(
      `geometry worker failed with code ${exit.code}, signal ` +
      `${exit.signal ?? "none"}: ${stderr.toString("utf8").trim()}`
    );
  }
  return parseJson(stdout, "geometry worker stdout");
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const polygonPath = (geometry) =>
  geometry.coordinates
    .map((ring) =>
      ring
        .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
        .join(" ") + " Z"
    )
    .join(" ");

const linePath = (coordinates) =>
  coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");

/** Render a numbered overlay whose banner makes review-only status explicit. */
const createOverlay = (report, { backgroundHref }) => {
  const regions = report.candidateRegions.map((region, index) => {
    const hue = (index * 137.508) % 360;
    const number = region.id.slice(-4).replace(/^0+/, "") || "0";
    return [
      `<path class="region" data-region-id="${region.id}" ` +
        `data-geometry-fingerprint="${region.geometryFingerprint}" ` +
        `data-source-candidate-ids="${region.sourceCandidateIds.join(" ")}" ` +
        `d="${polygonPath(region.geometry)}" ` +
        `style="--region-hue:${hue.toFixed(3)}"/>`,
      `<text class="region-label" x="${region.representativePoint.x}" ` +
        `y="${region.representativePoint.y}">${number}</text>`
    ].join("\n");
  }).join("\n");
  const excluded = report.excludedSpaces.map((space) =>
    `<path class="excluded" data-source-candidate-id="${space.sourceCandidateId}" ` +
    `data-geometry-fingerprint="${space.geometryFingerprint}" ` +
    `d="${polygonPath(space.geometry)}"/>`
  ).join("\n");
  const diagnostics = [
    ...report.diagnostics.cuts.map((line) => ({ ...line, className: "cut" })),
    ...report.diagnostics.dangles.map((line) => ({ ...line, className: "dangle" })),
    ...report.diagnostics.invalidRings.map((line) => ({
      ...line,
      className: "invalid"
    }))
  ].map((line) =>
    `<path class="diagnostic ${line.className}" data-diagnostic-id="${line.id}" ` +
    `data-geometry-fingerprint="${line.geometryFingerprint}" ` +
    `data-source-candidate-ids="${line.sourceCandidateIds.join(" ")}" ` +
    `d="${linePath(line.coordinates)}"/>`
  ).join("\n");
  const endpointToLineCandidates =
    report.diagnostics.endpointToLineCandidates.map((candidate) => {
      const title =
        `${candidate.id}: ${candidate.endpointSourceCandidateId}:${candidate.endpoint} ` +
        `→ ${candidate.lineSourceCandidateId}, ${candidate.distancePx} px`;
      return [
        `<g class="endpoint-to-line" data-diagnostic-id="${candidate.id}" ` +
          `data-geometry-fingerprint="${candidate.geometryFingerprint}" ` +
          `data-endpoint-source-candidate-id="${candidate.endpointSourceCandidateId}" ` +
          `data-line-source-candidate-id="${candidate.lineSourceCandidateId}">`,
        `<title>${escapeXml(title)}</title>`,
        `<path d="M ${candidate.endpointPoint.x} ${candidate.endpointPoint.y} ` +
          `L ${candidate.projectedPoint.x} ${candidate.projectedPoint.y}"/>`,
        `<circle cx="${candidate.endpointPoint.x}" cy="${candidate.endpointPoint.y}" r="5"/>`,
        "</g>"
      ].join("");
    }).join("\n");
  const summary =
    `${report.summary.candidateRegionCount} кандидатов областей · ` +
    `${report.summary.cutEdgeCount} лишних рёбер · ` +
    `${report.summary.dangleCount} незамкнутых остатков · ` +
    `${report.summary.endpointToLineCandidateCount} концов рядом с линиями · ` +
    `${report.summary.invalidRingCount} недопустимых колец`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 5079 3627" width="5079" height="3627"
  role="img" aria-labelledby="title description">
  <title id="title">Черновая полигонализация карты «Карты, деньги, поезда»</title>
  <description id="description">${escapeXml(summary)}. Ничего не подтверждено автором и не предназначено для runtime.</description>
  <style>
    .background { opacity: .52; }
    .region { fill: hsl(var(--region-hue) 78% 56% / .30); stroke: hsl(var(--region-hue) 80% 30% / .78); stroke-width: 2.2; vector-effect: non-scaling-stroke; fill-rule: evenodd; }
    .region-label { paint-order: stroke; stroke: white; stroke-width: 7; stroke-linejoin: round; fill: #171717; font: 700 22px system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; }
    .excluded { fill: #ef4444; fill-opacity: .62; stroke: #7f1d1d; stroke-width: 5; vector-effect: non-scaling-stroke; fill-rule: evenodd; }
    .diagnostic { fill: none; vector-effect: non-scaling-stroke; }
    .cut { stroke: #f59e0b; stroke-width: 5; }
    .dangle { stroke: #e11d48; stroke-width: 7; }
    .invalid { stroke: #111827; stroke-width: 9; stroke-dasharray: 15 10; }
    .endpoint-to-line path { fill: none; stroke: #0891b2; stroke-width: 3; stroke-dasharray: 7 5; vector-effect: non-scaling-stroke; }
    .endpoint-to-line circle { fill: #06b6d4; stroke: white; stroke-width: 2; vector-effect: non-scaling-stroke; }
    .banner { fill: #111827; fill-opacity: .93; }
    .banner-title { fill: #fff; font: 700 30px system-ui, sans-serif; }
    .banner-summary { fill: #fde68a; font: 600 22px system-ui, sans-serif; }
  </style>
  <image class="background" href="${escapeXml(backgroundHref)}" xlink:href="${escapeXml(backgroundHref)}" x="0" y="0" width="5079" height="3627"/>
  <g id="candidate-regions">${regions}</g>
  <g id="excluded-spaces">${excluded}</g>
  <g id="polygonization-diagnostics">${diagnostics}</g>
  <g id="endpoint-to-line-diagnostics">${endpointToLineCandidates}</g>
  <g id="review-banner">
    <rect class="banner" x="24" y="24" width="2500" height="112" rx="14"/>
    <text class="banner-title" x="52" y="67">ЧЕРНОВИК ПРОВЕРКИ · publishable=false</text>
    <text class="banner-summary" x="52" y="108">${escapeXml(summary)}</text>
  </g>
</svg>
`;
};

const assertFileEquals = async (filePath, expected) => {
  const actual = await readFile(filePath, "utf8");
  if (actual !== expected) {
    fail(`${filePath} is stale; regenerate the polygonization review`);
  }
};

/** CLI entry point for generation and freshness checking. */
export const runVectorMapPolygonizationReviewCli = async (
  argv = process.argv.slice(2)
) => {
  const options = parseArguments(argv);
  const rawReviewPath = options.rawReviewPath ?? DEFAULT_RAW_REVIEW;
  const classificationPath = options.classificationPath ?? DEFAULT_CLASSIFICATION;
  const topologyPath = options.topologyPath ?? DEFAULT_TOPOLOGY;
  const rawSchemaPath = options.rawSchemaPath ?? DEFAULT_RAW_SCHEMA;
  const classificationSchemaPath =
    options.classificationSchemaPath ?? DEFAULT_CLASSIFICATION_SCHEMA;
  const topologySchemaPath = options.topologySchemaPath ?? DEFAULT_TOPOLOGY_SCHEMA;
  const outputSchemaPath = options.outputSchemaPath ?? DEFAULT_OUTPUT_SCHEMA;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT;
  const overlayPath = options.overlayPath ?? DEFAULT_OVERLAY;
  const workerPath = options.workerPath ?? DEFAULT_WORKER;
  const pythonPath = options.pythonPath ?? DEFAULT_PYTHON;
  const protectedPaths = [
    rawReviewPath,
    classificationPath,
    topologyPath,
    rawSchemaPath,
    classificationSchemaPath,
    topologySchemaPath,
    outputSchemaPath,
    workerPath,
    pythonPath
  ];
  const [outputInspection, overlayInspection] = await Promise.all([
    inspectOutputPath(outputPath, protectedPaths),
    inspectOutputPath(overlayPath, protectedPaths)
  ]);
  if (
    outputInspection.canonical === overlayInspection.canonical ||
    (
      outputInspection.stats !== null &&
      overlayInspection.stats !== null &&
      outputInspection.stats.dev === overlayInspection.stats.dev &&
      outputInspection.stats.ino === overlayInspection.stats.ino
    )
  ) {
    fail("polygonization JSON and SVG outputs must be different files");
  }

  const [
    classificationBytes,
    topologyBytes,
    topologySchemaBytes,
    outputSchemaBytes
  ] = await Promise.all([
    readStableFile(classificationPath, JSON_LIMIT),
    readStableFile(topologyPath, JSON_LIMIT),
    readStableFile(topologySchemaPath, SCHEMA_LIMIT),
    readStableFile(outputSchemaPath, SCHEMA_LIMIT)
  ]);
  const classificationSnapshot = parseJson(
    classificationBytes,
    classificationPath
  );
  const topology = parseJson(topologyBytes, topologyPath);
  validateWithSchema(
    topology,
    parseJson(topologySchemaBytes, topologySchemaPath),
    "vector topology review"
  );
  const topologySha256 = sha256(topologyBytes);
  if (topologySha256 !== APPROVED_TOPOLOGY_SHA256) {
    fail(
      "the topology review differs from the visually approved artifact; " +
      "review its endpoint pairs before polygonization"
    );
  }

  const model = await buildVectorMapClassificationReview({
    rawReviewPath,
    classificationPath,
    rawSchemaPath,
    classificationSchemaPath,
    classificationOverride: classificationSnapshot
  });
  const classificationSha256 = sha256(classificationBytes);
  if (
    topology.provenance.rawReview.sha256 !== model.rawReviewSha256 ||
    topology.provenance.classification.sha256 !== classificationSha256
  ) {
    fail("topology provenance does not match the validated vector inputs");
  }
  const includedCandidates = model.rawReview.boundaryCandidates.filter(
    (candidate) =>
      model.candidateClassificationById[candidate.id].disposition === "include"
  );
  const heldCandidate = model.rawReview.boundaryCandidates.find(
    (candidate) => candidate.id === "boundary-candidate-0978"
  );
  if (
    includedCandidates.length !== 978 ||
    !heldCandidate ||
    model.candidateClassificationById[heldCandidate.id].disposition !== "hold" ||
    !heldCandidate.pdfCommands.some((command) => command.op === "Z") ||
    topology.nearEndpointPairs.length !== 15
  ) {
    fail("validated vector inputs no longer match the approved review boundary");
  }

  const workerResult = await runGeometryWorker({
    pythonPath,
    workerPath,
    payload: {
      schemaVersion: "1.0",
      flattenTolerancePx: FLATTEN_TOLERANCE_PX,
      snapThresholdPx: SNAP_THRESHOLD_PX,
      pdfToCanonical: model.rawReview.calibration.pdfToCanonical,
      approvedEndpointPairs: topology.nearEndpointPairs,
      includedCandidates,
      excludedClosedContour: heldCandidate
    }
  });
  const report = {
    $schema: "vector-map-polygonization-review.schema.json",
    schemaVersion: "1.1",
    status: "review-draft",
    publishable: false,
    warning:
      "ЧЕРНОВИК ПРОВЕРКИ: ограниченные грани ещё не являются игровыми " +
      "областями, не подтверждены автором и не могут быть входом runtime.",
    provenance: {
      rawReview: {
        file: "vector-map.review.json",
        sha256: model.rawReviewSha256
      },
      classification: {
        file: "vector-map.classification.review.json",
        sha256: classificationSha256
      },
      topologyReview: {
        file: "vector-map.topology.review.json",
        sha256: topologySha256
      },
      source: {
        file: model.rawReview.source.file,
        sha256: model.rawReview.source.sha256
      },
      calibration: {
        kind: model.rawReview.calibration.kind,
        coordinateSpace: "canonical-map-pixels",
        width: model.rawReview.coordinateSystem.width,
        height: model.rawReview.coordinateSystem.height,
        rmsErrorPx: model.rawReview.calibration.rmsErrorPx,
        maxErrorPx: model.rawReview.calibration.maxErrorPx
      },
      toolchain: {
        node: process.versions.node,
        ...workerResult.toolchain
      },
      algorithm: {
        flattening: "recursive-de-casteljau-canonical-chord-bound",
        flattenTolerancePx: FLATTEN_TOLERANCE_PX,
        endpointSnapPolicy: "approved-topology-pairs-only-centroid",
        snapThresholdPx: SNAP_THRESHOLD_PX,
        intersectionNoding: "shapely.unary_union",
        polygonization: "shapely.polygonize_full"
      }
    },
    policy: {
      semanticAssignmentsConfirmed: false,
      externalInfiniteFaceExcluded: true,
      excludedInternalSpaceCandidateId: "boundary-candidate-0978",
      excludedInternalSpaceInterpretation: "review-assumption-not-author-confirmed",
      additionalSyntheticConnectionsAllowed: false,
      runtimeIntegrationAllowed: false
    },
    summary: workerResult.summary,
    snapClusters: workerResult.snapClusters,
    candidateRegions: workerResult.candidateRegions,
    excludedSpaces: workerResult.excludedSpaces,
    diagnostics: workerResult.diagnostics,
    blockingFindings: workerResult.blockingFindings
  };
  validateWithSchema(
    report,
    parseJson(outputSchemaBytes, outputSchemaPath),
    "vector polygonization review"
  );
  const expectedJson = `${JSON.stringify(report, null, 2)}\n`;
  const backgroundHref = portablePath(
    path.relative(path.dirname(overlayPath), path.resolve(
      annotationsDirectory,
      model.rawReview.backgroundImage.file
    ))
  );
  const expectedOverlay = createOverlay(report, { backgroundHref });

  if (options.check) {
    await Promise.all([
      assertFileEquals(outputPath, expectedJson),
      assertFileEquals(overlayPath, expectedOverlay)
    ]);
    process.stdout.write(
      `Vector polygonization review is current: ` +
      `${report.summary.candidateRegionCount} candidate regions, ` +
      `${report.summary.dangleCount} dangles, ` +
      `${report.summary.endpointToLineCandidateCount} endpoint-to-line candidates, ` +
      `${report.summary.blockingFindingCount} blocking findings; ` +
      `publishable=false.\n`
    );
    return report;
  }

  await writeArtifactPairWithRollback({
    outputPath,
    json: expectedJson,
    overlayPath,
    overlay: expectedOverlay
  });
  process.stdout.write(
    `Wrote fail-closed polygonization review: ` +
    `${report.summary.candidateRegionCount} candidate regions, ` +
    `${report.summary.dangleCount} dangles, ` +
    `${report.summary.endpointToLineCandidateCount} endpoint-to-line candidates, ` +
    `${report.summary.blockingFindingCount} blocking findings; ` +
    `publishable=false.\n`
  );
  return report;
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runVectorMapPolygonizationReviewCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
