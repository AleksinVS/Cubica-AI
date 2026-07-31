#!/usr/bin/env node
/**
 * Вырезать увеличенные кадры вокруг самых широких «сомнений» разбиения карты
 * на области, чтобы человек мог принять решение за несколько минут.
 *
 * Зачем этот инструмент нужен. `cmt_region_partition.py` разбил авторскую
 * карту на 917 «областей» (region — замкнутый кусок карты, окружённый линиями
 * границ) и зафиксировал несколько сотен мест, где решение не было
 * однозначным («сомнение», doubt — см. `render-region-partition-overview.mjs`).
 * Один вид сомнения — `country-border-gap-merged` — устроен так: узкая щель
 * лежала на стыке двух стран, автоматика присоединила её к одной из соседних
 * областей, и часть площади щели (`foreignAreaPx2`) в действительности
 * принадлежала ДРУГОЙ стране — государственная граница на этом участке
 * сдвинулась ровно на эту площадь. Таких записей — несколько сотен, и никто
 * не будет читать их все как JSON: продюсеру нужно посмотреть на самые
 * крупные передачи территории и сказать, приемлемы ли они.
 *
 * Инструмент строит для каждого выбранного сомнения одну картинку: кусок
 * авторского растра вокруг точки сомнения, увеличенный методом ближайшего
 * соседа (без сглаживания — иначе интерполяция сама «спрячет» именно тот
 * сдвиг в несколько точек, который нужно разглядеть), с наложенным поверх
 * разбиением. На картинке — три слоя: тонкой линией показаны границы всех
 * областей в кадре; толстой линией — государственная граница **по
 * разбиению** (та, что нужно проверить: она вычислена из самих областей, а
 * не взята из авторской заливки — см. пояснение ниже и `computeStateBorderEdges`);
 * закрашенным контуром `outline` самой щели — **сама спорная полоса**, то
 * есть в точности та территория, которая перешла другой стране (для видов
 * сомнения, у которых есть это поле); маленькой меткой — сама точка
 * сомнения. Внутри картинки есть подпись с легендой цветов: идентификатор
 * сомнения, вид, перенесённая площадь и ширина щели, названия обеих стран.
 * Плюс один файл-указатель `index.md` со списком вырезанных картинок и
 * сводкой по всему явлению (сколько всего таких записей и какую долю карты
 * они в сумме затрагивают — без этого числа отдельные картинки нечем
 * оценить: то ли это единичный случай, то ли обычное дело).
 *
 * Почему на картинке нет второй, «авторской» линии границы. Более ранняя
 * версия этого инструмента рисовала контур страны из
 * `countriesStations.countries[].contour` рядом с границей "по разбиению",
 * рассчитывая показать разницу "было/стало". Проверка расстояния между этими
 * двумя линиями в середине всех 2213 межстрановых рёбер разбиения — отдельно
 * для рёбер рядом с сомнением и рёбер вдали от любого сомнения — дала
 * одинаковые распределения (медиана 0 px, p90 ~1.3–1.8 px, максимум ~4.2–4.3 px
 * в обеих группах). То есть расхождение между авторским контуром и разбиением
 * — это шум измерения самого контура (другой способ извлечения границы из
 * растра), а не эффект присоединения щели: показывать его как "до/после"
 * сообщало бы неправду. Вместо этого решение показывается напрямую — заливкой
 * контура самой щели (`outline`), а не выводом из сравнения двух независимо
 * построенных линий.
 *
 * Почему граница "по разбиению" всё же строится заново, а не берётся из
 * готового контура страны: контур страны — это авторская заливка, извлечённая
 * из векторной карты независимо от разбиения на области, и не обязана точно
 * совпадать с линией разбиения (см. выше). Граница "по разбиению" строится из
 * самих `regions[]`: каждое ребро (отрезок между двумя соседними точками
 * кольца области) собирается в общий индекс по обеим областям, которые его
 * используют. Ребро — государственная граница, если области по разные его
 * стороны принадлежат разным странам (`countryId`), или если ребро вообще
 * ничьё, кроме одной области (это внешний край всей играбельной территории).
 * Сопоставление рёбер — по точным координатам, без допуска: области выходят
 * из одного планарного разбиения, поэтому общее ребро двух соседей записано
 * побайтово одинаковыми числами в обеих областях (проверено на реальном
 * черновике — см. `computeStateBorderEdges`).
 *
 * Источники (все — только для чтения, этот инструмент их не меняет и не
 * пишет ни во что внутри `annotations/` или `draft/`):
 *   - `annotations/vector-map.region-partition.draft.json`   (области, сомнения);
 *   - `annotations/vector-map.countries-stations.draft.json` (названия стран);
 *   - `draft/trains/Игровая Карта.png`                       (авторский растр).
 *
 * Результат — регенерируемый материал для проверки, а не публикуемый
 * артефакт, поэтому по умолчанию он пишется под `.tmp/` (см. правило о
 * временных файлах в корневом `CLAUDE.md`), а не в `annotations/`, где прямо
 * сейчас пересобирается другая задача.
 *
 * Способ построения PNG (SVG-оверлей поверх авторского растра через sharp) и
 * общий стиль подсказаны соседним `render-region-partition-overview.mjs` —
 * см. его заголовочный комментарий; здесь это тот же приём, применённый не ко
 * всей карте разом, а к маленькому окну вокруг одного сомнения, поэтому код
 * не переиспользуется напрямую (правки в overview-инструменте запрещены
 * условием задачи), а повторяет тот же подход в новом файле.
 */

import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const moduleFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");
const gameRoot = path.join(repoRoot, "games", "cards-money-trains");
const annotationsDirectory = path.join(gameRoot, "annotations");
const draftDirectory = path.join(repoRoot, "draft");

const DEFAULT_REGION_PARTITION_PATH = path.join(
  annotationsDirectory,
  "vector-map.region-partition.draft.json"
);
const DEFAULT_COUNTRIES_STATIONS_PATH = path.join(
  annotationsDirectory,
  "vector-map.countries-stations.draft.json"
);
const DEFAULT_BACKGROUND_PATH = path.join(draftDirectory, "trains", "Игровая Карта.png");
const DEFAULT_OUTPUT_DIRECTORY = path.join(repoRoot, ".tmp", "region-partition-doubt-crops");

const DEFAULT_KIND = "country-border-gap-merged";

