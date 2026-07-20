#!/usr/bin/env node
/**
 * Extract author cargo/news workbook rows into a deterministic intake artifact.
 *
 * The XLSX remains immutable evidence. This tool deliberately stops before
 * runtime publication: it records source rows and direct deck links, while
 * author-confirmed card multiplicity and the remaining executable-news gap
 * stay explicit.
 * JSON Schema is the structural source of truth for the derived artifact.
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
const defaultSourcePath = path.join(repoRoot, "draft", "trains", "Колоди + Новости.xlsx");
const defaultSchemaPath = path.join(packageRoot, "authoring", "fixtures", "cargo-news.intake.schema.json");
const defaultOutputPath = path.join(packageRoot, "authoring", "fixtures", "cargo-news.intake.json");
const xlsxReaderPath = path.join(toolRoot, "read-xlsx-rows.py");
const sourceRepositoryPath = "draft/trains/Колоди + Новости.xlsx";
const cargoSheetName = "Колоды по терминалам";
const newsSheetName = "Новости (2 типов)";
const cargoHeader = ["Терминал отправления", "Терминал прибытия", "Стоимость", "Колода"];
const newsHeader = ["Тип новости", "Номер новости", "Новость"];
const cargoAdditionLabel = "Добавление карточек грузов";
const ruleNewsLabel = "Ограничения, пошлины, плюшки";

class CargoNewsIntakeError extends Error {
  /** Create a stable error suitable for an authoring report or CI output. */
  constructor(message) {
    super(message);
    this.name = "CargoNewsIntakeError";
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readJson = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new CargoNewsIntakeError(
      `cannot read JSON "${path.relative(repoRoot, filePath)}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const requireInteger = (value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CargoNewsIntakeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
};

const requireText = (value, label, maximum = 4000) => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new CargoNewsIntakeError(`${label} must be non-empty source text without surrounding whitespace`);
  }
  return value;
};

const requireRow = (row, sheetName, sourceRow, width) => {
  if (!Array.isArray(row) || row.length !== width || row.some((value) => value === null || value === undefined)) {
    throw new CargoNewsIntakeError(`${sheetName} row ${sourceRow} must contain exactly ${width} populated cells`);
  }
  return row;
};

const assertHeader = (actual, expected, sheetName) => {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new CargoNewsIntakeError(`${sheetName} header changed; expected ${JSON.stringify(expected)}`);
  }
};

const terminalId = (number) => `terminal-${number}`;
const newsId = (number) => `news-${String(number).padStart(2, "0")}`;
const cargoId = (sourceRow) => `cargo-source-row-${String(sourceRow).padStart(3, "0")}`;

/**
 * Interpret only structure stated directly by workbook columns and labels.
 *
 * A row becomes one physical-card record because the author has now confirmed
 * that multiplicity rule. Runtime publication is still a separate step: this
 * intake remains non-publishable and preserves the incomplete news-effect
 * mapping as an explicit gap.
 */
const normalizeWorkbook = (workbook, sourceSha256) => {
  if (!workbook || !Array.isArray(workbook.sheets)) {
    throw new CargoNewsIntakeError("XLSX reader returned no worksheet list");
  }
  const names = workbook.sheets.map((sheet) => sheet?.name);
  assertHeader(names, [cargoSheetName, newsSheetName], "workbook");
  const cargoRows = workbook.sheets[0]?.rows;
  const newsRows = workbook.sheets[1]?.rows;
  if (!Array.isArray(cargoRows) || cargoRows.length !== 175) {
    throw new CargoNewsIntakeError(`${cargoSheetName} must contain one header and 174 source rows`);
  }
  if (!Array.isArray(newsRows) || newsRows.length !== 35) {
    throw new CargoNewsIntakeError(`${newsSheetName} must contain one header and 34 source rows`);
  }
  assertHeader(cargoRows[0], cargoHeader, cargoSheetName);
  assertHeader(newsRows[0], newsHeader, newsSheetName);

  const cargoRecords = cargoRows.slice(1).map((rawRow, index) => {
    const sourceRow = index + 2;
    const row = requireRow(rawRow, cargoSheetName, sourceRow, 4);
    const origin = requireInteger(row[0], `${cargoSheetName} row ${sourceRow} origin`, { minimum: 1, maximum: 23 });
    const destination = requireInteger(row[1], `${cargoSheetName} row ${sourceRow} destination`, { minimum: 1, maximum: 23 });
    if (origin === destination) {
      throw new CargoNewsIntakeError(`${cargoSheetName} row ${sourceRow} has identical endpoints`);
    }
    const payout = requireInteger(row[2], `${cargoSheetName} row ${sourceRow} payout`, { maximum: 1000 });
    const sourceDeckLabel = requireText(row[3], `${cargoSheetName} row ${sourceRow} deck`, 100);
    const baseMatch = /^([1-9]|1[0-9]|2[0-3]) терминал$/u.exec(sourceDeckLabel);
    const newsMatch = /^Колода новости ([1-9]|10)$/u.exec(sourceDeckLabel);
    let deck;
    if (baseMatch) {
      const deckTerminal = Number(baseMatch[1]);
      if (deckTerminal !== origin) {
        throw new CargoNewsIntakeError(
          `${cargoSheetName} row ${sourceRow} base deck terminal does not match its origin`
        );
      }
      deck = { kind: "base-terminal", terminalId: terminalId(deckTerminal) };
    } else if (newsMatch) {
      deck = { kind: "news-addition", newsId: newsId(Number(newsMatch[1])) };
    } else {
      throw new CargoNewsIntakeError(`${cargoSheetName} row ${sourceRow} has an unknown deck label`);
    }
    return {
      id: cargoId(sourceRow),
      sourceRow,
      originNodeId: terminalId(origin),
      destinationNodeId: terminalId(destination),
      bankPayout: payout,
      sourceDeckLabel,
      deck
    };
  });

  const cargoByNews = new Map();
  for (const cargo of cargoRecords) {
    if (cargo.deck.kind !== "news-addition") continue;
    const linked = cargoByNews.get(cargo.deck.newsId) ?? [];
    linked.push(cargo.id);
    cargoByNews.set(cargo.deck.newsId, linked);
  }

  const seenNewsNumbers = new Set();
  const newsRecords = newsRows.slice(1).map((rawRow, index) => {
    const sourceRow = index + 2;
    const row = requireRow(rawRow, newsSheetName, sourceRow, 3);
    const sourceCategoryLabel = requireText(row[0], `${newsSheetName} row ${sourceRow} category`, 100);
    const number = requireInteger(row[1], `${newsSheetName} row ${sourceRow} number`, { minimum: 1, maximum: 34 });
    if (seenNewsNumbers.has(number)) {
      throw new CargoNewsIntakeError(`${newsSheetName} contains duplicate news number ${number}`);
    }
    seenNewsNumbers.add(number);
    const expectedCategory = number <= 10 ? cargoAdditionLabel : ruleNewsLabel;
    if (sourceCategoryLabel !== expectedCategory) {
      throw new CargoNewsIntakeError(`${newsSheetName} row ${sourceRow} category does not match news ${number}`);
    }
    return {
      id: newsId(number),
      sourceRow,
      number,
      category: number <= 10 ? "cargo-addition" : "rule-modifier",
      sourceCategoryLabel,
      text: requireText(row[2], `${newsSheetName} row ${sourceRow} text`),
      linkedCargoRecordIds: cargoByNews.get(newsId(number)) ?? []
    };
  });
  if (seenNewsNumbers.size !== 34 || [...seenNewsNumbers].some((number) => number < 1 || number > 34)) {
    throw new CargoNewsIntakeError(`${newsSheetName} must contain every news number from 1 to 34 exactly once`);
  }
  for (let number = 1; number <= 10; number += 1) {
    if (!cargoByNews.has(newsId(number))) {
      throw new CargoNewsIntakeError(`news ${number} has no linked cargo rows`);
    }
  }

  const baseCargoRecordCount = cargoRecords.filter((item) => item.deck.kind === "base-terminal").length;
  const newsAddedCargoRecordCount = cargoRecords.length - baseCargoRecordCount;
  return {
    apiVersion: "cubica.game/cards-money-trains-content-intake/v1",
    gameId: "cards-money-trains",
    locale: "ru-RU",
    status: "content-intake",
    publishable: false,
    source: {
      path: sourceRepositoryPath,
      sha256: sourceSha256,
      sheets: [cargoSheetName, newsSheetName]
    },
    summary: {
      cargoRecordCount: cargoRecords.length,
      baseCargoRecordCount,
      newsAddedCargoRecordCount,
      newsRecordCount: newsRecords.length,
      cargoAdditionNewsCount: newsRecords.filter((item) => item.category === "cargo-addition").length,
      ruleNewsCount: newsRecords.filter((item) => item.category === "rule-modifier").length
    },
    authorConfirmations: {
      oneSourceRowEqualsOneRuntimeCard: true,
      runtimeDeckLifecycleApproved: true
    },
    unresolved: {
      executableNewsMappingComplete: false
    },
    cargoRecords,
    newsRecords
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
    throw new CargoNewsIntakeError(`intake schema compilation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!validate(content)) {
    throw new CargoNewsIntakeError(
      ajv.errorsText(validate.errors, { separator: "\n", dataVar: "content" })
    );
  }
  const allIds = [...content.cargoRecords.map((item) => item.id), ...content.newsRecords.map((item) => item.id)];
  if (new Set(allIds).size !== allIds.length) {
    throw new CargoNewsIntakeError("intake contains duplicate record ids");
  }
  return content;
};

