#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_map_countries_stations.py
==================================

Назначение
----------
Разобрать авторский файл карты "Карта Гвиней а4.ai" (это PDF 1.6 "под
капотом" — Adobe Illustrator сохраняет .ai как обычный PDF с добавленными
приватными секциями) и извлечь из него ДВЕ вещи в канонических координатах
карты 5079 x 3627 точек:

  1. контуры 10 стран (полигоны с уникальным цветом заливки CMYK);
  2. 23 станции — но НЕ пересчитывая их координаты заново, а беря уже
     выверенные позиции из отчёта `vector-map.review.json` (раздел
     `terminalCandidates`), потому что именно эти 23 точки использовались
     для калибровки аффинного преобразования `pdfToCanonical` (см. поле
     `calibration.method` в том же отчёте). Пересчитывать их из значков
     заново — значит потерять точность калибровки и создать риск лишнего
     рассинхрона с уже принятым отчётом.

Это НЕПУБЛИКУЕМЫЙ черновой артефакт (см. `publishable: false` в результате).
Он не подключён ни к игровому манифесту, ни к среде исполнения — это
вспомогательные данные для человека, который позже проставит настоящие
названия стран и номера станций.

Почему в файле два независимых источника геометрии
----------------------------------------------------
На карте среди 225 закрашенных путей (проверено ранее, см. историю задачи
в .tmp/agent-workflow/cmt-boundary-review/probe_fills.py) встречается
группа из 25 значков одного и того же "станционного" цвета чернил CMYK
(0.369, 0.297, 0.346, 0.101). При ближайшем рассмотрении она распадается
на две ПО-РАЗНОМУ нарисованные группы:

  - 23 значка размером ~115 x 117 точек, состоящие из ДВУХ вложенных
    контуров (внешняя шестерня с зубчатым ободом + внутреннее отверстие-
    "дырка") — это настоящие станции. Их центры почти идеально (ошибка
    порядка 0.002-1.3 точки) совпадают с 23 позициями terminalCandidates
    из уже принятого отчёта — это и есть перекрёстное подтверждение,
    что это именно станции, а не что-то ещё;
  - 2 значка размером ровно вдвое меньше (~60 x 60 точек), состоящие из
    ОДНОГО контура без отверстия — визуальная проверка вырезки из
    `draft/trains/Игровая Карта.png` показала, что это гладкие кружки
    без зубцов с подписями "9¾" и "π" (полустанки — промежуточные
    карты, а не игровые станции). Их центры отстоят от ближайшей станции
    на 294-349 точек — то есть они физически расположены в стороне,
    случайного совпадения позиций тут нет.

Поэтому итоговый список станций строится из `terminalCandidates`
(источник истины для позиций), а 23 значка-шестерёнки используются только
как НЕЗАВИСИМАЯ проверка (взаимное соответствие центров), а 2 маленьких
кружка сохраняются отдельным списком `waypoints`: это полустанки —
промежуточные остановки, которые, в отличие от терминала, грузы не
принимают. Подтверждено PM 2026-07-26.

Как устроен разбор PDF-потока (кратко, для нового разработчика)
------------------------------------------------------------------
  - Внутри PDF "поток содержимого" (content stream) — это текстовый
    мини-язык операторов, похожий на PostScript: числа-операнды идут
    перед оператором, например `100 0 l` означает "провести линию в
    точку (100, 0)".
  - "Текущая матрица преобразования" (CTM, current transformation
    matrix) переводит локальные координаты пути в координаты страницы
    PDF. Она меняется оператором `cm` и сохраняется/восстанавливается
    операторами `q`/`Q` (это стек "закладок" графического состояния).
  - Путь может состоять из нескольких "подпутей" (несколько
    m...(l|c|v|y)*...h подряд перед одним оператором закраски `f`) —
    например, буква "О" из внешнего и внутреннего контура, или (в нашем
    случае) значок станции из внешней шестерни и внутренней дырки.
  - Кривые Безье (`c`/`v`/`y`) переводятся в ломаные линии ("сглаживаются")
    с контролем ошибки не более `FLATTEN_TOLERANCE_PX` точки — так же,
    как это делает принятый в проекте инструмент
    `vector_map_polygonizer.py` (см. `flatten_cubic`/`_distance_to_chord`
    там же; здесь та же математика скопирована и прокомментирована
    заново, чтобы этот файл был самодостаточным).

Что не входит в этот скрипт
------------------------------
  - Скрипт НЕ присваивает странам названия и НЕ читает номера станций
    с карты — это отдельный шаг, который должен выполнить человек
    (прямой запрет в постановке задачи).
  - Исходный `.ai`-файл открывается только на чтение.
  - Принятые отчёты (`vector-map.review.json` и соседние `*.review.json`)
    только читаются, не изменяются.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import zlib
from collections import Counter
from typing import Any

from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry


# ---------------------------------------------------------------------------
# Пути и константы источников данных
# ---------------------------------------------------------------------------

# Путь к авторскому файлу карты. Открывается СТРОГО на чтение.
AI_PATH = "/home/abc/projects/Cubica-AI/draft/trains/Карта Гвиней  а4.ai"

# Ожидаемый sha256 исходного файла — контроль, что мы работаем с тем же
# файлом, для которого были установлены факты в постановке задачи. Если
# файл изменится, скрипт должен упасть с понятной ошибкой, а не молча
# выдать другой результат.
EXPECTED_AI_SHA256 = (
    "453703c064cf6aa6220f5059f83c9fa33404310f5a65cce5529900f0ddee1806"
)

