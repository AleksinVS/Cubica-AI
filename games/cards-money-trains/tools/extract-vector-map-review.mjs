/**
 * Reproducible review-only extraction from the Illustrator-compatible PDF map.
 *
 * The authoring `.ai` file is a PDF 1.6 document. This tool deliberately reads
 * only the public page dictionary and its Flate-compressed drawing stream. It
 * never parses Illustrator's large private round-trip data. The result is a
 * review artifact, not a runtime fragment: terminal gears calibrate PDF points
 * to the canonical 5079 × 3627 map, while stroked map paths remain anonymous
 * boundary candidates until a person assigns countries and regions.
 */

import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import AjvImport from "ajv";

const Ajv = AjvImport.default ?? AjvImport;
const moduleFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");

const DEFAULT_SOURCE = path.join(repoRoot, "draft", "trains", "Карта Гвиней  а4.ai");
const DEFAULT_REFERENCE = path.join(
  repoRoot,
  "games",
  "cards-money-trains",
  "annotations",
  "initial-network.review.json"
);
const DEFAULT_SCHEMA = path.join(
  repoRoot,
  "games",
  "cards-money-trains",
  "annotations",
  "vector-map-review.schema.json"
);
const DEFAULT_OUTPUT = path.join(
  repoRoot,
  "games",
  "cards-money-trains",
  "annotations",
  "vector-map.review.json"
);
const DEFAULT_OVERLAY = path.join(
  repoRoot,
  "games",
  "cards-money-trains",
  "annotations",
  "vector-map.review-overlay.svg"
);
const DEFAULT_BACKGROUND = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");

const PUBLIC_PDF_PREFIX_LIMIT = 2 * 1024 * 1024;
const PUBLIC_CONTENT_OUTPUT_LIMIT = 16 * 1024 * 1024;
const SNAPSHOT_CHUNK_SIZE = 1024 * 1024;
const REFERENCE_SIZE_LIMIT = 16 * 1024 * 1024;
const TERMINAL_COUNT = 23;
const CALIBRATION_ACCEPTANCE_PX = 3;
const TERMINAL_REFERENCE_PATTERN = /^terminal-[0-9]+$/;
const NUMBER = "[-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)";
const EXPECTED_MC0_XOBJECTS = ["Im0", "Fm0", "Fm1", "Fm2", "Fm3", "Fm4"];
const EXPECTED_MC0_PAINT_COUNTS = { n: 3, f: 177, S: 981 };
const EXPECTED_MC2_PAINT_COUNTS = { n: 3, f: 48 };
const validatedArtifacts = new WeakSet();

const fail = (message) => {
  throw new Error(message);
};

const portablePath = (value) => value.split(path.sep).join("/");
const round = (value, digits = 6) => Number(value.toFixed(digits));
const roundPoint = (point, digits = 6) => ({
  x: round(point.x, digits),
  y: round(point.y, digits)
});

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const sameFileIdentity = (left, right) =>
  left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;

