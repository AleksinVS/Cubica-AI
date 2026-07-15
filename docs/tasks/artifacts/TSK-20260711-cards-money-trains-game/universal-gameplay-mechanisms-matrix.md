# Матрица текущих игровых механизмов и целевых замен

## Оглавление

- [Назначение и метод](#назначение-и-метод)
- [Обозначения классов](#обозначения-классов)
- [Покрытие игр](#покрытие-игр)
- [Точные количества старых операций](#точные-количества-старых-операций)
- [Публичные эффекты](#публичные-эффекты)
- [Условия, ссылки и композиция](#условия-ссылки-и-композиция)
- [Исполнение, authoring, редактор и проекция](#исполнение-authoring-редактор-и-проекция)
- [Карта целевых примитивов](#карта-целевых-примитивов)
- [Очередность миграции](#очередность-миграции)

## Назначение и метод

Матрица фиксирует фактическое состояние на 2026-07-14 для стадии A аудита.
Она охватывает каноническую JSON Schema, серверное исполнение, authoring-слой
(редактируемый источник игры, из которого компилятор выпускает runtime-манифест),
редактор, Presenter, шесть исполнимых игровых манифестов и их тестовые
фикстуры. Публичный контракт и поведение игр в этой стадии не менялись.

Подсчёт разделяет три величины: декларации в runtime JSON, редактируемые
authoring-источники и шаги после фактического runtime-раскрытия шаблонов.
Внутренние операции JSON Patch `add`/`replace` не смешивались с типами игровых
эффектов.

Каноническая схема содержит 29 вариантов публичного эффекта в
`GameManifestDeterministicEffect` (`docs/architecture/schemas/game-manifest.schema.json:1605`).
Во всех шести манифестах найдено 196 действий `manifest-data`, 693 stored
effects и 967 фактически раскрытых шагов. В editable authoring находятся 695
effects: нормативный CMT содержит два дополнительных pending actions. Целевой
результат удаляет весь `deterministic.effects[]`, а не только узкие transport
варианты.

## Обозначения классов

- **U — универсальный примитив:** нейтральная операция, пригодная как часть
  общего языка.
- **A — общий алгоритм:** воспроизводимая математическая, графовая или
  stateful-операция, которую не следует раскладывать до сырых записей.
- **M — authoring-макрос:** предметное удобное имя допустимо в исходнике игры,
  но компилятор должен раскрывать его в общий runtime-язык.
- **N — узкий runtime-эффект:** общий движок кодирует предметный сценарий;
  нужна миграция.
- **L — удаляемая legacy-форма:** полезная семантика переносится, но старое имя,
  envelope, тип и runtime entry point не входят в целевой контракт.

## Покрытие игр

| Игра | Действия / шаблоны | Stored / expanded | Основные механизмы и замечания |
|---|---:|---:|---|
| `antarctica` | 141 / 4 | 522 / 796 | 138 действий template-backed; 6 template effects раскрываются в 280 применений; 483 stored effects находятся в overrides. |
| `simple-choice` | 1 / 0 | 7 / 7 | Нейтральная малая фикстура object/state/metric/timeline/log операций. |
| `ai-driven-choice` | 0 / 0 | 0 / 0 | Использует отдельный Agent Runtime; old gameplay effects отсутствуют. |
| `estate-race` | 10 / 0 | 61 / 61 | 8 схем параметров и 8 `x-cubica-ref`; random/turn/economy и ограниченный JsonLogic subset. |
| `cards-money-trains` | 6 / 0 | 8 / 8 | Editable source содержит 10 effects: road/waypoint пока только `pendingActions`. |
| `cards-money-trains-mock` | 38 / 0 | 95 / 95 | Единственный runtime-потребитель transport/deck/ranking; source of truth — builder нормативной игры. |
| **Всего** | **196 / 4** | **693 / 967** | Editable authoring — 695 effects. |

Итоговое наиболее массовое stored-использование: `metric.add` — 250 деклараций,
`log.append` — 185, `state.patch` — 79, `timeline.set` — 61. После раскрытия
Antarctica фактическое число `timeline.set` равно 195, а `object.state.set` —
157. Два известных
дефекта локализованы в mock-пакете: два вызова
`transport.construction.activateDue` и явное обновление только двух стартовых
локомотивов вместо фактической активной коллекции.

## Точные количества старых операций

`Stored` — число деклараций в runtime JSON. `Expanded` — число шагов, которые
получаются после runtime-раскрытия шаблонов и overrides.

| Старый `op` | Stored | Expanded | Основной потребитель |
|---|---:|---:|---|
| `runtime.server.request` | 1 | 1 | Antarctica |
| `timeline.set` | 61 | 195 | Antarctica, Simple |
| `random.roll` | 1 | 1 | Estate |
| `deck.shuffle` | 2 | 2 | CMT mock |
| `deck.draw` | 3 | 3 | CMT mock |
| `metric.add` | 250 | 250 | Antarctica, Estate, Simple |
| `metric.set` | 1 | 1 | Estate |
| `turn.next` | 1 | 1 | Estate |
| `turn.phase.set` | 17 | 17 | Estate |
| `metric.transfer` | 15 | 15 | Estate, CMT mock |
| `transport.road.build` | 1 | 1 | CMT mock; ещё один pending в normative source |
| `transport.waypoint.build` | 1 | 1 | CMT mock; ещё один pending в normative source |
| `transport.construction.activateDue` | 2 | 2 | CMT mock |
| `transport.vehicle.move` | 1 | 1 | CMT mock |
| `transport.vehicle.attach` | 2 | 2 | CMT mock |
| `transport.vehicle.detach` | 1 | 1 | CMT mock |
| `transport.cargo.load` | 1 | 1 | CMT mock |
| `transport.cargo.deliver` | 2 | 2 | CMT mock |
| `ranking.compute` | 1 | 1 | CMT mock |
| `state.patch` | 79 | 79 | Все пять deterministic-игр |
| `flag.set` | 10 | 10 | Antarctica |
| `counter.add` | 17 | 17 | Antarctica, CMT mock |
| `collection.append` | 10 | 10 | Antarctica |
| `object.create` | 1 | 1 | Simple |
| `object.state.set` | 17 | 157 | Antarctica, CMT mock, Simple |
| `object.attribute.patch` | 10 | 10 | Estate, CMT mock, Simple |
| `ui.panel.open` | 0 | 0 | Нет |
| `ui.screen.open` | 0 | 0 | Нет |
| `log.append` | 185 | 185 | Все пять deterministic-игр |
| **Всего** | **693** | **967** | — |

## Публичные эффекты

В столбце «Контракт / исполнение» сначала указан источник публичной формы, затем
основной обработчик. Приоритет **P0** означает блокирующую безопасность или
целостность, **P1** — первый игровой рефакторинг, **P2/P3** — последующие
малые группы.

Для всех строк действует единая конечная граница: полезная семантика переносится
в IR или нейтральный algorithm module, но старое имя `op`, effect envelope,
TypeScript variant и runtime switch case удаляются. Временный interpreter не
входит в production-архитектуру.

| Операция | Контракт / исполнение | Фактические игры | Скрытая вычислительная структура | Класс | Целевая форма, миграция и приоритет |
|---|---|---|---|---|---|
| `runtime.server.request` | Schema `:1610`; `deterministicHandlers.ts` | Antarctica, 1 | Переключение служебного UI-флага, а не реальный сетевой запрос | L | Удалить без нового op: сам dispatch уже является серверным вызовом; нужное поле меняется typed command. P2. |
| `timeline.set` | Schema `:1625`; `deterministicHandlers.ts` | Antarctica 60 stored / 194 expanded, Simple Choice 1 | Типизированная запись шага временной линии | M | Authoring-макрос над structured state command и, позднее, event/state-machine module; старый op удаляется. P2. |
| `random.roll` | Schema `:1707`; `sessionRandom.ts` | Estate Race, 1 | Воспроизводимый выбор через сессионный генератор случайности | A | Конкретный random module op с named stream, `ResultRef`, cost и узким trusted public result; old op удаляется. P2. |
| `deck.shuffle` | Schema `:1737`; `deckEffects.ts:101` | Mock, 2 | Каноническая выборка источника, секретный порядок, воспроизводимое перемешивание | A | Версионированный secret-safe deck module с typed source, named random stream и лимитами; old entry point удаляется. P2. |
| `deck.draw` | Schema `:1764`; `deckEffects.ts:54` | Mock, 3 | Атомарное извлечение из секретного порядка с discard/empty-policy | A | Сохранить алгоритмом, унифицировать `onEmpty`, результат и предел размера. P2. |
| `metric.add` | Schema `:1791`; `deterministicHandlers.ts` | Antarctica 248, Estate 1, Simple 1 | Числовая запись в типизированную конечную точку | U | Числовая typed command с `ValueExpr`; offline translator переносит данные, старое имя и handler удаляются. P2. |
| `metric.set` | Schema `:1823`; `deterministicHandlers.ts` | Estate Race, 1 | Присваивание числовой конечной точке | U | Та же общая mutation-модель. P2. |
| `turn.next` | Schema `:1882`; `deterministicHandlers.ts:1252` | Estate Race, 1 | Циклический выбор следующего участника с фильтром | M/A | Общий ordered participant selector/algorithm; `eliminated` задаётся predicate манифеста. Старый op удаляется. P2. |
| `turn.phase.set` | Schema `:1900`; `deterministicHandlers.ts` | Estate Race, 17 | Типизированная запись фазы | U/M | Authoring-сокращение над общей mutation с проверкой объявленной фазы. P2. |
| `metric.transfer` | Schema `:1917`; `deterministicHandlers.ts` | Estate 8, Mock 7 | Атомарный дебет/кредит двух конечных точек | U | Сохранить как безопасную атомарную mutation; повторно использовать в transport-макросах. P1/P2. |
| `transport.road.build` | Schema `:1934`; `transportNetwork.ts:871` | Mock, 1; real game — pending authoring | Оплата + ограниченный маршрут по областям + создание ребра + lifecycle | M + A | Route planner остаётся graph/geometry module; payment/create/lifecycle компилируются в transaction. Старый предметный entry point удаляется. P2. |
| `transport.waypoint.build` | Schema `:1971`; `transportNetwork.ts:936` | Mock, 1; real game — pending authoring | Разделение ломаной и ребра, создание узла и двух рёбер | M + A | Выделить `graph.edge.splitAtFraction`; оплату и lifecycle оставить композиции игры. P2. |
| `transport.construction.activateDue` | Schema `:2002`; `transportNetwork.ts:804` | Mock, 2 | Выбрать фактические nodes/edges, сравнить срок, снять одну причину блокировки, условно активировать | N | Первый proof: `core.select` + typed comparisons + `core.update` над candidate state. Op и ветка handler физически удаляются. P1, `LEGACY-0063`. |
| `transport.vehicle.move` | Schema `:2021`; `transportNetwork.ts:1035` | Mock, 1 | Графовая достижимость, capacity/coupling, перенос набора и расход ресурса | M + A | Сохранить общий graph movement/capacity algorithm, orchestration раскрыть в transaction. Канонизировать порядок. P2. |
| `transport.vehicle.attach` | Schema `:2039`; `transportNetwork.ts:1121` | Mock, 2 | Проверка совместимости, совместного положения и мощности связи; запись relation | M | Общие typed relation + capacity predicate + resource command; предметный op удаляется после раскрытия macro. P2. |
| `transport.vehicle.detach` | Schema `:2055`; `transportNetwork.ts` | Mock, 1 | Удаление типизированной связи и расход ресурса | M | Typed relation/resource commands; старый op удаляется. P2. |
| `transport.cargo.load` | Schema `:2071`; `transportNetwork.ts` | Mock, 1 | Совместное положение, связь cargo-container и смена фасетов | N/M | Предметный authoring-макрос над relation, selector и mutations. P2. |
| `transport.cargo.deliver` | Schema `:2084`; `transportNetwork.ts:1208` | Mock, 2 | Кратчайший путь, агрегация тарифа, переводы, выгрузка, отсоединение и фасеты | N/M + A | `graph.shortestPath` оставить алгоритмом; остальное раскрыть в transaction. Явно зафиксировать, считается текущий или пройденный путь. P2. |
| `ranking.compute` | Schema `:2100`; `rankingEffects.ts:65` | Mock, 1 | Select → group → aggregate → deterministic sort/rank → winners | N/M | Общие aggregate/group/sort/rank над Selector и ValueExpr; экономический состав остаётся макросом игры. P2. |
| `state.patch` | Schema `:2162`; `deterministicHandlers.ts` | Antarctica 31, Mock 23, CMT 6, Estate 18, Simple 1 | Низкоуровневая запись по пути | L | Offline translator создаёт structured typed commands; произвольный public JSON Pointer и old handler удаляются. До cutover нужен safe-path P0. |
| `flag.set` | Schema `:2185`; `deterministicHandlers.ts` | Antarctica, 10 | Булево присваивание | M | Authoring sugar над canonical Mutation. P2. |
| `counter.add` | Schema `:2213`; `deterministicHandlers.ts` | Antarctica 10, Mock 7 | Числовое приращение | M | Authoring sugar над canonical Mutation. P2. |
| `collection.append` | Schema `:2237`; `deterministicHandlers.ts` | Antarctica, 10 | Добавление элемента в коллекцию | M/U | Canonical collection mutation с limit/uniqueness policy. P2. |
| `object.create` | Schema `:2267`; `deterministicHandlers.ts` | Simple Choice, 1 | Создание типизированного объекта | U | Сохранить в mutation-словаре; валидировать атрибуты по объявлению object model и лимит коллекции. P2. |
| `object.state.set` | Schema `:2320`; `deterministicHandlers.ts` | Antarctica 11, Mock 5, Simple 1 | Изменение одного фасета одного статического ID | U | Сохранить single-target форму; массовая форма использует Selector и тот же mutation. P1. |
| `object.attribute.patch` | Schema `:2352`; `deterministicHandlers.ts:418` | Mock 5, Estate 4, Simple 1 | Патч атрибута одного объекта | U с P0-разрывом | Общий safe typed attribute mutation; запретить опасные сегменты и валидировать тип атрибута. P0/P1. |
| `ui.panel.open` | Schema `:2399`; `deterministicHandlers.ts` | Нет | Навигационная команда Presenter | L | Удалить из gameplay schema без миграции данных; UI manifest/Presenter владеют навигацией. P1 cleanup. |
| `ui.screen.open` | Schema `:2427`; `deterministicHandlers.ts` | Нет | Навигационная команда Presenter | L | Удалить из gameplay schema без миграции данных; UI manifest/Presenter владеют навигацией. P1 cleanup. |
| `log.append` | Schema `:2454`; `deterministicHandlers.ts:1293` | Все action-игры, 185 | Добавление журналируемого события | U с P0-разрывом | Typed `events.emit`; audit envelope неизменяем, payload bounded и label-checked. Старый op удаляется. P0/P2. |

### Внутренние повторения, влияющие на эффекты

- Перевод денег реализован и общим `metric.transfer`, и отдельно внутри
  transport payment flow. В транспортной версии несколько списаний с одного
  баланса могут читать одно исходное значение; её следует заменить общей
  агрегированной транзакцией (`transportNetwork.ts:340`).
- Поиск объекта, проверка типа/фасета и безопасные пути повторены в
  `deterministicHandlers.ts`, `transportNetwork.ts`, `deckEffects.ts` и
  `rankingEffects.ts`.
- `state.patch`, `flag.set`, `counter.add`, `collection.append`, metric и
  object mutations являются разными именами одной модели «вычислить значение и
  записать в типизированную конечную точку».
- Часть обработчиков обходит свойства объектов в порядке вставки; ranking
  использует `localeCompare`. Целевой порядок должен задаваться платформой и
  быть одинаковым после JSON/PostgreSQL round-trip.

## Условия, ссылки и композиция

| Механизм | Контракт / исполнение | Игры | Текущий статус | Целевая замена и приоритет |
|---|---|---|---|---|
| Action guard | Schema `:1240-1330`; `deterministicHandlers.ts` | Antarctica, Estate, CMT, Mock, Simple | Поддерживает object/state/timeline/turn/count/JsonLogic, но допускает неизвестные поля и смешивает public availability с server authorization | Два закрытых Predicate: public-only `availability` и server-only `authorization`; offline lowering старой формы. P0/P1. |
| Effect `when` | Schema `:1447-1605`; `deterministicHandlers.ts:1382` | Antarctica и Estate | Отдельная, более чистая форма metric/state/count/JsonLogic/all/any/not; не совпадает с action guard | Использовать тот же `Predicate`, с явным чтением `preAction` или текущего промежуточного состояния. P1. |
| JsonLogic | Schema `:1332-1366`; `json-logic-js` calls | Estate Race guards; computed metrics имеют ещё один поднабор | Произвольное имя оператора, нет глубины/размера/стоимости; разные каналы поддерживают разные подмножества | Строгий JSON AST с типами и бюджетом; фактический subset переводится offline, runtime JsonLogic удаляется. P0/P1. |
| `collectionCount` | Schema `:2523-2561` и дубликат `:1488-1540` | Antarctica | Требует статический массив `ids`; динамические созданные объекты не попадают | Selector + bounded aggregate count. P1. |
| Object guard | Schema `:2725-2763` | Antarctica, Simple | Один явный `objectId` | Predicate над Selector либо typed object ref. P1/P2. |
| `paramsSchema` | Schema `:203-397`; `actionParameters.ts:165-222` | Estate, Mock | Хороший bounded scalar input; `x-cubica-ref` повторно разрешается по живому состоянию | Сохранить. Selector/ResultRef не принимать от клиента как код или путь; клиент передаёт только объявленные opaque IDs. |
| Action template | Schema `:963-978`; resolver `deterministicHandlers.ts:73-146` | Antarctica, 4 шаблона / 138 применений | Runtime-шаблон узок, но placeholders и bindings не типизированы; authoring template открыт | Typed authoring macro с input schema, compile-time раскрытием и обязательной runtime validation. P1/P2. |
| Atomic action | `actionDispatcher.ts:49-65`; `deterministicHandlers.ts:1365-1899` | Все action-игры | Lock/version check и clone rollback уже есть; no-effect action увеличивает version; нет scan/memory/output budget и единой rollback-семантики RNG/events | Ordered candidate transaction; `cardinality`, static/runtime budget, один commit, полный rollback state/RNG/events/version. P1. |
| Результат шага | Отсутствует | Нет | Следующая операция не может типизированно сослаться на выборку/агрегацию предыдущей | `ResultRef` только на предыдущий именованный шаг; тип и область проверяет schema/compiler/runtime. P1. |
| Событие/расписание | Полноценного gameplay-контракта нет | Timeline частично имитирует сценарий | Нет доменного event store; `lastEventSequence` растёт раз на action | Версионированные event/schedule steps после первого selector/mutation slice. P3. |
| Replay/version pin | `packages/contracts/session/src/index.ts:46`; `replayFingerprint.ts` | Все сессии | Сессия не закрепляет hash пакета и версию языка; fingerprint — проверка, не восстановление | Закрепить manifest/IR hash, API, budget profile, random versions и typed module descriptors с отдельными `moduleId` / `moduleVersion` / `artifactHash` / `algorithmVersions`; replay before rebind либо archive. P0/P1, блокирует cutover. |

## Исполнение, authoring, редактор и проекция

| Область | Доказательство | Класс/проблема | Целевое действие |
|---|---|---|---|
| Runtime JSON Schema | `game-manifest.schema.json:122-193` | Actions/effects в основном закрыты; dialect draft-07 (`:3`) | Перейти на 2020-12 для новых модульных `$defs`, строгих `oneOf` и `unevaluatedProperties:false`; валидаторы используют Ajv 2020. P0 contract foundation. |
| Authoring schema | `game-authoring-v2.schema.json:187-228,299-359` | `deterministic`, params и templates почти произвольные объекты; строгий runtime-контракт автор не видит | Authoring v3 или совместимый wrapper переиспользует canonical vocabulary; compiler всегда валидирует результат перед записью. P0/P1. |
| Authoring compiler | `authoring-compiler.cjs:906-930,1212-1299` | Копирует gameplay-блоки; прямой CLI может записать результат без runtime-validation | Compile → canonical runtime validate → write; предметные macros раскрывать до validation. P0/P1. |
| Generated TypeScript | `generated/game-manifest.ts:20-55`; generator header | Производный тип содержит catch-all unknown, а потребители импортируют рукописный `index.ts` | Удалить unknown-collapse, добавить compile-time union tests и сделать generated types реальной consumer surface. P0 contract foundation. |
| Семантический validator | `manifestValidation.ts:157-232` | Transport refs проверяются не для всех ops/templates/overrides | Обходить canonical compiled program целиком; schema отвечает за форму, semantic registry — только за межссылочные инварианты. P1. |
| Editor schema | `apps/editor-web/src/lib/editor-json-schema.ts:1-32` | Регистрирует authoring, но не строгий gameplay vocabulary | Resolver `$ref`/`oneOf`, формы по `op`, diagnostics с source-map. P1 после фиксации контракта. |
| Editor entities/forms | `entity-projection.ts:1059-1095`; `property-panel.tsx:179-208` | Guard/effect/template не first-class; сложный JSON правится textarea | Вложенные steps/selectors/mutations как сущности и schema-driven controls. P1/P2. |
| Player projection | `playerSessionProjection.ts:14-24` | Из полного state удаляются только `secret.random` и `secret.decks`; иные secret/runtime/player поля могут уйти клиенту | Белый список player-facing snapshot; secret закрыт по умолчанию. P0 до selector language. |
| Snapshot application | `runtime.service.ts:47-53`; `game-presenter.ts:391-399,441-445`; `view-protocol/src/state.ts:38-55` | Полный снимок местами применяется как Merge Patch, поэтому удалённые ключи остаются, а `null` меняет смысл | Один явно маркированный full-snapshot contract и полная замена на клиенте. P0. |
| Action availability | `actionAvailability.ts:31-113`; `game-presenter.ts:54-74`; `button-component.tsx:45-50` | Разные actor/actionId; secret-aware guard может стать однобитным каналом | Канонический actor/action ID; отдельный public-only `availabilityPredicate`; authorization guard не публикуется. P0. |
| Safe write paths | `deterministicHandlers.ts:418-461` | `object.attribute.patch` не запрещает все prototype-сегменты | Общий safe-path resolver и предпочтение structured typed endpoints. P0. |
| Request/audit bounds | `httpServer.ts:59-74`; `deterministicHandlers.ts:611,1326` | Нет явного лимита body/lastPayload; log data может перезаписать служебные поля | Лимиты, schema stripping/validation и неизменяемая audit envelope. P0 hardening. |
| Command identity | `runtime-client.ts:125-193`; `packages/contracts/session/src/index.ts` | Клиент передаёт `playerId`, дублирует `params/payload`, а `expectedStateVersion` не возвращает исходную квитанцию после lost response | Principal только из аутентификации, actor разрешается сервером; удалить доверенный `playerId`. Внешний случайный `cli_` сохраняется на retry, внутренний `sys_` выводится из schedule/occurrence; receipt lookup выполняется до version check, а системный trigger проверяется под session lock. P0/P1. |
| `playersTemplate` | `turnBasedSessionState.ts:66-113`; Estate manifest `:94-108` | Полезный init macro, но `visibility` не переносится в проекцию | Сохранить как typed session-init macro; исправить visibility вместе с P0 projection. P0/P2. |
| Read-only UI filter | `actionAvailability.ts`; game plugin `accessible-actions.ts` | Универсальный Presenter-механизм, но привязка кнопки расходится | Сохранить read-only; после P0 использовать только canonical server availability и явно опубликованные presentation filters. |

## Карта целевых примитивов

Цель — один версионированный Cubica Mechanics IR с несколькими согласованными
словарями, а не несколько независимых языков. Все словари используют общую
state model, типы ссылок и безопасности, результаты, budgets и транзакцию.

| Примитив | Минимальная ответственность | Первый доказательный потребитель | Не входит в первый срез |
|---|---|---|---|
| `StateModel` | Record/entity/ref types; `public|player(owner)|server`; collection capacity/key/order; allowed writes | Units, nodes/edges, players | Произвольный JSON traversal |
| `TypedEndpoint` | Структурированный field/facet/attribute/metric/relation ref с value/security type | Ресурс действия и lifecycle | Клиентский JSON Pointer |
| `core.select` | Typed collection filters, canonical order и `cardinality.min/max` | Фактические active units; due nodes/edges | Полный SQL-подобный запрос |
| `Predicate` / `ValueExpr` | Bounded closed AST; context/item/result refs; comparisons и ограниченная арифметика | Due-time, blocking reasons, значение 5 | JsonLogic/CEL string, пользовательская функция |
| `ResultRef` | Ссылка только назад с value/confidentiality/integrity type | Select → update, algorithm → write | Путь к произвольному runtime object |
| `core.update` | Typed single/bulk command без partial success | Оба обязательных сценария первого среза | Graph planning как mutation |
| `Transaction` | Ordered candidate steps, immutable target set per step, one commit/full rollback | Lifecycle и resource reset | Долгоживущий фоновой процесс |
| `BudgetProfile` | Static cost + runtime scan/operator/memory/output/algorithm cost; manifest не повышает cap | Neutral stress/rollback fixture | Один `maxMatches` как единственная защита |
| Module op | Конкретная versioned deck/random/graph/geometry schema с typed I/O, flow rules и conformance tests | Road planner, deck, random roll | Generic untyped `algorithm.call` |
| `DomainEvent` / `Schedule` | Typed event, trigger и due condition с replay version | Последующая timeline/turn миграция | Первый selector/mutation slice |
| Authoring macro | Предметное имя и typed inputs; compile-time раскрытие в mechanics program | `construction.activateDue`, cargo/ranking позже | Отдельный runtime DSL для каждой игры |

## Очередность миграции

1. **W0 — граница доверия:** закрытая player projection, точная семантика
   full snapshot, principal только из аутентификации, server-resolved actor без
   доверенного клиентского `playerId`, единый action ID, public-only
   availability, safe writes, bounded request/log. Это отдельный блокер
   безопасности, а не gameplay-срез.
2. **W1 — версии, команды и dialect:** закрепить manifest/IR за session;
   ввести typed module/artifact/algorithm locks, раздельные client/system
   `commandId` и durable receipt transaction; выделить Ajv 2020 validator;
   выполнить dialect-only parity; сделать generated union полезной consumer
   surface.
3. **W2 — IR kernel:** StateModel, typed AST, query/assert/command/ResultRef,
   candidate transaction и двухуровневый budget; neutral fixture + Simple.
4. **W3 — первый игровой proof:** due activation и resource reset всех
   фактических active units, включая купленные; старый op остаётся только
   differential oracle в тестовой ветке.
5. **W4 — Antarctica:** compile-time templates, 522 stored/796 expanded steps,
   69 общих conditional effects с Estate и четыре `preAction` случая.
6. **W5 — Estate Race:** offline JsonLogic lowering, random/turn/economy/player
   state; trusted random/deck information-flow rules.
7. **W6 — normative CMT, затем mock builder:** graph/geometry modules,
   relation/cargo/ranking macros, road preview по typed result, regeneration.
8. **W7 — editor и cutover:** schema-driven forms, карты связи generated-IR с
   authoring-исходниками, session replay or archive, lockstep
   runtime/manifests/cache switch; удалить old schema, types, switch, subject
   entry points, translator и oracle.

`LEGACY-0063` остаётся active до W7. Постоянного адаптера между old effects и
IR нет; разработка поэтапна, production-переход один.