# Уже принятый отчёт конвейера векторной карты — источник калибровки и
# ИСТОЧНИК ИСТИНЫ для позиций 23 станций (раздел terminalCandidates).
# Файл только читается, не изменяется.
REVIEW_JSON_PATH = (
    "/home/abc/projects/Cubica-AI/games/cards-money-trains/annotations/"
    "vector-map.review.json"
)

# Куда пишем результат этого скрипта.
OUTPUT_JSON_PATH = (
    "/home/abc/projects/Cubica-AI/games/cards-money-trains/annotations/"
    "vector-map.countries-stations.draft.json"
)

# Контрольные признаки потока геометрии внутри PDF — получены ранее
# ручным анализом файла (см. find_stream.py в истории задачи) и служат,
# чтобы однозначно опознать нужный поток среди прочих потоков файла
# (шрифты, гигантская растровая подложка /Im0 и т.п.), даже если порядок
# объектов в файле слегка изменится.
EXPECTED_STREAM_SIZE = 765739
EXPECTED_STREAM_HEAD = b"/OC /MC0 BDC"

# Аффинное преобразование "координаты страницы PDF -> канонические
# координаты карты 5079 x 3627 точек". ОБЯЗАТЕЛЬНО берём готовое,
# откалиброванное по 23 станциям преобразование из принятого отчёта
# (ошибка калибровки 0.44 точки), а не пересчитываем своё по размеру
# страницы — так реализация остаётся согласованной с уже принятым
# конвейером проекта.
#   x' = a*x + c*y + e
#   y' = b*x + d*y + f
PDF_TO_CANONICAL = {
    "a": 5.842515736,
    "b": 0.000175041,
    "c": 0.001037515,
    "d": -5.841882751,
    "e": -8.935763615,
    "f": 3517.375509641,
}

CANONICAL_WIDTH = 5079
CANONICAL_HEIGHT = 3627

# Допуск сглаживания кривых Безье в канонических точках — тот же, что
# использует принятый конвейер (`vector_map_polygonizer.py`).
FLATTEN_TOLERANCE_PX = 0.25
MAX_FLATTEN_DEPTH = 24

# Все числа в итоговом JSON округляются до этого числа знаков после
# запятой — для детерминированности повторных запусков.
ROUND_DIGITS = 6

# Цвет чернил (CMYK), которым нарисованы ВСЕ станционные значки и обе
# значки полустанков — они используют одну и ту же заливку, различить
# их по одному только цвету нельзя, нужен признак формы (см. ниже).
STATION_INK_COLOR = (0.369, 0.297, 0.346, 0.101)

# Настоящий значок станции нарисован ДВУМЯ вложенными подпутями (внешняя
# шестерня с зубчатым ободом + внутренняя дырка втулки). Декоративная
# полустанок — гладкий кружок без отверстия, то есть ОДНИМ подпутём.
STATION_ICON_SUBPATH_COUNT = 2
DECORATIVE_MARKER_SUBPATH_COUNT = 1

# Порог площади (в px^2 канонических координат), отделяющий 10 контуров
# стран от всего остального. Обоснование выбора порога (не магическое
# число, а измеренный разрыв в данных): среди всех закрашенных объектов,
# кроме самого большого (фон/море), 10 объектов со СТРАНОВЫМИ контурами
# имеют площадь от ~108 813 до ~1 670 643 px^2. Следующий по величине
# закрашенный объект (не страна — декоративный элемент легенды,
# встречающийся с одним и тем же цветом много раз) имеет площадь всего
# ~54 178 px^2, то есть почти вдвое меньше самой маленькой страны. Порог
# 80 000 лежит ровно посередине этого разрыва и оставляет большой запас
# в обе стороны.
COUNTRY_AREA_THRESHOLD_PX2 = 80_000.0

EXPECTED_COUNTRY_COUNT = 10
EXPECTED_STATION_COUNT = 23
EXPECTED_DECORATIVE_MARKER_COUNT = 2

# Два полустанка опознаны по подписям на карте и подтверждены PM (см.
# посмотревшим на вырезки из `draft/trains/Игровая Карта.png`), а не
# программным распознаванием текста. Поэтому здесь это предложенная,
# НЕ ОКОНЧАТЕЛЬНАЯ интерпретация: reviewStatus="proposed",
# confirmationStatus="unconfirmed" — финальное подтверждение остаётся за
# человеком. Ключ — округлённый (до 1 знака) канонический центр значка,
# чтобы привязка была устойчивой и не зависела от порядка обхода путей.
DECORATIVE_MARKER_LABELS_BY_ROUNDED_CENTER = {
    (2958.2, 813.8): "9¾",
    (3258.8, 1384.9): "3,14 (π)",
}
DECORATIVE_MARKER_LABEL_MATCH_TOLERANCE_PX = 1.0


def _fail(message: str) -> None:
    """Остановиться с понятной ошибкой вместо тихой выдачи неверного результата."""

    raise ValueError(message)


def _round(value: float) -> float:
    """Округлить число до ROUND_DIGITS знаков и убрать некрасивый '-0.0'."""

    rounded = round(float(value), ROUND_DIGITS)
    return 0.0 if rounded == 0 else rounded


def _round_point(point: tuple[float, float]) -> dict[str, float]:
    return {"x": _round(point[0]), "y": _round(point[1])}


def sha256_of_file(path: str) -> str:
    """Посчитать sha256 файла потоково (без загрузки целиком в память)."""

    hasher = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


# ---------------------------------------------------------------------------
# Шаг 1. Достать поток геометрии из .ai-файла (только чтение)
# ---------------------------------------------------------------------------

