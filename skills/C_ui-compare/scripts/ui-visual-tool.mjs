#!/usr/bin/env node
/**
 * ui-visual-tool.mjs — единый инструмент детерминированного сравнения UI с образцом.
 *
 * Зачем: vision-модели (мультимодальные LLM) ненадёжно видят пиксельные различия
 * между «как есть» и «как должно быть». Поэтому различия должен находить
 * детерминированный код (pixelmatch), а модель — только объяснять и чинить их.
 * Этот скрипт — набор подкоманд для такого измеряемого цикла.
 *
 * Подкоманды:
 *   to-png  <image> --out <png> [--width N]         привести образец (jpg/webp/png) к PNG
 *   capture <url>   --out <png> [--viewport WxH]    скриншот работающего UI (Playwright)
 *   compare <ref.png> <impl.png> [--out-dir D]      пиксельное сравнение + сетка регионов
 *   compare-elements <ref.png> <url> --regions ...  двухуровневая проверка по элементам:
 *                                                   геометрия (DOM) + внешний вид (кропы)
 *   validate-inventory <inventory.json>             JSON Schema + смысловые инварианты
 *   create-profile <ref.png> --inventory ...        воспроизводимый профиль сравнения
 *   scan <img.png> --out-dir ...                    адаптивные кропы плотных зон
 *   detail-coverage <img.png> --regions <файл>      геометрия + карта контрастных деталей
 *   audit <url> [--profile ...]                     доступность и адаптивная компоновка
 *   capture-matrix <url> --profile ...              все viewport из профиля
 *   crop    <img.png> --rect x,y,w,h --out <png>    вырезать зону (с увеличением --scale)
 *   sample  <img.png> --points "x,y;..."|--rect ... точные цвета пикселей/зоны
 *
 * Зависимости берутся из node_modules корня репозитория (playwright, pixelmatch,
 * pngjs уже объявлены в корневом package.json) — запускать из корня репозитория:
 *   node skills/C_ui-compare/scripts/ui-visual-tool.mjs <команда> ...
 *
 * Все артефакты по умолчанию пишутся в .tmp/ui-compare/ (правило проекта:
 * временные файлы живут в .tmp/ и не коммитятся).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  installedPackageVersion,
  flattenRegionSpec,
  inventorySource,
  readAndValidateProfile,
  schemaPaths,
  sha256File,
  validateInventoryDocument,
  validateProfileArtifacts,
  validateProfileDocument,
  viewportFromProfile,
  UI_COMPARE_CAPTURE_ALGORITHM_VERSION,
  UI_COMPARE_TOOL_CONTRACT_VERSION,
  UI_COMPARISON_PROFILE_SCHEMA_ID,
} from "./ui-inventory.mjs";

// Зависимости загружаются в два приёма: сначала обычное разрешение Node
// (node_modules вверх по дереву от файла скрипта), затем node_modules каталога
// запуска. Второй путь нужен для переносимости: навык может быть установлен
// вне дерева проекта (общий каталог skills), а зависимости стоят в проекте.
async function loadDep(name, entry) {
  try {
    return await import(name);
  } catch {
    try {
      return await import(pathToFileURL(path.join(process.cwd(), "node_modules", name, entry)).href);
    } catch {
      console.error(
        `Не найдена зависимость "${name}". Установи в каталоге запуска (корне проекта):\n` +
        `  npm install\n` +
        `Используй зафиксированные package.json/package-lock.json и запускай инструмент из корня проекта.`
      );
      process.exit(1);
    }
  }
}

const { PNG } = await loadDep("pngjs", "lib/png.js");
const pixelmatch = (await loadDep("pixelmatch", "index.js")).default;
// Playwright загружается лениво внутри команд, которым нужен браузер (см. loadDep).

// Фактический путь запуска этого скрипта — для подсказок с готовыми командами
// (навык может подключаться через мост среды агента, путь нельзя вычислять из него).
const SELF = path.relative(process.cwd(), process.argv[1]) || path.basename(process.argv[1]);

const DEFAULT_OUT_DIR = path.join(".tmp", "ui-compare");

// ---------------------------------------------------------------------------
// Разбор аргументов командной строки (без внешних библиотек, чтобы не тянуть
// лишние зависимости: --flag value и --flag без значения → true).
// Булевы флаги перечислены явно: иначе флаг, стоящий перед позиционным
// аргументом, «съедал» бы его как своё значение (--full-page <url> → url
// пропадал бы).
// ---------------------------------------------------------------------------
const BOOLEAN_FLAGS = new Set([
  "full-page", "include-aa", "no-crops", "no-freeze", "ci", "allow-legacy",
  "allow-unstable", "enforce-detail-gate",
]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function parseRect(str) {
  const parts = String(str).split(",").map((v) => parseInt(v.trim(), 10));
  if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) {
    throw new Error(`Неверный формат прямоугольника: "${str}" (ожидается x,y,w,h)`);
  }
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}

function parseViewport(str, fallback = { width: 1920, height: 1080 }) {
  if (!str || str === true) return fallback;
  const m = String(str).match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error(`Неверный формат viewport: "${str}" (ожидается WxH, например 1920x1080)`);
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function readProfile(flags) {
  return typeof flags.profile === "string"
    ? readAndValidateProfile(flags.profile, process.argv[1])
    : null;
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function runtimeMetadata(extra = {}) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    toolScript: path.resolve(process.argv[1]),
    toolScriptSha256: sha256File(process.argv[1]),
    toolContractVersion: UI_COMPARE_TOOL_CONTRACT_VERSION,
    captureAlgorithmVersion: UI_COMPARE_CAPTURE_ALGORITHM_VERSION,
    playwright: installedPackageVersion("playwright"),
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

function profileViewport(profile, flags, fallback) {
  if (!profile) return parseViewport(flags.viewport, fallback);
  const selected = viewportFromProfile(profile, flags["viewport-name"]);
  if (flags.viewport) {
    const explicit = parseViewport(flags.viewport);
    if (explicit.width !== selected.width || explicit.height !== selected.height) {
      console.warn("ВНИМАНИЕ: --viewport переопределяет версионированный профиль; зафиксируй причину в отчёте.");
    }
    return explicit;
  }
  return { width: selected.width, height: selected.height };
}

function captureSettings(profile, flags) {
  const configured = profile?.capture || {};
  const settings = {
    dpr: flags.dpr ? parseFloat(flags.dpr) : (configured.dpr ?? 1),
    colorScheme: flags["color-scheme"] || configured.colorScheme || "light",
    reducedMotion: configured.reducedMotion || "reduce",
    locale: flags.locale || configured.locale || "ru-RU",
    timezoneId: flags.timezone || configured.timezoneId || "Europe/Moscow",
    waitMs: flags["wait-ms"] ? parseInt(flags["wait-ms"], 10) : (configured.waitMs ?? 800),
    stabilityFrames: configured.stabilityFrames ?? 2,
    stabilityIntervalMs: flags["stability-interval-ms"]
      ? parseInt(flags["stability-interval-ms"], 10)
      : (configured.stabilityIntervalMs ?? 150),
    maxStabilityAttempts: flags["max-stability-attempts"]
      ? parseInt(flags["max-stability-attempts"], 10)
      : (configured.maxStabilityAttempts ?? 5),
    allowUnstable: flags["allow-unstable"] === true,
    waitSelector: flags["wait-selector"] || configured.waitSelector,
    steps: flags.steps || configured.steps,
  };
  if (!Number.isFinite(settings.dpr) || settings.dpr <= 0) {
    throw new Error("--dpr должен быть положительным числом");
  }
  if (!Number.isInteger(settings.stabilityIntervalMs) || settings.stabilityIntervalMs < 0) {
    throw new Error("--stability-interval-ms должен быть неотрицательным целым числом");
  }
  if (!Number.isInteger(settings.maxStabilityAttempts) ||
      settings.maxStabilityAttempts < settings.stabilityFrames) {
    throw new Error("--max-stability-attempts должен быть целым и не меньше числа стабильных кадров");
  }
  return settings;
}

function comparisonSettings(profile, flags) {
  const configured = profile?.compare || {};
  return {
    threshold: flags.threshold ? parseFloat(flags.threshold) : (configured.threshold ?? 0.1),
    gate: flags.gate ? parseFloat(flags.gate) : (configured.gate ?? 5),
    cellGate: flags["cell-gate"] ? parseFloat(flags["cell-gate"]) : (configured.cellGate ?? 10),
    tolerance: flags.tolerance ? parseFloat(flags.tolerance) : (configured.tolerance ?? 2),
    includeAA: flags["include-aa"] ? true : (configured.includeAA ?? false),
  };
}

// Масштаб автокропа: мелкие элементы (кнопки, индикаторы) увеличиваем сильнее,
// чтобы при просмотре моделью каждый пиксель остался различим.
function cropScaleFor(w, h) {
  const m = Math.max(w, h);
  if (m <= 200) return 3;
  if (m <= 600) return 2;
  return 1;
}

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath, png) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function hex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Вырезает регион из PNG. Границы заранее приводятся к допустимым,
// потому что bitblt в pngjs бросает исключение при выходе за края.
function extractRegion(png, x, y, w, h) {
  const cx = Math.max(0, Math.min(x, png.width - 1));
  const cy = Math.max(0, Math.min(y, png.height - 1));
  const cw = Math.max(1, Math.min(w, png.width - cx));
  const ch = Math.max(1, Math.min(h, png.height - cy));
  const out = new PNG({ width: cw, height: ch });
  PNG.bitblt(png, out, cx, cy, cw, ch, 0, 0);
  return out;
}

// Увеличение «ближайшим соседом» — без сглаживания, чтобы при просмотре кропа
// моделью каждый исходный пиксель оставался различимым.
function scaleNearest(png, k) {
  if (k <= 1) return png;
  const out = new PNG({ width: png.width * k, height: png.height * k });
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < out.width; x++) {
      const sx = Math.floor(x / k);
      const si = (sy * png.width + sx) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

// Масштабирование к произвольному размеру «ближайшим соседом» — для
// нормализации кропа элемента, когда фактический размер элемента отличается
// от размеченного (внешний вид сравнивается отдельно от геометрии).
function resizeNearest(png, W, H) {
  if (png.width === W && png.height === H) return png;
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const sy = Math.min(png.height - 1, Math.floor((y * png.height) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x * png.width) / W));
      const si = (sy * png.width + sx) * 4;
      const di = (y * W + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

// Склейка изображений в один ряд (образец | реализация | diff) — модели проще
// смотреть на один файл, чем сопоставлять три отдельных.
function composeSideBySide(images, gap = 12) {
  const width = images.reduce((s, i) => s + i.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((i) => i.height));
  const out = new PNG({ width, height });
  out.data.fill(255); // белый фон, включая альфа-канал
  let ox = 0;
  for (const img of images) {
    PNG.bitblt(img, out, 0, 0, img.width, img.height, ox, 0);
    ox += img.width + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// to-png: приведение образца любого растрового формата к PNG.
// Вместо добавления зависимости-декодера (jpeg-js, sharp) используем Chromium
// из Playwright: он открывает файл как картинку, мы снимаем скриншот 1:1.
// ---------------------------------------------------------------------------
async function cmdToPng(positional, flags) {
  const [input] = positional;
  if (!input || !flags.out) {
    throw new Error("Использование: to-png <image> --out <png> [--width N]");
  }
  const { chromium } = await loadDep("playwright", "index.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();
    const fileUrl = pathToFileURL(path.resolve(input)).href;
    await page.goto(fileUrl, { waitUntil: "load" });
    const dims = await page.evaluate(() => {
      const img = document.images[0];
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    if (!dims) throw new Error(`Chromium не открыл "${input}" как изображение`);

    // --width масштабирует пропорционально: полезно, чтобы привести макет
    // к ширине реального viewport перед сравнением.
    const width = flags.width ? parseInt(flags.width, 10) : dims.w;
    const height = Math.round((dims.h * width) / dims.w);
    await page.setViewportSize({ width, height });
    await page.evaluate(({ width, height }) => {
      const img = document.images[0];
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      img.style.position = "fixed";
      img.style.left = "0";
      img.style.top = "0";
      img.style.width = width + "px";
      img.style.height = height + "px";
    }, { width, height });
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    await page.screenshot({ path: flags.out, clip: { x: 0, y: 0, width, height } });
    console.log(`OK: ${input} (${dims.w}x${dims.h}) -> ${flags.out} (${width}x${height})`);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Подготовка страницы к детерминированному скриншоту.
// 1) Сценарий --steps: последовательность действий (клики, ожидания) для
//    доведения приложения до целевого состояния — методология §8 требует
//    сравнивать целевой экран, а не стартовый.
// 2) Ожидание document.fonts.ready: скриншот, снятый до подгрузки
//    веб-шрифта, даёт ложный diff по всему тексту.
// 3) Заморозка анимаций и переходов: без неё региональный diff нестабилен
//    от прогона к прогону (методология §10.5 п.5). Отключается --no-freeze.
// ---------------------------------------------------------------------------
async function runSteps(page, stepsFile) {
  const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8"));
  if (!Array.isArray(steps)) throw new Error("--steps: ожидается JSON-массив шагов");
  for (const [i, step] of steps.entries()) {
    if (step.click) {
      await page.locator(step.click).first().click({ timeout: 15000 });
      console.log(`  шаг ${i + 1}: click ${step.click}`);
    } else if (step.waitSelector) {
      await page.waitForSelector(step.waitSelector, { timeout: 30000 });
      console.log(`  шаг ${i + 1}: waitSelector ${step.waitSelector}`);
    } else if (step.fill) {
      await page.locator(step.fill.selector).first().fill(String(step.fill.value));
      console.log(`  шаг ${i + 1}: fill ${step.fill.selector}`);
    } else if (step.wait) {
      await page.waitForTimeout(step.wait);
      console.log(`  шаг ${i + 1}: wait ${step.wait}ms`);
    } else {
      throw new Error(
        `Неизвестный шаг сценария #${i + 1}: ${JSON.stringify(step)} ` +
        `(поддерживаются {"click":"css"}, {"waitSelector":"css"}, ` +
        `{"fill":{"selector":"css","value":"..."}}, {"wait":ms})`
      );
    }
  }
}

async function preparePage(page, flags, settings = captureSettings(null, flags)) {
  if (typeof settings.steps === "string") {
    console.log("Сценарий достижения состояния:");
    await runSteps(page, settings.steps);
  }
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  // decode() ждёт не только событие load, но и фактическую готовность пикселей
  // изображения. Ошибка отдельной картинки остаётся в метаданных и не
  // блокирует снимок бесконечно.
  const imageReadiness = await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        await img.decode();
      } catch {
        // Сломанная картинка должна попасть в отчёт, а не зависнуть здесь.
      }
    }));
    return {
      total: images.length,
      incomplete: images.filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src || "<inline>"),
      fontFamilies: [...new Set(
        [...document.querySelectorAll("*")]
          .slice(0, 1000)
          .map((element) => getComputedStyle(element).fontFamily)
          .filter(Boolean)
      )].sort(),
    };
  });
  if (!flags["no-freeze"]) {
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;" +
        "caret-color:transparent!important;scroll-behavior:auto!important}",
    }).catch(() => {});
  }
  return imageReadiness;
}

/**
 * Capture until two consecutive frames are byte-identical. A fixed delay can
 * still land in the middle of a JavaScript-driven render, while consecutive
 * equality gives direct evidence that the compared state stopped changing.
 */
