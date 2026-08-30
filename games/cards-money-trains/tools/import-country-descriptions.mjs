#!/usr/bin/env node
/**
 * Extract the author's country descriptions PDF into a review-only fixture.
 *
 * The PDF remains immutable evidence. This tool preserves page order, source
 * titles, terminal labels and both line-preserving and normalized narrative
 * text. It deliberately does not assign map country IDs, terminal IDs or
 * coordinates: those mappings require a separate content review.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const executeFile = promisify(execFile);
const scriptFile = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(scriptFile);
const packageRoot = path.resolve(toolRoot, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const sourceRepositoryPath = "draft/trains/Описания стран Гвинеи 1 стол.pdf";
const defaultSourcePath = path.join(repoRoot, ...sourceRepositoryPath.split("/"));
const defaultSchemaPath = path.join(
  packageRoot,
  "authoring",
  "fixtures",
  "country-descriptions.intake.schema.json"
);
const defaultOutputPath = path.join(
  packageRoot,
  "authoring",
  "fixtures",
  "country-descriptions.intake.json"
);
const expectedPageCount = 10;
const terminalLinePattern = /^Терминал(?:ы)?:\s*(.+)$/u;

class CountryDescriptionsIntakeError extends Error {
  /** Create a stable, non-secret error suitable for CI and authoring reports. */
  constructor(message) {
    super(message);
    this.name = "CountryDescriptionsIntakeError";
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readJson = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new CountryDescriptionsIntakeError(
      `cannot read JSON "${path.relative(repoRoot, filePath)}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const reviewRecordId = (sourceOrder) =>
  `country-description-review-${String(sourceOrder).padStart(2, "0")}`;

/**
 * Turn one pdftotext page into a source-faithful review record.
 *
 * `sourceNarrative` keeps the extractor's line wrapping. `text` only joins
 * those soft line breaks with spaces, making the same words usable by the
 * authoring UI without pretending to reconstruct the DOCX paragraph model.
 */
const normalizePage = (pageText, sourcePage, sourceOrder) => {
  const lines = pageText
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0].trim().length === 0) lines.shift();
  while (lines.length > 0 && lines.at(-1).trim().length === 0) lines.pop();

  if (lines.length < 2) {
    throw new CountryDescriptionsIntakeError(`PDF page ${sourcePage} contains no complete country description`);
  }

  const sourceTitle = lines.shift().trim();
  if (sourceTitle.length === 0 || sourceTitle.length > 160) {
    throw new CountryDescriptionsIntakeError(`PDF page ${sourcePage} has an invalid source title`);
  }

  let sourceTerminalLine = null;
  let sourceTerminalLabels = [];
  const terminalMatch = terminalLinePattern.exec(lines[0]?.trim() ?? "");
  if (terminalMatch) {
    sourceTerminalLine = lines.shift().trim();
    sourceTerminalLabels = terminalMatch[1].split(",").map((label) => label.trim());
    if (
      sourceTerminalLabels.length === 0 ||
      sourceTerminalLabels.some((label) => !/^(?:[1-9]|1[0-9]|2[0-3])$/u.test(label)) ||
      new Set(sourceTerminalLabels).size !== sourceTerminalLabels.length
    ) {
      throw new CountryDescriptionsIntakeError(`PDF page ${sourcePage} has invalid source terminal labels`);
    }
  }

  const narrativeLines = lines.map((line) => line.trim());
  if (narrativeLines.some((line) => line.length === 0)) {
    throw new CountryDescriptionsIntakeError(
      `PDF page ${sourcePage} contains an unexpected blank line; review paragraph extraction before importing`
    );
  }
  const sourceNarrative = narrativeLines.join("\n");
  const text = narrativeLines.join(" ").replace(/\s+/gu, " ").trim();
  if (sourceNarrative.length === 0 || text.length === 0 || text.length > 12_000) {
    throw new CountryDescriptionsIntakeError(`PDF page ${sourcePage} has an invalid narrative`);
  }

  return {
    id: reviewRecordId(sourceOrder),
    sourcePage,
    sourceOrder,
    sourceTitle,
    sourceTerminalLine,
    sourceTerminalLabels,
    sourceNarrative,
    text
  };
};

/**
 * Normalize the complete pdftotext result and fail closed on source changes.
 */
const normalizePdfText = (rawText, sourceSha256) => {
  if (typeof rawText !== "string" || rawText.includes("\u0000")) {
    throw new CountryDescriptionsIntakeError("pdftotext returned invalid UTF-8 text");
  }
  const pageParts = rawText.replace(/\r\n?/gu, "\n").split("\f");
  while (pageParts.length > 0 && pageParts.at(-1).trim().length === 0) pageParts.pop();
  if (pageParts.length !== expectedPageCount) {
    throw new CountryDescriptionsIntakeError(
      `country descriptions PDF must contain exactly ${expectedPageCount} extractable pages`
    );
  }

  const countryRecords = pageParts.map((pageText, index) =>
    normalizePage(pageText, index + 1, index + 1)
  );
  const titles = countryRecords.map((record) => record.sourceTitle);
  if (new Set(titles).size !== titles.length) {
    throw new CountryDescriptionsIntakeError("country descriptions PDF contains duplicate source titles");
  }

  const allTerminalLabels = countryRecords.flatMap((record) => record.sourceTerminalLabels);
  const expectedTerminalLabels = Array.from({ length: 23 }, (_, index) => String(index + 1));
  const sortedTerminalLabels = [...allTerminalLabels].sort((left, right) => Number(left) - Number(right));
  try {
    assert.deepEqual(sortedTerminalLabels, expectedTerminalLabels);
  } catch {
    throw new CountryDescriptionsIntakeError(
      "source terminal labels must contain every label from 1 to 23 exactly once"
    );
  }

  return {
    $schema: "./country-descriptions.intake.schema.json",
    apiVersion: "cubica.game/cards-money-trains-country-descriptions-intake/v1",
    gameId: "cards-money-trains",
    locale: "ru-RU",
    status: "review-draft",
    publishable: false,
    source: {
      path: sourceRepositoryPath,
      sha256: sourceSha256,
      extractor: "pdftotext -layout -enc UTF-8",
      pageCount: expectedPageCount
    },
    summary: {
      countryRecordCount: countryRecords.length,
      recordsWithTerminalLabels: countryRecords.filter(
        (record) => record.sourceTerminalLabels.length > 0
      ).length,
      sourceTerminalLabelCount: allTerminalLabels.length
    },
    unresolved: {
      countryIdMapping: "not-reviewed",
      terminalIdMapping: "not-reviewed",
      mapCoordinatesConfirmed: false,
      productionManifestLinked: false
    },
    countryRecords
  };
};

const validateIntake = async (content, schemaPath = defaultSchemaPath) => {
  const schema = await readJson(schemaPath);
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false
  });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    throw new CountryDescriptionsIntakeError(
      `intake schema compilation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!validate(content)) {
    throw new CountryDescriptionsIntakeError(
      ajv.errorsText(validate.errors, { separator: "\n", dataVar: "content" })
    );
  }
  if (new Set(content.countryRecords.map((record) => record.id)).size !== content.countryRecords.length) {
    throw new CountryDescriptionsIntakeError("country description intake contains duplicate record ids");
  }
  return content;
};