const sameStableStats = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const inspectFilePath = async (filePath) => {
  const resolved = path.resolve(filePath);
  let linkStats;
  try {
    linkStats = await lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    // A not-yet-created output still inherits any symlink resolution from its
    // existing parent directory, so aliases cannot bypass the equality guard.
    return {
      canonical: path.join(await realpath(path.dirname(resolved)), path.basename(resolved)),
      identity: null,
      symbolicLink: false
    };
  }
  if (linkStats.isSymbolicLink()) {
    try {
      const targetStats = await stat(resolved, { bigint: true });
      return {
        canonical: await realpath(resolved),
        identity: { dev: targetStats.dev, ino: targetStats.ino },
        symbolicLink: true
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return { canonical: resolved, identity: null, symbolicLink: true };
    }
  }
  return {
    canonical: await realpath(resolved),
    identity: { dev: linkStats.dev, ino: linkStats.ino },
    symbolicLink: false
  };
};

/**
 * Refuse every output collision before reading or writing derived artifacts.
 * This protects author sources even when a caller supplies symlinked paths.
 */
export const assertSafeArtifactPaths = async ({
  sourcePath,
  referencePath,
  schemaPath,
  backgroundPath,
  outputPath,
  overlayPath
}) => {
  const entries = await Promise.all(Object.entries({
    sourcePath,
    referencePath,
    schemaPath,
    backgroundPath,
    outputPath,
    overlayPath
  }).map(async ([name, filePath]) => [name, await inspectFilePath(filePath)]));
  const inspected = Object.fromEntries(entries);
  const protectedNames = ["sourcePath", "referencePath", "schemaPath", "backgroundPath"];
  for (const outputName of ["outputPath", "overlayPath"]) {
    if (inspected[outputName].symbolicLink) {
      fail(`${outputName} must not be a symbolic link`);
    }
  }
  if (inspected.outputPath.canonical === inspected.overlayPath.canonical ||
      sameFileIdentity(inspected.outputPath.identity, inspected.overlayPath.identity)) {
    fail("review JSON output and SVG overlay must use different paths");
  }
  for (const outputName of ["outputPath", "overlayPath"]) {
    for (const protectedName of protectedNames) {
      if (inspected[outputName].canonical === inspected[protectedName].canonical ||
          sameFileIdentity(inspected[outputName].identity, inspected[protectedName].identity)) {
        fail(`${outputName} must not overwrite ${protectedName}`);
      }
    }
  }
};

/**
 * Hash a stable file descriptor while retaining either its whole content or a
 * bounded prefix. Identity, size and nanosecond timestamps are checked both on
 * the descriptor and the pathname so a concurrent replacement fails closed.
 */
const readStableSnapshot = async (filePath, { captureLimit, requireWhole = false }) => {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail(`${filePath}: expected a regular file`);
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${filePath}: file is too large`);
    const size = Number(before.size);
    if (requireWhole && size > captureLimit) {
      fail(`${filePath}: ${size} bytes exceed the safe ${captureLimit}-byte snapshot limit`);
    }
    const captureSize = requireWhole ? size : Math.min(size, captureLimit);
    const captured = Buffer.alloc(captureSize);
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(Math.min(SNAPSHOT_CHUNK_SIZE, Math.max(size, 1)));
    let position = 0;
    while (position < size) {
      const requested = Math.min(chunk.length, size - position);
      const { bytesRead } = await handle.read(chunk, 0, requested, position);
      if (bytesRead === 0) fail(`${filePath}: file ended while creating a stable snapshot`);
      const slice = chunk.subarray(0, bytesRead);
      hash.update(slice);
      if (position < captureSize) {
        slice.copy(captured, position, 0, Math.min(bytesRead, captureSize - position));
      }
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await stat(filePath, { bigint: true });
    if (!sameStableStats(before, after) || !sameStableStats(before, pathAfter)) {
      fail(`${filePath}: source changed while its review snapshot was being read`);
    }
    return {
      bytes: size,
      sha256: hash.digest("hex"),
      data: captured
    };
  } finally {
    await handle.close();
  }
};

/**
 * Read only the beginning of the PDF where the page and public content stream
 * live. A streaming hash covers the source for provenance, but private data is
 * neither inflated nor interpreted by this extractor.
 */
export const readPublicPdfDrawingStream = async (sourcePath) => {
  const snapshot = await readStableSnapshot(sourcePath, {
    captureLimit: PUBLIC_PDF_PREFIX_LIMIT
  });
  const prefix = snapshot.data;
  const prefixText = prefix.toString("latin1");
  const version = prefixText.match(/^%PDF-([0-9]+\.[0-9]+)/)?.[1];
  if (!version) fail(`${sourcePath}: PDF header is missing`);

  const objectPattern = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let pageObject;
  let pageBody;
  for (const match of prefixText.matchAll(objectPattern)) {
    if (/\/Type\/Page(?=[\s/>])/.test(match[2])) {
      pageObject = Number(match[1]);
      pageBody = match[2];
      break;
    }
  }
  if (!pageObject || !pageBody) fail(`${sourcePath}: public PDF page object is missing`);

  const contentsObject = Number(pageBody.match(/\/Contents\s+(\d+)\s+0\s+R/)?.[1]);
  if (!contentsObject) fail(`${sourcePath}: page /Contents reference is missing`);
  if (!/\/MC0\s+\d+\s+0\s+R/.test(pageBody) || !/\/MC2\s+\d+\s+0\s+R/.test(pageBody)) {
    fail(`${sourcePath}: expected public MC0 and MC2 optional-content layers are missing`);
  }

  const objectMarkerPattern = new RegExp(`(?:^|[\\r\\n])${contentsObject}\\s+0\\s+obj\\b`);
  const objectMarker = objectMarkerPattern.exec(prefixText);
  if (!objectMarker) fail(`${sourcePath}: content object ${contentsObject} is outside the public prefix`);
  const objectStart = objectMarker.index + objectMarker[0].search(/[0-9]/);
  const streamKeyword = prefix.indexOf(Buffer.from("stream"), objectStart);
  if (streamKeyword < 0) fail(`${sourcePath}: content object ${contentsObject} has no stream`);
  const dictionary = prefix.subarray(objectStart, streamKeyword).toString("latin1");
  const compressedLength = Number(dictionary.match(/\/Length\s+(\d+)/)?.[1]);
  if (!compressedLength) fail(`${sourcePath}: content stream length is missing`);
  if (!/\/Filter\s*\/FlateDecode/.test(dictionary)) {
    fail(`${sourcePath}: only the public FlateDecode content stream is supported`);
  }

  let dataStart = streamKeyword + "stream".length;
  if (prefix[dataStart] === 13) dataStart += 1;
  if (prefix[dataStart] === 10) dataStart += 1;
  const dataEnd = dataStart + compressedLength;
  if (dataEnd > prefix.length) {
    fail(`${sourcePath}: public content stream exceeds the ${PUBLIC_PDF_PREFIX_LIMIT}-byte safety prefix`);
  }
  let content;
  try {
    content = inflateSync(prefix.subarray(dataStart, dataEnd), {
      maxOutputLength: PUBLIC_CONTENT_OUTPUT_LIMIT
    }).toString("latin1");
  } catch (error) {
    fail(
      `${sourcePath}: public PDF content is invalid or exceeds the ` +
      `${PUBLIC_CONTENT_OUTPUT_LIMIT}-byte decompression limit (${error.message})`
    );
  }
  if (!content.includes("/OC /MC0 BDC") || !content.includes("/OC /MC2 BDC")) {
    fail(`${sourcePath}: decoded content lacks expected MC0/MC2 layer markers`);
  }

  return {
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
    pdfVersion: version,
    pageObject,
    contentsObject,
    content
  };
};

/** Extract a top-level optional-content block such as MC0 or MC2. */
export const extractPublicLayer = (content, layerToken) => {
  const marker = `/OC /${layerToken} BDC`;
  const start = content.indexOf(marker);
  if (start < 0) fail(`public PDF layer ${layerToken} is missing`);
  const bodyStart = start + marker.length;
  const end = content.indexOf("\nEMC", bodyStart);
  if (end < 0) fail(`public PDF layer ${layerToken} has no closing EMC`);
  return content.slice(bodyStart, end);
};

const countPaintOperators = (layer) => {
  const counts = {};
  const operatorPattern = /(?:^|\s)(S|s|f\*|f|F|B\*|B|b\*|b|n)(?=\s|$)/g;
  for (const match of layer.matchAll(operatorPattern)) {
    counts[match[1]] = (counts[match[1]] ?? 0) + 1;
  }
  return counts;
};

const assertExactCounts = (label, actual, expected) => {
  const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
  const differs = keys.some((key) => (actual[key] ?? 0) !== (expected[key] ?? 0));
  if (differs) {
    fail(`${label} paint structure changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/**
 * Fail closed when Illustrator moves drawing into nested XObjects or changes
 * path-paint operators. The extractor intentionally covers only the 981
 * top-level S strokes in the current page stream; known XObjects are excluded,
 * never expanded and cannot silently become region geometry.
 */
export const assertExpectedPublicLayerStructure = (mapLayer, terminalLayer) => {
  const mapXObjects = Array.from(
    mapLayer.matchAll(/\/([A-Za-z0-9_.-]+)\s+Do\b/g),
    (match) => match[1]
  );
  if (JSON.stringify(mapXObjects) !== JSON.stringify(EXPECTED_MC0_XOBJECTS)) {
    fail(
      `MC0 drawing XObjects changed: expected ${EXPECTED_MC0_XOBJECTS.join(", ")}, ` +
      `got ${mapXObjects.join(", ") || "none"}`
    );
  }
  const terminalXObjects = Array.from(
    terminalLayer.matchAll(/\/([A-Za-z0-9_.-]+)\s+Do\b/g),
    (match) => match[1]
  );
  if (terminalXObjects.length > 0) {
    fail(`MC2 contains unsupported drawing XObjects: ${terminalXObjects.join(", ")}`);
  }
  assertExactCounts("MC0", countPaintOperators(mapLayer), EXPECTED_MC0_PAINT_COUNTS);
  assertExactCounts("MC2", countPaintOperators(terminalLayer), EXPECTED_MC2_PAINT_COUNTS);
};

/**
 * The terminal layer contains exactly 23 repeated gear primitives. The first
 * circular primitive in each gear has a known local centre (-6.645, 0); using
 * the primitive rather than text avoids dependence on embedded font encoding.
 */
export const extractTerminalGearCenters = (terminalLayer) => {
  const gearPattern = new RegExp(
    `q\\s+1\\s+0\\s+0\\s+1\\s+(${NUMBER})\\s+(${NUMBER})\\s+cm\\s+` +
      `0\\s+0\\s+m\\s+0\\s+-3\\.67\\s+-2\\.975\\s+-6\\.645\\s+-6\\.645\\s+-6\\.645\\s+c`,
    "g"
  );
  const centers = [];
  for (const match of terminalLayer.matchAll(gearPattern)) {
    centers.push({ x: Number(match[1]) - 6.645, y: Number(match[2]) });
  }
  if (centers.length !== TERMINAL_COUNT) {
    fail(`expected ${TERMINAL_COUNT} terminal gear centres in MC2, found ${centers.length}`);
  }
  return centers;
};

const range = (points, key) => ({
  min: Math.min(...points.map((point) => point[key])),
  max: Math.max(...points.map((point) => point[key]))
});

const applyAxisAlignment = (alignment, point) => ({
  x: alignment.scaleX * point.x + alignment.offsetX,
  y: alignment.scaleY * point.y + alignment.offsetY
});

const applyAffine = (matrix, point) => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f
});

