/**
 * Contract tests for the game-local synthetic text import.
 *
 * These tests prove that the JSON Schema accepts the committed fixture,
 * rejects malformed or ambiguous content, and protects existing generated
 * output when validation fails.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MockTextContentValidationError,
  defaultInputPath,
  defaultOutputPath,
  loadMockTextContent,
  resolveWritableOutputPath,
  writeImportedMockTextContent
} from "../tools/import-mock-text-content.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const withTemporaryDirectory = async (callback) => {
  const repositoryTemporaryRoot = path.resolve(packageRoot, "..", "..", ".tmp");
  await mkdir(repositoryTemporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(repositoryTemporaryRoot, "cmt-text-import-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("committed synthetic text validates and matches the imported artifact", async () => {
  const content = await loadMockTextContent();
  const generated = JSON.parse(await readFile(defaultOutputPath, "utf8"));
  assert.deepEqual(generated, content);
  assert.equal(content.newsCards.length, 6);
  assert.equal(content.cargoCards.length, 12);
  assert.deepEqual(content.roles.map((role) => role.audience), [
    "facilitator",
    "logistics_company",
    "locomotive_guild"
  ]);
  assert.equal(content.controlMetadata.normativeUseAllowed, false);
});

test("strict schema rejects unknown fields with a readable input path", async () => {
  await withTemporaryDirectory(async (directory) => {
    const invalidInputPath = path.join(directory, "invalid-content.json");
    const content = JSON.parse(await readFile(defaultInputPath, "utf8"));
    content.newsCards[0].unexpectedRule = "must not be accepted";
    await writeFile(invalidInputPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

    await assert.rejects(
      loadMockTextContent({ inputPath: invalidInputPath }),
      (error) => {
        assert.ok(error instanceof MockTextContentValidationError);
        assert.match(error.message, /newsCards\/0.*additional properties/i);
        return true;
      }
    );
  });
});

test("semantic validation rejects duplicate identifiers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const invalidInputPath = path.join(directory, "duplicate-content.json");
    const content = JSON.parse(await readFile(defaultInputPath, "utf8"));
    content.newsCards[1].id = content.newsCards[0].id;
    await writeFile(invalidInputPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

    await assert.rejects(
      loadMockTextContent({ inputPath: invalidInputPath }),
      /newsCards contains duplicate id/
    );
  });
});

test("failed import leaves an existing output unchanged", async () => {
  await withTemporaryDirectory(async (directory) => {
    const invalidInputPath = path.join(directory, "invalid-content.json");
    const outputPath = path.join(directory, "existing-output.json");
    const originalOutput = "{\"preserved\":true}\n";
    const content = JSON.parse(await readFile(defaultInputPath, "utf8"));
    delete content.instructions;
    await writeFile(invalidInputPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    await writeFile(outputPath, originalOutput, "utf8");

    await assert.rejects(
      writeImportedMockTextContent({ inputPath: invalidInputPath, outputPath }),
      MockTextContentValidationError
    );
    assert.equal(await readFile(outputPath, "utf8"), originalOutput);
  });
});

test("importer refuses the normative game directory as an output target", async () => {
  const forbiddenOutput = path.resolve(packageRoot, "..", "cards-money-trains", "mock-text-content.imported.json");
  assert.equal(resolveWritableOutputPath(), defaultOutputPath);
  await assert.rejects(
    writeImportedMockTextContent({ outputPath: forbiddenOutput }),
    /refuses to write into games\/cards-money-trains/
  );
});