async function captureStableFrame(page, takeFrame, settings) {
  let previousHash = null;
  let stableRun = 0;
  let lastBuffer = null;
  const hashes = [];
  for (let attempt = 1; attempt <= settings.maxStabilityAttempts; attempt++) {
    lastBuffer = await takeFrame();
    const currentHash = hashBuffer(lastBuffer);
    hashes.push(currentHash);
    stableRun = currentHash === previousHash ? stableRun + 1 : 1;
    if (stableRun >= settings.stabilityFrames) {
      return { buffer: lastBuffer, stable: true, attempts: attempt, hashes };
    }
    previousHash = currentHash;
    if (attempt < settings.maxStabilityAttempts) {
      await page.waitForTimeout(settings.stabilityIntervalMs);
    }
  }
  const result = {
    buffer: lastBuffer,
    stable: false,
    attempts: settings.maxStabilityAttempts,
    hashes,
  };
  if (!settings.allowUnstable) {
    throw new Error(
      `Страница не дала ${settings.stabilityFrames} одинаковых последовательных кадров ` +
      `за ${settings.maxStabilityAttempts} попыток; зафиксируй состояние или используй ` +
      "--allow-unstable только с объяснением в отчёте"
    );
  }
  console.warn("ВНИМАНИЕ: сохранён нестабильный кадр по явному --allow-unstable");
  return result;
}

