# TSK-20260706-flow-simulation-platform-capabilities: Платформенные возможности игр-симуляций реального времени

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Dependencies](#dependencies)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

planned

Status note: архитектура ADR-061 и ADR-062 принята 2026-07-06; Phase 0 закрыта. Отдельного разрешения на весь план нет; нужные фазы активируются игровым срезом или приоритетом PM. Phase 2 ждёт PRNG-модуль ADR-058
Phase 1 параллельного трека.

## Understanding

Работа понята так: платформа получает канал доставки для класса игр
«симулятор потока» (клиентская 2D-симуляция реального времени на Phaser).
Принцип: реальное время живёт в клиентской сцене плагина игры, runtime владеет
границами раундов через обычные детерминированные действия. Для этого
добавляются четыре общие возможности: параметры действий (`paramsSchema`,
ADR-061), эффект `random.seed`, точка вклада плагина `phaserSceneFactory` +
Phaser-хост в `player-web`, компонент `simulationSurface` в UI-манифесте, плюс
клиентская утилита seeded PRNG. Доказательство generic-пути — фикстурная игра
`games/conveyor-mini/` (отдельная программа
`TSK-20260706-conveyor-mini-game`, реализует другой агент).

## Architecture Source

- `docs/architecture/adrs/061-action-parameters.md` (Proposed)
- `docs/architecture/adrs/062-realtime-client-simulation-and-phaser-channel.md` (Proposed)
- `docs/architecture/flow-simulation-platform-design.md` — детальный дизайн.
  **Для исполнителя обязательны**: §4.0 (нормативный справочник — имена полей,
  TS-сигнатуры, жизненный цикл берутся ТОЛЬКО оттуда; при расхождении с прозой
  приоритет у §4.0), §9 (правила работы и запреты), §10 (координация с
  параллельным треком).
- `docs/architecture/board-game-platform-design.md` §4.0–4.1 — нормативный PRNG
  (владелец — параллельный трек) и контекст JsonLogic.
- ADR-024 (bounded mechanics), ADR-025/ADR-056 (Schema SSOT + генерация
  контрактов), ADR-037/ADR-039 (плагины), ADR-040 (политика расширения
  runtime-api), ADR-055 (чистота рендерера), ADR-058 (PRNG, metric.set).

## Why

Класс игр «симулятор потока» (производственные/логистические тренажёры в
реальном времени) невозможен на текущем DOM-плеере: нет игрового цикла, нет
канала передачи посчитанных клиентом итогов (у действий нет параметров), нет
воспроизводимой клиентской случайности. Без общего пакета первая же такая игра
потребовала бы запрещённых game-specific веток и неконтролируемых зависимостей
в плагинах.

## Current Findings

1. `DispatchActionInput` (`packages/contracts/session`,
   `services/runtime-api/src/modules/player-api/requestValidation.ts`) несёт
   только `sessionId`/`actionId`/`playerId` — параметров нет.
2. Guard-форма `jsonLogic` в схеме манифеста уже существует; контекст данных
   для неё определяет параллельный трек (board-design §4.0).
3. `plugin.schema.json` → `targets["player-web"].contributes` содержит только
   `gameConfigFactory`; политика `dependenciesPolicy: "platform-only"`
   запрещает npm-зависимости плагинов — Phaser обязан жить на платформе.
4. PRNG-модуль сессии (`state.secret.random`) проектируется в ADR-058 Phase 1
   параллельного трека; на момент создания задачи не реализован.
5. `ui-manifest.schema.json` не имеет canvas-компонентов; player-web рендерит
   экраны декларативно (ADR-055 в работе — `TSK-20260630-player-web-renderer-purity`).

## Target State

1. Схемы и сгенерированные контракты описывают: `actions.<id>.paramsSchema`
   (плоский объект, лимиты по §4.1 дизайна), `params` в `POST /actions`,
   эффект `random.seed`, вклад `phaserSceneFactory`, компонент
   `simulationSurface`.
2. `runtime-api`: Ajv-валидация params до guards (params без схемы → 400),
   ветка `params` в контексте JsonLogic, обработчик `random.seed` поверх
   PRNG-модуля сессии; отклонённое действие не меняет состояние.
3. `player-web`: ленивый Phaser-хост, монтирование `simulationSurface`,
   жизненный цикл сцены по §4.0 дизайна (включая fail-closed диагностику),
   `createSeededRandom` в `plugin-api` с эталонным вектором, общим с серверным
   PRNG.
4. Ни одного упоминания конкретной игры в платформенных слоях; `phaser` не
   импортируется в коде плагинов (grep-инварианты §7 дизайна в CI).

## Scope

- JSON Schema трёх схем + перегенерация контрактов + контрактные тесты.
- Валидация params и обработчик `random.seed` в `services/runtime-api`.
- Phaser-хост, контракт сцены и seeded PRNG утилита в `apps/player-web`.
- Расширение replay-контура параметрами действий.
- Регистрация долга «превью-адаптер ADR-036 для Phaser отложен» в
  `docs/legacy/debt-log.csv` + `docs/legacy/stubs-register.md`.

## Non-Goals

- Сама фикстурная игра `conveyor-mini` (отдельная программа, другой агент).
- Серверный realtime-контур, стриминг позиций, тики (отклонено ADR-062).
- Серверная ресимуляция/анти-чит (граница честности ADR-062 §2.3).
- Мультиплеер класса симуляций; Phaser-проекция Cubica Surface.
- Визуальное редактирование Phaser-сцен в редакторе (долг, ADR-062 §2.5).
- Вложенные объекты/массивы в `paramsSchema`.

## Dependencies

- **ADR-058 Phase 1 (PRNG-модуль)** — блокирует Phase 2 этой программы.
- **ADR-058 Phase 4 (`metric.set`, `when`)** — нужен только фикстурной игре,
  эту программу не блокирует.
- **Builder контекста JsonLogic** — правило «кто первый — тот создаёт» (§10
  дизайна): если параллельный трек ещё не создал builder, Phase 1 создаёт его
  и фиксирует передачу владения в Handoff Log обеих задач.

## Execution Plan

### Phase 0. Принятие ADR

1. Ревью и принятие ADR-061 и ADR-062 владельцем проекта (Proposed → Accepted).
   Все проектные вопросы закрыты в §8 дизайн-документа — технических решений
   на этой фазе не требуется.

### Phase 1. Параметры действий (ADR-061)

1. Схема: `actions.<id>.paramsSchema` с мета-ограничениями §4.1 дизайна
   (плоский объект, `additionalProperties: false`, типы
   integer/number/string(maxLength≤256)/boolean, ≤16 свойств); негативные
   фикстуры на каждое ограничение.
2. Контракты: `params` в `DispatchActionInput` (`packages/contracts/session`);
   `requestValidation.ts` — `params` строго объект, если присутствует.
3. Runtime: Ajv-компиляция `paramsSchema` при загрузке манифеста (кэш вместе с
   манифестом); порядок проверок строго по §4.1: 400 при params без схемы →
   Ajv → guards → effects; ветка `params` в контексте JsonLogic (расширение
   общего builder-а, см. Dependencies).
4. Безопасность (нормативный блок §4.1 дизайна): defense-in-depth отклонение
   ключей `__proto__`/`constructor`/`prototype` на верхнем уровне `params` в
   `requestValidation.ts` до Ajv; Ajv без `coerceTypes`/`useDefaults`; params
   не сливаются ни в какие объекты (живут только веткой контекста JsonLogic).
5. Тесты: лишние поля, неверные типы, отсутствие обязательных, params без
   схемы, `{}` при объявленной схеме, доступность `params.*` в guard и в
   значении эффекта; по одному тесту на каждый из трёх pollution-ключей;
   строковый параметр с HTML-содержимым сохраняется эффектом как есть и не
   исполняется.

### Phase 2. Эффект random.seed

Блокер: PRNG-модуль ADR-058 Phase 1 (не реализовывать свой — §10 дизайна).

1. Схема: эффект `random.seed` (`storePath` — JSON Pointer, обязан начинаться
   с `/public/`); негативная фикстура на указатель вне `/public/`.
2. Runtime: обработчик по нормативу §4.2 дизайна (4×uint32 → 32 hex lowercase,
   counter +4), платформенная запись журнала.
3. Тесты: фиксированный seed сессии → эталонное зерно (записать вектор);
   counter увеличен ровно на 4; два вызова подряд дают разные зёрна.

### Phase 3. Phaser-хост и контракт сцены в player-web

1. Схема `plugin.schema.json`: вклад `phaserSceneFactory: boolean`; схема
   `ui-manifest.schema.json`: компонент `simulationSurface` (поля и лимиты по
   §4.4 дизайна); перегенерация контрактов, негативные фикстуры.
2. `apps/player-web`: зависимость `phaser` (актуальная стабильная 3.x,
   зафиксировать точную версию; документацию API брать через Context7);
   ленивый динамический import; хост-компонент, исполняющий жизненный цикл
   §4.0 дизайна пп.1–5 (включая fail-closed диагностику при отсутствии вклада).
3. `plugin-api`: экспорт типов `PhaserSceneContext`, `SimulationSceneHandle`,
   `PhaserSceneFactory`, `SimulationSessionSnapshot` — сигнатуры строго по
   §4.0; загрузчик плагина распознаёт экспорт `createSimulationScene`.
4. Тесты (Vitest, моки Phaser): монтирование/размонтирование в правильном
   порядке (`handle.destroy()` до `game.destroy(true)`), проброс
   `updateSession`, диагностика при ошибке фабрики.

### Phase 4. Клиентский seeded PRNG

1. `plugin-api`: `createSeededRandom(seedHex)` — алгоритм нормативно идентичен
   серверному (board-design §4.1): xoshiro128**, посев 4×uint32 из hex, замена
   нулевого состояния на `[1,2,3,4]`, `nextInt` rejection sampling, `shuffle`
   Фишер–Йетс, `nextFloat = nextUint32()/2^32`.
2. Тесты: эталонный вектор, общий с серверным PRNG-модулем (тот же файл
   фикстуры или продублированные значения с комментарием-ссылкой); граничные
   случаи `nextInt` (min==max, диапазон 1..1).

### Phase 5. Replay и CI-инварианты

1. Расширить replay-контур: транскрипт действия включает `params`;
   автотест «seed + транскрипт → идентичное конечное состояние» на любом
   generic-манифесте с параметрами (без упоминания конкретных игр).
2. CI grep-инварианты §7 дизайна: `conveyor` отсутствует в
   `services/runtime-api/src` и `apps/player-web/src`; `phaser` не
   импортируется в `games/*/plugins/*/src`.
3. Зарегистрировать долг «ADR-036 hit-test адаптер для Phaser отложен»
   (`docs/legacy/debt-log.csv`, `docs/legacy/stubs-register.md`).

### Phase 6. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md` (ADR-список + текущий срез),
   `PROJECT_OVERVIEW.md` (канонический срез), `NEXT_STEPS.md`, Handoff Log;
   разблокировать `TSK-20260706-conveyor-mini-game` записью в её Handoff Log.

## Acceptance

- Все новые схемные конструкции покрыты позитивными/негативными фикстурами;
  `verify:contracts-schema-parity` зелёный.
- `POST /actions` с params: валидация по схеме действия; params без схемы →
  400; невалидные params не меняют состояние.
- `random.seed`: эталонное зерно при фиксированном seed сессии; counter +4.
- Хост player-web монтирует сцену тестового плагина (generic-фикстура тестов)
  и корректно размонтирует; при отсутствии вклада — диагностический блок.
- Клиентский и серверный PRNG дают бит-в-бит одинаковый эталонный вектор.
- Grep-инварианты и `verify:canonical` зелёные.

## Validation

```text
npm run generate:contracts && npm run verify:contracts-schema-parity
cd services/runtime-api && npm run typecheck && npm test
cd apps/player-web && npm run typecheck && npm test
npm run verify:canonical
```

## Risks

- Параллельный трек (TSK-20260705-*) меняет те же файлы runtime
  (обработчики, builder контекста): перед каждой фазой сверяться с их Handoff
  Log и `git log`; владение общими блоками — по §10 дизайна.
- Phaser — тяжёлая зависимость: обязательна ленивая загрузка; проверить, что
  бандл страниц без `simulationSurface` не вырос (bundle-анализ в Phase 3).
- Params — первый канал недоверенных данных в детерминированном контуре:
  лимиты схемы обязательны, никакой «мягкой» валидации.
- API Phaser 3.x меняется между минорами: документацию получать через Context7,
  версию зафиксировать точно.

## Handoff Log

- 2026-07-06: задача создана вместе с ADR-061/ADR-062 (Proposed) и
  `docs/architecture/flow-simulation-platform-design.md`; ожидает принятия ADR
  владельцем проекта. Все проектные вопросы закрыты заранее (§8 дизайна):
  формы конструкций — §4.0, фикстурная игра — §6, координация с параллельным
  треком — §10. Реализация не начата.
- 2026-07-06 (позже): владелец принял ADR-061/ADR-062 (Proposed → Accepted),
  Phase 0 закрыта; `PROJECT_ARCHITECTURE.md` и `NEXT_STEPS.md`
  синхронизированы. По вопросу владельца о безопасности параметров в §4.1
  дизайна добавлен нормативный анти-инъекционный блок (инертность params,
  запрет интерпретации как путей/выражений, отклонение pollution-ключей,
  запрет merge/spread, строгий Ajv без coerce/defaults, лимиты объёма);
  Phase 1 дополнена пунктом безопасности и тестами. Реализация не начата.
- 2026-07-11: Phaser-хост и нормативный контекст сцены реализованы первым
  игровым срезом. По принятому ADR-063 контекст аддитивно расширен обязательным
  `GameAssetResolver assets`; точная сигнатура синхронизирована в §4.0
  flow-дизайна и в plugin API. Каналом владеет параллельная задача
  `TSK-20260706-game-asset-channel`; flow-трек не должен создавать второй
  резолвер или альтернативный способ загрузки файлов.