/**
 * Сколько сомнений кропить по умолчанию.
 *
 * Раньше здесь стояло 20 — разумный предел, когда сомнений этого вида было
 * больше тысячи. После пересборки черновика их 393, и распределение
 * измеренной переносимой площади (`foreignAreaPx2`) резко неровное: только
 * 36 записей превышают 100 px², и только 6 — 300 px² (числа считаются заново
 * из файла при каждом запуске, см. describeForeignAreaPopulation — здесь не
 * зашиты). 20 из 393 — слишком тонкий срез, если "заметных" записей уже 36:
 * часть из них осталась бы вовсе не увиденной. 40 — с запасом покрывает весь
 * заметный "хвост" распределения (36 записей >100 px² плюс несколько чуть
 * ниже порога для контекста), оставаясь при этом кадром, который человек
 * реально просмотрит за несколько минут, а не сотнями изображений.
 */
const DEFAULT_LIMIT = 40;

// Область — большой JSON (~6.5 МБ), контуры стран — раз в 10 меньше;
// растровая подложка — несколько МБ. Ограничения защищают от неожиданной
// подмены входного файла на слишком большой перед разбором JSON/растра —
// то же обоснование, что и в render-region-partition-overview.mjs.
const JSON_LIMIT = 32 * 1024 * 1024;
const PNG_LIMIT = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Размер окна кропа и увеличение — оба выводятся из измеренной толщины
// авторского штриха, а не подбираются на глаз.
// ---------------------------------------------------------------------------

/**
 * Толщина основной линии карты в точках (авторский штрих).
 *
 * Измерена и объяснена в `cmt_region_partition.py` (константа
 * `DOMINANT_STROKE_WIDTH_PX`, строка с комментарием "Толщина основной линии
 * карты… 909 из 979 обводок-кандидатов"): это не назначенное, а измеренное по
 * авторскому файлу число. Значение скопировано сюда как число, а не через
 * импорт, потому что `cmt_region_partition.py` — python-инструмент, а этот —
 * mjs, и правка существующих инструментов в этой задаче запрещена условием
 * задания.
 */
const DOMINANT_STROKE_WIDTH_PX = 6.970;

/**
 * Множитель окна кропа относительно толщины штриха.
 *
 * Самый широкий зафиксированный сдвиг границы страны в черновике — около
 * 6.6 точки (эффективная ширина щели `country-border-gap-merged`, то есть он
 * уже сопоставим по размеру с самой толщиной штриха). Окно в 30 штрихов
 * (≈209×209 точек) даёт кадр, в который целиком помещается спорный участок
 * границы вместе с обеими смежными областями — то есть видно не только сам
 * сдвиг, но и то, куда он ведёт по контуру. При этом типичный сдвиг в 5 точек
 * — это ещё заметная доля кадра (~2.4% его ширины), а не потерянный в большом
 * куске карты пиксель. Меньший множитель прижимал бы кадр вплотную к щели и
 * лишал бы контекста для решения; больший — прятал бы сдвиг среди слишком
 * большого куска карты.
 */
const WINDOW_SIDE_STROKE_MULTIPLE = 30;
const WINDOW_SIDE_PX = Math.round(WINDOW_SIDE_STROKE_MULTIPLE * DOMINANT_STROKE_WIDTH_PX);

/**
 * Увеличение методом ближайшего соседа (без интерполяции).
 *
 * Интерполяция (билинейная/кубическая) размывает резкую ступеньку сдвига в
 * плавный градиент в несколько пикселей — то есть спрятала бы именно то, что
 * нужно измерить на глаз. Ближайший сосед просто повторяет каждую исходную
 * точку в блок ×7, поэтому реальные пиксели авторского растра остаются
 * различимы поштучно. При окне 209×209 это даёт готовую картинку ~1463×1463
 * точки (плюс подпись) — сдвиг в 5 исходных точек становится ~35 экранными
 * пикселями, разборчиво даже при беглом просмотре.
 */
const UPSCALE_FACTOR = 7;

// Высота подписи внутри картинки (в конечных, уже увеличенных пикселях).
// Пять строк подписи (id+вид, ширина+площадь, страны, цветовая легенда двух
// границ, техническая справка про масштаб) с запасом на отступы — 185
// пикселей достаточно при выбранном размере шрифта, не отбирая заметную
// долю кадра у самой карты.
const CAPTION_HEIGHT_PX = 185;

// Радиус метки места сомнения. Взят как треть толщины штриха — метка заметно
// меньше самого штриха (не перекрывает соседнюю геометрию), но после
// увеличения ×7 остаётся крупным аккуратным кружком, а не точкой.
const DOUBT_MARKER_RADIUS_PX = Math.max(2, DOMINANT_STROKE_WIDTH_PX / 3);

// Толщина линии обычной границы области — тонкая линия, как и требует
// задание.
const REGION_BOUNDARY_STROKE_WIDTH_PX = 1.3;

// Толщина границы страны "по разбиению" (предмет проверки) — как в
// render-region-partition-overview.mjs (та же величина 4.2 для того же
// смысла на той же карте), то есть заметно, в три с лишним раза, толще линии
// области и сразу узнаётся.
const PARTITION_STATE_BORDER_STROKE_WIDTH_PX = 4.2;

/**
 * Стиль заливки самой щели (`outline`).
 *
 * Первая версия рисовала заливку одним слоем под границей "по разбиению" —
 * и щель почти всегда исчезала полностью: граница+гало шириной ~6.8–9.4 точки
 * (см. PARTITION_STATE_BORDER_STROKE_WIDTH_PX) толще самой щели (обычно
 * 1–5 точек), а граница как раз и проходит вдоль одного из краёв щели (после
 * присоединения щели к соседу новая граница — это её дальний край), поэтому
 * рисование "гранныица поверх щели" стирало щель с картинки целиком —
 * проверено на реальном кропе (самая широкая и самая мелкая передачи —
 * розовой заливки не было видно вовсе).
 *
 * Поэтому щель рисуется в два прохода: полупрозрачная заливка — низко, под
 * границей (тогда видно, что граница проходит по спорной территории, а не
 * рядом с ней), а чёткая обводка контура щели — поверх границы (тогда
 * видна её истинная протяжённость, даже там, где заливку целиком перекрыла
 * широкая граница с гало).
 */