const matchWithAlignment = (sourcePoints, referenceNodes, alignment) => {
  const pairs = sourcePoints.map((source, sourceIndex) => {
    const projected = applyAxisAlignment(alignment, source);
    let nearest;
    for (const reference of referenceNodes) {
      const distance = Math.hypot(
        projected.x - reference.position.x,
        projected.y - reference.position.y
      );
      if (!nearest || distance < nearest.distance) nearest = { reference, distance };
    }
    return { source, sourceIndex, ...nearest };
  });
  const unique = new Set(pairs.map((pair) => pair.reference.id)).size === referenceNodes.length;
  const squaredError = pairs.reduce((sum, pair) => sum + pair.distance ** 2, 0);
  return { alignment, pairs, unique, squaredError };
};

/** Solve a 3 × 3 linear system with deterministic partial pivoting. */
const solve3 = (matrix, vector) => {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) fail("terminal calibration matrix is singular");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index < 4; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index < 4; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }
  return rows.map((row) => row[3]);
};

const fitAffineAxis = (pairs, coordinate) => {
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const target = [0, 0, 0];
  for (const pair of pairs) {
    const row = [pair.source.x, pair.source.y, 1];
    const value = pair.reference.position[coordinate];
    for (let left = 0; left < 3; left += 1) {
      target[left] += row[left] * value;
      for (let right = 0; right < 3; right += 1) {
        normal[left][right] += row[left] * row[right];
      }
    }
  }
  return solve3(normal, target);
};

/**
 * Match the two 23-point sets without depending on Illustrator draw order.
 * Four axis orientations are tested from bounding boxes; the unique best match
 * is then refined with a full six-parameter affine least-squares transform.
 */
