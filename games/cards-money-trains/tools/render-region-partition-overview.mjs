#!/usr/bin/env node
/**
 * Построить постоянную обзорную карту разбиения авторской карты на области.
 *
 * Зачем этот инструмент нужен: `cmt_region_partition.py` уже посчитал 918
 * «областей» (region — замкнутый кусок карты, окружённый линиями границ) и
 * зафиксировал несколько сотен мест, где автоматический расчёт был
 * неоднозначным («сомнение», doubt; точное число читается из самого
 * входного файла и печатается в отчёте инструмента при каждом запуске —
 * оно не зашито в код и может меняться при пересборке черновика). Этот
 * большой JSON неудобно разглядывать человеку напрямую. Инструмент строит
 * три файла человеко-читаемого вида:
 *   1. `vector-map.region-partition.overview.svg`  — цветная схема всех
 *      918 областей в масштабе всей карты, с подписями крупных областей,
 *      значками сомнений, контурами стран, станциями и легендой;
 *   2. `vector-map.region-partition.overview.png`  — та же схема, но
 *      наложенная поверх исходного растра карты, чтобы можно было сверить
 *      разбиение с оригиналом на глаз;
 *   3. `vector-map.region-partition.doubts.md`     — реестр всех сомнений
 *      в виде таблиц с пояснениями для человека, впервые видящего этот
 *      документ.
 *
 * Кроме областей и сомнений, на схеме показаны три вида игровых меток:
 * контуры стран, станции (принимают грузы) и полустанки (waypoint) —
 * промежуточные остановки на дороге, которые, в отличие от станции,
 * НЕ принимают грузы (подтверждено PM 2026-07-26; на исходной карте
 * нарисованы гладким кружком без зубчатого обода и без отверстия, в
 * отличие от значка станции). Полустанки — не сомнение и в реестр
 * `doubts.md` не входят, у них уже есть подтверждённая человеком трактовка.
 *
 * Источники (все — только для чтения, этот инструмент их не меняет):
 *   - `annotations/vector-map.region-partition.draft.json`   (области, сомнения);
 *   - `annotations/vector-map.countries-stations.draft.json` (контуры стран, станции, полустанки);
 *   - `draft/trains/Игровая Карта.png`                       (авторский растр, только для PNG).
 *
 * Режим `--check` пересобирает все три файла в памяти и сверяет их с уже
 * сохранёнными на диске байт-в-байт, ничего не записывая. Это позволяет
 * проверить в CI, что артефакты не устарели относительно исходников —
 * так же, как это делает `build-map-asset.mjs` и
 * `render-vector-map-classification-review.mjs` для соседних обзоров.
 */

import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const moduleFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");
const gameRoot = path.join(repoRoot, "games", "cards-money-trains");
const annotationsDirectory = path.join(gameRoot, "annotations");

const DEFAULT_REGION_PARTITION_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.draft.json"
);
const DEFAULT_COUNTRIES_STATIONS_PATH = path.join(
  annotationsDirectory,
  "vector-map.countries-stations.draft.json"
);
const DEFAULT_BACKGROUND_PATH = path.join(repoRoot, "draft", "trains", "Игровая Карта.png");
const DEFAULT_SVG_OUTPUT_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.overview.svg"
);
const DEFAULT_PNG_OUTPUT_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.overview.png"
);
const DEFAULT_MD_OUTPUT_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.doubts.md"
);

// Канонический размер карты в пикселях (то же число используют все
// соседние обзорные инструменты — см. render-vector-map-classification-review.mjs).
const CANONICAL_WIDTH = 5079;
const CANONICAL_HEIGHT = 3627;

// Область — большой JSON (~6.5 МБ), контуры стран — раза в 10 меньше;
// растровая подложка — несколько МБ. Ограничения защищают от неожиданной
// подмены входного файла на слишком большой перед разбором JSON/растра.
const JSON_LIMIT = 32 * 1024 * 1024;
const PNG_LIMIT = 64 * 1024 * 1024;

/**
 * Порог подписывания областей числом (в квадратных пикселях площади).
 *
 * 918 подписей на одной схеме нечитаемы (номера налезают друг на друга).
 * Порог выбран так, чтобы подписать чуть больше половины областей по счёту,
 * но покрыть подавляющую часть видимой площади карты — то есть человек
 * видит номер почти везде, где на глаз заметен кусок карты, а самые мелкие
 * обрезки без подписи остаются доступны через JSON и общий счётчик.
 * Фактические числа (сколько подписано и какую площадь это покрывает)
 * посчитаны из данных и распечатаны в отчёте, а не захардкожены.
 */
const LABEL_AREA_THRESHOLD_PX2 = 5000;

// Итоговая ширина растрового PNG-обзора. Полное разрешение (5079×3627)
// делает подписи максимально чёткими, но захламляет каталог тяжёлым файлом;
// половинная ширина уже даёт файл разумного размера, а подписи крупных
// областей (шрифт 15px в исходном масштабе) остаются читаемыми на экране.
const OVERVIEW_PNG_WIDTH = 3200;

// Радиус, на который расходятся в стороны две метки сомнений, стоящие
// ровно в одной и той же точке (см. computeDoubtRenderPositions). Такое
// бывает, когда два разных способа расчёта разошлись из-за одного и того
// же места на карте — у обеих меток одинаковые atX/atY.
const DUPLICATE_OFFSET_RADIUS_PX = 15;

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Округление числа с фиксированным числом знаков — для детерминированного SVG. */
const round = (value, digits = 2) => Number(value.toFixed(digits));

const xmlEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

/** Достаёт последние 4 цифры из идентификатора вида "map-region-0002". */
const numericSuffix = (id) => {
  const match = /(\d+)$/.exec(id);
  if (!match) fail(`identifier without a trailing number: ${id}`);
  return match[1];
};

// ---------------------------------------------------------------------------
// Безопасное, ограниченное по размеру чтение входных файлов без записи в них.
// Приём и обоснование те же, что в render-vector-map-classification-review.mjs:
// защититься от гонки (файл подменили, пока мы его читали) и от случайно
// огромного файла ещё до разбора JSON.
// ---------------------------------------------------------------------------