const SLIVER_FILL_COLOR = "#ec4899";
const SLIVER_FILL_OPACITY = 0.5;
const SLIVER_OUTLINE_STROKE_COLOR = "#831843";
const SLIVER_OUTLINE_STROKE_WIDTH_PX = 2.0;

// ---------------------------------------------------------------------------
// Виды сомнений и их заголовки для человека — тот же список и те же
// формулировки, что в render-region-partition-overview.mjs (там они входят в
// DOUBT_KIND_STYLE.title). Скопировано, а не импортировано, по той же причине:
// правка соседнего файла запрещена условием задания.
// ---------------------------------------------------------------------------

const DOUBT_KIND_TITLES = {
  "unresolved-gap": "Незамкнутая граница",
  "assumed-connection": "Предположенное соединение",
  "collapsed-sliver": "Схлопнутая щель",
  "country-border-gap-merged": "Щель на границе стран",
  "removed-micro-hole": "Убранное микро-отверстие",
  "methods-disagree-merged": "Расхождение способов — объединение",
  "methods-disagree-split": "Расхождение способов — разделение",
  "methods-disagree-unmatched": "Расхождение способов — нет соответствия"
};

/**
 * Числовая мера "насколько крупная запись", отдельно на выбор (сортировку) и
 * на показ, для тех видов сомнения, которые этот инструмент умеет кропить.
 *
 * Только эти два вида несут числовое поле, по которому имеет смысл выбирать
 * "самые крупные первыми" — остальные пять видов (`unresolved-gap` и т.д.)
 * либо вовсе не измеряют величину в этом смысле, либо измеряют что-то
 * несопоставимое (длину разрыва, просвет краски), поэтому не перечислены
 * здесь и отклоняются с понятным сообщением в buildDoubtCrops.
 *
 * `field` — то самое поле сомнения, по которому сортируем и которое считаем
 * "главным числом" в подписи и в первой колонке индекса. Для
 * `country-border-gap-merged` это `foreignAreaPx2` — площадь, которая
 * действительно сменила страну (а не `effectiveWidthPx`, который лишь
 * говорит, насколько тонкой была полоса; см. заголовочный комментарий и
 * задание, приведшее к этой правке). `hasStrip` включает отрисовку заливки
 * `outline` и её объяснение в подписи/индексе — только у видов, где это поле
 * вообще есть в схеме. `showTransferredAreaSummary` включает отдельный абзац
 * в index.md с общей статистикой по всем записям этого вида (не только по
 * выбранным) — она была явно запрошена только для `country-border-gap-merged`,
 * где "площадь" имеет смысл "территория, сменившая страну".
 */
const DOUBT_KIND_METRICS = {
  "country-border-gap-merged": {
    field: "foreignAreaPx2",
    label: "перенесено",
    unit: "px²",
    digits: 1,
    secondaryField: "effectiveWidthPx",
    secondaryLabel: "ширина щели",
    secondaryUnit: "px",
    secondaryDigits: 3,
    hasStrip: true,
    showTransferredAreaSummary: true
  },
  "collapsed-sliver": {
    field: "effectiveWidthPx",
    label: "ширина",
    unit: "px",
    digits: 3,
    secondaryField: "areaPx2",
    secondaryLabel: "площадь",
    secondaryUnit: "px²",
    secondaryDigits: 1,
    hasStrip: false,
    showTransferredAreaSummary: false
  }
};

const fail = (message) => {
  throw new Error(message);
};

/** Округление числа с фиксированным числом знаков — для детерминированного вывода. */
const round = (value, digits = 2) => Number(value.toFixed(digits));

const xmlEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

// ---------------------------------------------------------------------------
// Безопасное, ограниченное по размеру чтение входных файлов без записи в них.
// Тот же приём и то же обоснование, что в render-region-partition-overview.mjs
// и extract-vector-map-review.mjs: защититься от гонки (файл подменили, пока
// мы его читали) и от неожиданно огромного файла ещё до разбора.
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

/**
 * Проверить, что путь `candidate` лежит внутри `parent` (или совпадает с ним).
 * Используется, чтобы навсегда запретить запись в защищённые каталоги.
 */
const isPathWithinOrEqual = (parent, candidate) => {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedParent) return true;
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * Отказ, если каталог вывода — символическая ссылка либо лежит внутри
 * `annotations/` или `draft/`. Оба запрета — прямое требование задания: этот
 * инструмент читает оттуда, но никогда не пишет туда, а `annotations/`
 * прямо сейчас параллельно пересобирается другой задачей.
 */
const assertOutputDirectoryIsSafe = async (outputDirectory) => {
  for (const forbidden of [annotationsDirectory, draftDirectory]) {
    if (isPathWithinOrEqual(forbidden, outputDirectory)) {
      fail(`${outputDirectory} must not be inside ${forbidden} (protected read-only area)`);
    }
  }
  let stats;
  try {
    stats = await lstat(path.resolve(outputDirectory));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    stats = null;
  }
  if (stats?.isSymbolicLink()) fail(`${outputDirectory} must not be a symbolic link`);
};

// ---------------------------------------------------------------------------
// Загрузка входных данных. Никакой глубокой перекрёстной проверки со
// summary — она уже выполняется в render-region-partition-overview.mjs;
// здесь только минимум, нужный для собственно кропа.
// ---------------------------------------------------------------------------

const loadDoubtCropInputs = async ({ regionPartitionPath, countriesStationsPath, backgroundPath }) => {
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
  if (!Array.isArray(countriesStations.countries)) {
    fail("countries-stations draft is missing countries[]");
  }

  // Размер растра читается из самого файла, а не берётся жёстко зашитым
  // "каноническим" числом: инструмент, в отличие от постоянного обзора, не
  // публикует ничего, что должно совпадать байт-в-байт с эталоном, а координаты
  // сомнений и растр всегда приходят парой из одних и тех же путей по
  // умолчанию — подмена одного без другого сюда не пройдёт незамеченной,
  // потому что `--out` не даёт подменить входы, только каталог вывода.
  const backgroundMetadata = await sharp(backgroundBytes).metadata();
  const rasterWidth = backgroundMetadata.width;
  const rasterHeight = backgroundMetadata.height;
  if (!Number.isInteger(rasterWidth) || !Number.isInteger(rasterHeight) ||
    rasterWidth <= 0 || rasterHeight <= 0) {
    fail(`${backgroundPath}: unexpected raster dimensions ${rasterWidth}x${rasterHeight}`);
  }

  return { regionPartition, countriesStations, backgroundBytes, rasterWidth, rasterHeight };
};

