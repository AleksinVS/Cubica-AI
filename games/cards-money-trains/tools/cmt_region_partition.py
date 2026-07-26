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
from vector_map_polygonizer import flatten_candidate, geometry_fingerprint  # noqa: E402


def file_digest(path: Path) -> str:
    """Отпечаток файла: нужен, чтобы черновик знал, из чего он собран.

    Если исходный отчёт изменится, отпечаток разойдётся, и станет видно, что
    черновик устарел, а не молча описывает другую карту.
    """

    import hashlib

    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()

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

# Толщина основной линии карты в точках: её имеют 909 из 979 обводок-кандидатов.
# Используется как мера того, что считать настоящей областью, а что остатком
# геометрии линий. Значение не назначено, а измерено по авторскому файлу.
DOMINANT_STROKE_WIDTH_PX = 6.970


def effective_width(polygon: Polygon) -> float:
    """Насколько фигура «толстая»: удвоенная площадь, делённая на периметр.

    Для длинной узкой полосы эта величина равна её ширине. Для округлой фигуры
    она близка к её поперечнику. Величина нужна, чтобы отличить настоящую
    область от щели: щель длинная и узкая, поэтому у неё большой периметр при
    малой площади, и значение получается маленьким даже когда площадь заметная.
    Сравнение только по площади такую щель не поймало бы.
    """

    return 2.0 * polygon.area / polygon.length if polygon.length else 0.0


def collapse_slivers(
    regions: list[Polygon],
    min_width: float = DOMINANT_STROKE_WIDTH_PX,
) -> tuple[list[Polygon], list[dict[str, Any]]]:
    """Схлопнуть узкие щели, присоединив каждую к соседу по длинной общей границе.

    Щели возникают вдоль границ стран: край цветной заливки идёт рядом с осевой
    линией лежащей поверх него обводки, и между ними остаётся узкая полоса.
    Областью такая полоса не является.

    Порог взят равным толщине основной линии карты. Он измерен, а не назначен:
    при этом пороге под правило попадают ровно те фигуры, что лежат у границ
    стран, ни одной посторонней, а медианная ширина настоящей области примерно
    вчетверо больше порога.

    Щель не исчезает бесследно: каждое схлопывание возвращается отдельной
    записью и попадает в реестр решений.
    """

    keep = [region for region in regions if effective_width(region) >= min_width]
    slivers = [region for region in regions if effective_width(region) < min_width]
    collapsed: list[dict[str, Any]] = []

    # Мелкие щели присоединяются первыми: так более крупная щель, если она
    # окажется рядом, присоединится уже к укрупнённому соседу.
    for sliver in sorted(slivers, key=lambda region: region.area):
        tree = STRtree(keep)
        best_index = None
        best_length = 0.0
        for index in tree.query(sliver.buffer(1.0)):
            index = int(index)
            shared = sliver.exterior.intersection(keep[index].buffer(0.05)).length
            if shared > best_length:
                best_length = shared
                best_index = index

        point = sliver.representative_point()
        record = {
            "areaPx2": _round(sliver.area),
            "effectiveWidthPx": _round(effective_width(sliver)),
            "atX": _round(point.x),
            "atY": _round(point.y),
            "sharedBoundaryPx": _round(best_length),
            "merged": best_index is not None,
        }
        if best_index is None:
            # Соседа нет: щель оставлена как есть, чтобы не потерять территорию.
            keep.append(sliver)
        else:
            merged = unary_union([keep[best_index], sliver])
            # Объединение двух соседей по общей границе обязано остаться одной
            # фигурой; если распалось, безопаснее ничего не менять.
            if isinstance(merged, Polygon):
                keep[best_index] = merged
            else:
                keep.append(sliver)
                record["merged"] = False
        collapsed.append(record)

    return keep, collapsed


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