const readWorkbookRows = async (sourcePath = defaultSourcePath) => {
  try {
    const { stdout } = await executeFile("python3", [xlsxReaderPath, sourcePath], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true
    });
    return JSON.parse(stdout);
  } catch (error) {
    const details = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr).trim()
      : error instanceof Error ? error.message : String(error);
    throw new CargoNewsIntakeError(`author workbook extraction failed: ${details}`);
  }
};

/**
 * Read the source as one stable snapshot. Comparing bytes around the parser
 * prevents an editor from changing the workbook halfway through extraction.
 */
const buildCargoNewsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath
} = {}) => {
  const before = await readFile(sourcePath);
  const workbook = await readWorkbookRows(sourcePath);
  const after = await readFile(sourcePath);
  if (!before.equals(after)) {
    throw new CargoNewsIntakeError("author workbook changed during extraction");
  }
  return validateIntake(normalizeWorkbook(workbook, sha256(before)), schemaPath);
};

const assertSafeOutputPath = async (outputPath = defaultOutputPath) => {
  const resolved = path.resolve(outputPath);
  const relative = path.relative(repoRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new CargoNewsIntakeError("intake output must stay inside the repository");
  }
  const protectedPaths = [defaultSourcePath, defaultSchemaPath, xlsxReaderPath, scriptFile];
  if (protectedPaths.some((protectedPath) => path.resolve(protectedPath) === resolved)) {
    throw new CargoNewsIntakeError("intake output must not overwrite an input or tool");
  }
  try {
    const outputInfo = await lstat(resolved);
    if (outputInfo.isSymbolicLink()) throw new CargoNewsIntakeError("intake output must not be a symbolic link");
    const outputStat = await stat(resolved);
    for (const protectedPath of protectedPaths) {
      const protectedStat = await stat(protectedPath);
      if (outputStat.dev === protectedStat.dev && outputStat.ino === protectedStat.ino) {
        throw new CargoNewsIntakeError("intake output must not alias an input or tool");
      }
    }
  } catch (error) {
    if (error instanceof CargoNewsIntakeError) throw error;
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  const parent = await realpath(path.dirname(resolved));
  const repo = await realpath(repoRoot);
  if (parent !== repo && !parent.startsWith(`${repo}${path.sep}`)) {
    throw new CargoNewsIntakeError("intake output parent resolves outside the repository");
  }
  return resolved;
};

const writeCargoNewsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath,
  outputPath = defaultOutputPath
} = {}) => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const resolvedOutput = await assertSafeOutputPath(outputPath);
  const content = await buildCargoNewsIntake({ sourcePath, schemaPath });
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

