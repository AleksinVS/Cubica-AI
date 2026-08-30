"""Узкие проверки разбиения карты «Карты, деньги, поезда» на области.

Зачем нужен этот файл
---------------------
`cmt_region_partition.py` строит крупный (около 6 МБ, почти тысяча областей)
черновик разбиения карты. Пересобирать его целиком в каждой проверке дорого
(около 20 секунд), поэтому этот файл, как и соседний
`test_vector_map_polygonizer.py`, делит доказательства на две дешёвые группы:

* **проверки чистых функций** модуля на маленьких придуманных фигурах —
  никакой карты, никакого чтения файлов, доли секунды на весь набор;
* **проверки уже записанного артефакта** — файл читается один раз (без
  пересборки) и сверяется сам с собой: совпадают ли отпечатки геометрии
  (теперь уже включая внутренние кольца — дыры), сходится ли число
  «предположительных» соединений и убранных ничтожных отверстий с реестром
  сомнений, совпадают ли отпечатки исходных отчётов с файлами на диске.

Ни одна проверка здесь не содержит игровых правил «Карт, денег, поездов» —
только геометрические свойства, общие для любой карты, разбитой этим же
способом.
"""

from __future__ import annotations

import hashlib
import json
import random
import unittest
from pathlib import Path

from shapely import unary_union
from shapely.geometry import Point, Polygon, box

# Чистые функции модуля, о повторяемости которых просит задание. Модуль лежит
# рядом с этим файлом, поэтому обычный импорт по имени пакета работает при
# запуске из каталога tools/ (так же, как соседний test_vector_map_polygonizer.py
# импортирует vector_map_polygonizer). MICRO_AREA_PX2 — тот же порог ничтожного
# отверстия, что использует drop_micro_holes(); проверка сверяет по нему
# реальный артефакт, а не хранит собственную копию числа 25.0.
from cmt_region_partition import (
    MICRO_AREA_PX2,
    build_region_adjacency,
    collapse_slivers,
    connected_components,
    drop_micro_holes,
    effective_width,
    foreign_area_after_merge,
    stable_region_order,
)

# geometry_fingerprint нужен отдельно, чтобы пересчитать отпечаток области из
# уже записанных координат exteriorRing и сравнить его с сохранённым значением
# geometryFingerprint — это и есть дешёвая проверка повторяемости на уже
# собранном артефакте, без запуска всего конвейера заново.
from vector_map_polygonizer import geometry_fingerprint

# Каталог annotations/ и оба файла: сам черновик и три отчёта, из которых
# он собран (их отпечатки записаны в provenance черновика).
ANNOTATIONS_DIR = Path(__file__).resolve().parent.parent / "annotations"
DRAFT_PATH = ANNOTATIONS_DIR / "vector-map.region-partition.draft.json"


def _sha256_plain(path: Path) -> str:
    """sha256 файла в чистом hex, без префикса — так хранится provenance.source."""

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha256_with_prefix(path: Path) -> str:
    """sha256 файла с префиксом "sha256:" — так его печатает file_digest()."""

    return "sha256:" + _sha256_plain(path)