const sameStableStats = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const readStableFile = async (filePath, limit) => {
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail(`${filePath}: expected a regular file`);
    if (before.size > BigInt(limit)) {
      fail(`${filePath}: ${before.size} bytes exceed the safe ${limit}-byte limit`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await stat(filePath, { bigint: true });
    if (!sameStableStats(before, after) || !sameStableStats(before, pathAfter)) {
      fail(`${filePath}: input changed while it was being read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

const parseJson = (bytes, filePath) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${filePath}: invalid JSON (${error.message})`);
  }
};

/** Отказ, если outputPath — символическая ссылка или совпадает с защищённым входом. */
const assertSafeOutputPath = async (outputPath, protectedPaths) => {
  let outputStats;
  try {
    outputStats = await lstat(path.resolve(outputPath), { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    outputStats = null;
  }
  if (outputStats?.isSymbolicLink()) {
    fail(`${outputPath} must not be a symbolic link`);
  }
  const outputCanonical = await realpath(
    outputStats === null ? path.dirname(path.resolve(outputPath)) : path.resolve(outputPath)
  ).catch(() => path.resolve(outputPath));
  for (const protectedPath of protectedPaths) {
    const protectedCanonical = await realpath(protectedPath).catch(() => path.resolve(protectedPath));
    if (outputStats !== null && protectedCanonical === path.resolve(outputPath)) {
      fail(`${outputPath} must not overwrite protected input ${protectedPath}`);
    }
    void outputCanonical; // канонический путь каталога сверен через realpath выше
  }
};

// ---------------------------------------------------------------------------
// Загрузка и минимальная относительная проверка входных данных.
// Полной JSON Schema для region-partition.draft.json пока нет (см. задание —
// артефакт и сам инструмент cmt_region_partition.py менять запрещено), поэтому
// здесь — только проверки согласованности с полем summary самого файла:
// они защищают от молчаливого рассинхрона, если черновик когда-нибудь
// пересоберут по-другому.
// ---------------------------------------------------------------------------

const DOUBT_KIND_ORDER = [
  "unresolved-gap",
  "assumed-connection",
  "collapsed-sliver",
  "country-border-gap-merged",
  "removed-micro-hole",
  "methods-disagree-merged",
  "methods-disagree-split",
  "methods-disagree-unmatched"
];

const loadInputs = async ({ regionPartitionPath, countriesStationsPath, backgroundPath }) => {
  const [regionPartitionBytes, countriesStationsBytes, backgroundBytes] = await Promise.all([
    readStableFile(regionPartitionPath, JSON_LIMIT),
    readStableFile(countriesStationsPath, JSON_LIMIT),
    readStableFile(backgroundPath, PNG_LIMIT)
  ]);
  const regionPartition = parseJson(regionPartitionBytes, regionPartitionPath);
  const countriesStations = parseJson(countriesStationsBytes, countriesStationsPath);

  if (!Array.isArray(regionPartition.regions) || !Array.isArray(regionPartition.doubts)) {
    fail("region-partition draft is missing regions[] or doubts[]");
  }
  if (regionPartition.regions.length !== regionPartition.summary.regionCount) {
    fail("regions[] length disagrees with summary.regionCount");
  }
  if (regionPartition.doubts.length !== regionPartition.summary.doubtCount) {
    fail("doubts[] length disagrees with summary.doubtCount");
  }
  const doubtKindCounts = Object.fromEntries(DOUBT_KIND_ORDER.map((kind) => [kind, 0]));
  for (const doubt of regionPartition.doubts) {
    if (!(doubt.kind in doubtKindCounts)) fail(`unknown doubt kind: ${doubt.kind}`);
    doubtKindCounts[doubt.kind] += 1;
  }
  if (doubtKindCounts["unresolved-gap"] !== regionPartition.summary.unresolvedGapCount) {
    fail("unresolved-gap count disagrees with summary.unresolvedGapCount");
  }
  // Сводка считает все присоединённые щели одним числом, а реестр сомнений
  // делит их на два вида: обычную щель внутри страны и щель на границе стран,
  // из-за которой граница страны сместилась. Сверяется сумма обоих видов.
  const collapsedDoubtCount = doubtKindCounts["collapsed-sliver"] +
    doubtKindCounts["country-border-gap-merged"];
  if (collapsedDoubtCount !== regionPartition.summary.collapsedSliverCount) {
    fail("collapsed-sliver + country-border-gap-merged count disagrees with summary.collapsedSliverCount");
  }
  if (doubtKindCounts["removed-micro-hole"] !== regionPartition.summary.removedMicroHoleCount) {
    fail("removed-micro-hole count disagrees with summary.removedMicroHoleCount");
  }
  if (!Array.isArray(countriesStations.countries) || !Array.isArray(countriesStations.stations)) {
    fail("countries-stations draft is missing countries[] or stations[]");
  }
  if (!Array.isArray(countriesStations.waypoints)) {
    fail("countries-stations draft is missing waypoints[]");
  }
  if (countriesStations.waypoints.length !== countriesStations.summary.waypointCount) {
    fail("waypoints[] length disagrees with countries-stations summary.waypointCount");
  }
  if (countriesStations.waypoints.length !== regionPartition.summary.waypointCount) {
    fail(
      "region-partition summary.waypointCount disagrees with " +
      "countries-stations waypoints[] length"
    );
  }

  const backgroundMetadata = await sharp(backgroundBytes).metadata();
  if (backgroundMetadata.width !== CANONICAL_WIDTH || backgroundMetadata.height !== CANONICAL_HEIGHT) {
    fail(
      `background map is ${backgroundMetadata.width}x${backgroundMetadata.height}, ` +
      `expected ${CANONICAL_WIDTH}x${CANONICAL_HEIGHT}`
    );
  }

  return {
    regionPartition,
    countriesStations,
    backgroundBytes,
    doubtKindCounts,
    regionPartitionSha256: sha256(regionPartitionBytes),
    countriesStationsSha256: sha256(countriesStationsBytes)
  };
};

// ---------------------------------------------------------------------------
// Геометрия: определить, какие области затрагивает каждое сомнение.
// ---------------------------------------------------------------------------

/** Классический тест "точка внутри многоугольника" методом луча (ray casting). */
export const pointInRing = (x, y, ring) => {
  let inside = false;
  // `j = i++` (постфиксный инкремент) обязателен: он присваивает j значение i
  // ДО увеличения, то есть предыдущий индекс. `j = i += 1` (префиксный,
  // как было раньше) присваивает j уже увеличенное значение i — тогда j и i
  // совпадают на каждом шаге, ребро вырождается в точку, пересечение луча с
  // ним никогда не засчитывается, и функция объявляет любую точку внутри
  // кольца лежащей снаружи (кроме одного случая — замыкающего ребра при i=0).
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

const distancePointToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
};

export const distancePointToRing = (x, y, ring) => {
  let minDistance = Infinity;
  // Тот же постфиксный `j = i++`, что и в pointInRing() выше и по той же
  // причине: префиксная форма склеивала j и i в один и тот же индекс.
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const distance = distancePointToSegment(x, y, ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
};

/**
 * Найти области, которые касаются места сомнения.
 *
 * В подавляющем большинстве случаев точка сомнения попадает внутрь ровно
 * одной области — тогда возвращается она одна.
 * Остальные сомнения (в основном "unresolved-gap") стоят точно в разрыве
 * границы, то есть вне заливки любой области; для них возвращаются две
 * ближайшие по краю области — обычно это и есть та пара, которую разрыв
 * должен был бы разделять или соединять. Такой результат помечается
 * приближённым (см. вызывающий код и лист "≈" в markdown-таблице).
 */
const findAffectedRegions = (doubt, regions) => {
  const contained = [];
  for (const region of regions) {
    const { minX, minY, maxX, maxY } = region.bounds;
    if (doubt.atX < minX - 1 || doubt.atX > maxX + 1) continue;
    if (doubt.atY < minY - 1 || doubt.atY > maxY + 1) continue;
    if (pointInRing(doubt.atX, doubt.atY, region.exteriorRing)) contained.push(region.id);
  }
  if (contained.length > 0) return { regionIds: contained, approximate: false };

  const distances = regions.map((region) => ({
    id: region.id,
    distance: distancePointToRing(doubt.atX, doubt.atY, region.exteriorRing)
  }));
  distances.sort((left, right) => left.distance - right.distance);
  return { regionIds: distances.slice(0, 2).map((entry) => entry.id), approximate: true };
};

// ---------------------------------------------------------------------------
// Цвет областей: шаг по кругу оттенков на золотое сечение.
//
// Приём объяснён в задании: если брать каждый следующий оттенок через угол
// золотого сечения (~137.508°) от предыдущего, соседние по номеру области
// почти никогда не получают близкие оттенки, даже без анализа реального
// соседства на карте. Это простой и надёжный способ отличать области, не
// требующий знать, кто с кем реально граничит.
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE_DEGREES = 137.50776405;
const REGION_SATURATION = 62;
const REGION_LIGHTNESS = 54;

const regionHue = (index) => (index * GOLDEN_ANGLE_DEGREES) % 360;
const regionFillColor = (index) =>
  `hsl(${round(regionHue(index), 1)}deg ${REGION_SATURATION}% ${REGION_LIGHTNESS}%)`;
const regionStrokeColor = (index) =>
  `hsl(${round(regionHue(index), 1)}deg ${REGION_SATURATION}% ${Math.max(REGION_LIGHTNESS - 26, 8)}%)`;

// ---------------------------------------------------------------------------
// Оформление меток сомнений: разная форма и цвет для каждого из четырёх
// визуально различимых семейств, требуемых заданием (незамкнутая граница,
// предположенное соединение, схлопнутая щель, расхождение способов).
// Три подвида "расхождение способов" делят форму (круг) и цвет (синий) —
// задание требует различать по цвету и форме только эти четыре семейства,
// а не подвиды внутри "расхождения способов". Чтобы всё же можно было
// отличить подвид на глаз прямо на схеме (без похода в таблицу), используется
// не штрих контура (он теряется на маленькой иконке), а заметно разный
// рисунок внутри круга: сплошная заливка / кольцо (полая середина) /
// заливка с белой точкой в центре ("мишень").
//
// В черновике появился ещё один, пятый вид сомнения — "removed-micro-hole"
// (ничтожное внутреннее отверстие внутри области убрано при разборе). Он не
// входит в перечисленные четыре обязательных семейства из задания, но по
// тому же принципу читаемости получает свою собственную форму и цвет
// (звезда, красный), чтобы не путаться ни с одним из остальных пяти.
// ---------------------------------------------------------------------------

const DOUBT_KIND_STYLE = {
  "unresolved-gap": {
    shape: "triangle",
    fill: "#f59e0b",
    stroke: "#7c2d12",
    variant: "solid",
    title: "Незамкнутая граница"
  },
  "assumed-connection": {
    shape: "diamond",
    fill: "#8b5cf6",
    stroke: "#4c1d95",
    variant: "solid",
    title: "Предположенное соединение"
  },
  "collapsed-sliver": {
    shape: "square",
    fill: "#14b8a6",
    stroke: "#134e4a",
    variant: "solid",
    title: "Схлопнутая щель"
  },
  // Щель, доставшаяся соседу через государственную границу: тот же вид
  // присоединения, но граница страны при этом сместилась на несколько точек,
  // поэтому такие места отделены от обычных щелей и показаны полым квадратом.
  "country-border-gap-merged": {
    shape: "square",
    fill: "#14b8a6",
    stroke: "#134e4a",
    variant: "ring",
    title: "Щель на границе стран"
  },
  "removed-micro-hole": {
    shape: "star",
    fill: "#ef4444",
    stroke: "#7f1d1d",
    variant: "solid",
    title: "Убранное микро-отверстие"
  },
  "methods-disagree-merged": {
    shape: "circle",
    fill: "#3b82f6",
    stroke: "#1e3a8a",
    variant: "solid",
    title: "Расхождение способов — объединение"
  },
  "methods-disagree-split": {
    shape: "circle",
    fill: "#3b82f6",
    stroke: "#1e3a8a",
    variant: "ring",
    title: "Расхождение способов — разделение"
  },
  "methods-disagree-unmatched": {
    shape: "circle",
    fill: "#3b82f6",
    stroke: "#1e3a8a",
    variant: "bullseye",
    title: "Расхождение способов — нет соответствия"
  }
};

const DOUBT_MARKER_RADIUS = 11;

/** Возвращает SVG-фрагмент "иконки" сомнения (без подписи) заданной формы. */
const doubtMarkerShape = (kind, cx, cy) => {
  const style = DOUBT_KIND_STYLE[kind];
  const r = DOUBT_MARKER_RADIUS;
  // "ring" рисует контур без заливки (полая середина — видно карту насквозь),
  // "bullseye" — обычную заливку плюс маленькую белую точку в центре.
  const fillOpacity = style.variant === "ring" ? "0" : "0.88";
  const strokeWidth = style.variant === "ring" ? 4.2 : 2.4;
  const common = `fill="${style.fill}" fill-opacity="${fillOpacity}" stroke="${style.stroke}" ` +
    `stroke-width="${strokeWidth}"`;
  const bullseyeDot = style.variant === "bullseye"
    ? `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r * 0.32)}" fill="#ffffff" fill-opacity="0.95" />`
    : "";
  if (style.shape === "triangle") {
    const points = [
      [cx, cy - r],
      [cx + r * 0.92, cy + r * 0.78],
      [cx - r * 0.92, cy + r * 0.78]
    ].map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
    return `<polygon ${common} points="${points}" />`;
  }
  if (style.shape === "diamond") {
    const points = [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy]
    ].map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
    return `<polygon ${common} points="${points}" />`;
  }
  if (style.shape === "square") {
    const side = r * 1.5;
    return `<rect ${common} x="${round(cx - side / 2)}" y="${round(cy - side / 2)}" ` +
      `width="${round(side)}" height="${round(side)}" />`;
  }
  if (style.shape === "star") {
    // Четырёхконечная звезда: чередуются 4 внешних и 4 внутренних точки —
    // читается как "особая метка", не похожая ни на один из остальных
    // четырёх базовых силуэтов (треугольник/ромб/квадрат/круг).
    const outer = r * 1.15;
    const inner = r * 0.42;
    const points = [];
    for (let i = 0; i < 8; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / 4) * i - Math.PI / 2;
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
    const pointsAttr = points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
    return `<polygon ${common} points="${pointsAttr}" />`;
  }
  // circle — все три подвида "расхождение способов"
  return `<circle ${common} cx="${round(cx)}" cy="${round(cy)}" r="${r}" />${bullseyeDot}`;
};

// ---------------------------------------------------------------------------
// Метки сомнений, стоящие в одной и той же точке (bit-в-bit совпадающие
// atX/atY — 9 таких пар в текущем черновике), раздвигаются на фиксированный
// небольшой радиус по кругу вокруг настоящей точки, а тонкая линия-выноска
// соединяет метку с настоящим местом, помеченным маленькой точкой. Это чисто
// оформительский приём для читаемости: истинные координаты не меняются и
// остаются доступны в JSON и в markdown-таблице.
// ---------------------------------------------------------------------------

const computeDoubtRenderPositions = (doubts) => {
  const groups = new Map();
  for (const doubt of doubts) {
    const key = `${doubt.atX.toFixed(3)}|${doubt.atY.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doubt);
  }
  const positions = new Map();
  for (const group of groups.values()) {
    // Сортировка по id внутри группы — детерминированный порядок раскладки.
    const sorted = [...group].sort((left, right) => left.id.localeCompare(right.id));
    sorted.forEach((doubt, index) => {
      if (sorted.length === 1) {
        positions.set(doubt.id, { x: doubt.atX, y: doubt.atY, leaderTo: null });
        return;
      }
      const angle = (2 * Math.PI * index) / sorted.length;
      positions.set(doubt.id, {
        x: doubt.atX + DUPLICATE_OFFSET_RADIUS_PX * Math.cos(angle),
        y: doubt.atY + DUPLICATE_OFFSET_RADIUS_PX * Math.sin(angle),
        leaderTo: { x: doubt.atX, y: doubt.atY }
      });
    });
  }
  return positions;
};

// ---------------------------------------------------------------------------
// Сборка фрагментов SVG.
// ---------------------------------------------------------------------------

const ringToPath = (ring) => {
  const [first, ...rest] = ring;
  const moveTo = `M ${round(first[0])} ${round(first[1])}`;
  const lineTo = rest.map(([x, y]) => `L ${round(x)} ${round(y)}`).join(" ");
  return `${moveTo} ${lineTo} Z`;
};

const renderRegions = (regions) => regions.map((region, index) => {
  const fill = regionFillColor(index);
  const stroke = regionStrokeColor(index);
  return `    <path class="region" id="${xmlEscape(region.id)}" ` +
    `data-region-id="${xmlEscape(region.id)}" data-area-px2="${round(region.areaPx2, 1)}" ` +
    `d="${ringToPath(region.exteriorRing)}" fill="${fill}" fill-opacity="0.55" ` +
    `stroke="${stroke}" stroke-width="0.7" stroke-opacity="0.65">` +
    `<title>${xmlEscape(region.id)} · площадь ${round(region.areaPx2, 0)} px²</title></path>`;
}).join("\n");

/**
 * Пустые пространства — вода или иная незанятая площадь вне страновых заливок.
 * Игровыми областями они не являются, поэтому рисуются отдельным слоем и
 * заметно иначе: тёмная косая штриховка вместо цветной заливки. Показывать их
 * обязательно: исключённое из разбиения не должно исчезать с обзора молча.
 */
const renderEmptySpaces = (spaces) => spaces.map((space) => {
  const { x, y } = space.representativePoint;
  return `    <path class="empty-space" id="${xmlEscape(space.id)}" ` +
    `data-empty-space-id="${xmlEscape(space.id)}" ` +
    `d="${ringToPath(space.exteriorRing)}" fill="url(#empty-space-hatch)" ` +
    `stroke="#1f2937" stroke-width="2.5" stroke-dasharray="10 6">` +
    `<title>${xmlEscape(space.id)} · пустое пространство, не игровая территория · ` +
    `площадь ${round(space.areaPx2, 0)} px²</title></path>\n` +
    `    <text class="empty-space-label" x="${round(x)}" y="${round(y)}" ` +
    `text-anchor="middle" dominant-baseline="middle">пусто</text>`;
}).join("\n");

const renderRegionLabels = (regions, threshold) => {
  const labelled = regions.filter((region) => region.areaPx2 >= threshold);
  const rows = labelled.map((region) => {
    const { x, y } = region.representativePoint;
    const label = numericSuffix(region.id);
    return `    <text class="region-label" data-region-id="${xmlEscape(region.id)}" ` +
      `x="${round(x)}" y="${round(y)}">${label}</text>`;
  }).join("\n");
  return { count: labelled.length, markup: rows };
};

const renderCountryContours = (countries) => countries.map((country) => {
  const subpaths = country.contour
    .map((ring) => ringToPath(ring))
    .join(" ");
  const label = numericSuffix(country.id);
  return [
    `    <path class="country-contour-halo" d="${subpaths}" data-country-id="${xmlEscape(country.id)}" />`,
    `    <path class="country-contour" d="${subpaths}" data-country-id="${xmlEscape(country.id)}">` +
      `<title>Страна ${xmlEscape(label)} (${xmlEscape(country.id)})</title></path>`
  ].join("\n");
}).join("\n");

const renderStations = (stations) => stations.map((station) => {
  const { x, y } = station.canonicalPosition;
  const label = `s${numericSuffix(station.id)}`;
  return [
    `    <g class="station" data-station-id="${xmlEscape(station.id)}">`,
    `      <circle cx="${round(x)}" cy="${round(y)}" r="9" />`,
    `      <line x1="${round(x - 6)}" y1="${round(y)}" x2="${round(x + 6)}" y2="${round(y)}" />`,
    `      <line x1="${round(x)}" y1="${round(y - 6)}" x2="${round(x)}" y2="${round(y + 6)}" />`,
    `      <text x="${round(x + 13)}" y="${round(y - 11)}">${label}` +
      `<title>${xmlEscape(station.id)} → ${xmlEscape(station.mappedReferenceId ?? "?")}</title></text>`,
    "    </g>"
  ].join("\n");
}).join("\n");

/**
 * Полустанок (waypoint) — промежуточная остановка на дороге, которая,
 * в отличие от станции, НЕ принимает грузы (см. заголовочный комментарий
 * файла). Метка нарочно устроена иначе, чем у станции (нет креста внутри,
 * другой цвет) и иначе, чем у сомнений (сплошной жёлтый кружок без формы
 * треугольника/ромба/квадрата), чтобы три вида игровых меток не путались.
 */
const renderWaypoints = (waypoints) => waypoints.map((waypoint) => {
  const { x, y } = waypoint.center;
  const label = `w${numericSuffix(waypoint.id)}`;
  return [
    `    <g class="waypoint" data-waypoint-id="${xmlEscape(waypoint.id)}">`,
    `      <circle cx="${round(x)}" cy="${round(y)}" r="10" />`,
    `      <text x="${round(x + 14)}" y="${round(y - 12)}">${label}` +
      `<title>${xmlEscape(waypoint.id)} · полустанок «${xmlEscape(waypoint.label)}» · ` +
      `грузы НЕ принимает (подтверждено PM ${xmlEscape(waypoint.confirmedAt ?? "")})</title></text>`,
    "    </g>"
  ].join("\n");
}).join("\n");

const renderDoubts = (doubts, positions) => doubts.map((doubt) => {
  const position = positions.get(doubt.id);
  const label = `d${numericSuffix(doubt.id)}`;
  const leader = position.leaderTo === null
    ? ""
    : `      <line class="doubt-leader" x1="${round(position.x)}" y1="${round(position.y)}" ` +
      `x2="${round(position.leaderTo.x)}" y2="${round(position.leaderTo.y)}" />\n` +
      `      <circle class="doubt-true-point" cx="${round(position.leaderTo.x)}" ` +
      `cy="${round(position.leaderTo.y)}" r="2.2" />\n`;
  return [
    `    <g class="doubt" data-doubt-id="${xmlEscape(doubt.id)}" data-kind="${xmlEscape(doubt.kind)}">`,
    leader,
    `      ${doubtMarkerShape(doubt.kind, position.x, position.y)}`,
    `      <text x="${round(position.x + DOUBT_MARKER_RADIUS + 3)}" ` +
      `y="${round(position.y - DOUBT_MARKER_RADIUS)}">${label}` +
      `<title>${xmlEscape(doubt.id)} · ${xmlEscape(DOUBT_KIND_STYLE[doubt.kind].title)} · ` +
      `${xmlEscape(doubt.chosenHypothesis)}</title></text>`,
    "    </g>"
  ].join("\n");
}).join("\n");

const renderLegend = ({
  emptySpaceCount,
  doubtKindCounts,
  labelledRegionCount,
  totalRegionCount,
  labelledAreaShare,
  stationCount,
  waypointCount,
  countryCount,
  regionsWithoutCountryCount
}) => {
  // Панель легенды считает высоту по фактическому числу видов сомнений
  // (DOUBT_KIND_ORDER), а не по захардкоженному числу строк — так добавление
  // или удаление вида сомнения в исходных данных (как уже случилось один раз
  // за время разработки этого инструмента: появился "removed-micro-hole")
  // не ломает вёрстку легенды молча.
  const doubtsHeadingY = 432;
  const doubtRowsBaseY = 528;
  const doubtRowHeight = 40;
  const doubtKindShapeCount = new Set(
    DOUBT_KIND_ORDER.map((kind) => DOUBT_KIND_STYLE[kind].shape)
  ).size;
  const doubtRows = DOUBT_KIND_ORDER.map((kind, index) => {
    const style = DOUBT_KIND_STYLE[kind];
    const y = doubtRowsBaseY + index * doubtRowHeight;
    const iconX = 3670;
    const icon = doubtMarkerShape(kind, iconX, y - 7).replace(/<title>.*?<\/title>/, "");
    return [
      `      <g transform="translate(0,0)">${icon}</g>`,
      `      <text x="${iconX + 24}" y="${y}">${doubtKindCounts[kind]} · ${xmlEscape(style.title)} ` +
        `(${xmlEscape(kind)})</text>`
    ].join("\n");
  }).join("\n");
  const footerY = doubtRowsBaseY + DOUBT_KIND_ORDER.length * doubtRowHeight + 22;
  const panelHeight = footerY - 30 + 35;

  return `  <g id="legend" font-family="sans-serif">
    <rect x="3625" y="30" width="1420" height="${panelHeight}" rx="20" fill="#0f172a" fill-opacity="0.94" stroke="#e2e8f0" stroke-width="3" />
    <text x="3665" y="80" fill="#ffffff" font-size="30" font-weight="700">Обзор разбиения карты на области</text>
    <text x="3665" y="115" fill="#cbd5e1" font-size="21">${totalRegionCount} областей · ${stationCount} станций · ${waypointCount} полустанка · ${countryCount} стран</text>
    <text x="3665" y="145" fill="#cbd5e1" font-size="21">Подписаны числом области ≥ ${LABEL_AREA_THRESHOLD_PX2} px²:</text>
    <text x="3665" y="172" fill="#cbd5e1" font-size="21">${labelledRegionCount} из ${totalRegionCount} (${round(labelledAreaShare, 1)}% площади карты)</text>
    <text x="3665" y="205" fill="#94a3b8" font-size="19">Заливка — условный цвет по номеру области</text>
    <text x="3665" y="228" fill="#94a3b8" font-size="19">(шаг по кругу оттенков на золотое сечение),</text>
    <text x="3665" y="251" fill="#94a3b8" font-size="19">смысла страны не несёт. Подпись области —</text>
    <text x="3665" y="274" fill="#94a3b8" font-size="19">номер без префикса "map-region-".</text>

    <path d="M3665 305 L3720 305" class="country-contour-halo" />
    <path d="M3665 305 L3720 305" class="country-contour" />
    <text x="3730" y="311" fill="#ffffff" font-size="21">Граница страны (${countryCount}), ${regionsWithoutCountryCount} область без страны</text>

    <g class="station" transform="translate(0,0)">
      <circle cx="3683" cy="345" r="9" />
      <line x1="3677" y1="345" x2="3689" y2="345" />
      <line x1="3683" y1="339" x2="3683" y2="351" />
    </g>
    <text x="3730" y="351" fill="#ffffff" font-size="21">Станция (метка "s" + номер) — принимает грузы</text>

    <g class="waypoint" transform="translate(0,0)">
      <circle cx="3683" cy="387" r="10" />
    </g>
    <text x="3730" y="393" fill="#ffffff" font-size="21">Полустанок (метка "w" + номер) — грузы НЕ принимает</text>
    <rect x="3672" y="408" width="26" height="16" fill="url(#empty-space-hatch)" stroke="#1f2937" stroke-width="1.5"/>
    <text x="3730" y="421" fill="#ffffff" font-size="21">Пустое пространство (${emptySpaceCount}) — не игровая территория</text>

    <text x="3665" y="${doubtsHeadingY}" fill="#fbbf24" font-size="22" font-weight="700">Сомнения — ${DOUBT_KIND_ORDER.length} видов, ${doubtKindShapeCount} форм (см. ниже)</text>
    <text x="3665" y="${doubtsHeadingY + 25}" fill="#94a3b8" font-size="18">метка "d" + номер, разгадка — в doubts.md</text>
    <text x="3665" y="${doubtsHeadingY + 47}" fill="#94a3b8" font-size="18">3 подвида "расхождение способов" — один цвет</text>
    <text x="3665" y="${doubtsHeadingY + 69}" fill="#94a3b8" font-size="18">и форма (круг), различить рисунком внутри него</text>
${doubtRows}
    <text x="3665" y="${footerY}" fill="#64748b" font-size="17">Обзор для человека; в runtime-манифест не подключается.</text>
  </g>`;
};

/**
 * Собрать полный текст SVG-документа.
 *
 * `opaqueBackground` переключает только самый нижний прямоугольник:
 *   true  — для отдельного файла .overview.svg (белая подложка, документ
 *           самодостаточен и открывается сам по себе);
 *   false — для временного растеризования перед наложением на авторский
 *           растр в PNG (см. renderOverviewPng): фон должен быть прозрачным,
 *           чтобы через полупрозрачную заливку областей было видно карту.
 * Содержимое (области, подписи, границы, станции, сомнения, легенда)
 * при этом остаётся одним и тем же — это буквально "то же изображение",
 * как и требуется для PNG-подложки.
 */
const buildOverviewSvgDocument = ({
  regionPartition,
  countriesStations,
  doubtKindCounts,
  opaqueBackground
}) => {
  const { regions, doubts, summary, emptySpaces } = regionPartition;
  const { countries, stations, waypoints } = countriesStations;
  const positions = computeDoubtRenderPositions(doubts);
  const { count: labelledRegionCount, markup: regionLabelsMarkup } =
    renderRegionLabels(regions, LABEL_AREA_THRESHOLD_PX2);
  const labelledAreaShare = 100 *
    regions.filter((region) => region.areaPx2 >= LABEL_AREA_THRESHOLD_PX2)
      .reduce((sum, region) => sum + region.areaPx2, 0) / summary.totalAreaPx2;

  const backgroundRect = opaqueBackground
    ? `  <rect x="0" y="0" width="${CANONICAL_WIDTH}" height="${CANONICAL_HEIGHT}" fill="#eef2f7" />\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANONICAL_WIDTH}" height="${CANONICAL_HEIGHT}" viewBox="0 0 ${CANONICAL_WIDTH} ${CANONICAL_HEIGHT}" role="img" aria-labelledby="title description" data-status="review-overview" data-publishable="false">
  <title id="title">Обзорная карта разбиения авторской карты на области</title>
  <desc id="description">Постоянный обзор ${summary.regionCount} областей и ${summary.doubtCount} сомнительных мест из vector-map.region-partition.draft.json, плюс контуры стран, станции и полустанки из vector-map.countries-stations.draft.json. Только для проверки человеком; в игровой манифест не подключается.</desc>
  <style>
    .region-label { font-family: sans-serif; font-size: 15px; fill: #111827; stroke: #ffffff; stroke-width: 3px; paint-order: stroke; text-anchor: middle; dominant-baseline: middle; font-weight: 600; }
    .country-contour-halo { fill: none; stroke: #ffffff; stroke-width: 11; stroke-opacity: 0.8; stroke-linejoin: round; }
    .country-contour { fill: none; stroke: #111827; stroke-width: 4.2; stroke-opacity: 0.96; stroke-linejoin: round; }
    .station circle { fill: #ec4899; fill-opacity: 0.92; stroke: #831843; stroke-width: 2.2; }
    .station line { stroke: #831843; stroke-width: 2; }
    .station text { font-family: sans-serif; font-size: 14px; fill: #831843; stroke: #ffffff; stroke-width: 3px; paint-order: stroke; font-weight: 700; }
    .waypoint circle { fill: #eab308; fill-opacity: 0.92; stroke: #78350f; stroke-width: 2.4; }
    .waypoint text { font-family: sans-serif; font-size: 14px; fill: #78350f; stroke: #ffffff; stroke-width: 3px; paint-order: stroke; font-weight: 700; }
    .doubt text { font-family: sans-serif; font-size: 13px; fill: #111827; stroke: #ffffff; stroke-width: 3px; paint-order: stroke; font-weight: 700; }
    .empty-space-label { fill: #f8fafc; font-family: sans-serif; font-size: 30px; font-weight: 700; paint-order: stroke; stroke: #111827; stroke-width: 5; }
    .doubt-leader { stroke: #475569; stroke-width: 1.4; stroke-dasharray: 2 3; }
    .doubt-true-point { fill: #111827; stroke: #ffffff; stroke-width: 1; }
    #legend text { fill: #e2e8f0; }
  </style>
  <defs>
    <pattern id="empty-space-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="14" fill="#0f172a" fill-opacity="0.45"/>
      <line x1="0" y1="0" x2="0" y2="14" stroke="#e2e8f0" stroke-width="3" stroke-opacity="0.5"/>
    </pattern>
  </defs>
${backgroundRect}  <g id="regions" aria-label="${regions.length} областей разбиения карты">
${renderRegions(regions)}
  </g>
  <g id="region-labels" aria-label="Номера областей крупнее порога">
${regionLabelsMarkup}
  </g>
  <g id="empty-spaces" aria-label="Пустые пространства: не игровая территория">
${renderEmptySpaces(emptySpaces)}
  </g>
  <g id="country-contours" aria-label="Контуры стран">
${renderCountryContours(countries)}
  </g>
  <g id="stations" aria-label="Станции (принимают грузы)">
${renderStations(stations)}
  </g>
  <g id="waypoints" aria-label="Полустанки (не принимают грузы)">
${renderWaypoints(waypoints)}
  </g>
  <g id="doubts" aria-label="${doubts.length} сомнительных мест разбиения">
${renderDoubts(doubts, positions)}
  </g>
${renderLegend({
    emptySpaceCount: emptySpaces.length,
    doubtKindCounts,
    labelledRegionCount,
    totalRegionCount: regions.length,
    labelledAreaShare,
    stationCount: stations.length,
    waypointCount: waypoints.length,
    countryCount: countries.length,
    regionsWithoutCountryCount: summary.regionsWithoutCountryCount
  })}
</svg>
`;
};

// ---------------------------------------------------------------------------
// Растеризация PNG поверх авторской карты (через sharp — как в build-map-asset.mjs).
// ---------------------------------------------------------------------------

const renderOverviewPng = async (transparentSvgDocument, backgroundBytes) => {
  // Растеризуем схему в её родном разрешении 5079×3627 (совпадает с
  // width/height корневого <svg>), затем накладываем на авторский растр —
  // так области с полупрозрачной заливкой действительно видны поверх карты,
  // а не поверх сплошного белого фона.
  const overlayBuffer = await sharp(Buffer.from(transparentSvgDocument), {
    density: 72
  }).png().toBuffer();
  const composedBuffer = await sharp(backgroundBytes)
    .composite([{ input: overlayBuffer, blend: "over" }])
    .png()
    .toBuffer();
  // Финальное сжатие по ширине: полное разрешение делает файл во много раз
  // тяжелее без заметного выигрыша в читаемости на экране, а вдвое меньшая
  // ширина уже даёт разумный размер файла при сохранении читаемых подписей.
  return sharp(composedBuffer)
    .resize({ width: OVERVIEW_PNG_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
};

// ---------------------------------------------------------------------------
// Markdown-реестр сомнений.
// ---------------------------------------------------------------------------

const CONFIDENCE_LABEL = { low: "низкая", medium: "средняя", high: "высокая" };

/** Доп. числовое поле, характерное для данного вида сомнения (для колонки "детали"). */
const kindSpecificDetail = (doubt) => {
  if (doubt.kind === "unresolved-gap") return `длина разрыва ≈ ${round(doubt.lengthPx, 1)} px`;
  if (doubt.kind === "assumed-connection") return `просвет краски ≈ ${round(doubt.inkGapPx, 2)} px`;
  if (doubt.kind === "collapsed-sliver") {
    return `площадь ${round(doubt.areaPx2, 0)} px², ширина ≈ ${round(doubt.effectiveWidthPx, 2)} px`;
  }
  if (doubt.kind === "country-border-gap-merged") {
    // mergedIntoRegionId называет область, в которую щель фактически вошла —
    // «в какую сторону присоединилась» это половина того, что решает
    // проверяющий человек, наравне с самим спорным контуром (см. outline,
    // который эта таблица не показывает: он нужен инструментам построения
    // схемы, а не текстовому реестру). У этого вида записи щель всегда
    // присоединена (merged: true — иначе проверить нечего, см. схему), так
    // что mergedIntoRegionId здесь никогда не null. foreignAreaPx2 — сколько
    // именно площади щели фактически принадлежало другой стране: это и есть
    // измеренный размер сдвига границы, величина, по которой человеку стоит
    // сортировать и оценивать записи, а не только ширина самой щели.
    return `площадь ${round(doubt.areaPx2, 0)} px², ширина ≈ ${round(doubt.effectiveWidthPx, 2)} px, ` +
      `чужой территории ${round(doubt.foreignAreaPx2, 2)} px², вошла в область ${numericSuffix(doubt.mergedIntoRegionId)}`;
  }
  if (doubt.kind === "removed-micro-hole") {
    return `площадь убранного отверстия ≈ ${round(doubt.areaPx2, 1)} px²`;
  }
  return `площадь спорного участка ≈ ${round(doubt.areaPx2, 0)} px²`;
};

const buildDoubtTable = (doubts, regionPartition) => {
  const header = "| № | Координаты (x, y) | Принятая трактовка | Рассмотренная замена | " +
    "Уверенность | Затронутые области | Доп. детали |\n" +
    "|---|---|---|---|---|---|---|";
  const rows = doubts.map((doubt) => {
    const { regionIds, approximate } = findAffectedRegions(doubt, regionPartition.regions);
    const affected = (approximate ? "≈ " : "") +
      regionIds.map((id) => numericSuffix(id)).join(", ");
    return `| ${numericSuffix(doubt.id)} | ${round(doubt.atX, 1)}, ${round(doubt.atY, 1)} | ` +
      `${doubt.chosenHypothesis} | ${doubt.consideredAlternative} | ` +
      `${CONFIDENCE_LABEL[doubt.confidence] ?? doubt.confidence} | ${affected} | ` +
      `${kindSpecificDetail(doubt)} |`;
  });
  return [header, ...rows].join("\n");
};

const buildDoubtsMarkdown = ({ regionPartition, doubtKindCounts }) => {
  const { doubts, summary, policy } = regionPartition;
  const byKind = Object.fromEntries(
    DOUBT_KIND_ORDER.map((kind) => [kind, doubts.filter((doubt) => doubt.kind === kind)])
  );

  const toc = [
    "## Оглавление",
    "",
    "- [Что это такое](#что-это-такое)",
    "- [Пояснение видов сомнений простыми словами](#пояснение-видов-сомнений-простыми-словами)",
    "- [Сводка по числам](#сводка-по-числам)",
    "- [Незамкнутая граница (unresolved-gap)](#unresolved-gap)",
    "- [Предположенное соединение (assumed-connection)](#assumed-connection)",
    "- [Схлопнутая щель (collapsed-sliver)](#collapsed-sliver)",
    "- [Щель на границе стран (country-border-gap-merged)](#country-border-gap-merged)",
    "- [Убранное микро-отверстие (removed-micro-hole)](#removed-micro-hole)",
    "- [Расхождение способов — объединение (methods-disagree-merged)](#methods-disagree-merged)",
    "- [Расхождение способов — разделение (methods-disagree-split)](#methods-disagree-split)",
    "- [Расхождение способов — нет соответствия (methods-disagree-unmatched)](#methods-disagree-unmatched)",
    "- [Как пользоваться этим документом вместе со схемой](#как-пользоваться-этим-документом-вместе-со-схемой)",
    ""
  ].join("\n");

  const intro = `## Что это такое

Инструмент \`cmt_region_partition.py\` разбил авторскую карту \`draft/trains/Игровая Карта.png\`
на **${summary.regionCount} областей** (region) — замкнутых кусков карты, ограниченных линиями
границ. Для большинства мест это получилось однозначно, но в **${summary.doubtCount} местах**
автоматический расчёт был неоднозначным — такие места здесь называют
**сомнением** (doubt). Этот документ перечисляет все ${summary.doubtCount} сомнений по видам,
с координатами, принятым решением и рассмотренной альтернативой, чтобы
человек мог найти и проверить каждое по номеру.

Координаты \`x, y\` — в общей системе координат карты (0,0 — левый верхний
угол, 5079×3627 пикселей), той же самой, что используется в
\`vector-map.region-partition.draft.json\`. На обзорной схеме
(\`vector-map.region-partition.overview.svg\` и \`.png\`) каждое сомнение
отмечено значком с подписью **"d" + номер** (например, "d0142" для
\`doubt-0142\`) — этот номер совпадает с колонкой "№" в таблицах ниже.
`;

  const glossary = `## Пояснение видов сомнений простыми словами

- **область (region)** — замкнутый кусок карты, окружённый линиями границ;
  примерно то же самое, что кусок мозаики.
- **граница (boundary)** — напечатанная на карте линия, отделяющая одну
  область или страну от другой.
- **полоса краски (ink)** — то, что на самом деле напечатано: у любой линии
  есть реальная ширина (толщина мазка), а не только воображаемая
  бесконечно тонкая осевая линия посередине.
- **способ «осевые» и способ «краска»** — два разных автоматических приёма
  расчёта площади области. «Осевые» строит области по воображаемым тонким
  линиям посередине полос краски и добавляет запас (допуск), вычисленный
  по толщине реальных линий карты. «Краска» строит области по свободному
  от краски пространству напрямую, без допуска. Обычно они совпадают;
  когда результаты расходятся — это и есть сомнение вида
  «расхождение способов» (methods-disagree-*). Принятым по умолчанию
  считается способ «осевые» (см. \`policy.authoritativeMethod\` в JSON),
  а «краска» используется только для проверки.
- **щель (sliver)** — очень узкая полоска площади у границы страны,
  настолько тонкая, что не может быть самостоятельной областью; такую
  щель присоединяют к соседней области.
- **внутреннее отверстие (hole)** — маленький "остров" пустоты целиком
  внутри области, а не на её краю (в отличие от щели). Если такое
  отверстие ничтожно мало, его убирают как шум измерения, а не оставляют
  как настоящий анклав.
- **уверенность (confidence)** — насколько автоматическое решение
  надёжно: низкая, средняя или высокая.

Восемь видов сомнений:

1. **unresolved-gap** — «незамкнутая граница»: на карте есть линия, которая
   должна была бы упереться в другую линию и замкнуть границу, но их
   полосы краски не сходятся. Соединение решили не создавать — граница
   так и осталась разомкнутой.
2. **assumed-connection** — «предположенное соединение»: концы двух линий
   не касаются полосой краски впритык, но промежуток между ними тоньше
   самой линии — настолько мал, что решили считать их соединёнными.
   Это предположение, а не точное совпадение.
3. **collapsed-sliver** — «схлопнутая щель»: узкая щель у границы страны
   присоединена к соседней области, а не оставлена отдельной областью. Щель
   целиком лежала внутри своей же страны (или её вообще не удалось ни к
   чему присоединить) — государственной границы это решение не касается.
4. **country-border-gap-merged** — «щель на границе стран»: тот же приём
   присоединения, что и у collapsed-sliver, но часть площади щели (см.
   foreignAreaPx2) в действительности лежала в заливке ДРУГОЙ страны, чем та,
   которой досталась область после присоединения, — проверено напрямую
   пересечением контура щели (outline) с авторскими заливками стран, а не
   через приближение (расстояние или долю перекрытия). Присоединение слегка
   сдвинуло государственную границу — ровно на измеренную площадь
   foreignAreaPx2, а не только «на ширину щели».
5. **removed-micro-hole** — «убранное микро-отверстие»: ничтожно маленькое
   внутреннее отверстие внутри области сочли шумом измерения и убрали,
   а не оставили как настоящий анклав внутри области.
6. **methods-disagree-merged** — способ «осевые» (принятый) объединил
   область с соседней, а способ «краска» (проверочный) считает её
   отдельной.
7. **methods-disagree-split** — способ «осевые» разделил область на части,
   а способ «краска» считает её единой.
8. **methods-disagree-unmatched** — способ «краска» вообще не даёт для
   этого места однозначного соответствия ни с одной областью способа
   «осевые».

В таблицах ниже колонка **"Затронутые области"** показывает номер(а)
области рядом с местом сомнения (определено проверкой "точка внутри
контура области"). Если сомнение стоит прямо в разрыве границы и поэтому
не попадает внутрь ни одной области, показаны **2 ближайшие по краю
области** с пометкой «≈» — это приближение, а не точное включение.
`;

  const summaryTable = `## Сводка по числам

Всего сомнений: **${summary.doubtCount}** из ${summary.regionCount} областей
(итоговая площадь всех областей — ${Math.round(summary.totalAreaPx2)} px²).
Принятый метод разбиения — \`${policy.authoritativeMethod}\` (решение
\`${policy.decision}\`), проверочный — \`${policy.verificationMethod}\`.

| Вид | Число | Доля от всех сомнений |
|---|---|---|
${DOUBT_KIND_ORDER.map((kind) => {
  const count = doubtKindCounts[kind];
  const share = round((100 * count) / summary.doubtCount, 1);
  return `| ${DOUBT_KIND_STYLE[kind].title} (\`${kind}\`) | ${count} | ${share}% |`;
}).join("\n")}
| **Итого** | **${summary.doubtCount}** | 100% |
`;

  const SHAPE_NAME_RU = {
    triangle: "треугольник",
    diamond: "ромб",
    square: "квадрат",
    star: "четырёхконечная звезда",
    circle: "круг"
  };
  const VARIANT_NAME_RU = {
    solid: "со сплошной заливкой",
    ring: "в виде кольца с полой серединой",
    bullseye: "с белой точкой в центре"
  };

  const kindSection = (kind, anchorTitle) => {
    const list = byKind[kind];
    const style = DOUBT_KIND_STYLE[kind];
    return `## ${anchorTitle}

${style.title} — ${list.length} мест. На схеме отмечены значком «${SHAPE_NAME_RU[style.shape]}»
цвета ${style.fill} (${VARIANT_NAME_RU[style.variant]}).

${buildDoubtTable(list, regionPartition)}
`;
  };

  const usage = `## Как пользоваться этим документом вместе со схемой

1. На обзорной схеме (\`vector-map.region-partition.overview.svg\` или
   \`.png\`) найдите значок сомнения нужной формы и цвета, посмотрите
   подпись вида "d" + номер (например, "d0068").
2. Отбросьте букву "d" — получится номер, например "0068" для
   \`doubt-0068\`.
3. Найдите строку с этим номером в таблице нужного вида ниже — там
   указаны точные координаты, принятая трактовка, рассмотренная
   альтернатива, уверенность и затронутые области.
4. Номера затронутых областей (колонка "Затронутые области") совпадают
   с подписями областей на схеме (только для областей крупнее
   ${LABEL_AREA_THRESHOLD_PX2} px² — более мелкие подписаны только в
   JSON-файле \`vector-map.region-partition.draft.json\`).
5. Для точных числовых полей (все десятичные знаки, идентификаторы
   кандидатов границ и т.п.) — смотрите тот же JSON-файл по номеру
   \`doubt-NNNN\`.
`;

  return [
    "# Реестр сомнительных мест разбиения карты на области",
    "",
    toc,
    intro,
    glossary,
    summaryTable,
    kindSection("unresolved-gap", "Незамкнутая граница (unresolved-gap) {#unresolved-gap}"),
    kindSection("assumed-connection", "Предположенное соединение (assumed-connection) {#assumed-connection}"),
    kindSection("collapsed-sliver", "Схлопнутая щель (collapsed-sliver) {#collapsed-sliver}"),
    kindSection(
      "country-border-gap-merged",
      "Щель на границе стран (country-border-gap-merged) {#country-border-gap-merged}"
    ),
    kindSection(
      "removed-micro-hole",
      "Убранное микро-отверстие (removed-micro-hole) {#removed-micro-hole}"
    ),
    kindSection(
      "methods-disagree-merged",
      "Расхождение способов — объединение (methods-disagree-merged) {#methods-disagree-merged}"
    ),
    kindSection(
      "methods-disagree-split",
      "Расхождение способов — разделение (methods-disagree-split) {#methods-disagree-split}"
    ),
    kindSection(
      "methods-disagree-unmatched",
      "Расхождение способов — нет соответствия (methods-disagree-unmatched) {#methods-disagree-unmatched}"
    ),
    usage
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Атомарная запись и проверка "не устарело ли" (--check), по образцу
// render-vector-map-classification-review.mjs / build-vector-map-polygonization-review.mjs.
// ---------------------------------------------------------------------------

const removeTemporaryFile = async (filePath) => {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeExclusiveTemporaryFile = async (targetPath, content) => {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`
  );
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o644
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
  await handle.close();
  return temporaryPath;
};

const syncDirectories = async (directories) => {
  for (const directory of new Set(directories)) {
    const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

const writeArtifactsAtomically = async (artifacts) => {
  const temporaryFiles = [];
  try {
    for (const artifact of artifacts) {
      temporaryFiles.push({
        targetPath: artifact.targetPath,
        temporaryPath: await writeExclusiveTemporaryFile(artifact.targetPath, artifact.content)
      });
    }
    for (const temporary of temporaryFiles) {
      await rename(temporary.temporaryPath, temporary.targetPath);
      temporary.temporaryPath = null;
    }
    await syncDirectories(artifacts.map((artifact) => path.dirname(artifact.targetPath)));
  } finally {
    await Promise.all(temporaryFiles.map((temporary) => removeTemporaryFile(temporary.temporaryPath)));
  }
};

const assertFileMatches = async (filePath, expectedBytes) => {
  let actualBytes;
  try {
    actualBytes = await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${filePath} is missing; run the renderer without --check`);
    throw error;
  }
  const expectedBuffer = Buffer.isBuffer(expectedBytes) ? expectedBytes : Buffer.from(expectedBytes);
  if (!actualBytes.equals(expectedBuffer)) {
    fail(`${filePath} is stale relative to its inputs; regenerate the region-partition overview`);
  }
};

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const parseArguments = (argv) => {
  const options = { check: false };
  for (const argument of argv) {
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  return options;
};

export const runRegionPartitionOverviewCli = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);

  await assertSafeOutputPath(DEFAULT_SVG_OUTPUT_PATH, [
    DEFAULT_REGION_PARTITION_PATH,
    DEFAULT_COUNTRIES_STATIONS_PATH,
    DEFAULT_BACKGROUND_PATH
  ]);
  await assertSafeOutputPath(DEFAULT_PNG_OUTPUT_PATH, [
    DEFAULT_REGION_PARTITION_PATH,
    DEFAULT_COUNTRIES_STATIONS_PATH,
    DEFAULT_BACKGROUND_PATH
  ]);
  await assertSafeOutputPath(DEFAULT_MD_OUTPUT_PATH, [
    DEFAULT_REGION_PARTITION_PATH,
    DEFAULT_COUNTRIES_STATIONS_PATH,
    DEFAULT_BACKGROUND_PATH
  ]);

  const { regionPartition, countriesStations, backgroundBytes, doubtKindCounts } = await loadInputs({
    regionPartitionPath: DEFAULT_REGION_PARTITION_PATH,
    countriesStationsPath: DEFAULT_COUNTRIES_STATIONS_PATH,
    backgroundPath: DEFAULT_BACKGROUND_PATH
  });

  const standaloneSvg = buildOverviewSvgDocument({
    regionPartition,
    countriesStations,
    doubtKindCounts,
    opaqueBackground: true
  });
  const transparentSvg = buildOverviewSvgDocument({
    regionPartition,
    countriesStations,
    doubtKindCounts,
    opaqueBackground: false
  });
  const pngBuffer = await renderOverviewPng(transparentSvg, backgroundBytes);
  const markdown = buildDoubtsMarkdown({ regionPartition, doubtKindCounts });

  const reportLine =
    `region-partition overview: ${regionPartition.regions.length} regions, ` +
    `${regionPartition.doubts.length} doubts, ` +
    `${pngBuffer.byteLength} PNG bytes.\n`;

  if (options.check) {
    await assertFileMatches(DEFAULT_SVG_OUTPUT_PATH, standaloneSvg);
    await assertFileMatches(DEFAULT_PNG_OUTPUT_PATH, pngBuffer);
    await assertFileMatches(DEFAULT_MD_OUTPUT_PATH, markdown);
    process.stdout.write(`Region-partition overview is current: ${reportLine}`);
    return { regionPartition, countriesStations };
  }

  await writeArtifactsAtomically([
    { targetPath: DEFAULT_SVG_OUTPUT_PATH, content: standaloneSvg },
    { targetPath: DEFAULT_PNG_OUTPUT_PATH, content: pngBuffer },
    { targetPath: DEFAULT_MD_OUTPUT_PATH, content: markdown }
  ]);
  process.stdout.write(`Wrote region-partition overview: ${reportLine}`);
  return { regionPartition, countriesStations };
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runRegionPartitionOverviewCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