// ---------------------------------------------------------------------------
// capture: скриншот работающего UI с фиксированными viewport и DPR.
// DPR (device pixel ratio, плотность пикселей) фиксируем = 1, иначе на разных
// машинах один и тот же UI даёт разные пиксели и diff становится шумным.
// ---------------------------------------------------------------------------
async function cmdCapture(positional, flags) {
  const [url] = positional;
  if (!url || !flags.out) {
    throw new Error(
      "Использование: capture <url> --out <png> [--viewport WxH] [--dpr N] " +
      "[--wait-selector <css>] [--wait-ms N] [--element <css>] [--full-page] " +
      "[--steps <steps.json>] [--no-freeze]"
    );
  }
  const profile = readProfile(flags);
  const viewport = profileViewport(profile, flags, { width: 1920, height: 1080 });
  const settings = captureSettings(profile, flags);
  const dpr = settings.dpr;

  const { chromium } = await loadDep("playwright", "index.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      colorScheme: settings.colorScheme,
      reducedMotion: settings.reducedMotion,
      locale: settings.locale,
      timezoneId: settings.timezoneId,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (settings.waitSelector) {
      await page.waitForSelector(settings.waitSelector, { timeout: 30000 });
    }
    const readiness = await preparePage(page, flags, settings);
    // Небольшая пауза после подготовки: даём завершиться перерисовке.
    await page.waitForTimeout(settings.waitMs);
    const takeFrame = flags.element
      ? () => page.locator(flags.element).first().screenshot({ animations: "disabled", caret: "hide" })
      : () => page.screenshot({
        fullPage: Boolean(flags["full-page"]),
        animations: "disabled",
        caret: "hide",
      });
    const stability = await captureStableFrame(page, takeFrame, settings);
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(flags.out, stability.buffer);
    const metadataPath = typeof flags.report === "string" ? flags.report : `${flags.out}.json`;
    const metadata = runtimeMetadata({
      command: "capture",
      url,
      output: path.resolve(flags.out),
      outputSha256: sha256File(flags.out),
      browser: { name: "chromium", version: browser.version() },
      viewport,
      capture: settings,
      stability: {
        stable: stability.stable,
        attempts: stability.attempts,
        frameSha256: stability.hashes,
      },
      readiness,
      profile: typeof flags.profile === "string"
        ? { path: path.resolve(flags.profile), sha256: sha256File(flags.profile) }
        : null,
    });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`OK: ${url} -> ${flags.out} (viewport ${viewport.width}x${viewport.height}, dpr ${dpr})`);
    console.log(`Метаданные: ${metadataPath}`);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// compare: пиксельное сравнение «образец vs реализация».
// Выход: общий процент различий, разбивка по сетке (локализация: ГДЕ различия),
// diff.png (карта различий), side-by-side.png и машинный report.json.
// ---------------------------------------------------------------------------
function diffPercent(a, b, w, h, options) {
  const count = pixelmatch(a.data, b.data, undefined, w, h, options);
  return { count, percent: (count / (w * h)) * 100 };
}

async function cmdCompare(positional, flags) {
  const [refPath, implPath] = positional;
  if (!refPath || !implPath) {
    throw new Error(
      "Использование: compare <reference.png> <implementation.png> [--out-dir D] " +
      "[--threshold 0.1] [--grid 4x4] [--regions <regions.json>] [--gate 5] [--include-aa]"
    );
  }
  const profile = readProfile(flags);
  const configured = comparisonSettings(profile, flags);
  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : DEFAULT_OUT_DIR;
  const threshold = configured.threshold;
  const gate = configured.gate;
  // Отдельный порог на ячейку/регион: локальный дефект (пропавшая кнопка ~25%
  // в своей ячейке) «разбавляется» площадью кадра до 2-3% и проходит общий
  // порог. Поэтому FAIL ставится и при превышении порога любой ячейкой.
  const cellGate = configured.cellGate;
  // includeAA=true заставляет считать антиалиасинг (сглаживание краёв текста)
  // различием. По умолчанию выключено: шрифтовый шум маскирует реальные дефекты.
  const options = { threshold, includeAA: configured.includeAA };

  if (profile && sha256File(refPath) !== profile.reference.sha256) {
    throw new Error("Образец изменился после создания профиля: SHA-256 не совпадает");
  }

  let ref = readPng(refPath);
  let impl = readPng(implPath);

  const sizeMismatch = ref.width !== impl.width || ref.height !== impl.height;
  if (sizeMismatch) {
    console.warn(
      `ВНИМАНИЕ: размеры не совпадают (образец ${ref.width}x${ref.height}, ` +
      `реализация ${impl.width}x${impl.height}). Сравнивается перекрытие от левого ` +
      `верхнего угла; правильнее выровнять размеры (to-png --width / capture --viewport).`
    );
  }
  const w = Math.min(ref.width, impl.width);
  const h = Math.min(ref.height, impl.height);
  ref = extractRegion(ref, 0, 0, w, h);
  impl = extractRegion(impl, 0, 0, w, h);
  // Сохраняем выровненные копии: все координаты отчёта относятся именно к ним,
  // и команды crop/sample должны выполняться по этим файлам.
  writePng(path.join(outDir, "ref.png"), ref);
  writePng(path.join(outDir, "impl.png"), impl);

  const diffPng = new PNG({ width: w, height: h });
  const totalCount = pixelmatch(ref.data, impl.data, diffPng.data, w, h, options);
  const totalPercent = (totalCount / (w * h)) * 100;
  writePng(path.join(outDir, "diff.png"), diffPng);
  writePng(path.join(outDir, "side-by-side.png"), composeSideBySide([ref, impl, diffPng]));

  // Разбивка по сетке: один общий процент не говорит, где проблема.
  // Сетка сразу показывает «footer отличается на 40%, остальное на 0.2%».
  const gridSpec = typeof flags.grid === "string" ? flags.grid : "4x4";
  const gm = gridSpec.match(/^(\d+)x(\d+)$/);
  if (!gm) throw new Error(`Неверный формат --grid: "${gridSpec}" (ожидается ColsxRows)`);
  const cols = parseInt(gm[1], 10);
  const rows = parseInt(gm[2], 10);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor((w * c) / cols);
      const y = Math.floor((h * r) / rows);
      const cw = (c === cols - 1 ? w : Math.floor((w * (c + 1)) / cols)) - x;
      const ch = (r === rows - 1 ? h : Math.floor((h * (r + 1)) / rows)) - y;
      const a = extractRegion(ref, x, y, cw, ch);
      const b = extractRegion(impl, x, y, cw, ch);
      const { percent } = diffPercent(a, b, cw, ch, options);
      cells.push({ cell: `r${r + 1}c${c + 1}`, x, y, w: cw, h: ch, percent });
    }
  }
  cells.sort((a, b) => b.percent - a.percent);

  // Именованные регионы — предпочтительный режим: сравнение в терминах
  // смысловых элементов (кнопка, панель), а не абстрактных ячеек. Принимает
  // простой массив [{id,x,y,w,h}] или *.design.json (ADR-016) напрямую.
  let regions = [];
  const skippedRegions = [];
  if (typeof flags.regions === "string") {
    const raw = JSON.parse(fs.readFileSync(flags.regions, "utf8"));
    regions = flattenRegionSpec(raw, skippedRegions).map((rg) => {
      const a = extractRegion(ref, rg.x, rg.y, rg.w, rg.h);
      const b = extractRegion(impl, rg.x, rg.y, rg.w, rg.h);
      const { percent } = diffPercent(a, b, a.width, a.height, options);
      return { ...rg, percent };
    }).sort((a, b) => b.percent - a.percent);
    if (skippedRegions.length) {
      console.warn(`ВНИМАНИЕ: зоны без bounds пропущены: ${skippedRegions.join(", ")}`);
    }
  }

  const failedCells = cells.filter((c) => c.percent >= cellGate);
  const failedRegions = regions.filter((r) => r.percent >= cellGate);
  const failReasons = [];
  if (sizeMismatch) failReasons.push("размеры образца и реализации не совпадают");
  if (profile?.mode !== "style-parity") {
    if (totalPercent >= gate) failReasons.push(`общий diff ${totalPercent.toFixed(2)}% >= ${gate}%`);
    if (failedCells.length) failReasons.push(`ячейки выше порога ${cellGate}%: ${failedCells.map((c) => c.cell).join(", ")}`);
    if (failedRegions.length) failReasons.push(`регионы выше порога ${cellGate}%: ${failedRegions.map((r) => r.id).join(", ")}`);
  }
  const status = failReasons.length ? "FAIL" : "PASS";

  // Автокропы проблемных зон: полоса «образец | реализация | diff» с
  // увеличением. Именно эти файлы (а не полные кадры) нужно смотреть при
  // диагностике — на полном кадре, ужатом до контекста модели, мелкие
  // различия неразличимы. Семантические регионы приоритетнее ячеек сетки.
  const cropOutputs = [];
  if (!flags["no-crops"]) {
    const zones = [...failedRegions, ...failedCells].slice(0, 6);
    for (const zone of zones) {
      const label = String(zone.id || zone.cell).replace(/[^\w.-]+/g, "_");
      const k = cropScaleFor(zone.w, zone.h);
      const strip = composeSideBySide([
        scaleNearest(extractRegion(ref, zone.x, zone.y, zone.w, zone.h), k),
        scaleNearest(extractRegion(impl, zone.x, zone.y, zone.w, zone.h), k),
        scaleNearest(extractRegion(diffPng, zone.x, zone.y, zone.w, zone.h), k),
      ]);
      const file = path.join(outDir, `crop-${label}.png`);
      writePng(file, strip);
      cropOutputs.push({ zone: zone.id || zone.cell, file, scale: k, layout: "ref | impl | diff" });
    }
  }
  const report = {
    schemaVersion: "2.0",
    mode: profile?.mode || "pixel-parity",
    reference: path.resolve(refPath),
    implementation: path.resolve(implPath),
    hashes: {
      reference: sha256File(refPath),
      implementation: sha256File(implPath),
      profile: typeof flags.profile === "string" ? sha256File(flags.profile) : null,
    },
    runtime: runtimeMetadata(),
    comparedSize: { width: w, height: h },
    sizeMismatch,
    options: {
      threshold,
      includeAA: options.includeAA,
      gate,
      cellGate,
      pixelGateEnforced: profile?.mode !== "style-parity",
    },
    totalDiffPixels: totalCount,
    totalPercent: Number(totalPercent.toFixed(3)),
    status,
    failReasons,
    grid: cells.map((c) => ({ ...c, percent: Number(c.percent.toFixed(3)) })),
    regions: regions.map((r) => ({ ...r, percent: Number(r.percent.toFixed(3)) })),
    skippedRegions,
    crops: cropOutputs,
    files: {
      ref: path.join(outDir, "ref.png"),
      impl: path.join(outDir, "impl.png"),
      diff: path.join(outDir, "diff.png"),
      sideBySide: path.join(outDir, "side-by-side.png"),
      report: path.join(outDir, "report.json"),
    },
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(`Общий diff: ${totalPercent.toFixed(2)}% (${totalCount} px из ${w * h}), порог ${gate}%, порог ячейки ${cellGate}%`);
  if (profile?.mode === "style-parity") {
    console.log("Режим style-parity: пиксельные значения диагностические и не определяют PASS.");
  }
  console.log(`Сетка ${gridSpec} (худшие сверху):`);
  for (const c of cells) {
    const mark = c.percent >= cellGate ? "  <-- превышает порог ячейки" : "";
    console.log(`  ${c.cell}  rect=${c.x},${c.y},${c.w},${c.h}  ${c.percent.toFixed(2)}%${mark}`);
  }
  if (regions.length) {
    console.log("Именованные регионы:");
    for (const r of regions) {
      console.log(`  ${r.id}  rect=${r.x},${r.y},${r.w},${r.h}  ${r.percent.toFixed(2)}%`);
    }
  }
  if (cropOutputs.length) {
    console.log("Автокропы проблемных зон (образец | реализация | diff) — смотреть их, а не полные кадры:");
    for (const c of cropOutputs) console.log(`  ${c.zone} -> ${c.file} (x${c.scale})`);
  }
  console.log(`Артефакты: ${outDir} (ref.png, impl.png, diff.png, side-by-side.png, report.json)`);
  console.log(`СТАТУС: ${status}${failReasons.length ? " — " + failReasons.join("; ") : ""}`);
  if (flags.ci && status === "FAIL") process.exitCode = 2;
  if (status === "FAIL" && !cropOutputs.length) {
    const worst = cells[0];
    console.log(
      `Локализуй худшую ячейку (смотри кропы, а не полный кадр):\n` +
      `  node ${SELF} crop ${report.files.ref} --rect ${worst.x},${worst.y},${worst.w},${worst.h} --scale 2 --out ${path.join(outDir, "crop-ref.png")}\n` +
      `  node ${SELF} crop ${report.files.impl} --rect ${worst.x},${worst.y},${worst.w},${worst.h} --scale 2 --out ${path.join(outDir, "crop-impl.png")}`
    );
  }
}

