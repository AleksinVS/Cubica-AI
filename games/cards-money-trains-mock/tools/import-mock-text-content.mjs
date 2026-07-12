#!/usr/bin/env node
/**
 * Validate and import synthetic text content for the mock game package.
 *
 * JSON Schema is the structural source of truth. This module only adds
 * cross-item checks that JSON Schema draft-07 cannot express conveniently,
 * such as uniqueness by `id`. The production game directory is an explicit
 * write boundary: this development tool can never target it.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const scriptFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptFile), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const normativeRoot = path.join(repoRoot, "games", "cards-money-trains");
const defaultInputPath = path.join(packageRoot, "fixtures", "mock-text-content.json");
const defaultSchemaPath = path.join(packageRoot, "fixtures", "mock-text-content.schema.json");
const defaultOutputPath = path.join(packageRoot, "generated", "mock-text-content.imported.json");

class MockTextContentValidationError extends Error {
  constructor(filePath, details) {
    super(`invalid mock text content in ${filePath}:\n${details}`);
    this.name = "MockTextContentValidationError";
  }
}

const readJson = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new MockTextContentValidationError(
      filePath,
      error instanceof Error ? error.message : String(error)
    );
  }
};

const assertUniqueIds = (content, inputPath) => {
  const collections = [
    ["newsCards", content.newsCards],
    ["cargoCards", content.cargoCards],
    ["methodicalPauses", content.methodicalPauses],
    ["roles", content.roles],
    ["instructions.facilitator", content.instructions.facilitator],
    ["instructions.participants", content.instructions.participants]
  ];
  for (const [name, values] of collections) {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value.id)) {
        throw new MockTextContentValidationError(inputPath, `${name} contains duplicate id "${value.id}"`);
      }
      seen.add(value.id);
    }
  }
};

/**
 * Load an input only after its schema itself compiles in Ajv strict mode.
 * `allErrors` gives content editors one actionable report instead of forcing
 * them to fix malformed fields one at a time.
 */
const loadMockTextContent = async ({
  inputPath = defaultInputPath,
  schemaPath = defaultSchemaPath
} = {}) => {
  const [schema, content] = await Promise.all([readJson(schemaPath), readJson(inputPath)]);
  const ajv = new Ajv({ allErrors: true, strict: true });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    throw new MockTextContentValidationError(
      schemaPath,
      `schema compilation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!validate(content)) {
    const details = ajv.errorsText(validate.errors, { separator: "\n", dataVar: "content" });
    throw new MockTextContentValidationError(inputPath, details);
  }
  assertUniqueIds(content, inputPath);
  return structuredClone(content);
};

const isPathInside = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const resolveWritableOutputPath = (outputPath = defaultOutputPath) => {
  const resolvedOutputPath = path.resolve(outputPath);
  if (isPathInside(resolvedOutputPath, normativeRoot)) {
    throw new Error("mock content importer refuses to write into games/cards-money-trains");
  }
  return resolvedOutputPath;
};

/**
 * Write through a sibling temporary file and rename only after validation.
 * Consequently a malformed input leaves an existing imported artifact byte
 * for byte unchanged and never exposes a partial JSON document to the build.
 */
const writeImportedMockTextContent = async ({
  inputPath = defaultInputPath,
  schemaPath = defaultSchemaPath,
  outputPath = defaultOutputPath
} = {}) => {
  const resolvedOutputPath = resolveWritableOutputPath(outputPath);
  const content = await loadMockTextContent({ inputPath: path.resolve(inputPath), schemaPath: path.resolve(schemaPath) });
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const temporaryPath = `${resolvedOutputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    await rename(temporaryPath, resolvedOutputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return content;
};

const parseCliArguments = (argv) => {
  const result = { inputPath: defaultInputPath, schemaPath: defaultSchemaPath, outputPath: defaultOutputPath, checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      result.checkOnly = true;
      continue;
    }
    const field = argument === "--input" ? "inputPath" : argument === "--schema" ? "schemaPath" : argument === "--output" ? "outputPath" : null;
    if (!field || !argv[index + 1]) throw new Error(`unknown or incomplete argument "${argument}"`);
    result[field] = path.resolve(argv[index + 1]);
    index += 1;
  }
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const run = async () => {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.checkOnly) {
      await loadMockTextContent(options);
      process.stdout.write("cards-money-trains-mock: text content is valid\n");
      return;
    }
    await writeImportedMockTextContent(options);
    process.stdout.write(`cards-money-trains-mock: text content imported to ${options.outputPath}\n`);
  };
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  MockTextContentValidationError,
  defaultInputPath,
  defaultOutputPath,
  defaultSchemaPath,
  loadMockTextContent,
  resolveWritableOutputPath,
  writeImportedMockTextContent
};
