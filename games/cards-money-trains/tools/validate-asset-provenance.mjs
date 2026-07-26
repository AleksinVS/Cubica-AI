#!/usr/bin/env node
/**
 * Проверить реестр происхождения ассетов игры «Карты, деньги, поезда».
 *
 * Реестр происхождения (provenance registry) — это файл
 * `asset-provenance.json`, который перечисляет, откуда взят каждый ассет
 * платформы и каждый авторский первоисточник, и какие права на него
 * подтверждены. Единственный источник истины структуры реестра — JSON Schema
 * (`asset-provenance.schema.json`), поэтому проверка выполняется стандартным
 * валидатором (библиотека AJV) по этой схеме, а не вручную написанными
 * проверками вида `if (typeof x !== "string")` (см. правило платформы о
 * declarative-vs-imperative drift в корневом CLAUDE.md).
 *
 * Помимо структурной проверки по схеме, скрипт дополнительно перепроверяет
 * факты, которые схема в принципе проверить не может: что каждый путь в
 * реестре действительно существует в репозитории и что записанный отпечаток
 * sha256 совпадает с содержимым файла на диске. Это защищает от ситуации,
 * когда файл незаметно подменили или реестр устарел.
 *
 * Использование:
 *   node games/cards-money-trains/tools/validate-asset-provenance.mjs
 *
 * Код завершения: 0 — реестр валиден и все отпечатки совпали; 1 — найдены
 * расхождения (подробности печатаются в stderr).
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";

// Ajv публикуется и как CommonJS default-экспорт, и как именованный —
// это же приведение используется в соседних инструментах игры
// (build-vector-map-topology-review.mjs), сохраняем единый стиль.
const Ajv = AjvImport.default ?? AjvImport;

const moduleFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(moduleFile);
const gameRoot = path.resolve(toolsDirectory, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");

const REGISTRY_PATH = path.join(gameRoot, "asset-provenance.json");
const SCHEMA_PATH = path.join(gameRoot, "asset-provenance.schema.json");

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

/** Посчитать sha256 файла в hex, как это делает остальной инструментарий игры. */
const sha256OfFile = async (filePath) => {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
};

/**
 * Выбрать каталог, от которого нужно отсчитывать относительный путь записи.
 * Реестр сводит в одном списке пути с разными базами: доставляемые ассеты
 * лежат внутри пакета игры ("game"), а авторские первоисточники — вне его,
 * в каталоге draft/ на верхнем уровне репозитория ("repo"). Поле root в
 * каждой записи схемы явно называет нужную базу, поэтому здесь простое
 * сопоставление, а не догадка по форме пути.
 */
const baseDirectoryForRoot = (root) => {
  if (root === "game") return gameRoot;
  if (root === "repo") return repoRoot;
  throw new Error(`неизвестная база пути root="${root}"`);
};

/**
 * Проверить один путь из реестра: файл должен существовать, быть обычным
 * файлом и иметь ожидаемые размер и отпечаток. Возвращает список текстовых
 * проблем (пустой список — значит всё совпало).
 */
const verifyFileFact = async (relativePath, root, expected, label) => {
  const problems = [];
  const absolutePath = path.join(baseDirectoryForRoot(root), ...relativePath.split("/"));
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    problems.push(`${label}: путь "${relativePath}" не найден в репозитории`);
    return problems;
  }
  if (!fileStat.isFile()) {
    problems.push(`${label}: путь "${relativePath}" не является обычным файлом`);
    return problems;
  }
  if (
    typeof expected.byteSize === "number" &&
    fileStat.size !== expected.byteSize
  ) {
    problems.push(
      `${label}: размер файла "${relativePath}" равен ${fileStat.size} байт, ` +
        `а в реестре записано ${expected.byteSize}`
    );
  }
  const actualSha256 = await sha256OfFile(absolutePath);
  if (actualSha256 !== expected.sha256) {
    problems.push(
      `${label}: sha256 файла "${relativePath}" равен ${actualSha256}, ` +
        `а в реестре записано ${expected.sha256}`
    );
  }
  return problems;
};

const main = async () => {
  const [schema, registry] = await Promise.all([
    readJson(SCHEMA_PATH),
    readJson(REGISTRY_PATH)
  ]);

  // Шаг 1. Структурная проверка стандартным валидатором AJV по JSON Schema.
  // strict: true не даёт схеме тихо игнорировать опечатки в её собственных
  // ключевых словах; allErrors: true печатает сразу все найденные проблемы,
  // а не только первую.
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const isStructurallyValid = validate(registry);

  if (!isStructurallyValid) {
    console.error("Реестр НЕ прошёл проверку по схеме JSON Schema:");
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || "/"} ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Реестр прошёл проверку по схеме (${registry.entries.length} ` +
      `запис${registry.entries.length === 1 ? "ь" : "и"}).`
  );

  // Шаг 2. Перепроверка фактов на диске: путь существует, размер и sha256
  // совпадают с тем, что записано в реестре. Схема JSON Schema это проверить
  // не может — она не читает файловую систему.
  const problems = [];
  for (const entry of registry.entries) {
    problems.push(
      ...(await verifyFileFact(
        entry.path,
        entry.root,
        { byteSize: entry.byteSize, sha256: entry.sha256 },
        `запись "${entry.id}"`
      ))
    );
    if (entry.kind === "derived-asset") {
      const source = entry.derivedFrom.source;
      problems.push(
        ...(await verifyFileFact(
          source.path,
          source.root,
          { byteSize: source.byteSize, sha256: source.sha256 },
          `первоисточник записи "${entry.id}"`
        ))
      );
    }
  }

  if (problems.length > 0) {
    console.error("Найдены расхождения между реестром и файлами на диске:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Все пути реестра существуют, а их размер и sha256 совпадают с записанными."
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
