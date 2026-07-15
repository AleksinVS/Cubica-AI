# Game Intent → Cubica Mechanics IR

Документ объясняет целевую цепочку от игровой команды клиента до
декларативного языка правил Cubica и фактическую границу миграции со старого
`deterministic.effects[]`. Каноническое архитектурное решение находится в
ADR-083 и ADR-084; JSON Schema остаётся единственным источником истины
исполняемой структуры.

**Промежуточное представление (IR)** — канонический JSON-план после раскрытия
authoring-макросов и до исполнения runtime. **Candidate state** — пробная копия
состояния, которая сохраняется только после успеха всего действия.
**Game Intent (игровое намерение)** — предметная команда клиента, игрового ИИ
или UI: существующий `actionId` и проверяемые параметры без доступа к
внутренним операциям. Отдельное поле `intentId` не вводится.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Фактическая старая форма](#2-фактическая-старая-форма)
- [3. Основные правила](#3-основные-правила)
- [3.1. Game Intent и Presenter](#31-game-intent-и-presenter)
- [3.2. Два каталога](#32-два-каталога)
- [4. Публичный каркас](#4-публичный-каркас)
- [5. Типизированная модель состояния](#5-типизированная-модель-состояния)
- [6. Выражения и ссылки](#6-выражения-и-ссылки)
- [7. Категории шагов](#7-категории-шагов)
- [8. Транзакционная семантика](#8-транзакционная-семантика)
- [8.1. Идемпотентность команды](#81-идемпотентность-команды)
- [8.2. Системное срабатывание](#82-системное-срабатывание)
- [9. Безопасность данных](#9-безопасность-данных)
- [10. Детерминизм и стоимость](#10-детерминизм-и-стоимость)
- [11. Модульное расширение](#11-модульное-расширение)
- [12. Authoring, редактор и диагностика](#12-authoring-редактор-и-диагностика)
- [13. Сценарии текущих игр](#13-сценарии-текущих-игр)
- [14. Миграция и удаление старого пути](#14-миграция-и-удаление-старого-пути)
- [15. Границы безопасного исполнения](#15-границы-безопасного-исполнения)
- [16. Источники](#16-источники)

## 1. Назначение

Cubica Mechanics IR должен позволять игре без изменения общего runtime:

- читать фактическое состояние сессии через типизированные ссылки;
- выбирать, фильтровать, сортировать, группировать и агрегировать ограниченные
  коллекции;
- проверять предусловия и ветвиться;
- менять объекты, records, отношения, ресурсы и события;
- использовать графовые, геометрические, колодные и случайные алгоритмы;
- связывать результат предыдущего шага со следующим;
- применять весь результат атомарно и воспроизводимо.

Универсальность не означает произвольный код. Язык имеет закрытый словарь,
предварительную типизацию, явные версии и ограничение стоимости.

## 2. Фактическая старая форма

На 2026-07-14 runtime ещё исполняет `deterministic.effects[]`:

- JSON Schema объявляет 29 вариантов;
- 27 вариантов используются пятью играми;
- runtime-манифесты хранят 693 декларации;
- после раскрытия templates/overrides исполняются 967 шагов;
- editable authoring содержит 695 эффектов, включая два pending CMT actions;
- `ui.panel.open` и `ui.screen.open` не имеют игровых потребителей.

Старый путь включает runtime-подстановку `{{...}}`, отдельные формы guard/when,
JsonLogic, строковые JSON Pointer и большой switch в
`deterministicHandlers.ts`. Он является фактическим миграционным долгом, а не
допустимой альтернативой для новых механик.

## 3. Основные правила

1. JSON Schema 2020-12 владеет синтаксисом IR.
2. Каждый вариант закрыт и различается точным `op: const`.
3. Компилятор раскрывает authoring-макросы, нормализует defaults и проверяет IR
   до публикации.
4. Семантический checker проверяет только то, что нельзя выразить JSON Schema:
   ссылки, value/security types, версии модулей и стоимость.
5. Game Intent разделяет публичную доступность, серверную авторизацию и одну
   изменяющую транзакцию.
6. Любая ошибка откатывает state, случайность, события и версию сессии.
7. Клиентский ввод остаётся значением и не становится путём, выражением, именем
   операции или модуля.
8. Предметные процессы принадлежат игре и компилируемым макросам; общий runtime
   содержит только нейтральные операции и алгоритмы. Не выразимая ими
   уникальная логика остаётся в изолированном runtime-расширении игры.
9. Presenter проецирует чтение и исполняет опубликованную UI-привязку
   `actionId + params`, добавляет стабильный `commandId`, но не выбирает
   действие по предметному состоянию, не составляет IR и не заявляет
   доверенный `playerId`.
10. Внешний `commandId` обозначает одну логическую команду на всех HTTP retry;
    внутренний планировщик использует отдельный детерминированный профиль.
    `requestId` при необходимости обозначает конкретную доставку, а
    `expectedStateVersion` отдельно разрешает конкуренцию внешних команд.

### 3.1. Game Intent и Presenter

Обычный клиент и игровой ИИ видят только actor-scoped Game Intents. Их
канонический идентификатор — существующий `actionId`; отдельный `intentId` и
параллельный каталог не создаются.

Presenter является projector на read path и router на write path. Он может
показать серверную доступность, собрать параметры из опубликованных bindings,
сохранить незавершённый `commandId` и отправить намерение, но не считает
законность, стоимость, маршрут или победителя, не выполняет lowering и не
поддерживает собственный `commandMap` либо fallback-команды.

Доверенная личность не передаётся как `playerId` в теле запроса: principal
устанавливается аутентификацией, а actor разрешается сервером в сессии. Если
игре нужен явный выбор actor, клиентское значение является только недоверенной
заявкой и проходит отдельную авторизацию.

Первая версия runtime ограничена привязкой проверенных параметров и разрешением
opaque refs. Ветвление выполняется внутри опубликованного IR. Выбор одного из
нескольких заранее опубликованных typed plans остаётся зарезервированным server
lowering и не реализуется без отдельного игрового потребителя. Клиент или LLM
не выбирает `op`, module, path или структуру программы.

### 3.2. Два каталога

Authoring AI и editor используют широкий operation catalog: IR operations,
functions, algorithms, mechanics capability packs, macros и intent templates.
Каталог работает по схеме «найти кандидата → получить точную схему → применить
и проверить», поэтому весь словарь не загружается в каждый промт.

Игрок и игровой ИИ получают `actionId`. Неизменяемое описание и bounded params
schema кэшируются по `bundleHash`; динамические
`available/unavailable/parameter-dependent`, `basisStateVersion`, варианты и
preview проецируются отдельно для principal/actor/session. Внутренние IR,
server authorization и secret reasons не публикуются. Наличие и порядок
элементов каталога также считаются информационным потоком.

У числа операций нет искусственного лимита, но две runtime-операции одного
уровня обязаны отличаться проверяемыми guarantees: types, reads/writes,
purity, security flow, determinism/random, ordering, failure/cardinality и
cost. Синонимы и предметные workflows остаются macros и исчезают до runtime.

## 4. Публичный каркас

Манифест фиксирует язык, бюджет и модули один раз:

```json
{
  "mechanics": {
    "apiVersion": "cubica.dev/mechanics/v1alpha1",
    "budgetProfile": "turn-based-standard-v1",
    "moduleLock": {
      "core": {
        "moduleId": "cubica.core",
        "moduleVersion": "1.0.0",
        "artifactHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
      },
      "random": {
        "moduleId": "cubica.random",
        "moduleVersion": "1.0.0",
        "artifactHash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        "algorithmVersions": {
          "randomStreams": "xoshiro128ss-streams-v1"
        }
      },
      "regionGraph": {
        "moduleId": "cubica.graph.regions",
        "moduleVersion": "1.0.0",
        "artifactHash": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        "algorithmVersions": {
          "regionPath": "region-segment-minimum-v1"
        }
      }
    }
  }
}
```

`moduleVersion` — точная версия модуля в формате `major.minor.patch`, без
диапазона; `artifactHash` закрепляет конкретное содержимое. Версии поведения
отдельных алгоритмов записываются в `algorithmVersions` и не смешиваются с
версией самого модуля. Ключ `moduleLock` является локальным псевдонимом, а
каноническую идентичность задаёт `moduleId`.

Game Intent имеет bounded `paramsSchema` и три независимые исполняемые части:

```json
{
  "actionId": "restore-active-resources",
  "paramsSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "availability": {
    "op": "bool.eq",
    "left": { "op": "context.activePlayerId" },
    "right": { "op": "context.actorId" }
  },
  "authorization": {
    "op": "auth.actorIsActive"
  },
  "binding": {
    "kind": "mechanics-plan",
    "transaction": {
      "steps": [
        {
          "id": "active-units",
          "op": "core.select",
          "source": { "collection": "units" },
          "where": {
            "op": "value.eq",
            "left": { "op": "item.facet", "name": "availability" },
            "right": { "op": "value.literal", "value": "active" }
          },
          "orderBy": [{ "field": "id", "direction": "asc" }],
          "cardinality": { "min": 0, "max": 64 }
        },
        {
          "id": "restore-resource",
          "op": "core.update",
          "targets": { "result": "active-units" },
          "changes": [
            {
              "field": { "attribute": "actionPoints" },
              "set": { "op": "value.literal", "value": 5 }
            }
          ]
        }
      ]
    }
  }
}
```

Точные поля расширяются schema-first с реальными срезами. Общая семантика
`actionId`, bounded parameters, `apiVersion`, раздельных каналов действия,
типов, cardinality, результатов, транзакции, budgets и module locks является
обязательной. UI manifest отдельно связывает `actionId` с подписью,
расположением и органом ввода.

## 5. Типизированная модель состояния

Любая доступная запросам коллекция объявляет:

- item/record type;
- `audienceRef`: первая версия поддерживает `public`, actor и `server`, а
  контракт допускает будущие team/role audiences;
- максимальную ёмкость;
- стабильный key и канонический порядок;
- поля, фасеты и отношения;
- разрешённые чтения и записи.

Базовые типы: `Bool`, `String`, bounded `Integer`, точный `Decimal`, `Enum`,
`Option<T>`, `EntityRef<T>`, `EntitySet<T>` и объявленные records. Отсутствие и
`null` различаются. Деньги и рейтинги не используют двоичную плавающую точку.

Произвольный JSON Pointer/JSONPath не является типизированной ссылкой. Путь к
полю задаётся структурой, проверенной против модели состояния.

## 6. Выражения и ссылки

Выражение — закрытое JSON AST, а не строка с кодом. Минимальные группы:

- literal и optional operations `exists`/`coalesce`;
- context refs: actor, active participant, записанное игровое время;
- item refs: ID, type, facet, attribute, relation;
- result refs на предыдущие шаги;
- boolean `and`/`or`/`not`;
- typed comparisons;
- bounded integer/decimal arithmetic;
- ограниченные set и aggregate operations.

Выражение чисто: оно не меняет state, не получает случайность и не читает
системные часы, сеть, файловую систему или environment. Рекурсия,
неограниченный цикл и пользовательская функция запрещены.

Каждый step ID уникален. ResultRef может смотреть только назад; checker выводит
его тип, конфиденциальность и целостность.

## 7. Категории шагов

### Query

Чистый запрос выбирает, фильтрует, сортирует, группирует или агрегирует данные.
Источник имеет capacity, результат — `cardinality.min/max`, а порядок — явный
или канонический.

### Assert

Утверждение проверяет predicate либо результат. Нарушение возвращает стабильный
код и откатывает транзакцию. Отдельные несовместимые `onNoMatch` не нужны:
пустая выборка регулируется общей cardinality.

### Command

Команда создаёт или меняет typed state/object/relation/resource/event и является
единственной категорией, которая расходует воспроизводимую случайность. Bulk
command применима ко всем targets или ни к одному; partial success запрещён.

### Algorithm

Алгоритм решает чистую нейтральную вычислительную задачу: путь в графе,
геометрию или stable ranking. Он имеет конкретный versioned `op`, typed I/O,
cost model и conformance tests, но не меняет состояние, не создаёт события и не
расходует RNG. Перемешивание и случайный выбор являются module-backed
командами, потому что меняют состояние воспроизводимой случайности. Generic
`algorithm.call` с произвольными аргументами запрещён.

`sequence`, ограниченные `if`/`match` и обработка bounded-набора являются
структурными узлами плана, а не новой категорией операции. Первая версия
поддерживает `sequence`; дополнительные control nodes вводятся реальными
срезами. Рекурсия, `goto` и неограниченные циклы запрещены.

Отложенное правило регистрируется typed command как ссылка на опубликованный
system intent с bounded condition/occurrences. После commit scheduler отправляет
его через тот же dispatcher. Системный `commandId` состоит из `sys_` и 43
символов `base64url` без `=` от SHA-256 канонического JSON-массива с меткой
`cubica.system-command/v1`, `sessionId`, случайным серверным `scheduleId` и
номером occurrence. Префикс не даёт полномочий: системное происхождение
подтверждает только внутренний аутентифицированный канал. Каждое срабатывание —
отдельная transaction;
synchronous recursive trigger chain и скрытый system-clock read запрещены.

## 8. Транзакционная семантика

Шаги выполняются по порядку над candidate state. Каждый следующий шаг видит
результат предыдущих успешных команд. Target set фиксируется в начале шага и
обрабатывается в каноническом порядке.

Runtime формирует новое состояние, random counters, events и audit на пробной
копии. Commit выполняется один раз после успеха всех шагов. Ошибка:

- отбрасывает candidate state;
- не расходует random stream;
- не публикует события и журнал;
- не увеличивает session version;
- не показывает закрытые данные в диагностике.

Внутри одного шага после разрешения целей одно конечное поле может встретиться
не более одного раза, если команда не объявляет ассоциативную и коммутативную
агрегацию. Разные последовательные шаги могут писать в одно поле; они
применяются в объявленном порядке, который является частью replay.

### 8.1. Идемпотентность команды

Для внешнего клиента `commandId` является идентификатором логической команды и
сохраняется при повторной HTTP-доставке и перезагрузке клиента. Он состоит из
`cli_` и 22 символов `base64url` без `=` от 16 байт, созданных
криптографически стойким генератором.
Транспортный `requestId` и OpenTelemetry `traceId/spanId` могут различаться
между попытками и не участвуют в дедупликации. Системный профиль `sys_` имеет
отдельную внутреннюю схему; публичный endpoint его не принимает.

Principal — доверенный пользователь, устройство или контроллер доставки;
actor — участник или роль внутри игры. В хотсите стабильный principal управляет
несколькими местами, поэтому actor разрешается при первом принятии команды,
сохраняется в receipt и не вычисляется заново после смены хода.
Тело публичной команды не содержит доверенного `playerId`.

После свежей аутентификации principal и проверки текущего права чтения session
runtime под lock ищет receipt по `sessionId + principalId + commandId` и только
затем проверяет `expectedStateVersion`:

- тот же canonical fingerprint возвращает исходную публичную receipt без
  повторного IR, RNG, событий и игровой авторизации, а рядом отдаётся текущая
  player projection;
- другой fingerprint с тем же `commandId` даёт `COMMAND_ID_REUSED`;
- новая команда разрешает actor и проходит version/params/availability/
  authorization/budget checks;
- state, random counters, events, audit и внутренняя receipt сохраняются одним
  commit.

Fingerprint включает `actionId`, canonical params, expected version и pinned
definition. Malformed/unauthenticated и временные инфраструктурные сбои не
получают terminal receipt; стабильный допущенный игровой отказ может её
получить. `expectedStateVersion` остаётся защитой от двух разных команд на одной
версии и не заменяет command idempotency.

### 8.2. Системное срабатывание

Планировщик не может заранее знать версию состояния в момент исполнения,
поэтому доверенная внутренняя команда не содержит `expectedStateVersion`. Это
не ослабляет публичный контракт: внешний клиент всегда обязан передать версию и
не может выбрать системный профиль по префиксу строки.

Под session lock dispatcher сначала ищет квитанцию, затем загружает ожидаемое
срабатывание и проверяет его session/schedule/occurrence, закреплённые bundle и
definition, момент исполнения и условие на текущем авторитетном состоянии.
После системной авторизации и проверки бюджета он одной транзакцией сохраняет
state, RNG, events, audit, receipt и отметку о потреблении occurrence.
Отпечаток включает schedule, occurrence, intent, params и закреплённые hashes,
но не неизвестную заранее версию.

Объявленная политика ложного условия выбирает `defer` без терминальной
квитанции либо атомарный `skip` с терминальной квитанцией. Так условие trigger
заменяет только клиентскую version precondition, но не блокировку,
авторизацию или защиту от повторного применения.

## 9. Безопасность данных

Checker выводит для каждого значения:

- обычный value type;
- confidentiality через `audienceRef`;
- integrity: manifest constant, server value, проверенный module result либо
  untrusted client/agent input.

Результат получает не менее строгие labels, чем входы. Label условия переносится
на управляемую ветку: server-only predicate не может условно менять public field
или public availability.

`availability` читает только player-visible context. `authorization` остаётся
server-only и не раскрывает причины отказа. Общего `reveal` нет. Текущим играм
нужны только узкие доверенные раскрытия:

- random command публикует результат, но не состояние генератора;
- deck draw публикует разрешённую карту, но не будущий порядок колоды.

Внутренняя receipt содержит fingerprint, `planHash` и закрытые audit refs;
публичная receipt является отдельной schema-defined проекцией. Для текущего
учебного продукта раскрытие идентичности ветви через `planHash` не считается
критичным и не блокирует выпуск, но сырые закрытые значения не публикуются.
Будущий чувствительный продукт может скрыть внутренние поля без смены command
ledger.

## 10. Детерминизм и стоимость

Игровой порядок не зависит от insertion order JSON, базы данных или locale.
Каждый объявленный ключ сортировки использует каноническое платформенное
правило сравнения; если все ключи равны, стабильный ID сущности является
обязательным последним разрешителем равенства. Системное время доступно только
как записанное событие.

Независимые подсистемы используют именованные random streams, чтобы новый
бросок не менял будущие карты. Опубликованный IR получает hash по каноническому
JSON; session закрепляет один content-addressed `bundleHash`, который включает
планы, action catalog, schemas, compiler, modules, budgets и версии
случайности. Одного IR hash недостаточно.

Стоимость ограничивается на двух уровнях:

1. Publisher checker оценивает source capacity, result bounds, expression
   depth/nodes, sort/aggregate/algorithm complexity.
2. Runtime считает посещённые элементы, weighted operations, память,
   intermediate/output size и algorithm-specific work.

Budget profile принадлежит платформе и версионируется. Игра не повышает его.
Один `maxMatches` не является защитой: scan может быть дорогим и вернуть ноль.

## 11. Модульное расширение

Различаются четыре границы с разными полномочиями:

1. **Mechanics capability pack** живёт в доверенном build/publish-контуре:
   schemas, macros, intent templates, discovery и lowering rules. Он не
   является сам по себе разрешением выполнить код во время партии.
2. **Platform runtime module** поставляет общую schema, checker, executor, cost
   model и neutral conformance corpus; точная версия закрепляется в
   `moduleLock`.
3. **UI capability pack** поставляет только клиентское представление и ввод по
   ADR-066 и не владеет правилами.
4. **Game runtime extension** поставляет код только одной игры, когда IR и
   общие modules недостаточны. Он закрепляется в bundle игры и исполняется
   только через изолированный runner.

Есть четыре разрешённых уровня расширения:

1. Game authoring macro компилируется в существующий IR и исчезает до runtime.
2. Pure function добавляется в закрытый expression vocabulary с types, flow
   rules и cost.
3. Platform module добавляется для общей математической задачи или
   защищаемого инварианта.
4. Изолированное game extension добавляется для действительно уникальной
   предметной функциональности, которую нельзя разумно разложить на первые три
   уровня.

Module descriptor фиксирует `moduleId`, точную `moduleVersion`,
`artifactHash`, JSON Schema operations, typed inputs/results, purity или
declared write scope, declassification rules, cost model и conformance corpus.
Значимые версии алгоритмов перечисляются отдельно в `algorithmVersions`;
schemas разрешённых модулей компонуются в закрытый union.

Mechanics packs образуют version-locked acyclic dependency graph. Namespace
collision, incompatible versions и silent override являются publication
errors. Pack может потребовать установленный runtime module и объявить
совместимость с UI pack, но не обязан требовать конкретный UI-канал.

Изолированное game extension принадлежит namespace/bundle игры, получает только
schema-defined state projection, по умолчанию не имеет прямого доступа к
storage, network, filesystem, environment, process spawning или system clock и
ограничено по CPU, времени, памяти и output. Дополнительные права требуют нового
решения о границе безопасности. Предпочтительный результат — чистое значение для
последующих IR-команд; bounded change set допускается только в declared write
scope и применяется самой платформой внутри общей транзакции. Game ID и
subject workflow по-прежнему не попадают в platform module или core branch.

## 12. Authoring, редактор и диагностика

Authoring может использовать предметные названия и компактные макросы. Каждый
макрос имеет typed inputs и детерминированно раскрывается до публикации.

Compiler:

1. проверяет authoring schema;
2. раскрывает macros/templates и `{{...}}` bindings;
3. назначает стабильные step IDs и нормализует defaults;
4. выпускает canonical IR и карту связи с исходником (source map) — таблицу
   соответствия скомпилированных шагов местам в authoring-файле;
5. проверяет runtime JSON Schema;
6. выполняет type/security/cost checker;
7. только после этого записывает manifest.

Runtime не объединяет templates и не выполняет строковую подстановку.

Диагностика содержит стабильный code, `instanceLocation`, authoring pointer,
step ID, expected/actual type и cost, но не secret values. Editor строит формы
из той же JSON Schema. Generated TypeScript union исчерпывающий и не имеет
catch-all `{ [key: string]: unknown }`.

## 13. Сценарии текущих игр

### Antarctica

Template/macros компилируют timeline, metrics, object state, flags, counters,
collections и log в typed commands/events. Условные effects переводятся в общий
Predicate; четыре `preAction` случая получают явную snapshot ref.

### Estate Race

Используемый JsonLogic subset переводится в typed AST. Turn selection,
player-scoped state и economy transfer используют общие query/command modules;
random roll использует named trusted random stream.

### «Карты, деньги, поезда»

- due activation: select по времени/state → remove blocking reason → select на
  candidate state → activate;
- reset хода: select фактических active units → update resource, включая
  купленные объекты;
- road/waypoint: graph/geometry algorithm → payment/create/lifecycle commands;
- move/attach/detach/cargo: graph/relation predicates и commands;
- ranking: select/group/aggregate/stable sort/write;
- decks/random остаются versioned trusted modules.

### Simple Choice

Малая игра первой мигрирует basic state/object/metric/event commands и остаётся
нейтральной проверкой общего контура.

### AI Driven Choice

Использует отдельный Agent Runtime и не зависит от deterministic effects.
Narration и Cubica Surface проходят собственную schema/security validation, а
целевая долговременная мутация сходится в actor-scoped Game Intent → Mechanics
IR. Прямые agent state effects/patches являются legacy-контрактом миграции.

## 14. Миграция и удаление старого пути

Конечная граница принята ADR-084:

- новые effects заморожены;
- одноразовый offline translator переносит механические операции;
- old interpreter используется только как сравнительный эталон (differential
  oracle) — тестовый запуск для сопоставления результатов, недоступный
  production-запросам;
- одинаковые state/params/seed сравниваются по state, events, errors и random
  counters;
- subject transport/ranking workflows раскрываются вручную, а нейтральные
  algorithms сохраняются modules;
- authoring, mock builder, manifests/source maps, editor, types, validators,
  tests и sessions мигрируют до cutover;
- существующие `actionId` формально становятся Game Intents без переименования,
  client command maps и fallback names удаляются, а `payload` сводится к
  единственному `params`;
- доверенный `playerId` удаляется из тел `/actions`, Agent Turn и защищённых
  preview; principal приходит только из аутентификации, actor разрешается
  сервером;
- session получает immutable `bundleHash`, action/pack/compiler/module/
  budget/random locks, а receipt — конкретный `planHash`; старая партия
  replay-проверяется только при наличии истории и точных старых правил, иначе
  проходит проверенную snapshot-миграцию либо архивируется;
- durable command receipt хранится атомарно со state/events/random/audit до
  production cutover;
- runtime, manifests, content cache и editor preview переключаются lockstep;
- после этого удаляются `deterministic.effects`, 29 variants, old types,
  condition/switch executor, runtime template resolution, subject entry points,
  translator и oracle.

Постоянный adapter запрещён. Поэтапная разработка не означает двух production
языков.

## 15. Границы безопасного исполнения

- В обычном IR нет arbitrary JavaScript, network, filesystem, environment или
  system clock; game extension допускается только в изолированном runner с
  явными правами и budgets.
- Нет generic eval, module call, JSON Pointer/JSONPath или client-selected op.
- Нет client/LLM-provided IR, Presenter lowering или отдельного action/intent
  catalog.
- Нет доверия к клиентскому `playerId` или к префиксу системного `commandId`.
- Нет unbounded recursion, loops, collections или intermediate results.
- Нет public availability, зависящей от server-only data.
- Нет partial batch success и silent last-write-wins.
- Нет game-specific branch или game ID в platform core.
- Нет semantic reliance на JSON/database/locale order.
- Нет продолжения session на другой программе без явной миграции.
- Нет permanent old-effects fallback после cutover.
- Нет точного retry, который исполняет уже принятую команду второй раз.

## 16. Источники

- ADR-083: universal composable gameplay mechanics.
- ADR-084: Game Intents, capability catalog and typed transactional Mechanics
  IR.
- JSON Schema 2020-12: https://json-schema.org/draft/2020-12
- CEL specification: https://github.com/google/cel-spec
- OPA policy language and capabilities: https://www.openpolicyagent.org/docs/policy-language
- Cedar schema and validation: https://docs.cedarpolicy.com/schema/schema.html
- W3C SCXML: https://www.w3.org/TR/scxml/
- RFC 6902 JSON Patch: https://www.rfc-editor.org/rfc/rfc6902.html
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785.html
- AWS idempotent API practice: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- MCP client discovery practice: https://modelcontextprotocol.io/docs/develop/clients/client-best-practices
- `docs/reviews/2026-07-14-universal-gameplay-mechanisms-audit.md`.
- `docs/tasks/artifacts/TSK-20260711-cards-money-trains-game/universal-gameplay-mechanisms-matrix.md`.