export const calibrateTerminalCenters = (sourcePoints, referenceNodes) => {
  if (sourcePoints.length !== TERMINAL_COUNT || referenceNodes.length !== TERMINAL_COUNT) {
    fail(`terminal calibration requires ${TERMINAL_COUNT} source and reference points`);
  }
  const sourceX = range(sourcePoints, "x");
  const sourceY = range(sourcePoints, "y");
  const referencePoints = referenceNodes.map((node) => node.position);
  const referenceX = range(referencePoints, "x");
  const referenceY = range(referencePoints, "y");
  const sourceMidX = (sourceX.min + sourceX.max) / 2;
  const sourceMidY = (sourceY.min + sourceY.max) / 2;
  const referenceMidX = (referenceX.min + referenceX.max) / 2;
  const referenceMidY = (referenceY.min + referenceY.max) / 2;

  const matches = [];
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      const scaleX = signX * (referenceX.max - referenceX.min) / (sourceX.max - sourceX.min);
      const scaleY = signY * (referenceY.max - referenceY.min) / (sourceY.max - sourceY.min);
      const alignment = {
        scaleX,
        scaleY,
        offsetX: referenceMidX - scaleX * sourceMidX,
        offsetY: referenceMidY - scaleY * sourceMidY
      };
      matches.push(matchWithAlignment(sourcePoints, referenceNodes, alignment));
    }
  }
  const viable = matches.filter((match) => match.unique)
    .sort((left, right) => left.squaredError - right.squaredError);
  if (viable.length === 0) fail("bounding-box calibration did not produce a one-to-one terminal match");
  const best = viable[0];

  const xCoefficients = fitAffineAxis(best.pairs, "x");
  const yCoefficients = fitAffineAxis(best.pairs, "y");
  const matrix = {
    a: xCoefficients[0],
    b: yCoefficients[0],
    c: xCoefficients[1],
    d: yCoefficients[1],
    e: xCoefficients[2],
    f: yCoefficients[2]
  };
  const pairs = best.pairs.map((pair) => {
    const calibrated = applyAffine(matrix, pair.source);
    return {
      ...pair,
      calibrated,
      residual: Math.hypot(
        calibrated.x - pair.reference.position.x,
        calibrated.y - pair.reference.position.y
      )
    };
  });
  const meanError = pairs.reduce((sum, pair) => sum + pair.residual, 0) / pairs.length;
  const rmsError = Math.sqrt(
    pairs.reduce((sum, pair) => sum + pair.residual ** 2, 0) / pairs.length
  );
  const maxError = Math.max(...pairs.map((pair) => pair.residual));
  if (maxError > CALIBRATION_ACCEPTANCE_PX) {
    fail(
      `terminal calibration maximum error ${maxError.toFixed(3)} px exceeds ` +
      `${CALIBRATION_ACCEPTANCE_PX} px`
    );
  }
  return { matrix, initialAlignment: best.alignment, pairs, meanError, rmsError, maxError };
};

const identityMatrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

const multiplyMatrices = (left, right) => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
  e: left.a * right.e + left.c * right.f + left.e,
  f: left.b * right.e + left.d * right.f + left.f
});

const cloneGraphicsState = (state) => ({
  ctm: { ...state.ctm },
  strokeCmyk: state.strokeCmyk ? [...state.strokeCmyk] : null,
  lineWidth: state.lineWidth,
  lineCap: state.lineCap,
  lineJoin: state.lineJoin
});

const transformedCommand = (op, points, ctm) => ({
  op,
  points: points.map((point) => applyAffine(ctm, point))
});

/**
 * Parse the limited public PDF path operators used by this Illustrator file.
 * Only the source's verified top-level S/s paths become candidates. Filled
 * shapes and known XObjects are deliberately excluded by the structure gate,
 * so nested or newly introduced drawing cannot silently become a region.
 */
