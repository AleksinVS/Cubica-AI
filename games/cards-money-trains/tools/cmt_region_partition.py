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

Поэтому здесь замыкание границ выводится из толщины обводки. Полное описание
способа и его обоснование — в разделе «Полное разбиение на области» файла
`games/cards-money-trains/annotations/README.md`, ход работы — в задаче
`docs/tasks/active/TSK-20260726-cmt-region-partition.md`.

Разбиение считается двумя независимыми способами, и их
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

# Доля площади участка, обязанная лежать внутри страновых заливок, чтобы участок
# считался игровой территорией. Значение измерено: 913 участков лежат внутри
# более чем на 99%, три — целиком снаружи, промежуточных значений нет.
EMPTY_SPACE_MAX_INSIDE_SHARE = 0.5


def effective_width(polygon: Polygon) -> float:
    """Насколько фигура «толстая»: удвоенная площадь, делённая на периметр.

    Для длинной узкой полосы эта величина равна её ширине. Для округлой фигуры
    она близка к её поперечнику. Величина нужна, чтобы отличить настоящую
    область от щели: щель длинная и узкая, поэтому у неё большой периметр при
    малой площади, и значение получается маленьким даже когда площадь заметная.
    Сравнение только по площади такую щель не поймало бы.
    """

    return 2.0 * polygon.area / polygon.length if polygon.length else 0.0


def classify_sliver_countries(
    sliver: Polygon,
    named_countries: list[tuple[str, str | None, Polygon]],
    min_share: float = 0.02,
) -> list[str]:
    """Страны, заметно перекрывающие щель (не менее `min_share` её площади).

    Обычная внутренняя щель (не на границе страны) пересекается ровно с одной
    страной почти по всей своей площади. Щель на границе двух стран — другое
    дело: она пересекается либо сразу с двумя странами (их заливки
    перекрываются, или щель лежит ровно между ними), либо ни с одной (щель —
    зазор МЕЖДУ двумя заливками, авторские контуры которых не сходятся точно в
    этом месте). Оба этих случая отличаются от обычной внутренней щели тем, что
    список здесь получается не из ровно одного элемента, и именно по этому
    признаку такую щель нужно отдельно отметить в реестре решений: присоединение
    всё равно происходит по тому же правилу самой длинной общей границы, но
    государственная граница на этом участке слегка сдвигается, и человек должен
    иметь возможность это увидеть и пересмотреть.
    """

    if sliver.area <= 0.0:
        return []
    touching: list[str] = []
    for country_id, _name, polygon in named_countries:
        if not polygon.intersects(sliver):
            continue
        overlap_area = polygon.intersection(sliver).area
        if overlap_area >= min_share * sliver.area:
            touching.append(country_id)
    return touching


