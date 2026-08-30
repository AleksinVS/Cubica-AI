#!/usr/bin/env node
/**
 * Собрать наглядный предпросмотр вырезанной непроходимой местности для
 * продюсера: обзор всей карты с обведёнными новыми областями, отдельный кроп
 * на каждую такую область (достаточно крупный, чтобы судить по нему), особый
 * кроп на весь речной барьер у двух озёр целиком, и `index.md`,
 * объясняющий простыми словами, что вырезано и по какому правилу.
 *
 * Это не тот же инструмент, что render-region-partition-doubt-crops.mjs:
 * тот показывает спорные места всего разбиения вообще, а этот — конкретно
 * продюсерское решение о непроходимой местности, один раз, для приёмки.
 *
 * Запуск (без --check — это не воспроизводимый в байтах артефакт, а картинки
 * для человека, и они не хранятся в репозитории):
 *   node games/cards-money-trains/tools/render-impassable-terrain-preview.mjs [outDir]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "../../../node_modules/sharp/lib/index.js";

const moduleFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(moduleFile);
const repoRoot = path.resolve(toolsDirectory, "..", "..", "..");
const annotationsDirectory = path.resolve(toolsDirectory, "..", "annotations");
const SOURCE_IMAGE_PATH = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");
const DRAFT_PATH = path.join(annotationsDirectory, "vector-map.region-partition.draft.json");

const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, ".tmp", "impassable-terrain-preview"));

const readJson = async (filePath) => JSON.parse(await (await import("node:fs/promises")).readFile(filePath, "utf8"));

const polygonPointsAttr = (ring, scale = 1, offsetX = 0, offsetY = 0) =>
  ring.map(([x, y]) => `${(x - offsetX) * scale},${(y - offsetY) * scale}`).join(" ");

const boundsOfRing = (ring) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

const main = async () => {
  await mkdir(outDir, { recursive: true });
  const draft = await readJson(DRAFT_PATH);
  const regionsById = new Map(draft.regions.map((region) => [region.id, region]));
  const impassableIds = draft.impassableTerrain.regionIds;
  const impassableRegions = impassableIds.map((id) => {
    const region = regionsById.get(id);
    if (!region) throw new Error(`draft does not declare region "${id}" named in impassableTerrain.regionIds`);
    return region;
  });
  const measurement = draft.impassableTerrain.measurement;

  const { width: W, height: H } = await sharp(SOURCE_IMAGE_PATH).metadata();

  // --- Обзор: вся карта уменьшена, каждая новая область обведена и подписана номером входного пятна ---
  const SCALE = 0.35;
  const overviewMarks = impassableRegions.map((region, index) => {
    const points = polygonPointsAttr(region.exteriorRing, SCALE);
    const centerX = region.representativePoint.x * SCALE;
    const centerY = region.representativePoint.y * SCALE;
    return (
      `<polygon points="${points}" fill="#dc2626" fill-opacity="0.55" stroke="#7f1d1d" stroke-width="2"/>` +
      `<text x="${centerX.toFixed(1)}" y="${(centerY - 6).toFixed(1)}" fill="#7f1d1d" ` +
      `font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">${index + 1}</text>`
    );
  }).join("\n  ");
  const overviewSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * SCALE)}" height="${Math.round(H * SCALE)}">${overviewMarks}</svg>`
  );
  await sharp(SOURCE_IMAGE_PATH)
    .resize({ width: Math.round(W * SCALE) })
    .composite([{ input: overviewSvg, top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, "overview.png"));

  // --- Один кроп на каждую новую область: окно вчетверо шире области, увеличение x3 ---
  const rows = [];
  for (const [index, region] of impassableRegions.entries()) {
    const number = index + 1;
    const bounds = boundsOfRing(region.exteriorRing);
    const width = Math.max(bounds.maxX - bounds.minX, 20);
    const height = Math.max(bounds.maxY - bounds.minY, 20);
    const side = Math.round(Math.max(width, height) * 4 + 120);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const left = Math.max(0, Math.min(W - side, Math.round(centerX - side / 2)));
    const top = Math.max(0, Math.min(H - side, Math.round(centerY - side / 2)));
    const cropWidth = Math.min(side, W - left);
    const cropHeight = Math.min(side, H - top);

    const outlineSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cropWidth}" height="${cropHeight}">` +
      `<polygon points="${polygonPointsAttr(region.exteriorRing, 1, left, top)}" ` +
      `fill="#dc2626" fill-opacity="0.35" stroke="#7f1d1d" stroke-width="3"/>` +
      (region.interiorRings ?? []).map((ring) =>
        `<polygon points="${polygonPointsAttr(ring, 1, left, top)}" fill="none" stroke="#7f1d1d" stroke-width="2" stroke-dasharray="6 4"/>`
      ).join("") +
      `</svg>`
    );
    const fileName = `region-${String(number).padStart(2, "0")}-${region.id}.png`;
    await sharp(SOURCE_IMAGE_PATH)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .composite([{ input: outlineSvg, top: 0, left: 0 }])
      .png()
      .toFile(path.join(outDir, fileName));
    rows.push({
      number, id: region.id, areaPx2: region.areaPx2,
      countryName: region.countryName, fileName,
      parent: (draft.impassableTerrain.surgeryLog.find(
        (entry) => entry.kind === "impassable-terrain-region" && entry.newRegionId === region.id
      ) ?? {}).parentRegionId
    });
  }

  // --- Особый кроп: весь речной барьер у двух озёр целиком, одним куском ---
  const riverRegions = impassableRegions.filter((region) => region.areaPx2 > 300 &&
    region.representativePoint.x > 1000 && region.representativePoint.x < 2000 &&
    region.representativePoint.y > 1200 && region.representativePoint.y < 2000);
  if (riverRegions.length > 0) {
    const allBounds = riverRegions.map((r) => boundsOfRing(r.exteriorRing));
    const minX = Math.min(...allBounds.map((b) => b.minX)) - 80;
    const minY = Math.min(...allBounds.map((b) => b.minY)) - 80;
    const maxX = Math.max(...allBounds.map((b) => b.maxX)) + 80;
    const maxY = Math.max(...allBounds.map((b) => b.maxY)) + 80;
    const left = Math.max(0, Math.round(minX));
    const top = Math.max(0, Math.round(minY));
    const cropWidth = Math.min(W - left, Math.round(maxX - minX));
    const cropHeight = Math.min(H - top, Math.round(maxY - minY));
    const marks = riverRegions.map((region) =>
      `<polygon points="${polygonPointsAttr(region.exteriorRing, 1, left, top)}" fill="#2563eb" fill-opacity="0.45" stroke="#1e3a8a" stroke-width="2"/>`
    ).join("\n  ");
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cropWidth}" height="${cropHeight}">${marks}</svg>`);
    await sharp(SOURCE_IMAGE_PATH)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .composite([{ input: svg, top: 0, left: 0 }])
      .png()
      .toFile(path.join(outDir, "lakes-and-river.png"));
  }

  const lines = [
    "# Непроходимая местность — предпросмотр для приёмки",
    "",
    "Продюсер решил: нарисованная художником тёмно-коричневая местность на карте " +
    "(и река, соединяющая два озера) — игровая территория, на которой запрещено " +
    "строить дороги. Это уже было на карте, просто не было выделено как области; " +
    "этот предпросмотр показывает, что именно вырезано и по какому правилу.",
    "",
    "## Как отобрана местность",
    "",
    "Цвет местности — проба с самой карты (139, 111, 89), не подобран на глаз, " +
    "с допуском 12 на канал. Обводки государственных границ нарисованы тем же " +
    "цветом, поэтому отделены по толщине: маска стачивается на 5 точек (эрозия) " +
    `— измеренная толщина линии ${6.970} точки исчезает целиком, — а затем ` +
    "наращивается обратно (дилатация), возвращая пятну его настоящий размер. " +
    `Так найдено ${measurement.patchCount} пятен площадью не менее 300 точек в квадрате.`,
    "",
    "Декорация (заголовок карты, роза ветров, легенда, рамка листа) нарисована " +
    "тем же цветом и сравнимого размера с местностью, поэтому цвет и толщина " +
    "её не отличают. Отличает положение: местность лежит внутри разбиения карты " +
    "на области, декорация — снаружи. Измерение разделяет пятна БЕЗ единого " +
    `промежуточного случая: ${measurement.terrainPatchCount} пятен лежат внутри ` +
    `разбиения (местность), ${measurement.decorationPatchCount} — вне его (декорация).`,
    "",
    `Решением продюсера оставлено ПРОХОДИМЫМИ пятен: ${measurement.excludedPatches.length}. ` +
    "Они прошли признак «местность», но продюсер решил иначе, и в список ниже " +
    "они не входят:",
    "",
    ...measurement.excludedPatches.map((patch) =>
      `- ${patch.areaPx2} точки в квадрате у (${Math.round(patch.centroid.x)}, ` +
      `${Math.round(patch.centroid.y)}) — ${patch.producerDecisionReason}.`
    ),
    "",
    "## Река у двух озёр",
    "",
    "Река нарисована тем же цветом и почти той же толщиной, что и обводка " +
    "государственной границы, — эрозия, отделяющая обычную местность, стирает " +
    "и её тоже. Отличает не цвет и не толщина, а то, что означает каждая линия " +
    "для уже построенного разбиения: государственная граница идёт ВДОЛЬ границы " +
    "между областями (разбиение и резалось по её линии), а река идёт ПОПЕРЁК " +
    "области, не вдоль её края. Измеренное расстояние от пикселя реки до " +
    `ближайшей границы области: минимум ${measurement.riverDistanceMinPx}, медиана ` +
    `${measurement.riverDistanceMedianPx}, максимум ${measurement.riverDistanceMaxPx} ` +
    `точки; лишь ${(measurement.riverShareWithinHalfStrokeWidth * 100).toFixed(1)}% ` +
    `пикселей лежат не дальше половины толщины линии (${measurement.riverHalfStrokeWidthPx} ` +
    "точки) — там, где река на самом деле пересекает границу области. Картинка " +
    "`lakes-and-river.png` показывает всю реку как один сплошной барьер.",
    "",
    "## Список новых непроходимых областей",
    "",
    `Всего ${rows.length} новых непроходимых областей (34 пятна местности плюс ` +
    "река, разрезанные по границам уже существующих областей карты — одно пятно " +
    "местности может лечь сразу в несколько областей и тогда становится " +
    "несколькими новыми областями, каждая со своей страной).",
    "",
    "| № | id | страна | площадь, px² | из области | картинка |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) =>
      `| ${r.number} | ${r.id} | ${r.countryName} | ${Math.round(r.areaPx2)} | ${r.parent ?? "—"} | [${r.fileName}](./${r.fileName}) |`
    ),
    "",
    "`overview.png` — вся карта с обведёнными новыми областями."
  ];
  await writeFile(path.join(outDir, "index.md"), lines.join("\n"));
  process.stdout.write(`render-impassable-terrain-preview: wrote ${outDir} (${rows.length} regions)\n`);
};

main().catch((error) => {
  process.stderr.write(`render-impassable-terrain-preview: ${error.message}\n`);
  process.exitCode = 1;
});
