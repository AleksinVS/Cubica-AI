#!/usr/bin/env node
/**
 * Извлечь из авторского растра карты («Игровая Карта.png») пиксельные пятна
 * тёмно-коричневой местности — той самой территории, на которой продюсер
 * запретил строить дороги (см. games/cards-money-trains/annotations/README.md,
 * раздел «Непроходимая местность и река»).
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ (для новичка в проекте)
 * ----------------------------------------
 * Карта — растровая картинка, а не вектор: у нас нет отдельного слоя «вот тут
 * гора, а тут вода». Единственный способ найти нарисованную художником
 * местность — искать пиксели её цвета. Проблема в том, что ТЕМ ЖЕ САМЫМ
 * цветом на карте нарисованы: (1) обводки государственных границ, (2) рамка
 * листа, заголовок карты, роза ветров и легенда. Их нужно исключить, не
 * нарисовав ни одной новой границы вручную:
 *
 *   1. Обводки границ — это ТОНКИЕ линии (измеренная толщина 6.970 точки).
 *      Местность — это ШИРОКИЕ пятна. Стачивание маски на 5 точек (эрозия)
 *      стирает линию целиком, но не касается пятна шире её; последующее
 *      наращивание на те же 5 точек (дилатация) возвращает пятну исходный
 *      размер. Эта пара операций — «раскрытие» (opening) — стандартный приём
 *      морфологической обработки изображений: убрать тонкое, оставить толстое.
 *   2. Декорация (заголовок, роза, легенда, рамка) отделяется не здесь, а
 *      позже, в Python-части конвейера (`cmt_impassable_terrain.py`), потому
 *      что признак «пятно лежит внутри разбиения карты на области» требует
 *      геометрии областей (полигонов), а этот файл работает только с
 *      растром. Здесь пятна просто перечисляются — все, без разбора.
 *
 * Отдельно этот файл находит СЫРОЕ (нераскрытое) пятно рядом с двумя озёрами
 * — оно и есть «озёра плюс река между ними»: река тоньше эрозии на 5 точек и
 * потому пропадает при раскрытии, но остаётся в сыром цветовом тесте. Из
 * этого сырого пятна Python-часть конвейера вычитает уже найденные пятна
 * озёр и по расстоянию до границы области отделяет реку (см. README).
 *
 * ПОЧЕМУ СТРУКТУРНЫЙ ЭЛЕМЕНТ — «РОМБ», А НЕ КРУГ
 * ------------------------------------------------
 * Правильная эрозия/дилатация диском радиуса 5 точек была бы точнее по форме,
 * но дороже: диск радиуса 5 — это 81 смещение растра на проход. Здесь
 * используется приближение: пятикратное применение эрозии/дилатации
 * крестом 3×3 (получаетcz эрозия/дилатация ромбом — L1-шаром радиуса 5).
 * Approximation оправдана измерением, а не удобством: этот же приём уже
 * применялся при первичном обследовании карты и дал ровно те же числа,
 * что и в задании продюсера (35 пятен местности площадью не менее 300 px²,
 * из которых один — площадью 407 px² у (2462, 941) — пересечён дорогой
 * road-6-7 и намеренно оставлен проходимым). Смена структурного элемента
 * изменила бы эти числа и разошлась бы с уже принятым решением продюсера,
 * поэтому она недопустима без нового измерения и пересмотра решения.
 *
 * Формат вывода — построчное RLE (run-length encoding: вместо списка всех
 * пикселей пятна хранится, для каждой занятой строки y, список полуоткрытых
 * интервалов [x0,x1) занятых столбцов). Для сплошных пятен это на два-три
 * порядка компактнее, чем координаты каждого пикселя, и восстанавливается
 * обратно без потерь.
 *
 * Usage:
 *   node games/cards-money-trains/tools/extract-impassable-terrain-raster.mjs
 *   node games/cards-money-trains/tools/extract-impassable-terrain-raster.mjs --check
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "../../../node_modules/sharp/lib/index.js";

const moduleFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(moduleFile);
const repoRoot = path.resolve(toolsDirectory, "..", "..", "..");
const annotationsDirectory = path.resolve(toolsDirectory, "..", "annotations");

const SOURCE_IMAGE_PATH = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");
const OUTPUT_PATH = path.join(annotationsDirectory, "impassable-terrain.raster.json");

// --- Измеренные постоянные величины (см. докстринг выше и README) ----------

/** Проба цвета местности, снятая с карты в точке (3650, 2300). Не подобрана — измерена. */
const TERRAIN_COLOR = [139, 111, 89];
const TERRAIN_SAMPLE_POINT = { x: 3650, y: 2300 };
/** Допуск на канал: наибольшее отличие каждого из R/G/B от пробы, при котором пиксель ещё считается местностью. */
const COLOR_TOLERANCE = 12;
/** Радиус эрозии/дилатации в точках карты — измеренная толщина обводки границы (6.970) с запасом. */
const OPENING_RADIUS_PX = 5;
/** Ниже этой площади в точках карты в квадрате раскрытое пятно не может быть настоящей местностью (см. README). */
const MIN_PATCH_AREA_PX2 = 300;
/** Опорные точки двух озёр в районе новой реки (см. задание продюсера). Нужны только чтобы найти сырое пятно «озёра+река». */
const LAKE_SEED_POINTS = [
  { x: 1336, y: 1426 },
  { x: 1421, y: 1633 }
];
/**
 * Окно поиска сырого пятна «озёра+река». Устойчивость его границ к размеру
 * этого окна проверена отдельно (при окне 1800×950 и при 2200×1500 получено
 * ровно то же пятно, 11274 px, с тем же прямоугольником x[1285,1566]
 * y[1302,1662]) — то есть пятно целиком помещается внутри окна и не обрезано
 * им, а размер окна выбран только ради скорости (не гонять эрозию по всей
 * карте 5079×3627 ради одного локального пятна).
 */