def collapse_slivers(
    regions: list[Polygon],
    min_width: float = DOMINANT_STROKE_WIDTH_PX,
    named_countries: list[tuple[str, str | None, Polygon]] | None = None,
) -> tuple[list[Polygon], list[dict[str, Any]]]:
    """Схлопнуть узкие щели, присоединив каждую к соседу по длинной общей границе.

    Щели возникают вдоль границ стран: край цветной заливки идёт рядом с осевой
    линией лежащей поверх него обводки, и между ними остаётся узкая полоса.
    Областью такая полоса не является. Того же происхождения — узкие грани,
    целиком лежащие внутри нарисованной краски (сдвоенные линии); вызывающий
    код передаёт их сюда вместе с обычными щелями, не отбрасывая заранее.

    Порог взят равным толщине основной линии карты. Он измерен, а не назначен:
    при этом пороге под правило попадают ровно те фигуры, что лежат у границ
    стран, ни одной посторонней, а медианная ширина настоящей области примерно
    вчетверо больше порога.

    Щель не исчезает бесследно: каждое схлопывание возвращается отдельной
    записью и попадает в реестр решений — кроме тех редких случаев, где щель
    настолько мала (площадь после округления до шести знаков — как везде в
    этом файле — равна ровно 0.0, то есть меньше одной миллионной точки в
    квадрате), что печатать про неё запись было бы не честной фиксацией
    решения, а бессмысленным шумом; геометрия при этом всё равно объединяется,
    неучтённой остаётся только сама эта неизмеримая крошка площади, а не
    территория.

    Если передан `named_countries`, каждая запись дополнительно получает поле
    `touchingCountryIds` — список стран, заметно перекрывающих щель (см.
    classify_sliver_countries()). Это не меняет сам способ присоединения: щель
    всё равно достаётся соседу с самой длинной общей границей независимо от
    того, к какой стране он относится. Поле лишь помечает случаи, где щель
    лежит на границе двух стран или вовсе вне обеих заливок, — вызывающий код
    заносит такие случаи в реестр решений отдельным видом записи.
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
        if named_countries is not None:
            record["touchingCountryIds"] = classify_sliver_countries(
                sliver, named_countries
            )
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
        if record["areaPx2"] > 0.0:
            collapsed.append(record)

    return keep, collapsed


def merge_residual_micro_regions(
    regions: list[Polygon],
    min_area: float = MICRO_AREA_PX2,
    named_countries: list[tuple[str, str | None, Polygon]] | None = None,
) -> tuple[list[Polygon], list[dict[str, Any]]]:
    """Второй шанс для щелей, которые collapse_slivers() не смогла присоединить.

    collapse_slivers() выше присоединяет щели по длине общей границы с
    соседом, и это работает почти везде. Но там, где на карте сходятся сразу
    несколько пересекающихся линий, полигонизация иногда даёт вырожденную
    грань числовой ничтожности — площадью меньше MICRO_AREA_PX2, того же
    порога, что уже отделяет числовой шум от настоящей территории по всему
    этому файлу (drop_micro_holes(), summarize(), clip_regions_by_countries()).
    У такой вырожденной грани длина общей границы с соседом может по чистой
    числовой случайности измериться нулём, хотя геометрически грань явно
    чему-то прилегает — потому что её собственный контур настолько мал и
    неровен, что пересечение с буфером соседа даёт пустое множество или
    единственную точку, а не отрезок. Присоединение по длине границы в этом
    случае ненадёжно; вместо него берётся присоединение к ближайшему по
    расстоянию соседу — тот же принцип «к соседу», но единственным
    измерением, которое на такой геометрии вообще работает.

    Площадь и здесь не теряется бесследно: если объединение с ближайшим
    соседом не дало одной простой фигуры (в измеренных данных этого файла не
    происходит, но проверяется на будущее), фрагмент остаётся как есть, и это
    видно в возвращаемой записи по `merged: false` — как и в collapse_slivers().

    Запись о присоединении печатается, только если площадь фрагмента после
    округления до шести знаков (_round(), как и везде в этом файле) больше
    нуля. Некоторые из этих фрагментов настолько малы (меньше одной миллионной
    точки в квадрате — числовой мусор кластера пересекающихся линий, а не
    измеримая территория), что округление даёт ровно 0.0; схема черновика
    требует строго положительной площади у любой записи о присоединении, и это
    верно: печатать «присоединён участок площадью 0.0» было бы не честной
    записью решения, а бессмысленным шумом. Геометрия при этом объединяется
    всегда, независимо от того, печатается ли запись, — неучтённой в записи
    остаётся только сама эта неизмеримая крошка площади, а не территория.
    """

    keep = [region for region in regions if region.area >= min_area]
    tiny = [region for region in regions if region.area < min_area]
    resolved: list[dict[str, Any]] = []

    for fragment in sorted(tiny, key=lambda region: region.area):
        point = fragment.representative_point()
        record = {
            "areaPx2": _round(fragment.area),
            "effectiveWidthPx": _round(effective_width(fragment)),
            "atX": _round(point.x),
            "atY": _round(point.y),
            # Присоединение здесь идёт по расстоянию, а не по длине общей
            # границы (см. докстринг выше), поэтому это поле всегда 0 —
            # честно показывает, что обычное измерение collapse_slivers() тут
            # неприменимо, а не подделывает его несуществующим числом.
            "sharedBoundaryPx": 0.0,
            "merged": False,
        }
        if named_countries is not None:
            record["touchingCountryIds"] = classify_sliver_countries(
                fragment, named_countries
            )
        if keep:
            # Несколько соседей могут оказаться на одном и том же (нулевом)
            # расстоянии от вырожденного фрагмента: он лежит в точке, где
            # сходится сразу несколько других граней. Объединение с ближайшим
            # из них не обязано дать простую фигуру именно из-за вырожденности
            # самого фрагмента — поэтому здесь перебираются все соседи по
            # возрастанию расстояния, и берётся первый, для которого
            # объединение действительно сошлось в одну фигуру, а не первый
            # по расстоянию сам по себе.
            candidates_by_distance = sorted(
                range(len(keep)), key=lambda index: fragment.distance(keep[index])
            )
            merged_index = None
            for candidate_index in candidates_by_distance:
                merged = unary_union([keep[candidate_index], fragment])
                if isinstance(merged, Polygon):
                    keep[candidate_index] = merged
                    merged_index = candidate_index
                    break
            if merged_index is None:
                keep.append(fragment)
            else:
                record["merged"] = True
        else:
            keep.append(fragment)
        if record["areaPx2"] > 0.0:
            resolved.append(record)

    return keep, resolved


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
    соединения опирается именно на них: участок краски строится с
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


def separate_empty_spaces(
    regions: list[Polygon],
    countries: list[Polygon],
    max_inside_share: float = EMPTY_SPACE_MAX_INSIDE_SHARE,
) -> tuple[list[Polygon], list[Polygon]]:
    """Отделить пустые пространства от игровых областей.

    Пустое пространство — это вода или иная незанятая площадь: на карте она
    нарисована гладкой тёмной заливкой без внутреннего деления на области и не
    принадлежит ни одной стране. Игровой территорией она не является, поэтому
    областью считаться не должна.

    Признак прямой: игровая территория — это то, что покрыто цветной заливкой
    какой-либо страны. Участок, лежащий вне всех страновых заливок, к игре не
    относится.

    Порог измерен, а не назначен: из 919 участков 913 лежат внутри стран более
    чем на 99%, а три — целиком снаружи; значений между 10% и 99% нет вовсе, то
    есть полоса, в которой стоит порог, пуста.

    Пустые пространства не отбрасываются молча: они возвращаются отдельным
    списком и сохраняются в черновике.
    """

    if not countries:
        return regions, []

    land = unary_union(countries)
    playable: list[Polygon] = []
    empty: list[Polygon] = []
    for region in regions:
        inside = region.intersection(land).area / region.area if region.area else 0.0
        (playable if inside > max_inside_share else empty).append(region)
    return playable, empty


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

    Критерий: конец штриха соединён с другим штрихом тогда и только
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


# --- Новый критерий приёмки: связность графа соседства областей ---------------
#
# Зачем это нужно (для новичка в проекте): дорога в этой игре строится между
# соседними областями, а маршрут между терминалами разных стран — это цепочка
# соседств через несколько областей подряд. Если граф соседства (области —
# вершины, ребро — общая граница положительной длины) распадается на
# несколько частей, между областями из разных частей маршрута не существует
# вообще, и построить дорогу между ними нельзя ни при каком количестве денег.
# До исправления пустот в разбиении (см. main()) карта именно так и
# распадалась: 917 областей делились на шесть частей размерами 400, 234, 105,
# 99, 52 и 27 — по границам целых стран, — потому что незамкнутые пустоты
# рвали общую границу как раз там, где одна страна граничит с другой.


def build_region_adjacency(polygons: list[Polygon]) -> list[set[int]]:
    """Построить граф соседства: связаны области с общей границей ненулевой длины.

    Проверяется именно длина пересечения внешних контуров, а не просто факт
    пересечения: две области, соприкасающиеся только в одной точке (углом),
    не могут пропустить через эту точку дорогу и соседями в смысле этой игры
    не считаются.
    """

    tree = STRtree(polygons)
    neighbors: list[set[int]] = [set() for _ in polygons]
    for index, polygon in enumerate(polygons):
        for candidate in tree.query(polygon):
            candidate = int(candidate)
            if candidate <= index:
                # Пара уже обработана с другой стороны, либо это сама область.
                continue
            shared = polygon.exterior.intersection(polygons[candidate].exterior)
            if shared.length > 1e-6:
                neighbors[index].add(candidate)
                neighbors[candidate].add(index)
    return neighbors


def connected_components(neighbors: list[set[int]]) -> list[list[int]]:
    """Связные части графа соседства (обход в глубину без рекурсии).

    Без рекурсии — потому что при нескольких сотнях вершин глубина обхода
    легко превысила бы предел рекурсии Python на неудачно устроенном графе;
    явный стек этого ограничения не имеет.
    """

    visited = [False] * len(neighbors)
    components: list[list[int]] = []
    for start in range(len(neighbors)):
        if visited[start]:
            continue
        stack = [start]
        visited[start] = True
        component = [start]
        while stack:
            node = stack.pop()
            for neighbor in neighbors[node]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    stack.append(neighbor)
                    component.append(neighbor)
        components.append(component)
    return components


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


def assign_country(
    region: Polygon,
    countries: list[tuple[str, str, Polygon]],
) -> tuple[str | None, str | None]:
    """Привязать область к стране по её внутренней точке.

    Возвращает идентификатор страны игры и её название. Привязка выполняется
    геометрически: внутрь какой авторской заливки попала точка области, той
    стране область и принадлежит. Сама связь «заливка -> страна игры» уже
    установлена и проверена при извлечении стран.
    """

    point = region.representative_point()
    for country_id, name, polygon in countries:
        if polygon.covers(point):
            return country_id, name
    return None, None


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
        country_id, country_name = assign_country(region, countries)
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
                "countryId": country_id,
                "countryName": country_name,
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
        # touchingCountryIds присутствует только тогда, когда collapse_slivers()
        # вызвана с named_countries (так вызывается только сборка по осевым
        # линиям — см. main()). Ровно один элемент означает обычную внутреннюю
        # щель: она лежит внутри одной страны, и государственная граница не
        # меняется. Ноль или два и более элементов означают щель НА границе
        # стран — присоединение всё равно происходит по тому же sliverRule, но
        # государственная граница на этом участке слегка сдвигается, и это
        # обязано попасть в реестр отдельным видом записи, а не потеряться
        # среди обычных щелей.
        touching = record.get("touchingCountryIds")
        if touching is not None and len(touching) != 1:
            add(
                "country-border-gap-merged",
                (record["atX"], record["atY"]),
                (
                    "Щель на границе стран присоединена к соседней области по "
                    "самой длинной общей границе (правило sliverRule); "
                    "государственная граница на этом участке сместилась на "
                    "ширину щели."
                ),
                "Считать щель самостоятельной областью или провести границу иначе.",
                "medium",
                {
                    "areaPx2": record["areaPx2"],
                    "effectiveWidthPx": record["effectiveWidthPx"],
                    "merged": record["merged"],
                    "touchingCountryCount": len(touching),
                    "touchingCountryIds": touching,
                },
            )
        else:
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

    # Именованные страны (идентификатор игры, название, заливка) загружаются
    # здесь, раньше, чем раньше: щели, схлопываемые ниже собственным правилом
    # sliverRule, обязаны знать, какую страну (или страны) они затрагивают,
    # чтобы отличить обычную внутреннюю щель от щели на границе двух стран —
    # см. classify_sliver_countries(). Загрузка не зависит от флага
    # `--no-countries`: даже когда границы стран не участвуют в самом
    # разбиении, принадлежность области стране всё равно вычисляется — так
    # было и до этого переноса, когда блок читался позже, перед сборкой
    # черновика.
    countries_path = annotations / "vector-map.countries-stations.draft.json"
    countries_data = (
        json.loads(countries_path.read_text(encoding="utf-8"))
        if countries_path.exists()
        else {"countries": [], "stations": []}
    )
    named_countries = [
        (country.get("gameCountryId") or country["id"], country.get("name"), polygon)
        for country in countries_data.get("countries", [])
        for polygon in rings_to_polygons(country.get("contour") or [])
    ]

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
    # самостоятельная область, а внутренность самой линии — но и не пустота:
    # игровая территория под ней никуда не делась, поэтому грань обязана
    # присоединиться к соседней области, а не исчезнуть.
    #
    # НАЙДЕННАЯ И ИСПРАВЛЕННАЯ ОШИБКА. Раньше такие грани здесь просто
    # выбрасывались из списка областей, и покрытая ими территория не
    # доставалась ни одной области — получалась настоящая дыра в играбельной
    # карте. Пять из десяти авторских дорог проходили ровно через такие дыры:
    # маршрут дороги на этом отрезке не принадлежал ни одной области.
    # Измерение показало, что действующая ширина ВСЕХ таких граней (2290 из
    # 3247 до сверки в авторской карте) меньше толщины основной линии карты —
    # не больше 4.77 точки против порога 6.97, — то есть по уже принятому
    # правилу sliverRule они являются щелями и обязаны присоединиться к соседу
    # по самой длинной общей границе, как и любая другая щель. Поэтому здесь
    # эти грани больше не отбрасываются: они остаются в общем списке и ниже
    # передаются в collapse_slivers() вместе со всеми остальными гранями — тот
    # же вызов, что уже схлопывал щели у границ стран, находит соседа и для них.
    ink_covered_count = sum(
        1
        for region in centerline["regions"]
        if region.difference(ink).area < MICRO_AREA_PX2
    )
    print(
        "граней внутри краски (щелей у сдвоенных линий, подлежат схлопыванию): "
        f"{ink_covered_count}"
    )

    # Защитная проверка вместо тихого возврата к старому поведению. Вывод выше
    # опирается на измеренный факт: такие грани УЖЕ уже основной линии. Если
    # это когда-нибудь перестанет быть так (новый авторский файл, другая
    # обводка), автоматическое схлопывание широкой грани щелью было бы не
    # измерением, а новым допуском — правильнее остановиться и разобраться.
    oversized_ink_covered = [
        region
        for region in centerline["regions"]
        if region.difference(ink).area < MICRO_AREA_PX2
        and effective_width(region) >= DOMINANT_STROKE_WIDTH_PX
    ]
    if oversized_ink_covered:
        point = oversized_ink_covered[0].representative_point()
        raise SystemExit(
            "грань внутри краски шире основной линии карты "
            f"({effective_width(oversized_ink_covered[0]):.3f} >= "
            f"{DOMINANT_STROKE_WIDTH_PX}) у точки ({point.x:.1f}, {point.y:.1f}); "
            "автоматическое схлопывание такой грани щелью было бы предположением, "
            "не измерением — нужно решение человека"
        )

    centerline["regions"], centerline_collapsed = collapse_slivers(
        centerline["regions"], named_countries=named_countries
    )
    print(f"узких щелей схлопнуто: {len(centerline_collapsed)}")

    # Второй шанс для тех немногих щелей (в измеренных данных — 5), которые
    # collapse_slivers() выше не смогла присоединить: на кластерах, где
    # сходятся сразу несколько пересекающихся линий, полигонизация иногда даёт
    # вырожденную грань числовой ничтожности, у которой длина общей границы с
    # соседом по чистой числовой случайности измеряется нулём. См. докстринг
    # merge_residual_micro_regions() — присоединение здесь идёт по расстоянию,
    # а не по длине границы, единственному измерению, которое на такой
    # геометрии вообще работает.
    centerline["regions"], residual_micro_merged = merge_residual_micro_regions(
        centerline["regions"], named_countries=named_countries
    )
    print(
        "вырожденных граней-остатков присоединено вторым шансом: "
        f"{len(residual_micro_merged)}"
    )
    centerline_collapsed = centerline_collapsed + residual_micro_merged

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

    # Пустые пространства (вода) исключаются из обоих разбиений до сверки: они
    # не игровая территория, и их присутствие с одной стороны выглядело бы
    # расхождением способов, хотя расхождения нет.
    real_paint, paint_empty = separate_empty_spaces(real_paint, country_polygons)
    real_center, empty_spaces = separate_empty_spaces(real_center, country_polygons)
    print(f"пустых пространств исключено: {len(empty_spaces)} по осевым, {len(paint_empty)} по краске")

    # Проверка полноты замощения. Играбельная карта — это объединение всех
    # страновых заливок за вычетом трёх исключённых пустых пространств (морей):
    # внутри неё не должно остаться ни одного участка, не принадлежащего ни
    # одной области. До исправления обработки граней внутри краски здесь
    # оставалось 30687 точек в квадрате пустоты в 852 отдельных местах — ровно
    # там, где потом проваливались авторские дороги. Проверка не чинит пропуски
    # сама: если она находит хоть один, значит sliverRule почему-то не
    # сработал выше, и это повод остановиться и разобраться, а не придумать
    # здесь новый допуск.
    if country_polygons:
        playable_land = unary_union(country_polygons)
        covered_land = unary_union(real_center + empty_spaces)
        residual_void = playable_land.difference(covered_land)
        residual_void_area = residual_void.area
        if residual_void_area > 1e-6:
            void_parts = [
                part
                for part in getattr(residual_void, "geoms", [residual_void])
                if part.area > 1e-9
            ]
            raise SystemExit(
                f"в играбельной карте осталось {residual_void_area:.3f} точки "
                f"в квадрате пустоты в {len(void_parts)} местах, не "
                "принадлежащих ни одной области и ни одному пустому "
                "пространству; sliverRule обязан был присоединить их к соседу "
                "выше, но не сработал — нужен разбор причины, а не новый допуск"
            )
        print("проверка полноты замощения играбельной карты: пустот не найдено")

    comparison = compare_partitions(real_paint, real_center)
    print(f"областей, совпавших один к одному: {comparison['pairCount']}")
    print(f"область краски без пары (слиты «осевыми»): {len(comparison['paintWithoutPair'])}")
    print(f"область краски разрезана «осевыми» надвое и более: {len(comparison['paintSplitInTwoOrMore'])}")
    print(f"область «осевых» без однозначной пары: {len(comparison['centerlineWithoutPair'])}")

    agreement = comparison["pairCount"] / max(len(real_paint), len(real_center))
    print(f"доля согласия: {agreement:.2%}")

    # --- постоянный артефакт черновика ---------------------------------------
    # countries_path / countries_data / named_countries уже загружены в самом
    # начале main() — раньше, чем здесь, потому что collapse_slivers() выше
    # уже использовала named_countries для классификации щелей.

    # Перечень пустых пространств берётся от способа «краска»: он образует их
    # все как отдельные участки, тогда как способ «осевые» часть из них вовсе не
    # замыкает в грань. Для каждого отмечается, увидел ли его второй способ.
    centerline_empty_tree = STRtree(empty_spaces) if empty_spaces else None
    empty_records = []
    for order, space in enumerate(stable_region_order(paint_empty), start=1):
        seen_by_centerline = False
        if centerline_empty_tree is not None:
            probe = space.representative_point()
            seen_by_centerline = any(
                empty_spaces[int(i)].covers(probe)
                for i in centerline_empty_tree.query(probe)
            )
        min_x, min_y, max_x, max_y = space.bounds
        point = space.representative_point()
        empty_records.append(
            {
                "id": f"empty-space-{order:04d}",
                "geometryFingerprint": geometry_fingerprint(space),
                "areaPx2": _round(space.area),
                "bounds": {
                    "minX": _round(min_x),
                    "minY": _round(min_y),
                    "maxX": _round(max_x),
                    "maxY": _round(max_y),
                },
                "representativePoint": {"x": _round(point.x), "y": _round(point.y)},
                "interpretation": (
                    "пустое пространство: вода или иная незанятая площадь вне "
                    "всех страновых заливок; игровой территорией не является"
                ),
                "foundByBothMethods": seen_by_centerline,
                "exteriorRing": [
                    [_round(x), _round(y)] for x, y in space.exterior.coords
                ],
            }
        )

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
    without_country = [r["id"] for r in region_records if r["countryId"] is None]

    # Новый критерий приёмки: граф соседства обязан быть связным (см.
    # build_region_adjacency()/connected_components() выше). stable_region_order()
    # — чистая функция уже собранного списка областей, поэтому повторный вызов
    # здесь на том же real_center детерминированно даёт тот же порядок, каким
    # build_regions() уже пронумеровала области: индекс i в графе соответствует
    # region_records[i].
    print("\n--- граф соседства областей ---")
    ordered_polygons_for_adjacency = stable_region_order(real_center)
    adjacency = build_region_adjacency(ordered_polygons_for_adjacency)
    components = connected_components(adjacency)
    components.sort(key=len, reverse=True)
    component_sizes = [len(component) for component in components]
    cross_country_adjacency_count = 0
    same_country_adjacency_count = 0
    for index, neighbor_set in enumerate(adjacency):
        for neighbor in neighbor_set:
            if neighbor <= index:
                continue
            if region_records[index]["countryId"] != region_records[neighbor]["countryId"]:
                cross_country_adjacency_count += 1
            else:
                same_country_adjacency_count += 1
    print(f"связных частей: {len(components)}; размеры частей: {component_sizes}")
    print(f"переходов между областями разных стран: {cross_country_adjacency_count}")
    print(f"переходов между областями одной страны: {same_country_adjacency_count}")
    if len(components) != 1:
        raise SystemExit(
            f"граф соседства областей распался на {len(components)} несвязных "
            f"частей размерами {component_sizes}; маршрут между областями из "
            "разных частей не существует, строительство дорог между ними "
            "невозможно ни при каком бюджете — разбиение непригодно для "
            "алгоритмов, пока связность не восстановлена"
        )

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
            "decisionRecord": "games/cards-money-trains/annotations/README.md#полное-разбиение-на-области",
            "authoritativeMethod": "centerlines-with-ink-derived-tolerance",
            "verificationMethod": "paint-free-space",
            "semanticAssignmentsConfirmed": False,
            "runtimeIntegrationAllowed": False,
            "flattenTolerancePx": FLATTEN_TOLERANCE_PX,
            "dominantStrokeWidthPx": DOMINANT_STROKE_WIDTH_PX,
            "emptySpaceRule": (
                "Участок, лежащий вне всех страновых заливок, считается пустым "
                "пространством (водой) и игровой областью не является. Порог "
                "измерен: 913 участков внутри стран более чем на 99%, три — "
                "целиком снаружи, промежуточных значений нет."
            ),
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
            "emptySpaceCount": len(empty_records),
            "totalAreaPx2": center_summary["totalAreaPx2"],
            "connectedComponentCount": len(components),
            "largestConnectedComponentSize": component_sizes[0] if component_sizes else 0,
            "crossCountryAdjacencyCount": cross_country_adjacency_count,
        },
        "regions": region_records,
        "emptySpaces": empty_records,
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
        # Поле touchingCountryIds — диагностика для build_doubts() выше, не
        # часть постоянной формы записи collapsedSliver (её закрепляет схема
        # шестью полями: areaPx2, effectiveWidthPx, atX, atY, sharedBoundaryPx,
        # merged). Здесь она отбрасывается, чтобы список остался в прежней,
        # проверенной схемой форме независимо от того, помогла ли эта
        # диагностика построить какой-то doubt.
        "collapsedSlivers": [
            {
                "areaPx2": record["areaPx2"],
                "effectiveWidthPx": record["effectiveWidthPx"],
                "atX": record["atX"],
                "atY": record["atY"],
                "sharedBoundaryPx": record["sharedBoundaryPx"],
                "merged": record["merged"],
            }
            for record in centerline_collapsed
        ],
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