// ---------------------------------------------------------------------------
// compare-elements: двухуровневая проверка по элементам разметки.
// Уровень 1 — геометрия («не там»): bounds из разметки образца против
// фактического getBoundingClientRect() DOM-элемента живой реализации.
// Уровень 2 — внешний вид («не такой»): кроп образца по bounds разметки
// против кропа реализации по ФАКТИЧЕСКИМ bounds (с нормализацией размера).
// В едином пиксельном проценте «элемент сдвинут» и «элемент выглядит иначе»
// смешиваются — здесь они разделены на два независимых вердикта.
// Дополнительно проверяется перекрытие (elementFromPoint в центре элемента):
// ловит кейс «кнопка видна, но кликнуть нельзя» (методология §7).
// Селектор берётся из необязательного поля selector зоны/элемента в
// *.design.json (схема ADR-016 допускает дополнительные поля) либо из карты
// --selectors вида {"id": "css", "region/element": "css"}.
// ---------------------------------------------------------------------------
async function cmdCompareElements(positional, flags) {
  const [refPath, url] = positional;
  if (!refPath || !url || typeof flags.regions !== "string") {
    throw new Error(
      "Использование: compare-elements <reference.png> <url> --regions <файл> " +
      "[--selectors <map.json>] [--viewport WxH] [--tolerance 2] [--gate 10] " +
      "[--threshold 0.1] [--wait-selector <css>] [--wait-ms N] [--out-dir D] " +
      "[--steps <steps.json>] [--no-freeze] [--include-aa] [--ci]"
    );
  }
  const profile = readProfile(flags);
  const configured = comparisonSettings(profile, flags);
  const capture = captureSettings(profile, flags);
  // DPR всегда 1: координаты разметки заданы в пикселях изображения-образца,
  // getBoundingClientRect возвращает CSS-пиксели, а скриншот при DPR=2 был бы
  // в физических пикселях — смешение масштабов дало бы кропы не тех областей.
  if (flags.dpr && parseFloat(flags.dpr) !== 1) {
    console.warn("ВНИМАНИЕ: compare-elements всегда работает при DPR=1; --dpr проигнорирован.");
  }
  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : DEFAULT_OUT_DIR;
  // Допуск геометрии в пикселях: субпиксельные округления браузера дают ±1px,
  // всё сверх допуска — реальный сдвиг или неверный размер.
  const tolerance = configured.tolerance;
  const gate = profile?.mode === "style-parity"
    ? 101
    : (flags.gate ? parseFloat(flags.gate) : (profile ? configured.cellGate : 10));
  const options = {
    threshold: configured.threshold,
    includeAA: configured.includeAA,
  };
  const waitMs = capture.waitMs;

  const ref = readPng(refPath);
  // Viewport по умолчанию равен размеру образца: иначе фактические координаты
  // элементов заведомо не совпадут с разметкой.
  const viewport = profileViewport(profile, flags, { width: ref.width, height: ref.height });

  const skippedRegions = [];
  const raw = JSON.parse(fs.readFileSync(flags.regions, "utf8"));
  const selMap = typeof flags.selectors === "string"
    ? JSON.parse(fs.readFileSync(flags.selectors, "utf8"))
    : {};
  const specs = flattenRegionSpec(raw, skippedRegions)
    .map((s) => ({ ...s, selector: selMap[s.id] || s.selector }));
  const noSelector = specs.filter((s) => !s.selector).map((s) => s.id);
  const targets = specs.filter((s) => s.selector);
  if (skippedRegions.length) {
    console.warn(`ВНИМАНИЕ: зоны без bounds пропущены: ${skippedRegions.join(", ")}`);
  }
  if (noSelector.length) {
    console.warn(`Без селектора (проверяй их через compare --regions): ${noSelector.join(", ")}`);
  }
  if (!targets.length) {
    throw new Error("Ни у одной зоны нет селектора (поле selector в разметке или карта --selectors)");
  }

  // Типы, для которых перекрытие означает сломанное взаимодействие,
  // а не допустимое наложение декора.
  const INTERACTIVE_TYPES = new Set([
    "button", "input", "control", "link", "toggle", "slider", "checkbox", "select",
  ]);

  const { chromium } = await loadDep("playwright", "index.mjs");
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  let shot;
  let stability;
  const probes = [];
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: capture.colorScheme,
      reducedMotion: capture.reducedMotion,
      locale: capture.locale,
      timezoneId: capture.timezoneId,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (capture.waitSelector) await page.waitForSelector(capture.waitSelector, { timeout: 30000 });
    await preparePage(page, flags, capture);
    await page.waitForTimeout(waitMs);
    stability = await captureStableFrame(
      page,
      () => page.screenshot({ animations: "disabled", caret: "hide" }),
      capture
    );
    shot = PNG.sync.read(stability.buffer);

    for (const spec of targets) {
      const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Элемент вне видимой области (или нулевого размера): прокрутка этим
        // инструментом не поддерживается, сравнение пикселей было бы мусорным,
        // а elementFromPoint вернул бы null (ложное «перекрыт»).
        const offscreen = r.width === 0 || r.height === 0 ||
          cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight;
        // elementFromPoint возвращает верхний элемент в точке; если это не сам
        // элемент, не его потомок и не предок — элемент перекрыт чужим слоем.
        const top = offscreen ? null : document.elementFromPoint(cx, cy);
        return {
          found: true,
          offscreen,
          rect: { x: r.left, y: r.top, w: r.width, h: r.height },
          occluded: offscreen ? false : !(top === el || el.contains(top) || (top && top.contains(el))),
        };
      }, spec.selector);
      probes.push({ spec, info });
    }
  } finally {
    await browser.close();
  }

  const rows = [];
  for (const { spec, info } of probes) {
    if (!info.found) {
      // Отсутствующий элемент — самый частый «незамеченный» дефект; он
      // фиксируется явно, а не растворяется в пиксельном проценте.
      rows.push({ id: spec.id, selector: spec.selector, status: "MISSING" });
      continue;
    }
    if (info.offscreen) {
      rows.push({
        id: spec.id, selector: spec.selector, status: "OFFSCREEN",
        geometry: {
          expected: { x: spec.x, y: spec.y, w: spec.w, h: spec.h },
          actual: info.rect,
        },
      });
      continue;
    }
    const a = info.rect;
    const delta = {
      dx: a.x - spec.x, dy: a.y - spec.y, dw: a.w - spec.w, dh: a.h - spec.h,
    };
    const geometryPass =
      Math.max(Math.abs(delta.dx), Math.abs(delta.dy), Math.abs(delta.dw), Math.abs(delta.dh)) <= tolerance;

    const refCrop = extractRegion(ref, Math.round(spec.x), Math.round(spec.y), Math.round(spec.w), Math.round(spec.h));
    const implCropRaw = extractRegion(
      shot,
      Math.round(a.x), Math.round(a.y),
      Math.max(1, Math.round(a.w)), Math.max(1, Math.round(a.h))
    );
    const resized = implCropRaw.width !== refCrop.width || implCropRaw.height !== refCrop.height;
    const implCrop = resizeNearest(implCropRaw, refCrop.width, refCrop.height);
    const diffCrop = new PNG({ width: refCrop.width, height: refCrop.height });
    const count = pixelmatch(refCrop.data, implCrop.data, diffCrop.data, refCrop.width, refCrop.height, options);
    const percent = (count / (refCrop.width * refCrop.height)) * 100;

    const k = cropScaleFor(refCrop.width, refCrop.height);
    const file = path.join(outDir, `element-${String(spec.id).replace(/[^\w.-]+/g, "_")}.png`);
    writePng(file, composeSideBySide([
      scaleNearest(refCrop, k), scaleNearest(implCrop, k), scaleNearest(diffCrop, k),
    ]));

    const interactive = INTERACTIVE_TYPES.has(String(spec.type || "").toLowerCase());
    const appearancePass = percent < gate;
    const occlusionFail = info.occluded && interactive;
    rows.push({
      id: spec.id,
      selector: spec.selector,
      status: !geometryPass || !appearancePass || occlusionFail ? "FAIL" : "PASS",
      geometry: {
        expected: { x: spec.x, y: spec.y, w: spec.w, h: spec.h },
        actual: a, delta, tolerance, pass: geometryPass,
      },
      appearance: { percent: Number(percent.toFixed(3)), gate, pass: appearancePass, resized, crop: file },
      occluded: info.occluded,
      interactive,
    });
  }

  const missing = rows.filter((r) => r.status === "MISSING");
  const offscreen = rows.filter((r) => r.status === "OFFSCREEN");
  const failed = rows.filter((r) => r.status === "FAIL");
  const status = missing.length || offscreen.length || failed.length ? "FAIL" : "PASS";
  const report = {
    schemaVersion: "2.0",
    reference: path.resolve(refPath), url, viewport, tolerance, gate,
    hashes: {
      reference: sha256File(refPath),
      profile: typeof flags.profile === "string" ? sha256File(flags.profile) : null,
    },
    runtime: runtimeMetadata({ browser: { name: "chromium", version: browserVersion } }),
    stability: {
      stable: stability.stable,
      attempts: stability.attempts,
      frameSha256: stability.hashes,
    },
    elements: rows, noSelector, skippedRegions, status,
  };
  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  fs.writeFileSync(path.join(outDir, "elements-report.json"), JSON.stringify(report, null, 2));

  console.log(`Элементы (${rows.length}), допуск геометрии ±${tolerance}px, порог вида ${gate}%:`);
  for (const r of rows) {
    if (r.status === "MISSING") {
      console.log(`  ${r.id} [MISSING] элемент не найден по селектору: ${r.selector}`);
      continue;
    }
    if (r.status === "OFFSCREEN") {
      console.log(
        `  ${r.id} [OFFSCREEN] элемент вне вьюпорта или нулевого размера ` +
        `(факт: x=${r.geometry.actual.x.toFixed(0)}, y=${r.geometry.actual.y.toFixed(0)}, ` +
        `w=${r.geometry.actual.w.toFixed(0)}, h=${r.geometry.actual.h.toFixed(0)}) — ` +
        `проверь layout или увеличь viewport`
      );
      continue;
    }
    const g = r.geometry;
    const gTxt = `Δx=${g.delta.dx.toFixed(0)} Δy=${g.delta.dy.toFixed(0)} Δw=${g.delta.dw.toFixed(0)} Δh=${g.delta.dh.toFixed(0)} ${g.pass ? "OK" : "СДВИГ/РАЗМЕР"}`;
    const ap = r.appearance;
    const aTxt = `${ap.percent.toFixed(2)}% ${ap.pass ? "OK" : "РАСХОЖДЕНИЕ"}${ap.resized ? " (размер нормализован)" : ""}`;
    const oTxt = r.occluded ? (r.interactive ? "ПЕРЕКРЫТ (интерактивный!)" : "перекрыт (неинтерактивный)") : "нет";
    console.log(`  ${r.id} [${r.status}] геометрия: ${gTxt}; вид: ${aTxt}; перекрытие: ${oTxt}`);
  }
  console.log(`Кропы элементов: ${outDir}${path.sep}element-*.png (образец | реализация | diff)`);
  console.log(`Отчёт: ${path.join(outDir, "elements-report.json")}`);
  console.log(
    `СТАТУС: ${status}` +
    (status === "FAIL"
      ? ` — не найдено: ${missing.length}, вне вьюпорта: ${offscreen.length}, с расхождениями: ${failed.length}`
      : "")
  );
  if (flags.ci && status === "FAIL") process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// detail-coverage: геометрическая проверка и диагностический сигнал.