def extract_geometry_stream() -> bytes:
    """
    Найти и распаковать единственный поток содержимого страницы с
    векторной геометрией внутри .ai (это PDF 1.6 "под капотом").

    Файл содержит один гигантский поток растровой подложки /Im0 (после
    распаковки ~837 МБ) — его нельзя распаковывать целиком (слишком
    дорого по памяти), поэтому каждый найденный поток распаковывается
    ПОСТЕПЕННО (небольшими кусками) и распаковка обрывается, как только
    накопленный объём превышает разумный порог `cap` — это верный
    признак, что перед нами растр, а не геометрия.

    Файл открывается только на чтение; никакие данные в него не пишутся.
    """

    with open(AI_PATH, "rb") as fh:
        data = fh.read()

    cap = 5_000_000  # порог отсечения "это растр, а не поток геометрии"
    stream_starts = [m.end() for m in re.finditer(rb"stream\r\n|stream\n", data)]

    for start in stream_starts:
        end = data.find(b"endstream", start)
        if end == -1:
            continue
        raw = data[start:end]
        if raw.endswith(b"\r\n"):
            raw = raw[:-2]
        elif raw.endswith(b"\n") or raw.endswith(b"\r"):
            raw = raw[:-1]

        decompressor = zlib.decompressobj()
        out = bytearray()
        try:
            pos = 0
            chunk_size = 65536
            within_cap = True
            while pos < len(raw):
                out.extend(decompressor.decompress(raw[pos:pos + chunk_size]))
                pos += chunk_size
                if len(out) > cap:
                    within_cap = False
                    break
            if within_cap:
                out.extend(decompressor.flush())
            else:
                continue
        except zlib.error:
            continue

        if len(out) == EXPECTED_STREAM_SIZE and out.startswith(EXPECTED_STREAM_HEAD):
            return bytes(out)

    _fail(
        "Не удалось найти поток геометрии по контрольным признакам "
        f"(ожидался размер {EXPECTED_STREAM_SIZE} байт, начало "
        f"{EXPECTED_STREAM_HEAD!r}). Структура исходного файла могла "
        "измениться."
    )
    raise AssertionError("unreachable")  # для статических анализаторов


# ---------------------------------------------------------------------------
# Шаг 2. Аффинные преобразования (CTM страницы PDF + калиброванный переход
# в канонические координаты карты)
# ---------------------------------------------------------------------------

# Матрица в конвенции PDF-оператора cm: точка-строка умножается на матрицу
# 3x3 (a b 0 / c d 0 / e f 1). Хранится как кортеж (a, b, c, d, e, f).
IDENTITY_MATRIX = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def matrix_multiply(inner: tuple, outer: tuple) -> tuple:
    """Скомпоновать два преобразования: сначала `inner`, затем `outer`.

    В терминах оператора `cm` с локальной матрицей M: новый CTM = M * старый
    CTM, то есть при рисовании сначала действует локальная матрица пути,
    а затем — всё, что уже накоплено снаружи в CTM.
    """

    a1, b1, c1, d1, e1, f1 = inner
    a2, b2, c2, d2, e2, f2 = outer
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def apply_matrix(x: float, y: float, matrix: tuple) -> tuple[float, float]:
    """Перевести точку (x, y) через матрицу CTM (та же конвенция PDF)."""

    a, b, c, d, e, f = matrix
    return (x * a + y * c + e, x * b + y * d + f)


def apply_pdf_to_canonical(x: float, y: float) -> tuple[float, float]:
    """Перевести точку страницы PDF в канонические координаты карты.

    Используется ЕДИНОЕ откалиброванное преобразование из принятого
    отчёта (см. PDF_TO_CANONICAL) — а не собственный пересчёт по
    размеру страницы.
    """

    m = PDF_TO_CANONICAL
    return (
        m["a"] * x + m["c"] * y + m["e"],
        m["b"] * x + m["d"] * y + m["f"],
    )


# ---------------------------------------------------------------------------
# Шаг 3. Сглаживание кривых Безье с контролем ошибки (адаптивное деление)
# ---------------------------------------------------------------------------
# Математика скопирована из принятого инструмента
# `vector_map_polygonizer.py` (функции `_distance_to_chord`, `_split_cubic`,
# `flatten_cubic`) и прокомментирована заново, чтобы этот файл был
# самодостаточным и не требовал чтения соседнего модуля для понимания.

def _distance_to_chord(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    """Расстояние от точки до бесконечной прямой через (start, end).

    Кубическая кривая Безье целиком лежит внутри выпуклой оболочки своих
    четырёх опорных точек. Поэтому если ОБЕ внутренние опорные точки
    находятся не дальше `tolerance` от хорды (прямой между концами),
    вся кривая тоже не дальше `tolerance` от хорды — это детерминированный
    и заведомо не занижающий ошибку критерий "достаточно плоско".
    """

    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(
        dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]
    ) / length


def _split_cubic(p0, p1, p2, p3):
    """Разбить кубическую кривую на две половины в t=0.5 (де Кастельжо)."""

    def midpoint(left, right):
        return ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)

    p01 = midpoint(p0, p1)
    p12 = midpoint(p1, p2)
    p23 = midpoint(p2, p3)
    p012 = midpoint(p01, p12)
    p123 = midpoint(p12, p23)
    p0123 = midpoint(p012, p123)
    return (p0, p01, p012, p0123), (p0123, p123, p23, p3)