// ---------------------------------------------------------------------------
// Выбор сомнений: самые крупные по выбранной мере первыми, ничьи
// разрешаются по id, чтобы два запуска подряд выбирали одни и те же записи
// (требование задания).
// ---------------------------------------------------------------------------

/**
 * Отсортировать и обрезать список сомнений одного вида по числовому полю
 * `metricField` (см. DOUBT_KIND_METRICS — для `country-border-gap-merged`
 * это `foreignAreaPx2`, а не `effectiveWidthPx`: ширина говорит, насколько
 * тонкой была полоса, а перенесённая площадь — сколько территории в
 * действительности сменило страну, то есть то, что и должен оценивать
 * проверяющий человек). Чистая функция — тестируется без файлов.
 */
export const selectDoubtsForCrop = (doubtsOfKind, limit, metricField) => [...doubtsOfKind]
  .sort((left, right) => (right[metricField] - left[metricField]) || left.id.localeCompare(right.id))
  .slice(0, limit);

// ---------------------------------------------------------------------------
// Геометрия окна кропа: центрировать на точке сомнения и прижать к краям
// растра, никогда не выходя за его пределы и никогда не давая отрицательные
// координаты (в том числе когда сомнение стоит у самого края карты).
// ---------------------------------------------------------------------------

/** Чистая функция — тестируется без файлов и без sharp. */
export const computeCropWindow = (atX, atY, sidePx, rasterWidth, rasterHeight) => {
  const width = Math.max(1, Math.min(Math.round(sidePx), Math.round(rasterWidth)));
  const height = Math.max(1, Math.min(Math.round(sidePx), Math.round(rasterHeight)));
  const rawX = Math.round(atX - width / 2);
  const rawY = Math.round(atY - height / 2);
  const x = Math.max(0, Math.min(rawX, Math.round(rasterWidth) - width));
  const y = Math.max(0, Math.min(rawY, Math.round(rasterHeight) - height));
  return { x, y, width, height };
};

const boundsIntersectWindow = (bounds, window) =>
  bounds.maxX >= window.x && bounds.minX <= window.x + window.width &&
  bounds.maxY >= window.y && bounds.minY <= window.y + window.height;

const regionsOverlappingWindow = (regions, window) =>
  regions.filter((region) => boundsIntersectWindow(region.bounds, window));

// ---------------------------------------------------------------------------
// Государственная граница "по разбиению" — вычисляется из самих областей, а
// не берётся из готового авторского контура страны (см. заголовочный
// комментарий файла: контур страны — это старая, дощелевая граница, и
// показывать её как "текущую" означало бы прятать именно тот сдвиг, который
// нужно проверить).
//
// Приём: каждая область — многоугольник(и) (внешнее кольцо плюс, в общем
// случае, внутренние кольца-дыры); каждое ребро многоугольника — отрезок
// между двумя соседними точками кольца. Планарное разбиение устроено так,
// что общее ребро двух соседних областей записано в обеих одними и теми же
// координатами (см. cmt_region_partition.py: разбиение строится по точкам
// пересечения полос краски, поэтому у соседей это буквально одна и та же
// пара чисел, а не два близких, но разных отрезка). Это позволяет находить
// пары "сосед-сосед" точным сравнением координат — без допуска и без
// пространственного поиска ближайшего соседа, которые задание прямо
// запрещает: "области выходят из одного планарного разбиения, поэтому общие
// рёбра побайтово совпадают между соседями — никакого допуска, никакого
// нечёткого сопоставления".
// ---------------------------------------------------------------------------

/** Точный, не округляемый ключ точки — совпадает только при побитовом равенстве координат. */
const pointKey = ([x, y]) => `${x},${y}`;

/** Ключ ребра не зависит от направления обхода: одно и то же ребро двух соседей должно совпасть. */
const edgeKey = (p1, p2) => {
  const a = pointKey(p1);
  const b = pointKey(p2);
  return a < b ? `${a}/${b}` : `${b}/${a}`;
};

/**
 * Собрать индекс "ребро → кто его использует" по всем областям сразу.
 *
 * Индекс строится один раз для всего черновика (а не отдельно для каждого
 * кропа — рёбра глобальны и не зависят от окна), после чего для каждого
 * кропа нужный участок просто отбирается по границам окна.
 */
const buildRegionEdgeIndex = (regions) => {
  const edgesByKey = new Map();
  for (const region of regions) {
    const rings = [region.exteriorRing, ...(region.interiorRings ?? [])];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 1) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % ring.length];
        const key = edgeKey(p1, p2);
        let entry = edgesByKey.get(key);
        if (!entry) {
          entry = { p1, p2, usages: [] };
          edgesByKey.set(key, entry);
        }
        entry.usages.push({ regionId: region.id, countryId: region.countryId ?? null });
      }
    }
  }
  return edgesByKey;
};

/**
 * Классифицировать рёбра разбиения и вернуть только те, что составляют
 * государственную границу "по разбиению": ребро на стыке двух разных стран,
 * либо ребро на самом краю играбельной территории (используется только
 * одной областью — соседа с другой стороны попросту нет).
 *
 * Ровно два пользователя одного ребра — единственный ожидаемый случай для
 * внутреннего ребра планарного разбиения (у отрезка есть не более двух
 * сторон). Если у ребра оказалось три и более пользователей — это не какая-то
 * мелкая неточность, которую можно списать на допуск (никакого допуска здесь
 * и нет: совпадение уже проверено точно), а признак того, что черновик — не
 * настоящее планарное разбиение, каким он себя называет. Это значительно
 * более серьёзная находка, чем этот инструмент, поэтому здесь — отказ с
 * понятным сообщением, а не попытка угадать правильную пару.
 */
export const computeStateBorderEdges = (regions) => {
  const edgesByKey = buildRegionEdgeIndex(regions);
  const stateBorderEdges = [];
  for (const edge of edgesByKey.values()) {
    if (edge.usages.length === 1) {
      // Внешний край играбельной территории — тоже государственная граница
      // по смыслу задания, даже если формально у неё только один "хозяин".
      stateBorderEdges.push(edge);
      continue;
    }
    if (edge.usages.length === 2) {
      const [first, second] = edge.usages;
      if (first.countryId !== second.countryId) stateBorderEdges.push(edge);
      continue;
    }
    fail(
      `region-partition edge shared by ${edge.usages.length} regions ` +
      `(${edge.usages.map((usage) => usage.regionId).join(", ")}) at ` +
      `${pointKey(edge.p1)}–${pointKey(edge.p2)}: this is not a valid planar ` +
      "partition (an interior edge must border at most two regions); " +
      "stopping instead of guessing which pair is real"
    );
  }
  return stateBorderEdges;
};