// Геометрический контур проверяет, размечена ли площадь. Второй контур лишь
// показывает контрастные детали вне конечных элементов: он не распознаёт их
// назначение и поэтому не является обязательным приёмочным критерием.
// ---------------------------------------------------------------------------
function paintRegions(mask, width, height, regions) {
  for (const region of regions) {
    const x0 = Math.max(0, Math.round(region.x));
    const y0 = Math.max(0, Math.round(region.y));
    const x1 = Math.min(width, Math.round(region.x + region.w));
    const y1 = Math.min(height, Math.round(region.y + region.h));
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  }
}

function visualSignalMask(img, threshold) {
  const signal = new Uint8Array(img.width * img.height);
  const difference = (a, b) =>
    (Math.abs(img.data[a] - img.data[b]) +
      Math.abs(img.data[a + 1] - img.data[b + 1]) +
      Math.abs(img.data[a + 2] - img.data[b + 2])) / 3;
  for (let y = 0; y < img.height - 1; y++) {
    for (let x = 0; x < img.width - 1; x++) {
      const pixel = y * img.width + x;
      const rgba = pixel * 4;
      if (difference(rgba, rgba + 4) >= threshold ||
          difference(rgba, rgba + img.width * 4) >= threshold) {
        signal[pixel] = 1;
      }
    }
  }
  return signal;
}

async function cmdDetailCoverage(positional, flags) {
  const [imgPath] = positional;
  if (!imgPath || typeof flags.regions !== "string") {
    throw new Error(
      "Использование: detail-coverage <img.png> --regions <файл> [--out <mask.png>] " +
      "[--gate 2] [--signal-gate 5] [--signal-threshold 24] [--grid 8x8] " +
      "[--enforce-detail-gate] [--ci]"
    );
  }
  const geometryGate = flags.gate ? parseFloat(flags.gate) : 2;
  const signalGate = flags["signal-gate"] ? parseFloat(flags["signal-gate"]) : 5;
  const signalThreshold = flags["signal-threshold"] ? parseFloat(flags["signal-threshold"]) : 24;
  const img = readPng(imgPath);
  const raw = JSON.parse(fs.readFileSync(flags.regions, "utf8"));
  const validation = validateInventoryDocument(raw, {
    imageSize: { width: img.width, height: img.height },
    mode: flags.mode,
  });
  const legacyAllowed = flags["allow-legacy"] && Array.isArray(raw);
  const validationPass = validation.valid || legacyAllowed;
  const allCovered = new Uint8Array(img.width * img.height);
  const detailCovered = new Uint8Array(img.width * img.height);
  paintRegions(allCovered, img.width, img.height, validation.regions);
  paintRegions(detailCovered, img.width, img.height, validation.semanticLeaves);
  const signal = visualSignalMask(img, signalThreshold);

  let uncoveredCount = 0;
  let signalCount = 0;
  let missedSignalCount = 0;
  for (let i = 0; i < allCovered.length; i++) {
    if (!allCovered[i]) uncoveredCount++;
    if (signal[i]) {
      signalCount++;
      if (!detailCovered[i]) missedSignalCount++;
    }
  }
  const uncoveredPercent = (uncoveredCount / allCovered.length) * 100;
  const missedSignalPercent = signalCount === 0 ? 0 : (missedSignalCount / signalCount) * 100;

  // Красным показывается только контрастная деталь вне конечного элемента.
  // Жёлтым отмечается обычная геометрически непокрытая площадь.
  const outPath = typeof flags.out === "string" ? flags.out : path.join(DEFAULT_OUT_DIR, "detail-coverage-mask.png");
  const mask = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < allCovered.length; i++) {
    const si = i * 4;
    if (signal[i] && !detailCovered[i]) {
      mask.data[si] = 255; mask.data[si + 1] = 30; mask.data[si + 2] = 30;
    } else if (!allCovered[i]) {
      mask.data[si] = 255; mask.data[si + 1] = 190; mask.data[si + 2] = 20;
    } else {
      const v = Math.round(((img.data[si] + img.data[si + 1] + img.data[si + 2]) / 3) * 0.5);
      mask.data[si] = v; mask.data[si + 1] = v; mask.data[si + 2] = v;
    }
    mask.data[si + 3] = 255;
  }
  writePng(outPath, mask);

  // Локализация пропущенных контрастных деталей по сетке.
  const gridSpec = typeof flags.grid === "string" ? flags.grid : "8x8";
  const gm = gridSpec.match(/^(\d+)x(\d+)$/);
  if (!gm) throw new Error(`Неверный формат --grid: "${gridSpec}" (ожидается ColsxRows)`);
  const cols = parseInt(gm[1], 10);
  const rowsN = parseInt(gm[2], 10);
  const cellsOut = [];
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor((img.width * c) / cols);
      const y = Math.floor((img.height * r) / rowsN);
      const x2 = c === cols - 1 ? img.width : Math.floor((img.width * (c + 1)) / cols);
      const y2 = r === rowsN - 1 ? img.height : Math.floor((img.height * (r + 1)) / rowsN);
      let localSignal = 0;
      let missed = 0;
      for (let yy = y; yy < y2; yy++) {
        for (let xx = x; xx < x2; xx++) {
          const index = yy * img.width + xx;
          if (signal[index]) {
            localSignal++;
            if (!detailCovered[index]) missed++;
          }
        }
      }
      const pct = localSignal === 0 ? 0 : (missed / localSignal) * 100;
      if (pct > 0.5) cellsOut.push({ cell: `r${r + 1}c${c + 1}`, x, y, w: x2 - x, h: y2 - y, percent: pct });
    }
  }
  cellsOut.sort((a, b) => b.percent - a.percent);

  const failReasons = [];
  const warnings = [];
  if (!validationPass) failReasons.push("инвентарь не прошёл валидацию");
  if (uncoveredPercent >= geometryGate) failReasons.push(`геометрически не покрыто ${uncoveredPercent.toFixed(2)}%`);
  if (missedSignalPercent >= signalGate) {
    const message = `вне конечных элементов осталось ${missedSignalPercent.toFixed(2)}% контрастных деталей`;
    warnings.push(message);
    if (flags["enforce-detail-gate"]) failReasons.push(message);
  }
  const status = failReasons.length ? "FAIL" : "PASS";
  console.log(
    `Геометрическое покрытие: ${(100 - uncoveredPercent).toFixed(2)}% ` +
    `(непокрыто ${uncoveredPercent.toFixed(2)}%, порог ${geometryGate}%)`
  );
  console.log(
    `Диагностическое покрытие контрастных деталей: ${(100 - missedSignalPercent).toFixed(2)}% ` +
    `(вне элементов ${missedSignalPercent.toFixed(2)}%, ориентир ${signalGate}%, сигналов ${signalCount})`
  );
  for (const error of validation.errors) console.log(`  ОШИБКА ИНВЕНТАРЯ: ${error}`);
  for (const warning of validation.warnings) console.log(`  ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
  if (cellsOut.length) {
    console.log(`Контрастные детали вне конечных элементов (сетка ${gridSpec}, худшие сверху):`);
    for (const cc of cellsOut.slice(0, 10)) {
      console.log(`  ${cc.cell}  rect=${cc.x},${cc.y},${cc.w},${cc.h}  непокрыто ${cc.percent.toFixed(1)}%`);
    }
  }
  const reportPath = typeof flags.report === "string"
    ? flags.report
    : path.join(path.dirname(outPath), "detail-coverage-report.json");
  const report = {
    schemaVersion: "3.0",
    image: { path: path.resolve(imgPath), sha256: sha256File(imgPath), width: img.width, height: img.height },
    inventory: { path: path.resolve(flags.regions), sha256: sha256File(flags.regions) },
    runtime: runtimeMetadata(),
    geometry: { uncoveredPercent, gate: geometryGate },
    detailSignal: {
      signalCount,
      missedSignalCount,
      missedSignalPercent,
      gate: signalGate,
      threshold: signalThreshold,
      enforced: Boolean(flags["enforce-detail-gate"]),
    },
    validation: { valid: validationPass, errors: validation.errors, warnings: validation.warnings },
    cells: cellsOut,
    status,
    warnings,
    failReasons,
    mask: path.resolve(outPath),
  };
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  for (const warning of warnings) console.log(`  ДИАГНОСТИКА: ${warning}`);
  console.log(`Маска: ${outPath} (красное = контрастная деталь вне элемента; жёлтое = площадь вне любых зон)`);
  console.log(`Отчёт: ${reportPath}`);
  console.log(`СТАТУС: ${status}${failReasons.length ? " — " + failReasons.join("; ") : ""}`);
  if (flags.ci && status === "FAIL") process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// Inventory/profile contracts: these commands make the inputs inspectable and
// reproducible before an agent starts implementation.
// ---------------------------------------------------------------------------
async function cmdValidateInventory(positional, flags) {
  const [inventoryPath] = positional;
  if (!inventoryPath) {
    throw new Error("Использование: validate-inventory <inventory.json> [--image <png>] [--mode pixel-parity|style-parity] [--ci]");
  }
  const raw = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const image = typeof flags.image === "string" ? readPng(flags.image) : null;
  const result = validateInventoryDocument(raw, {
    imageSize: image ? { width: image.width, height: image.height } : undefined,
    mode: flags.mode,
  });
  console.log(`JSON Schema: ${schemaPaths().inventory}`);
  console.log(`Регионов: ${result.regions.length}; отдельных смысловых элементов: ${result.semanticLeaves.length}`);
  for (const error of result.errors) console.log(`  ОШИБКА: ${error}`);
  for (const warning of result.warnings) console.log(`  ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
  console.log(`СТАТУС: ${result.valid ? "PASS" : "FAIL"}`);
  if (flags.ci && !result.valid) process.exitCode = 2;
}

