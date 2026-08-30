#!/usr/bin/env python3
"""Вырезать из разбиения карты непроходимую местность как области своего рода.

Зачем нужен этот файл
---------------------
Продюсер решил: тёмно-коричневая местность, нарисованная художником на карте
(и река, соединяющая два озера в одном месте), — это игровая территория, на
которой запрещено строить дороги. Раньше эта местность просто лежала ВНУТРИ
обычных игровых областей, никак не выделенная. Этот файл вырезает её из
областей, которые она задевает, как отдельные новые области, и возвращает
список их идентификаторов — чтобы вызывающий код (`cmt_region_partition.py`)
мог пометить их как непроходимые для планировщика дорог.

Входные данные — растровое измерение, произведённое отдельным инструментом
`extract-impassable-terrain-raster.mjs` (JS, работает с картинкой через
`sharp`, т.к. в Python-окружении этой игры нет библиотеки для чтения PNG —
только numpy и shapely для геометрии). Этот файл превращает то растровое
измерение в векторную геометрию и режет по ней разбиение — то есть отвечает
только за геометрию, а не за пиксели.

Два отдельных вопроса и как каждый решается
--------------------------------------------
1. **Какие пятна — местность, а какие — декорация** (заголовок карты, роза
   ветров, легенда, рамка листа)? Все они одного цвета и сравнимого размера
   с местностью, поэтому цветом их не отличить. Отличает положение: пятно —
   местность, если оно лежит внутри разбиения карты на области, — измерено,
   что этот признак разделяет пятна БЕЗ единого промежуточного случая (см.
   `classify_patches()`).
2. **Где кончается река и начинается государственная граница** в районе двух
   озёр? Река нарисована тем же цветом и почти той же толщиной, что и
   обводка границы, поэтому раскрытие (эрозия+дилатация), уже отделяющее
   местность от границ в целом по карте, здесь не работает: эрозия стирает
   реку целиком, как и границу. Отличает то, ЧТО каждая из них означает для
   уже построенного разбиения: граница страны идёт ВДОЛЬ границы между
   областями (разбиение и резалось по её линии), а река идёт ПОПЕРЁК области,
   не вдоль её края. Расстояние от пикселя до ближайшей границы области —
   измеримый признак этого различия (см. `select_river_pixels()`), и он
   проверяется перед использованием, а не принимается на веру.

Простая геометрическая операция «область минус маска» здесь недостаточна:
если бы вырезание отбрасывало вырезанный кусок, продюсерская территория
исчезла бы с карты, а не стала непроходимой (пропало бы полное замощение
играбельной карты — тот же инвариант, который `cmt_region_partition.py`
проверяет для всего разбиения). Поэтому вырезанный кусок не отбрасывается, а
становится НОВОЙ областью — со своим номером и с полем, помечающим её как
непроходимую, — и продолжает быть частью замощения.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

# --- Пороги классификации пятен: ≥95% внутри разбиения — местность, ---------
# --- ≤20% — декорация. Пороги измерены (см. README.md, раздел «Непроходимая -
# --- местность»): 35 пятен лежат внутри более чем на 95%, 56 — не более чем -
# --- на 20%, ни одного значения между нет. Если новое измерение когда-нибудь -
# --- даст пятно между порогами, дальнейшая работа этого файла обязана -------
# --- остановиться (см. классификацию ниже), а не тихо выбрать сторону. ------
TERRAIN_INSIDE_SHARE_MIN = 0.95
DECORATION_INSIDE_SHARE_MAX = 0.20

# Решения продюсера: пятна, которые продюсер осмотрел и оставил ПРОХОДИМЫМИ,
# хотя измерение отнесло их к местности. Это единственное место, где решение
# человека перевешивает измерение, и каждое такое решение записано вместе с
# его основанием — иначе через полгода будет не отличить осознанное решение от
# случайно потерянного пятна.
#
# Пятно опознаётся по СВОИМ СОБСТВЕННЫМ признакам — положению и площади, — а не
# по номеру получившейся из него области: номера областей присваиваются по
# порядку и меняются при каждой пересборке разбиения, поэтому запрет «по
# номеру» перестал бы указывать на то же самое пятно.
PRODUCER_EXCLUDED_PATCHES = (
    {
        "centroid": (2462.0, 941.0),
        "areaPx2": 407,
        "reason": (
            "авторская дорога road-6-7 проходит прямо через это пятно на 19 точек: "
            "объявить его непроходимым значило бы объявить непроезжей уже "
            "нарисованную автором дорогу"
        ),
    },
    {
        "centroid": (2300.0, 1311.0),
        "areaPx2": 706,
        "reason": (
            "продюсер осмотрел предпросмотр и решил, что это пятно не является "
            "непроходимой местностью. Государственная граница разрезает его надвое, "
            "поэтому в сборке от 2026-07-31 оно давало сразу две области "
            "(map-region-0945 площадью 344 px² и map-region-0947 площадью 362 px²) "
            "в разных странах"
        ),
    },
)
EXCLUDED_PATCH_MATCH_TOLERANCE_PX = 3.0
EXCLUDED_PATCH_AREA_TOLERANCE_PX2 = 5


def load_raster(path: Path) -> dict[str, Any]:
    """Прочитать растровое измерение, построенное `extract-impassable-terrain-raster.mjs`."""

    return json.loads(path.read_text(encoding="utf-8"))


def _rows_to_boxes(rows: list[list[Any]]) -> list[Polygon]:
    """Построчное RLE (см. докстринг инструмента-экстрактора) -> список клеток-прямоугольников.

    Каждая запись строки — `[y, [x0,x1, x2,x3, ...]]`, где каждая пара — это
    полуоткрытый интервал занятых столбцов `[x0,x1)`. Прямоугольник на весь
    интервал строится один раз на интервал, а не на пиксель — так объединение
    ниже получает на порядки меньше фигур для сплошных пятен.
    """

    boxes = []
    for y, runs in rows:
        for i in range(0, len(runs), 2):
            boxes.append(box(runs[i], y, runs[i + 1], y + 1))
    return boxes


def rows_to_polygon(rows: list[list[Any]]) -> Polygon | Any:
    """Собрать геометрию из построчного RLE через объединение клеток-пикселей.

    Измерено на данных этой карты: специализированное
    `shapely.coverage_union_all` (рассчитанное на быстрое объединение
    неперекрывающихся стыкующихся по рёбрам фигур — ровно наш случай) на
    практике разваливает связное растровое пятно на десятки лишних частей —
    например, простое круглое пятно 8917 px² оно вернуло как 117 частей вместо
    одной, хотя площадь совпала (8917.0) и точный обход в ширину подтверждает,
    что пиксели пятна связны по рёбрам. Поэтому здесь используется обычный
    `unary_union`: на тех же входных клетках он корректно даёт один `Polygon`
    и делает это быстро (доли секунды даже на самом крупном пятне карты,
    ~3000 клеток) — специализированная функция не нужна.
    """

    boxes = _rows_to_boxes(rows)
    if not boxes:
        raise ValueError("пустой список строк — нечего собирать в полигон")
    if len(boxes) == 1:
        return boxes[0]
    return unary_union(boxes)


def classify_patches(
    patches: list[dict[str, Any]],
    land_union: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Разделить растровые пятна на местность, декорацию и продюсерские исключения.

    `land_union` — объединение полигонов ТЕКУЩЕГО (ещё не тронутого этим
    файлом) разбиения на области: играбельная карта минус пустые пространства.
    Признак — доля площади пятна, лежащая внутри этого объединения, применённая
    к ТОЧНОМУ пересечению геометрий (не к выборке пикселей): совпадает с тем
    же приёмом, каким `cmt_region_partition.py` уже отличает играбельную
    территорию от пустых пространств в `separate_empty_spaces()`.

    Останавливается (`SystemExit`), если находится пятно с долей строго между
    порогами `DECORATION_INSIDE_SHARE_MAX` и `TERRAIN_INSIDE_SHARE_MIN` —
    измеренное разделение (см. README) не оставляет для такого пятна места;
    получить его означало бы, что измерение на этой карте больше не
    подтверждается, и решать это должен человек, а не эвристика по умолчанию.
    """

    terrain: list[dict[str, Any]] = []
    decoration: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    # Ключ — индекс правила в PRODUCER_EXCLUDED_PATCHES, чтобы ниже было видно,
    # какое именно решение продюсера не нашло своего пятна.
    excluded_by_rule: dict[int, dict[str, Any]] = {}

    for patch in patches:
        polygon = rows_to_polygon(patch["rows"])
        area = polygon.area
        inside_share = polygon.intersection(land_union).area / area if area else 0.0
        centroid = patch["centroid"]
        record = {
            "polygon": polygon,
            "sizePx2": patch["sizePx2"],
            "centroid": centroid,
            "bbox": patch["bbox"],
            "insideShare": inside_share,
        }
        matched_rule: int | None = None
        for rule_index, rule in enumerate(PRODUCER_EXCLUDED_PATCHES):
            if (
                abs(centroid["x"] - rule["centroid"][0]) <= EXCLUDED_PATCH_MATCH_TOLERANCE_PX
                and abs(centroid["y"] - rule["centroid"][1]) <= EXCLUDED_PATCH_MATCH_TOLERANCE_PX
                and abs(patch["sizePx2"] - rule["areaPx2"]) <= EXCLUDED_PATCH_AREA_TOLERANCE_PX2
            ):
                matched_rule = rule_index
                break
        if inside_share >= TERRAIN_INSIDE_SHARE_MIN:
            if matched_rule is not None:
                if matched_rule in excluded_by_rule:
                    rule = PRODUCER_EXCLUDED_PATCHES[matched_rule]
                    raise SystemExit(
                        "найдено более одного пятна, совпадающего с продюсерским "
                        f"исключением у ({rule['centroid'][0]:.0f}, {rule['centroid'][1]:.0f}) "
                        "— совпадение должно быть однозначным"
                    )
                record["producerDecisionReason"] = PRODUCER_EXCLUDED_PATCHES[matched_rule]["reason"]
                excluded_by_rule[matched_rule] = record
            else:
                terrain.append(record)
        elif inside_share <= DECORATION_INSIDE_SHARE_MAX:
            decoration.append(record)
        else:
            ambiguous.append(record)

    if ambiguous:
        details = ", ".join(
            f"{item['sizePx2']}px² @({item['centroid']['x']:.0f},{item['centroid']['y']:.0f}) "
            f"{item['insideShare']:.1%}"
            for item in ambiguous
        )
        raise SystemExit(
            f"{len(ambiguous)} пятен лежат МЕЖДУ порогами классификации "
            f"({DECORATION_INSIDE_SHARE_MAX:.0%}..{TERRAIN_INSIDE_SHARE_MIN:.0%}): {details}. "
            "Измеренное разделение (README) больше не подтверждается на этих данных — "
            "нужен разбор человеком, а не автоматический выбор стороны."
        )
    missing = [
        f"~{rule['areaPx2']} px² @ ({rule['centroid'][0]:.0f}, {rule['centroid'][1]:.0f})"
        for index, rule in enumerate(PRODUCER_EXCLUDED_PATCHES)
        if index not in excluded_by_rule
    ]
    if missing:
        raise SystemExit(
            f"продюсерские исключения не найдены среди пятен, классифицированных "
            f"как местность: {', '.join(missing)} — проверьте измерение или решение "
            "продюсера. Молча пропустить исключение нельзя: пятно тогда стало бы "
            "непроходимым вопреки принятому решению"
        )

    excluded = [excluded_by_rule[index] for index in range(len(PRODUCER_EXCLUDED_PATCHES))]
    return terrain, decoration, excluded