def load_country_polygons(path: Path) -> list[Polygon]:
    """Загрузить границы стран как самостоятельные границы областей.

    Граница страны — такая же граница области, как и внутренняя линия: область
    не может пересекать её и одновременно принадлежать двум странам. Но в
    авторском файле она нарисована иначе — не обводкой, а краем залитой фигуры.
    Поэтому её нужно добавить в разбиение отдельно, иначе внутренние линии,
    упирающиеся в границу страны, останутся незамкнутыми, а области будут
    перетекать из страны в страну.
    """

    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    polygons: list[Polygon] = []
    for country in data.get("countries", []):
        polygons.extend(rings_to_polygons(country.get("contour") or []))
    return polygons


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


# --- Постоянный артефакт черновика -------------------------------------------


def drop_micro_holes(
    regions: list[Polygon],
    min_area: float = MICRO_AREA_PX2,
) -> tuple[list[Polygon], list[dict[str, Any]]]:
    """Убрать из областей ничтожные внутренние отверстия.

    Внутреннее кольцо — это дырка внутри области. Настоящая дырка на карте
    означала бы анклав: участок, целиком окружённый другой областью. Отверстие
    же площадью в доли точки анклавом быть не может; оно возникает там, где две
    линии наложились друг на друга почти вплотную.

    Такие отверстия убираются, потому что иначе они попали бы в игровую
    геометрию как настоящие дырки и мешали бы расчёту смежности. Каждое убранное
    отверстие возвращается записью и попадает в реестр решений: бесследно ничего
    не исчезает.

    Отверстие площадью не меньше порога сохраняется как есть: это уже возможный
    анклав, и решение о нём принимает человек.
    """

    cleaned: list[Polygon] = []
    removed: list[dict[str, Any]] = []
    for region in regions:
        keep_interiors = []
        for interior in region.interiors:
            hole = Polygon(interior)
            if hole.area >= min_area:
                keep_interiors.append(interior.coords)
                continue
            point = hole.representative_point()
            removed.append(
                {
                    "areaPx2": _round(hole.area),
                    "atX": _round(point.x),
                    "atY": _round(point.y),
                }
            )
        if len(keep_interiors) == len(region.interiors):
            cleaned.append(region)
        else:
            cleaned.append(Polygon(region.exterior.coords, keep_interiors))
    return cleaned, removed


def stable_region_order(regions: list[Polygon]) -> list[Polygon]:
    """Упорядочить области так, чтобы номера не менялись между запусками.

    Порядок задаётся положением области на карте — сверху вниз, затем слева
    направо, — а при полном совпадении положения отпечатком геометрии. Такой
    порядок не зависит от того, в каком порядке библиотека вернула грани,
    поэтому номер области остаётся за ней при повторной сборке.
    """

    def key(region: Polygon) -> tuple[Any, ...]:
        min_x, min_y, max_x, max_y = region.bounds
        return (
            _round(min_y),
            _round(min_x),
            _round(max_y),
            _round(max_x),
            geometry_fingerprint(region),
        )

    return sorted(regions, key=key)


def assign_country(region: Polygon, countries: list[tuple[str, Polygon]]) -> str | None:
    """Черновая привязка области к стране по её внутренней точке.

    Привязка именно черновая: она говорит лишь о том, внутрь какой авторской
    заливки попала точка. Смысловое подтверждение выполняет человек.
    """

    point = region.representative_point()
    for country_id, polygon in countries:
        if polygon.covers(point):
            return country_id
    return None


