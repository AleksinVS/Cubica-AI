/**
 * Профилировщик холодной загрузки editor-проекций (TSK-20260704, Phase 2 вход).
 *
 * ЗАЧЕМ ЭТОТ СКРИПТ.
 * Каждая загрузка редактора заново строит проекции из authoring-манифестов
 * (docs/architecture/editor-preview-first-ux.md §10). Прежде чем строить кэш
 * (design-spec §2.6, уровни 1/2/3), нужно понять, КУДА уходит время — по
 * модульным границам editor-engine, — чтобы кэшировать по данным, а не вслепую,
 * и чтобы был воспроизводимый baseline «до/после» (design-spec §5).
 *
 * ЧТО ИЗМЕРЯЕТСЯ (по модульным границам editor-engine и по стадиям загрузки):
 *   Разовая инициализация (общая для всех игр; цель кэша уровня 3):
 *     - schema.createRegistry     — createSchemaRegistry() редактора;
 *     - schema.compileValidators  — регистрация 3 authoring-схем редактора и
 *                                   принудительная компиляция Ajv-валидаторов;
 *     - compiler.buildAjv         — authoring-compiler.buildAjv() (компиляция
 *                                   8 схем компилятора).
 *   На каждую игру (цель кэша уровня 1 «в памяти» и уровня 2 «на диске»):
 *     - read.files            — fs-чтение всех authoring-файлов (game + ui по каналам);
 *     - parse.jsonOnly        — только JSON.parse текстов (диагностика; НЕ в составном);
 *     - parse.documentStore   — createDocumentStore: JSON.parse + text location map;
 *     - validate.documents    — validateDocument (Ajv-валидация + семантические диагностики);
 *     - graph.projection      — buildAuthoringGraphProjection (граф авторинга);
 *     - projection.entity     — buildEditorEntityProjection (единая проекция сущностей ADR-052);
 *     - tree.entityTreeView   — buildEntityTreeViewModel (дерево сущностей);
 *     - tree.jsonTree         — buildTreeViewModel (технич. JSON-дерево);
 *     - timeline.chronology   — buildManifestChronologyTimeline (хронология сценария);
 *     - yaml.entityProjection — buildEditorEntityYamlProjection для представительной сущности;
 *     - compile.game          — компиляция game authoring → runtime manifest;
 *     - compile.ui            — компиляция ui authoring → runtime manifest (сумма по каналам).
 *   Составной показатель:
 *     - composite.projectionLoad — сумма пути, который редактор проходит при
 *       каждой загрузке проекта (read + parse.documentStore + validate + graph +
 *       projection + tree*2 + timeline + yaml + compile game/ui). parse.jsonOnly в
 *       сумму не входит (это диагностический разрез внутри parse.documentStore).
 *
 * МЕТОДИКА.
 *   - N итераций (по умолчанию 5) после 1 прогревочной (прогрев отбрасывается);
 *   - на каждой итерации сначала строится разовая инициализация, затем для каждой
 *     игры прогоняется весь конвейер, каждая стадия отдельно замеряется
 *     process.hrtime.bigint() и её выход переиспользуется следующей стадией
 *     (это честная «сумма пути»);
 *   - по каждой метрике считаются медиана, min, max;
 *   - таблица выводится в stdout, полный результат пишется в
 *     .tmp/profile-editor-load-<date>.json. Скрипт НЕ пишет ничего вне .tmp/.
 *
 * ПОЧЕМУ ТАКОЙ ЗАПУСК (ESM/TS без tsx и без сборки dist).
 *   editor-engine — это ESM/TypeScript с main = src/index.ts и import-специфи-
 *   каторами с расширением .ts. В репозитории НЕТ tsx, а собранного dist у пакета
 *   тоже нет. Наименее хрупкий путь — встроенная поддержка TS в Node (тот же
 *   приём, что у services/runtime-api dev: `node --experimental-strip-types`).
 *   Но document-store.ts использует TS-«parameter property»
 *   (`constructor(private readonly text)`), которую strip-only режим не понимает,
 *   поэтому нужен полный трансформ: `node --experimental-transform-types`. Флаг
 *   проставляет npm-скрипт `profile:editor-load`. Стоимость трансформации — это
 *   стоимость загрузки модуля (однократно на процесс, ДО замеров), поэтому она НЕ
 *   попадает в измеряемые стадии: замеряется исполнение уже загруженного JS,
 *   алгоритмическая сложность которого от способа трансформации не зависит.
 *
 * НАДЁЖНОСТЬ ЗАМЕРА.
 *   Хост 4-ядерный, замеры чувствительны к фоновой нагрузке. Скрипт снимает
 *   nproc и load average на момент старта и пишет их в JSON; если доступен
 *   global.gc (флаг --expose-gc), между итерациями вызывается сборка мусора,
 *   чтобы уменьшить дрожание. Для интерпретации при шуме используйте медиану и
 *   min (min ≈ наименее «зашумлённый» прогон).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// --- Пути репозитория -------------------------------------------------------
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const require = createRequire(import.meta.url);

// editor-engine импортируется по абсолютному пути к src/index.ts (main пакета).
// Это надёжнее bare-специфи­катора: не зависит от разрешения "exports"/симлинков
// workspaces и работает под --experimental-transform-types.
const enginePath = path.join(repoRoot, "packages", "editor-engine", "src", "index.ts");

// authoring-compiler — CommonJS (.cjs); подключаем через require.
const authoringCompiler = require(path.join(
  repoRoot,
  "scripts",
  "manifest-tools",
  "authoring-compiler.cjs"
));

// Схемы, которые редактор регистрирует (apps/editor-web/src/lib/editor-json-schema.ts).
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const EDITOR_SCHEMAS = [
  {
    id: "https://cubica.platform/schemas/manifest-authoring-common.schema.json",
    file: "manifest-authoring-common.schema.json"
  },
  {
    id: "https://cubica.platform/schemas/game-authoring.v2.json",
    file: "game-authoring-v2.schema.json"
  },
  {
    id: "https://cubica.platform/schemas/ui-authoring.v2.json",
    file: "ui-authoring-v2.schema.json"
  }
];
const GAME_AUTHORING_SCHEMA_ID = "https://cubica.platform/schemas/game-authoring.v2.json";
const UI_AUTHORING_SCHEMA_ID = "https://cubica.platform/schemas/ui-authoring.v2.json";

// --- Аргументы CLI ----------------------------------------------------------
function parseArgs(argv) {
  const options = { iterations: 5, warmups: 1, games: ["antarctica", "simple-choice", "ai-driven-choice"] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--iterations" || arg === "-n") {
      options.iterations = Math.max(1, Number(argv[i + 1]));
      i += 1;
    } else if (arg === "--warmups") {
      options.warmups = Math.max(0, Number(argv[i + 1]));
      i += 1;
    } else if (arg === "--games") {
      options.games = String(argv[i + 1]).split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// --- Таймер -----------------------------------------------------------------
/** Замеряет стадию `fn`, добавляет длительность (мс) в `bucket[name]` и возвращает результат fn. */
function timed(bucket, name, fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  (bucket[name] ??= []).push(ms);
  return value;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(values) {
  return {
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values.length
  };
}

// --- Загрузка входов игры ---------------------------------------------------
/**
 * Возвращает authoring-задания игры (game + ui по каналам) через discoverJobs
 * компилятора — это ровно тот набор файлов, что видит и компилятор, и редактор.
 */
function discoverGameInputs(gameId) {
  const jobs = authoringCompiler.discoverJobs({ gameId });
  if (jobs.length === 0) {
    throw new Error(`No authoring jobs discovered for game "${gameId}"`);
  }
  return jobs.map((job) => ({
    job,
    kind: job.kind, // "game" | "ui"
    channel: job.channel,
    absPath: job.sourceFile,
    relPath: path.relative(repoRoot, job.sourceFile).replace(/\\/g, "/")
  }));
}

/** Суммарная длина facet-источников — грубая мера «богатства» сущности. */
function facetSourceCount(entity) {
  let total = 0;
  for (const sources of Object.values(entity.facets ?? {})) {
    total += Array.isArray(sources) ? sources.length : 0;
  }
  return total;
}

/**
 * Детерминированно выбирает представительную сущность для YAML-проекции:
 * максимальное число facet-источников, ничьи — по entityId лексикографически.
 */
function pickRepresentativeEntity(projection) {
  let best;
  for (const entity of projection.entities) {
    if (best === undefined) {
      best = entity;
      continue;
    }
    const count = facetSourceCount(entity);
    const bestCount = facetSourceCount(best);
    if (count > bestCount || (count === bestCount && entity.entityId < best.entityId)) {
      best = entity;
    }
  }
  return best;
}

async function main() {
  const options = parseArgs(process.argv);
  const engine = await import(enginePath);

  const host = {
    nproc: os.cpus().length,
    loadAverage: os.loadavg(),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`
  };

  // Читаем входы всех игр один раз (пути/тексты стабильны в рамках прогона).
  const games = options.games.map((gameId) => {
    const inputs = discoverGameInputs(gameId);
    return { gameId, inputs };
  });

  // Тексты схем редактора — читаем один раз (файлы стабильны).
  const editorSchemaTexts = EDITOR_SCHEMAS.map((schema) => ({
    id: schema.id,
    json: JSON.parse(fs.readFileSync(path.join(schemasRoot, schema.file), "utf8"))
  }));

  // Копилки замеров: shared[name] = массив мс; perGame[gameId][name] = массив мс.
  const shared = {};
  const perGame = Object.fromEntries(games.map((g) => [g.gameId, {}]));
  // Информация о выбранной представительной сущности (для отчёта; не таймер).
  const representative = {};
  // Грубые размеры входов (для отчёта о нелинейности).
  const inputStats = {};

  const totalIterations = options.warmups + options.iterations;
  for (let iter = 0; iter < totalIterations; iter += 1) {
    const isWarmup = iter < options.warmups;
    // Прогревочные итерации пишут в отдельные (выбрасываемые) копилки.
    const sharedBucket = isWarmup ? {} : shared;
    const gameBucket = (gameId) => (isWarmup ? {} : perGame[gameId]);

    if (typeof global.gc === "function") {
      global.gc();
    }

    // --- Разовая инициализация (общая для всех игр) ---
    const registry = timed(sharedBucket, "schema.createRegistry", () => engine.createSchemaRegistry());
    timed(sharedBucket, "schema.compileValidators", () => {
      for (const schema of editorSchemaTexts) {
        registry.registerSchema(schema.id, schema.json);
      }
      // Принудительно компилируем валидаторы: validateValue вызывает
      // ajv.getSchema(...), что компилирует схему при первом обращении.
      for (const schema of editorSchemaTexts) {
        registry.validateValue({ schemaId: schema.id, value: {} });
      }
    });
    const compilerAjv = timed(sharedBucket, "compiler.buildAjv", () => authoringCompiler.buildAjv());

    // --- Конвейер на каждую игру ---
    for (const { gameId, inputs } of games) {
      const bucket = gameBucket(gameId);

      // 1. Чтение файлов с диска.
      const texts = timed(bucket, "read.files", () =>
        inputs.map((input) => ({ input, text: fs.readFileSync(input.absPath, "utf8") }))
      );

      // 2a. Диагностика: только JSON.parse (не входит в составной показатель).
      timed(bucket, "parse.jsonOnly", () => texts.map(({ text }) => JSON.parse(text)));

      // 2b. createDocumentStore: JSON.parse + построение text location map.
      const snapshots = timed(bucket, "parse.documentStore", () =>
        texts.map(({ input, text }) => {
          const store = engine.createDocumentStore({ filePath: input.relPath, text });
          return { input, snapshot: store.snapshot() };
        })
      );

      const gameSnapshot = snapshots.find(({ input }) => input.kind === "game");
      if (gameSnapshot === undefined) {
        throw new Error(`Game "${gameId}" has no game authoring document`);
      }

      // 3. Валидация всех документов (Ajv + семантика).
      const gameDiagnostics = timed(bucket, "validate.documents", () => {
        let gameDocDiagnostics = [];
        for (const { input, snapshot } of snapshots) {
          const schemaId = input.kind === "game" ? GAME_AUTHORING_SCHEMA_ID : UI_AUTHORING_SCHEMA_ID;
          const diagnostics = engine.validateDocument(snapshot, {
            schemaRegistry: registry,
            schemaId,
            includeSemanticDiagnostics: true
          });
          if (input.kind === "game") {
            gameDocDiagnostics = diagnostics;
          }
        }
        return gameDocDiagnostics;
      });

      // 4. Граф авторинга (строится на активном = game снимке).
      const graphProjection = timed(bucket, "graph.projection", () =>
        engine.buildAuthoringGraphProjection(gameSnapshot.snapshot)
      );

      // 5. Единая проекция сущностей (по всем документам игры).
      const projectionDocuments = snapshots.map(({ input, snapshot }) => ({
        filePath: input.relPath,
        json: snapshot.json
      }));
      const projection = timed(bucket, "projection.entity", () =>
        engine.buildEditorEntityProjection({ gameId, documents: projectionDocuments })
      );

      // 6. Дерево сущностей.
      timed(bucket, "tree.entityTreeView", () =>
        engine.buildEntityTreeViewModel({
          snapshot: gameSnapshot.snapshot,
          diagnostics: gameDiagnostics,
          graphProjection
        })
      );

      // 7. Технич. JSON-дерево.
      timed(bucket, "tree.jsonTree", () =>
        engine.buildTreeViewModel({
          snapshot: gameSnapshot.snapshot,
          diagnostics: gameDiagnostics,
          graphProjection
        })
      );

      // 8. Хронология сценария.
      timed(bucket, "timeline.chronology", () =>
        engine.buildManifestChronologyTimeline({ snapshot: gameSnapshot.snapshot })
      );

      // 9. YAML-проекция представительной сущности.
      const entity = pickRepresentativeEntity(projection);
      if (!isWarmup && representative[gameId] === undefined && entity !== undefined) {
        representative[gameId] = {
          entityId: entity.entityId,
          label: entity.label,
          kind: entity.kind,
          facetSourceCount: facetSourceCount(entity)
        };
      }
      timed(bucket, "yaml.entityProjection", () => {
        if (entity === undefined) {
          return undefined;
        }
        return engine.buildEditorEntityYamlProjection({ entity, documents: projectionDocuments });
      });

      // 10. Компиляция game authoring → runtime manifest (холодная, без кэша).
      const gameInput = inputs.find((input) => input.kind === "game");
      const gameText = texts.find(({ input }) => input.kind === "game").text;
      timed(bucket, "compile.game", () =>
        authoringCompiler.compileAuthoringText(gameInput.job, gameText, compilerAjv)
      );

      // 10b. Тёплая компиляция через кэш уровня 3 (первый вызов — промах, пишет
      // кэш; последующие — попадание, читают с диска). Диагностический разрез:
      // НЕ входит в composite. Даёт число «warm, cache hit» для §9.7.
      timed(bucket, "compile.gameWarm", () =>
        authoringCompiler.compileAuthoringTextCached(gameInput.job, gameText, compilerAjv, {
          cacheEnabled: true
        })
      );

      // 11. Компиляция ui authoring → runtime manifest (сумма по каналам).
      const uiInputs = inputs.filter((input) => input.kind === "ui");
      timed(bucket, "compile.ui", () => {
        for (const uiInput of uiInputs) {
          const uiText = texts.find(({ input }) => input === uiInput).text;
          authoringCompiler.compileAuthoringText(uiInput.job, uiText, compilerAjv);
        }
      });

      // Грубые размеры входов — фиксируем один раз (для анализа нелинейности).
      if (!isWarmup && inputStats[gameId] === undefined) {
        inputStats[gameId] = {
          files: inputs.map((input) => ({
            relPath: input.relPath,
            kind: input.kind,
            channel: input.channel,
            bytes: fs.statSync(input.absPath).size
          })),
          totalBytes: inputs.reduce((sum, input) => sum + fs.statSync(input.absPath).size, 0),
          entityCount: projection.entities.length
        };
      }
    }
  }

  // --- Составной показатель на игру (сумма стадий пути, покомпонентно по итерациям) ---
  const COMPOSITE_STAGES = [
    "read.files",
    "parse.documentStore",
    "validate.documents",
    "graph.projection",
    "projection.entity",
    "tree.entityTreeView",
    "tree.jsonTree",
    "timeline.chronology",
    "yaml.entityProjection",
    "compile.game",
    "compile.ui"
  ];
  for (const { gameId } of games) {
    const bucket = perGame[gameId];
    const composite = [];
    for (let i = 0; i < options.iterations; i += 1) {
      let sum = 0;
      for (const stage of COMPOSITE_STAGES) {
        sum += bucket[stage][i];
      }
      composite.push(sum);
    }
    bucket["composite.projectionLoad"] = composite;
  }

  // --- Сводка ---
  const summarizeBucket = (bucket) =>
    Object.fromEntries(Object.entries(bucket).map(([name, values]) => [name, summarize(values)]));

  const result = {
    generatedAt: new Date().toISOString(),
    host,
    options: { iterations: options.iterations, warmups: options.warmups, games: options.games },
    gcEnabled: typeof global.gc === "function",
    shared: summarizeBucket(shared),
    perGame: Object.fromEntries(games.map((g) => [g.gameId, summarizeBucket(perGame[g.gameId])])),
    representativeEntity: representative,
    inputStats
  };

  // --- Вывод таблиц ---
  printReport(result, COMPOSITE_STAGES);

  // --- Запись JSON в .tmp/ ---
  const tmpDir = path.join(repoRoot, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(tmpDir, `profile-editor-load-${date}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`\nJSON записан: ${path.relative(repoRoot, outFile)}`);
}

function fmt(ms) {
  return ms.toFixed(3).padStart(10);
}

function printReport(result, compositeStages) {
  console.log("=".repeat(78));
  console.log("Профиль холодной загрузки editor-проекций");
  console.log("=".repeat(78));
  console.log(
    `Хост: nproc=${result.host.nproc}, load(1/5/15)=${result.host.loadAverage
      .map((v) => v.toFixed(2))
      .join("/")}, node=${result.host.nodeVersion}, mem free=${result.host.freeMemMb}MB`
  );
  console.log(
    `Итераций: ${result.options.iterations} (+${result.options.warmups} прогрев), GC между итерациями: ${
      result.gcEnabled ? "да" : "нет"
    }`
  );

  const row = (name, s) => `  ${name.padEnd(26)} ${fmt(s.median)} ${fmt(s.min)} ${fmt(s.max)}`;
  const header = `  ${"метрика".padEnd(26)} ${"медиана".padStart(10)} ${"min".padStart(10)} ${"max".padStart(10)}  (мс)`;

  console.log("\n--- Разовая инициализация (общая; цель кэша уровня 3) ---");
  console.log(header);
  for (const [name, s] of Object.entries(result.shared)) {
    console.log(row(name, s));
  }

  for (const [gameId, bucket] of Object.entries(result.perGame)) {
    const stats = result.inputStats[gameId];
    console.log(`\n--- Игра: ${gameId} (входы ${(stats.totalBytes / 1024).toFixed(1)} KB, сущностей ${stats.entityCount}) ---`);
    console.log(header);
    for (const stage of compositeStages) {
      console.log(row(stage, bucket[stage]));
    }
    console.log("  " + "-".repeat(58));
    console.log(row("composite.projectionLoad", bucket["composite.projectionLoad"]));
    console.log(row("parse.jsonOnly (диагн.)", bucket["parse.jsonOnly"]));
    console.log(row("compile.game (warm, hit)", bucket["compile.gameWarm"]));
    const rep = result.representativeEntity[gameId];
    if (rep) {
      console.log(`  представит. сущность YAML: ${rep.entityId} (facet-источников: ${rep.facetSourceCount})`);
    }
  }
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