def flatten_cubic(p0, p1, p2, p3, tolerance: float, depth: int = 0):
    """Приблизить одну кубическую кривую ломаной с гарантированной ошибкой.

    Возвращает список точек ОТ p0 ДО p3 включительно (без дублирования
    внутренних точек при рекурсивном делении).
    """

    flatness = max(
        _distance_to_chord(p1, p0, p3),
        _distance_to_chord(p2, p0, p3),
    )
    if flatness <= tolerance:
        return [p0, p3]
    if depth >= MAX_FLATTEN_DEPTH:
        _fail(
            "сглаживание кривой Безье превысило безопасный предел "
            f"рекурсии, не достигнув допуска {tolerance}"
        )
    left, right = _split_cubic(p0, p1, p2, p3)
    left_points = flatten_cubic(*left, tolerance, depth + 1)
    right_points = flatten_cubic(*right, tolerance, depth + 1)
    return left_points[:-1] + right_points


# ---------------------------------------------------------------------------
# Шаг 4. Токенизация и разбор потока операторов PDF, построение заливок
# ---------------------------------------------------------------------------

# Регулярное выражение узнаёт: имена (/Name), числа, массивы, строки и
# операторы-ключевые слова. Этого достаточно для геометрического потока —
# литеральные строки/массивы в нём встречаются только в служебных
# операторах, которые нас не интересуют.
TOKEN_RE = re.compile(
    rb"/[^\s/()<>\[\]{}%]+"
    rb"|-?\d*\.\d+(?:[eE][-+]?\d+)?"
    rb"|-?\d+(?:[eE][-+]?\d+)?"
    rb"|\[[^\]]*\]"
    rb"|\([^)]*\)"
    rb"|<[^>]*>"
    rb"|[A-Za-z][A-Za-z0-9*'\"]*"
)

_NUMBER_RE = re.compile(rb"^-?\d*\.?\d+(?:[eE][-+]?\d+)?$")


def _is_number_token(token: bytes) -> bool:
    return bool(_NUMBER_RE.match(token)) and token not in (b"", b"-")


class _FillRecord:
    """Один разобранный закрашенный путь (объект заливки) в канонических
    координатах, до какой-либо классификации на страну/станцию/прочее."""

    __slots__ = (
        "raw_id",
        "rings",       # список замкнутых колец (list[list[(x, y)]])
        "color_model",
        "color_values",
    )

    def __init__(self, raw_id, rings, color_model, color_values):
        self.raw_id = raw_id
        self.rings = rings
        self.color_model = color_model
        self.color_values = color_values


def parse_fill_records(stream: bytes) -> list[_FillRecord]:
    """Разобрать поток операторов PDF и вернуть все закрашенные объекты.

    Ведётся стек CTM (q/Q/cm) и текущий цвет заливки (g/rg/k/sc/scn).
    Каждый путь может состоять из нескольких подпутей (m...(l|c|v|y)*h) —
    они сохраняются как отдельные кольца одного объекта заливки. Кривые
    сразу переводятся в канонические координаты и сглаживаются там же
    (аффинное преобразование коммутирует с параметризацией кривой Безье,
    поэтому сглаживание после преобразования даёт тот же результат, что и
    сглаживание до него, но так проще контролировать допуск в
    "физических" единицах канонической карты).
    """

    ctm_stack = [IDENTITY_MATRIX]
    fill_color: dict[str, Any] = {"model": "unknown", "values": []}

    subpaths: list[dict[str, Any]] = []
    current_subpath: dict[str, Any] | None = None
    current_point = (0.0, 0.0)
    subpath_start = (0.0, 0.0)

    records: list[_FillRecord] = []
    operands: list[Any] = []

    def current_ctm():
        return ctm_stack[-1]

    def to_canonical(x: float, y: float) -> tuple[float, float]:
        """Локальные координаты пути -> CTM (страница PDF) -> канонические."""

        page_x, page_y = apply_matrix(x, y, current_ctm())
        return apply_pdf_to_canonical(page_x, page_y)

    def start_new_path():
        nonlocal subpaths, current_subpath
        subpaths = []
        current_subpath = None

    def ensure_subpath_open():
        nonlocal current_subpath
        if current_subpath is None:
            current_subpath = {"points": []}
            subpaths.append(current_subpath)

    def finish_fill():
        """Оператор закраски встречен — собрать объект заливки из
        накопленных подпутей (принудительно замкнув каждый подпуть, как
        того требует семантика заливки в PDF: незамкнутый путь при
        заливке неявно замыкается прямой к началу подпути)."""

        nonlocal subpaths, current_subpath
        if not subpaths:
            start_new_path()
            return

        rings = []
        for sp in subpaths:
            points = sp["points"]
            if len(points) < 3:
                continue
            if points[0] != points[-1]:
                points = points + [points[0]]
            rings.append(points)

        if rings:
            records.append(
                _FillRecord(
                    raw_id=f"raw-fill-{len(records):04d}",
                    rings=rings,
                    color_model=fill_color.get("model"),
                    color_values=tuple(
                        round(v, 4) for v in fill_color.get("values", [])
                    ),
                )
            )
        start_new_path()

    for match in TOKEN_RE.finditer(stream):
        token = match.group()

        if token.startswith(b"/") or token[:1] in (b"[", b"(", b"<"):
            operands.append(token.decode("latin-1"))
            continue
        if _is_number_token(token):
            operands.append(float(token))
            continue

        op = token.decode("latin-1")

        if op == "q":
            ctm_stack.append(current_ctm())
        elif op == "Q":
            if len(ctm_stack) > 1:
                ctm_stack.pop()
        elif op == "cm":
            a, b, c, d, e, f = operands[-6:]
            ctm_stack[-1] = matrix_multiply((a, b, c, d, e, f), ctm_stack[-1])
        elif op == "m":
            x, y = operands[-2:]
            point = to_canonical(x, y)
            current_subpath = {"points": [point]}
            subpaths.append(current_subpath)
            current_point = point
            subpath_start = point
        elif op == "l":
            ensure_subpath_open()
            x, y = operands[-2:]
            point = to_canonical(x, y)
            current_subpath["points"].append(point)
            current_point = point
        elif op == "c":
            # полная кубическая кривая: 3 контрольные точки заданы явно
            ensure_subpath_open()
            x1, y1, x2, y2, x3, y3 = operands[-6:]
            p1 = to_canonical(x1, y1)
            p2 = to_canonical(x2, y2)
            p3 = to_canonical(x3, y3)
            current_subpath["points"].extend(
                flatten_cubic(current_point, p1, p2, p3, FLATTEN_TOLERANCE_PX)[1:]
            )
            current_point = p3
        elif op == "v":
            # сокращённая форма: первая контрольная точка = текущая точка
            ensure_subpath_open()
            x2, y2, x3, y3 = operands[-4:]
            p2 = to_canonical(x2, y2)
            p3 = to_canonical(x3, y3)
            current_subpath["points"].extend(
                flatten_cubic(current_point, current_point, p2, p3, FLATTEN_TOLERANCE_PX)[1:]
            )
            current_point = p3
        elif op == "y":
            # сокращённая форма: вторая контрольная точка = конечная точка
            ensure_subpath_open()
            x1, y1, x3, y3 = operands[-4:]
            p1 = to_canonical(x1, y1)
            p3 = to_canonical(x3, y3)
            current_subpath["points"].extend(
                flatten_cubic(current_point, p1, p3, p3, FLATTEN_TOLERANCE_PX)[1:]
            )
            current_point = p3
        elif op == "h":
            if current_subpath is not None and current_subpath["points"]:
                current_point = subpath_start
        elif op == "re":
            # прямоугольник — отдельный, всегда замкнутый подпуть
            x, y, w, h = operands[-4:]
            corners = [
                to_canonical(x, y),
                to_canonical(x + w, y),
                to_canonical(x + w, y + h),
                to_canonical(x, y + h),
            ]
            current_subpath = {"points": corners}
            subpaths.append(current_subpath)
            current_point = corners[0]
            subpath_start = corners[0]
        elif op in ("f", "F", "f*", "B", "B*", "b", "b*"):
            # все варианты закраски (в т.ч. "заливка + обводка") для нас
            # означают одно и то же: зафиксировать текущий путь как заливку
            finish_fill()
        elif op in ("S", "s", "n"):
            # чистая обводка или явное "путь без покраски" — заливки нет
            start_new_path()
        elif op == "g":
            (gray,) = operands[-1:]
            fill_color = {"model": "gray", "values": [gray]}
        elif op == "rg":
            r, g, b = operands[-3:]
            fill_color = {"model": "rgb", "values": [r, g, b]}
        elif op == "k":
            c, m, y_, kk = operands[-4:]
            fill_color = {"model": "cmyk", "values": [c, m, y_, kk]}
        elif op in ("sc", "scn"):
            numbers = [v for v in operands if isinstance(v, float)]
            model = {1: "gray", 3: "rgb", 4: "cmyk"}.get(len(numbers), "sc_raw")
            fill_color = {"model": model, "values": numbers}
        # прочие операторы (текст, состояние графики, штрихпунктир и т.п.)
        # не влияют на геометрию заливок и намеренно игнорируются

        operands = []

    return records