const extractPdfText = async (sourcePath = defaultSourcePath) => {
  try {
    const { stdout } = await executeFile(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", sourcePath, "-"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true
      }
    );
    return stdout;
  } catch (error) {
    const stderr = error && typeof error === "object" && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
    const details = stderr || (error instanceof Error ? error.message : String(error));
    throw new CountryDescriptionsIntakeError(`country description extraction failed: ${details}`);
  }
};

/**
 * Read the PDF as one stable snapshot around the external extractor.
 *
 * Byte comparison prevents a concurrently replaced author file from producing
 * text and provenance that refer to different source versions.
 */
const buildCountryDescriptionsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath
} = {}) => {
  const before = await readFile(sourcePath);
  const extracted = await extractPdfText(sourcePath);
  const after = await readFile(sourcePath);
  if (!before.equals(after)) {
    throw new CountryDescriptionsIntakeError("country descriptions PDF changed during extraction");
  }
  return validateIntake(normalizePdfText(extracted, sha256(before)), schemaPath);
};

const assertSafeOutputPath = async (outputPath = defaultOutputPath) => {
  const resolved = path.resolve(outputPath);
  const relative = path.relative(repoRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new CountryDescriptionsIntakeError("intake output must stay inside the repository");
  }
  const protectedPaths = [defaultSourcePath, defaultSchemaPath, scriptFile];
  if (protectedPaths.some((protectedPath) => path.resolve(protectedPath) === resolved)) {
    throw new CountryDescriptionsIntakeError("intake output must not overwrite an input or tool");
  }
  try {
    const outputInfo = await lstat(resolved);
    if (outputInfo.isSymbolicLink()) {
      throw new CountryDescriptionsIntakeError("intake output must not be a symbolic link");
    }
    const outputStat = await stat(resolved);
    for (const protectedPath of protectedPaths) {
      const protectedStat = await stat(protectedPath);
      if (outputStat.dev === protectedStat.dev && outputStat.ino === protectedStat.ino) {
        throw new CountryDescriptionsIntakeError("intake output must not alias an input or tool");
      }
    }
  } catch (error) {
    if (error instanceof CountryDescriptionsIntakeError) throw error;
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  const parent = await realpath(path.dirname(resolved));
  const repository = await realpath(repoRoot);
  if (parent !== repository && !parent.startsWith(`${repository}${path.sep}`)) {
    throw new CountryDescriptionsIntakeError("intake output parent resolves outside the repository");
  }
  return resolved;
};

const writeCountryDescriptionsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath,
  outputPath = defaultOutputPath
} = {}) => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const resolvedOutput = await assertSafeOutputPath(outputPath);
  const content = await buildCountryDescriptionsIntake({ sourcePath, schemaPath });
  const temporaryPath = `${resolvedOutput}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, resolvedOutput);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
  return content;
};

const checkCountryDescriptionsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath,
  outputPath = defaultOutputPath
} = {}) => {
  const [expected, actual] = await Promise.all([
    buildCountryDescriptionsIntake({ sourcePath, schemaPath }),
    readJson(outputPath)
  ]);
  await validateIntake(actual, schemaPath);
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new CountryDescriptionsIntakeError(
      "committed country description intake is stale; run the importer"
    );
  }
  return actual;
};

const parseArguments = (argv) => {
  if (argv.length === 0) return { checkOnly: false };
  if (argv.length === 1 && argv[0] === "--check") return { checkOnly: true };
  throw new CountryDescriptionsIntakeError(
    "usage: import-country-descriptions.mjs [--check]"
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const run = async () => {
    const { checkOnly } = parseArguments(process.argv.slice(2));
    const content = checkOnly
      ? await checkCountryDescriptionsIntake()
      : await writeCountryDescriptionsIntake();
    process.stdout.write(
      `cards-money-trains: ${checkOnly ? "verified" : "imported"} ${content.summary.countryRecordCount} country descriptions\n`
    );
  };
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  CountryDescriptionsIntakeError,
  buildCountryDescriptionsIntake,
  checkCountryDescriptionsIntake,
  defaultOutputPath,
  defaultSchemaPath,
  defaultSourcePath,
  normalizePdfText,
  validateIntake,
  writeCountryDescriptionsIntake
};