export const extractBoundaryCandidates = (
  mapLayer,
  calibrationMatrix,
  { expectedCount = EXPECTED_MC0_PAINT_COUNTS.S } = {}
) => {
  let state = {
    ctm: identityMatrix(),
    strokeCmyk: null,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0
  };
  const stack = [];
  let commands = [];
  let currentPoint = null;
  const candidates = [];

  const resetPath = () => {
    commands = [];
    currentPoint = null;
  };
  const addPointCommand = (op, points) => {
    commands.push(transformedCommand(op, points, state.ctm));
    if (points.length > 0) currentPoint = points[points.length - 1];
  };
  const capture = (paintOperator) => {
    if (paintOperator === "s") commands.push({ op: "Z", points: [] });
    if (commands.length >= 2) {
      if (!state.strokeCmyk) fail("stroked map path has no explicit CMYK colour");
      const allPoints = commands.flatMap((command) => command.points)
        .map((point) => applyAffine(calibrationMatrix, point));
      const identifier = `boundary-candidate-${String(candidates.length + 1).padStart(4, "0")}`;
      candidates.push({
        id: identifier,
        sourcePathIndex: candidates.length + 1,
        sourceLayer: "MC0",
        paintOperator,
        strokeStyle: {
          cmyk: state.strokeCmyk.map((value) => round(value)),
          width: round(state.lineWidth),
          lineCap: state.lineCap,
          lineJoin: state.lineJoin
        },
        pdfCommands: commands.map((command) => ({
          op: command.op,
          points: command.points.map((point) => roundPoint(point))
        })),
        canonicalBounds: {
          minX: round(Math.min(...allPoints.map((point) => point.x)), 3),
          minY: round(Math.min(...allPoints.map((point) => point.y)), 3),
          maxX: round(Math.max(...allPoints.map((point) => point.x)), 3),
          maxY: round(Math.max(...allPoints.map((point) => point.y)), 3)
        },
        regionId: null,
        countryId: null,
        reviewStatus: "unclassified"
      });
    }
    resetPath();
  };

  for (const rawLine of mapLayer.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^q(?:\s|$)/.test(line)) {
      stack.push(cloneGraphicsState(state));
      line = line.replace(/^q\s*/, "");
      if (!line) continue;
    }
    if (line === "Q") {
      state = stack.pop() ?? fail("unbalanced Q operator in MC0");
      continue;
    }

    const cmyk = line.match(new RegExp(`(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+K(?:\\s|$)`));
    if (cmyk) state.strokeCmyk = cmyk.slice(1, 5).map(Number);
    const width = line.match(new RegExp(`(${NUMBER})\\s+w(?:\\s|$)`));
    if (width) state.lineWidth = Number(width[1]);
    const lineJoin = line.match(/([0-2])\s+j(?:\s|$)/);
    if (lineJoin) state.lineJoin = Number(lineJoin[1]);
    const lineCap = line.match(/([0-2])\s+J(?:\s|$)/);
    if (lineCap) state.lineCap = Number(lineCap[1]);

    const matrix = line.match(
      new RegExp(`(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+cm(?:\\s|$)`)
    );
    if (matrix) {
      const values = matrix.slice(1, 7).map(Number);
      state.ctm = multiplyMatrices(state.ctm, {
        a: values[0], b: values[1], c: values[2],
        d: values[3], e: values[4], f: values[5]
      });
      continue;
    }

    let match = line.match(new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+m$`));
    if (match) {
      addPointCommand("M", [{ x: Number(match[1]), y: Number(match[2]) }]);
      continue;
    }
    match = line.match(new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+l$`));
    if (match) {
      addPointCommand("L", [{ x: Number(match[1]), y: Number(match[2]) }]);
      continue;
    }
    match = line.match(
      new RegExp(
        `^(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+c$`
      )
    );
    if (match) {
      addPointCommand("C", [
        { x: Number(match[1]), y: Number(match[2]) },
        { x: Number(match[3]), y: Number(match[4]) },
        { x: Number(match[5]), y: Number(match[6]) }
      ]);
      continue;
    }
    match = line.match(new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+v$`));
    if (match) {
      if (!currentPoint) fail("PDF v operator has no current path point");
      addPointCommand("C", [
        { ...currentPoint },
        { x: Number(match[1]), y: Number(match[2]) },
        { x: Number(match[3]), y: Number(match[4]) }
      ]);
      continue;
    }
    match = line.match(new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+y$`));
    if (match) {
      const end = { x: Number(match[3]), y: Number(match[4]) };
      addPointCommand("C", [
        { x: Number(match[1]), y: Number(match[2]) },
        { ...end },
        end
      ]);
      continue;
    }
    match = line.match(
      new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+re$`)
    );
    if (match) {
      const [x, y, widthValue, heightValue] = match.slice(1, 5).map(Number);
      addPointCommand("M", [{ x, y }]);
      addPointCommand("L", [{ x: x + widthValue, y }]);
      addPointCommand("L", [{ x: x + widthValue, y: y + heightValue }]);
      addPointCommand("L", [{ x, y: y + heightValue }]);
      commands.push({ op: "Z", points: [] });
      currentPoint = { x, y };
      continue;
    }
    if (line === "h") {
      commands.push({ op: "Z", points: [] });
      continue;
    }
    if (line === "S" || line === "s") {
      capture(line);
      continue;
    }
    if (/^(?:f\*?|F|B\*?|b\*?|n)$/.test(line)) resetPath();
  }
  // Illustrator opens one page-level clipping state in MC0 and closes it at
  // the beginning of MC1. Optional-content markers therefore do not coincide
  // with the graphics-state lifetime. More than that one verified outer state
  // still signals a malformed or changed source stream.
  if (stack.length > 1) fail("unexpected nested q/Q imbalance in MC0");
  if (candidates.length !== expectedCount) {
    fail(
      `MC0 must yield exactly ${expectedCount} top-level S/s candidates, ` +
      `got ${candidates.length}`
    );
  }
  return candidates;
};

const validateArtifact = async (artifact, schemaPath) => {
  const schema = await readJson(schemaPath);
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(artifact)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    fail(`vector map review artifact failed JSON Schema validation: ${details}`);
  }
};

const readPngDimensions = (header, filePath) => {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (header.length < 24 || !header.subarray(0, 8).equals(pngSignature) ||
      header.readUInt32BE(8) !== 13 || header.subarray(12, 16).toString("ascii") !== "IHDR") {
    fail(`${filePath}: expected a PNG with a standard IHDR header`);
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
};

/** Build the deterministic JSON artifact without writing it. */
export const buildVectorMapReview = async ({
  sourcePath = DEFAULT_SOURCE,
  referencePath = DEFAULT_REFERENCE,
  schemaPath = DEFAULT_SCHEMA,
  outputPath = DEFAULT_OUTPUT,
  backgroundPath = DEFAULT_BACKGROUND
} = {}) => {
  const [pdf, referenceSnapshot, backgroundSnapshot] = await Promise.all([
    readPublicPdfDrawingStream(sourcePath),
    readStableSnapshot(referencePath, {
      captureLimit: REFERENCE_SIZE_LIMIT,
      requireWhole: true
    }),
    readStableSnapshot(backgroundPath, { captureLimit: 32 })
  ]);
  let reference;
  try {
    reference = JSON.parse(referenceSnapshot.data.toString("utf8"));
  } catch (error) {
    fail(`${referencePath}: invalid reference JSON (${error.message})`);
  }
  const backgroundDimensions = readPngDimensions(backgroundSnapshot.data, backgroundPath);
  if (backgroundDimensions.width !== 5079 || backgroundDimensions.height !== 3627) {
    fail(
      `${backgroundPath}: expected canonical 5079 × 3627 background, got ` +
      `${backgroundDimensions.width} × ${backgroundDimensions.height}`
    );
  }
  const referenceNodes = reference.nodes
    .filter((node) => TERMINAL_REFERENCE_PATTERN.test(node.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  if (referenceNodes.length !== TERMINAL_COUNT) {
    fail(`${referencePath}: expected ${TERMINAL_COUNT} numbered terminal references`);
  }
  if (reference.coordinateSystem?.width !== 5079 || reference.coordinateSystem?.height !== 3627) {
    fail(`${referencePath}: canonical coordinate system must be 5079 × 3627`);
  }

  const terminalLayer = extractPublicLayer(pdf.content, "MC2");
  const mapLayer = extractPublicLayer(pdf.content, "MC0");
  assertExpectedPublicLayerStructure(mapLayer, terminalLayer);
  const terminalCenters = extractTerminalGearCenters(terminalLayer);
  const calibration = calibrateTerminalCenters(terminalCenters, referenceNodes);
  const boundaryCandidates = extractBoundaryCandidates(mapLayer, calibration.matrix);
  const outputDirectory = path.dirname(outputPath);

  const artifact = {
    $schema: portablePath(path.relative(outputDirectory, schemaPath)),
    schemaVersion: "1.0",
    status: "review-draft",
    publishable: false,
    warning: "ЧЕРНОВИК ПРОВЕРКИ: извлечены только 981 верхнеуровневая обводка S открытого PDF-слоя; вложенные XObject исключены, а кандидаты ещё не назначены странам и областям. Не использовать для сборки runtime-манифеста.",
    source: {
      file: portablePath(path.relative(outputDirectory, sourcePath)),
      sha256: pdf.sha256,
      bytes: pdf.bytes,
      pdfVersion: pdf.pdfVersion,
      pageObject: pdf.pageObject,
      contentsObject: pdf.contentsObject,
      contentFilter: "FlateDecode",
      publicLayers: { map: "MC0", terminals: "MC2" },
      illustratorPrivateDataParsed: false
    },
    referenceAnnotation: {
      file: portablePath(path.relative(outputDirectory, referencePath)),
      sha256: referenceSnapshot.sha256,
      nodeSelector: "^terminal-[0-9]+$",
      terminalCount: TERMINAL_COUNT
    },
    backgroundImage: {
      file: portablePath(path.relative(outputDirectory, backgroundPath)),
      sha256: backgroundSnapshot.sha256,
      bytes: backgroundSnapshot.bytes,
      format: "png",
      pixelWidth: backgroundDimensions.width,
      pixelHeight: backgroundDimensions.height
    },
    coordinateSystem: {
      origin: "top-left",
      units: "design-pixel",
      width: 5079,
      height: 3627
    },
    calibration: {
      kind: "affine-least-squares",
      method: "23 terminal gear centers; deterministic bounding-box orientation match followed by six-parameter least-squares fit",
      pdfToCanonical: Object.fromEntries(
        Object.entries(calibration.matrix).map(([key, value]) => [key, round(value, 9)])
      ),
      initialAxisAlignment: {
        scaleX: round(calibration.initialAlignment.scaleX, 9),
        scaleY: round(calibration.initialAlignment.scaleY, 9),
        offsetX: round(calibration.initialAlignment.offsetX, 9),
        offsetY: round(calibration.initialAlignment.offsetY, 9)
      },
      rmsErrorPx: round(calibration.rmsError),
      meanErrorPx: round(calibration.meanError),
      maxErrorPx: round(calibration.maxError),
      acceptanceThresholdPx: CALIBRATION_ACCEPTANCE_PX
    },
    terminalCandidates: calibration.pairs.map((pair, index) => ({
      id: `vector-terminal-candidate-${String(index + 1).padStart(2, "0")}`,
      sourceOrder: index + 1,
      mappedReferenceId: pair.reference.id,
      pdfPosition: roundPoint(pair.source),
      canonicalPosition: roundPoint(pair.calibrated, 3),
      referencePosition: roundPoint(pair.reference.position, 3),
      residualPx: round(pair.residual)
    })),
    boundaryCandidatePolicy: {
      sourceLayer: "MC0",
      extractionScope: "top-level-page-content-only",
      selectedPaintOperators: ["S", "s"],
      expectedTopLevelStrokeCount: EXPECTED_MC0_PAINT_COUNTS.S,
      excludedXObjects: [...EXPECTED_MC0_XOBJECTS],
      excludedContent: ["known XObjects", "filled shapes", "text", "Illustrator private data"],
      semanticAssignment: null,
      requiresHumanClassification: true
    },
    boundaryCandidates,
    summary: {
      terminalCandidateCount: terminalCenters.length,
      matchedTerminalCount: calibration.pairs.length,
      boundaryCandidateCount: boundaryCandidates.length,
      assignedRegionCount: 0,
      assignedCountryCount: 0
    }
  };
  await validateArtifact(artifact, schemaPath);
  // The WeakSet is a process-local validation brand. Deep freezing prevents a
  // caller from changing a schema-checked value before rendering the overlay.
  deepFreeze(artifact);
  validatedArtifacts.add(artifact);
  return artifact;
};

const xmlEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const svgNumber = (value) => round(value, 3);

const assertSafeBackgroundHref = (backgroundHref) => {
  if (typeof backgroundHref !== "string" || backgroundHref.length === 0) {
    fail("backgroundHref must be a non-empty relative file path");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(backgroundHref) ||
      path.posix.isAbsolute(backgroundHref) ||
      path.win32.isAbsolute(backgroundHref) ||
      backgroundHref.startsWith("\\\\")) {
    fail("backgroundHref must be relative and must not be a URI");
  }
};

const commandToSvg = (command, matrix) => {
  if (command.op === "Z") return "Z";
  const points = command.points.map((point) => applyAffine(matrix, point));
  return `${command.op} ${points.map((point) => `${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" ")}`;
};

const compareNumbers = (left, right) => left - right;

const compareStrokeStyles = (left, right) => {
  for (let index = 0; index < 4; index += 1) {
    const difference = compareNumbers(left.cmyk[index], right.cmyk[index]);
    if (difference !== 0) return difference;
  }
  return (
    compareNumbers(left.width, right.width) ||
    compareNumbers(left.lineCap, right.lineCap) ||
    compareNumbers(left.lineJoin, right.lineJoin)
  );
};

/**
 * Serialize the exact source values rather than a display colour. The key is
 * hashed into the SVG group id so repeated extraction keeps the same identity
 * even when a future reviewed source introduces another style before it.
 */
const strokeStyleKey = (style) =>
  `cmyk=${style.cmyk.join(",")};width=${style.width};cap=${style.lineCap};join=${style.lineJoin}`;

/**
 * Group candidates by every source stroke attribute preserved in the JSON.
 * The artifact has already passed its JSON Schema before this function runs;
 * this is a presentation transform, not a second imperative validator.
 */
export const groupBoundaryCandidatesByStrokeStyle = (candidates) => {
  const byStyle = new Map();
  for (const candidate of candidates) {
    const key = strokeStyleKey(candidate.strokeStyle);
    const existing = byStyle.get(key);
    if (existing) {
      existing.candidates.push(candidate);
    } else {
      byStyle.set(key, {
        key,
        id: `boundary-style-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
        style: candidate.strokeStyle,
        candidates: [candidate]
      });
    }
  }
  return [...byStyle.values()].sort((left, right) =>
    compareStrokeStyles(left.style, right.style));
};

const cmykToHex = (cmyk) => {
  const channels = cmyk.slice(0, 3).map((component) =>
    Math.round(255 * (1 - Math.min(1, component + cmyk[3]))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

const SVG_LINE_CAPS = ["butt", "round", "square"];
const SVG_LINE_JOINS = ["miter", "round", "bevel"];

const renderStyleLegend = (groups) => {
  const panelX = 2110;
  const panelY = 36;
  const panelWidth = 2933;
  const panelHeight = 544;
  const columnCount = 2;
  const rowsPerColumn = Math.ceil(groups.length / columnCount);
  const columnWidth = 1430;
  const entries = groups.map((group, index) => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = panelX + 42 + column * columnWidth;
    const y = panelY + 112 + row * 46;
    const order = String(index + 1).padStart(2, "0");
    const colour = cmykToHex(group.style.cmyk);
    const label = (
      `S${order} · ${group.candidates.length} шт. · ` +
      `CMYK ${group.style.cmyk.join("/")} · w ${group.style.width} · ` +
      `cap ${group.style.lineCap} · join ${group.style.lineJoin}`
    );
    return [
      `    <g aria-label="${xmlEscape(label)}">`,
      `      <line x1="${x}" y1="${y - 8}" x2="${x + 72}" y2="${y - 8}" ` +
        `stroke="${colour}" stroke-width="${Math.max(5, group.style.width * 5)}" ` +
        `stroke-linecap="${SVG_LINE_CAPS[group.style.lineCap]}" ` +
        `stroke-linejoin="${SVG_LINE_JOINS[group.style.lineJoin]}" />`,
      `      <text x="${x + 92}" y="${y}" fill="#ffffff" font-size="23">${xmlEscape(label)}</text>`,
      "    </g>"
    ].join("\n");
  }).join("\n");
  return `  <g id="stroke-style-legend" role="group" aria-labelledby="stroke-style-legend-title" font-family="sans-serif">
    <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="20" fill="#10151d" fill-opacity="0.94" stroke="#b9d7e8" stroke-width="4" />
    <text id="stroke-style-legend-title" x="${panelX + 42}" y="${panelY + 61}" fill="#ffffff" font-size="31" font-weight="700">Исходные стили линий · ${groups.length} групп · ${groups.reduce((sum, group) => sum + group.candidates.length, 0)} кандидатов</text>
${entries}
  </g>`;
};

/** Build the human-review overlay from the JSON artifact. */
export const createReviewOverlay = (artifact, { backgroundHref }) => {
  if (!validatedArtifacts.has(artifact)) {
    fail("createReviewOverlay requires the immutable schema-validated artifact returned by buildVectorMapReview");
  }
  assertSafeBackgroundHref(backgroundHref);
  const matrix = artifact.calibration.pdfToCanonical;
  const styleGroups = groupBoundaryCandidatesByStrokeStyle(artifact.boundaryCandidates);
  const paths = styleGroups.map((group, index) => {
    const styleNumber = String(index + 1).padStart(2, "0");
    const styleLabel = (
      `Стиль S${styleNumber}: ${group.candidates.length} кандидатов; ` +
      `CMYK ${group.style.cmyk.join("/")}; ширина ${group.style.width}; ` +
      `окончание ${group.style.lineCap}; стык ${group.style.lineJoin}`
    );
    const candidates = group.candidates.map((candidate) => {
      const data = candidate.pdfCommands.map((command) => commandToSvg(command, matrix)).join(" ");
      return [
        `      <path id="${xmlEscape(candidate.id)}" data-candidate-id="${xmlEscape(candidate.id)}" d="${data}">`,
        `        <title>${xmlEscape(candidate.id)} · S${styleNumber}</title>`,
        "      </path>"
      ].join("\n");
    }).join("\n");
    return [
      `    <g id="${group.id}" data-style-order="${styleNumber}" ` +
        `data-candidate-count="${group.candidates.length}" ` +
        `data-stroke-style="${xmlEscape(group.key)}" fill="none" ` +
        `stroke="${cmykToHex(group.style.cmyk)}" ` +
        `stroke-width="${Math.max(3, svgNumber(group.style.width * 4))}" ` +
        `stroke-linecap="${SVG_LINE_CAPS[group.style.lineCap]}" ` +
        `stroke-linejoin="${SVG_LINE_JOINS[group.style.lineJoin]}" ` +
        `opacity="0.94" role="group" aria-labelledby="${group.id}-title">`,
      `      <title id="${group.id}-title">${xmlEscape(styleLabel)}</title>`,
      candidates,
      "    </g>"
    ].join("\n");
  }).join("\n");
  const terminals = artifact.terminalCandidates.map((candidate) => {
    const { x, y } = candidate.canonicalPosition;
    const label = candidate.mappedReferenceId.replace("terminal-", "");
    return [
      `    <circle cx="${x}" cy="${y}" r="15" />`,
      `    <text x="${x + 22}" y="${y - 22}">${xmlEscape(label)}</text>`
    ].join("\n");
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="5079" height="3627" viewBox="0 0 5079 3627" role="img" aria-labelledby="title description">
  <title id="title">Проверочное наложение векторных кандидатов карты</title>
  <desc id="description">Непубликационный слой для ручной классификации: 981 линия сгруппирована по точному исходному стилю CMYK, ширине, окончанию и стыку. Идентификатор каждой линии доступен как идентификатор элемента и во всплывающей подсказке. Линии ещё не назначены областям и странам; бирюзовые точки показывают калибровку по 23 терминалам.</desc>
  <image href="${xmlEscape(backgroundHref)}" x="0" y="0" width="5079" height="3627" preserveAspectRatio="none" opacity="0.5" />
  <g id="unclassified-boundary-candidates" aria-label="Неразмеченные кандидаты границ">
${paths}
  </g>
  <g id="calibration-terminals" fill="#00e5ff" stroke="#002c38" stroke-width="4" font-family="sans-serif" font-size="38" font-weight="700">
${terminals}
  </g>
  <g id="review-warning" font-family="sans-serif">
    <rect x="36" y="36" width="2010" height="178" rx="20" fill="#201024" fill-opacity="0.92" stroke="#ff4df5" stroke-width="5" />
    <text x="78" y="105" fill="#ffffff" font-size="43" font-weight="700">ЧЕРНОВИК: контуры не назначены областям</text>
    <text x="78" y="166" fill="#ffd9fb" font-size="34">${artifact.summary.boundaryCandidateCount} верхнеуровневых обводок · ошибка калибровки ≤ ${artifact.calibration.maxErrorPx} px</text>
  </g>
${renderStyleLegend(styleGroups)}
</svg>
`;
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
      "--input": "sourcePath",
      "--reference": "referencePath",
      "--schema": "schemaPath",
      "--output": "outputPath",
      "--overlay": "overlayPath",
      "--background": "backgroundPath"
    }[argument];
    if (!key) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) fail(`${argument} requires a file path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
};

const assertFileEquals = async (filePath, expected) => {
  let actual;
  try {
    actual = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${filePath} is missing; run the extractor without --check`);
    throw error;
  }
  if (actual !== expected) fail(`${filePath} is stale; regenerate the vector-map review artifacts`);
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
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`
  );
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0);
  const handle = await open(temporaryPath, flags, 0o644);
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
    const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

/**
 * Replace each derivative atomically. Both O_EXCL temporary files are fully
 * written and fsynced before either rename, and directory metadata is fsynced
 * afterwards. Rename replaces an output link itself instead of following it.
 */
const writeArtifactPairAtomically = async ({ outputPath, json, overlayPath, overlay }) => {
  let jsonTemporary;
  let overlayTemporary;
  try {
    jsonTemporary = await writeExclusiveTemporaryFile(outputPath, json);
    overlayTemporary = await writeExclusiveTemporaryFile(overlayPath, overlay);
    await rename(jsonTemporary, outputPath);
    jsonTemporary = null;
    await rename(overlayTemporary, overlayPath);
    overlayTemporary = null;
    await syncDirectories([path.dirname(outputPath), path.dirname(overlayPath)]);
  } finally {
    await Promise.all([
      removeTemporaryFile(jsonTemporary),
      removeTemporaryFile(overlayTemporary)
    ]);
  }
};

/** CLI entry point used both for deterministic generation and CI freshness checks. */
export const runCli = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  const sourcePath = options.sourcePath ?? DEFAULT_SOURCE;
  const referencePath = options.referencePath ?? DEFAULT_REFERENCE;
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT;
  const overlayPath = options.overlayPath ?? DEFAULT_OVERLAY;
  const backgroundPath = options.backgroundPath ?? DEFAULT_BACKGROUND;
  await assertSafeArtifactPaths({
    sourcePath,
    referencePath,
    schemaPath,
    backgroundPath,
    outputPath,
    overlayPath
  });
  const artifact = await buildVectorMapReview({
    sourcePath,
    referencePath,
    schemaPath,
    outputPath,
    backgroundPath
  });
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const backgroundHref = portablePath(path.relative(path.dirname(overlayPath), backgroundPath));
  const overlay = createReviewOverlay(artifact, { backgroundHref });
  if (options.check) {
    await Promise.all([
      assertFileEquals(outputPath, json),
      assertFileEquals(overlayPath, overlay)
    ]);
    process.stdout.write(
      `Vector map review is current: ${artifact.summary.terminalCandidateCount} terminals, ` +
      `${artifact.summary.boundaryCandidateCount} unclassified boundary candidates.\n`
    );
    return artifact;
  }
  await writeArtifactPairAtomically({ outputPath, json, overlayPath, overlay });
  process.stdout.write(
    `Wrote review-only vector map artifacts: ${artifact.summary.terminalCandidateCount} terminals, ` +
    `${artifact.summary.boundaryCandidateCount} unclassified boundary candidates.\n`
  );
  return artifact;
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