function parseViewportList(value, fallback) {
  if (!value || value === true) return [fallback];
  return String(value).split(",").map((entry) => {
    const match = entry.trim().match(/^([a-z0-9][a-z0-9-]*):(\d+)x(\d+)$/);
    if (!match) throw new Error(`Неверный viewport "${entry}"; ожидается name:WxH`);
    return { name: match[1], width: Number(match[2]), height: Number(match[3]) };
  });
}

async function cmdCreateProfile(positional, flags) {
  const [referencePath] = positional;
  if (!referencePath || typeof flags.inventory !== "string" || typeof flags.out !== "string" || !flags.mode) {
    throw new Error(
      "Использование: create-profile <reference.png> --inventory <inventory.json> " +
      "--mode pixel-parity|style-parity --out <profile.json> [--viewports desktop:1920x1080,narrow:320x800]"
    );
  }
  if (!["pixel-parity", "style-parity"].includes(flags.mode)) {
    throw new Error("--mode: ожидается pixel-parity или style-parity");
  }
  const reference = readPng(referencePath);
  const inventoryRaw = JSON.parse(fs.readFileSync(flags.inventory, "utf8"));
  const inventoryValidation = validateInventoryDocument(inventoryRaw, {
    imageSize: { width: reference.width, height: reference.height },
    mode: flags.mode,
  });
  if (!inventoryValidation.valid) {
    throw new Error(`Инвентарь не прошёл проверку:\n- ${inventoryValidation.errors.join("\n- ")}`);
  }
  const referenceSha256 = sha256File(referencePath);
  const viewports = parseViewportList(flags.viewports, {
    name: "reference",
    width: reference.width,
    height: reference.height,
  }).map((viewport) => viewport.width === reference.width && viewport.height === reference.height
    ? { ...viewport, referencePath: path.resolve(referencePath), referenceSha256 }
    : viewport);
  const profile = {
    $schema: UI_COMPARISON_PROFILE_SCHEMA_ID,
    schemaVersion: "2.0",
    mode: flags.mode,
    reference: {
      path: path.resolve(referencePath),
      sha256: referenceSha256,
      source: inventorySource(inventoryRaw),
    },
    inventory: {
      path: path.resolve(flags.inventory),
      sha256: sha256File(flags.inventory),
    },
    viewports,
    capture: {
      dpr: 1,
      colorScheme: flags["color-scheme"] || "light",
      reducedMotion: "reduce",
      locale: flags.locale || "ru-RU",
      timezoneId: flags.timezone || "Europe/Moscow",
      waitMs: flags["wait-ms"] ? Number(flags["wait-ms"]) : 800,
      stabilityFrames: 2,
      stabilityIntervalMs: flags["stability-interval-ms"]
        ? Number(flags["stability-interval-ms"])
        : 150,
      maxStabilityAttempts: flags["max-stability-attempts"]
        ? Number(flags["max-stability-attempts"])
        : 5,
      ...(flags["wait-selector"] ? { waitSelector: flags["wait-selector"] } : {}),
      ...(flags.steps ? { steps: path.resolve(flags.steps) } : {}),
    },
    compare: {
      threshold: 0.1,
      gate: flags.mode === "pixel-parity" ? 5 : 100,
      cellGate: flags.mode === "pixel-parity" ? 10 : 100,
      tolerance: flags.mode === "pixel-parity" ? 2 : 8,
      includeAA: false,
    },
    accessibility: {
      minimumTargetSize: 24,
      normalTextContrast: 4.5,
      largeTextContrast: 3,
      maxAuditedElements: 500,
    },
    tool: {
      contractVersion: UI_COMPARE_TOOL_CONTRACT_VERSION,
      captureAlgorithmVersion: UI_COMPARE_CAPTURE_ALGORITHM_VERSION,
      scriptSha256: sha256File(process.argv[1]),
      node: process.version,
      playwright: installedPackageVersion("playwright"),
      platform: process.platform,
      arch: process.arch,
    },
  };
  const validation = validateProfileDocument(profile);
  if (!validation.valid) throw new Error(`Создан неверный профиль:\n- ${validation.errors.join("\n- ")}`);
  fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
  fs.writeFileSync(flags.out, JSON.stringify(profile, null, 2));
  console.log(`OK: профиль -> ${flags.out} (${viewports.map((v) => `${v.name}:${v.width}x${v.height}`).join(", ")})`);
}