def _decode_pixel_set(rows: list[list[Any]]) -> set[tuple[int, int]]:
    """Построчное RLE -> множество отдельных пикселей (для операций, которым нужен сам пиксель, не полигон)."""

    pixels: set[tuple[int, int]] = set()
    for y, runs in rows:
        for i in range(0, len(runs), 2):
            for x in range(runs[i], runs[i + 1]):
                pixels.add((x, y))
    return pixels


def _pixel_set_to_rows(pixels: set[tuple[int, int]]) -> list[list[Any]]:
    """Обратное преобразование: множество пикселей -> построчное RLE, для повторного использования rows_to_polygon()."""

    by_row: dict[int, list[int]] = {}
    for x, y in pixels:
        by_row.setdefault(y, []).append(x)
    rows: list[list[Any]] = []
    for y in sorted(by_row):
        xs = sorted(by_row[y])
        runs: list[int] = []
        start = xs[0]
        end = xs[0] + 1
        for x in xs[1:]:
            if x == end:
                end = x + 1
                continue
            runs.extend([start, end])
            start, end = x, x + 1
        runs.extend([start, end])
        rows.append([y, runs])
    return rows


def _pixel_neighbours(pixel: tuple[int, int]) -> tuple[tuple[int, int], ...]:
    x, y = pixel
    return ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))


