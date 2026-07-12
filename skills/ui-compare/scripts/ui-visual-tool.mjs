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
 *   coverage <img.png> --regions <файл>             полнота разметки: доля площади вне зон
 *   crop    <img.png> --rect x,y,w,h --out <png>    вырезать зону (с увеличением --scale)
 *   sample  <img.png> --points "x,y;..."|--rect ... точные цвета пикселей/зоны
 *
 * Зависимости берутся из node_modules корня репозитория (playwright, pixelmatch,
 * pngjs уже объявлены в корневом package.json) — запускать из корня репозитория:
 *   node .claude/skills/ui-compare/scripts/ui-visual-tool.mjs <команда> ...
 *
 * Все артефакты по умолчанию пишутся в .tmp/ui-compare/ (правило проекта:
 * временные файлы живут в .tmp/ и не коммитятся).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
        `  npm install --no-save pngjs pixelmatch playwright\n` +
        `и запускай инструмент из корня проекта.`
      );
      process.exit(1);
    }
  }
}

const { PNG } = await loadDep("pngjs", "lib/png.js");
const pixelmatch = (await loadDep("pixelmatch", "index.js")).default;
// Playwright загружается лениво внутри команд, которым нужен браузер (см. loadDep).

// Фактический путь запуска этого скрипта — для подсказок с готовыми командами
// (навык может лежать не в .claude/skills, путь нельзя жёстко зашивать).
const SELF = path.relative(process.cwd(), process.argv[1]) || path.basename(process.argv[1]);

const DEFAULT_OUT_DIR = path.join(".tmp", "ui-compare");

// ---------------------------------------------------------------------------
// Разбор аргументов командной строки (без внешних библиотек, чтобы не тянуть
// лишние зависимости: --flag value и --flag без значения → true).
// Булевы флаги перечислены явно: иначе флаг, стоящий перед позиционным
// аргументом, «съедал» бы его как своё значение (--full-page <url> → url
// пропадал бы).
// ---------------------------------------------------------------------------
const BOOLEAN_FLAGS = new Set(["full-page", "include-aa", "no-crops", "no-freeze", "ci"]);

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