const edgeBounds = (edge) => ({
  minX: Math.min(edge.p1[0], edge.p2[0]),
  minY: Math.min(edge.p1[1], edge.p2[1]),
  maxX: Math.max(edge.p1[0], edge.p2[0]),
  maxY: Math.max(edge.p1[1], edge.p2[1])
});

const edgesOverlappingWindow = (edges, window) =>
  edges.filter((edge) => boundsIntersectWindow(edgeBounds(edge), window));

// ---------------------------------------------------------------------------
// Название(я) страны/стран для подписи.
//
// Черновик когда-то нёс на `country-border-gap-merged` готовый список
// `touchingCountryIds` — после пересборки черновика это поле убрано из схемы
// целиком (щель теперь несёт `outline`/`mergedIntoRegionId`/`foreignAreaPx2`
// вместо него). Одна страна отсюда известна точно — это страна области
// `mergedIntoRegionId` (куда щель фактически вошла). Вторую («чужую») страну
// схема больше не называет по имени, поэтому она восстанавливается прямым
// геометрическим тестом: проверяется, чья авторская заливка (страновой
// контур из countries-stations) содержит вершины контура самой щели
// (`outline`). Это простой поиск "чья это территория по цвету", а не линия
// сравнения "было/стало" — в отличие от прежней (снятой) авторской линии
// границы, он ничего не утверждает о том, где именно проходит граница, и
// поэтому не подвержен находке о шуме контура (см. заголовочный комментарий
// файла и computeStateBorderEdges).
//
// Остальные виды сомнений не несут ни `touchingCountryIds`, ни
// `mergedIntoRegionId` — для них страна ищется тем же способом, что в
// реестре render-region-partition-overview.mjs: тест "точка внутри контура
// области" по bounds и лучу (ray casting).
// ---------------------------------------------------------------------------

