/**
 * Focused regression tests for deterministic author PDF intake.
 *
 * The tests prove source provenance, complete page extraction, schema
 * enforcement and the explicit boundary that source labels are not yet
 * production map identifiers.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CountryDescriptionsIntakeError,
  buildCountryDescriptionsIntake,
  checkCountryDescriptionsIntake,
  defaultOutputPath,
  normalizePdfText,
  validateIntake
} from "./import-country-descriptions.mjs";

test("author PDF extraction is complete, deterministic and review-only", async () => {
  const content = await buildCountryDescriptionsIntake();

  assert.equal(content.publishable, false);
  assert.equal(content.status, "review-draft");
  assert.match(content.source.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(content.source.pageCount, 10);
  assert.equal(content.countryRecords.length, 10);
  assert.deepEqual(
    content.countryRecords.map((record) => record.sourcePage),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.deepEqual(
    content.countryRecords.map((record) => record.sourceOrder),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.equal(content.summary.recordsWithTerminalLabels, 9);
  assert.equal(content.summary.sourceTerminalLabelCount, 23);
  assert.equal(content.unresolved.countryIdMapping, "not-reviewed");
  assert.equal(content.unresolved.terminalIdMapping, "not-reviewed");
  assert.equal(content.unresolved.productionManifestLinked, false);
  assert.ok(content.countryRecords.every((record) => !("countryId" in record)));
  assert.ok(content.countryRecords.every((record) => !("terminalIds" in record)));
  assert.equal(content.countryRecords[0].sourceTitle, "Гордая Гвинея");
  assert.equal(content.countryRecords[0].sourceTerminalLine, null);
  assert.equal(content.countryRecords[1].sourceTerminalLine, "Терминалы: 4, 6, 8, 9, 10");

  await assert.doesNotReject(validateIntake(structuredClone(content)));
});

test("committed country descriptions exactly match the immutable author PDF", async () => {
  const committed = JSON.parse(await readFile(defaultOutputPath, "utf8"));
  const checked = await checkCountryDescriptionsIntake();

  assert.deepEqual(checked, committed);
});

test("normalization rejects incomplete pages and uncertain terminal labels", () => {
  const validPage = [
    "Тестовая Гвинея",
    "Терминалы: 1, 2",
    "Исходный текст."
  ].join("\n");
  const tooFewPages = `${validPage}\f`;
  assert.throws(
    () => normalizePdfText(tooFewPages, "a".repeat(64)),
    (error) =>
      error instanceof CountryDescriptionsIntakeError &&
      /exactly 10 extractable pages/u.test(error.message)
  );

  const invalidPages = Array.from(
    { length: 10 },
    (_, index) => [
      `Тестовая Гвинея ${index + 1}`,
      index === 0 ? "Терминалы: 24" : `Терминалы: ${index + 1}`,
      "Исходный текст."
    ].join("\n")
  ).join("\f");
  assert.throws(
    () => normalizePdfText(invalidPages, "a".repeat(64)),
    (error) =>
      error instanceof CountryDescriptionsIntakeError &&
      /invalid source terminal labels/u.test(error.message)
  );
});

test("JSON Schema rejects publication and accidental runtime mappings", async () => {
  const content = await buildCountryDescriptionsIntake();
  const publishable = structuredClone(content);
  publishable.publishable = true;
  await assert.rejects(
    validateIntake(publishable),
    (error) => error instanceof CountryDescriptionsIntakeError && /publishable/u.test(error.message)
  );

  const mapped = structuredClone(content);
  mapped.countryRecords[0].countryId = "country-proud-guinea";
  await assert.rejects(
    validateIntake(mapped),
    (error) =>
      error instanceof CountryDescriptionsIntakeError &&
      /must NOT have additional properties/u.test(error.message)
  );
});