# ---------------------------------------------------------------------------
# Шаг 5. Превратить кольца пути в полигон shapely (с учётом возможных дыр)
# ---------------------------------------------------------------------------

def _rings_to_geometry(rings: list[list[tuple[float, float]]]) -> BaseGeometry | None:
    """Собрать из подпутей одного объекта заливки итоговую геометрию.

    В общем случае у объекта заливки может быть несколько подпутей:
    несколько раздельных островов (тогда результат — их объединение)
    или внешний контур с внутренней дыркой (тогда результат — разность).
    Симметрическая разность колец, отсортированных по убыванию площади,
    закрывает оба случая единообразно: для непересекающихся колец она
    равна объединению, а для строго вложенного кольца — вычитанию дыры.
    """

    polygons = []
    for ring in rings:
        try:
            polygon = Polygon(ring)
        except Exception:
            continue
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if not polygon.is_empty and polygon.area > 0:
            polygons.append(polygon)

    if not polygons:
        return None

    polygons.sort(key=lambda p: -p.area)
    geometry = polygons[0]
    for polygon in polygons[1:]:
        geometry = geometry.symmetric_difference(polygon)

    return None if geometry.is_empty else geometry


# ---------------------------------------------------------------------------
# Шаг 6. Сериализация геометрии в JSON (координаты + округление)
# ---------------------------------------------------------------------------

def _polygon_rings_json(geometry: BaseGeometry) -> list[list[list[float]]]:
    """Список колец полигона (внешнее кольцо первым, затем дыры), каждое —
    список [x, y] в канонических координатах, округлённых до ROUND_DIGITS."""

    polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    rings_json = []
    for polygon in polygons:
        rings_json.append(
            [[_round(x), _round(y)] for x, y in polygon.exterior.coords]
        )
        for interior in polygon.interiors:
            rings_json.append([[_round(x), _round(y)] for x, y in interior.coords])
    return rings_json


def _bounds_json(geometry: BaseGeometry) -> dict[str, float]:
    min_x, min_y, max_x, max_y = geometry.bounds
    return {
        "minX": _round(min_x),
        "minY": _round(min_y),
        "maxX": _round(max_x),
        "maxY": _round(max_y),
    }