const pointInRing = (x, y, ring) => {
  let inside = false;
  // j = i++ (post-increment) is the standard idiom here: at the top of each
  // iteration j must hold the *previous* vertex's index while i holds the
  // current one, so the loop walks every edge of the ring exactly once.
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

const findRegionsContainingPoint = (x, y, regions) => regions.filter((region) => {
  const { minX, minY, maxX, maxY } = region.bounds;
  if (x < minX - 1 || x > maxX + 1) return false;
  if (y < minY - 1 || y > maxY + 1) return false;
  return pointInRing(x, y, region.exteriorRing);
});

/** Countries touching a country-border-gap-merged doubt: the merge destination plus whichever fill(s) the sliver's own outline sits in. */
const countryNamesForBorderGapDoubt = (doubt, regions, countries) => {
  const names = new Set();
  const mergedRegion = regions.find((region) => region.id === doubt.mergedIntoRegionId);
  if (mergedRegion?.countryName) names.add(mergedRegion.countryName);
  for (const country of countries) {
    if (names.has(country.name)) continue;
    const touchesOutline = doubt.outline.some(([x, y]) =>
      country.contour.some((ring) => pointInRing(x, y, ring)));
    if (touchesOutline) names.add(country.name);
  }
  return names.size > 0 ? [...names].join(" / ") : "страны не определены";
};

export const countryNamesForDoubt = (doubt, regions, countries) => {
  if (typeof doubt.mergedIntoRegionId === "string" && Array.isArray(doubt.outline)) {
    return countryNamesForBorderGapDoubt(doubt, regions, countries);
  }
  const containing = findRegionsContainingPoint(doubt.atX, doubt.atY, regions);
  const names = [...new Set(containing.map((region) => region.countryName ?? region.countryId ?? "?"))];
  return names.length > 0 ? names.join(" / ") : "страна не определена";
};

// ---------------------------------------------------------------------------
// SVG-оверлей одного кадра: границы областей (тонко), государственная граница
// (толсто и другим цветом), метка сомнения. Координаты остаются в родной
// (канонической) системе координат карты — viewBox сам обрезает и сдвигает
// содержимое до окна кропа, поэтому ни одну координату кольца не нужно
// пересчитывать вручную.
// ---------------------------------------------------------------------------

const ringToPath = (ring) => {
  const [first, ...rest] = ring;
  const moveTo = `M ${round(first[0], 3)} ${round(first[1], 3)}`;
  const lineTo = rest.map(([x, y]) => `L ${round(x, 3)} ${round(y, 3)}`).join(" ");
  return `${moveTo} ${lineTo} Z`;
};

const regionBoundaryPath = (region) =>
  [region.exteriorRing, ...(region.interiorRings ?? [])].map(ringToPath).join(" ");

const renderDoubtMarkerMarkup = (doubt, radius) => {
  const x = round(doubt.atX, 3);
  const y = round(doubt.atY, 3);
  return [
    `    <circle cx="${x}" cy="${y}" r="${radius}" />`,
    `    <line x1="${round(doubt.atX - radius * 1.8, 3)}" y1="${y}" ` +
      `x2="${round(doubt.atX + radius * 1.8, 3)}" y2="${y}" />`,
    `    <line x1="${x}" y1="${round(doubt.atY - radius * 1.8, 3)}" ` +
      `x2="${x}" y2="${round(doubt.atY + radius * 1.8, 3)}" />`
  ].join("\n");
};

/** Exported for the "the strip is actually drawn" test — a pure string builder, no sharp needed. */
export const buildCropOverlaySvg = ({ window, regionsInWindow, stateBorderEdgesInWindow, doubt }) => {
  const regionPaths = regionsInWindow.map((region) =>
    `    <path class="region-boundary" d="${regionBoundaryPath(region)}" />`).join("\n");
  // Государственная граница "по разбиению" — просто отрезки (рёбра), не
  // замкнутые кольца, поэтому рисуются как <line>, а не как <path> с M/L/Z.
  const statePartitionLines = stateBorderEdgesInWindow.map((edge) => {
    const [x1, y1] = edge.p1;
    const [x2, y2] = edge.p2;
    const attrs = `x1="${round(x1, 3)}" y1="${round(y1, 3)}" x2="${round(x2, 3)}" y2="${round(y2, 3)}"`;
    return `    <line class="state-border-halo" ${attrs} />\n    <line class="state-border" ${attrs} />`;
  }).join("\n");
  // Сама спорная полоса — контур щели (outline), там, где он есть (только у
  // country-border-gap-merged; см. DOUBT_KIND_METRICS.hasStrip). Рисуется в
  // два прохода — заливка низко (под границей), чёткая обводка высоко (поверх
  // границы) — см. комментарий у SLIVER_FILL_COLOR о том, почему один слой
  // под границей стирал щель с картинки целиком.
  const sliverPath = Array.isArray(doubt.outline) ? ringToPath(doubt.outline) : null;
  const sliverFillMarkup = sliverPath === null ? "" : `    <path class="sliver-fill" d="${sliverPath}" />`;
  const sliverStrokeMarkup = sliverPath === null
    ? ""
    : `    <path class="sliver-outline-stroke" d="${sliverPath}" />`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${window.width}" height="${window.height}" ` +
    `viewBox="${window.x} ${window.y} ${window.width} ${window.height}">
  <style>
    .region-boundary { fill: none; stroke: #1d4ed8; stroke-width: ${REGION_BOUNDARY_STROKE_WIDTH_PX}; stroke-opacity: 0.92; }
    .sliver-fill { fill: ${SLIVER_FILL_COLOR}; fill-opacity: ${SLIVER_FILL_OPACITY}; stroke: none; }
    .sliver-outline-stroke { fill: none; stroke: ${SLIVER_OUTLINE_STROKE_COLOR}; stroke-width: ${SLIVER_OUTLINE_STROKE_WIDTH_PX}; stroke-opacity: 1; }
    .state-border-halo { fill: none; stroke: #ffffff; stroke-width: ${round(PARTITION_STATE_BORDER_STROKE_WIDTH_PX + 2.6, 2)}; stroke-opacity: 0.85; stroke-linecap: round; }
    .state-border { fill: none; stroke: #dc2626; stroke-width: ${PARTITION_STATE_BORDER_STROKE_WIDTH_PX}; stroke-opacity: 0.96; stroke-linecap: round; }
    .doubt-marker circle { fill: #facc15; fill-opacity: 0.92; stroke: #78350f; stroke-width: 1.4; }
    .doubt-marker line { stroke: #78350f; stroke-width: 1.2; }
  </style>
  <g id="region-boundaries">
${regionPaths}
  </g>
  <g id="sliver-fill">
${sliverFillMarkup}
  </g>
  <g id="state-borders">
${statePartitionLines}
  </g>
  <g id="sliver-outline-stroke">
${sliverStrokeMarkup}
  </g>
  <g class="doubt-marker" id="doubt-marker">
${renderDoubtMarkerMarkup(doubt, DOUBT_MARKER_RADIUS_PX)}
  </g>
</svg>
`;
};

/**
 * Подпись внутри картинки — отдельный SVG-документ в конечных (уже
 * увеличенных) пикселях, а не часть карты. Так текст остаётся гладким и
 * читаемым независимо от того, что сама карта нарочно увеличена методом
 * ближайшего соседа и выглядит "пиксельно" — смешивать сглаженный текст с
 * пиксельной картой в одном растре было бы противоречиво.
 */
const buildCaptionSvg = ({
  doubt, kindTitle, metrics, countries, width, height, windowSidePx, upscaleFactor
}) => {
  const primaryLabel = `${metrics.label} ≈ ${round(doubt[metrics.field], metrics.digits)} ${metrics.unit}`;
  const secondaryLabel =
    `${metrics.secondaryLabel} ≈ ${round(doubt[metrics.secondaryField], metrics.secondaryDigits)} ${metrics.secondaryUnit}`;
  const sliverLegend = metrics.hasStrip
    ? `<tspan fill="#f472b6" font-weight="700">   ■ розовая заливка</tspan>` +
      `<tspan fill="#cbd5e1"> — сама щель (перешедшая территория)</tspan>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#0b1220" />
  <text x="26" y="36" font-family="sans-serif" font-size="27" font-weight="700" fill="#f8fafc">${xmlEscape(doubt.id)} · ${xmlEscape(kindTitle)}</text>
  <text x="26" y="70" font-family="sans-serif" font-size="21" fill="#e2e8f0">${xmlEscape(primaryLabel)} · ${xmlEscape(secondaryLabel)}</text>
  <text x="26" y="100" font-family="sans-serif" font-size="21" fill="#e2e8f0">страны: ${xmlEscape(countries)}</text>
  <text x="26" y="132" font-family="sans-serif" font-size="19">
    <tspan fill="#f87171" font-weight="700">■ красная</tspan><tspan fill="#cbd5e1"> — граница по разбиению</tspan>${sliverLegend}
  </text>
  <text x="26" y="${height - 14}" font-family="sans-serif" font-size="15" fill="#94a3b8">окно ${windowSidePx}×${windowSidePx} px исходной карты, увеличено ×${upscaleFactor} методом ближайшего соседа</text>
</svg>
`;
};

// ---------------------------------------------------------------------------
// Растеризация одного кадра поверх авторского растра (через sharp, тот же
// приём, что и в render-region-partition-overview.mjs).
// ---------------------------------------------------------------------------

const renderDoubtCropBuffer = async ({
  backgroundBytes,
  regionPartition,
  countriesStations,
  stateBorderEdges,
  doubt,
  metrics,
  rasterWidth,
  rasterHeight,
  windowSidePx,
  upscaleFactor
}) => {
  const window = computeCropWindow(doubt.atX, doubt.atY, windowSidePx, rasterWidth, rasterHeight);
  const regionsInWindow = regionsOverlappingWindow(regionPartition.regions, window);
  const stateBorderEdgesInWindow = edgesOverlappingWindow(stateBorderEdges, window);

  const overlaySvg = buildCropOverlaySvg({ window, regionsInWindow, stateBorderEdgesInWindow, doubt });
  const overlayPngBuffer = await sharp(Buffer.from(overlaySvg), { density: 72 }).png().toBuffer();

  const rasterCropBuffer = await sharp(backgroundBytes)
    .extract({ left: window.x, top: window.y, width: window.width, height: window.height })
    .toBuffer();

  const composedBuffer = await sharp(rasterCropBuffer)
    .composite([{ input: overlayPngBuffer, blend: "over" }])
    .png()
    .toBuffer();

  const upscaledWidth = window.width * upscaleFactor;
  const upscaledHeight = window.height * upscaleFactor;
  // fit: "fill" + kernel: nearest вместе дают точную замену каждой исходной
  // точки на блок upscaleFactor×upscaleFactor — без этого при неквадратном
  // окне (кроп у самого края карты) sharp мог бы добавить поля вместо
  // честного увеличения "каждый пиксель — в N раз крупнее".
  const upscaledBuffer = await sharp(composedBuffer)
    .resize({ width: upscaledWidth, height: upscaledHeight, kernel: sharp.kernel.nearest, fit: "fill" })
    .png()
    .toBuffer();

  const captionSvg = buildCaptionSvg({
    doubt,
    kindTitle: DOUBT_KIND_TITLES[doubt.kind] ?? doubt.kind,
    metrics,
    countries: countryNamesForDoubt(doubt, regionPartition.regions, countriesStations.countries),
    width: upscaledWidth,
    height: CAPTION_HEIGHT_PX,
    windowSidePx: window.width,
    upscaleFactor
  });
  const captionBuffer = await sharp(Buffer.from(captionSvg)).png().toBuffer();

  const finalBuffer = await sharp({
    create: {
      width: upscaledWidth,
      height: upscaledHeight + CAPTION_HEIGHT_PX,
      channels: 3,
      background: "#0b1220"
    }
  })
    .composite([
      { input: upscaledBuffer, left: 0, top: 0 },
      { input: captionBuffer, left: 0, top: upscaledHeight }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer: finalBuffer, window, fileName: `${doubt.id}.png` };
};

// ---------------------------------------------------------------------------
// Статистика по всему явлению (не только по отобранным записям) — нужна,
// чтобы человек, глядя на несколько картинок, понимал, какую долю всего
// явления они показывают, а не гадал об этом. Считается заново из файла при
// каждом запуске (см. DEFAULT_LIMIT и заголовочный комментарий) — числа
// здесь не захардкожены, а вычисляются на реальных данных ниже.
// ---------------------------------------------------------------------------

/** Count/total/max/median по массиву чисел. Чистая функция — тестируется без файлов. */
export const computeNumericStats = (values) => {
  if (values.length === 0) fail("computeNumericStats: empty input");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    count: values.length,
    total: values.reduce((sum, value) => sum + value, 0),
    max: sorted[sorted.length - 1],
    median
  };
};

/**
 * Абзац "масштаб явления целиком" для country-border-gap-merged: сколько
 * всего таких записей, сколько площади они в сумме переносят и какую долю
 * карты (`rasterWidth`×`rasterHeight`, вся авторская картинка, включая воду
 * и прочее не занятое странами пространство — то же "площадь карты", что
 * держит в голове проверяющий человек, а не только площадь заявленных
 * областей) это составляет. Без этого числа один просмотренный кроп ничем
 * не отличим от происшествия, которое встречается в тексте один раз или
 * триста раз — а PM явно попросил именно эту способность оценить масштаб.
 */
export const describeForeignAreaPopulation = ({ stats, mapAreaPx2, over100Count, over300Count }) => {
  const sharePercent = round((100 * stats.total) / mapAreaPx2, 3);
  return `Во всём черновике таких записей ${stats.count}; в сумме они переносят другой стране ` +
    `${round(stats.total, 1)} px² — ${sharePercent}% площади карты (${mapAreaPx2} px²). Самая ` +
    `крупная отдельная передача — ${round(stats.max, 1)} px², медианная — ${round(stats.median, 2)} px². ` +
    `Свыше 100 px² — ${over100Count} записей, свыше 300 px² — ${over300Count}. Значит, картинки ниже — ` +
    `это заведомо не рядовые случаи, а верхний край всего явления, и весь масштаб проблемы — доли ` +
    `процента площади карты, а не что-то повсеместное.`;
};

// ---------------------------------------------------------------------------
// Файл-указатель index.md — читаемый человеком реестр вырезанных картинок.
// ---------------------------------------------------------------------------

/** Чистая функция — тестируется на синтетических строках без файлов. */
export const buildIndexMarkdown = ({ kind, kindTitle, metrics, matchingCount, populationStatsSentence, rows }) => {
  const stripSentence = metrics.hasStrip
    ? "закрашенной розовым полосой показана сама щель — территория, которая по разбиению перешла " +
      "другой стране; "
    : "";
  const intro = `# Проверка сомнений «${kindTitle}» (\`${kind}\`) — перенос территории между странами\n\n` +
    `Ниже — ${rows.length} из ${matchingCount} сомнений вида «${kindTitle}» из разбиения авторской ` +
    `карты на области, отсортированные по убыванию поля «${metrics.label}» (самые крупные — первыми). ` +
    `Каждая строка — увеличенный кусок авторской карты вокруг места сомнения с наложенным сверху ` +
    `разбиением: тонкой синей линией показаны границы всех областей в кадре; толстой красной линией — ` +
    `**государственная граница по разбиению** (вычислена из самих областей — см. пояснение в файле ` +
    `инструмента); ${stripSentence}жёлтой меткой отмечена точка самого сомнения.` +
    (populationStatsSentence ? ` ${populationStatsSentence}` : "") +
    ` **Решение, которое нужно принять**: посмотреть на картинку в каждой строке и сказать, не выглядит ` +
    `ли перенос территории неправдоподобным — принять его или отклонить, по каждому случаю отдельно или ` +
    `по всей партии сразу, если все выглядят приемлемо.\n\n`;
  const header = `| id | ${metrics.label}, ${metrics.unit} | ${metrics.secondaryLabel}, ${metrics.secondaryUnit} ` +
    "| страны | картинка |\n|---|---|---|---|---|";
  const body = rows.map((row) =>
    `| ${row.id} | ${round(row.primaryValue, metrics.digits)} | ${round(row.secondaryValue, metrics.secondaryDigits)} | ` +
    `${row.countries} | [${row.fileName}](./${row.fileName}) |`
  ).join("\n");
  return `${intro}${header}\n${body}\n`;
};

// ---------------------------------------------------------------------------
// Сборка: загрузка входов, отбор, вырезание кадров, запись результата.
// Каталог вывода — регенерируемый (не постоянный артефакт), поэтому перед
// записью он полностью пересобирается с нуля, а не дополняется: иначе
// картинки от предыдущего запуска с другим --kind/--limit остались бы лежать
// рядом, не упомянутые в свежем index.md, и вводили бы в заблуждение.
// ---------------------------------------------------------------------------

export const buildDoubtCrops = async ({
  regionPartitionPath,
  countriesStationsPath,
  backgroundPath,
  kind,
  limit,
  outputDirectory,
  windowSidePx = WINDOW_SIDE_PX,
  upscaleFactor = UPSCALE_FACTOR
}) => {
  const metrics = DOUBT_KIND_METRICS[kind];
  if (!metrics) {
    fail(
      `doubt kind "${kind}" has no defined size metric in this tool (supported: ` +
      `${Object.keys(DOUBT_KIND_METRICS).join(", ")}); other kinds either do not measure a size in this ` +
      "sense or measure something incomparable (gap length, ink overlap)"
    );
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    fail(`--limit must be a positive integer, got: ${limit}`);
  }
  await assertOutputDirectoryIsSafe(outputDirectory);

  const { regionPartition, countriesStations, backgroundBytes, rasterWidth, rasterHeight } =
    await loadDoubtCropInputs({ regionPartitionPath, countriesStationsPath, backgroundPath });

  const allOfKind = regionPartition.doubts.filter((doubt) => doubt.kind === kind);
  if (allOfKind.length === 0) {
    return {
      status: "empty",
      kind,
      matchingCount: 0,
      message: `No doubts of kind "${kind}" found among ${regionPartition.doubts.length} doubts in the ` +
        "draft; nothing to crop, output directory not touched."
    };
  }
  for (const doubt of allOfKind) {
    if (typeof doubt[metrics.field] !== "number" || typeof doubt[metrics.secondaryField] !== "number") {
      fail(
        `doubt kind "${kind}" has a record without a numeric ${metrics.field}/${metrics.secondaryField}; ` +
        "the regenerated draft may have changed shape again — re-check DOUBT_KIND_METRICS against the schema"
      );
    }
  }

  const selected = selectDoubtsForCrop(allOfKind, limit, metrics.field);
  // Built once for the whole draft: edges are a global property of the
  // partition, not of any one crop window (see the section comment above
  // computeStateBorderEdges for why this must come from the regions and not
  // from the author's country contour).
  const stateBorderEdges = computeStateBorderEdges(regionPartition.regions);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const rows = [];
  for (const doubt of selected) {
    const { buffer, fileName } = await renderDoubtCropBuffer({
      backgroundBytes,
      regionPartition,
      countriesStations,
      stateBorderEdges,
      doubt,
      metrics,
      rasterWidth,
      rasterHeight,
      windowSidePx,
      upscaleFactor
    });
    await writeFile(path.join(outputDirectory, fileName), buffer);
    rows.push({
      id: doubt.id,
      primaryValue: doubt[metrics.field],
      secondaryValue: doubt[metrics.secondaryField],
      countries: countryNamesForDoubt(doubt, regionPartition.regions, countriesStations.countries),
      fileName
    });
  }

  // The "scale of the whole phenomenon" paragraph is computed from every
  // matching record in the draft (allOfKind), not just the cropped sample —
  // see describeForeignAreaPopulation for why this was explicitly requested.
  let populationStatsSentence = "";
  if (metrics.showTransferredAreaSummary) {
    const stats = computeNumericStats(allOfKind.map((doubt) => doubt[metrics.field]));
    populationStatsSentence = describeForeignAreaPopulation({
      stats,
      mapAreaPx2: rasterWidth * rasterHeight,
      over100Count: allOfKind.filter((doubt) => doubt[metrics.field] > 100).length,
      over300Count: allOfKind.filter((doubt) => doubt[metrics.field] > 300).length
    });
  }

  const indexMarkdown = buildIndexMarkdown({
    kind,
    kindTitle: DOUBT_KIND_TITLES[kind],
    metrics,
    matchingCount: allOfKind.length,
    populationStatsSentence,
    rows
  });
  await writeFile(path.join(outputDirectory, "index.md"), indexMarkdown);

  const primaryValues = selected.map((doubt) => doubt[metrics.field]);
  return {
    status: "ok",
    kind,
    matchingCount: allOfKind.length,
    croppedCount: selected.length,
    metricField: metrics.field,
    metricUnit: metrics.unit,
    metricDigits: metrics.digits,
    metricRange: { min: Math.min(...primaryValues), max: Math.max(...primaryValues) },
    outputDirectory
  };
};

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const parseArguments = (argv) => {
  const options = { kind: DEFAULT_KIND, limit: DEFAULT_LIMIT, outputDirectory: DEFAULT_OUTPUT_DIRECTORY };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--kind") {
      index += 1;
      if (argv[index] === undefined) fail("--kind requires a value");
      options.kind = argv[index];
      continue;
    }
    if (argument === "--limit") {
      index += 1;
      if (argv[index] === undefined) fail("--limit requires a value");
      options.limit = Number(argv[index]);
      continue;
    }
    if (argument === "--out") {
      index += 1;
      if (argv[index] === undefined) fail("--out requires a value");
      options.outputDirectory = path.resolve(argv[index]);
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  return options;
};

export const runRenderRegionPartitionDoubtCropsCli = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  const result = await buildDoubtCrops({
    regionPartitionPath: DEFAULT_REGION_PARTITION_PATH,
    countriesStationsPath: DEFAULT_COUNTRIES_STATIONS_PATH,
    backgroundPath: DEFAULT_BACKGROUND_PATH,
    kind: options.kind,
    limit: options.limit,
    outputDirectory: options.outputDirectory
  });

  if (result.status === "empty") {
    process.stdout.write(`${result.message}\n`);
    process.exitCode = 1;
    return result;
  }

  process.stdout.write(
    `${result.kind}: ${result.matchingCount} doubts exist, ${result.croppedCount} cropped, ` +
    `${result.metricField} range ${round(result.metricRange.min, result.metricDigits)}–` +
    `${round(result.metricRange.max, result.metricDigits)} ${result.metricUnit}. ` +
    `Output: ${result.outputDirectory}\n`
  );
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  runRenderRegionPartitionDoubtCropsCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
