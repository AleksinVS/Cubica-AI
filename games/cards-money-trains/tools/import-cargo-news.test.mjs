/**
 * Focused regression tests for deterministic author XLSX intake.
 *
 * The source workbook is read-only evidence. Tests prove exact extraction,
 * schema enforcement and fail-closed handling of structural changes without
 * claiming that the resulting rows are already executable game content.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CargoNewsIntakeError,
  buildCargoNewsIntake,
  checkCargoNewsIntake,
  defaultOutputPath,
  normalizeWorkbook,
  validateIntake
} from "./import-cargo-news.mjs";

const toRawWorkbook = (content) => ({
  sheets: [
    {
      name: "Колоды по терминалам",
      rows: [
        ["Терминал отправления", "Терминал прибытия", "Стоимость", "Колода"],
        ...content.cargoRecords.map((record) => [
          Number(record.originNodeId.slice("terminal-".length)),
          Number(record.destinationNodeId.slice("terminal-".length)),
          record.bankPayout,
          record.sourceDeckLabel
        ])
      ]
    },
    {
      name: "Новости (2 типов)",
      rows: [
        ["Тип новости", "Номер новости", "Новость"],
        ...content.newsRecords.map((record) => [
          record.sourceCategoryLabel,
          record.number,
          record.text
        ])
      ]
    }
  ]
});

test("author workbook extraction is complete, deterministic and non-publishable", async () => {
  const content = await buildCargoNewsIntake();

  assert.equal(content.publishable, false);
  assert.equal(content.status, "content-intake");
  assert.match(content.source.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(content.source.sheets, ["Колоды по терминалам", "Новости (2 типов)"]);
  assert.equal(content.cargoRecords.length, 174);
  assert.equal(content.newsRecords.length, 34);
  assert.equal(
    content.summary.baseCargoRecordCount + content.summary.newsAddedCargoRecordCount,
    174
  );
  assert.equal(content.summary.cargoAdditionNewsCount, 10);
  assert.equal(content.summary.ruleNewsCount, 24);
  assert.equal(content.authorConfirmations.oneSourceRowEqualsOneRuntimeCard, true);
  assert.equal(content.authorConfirmations.runtimeDeckLifecycleApproved, true);
  assert.equal(content.unresolved.executableNewsMappingComplete, false);
  assert.equal(content.newsRecords.find((item) => item.number === 12)?.linkedCargoRecordIds.length, 0);
  assert.ok(content.newsRecords.slice(0, 10).every((item) => item.linkedCargoRecordIds.length > 0));

  await assert.doesNotReject(validateIntake(structuredClone(content)));
});

test("committed cargo/news intake exactly matches the immutable author workbook", async () => {
  const committed = JSON.parse(await readFile(defaultOutputPath, "utf8"));
  const checked = await checkCargoNewsIntake();

  assert.deepEqual(checked, committed);
});

test("normalization rejects deck and news changes instead of guessing semantics", async () => {
  const content = await buildCargoNewsIntake();
  const mismatchedDeck = toRawWorkbook(content);
  mismatchedDeck.sheets[0].rows[1][3] = "2 терминал";
  assert.throws(
    () => normalizeWorkbook(mismatchedDeck, content.source.sha256),
    (error) => error instanceof CargoNewsIntakeError &&
      /base deck terminal does not match its origin/u.test(error.message)
  );

  const duplicateNews = toRawWorkbook(content);
  duplicateNews.sheets[1].rows[2][1] = 1;
  assert.throws(
    () => normalizeWorkbook(duplicateNews, content.source.sha256),
    (error) => error instanceof CargoNewsIntakeError &&
      /duplicate news number 1/u.test(error.message)
  );
});

test("JSON Schema rejects accidental publication and structural loss", async () => {
  const content = await buildCargoNewsIntake();
  const publishable = structuredClone(content);
  publishable.publishable = true;
  await assert.rejects(
    validateIntake(publishable),
    (error) => error instanceof CargoNewsIntakeError && /publishable/u.test(error.message)
  );

  const missingCargo = structuredClone(content);
  missingCargo.cargoRecords.pop();
  await assert.rejects(
    validateIntake(missingCargo),
    (error) => error instanceof CargoNewsIntakeError && /174/u.test(error.message)
  );
});