const LAKES_WINDOW = { minX: 1000, minY: 1000, maxX: 3200, maxY: 2500 };

const fail = (message) => { throw new Error(message); };

const sha256File = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");

/** Эрозия/дилатация ромбом (L1-шаром) радиуса `radius` через `radius` проходов креста 3×3. */
const morphologyPass = (mask, width, height, radius, mode) => {
  let current = mask;
  for (let step = 0; step < radius; step += 1) {
    const next = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      const rowBase = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const p = rowBase + x;
        const neighbourSum = current[p] + current[p - 1] + current[p + 1] + current[p - width] + current[p + width];
        next[p] = mode === "erode" ? (neighbourSum === 5 ? 1 : 0) : (neighbourSum > 0 ? 1 : 0);
      }
    }
    current = next;
  }
  return current;
};

/** Связные компоненты (4-связность) булевой маски внутри прямоугольного окна, стек-обход без рекурсии. */
const labelComponents = (mask, width, height, window) => {
  const { minX, minY, maxX, maxY } = window;
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = new Int32Array(width * height);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const seed = y * width + x;
      if (!mask[seed] || labels[seed] !== -1) continue;
      let top = 0;
      stack[top++] = seed;
      labels[seed] = components.length;
      const pixels = [];
      while (top > 0) {
        const p = stack[--top];
        pixels.push(p);
        const px = p % width;
        const py = (p / width) | 0;
        const neighbours = [p - 1, p + 1, p - width, p + width];
        const neighbourCoords = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
        for (let k = 0; k < 4; k += 1) {
          const [nx, ny] = neighbourCoords[k];
          if (nx < minX || nx >= maxX || ny < minY || ny >= maxY) continue;
          const np = neighbours[k];
          if (mask[np] && labels[np] === -1) {
            labels[np] = components.length;
            stack[top++] = np;
          }
        }
      }
      components.push(pixels);
    }
  }
  return { labels, components };
};

/** Превратить плоский список индексов пикселей в построчное RLE ([y, [x0,x1, x2,x3, ...]] на строку). */
const toRowRuns = (pixelIndices, width) => {
  const byRow = new Map();
  for (const p of pixelIndices) {
    const x = p % width;
    const y = (p / width) | 0;
    if (!byRow.has(y)) byRow.set(y, []);
    byRow.get(y).push(x);
  }
  const rows = [];
  for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
    const xs = byRow.get(y).sort((a, b) => a - b);
    const runs = [];
    let runStart = xs[0];
    let runEnd = xs[0] + 1;
    for (let i = 1; i < xs.length; i += 1) {
      if (xs[i] === runEnd) { runEnd = xs[i] + 1; continue; }
      runs.push(runStart, runEnd);
      runStart = xs[i];
      runEnd = xs[i] + 1;
    }
    runs.push(runStart, runEnd);
    rows.push([y, runs]);
  }
  return rows;
};

