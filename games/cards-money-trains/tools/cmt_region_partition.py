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

from shapely import STRtree, make_valid, polygonize_full, set_precision, unary_union
from shapely.geometry import LineString, Point, Polygon, box

# Модуль прежнего конвейера лежит рядом; путь добавляется явно, чтобы скрипт
# запускался из любого каталога.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Модуль прежнего конвейера переиспользуется, чтобы сглаживание кривых Безье и
# перевод в канонические координаты выполнялись ровно так же, как в уже принятых
# отчётах. Расхождение в этом месте сделало бы два результата несравнимыми.
from vector_map_polygonizer import flatten_candidate, geometry_fingerprint  # noqa: E402

# Построение маски непроходимой местности (растровое измерение -> векторная
# геометрия, классификация местность/декорация, отделение реки от границы) —
# отдельный вопрос от геометрической хирургии самого разбиения, вынесенный в
# свой модуль; см. докстринг у build_impassable_terrain_mask() ниже.
import cmt_impassable_terrain  # noqa: E402


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

# Шаг сетки, в которой хранятся координаты черновика: шесть знаков после
# запятой (см. `_round()`). Это не отдельная настройка, а то же самое
# разрешение, записанное числом, чтобы логические операции можно было
# проводить СРАЗУ в нём (`grid_size` у операций shapely), а не округлять
# результат после них. Округление после операции сдвигает узлы общей границы
# на величину до половины шага, и половина узлов уезжает внутрь соседа —
# именно так и возникали неизмеримо узкие наложения областей.
COORDINATE_GRID_PX = 1e-6

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


def foreign_area_after_merge(
    sliver: Polygon,
    own_country_id: str | None,
    named_countries: list[tuple[str, str | None, Polygon]],
) -> float:
    """Сколько площади щели фактически принадлежит ЧУЖОЙ стране.

    Запись `country-border-gap-merged` утверждает конкретную вещь: «здесь
    сдвинулась государственная граница». Граница сдвигается ровно тогда, когда
    щель — хотя бы частично — лежала на территории ДРУГОЙ страны, а затем
    досталась соседней области, принадлежащей стране `own_country_id`. Если
    же вся щель лежала внутри собственной страны области, к которой она
    присоединилась, никакая чужая территория никуда не перешла, и это уже
    обычная внутренняя щель, а не сдвиг границы, — вне зависимости от того,
    что происходит в нескольких точках карты рядом.

    Это первая версия признака, проверяющая утверждение НАПРЯМУЮ, а не через
    приближение. Две прежние версии проверяли не саму претензию, а её признаки
    (сначала долю площади, потом расстояние до заливки — обе доли доступны в
    истории файла и в README), и обе ошибались именно потому, что признак —
    не то же самое, что утверждение. Прямая проверка — пересечение реальной
    геометрии щели с реальной геометрией заливки чужой страны — ошибаться по
    этой причине уже не может: либо чужая площадь действительно есть, либо её
    нет.

    Возвращает площадь пересечения щели со всеми заливками стран, ЧЕЙ
    идентификатор не совпадает с `own_country_id` (в их числе учитываются даже
    страны, чьи заливки просто лежат по соседству без общей истории с этой
    щелью, — если геометрического пересечения нет, эта страна и не даёт вклада
    в сумму, отдельно перечислять её не нужно). Если `own_country_id` равен
    `None` (область, в которую вошла щель, сама не привязана ни к одной
    стране — на измеренной карте таких нет, но защититься дёшево), исключать
    нечего, и в сумму идёт пересечение со всеми странами без исключения.
    """

    if sliver.area <= 0.0:
        return 0.0
    return sum(
        polygon.intersection(sliver).area
        for country_id, _name, polygon in named_countries
        if country_id != own_country_id
    )