def _connected_components(pixels: set[tuple[int, int]]) -> list[set[tuple[int, int]]]:
    """Связные компоненты (4-связность) множества пикселей, обход в ширину без рекурсии."""

    remaining = set(pixels)
    components: list[set[tuple[int, int]]] = []
    while remaining:
        seed = next(iter(remaining))
        stack = [seed]
        remaining.discard(seed)
        component = {seed}
        while stack:
            current = stack.pop()
            for neighbour in _pixel_neighbours(current):
                if neighbour in remaining:
                    remaining.discard(neighbour)
                    component.add(neighbour)
                    stack.append(neighbour)
        components.append(component)
    return components


def measure_river_boundary_distances(
    candidate_pixels: set[tuple[int, int]],
    boundary_segments: list[LineString],
) -> dict[tuple[int, int], float]:
    """Расстояние от центра каждого пикселя-кандидата до ближайшего отрезка границы области.

    Вынесено отдельной функцией, чтобы вызывающий код мог напечатать
    распределение расстояний как есть (задание требует ИЗМЕРИТЬ и ДОЛОЖИТЬ
    его, а не просто применить порог).
    """

    tree = STRtree(boundary_segments)
    distances: dict[tuple[int, int], float] = {}
    for x, y in candidate_pixels:
        point = Point(x + 0.5, y + 0.5)
        nearest_index = tree.nearest(point)
        distances[(x, y)] = boundary_segments[int(nearest_index)].distance(point)
    return distances