def _representative_point_json(geometry: BaseGeometry) -> dict[str, float]:
    point = geometry.representative_point()
    if not geometry.contains(point):
        _fail("представительная точка оказалась вне контура — геометрия невалидна")
    return _round_point((point.x, point.y))


# ---------------------------------------------------------------------------
# Шаг 7. Отбор 10 стран
# ---------------------------------------------------------------------------

def select_countries(fills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Отобрать 10 контуров стран из всех разобранных заливок.

    Правило (обоснование см. в комментарии к COUNTRY_AREA_THRESHOLD_PX2):
      1. исключить самую большую по площади заливку — это фон/море;
      2. среди оставшихся оставить только "крупные" (площадь выше
         измеренного порога, отделяющего страны от прочих деталей карты);
      3. среди крупных оставить только те, чей цвет CMYK уникален в
         пределах этой крупной группы (несколько декоративных элементов
         легенды совпадающего масштаба и повторяющегося цвета так
         исключаются).
    Результат обязан содержать ровно EXPECTED_COUNTRY_COUNT записей —
    иначе это сигнал, что исходные данные или допущения изменились, и
    скрипт должен остановиться, а не молча выдать неверный список.
    """

    if not fills:
        _fail("не найдено ни одной заливки — нечего анализировать")

    by_area_desc = sorted(fills, key=lambda f: -f["geometry"].area)
    background = by_area_desc[0]
    remaining = by_area_desc[1:]

    large = [f for f in remaining if f["geometry"].area > COUNTRY_AREA_THRESHOLD_PX2]
    color_counts = Counter(f["color_values"] for f in large)
    countries = [f for f in large if color_counts[f["color_values"]] == 1]

    if len(countries) != EXPECTED_COUNTRY_COUNT:
        _fail(
            f"ожидалось ровно {EXPECTED_COUNTRY_COUNT} стран, "
            f"получено {len(countries)}; проверьте допущения отбора "
            "(порог площади, критерий уникальности цвета)"
        )

    return countries, background


# ---------------------------------------------------------------------------
# Шаг 8. Отбор значков станционного цвета (23 терминала + 2 полустанка)
# ---------------------------------------------------------------------------

def select_station_color_icons(
    fills: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Разделить все значки станционного цвета на терминалы и полустанки.

    Признак разделения — ФОРМА (число подпутей), а не размер: настоящая
    станция нарисована шестерёнкой с отверстием (2 подпути — внешний зубчатый
    контур и внутренняя дырка), а полустанок — гладким кружком
    без отверстия (1 подпуть). Оба типа используют один и тот же цвет
    чернил, поэтому одного цвета для различения недостаточно.
    """

    same_color = [f for f in fills if f["color_values"] == STATION_INK_COLOR]

    gear_icons = [
        f for f in same_color if f["n_subpaths"] == STATION_ICON_SUBPATH_COUNT
    ]
    decorative = [
        f for f in same_color if f["n_subpaths"] == DECORATIVE_MARKER_SUBPATH_COUNT
    ]

    if len(gear_icons) + len(decorative) != len(same_color):
        _fail(
            "среди значков станционного цвета встретился объект с "
            "неожиданным числом подпутей — форма не укладывается ни в "
            "'терминал', ни в 'полустанок'"
        )
    if len(gear_icons) != EXPECTED_STATION_COUNT:
        _fail(
            f"ожидалось ровно {EXPECTED_STATION_COUNT} значков-шестерёнок "
            f"станционного цвета для перекрёстной проверки, получено "
            f"{len(gear_icons)}"
        )
    if len(decorative) != EXPECTED_DECORATIVE_MARKER_COUNT:
        _fail(
            f"ожидалось ровно {EXPECTED_DECORATIVE_MARKER_COUNT} "
            f"декоративных значка станционного цвета, получено "
            f"{len(decorative)}"
        )

    return gear_icons, decorative


# ---------------------------------------------------------------------------
# Шаг 9. Устойчивая сортировка (Y, затем X ограничивающего прямоугольника)
# ---------------------------------------------------------------------------

def _sort_key_by_bbox(fill: dict[str, Any]) -> tuple[float, float]:
    bounds = fill["geometry"].bounds  # (minx, miny, maxx, maxy)
    return (_round(bounds[1]), _round(bounds[0]))


def _sort_key_by_point(x: float, y: float) -> tuple[float, float]:
    return (_round(y), _round(x))


# ---------------------------------------------------------------------------
# Основная сборка результата
# ---------------------------------------------------------------------------

def build_result() -> dict[str, Any]:
    # --- контроль версии исходного файла ---
    actual_sha256 = sha256_of_file(AI_PATH)
    if actual_sha256 != EXPECTED_AI_SHA256:
        _fail(
            "sha256 исходного .ai не совпадает с ожидаемым — файл изменился "
            f"с момента постановки задачи (ожидался {EXPECTED_AI_SHA256}, "
            f"получен {actual_sha256})"
        )

    # --- разобрать геометрию из .ai (только чтение) ---
    stream = extract_geometry_stream()
    raw_records = parse_fill_records(stream)

    fills: list[dict[str, Any]] = []
    for record in raw_records:
        geometry = _rings_to_geometry(record.rings)
        if geometry is None:
            # Вырожденные пути (нулевая площадь, самопересекающиеся "пылинки"
            # в несколько точек) не несут геометрического смысла для нашей
            # задачи — они не страны и не станции, поэтому просто
            # пропускаются, не искажая подсчёт содержательных объектов.
            continue
        fills.append(
            {
                "geometry": geometry,
                "color_model": record.color_model,
                "color_values": record.color_values,
                "n_subpaths": len(record.rings),
            }
        )

    # --- страны ---
    countries_raw, background = select_countries(fills)
    countries_sorted = sorted(countries_raw, key=_sort_key_by_bbox)

    country_records = []
    for index, fill in enumerate(countries_sorted, start=1):
        geometry = fill["geometry"]
        country_records.append(
            {
                "id": f"country-fill-{index:04d}",
                "name": None,  # человек присвоит название позже — не отбрасываем поле
                "colorCmyk": list(fill["color_values"]),
                "areaPx2": _round(geometry.area),
                "bounds": _bounds_json(geometry),
                "representativePoint": _representative_point_json(geometry),
                "subpathCount": fill["n_subpaths"],
                "contour": _polygon_rings_json(geometry),
            }
        )

    # --- пересечения контуров стран (известная остаточная величина) ---
    country_geoms = [f["geometry"] for f in countries_sorted]
    total_overlap_px2 = 0.0
    overlap_pairs = []
    for i in range(len(country_geoms)):
        for j in range(i + 1, len(country_geoms)):
            gi, gj = country_geoms[i], country_geoms[j]
            if gi.intersects(gj):
                overlap_area = gi.intersection(gj).area
                if overlap_area > 1e-6:
                    total_overlap_px2 += overlap_area
                    overlap_pairs.append(
                        {
                            "countryA": country_records[i]["id"],
                            "countryB": country_records[j]["id"],
                            "overlapAreaPx2": _round(overlap_area),
                        }
                    )
    total_country_area_px2 = sum(g.area for g in country_geoms)
    overlap_ratio = (
        total_overlap_px2 / total_country_area_px2 if total_country_area_px2 else 0.0
    )

    # --- значки станционного цвета: терминалы (проверка) + полустанки ---
    gear_icons, decorative_icons = select_station_color_icons(fills)

    # --- станции: источник истины — terminalCandidates из принятого отчёта ---
    with open(REVIEW_JSON_PATH, "r", encoding="utf-8") as fh:
        review = json.load(fh)
    terminal_candidates = review["terminalCandidates"]
    if len(terminal_candidates) != EXPECTED_STATION_COUNT:
        _fail(
            f"в {REVIEW_JSON_PATH} найдено "
            f"{len(terminal_candidates)} terminalCandidates, ожидалось "
            f"{EXPECTED_STATION_COUNT}; принятый отчёт изменился"
        )

    terminals_sorted = sorted(
        terminal_candidates,
        key=lambda t: _sort_key_by_point(
            t["canonicalPosition"]["x"], t["canonicalPosition"]["y"]
        ),
    )
    station_records = []
    for index, terminal in enumerate(terminals_sorted, start=1):
        station_records.append(
            {
                "id": f"station-icon-{index:04d}",
                "sourceTerminalCandidateId": terminal["id"],
                "mappedReferenceId": terminal["mappedReferenceId"],
                "canonicalPosition": {
                    "x": _round(terminal["canonicalPosition"]["x"]),
                    "y": _round(terminal["canonicalPosition"]["y"]),
                },
                "residualPx": _round(terminal["residualPx"]),
            }
        )

    # --- перекрёстная проверка: центры 23 значков-шестерёнок vs 23 станции ---
    # Это НЕЗАВИСИМАЯ проверка калибровки (см. запрос координатора):
    # значки-шестерёнки отобраны по цвету+форме из геометрии .ai, а станции
    # взяты из уже принятого отчёта — если бы калибровка "поехала", здесь
    # появились бы большие невязки или неоднозначные (не 1-в-1) соответствия.
    crosscheck = []
    used_station_ids: set[str] = set()
    for gear in gear_icons:
        centroid = gear["geometry"].centroid
        best_station = None
        best_distance = None
        for station in station_records:
            dx = centroid.x - station["canonicalPosition"]["x"]
            dy = centroid.y - station["canonicalPosition"]["y"]
            distance = math.hypot(dx, dy)
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_station = station
        crosscheck.append(
            {
                "gearIconCentroid": _round_point((centroid.x, centroid.y)),
                "matchedStationId": best_station["id"],
                "matchedMappedReferenceId": best_station["mappedReferenceId"],
                "residualToStationPx": _round(best_distance),
            }
        )
        used_station_ids.add(best_station["id"])

    if len(used_station_ids) != EXPECTED_STATION_COUNT:
        _fail(
            "перекрёстная проверка значков-шестерёнок и станций дала "
            "неоднозначное (не взаимно-однозначное) соответствие — "
            f"уникальных совпавших станций: {len(used_station_ids)} из "
            f"{EXPECTED_STATION_COUNT}"
        )
    crosscheck.sort(key=lambda item: item["matchedStationId"])
    max_crosscheck_residual_px = max(
        (item["residualToStationPx"] for item in crosscheck), default=0.0
    )

    # --- полустанки: два маленьких гладких кружка ---
    #
    # Полустанок — промежуточная остановка на дороге, в отличие от терминала он
    # не принимает грузы. Оба кружка сначала были ошибочно приняты за украшение
    # карты: вывод был сделан по внешнему виду, без сверки с уже имеющимися
    # источниками. PM подтвердил 2026-07-26, что «9¾» и «3,14 (π)» — полустанки.
    #
    # Это подтверждается и самой картой: в её легенде «Грузы по терминалам»
    # перечислены ровно номера 1–23, и ни «9¾», ни «3,14» там нет, то есть
    # грузов они не принимают и терминалами не являются.
    decorative_sorted = sorted(
        decorative_icons,
        key=_sort_key_by_bbox,
    )
    decorative_records = []
    for index, fill in enumerate(decorative_sorted, start=1):
        geometry = fill["geometry"]
        centroid = geometry.centroid
        rounded_center = (round(centroid.x, 1), round(centroid.y, 1))
        label = None
        for candidate_center, candidate_label in DECORATIVE_MARKER_LABELS_BY_ROUNDED_CENTER.items():
            if math.hypot(
                rounded_center[0] - candidate_center[0],
                rounded_center[1] - candidate_center[1],
            ) <= DECORATIVE_MARKER_LABEL_MATCH_TOLERANCE_PX:
                label = candidate_label
                break
        if label is None:
            _fail(
                "декоративный значок не сопоставился ни с одной ранее "
                f"визуально прочитанной подписью (центр {rounded_center}); "
                "нужна новая визуальная проверка человеком"
            )
        bounds = _bounds_json(geometry)
        decorative_records.append(
            {
                "id": f"waypoint-{index:04d}",
                "center": _round_point((centroid.x, centroid.y)),
                "bounds": bounds,
                "widthPx": _round(bounds["maxX"] - bounds["minX"]),
                "heightPx": _round(bounds["maxY"] - bounds["minY"]),
                "areaPx2": _round(geometry.area),
                "colorCmyk": list(fill["color_values"]),
                "label": label,
                "labelSource": (
                    "визуальное прочтение вырезки из "
                    "draft/trains/Игровая Карта.png внешним агентом; "
                    "не программное распознавание текста"
                ),
                "kind": "waypoint",
                "interpretation": (
                    "полустанок: промежуточная остановка на дороге, которая, в "
                    "отличие от терминала, не принимает грузы. Нарисован "
                    "гладким кружком без зубчатого обода и без отверстия, чем "
                    "и отличается от значка терминала"
                ),
                "cargoAccepted": False,
                "evidence": (
                    "легенда авторской карты «Грузы по терминалам» перечисляет "
                    "ровно номера 1–23, в которые эти два значка не входят"
                ),
                "reviewStatus": "confirmed",
                "confirmationStatus": "confirmed-by-pm",
                "confirmedAt": "2026-07-26",
            }
        )

    # --- summary ---
    summary = {
        "countryCount": len(country_records),
        "stationCount": len(station_records),
        "waypointCount": len(decorative_records),
        "backgroundFillAreaPx2": _round(background["geometry"].area),
        "totalCountryAreaPx2": _round(total_country_area_px2),
        "canonicalCanvasAreaPx2": CANONICAL_WIDTH * CANONICAL_HEIGHT,
        "countryAreaShareOfCanvas": _round(
            total_country_area_px2 / (CANONICAL_WIDTH * CANONICAL_HEIGHT)
        ),
        "countryBoundaryOverlap": {
            "note": (
                "известная остаточная величина: соседние страны рисовались "
                "как отдельные независимые контуры, поэтому их общие границы "
                "слегка не совпадают геометрически (доли пикселя на "
                "изгибах кривых). Площадь пренебрежимо мала относительно "
                "площади стран."
            ),
            "totalOverlapAreaPx2": _round(total_overlap_px2),
            "overlapRatioOfTotalCountryArea": _round(overlap_ratio),
            "pairs": overlap_pairs,
        },
        "gearIconToStationCrosscheck": {
            "method": (
                "23 значка-шестерёнки станционного цвета отобраны из "
                "геометрии .ai по цвету CMYK и форме (2 подпути — внешний "
                "зубчатый контур + внутренняя дырка), их центроиды "
                "сопоставлены методом ближайшего соседа с 23 station-icon "
                "из этого же файла (которые, в свою очередь, взяты из "
                "terminalCandidates принятого отчёта)."
            ),
            "matchedPairCount": len(crosscheck),
            "maxResidualPx": _round(max_crosscheck_residual_px),
            "acceptanceThresholdPxForReference": review["calibration"].get(
                "acceptanceThresholdPx"
            ),
            "pairs": crosscheck,
        },
    }

    return {
        "schemaVersion": "1.0.0",
        "status": "draft",
        "publishable": False,
        "warning": (
            "Непубликуемый черновой артефакт. Названия стран и номера "
            "станций намеренно НЕ проставлены — это должен сделать "
            "человек. Файл не подключён к игровому манифесту и не "
            "используется средой исполнения. Список waypoints "
            "'reviewStatus: proposed' / 'confirmationStatus: unconfirmed' "
            "содержит два полустанка ('9¾' и '3,14 (π)'), подтверждённых PM 2026-07-26."
            "окончательного подтверждения человеком."
        ),
        "provenance": {
            "sourceAiFile": AI_PATH,
            "sourceAiSha256": actual_sha256,
            "sourceContentStreamBytes": len(stream),
            "stationSourceReviewJson": REVIEW_JSON_PATH,
            "pdfToCanonical": PDF_TO_CANONICAL,
            "flattenTolerancePx": FLATTEN_TOLERANCE_PX,
            "generatedBy": os.path.relpath(__file__, "/home/abc/projects/Cubica-AI"),
        },
        "summary": summary,
        "countries": country_records,
        "stations": station_records,
        "waypoints": decorative_records,
    }


def main() -> None:
    result = build_result()
    # Ключи сортируются по алфавиту и разделители фиксированы — это часть
    # требования детерминированности (побайтово одинаковый результат при
    # повторном запуске).
    serialized = json.dumps(
        result,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
    )
    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as fh:
        fh.write(serialized)
        fh.write("\n")

    print(f"Записано: {OUTPUT_JSON_PATH}")
    print(f"Стран: {result['summary']['countryCount']}")
    print(f"Станций: {result['summary']['stationCount']}")
    print(f"Полустанков: {result['summary']['waypointCount']}")


if __name__ == "__main__":
    main()