def collapse_slivers(
    regions: list[Polygon],
    min_width: float = DOMINANT_STROKE_WIDTH_PX,
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

    Является ли щель щелью НА границе двух стран, эта функция не решает —
    решение требует знать, в какую итоговую область щель попала и какой
    стране эта область принадлежит, а обе эти вещи известны только после
    полной сборки черновика (см. build_regions()/build_doubts() в main()).
    Поэтому каждая запись здесь несёт временное поле `sliverPolygon` — сам
    объект геометрии щели (не строка, не координаты; отбрасывается перед
    сериализацией) — чтобы build_doubts() могла позже проверить прямое
    утверждение «эта площадь принадлежала другой стране» через
    foreign_area_after_merge(), не восстанавливая геометрию заново из
    округлённых координат.
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
            # См. докстринг выше: объект геометрии, не координаты — временное
            # поле для build_doubts(), отбрасывается перед записью на диск
            # (ни в doubts[], ни тем более в постоянный список collapsedSlivers
            # объект Python попасть не должен — JSON не умеет его хранить).
            "sliverPolygon": sliver,
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
        if record["areaPx2"] > 0.0:
            collapsed.append(record)

    return keep, collapsed


def merge_residual_micro_regions(
    regions: list[Polygon],
    min_area: float = MICRO_AREA_PX2,
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
            # См. тот же комментарий в collapse_slivers() выше: объект
            # геометрии, не координаты — временное поле для build_doubts(),
            # отбрасывается перед записью на диск.
            "sliverPolygon": fragment,
        }
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


def _all_rings(polygon: Polygon) -> list[Any]:
    """Все контуры многоугольника: внешний и, если есть, внутренние (дырки).

    До вырезания непроходимой местности внутренние кольца встречались только
    как ничтожные числовые артефакты (см. `drop_micro_holes()`), поэтому
    прежняя проверка соседства смотрела только на внешний контур. Теперь
    внутреннее кольцо может означать настоящий анклав — область, вырезанная
    внутри другой, — и её общая граница с областью вокруг лежит именно на
    ЭТОМ внутреннем кольце, а не где-либо на внешнем контуре анклава. Не
    учитывать внутренние кольца здесь означало бы, что анклав никогда не
    получает соседей — то есть граф соседства был бы неверен именно там, где
    вырезание местности только что произошло.
    """

    return [polygon.exterior, *polygon.interiors]



def conform_partition_to_shared_grid(
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    """Одна общая посадка всего разбиения на сетку хранения координат.

    ЗАЧЕМ. Черновик хранит координаты с шестью знаками после запятой — это
    сетка с шагом 10⁻⁶ точки карты. Каждая область округляется до этой сетки
    НЕЗАВИСИМО от соседей. Для подавляющего большинства общих границ это
    неважно: обе стороны получают одни и те же узлы. Но там, где у одной
    области вдоль общей границы есть вершина, а у соседа между двумя его
    собственными узлами идёт прямая, возникает расхождение: прямая между двумя
    узлами сетки, вообще говоря, не проходит через третий узел, поэтому чужая
    вершина оказывается на полшага сетки ВНУТРИ соседа. Вдоль всей общей
    границы набирается цепочка таких треугольничков — наложение площадью в
    единицы миллионных долей точки в квадрате. На картинке его не видно ни при
    каком увеличении, но проверка платформы считает непересечение областей
    точно, без допуска, и такую пару отвергает.

    ЧТО ДЕЛАЕТ. Ровно одно действие на всё разбиение сразу: каждая вершина,
    отстоящая от чужой стороны не дальше одного шага сетки, ВСТАВЛЯЕТСЯ в эту
    сторону. После этого обе стороны общей границы проходят через один и тот
    же упорядоченный набор точек — то есть общая граница описана буквально
    одной и той же ломаной с обеих сторон. Совпадающие координаты не могут
    наложиться ни на каком последнем разряде, и наложению просто негде
    возникнуть.

    ЧЕМ ЭТО ЛУЧШЕ ПРЕЖНЕГО. Раньше здесь стояла починка по парам: найти
    наложившуюся пару и вычесть наложение из одной из областей. Она лечила
    следствие и делала это разрушительно — наложение тянется вдоль ВСЕЙ общей
    границы, поэтому вычитание отрывало пару друг от друга целиком. Измерено
    на этой карте: 13 пар теряли общую границу, суммарно 718 точек из 870, а
    одна область (`map-region-0699`) оставалась островом, отчего играбельный
    граф соседства распадался надвое. Соседство здесь не косметика: именно по
    общей границе планировщик и проводит дорогу (ADR-100), так что оторванная
    граница — это запрет проезда там, где земля на самом деле сплошная.
    Посадка на сетку вершин не двигает и границ не рвёт: она только ДОБАВЛЯЕТ
    в контур уже существующие узлы сетки.

    ДОПУСК. Один шаг сетки (10⁻⁶). Расхождение такого масштаба может породить
    только независимое округление; всё, что дальше, — настоящая подробность
    карты, и её трогать нельзя. Поэтому больший допуск здесь не «надёжнее», а
    просто неверен.

    Возвращает измерения для отчёта: сколько вершин вставлено и у скольких
    областей изменился контур.
    """

    tolerance = COORDINATE_GRID_PX

    # Кольца всех областей в одном плоском списке: (индекс записи, индекс
    # кольца, точки замкнутого кольца). Индекс кольца 0 — внешний контур,
    # дальше — внутренние (дырки).
    rings: list[tuple[int, int, list[list[float]]]] = []
    for record_index, record in enumerate(records):
        rings.append((record_index, 0, record["exteriorRing"]))
        for ring_index, ring in enumerate(record.get("interiorRings") or []):
            rings.append((record_index, ring_index + 1, ring))

    # Дерево по ВСЕМ сторонам разбиения сразу. Именно это и делает посадку
    # общей: вопрос «нет ли рядом чужой стороны» задаётся один раз всему
    # разбиению, а не отдельно каждой подозрительной паре.
    segments: list[LineString] = []
    segment_owner: list[tuple[int, int]] = []  # (индекс кольца в rings, номер стороны)
    for ring_position, (_, _, points) in enumerate(rings):
        for index in range(len(points) - 1):
            segments.append(LineString([tuple(points[index]), tuple(points[index + 1])]))
            segment_owner.append((ring_position, index))
    tree = STRtree(segments)

    # Вставки: кольцо -> номер стороны -> список точек, которые обязаны на ней
    # лежать. Ключ точки — кортеж координат, чтобы одна и та же вершина от
    # нескольких соседей не вставилась дважды.
    insertions: dict[int, dict[int, set[tuple[float, float]]]] = {}
    inserted_vertices = 0

    for ring_position, (record_index, _, points) in enumerate(rings):
        for point in points[:-1]:
            vertex = Point(point[0], point[1])
            for candidate in tree.query(vertex, predicate="dwithin", distance=tolerance):
                candidate = int(candidate)
                target_ring, segment_index = segment_owner[candidate]
                if target_ring == ring_position:
                    # Своё же кольцо: собственные вершины на собственных
                    # сторонах — это вопрос чистки контура, а не посадки.
                    continue
                if rings[target_ring][0] == record_index:
                    # Другое кольцо той же области (анклав внутри дырки):
                    # общая граница у них есть, но она уже описана одним и тем
                    # же контуром, поэтому вставлять нечего.
                    continue
                segment = segments[candidate]
                start, end = list(segment.coords)
                key = (point[0], point[1])
                if key == tuple(start) or key == tuple(end):
                    continue  # вершина уже есть у соседа — сажать нечего
                if vertex.distance(segment) > tolerance:
                    continue
                insertions.setdefault(target_ring, {}).setdefault(segment_index, set()).add(key)

    if not insertions:
        return {"insertedVertexCount": 0, "changedRegionCount": 0}

    changed_records: set[int] = set()
    for ring_position, by_segment in insertions.items():
        record_index, ring_index, points = rings[ring_position]
        rebuilt: list[list[float]] = []
        for index in range(len(points) - 1):
            start = points[index]
            rebuilt.append(start)
            extra = by_segment.get(index)
            if not extra:
                continue
            end = points[index + 1]
            span_x = end[0] - start[0]
            span_y = end[1] - start[1]
            span = span_x * span_x + span_y * span_y
            if span <= 0:
                continue
            # Точки ставятся в порядке движения ВДОЛЬ стороны, иначе контур
            # завернулся бы сам на себя.
            ordered = sorted(
                extra,
                key=lambda p: ((p[0] - start[0]) * span_x + (p[1] - start[1]) * span_y) / span,
            )
            for point in ordered:
                rebuilt.append([point[0], point[1]])
                inserted_vertices += 1
        rebuilt.append(list(points[-1]))

        if ring_index == 0:
            records[record_index]["exteriorRing"] = rebuilt
        else:
            records[record_index]["interiorRings"][ring_index - 1] = rebuilt
        changed_records.add(record_index)

    # Поля, зависящие от геометрии, обязаны описывать то, что записано.
    for record_index in changed_records:
        record = records[record_index]
        record.update(_region_geometry_fields(Polygon(
            [tuple(p) for p in record["exteriorRing"]],
            [[tuple(p) for p in ring] for ring in record.get("interiorRings", [])],
        )))

    return {
        "insertedVertexCount": inserted_vertices,
        "changedRegionCount": len(changed_records),
    }


def assert_no_overlapping_regions(records: list[dict[str, Any]]) -> None:
    """Остановиться, если хоть какие-то две области делят площадь.

    Проверка, а не починка — и это принципиально. После общей посадки на сетку
    (см. `conform_partition_to_shared_grid()`) наложений быть не может по
    построению, поэтому найденное здесь наложение означает не «шум округления,
    который надо подтереть», а настоящую ошибку конвейера. Прежняя версия
    этого места именно чинила, и починка молча рвала общие границы; теперь
    неправильное состояние обязано остановить сборку и потребовать разбора.
    """

    polygons = [
        Polygon(
            [tuple(p) for p in record["exteriorRing"]],
            [[tuple(p) for p in ring] for ring in record.get("interiorRings", [])],
        )
        for record in records
    ]
    tree = STRtree(polygons)
    overlaps: list[str] = []
    for index, polygon in enumerate(polygons):
        for candidate in tree.query(polygon):
            candidate = int(candidate)
            if candidate <= index:
                continue
            shared = polygon.intersection(polygons[candidate])
            if shared.is_empty or shared.area <= 0.0:
                continue
            overlaps.append(
                f"{records[index]['id']}/{records[candidate]['id']} на "
                f"{shared.area:.9f} точки в квадрате"
            )
    if overlaps:
        raise SystemExit(
            f"после общей посадки на сетку области всё ещё накладываются "
            f"({len(overlaps)} пар): {'; '.join(overlaps[:10])}"
            + (" …" if len(overlaps) > 10 else "")
            + ". Это ошибка конвейера, а не шум округления, и требует разбора "
            "человеком, а не тихой правки геометрии"
        )


def build_region_adjacency(polygons: list[Polygon]) -> list[set[int]]:
    """Построить граф соседства: связаны области с общей границей ненулевой длины.

    Проверяется именно длина пересечения контуров, а не просто факт
    пересечения: две области, соприкасающиеся только в одной точке (углом),
    не могут пропустить через эту точку дорогу и соседями в смысле этой игры
    не считаются. Проверяются ВСЕ контуры каждой области (внешний и все
    внутренние — см. `_all_rings()`), потому что анклав внутри дырки другой
    области граничит именно с её внутренним контуром.
    """

    tree = STRtree(polygons)
    neighbors: list[set[int]] = [set() for _ in polygons]
    for index, polygon in enumerate(polygons):
        left_rings = _all_rings(polygon)
        for candidate in tree.query(polygon):
            candidate = int(candidate)
            if candidate <= index:
                # Пара уже обработана с другой стороны, либо это сама область.
                continue
            shared_length = 0.0
            for left_ring in left_rings:
                for right_ring in _all_rings(polygons[candidate]):
                    shared_length += left_ring.intersection(right_ring).length
                    if shared_length > 1e-6:
                        break
                if shared_length > 1e-6:
                    break
            if shared_length > 1e-6:
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
    locate_region_id: Any,
    region_country_by_id: dict[str, str | None],
    named_countries: list[tuple[str, str | None, Polygon]],
) -> list[dict[str, Any]]:
    """Собрать реестр мест, где решение принято не однозначно.

    В реестр попадает всё, что человек может захотеть перепроверить: места
    расхождения двух способов, соединения-предположения, схлопнутые щели и
    оставшиеся незамкнутые концы. Каждая запись называет принятую трактовку и
    рассмотренную замену, чтобы решение можно было пересмотреть, не пересчитывая
    всё заново.

    `locate_region_id` — функция вида `(x, y) -> str | None`, определяющая
    финальный идентификатор области (`map-region-NNNN`), чья геометрия
    содержит точку. Она нужна записи `country-border-gap-merged` дважды:
    сначала — назвать «в какую сторону присоединилась» щель (половина того,
    что решает проверяющий человек), затем — узнать countryId этой области
    через `region_country_by_id`, чтобы foreign_area_after_merge() могла
    проверить прямое утверждение «часть щели принадлежала другой стране», а
    не полагаться на приближение через расстояние.
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
        # sliverPolygon — временное поле (сам объект геометрии), которое
        # collapse_slivers()/merge_residual_micro_regions() кладут в record
        # при постройке щели (см. докстринг collapse_slivers()). Оно обязано
        # быть здесь всегда: отсутствие — не повод молча пропустить запись, а
        # рассогласование конвейера, о котором обязан узнать человек.
        sliver_polygon = record.get("sliverPolygon")
        if sliver_polygon is None:
            raise SystemExit(
                f"у щели в точке ({record['atX']}, {record['atY']}) нет "
                "геометрии (sliverPolygon отсутствует) — конвейер обязан "
                "сохранить полигон щели при её постройке; проверьте "
                "collapse_slivers()/merge_residual_micro_regions()"
            )

        # Претензия «государственная граница сдвинулась» проверяется здесь
        # напрямую, а не через приближение (ни через долю перекрытия, ни через
        # расстояние — обе более ранние версии этого признака проверяли не то
        # утверждение, которое печаталось в записи; см. README). Граница
        # сдвигается ровно тогда, когда щель — хотя бы частично — лежала на
        # территории ДРУГОЙ страны и досталась соседу другой страны. Щель,
        # которую не удалось присоединить (merged=False), никуда не вошла:
        # проверить, чья территория "перешла", здесь буквально не к чему —
        # такая щель не может нести эту претензию и остаётся обычной
        # collapsed-sliver независимо от того, что происходит по соседству.
        merged_into_region_id = None
        foreign_area = None
        if record["merged"]:
            # «В какую сторону присоединилась щель» — половина того, что
            # решает человек, поэтому финальный номер области, в которую щель
            # физически вошла, ищется здесь же.
            merged_into_region_id = locate_region_id(record["atX"], record["atY"])
            if merged_into_region_id is None:
                raise SystemExit(
                    "щель в точке "
                    f"({record['atX']}, {record['atY']}) помечена как "
                    "присоединённая (merged=True), но ни одна финальная "
                    "область не содержит эту точку — рассогласование "
                    "конвейера, а не повод молча записать null"
                )
            own_country_id = region_country_by_id.get(merged_into_region_id)
            foreign_area = foreign_area_after_merge(
                sliver_polygon, own_country_id, named_countries
            )

        # Решение принимается по ОКРУГЛЁННОЙ площади, а не по исходному числу
        # с плавающей запятой — тем же правилом, каким весь этот файл везде
        # отличает настоящую величину от вычислительного шума (см. `_round()`
        # и его использование в collapse_slivers()/merge_residual_micro_regions():
        # "площадь после округления до шести знаков равна ровно 0.0" уже там
        # означает "печатать нечего, это не территория, а крошка шума"). Без
        # этого шага запись могла бы утверждать "граница сдвинулась" и тут же
        # печатать foreignAreaPx2: 0.0 — цифра прямо в самой записи опровергала
        # бы её же вид, а не просто была бы неточной. Это не новый порог
        # отсечения (см. задание — вводить его нельзя): это тот же самый порог
        # ничтожности плавающей запятой, применённый там же, где он уже
        # применяется к площади самой щели несколькими строками выше.
        foreign_area_rounded = _round(foreign_area) if foreign_area is not None else None

        if foreign_area_rounded is not None and foreign_area_rounded > 0.0:
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
                    "outline": [
                        [_round(x), _round(y)]
                        for x, y in sliver_polygon.exterior.coords
                    ],
                    "mergedIntoRegionId": merged_into_region_id,
                    "foreignAreaPx2": foreign_area_rounded,
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


# --- Финальный шаг: вырезание непроходимой местности из разбиения -------------
#
# Продюсер решил: нарисованная художником тёмно-коричневая местность (и река,
# соединяющая два озера в одном месте) — игровая территория, на которой нельзя
# строить дороги. Она уже присутствовала на карте раньше, просто не была
# выделена: этот шаг вырезает её как области своего рода из уже собранного
# разбиения — единственное место во всём конвейере, которое это делает (см.
# заголовок модуля: «черновик остаётся под одним владельцем»).
#
# Само построение маски местности (какие растровые пятна — местность, а какие
# декорация; где кончается река и начинается государственная граница) вынесено
# в `cmt_impassable_terrain.py` — это отдельный вопрос («что вырезать»), тогда
# как здесь решается только «как вырезать», то есть геометрическая хирургия
# самого разбиения.

# Поле, которым новая область помечается как непроходимая местность (см.
# схему `vector-map-region-partition.schema.json`). Название описывает факт
# («это местность, непроходимая для дорог»), а не механизм получения области,
# потому что первое не изменится, даже если способ вырезания местности когда-
# нибудь станет другим.
IMPASSABLE_TERRAIN_FIELD = "isImpassableTerrain"


def connected_polygon_pieces(geometry: Any) -> list[Polygon]:
    """Разложить результат геометрической операции на отдельные многоугольники.

    Пересечение и разность многоугольников в shapely могут вернуть не только
    один `Polygon`, но и `MultiPolygon`, пустую фигуру или (крайне редко)
    вырожденную линию/точку нулевой площади. Здесь остаются только настоящие
    многоугольники положительной площади — ровно то, что дальше может стать
    отдельной областью.
    """

    if geometry.is_empty:
        return []
    parts = list(getattr(geometry, "geoms", [geometry]))
    return [part for part in parts if isinstance(part, Polygon) and not part.is_empty and part.area > 0.0]


def _region_geometry_fields(polygon: Polygon) -> dict[str, Any]:
    """Пересчитать все поля черновика, зависящие только от геометрии области.

    Вынесено отдельной функцией, потому что этот же набор полей нужно
    пересчитать дважды: и для области, из которой вырезали кусок (у неё
    геометрия меняется, но не идентичность), и для только что появившейся
    новой области.

    Геометрия проверяется на допустимость до округления координат и, отдельно,
    после него: округление до шести знаков (`_round()`, как и везде в этом
    файле — поразрядно, без пересчёта топологии) обязано быть безопасным
    преобразованием, но само по себе это не доказано. Измерено: после
    хирургии, вычитающей и объединяющей куски друг с другом несколько раз
    подряд, у некоторых областей находятся две РАЗНЫЕ вершины на расстоянии
    меньше одной миллионной точки карты друг от друга — расстояние, которое
    породила сама геометрическая операция, а не авторский контур; поразрядное
    округление превращает такую пару в одну и ту же точку и тем самым — в
    вырожденную сторону нулевой длины или самопересечение.

    НАЙДЕННАЯ И ОТВЕРГНУТАЯ ПОПЫТКА: `shapely.set_precision()` (снижение
    точности координат целой геометрией, а не поразрядно) устраняет именно эту
    невалидность, но ценой, обнаруженной только измерением, а не с первого
    взгляда, — она может пересобрать вершины на значительном протяжении
    контура ДАЛЕКО от места самого разреза (не только у самой невалидной пары
    точек), и это измеренно сдвигало на несколько точек карты границу с
    СОСЕДНЕЙ, нетронутой хирургией областью, порождая настоящее (хоть и
    небольшое) наложение областей — то же наложение, которое отдельно ловит
    общий валидатор аннотации при сборке манифеста. Это хуже отсутствия
    проверки: `set_precision()` решала одну измеренную невалидность, но
    создавала другую, менее заметную здесь и обнаруживаемую только на
    следующем шаге конвейера. Поэтому вместо этого при обнаруженной
    невалидности после поразрядного округления применяется `buffer(0)` —
    стандартный приём shapely для локального исправления самопересечений,
    не пересобирающий контур целиком, — и только к САМОЙ невалидной фигуре, а
    не ко всем регионам без разбора.
    """

    if not polygon.is_valid:
        point = polygon.representative_point()
        raise SystemExit(
            f"область с недопустимой геометрией (самопересечение или иная "
            f"невалидность) у точки ({point.x:.3f}, {point.y:.3f}) — до "
            "округления координат; хирургия обязана давать только допустимые "
            "многоугольники, это рассогласование конвейера, а не законный "
            "случай, который стоит округлять как есть"
        )

    min_x, min_y, max_x, max_y = polygon.bounds
    point = polygon.representative_point()

    def dedupe_consecutive(ring: list[list[float]]) -> list[list[float]]:
        # Округление до шести знаков может свести две соседние (различные до
        # округления) вершины в одну и ту же точку — измерено, что это
        # происходит после нескольких операций пересечения/вычитания подряд
        # (см. докстринг функции выше). Пара одинаковых соседних точек — это
        # сторона нулевой длины, а не настоящая деталь контура; она убирается
        # тем же способом, каким apply_ink_joins() выше уже убирает такие же
        # соседние повторы после переноса концов обводок на осевые линии.
        deduped = [ring[0]]
        for point in ring[1:]:
            if point != deduped[-1]:
                deduped.append(point)
        if len(deduped) > 1 and deduped[0] != deduped[-1]:
            deduped.append(deduped[0])
        return deduped

    def rounded_rings(source: Polygon) -> tuple[list[list[float]], list[list[list[float]]]]:
        ext = dedupe_consecutive([[_round(x), _round(y)] for x, y in source.exterior.coords])
        ints = [
            dedupe_consecutive([[_round(x), _round(y)] for x, y in interior.coords])
            for interior in source.interiors
        ]
        return ext, ints

    exterior_ring, interior_rings = rounded_rings(polygon)
    rounded_polygon = Polygon(exterior_ring, interior_rings)
    if not rounded_polygon.is_valid:
        # Локальное исправление — только для этой конкретной фигуры, только
        # когда округление её действительно сломало (см. докстринг выше про
        # отвергнутую попытку с set_precision()), и только структурное
        # (`make_valid(method="structure")`): в отличие от buffer(0), оно
        # explicitно знает, что внешнее кольцо ограничивает площадь, а
        # внутренние — вычитают её, и не путает дырки с обычным
        # самопересечением. Исправляется уже ОКРУГЛЁННАЯ фигура (та, что
        # сломалась), а не исходная — после исправления координаты округляются
        # заново, потому что make_valid() не обязан сам оставаться на сетке
        # шести знаков.
        repaired = make_valid(rounded_polygon, method="structure")
        repaired_parts = [
            part for part in getattr(repaired, "geoms", [repaired])
            if isinstance(part, Polygon) and not part.is_empty
        ]
        repaired_parts.sort(key=lambda part: part.area, reverse=True)
        if not repaired_parts:
            raise SystemExit(
                f"округление координат области у точки ({point.x:.3f}, "
                f"{point.y:.3f}) до шести знаков дало недопустимую геометрию, "
                "и структурное исправление (make_valid) не оставило от неё "
                "ни одного многоугольника — нужно решение человека, а не "
                "тихая запись сломанной геометрии в черновик"
            )
        discarded_area = sum(part.area for part in repaired_parts[1:])
        if discarded_area >= MICRO_AREA_PX2:
            raise SystemExit(
                f"округление координат области у точки ({point.x:.3f}, "
                f"{point.y:.3f}) до шести знаков дало недопустимую геометрию; "
                f"структурное исправление (make_valid) распалось на "
                f"{len(repaired_parts)} частей, из которых отброшенные вместе "
                f"занимают {discarded_area:.6f} точки в квадрате — это уже не "
                "числовой шум, а настоящая величина, и требует решения "
                "человека, а не тихого отбрасывания"
            )
        exterior_ring, interior_rings = rounded_rings(repaired_parts[0])
        rounded_polygon = Polygon(exterior_ring, interior_rings)
        if not rounded_polygon.is_valid:
            raise SystemExit(
                f"округление координат области у точки ({point.x:.3f}, "
                f"{point.y:.3f}) до шести знаков остаётся недопустимым даже "
                "после структурного исправления (make_valid) — нужно решение "
                "человека, а не тихая запись сломанной геометрии в черновик"
            )

    # Все производные поля считаются по ОКРУГЛЁННОЙ фигуре — по той самой, чьи
    # контуры и записываются рядом, — а не по исходной.
    #
    # НАЙДЕННЫЙ И ИСПРАВЛЕННЫЙ ДЕФЕКТ: отпечаток, площадь, рамка и опорная
    # точка брались от ИСХОДНОГО многоугольника, а контуры записывались
    # округлённые, слитые по соседним повторам и, изредка, структурно
    # исправленные. Пока округление ничего не меняло, обе фигуры совпадали и
    # расхождения не было видно. Но там, где округление слило две вершины или
    # где сработало структурное исправление, запись начинала описывать сама
    # себя неверно: отпечаток относился к одной форме, а сохранённые контуры —
    # к другой. Отпечаток — это тождество формы, по нему сверяются шаги
    # конвейера, поэтому он обязан считаться ровно от того, что записано.
    rounded_min_x, rounded_min_y, rounded_max_x, rounded_max_y = rounded_polygon.bounds
    rounded_point = rounded_polygon.representative_point()
    return {
        "geometryFingerprint": geometry_fingerprint(rounded_polygon),
        "areaPx2": _round(rounded_polygon.area),
        "effectiveWidthPx": _round(effective_width(rounded_polygon)),
        "bounds": {
            "minX": _round(rounded_min_x),
            "minY": _round(rounded_min_y),
            "maxX": _round(rounded_max_x),
            "maxY": _round(rounded_max_y),
        },
        "representativePoint": {"x": _round(rounded_point.x), "y": _round(rounded_point.y)},
        "exteriorRing": exterior_ring,
        "interiorRings": interior_rings,
    }


def build_impassable_terrain_mask(
    annotations_dir: Path,
    real_center_polygons: list[Polygon],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Построить непроходимую маску (34 пятна местности + река) поверх ТЕКУЩЕГО разбиения.

    `real_center_polygons` — области разбиения ДО хирургии: маска местности
    строится по ним (нужны для правила «пятно лежит внутри разбиения» и для
    различения реки и государственной границы по расстоянию до границы
    области — см. `cmt_impassable_terrain.py`), а не по разбиению ПОСЛЕ
    хирургии, которого на этом шаге ещё не существует.

    Возвращает список частей маски (каждая — многоугольник со своим
    `sourceKind` — «terrain-patch» или «river» — и площадью в исходных
    пикселях, для отчёта) и диагностику измерения (доли классификации, порог
    реки, гистограмму расстояний) для README/отчёта человеку.
    """

    terrain_tools = cmt_impassable_terrain

    raster_path = annotations_dir / "impassable-terrain.raster.json"
    raster = terrain_tools.load_raster(raster_path)

    land_union = unary_union(real_center_polygons)
    terrain_patches, decoration_patches, excluded_patches = terrain_tools.classify_patches(
        raster["patches"], land_union
    )

    def nearest_patch(x: float, y: float) -> dict[str, Any]:
        best = None
        for patch in terrain_patches:
            distance = math.hypot(patch["centroid"]["x"] - x, patch["centroid"]["y"] - y)
            if best is None or distance < best[0]:
                best = (distance, patch)
        return best[1]

    lake_seed_points = raster["measurement"]["lakeSeedPoints"]
    lake_patches = [nearest_patch(point["x"], point["y"]) for point in lake_seed_points]

    river_bbox = raster["lakesRiverBlob"]["bbox"]
    near_bbox = (river_bbox["minX"], river_bbox["minY"], river_bbox["maxX"], river_bbox["maxY"])
    region_polygons_by_index = {str(i): polygon for i, polygon in enumerate(real_center_polygons)}
    boundary_segments = terrain_tools.build_boundary_segments(region_polygons_by_index, near_bbox, padding=50.0)

    half_stroke_width = DOMINANT_STROKE_WIDTH_PX / 2.0
    river_pixels, river_distances = terrain_tools.select_river_pixels(
        raster["lakesRiverBlob"]["rows"],
        [patch["polygon"] for patch in lake_patches],
        boundary_segments,
        half_stroke_width,
    )
    river_polygon = terrain_tools.river_polygon_from_pixels(river_pixels)

    # Векторные контуры маски упрощаются тем же допуском, каким разбиение уже
    # упрощает свои собственные контуры (см. FLATTEN_TOLERANCE_PX выше — тот
    # же допуск сглаживания кривых Безье, применённый здесь к пиксельной
    # лестнице границы пятна вместо кривой; задание прямо требует не изобретать
    # для этого второй допуск). Щели-обрезки, которые вычитание пиксельно-
    # рваного контура маски из гладкого векторного контура области всё равно
    # оставляет почти вдоль её собственного края, устраняются не здесь, а
    # ниже, в apply_impassable_terrain(): щель присоединяется к вырезанному
    # куску по тому же измеренному признаку (`effective_width()` против
    # `DOMINANT_STROKE_WIDTH_PX`), каким `collapse_slivers()` уже отличает
    # щель от области везде в этом файле.
    def simplified(polygon: Polygon) -> Polygon | Any:
        # Компактные пятна местности упрощаются в один Polygon (проверено на
        # всех 34 пятнах этой карты). Длинная узкая река — другое дело: на
        # допуске 0.25 точки алгоритм упрощения (Дуглас — Пекер с сохранением
        # топологии) может разбить такую тонкую извилистую фигуру на несколько
        # соприкасающихся частей вместо одной — тот же класс явления, что и у
        # coverage_union_all() в rows_to_polygon() (см. cmt_impassable_terrain.py),
        # только источник другой. Разница между Polygon и MultiPolygon здесь не
        # важна: ниже все части маски всё равно объединяются в одну фигуру
        # (mask_union) перед вырезанием, так что MultiPolygon-часть работает
        # ровно так же, как несколько отдельных частей маски.
        result = polygon.simplify(FLATTEN_TOLERANCE_PX, preserve_topology=True)
        if result.is_empty or not result.is_valid:
            raise SystemExit(
                f"упрощение контура маски (допуск {FLATTEN_TOLERANCE_PX} px) дало "
                f"пустую или недопустимую геометрию — нужно решение человека, а не тихий обход"
            )
        area_before, area_after = polygon.area, result.area
        relative_change = abs(area_after - area_before) / area_before if area_before else 0.0
        if relative_change > 0.02:
            raise SystemExit(
                f"упрощение контура маски (допуск {FLATTEN_TOLERANCE_PX} px) изменило площадь "
                f"на {relative_change:.2%} ({area_before:.1f} -> {area_after:.1f} px²) — "
                "это больше, чем можно списать на сглаживание пиксельной лестницы; "
                "нужно решение человека, а не тихий обход"
            )
        return result

    mask_parts = [
        {"sourceKind": "terrain-patch", "polygon": simplified(patch["polygon"]), "areaPx2": patch["sizePx2"]}
        for patch in terrain_patches
    ] + [
        {"sourceKind": "river", "polygon": simplified(river_polygon), "areaPx2": len(river_pixels)}
    ]

    distance_values = list(river_distances.values())
    diagnostics = {
        "patchCount": len(raster["patches"]),
        "terrainPatchCount": len(terrain_patches),
        "decorationPatchCount": len(decoration_patches),
        # Список, а не одно пятно: продюсерских решений «оставить проходимым»
        # может быть сколько угодно, и каждое несёт своё основание текстом,
        # чтобы решение не превратилось в необъяснимое число в коде.
        "excludedPatches": [
            {
                "areaPx2": patch["sizePx2"],
                "centroid": patch["centroid"],
                "producerDecisionReason": patch["producerDecisionReason"],
            }
            for patch in excluded_patches
        ],
        "riverCandidatePixelCount": len(river_distances),
        "riverSelectedPixelCount": len(river_pixels),
        "riverHalfStrokeWidthPx": _round(half_stroke_width),
        "riverDistanceMinPx": _round(min(distance_values)) if distance_values else None,
        "riverDistanceMedianPx": _round(sorted(distance_values)[len(distance_values) // 2]) if distance_values else None,
        "riverDistanceMaxPx": _round(max(distance_values)) if distance_values else None,
        "riverShareWithinHalfStrokeWidth": _round(
            sum(1 for d in distance_values if d <= half_stroke_width) / len(distance_values)
        ) if distance_values else None,
    }
    return mask_parts, diagnostics


def apply_impassable_terrain(
    region_records: list[dict[str, Any]],
    ordered_polygons: list[Polygon],
    mask_parts: list[dict[str, Any]],
    stations: list[dict[str, Any]],
    waypoints: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]]]:
    """Вырезать непроходимую маску из каждой затронутой области.

    Обязательный инвариант этого шага (проверяется отдельно вызывающим кодом
    в main(), см. «полнота замощения»): суммарная площадь всех областей до и
    после этого шага должна совпасть с точностью до микроскопической щели —
    хирургия не отбрасывает и не создаёт территорию, только переклассифицирует
    её на «обычная область» / «непроходимая местность».

    Для каждой затронутой области:
      - кусок ``область ∩ маска`` — то, что вырезается. Каждый его связный
        кусок (patch может лежать в области несколькими отдельными частями,
        если несколько пятен местности попали в одну область) становится
        НОВОЙ областью, помечённой как непроходимая местность и
        унаследовавшей countryId родителя — это в точности требование
        задания, и оно автоматически не даёт новой области пересечь
        государственную границу: страна берётся от области-родителя, а не
        назначается заново.
      - остаток ``область − маска`` — то, что остаётся играбельным. В
        измеренных данных этой карты остаток почти всегда — один многоугольник
        (с внутренним кольцом на месте вырезанного куска, если кусок лежал
        строго внутри области, — это и есть «область с дыркой», которую
        теперь поддерживает геометрический контракт). Но в 2 из 917 областей
        (см. отчёт в README) вырезание местности у самого края области рушит
        узкий перешеек её собственной формы, и остаток распадается на два
        значительных куска суши, а не на один многоугольник с дыркой; это
        измерено, а не предположено (см. проверку по `effective_width()`
        против `DOMINANT_STROKE_WIDTH_PX` ниже — тот же признак, каким
        `collapse_slivers()` уже отличает щель от области везде в этом файле,
        — отсеивающую настоящий шум пиксельной сетки от таких настоящих
        расколов). Самый большой из кусков остатка наследует прежний
        идентификатор области (это по-прежнему «та же область», просто без
        откушенного куска); каждый следующий по величине кусок остатка
        становится ОБЫЧНОЙ (не непроходимой) новой областью той же страны —
        того же оператора «связный кусок земли — это область», что уже
        применяется к вырезаемому куску, только с другой стороны вычитания.

    Станции и полустанки области, чья геометрия изменилась, перепривязываются
    к оставшемуся куску геометрическим тестом (та же проверка «точка внутри
    контура», которой `build_regions()` уже привязывает их к области в
    первый раз) — не предполагается, что они остаются на месте.
    """

    # Посадка на сетку хранения ПЕРЕД логическими операциями.
    #
    # Координаты этого черновика хранятся округлёнными до миллионной доли точки
    # (см. _round): без округления библиотека даёт разные последние двоичные
    # разряды между запусками, и файл перестаёт быть воспроизводимым. Но
    # операции вычитания и пересечения до сих пор выполнялись по НЕокруглённым
    # числам, а округление применялось только на запись. Две стороны одного
    # разреза, разошедшиеся на 1e-9, округлялись после этого в РАЗНЫЕ узлы
    # сетки, и области начинали накладываться на миллионную долю точки в
    # квадрате. Измерено на этой карте: 15 таких пар, наибольшее наложение
    # 3.6e-6 px² при площадях областей в десятки тысяч. Платформа требует
    # непересечения точно — и при публикации, и при загрузке, — поэтому такие
    # пары отвергались, хотя картографически ничего неправильного в них нет.
    #
    # set_precision сажает геометрию на ту же сетку 1e-6 ДО операций, и тогда
    # операции дают согласованный результат на той же сетке: у общей границы
    # обе стороны получают одни и те же узлы, а не два соседних. Сетка взята не
    # новая: это ровно то разрешение, с которым черновик и так записывается.
    mask_union = set_precision(
        unary_union([part["polygon"] for part in mask_parts]), COORDINATE_GRID_PX
    )
    ordered_polygons = [
        set_precision(polygon, COORDINATE_GRID_PX) for polygon in ordered_polygons
    ]
    updated: list[dict[str, Any] | None] = list(region_records)
    impassable_ids: list[str] = []
    surgery_log: list[dict[str, Any]] = []
    next_number = len(region_records) + 1
    # Id тех областей, чья запись перестроена НА МЕСТЕ (тот же id, изменённая
    # геометрия) — нужен только финальной уборке остаточных наложений в конце
    # функции, чтобы отличить их от областей, вообще не задетых хирургией
    # (те geometryFingerprint обязаны сохранить в точности, см. требование
    # задания).
    rebuilt_in_place_ids: set[str] = set()

    station_positions = {
        item["id"]: (float(item["canonicalPosition"]["x"]), float(item["canonicalPosition"]["y"]))
        for item in stations
    }
    waypoint_positions = {
        item["id"]: (float(item["center"]["x"]), float(item["center"]["y"]))
        for item in waypoints
    }

    def relocate(polygon: Polygon, candidate_ids: list[str], positions: dict[str, tuple[float, float]]) -> list[str]:
        return sorted(
            item_id for item_id in candidate_ids
            if polygon.covers(Point(*positions[item_id]))
        )

    def stable_pieces(pieces: list[Polygon]) -> list[Polygon]:
        # Тот же порядок, каким build_regions() уже нумерует области — сверху
        # вниз, затем слева направо, при равенстве положения по отпечатку
        # геометрии, — чтобы номера новых областей не зависели от порядка,
        # в котором shapely вернула куски геометрической операции.
        return stable_region_order(pieces)

    for index, polygon in enumerate(ordered_polygons):
        if not mask_union.intersects(polygon):
            continue
        # Порог значимости здесь — площадь против MICRO_AREA_PX2 (25 точек в
        # квадрате), не действующая ширина против DOMINANT_STROKE_WIDTH_PX.
        # Действующая ширина была измерена и отвергнута для ЭТОГО решения:
        # применённая к кускам `область ∩ маска`, она неверно отбрасывает
        # НАСТОЯЩУЮ местность. Пример из измеренных данных этой карты — пятно
        # 706 px² @ (2300, 1311): его собственная действующая ширина как единой
        # фигуры уже 6.09 точки, то есть ниже порога 6.97, хотя пятно прошло
        # независимую проверку «внутри разбиения не менее 95%» (см.
        # `classify_patches()`) и является настоящей местностью, а не
        # артефактом; при разрезании такого пятна ещё и по внутренним границам
        # нескольких областей каждый получившийся кусок становится ещё уже, и
        # все они дружно проваливаются под порог ширины, хотя всё пятно
        # целиком — настоящая, уже подтверждённая территория. MICRO_AREA_PX2 —
        # тот же порог, что и везде в этом файле для вопроса «это числовой шум
        # или нет» (drop_micro_holes(), проверка полноты замощения выше), и
        # именно этот вопрос здесь и стоит: кусок пересечения области с маской
        # — это часть УЖЕ подтверждённого пятна (см. classify_patches()) или
        # уже подтверждённой реки (см. select_river_pixels()), не нуждающаяся в
        # повторной проверке формы, — единственный открытый вопрос — достаточно
        # ли от неё осталось в ЭТОЙ КОНКРЕТНОЙ области, чтобы не быть числовым
        # обрезком точно того же рода, что MICRO_AREA_PX2 уже отсеивает по всему
        # файлу.
        all_carved_pieces = connected_polygon_pieces(polygon.intersection(mask_union))
        significant_carved_pieces = [piece for piece in all_carved_pieces if piece.area >= MICRO_AREA_PX2]
        if not significant_carved_pieces:
            # Касание маски и области существует, но весь его след — числовой
            # обрезок меньше MICRO_AREA_PX2; область остаётся как есть, ничего
            # не создаётся и не переклассифицируется. Эта крошка площади
            # остаётся частью области как была — она и не вычиталась, поэтому
            # теряться ей неоткуда.
            continue
        carved_mask_for_region = unary_union(significant_carved_pieces)

        # Вычитается объединение ЗНАЧИМЫХ кусков, а не всего пересечения:
        # обрезок меньше MICRO_AREA_PX2 просто не вычитается и остаётся
        # обычной играбельной землёй этой области, а не пропадает и не
        # становится территорией без хозяина.
        #
        # Вычитание — БЕЗ раздутия: измерено (см. README, раздел «Непроходимая
        # местность и река»), что игольчатые щели, которые вычитание пиксельно-
        # рваного контура маски из гладкого контура области оставляет почти
        # вдоль её собственного края, лежат на РАССТОЯНИИ РОВНО 0 от самой
        # вырезаемой маски — то есть геометрически являются частью вырезанного
        # куска, отделившейся от него только числовым шумом операции
        # вычитания, а вовсе не «зависли между» маской и остатком, как
        # предполагала более ранняя (и неверная) версия этого шага. Раздутие
        # перед вычитанием пробовалось и было отброшено: оно не устраняло
        # проблему (нужный запас оказался разным в разных местах — от 0.05
        # до более чем толщины линии, — то есть у него нет одного верного
        # значения), а один раз даже её усугубило, случайно раздробив кусок
        # маски на несколько там, где раздутие пересекло сама себя. Здесь же
        # решение прямое: щели-обрезки остатка присоединяются туда, где они
        # физически лежат, — к вырезанному куску, — простым объединением, а
        # не раздутием чего бы то ни было.
        # Вырез и остаток обязаны быть точным дополнением ДРУГ ДРУГА одного и
        # того же разреза — иначе полоска, присоединённая к вырезу как щель,
        # осталась бы одновременно и землёй остатка, то есть в двух разных
        # областях сразу. НАЙДЕННАЯ И ИСПРАВЛЕННАЯ ОШИБКА: более ранняя версия
        # этого шага вычисляла остаток один раз, ДО присоединения щелей к
        # вырезу, и потому именно это и делала. Собственная проверка этого
        # файла её не поймала (площадь и отпечаток были правильными для
        # каждой стороны по отдельности), но её поймала общая проверка
        # пересечения областей в map-annotation.mjs при сборке манифеста — то
        # есть на шаге, который сборка черновика не проверяет вовсе. Поэтому
        # здесь carved_mask и remainder пересчитываются друг относительно
        # друга ПОВТОРНО, пока присоединение щелей к вырезу не перестанет
        # находить новые щели в остатке (то есть пока оба не станут точным
        # дополнением друг друга без остатка микро-полосок с обеих сторон).
        carved_mask_healed = carved_mask_for_region
        remainder_raw_pieces = connected_polygon_pieces(polygon.difference(carved_mask_healed))
        sliver_remainder_pieces = [p for p in remainder_raw_pieces if p.area < MICRO_AREA_PX2]
        # Предел итераций — не измеренное число, а защита от зацикливания:
        # каждый проход присоединяет к вырезу хотя бы одну реальную щель или
        # останавливается, поэтому на практике достаточно одного-двух
        # проходов; если цикл не сошёлся за 10, это рассогласование
        # конвейера, а не медленная сходимость.
        for _ in range(10):
            if not sliver_remainder_pieces:
                break
            carved_mask_healed = unary_union([carved_mask_healed, *sliver_remainder_pieces])
            remainder_raw_pieces = connected_polygon_pieces(polygon.difference(carved_mask_healed))
            sliver_remainder_pieces = [p for p in remainder_raw_pieces if p.area < MICRO_AREA_PX2]
        else:
            if sliver_remainder_pieces:
                raise SystemExit(
                    f"присоединение щелей остатка к вырезу не сошлось за 10 "
                    f"проходов у области {region_records[index]['id']}; это "
                    "рассогласование конвейера, а не медленная сходимость, и "
                    "требует разбора человеком"
                )

        # Тот же порог отличает настоящий РАСКОЛ оставшейся играбельной земли
        # (два значительных куска суши — см. README, «Найденная и
        # исправленная ошибка» про области 0038/0128) от игольчатого
        # обрезка вычитания, уже присоединённого к вырезу в цикле выше.
        significant_remainder_pieces = [p for p in remainder_raw_pieces if p.area >= MICRO_AREA_PX2]

        carved_pieces = stable_pieces(connected_polygon_pieces(carved_mask_healed))
        remainder_pieces = stable_pieces(significant_remainder_pieces)

        original = region_records[index]
        if remainder_pieces:
            main_remainder = remainder_pieces[0]
            rebuilt = dict(original)
            rebuilt.update(_region_geometry_fields(main_remainder))
            rebuilt["stationIds"] = relocate(main_remainder, original["stationIds"], station_positions)
            rebuilt["waypointIds"] = relocate(main_remainder, original["waypointIds"], waypoint_positions)
            updated[index] = rebuilt
            rebuilt_in_place_ids.add(original["id"])

            for extra_piece in remainder_pieces[1:]:
                new_id = f"map-region-{next_number:04d}"
                next_number += 1
                new_record = dict(original)
                new_record["id"] = new_id
                new_record.update(_region_geometry_fields(extra_piece))
                new_record["stationIds"] = relocate(extra_piece, original["stationIds"], station_positions)
                new_record["waypointIds"] = relocate(extra_piece, original["waypointIds"], waypoint_positions)
                updated.append(new_record)
                surgery_log.append({
                    "kind": "region-split-by-terrain-removal",
                    "originalRegionId": original["id"],
                    "newRegionId": new_id,
                    "areaPx2": _round(extra_piece.area),
                })
        else:
            # Область целиком лежит внутри маски (не измерено на этой карте —
            # ни одна из 917 областей не откушена полностью, — но останов
            # безопаснее тихого удаления области из разбиения).
            raise SystemExit(
                f"область {original['id']} целиком совпала с непроходимой маской; "
                "это не измерено на текущей карте и требует решения человека, "
                "а не тихого удаления области"
            )

        for piece in carved_pieces:
            new_id = f"map-region-{next_number:04d}"
            next_number += 1
            new_record = {
                "id": new_id,
                "countryId": original["countryId"],
                "countryName": original["countryName"],
                "stationIds": [],
                "waypointIds": [],
                IMPASSABLE_TERRAIN_FIELD: True,
            }
            new_record.update(_region_geometry_fields(piece))
            updated.append(new_record)
            impassable_ids.append(new_id)
            surgery_log.append({
                "kind": "impassable-terrain-region",
                "parentRegionId": original["id"],
                "newRegionId": new_id,
                "countryId": original["countryId"],
                "areaPx2": _round(piece.area),
            })

    final_records = [record for record in updated if record is not None]

    # `surgery_touched_ids` — области, которых хирургия действительно коснулась:
    # только их контуры имеет смысл чистить от следов геометрических операций
    # (см. drop_return_spikes/drop_collinear_vertices ниже).
    surgery_touched_ids = {
        entry["newRegionId"] for entry in surgery_log if "newRegionId" in entry
    } | rebuilt_in_place_ids


    # --- Финальная, однопроходная проверка тем же признаком, каким сторонний -
    # --- JS-валидатор общей аннотации проверяет самопересечение --------------
    #
    # shapely (`Polygon.is_valid`, уже проверено выше для каждой области при
    # округлении) и JS-валидатор `assertSimpleClosedPolygon()` в
    # scripts/map-annotation/map-annotation.mjs проверяют одно и то же
    # утверждение («контур не пересекает сам себя») двумя независимыми
    # реализациями с плавающей запятой — и в редких, крайних случаях (кластер
    # из нескольких почти совпадающих вершин на расстоянии порядка
    # 10⁻⁶–10⁻⁵ точки карты, оставленный несколькими операциями пересечения и
    # вычитания подряд там, где несколько кусков маски сходятся почти в одной
    # точке контура) они расходятся: shapely считает контур допустимым, а
    # JS-реализация — нет. Эта проверка воспроизводит именно вторую
    # реализацию (тот же порядок проверки несоседних пар сторон, тот же
    # эпсилон 10⁻⁹), чтобы находить только те области, что действительно не
    # прошли бы сборку манифеста, а не полагаться на приближение через
    # действующую ширину или площадь. Исправление — структурное
    # (`make_valid(method="structure")`), в одно применение, без повторного
    # цикла: область, где эта проверка расходится с shapely, — редкое
    # (измерено: 2 из 984 областей той сборки) исключение, а не источник
    # каскада новых наложений, требующего той же лестницы сходимости, что и
    # уборка выше.
    def has_nonadjacent_side_crossing(ring: list[list[float]]) -> bool:
        points = [tuple(p) for p in ring]
        if points[0] != points[-1]:
            points.append(points[0])
        side_count = len(points) - 1

        def cross(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        def point_on_segment(p, s, e):
            return (
                abs(cross(s, e, p)) < 1e-9
                and min(s[0], e[0]) - 1e-9 <= p[0] <= max(s[0], e[0]) + 1e-9
                and min(s[1], e[1]) - 1e-9 <= p[1] <= max(s[1], e[1]) + 1e-9
            )

        def segments_intersect(a, b, c, d):
            ab_c, ab_d = cross(a, b, c), cross(a, b, d)
            cd_a, cd_b = cross(c, d, a), cross(c, d, b)
            if ((ab_c > 0 and ab_d < 0) or (ab_c < 0 and ab_d > 0)) and \
               ((cd_a > 0 and cd_b < 0) or (cd_a < 0 and cd_b > 0)):
                return True
            return (
                (abs(ab_c) < 1e-9 and point_on_segment(c, a, b))
                or (abs(ab_d) < 1e-9 and point_on_segment(d, a, b))
                or (abs(cd_a) < 1e-9 and point_on_segment(a, c, d))
                or (abs(cd_b) < 1e-9 and point_on_segment(b, c, d))
            )

        for left in range(side_count):
            for right in range(left + 1, side_count):
                adjacent = right == left + 1 or (left == 0 and right == side_count - 1)
                if adjacent:
                    continue
                if segments_intersect(points[left], points[left + 1], points[right], points[right + 1]):
                    return True
        return False

    # Удаление возвратных шипов на контуре.
    #
    # Повторные пересечения и вычитания оставляют на контуре «шипы»: кольцо
    # уходит из точки A в точку B и тут же возвращается в ту же самую точку A.
    # Такой ход не ограничивает никакой площади и не добавляет к границе
    # ничего, чего в ней уже нет, — отрезок A—B в контуре и так есть. Но три
    # почти совпадающие точки подряд заставляют проверку самопересечения (и её
    # двойник в общем конвейере приёма карт) считать, что дальние стороны
    # кольца пересекаются, и область отвергается.
    #
    # Удаляется ТОЛЬКО точное повторение. Соблазн вместо этого слить близкие
    # вершины в одну проверен и отвергнут по измерению: сдвиг вершины даже на
    # одну десятитысячную точки уводит её с общей границы с соседом, и вместо
    # одной непринятой области получаются наложения областей и разрывы
    # замощения, через которые «выходит за разбиение» авторская дорога.
    # Поэтому здесь не двигается ни одна вершина: только выбрасывается
    # повторный проход по уже пройденному отрезку.
    def drop_return_spikes(records: list[dict[str, Any]], touched: set[str]) -> int:
        removed = 0

        def clean(ring: list[list[float]]) -> list[list[float]]:
            body = [list(point) for point in ring]
            if len(body) > 1 and body[0] == body[-1]:
                body = body[:-1]
            changed = True
            while changed and len(body) >= 3:
                changed = False
                index = 0
                while index < len(body) and len(body) >= 3:
                    size = len(body)
                    if body[index] == body[(index + 2) % size]:
                        # Выбрасываются середина шипа и его повторная вершина;
                        # исходная точка остаётся на месте.
                        first, second = (index + 1) % size, (index + 2) % size
                        for position in sorted((first, second), reverse=True):
                            body.pop(position)
                        changed = True
                        continue
                    index += 1
            return body

        for item in records:
            if item["id"] not in touched:
                continue
            outer = clean(item["exteriorRing"])
            if len(outer) >= 3:
                closed = [*outer, list(outer[0])]
                removed += len(item["exteriorRing"]) - len(closed)
                item["exteriorRing"] = closed
            inner = item.get("interiorRings") or []
            for position, ring in enumerate(inner):
                cleaned = clean(ring)
                if len(cleaned) >= 3:
                    closed = [*cleaned, list(cleaned[0])]
                    removed += len(ring) - len(closed)
                    inner[position] = closed
        return removed

    # Удаление вершин, избыточных по мерке самой платформы.
    #
    # После шипов остаётся вторая, более тонкая беда: вершина, лежащая на
    # отрезке между двумя своими соседями по контуру. Геометрически она не
    # добавляет ничего, но из-за неё три почти совпадающие точки образуют
    # «сторону» длиной 1e-5, и проверка самопересечения — и в общем конвейере
    # приёма карт, и в загрузочной проверке runtime — считает, что дальние
    # стороны кольца соприкасаются.
    #
    # Мерка берётся не своя, а платформенная: `pointOnSegment` в
    # services/runtime-api/src/modules/runtime/regionRoadGeometry.ts признаёт
    # точку лежащей на отрезке, когда векторное произведение не превышает
    # 1e-9, умноженного на длину отрезка. Убирается ровно то, что платформа и
    # так считает лежащим на прямой, поэтому граница не меняется в пределах
    # её собственной различимости. Общая граница с соседом при этом остаётся
    # действительной: вывод переходов версии 2 намеренно сливает соприкасающиеся
    # части одной границы, чтобы лишняя вершина на одной стороне не меняла ни
    # топологию графа, ни контрольную сумму (см. deriveRegionCrossings).
    def drop_collinear_vertices(records: list[dict[str, Any]], touched: set[str]) -> int:
        removed = 0

        def on_segment(point, start, end) -> bool:
            area2 = abs((end[0] - start[0]) * (point[1] - start[1])
                        - (end[1] - start[1]) * (point[0] - start[0]))
            length = math.dist(start, end)
            return area2 <= 1e-9 * max(1.0, length)

        def clean(ring: list[list[float]]) -> list[list[float]]:
            body = [list(point) for point in ring]
            if len(body) > 1 and body[0] == body[-1]:
                body = body[:-1]
            changed = True
            while changed and len(body) >= 4:
                changed = False
                index = 0
                while index < len(body) and len(body) >= 4:
                    size = len(body)
                    previous = body[index - 1]
                    current = body[index]
                    following = body[(index + 1) % size]
                    if on_segment(current, previous, following):
                        body.pop(index)
                        changed = True
                        continue
                    index += 1
            return body

        for item in records:
            if item["id"] not in touched:
                continue
            outer = clean(item["exteriorRing"])
            if len(outer) >= 3:
                closed = [*outer, list(outer[0])]
                removed += len(item["exteriorRing"]) - len(closed)
                item["exteriorRing"] = closed
            inner = item.get("interiorRings") or []
            for position, ring in enumerate(inner):
                cleaned = clean(ring)
                if len(cleaned) >= 3:
                    closed = [*cleaned, list(cleaned[0])]
                    removed += len(ring) - len(closed)
                    inner[position] = closed
        return removed

    # Снимок контуров ДО чистки, чтобы понять, у каких именно областей она
    # что-то изменила. НАЙДЕННЫЙ И ИСПРАВЛЕННЫЙ ДЕФЕКТ: обе чистки переписывали
    # `exteriorRing`/`interiorRings` прямо в записи, но НЕ пересчитывали
    # `geometryFingerprint`, `areaPx2`, `bounds` и `representativePoint`. Форма
    # менялась, а её отпечаток продолжал описывать прежнюю — то есть перставал
    # быть отпечатком того, что записано. Измерено на той сборке: у 16 из 984
    # областей записанный отпечаток не воспроизводился из их же собственных
    # контуров. Отпечаток — это тождество формы, по нему сверяются шаги
    # конвейера, поэтому расхождение здесь не косметика.
    rings_before = {
        record["id"]: json.dumps(
            [record["exteriorRing"], record.get("interiorRings") or []],
            separators=(",", ":"),
        )
        for record in final_records
    }
    spikes_removed = drop_return_spikes(final_records, surgery_touched_ids)
    collinear_removed = drop_collinear_vertices(final_records, surgery_touched_ids)
    refreshed = 0
    for record in final_records:
        after = json.dumps(
            [record["exteriorRing"], record.get("interiorRings") or []],
            separators=(",", ":"),
        )
        if after == rings_before[record["id"]]:
            continue
        record.update(_region_geometry_fields(Polygon(
            [tuple(p) for p in record["exteriorRing"]],
            [[tuple(p) for p in ring] for ring in record.get("interiorRings", [])],
        )))
        refreshed += 1
    if spikes_removed or collinear_removed:
        print(f"  очистка контуров: возвратных шипов {spikes_removed}, "
              f"вершин на прямой {collinear_removed} (ни одна вершина не сдвинута); "
              f"пересчитано отпечатков и площадей: {refreshed}")

    # Общая посадка всего разбиения на сетку хранения — последний
    # геометрический шаг, потому что любой шаг после него мог бы её нарушить.
    # Сразу за ней — проверка, а не починка: наложений после посадки быть не
    # может, поэтому найденное означало бы ошибку конвейера.
    conforming = conform_partition_to_shared_grid(final_records)
    print(
        f"  общая посадка на сетку {COORDINATE_GRID_PX:g}: вставлено вершин "
        f"{conforming['insertedVertexCount']} в {conforming['changedRegionCount']} "
        "областях (ни одна вершина не сдвинута, границы не разрывались)"
    )
    assert_no_overlapping_regions(final_records)
    print("  наложений областей после посадки: 0 (проверено точно, без допуска)")

    by_id = {record["id"]: record for record in final_records}
    js_validator_repairs: list[dict[str, Any]] = []
    for record in final_records:
        if record["id"] not in surgery_touched_ids:
            continue
        if not has_nonadjacent_side_crossing(record["exteriorRing"]):
            continue
        polygon = Polygon(
            [tuple(p) for p in record["exteriorRing"]],
            [[tuple(p) for p in ring] for ring in record.get("interiorRings", [])],
        )
        repaired = make_valid(polygon, method="structure")
        repaired_parts = [
            part for part in getattr(repaired, "geoms", [repaired])
            if isinstance(part, Polygon) and not part.is_empty
        ]
        repaired_parts.sort(key=lambda part: part.area, reverse=True)
        if repaired_parts and not has_nonadjacent_side_crossing(
            [[_round(x), _round(y)] for x, y in repaired_parts[0].exterior.coords]
        ):
            record.update(_region_geometry_fields(repaired_parts[0]))
            js_validator_repairs.append({"id": record["id"], "repaired": True})
        else:
            # ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ, НЕ ЗАМОЛЧАННОЕ: структурное исправление
            # не устранило расхождение. Область остаётся допустимой по
            # shapely (полнота замощения, площадь и связность, доказанные
            # выше, её не касаются), но не проходит более строгую проверку
            # стороннего JS-валидатора общей аннотации — сборка манифеста для
            # этой конкретной области сейчас откажет. Это зафиксировано здесь
            # как открытый вопрос человеку, а не исправлено подгонкой:
            # дальнейшая попытка потребовала бы либо согласовать одну общую
            # реализацию проверки самопересечения между Python и JS, либо
            # перестроить контур этой области вручную.
            js_validator_repairs.append({"id": record["id"], "repaired": False})

    if js_validator_repairs:
        surgery_log.append({
            "kind": "js-validator-self-intersection-repair",
            "regions": js_validator_repairs,
        })
        unresolved = [item["id"] for item in js_validator_repairs if not item["repaired"]]
        if unresolved:
            print(
                "ВНИМАНИЕ: следующие новые области проходят проверку shapely, но "
                "не проходят более строгую проверку самопересечения стороннего "
                f"JS-валидатора общей аннотации, и структурное исправление их не "
                f"устранило — сборка манифеста для них сейчас откажет: {unresolved}. "
                "Это открытый вопрос человеку (см. README.md), а не тихая подгонка."
            )

    return final_records, impassable_ids, surgery_log


def main() -> None:
    """Посчитать разбиение обоими способами, сверить их и собрать черновик."""

    annotations = Path(__file__).resolve().parent.parent / "annotations"
    review = json.loads((annotations / "vector-map.review.json").read_text(encoding="utf-8"))
    classification = json.loads(
        (annotations / "vector-map.classification.review.json").read_text(encoding="utf-8")
    )
    # 25 узлов начальной сети нужны только в самом конце main() — чтобы
    # проверить, не разрезала ли непроходимая местность граф соседства на
    # части, в разных из которых оказался бы узел сети (см. «непроходимая
    # местность» ниже). Читается здесь же, рядом с остальными исходниками
    # черновика, а не рядом с местом использования, чтобы все чтения файлов
    # main() были в одном месте.
    initial_network = json.loads(
        (annotations / "initial-network.review.json").read_text(encoding="utf-8")
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
    # здесь, раньше, чем раньше: build_regions() ниже привязывает каждую
    # область к стране по заливке, а build_doubts() в самом конце — отдельно
    # проверяет для щели на границе стран, чья площадь фактически "перешла"
    # чужой стране (см. foreign_area_after_merge()). Загрузка не зависит от
    # флага `--no-countries`: даже когда границы стран не участвуют в самом
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
        centerline["regions"]
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
        centerline["regions"]
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
    # начале main() — раньше, чем здесь, потому что build_regions() и
    # build_doubts() ниже обе используют named_countries (см. комментарий у
    # места их загрузки).

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

    # stable_region_order() — чистая функция уже собранного списка областей,
    # поэтому повторный вызов здесь на том же real_center детерминированно
    # даёт тот же порядок, каким build_regions() уже пронумеровала области:
    # индекс i в этом списке соответствует region_records[i]. Список и дерево
    # поиска по нему нужны дважды ниже — сначала build_doubts() использует их
    # через locate_region_id(), чтобы назвать область, в которую вошла щель
    # country-border-gap-merged, затем граф соседства (см. «Новый критерий
    # приёмки» ниже) использует их повторно, не пересчитывая заново тот же
    # порядок.
    ordered_polygons_for_adjacency = stable_region_order(real_center)
    region_lookup_tree = STRtree(ordered_polygons_for_adjacency)

    def locate_region_id(x: float, y: float) -> str | None:
        """Финальный id области (map-region-NNNN), чья геометрия содержит точку.

        Точка щели, присоединённой к соседу, почти всегда остаётся внутри той
        же итоговой области и после всех последующих шагов конвейера (удаление
        ничтожных отверстий только добавляет площадь обратно, а не убирает её;
        отбор по площади и по пустым пространствам уже укрупнённую область не
        исключает) — поэтому тот же геометрический тест "точка внутри контура"
        (`covers`), которым build_regions() выше уже привязывает станции и
        полустанки к их областям, годится и для этого поиска в первую очередь.

        Измерено одно (из 1039) исключение: кластер, где несколько щелей
        сходятся и объединяются друг с другом в несколько проходов, может
        сдвинуть контур итоговой области на несколько точек карты от исходной
        representative_point() схлопнутой щели — проверка полноты замощения
        выше (`residual_void_area`) в этом месте не падает, то есть сама
        площадь никуда не теряется, смещается только контур относительно
        одной записанной точки. Поэтому при точном промахе здесь ищется
        ближайшая область в пределах DOMINANT_STROKE_WIDTH_PX — того же
        измеренного порога, которым весь этот файл уже отличает «тот же
        локальный участок» от «другое место», а не нового подобранного числа.
        Промах шире этого порога не подгоняется, а возвращает None и приводит
        к остановке в build_doubts() — так остаётся видно, если несогласование
        когда-нибудь станет больше единичного измеренного случая.
        """

        point = Point(x, y)
        for index in region_lookup_tree.query(point):
            index = int(index)
            if ordered_polygons_for_adjacency[index].covers(point):
                return region_records[index]["id"]

        nearest_index = None
        nearest_distance = None
        for index in region_lookup_tree.query(point.buffer(DOMINANT_STROKE_WIDTH_PX)):
            index = int(index)
            distance = ordered_polygons_for_adjacency[index].distance(point)
            if nearest_distance is None or distance < nearest_distance:
                nearest_distance = distance
                nearest_index = index
        if nearest_index is not None and nearest_distance <= DOMINANT_STROKE_WIDTH_PX:
            return region_records[nearest_index]["id"]
        return None

    # countryId каждой финальной области — build_doubts() смотрит его по
    # mergedIntoRegionId, чтобы проверить прямое утверждение записи
    # country-border-gap-merged (см. foreign_area_after_merge()): осталась ли
    # часть щели территорией страны, отличной от страны области, в которую
    # щель фактически вошла.
    region_country_by_id = {r["id"]: r["countryId"] for r in region_records}

    doubts = build_doubts(
        comparison,
        real_paint,
        real_center,
        joins,
        centerline_collapsed,
        centerline["dangleLines"],
        micro_holes,
        locate_region_id,
        region_country_by_id,
        named_countries,
    )
    without_country = [r["id"] for r in region_records if r["countryId"] is None]

    # Новый критерий приёмки: граф соседства обязан быть связным (см.
    # build_region_adjacency()/connected_components() выше).
    print("\n--- граф соседства областей ---")
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

    # --- Финальный шаг: вырезать непроходимую местность (см. раздел файла --
    # --- «Финальный шаг: вырезание непроходимой местности из разбиения») ---
    #
    # Выполняется здесь и только здесь — после того, как базовое разбиение
    # (917 областей) уже прошло собственную проверку связности выше, — чтобы
    # маска местности строилась по уже принятому, самосогласованному
    # разбиению, а не по промежуточному состоянию.
    print("\n--- непроходимая местность (продюсерское решение) ---")
    mask_parts, terrain_diagnostics = build_impassable_terrain_mask(
        annotations, ordered_polygons_for_adjacency
    )
    print(
        f"растровых пятен цвета местности: {terrain_diagnostics['patchCount']}; "
        f"местность: {terrain_diagnostics['terrainPatchCount']}, "
        f"декорация: {terrain_diagnostics['decorationPatchCount']}"
    )
    for excluded in terrain_diagnostics["excludedPatches"]:
        print(
            f"оставлено проходимым решением продюсера: {excluded['areaPx2']} px² @ "
            f"({excluded['centroid']['x']:.0f}, {excluded['centroid']['y']:.0f}) — "
            f"{excluded['producerDecisionReason']}"
        )
    print(
        "признак «река против границы» (расстояние до ближайшей границы области, px): "
        f"кандидатов {terrain_diagnostics['riverCandidatePixelCount']}, "
        f"минимум {terrain_diagnostics['riverDistanceMinPx']}, "
        f"медиана {terrain_diagnostics['riverDistanceMedianPx']}, "
        f"максимум {terrain_diagnostics['riverDistanceMaxPx']}, "
        f"доля не дальше половины толщины линии "
        f"({terrain_diagnostics['riverHalfStrokeWidthPx']} px): "
        f"{terrain_diagnostics['riverShareWithinHalfStrokeWidth']:.1%}"
    )

    base_region_count = len(region_records)
    region_records, impassable_region_ids, terrain_surgery_log = apply_impassable_terrain(
        region_records,
        ordered_polygons_for_adjacency,
        mask_parts,
        countries_data.get("stations", []),
        countries_data.get("waypoints", []),
    )
    regions_split_by_terrain = [
        entry for entry in terrain_surgery_log if entry["kind"] == "region-split-by-terrain-removal"
    ]
    touched_parent_ids = sorted({entry["parentRegionId"] for entry in terrain_surgery_log if "parentRegionId" in entry})
    print(
        f"областей, задетых маской: {len(touched_parent_ids)}; "
        f"новых непроходимых областей: {len(impassable_region_ids)}; "
        f"областей, расколотых удалением местности на суше: {len(regions_split_by_terrain)}; "
        f"итоговое число областей: {len(region_records)} (было {base_region_count})"
    )
    without_country = [r["id"] for r in region_records if r["countryId"] is None]

    # Связность ПОСЛЕ хирургии — отдельная проверка от связности ДО неё выше.
    # Река — намеренно непроходимая преграда, поэтому здесь падать при
    # распаде на несколько частей НЕЛЬЗЯ (в отличие от проверки выше): задание
    # явно требует доложить результат, а не решать его самостоятельно, если
    # река разъединила сеть терминалов.
    post_surgery_polygons = [
        Polygon(
            [tuple(p) for p in record["exteriorRing"]],
            [[tuple(p) for p in ring] for ring in record.get("interiorRings", [])],
        )
        for record in region_records
    ]

    # --- Первая проверка: полный геометрический граф ПОСЛЕ хирургии (все ---
    # --- областей, включая непроходимые) обязан остаться ОДНИМ листом. -----
    # Это не тот же вопрос, что играбельность ниже: анклав внутри дырки
    # всегда смежен с окружающей его областью (у дырки есть граница), поэтому
    # вырезание местности само по себе не может физически расколоть карту на
    # куски суши, не касающиеся друг друга, — оно только переклассifицирует
    # уже существующую территорию. Если эта проверка всё-таки найдёт больше
    # одной части, это будет означать ошибку хирургии (потерянный кусок земли
    # где-то в geometрии), а не законное следствие непроходимой реки, — и
    # останавливаться здесь нужно так же, как и в проверке связности БАЗОВОГО
    # разбиения выше.
    full_adjacency = build_region_adjacency(post_surgery_polygons)
    # Переходы между странами ПОСЛЕ хирургии считаются здесь же, по тому же
    # графу: вырезанный кусок наследует страну родителя, но граничить может и
    # с областью другой страны, поэтому число законно отличается от базового.
    cross_country_adjacency_count_after = 0
    for index, neighbour_set in enumerate(full_adjacency):
        for neighbour in neighbour_set:
            if neighbour <= index:
                continue
            if region_records[index]["countryId"] != region_records[neighbour]["countryId"]:
                cross_country_adjacency_count_after += 1
    all_regions_components = connected_components(full_adjacency)
    all_regions_components.sort(key=len, reverse=True)
    all_regions_component_sizes = [len(component) for component in all_regions_components]
    print(
        f"связных частей ПОСЛЕ вырезания местности, все {len(region_records)} областей "
        f"(геометрическая проверка — доказывает, что карта осталась одним листом): "
        f"{len(all_regions_components)}; размеры частей: {all_regions_component_sizes}"
    )
    if len(all_regions_components) != 1:
        raise SystemExit(
            f"после вырезания местности геометрический граф соседства (все "
            f"{len(region_records)} областей, включая непроходимые) распался на "
            f"{len(all_regions_components)} частей размерами {all_regions_component_sizes}; "
            "хирургия обязана сохранять карту одним листом суши — это "
            "рассогласование конвейера, а не законное следствие непроходимой "
            "реки, и требует разбора, а не подгонки"
        )

    # --- Вторая проверка: ИГРАБЕЛЬНЫЙ граф — тот же граф, но с узлами- ------
    # --- препятствиями, выброшенными целиком (не только их рёбра). ---------
    # Это и есть вопрос, который интересует продюсера: дорога не может пройти
    # ЧЕРЕЗ непроходимую область, поэтому два соседа непроходимой области по
    # разные её стороны, раньше граничившие друг с другом напрямую, теперь
    # смежны только ЧЕРЕЗ неё — то есть для игры не смежны вовсе. В отличие от
    # проверки выше, здесь больше одной части — измеренный факт, а не отказ:
    # непроходимая река может (хотя на текущей карте не оказалась обязана)
    # разрезать играбельную карту на несколько частей.
    impassable_id_set = set(impassable_region_ids)
    impassable_indices = {
        index for index, record in enumerate(region_records) if record["id"] in impassable_id_set
    }
    playable_indices = [index for index in range(len(region_records)) if index not in impassable_indices]
    playable_adjacency = [
        (full_adjacency[index] - impassable_indices) if index not in impassable_indices else set()
        for index in range(len(region_records))
    ]
    # connected_components() обходит все индексы 0..N-1; чтобы непроходимые
    # области не превратились в отдельные одноузловые «части» и не засорили
    # отчёт, здесь считаются компоненты только над играбельным подмножеством
    # индексов, тем же обходом в ширину, что и connected_components() выше.
    visited = [False] * len(region_records)
    for index in impassable_indices:
        visited[index] = True
    playable_components: list[list[int]] = []
    for start in playable_indices:
        if visited[start]:
            continue
        stack = [start]
        visited[start] = True
        component = [start]
        while stack:
            node = stack.pop()
            for neighbour in playable_adjacency[node]:
                if not visited[neighbour]:
                    visited[neighbour] = True
                    stack.append(neighbour)
                    component.append(neighbour)
        playable_components.append(component)
    playable_components.sort(key=len, reverse=True)
    playable_component_sizes = [len(component) for component in playable_components]
    region_component_of: dict[int, int] = {}
    for component_index, component in enumerate(playable_components):
        for region_index in component:
            region_component_of[region_index] = component_index

    print(
        f"связных частей ИГРАБЕЛЬНОГО графа (непроходимые области выброшены "
        f"из графа целиком, а не только их рёбра): {len(playable_components)} "
        f"из {len(playable_indices)} играбельных областей; "
        f"размеры частей: {playable_component_sizes}"
    )
    if len(playable_components) != 1:
        print(
            "ВНИМАНИЕ: непроходимая местность разъединяет играбельный граф соседства — "
            "это измеренное (не обязательно ошибочное) следствие непроходимой реки; "
            "решает продюсер, а не инструмент — см. проверку достижимости узлов сети ниже."
        )

    # --- Третья проверка: обязана ли карта остаться проходимой для игры? ---
    # Единственное, что для игры на самом деле важно, — достижимы ли друг из
    # друга все 25 узлов начальной сети ЧЕРЕЗ играбельные области. В отличие
    # от печати выше (playable_components > 1 сама по себе не отказ), эта
    # проверка — жёсткая остановка, в том же стиле, что и проверка полноты
    # замощения и связности базового разбиения: если узел сети оказался
    # недостижим, это решение обязан принять продюсер, а не инструмент молча
    # смирившийся с недостижимой частью карты.
    node_host_index: dict[str, int | None] = {}
    node_in_impassable_region: dict[str, str | None] = {}
    for node in initial_network["nodes"]:
        point = Point(node["position"]["x"], node["position"]["y"])
        playable_host = None
        impassable_host_id = None
        for candidate_index, polygon in enumerate(post_surgery_polygons):
            if not polygon.covers(point):
                continue
            if candidate_index in impassable_indices:
                impassable_host_id = region_records[candidate_index]["id"]
            else:
                playable_host = candidate_index
                break
        node_host_index[node["id"]] = playable_host
        node_in_impassable_region[node["id"]] = impassable_host_id if playable_host is None else None

    # Узел сети внутри непроходимой области — отдельная, именованная находка:
    # это значило бы, что сеть терминалов и вырезанная местность физически
    # пересекаются, а не просто оказались рядом. На измеренной карте такого
    # нет ни у одного из 25 узлов, но проверяется явно, а не предполагается.
    nodes_inside_impassable_terrain = {
        node_id: region_id
        for node_id, region_id in node_in_impassable_region.items()
        if region_id is not None
    }
    if nodes_inside_impassable_terrain:
        raise SystemExit(
            "узлы начальной сети оказались внутри вырезанной непроходимой "
            f"местности: {nodes_inside_impassable_terrain}. Сеть терминалов и "
            "непроходимая местность физически пересекаются — это решение "
            "продюсера (переместить терминал, изменить маску местности или "
            "явно принять пересечение), а не то, что инструмент может "
            "тихо стерпеть."
        )

    node_playable_component: dict[str, int | None] = {
        node_id: (region_component_of.get(host_index) if host_index is not None else None)
        for node_id, host_index in node_host_index.items()
    }
    nodes_without_region = [node_id for node_id, component in node_playable_component.items() if component is None]
    if nodes_without_region:
        raise SystemExit(
            f"узлы начальной сети не найдены ни в одной играбельной области: "
            f"{nodes_without_region} — рассогласование конвейера (узел вне всех "
            "областей вообще), а не следствие непроходимой местности"
        )
    distinct_node_components = set(node_playable_component.values())
    network_nodes_in_one_component = len(distinct_node_components) <= 1
    print(
        f"все {len(initial_network['nodes'])} узлов начальной сети достижимы друг из "
        f"друга через играбельные области: {network_nodes_in_one_component} "
        f"(разных играбельных частей с узлами: {len(distinct_node_components)})"
    )
    if not network_nodes_in_one_component:
        components_by_node = {
            node_id: component for node_id, component in node_playable_component.items()
        }
        raise SystemExit(
            "непроходимая местность разъединяет сеть терминалов: не все 25 узлов "
            "начальной сети достижимы друг из друга через играбельные области — "
            f"{components_by_node}. Это решение ПРОДЮСЕРА (сузить маску местности, "
            "передвинуть терминал или явно принять недостижимость), а не то, что "
            "инструмент вправе решить самостоятельно молчаливой подгонкой."
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
            "regionsWithInteriorRingsCount": sum(
                1 for record in region_records if record.get("interiorRings")
            ),
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
            # ВНИМАНИЕ про эти два поля: они считаются на БАЗОВОМ разбиении,
            # ДО финального шага вырезания непроходимой местности (то есть на
            # baseRegionCountBeforeTerrainSurgery областях, а не на итоговых
            # regionCount) — это отдельная, более ранняя проверка (см. main()
            # выше), и её смысл не меняется тем, что случилось позже. Числа
            # ПОСЛЕ вырезания местности — три поля ниже с суффиксом
            # AfterTerrainSurgery.
            "connectedComponentCount": len(components),
            "largestConnectedComponentSize": component_sizes[0] if component_sizes else 0,
            "crossCountryAdjacencyCount": cross_country_adjacency_count,
            # Продюсерское решение вырезать непроходимую местность (см. раздел
            # «Финальный шаг» этого файла и README.md, раздел «Непроходимая
            # местность и река») — числа здесь про то, что случилось ПОСЛЕ
            # baseRegionCountBeforeTerrainSurgery областей выше.
            "baseRegionCountBeforeTerrainSurgery": base_region_count,
            "impassableTerrainRegionCount": len(impassable_region_ids),
            "regionsTouchedByTerrainSurgeryCount": len(touched_parent_ids),
            "regionsSplitByTerrainRemovalCount": len(regions_split_by_terrain),
            # Геометрическая проверка ПОСЛЕ вырезания местности: граф соседства
            # ВСЕХ regionCount областей (включая непроходимые) — доказывает,
            # что карта осталась одним листом суши. Обязано быть 1 (см.
            # проверку в main() выше, которая иначе останавливает сборку).
            "connectedComponentCountAfterTerrainSurgery": len(all_regions_components),
            "largestConnectedComponentSizeAfterTerrainSurgery": (
                all_regions_component_sizes[0] if all_regions_component_sizes else 0
            ),
            # Играбельная проверка: граф соседства БЕЗ непроходимых областей
            # (они выброшены из графа целиком, а не только их рёбра). В
            # отличие от предыдущей пары, больше 1 здесь — измеренный факт,
            # а не отказ сборки: непроходимая река может (хотя на текущей
            # карте не оказалась обязана) разрезать играбельную карту.
            "playableConnectedComponentCountAfterTerrainSurgery": len(playable_components),
            "playableLargestConnectedComponentSizeAfterTerrainSurgery": (
                playable_component_sizes[0] if playable_component_sizes else 0
            ),
            "networkNodesInOneComponentAfterTerrainSurgery": network_nodes_in_one_component,
            # Переходы между областями разных стран, пересчитанные ПОСЛЕ
            # вырезания местности. Отдельное поле, а не поправка к базовому:
            # вырезанный кусок наследует страну своего родителя, но граничить
            # может и с областью другой страны, поэтому число законно растёт.
            "crossCountryAdjacencyCountAfterTerrainSurgery": cross_country_adjacency_count_after,
        },
        "regions": region_records,
        "impassableTerrain": {
            "decisionRecord": (
                "games/cards-money-trains/annotations/README.md#непроходимая-местность-и-река"
            ),
            "fieldName": IMPASSABLE_TERRAIN_FIELD,
            "measurement": terrain_diagnostics,
            "regionIds": impassable_region_ids,
            "surgeryLog": terrain_surgery_log,
        },
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
        # Поле sliverPolygon — временный объект геометрии для build_doubts()
        # выше (см. докстринг collapse_slivers()), не часть постоянной формы
        # записи collapsedSliver (её закрепляет схема шестью полями: areaPx2,
        # effectiveWidthPx, atX, atY, sharedBoundaryPx, merged), да и не могло
        # бы ею стать: JSON не умеет хранить объект Python. Здесь оно
        # отбрасывается явным перечислением полей ниже. Контур щели (в виде
        # координат, "outline") и площадь чужой территории ("foreignAreaPx2")
        # попадают в постоянную запись только у doubts[].kind ==
        # 'country-border-gap-merged' — см. build_doubts(); здесь, в списке
        # collapsedSlivers, они не нужны ни для одной из 2330 щелей: это был
        # бы избыточный вес файла без читателя.
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