const checkCargoNewsIntake = async ({
  sourcePath = defaultSourcePath,
  schemaPath = defaultSchemaPath,
  outputPath = defaultOutputPath
} = {}) => {
  const [expected, actual] = await Promise.all([
    buildCargoNewsIntake({ sourcePath, schemaPath }),
    readJson(outputPath)
  ]);
  await validateIntake(actual, schemaPath);
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new CargoNewsIntakeError("committed cargo/news intake is stale; run the importer");
  }
  return actual;
};

const parseArguments = (argv) => {
  if (argv.length === 0) return { checkOnly: false };
  if (argv.length === 1 && argv[0] === "--check") return { checkOnly: true };
  throw new CargoNewsIntakeError('usage: import-cargo-news.mjs [--check]');
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const run = async () => {
    const { checkOnly } = parseArguments(process.argv.slice(2));
    const content = checkOnly
      ? await checkCargoNewsIntake()
      : await writeCargoNewsIntake();
    process.stdout.write(
      `cards-money-trains: ${checkOnly ? "verified" : "imported"} ${content.summary.cargoRecordCount} cargo rows and ${content.summary.newsRecordCount} news rows\n`
    );
  };
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  CargoNewsIntakeError,
  buildCargoNewsIntake,
  checkCargoNewsIntake,
  defaultOutputPath,
  defaultSchemaPath,
  defaultSourcePath,
  normalizeWorkbook,
  validateIntake,
  writeCargoNewsIntake
};