class RegionPartitionDraftFacts(unittest.TestCase):
    """Проверки уже записанного артефакта: файл читается один раз на весь класс.

    Пересборка артефакта здесь не выполняется ни разу — это было бы тем самым
    дорогим 20-секундным прогоном, которого просит избежать задание. Вместо
    этого класс один раз читает уже существующий файл с диска и дальше только
    анализирует то, что в нём уже записано.
    """

    draft: dict

    @classmethod
    def setUpClass(cls) -> None:
        if not DRAFT_PATH.exists():
            raise unittest.SkipTest(
                f"черновик не найден: {DRAFT_PATH}; сначала запустите "
                "cmt_region_partition.py"
            )
        cls.draft = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))

    def test_publishable_is_false_and_status_is_draft_review_only(self) -> None:
        """Сохранение publishable: false.

        Это самое важное ограничение всего артефакта: пока смысловое
        подтверждение областей не выполнено человеком, ни один флаг не должен
        разрешать публикацию. Значение сравнивается через `assertIs`, а не
        `assertFalse`, чтобы отличить булево `False` от «пусто»/`None`, которые
        `assertFalse` тоже пропустил бы.
        """

        self.assertIs(self.draft["publishable"], False)
        self.assertEqual(self.draft["status"], "draft-review-only")

    def test_no_join_is_an_unlabeled_invented_connection(self) -> None:
        """Отсутствие непомеченных придуманных соединений.

        У каждого соединения в `joins` обязан быть класс `joinClass`. Но
        одного наличия поля недостаточно: нужно доказать, что предположения
        (`narrow-gap` — соединение по узкому зазору, а не по факту перекрытия
        краски) не потерялись и не были придуманы задним числом. Поэтому число
        соединений класса `narrow-gap` обязано в точности совпасть с числом
        записей `assumed-connection` в реестре сомнений: реестр — это ровно
        список тех соединений, которые являются предположением, а не фактом.
        """

        joins = self.draft["joins"]
        self.assertTrue(joins, "в черновике не должно быть пустого списка соединений")
        for join in joins:
            self.assertIn(
                join["joinClass"],
                ("ink-overlap", "narrow-gap"),
                f"соединение {join['candidateId']} -> {join['targetCandidateId']} "
                f"имеет непредусмотренный класс {join['joinClass']!r}",
            )

        narrow_gap_joins = [j for j in joins if j["joinClass"] == "narrow-gap"]
        assumed_connection_doubts = [
            d for d in self.draft["doubts"] if d["kind"] == "assumed-connection"
        ]
        self.assertEqual(
            len(narrow_gap_joins),
            len(assumed_connection_doubts),
            "число соединений narrow-gap обязано совпадать с числом записей "
            "assumed-connection в реестре сомнений — иначе часть предположений "
            "осталась бы непомеченной",
        )

        # Сводка тоже обязана согласовываться с фактическим содержимым массивов:
        # иначе сводка могла бы молча разойтись с самими данными.
        summary = self.draft["summary"]
        self.assertEqual(summary["narrowGapJoinCount"], len(narrow_gap_joins))
        self.assertEqual(summary["joinCount"], len(joins))
        self.assertEqual(summary["doubtCount"], len(self.draft["doubts"]))
        self.assertEqual(summary["regionCount"], len(self.draft["regions"]))
        self.assertEqual(
            summary["collapsedSliverCount"], len(self.draft["collapsedSlivers"])
        )

    def test_no_region_keeps_a_micro_hole_and_removed_holes_are_fully_tracked(
        self,
    ) -> None:
        """Правило удаления ничтожных отверстий соблюдено, и ничего не потерялось.

        `drop_micro_holes()` обязана убрать из области любое внутреннее кольцо
        площадью меньше `MICRO_AREA_PX2` (числовой мусор от наложения почти
        совпавших линий, а не анклав) и оставить как есть кольцо побольше
        (возможный анклав, решение о котором принимает человек). Здесь
        проверяется видимый снаружи результат этого правила на уже записанном
        артефакте:

        1. ни у одной области не осталось внутреннего кольца площадью меньше
           порога — иначе правило было бы нарушено уже после сборки;
        2. число убранных отверстий одинаково в трёх независимых местах
           артефакта (`removedMicroHoles`, `summary.removedMicroHoleCount` и
           записи `doubts[].kind == "removed-micro-hole"`) — ни одно убранное
           отверстие не должно быть учтено дважды или потеряно.
        """

        for record in self.draft["regions"]:
            for interior_ring in record["interiorRings"]:
                hole_area = Polygon(interior_ring).area
                self.assertGreaterEqual(
                    hole_area,
                    MICRO_AREA_PX2,
                    f"область {record['id']} сохранила внутреннее кольцо площадью "
                    f"{hole_area}, хотя порог ничтожного отверстия "
                    f"{MICRO_AREA_PX2} — такое кольцо обязано быть убрано "
                    "drop_micro_holes() и попасть в removedMicroHoles",
                )

        removed_micro_holes = self.draft["removedMicroHoles"]
        removed_micro_hole_doubts = [
            d for d in self.draft["doubts"] if d["kind"] == "removed-micro-hole"
        ]
        self.assertEqual(
            len(removed_micro_holes),
            len(removed_micro_hole_doubts),
            "число записей removedMicroHoles обязано совпадать с числом "
            "записей removed-micro-hole в реестре сомнений",
        )
        self.assertEqual(
            self.draft["summary"]["removedMicroHoleCount"], len(removed_micro_holes)
        )
        for removed in removed_micro_holes:
            self.assertLess(
                removed["areaPx2"],
                MICRO_AREA_PX2,
                "запись removedMicroHoles обязана описывать именно ничтожное "
                "отверстие — площадь строго меньше порога",
            )

    def test_recorded_regions_reproduce_their_own_geometry_fingerprint(self) -> None:
        """Повторяемость отпечатков уже записанного артефакта — без исключений.

        Полный пересчёт всей карты здесь не нужен: у каждой области уже
        сохранены её собственный отпечаток (`geometryFingerprint`), площадь
        (`areaPx2`), внешний контур (`exteriorRing`) и внутренние кольца-дыры
        (`interiorRings`). Если восстановить многоугольник из внешнего контура
        И внутренних колец вместе и посчитать отпечаток заново, он обязан
        совпасть с записанным, а площадь — совпасть с точностью до округления:
        `geometry_fingerprint()` округляет координаты ровно до тех же шести
        знаков, что уже сохранены в JSON, поэтому повторный расчёт из
        собственных данных детерминирован.

        РАНЕЕ НАЙДЕННЫЙ ДЕФЕКТ (сообщён основному агенту и исправлен им, не
        этим набором проверок): до появления поля `interiorRings` у двух из
        918 областей отпечаток и площадь не совпадали при пересчёте только по
        `exteriorRing`, потому что дыры учитывались в отпечатке/площади, но не
        сохранялись в контуре. Теперь, когда `interiorRings` сохраняет и
        сохранившиеся (не ничтожные) дыры, никаких исключений быть не должно —
        проверка требует точного совпадения у всех областей без допуска.
        """

        regions = self.draft["regions"]
        mismatched: list[tuple[str, str]] = []
        for record in regions:
            polygon = Polygon(record["exteriorRing"], record["interiorRings"])
            recomputed_fingerprint = geometry_fingerprint(polygon)
            if recomputed_fingerprint != record["geometryFingerprint"]:
                mismatched.append((record["id"], "geometryFingerprint"))
                continue
            # Отпечаток совпал — площадь обязана совпасть тоже. Допуск взят не
            # в шесть знаков (как округление самих координат), а в одну
            # тысячную точки в квадрате: столько шума вносит пересчёт площади
            # по формуле шнурования из уже округлённых координат, и это на
            # порядки меньше площади любой настоящей дыры или ошибки.
            self.assertAlmostEqual(
                polygon.area,
                record["areaPx2"],
                delta=1e-3,
                msg=f"область {record['id']}: площадь из exteriorRing+interiorRings "
                "разошлась с areaPx2, хотя отпечаток совпал",
            )

        self.assertEqual(
            mismatched,
            [],
            "область(и) не воспроизводят свой отпечаток по exteriorRing+"
            f"interiorRings (сверка уже записанного файла, без пересборки): {mismatched}",
        )

    def test_stable_region_ids_are_sorted_and_pattern_correct(self) -> None:
        """Идентификаторы областей и сомнений соответствуют образцу и порядку.

        `stable_region_order()` гарантирует устойчивый порядок при сборке;
        здесь проверяется его видимый снаружи результат — номера в уже
        записанном файле идут по возрастанию без пропусков и разрывов формата.
        """

        region_ids = [record["id"] for record in self.draft["regions"]]
        self.assertEqual(region_ids, sorted(region_ids))
        for index, region_id in enumerate(region_ids, start=1):
            self.assertEqual(region_id, f"map-region-{index:04d}")

        doubt_ids = [doubt["id"] for doubt in self.draft["doubts"]]
        for index, doubt_id in enumerate(doubt_ids, start=1):
            self.assertEqual(doubt_id, f"doubt-{index:04d}")

    def test_every_region_belongs_to_a_country_from_the_catalog(self) -> None:
        """Принадлежность стране проставлена и согласована с каталогом стран.

        Связь «заливка карты -> страна игры» устанавливается при извлечении
        стран и проверяется там же по преобладанию голосов. Здесь проверяется
        её видимый снаружи результат: у каждой области стоит страна из каталога
        вместе с её названием, пара «идентификатор — название» всюду одна и та
        же, а область без страны допускается только одна — непроходимый массив
        в центре карты, который не принадлежит ни одной стране.
        """

        countries = json.loads(
            (ANNOTATIONS_DIR / "vector-map.countries-stations.draft.json").read_text(
                encoding="utf-8"
            )
        )
        catalog = {
            country["gameCountryId"]: country["name"]
            for country in countries["countries"]
        }
        self.assertEqual(len(catalog), 10, "ожидается ровно десять стран")

        without_country = []
        for region in self.draft["regions"]:
            country_id = region["countryId"]
            if country_id is None:
                # Название обязано отсутствовать вместе с идентификатором:
                # область не может быть безымянной и одновременно названной.
                self.assertIsNone(region["countryName"], region["id"])
                without_country.append(region["id"])
                continue
            self.assertIn(country_id, catalog, region["id"])
            self.assertEqual(region["countryName"], catalog[country_id], region["id"])

        self.assertEqual(
            without_country,
            [],
            "у каждой игровой области обязана быть страна: участки вне стран — "
            "это пустые пространства, и они вынесены в emptySpaces",
        )

        # Каждая страна каталога получила хотя бы одну область: страна без
        # территории означала бы, что связь установлена неверно.
        used = {region["countryId"] for region in self.draft["regions"]} - {None}
        self.assertEqual(used, set(catalog), "не у всех стран каталога есть области")

    def test_region_adjacency_graph_is_a_single_connected_component(self) -> None:
        """Новый критерий приёмки: граф соседства областей связен.

        Дороги в этой игре строятся между соседними областями, поэтому
        маршрут между двумя терминалами — это цепочка соседств. Если граф
        соседства (области — вершины, ребро — общая граница положительной
        длины) распадается на несколько частей, между областями из разных
        частей маршрута не существует вообще, и построить дорогу между ними
        нельзя ни при каком количестве денег — именно так была устроена карта
        до исправления пустот в разбиении (шесть частей по границам стран).

        Проверка здесь не пересобирает карту — она восстанавливает каждую
        область из уже записанных `exteriorRing`/`interiorRings` (как и
        `test_recorded_regions_reproduce_their_own_geometry_fingerprint` выше)
        и строит граф соседства заново тем же кодом, что использует
        cmt_region_partition.py, — независимая проверка уже записанного
        артефакта, а не просто доверие числу из summary.
        """

        polygons = [
            Polygon(record["exteriorRing"], record["interiorRings"])
            for record in self.draft["regions"]
        ]
        neighbors = build_region_adjacency(polygons)
        components = connected_components(neighbors)

        self.assertEqual(
            len(components),
            1,
            "граф соседства областей обязан быть одной связной частью — иначе "
            "маршрут между областями из разных частей не существует",
        )
        self.assertEqual(
            len(components[0]),
            len(polygons),
            "единственная связная часть обязана охватывать все области без исключения",
        )

        # Пересчитанные числа обязаны совпасть с тем, что записано в summary:
        # иначе сводка молча разошлась бы с фактическим содержимым черновика.
        #
        # Сверяться нужно с ПОСЛЕ-хирургическими полями, а не с базовыми:
        # `connectedComponentCount`/`largestConnectedComponentSize` описывают
        # разбиение ДО вырезания непроходимой местности (917 областей), а
        # `regions` черновика — уже после него (982). Сверка с базовыми полями
        # сравнивала бы два разных множества областей и падала бы не на
        # дефекте, а на собственной путанице.
        summary = self.draft["summary"]
        self.assertEqual(
            summary["connectedComponentCountAfterTerrainSurgery"], len(components)
        )
        self.assertEqual(
            summary["largestConnectedComponentSizeAfterTerrainSurgery"],
            len(components[0]),
        )

        recomputed_cross_country_edges = 0
        regions = self.draft["regions"]
        for index, neighbor_set in enumerate(neighbors):
            for neighbor in neighbor_set:
                if neighbor <= index:
                    continue
                if regions[index]["countryId"] != regions[neighbor]["countryId"]:
                    recomputed_cross_country_edges += 1
        # Опять же ПОСЛЕ-хирургическое поле: `crossCountryAdjacencyCount`
        # описывает базовое разбиение, а пересчёт выше идёт по итоговым
        # областям черновика.
        self.assertEqual(
            summary["crossCountryAdjacencyCountAfterTerrainSurgery"],
            recomputed_cross_country_edges,
        )
        self.assertGreater(
            recomputed_cross_country_edges,
            0,
            "при единственной связной части обязан быть хотя бы один переход "
            "между областями разных стран — иначе страны не соединены друг с другом",
        )

    def test_empty_spaces_are_listed_and_lie_outside_every_country(self) -> None:
        """Пустые пространства перечислены отдельно и не попали в области.

        Пустое пространство — вода или иная незанятая площадь вне страновых
        заливок. Игровой территорией оно не является, поэтому не должно быть
        среди областей; но и исчезать молча не должно, поэтому перечисляется
        явно. Здесь проверяется и то и другое.
        """

        spaces = self.draft["emptySpaces"]
        self.assertEqual(len(spaces), self.draft["summary"]["emptySpaceCount"])
        self.assertGreater(len(spaces), 0, "пустые пространства на карте есть")

        countries = json.loads(
            (ANNOTATIONS_DIR / "vector-map.countries-stations.draft.json").read_text(
                encoding="utf-8"
            )
        )
        land = unary_union(
            [
                Polygon(ring)
                for country in countries["countries"]
                for ring in country["contour"]
            ]
        )

        region_points = [
            Point(
                region["representativePoint"]["x"],
                region["representativePoint"]["y"],
            )
            for region in self.draft["regions"]
        ]

        for space in spaces:
            polygon = Polygon(space["exteriorRing"])
            inside_share = polygon.intersection(land).area / polygon.area
            self.assertLessEqual(
                inside_share,
                0.5,
                f"{space['id']} обязано лежать вне страновых заливок",
            )
            # Ни одна область не должна оказаться внутри пустого пространства:
            # это означало бы, что вода попала в игровую территорию.
            for point in region_points:
                self.assertFalse(
                    polygon.covers(point),
                    f"область внутри {space['id']}: пустое пространство стало областью",
                )

    def test_provenance_digests_match_files_on_disk(self) -> None:
        """Происхождение: отпечатки в provenance совпадают с файлами на диске.

        Схема JSON Schema проверяет только форму строки отпечатка
        ("sha256:" + 64 hex-знака), но не читает файловую систему. Эта
        проверка перечитывает авторский .ai-первоисточник и три отчёта, из
        которых собран черновик, и сверяет их фактический sha256 с тем, что
        записано в provenance. Расхождение означало бы, что черновик собран не
        из тех файлов, что сейчас лежат в репозитории (устарел или источник
        подменили).
        """

        provenance = self.draft["provenance"]

        repo_root = ANNOTATIONS_DIR.parent.parent.parent
        source_path = (ANNOTATIONS_DIR / provenance["source"]["file"]).resolve()
        self.assertTrue(
            str(source_path).startswith(str(repo_root)),
            "provenance.source.file обязан указывать внутрь репозитория",
        )
        if source_path.exists():
            self.assertEqual(
                _sha256_plain(source_path),
                provenance["source"]["sha256"],
                "отпечаток авторского .ai-первоисточника разошёлся с файлом на диске",
            )

        for field, file_name in (
            ("rawReview", "vector-map.review.json"),
            ("classification", "vector-map.classification.review.json"),
            ("countriesStations", "vector-map.countries-stations.draft.json"),
        ):
            report_path = ANNOTATIONS_DIR / file_name
            if not report_path.exists():
                self.fail(f"исходный отчёт не найден на диске: {report_path}")
            self.assertEqual(
                _sha256_with_prefix(report_path),
                provenance[field]["sha256"],
                f"отпечаток provenance.{field} разошёлся с файлом {file_name} на диске",
            )