def build_regions(
    regions: list[Polygon],
    countries: list[tuple[str, Polygon]],
    stations: list[dict[str, Any]],
    waypoints: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Собрать записи областей с устойчивыми номерами и отпечатками.

    Станция (терминал) принимает грузы, полустанок — промежуточная остановка,
    которая грузы не принимает. Обе сущности являются точками и относятся к той
    области, внутрь которой попали.
    """

    ordered = stable_region_order(regions)
    tree = STRtree(ordered)

    def locate(points: list[dict[str, Any]], key: str) -> dict[int, list[str]]:
        found: dict[int, list[str]] = {}
        for item in points:
            position = item.get(key) or {}
            point = Point(float(position.get("x", 0.0)), float(position.get("y", 0.0)))
            for index in tree.query(point):
                index = int(index)
                if ordered[index].covers(point):
                    found.setdefault(index, []).append(item["id"])
                    break
        return found

    station_of_region = locate(stations, "canonicalPosition")
    waypoint_of_region = locate(waypoints, "center")

    records: list[dict[str, Any]] = []
    for index, region in enumerate(ordered, start=1):
        min_x, min_y, max_x, max_y = region.bounds
        point = region.representative_point()
        records.append(
            {
                "id": f"map-region-{index:04d}",
                "geometryFingerprint": geometry_fingerprint(region),
                "areaPx2": _round(region.area),
                "effectiveWidthPx": _round(effective_width(region)),
                "bounds": {
                    "minX": _round(min_x),
                    "minY": _round(min_y),
                    "maxX": _round(max_x),
                    "maxY": _round(max_y),
                },
                "representativePoint": {"x": _round(point.x), "y": _round(point.y)},
                "draftCountryId": assign_country(region, countries),
                "stationIds": sorted(station_of_region.get(index - 1, [])),
                "waypointIds": sorted(waypoint_of_region.get(index - 1, [])),
                "exteriorRing": [
                    [_round(x), _round(y)] for x, y in region.exterior.coords
                ],
                # Внутренние кольца — дырки внутри области, то есть анклавы.
                # Ничтожные отверстия уже убраны, поэтому список почти всегда
                # пуст; сохраняется он для того, чтобы площадь и отпечаток
                # области можно было восстановить из записанной геометрии.
                "interiorRings": [
                    [[_round(x), _round(y)] for x, y in interior.coords]
                    for interior in region.interiors
                ],
            }
        )
    return records


def build_doubts(
    comparison: dict[str, Any],
    paint_regions: list[Polygon],
    centerline_regions: list[Polygon],
    joins: list[dict[str, Any]],
    collapsed: list[dict[str, Any]],
    dangle_lines: list[Any],
    micro_holes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Собрать реестр мест, где решение принято не однозначно.

    В реестр попадает всё, что человек может захотеть перепроверить: места
    расхождения двух способов, соединения-предположения, схлопнутые щели и
    оставшиеся незамкнутые концы. Каждая запись называет принятую трактовку и
    рассмотренную замену, чтобы решение можно было пересмотреть, не пересчитывая
    всё заново.
    """

    doubts: list[dict[str, Any]] = []

    def add(kind: str, point: Any, chosen: str, alternative: str, confidence: str, extra: dict[str, Any]) -> None:
        doubts.append(
            {
                "id": f"doubt-{len(doubts) + 1:04d}",
                "kind": kind,
                "atX": _round(point[0]),
                "atY": _round(point[1]),
                "chosenHypothesis": chosen,
                "consideredAlternative": alternative,
                "confidence": confidence,
                **extra,
            }
        )

    for index in comparison["paintWithoutPair"]:
        region = paint_regions[index]
        point = region.representative_point()
        add(
            "methods-disagree-merged",
            (point.x, point.y),
            "Принято разбиение способа «осевые»: эта область объединена с соседней.",
            "Способ «краска» считает её отдельной областью.",
            "medium",
            {"areaPx2": _round(region.area)},
        )

    for index in comparison["paintSplitInTwoOrMore"]:
        region = paint_regions[index]
        point = region.representative_point()
        add(
            "methods-disagree-split",
            (point.x, point.y),
            "Принято разбиение способа «осевые»: эта область разделена на части.",
            "Способ «краска» считает её единой областью.",
            "medium",
            {"areaPx2": _round(region.area)},
        )

    for index in comparison["centerlineWithoutPair"]:
        region = centerline_regions[index]
        point = region.representative_point()
        add(
            "methods-disagree-unmatched",
            (point.x, point.y),
            "Область принята по способу «осевые».",
            "Способ «краска» не даёт для неё однозначного соответствия.",
            "low",
            {"areaPx2": _round(region.area)},
        )

    for join in joins:
        if join["joinClass"] != "narrow-gap":
            continue
        add(
            "assumed-connection",
            (join["movedToX"], join["movedToY"]),
            "Концы соединены: просвет между полосами краски тоньше самой линии.",
            "Оставить как настоящий разрыв границы.",
            "medium",
            {
                "candidateId": join["candidateId"],
                "targetCandidateId": join["targetCandidateId"],
                "inkGapPx": _round(join["inkGapPx"]),
            },
        )

    for record in collapsed:
        add(
            "collapsed-sliver",
            (record["atX"], record["atY"]),
            "Узкая щель у границы страны присоединена к соседней области.",
            "Считать щель самостоятельной областью.",
            "high",
            {
                "areaPx2": record["areaPx2"],
                "effectiveWidthPx": record["effectiveWidthPx"],
                "merged": record["merged"],
            },
        )

    for record in micro_holes:
        add(
            "removed-micro-hole",
            (record["atX"], record["atY"]),
            "Ничтожное внутреннее отверстие убрано из области.",
            "Считать отверстие настоящим анклавом внутри области.",
            "high",
            {"areaPx2": record["areaPx2"]},
        )

    for line in dangle_lines:
        add(
            "unresolved-gap",
            (line.coords[0][0], line.coords[0][1]),
            "Соединение не создано: краска соседних линий не сходится.",
            "Соединить вручную, если человек видит на карте продолжение границы.",
            "low",
            {"lengthPx": _round(line.length)},
        )

    return doubts


def main() -> None:
    """Посчитать разбиение обоими способами, сверить их и собрать черновик."""

    annotations = Path(__file__).resolve().parent.parent / "annotations"
    review = json.loads((annotations / "vector-map.review.json").read_text(encoding="utf-8"))
    classification = json.loads(
        (annotations / "vector-map.classification.review.json").read_text(encoding="utf-8")
    )

    strokes = load_strokes(review, classification)
    # Флаг нужен, чтобы измерить сам вклад границ стран: один и тот же расчёт
    # выполняется с ними и без них, и разница видна напрямую.
    use_countries = "--no-countries" not in sys.argv
    country_polygons = (
        load_country_polygons(annotations / "vector-map.countries-stations.draft.json")
        if use_countries
        else []
    )
    print(f"фигур стран: {len(country_polygons)}")
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
    paint_regions, paint_collapsed = collapse_slivers(paint_regions)
    print(
        f"областей до разреза по странам: {before_clip}, "
        f"после разреза и схлопывания щелей: {len(paint_regions)} "
        f"(схлопнуто {len(paint_collapsed)})"
    )
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

    centerline["regions"], centerline_collapsed = collapse_slivers(centerline["regions"])
    print(f"узких щелей схлопнуто: {len(centerline_collapsed)}")

    centerline["regions"], micro_holes = drop_micro_holes(centerline["regions"])
    print(f"ничтожных внутренних отверстий убрано: {len(micro_holes)}")
    with_holes = sum(1 for r in centerline["regions"] if len(r.interiors) > 0)
    print(f"областей с сохранёнными отверстиями: {with_holes}")
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

    # --- постоянный артефакт черновика ---------------------------------------

    countries_path = annotations / "vector-map.countries-stations.draft.json"
    countries_data = (
        json.loads(countries_path.read_text(encoding="utf-8"))
        if countries_path.exists()
        else {"countries": [], "stations": []}
    )
    named_countries = [
        (country["id"], polygon)
        for country in countries_data.get("countries", [])
        for polygon in rings_to_polygons(country.get("contour") or [])
    ]

    region_records = build_regions(
        real_center,
        named_countries,
        countries_data.get("stations", []),
        countries_data.get("waypoints", []),
    )
    doubts = build_doubts(
        comparison,
        real_paint,
        real_center,
        joins,
        centerline_collapsed,
        centerline["dangleLines"],
        micro_holes,
    )
    without_country = [r["id"] for r in region_records if r["draftCountryId"] is None]

    draft = {
        "$schema": "./vector-map-region-partition.schema.json",
        "schemaVersion": "1.0.0",
        "status": "draft-review-only",
        "publishable": False,
        "warning": (
            "Непубликуемый черновик разбиения авторской карты на области. "
            "Смысловое подтверждение областей, их принадлежности странам и "
            "трактовки спорных мест выполняет человек. К среде исполнения, "
            "игровому манифесту и публичным контрактам не подключается."
        ),
        "provenance": {
            "source": review["source"],
            "rawReview": {
                "file": "vector-map.review.json",
                "sha256": file_digest(annotations / "vector-map.review.json"),
            },
            "classification": {
                "file": "vector-map.classification.review.json",
                "sha256": file_digest(
                    annotations / "vector-map.classification.review.json"
                ),
            },
            "countriesStations": {
                "file": "vector-map.countries-stations.draft.json",
                "sha256": file_digest(countries_path) if countries_path.exists() else None,
            },
            "calibration": review["calibration"],
            "coordinateSystem": review["coordinateSystem"],
        },
        "policy": {
            "decision": "ADR-097",
            "authoritativeMethod": "centerlines-with-ink-derived-tolerance",
            "verificationMethod": "paint-free-space",
            "semanticAssignmentsConfirmed": False,
            "runtimeIntegrationAllowed": False,
            "flattenTolerancePx": FLATTEN_TOLERANCE_PX,
            "dominantStrokeWidthPx": DOMINANT_STROKE_WIDTH_PX,
            "sliverRule": (
                "Участок с действующей шириной меньше толщины основной линии "
                "карты присоединяется к соседу по самой длинной общей границе. "
                "Порог измерен по авторскому файлу, а не назначен."
            ),
            "joinClasses": {
                "ink-overlap": "Полосы краски двух линий пересекаются; допущения нет.",
                "narrow-gap": (
                    "Полосы краски не пересекаются, но просвет между ними тоньше "
                    "самой узкой из двух линий; это предположение."
                ),
            },
        },
        "summary": {
            "regionCount": len(region_records),
            "verificationRegionCount": len(real_paint),
            "exactPairCount": comparison["pairCount"],
            "agreementRatio": _round(agreement),
            "joinCount": len(joins),
            "inkOverlapJoinCount": overlap,
            "narrowGapJoinCount": narrow,
            "collapsedSliverCount": len(centerline_collapsed),
            "removedMicroHoleCount": len(micro_holes),
            "regionsWithInteriorRingsCount": with_holes,
            "unresolvedGapCount": centerline["dangleCount"],
            "cutEdgeCount": centerline["cutCount"],
            "invalidRingCount": centerline["invalidCount"],
            "doubtCount": len(doubts),
            "countryCount": len(named_countries),
            "stationCount": len(countries_data.get("stations", [])),
            "waypointCount": len(countries_data.get("waypoints", [])),
            "regionsWithoutCountryCount": len(without_country),
            "totalAreaPx2": center_summary["totalAreaPx2"],
        },
        "regions": region_records,
        "joins": [
            {
                "candidateId": join["candidateId"],
                "endpoint": join["endpoint"],
                "targetCandidateId": join["targetCandidateId"],
                "joinClass": join["joinClass"],
                "distancePx": _round(join["distancePx"]),
                "inkGapPx": _round(join["inkGapPx"]),
                "halfWidthPx": _round(join["halfWidthPx"]),
                "targetHalfWidthPx": _round(join["targetHalfWidthPx"]),
                "movedToX": join["movedToX"],
                "movedToY": join["movedToY"],
            }
            for join in sorted(
                joins, key=lambda item: (item["candidateId"], item["endpoint"])
            )
        ],
        "collapsedSlivers": centerline_collapsed,
        "removedMicroHoles": micro_holes,
        "doubts": doubts,
    }

    draft_path = annotations / "vector-map.region-partition.draft.json"
    payload = json.dumps(draft, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    if "--check" in sys.argv:
        current = draft_path.read_text(encoding="utf-8") if draft_path.exists() else ""
        if current != payload:
            raise SystemExit(
                "черновик разбиения устарел: пересоберите его запуском без --check"
            )
        print(f"\nчерновик разбиения актуален: {len(region_records)} областей, {len(doubts)} сомнений")
    else:
        draft_path.write_text(payload, encoding="utf-8")
        print(f"\nчерновик записан: {draft_path} ({len(payload) / 1024 / 1024:.2f} МБ)")
        print(f"   областей {len(region_records)}, сомнений {len(doubts)}")
        print(f"   областей без страны: {len(without_country)}")


if __name__ == "__main__":
    main()