const boundsOf = (pixelIndices, width) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pixelIndices) {
    const x = p % width;
    const y = (p / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

const centroidOf = (pixelIndices, width) => {
  let sx = 0, sy = 0;
  for (const p of pixelIndices) {
    sx += p % width;
    sy += (p / width) | 0;
  }
  return { x: sx / pixelIndices.length, y: sy / pixelIndices.length };
};

const buildRaster = async () => {
  const { data, info } = await sharp(SOURCE_IMAGE_PATH).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const colorMask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 3, p += 1) {
    if (Math.abs(data[i] - TERRAIN_COLOR[0]) <= COLOR_TOLERANCE &&
        Math.abs(data[i + 1] - TERRAIN_COLOR[1]) <= COLOR_TOLERANCE &&
        Math.abs(data[i + 2] - TERRAIN_COLOR[2]) <= COLOR_TOLERANCE) {
      colorMask[p] = 1;
    }
  }

  // Проверка пробы: пиксель в самой заявленной точке обязан совпасть с целевым цветом.
  const sampleIndex = (TERRAIN_SAMPLE_POINT.y * width + TERRAIN_SAMPLE_POINT.x) * 3;
  const sampledRgb = [data[sampleIndex], data[sampleIndex + 1], data[sampleIndex + 2]];
  if (!colorMask[TERRAIN_SAMPLE_POINT.y * width + TERRAIN_SAMPLE_POINT.x]) {
    fail(
      `цвет в контрольной точке (${TERRAIN_SAMPLE_POINT.x},${TERRAIN_SAMPLE_POINT.y}) равен ` +
      `[${sampledRgb.join(",")}], что не совпадает с ожидаемым [${TERRAIN_COLOR.join(",")}] ` +
      `в пределах допуска ${COLOR_TOLERANCE} — исходный растр или проба цвета изменились`
    );
  }

  const eroded = morphologyPass(colorMask, width, height, OPENING_RADIUS_PX, "erode");
  const dilated = morphologyPass(eroded, width, height, OPENING_RADIUS_PX, "dilate");
  // Наращивание не должно выходить за исходную цветовую маску — иначе раскрытое
  // пятно оказалось бы шире, чем реально нарисованный цвет.
  const openedMask = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) openedMask[p] = (dilated[p] && colorMask[p]) ? 1 : 0;

  const { components: openedComponents } = labelComponents(
    openedMask, width, height, { minX: 0, minY: 0, maxX: width, maxY: height }
  );
  const patches = openedComponents
    .filter((pixels) => pixels.length >= MIN_PATCH_AREA_PX2)
    .map((pixels) => ({
      sizePx2: pixels.length,
      centroid: centroidOf(pixels, width),
      bbox: boundsOf(pixels, width),
      rows: toRowRuns(pixels, width)
    }))
    .sort((a, b) => b.sizePx2 - a.sizePx2);

  // Сырое (нераскрытое) пятно «озёра+река»: связная компонента сырой маски,
  // содержащая обе опорные точки озёр. Если они окажутся в РАЗНЫХ сырых
  // компонентах, это значит, что предположение «озёра и река — одна
  // нарисованная фигура» не подтвердилось, и останавливаться нужно здесь, а
  // не тихо брать первую подвернувшуюся компоненту.
  const { labels: rawLabels, components: rawComponents } = labelComponents(
    colorMask, width, height, LAKES_WINDOW
  );
  const seedLabels = LAKE_SEED_POINTS.map((point) => rawLabels[point.y * width + point.x]);
  // Вогнутая форма озера может не содержать свою собственную точку-центроид
  // (проверено измерением на этой карте): в этом случае ищем метку в
  // ближайшем занятом пикселе в пределах толщины основной линии карты.
  const resolveSeedLabel = (point, initialLabel) => {
    if (initialLabel !== -1) return initialLabel;
    const searchRadius = 12;
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
        const nx = point.x + dx, ny = point.y + dy;
        if (nx < LAKES_WINDOW.minX || nx >= LAKES_WINDOW.maxX || ny < LAKES_WINDOW.minY || ny >= LAKES_WINDOW.maxY) continue;
        const label = rawLabels[ny * width + nx];
        if (label !== -1) return label;
      }
    }
    fail(`не найдено ни одного пикселя цвета местности рядом с опорной точкой (${point.x},${point.y})`);
  };
  const resolvedLabels = LAKE_SEED_POINTS.map((point, i) => resolveSeedLabel(point, seedLabels[i]));
  if (resolvedLabels[0] !== resolvedLabels[1]) {
    fail(
      "опорные точки двух озёр лежат в РАЗНЫХ сырых компонентах цветовой маски " +
      `(метки ${resolvedLabels[0]} и ${resolvedLabels[1]}) — предположение «озёра и река ` +
      "нарисованы одной непрерывной фигурой» не подтвердилось; нужен новый разбор, а не тихая подгонка"
    );
  }
  const lakesRiverPixels = rawComponents[resolvedLabels[0]];

  return {
    width,
    height,
    sampledRgb,
    patches,
    lakesRiverBlob: {
      sizePx2: lakesRiverPixels.length,
      bbox: boundsOf(lakesRiverPixels, width),
      rows: toRowRuns(lakesRiverPixels, width)
    }
  };
};