class PureFunctionTests(unittest.TestCase):
    """Проверки чистых функций модуля на маленьких придуманных фигурах.

    Здесь нет ни одной операции над реальной картой: только несколько
    прямоугольников, которых достаточно, чтобы независимо от карты доказать
    математическое свойство функции.
    """

    def test_effective_width_of_long_thin_strip_equals_its_width(self) -> None:
        """Для длинной узкой полосы effective_width() близка к её ширине.

        Формула — это удвоенная площадь, делённая на периметр. Для полосы
        длиной много больше ширины эта величина стремится к ширине: у длинной
        стороны вклад в периметр велик, а вклад коротких торцов в площадь и
        периметр пренебрежимо мал. Проверяется прямоугольник 10000×5 точек —
        отношение длины к ширине 2000:1, чего достаточно для точности лучше
        одной тысячной доли ширины.
        """

        width = 5.0
        strip = box(0.0, 0.0, 10000.0, width)
        self.assertAlmostEqual(effective_width(strip), width, places=2)

        # Контрольный случай: у квадрата со стороной s площадь s^2, периметр 4s,
        # поэтому 2*площадь/периметр = s/2 — ровно половина стороны, а не сама
        # сторона (в отличие от длинной полосы, где эта величина стремится к
        # полной ширине, а не к половине).
        square = box(0.0, 0.0, 20.0, 20.0)
        self.assertAlmostEqual(effective_width(square), 10.0, places=6)

        # Вырожденный случай (нулевой периметр) не должен приводить к делению
        # на ноль — функция обязана вернуть 0.0, а не бросить исключение.
        self.assertEqual(effective_width(Polygon()), 0.0)

    def test_collapse_slivers_merges_narrow_neighbor_and_preserves_total_area(
        self,
    ) -> None:
        """Правило схлопывания щелей не теряет территорию.

        Собираются две смежные фигуры: широкий «настоящий» участок и узкая
        полоса-щель вдоль одной из его сторон, действующая ширина которой ниже
        порога. После `collapse_slivers()` щель обязана присоединиться к
        соседу (у них общая длинная граница), а суммарная площадь всех
        оставшихся фигур обязана в точности совпасть с суммой площадей до
        схлопывания — щель не должна ни исчезнуть бесследно, ни задвоиться.
        """

        real_region = box(0.0, 0.0, 100.0, 100.0)
        # Ширина щели (2 точки) заведомо меньше порога (5 точек), а общая
        # граница со «настоящим» участком — вся сторона длиной 100 точек.
        sliver = box(100.0, 0.0, 102.0, 100.0)
        self.assertLess(effective_width(sliver), 5.0)
        self.assertGreaterEqual(effective_width(real_region), 5.0)

        total_area_before = real_region.area + sliver.area

        kept, collapsed_records = collapse_slivers(
            [real_region, sliver], min_width=5.0
        )

        self.assertEqual(len(collapsed_records), 1)
        self.assertTrue(collapsed_records[0]["merged"])
        self.assertEqual(
            sum(region.area for region in kept),
            total_area_before,
            "суммарная площадь после схлопывания щели обязана совпадать с "
            "площадью до него — щель присоединяется, а не исчезает",
        )

        # Щель, у которой рядом нет ни одного «настоящего» соседа, обязана
        # остаться самостоятельной записью — территория не должна потеряться
        # даже тогда, когда присоединить её не к чему.
        lonely_sliver = box(1000.0, 1000.0, 1002.0, 1100.0)
        kept_lonely, collapsed_lonely = collapse_slivers([lonely_sliver], min_width=5.0)
        self.assertEqual(len(kept_lonely), 1)
        self.assertFalse(collapsed_lonely[0]["merged"])
        self.assertEqual(kept_lonely[0].area, lonely_sliver.area)

    def test_drop_micro_holes_removes_only_holes_below_threshold(self) -> None:
        """`drop_micro_holes()` убирает только заведомо ничтожные отверстия.

        Придуманный многоугольник со стороной 100 получает два внутренних
        кольца: маленькое (площадь 9, заведомо меньше порога) и большое
        (площадь 100, заведомо больше). После вызова функции:

        * маленькое кольцо обязано исчезнуть из геометрии и появиться в
          списке убранных отверстий с правильной площадью;
        * большое кольцо обязано остаться как есть — это уже не «мусор», а
          возможный анклав, и функция не имеет права решать за человека;
        * площадь фигуры обязана вырасти ровно на площадь убранного маленького
          отверстия: дыра, которую перестали вычитать, увеличивает площадь на
          свою величину, не больше и не меньше.
        """

        outer = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0), (0.0, 0.0)]
        # Площадь 3*3 = 9 точек в квадрате — заведомо меньше порога MICRO_AREA_PX2.
        small_hole = [(10.0, 10.0), (13.0, 10.0), (13.0, 13.0), (10.0, 13.0), (10.0, 10.0)]
        # Площадь 10*10 = 100 точек в квадрате — заведомо больше порога.
        big_hole = [(50.0, 50.0), (60.0, 50.0), (60.0, 60.0), (50.0, 60.0), (50.0, 50.0)]

        polygon = Polygon(outer, [small_hole, big_hole])
        area_before = polygon.area

        cleaned, removed = drop_micro_holes([polygon], min_area=MICRO_AREA_PX2)

        self.assertEqual(len(cleaned), 1)
        self.assertEqual(
            len(cleaned[0].interiors),
            1,
            "большое кольцо (возможный анклав) обязано остаться в геометрии",
        )
        self.assertAlmostEqual(
            Polygon(cleaned[0].interiors[0]).area, 100.0, places=6
        )

        self.assertEqual(len(removed), 1)
        self.assertAlmostEqual(removed[0]["areaPx2"], 9.0, places=6)

        self.assertAlmostEqual(
            cleaned[0].area,
            area_before + 9.0,
            places=6,
            msg="площадь обязана вырасти ровно на площадь убранного отверстия",
        )

    def test_foreign_area_after_merge_tests_the_claim_directly(self) -> None:
        """`foreign_area_after_merge()` проверяет само утверждение, а не его признак.

        Два более ранних признака (доля перекрытия щели с заливкой, затем
        расстояние до заливки) оба проверяли не саму претензию «государственная
        граница сдвинулась», а её приближение, и оба на этом ошибались:
        измерение по авторской карте показало, что признак «расстояние»
        по-прежнему помечал 280 из 1039 щелей как сдвиг границы, хотя вся их
        площадь лежала внутри собственной страны той области, к которой они
        присоединились, — никакая чужая территория не переходила. Прямая
        проверка пересечения реальной геометрии щели с реальной геометрией
        чужой заливки такой ошибки не допускает: либо чужая площадь есть,
        либо её нет. Четыре сценария проверяют по отдельности стороны этого
        различия.
        """

        country_a = box(0.0, 0.0, 100.0, 100.0)
        country_b = box(100.0, 0.0, 200.0, 100.0)
        named_countries = [
            ("country-a", "Страна A", country_a),
            ("country-b", "Страна B", country_b),
        ]

        # Сценарий 1: щель целиком внутри страны A, присоединилась к области
        # страны A (own_country_id == "country-a"). Чужой территории здесь
        # нет вообще, поэтому итог обязан быть ровно 0.0, а не малым, но
        # положительным числом, — это и есть случай, который признак
        # «расстояние» путал со сдвигом границы, если по соседству случайно
        # оказывалась другая страна.
        inside_sliver = box(40.0, 40.0, 42.0, 60.0)
        self.assertEqual(
            foreign_area_after_merge(inside_sliver, "country-a", named_countries),
            0.0,
            "щель целиком внутри своей страны не отдаёт никому чужую территорию",
        )

        # Сценарий 2: щель — непрокрашенная полоса ровно НА границе A и B,
        # присоединилась к области страны A. Половина щели (10×100 = 1000)
        # лежит на стороне B — эта половина фактически "перешла" стране A,
        # и foreign_area_after_merge() обязана вернуть именно её площадь,
        # точным числом, а не признаком присутствия.
        straddling_sliver = box(90.0, 0.0, 110.0, 100.0)
        expected_foreign_area = country_b.intersection(straddling_sliver).area
        self.assertAlmostEqual(expected_foreign_area, 1000.0, places=6)
        self.assertAlmostEqual(
            foreign_area_after_merge(straddling_sliver, "country-a", named_countries),
            expected_foreign_area,
            places=6,
            msg="ровно половина щели лежала на территории B — это и обязано "
            "быть возвращённой площадью, не больше и не меньше",
        )

        # Сценарий 3: щель целиком внутри страны B, но по каким-то причинам
        # (например, из-за самой длинной общей границы у sliverRule)
        # присоединилась к области страны A. Вся площадь щели тогда — чужая
        # территория: foreign_area_after_merge() обязана вернуть площадь щели
        # целиком, а не только её часть.
        fully_foreign_sliver = box(150.0, 0.0, 152.0, 100.0)
        self.assertTrue(country_b.contains(fully_foreign_sliver))
        self.assertAlmostEqual(
            foreign_area_after_merge(fully_foreign_sliver, "country-a", named_countries),
            fully_foreign_sliver.area,
            places=6,
            msg="щель целиком внутри чужой страны отдаёт ей всю свою площадь",
        )

        # Сценарий 4: область, в которую вошла щель, сама не привязана ни к
        # одной стране (own_country_id is None — на измеренной карте таких
        # регионов нет, но функция обязана остаться безопасной). Исключать
        # тогда нечего, и в сумму идёт пересечение со всеми странами.
        self.assertAlmostEqual(
            foreign_area_after_merge(straddling_sliver, None, named_countries),
            straddling_sliver.area,
            places=6,
            msg="без своей страны у щели нечего исключать из суммы — вся её "
            "площадь, попавшая в чью-то заливку, считается чужой",
        )

    def test_stable_region_order_is_independent_of_input_order(self) -> None:
        """Устойчивость нумерации: порядок не зависит от порядка на входе.

        `stable_region_order()` обязана сортировать области по их положению на
        карте (и отпечатку геометрии при полном совпадении положения), а не по
        тому, в каком порядке их вернула геометрическая библиотека. Поэтому
        один и тот же набор фигур, поданный в разном порядке, обязан дать один
        и тот же порядок на выходе — иначе номер области менялся бы от запуска
        к запуску без всякой пересборки геометрии.
        """

        regions = [
            box(0.0, 0.0, 10.0, 10.0),
            box(20.0, 0.0, 30.0, 10.0),
            box(0.0, 20.0, 10.0, 30.0),
            box(50.0, 50.0, 60.0, 60.0),
        ]

        ordered_original = stable_region_order(regions)

        shuffled = regions[:]
        random.Random(20260726).shuffle(shuffled)
        self.assertNotEqual(
            [region.bounds for region in shuffled],
            [region.bounds for region in regions],
            "перемешанный список должен действительно отличаться порядком от исходного",
        )
        ordered_shuffled = stable_region_order(shuffled)

        self.assertEqual(
            [region.bounds for region in ordered_original],
            [region.bounds for region in ordered_shuffled],
            "порядок областей обязан не зависеть от порядка на входе",
        )


if __name__ == "__main__":
    unittest.main()