async function cmdValidateProfile(positional, flags) {
  const [profilePath] = positional;
  if (!profilePath) throw new Error("Использование: validate-profile <profile.json> [--ci]");
  const raw = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const result = validateProfileDocument(raw);
  const artifacts = validateProfileArtifacts(raw, process.argv[1]);
  const errors = [...result.errors, ...artifacts.errors];
  for (const error of errors) console.log(`  ОШИБКА: ${error}`);
  for (const warning of artifacts.warnings) console.log(`  ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
  console.log(`СТАТУС: ${errors.length ? "FAIL" : "PASS"}`);
  if (flags.ci && errors.length) process.exitCode = 2;
}

function tileDensity(signal, width, tile) {
  let count = 0;
  for (let y = tile.y; y < tile.y + tile.h; y++) {
    for (let x = tile.x; x < tile.x + tile.w; x++) count += signal[y * width + x];
  }
  return count / Math.max(1, tile.w * tile.h);
}

function overlappedTile(x, y, w, h, image, overlap) {
  const ox = Math.round(w * overlap);
  const oy = Math.round(h * overlap);
  const x0 = Math.max(0, x - ox);
  const y0 = Math.max(0, y - oy);
  const x1 = Math.min(image.width, x + w + ox);
  const y1 = Math.min(image.height, y + h + oy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function cmdScan(positional, flags) {
  const [imagePath] = positional;
  if (!imagePath || typeof flags["out-dir"] !== "string") {
    throw new Error(
      "Использование: scan <image.png> --out-dir <dir> [--target 480x360] " +
      "[--overlap 0.08] [--density 0.04] [--scale 2]"
    );
  }
  const image = readPng(imagePath);
  const target = parseViewport(flags.target, { width: 480, height: 360 });
  const overlap = flags.overlap ? Number(flags.overlap) : 0.08;
  const densityGate = flags.density ? Number(flags.density) : 0.04;
  const scale = flags.scale ? Number(flags.scale) : 2;
  const cols = Math.max(1, Math.min(8, Math.ceil(image.width / target.width)));
  const rows = Math.max(1, Math.min(8, Math.ceil(image.height / target.height)));
  const signal = visualSignalMask(image, 24);
  const baseTiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.floor(image.width * col / cols);
      const y = Math.floor(image.height * row / rows);
      const x2 = col === cols - 1 ? image.width : Math.floor(image.width * (col + 1) / cols);
      const y2 = row === rows - 1 ? image.height : Math.floor(image.height * (row + 1) / rows);
      baseTiles.push({ id: `r${row + 1}c${col + 1}`, ...overlappedTile(x, y, x2 - x, y2 - y, image, overlap) });
    }
  }
  const tiles = [];
  for (const base of baseTiles) {
    const density = tileDensity(signal, image.width, base);
    tiles.push({ ...base, level: 0, density });
    if (density < densityGate || base.w < 240 || base.h < 180) continue;
    const halfW = Math.ceil(base.w / 2);
    const halfH = Math.ceil(base.h / 2);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = base.x + col * Math.floor(base.w / 2);
        const y = base.y + row * Math.floor(base.h / 2);
        const tile = overlappedTile(x, y, Math.min(halfW, image.width - x), Math.min(halfH, image.height - y), image, overlap);
        tiles.push({
          id: `${base.id}-detail-r${row + 1}c${col + 1}`,
          ...tile,
          level: 1,
          density: tileDensity(signal, image.width, tile),
        });
      }
    }
  }
  fs.mkdirSync(flags["out-dir"], { recursive: true });
  for (const tile of tiles) {
    const output = path.join(flags["out-dir"], `${tile.id}.png`);
    writePng(output, scaleNearest(extractRegion(image, tile.x, tile.y, tile.w, tile.h), scale));
    tile.file = output;
  }
  const manifest = {
    schemaVersion: "1.0",
    source: { path: path.resolve(imagePath), sha256: sha256File(imagePath), width: image.width, height: image.height },
    settings: { target, overlap, densityGate, scale },
    tiles,
  };
  const manifestPath = path.join(flags["out-dir"], "scan-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`OK: ${tiles.length} кропов (${baseTiles.length} базовых, ${tiles.length - baseTiles.length} детальных) -> ${flags["out-dir"]}`);
  console.log(`Манифест: ${manifestPath}`);
}

async function auditPage(page, policy) {
  return page.evaluate(async ({ policy }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const parseColor = (value) => {
      const match = String(value).match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const background = (element) => {
      for (let current = element; current; current = current.parentElement) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.95) return color;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const luminance = (color) => {
      const channels = [color.r, color.g, color.b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (a, b) => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const label = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const referenced = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
        : "";
      const explicitLabels = element.labels
        ? [...element.labels].map((item) => item.textContent || "").join(" ")
        : "";
      const inputType = String(element.getAttribute("type") || "").toLowerCase();
      const valueLabel = ["button", "submit", "reset"].includes(inputType) ? element.value : "";
      return element.getAttribute("aria-label") || referenced || element.getAttribute("alt") ||
        explicitLabels || element.getAttribute("title") || valueLabel || element.innerText || "";
    };
    const selector = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const name = element.getAttribute("name");
      return name ? `${element.tagName.toLowerCase()}[name="${name}"]` : element.tagName.toLowerCase();
    };

    const issues = [];
    if (!document.documentElement.lang) {
      issues.push({ code: "document-language", severity: "warning", target: "html", message: "Не задан язык документа" });
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      issues.push({ code: "horizontal-overflow", severity: "error", target: "html", message: "Страница шире viewport" });
    }
    for (const image of [...document.images].filter(visible).slice(0, policy.maxAuditedElements)) {
      if (!image.hasAttribute("alt") && image.getAttribute("role") !== "presentation") {
        issues.push({ code: "image-alt", severity: "error", target: selector(image), message: "У изображения нет alt" });
      }
    }
    const interactive = [...document.querySelectorAll(
      'a[href],button,input:not([type="hidden"]),select,textarea,' +
      '[role="button"],[role="link"],[role="checkbox"],[role="radio"],' +
      '[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[tabindex]'
    )].filter(visible).slice(0, policy.maxAuditedElements);
    for (const element of interactive) {
      const target = selector(element);
      if (!label(element).trim()) {
        issues.push({ code: "accessible-name", severity: "error", target, message: "У элемента управления нет доступного имени" });
      }
      const rect = element.getBoundingClientRect();
      if (!element.disabled && (rect.width < policy.minimumTargetSize || rect.height < policy.minimumTargetSize)) {
        issues.push({
          code: "target-size", severity: "error", target,
          message: `Область ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} меньше ${policy.minimumTargetSize}px`,
        });
      }
      if (!element.disabled && element.tabIndex < 0) {
        issues.push({ code: "keyboard-focus", severity: "error", target, message: "Элемент управления недоступен с клавиатуры" });
      } else if (!element.disabled) {
        element.focus();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const style = getComputedStyle(element);
        const visibleFocus = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none";
        if (!visibleFocus) {
          issues.push({ code: "focus-visible", severity: "error", target, message: "Не обнаружен видимый индикатор фокуса" });
        }
      }
    }
    const textElements = [...document.querySelectorAll("body *")]
      .filter((element) => visible(element) && [...element.childNodes].some((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      ))
      .slice(0, policy.maxAuditedElements);
    for (const element of textElements) {
      const style = getComputedStyle(element);
      const foreground = parseColor(style.color);
      if (foreground && foreground.a > 0.95 && !style.backgroundImage.includes("gradient")) {
        const ratio = contrast(foreground, background(element));
        const fontSize = parseFloat(style.fontSize);
        const weight = Number(style.fontWeight) || 400;
        const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
        const required = large ? policy.largeTextContrast : policy.normalTextContrast;
        if (ratio + 0.01 < required) {
          issues.push({
            code: "text-contrast", severity: "error", target: selector(element),
            message: `Контраст ${ratio.toFixed(2)} ниже ${required}`,
          });
        }
      }
      const clipsX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      const clipsY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      if (clipsX || clipsY) {
        issues.push({ code: "text-overflow", severity: "error", target: selector(element), message: "Текст обрезан контейнером" });
      }
    }
    document.activeElement?.blur();
    return {
      audited: { controls: interactive.length, textElements: textElements.length, images: document.images.length },
      issues,
    };
  }, { policy });
}

async function cmdAudit(positional, flags) {
  const [url] = positional;
  if (!url) throw new Error("Использование: audit <url> [--profile <profile.json>] [--viewport WxH|--viewport-name <name>] [--out <report.json>] [--ci]");
  const profile = readProfile(flags);
  const viewport = profileViewport(profile, flags, { width: 1280, height: 720 });
  const capture = captureSettings(profile, flags);
  const policy = profile?.accessibility || {
    minimumTargetSize: 24,
    normalTextContrast: 4.5,
    largeTextContrast: 3,
    maxAuditedElements: 500,
  };
  const { chromium } = await loadDep("playwright", "index.mjs");
  const browser = await chromium.launch({ headless: true });
  let result;
  let ariaSnapshot = null;
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: capture.colorScheme,
      reducedMotion: "reduce",
      locale: capture.locale,
      timezoneId: capture.timezoneId,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (capture.waitSelector) await page.waitForSelector(capture.waitSelector, { timeout: 30000 });
    const readiness = await preparePage(page, flags, capture);
    await page.waitForTimeout(capture.waitMs);
    result = await auditPage(page, policy);
    ariaSnapshot = await page.locator("body").ariaSnapshot().catch(() => null);
    result.readiness = readiness;
    result.browser = { name: "chromium", version: browser.version() };
  } finally {
    await browser.close();
  }
  const failures = result.issues.filter((issue) => issue.severity === "error");
  const status = failures.length ? "FAIL" : "PASS";
  const outPath = typeof flags.out === "string" ? flags.out : path.join(DEFAULT_OUT_DIR, "accessibility-report.json");
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    schemaVersion: "1.0",
    url,
    viewport,
    policy,
    runtime: runtimeMetadata({ browser: result.browser }),
    ...result,
    ariaSnapshot,
    status,
  }, null, 2));
  for (const issue of result.issues) {
    console.log(`  ${issue.severity === "error" ? "ОШИБКА" : "ПРЕДУПРЕЖДЕНИЕ"} ${issue.code} ${issue.target}: ${issue.message}`);
  }
  console.log(`Отчёт доступности и компоновки: ${outPath}`);
  console.log(`СТАТУС: ${status}`);
  if (flags.ci && status === "FAIL") process.exitCode = 2;
}

async function cmdCaptureMatrix(positional, flags) {
  const [url] = positional;
  if (!url || typeof flags.profile !== "string") {
    throw new Error("Использование: capture-matrix <url> --profile <profile.json> [--out-dir <dir>] [--ci]");
  }
  const profile = readAndValidateProfile(flags.profile, process.argv[1]);
  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : path.join(DEFAULT_OUT_DIR, "matrix");
  const runs = [];
  for (const viewport of profile.viewports) {
    const viewportDir = path.join(outDir, viewport.name);
    const screenshot = path.join(viewportDir, "implementation.png");
    const auditReport = path.join(viewportDir, "accessibility-report.json");
    await cmdCapture([url], { ...flags, out: screenshot, "viewport-name": viewport.name });
    await cmdAudit([url], { ...flags, out: auditReport, "viewport-name": viewport.name });
    const audit = JSON.parse(fs.readFileSync(auditReport, "utf8"));
    let comparison = null;
    if (viewport.referencePath) {
      const compareDir = path.join(viewportDir, "comparison");
      await cmdCompare([viewport.referencePath, screenshot], {
        "out-dir": compareDir,
        regions: profile.inventory.path,
        threshold: String(profile.compare.threshold),
        gate: String(profile.compare.gate),
        "cell-gate": String(profile.compare.cellGate),
        ...(profile.compare.includeAA ? { "include-aa": true } : {}),
      });
      comparison = JSON.parse(fs.readFileSync(path.join(compareDir, "report.json"), "utf8"));
    }
    runs.push({
      viewport,
      screenshot,
      captureMetadata: `${screenshot}.json`,
      audit: { report: auditReport, status: audit.status },
      comparison: comparison ? { report: path.join(viewportDir, "comparison/report.json"), status: comparison.status } : null,
      status: audit.status === "PASS" && (!comparison || comparison.status === "PASS") ? "PASS" : "FAIL",
    });
  }
  const status = runs.every((run) => run.status === "PASS") ? "PASS" : "FAIL";
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "matrix-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: "1.0",
    url,
    profile: { path: path.resolve(flags.profile), sha256: sha256File(flags.profile) },
    runtime: runtimeMetadata(),
    runs,
    status,
  }, null, 2));
  console.log(`Матрица: ${runs.map((run) => `${run.viewport.name}=${run.status}`).join(", ")}`);
  console.log(`Отчёт: ${reportPath}`);
  console.log(`СТАТУС: ${status}`);
  if (flags.ci && status === "FAIL") process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// crop: вырезать зону изображения (с опциональным увеличением) для детального
// просмотра. Смотреть кропы вместо полного кадра — принципиально: полный кадр
// при попадании в контекст модели уменьшается и мелкие различия исчезают.
// ---------------------------------------------------------------------------
async function cmdCrop(positional, flags) {
  const [input] = positional;
  if (!input || !flags.rect || !flags.out) {
    throw new Error("Использование: crop <img.png> --rect x,y,w,h --out <png> [--scale N]");
  }
  const rect = parseRect(flags.rect);
  const scale = flags.scale ? parseInt(flags.scale, 10) : 1;
  const png = readPng(input);
  const cropped = scaleNearest(extractRegion(png, rect.x, rect.y, rect.w, rect.h), scale);
  writePng(flags.out, cropped);
  console.log(`OK: ${input} rect=${flags.rect} scale=${scale} -> ${flags.out} (${cropped.width}x${cropped.height})`);
}

// ---------------------------------------------------------------------------
// sample: точные цвета пикселей. Модели систематически ошибаются в оценке
// оттенка/насыщенности «на глаз», поэтому цвета берём только программно.
// --points — точные точки; --rect — среднее по зоне + доминирующие цвета
// (усреднение сглаживает шум JPEG-артефактов на макетах).
// ---------------------------------------------------------------------------
async function cmdSample(positional, flags) {
  const [input] = positional;
  if (!input || (!flags.points && !flags.rect)) {
    throw new Error('Использование: sample <img.png> --points "x,y;x,y" | --rect x,y,w,h [--top 6]');
  }
  const png = readPng(input);

  if (flags.points) {
    for (const pt of String(flags.points).split(";")) {
      const [x, y] = pt.split(",").map((v) => parseInt(v.trim(), 10));
      if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x >= png.width || y >= png.height) {
        console.log(`(${pt}): вне границ изображения ${png.width}x${png.height}`);
        continue;
      }
      const i = (y * png.width + x) * 4;
      console.log(`(${x},${y}): ${hex(png.data[i], png.data[i + 1], png.data[i + 2])} rgb(${png.data[i]},${png.data[i + 1]},${png.data[i + 2]})`);
    }
    return;
  }

  const rect = parseRect(flags.rect);
  const region = extractRegion(png, rect.x, rect.y, rect.w, rect.h);
  const top = flags.top ? parseInt(flags.top, 10) : 6;
  let sr = 0, sg = 0, sb = 0;
  // Квантование каналов до 32 уровней группирует близкие оттенки, иначе из-за
  // шума сжатия каждый пиксель был бы «уникальным» цветом.
  const buckets = new Map();
  const total = region.width * region.height;
  for (let i = 0; i < region.data.length; i += 4) {
    const r = region.data[i], g = region.data[i + 1], b = region.data[i + 2];
    sr += r; sg += g; sb += b;
    const key = `${r >> 3},${g >> 3},${b >> 3}`;
    const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const avg = hex(Math.round(sr / total), Math.round(sg / total), Math.round(sb / total));
  console.log(`Зона ${rect.x},${rect.y},${rect.w},${rect.h} (${total} px)`);
  console.log(`Средний цвет: ${avg}`);
  console.log(`Доминирующие цвета:`);
  [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, top)
    .forEach((bk) => {
      const c = hex(Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n));
      console.log(`  ${c}  ${(100 * bk.n / total).toFixed(1)}%`);
    });
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------
function usage() {
  console.log(`ui-visual-tool — детерминированное сравнение UI с образцом.

Команды:
  to-png  <image> --out <png> [--width N]
  capture <url> --out <png> [--profile <profile.json>] [--viewport-name <name>]
          [--viewport WxH] [--dpr N] [--wait-selector <css>]
          [--wait-ms N] [--element <css>] [--full-page] [--steps <steps.json>]
          [--no-freeze] [--stability-interval-ms 150] [--max-stability-attempts 5]
          [--allow-unstable]
          --steps — сценарий достижения состояния: JSON-массив шагов
          {"click":"css"} | {"waitSelector":"css"} | {"wait":ms} |
          {"fill":{"selector":"css","value":"..."}}.
          Анимации замораживаются по умолчанию (--no-freeze отключает).
  compare <reference.png> <implementation.png> [--profile <profile.json>]
          [--out-dir D] [--threshold 0.1]
          [--grid 4x4] [--regions <файл>] [--gate 5] [--cell-gate 10]
          [--include-aa] [--no-crops] [--ci]
          --regions принимает простой массив [{id,x,y,w,h}] или *.design.json
          (ADR-016); для проблемных зон автоматически пишутся кропы
          «образец|реализация|diff». --ci: код выхода 2 при FAIL.
  compare-elements <reference.png> <url> --regions <файл> [--selectors <map.json>]
          [--viewport WxH] [--tolerance 2] [--gate 10] [--threshold 0.1]
          [--wait-selector <css>] [--wait-ms N] [--out-dir D]
          [--steps <steps.json>] [--no-freeze] [--include-aa] [--ci]
          Двухуровневая проверка по элементам с селекторами: геометрия
          (bounds разметки против getBoundingClientRect, «не там»), внешний
          вид (кропы с нормализацией размера, «не такой»), перекрытие
          (elementFromPoint), статусы MISSING/OFFSCREEN. Всегда DPR=1.
          Селектор — поле selector в разметке или карта --selectors {"id":"css"}.
  validate-inventory <inventory.json> [--image <png>]
          [--mode pixel-parity|style-parity] [--ci]
          JSON Schema, уникальность id, границы, слои, перекрытия,
          доминирующие зоны и права использования образца.
  create-profile <reference.png> --inventory <inventory.json>
          --mode pixel-parity|style-parity --out <profile.json>
          [--viewports desktop:1920x1080,narrow:320x800]
  validate-profile <profile.json> [--ci]
          Проверяет схему, входы, версии контракта, алгоритма и браузерной среды.
  scan <image.png> --out-dir <dir> [--target 480x360] [--overlap 0.08]
          [--density 0.04] [--scale 2]
          Адаптивная сетка: плотные базовые зоны автоматически детализируются.
  detail-coverage <img.png> --regions <файл> [--out <mask.png>] [--gate 2]
          [--signal-gate 5] [--signal-threshold 24] [--grid 8x8]
          [--enforce-detail-gate] [--ci]
          Геометрическое покрытие и диагностическая карта контрастных деталей.
          Детали блокируют CI только с явным --enforce-detail-gate.
  audit <url> [--profile <profile.json>] [--viewport-name <name>]
          [--viewport WxH] [--out <report.json>] [--ci]
          Проверяет имена элементов, клавиатуру, фокус, контраст, размеры
          целей, alt, обрезание текста и горизонтальное переполнение.
  capture-matrix <url> --profile <profile.json> [--out-dir <dir>] [--ci]
          Снимок, аудит и доступное сравнение для каждого viewport профиля.
  crop    <img.png> --rect x,y,w,h --out <png> [--scale N]
  sample  <img.png> --points "x,y;x,y" | --rect x,y,w,h [--top 6]

Подробности: SKILL.md в каталоге навыка ui-compare (рядом с этим скриптом).`);
}

const [, , command, ...rest] = process.argv;
const { positional, flags } = parseArgs(rest);
const commands = {
  "to-png": cmdToPng,
  capture: cmdCapture,
  compare: cmdCompare,
  "compare-elements": cmdCompareElements,
  "validate-inventory": cmdValidateInventory,
  "create-profile": cmdCreateProfile,
  "validate-profile": cmdValidateProfile,
  scan: cmdScan,
  "detail-coverage": cmdDetailCoverage,
  // Deprecated compatibility alias. Documentation uses detail-coverage so an
  // agent cannot mistake this image signal for semantic understanding.
  coverage: cmdDetailCoverage,
  audit: cmdAudit,
  "capture-matrix": cmdCaptureMatrix,
  crop: cmdCrop,
  sample: cmdSample,
};

if (!command || !commands[command]) {
  usage();
  process.exit(command ? 1 : 0);
}
commands[command](positional, flags).catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