const main = async () => {
  const checkOnly = process.argv.includes("--check");
  const raster = await buildRaster();
  const sourceSha256 = await sha256File(SOURCE_IMAGE_PATH);

  const document = {
    $comment:
      "НЕПУБЛИКУЕМЫЙ промежуточный результат измерения растра. Не является " +
      "игровым содержимым и не подключается ни к манифесту, ни к среде " +
      "исполнения напрямую — векторная геометрия строится из него " +
      "Python-инструментом cmt_impassable_terrain.py, который и решает, какие " +
      "пятна — настоящая местность, а какие — декорация (заголовок, роза " +
      "ветров, легенда, рамка). Регенерируется командой из docstring этого " +
      "файла; вручную не редактируется.",
    schemaVersion: "1.0.0",
    sourceImage: {
      file: path.relative(annotationsDirectory, SOURCE_IMAGE_PATH).split(path.sep).join("/"),
      pixelWidth: raster.width,
      pixelHeight: raster.height,
      sha256: sourceSha256
    },
    measurement: {
      terrainColorRgb: TERRAIN_COLOR,
      terrainColorSamplePoint: TERRAIN_SAMPLE_POINT,
      sampledRgbAtControlPoint: raster.sampledRgb,
      colorTolerancePerChannel: COLOR_TOLERANCE,
      openingStructuringElement:
        "diamond (L1 ball), radius 5px, built from 5 passes of 3x3-cross erosion " +
        "then 5 passes of 3x3-cross dilation, re-intersected with the raw color " +
        "mask to restore each surviving patch's true extent",
      openingRadiusPx: OPENING_RADIUS_PX,
      minPatchAreaPx2: MIN_PATCH_AREA_PX2,
      lakeSeedPoints: LAKE_SEED_POINTS,
      lakesWindow: LAKES_WINDOW
    },
    patchCount: raster.patches.length,
    patches: raster.patches,
    lakesRiverBlob: raster.lakesRiverBlob
  };

  const payload = `${JSON.stringify(document, null, 2)}\n`;

  if (checkOnly) {
    let existing;
    try {
      existing = await readFile(OUTPUT_PATH, "utf8");
    } catch {
      fail(`${OUTPUT_PATH} does not exist; run without --check to build it`);
    }
    if (existing !== payload) {
      fail(`${OUTPUT_PATH} is stale relative to the source image; rerun without --check to rebuild it`);
    }
    process.stdout.write(
      `extract-impassable-terrain-raster: OK, up to date (${raster.patches.length} patches ≥` +
      `${MIN_PATCH_AREA_PX2}px², lakes+river raw blob ${raster.lakesRiverBlob.sizePx2}px²)\n`
    );
    return;
  }

  await writeFile(OUTPUT_PATH, payload, "utf8");
  process.stdout.write(
    `extract-impassable-terrain-raster: wrote ${OUTPUT_PATH} (${(payload.length / 1024).toFixed(0)} KiB; ` +
    `${raster.patches.length} patches ≥${MIN_PATCH_AREA_PX2}px², lakes+river raw blob ` +
    `${raster.lakesRiverBlob.sizePx2}px²)\n`
  );
};

main().catch((error) => {
  process.stderr.write(`extract-impassable-terrain-raster: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
