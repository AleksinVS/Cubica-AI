# Дизайн игры «Магнат железных дорог» (`rail-tycoon-mini`)

Статус: Proposed (нормативная спецификация для агентной реализации)
Дата: 2026-07-06
Владелец трека: оркестратор задачи `TSK-20260706-rail-tycoon-mini-game`

Игра — аналог классической Sid Meier's Railroad Tycoon (1990): игрок строит
железнодорожные линии между городами, запускает поезда по маршрутам и
зарабатывает на перевозке грузов при меняющемся спросе. «Аналог» означает
жанровые механики в сильно уменьшенном объёме; никакие названия, тексты,
графика или данные оригинальной игры не используются.

Документ написан для исполнителя-агента (в том числе со слабой LLM): разделы
4–9 **нормативны** — все JSON, числа, формулы и сигнатуры приведены полностью
и копируются как есть. Если для реализации нужно поле, число или поведение,
которого здесь нет, — исполнитель НЕ придумывает его сам, а останавливает срез
и записывает вопрос в Handoff Log задачи (см. §11).

---

## Оглавление

- [1. Цели и границы](#1-цели-и-границы)
- [2. Соответствие оригиналу Railroad Tycoon](#2-соответствие-оригиналу-railroad-tycoon)
- [3. Платформенные зависимости (новых возможностей НЕ требуется)](#3-платформенные-зависимости-новых-возможностей-не-требуется)
- [4. Игровая механика и баланс (нормативно)](#4-игровая-механика-и-баланс-нормативно)
- [5. Game-манифест: контент и состояние (полные JSON)](#5-game-манифест-контент-и-состояние-полные-json)
- [6. Game-манифест: действия (полные JSON)](#6-game-манифест-действия-полные-json)
- [7. UI-манифест (нормативно)](#7-ui-манифест-нормативно)
- [8. Плагин и Phaser-сцена (нормативно)](#8-плагин-и-phaser-сцена-нормативно)
- [9. Тестирование и приёмочные числа](#9-тестирование-и-приёмочные-числа)
- [10. Решённые проектные вопросы](#10-решённые-проектные-вопросы)
- [11. Указания агенту-исполнителю](#11-указания-агенту-исполнителю)
- [12. Координация с другими треками](#12-координация-с-другими-треками)

---

## 1. Цели и границы

Цели:

1. Первая **экономическая** игра платформы с Phaser-визуализацией (канал
   ADR-062): карта, сеть линий, движущиеся поезда.
2. Доказательство, что игра такого класса выражается **только** манифестом и
   плагином — без единой строки game-specific кода в платформенных слоях
   (правило 10 `CLAUDE.md`) и без новых платформенных примитивов (§3).
3. Игра реализуется **целиком агентом** по этому документу.

Границы (жёсткие):

- Один игрок, одна сессия, режим `singleplayer` (как `simple-choice`).
- Ровно 5 игровых лет; фиксированная карта из 5 городов, 7 линий, 5 маршрутов.
- Сервер (runtime) — единственный вычислитель денег и итогов. Клиентская
  сцена — чистая визуализация, она не отправляет ни одного действия и не
  содержит игровой случайности (это строже границы честности MVP ADR-062 —
  клиенту в принципе нечего подделывать).

## 2. Соответствие оригиналу Railroad Tycoon

| Механика оригинала | В `rail-tycoon-mini` |
|---|---|
| Прокладка путей по карте | Покупка предопределённых линий (7 фиксированных отрезков между городами) |
| Покупка локомотивов и составов | «Запуск поезда» по маршруту: один поезд на маршрут, фиксированная цена |
| Грузы и спрос городов | 3 типа груза (уголь, зерно, лес); спрос каждого груза меняется каждый год броском `1d3` |
| Экономика и капитал | Касса (`money`): стартовый капитал, расходы на строительство/поезда, годовой доход, обслуживание поездов |
| Течение времени | 5 лет; каждый год: планирование → перевозки (анимация) → итоги |
| Звания/рейтинг | Ранг по итоговой кассе (4 порога, §4.5) |
| **Вне рамок** | Акции и биржа, ИИ-конкуренты, станции и здания, произвольная геометрия путей, расписания и сигналы, несколько поездов на маршрут, кредиты, тарифы, банкротство |

Всё из строки «Вне рамок» — сознательные не-цели этой игры; предлагать их
реализацию можно только записью в Handoff Log, не кодом.

## 3. Платформенные зависимости (новых возможностей НЕ требуется)

Ключевое архитектурное решение: игра собирается из **уже спроектированных**
возможностей. Новых эффектов, схемных конструкций, компонентов и ADR **не
нужно**. Любая потребность в новом платформенном примитиве в ходе реализации —
признак ошибки чтения этого документа: остановиться и эскалировать (§11).

| Возможность | Источник | Кто реализует | Статус на 2026-07-06 |
|---|---|---|---|
| guard-форма `jsonLogic` | схема манифеста | уже существует | готово |
| `metric.add`, `state.patch`, `timeline.set`, `log.append` | текущий движок (`simple-choice`) | уже существует | готово |
| `random.roll` (+ PRNG сессии) | ADR-058, `board-game-platform-design.md` §4.1 | трек `TSK-20260705-*`, Phase 1 | в работе |
| `metric.set` (число \| jsonLogic), поле `when` у эффектов | ADR-058, там же §4.5–4.6 | трек `TSK-20260705-*`, Phase 4 | в работе |
| Phaser-хост, `simulationSurface`, `phaserSceneFactory`, контракт сцены | ADR-062, `flow-simulation-platform-design.md` §4.0/§4.3/§4.4 | трек `TSK-20260706-flow-*`, Phase 3 | в работе |
| Канал игровых ассетов: реестр `assets.json` + CI-валидатор, раздача `/game-assets/*`, резолвер `context.assets` | ADR-063, `game-asset-channel-design.md` §3 | трек `TSK-20260706-game-asset-channel`, Phases 1–3 | planned |

**НЕ используются** (и не должны появиться в реализации): `paramsSchema`/`params`
(ADR-061), `random.seed`, `createSeededRandom`, колоды (`deck.*`), состояние «на
игрока», `turn.*`, `endConditions`, `metric.transfer`, `branch`. Обоснования —
в §10.

Обозначения ниже: «спрос(груз)» = `public.market.<груз>.total` — результат
годового броска `random.roll` (эффект пишет объект `{values, total, isDouble}`,
игра читает только `total`).

## 4. Игровая механика и баланс (нормативно)

### 4.1. Цикл года

Состояние фазы — `state.public.round.status` (строка):

```text
idle ──year.start──▶ planning ──year.run──▶ running ──year.commit──▶ done (год < 5)
 ▲                                                        │
 └───────────────────────year.start───────────────────────┘
                                              year.commit ──▶ finished (год = 5)
```

1. `year.start` — год +1, бросается спрос всех трёх грузов (`1d3` каждый),
   `revenueYear` обнуляется, фаза `planning`, экран `planning`.
2. На фазе `planning` игрок в любом порядке и количестве (пока хватает денег):
   строит линии (`build.s1`…`build.s7`) и запускает поезда
   (`launch.r1`…`launch.r5`).
3. `year.run` — фаза `running`, экран `running`: сцена анимирует поезда;
   игрок нажимает «Завершить год» когда захочет (анимация декоративна и на
   итог не влияет).
4. `year.commit` — runtime вычисляет доход и обслуживание (формулы §4.4),
   обновляет кассу; год < 5 → фаза `done`, экран `between`; год = 5 → фаза
   `finished`, экран `results`.

### 4.2. Константы баланса

Все числа — контракт приёмки; менять их реализация не имеет права
(предложения об «улучшении играбельности» — только в Handoff Log).

| Константа | Значение |
|---|---|
| Стартовый капитал | 1200 |
| Цена поезда (любой маршрут) | 400 |
| Обслуживание за поезд за год | 50 |
| Всего лет | 5 |
| Спрос каждого груза в год | бросок `1d3` (значение 1..3) |
| Скорость поезда в сцене | 120 px/с (только визуализация) |

Линии (отрезки между городами):

| id | Города | Цена |
|---|---|---|
| `s1` | Углеград — Центральск | 250 |
| `s2` | Зерновск — Центральск | 250 |
| `s3` | Центральск — Лесогорск | 300 |
| `s4` | Центральск — Портовск | 300 |
| `s5` | Углеград — Лесогорск | 200 |
| `s6` | Зерновск — Портовск | 200 |
| `s7` | Лесогорск — Портовск | 350 |

Маршруты (поезд возит один груз по построенным линиям):

| id | Название | Груз | Базовый доход | Требует линии |
|---|---|---|---|---|
| `r1` | Углеград → Центральск | уголь | 150 | `s1` |
| `r2` | Зерновск → Центральск | зерно | 150 | `s2` |
| `r3` | Лесогорск → Центральск | лес | 160 | `s3` |
| `r4` | Углеград → Портовск | уголь | 260 | `s5` И `s7` |
| `r5` | Зерновск → Портовск | зерно | 180 | `s6` |

### 4.3. Правила действий игрока

- Линию можно построить один раз; только на фазе `planning`; только при
  `money >= цена`.
- Поезд по маршруту запускается один раз (один поезд на маршрут); только на
  фазе `planning`; только когда ВСЕ линии маршрута построены; только при
  `money >= 400`.
- Недопустимое действие отклоняется guard-ом целиком, состояние не меняется
  (стандартная семантика платформы).

### 4.4. Формулы (нормативные)

Годовой доход (вычисляется runtime в `year.commit`, см. точный JsonLogic в §6):

```text
revenueYear = r1Active·150·спрос(coal)
            + r2Active·150·спрос(grain)
            + r3Active·160·спрос(timber)
            + r4Active·260·спрос(coal)
            + r5Active·180·спрос(grain)

money = money + revenueYear − 50·trains
```

где `rKActive` ∈ {0,1} — запущен ли поезд маршрута, `trains` — число
запущенных поездов, `спрос(x)` ∈ {1,2,3}.

Следствие (доказательство отсутствия банкротства): каждый активный маршрут
приносит минимум `база·1 ≥ 150 > 50`, поэтому `revenueYear − 50·trains ≥ 0` и
касса на `year.commit` не убывает. Отрицательный баланс в игре недостижим;
специальной обработки не требуется.

**Контрольный пример (эталон для тестов):** спрос coal=2, grain=3, timber=1;
активны `r1`, `r2`, `r5` (trains=3):
`revenueYear = 150·2 + 150·3 + 180·3 = 300 + 450 + 540 = 1290`;
обслуживание `3·50 = 150`; прирост кассы `+1140`.

### 4.5. Ранги (статические пороги)

Итог игры — касса после 5-го года. Пороги отображаются текстом на экране
результатов (ничего не вычисляется, см. §10 п.9):

| Касса | Ранг |
|---|---|
| ≥ 2700 | Магнат |
| ≥ 2100 | Директор дороги |
| ≥ 1500 | Начальник депо |
| < 1500 | Стажёр |

Проверка достижимости (математическое ожидание спроса = 2): стратегия
«год 1: `s1`+`s2`+поезд `r1`; год 2: поезд `r2`; год 3: `s6`+поезд `r5`;
год 4: `s3`+поезд `r3`» даёт ожидаемую итоговую кассу ≈ 2320 («Директор
дороги»); при удачном спросе достижим «Магнат». Баланс закрыт, не подбирать.

## 5. Game-манифест: контент и состояние (полные JSON)

Файл: `games/rail-tycoon-mini/game.manifest.json`. Секции `meta`, `config`,
`engine` — по образцу `games/simple-choice/game.manifest.json` со значениями:
`meta.id = "rail-tycoon-mini"`, `meta.name = "Магнат железных дорог"`,
`config.players = {"min": 1, "max": 1}`, `config.settings =
{"mode": "singleplayer", "locale": "ru-RU"}`; `meta.training`: format
`"single"`, duration 5–15 минут, компетенция `planning` («Планирование
инвестиций: игрок распределяет ограниченный капитал между вложениями с разной
отдачей»). Точные имена служебных полей действий (`handlerType`,
`capabilityFamily` и т.п.) сверяются с актуальной схемой манифеста; образец —
`simple-choice`. Секция `objectModels` — пустой объект `{}` (игра не использует
объектные коллекции; всё состояние — метрики и служебные ветки).

### 5.1. `content` (нормативный, копируется как есть)

```json
"content": {
  "data": {
    "settings": {
      "startMoney": 1200,
      "trainCost": 400,
      "maintenancePerTrain": 50,
      "yearsTotal": 5,
      "trainSpeedPxPerSec": 120
    },
    "cargoTypes": [
      { "id": "coal",   "name": "Уголь", "color": "#546e7a" },
      { "id": "grain",  "name": "Зерно", "color": "#f9a825" },
      { "id": "timber", "name": "Лес",   "color": "#6d4c41" }
    ],
    "cities": [
      { "id": "centralsk", "name": "Центральск", "x": 480, "y": 90 },
      { "id": "uglegrad",  "name": "Углеград",   "x": 140, "y": 180 },
      { "id": "zernovsk",  "name": "Зерновск",   "x": 820, "y": 200 },
      { "id": "lesogorsk", "name": "Лесогорск",  "x": 200, "y": 430 },
      { "id": "portovsk",  "name": "Портовск",   "x": 760, "y": 440 }
    ],
    "segments": [
      { "id": "s1", "cityA": "uglegrad",  "cityB": "centralsk", "cost": 250 },
      { "id": "s2", "cityA": "zernovsk",  "cityB": "centralsk", "cost": 250 },
      { "id": "s3", "cityA": "centralsk", "cityB": "lesogorsk", "cost": 300 },
      { "id": "s4", "cityA": "centralsk", "cityB": "portovsk",  "cost": 300 },
      { "id": "s5", "cityA": "uglegrad",  "cityB": "lesogorsk", "cost": 200 },
      { "id": "s6", "cityA": "zernovsk",  "cityB": "portovsk",  "cost": 200 },
      { "id": "s7", "cityA": "lesogorsk", "cityB": "portovsk",  "cost": 350 }
    ],
    "routes": [
      { "id": "r1", "name": "Углеград → Центральск", "cargoId": "coal",
        "baseRevenue": 150, "segmentIds": ["s1"],
        "cityPath": ["uglegrad", "centralsk"] },
      { "id": "r2", "name": "Зерновск → Центральск", "cargoId": "grain",
        "baseRevenue": 150, "segmentIds": ["s2"],
        "cityPath": ["zernovsk", "centralsk"] },
      { "id": "r3", "name": "Лесогорск → Центральск", "cargoId": "timber",
        "baseRevenue": 160, "segmentIds": ["s3"],
        "cityPath": ["lesogorsk", "centralsk"] },
      { "id": "r4", "name": "Углеград → Портовск", "cargoId": "coal",
        "baseRevenue": 260, "segmentIds": ["s5", "s7"],
        "cityPath": ["uglegrad", "lesogorsk", "portovsk"] },
      { "id": "r5", "name": "Зерновск → Портовск", "cargoId": "grain",
        "baseRevenue": 180, "segmentIds": ["s6"],
        "cityPath": ["zernovsk", "portovsk"] }
    ],
    "ranks": [
      { "minMoney": 2700, "title": "Магнат" },
      { "minMoney": 2100, "title": "Директор дороги" },
      { "minMoney": 1500, "title": "Начальник депо" },
      { "minMoney": 0,    "title": "Стажёр" }
    ]
  }
}
```

Семантика: `cityPath` — упорядоченный список городов маршрута для отрисовки
полилинии (ломаной) в сцене; он согласован с `segmentIds` вручную и является
источником истины для геометрии (сцена НЕ строит путь по графу сама).
Координаты городов — дизайн-поле сцены 960×540 (§8).

### 5.2. `state` (нормативный, копируется как есть)

```json
"state": {
  "public": {
    "timeline": { "line": "main", "stepIndex": 0, "step_index": 0,
                  "stageId": "stage_rail", "stage_id": "stage_rail",
                  "screenId": "intro", "screen_id": "intro",
                  "canAdvance": false },
    "metrics": {
      "money": 1200, "year": 0, "trains": 0, "revenueYear": 0,
      "s1Built": 0, "s2Built": 0, "s3Built": 0, "s4Built": 0,
      "s5Built": 0, "s6Built": 0, "s7Built": 0,
      "r1Active": 0, "r2Active": 0, "r3Active": 0,
      "r4Active": 0, "r5Active": 0
    },
    "round": { "status": "idle" },
    "market": {
      "coal":   { "values": [], "total": 0, "isDouble": false },
      "grain":  { "values": [], "total": 0, "isDouble": false },
      "timber": { "values": [], "total": 0, "isDouble": false }
    },
    "flags": { "cards": {} },
    "objects": {},
    "ui": {},
    "log": []
  },
  "secret": {}
}
```

Семантика метрик: `money` — касса; `year` — номер текущего года (0 до начала
игры, 1..5); `trains` — число запущенных поездов; `revenueYear` — доход
последнего завершённого года; `sNBuilt`/`rKActive` — флаги 0/1 (числовые
метрики; булевых метрик у движка нет). `round.status` — фаза цикла (§4.1);
поле `seed` конвенции `flow-simulation-platform-design.md` §4.6 не
используется (обоснование — §10 п.2). `market.*` — место записи `random.roll`
(инициализировано нулевой формой того же вида, что пишет эффект).

## 6. Game-манифест: действия (полные JSON)

Все 15 действий приведены полностью и копируются как есть. Изменять guard-ы,
эффекты и числа запрещено. Служебные поля каждого действия одинаковы:
`"handlerType": "manifest-data"`, `"capabilityFamily": "runtime.server"`,
`"capability": "rail-tycoon-mini.<id действия>"`.

Сквозные правила (нормативная семантика платформы):

- guard-форма `jsonLogic` вычисляется над контекстом данных, где ветка
  `public` — это `state.public` (обращения вида
  `{"var": "public.metrics.money"}`);
- эффекты применяются строго по порядку; `when` эффекта вычисляется над
  состоянием, уже изменённым предыдущими эффектами того же действия; отказ
  любого эффекта откатывает действие целиком;
- `metric.set` со `"scope": "session"` пишет в `public.metrics`; значение
  `{"jsonLogic": …}` вычисляет runtime (ADR-058 Phase 4).

### 6.1. `year.start`

```json
"year.start": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.year.start",
  "displayName": "Начать год",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "or": [
        { "==": [ { "var": "public.round.status" }, "idle" ] },
        { "==": [ { "var": "public.round.status" }, "done" ] } ] },
      { "<": [ { "var": "public.metrics.year" }, 5 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "year", "delta": 1 },
      { "op": "metric.set", "scope": "session", "metricId": "revenueYear", "value": 0 },
      { "op": "random.roll", "dice": "1d3", "storePath": "/public/market/coal" },
      { "op": "random.roll", "dice": "1d3", "storePath": "/public/market/grain" },
      { "op": "random.roll", "dice": "1d3", "storePath": "/public/market/timber" },
      { "op": "state.patch", "patches": [
        { "op": "replace", "path": "/public/round/status", "value": "planning" } ] },
      { "op": "timeline.set", "canAdvance": false, "stepIndex": 1, "screenId": "planning" },
      { "op": "log.append", "kind": "year-start", "entityType": "round",
        "displayMode": "summary", "summary": "Начался новый год: спрос на грузы обновлён.",
        "auditMetrics": false }
    ]
  }
}
```

### 6.2. Строительство линий: `build.s1` … `build.s7`

Семь действий, различаются только константами (id, название, цена, метрика).
Приведены все полностью.

```json
"build.s1": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s1",
  "displayName": "Построить линию Углеград — Центральск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s1Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 250 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -250 },
      { "op": "metric.set", "scope": "session", "metricId": "s1Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Углеград — Центральск.",
        "auditMetrics": true }
    ]
  }
},
"build.s2": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s2",
  "displayName": "Построить линию Зерновск — Центральск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s2Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 250 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -250 },
      { "op": "metric.set", "scope": "session", "metricId": "s2Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Зерновск — Центральск.",
        "auditMetrics": true }
    ]
  }
},
"build.s3": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s3",
  "displayName": "Построить линию Центральск — Лесогорск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s3Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 300 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -300 },
      { "op": "metric.set", "scope": "session", "metricId": "s3Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Центральск — Лесогорск.",
        "auditMetrics": true }
    ]
  }
},
"build.s4": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s4",
  "displayName": "Построить линию Центральск — Портовск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s4Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 300 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -300 },
      { "op": "metric.set", "scope": "session", "metricId": "s4Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Центральск — Портовск.",
        "auditMetrics": true }
    ]
  }
},
"build.s5": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s5",
  "displayName": "Построить линию Углеград — Лесогорск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s5Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 200 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -200 },
      { "op": "metric.set", "scope": "session", "metricId": "s5Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Углеград — Лесогорск.",
        "auditMetrics": true }
    ]
  }
},
"build.s6": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s6",
  "displayName": "Построить линию Зерновск — Портовск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s6Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 200 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -200 },
      { "op": "metric.set", "scope": "session", "metricId": "s6Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Зерновск — Портовск.",
        "auditMetrics": true }
    ]
  }
},
"build.s7": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.build.s7",
  "displayName": "Построить линию Лесогорск — Портовск",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.s7Built" }, 0 ] },
      { ">=": [ { "var": "public.metrics.money" }, 350 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -350 },
      { "op": "metric.set", "scope": "session", "metricId": "s7Built", "value": 1 },
      { "op": "log.append", "kind": "build", "entityType": "segment",
        "displayMode": "summary", "summary": "Построена линия Лесогорск — Портовск.",
        "auditMetrics": true }
    ]
  }
}
```

### 6.3. Запуск поездов: `launch.r1` … `launch.r5`

Пять действий; guard проверяет фазу, свободу маршрута, построенность ВСЕХ
линий маршрута и деньги. Приведены все полностью.

```json
"launch.r1": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.launch.r1",
  "displayName": "Запустить поезд: Углеград → Центральск (уголь)",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.r1Active" }, 0 ] },
      { "==": [ { "var": "public.metrics.s1Built" }, 1 ] },
      { ">=": [ { "var": "public.metrics.money" }, 400 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -400 },
      { "op": "metric.set", "scope": "session", "metricId": "r1Active", "value": 1 },
      { "op": "metric.add", "metricId": "trains", "delta": 1 },
      { "op": "log.append", "kind": "launch", "entityType": "route",
        "displayMode": "summary", "summary": "Запущен поезд Углеград → Центральск.",
        "auditMetrics": true }
    ]
  }
},
"launch.r2": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.launch.r2",
  "displayName": "Запустить поезд: Зерновск → Центральск (зерно)",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.r2Active" }, 0 ] },
      { "==": [ { "var": "public.metrics.s2Built" }, 1 ] },
      { ">=": [ { "var": "public.metrics.money" }, 400 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -400 },
      { "op": "metric.set", "scope": "session", "metricId": "r2Active", "value": 1 },
      { "op": "metric.add", "metricId": "trains", "delta": 1 },
      { "op": "log.append", "kind": "launch", "entityType": "route",
        "displayMode": "summary", "summary": "Запущен поезд Зерновск → Центральск.",
        "auditMetrics": true }
    ]
  }
},
"launch.r3": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.launch.r3",
  "displayName": "Запустить поезд: Лесогорск → Центральск (лес)",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.r3Active" }, 0 ] },
      { "==": [ { "var": "public.metrics.s3Built" }, 1 ] },
      { ">=": [ { "var": "public.metrics.money" }, 400 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -400 },
      { "op": "metric.set", "scope": "session", "metricId": "r3Active", "value": 1 },
      { "op": "metric.add", "metricId": "trains", "delta": 1 },
      { "op": "log.append", "kind": "launch", "entityType": "route",
        "displayMode": "summary", "summary": "Запущен поезд Лесогорск → Центральск.",
        "auditMetrics": true }
    ]
  }
},
"launch.r4": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.launch.r4",
  "displayName": "Запустить поезд: Углеград → Портовск (уголь)",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.r4Active" }, 0 ] },
      { "==": [ { "var": "public.metrics.s5Built" }, 1 ] },
      { "==": [ { "var": "public.metrics.s7Built" }, 1 ] },
      { ">=": [ { "var": "public.metrics.money" }, 400 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -400 },
      { "op": "metric.set", "scope": "session", "metricId": "r4Active", "value": 1 },
      { "op": "metric.add", "metricId": "trains", "delta": 1 },
      { "op": "log.append", "kind": "launch", "entityType": "route",
        "displayMode": "summary", "summary": "Запущен поезд Углеград → Портовск.",
        "auditMetrics": true }
    ]
  }
},
"launch.r5": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.launch.r5",
  "displayName": "Запустить поезд: Зерновск → Портовск (зерно)",
  "deterministic": {
    "guard": { "jsonLogic": { "and": [
      { "==": [ { "var": "public.round.status" }, "planning" ] },
      { "==": [ { "var": "public.metrics.r5Active" }, 0 ] },
      { "==": [ { "var": "public.metrics.s6Built" }, 1 ] },
      { ">=": [ { "var": "public.metrics.money" }, 400 ] }
    ] } },
    "effects": [
      { "op": "metric.add", "metricId": "money", "delta": -400 },
      { "op": "metric.set", "scope": "session", "metricId": "r5Active", "value": 1 },
      { "op": "metric.add", "metricId": "trains", "delta": 1 },
      { "op": "log.append", "kind": "launch", "entityType": "route",
        "displayMode": "summary", "summary": "Запущен поезд Зерновск → Портовск.",
        "auditMetrics": true }
    ]
  }
}
```

### 6.4. `year.run`

```json
"year.run": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.year.run",
  "displayName": "Отправить поезда",
  "deterministic": {
    "guard": { "jsonLogic": { "==": [ { "var": "public.round.status" }, "planning" ] } },
    "effects": [
      { "op": "state.patch", "patches": [
        { "op": "replace", "path": "/public/round/status", "value": "running" } ] },
      { "op": "timeline.set", "canAdvance": false, "stepIndex": 2, "screenId": "running" },
      { "op": "log.append", "kind": "year-run", "entityType": "round",
        "displayMode": "summary", "summary": "Поезда отправлены в рейс.",
        "auditMetrics": false }
    ]
  }
}
```

### 6.5. `year.commit`

Порядок эффектов значим: `revenueYear` вычисляется ДО обновления `money`
(второй эффект читает результат первого); эффекты с `when` по `year`
разводят «промежуточный год» и «финал» (`when` поддерживается всеми
эффектами после ADR-058 Phase 4).

```json
"year.commit": {
  "handlerType": "manifest-data",
  "capabilityFamily": "runtime.server",
  "capability": "rail-tycoon-mini.year.commit",
  "displayName": "Завершить год",
  "deterministic": {
    "guard": { "jsonLogic": { "==": [ { "var": "public.round.status" }, "running" ] } },
    "effects": [
      { "op": "metric.set", "scope": "session", "metricId": "revenueYear",
        "value": { "jsonLogic": { "+": [
          { "*": [ { "var": "public.metrics.r1Active" }, 150,
                   { "var": "public.market.coal.total" } ] },
          { "*": [ { "var": "public.metrics.r2Active" }, 150,
                   { "var": "public.market.grain.total" } ] },
          { "*": [ { "var": "public.metrics.r3Active" }, 160,
                   { "var": "public.market.timber.total" } ] },
          { "*": [ { "var": "public.metrics.r4Active" }, 260,
                   { "var": "public.market.coal.total" } ] },
          { "*": [ { "var": "public.metrics.r5Active" }, 180,
                   { "var": "public.market.grain.total" } ] }
        ] } } },
      { "op": "metric.set", "scope": "session", "metricId": "money",
        "value": { "jsonLogic": { "+": [
          { "var": "public.metrics.money" },
          { "var": "public.metrics.revenueYear" },
          { "*": [ -50, { "var": "public.metrics.trains" } ] }
        ] } } },
      { "op": "state.patch",
        "when": { "<": [ { "var": "public.metrics.year" }, 5 ] },
        "patches": [
          { "op": "replace", "path": "/public/round/status", "value": "done" } ] },
      { "op": "timeline.set",
        "when": { "<": [ { "var": "public.metrics.year" }, 5 ] },
        "canAdvance": false, "stepIndex": 3, "screenId": "between" },
      { "op": "state.patch",
        "when": { "==": [ { "var": "public.metrics.year" }, 5 ] },
        "patches": [
          { "op": "replace", "path": "/public/round/status", "value": "finished" } ] },
      { "op": "timeline.set",
        "when": { "==": [ { "var": "public.metrics.year" }, 5 ] },
        "canAdvance": false, "stepIndex": 4, "screenId": "results" },
      { "op": "log.append", "kind": "year-result", "entityType": "round",
        "displayMode": "summary", "summary": "Год завершён: доход зачислен, обслуживание списано.",
        "auditMetrics": true }
    ]
  }
}
```

## 7. UI-манифест (нормативно)

Файл: `games/rail-tycoon-mini/ui/web/ui.manifest.json`. Структура файла,
формат `screen_routing`, `metric_specs` и декларативная привязка действий к
кнопкам-карточкам (`cardComponent` с `actions.onClick.command =
"requestServer"` и `payload.actionId`) — **строго по образцу**
`games/simple-choice/ui/web/ui.manifest.json` (прочитать его перед работой;
никаких других механизмов привязки не изобретать). `entry_point: "intro"`.

Экраны (`screen_routing` по `screenId`; `stepIndex` фиксированы: intro 0,
planning 1, running 2, between 3, results 4):

| screenId | Состав | Привязки действий |
|---|---|---|
| `intro` | Название игры; правила (3–5 абзацев: капитал 1200; стройте линии и запускайте поезда; спрос грузов меняется каждый год; доход = база × спрос; обслуживание 50 за поезд в год; 5 лет; пороги рангов из §4.5); карточка «Основать компанию» | → `year.start` |
| `planning` | Метрики: `money` («Касса»), `year` («Год»), спрос трёх грузов; компонент `{"type": "simulationSurface", "sceneId": "main", "designWidth": 960, "designHeight": 540}`; 7 карточек строительства; 5 карточек запуска поездов; карточка «Отправить поезда» | карточки → `build.s1`…`build.s7`, `launch.r1`…`launch.r5`, `year.run` |
| `running` | Метрики `money`, `year`; тот же компонент `simulationSurface` (`sceneId: "main"`); карточка «Завершить год» | → `year.commit` |
| `between` | Заголовок «Год завершён»; метрики `revenueYear` («Доход за год»), `money`, `year`; карточка «Начать следующий год» | → `year.start` |
| `results` | Заголовок «Игра окончена»; метрика `money`; статический текст порогов рангов: «2700+ — Магнат; 2100+ — Директор дороги; 1500+ — Начальник депо; меньше — Стажёр» | нет |

Нормативные тексты карточек `planning` (title / summary / actionId):

| title | summary | actionId |
|---|---|---|
| «Линия: Углеград — Центральск» | «Стоимость: 250» | `build.s1` |
| «Линия: Зерновск — Центральск» | «Стоимость: 250» | `build.s2` |
| «Линия: Центральск — Лесогорск» | «Стоимость: 300» | `build.s3` |
| «Линия: Центральск — Портовск» | «Стоимость: 300» | `build.s4` |
| «Линия: Углеград — Лесогорск» | «Стоимость: 200» | `build.s5` |
| «Линия: Зерновск — Портовск» | «Стоимость: 200» | `build.s6` |
| «Линия: Лесогорск — Портовск» | «Стоимость: 350» | `build.s7` |
| «Поезд: Углеград → Центральск» | «Уголь · база 150 · цена 400 · нужна линия s1» | `launch.r1` |
| «Поезд: Зерновск → Центральск» | «Зерно · база 150 · цена 400 · нужна линия s2» | `launch.r2` |
| «Поезд: Лесогорск → Центральск» | «Лес · база 160 · цена 400 · нужна линия s3» | `launch.r3` |
| «Поезд: Углеград → Портовск» | «Уголь · база 260 · цена 400 · нужны линии s5 и s7» | `launch.r4` |
| «Поезд: Зерновск → Портовск» | «Зерно · база 180 · цена 400 · нужна линия s6» | `launch.r5` |
| «Отправить поезда» | «Завершить планирование года» | `year.run` |

Привязки метрик (`gameVariableComponent.value`):
`{{game.state.public.metrics.money}}`, `{{game.state.public.metrics.year}}`,
`{{game.state.public.metrics.revenueYear}}`,
`{{game.state.public.market.coal.total}}` («Спрос: уголь»),
`{{game.state.public.market.grain.total}}` («Спрос: зерно»),
`{{game.state.public.market.timber.total}}` («Спрос: лес»).

Принятое упрощение (не чинить): карточки действий всегда интерактивны;
недопустимый клик отклоняется сервером и показывается стандартной ошибкой
player-web. Построенность линий и запущенные поезда игрок видит на сцене.

## 8. Плагин и Phaser-сцена (нормативно)

Плагин подчиняется контрактам `flow-simulation-platform-design.md` §4.0
(типы `PhaserSceneContext`, `SimulationSceneHandle`, экспорт
`createSimulationScene`) и §4.3 (`plugin.json` с
`"contributes": {"phaserSceneFactory": true}`, `dependenciesPolicy:
"platform-only"`, БЕЗ импорта `phaser` — только `context.Phaser`).

Раскладка (по образцу `games/antarctica/plugins/antarctica-player/`; ассеты
живут вне плагина — в `games/rail-tycoon-mini/assets/`, §8.0):

```text
games/rail-tycoon-mini/plugins/rail-tycoon-mini-player/
  .desc.json          — краткое описание каталога
  plugin.json         — id "rail-tycoon-mini-player", gameId "rail-tycoon-mini",
                        targets["player-web"].contributes = {"phaserSceneFactory": true}
  package.json        — name "@cubica-games/rail-tycoon-mini-player", без dependencies
  tsconfig.json       — по образцу antarctica-player
  src/index.ts        — export const createSimulationScene: PhaserSceneFactory
  src/scene.ts        — класс RailMapScene (extends context.Phaser.Scene)
  src/geometry.ts     — чистые функции buildRoutePath / trainPositionAt
  src/contracts.ts    — типы чтения public state и content этой игры
  tests/geometry.test.ts — юнит-тесты чистых функций (Vitest)
```

### 8.0. Ассеты игры (нормативно; канал ADR-063)

Игра использует четыре собственных SVG-ассета через платформенный канал
игровых ассетов (`game-asset-channel-design.md` §3). Все файлы — авторские,
написаны как текст (агенто-писаемый формат), проходят CI-валидатор
(`validate-game-assets.js`), в том числе санитизацию SVG.

`games/rail-tycoon-mini/assets/assets.json` (копируется как есть):

```json
{
  "gameId": "rail-tycoon-mini",
  "assets": [
    { "id": "train-coal",   "file": "train-coal.svg",   "kind": "image",
      "origin": { "type": "authored-in-repo" } },
    { "id": "train-grain",  "file": "train-grain.svg",  "kind": "image",
      "origin": { "type": "authored-in-repo" } },
    { "id": "train-timber", "file": "train-timber.svg", "kind": "image",
      "origin": { "type": "authored-in-repo" } },
    { "id": "city",         "file": "city.svg",         "kind": "image",
      "origin": { "type": "authored-in-repo" } }
  ]
}
```

Разметка SVG (нормативная; копируется как есть). Три файла поездов
идентичны с точностью до цвета корпуса — он равен цвету груза из
`content.cargoTypes` (§5.1): `train-coal.svg` → `#546e7a`,
`train-grain.svg` → `#f9a825`, `train-timber.svg` → `#6d4c41`.
Ниже приведён `train-coal.svg`; в двух остальных заменяется ТОЛЬКО значение
`fill` двух первых `rect` (корпус и кабина):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 28">
  <rect x="1" y="5" width="42" height="14" rx="3" fill="#546e7a"/>
  <rect x="43" y="9" width="12" height="10" rx="2" fill="#546e7a"/>
  <rect x="6" y="8" width="8" height="6" rx="1" fill="#eceff1"/>
  <rect x="18" y="8" width="8" height="6" rx="1" fill="#eceff1"/>
  <rect x="30" y="8" width="8" height="6" rx="1" fill="#eceff1"/>
  <circle cx="12" cy="22" r="4" fill="#263238"/>
  <circle cx="28" cy="22" r="4" fill="#263238"/>
  <circle cx="46" cy="22" r="4" fill="#263238"/>
</svg>
```

`city.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="21" fill="#455a64"/>
  <circle cx="24" cy="24" r="21" fill="none" stroke="#eceff1" stroke-width="3"/>
  <rect x="15" y="21" width="18" height="13" fill="#eceff1"/>
  <path d="M13 21 L24 11 L35 21 Z" fill="#eceff1"/>
</svg>
```

**Источники ассетов (нормативные правила выбора).** Для агентной
реализации MVP нормативен источник 1 (SVG из этого раздела). Остальные
источники — разрешённые пути будущего улучшения графики; любой из них
оформляется по правилам таблицы, всё прочее запрещено.

| # | Источник | Когда | Оформление `origin` в реестре |
|---|---|---|---|
| 1 | Авторские SVG из этого документа (§8.0) | MVP; всё, что агент может нарисовать текстом | `{"type": "authored-in-repo"}` |
| 2 | Изображения, созданные ИИ-генератором для проекта | Улучшение графики без художника | `{"type": "authored-in-repo"}`; условия инструмента обязаны разрешать использование без атрибуции; инструмент и промт зафиксировать в `.desc.json` каталога `assets/` |
| 3 | Свободные паки CC0 / Public Domain: Kenney.nl (транспорт, тайлы, UI), OpenGameArt.org с фильтром по лицензии CC0 | Готовые качественные спрайты | `{"type": "third-party", "license": "CC0-1.0", "source": "<точный URL пака>"}` |
| 4 | Ресурсы CC-BY (например, game-icons.net) | Когда CC0-аналога нет | `{"type": "third-party", "license": "CC-BY-4.0" (или фактическая), "source": "<URL>"}`; текст атрибуции — в `.desc.json` каталога `assets/` |
| 5 | Заказ художнику с полной передачей прав | Продуктовое качество | `{"type": "authored-in-repo"}` (договор хранится вне репозитория) |

Запрещённые источники (красное ревью): материалы коммерческих игр — в том
числе оригинальной Sid Meier's Railroad Tycoon (графика, звук, тексты);
лицензии с ограничениями NC/ND или вирусными условиями; «найдено в
интернете» без явной лицензии; стоки без права распространения в открытом
репозитории.

Требования независимо от источника: форматы, лимиты и SVG-санитизация
канала (`game-asset-channel-design.md` §3.5); бинарные форматы (png/webp)
агент-исполнитель сам не порождает — их добавляет владелец или отдельно
согласованный пайплайн. Замена графики позже — это замена файла при том же
`id` (URL сменится хэшем автоматически): манифесты и сцена не меняются.

Правила использования (нормативные):

- Сцена получает URL ассетов ТОЛЬКО через `context.assets.url(<id>)`
  (контракт `GameAssetResolver`); строка `/game-assets/` в коде плагина не
  появляется (grep-инвариант §9.6).
- Предзагрузка — в `preload()` сцены: `this.load.svg(id,
  context.assets.url(id), { width, height })` для всех четырёх id;
  размеры растеризации: поезда 56×28, город 48×48.
- Fallback-отрисовки при недоступном ассете НЕТ: целостность реестра
  гарантирует CI (`game-asset-channel-design.md` §6 п.9).

### 8.1. Чистые функции геометрии (нормативные сигнатуры и семантика)

```ts
export interface Point { x: number; y: number; }

/** Полилиния маршрута: координаты городов в порядке cityPath.
 * Неизвестный id города — выброс исключения (ошибка контента, fail fast). */
export function buildRoutePath(
  cityPath: ReadonlyArray<string>,
  cities: ReadonlyArray<{ id: string; x: number; y: number }>
): Point[];

/** Положение поезда на полилинии в момент elapsedMs при движении
 * «туда-обратно» с постоянной скоростью speedPxPerSec.
 * Алгоритм нормативен:
 *   L = суммарная длина полилинии (евклидова);
 *   если L === 0 или path.length < 2 → вернуть path[0];
 *   dist = (elapsedMs / 1000 * speedPxPerSec) % (2 * L);
 *   если dist > L → dist = 2 * L - dist;   // обратный ход
 *   идти по отрезкам полилинии, откладывая dist; вернуть точку
 *   линейной интерполяцией внутри текущего отрезка. */
export function trainPositionAt(
  path: ReadonlyArray<Point>,
  elapsedMs: number,
  speedPxPerSec: number
): Point;
```

Эталонные значения для тестов (путь `[(0,0), (100,0)]`, скорость 100 px/с):
t=0 → (0,0); t=500 → (50,0); t=1000 → (100,0); t=1500 → (50,0); t=2000 → (0,0).

### 8.2. Поведение сцены (нормативное; дизайн-поле 960×540)

Сцена — **только отображение**. Нормативные запреты: сцена НЕ вызывает
`dispatchAction` (все действия — карточки DOM-интерфейса); НЕ содержит
обработчиков ввода; НЕ использует `Math.random` и `Date.now` (время — только
`this.time` Phaser); изображения берёт ТОЛЬКО из канала ассетов §8.0 (через
`context.assets`, никаких URL в коде и никаких иных внешних ресурсов),
остальная графика — примитивы (линии, текст); НЕ читает ничего, кроме
`context.content`, `context.assets` и снимков `updateSession`.

1. **Данные.** Из `context.content`: города, линии, маршруты, грузы,
   `trainSpeedPxPerSec`. Из снимка сессии (`session.state.public`): метрики
   `sNBuilt`, `rKActive`, `year`, `round.status`, `market.*.total`. Функция
   `applySnapshot(snapshot)` перерисовывает статический слой идемпотентно;
   вызывается из `create()` и из каждого `updateSession`.
2. **Города**: спрайт ассета `city` (48×48, §8.0) в координатах города;
   подпись (name) под спрайтом (смещение y +34), кегль 14, цвет `#ffffff`.
3. **Линии**: отрезок между городами. Не построена — `lineStyle(2, 0x90a4ae,
   0.6)` плюс подпись цены у середины отрезка (кегль 12, цвет `#90a4ae`).
   Построена — `lineStyle(6, 0x263238, 1)`, подпись цены скрывается.
4. **Поезда**: для каждого маршрута с `rKActive === 1` — спрайт ассета
   `train-<cargoId>` маршрута (56×28, §8.0; цвет корпуса уже совпадает с
   цветом груза). При `round.status !== "running"` поезд стоит у
   первого города `cityPath` (смещение y −24). При `round.status ===
   "running"` поезд движется: позиция = `trainPositionAt(buildRoutePath(...),
   elapsed, trainSpeedPxPerSec)`, где `elapsed` отсчитывается по `this.time`
   с момента, когда сцена впервые увидела статус `running` текущего года.
5. **Панель сцены**: слева сверху (16, 12) текст «Год N из 5» (кегль 16);
   справа сверху (944, 12, выравнивание вправо) текст
   «Спрос — Уголь: X · Зерно: Y · Лес: Z» из `market.*.total`; при `year ===
   0` или нулевом спросе — «Спрос: —».
6. **Жизненный цикл**: `updateSession` → `applySnapshot`; `destroy()` снимает
   все таймеры/колбэки сцены (анимация — через `update()` сцены, отдельных
   таймеров не создавать без необходимости).
7. Анимация декоративна: она не влияет и не может влиять на подсчёты — все
   итоги считает runtime (§6.5). Никакой синхронизации анимации с фиксацией
   года не требуется: «Завершить год» доступна игроку сразу.

## 9. Тестирование и приёмочные числа

### 9.1. Юнит-тесты формулы (runtime, node:test)

Контрольный пример §4.4 как integration-подслучай: при market coal=2,
grain=3, timber=1 и активных `r1`, `r2`, `r5` действие `year.commit` даёт
`revenueYear == 1290` и `Δmoney == +1140`. Способ закрепить market в тесте —
фикстура состояния или подготовка состояния прямыми патчами тестовой сессии
(по образцу существующих runtime-тестов эффектов; НЕ менять обработчики).

### 9.2. Интеграционный сценарий (нормативный алгоритм; runtime-тест)

Спрос заранее неизвестен (PRNG сессии), поэтому тест НЕ хардкодит доходы, а
пересчитывает ожидание из наблюдаемого состояния. Скрипт строго линеен, без
ветвлений:

1. Создать сессию → проверить: `money 1200`, `year 0`, `status "idle"`,
   `screenId "intro"`, все `sNBuilt`/`rKActive` = 0.
2. `year.start` → `year 1`, `status "planning"`, `screenId "planning"`;
   прочитать `market.coal.total`, `market.grain.total`, `market.timber.total`
   (каждый ∈ {1,2,3}).
3. `build.s1` → `money 950`; `build.s2` → `money 700`; `launch.r1` →
   `money 300`, `trains 1`, `r1Active 1`.
4. Негативные проверки (каждая: действие отклонено И полный снимок
   `public.metrics` не изменился): `launch.r2` (денег 300 < 400);
   `build.s1` (повторно); `launch.r4` (линии не построены);
   `year.commit` (фаза `planning`); `year.start` (фаза `planning`).
5. `year.run` → `status "running"`, `screenId "running"`. Негативная:
   `build.s3` отклонено (фаза `running`), метрики не изменились.
6. `year.commit` → `revenueYear == 150·coal₁`;
   `money == 300 + 150·coal₁ − 50`; `status "done"`, `screenId "between"`
   (coal₁ — наблюдённое значение шага 2).
7. `year.start` (год 2, прочитать новый market) → `launch.r2` → `money`
   уменьшился на 400, `trains 2` (денег гарантированно хватает:
   минимум `250 + 150·1 = 400`).
8. `year.run`, `year.commit` → `revenueYear == 150·coal₂ + 150·grain₂`;
   `money` увеличился на `revenueYear − 100`.
9. Годы 3, 4, 5 — без покупок: `year.start` (читать market), `year.run`,
   `year.commit`; после каждого — та же формула с `trains == 2`.
10. После 5-го `year.commit`: `status "finished"`, `screenId "results"`,
    `year 5`; итоговое `money` равно значению, накопленному тестом
    пошагово. Негативная: `year.start` отклонено.

### 9.3. Детерминированный smoke-тест «без покупок»

Создать сессию; 5 раз подряд `year.start` → `year.run` → `year.commit`.
После каждого года `revenueYear == 0`; итог: `money == 1200`, `year == 5`,
`status "finished"`. Значения точны и не зависят от бросков спроса.

### 9.4. E2E (player-web, Playwright; детерминированный, ≤ 120 с)

1. Открыть игру → экран `intro`; клик «Основать компанию» → экран `planning`.
2. Клик «Линия: Углеград — Центральск» → «Касса» показывает 950.
3. Повторный клик той же карточки → видимая стандартная ошибка player-web;
   «Касса» по-прежнему 950.
4. Клик «Отправить поезда» → экран `running` (canvas `simulationSurface`
   присутствует); клик «Завершить год» → экран `between`, «Доход за год» 0,
   «Касса» 950.
5. Годы 2–5: «Начать следующий год» → «Отправить поезда» → «Завершить год».
6. Экран `results`: «Касса» 950, текст порогов рангов присутствует.

Все проверяемые числа пути (950, 0) не зависят от случайности.

### 9.5. Юнит-тесты плагина (Vitest)

- `buildRoutePath`: маппинг id → координаты в порядке `cityPath`; неизвестный
  id — исключение.
- `trainPositionAt`: эталонные точки из §8.1 (все пять) плюс путь из трёх
  точек (проверка перехода через излом).
- Два вызова с одинаковыми аргументами дают одинаковый результат (чистота).

### 9.6. Grep-инварианты чистоты (CI, по образцу трека симуляций)

- `rail-tycoon` не встречается в `services/runtime-api/src` и
  `apps/player-web/src` (правило 10 CLAUDE.md);
- в `games/rail-tycoon-mini/` нет `from "phaser"`, `require("phaser")`,
  `import("phaser")` (инъекция только через `context.Phaser`);
- в `games/rail-tycoon-mini/plugins/` нет `Math.random` и `Date.now`;
- в `games/rail-tycoon-mini/plugins/` нет строки `/game-assets/` — URL
  ассетов получаются только через `context.assets.url` (§8.0).

### 9.7. Прочее

- Каталог `games/rail-tycoon-mini/assets/` (реестр §8.0 и четыре SVG)
  проходит платформенный валидатор `validate-game-assets.js` (в контуре
  `verify:canonical`).
- Манифесты проходят строгую Ajv-валидацию и `verify:canonical`; изменений в
  `docs/architecture/schemas/` и `packages/contracts/` у этой игры НЕТ —
  `git diff --stat` по этим каталогам и по `services/runtime-api`,
  `apps/player-web` пуст (кроме, при необходимости, регистрации игры по
  тому же механизму, каким зарегистрированы `simple-choice`/`conveyor-mini`,
  если реестр игр — файл данных, а не код).
- Если authoring-слой (ADR-030) обязателен для новых игр на момент
  реализации — оформить authoring-манифесты по актуальному контуру и
  прогнать `npm run verify:manifest-authoring` (сверить с процессом
  `conveyor-mini`, Stage 1 его TSK).

## 10. Решённые проектные вопросы

Вопросы закрыты на этапе проектирования; исполнитель их НЕ пересматривает.

1. **Действия «на сущность» вместо параметров (ADR-061 не используется).**
   Карта фиксирована, сущностей мало (7 линий, 5 маршрутов) → 12 действий с
   константными guard-ами проще, проверяемее и не несут недоверенных данных.
   Альтернатива `build {segmentId}` с `paramsSchema` отклонена: guard-ы
   превратились бы в цепочки if по id, а выгоды при фиксированной карте нет.
2. **Без `random.seed` и клиентского PRNG.** Вся случайность игры — годовой
   спрос — серверная (`random.roll`). Сцена не содержит игровой случайности,
   поэтому зерно раунда ей не нужно. Из конвенции §4.6
   `flow-simulation-platform-design.md` берётся только `round.status`
   (без `index` — его роль играет метрика `year`, и без `seed`).
   Replay-детерминизм обеспечен PRNG сессии ADR-058.
3. **Сервер — единственный вычислитель итогов.** `year.commit` без параметров:
   формулы дохода живут в манифесте. Это строже границы честности MVP
   ADR-062 (там клиент присылает итоги) — у клиента вообще нет канала влияния
   на счёт. Следствие: анимация чисто декоративна (§8.2 п.7).
4. **Сцена без ввода, действия — DOM-карточки.** Рендерер уже умеет
   декларативную привязку карточек к действиям (ADR-055, образец
   `simple-choice`); сцена-визуализация минимизирует поверхность ошибок
   слабого исполнителя. Клики по сцене (канал `dispatchAction` ADR-062)
   демонстрирует `conveyor-mini` — дублировать демонстрацию не нужно.
5. **Фиксированные наборы сущностей, метрики-флаги 0/1** вместо динамических
   коллекций объектов: вписывается в существующие метрики; объектная модель
   (ADR-041) здесь не даёт выгоды, т.к. у сущностей нет фасетного жизненного
   цикла, видимого игроку через objectViews.
6. **Экономика без банкротства** — доказательство в §4.4; действия с
   недостатком денег отклоняют guard-ы.
7. **Один поезд на маршрут; поезда не продаются; линии не сносятся** —
   минимальный инвентарь механик (ADR-024, ограниченные механики).
8. **Новый ADR не нужен.** Классификация по правилу 10 CLAUDE.md: все
   механики — игровые (манифест + плагин); платформенные возможности — уже
   принятые ADR-058/061/062. Архитектурных решений уровня платформы этот
   документ не принимает.
9. **Ранги — статический текст**, а не вычисляемая метрика: движку не нужны
   строковые метрики и условное отображение; порог сравнивает человек.
10. **Пять фиксированных `stepIndex`** (0..4) с цикличным повторением экранов
    `planning`/`running`/`between`: маршрутизация экранов идёт по `screenId`;
    прогресс игры выражают метрики, а не timeline.
11. **Юридическая гигиена**: используются только жанровые механики; названия
    городов, тексты и графика — собственные (авторские SVG §8.0, `origin:
    authored-in-repo`). Название игры не содержит «Railroad Tycoon».
12. **Графика — через канал игровых ассетов ADR-063** (спрайты поездов и
    городов — авторские SVG в `games/rail-tycoon-mini/assets/`, линии и
    текст — примитивы). SVG выбран как агенто-писаемый формат; обращение —
    только по id через `context.assets`; fallback-примитивов при
    недоступном ассете нет (целостность гарантирует CI-валидатор канала).
    Первоначальный вариант «только примитивы» отклонён после появления
    платформенного канала: игра — продуктовый образец жанра, а не фикстура.

## 11. Указания агенту-исполнителю

1. **Не изобретать.** Нет поля/числа/поведения в этом документе, ADR или
   TSK — остановить срез, записать вопрос в Handoff Log
   `TSK-20260706-rail-tycoon-mini-game`, доложить оркестратору/владельцу.
2. **Не менять числа и формулы** (§4, §6) — это контракт приёмки; идеи об
   улучшении — только текстом в Handoff Log.
3. **Запреты** (нарушение = красное ревью): game-specific код или строка
   `rail-tycoon` в `services/runtime-api/src`, `apps/player-web/src`;
   `import "phaser"` в любом виде внутри `games/`; `Math.random`/`Date.now`
   в плагине; захардкоженные URL `/game-assets/` в плагине (только
   `context.assets.url`); вычисление денег/дохода в сцене или UI; новые
   платформенные эффекты/схемные конструкции; правка чужих игр и
   платформенных схем.
4. **Образцы обязательны к прочтению перед срезом**: `simple-choice`
   (манифесты), `antarctica-player` (структура плагина), `conveyor-mini`
   (плагин сцены и e2e — когда будет реализован),
   `flow-simulation-platform-design.md` §4.0 (контракт сцены).
5. **Каждый срез**: JSON валиден (Ajv строгий), тесты своего слоя зелёные,
   документация синхронна, новые каталоги — с `.desc.json` +
   `node scripts/dev/generate-structure.js`, временные файлы — только в
   `.tmp/`.
6. **Context7 MCP** — обязателен при работе с Phaser API (актуальная
   документация 3.x), как требует `CLAUDE.md`.
7. Порядок работ, приёмка и команды проверки — в
   `docs/tasks/active/TSK-20260706-rail-tycoon-mini-game.md`.

## 12. Координация с другими треками

- **Зависимости** (таблица §3): игра стартует только когда в `main`
  реализованы `random.roll` (ADR-058 Phase 1), `metric.set` + `when`
  (ADR-058 Phase 4), Phaser-хост с `simulationSurface`/`phaserSceneFactory`
  (трек `TSK-20260706-flow-simulation-platform-capabilities`, Phase 3) и
  канал игровых ассетов с резолвером `context.assets` (трек
  `TSK-20260706-game-asset-channel`, Phases 1–3). Состояние проверять по
  Handoff Log треков и `git log` схем.
- **Никакого дублирования**: если зависимость не готова — ждать или работать
  над независимыми срезами (например, Stage 3 плагин с юнит-тестами геометрии
  не требует платформенных фаз), но НЕ реализовывать платформенные блоки
  самостоятельно.
- **Общие файлы с другими треками** (`game-manifest.schema.json`,
  `deterministicHandlers.ts` и пр.) эта игра НЕ меняет — конфликтов владения
  нет by design.
- Этот документ и TSK игры — единственные нормативные источники игры;
  `conveyor-mini` — сосед по каналу Phaser, не зависимость по коду (кроме
  общего платформенного хоста).