def select_river_pixels(
    lakes_river_blob_rows: list[list[Any]],
    lake_polygons: list[Polygon],
    boundary_segments: list[LineString],
    half_stroke_width_px: float,
) -> tuple[set[tuple[int, int]], dict[tuple[int, int], float]]:
    """Отделить пиксели реки от уже найденных озёр внутри общего сырого пятна.

    Правило (см. докстринг модуля и README): пиксель, лежащий дальше
    `half_stroke_width_px` от любой границы области, — река (граница идёт
    ВДОЛЬ границ области, река — поперёк них). Пиксели ближе этого порога не
    отбрасываются поодиночке: показатель применяется к целым связным
    КУСКАМ пятна-кандидата (после вычитания озёр), а не к отдельным пикселям,
    — кусок остаётся рекой целиком, если хотя бы один его пиксель далёк от
    любой границы, а короткие пиксели-мостики, которыми река пересекает
    границу области, восстанавливаются вместе с ним. Это и есть требуемое
    «восстановление коротких участков», выраженное на уровне связности, а не
    произвольным добавлением соседних пикселей.
    """

    all_pixels = _decode_pixel_set(lakes_river_blob_rows)
    lake_union = unary_union(lake_polygons)
    candidates = {
        (x, y) for (x, y) in all_pixels
        if not lake_union.covers(Point(x + 0.5, y + 0.5))
    }
    if not candidates:
        raise SystemExit("после вычитания озёр не осталось ни одного пикселя-кандидата реки")

    distances = measure_river_boundary_distances(candidates, boundary_segments)

    components = _connected_components(candidates)
    river_pixels: set[tuple[int, int]] = set()
    for component in components:
        if any(distances[p] > half_stroke_width_px for p in component):
            river_pixels |= component
        # Компонента без единого «дальнего» пикселя не восстанавливается: это
        # был бы кусок, полностью прилегающий к границе, — то есть, по этому же
        # признаку, скорее обводка, чем река. В измеренных данных этой карты
        # такой компоненты нет (см. отчёт), но защититься дёшево.

    return river_pixels, distances


def build_boundary_segments(
    region_polygons_by_id: dict[str, Polygon],
    near_bbox: tuple[float, float, float, float],
    padding: float,
) -> list[LineString]:
    """Собрать отрезки границ ТЕКУЩЕГО разбиения рядом с районом реки, для проверки расстояния.

    Ограничение окрестностью — не приближение: расстояние всё равно считается
    точно до ближайшего отрезка, а окрестность лишь исключает заведомо далёкие
    области ради скорости (та же идея, что уже применяется в
    `cmt_region_partition.py` при поиске соседей через `STRtree`).
    """

    min_x, min_y, max_x, max_y = near_bbox
    min_x -= padding
    min_y -= padding
    max_x += padding
    max_y += padding
    segments: list[LineString] = []
    for polygon in region_polygons_by_id.values():
        b = polygon.bounds
        if b[2] < min_x or b[0] > max_x or b[3] < min_y or b[1] > max_y:
            continue
        rings = [polygon.exterior, *polygon.interiors]
        for ring in rings:
            coords = list(ring.coords)
            for i in range(len(coords) - 1):
                segments.append(LineString([coords[i], coords[i + 1]]))
    return segments


def river_polygon_from_pixels(river_pixels: set[tuple[int, int]]) -> Polygon:
    """Собрать полигон реки из отобранного множества пикселей (см. `select_river_pixels`)."""

    return rows_to_polygon(_pixel_set_to_rows(river_pixels))
