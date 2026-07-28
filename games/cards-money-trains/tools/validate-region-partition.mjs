#!/usr/bin/env node
/**
 * Проверить черновик разбиения карты «Карты, деньги, поезда» на области.
 *
 * Черновик (файл `vector-map.region-partition.draft.json`, около 6 МБ) строит
 * инструмент `cmt_region_partition.py`. Единственный источник истины его
 * структуры — JSON Schema (`vector-map-region-partition.schema.json`), поэтому
 * структурная проверка выполняется стандартным валидатором (библиотека AJV) по
 * этой схеме, а не вручную написанными проверками вида
 * `if (typeof x !== "string")` (см. правило платформы о declarative-vs-imperative
 * drift в корневом CLAUDE.md). Этот скрипт — прямой аналог соседнего
 * общего `scripts/asset-provenance/validate-asset-provenance.mjs`, адаптированный
 * под один крупный файл вместо
 * реестра из многих записей.
 *
 * Помимо структурной проверки по схеме, скрипт перепроверяет вещи, которые
 * схема в принципе проверить не может, потому что для этого нужно смотреть на
 * несколько полей сразу или читать файловую систему, а не проверять форму
 * одного значения:
 *
 *   1. Отпечатки авторского .ai-первоисточника и трёх исходных отчётов в
 *      `provenance` совпадают с фактическим содержимым файлов на диске (защита
 *      от подмены источника или устаревшего черновика).
 *   2. Число соединений класса `narrow-gap` в `joins` в точности равно числу
 *      записей `assumed-connection` в реестре `doubts`. Это доказывает, что
 *      каждое предположительное (не строго доказанное перекрытием краски)
 *      соединение помечено и учтено, а не осталось «невидимым» в графе.
 *   3. Число убранных ничтожных внутренних отверстий (`removedMicroHoles`)
 *      совпадает и с `summary.removedMicroHoleCount`, и с числом записей
 *      `removed-micro-hole` в `doubts` — ни одно убранное отверстие не должно
 *      потеряться бесследно.
 *
 * Использование:
 *   node games/cards-money-trains/tools/validate-region-partition.mjs
 *
 * Код завершения: 0 — черновик валиден и все перепроверки прошли;
 * 1 — найдены расхождения (подробности печатаются в stderr).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

// Ajv публикуется и как CommonJS default-экспорт, и как именованный —
// это же приведение используется в соседних инструментах игры
// (build-vector-map-topology-review.mjs).
const Ajv = AjvImport.default ?? AjvImport;

const moduleFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(moduleFile);
const annotationsDirectory = path.resolve(toolsDirectory, "..", "annotations");

const DRAFT_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.draft.json"
);
const SCHEMA_PATH = path.join(
  annotationsDirectory,
  "vector-map-region-partition.schema.json"
);

/** Прочитать и распарсить JSON-файл, с понятной ошибкой при поломке. */
const readJson = async (filePath) => {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`не удалось разобрать JSON "${filePath}": ${message}`);
  }
};

/**
 * Посчитать отпечаток файла в формате "sha256:<hex>" — именно так его печатает
 * file_digest() в cmt_region_partition.py. Единый формат нужен, чтобы сравнение
 * со значением из черновика было прямым сравнением строк, без перекодирования.
 */
const sha256WithPrefix = async (filePath) => {
  const bytes = await readFile(filePath);
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
};

/** Посчитать голый hex-отпечаток без префикса (так хранится provenance.source). */
const sha256Plain = async (filePath) => {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
};