// Приводит файл регионов к плоскому списку {id,x,y,w,h}. Принимает два формата:
// 1) простой массив [{id,x,y,w,h}];
// 2) *.design.json по ADR-016: зоны в regions[].bounds{x,y,width,height} и
//    вложенные элементы в regions[].elements[].bounds — так разметка макета
//    из инвентаризации напрямую служит спецификацией сравнения.
// Зоны без bounds допустимы в design.json — они пропускаются и перечисляются
// в skipped, чтобы пропуск был виден, а не молчалив.
function flattenRegionSpec(raw, skipped) {
  if (Array.isArray(raw)) return raw;
  const flat = [];
  for (const region of raw.regions || []) {
    if (region.bounds) {
      flat.push({
        id: region.id,
        x: region.bounds.x, y: region.bounds.y,
        w: region.bounds.width, h: region.bounds.height,
        // selector — необязательное расширение design.json (схема ADR-016
        // допускает дополнительные поля): CSS-селектор соответствующего
        // DOM-элемента для двухуровневой проверки compare-elements.
        selector: region.selector,
        type: region.type,
      });
    } else {
      skipped.push(region.id);
    }
    for (const el of region.elements || []) {
      const id = `${region.id}/${el.id}`;
      if (el.bounds) {
        flat.push({
          id,
          x: el.bounds.x, y: el.bounds.y, w: el.bounds.width, h: el.bounds.height,
          selector: el.selector,
          type: el.type,
        });
      } else {
        skipped.push(id);
      }
    }
  }
  return flat;
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

async function preparePage(page, flags) {
  if (typeof flags.steps === "string") {
    console.log("Сценарий достижения состояния:");
    await runSteps(page, flags.steps);
  }
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  if (!flags["no-freeze"]) {
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;" +
        "caret-color:transparent!important;scroll-behavior:auto!important}",
    }).catch(() => {});
  }
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
  const viewport = parseViewport(flags.viewport);
  const dpr = flags.dpr ? parseFloat(flags.dpr) : 1;
  const waitMs = flags["wait-ms"] ? parseInt(flags["wait-ms"], 10) : 800;

  const { chromium } = await loadDep("playwright", "index.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (flags["wait-selector"]) {
      await page.waitForSelector(flags["wait-selector"], { timeout: 30000 });
    }
    await preparePage(page, flags);
    // Небольшая пауза после подготовки: даём завершиться перерисовке.
    await page.waitForTimeout(waitMs);
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    if (flags.element) {
      await page.locator(flags.element).first().screenshot({ path: flags.out });
    } else {
      await page.screenshot({ path: flags.out, fullPage: Boolean(flags["full-page"]) });
    }
    console.log(`OK: ${url} -> ${flags.out} (viewport ${viewport.width}x${viewport.height}, dpr ${dpr})`);
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
  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : DEFAULT_OUT_DIR;
  const threshold = flags.threshold ? parseFloat(flags.threshold) : 0.1;
  const gate = flags.gate ? parseFloat(flags.gate) : 5;
  // Отдельный порог на ячейку/регион: локальный дефект (пропавшая кнопка ~25%
  // в своей ячейке) «разбавляется» площадью кадра до 2-3% и проходит общий
  // порог. Поэтому FAIL ставится и при превышении порога любой ячейкой.
  const cellGate = flags["cell-gate"] ? parseFloat(flags["cell-gate"]) : 10;
  // includeAA=true заставляет считать антиалиасинг (сглаживание краёв текста)
  // различием. По умолчанию выключено: шрифтовый шум маскирует реальные дефекты.
  const options = { threshold, includeAA: Boolean(flags["include-aa"]) };

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
  if (totalPercent >= gate) failReasons.push(`общий diff ${totalPercent.toFixed(2)}% >= ${gate}%`);
  if (failedCells.length) failReasons.push(`ячейки выше порога ${cellGate}%: ${failedCells.map((c) => c.cell).join(", ")}`);
  if (failedRegions.length) failReasons.push(`регионы выше порога ${cellGate}%: ${failedRegions.map((r) => r.id).join(", ")}`);
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
    reference: path.resolve(refPath),
    implementation: path.resolve(implPath),
    comparedSize: { width: w, height: h },
    sizeMismatch,
    options: { threshold, includeAA: options.includeAA, gate, cellGate },
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
  // DPR всегда 1: координаты разметки заданы в пикселях изображения-образца,
  // getBoundingClientRect возвращает CSS-пиксели, а скриншот при DPR=2 был бы
  // в физических пикселях — смешение масштабов дало бы кропы не тех областей.
  if (flags.dpr && parseFloat(flags.dpr) !== 1) {
    console.warn("ВНИМАНИЕ: compare-elements всегда работает при DPR=1; --dpr проигнорирован.");
  }
  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : DEFAULT_OUT_DIR;
  // Допуск геометрии в пикселях: субпиксельные округления браузера дают ±1px,
  // всё сверх допуска — реальный сдвиг или неверный размер.
  const tolerance = flags.tolerance ? parseFloat(flags.tolerance) : 2;
  const gate = flags.gate ? parseFloat(flags.gate) : 10;
  const options = {
    threshold: flags.threshold ? parseFloat(flags.threshold) : 0.1,
    includeAA: Boolean(flags["include-aa"]),
  };
  const waitMs = flags["wait-ms"] ? parseInt(flags["wait-ms"], 10) : 800;

  const ref = readPng(refPath);
  // Viewport по умолчанию равен размеру образца: иначе фактические координаты
  // элементов заведомо не совпадут с разметкой.
  const viewport = parseViewport(flags.viewport, { width: ref.width, height: ref.height });

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
  let shot;
  const probes = [];
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (flags["wait-selector"]) await page.waitForSelector(flags["wait-selector"], { timeout: 30000 });
    await preparePage(page, flags);
    await page.waitForTimeout(waitMs);
    shot = PNG.sync.read(await page.screenshot());

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
    reference: path.resolve(refPath), url, viewport, tolerance, gate,
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
// coverage: числовая проверка полноты разметки/инвентаря макета.
// Зачем: главный источник ошибок при верстке по образцу — ПРОПУЩЕННЫЕ
// элементы; полагаться на внимательность модели нельзя. Команда считает долю
// площади изображения, не покрытую ни одной зоной разметки, и пишет маску,
// где непокрытые места залиты красным: пропущенная кнопка видна как яркое
// пятно и как число, а не как надежда на дисциплину.
// Фон и декор тоже должны быть зонами (хотя бы одной общей "background").
// ---------------------------------------------------------------------------
async function cmdCoverage(positional, flags) {
  const [imgPath] = positional;
  if (!imgPath || typeof flags.regions !== "string") {
    throw new Error(
      "Использование: coverage <img.png> --regions <файл> [--out <mask.png>] " +
      "[--gate 2] [--grid 8x8] [--ci]"
    );
  }
  const gate = flags.gate ? parseFloat(flags.gate) : 2;
  const img = readPng(imgPath);
  const skipped = [];
  const raw = JSON.parse(fs.readFileSync(flags.regions, "utf8"));
  const specs = flattenRegionSpec(raw, skipped);
  if (skipped.length) console.warn(`ВНИМАНИЕ: зоны без bounds пропущены: ${skipped.join(", ")}`);
  if (!specs.length) throw new Error("В файле разметки нет ни одной зоны с bounds");

  // Маска покрытия: 1 = пиксель принадлежит хотя бы одной зоне разметки.
  const covered = new Uint8Array(img.width * img.height);
  for (const s of specs) {
    const x0 = Math.max(0, Math.round(s.x));
    const y0 = Math.max(0, Math.round(s.y));
    const x1 = Math.min(img.width, Math.round(s.x + s.w));
    const y1 = Math.min(img.height, Math.round(s.y + s.h));
    for (let y = y0; y < y1; y++) {
      covered.fill(1, y * img.width + x0, y * img.width + x1);
    }
  }
  let uncoveredCount = 0;
  for (let i = 0; i < covered.length; i++) if (!covered[i]) uncoveredCount++;
  const uncoveredPercent = (uncoveredCount / covered.length) * 100;

  // Маска: покрытое — приглушённый серый, непокрытое — красный.
  const outPath = typeof flags.out === "string" ? flags.out : path.join(DEFAULT_OUT_DIR, "coverage-mask.png");
  const mask = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < covered.length; i++) {
    const si = i * 4;
    if (covered[i]) {
      const v = Math.round(((img.data[si] + img.data[si + 1] + img.data[si + 2]) / 3) * 0.5);
      mask.data[si] = v; mask.data[si + 1] = v; mask.data[si + 2] = v;
    } else {
      mask.data[si] = 255; mask.data[si + 1] = 40; mask.data[si + 2] = 40;
    }
    mask.data[si + 3] = 255;
  }
  writePng(outPath, mask);

  // Локализация непокрытых мест по сетке — чтобы агент знал, куда смотреть.
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
      let un = 0;
      for (let yy = y; yy < y2; yy++) {
        for (let xx = x; xx < x2; xx++) if (!covered[yy * img.width + xx]) un++;
      }
      const pct = (un / ((x2 - x) * (y2 - y))) * 100;
      if (pct > 0.5) cellsOut.push({ cell: `r${r + 1}c${c + 1}`, x, y, w: x2 - x, h: y2 - y, percent: pct });
    }
  }
  cellsOut.sort((a, b) => b.percent - a.percent);

  const status = uncoveredPercent < gate ? "PASS" : "FAIL";
  console.log(
    `Покрытие разметкой: ${(100 - uncoveredPercent).toFixed(2)}% ` +
    `(непокрыто ${uncoveredPercent.toFixed(2)}%, порог ${gate}%)`
  );
  if (cellsOut.length) {
    console.log(`Непокрытые области (сетка ${gridSpec}, худшие сверху):`);
    for (const cc of cellsOut.slice(0, 10)) {
      console.log(`  ${cc.cell}  rect=${cc.x},${cc.y},${cc.w},${cc.h}  непокрыто ${cc.percent.toFixed(1)}%`);
    }
  }
  console.log(`Маска: ${outPath} (красное = вне зон разметки)`);
  console.log(`СТАТУС: ${status}`);
  if (status === "FAIL") {
    console.log(
      "Красные области — кандидаты в пропущенные элементы: рассмотри их кропами " +
      "и добавь зоны в разметку (фон/декор — тоже зоны)."
    );
  }
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
  capture <url> --out <png> [--viewport WxH] [--dpr N] [--wait-selector <css>]
          [--wait-ms N] [--element <css>] [--full-page] [--steps <steps.json>]
          [--no-freeze]
          --steps — сценарий достижения состояния: JSON-массив шагов
          {"click":"css"} | {"waitSelector":"css"} | {"wait":ms} |
          {"fill":{"selector":"css","value":"..."}}.
          Анимации замораживаются по умолчанию (--no-freeze отключает).
  compare <reference.png> <implementation.png> [--out-dir D] [--threshold 0.1]
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
  coverage <img.png> --regions <файл> [--out <mask.png>] [--gate 2] [--grid 8x8] [--ci]
          Полнота разметки: % площади вне зон + маска (красное = непокрыто).
          Непокрытые области — кандидаты в пропущенные элементы.
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
  coverage: cmdCoverage,
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
