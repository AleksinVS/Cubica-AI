#!/usr/bin/env python3
"""Построение полного черновика разделения авторской карты на игровые области.

Зачем нужен этот файл
---------------------
Авторская карта игры «Карты, деньги, поезда» нарисована в векторном редакторе.
Границы игровых областей на ней — это примерно тысяча отдельных **обводок**
(нарисованных линий, у каждой из которых есть толщина, то есть это полоса
краски, а не математическая линия). Художник рисовал их как штрихи, а не как
замкнутую карту, поэтому концы соседних штрихов почти нигде не совпадают точно.

Прежняя попытка собрать области трактовала каждую обводку как **осевую линию**
(математическую середину полосы, не имеющую толщины). При такой трактовке из 978
штрихов получилось 1575 **висячих концов** — концов линий, которые никуда не
приходят, из-за чего окружающая область не замыкается, — и всего 14 областей
вместо ожидаемых сотен.

Измерение показало, что разрывов на карте нет. Основная обводка имеет толщину
6.97 точки карты, а расстояния между концами штрихов лежат в пределах 0–3 точек.
Краска перекрывается везде; «разрывы» были следствием выбранной трактовки.

Поэтому здесь замыкание границ выводится из толщины обводки, как закреплено в
решении ADR-097. Разбиение считается двумя независимыми способами, и их
совпадение служит доказательством правильности вместо ручного просмотра
человеком сотен областей:

* **способ «краска»** — каждая осевая линия расширяется на свою полутолщину,
  все полосы объединяются в единую фигуру нарисованной краски, а областями
  считаются свободные участки внутри этой фигуры. Ни одного соединения этот
  способ не создаёт вообще;
* **способ «осевые»** — концы штрихов замыкаются там, где краска действительно
  перекрывается, после чего строится планарное разбиение. Этот способ даёт
  области с общими границами между соседями.

Результат обоих способов — непубликуемый черновик. Смысловое подтверждение
(какая область какой стране принадлежит и что вообще считать областью) выполняет
человек, а не этот инструмент.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

from shapely import STRtree, polygonize_full, unary_union
from shapely.geometry import LineString, Point, Polygon, box

# Модуль прежнего конвейера лежит рядом; путь добавляется явно, чтобы скрипт
# запускался из любого каталога.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Модуль прежнего конвейера переиспользуется, чтобы сглаживание кривых Безье и
# перевод в канонические координаты выполнялись ровно так же, как в уже принятых
# отчётах. Расхождение в этом месте сделало бы два результата несравнимыми.
from vector_map_polygonizer import flatten_candidate  # noqa: E402

# --- Постоянные величины конвейера -----------------------------------------

# Допуск сглаживания кривых Безье в точках канонической карты. Значение взято из
# уже принятого конвейера, менять его нельзя без пересборки прежних отчётов.
FLATTEN_TOLERANCE_PX = 0.25

# Точность построения скруглений при расширении линии в полосу. Чем больше
# значение, тем ближе скругление к настоящей окружности и тем дороже расчёт.
BUFFER_RESOLUTION = 8

# Соответствие формы торца линии в PDF и в геометрической библиотеке.
# В PDF: 0 — срез (краска обрывается ровно на конце осевой линии),
#        1 — круглый (краска выступает за конец на полутолщину во все стороны),
#        2 — квадратный (краска выступает за конец на полутолщину вдоль линии).
# В библиотеке shapely: 1 — круглый, 2 — плоский срез, 3 — квадратный.
PDF_CAP_TO_SHAPELY = {0: 2, 1: 1, 2: 3}

# Соответствие формы стыка звеньев ломаной.
# В PDF: 0 — острый, 1 — круглый, 2 — срезанный.
# В shapely: 1 — круглый, 2 — острый, 3 — срезанный.
PDF_JOIN_TO_SHAPELY = {0: 2, 1: 1, 2: 3}

# Ниже этой площади в точках карты замкнутый участок считается не областью, а
# микроконтуром — щелью, возникшей из-за наложения двух почти совпадающих
# штрихов. Такие участки не выбрасываются молча, а перечисляются отдельно.
MICRO_AREA_PX2 = 25.0


def _round(value: float) -> float:
    """Округление до шести знаков.

    Нужно, чтобы повторный запуск давал побайтово тот же файл: без округления
    последние двоичные разряды могут отличаться между запусками библиотеки.
    """

    return round(value + 0.0, 6)


def affine_scale(matrix: dict[str, float]) -> float:
    """Во сколько раз преобразование увеличивает длины.

    Толщина обводки хранится в единицах исходного файла, а вся остальная работа
    идёт в точках канонической карты. Чтобы перевести толщину, нужен масштаб
    преобразования. Он вычисляется как длина образа единичного вектора по каждой
    оси; при почти одинаковых значениях берётся среднее.
    """

    scale_x = math.hypot(matrix["a"], matrix["b"])
    scale_y = math.hypot(matrix["c"], matrix["d"])
    anisotropy = abs(scale_x - scale_y) / ((scale_x + scale_y) / 2)
    if anisotropy > 0.01:
        raise SystemExit(
            "преобразование растягивает оси по-разному "
            f"({anisotropy:.4%}); перевод толщины одним числом недопустим"
        )
    return (scale_x + scale_y) / 2


class Stroke:
    """Одна обводка карты: её осевая линия и занимаемый ею участок краски.

    Хранит вместе геометрию и параметры рисования, потому что критерий
    соединения из ADR-097 опирается именно на них: участок краски строится с
    собственной полутолщиной обводки и её собственной формой торца, а не по
    общему для всех числу.
    """

    __slots__ = ("candidate_id", "points", "closed", "half_width", "cap", "join", "line", "ink")

    def __init__(
        self,
        candidate_id: str,
        points: list[tuple[float, float]],
        closed: bool,
        half_width: float,
        cap: int,
        join: int,
    ) -> None:
        self.candidate_id = candidate_id
        self.points = points
        self.closed = closed
        self.half_width = half_width
        self.cap = cap
        self.join = join
        self.line = LineString(points)
        if half_width > 0.0:
            # Участок краски: осевая линия, расширенная на полутолщину с учётом
            # собственной формы торца и стыка. Это и есть то, что видно на карте.
            self.ink = self.line.buffer(
                half_width,
                resolution=BUFFER_RESOLUTION,
                cap_style=PDF_CAP_TO_SHAPELY[cap],
                join_style=PDF_JOIN_TO_SHAPELY[join],
            )
        else:
            # Граница страны — это не обводка, а край залитой фигуры: место, где
            # одна цветная заливка сменяется другой. Ширины у такого края нет
            # вовсе, поэтому «участком краски» для него является сама линия.
            self.ink = self.line


def load_strokes(review: dict[str, Any], classification: dict[str, Any]) -> list[Stroke]:
    """Собрать обводки-кандидаты границ в канонических координатах.

    Берутся только те кандидаты, которые классификация признала границами
    областей. Уже имеющееся поле `strokeStyle` даёт толщину и форму торца каждой
    обводки, поэтому отдельно разбирать исходный файл не требуется.
    """

    matrix = review["calibration"]["pdfToCanonical"]
    scale = affine_scale(matrix)

    # Классификация группирует кандидатов не по идентификаторам, а по точному
    # стилю обводки: цвет, толщина, форма торца и стыка. Поэтому отбор идёт
    # сопоставлением стиля кандидата со стилем группы.
    #
    # Берутся группы с решением `include` — это границы областей и внешняя
    # граница карты, — а также группа `hold`. В группе `hold` находится
    # единственный замкнутый контур `boundary-candidate-0978`; человек
    # подтвердил, что это непроходимый массив внутри страны. Его очертание —
    # настоящая граница на карте, поэтому в разбиении оно участвует. Смысл
    # массива при этом не утверждается: он лишь получает свою область.
    #
    # Группы с решением `exclude` — служебная рамка страницы; они не являются
    # игровой геометрией и отбрасываются.
    accepted_styles: dict[tuple, str] = {}
    for group in classification.get("styleClassifications", []):
        disposition = group.get("disposition")
        if disposition not in ("include", "hold"):
            continue
        style = group["strokeStyle"]
        key = (
            tuple(style["cmyk"]),
            style["width"],
            style.get("lineCap", 0),
            style.get("lineJoin", 0),
        )
        accepted_styles[key] = disposition

    strokes: list[Stroke] = []
    for candidate in review["boundaryCandidates"]:
        style = candidate["strokeStyle"]
        key = (
            tuple(style["cmyk"]),
            style["width"],
            style.get("lineCap", 0),
            style.get("lineJoin", 0),
        )
        if key not in accepted_styles:
            continue
        # Кривые Безье превращаются в ломаную с тем же допуском, что и в уже
        # принятых отчётах, иначе результаты нельзя было бы сравнивать.
        points, closed = flatten_candidate(candidate, matrix, FLATTEN_TOLERANCE_PX)
        strokes.append(
            Stroke(
                candidate_id=candidate["id"],
                points=points,
                closed=closed,
                half_width=style["width"] * scale / 2.0,
                cap=int(style.get("lineCap", 0)),
                join=int(style.get("lineJoin", 0)),
            )
        )
    if not strokes:
        raise SystemExit("не найдено ни одной обводки-кандидата границы")
    return strokes


def rings_to_polygons(rings: list[list[list[float]]]) -> list[Polygon]:
    """Собрать замкнутые кольца в многоугольники с учётом отверстий.

    Контур страны может состоять из нескольких колец: внешнего очертания и
    вложенных в него отверстий, например анклава другой страны. Кольцо, целиком
    лежащее внутри другого, считается отверстием, остальные — самостоятельными
    фигурами.
    """

    shapes = [Polygon(ring) for ring in rings if len(ring) >= 4]
    shapes = [shape for shape in shapes if shape.is_valid and not shape.is_empty]
    shapes.sort(key=lambda shape: shape.area, reverse=True)

    polygons: list[Polygon] = []
    holes: dict[int, list[Any]] = {}
    for shape in shapes:
        parent = None
        for index, candidate in enumerate(polygons):
            if candidate.contains(shape):
                parent = index
                break
        if parent is None:
            polygons.append(shape)
            holes[len(polygons) - 1] = []
        else:
            holes[parent].append(shape.exterior.coords)

    return [
        Polygon(polygon.exterior.coords, holes[index]) if holes[index] else polygon
        for index, polygon in enumerate(polygons)
    ]


def load_country_boundaries(path: Path) -> tuple[list[Stroke], list[Polygon]]:
    """Загрузить границы стран как самостоятельные границы областей.

    Граница страны — такая же граница области, как и внутренняя линия: область
    не может пересекать её и одновременно принадлежать двум странам. Но в
    авторском файле она нарисована иначе — не обводкой, а краем залитой фигуры.
    Поэтому её нужно добавить в разбиение отдельно, иначе внутренние линии,
    упирающиеся в границу страны, останутся незамкнутыми, а области будут
    перетекать из страны в страну.
    """

    if not path.exists():
        return [], []

    data = json.loads(path.read_text(encoding="utf-8"))
    boundaries: list[Stroke] = []
    polygons: list[Polygon] = []

    for country in data.get("countries", []):
        rings = country.get("contour") or []
        polygons.extend(rings_to_polygons(rings))
        for order, ring in enumerate(rings, start=1):
            if len(ring) < 4:
                continue
            points = [(float(x), float(y)) for x, y in ring]
            if points[0] != points[-1]:
                points.append(points[0])
            boundaries.append(
                Stroke(
                    candidate_id=f"{country['id']}:ring-{order:02d}",
                    points=points,
                    closed=True,
                    half_width=0.0,
                    cap=0,
                    join=0,
                )
            )
    return boundaries, polygons


def uncovered_country_lines(countries: list[Polygon], ink: Any) -> list[LineString]:
    """Найти участки границ стран, которые не нарисованы ни одной обводкой.

    Измерено: обводки государственных границ покрывают краской около 86.5%
    периметра страновых заливок. Остальная часть границы на карте видна только
    как стык двух разных цветов заливки, обводки там нет вовсе. Именно на этих
    участках области перетекают из страны в страну.

    Добавлять в разбиение весь контур страны нельзя: там, где обводка есть, край
    заливки идёт рядом с её осевой линией почти параллельно, и появились бы
    длинные тонкие щели вдоль каждой границы. Поэтому берётся только та часть
    контура, которую не закрывает краска.
    """

    uncovered: list[LineString] = []
    for polygon in countries:
        for ring in [polygon.exterior, *polygon.interiors]:
            remainder = LineString(ring.coords).difference(ink)
            for part in getattr(remainder, "geoms", [remainder]):
                if isinstance(part, LineString) and part.length > 1.0:
                    uncovered.append(part)
    return uncovered


def clip_regions_by_countries(
    regions: list[Polygon],
    countries: list[Polygon],
) -> list[Polygon]:
    """Разрезать области точно по границам стран.

    У края залитой фигуры ширины нет, поэтому в способе «краска» его нельзя
    вычесть как полосу — вычитание нулевой ширины ничего не изменило бы.
    Вместо этого каждая область пересекается со странами: часть, попавшая в одну
    страну, становится отдельной областью. Разрез проходит ровно по авторскому
    краю заливки, без какого-либо допуска.
    """

    if not countries:
        return regions

    tree = STRtree(countries)
    clipped: list[Polygon] = []
    for region in regions:
        pieces: list[Polygon] = []
        covered = []
        for index in tree.query(region):
            country = countries[int(index)]
            piece = region.intersection(country)
            if piece.is_empty:
                continue
            covered.append(country)
            for part in getattr(piece, "geoms", [piece]):
                if isinstance(part, Polygon) and part.area >= MICRO_AREA_PX2:
                    pieces.append(part)
        # Кусок области, не попавший ни в одну страну, тоже сохраняется: терять
        # территорию молча нельзя.
        if covered:
            outside = region.difference(unary_union(covered))
            for part in getattr(outside, "geoms", [outside]):
                if isinstance(part, Polygon) and part.area >= MICRO_AREA_PX2:
                    pieces.append(part)
        clipped.extend(pieces if pieces else [region])
    return clipped


# --- Способ «краска»: области как свободные участки внутри нарисованной краски -


def regions_from_paint(strokes: list[Stroke]) -> tuple[list[Polygon], Polygon]:
    """Найти области как свободные участки, окружённые нарисованной краской.

    Ни одного соединения этот способ не создаёт. Он просто объединяет все полосы
    краски в одну фигуру и смотрит, какие свободные куски плоскости она
    отгораживает. Именно это и видит человек, глядя на карту.

    Возвращает список областей и объединённую фигуру краски.
    """

    ink = unary_union([stroke.ink for stroke in strokes])

    # Рамка чуть больше всей краски. Свободное пространство ищется внутри неё,
    # чтобы у внешнего фона был свой отдельный кусок, который затем отбрасывается.
    min_x, min_y, max_x, max_y = ink.bounds
    frame = box(min_x - 10.0, min_y - 10.0, max_x + 10.0, max_y + 10.0)

    free_space = frame.difference(ink)

    # Куски свободного пространства, касающиеся рамки, — это внешний фон вокруг
    # карты, а не игровые области.
    frame_edge = frame.exterior
    regions: list[Polygon] = []
    parts = getattr(free_space, "geoms", [free_space])
    for part in parts:
        if part.is_empty or not isinstance(part, Polygon):
            continue
        if part.exterior.distance(frame_edge) < 1e-9:
            continue
        regions.append(part)
    return regions, ink


# --- Способ «осевые»: замыкание концов там, где краска перекрывается ----------


def find_ink_joins(strokes: list[Stroke]) -> list[dict[str, Any]]:
    """Найти концы штрихов, приходящие в краску другого штриха.

    Критерий из ADR-097: конец штриха соединён с другим штрихом тогда и только
    тогда, когда краска этих двух штрихов пересекается рядом с этим концом.
    «Рядом» означает внутри круга радиусом в полутолщину самого штриха — дальше
    его собственная краска не достаёт.

    Соединение по одной лишь близости точек не допускается: если краска не
    перекрывается, соединение не создаётся, и место остаётся настоящим разрывом.
    """

    tree = STRtree([stroke.ink for stroke in strokes])
    max_width = 2.0 * max(stroke.half_width for stroke in strokes)
    joins: list[dict[str, Any]] = []

    for index, stroke in enumerate(strokes):
        if stroke.closed:
            # У замкнутого контура свободных концов нет.
            continue
        for endpoint_name, point in (("start", stroke.points[0]), ("end", stroke.points[-1])):
            tip = Point(point)
            if stroke.half_width > 0.0:
                # Краска самого штриха рядом с этим концом.
                local_ink = stroke.ink.intersection(
                    tip.buffer(stroke.half_width, resolution=BUFFER_RESOLUTION)
                )
            else:
                # У границы нулевой толщины краски нет, и круг нулевого радиуса
                # был бы пустым. Роль «краски у конца» играет сама точка конца.
                local_ink = tip
            if local_ink.is_empty:
                continue

            # Область поиска соседей: собственная краска у конца, расширенная на
            # наибольшую возможную толщину чужой обводки. Расширение нужно, чтобы
            # увидеть не только пересечения, но и узкие зазоры второго класса.
            probe = local_ink.buffer(max_width, resolution=BUFFER_RESOLUTION)

            best: dict[str, Any] | None = None
            for other_index in tree.query(probe):
                other_index = int(other_index)
                if other_index == index:
                    continue
                other = strokes[other_index]

                # Класс 1 — краска перекрывается. Соединение следует прямо из
                # того, что нарисовано, и никакого допущения не содержит.
                gap = local_ink.distance(other.ink)
                if local_ink.intersects(other.ink):
                    join_class = "ink-overlap"
                # Класс 2 — краска не перекрывается, но зазор между полосами
                # тоньше самой узкой из двух линий. Такой просвет уже самого
                # штриха: художник вёл одну границу, а разрыв возник от того,
                # что торец линии срезан и краска обрывается ровно на конце
                # осевой линии. Класс помечается отдельно и показывается на
                # обзорной карте как предположение, а не как факт.
                elif gap < min(2.0 * stroke.half_width, 2.0 * other.half_width):
                    join_class = "narrow-gap"
                else:
                    continue

                distance = tip.distance(other.line)
                # Перекрытие краски всегда предпочтительнее узкого зазора, и
                # только при равном классе выбирается ближайший сосед.
                rank = (0 if join_class == "ink-overlap" else 1, distance)
                if best is None or rank < best["rank"]:
                    best = {
                        "rank": rank,
                        "joinClass": join_class,
                        "candidateId": stroke.candidate_id,
                        "endpoint": endpoint_name,
                        "targetCandidateId": other.candidate_id,
                        "distancePx": distance,
                        "inkGapPx": gap,
                        "halfWidthPx": stroke.half_width,
                        "targetHalfWidthPx": other.half_width,
                        "targetIndex": other_index,
                        "sourceIndex": index,
                    }
            if best is not None:
                del best["rank"]
                joins.append(best)
    return joins


def apply_ink_joins(
    strokes: list[Stroke],
    joins: list[dict[str, Any]],
    emit: list[Stroke] | None = None,
) -> list[LineString]:
    """Перенести концы штрихов на осевые линии соседей по найденным соединениям.

    Перенос выполняется только для тех концов, для которых критерий перекрытия
    краски уже выполнен. Никакой другой правки исходной геометрии не делается.

    Параметр `emit` задаёт, какие именно линии вернуть. Он нужен потому, что
    границы стран участвуют в замыкании как цели, но сами линиями разбиения не
    становятся: край залитой фигуры проходит рядом с толстой обводкой границы
    почти параллельно ей, и добавление его как отдельной линии породило бы
    длинные тонкие щели вдоль каждой государственной границы. Разрез по странам
    выполняется точным пересечением с фигурами стран, а не линиями.
    """

    moved: dict[str, list[tuple[float, float]]] = {
        stroke.candidate_id: list(stroke.points) for stroke in strokes
    }

    for join in joins:
        stroke = strokes[join["sourceIndex"]]
        target = strokes[join["targetIndex"]]
        tip_index = 0 if join["endpoint"] == "start" else -1
        tip = Point(moved[stroke.candidate_id][tip_index])
        # Ближайшая точка на осевой линии соседа: конец «дотягивается» до неё.
        projected = target.line.interpolate(target.line.project(tip))
        moved[stroke.candidate_id][tip_index] = (projected.x, projected.y)
        join["movedToX"] = _round(projected.x)
        join["movedToY"] = _round(projected.y)

    lines: list[LineString] = []
    for stroke in emit if emit is not None else strokes:
        points = moved[stroke.candidate_id]
        deduplicated = [points[0]]
        for point in points[1:]:
            if point != deduplicated[-1]:
                deduplicated.append(point)
        if len(deduplicated) >= 2:
            lines.append(LineString(deduplicated))
    return lines


def regions_from_centerlines(lines: list[LineString]) -> dict[str, Any]:
    """Построить планарное разбиение по замкнутым осевым линиям.

    Сначала все пересечения превращаются в общие узлы (это называется
    **узлование**: до него две пересекающиеся линии — независимые объекты),
    затем находятся минимальные замкнутые циклы — они и становятся областями.
    """

    noded = unary_union(lines)
    parts = list(getattr(noded, "geoms", [noded]))
    polygons, cuts, dangles, invalids = polygonize_full(parts)
    dangle_lines = list(getattr(dangles, "geoms", []))
    return {
        "regions": [geom for geom in getattr(polygons, "geoms", [])],
        "dangleLines": dangle_lines,
        "cutCount": len(list(getattr(cuts, "geoms", []))),
        "dangleCount": len(dangle_lines),
        "invalidCount": len(list(getattr(invalids, "geoms", []))),
        "nodedLineCount": len(parts),
    }


# --- Сводка -------------------------------------------------------------------


def summarize(regions: list[Polygon]) -> dict[str, Any]:
    """Разделить полученные участки на настоящие области и микроконтуры."""

    real = [region for region in regions if region.area >= MICRO_AREA_PX2]
    micro = [region for region in regions if region.area < MICRO_AREA_PX2]
    areas = sorted((region.area for region in real), reverse=True)
    return {
        "regionCount": len(real),
        "microContourCount": len(micro),
        "totalAreaPx2": _round(sum(areas)),
        "largestAreaPx2": _round(areas[0]) if areas else 0.0,
        "smallestAreaPx2": _round(areas[-1]) if areas else 0.0,
        "medianAreaPx2": _round(areas[len(areas) // 2]) if areas else 0.0,
    }


def compare_partitions(
    paint_regions: list[Polygon],
    centerline_regions: list[Polygon],
) -> dict[str, Any]:
    """Сопоставить области двух способов и найти расхождения.

    Способ «краска» даёт области, ужатые на полутолщину линии со всех сторон, а
    способ «осевые» — области, доходящие до середины линии. Поэтому контуры не
    совпадают буквально, и сравнивать их площади бессмысленно. Сравнивается
    другое: попадает ли внутренняя точка области одного способа ровно в одну
    область другого способа.

    Совпадение один к одному по всем областям означает, что оба способа увидели
    одно и то же разбиение. Именно это и служит доказательством правильности
    вместо ручного просмотра человеком сотен областей.
    """

    paint_tree = STRtree(paint_regions)
    # Какие области способа «осевые» попали в каждую область способа «краска».
    hits_per_paint: dict[int, list[int]] = {}
    centerline_without_pair: list[int] = []

    for index, region in enumerate(centerline_regions):
        probe = region.representative_point()
        hits = [
            int(candidate)
            for candidate in paint_tree.query(probe)
            if paint_regions[int(candidate)].covers(probe)
        ]
        if len(hits) != 1:
            # Внутренняя точка не попала ни в одну область краски или попала
            # сразу в несколько: пары нет.
            centerline_without_pair.append(index)
            continue
        hits_per_paint.setdefault(hits[0], []).append(index)

    # Честная сверка различает три случая, а не два. Область краски может
    # остаться без пары, получить ровно одну пару или получить несколько пар.
    # Последний случай означает, что способ «осевые» разрезал её на части, и
    # это такое же расхождение, как и отсутствие пары.
    exact_pairs = [index for index, hits in hits_per_paint.items() if len(hits) == 1]
    paint_split = [index for index, hits in hits_per_paint.items() if len(hits) > 1]
    paint_without_pair = [
        index for index in range(len(paint_regions)) if index not in hits_per_paint
    ]
    return {
        "pairCount": len(exact_pairs),
        "centerlineWithoutPair": centerline_without_pair,
        "paintWithoutPair": paint_without_pair,
        "paintSplitInTwoOrMore": paint_split,
    }


def main() -> None:
    """Посчитать разбиение обоими способами и напечатать сравнение.

    На этом шаге задача — получить и сверить числа. Постоянные артефакты,
    обзорная карта и реестр сомнений строятся отдельными шагами задачи.
    """

    annotations = Path(__file__).resolve().parent.parent / "annotations"
    review = json.loads((annotations / "vector-map.review.json").read_text(encoding="utf-8"))
    classification = json.loads(
        (annotations / "vector-map.classification.review.json").read_text(encoding="utf-8")
    )

    strokes = load_strokes(review, classification)
    # Флаг нужен, чтобы измерить сам вклад границ стран: один и тот же расчёт
    # выполняется с ними и без них, и разница видна напрямую.
    use_countries = "--no-countries" not in sys.argv
    country_boundaries, country_polygons = (
        load_country_boundaries(annotations / "vector-map.countries-stations.draft.json")
        if use_countries
        else ([], [])
    )
    print(f"границ стран: {len(country_boundaries)} колец, {len(country_polygons)} фигур")
    matrix = review["calibration"]["pdfToCanonical"]
    scale = affine_scale(matrix)
    half_widths = sorted({_round(stroke.half_width) for stroke in strokes})
    print(f"обводок-кандидатов границы: {len(strokes)}")
    print(f"масштаб: {scale:.6f} точки карты на единицу исходного файла")
    print(f"полутолщины: {half_widths}")
    print(f"наибольшая сумма полутолщин (радиус поиска): {2 * max(half_widths):.3f}")

    print("\n--- способ «краска» ---")
    paint_regions, ink = regions_from_paint(strokes)
    before_clip = len(paint_regions)
    paint_regions = clip_regions_by_countries(paint_regions, country_polygons)
    print(f"областей до разреза по странам: {before_clip}, после: {len(paint_regions)}")
    paint_summary = summarize(paint_regions)
    print(f"площадь нарисованной краски: {ink.area:.1f} точек карты в квадрате")
    for key, value in paint_summary.items():
        print(f"   {key}: {value}")

    print("\n--- способ «осевые» ---")
    # Ненарисованные участки границ стран становятся полноценными границами
    # нулевой толщины и участвуют в замыкании наравне с обводками. Полный контур
    # страны при этом не добавляется: измерено, что он идёт параллельно толстой
    # обводке границы и порождает около полутора тысяч тонких щелей.
    targets = strokes
    joins = find_ink_joins(targets)
    overlap = sum(1 for join in joins if join["joinClass"] == "ink-overlap")
    narrow = sum(1 for join in joins if join["joinClass"] == "narrow-gap")
    print(f"замкнутых концов всего: {len(joins)}")
    print(f"   из них по перекрытию краски: {overlap}")
    print(f"   из них по узкому зазору (предположение): {narrow}")
    lines = apply_ink_joins(targets, joins, emit=targets)

    # Граница страны на карте — это край цветной заливки; толстая обводка лишь
    # лежит поверх него и покрывает около 86.5% его длины. Поэтому в разбиение
    # добавляется весь контур страны: он и есть авторская граница.
    country_rings = [
        LineString(ring.coords)
        for polygon in country_polygons
        for ring in [polygon.exterior, *polygon.interiors]
    ]
    print(f"колец границ стран, добавлено линиями: {len(country_rings)}")
    centerline = regions_from_centerlines(lines + country_rings)

    # Там, где контур страны идёт рядом с толстой обводкой, между ними
    # появляется узкая грань, целиком лежащая внутри нарисованной краски. Это не
    # область, а внутренность самой линии. Правило отбрасывания то же самое, по
    # которому область определяется в способе «краска»: у настоящей области
    # внутри есть незакрашенное место.
    before_ink_filter = len(centerline["regions"])
    centerline["regions"] = [
        region
        for region in centerline["regions"]
        if region.difference(ink).area >= MICRO_AREA_PX2
    ]
    dropped = before_ink_filter - len(centerline["regions"])
    print(f"граней внутри краски отброшено: {dropped}")
    center_summary = summarize(centerline["regions"])
    print(f"висячих концов после замыкания: {centerline['dangleCount']}")
    print(f"лишних рёбер: {centerline['cutCount']}")
    print(f"недопустимых колец: {centerline['invalidCount']}")
    for key, value in center_summary.items():
        print(f"   {key}: {value}")

    print("\n--- сверка ---")
    difference = center_summary["regionCount"] - paint_summary["regionCount"]
    print(f"разница в числе областей: {difference}")

    real_paint = [region for region in paint_regions if region.area >= MICRO_AREA_PX2]
    real_center = [region for region in centerline["regions"] if region.area >= MICRO_AREA_PX2]
    comparison = compare_partitions(real_paint, real_center)
    print(f"областей, совпавших один к одному: {comparison['pairCount']}")
    print(f"область краски без пары (слиты «осевыми»): {len(comparison['paintWithoutPair'])}")
    print(f"область краски разрезана «осевыми» надвое и более: {len(comparison['paintSplitInTwoOrMore'])}")
    print(f"область «осевых» без однозначной пары: {len(comparison['centerlineWithoutPair'])}")

    agreement = comparison["pairCount"] / max(len(real_paint), len(real_center))
    print(f"доля согласия: {agreement:.2%}")

    # Промежуточная выгрузка для построения обзорной карты. Постоянный
    # артефакт с устойчивыми номерами и отпечатками собирается отдельным шагом
    # задачи; здесь нужен только материал для проверки глазами.
    dump_path = Path(".tmp/cmt-region-partition-preview.json")
    dump_path.parent.mkdir(parents=True, exist_ok=True)
    dump_path.write_text(
        json.dumps(
            {
                "mapWidth": review["coordinateSystem"]["width"],
                "mapHeight": review["coordinateSystem"]["height"],
                "paintRegions": [
                    [[_round(x), _round(y)] for x, y in region.exterior.coords]
                    for region in real_paint
                ],
                "centerlineRegions": [
                    [[_round(x), _round(y)] for x, y in region.exterior.coords]
                    for region in real_center
                ],
                "paintWithoutPair": comparison["paintWithoutPair"],
                "paintSplitInTwoOrMore": comparison["paintSplitInTwoOrMore"],
                "centerlineWithoutPair": comparison["centerlineWithoutPair"],
                "narrowGapJoins": [
                    [join["movedToX"], join["movedToY"]]
                    for join in joins
                    if join["joinClass"] == "narrow-gap"
                ],
                "unresolvedGaps": [
                    [_round(line.coords[0][0]), _round(line.coords[0][1])]
                    for line in centerline["dangleLines"]
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nвыгрузка для обзора: {dump_path}")


if __name__ == "__main__":
    main()
