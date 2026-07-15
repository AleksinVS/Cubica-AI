# Аудит универсальных механизмов игрового движка

## Оглавление

- [Короткий вывод для PM](#короткий-вывод-для-pm)
- [Как понята архитектурная задача](#как-понята-архитектурная-задача)
- [Что проверено](#что-проверено)
- [Какие лучшие практики изменили предложение](#какие-лучшие-практики-изменили-предложение)
- [Фактический масштаб и зависимости игр](#фактический-масштаб-и-зависимости-игр)
- [Где именно живёт старая форма](#где-именно-живёт-старая-форма)
- [Главные выводы аудита](#главные-выводы-аудита)
- [Что уже можно сохранить](#что-уже-можно-сохранить)
- [Целевая архитектура](#целевая-архитектура)
- [Предлагаемая публичная форма](#предлагаемая-публичная-форма)
- [Первый ограниченный вертикальный срез](#первый-ограниченный-вертикальный-срез)
- [Последовательность миграции](#последовательность-миграции)
- [Как изменится создание следующей игры](#как-изменится-создание-следующей-игры)
- [Совместимость и версии](#совместимость-и-версии)
- [Рассмотренные альтернативы](#рассмотренные-альтернативы)
- [Риски и контроль](#риски-и-контроль)
- [Конкретная точка архитектурного решения](#конкретная-точка-архитектурного-решения)
- [Принятое расширение 2026-07-15](#принятое-расширение-2026-07-15)
- [Решения повторного ревью 2026-07-15](#решения-повторного-ревью-2026-07-15)
- [Результат стадии A](#результат-стадии-a)

## Короткий вывод для PM

Удалять нужно не несколько транспортных команд, а всю публичную ветку
`deterministic.effects[]`. В схеме объявлено 29 вариантов, пять игр хранят 693
эффекта в runtime-манифестах, а после раскрытия шаблонов runtime фактически
исполняет 967 шагов. В редактируемых authoring-источниках находятся 695
эффектов: два дополнительных действия road/waypoint пока существуют только как
ожидающие публикации. Два UI-эффекта не используются ни одной игрой и удаляются
без переноса поведения.

Рекомендация после изучения практик безопасных декларативных языков стала шире
первоначального `objects.updateMany`: основой должен быть Cubica Mechanics IR —
типизированный транзакционный план. Он разделяет чистые запросы, утверждения,
изменяющие команды и версионированные алгоритмы. Массовое изменение объектов —
одна команда этого плана, а не центральная модель всего движка.

Гибкость для будущих игр обеспечивается четырьмя управляемыми уровнями:
компилируемыми макросами игры, чистыми типизированными функциями, нейтральными
платформенными модулями и изолированным исполняемым модулем конкретной игры,
если первых трёх уровней объективно недостаточно. Каждый runtime-модуль имеет
точную версию, JSON Schema, типы, правила доступа и модель стоимости; игровой
код дополнительно изолирован от процесса и хранилища платформы.

Первый gameplay-срез должен одновременно доказать две ситуации:

1. открыть все фактически созревшие объекты без слова «строительство» в общем
   runtime-эффекте;
2. восстановить ресурс всем фактически активным транспортным объектам, включая
   купленные во время партии, без перечисления ID.

До первого среза нужен отдельный P0-блок безопасности. Сейчас клиентская проекция
удаляет лишь две известные части `secret`, полный серверный снимок местами
применяется как частичное изменение, а guard доступности может читать секретные
данные. Универсальные выборки усилили бы эти разрывы, поэтому границу
public/secret нужно закрыть раньше.

Постоянный адаптер старых эффектов отклонён. Разработка может идти небольшими
проверяемыми срезами, а старый исполнитель до переключения может служить только
тестовым эталоном. Финальный переход должен одновременно заменить все
authoring-источники, производные манифесты, runtime и привязки сессий, после чего
старые schema/types/handlers и одноразовый конвертер удаляются.

Исполняемая JSON Schema, runtime и игровые манифесты на стадии A не менялись.
Конкретная целевая форма зафиксирована как принятое архитектурное решение в
ADR-084 на основании прямого поручения PM продолжать без отдельного
согласования.

## Как понята архитектурная задача

Уже принято решение, что публичный язык игрового движка должен быть
универсальным и комбинируемым, даже если первый доказательный потребитель пока
один. Дополнительное решение PM понято так: целевой результат обязан полностью
удалить старую ветку эффектов, а не сохранить её как постоянный совместимый
режим. Текущая задача — определить безопасную форму нового языка и доказуемый
путь полного перехода.

Под «универсальным» понимается нейтральная вычислительная структура: выбрать,
проверить, вычислить, упорядочить и изменить. Под «authoring-макросом» понимается
удобная предметная команда автора игры, которую компилятор раскрывает в эту
структуру до публикации. Например, автор может видеть «открыть готовое
строительство», но runtime должен получить ограниченные операции над объектами,
временем и причинами блокировки.

Стадия A ограничена аудитом и проектированием исполняемого контракта. Поскольку
PM явно разрешил продолжать без отдельного архитектурного checkpoint, точная
целевая форма уже отражена в ADR и каноническом обзоре архитектуры; изменение
JSON Schema и поведения начинается отдельными проверяемыми срезами стадии B.

## Что проверено

Аудит охватил:

- каноническую JSON Schema игрового манифеста и все 29 вариантов effect;
- guards, effect conditions, JsonLogic, параметры и `x-cubica-ref`;
- обработчик детерминированных действий, транспорт, рейтинг, колоды,
  случайность, ходы и состояние участников;
- authoring schema, компилятор, карты связи с исходником (source maps) —
  таблицы соответствия generated-шагов местам в authoring-файлах — и
  производные TypeScript-типы;
- семантический validator, editor schema/forms и projection entities;
- player-facing session projection, Presenter и серверную доступность действий;
- шесть исполнимых игровых манифестов, authoring-источники, mock-builder,
  опубликованные плагины и точечные фикстуры.

Рабочее дерево было грязным до начала аудита. Чужие изменения не откатывались и
не перезаписывались. Полная доказательная матрица находится в
[`universal-gameplay-mechanisms-matrix.md`](../tasks/artifacts/TSK-20260711-cards-money-trains-game/universal-gameplay-mechanisms-matrix.md).

Через Context7 сверены практики JSON Schema 2020-12 и Ajv 8. Для нового
модульного контракта существенны `$defs`/`$ref`, отдельный Ajv 2020 entry point,
`unevaluatedProperties: false` для закрытия составных схем и точный
`op: const` для вариантов. Текущая каноническая схема остаётся на draft-07,
поэтому переход dialect должен быть отдельным проверяемым срезом до добавления
IR, чтобы ошибки смены dialect не смешались с ошибками нового языка.

## Какие лучшие практики изменили предложение

| Источник | Принцип | Следствие для Cubica |
|---|---|---|
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) и [compound documents](https://json-schema.org/blog/posts/bundling-json-schema-compound-documents) | Модульные `$defs`/`$ref`, самостоятельные schema resources и корректное закрытие композиции | Общая основа и schemas модулей собираются в переносимый закрытый контракт; Ajv-specific `discriminator` не является семантикой языка. |
| [CEL specification](https://github.com/google/cel-spec) и [CEL-Go](https://github.com/google/cel-go) | Parse/check/evaluate, предварительно проверенный типизированный AST, host-owned functions, отсутствие произвольных мутаций и полного по Тьюрингу языка | Выражения — чистое закрытое JSON-дерево; типы и стоимость проверяются до публикации, а случайность и изменения остаются отдельными командами. |
| [OPA policy language](https://www.openpolicyagent.org/docs/policy-language), [strict errors](https://www.openpolicyagent.org/docs/errors) и [capabilities](https://www.openpolicyagent.org/docs/extensions) | Строгая компиляция, разрешённый набор встроенных операций и явное отделение недетерминированных функций | Профиль модулей фиксируется в манифесте; неизвестный `op`, окружение, часы и сеть недоступны. |
| [Cedar schema](https://docs.cedarpolicy.com/schema/schema.html) и [validation](https://docs.cedarpolicy.com/policies/validation.html) | Schema является контрактом приложения и позволяет ловить ошибки до исполнения | Коллекции, поля, ссылки и действия получают типы; изменение модели требует повторной проверки всех программ. |
| [W3C SCXML](https://www.w3.org/TR/scxml/) | Явный порядок переходов, очереди событий, microstep/macrostep и защищённые системные переменные | Будущий event/schedule-модуль должен иметь детерминированную очередь и не разрешать обычной игре менять служебные поля. Полный SCXML не внедряется. |
| [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902.html) и [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) | Ошибка последовательности не оставляет частично применённый результат; канонический JSON пригоден для стабильного fingerprint | Транзакция имеет полный rollback, а опубликованный IR получает воспроизводимый hash. Семантический порядок коллекций всё равно задаётся отдельно. |

Из этих практик получены четыре существенных улучшения относительно первого
варианта:

1. Центром является не bulk-update, а типизированный транзакционный план.
2. Одного `maxMatches` недостаточно: каждая коллекция имеет максимальную
   ёмкость, публикация получает статическую оценку, а runtime — счётчик
   стоимости, памяти и выхода.
3. Метка значения включает не только public/secret, но и целостность источника;
   секретность условия переносится на управляемую им ветку.
4. `onNoMatch` заменяется общей `cardinality.min/max`; частичного успеха нет.

## Фактический масштаб и зависимости игр

В репозитории шесть runtime-манифестов и 196 действий `manifest-data`. Число
хранимых эффектов меньше числа фактических шагов, потому что runtime до сих пор
сам раскрывает шаблоны и объединяет переопределения.

| Игра | Действия | Эффекты в runtime | Шаги после раскрытия | Редактируемый источник |
|---|---:|---:|---:|---|
| Antarctica | 141 | 522 | 796 | 522; 138 действий используют шаблоны, 483 эффекта находятся в overrides. |
| Cards–Money–Trains mock | 38 | 95 | 95 | 95, но source of truth — builder, а не сгенерированный JSON. |
| Estate Race | 10 | 61 | 61 | 61; случайность, ходы, переводы и ограниченный JsonLogic. |
| Cards–Money–Trains | 6 | 8 | 8 | 10: два дополнительных pending road/waypoint действия. |
| Simple Choice | 1 | 7 | 7 | 7; минимальная нейтральная фикстура. |
| AI Driven Choice | 0 | 0 | 0 | Использует Agent Runtime, не старые deterministic effects. |
| **Всего** | **196** | **693** | **967** | **695** |

В схеме 29 вариантов, реально используются 27. Неиспользуемые
`ui.panel.open`/`ui.screen.open` должны исчезнуть из gameplay-контракта; открытие
экрана принадлежит UI-манифесту и Presenter. 69 эффектов условные: 52 в
Antarctica и 17 в Estate Race; четыре из них явно читают `preAction` state.

## Где именно живёт старая форма

- Источник публичной структуры — `game-manifest.schema.json`: конверт действия
  (служебные поля вокруг параметров), overrides, templates, `effects`, условие
  `when` и union 29 операций.
- Рукописные типы находятся в `packages/contracts/manifest/src/index.ts`, а
  производная форма — в `src/generated/game-manifest.ts`. Потребители пока не
  используют generated union как единственную поверхность.
- Runtime раскрывает шаблоны и объединяет direct/override effects в начале
  `deterministicHandlers.ts`, затем вычисляет `when` и проходит большой switch.
  Deck, ranking и transport делегированы отдельным файлам, но остаются частью
  того же старого исполнительного пути.
- `manifestValidation.ts` отдельно сканирует transport effects, а
  `transportRoadPreview.ts` ищет позицию `transport.road.build` напрямую в
  `metadata.effects`.
- Редактируемые источники — `games/*/authoring/game.authoring.json`. Исключение:
  mock-пакет заново строится из нормативной игры файлом
  `games/cards-money-trains-mock/tools/build-mock-package.mjs`; ручное изменение
  его authoring/runtime будет потеряно.
- `game.manifest.json` и `game.manifest.source-map.json` каждой игры являются
  производными компилятора. Опубликованные browser `.mjs` не содержат старых
  gameplay ops и не требуют пересборки только из-за envelope; один тест плагина
  Estate Race напрямую читает `deterministic.effects` и должен быть перенесён.
- Сессия хранит `gameId`, необязательный `contentSourceId` и state, но не hash
  программы. Dispatch загружает текущий bundle, поэтому старые партии после
  обновления молча получили бы новую логику. До удаления декодера сессия должна
  быть привязана к неизменяемому `bundleHash`; replay допустим только при
  наличии истории и точных старых правил, иначе нужна snapshot-миграция либо
  явное архивирование.

Полная таблица всех 27 используемых операций, количества, потребителей,
исполнителей и целевой композиции находится в
[`universal-gameplay-mechanisms-matrix.md`](../tasks/artifacts/TSK-20260711-cards-money-trains-game/universal-gameplay-mechanisms-matrix.md).

### Два обязательных доказательства

`transport.construction.activateDue` используется дважды только в mock-манифесте
(`games/cards-money-trains-mock/game.manifest.json:1241` и `:1445`). Обработчик
проходит узлы и рёбра, сравнивает `activationTurn` со счётчиком хода, удаляет
причину `construction-pending` и активирует объект, только если других причин
блокировки не осталось (`transportNetwork.ts:804-868`). Это нейтральная
структура selector + predicate + bulk mutation, скрытая под предметным именем.

Действие следующего хода обновляет только два стартовых локомотива
(`game.manifest.json:1490` и следующий аналогичный patch). Купленный
`mock-market-locomotive-green-2` переводится из reserve в active
(`game.manifest.json:959-1024`), но его ID в обновлении нет. Источник
перечисления находится в mock-builder (`build-mock-package.mjs:650-691`). Это
прямое доказательство, что статические IDs не соответствуют живому состоянию
сессии.

## Главные выводы аудита

### P0. Граница public/secret пока не готова к общим выборкам

Player projection клонирует весь state и удаляет только `secret.random` и
`secret.decks` (`playerSessionProjection.ts:14-24`). Иные секретные поля,
runtime metadata и закрытые данные участников не имеют политики deny-by-default
(«запрещено, пока явно не разрешено»).

Guard и JsonLogic получают полный state (`deterministicHandlers.ts:282-313`).
Та же проверка используется для read-only availability. Даже общий ответ
«условие не выполнено» может раскрывать один бит секретного условия, а будущие
filter/aggregate превратят это в более широкий канал.

Целевое правило:

- player-facing snapshot строится по явному разрешённому контракту;
- `availabilityPredicate` читает только public-контекст;
- `authorizationPredicate` исполняется только сервером и не превращается
  автоматически в подсказку клиенту;
- secret → public/log/availability запрещён без отдельной типизированной
  операции раскрытия, которой нет в первом срезе.

### P0. Клиент и сервер расходятся в смысле снимка

Runtime возвращает полный авторитетный snapshot (`runtime.service.ts:47-53`),
но Presenter местами применяет его как JSON Merge Patch
(`game-presenter.ts:391-399,441-445`). Поэтому удалённый на сервере ключ может
остаться у клиента, а настоящее `null` — ошибочно удалить ключ. Для общего
языка нужна одна семантика: ответ действия является полным снимком и полностью
заменяет предыдущий.

### P0. Пути записи и журнал требуют укрепления

`object.attribute.patch` принимает путь и записывает сегменты без общего
запрета `__proto__`, `constructor`, `prototype`
(`deterministicHandlers.ts:418-461`). Новый язык не должен принимать
произвольную клиентскую строку как путь. Structured endpoint должен задавать
вид конечной точки и безопасное имя атрибута/фасета.

Кроме того, HTTP body и `runtime.lastPayload` не имеют ясного общего лимита, а
`log.data` может перезаписать служебные поля audit entry
(`httpServer.ts:59-74`, `deterministicHandlers.ts:611,1326`). Это нужно закрыть
до появления циклов и массовых результатов.

### P0. Публичный контракт представлен тремя несовпадающими формами

Runtime action/effect schema в основном закрыта, но authoring schema оставляет
`deterministic`, params и templates почти произвольными объектами
(`game-authoring-v2.schema.json:187-228,299-359`). Компилятор в основном копирует
их в runtime (`authoring-compiler.cjs:906-930`).

Сгенерированный TypeScript-тип содержит catch-all unknown-ветви, а реальные
потребители по-прежнему импортируют рукописный тип
(`generated/game-manifest.ts:20-55`, `schema-export.ts:1-3`). Текущая проверка
подтверждает байтовое соответствие генерации схеме, но не полезность
дискриминированного union для кода.

Цель — один schema-first словарь, который переиспользуют runtime, authoring,
compiler, editor и generated types. Семантический код остаётся только для
межссылочных инвариантов, которые нельзя выразить JSON Schema.

### P1. Нет динамического selector и массовой mutation

`collectionCount` требует статический список `ids`; object guard и mutations
работают с одним явным `objectId`. Нет общего filter/sort/group/result binding,
лимита совпадений и массового изменения. Это корневая причина обоих обязательных
дефектов и большей части предметных обработчиков.

### P1. Условия и вычисления раздвоены и не ограничены

Action guard открыт для неизвестных свойств, а рекурсивные `all/any/not` есть
только у отдельного effect condition. JsonLogic допускает любое имя оператора и
не задаёт глубину, количество узлов или вычислительную стоимость. Computed
metrics используют ещё один, отличный поднабор операторов.

Нужен один закрытый `Predicate` и один типизированный `ValueExpr` с белым
списком операций и platform-owned budget. Используемый Estate Race поднабор
JsonLogic (`and`, `!`, `==`, `!=`, `<`, `var`) переводится одноразовым
конвертером в typed AST; JsonLogic не остаётся runtime-адаптером.

### P1. Атомарный фундамент есть, явной политики нет

Runtime блокирует сессию, проверяет версию, исполняет effects над клоном и не
сохраняет клон при ошибке (`actionDispatcher.ts:49-65`,
`deterministicHandlers.ts:1365-1899`). Это хороший фундамент.

Но действие без совпавшего эффекта всё равно успешно увеличивает версию; нет
общей cardinality, ограничения scan/memory/output и общей двухфазной проверки.
Целевая Transaction должна построить и проверить candidate state, а затем
выполнить один commit; при ошибке версия, случайность и события не меняются.

### P1/P2. Не вся предметная операция должна исчезнуть до raw patches

Планирование дороги по областям, разбиение ребра, кратчайший путь, PRNG и
секретная колода являются общими алгоритмами. Их следует оставить отдельными
версионированными модулями с типизированными входами, результатами и лимитами.
Предметный workflow — оплата дороги, доставка груза, подсчёт конкретного
экономического рейтинга — должен стать authoring-макросом над этими алгоритмами
и общими mutations.

## Что уже можно сохранить

- JSON Schema остаётся единственным источником истины публичной структуры.
- Сервер остаётся единственным владельцем авторитетного состояния.
- Version check, session lock, clone-and-commit и PostgreSQL transaction уже
  обеспечивают основу атомарности.
- `x-cubica-ref` — хороший механизм: клиент передаёт opaque ID, а сервер снова
  разрешает его в фактическом состоянии и проверяет collection/type/network.
- PRNG `xoshiro128ss-v1`, deck secret order и region road planner уже являются
  версионированными или воспроизводимыми алгоритмами.
- Antarctica показывает правильную границу: предметное authoring-имя может
  компилироваться в нейтральные runtime effects.
- Read-only server availability полезна как Presenter-примитив после исправления
  actor/action binding и public-only policy.

## Целевая архитектура

Рекомендуется один Cubica Mechanics IR с общей системой типов и модульными
словарями:

| Слой | Ответственность |
|---|---|
| State model | Типы records/objects/players/relations, видимость, максимальная ёмкость коллекций, стабильный ключ и разрешённые записи. |
| Expressions | Чистый закрытый JSON AST: literals, context/item/result refs, boolean/comparison/arithmetic и ограниченные aggregates. |
| Query | Select/filter/sort/group/aggregate над фактическим state; результат типизирован и имеет `cardinality`. |
| Assert | Общая проверка условия или мощности результата со стабильной ошибкой и полным rollback. |
| Command | Единственный изменяющий слой: state/object/relation/resource/event/RNG changes над candidate state; массовая команда не имеет частичного успеха. |
| Algorithms | Чистые versioned graph/geometry/ranking вычисления с typed I/O и cost model; random/deck являются module-backed commands, потому что меняют RNG и раскрытие. |
| Control nodes | `sequence` и востребованные bounded `if`/`match` отделены от предметных операций; рекурсия, `goto` и неограниченные циклы запрещены. |
| Security checker | Вывод типа, confidentiality и integrity, включая secret control-flow; availability отделена от authorization. |
| Cost control | Static upper estimate при публикации плюс weighted runtime budget для scan, памяти, algorithms и output. |
| Authoring | Предметные macros с typed inputs, которые compiler полностью раскрывает и валидирует до публикации. |

Это не произвольный `filter/map/reduce` JSON-язык. Разрешены только явно
перечисленные операции; рекурсия, пользовательский код и неизвестные функции
запрещены. Platform budget profile фиксирует верхние пределы, а manifest может
только выбрать разрешённый профиль или снизить лимит.

### Обязательные инварианты

1. Все варианты schema закрыты и различаются точным `op: const`.
2. Любая traversable collection имеет объявленный тип, visibility, capacity,
   стабильный key и canonical order; селектор не обходит произвольный JSON.
3. Predicate/ValueExpr используют белый список, не меняют state и не получают
   случайность, время, сеть, файловую систему или окружение.
4. ResultRef указывает только на предыдущий step ID и проверяется по value type,
   confidentiality и integrity.
5. Клиентские значения не становятся путями, выражениями, operation names,
   module names или scopes.
6. Каждый шаг видит candidate state после предыдущего шага; target set
   фиксируется в начале шага и сортируется платформенным comparator.
7. `cardinality.min/max` единообразно описывает пустую/ограниченную выборку;
   частичного успеха нет.
8. Любая ошибка откатывает state, PRNG streams, events, audit publication и
   version increment.
9. Secret или player-owned результат нельзя направить в более открытую область;
   метка условия также влияет на управляемую ветку.
10. Общего `reveal` нет: deck draw и random roll используют отдельные trusted
    declassifiers с узким выходом.
11. Static cost и runtime cost проверяются независимо; `maxMatches` не заменяет
    scan/memory/output budgets.
12. Session закрепляет один content-addressed `bundleHash`, включающий action
    catalog, IR, language API, budget, modules, compiler и random versions.

## Предлагаемая публичная форма

Версия языка, бюджет и алгоритмические модули фиксируются один раз на манифест:

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

Точная версия модуля, hash его содержимого и версии отдельных алгоритмов
закрепляются раздельно. Именованная версия алгоритма не обязана использовать
схему версии модуля, а локальный ключ `moduleLock` не заменяет канонический
`moduleId`.

Действие разделяет public-only доступность, server-only авторизацию и
изменяющую транзакцию. Ниже показан общий ресурсный reset без игровых ID:

```json
{
  "deterministic": {
    "availability": {
      "op": "bool.eq",
      "left": { "op": "context.activePlayerId" },
      "right": { "op": "context.actorId" }
    },
    "authorization": {
      "op": "auth.actorIsActive"
    },
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

Коллекция `units` заранее объявляет тип, видимость, ёмкость и стабильный ключ.
Facet и attribute проверяются против state model. Клиент не выбирает collection,
field или expression; он передаёт только параметры действия, разрешённые его
схемой. `active-units` возвращает `EntitySet<Unit>`, поэтому следующий шаг может
сослаться на него, но не на произвольный путь runtime.

### Schema и validator

Canonical manifest schema переводится на JSON Schema 2020-12 отдельным
dialect-only срезом. Runtime, compiler и CI используют отдельный Ajv 2020
validator для runtime schema; authoring draft-07 не смешивается с ним в одном
экземпляре до собственной миграции. После доказанной parity общие словари
размещаются в `$defs`, а schemas зафиксированных modules компонуются в закрытый
union известных `op`.

После structural validation общий checker проверяет ResultRef, field/model
types, security labels, module locks и static cost. Диагностика возвращает
стабильный код, `instanceLocation`, authoring source pointer, step ID и
ожидаемый тип, но не секретное значение. Generated TypeScript union должен быть
исчерпывающим, без catch-all unknown; рукописный тип перестаёт быть вторым
источником истины.

## Первый ограниченный вертикальный срез

Первый gameplay-срез не реализует весь будущий язык, но обязан целиком перенести
`mock.debrief.next-turn`, а не смешивать новые query/update со старыми effects
в одной команде. Он добавляет только минимально доказанные части:

- state model для public object collections с item type, capacity и stable ID;
- typed assert, scalar/record add/set и event append;
- `core.select` по collection, object type, facet и attribute;
- Predicate `bool.and`, `value.eq`, `value.lte`, `set.contains`, `set.isEmpty`;
- ValueExpr `value.literal`, typed item field, context field и state model ref;
- canonical bytewise order по object ID и `cardinality.min/max`;
- `core.update` с attribute/facet set и set remove для именованной причины;
- typed `EntitySet<T>` result и ResultRef на предыдущий шаг;
- candidate-state semantics и полный rollback вместо частичного результата;
- platform budget для steps, source scan, result count, expression nodes,
  memory и output.

### Нейтральное доказательство

Фикстура без слов «поезд», «дорога» и названий игры содержит:

- несколько объектов двух типов;
- due/non-due значения;
- один due-объект с дополнительной причиной блокировки;
- динамически добавленный после старта объект;
- public и secret коллекции.

Тест доказывает canonical order, полный rollback при одном невалидном target,
`cardinality` для пустого и переполненного результата,
отдельный scan-budget, отсутствие secret/control-flow утечки, сохранение
независимой причины блокировки и одинаковый replay после PostgreSQL round-trip.

### Игровое доказательство

Construction authoring macro компилируется в одинаковую последовательность для
nodes и edges: выбрать due-объекты, удалить `construction-pending`, повторно
проверить уже обновлённый candidate state и активировать только объекты без иных
blocking reasons. В общем IR нет слов `construction`, `road` или `locomotive`.

Действие следующего хода выбирает фактическую public collection локомотивов,
фильтрует активные объекты нужной сети и ставит `actionPoints = 5`. Сценарий
обязательно выполняет цепочку «купить третий локомотив → начать следующий ход →
увидеть 5 единиц действия → выполнить движение».

На миграционной ветке старый `transport.construction.activateDue` используется
только как сравнительный эталон (differential oracle) — тестовый исполнитель,
который при одном state/params/seed должен дать те же state, events, errors и
random counters. Он не входит в целевой runtime и удаляется при финальном
переключении. Мигрируется нормативный authoring source, затем mock-builder
заново выпускает mock authoring, compiler — runtime manifest и карту связи с
исходником; ручное редактирование generated manifest не допускается.

## Последовательность миграции

| Пакет | Результат | Почему отдельно |
|---|---|---|
| W0 Trust boundary | Deny-by-default projection, principal только из аутентификации, server-resolved actor без доверенного клиентского `playerId`, canonical action ID, public-only availability, safe writes, bounded request/log | Общие запросы иначе расширят существующие каналы утечки. |
| W1 Version and dialect foundation | Manifest/IR hash pin в session; typed module/artifact/algorithm locks; раздельные client/system command profiles и durable receipt; отдельный Ajv 2020 runtime validator; dialect-only parity; generated union и compile-result validation | Сначала обеспечивает воспроизводимость, идемпотентность и единый schema source, не смешивая причины ошибок. |
| W2 IR kernel | State model, typed expressions, query/assert/command, ResultRef, candidate transaction, static/runtime cost; neutral fixture и Simple Choice | Доказывает общую семантику без transport-названий. |
| W3 First CMT proof | Общая due activation и reset ресурса всех фактических active units, включая купленные | Проверяет dynamic state и закрывает два исходных дефекта одним языком. |
| W4 Antarctica migration | Compile-time templates, 522 stored effects, 796 expanded steps, conditions и четыре `preAction` случая | Самый большой пользователь общих metric/timeline/log/object команд; доказывает macros. |
| W5 Estate Race migration | JsonLogic subset → typed AST, random stream, turn, economy transfer | Доказывает control, trusted random result и player-scoped state. |
| W6 CMT algorithms and mock builder | Normative pending actions; graph/geometry modules; relation/cargo/ranking compositions; затем regeneration mock | Не допускает косметического переименования предметных handlers. |
| W7 Editor and final cutover | Schema-driven forms, source-mapped diagnostics, migrated previews/sessions; lockstep deploy; delete old schema/types/switch/oracle/converter | Только после нулевого inventory и replay/conformance/browser gates. |

Срезы W2–W6 просматриваются и проверяются отдельно, но не выпускают постоянный
двойной runtime. Старый interpreter остаётся только тестовым эталоном в ветке;
production переключается один раз после готовности всей цепочки.

## Как изменится создание следующей игры

До рефакторинга разработчику приходится выбирать между множеством одноцелевых
effects, сырыми path patches и новым предметным обработчиком в runtime. Набор
динамических объектов часто заменяется списком известных ID.

После рефакторинга процесс будет таким:

1. автор объявляет типы, видимость, ёмкость коллекций и нужные module versions;
2. предметное действие и параметры описываются authoring-макросом;
3. editor строит форму query/assert/command/algorithm из JSON Schema и
   показывает ошибку на конкретном исходном поле;
4. compiler раскрывает macro, нормализует defaults и выпускает canonical IR;
5. checker проверяет references, value/security types и static cost;
6. runtime исполняет bounded transaction над фактическим candidate state;
7. новая операция языка доказывается neutral conformance fixture и одним
   вертикальным игровым сценарием.

Специализированный runtime algorithm добавляется только для действительно
математической задачи — например, разбиения ломаной или поиска пути — и не
получает предметное имя конкретной игры.

## Совместимость и версии

- Постоянной runtime-совместимости с `deterministic.effects` не будет. Во время
  разработки старый interpreter доступен только differential tests.
- Одноразовый offline translator мигрирует механические случаи, но не становится
  входным форматом runtime и удаляется после cutover.
- Session хранит manifest/content/IR hash, `apiVersion`, budget profile, module
  lock и версии random streams. Продолжение на другой программе запрещено без
  явной replay-проверенной миграции.
- Существующие сессии должны быть переиграны и перепривязаны либо явно
  архивированы до удаления старого decoder. Текущее хранение только `gameId` и
  `contentSourceId` делает это обязательным prerequisite, а не необязательным
  улучшением `LEGACY-0055`.
- Runtime, все manifests, editor preview worktrees и content cache переключаются
  согласованно; смешанное production-развёртывание запрещено.
- Browser plugin bundles не содержат gameplay effects и пересобираются только
  при изменении клиентского кода; generated manifests/source maps обязательно
  пересобираются из authoring.
- Старые operation names резервируются и не используются повторно.
- `LEGACY-0063` закрывается только после нулевого поиска старой формы и удаления
  executor/oracle/converter. `LEGACY-0057` закрывается раньше, после сценария
  «покупка → следующий ход → движение» на новом IR.

## Рассмотренные альтернативы

### Добавить `transport.resetLocomotiveActionPoints`

Отклонено: исправляет один симптом и создаёт ещё один предметный public effect.

### Добавить только standalone `objects.updateMany` без общей модели

Отклонено как центр языка. Bulk update остаётся одной командой IR и использует
общие state model, Predicate, ValueExpr, ResultRef, security labels, cost model и
Transaction; иначе следующая aggregate/graph/event задача снова создаст
несовместимый контракт.

### Разрешить произвольные `filter/map/reduce` и JsonLogic

Отклонено: трудно типизировать, ограничивать, диагностировать и анализировать
потоки secret → public. Нужен белый список закрытых операций.

### Разделить transport, ranking, decks и turns на независимые DSL

Отклонено: повторятся разные ссылки, predicates, error policies и budgets.
Модульные algorithm dictionaries остаются, но используют одну основу.

### Разрешить общий `algorithm.call` с произвольными аргументами

Отклонено: это вернёт нетипизированный plugin escape hatch. Schema каждого
зафиксированного module version компонуется в union конкретных закрытых ops.

### Разложить road/waypoint до raw state patches

Отклонено: потеряются серверная геометрия, versioned algorithm, work limits и
воспроизводимое разрешение равенства.

### Сохранить постоянный legacy adapter

Отклонено прямым решением PM: он удваивает язык, тестовую матрицу и поверхность
безопасности. Старый interpreter разрешён лишь как недоступный production
тестовый oracle до общего переключения.

### Одним непросматриваемым изменением переписать всё и сразу развернуть

Отклонено: реализация и differential checks идут малыми срезами. Это не меняет
финальную границу — production получает только новый IR после готовности всех
пакетов и сессий.

### Сохранить draft-07

Возможно, но требует разворачивать составные закрытые схемы и дублировать
properties. Рекомендован 2020-12, потому что новый язык по природе модульный и
должен корректно закрывать `oneOf`/`allOf` композиции.

## Риски и контроль

| Риск | Контроль |
|---|---|
| Selector читает secret или превращает его в availability signal | P0 deny-by-default projection, public-only availability, typed taint rule. |
| Массовая операция перегружает runtime | Collection capacity, static estimate, weighted scan/memory/output budget; manifest не повышает cap. |
| Одна плохая цель оставляет частичную запись | Candidate state, immutable target set на шаг, полный rollback state/RNG/events/version. |
| Случайность зависит от порядка JSON/PostgreSQL | Platform-defined bytewise comparator, named streams и canonical input до PRNG. |
| Schema, authoring, generated types и editor снова расходятся | Canonical `$defs`, compile-result validation, type-utility tests, schema-driven editor diagnostics. |
| Ошибки `oneOf` непонятны автору | Точный `op`, selected-variant diagnostics, step index и карта связи с исходником; секретные values не включать. |
| Секрет влияет на public через условную ветку | Checker переносит confidentiality label условия на branch result; availability имеет только public context. |
| Старую сессию нельзя воспроизвести после публикации | Новые session pin `bundleHash`; старые replay только при наличии истории и правил, иначе snapshot migration или явный archive. |
| Универсальный язык становится неконтролируемым программированием | Обычный IR — закрытый whitelist без JavaScript/сети/FS/часов/env; уникальный игровой код проходит только изолированный extension contract. |
| Большая миграция скрывает регрессии | Малые branch slices + старый interpreter только как сравнительный эталон; один lockstep production cutover. |
| Real CMT UI уже рекламирует pending road/waypoint actions | Перед нормативной публикацией отдельно сверить runtime actions, availability, UI forms и plugin bundle. |
| Cosmetic rename оставляет предметный core | Transport/ranking workflows раскладываются на macros/primitives; только graph/geometry/random/deck остаются нейтральными modules. |

## Конкретная точка архитектурного решения

Принцип универсальности был принят ранее. Прямое поручение PM продолжать без
отдельного согласования после анализа лучших практик принято как делегированное
утверждение следующей конкретной формы:

| Решение | Рекомендация | Реальная альтернатива и цена |
|---|---|---|
| Envelope нового языка | Manifest `mechanics` фиксирует `apiVersion`/budget/modules; action разделяет `availability`, `authorization`, `transaction.steps` | Один action-local `program` проще, но дублирует версии и не фиксирует общий module lock. |
| Schema dialect | JSON Schema 2020-12; сначала отдельный dialect parity slice, затем `$defs` IR | Draft-07 требует развёрнутых closed variants и усложняет modular composition. |
| Общая форма | State model + typed expression AST + query/assert/command/algorithm + ResultRef/Transaction | Независимые DSL повторят типы, security, errors и budgets. |
| Первый proof | Полный `mock.debrief.next-turn`: assert/add/set/select/update/event внутри одной transaction; due activation и dynamic resource reset | Миграция только двух фрагментов оставила бы двойной executor внутри одной команды и не доказала атомарность. |
| Public/secret | Confidentiality + integrity inference, включая branch condition; узкие deck/random declassifiers | Строковый scope и generic reveal создают прямые и неявные утечки. |
| Empty/error | Общая `cardinality.min/max`; полный rollback, без partial success | Per-op `onNoMatch` размножает политики; partial усложняет replay. |
| Limits | Collection capacity + static estimate + runtime scan/memory/output budget | Один `maxMatches` не ограничивает дорогой scan с пустым результатом. |
| Extensibility | Game macros compile away; общие modules имеют schemas/version locks/conformance corpus; уникальный игровой код разрешён только в изолированном game-scoped runner | Generic `module.call` или игровой импорт внутри core превращается в нетипизированный plugin path и угрожает платформе. |
| Legacy | Offline translator и сравнительный эталон только в миграционной ветке; lockstep cutover и полное удаление v1 | Permanent adapter удваивает язык и противоречит требованию PM. |

Статус формы: **Accepted** в ADR-084; `PROJECT_ARCHITECTURE.md`
синхронизирован. Это не означает, что исполняемый контракт уже реализован:
JSON Schema, runtime и игры переходят в стадии B по пакетам W0–W7 без нового
архитектурного checkpoint.

## Принятое расширение 2026-07-15

После отдельного обсуждения разработки ИИ-агентами, границы Presenter и
идемпотентности PM принял расширение того же ADR-084. Оно дополняет, а в
случае расхождения заменяет узкую таблицу решения выше:

- Game Intent становится единственным клиентским write-фасадом; каноническим
  полем остаётся существующий `actionId`, отдельный `intentId` не вводится;
- Presenter является projector на read path и router на write path: передаёт
  точный intent и параметры, но не содержит правила, command maps, fallback
  names или lowering;
- authoring AI/editor видят широкий operation catalog, а игрок/игровой ИИ —
  только actor-scoped Game Intents;
- размер operation catalog не имеет произвольного лимита, но каждая
  каноническая операция одного уровня обязана иметь отличимые types,
  reads/writes, security, determinism, ordering, failure и cost guarantees;
- build-time mechanics capability packs, platform/game runtime modules и UI
  capability packs являются разными namespaces и границами доверия;
- первая версия runtime ограничена привязкой params/opaque refs и control flow
  внутри опубликованного IR; выбор typed plan остаётся зарезервированным server
  lowering; client/LLM-selected IR запрещён;
- `commandId` стабилен для одной логической команды на всех HTTP retry,
  receipt lookup предшествует `expectedStateVersion`, а
  state/random/events/audit/receipt сохраняются атомарно;
- session pins весь mechanics bundle и locks, receipt хранит
  `definitionHash`/`planHash`;
- целевые AI-driven state mutations также сходятся в Game Intent → IR;
- финальный cutover дополнительно удаляет client command maps, двойные
  `params/payload` и direct agent state effects.

Полная нормативная формулировка находится в ADR-084. Подробная реализация
остаётся в W0/W1 и последующих срезах, а не в этом аудите.

## Решения повторного ревью 2026-07-15

Повторное независимое ревью не отменило двухслойную модель Game Intent →
Mechanics IR, но выявило несколько противоречий. PM принял следующие
уточнения; они отражены в ADR-040/054/058/059/079/083/084, обзоре архитектуры и
GSR-036:

1. `actionId` сохраняется как канонический идентификатор Game Intent. Массовое
   переименование в `intentId` не создаёт нового инварианта и отменено.
2. `commandId` обозначает логическую команду и ключ идемпотентности;
   транспортный `requestId` и `traceId/spanId` имеют другие роли.
3. Principal доставки и actor внутри игры разделены. В хотсите command ledger
   индексируется стабильным контроллером сессии, а actor сохраняется при первом
   выполнении, поэтому retry после смены активного игрока не повторяет ход.
4. Внутренняя и публичная receipt являются разными проекциями. Возможная
   утечка идентичности закрытой ветви через `planHash` для текущих учебных
   данных не считается критичной и не блокирует выпуск. Сырые закрытые значения
   по-прежнему не публикуются; более строгая redaction policy может быть
   включена будущим чувствительным продуктом.
5. `algorithm` является чистым вычислением. Все изменения state, RNG и events
   принадлежат `command`; `sequence` и bounded `if/match` являются отдельными
   структурными узлами.
6. Исполняемый код конкретной игры разрешён, когда IR и общие платформенные
   модули не позволяют разумно реализовать функциональность. Жёсткая граница —
   game-scoped namespace/bundle, отдельный изолированный runner, schema-defined
   вход/выход, declared read/write scope, resource limits и отсутствие прямого
   доступа к platform storage/process/network/FS/env/time. Выбор расширения в
   этой принятой границе не требует отдельного согласования для каждой игры;
   новое архитектурное решение нужно только для новых прав или ослабления
   изоляции.
7. Неизменяемое определение action и динамическая actor-scoped availability
   разделены. Наличие, порядок, options и preview также проходят проверку
   информационного потока.
8. Первый proof мигрирует полное действие `mock.debrief.next-turn`, включая
   guard, счётчик, все сбросы, due activation, динамический reset и log в одной
   candidate-state transaction.
9. Для существующих сессий replay-миграция возможна только при наличии истории
   и точных старых правил. Иначе используется проверенная snapshot-миграция или
   явное архивирование; новые сессии закрепляются за `bundleHash`.

Дополнительные семь замечаний к этой редакции приняты полностью и закрыты
следующими уточнениями:

10. Конфликт идентификаторов устранён двумя профилями. Недоверенный клиент
    создаёт непрозрачный случайный `cli_` `commandId`; планировщик
    детерминированно выводит внутренний `sys_` из session/schedule/occurrence.
    Это разные JSON Schema, а префикс не является основанием доверия.
    Транспортный `requestId` и идентификаторы трассировки не участвуют в
    игровой идемпотентности.
11. Системное срабатывание освобождено только от неизвестного заранее
    `expectedStateVersion`, но не от защиты конкуренции. Под session lock оно
    повторно проверяет закреплённый schedule, момент и trigger на текущем
    состоянии, авторизацию и бюджет; occurrence, state, events, audit и receipt
    фиксируются атомарно. Политика ложного trigger явно выбирает `defer` либо
    терминальный `skip`.
12. `moduleLock` больше не смешивает версии разных видов. Каждый описатель
    отдельно хранит `moduleId`, точную `moduleVersion`, `artifactHash` и при
    необходимости `algorithmVersions`. Графовый пример переименован в
    нейтральный `cubica.graph.regions` / `region-segment-minimum-v1`.
13. ADR-084 теперь явно уточняет принятые контракты атомарных экономических
    переводов и серверного расчёта регионального пути, чтобы миграция
    `metric.transfer` и дорожного алгоритма не потеряла их инварианты.
14. В терминах определены конверт команды, входной допуск, карта связи с
    исходником и сравнительный эталон; далее используются понятные русские
    названия.
15. Правило записи теперь однозначно относится к одному конечному полю внутри
    одного шага, а разные последовательные шаги могут писать туда в заданном
    порядке. Сортировка применяет объявленные ключи и использует стабильный ID
    только как обязательный последний разрешитель равенства.
16. Миграция явно удаляет доверенный `playerId` из тел `/actions`, Agent Turn и
    защищённых preview. Principal приходит из аутентификации, actor разрешается
    сервером; возможный выбор actor остаётся недоверенным входом и отдельно
    авторизуется.

Эти уточнения обязательны для целевого production contract. Полный pack DAG,
server plan selection, scheduler и общий event store не нужны первому proof и
остаются отложенными до реального потребителя.

## Результат стадии A

Стадия A завершает проектирование следующими артефактами:

- этот доказательный отчёт;
- полная матрица операций, игр, слоёв и целевых замен;
- принятый ADR типизированного transactional IR и синхронизированный обзор
  архитектуры;
- карта state/query/assert/command/algorithm primitives и публичный skeleton;
- W0/W1 prerequisites и первый bounded gameplay-slice;
- последовательность полной миграции без постоянного adapter; `LEGACY-0063`
  остаётся active до физического удаления v1.

Проверки стадии A ограничиваются документацией, структурным inventory и
`git diff --check`, как требует исходная задача. Runtime/schema/game tests
намеренно не запускаются, поскольку исполняемый контракт и поведение не
менялись. Остаточный риск — фактическое рабочее дерево параллельно меняется;
перед каждым срезом стадии B inventory затронутой группы повторно подтверждается
на её исходном commit.