const main = async () => {
  // Файл артефакта большой (около 6 МБ). Он читается один раз в память для
  // структурной проверки; содержимое нигде намеренно не печатается целиком —
  // в консоль идут только счётчики и найденные проблемы.
  const [schema, draft] = await Promise.all([
    readJson(SCHEMA_PATH),
    readJson(DRAFT_PATH),
  ]);

  // Шаг 1. Структурная проверка стандартным валидатором AJV по JSON Schema.
  // strict: true не даёт схеме тихо игнорировать опечатки в её собственных
  // ключевых словах; allErrors: true печатает сразу все найденные проблемы.
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const isStructurallyValid = validate(draft);

  if (!isStructurallyValid) {
    console.error("Черновик НЕ прошёл проверку по схеме JSON Schema:");
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || "/"} ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Черновик прошёл проверку по схеме (${draft.regions.length} областей, ` +
      `${draft.joins.length} соединений, ${draft.doubts.length} сомнений).`
  );

  const problems = [];

  // Шаг 2а. Перепроверка отпечатка авторского PDF-совместимого первоисточника
  // (.ai-файла). Путь в provenance.source.file записан относительно каталога
  // annotations/, как это делает build-time инструмент.
  const repoRoot = path.resolve(annotationsDirectory, "..", "..", "..");
  const sourceAbsolutePath = path.resolve(
    annotationsDirectory,
    draft.provenance.source.file
  );
  if (!sourceAbsolutePath.startsWith(repoRoot)) {
    problems.push(
      `provenance.source.file указывает за пределы репозитория: ${draft.provenance.source.file}`
    );
  } else {
    try {
      const actualSourceSha256 = await sha256Plain(sourceAbsolutePath);
      if (actualSourceSha256 !== draft.provenance.source.sha256) {
        problems.push(
          `provenance.source: sha256 файла "${draft.provenance.source.file}" ` +
            `равен ${actualSourceSha256}, а в черновике записано ` +
            `${draft.provenance.source.sha256}`
        );
      }
    } catch {
      problems.push(
        `provenance.source: файл "${draft.provenance.source.file}" не найден в репозитории`
      );
    }
  }

  // Шаг 2б. Перепроверка отпечатков исходных отчётов на диске. Схема лишь
  // проверяет форму строки ("sha256:" + 64 hex-знака), но не читает файлы —
  // это защита от подмены источника или устаревшего черновика.
  const digestChecks = [
    ["rawReview", "vector-map.review.json"],
    ["classification", "vector-map.classification.review.json"],
    ["countriesStations", "vector-map.countries-stations.draft.json"],
  ];
  for (const [field, fileName] of digestChecks) {
    const recorded = draft.provenance[field];
    const absolutePath = path.join(annotationsDirectory, fileName);
    let actual;
    try {
      actual = await sha256WithPrefix(absolutePath);
    } catch {
      problems.push(
        `provenance.${field}: файл "${fileName}" не найден в репозитории`
      );
      continue;
    }
    if (actual !== recorded.sha256) {
      problems.push(
        `provenance.${field}: sha256 файла "${fileName}" равен ${actual}, ` +
          `а в черновике записано ${recorded.sha256}`
      );
    }
  }

  // Шаг 3. Отсутствие непомеченных придуманных соединений. Каждое соединение
  // в joins уже обязано иметь joinClass (это проверяет схема), но здесь
  // проверяется дополнительный факт: ровно каждое соединение класса
  // narrow-gap (предположение, а не факт перекрытия краски) должно быть
  // отражено отдельной записью assumed-connection в реестре сомнений — ни
  // одно предположение не должно молча потеряться и ни одна запись сомнения
  // не должна быть придумана без соответствующего соединения.
  const narrowGapJoins = draft.joins.filter(
    (join) => join.joinClass === "narrow-gap"
  );
  const assumedConnectionDoubts = draft.doubts.filter(
    (doubt) => doubt.kind === "assumed-connection"
  );
  if (narrowGapJoins.length !== assumedConnectionDoubts.length) {
    problems.push(
      `число соединений класса narrow-gap (${narrowGapJoins.length}) не ` +
        `совпадает с числом записей assumed-connection в doubts ` +
        `(${assumedConnectionDoubts.length})`
    );
  }
  if (draft.summary.narrowGapJoinCount !== narrowGapJoins.length) {
    problems.push(
      `summary.narrowGapJoinCount (${draft.summary.narrowGapJoinCount}) не ` +
        `совпадает с фактическим числом соединений narrow-gap в joins ` +
        `(${narrowGapJoins.length})`
    );
  }

  // Тот же принцип для ничтожных внутренних отверстий: drop_micro_holes()
  // убирает отверстие из геометрии области, но обязана зафиксировать его в
  // двух местах сразу — в removedMicroHoles и отдельной записью doubts вида
  // removed-micro-hole. Расхождение означало бы, что убранное отверстие
  // где-то потерялось бесследно.
  const removedMicroHoleDoubts = draft.doubts.filter(
    (doubt) => doubt.kind === "removed-micro-hole"
  );
  if (draft.removedMicroHoles.length !== removedMicroHoleDoubts.length) {
    problems.push(
      `число записей removedMicroHoles (${draft.removedMicroHoles.length}) не ` +
        `совпадает с числом записей removed-micro-hole в doubts ` +
        `(${removedMicroHoleDoubts.length})`
    );
  }
  if (draft.summary.removedMicroHoleCount !== draft.removedMicroHoles.length) {
    problems.push(
      `summary.removedMicroHoleCount (${draft.summary.removedMicroHoleCount}) ` +
        `не совпадает с длиной removedMicroHoles (${draft.removedMicroHoles.length})`
    );
  }

  // Шаг 4. Сохранение publishable: false. Схема это уже гарантирует через
  // const, но явная проверка здесь оставляет понятное сообщение об ошибке в
  // отдельном тексте, если кто-то в будущем ослабит схему по ошибке.
  if (draft.publishable !== false) {
    problems.push(
      `publishable обязано быть false, а записано ${JSON.stringify(draft.publishable)}`
    );
  }

  if (problems.length > 0) {
    console.error("Найдены расхождения черновика:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Отпечатки источников совпадают с файлами на диске, соединения narrow-gap " +
      "и убранные ничтожные отверстия полностью учтены в реестре сомнений, " +
      "publishable остаётся false."
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
