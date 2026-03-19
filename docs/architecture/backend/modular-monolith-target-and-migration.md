# Целевая схема репозитория и карта миграции к модульному монолиту

**Дата:** 2026-03-19  
**Статус:** Proposal  
**Связанный ADR:** `ADR-017`

## 1. Цель

Документ фиксирует:

- целевое дерево каталогов репозитория Cubica в парадигме AI-first + Code-first;
- целевую модульную структуру backend-а;
- поэтапную карту миграции из текущего состояния (`as-is`) в целевое (`to-be`);
- правила, которые упростят дальнейшее выделение модулей в отдельные сервисы.

## 2. Проблема текущего дерева

Сейчас репозиторий одновременно содержит:

- реальные активные артефакты;
- целевые архитектурные заготовки;
- черновики;
- архивные приложения;
- placeholder-пакеты;
- документы, описывающие более зрелую систему, чем существует в коде.

Из-за этого затруднено:

- понимание, что является источником истины;
- автоматическая навигация для AI-агентов;
- построение единого build/test/runtime контура;
- последовательная эволюция backend-а.

## 3. Целевое дерево каталогов (`to-be`)

```text
Cubica/
├── apps/
│   ├── player-web/                        # основной web player / viewer shell
│   ├── authoring-studio/                  # UI редактора и AI-assisted authoring
│   └── ops-console/                       # внутренние runtime/admin инструменты
│
├── services/
│   └── runtime-api/                       # один deployable backend на ближайшую фазу
│       ├── src/
│       │   ├── modules/
│       │   │   ├── player-api/
│       │   │   ├── session/
│       │   │   ├── runtime/
│       │   │   ├── content/
│       │   │   ├── ai/
│       │   │   ├── telemetry/
│       │   │   └── admin/
│       │   ├── app.ts
│       │   └── bootstrap.ts
│       ├── tests/
│       └── docs/
│
├── packages/
│   ├── contracts/
│   │   ├── manifest/
│   │   ├── session/
│   │   ├── runtime/
│   │   └── ai/
│   ├── sdk-core/
│   ├── sdk-react/
│   ├── ui-kit/
│   ├── viewer-web/
│   ├── runtime-core/
│   ├── runtime-capabilities/
│   ├── ai-orchestrator/
│   ├── manifest-tooling/
│   └── observability/
│
├── games/
│   ├── antarctica/
│   │   ├── game.manifest.json
│   │   ├── ui/
│   │   ├── scripts/
│   │   ├── scenario.md
│   │   ├── design/
│   │   └── tests/
│   └── <game-id>/
│
├── schemas/
│   ├── core/
│   ├── capabilities/
│   ├── api/
│   └── examples/
│
├── tools/
│   ├── manifest-cli/
│   ├── replay/
│   ├── seed/
│   └── eval/
│
├── docs/
│   ├── architecture/
│   ├── reviews/
│   └── tasks/
│
├── archive/                               # только исторические артефакты
├── draft/                                 # только короткоживущие эксперименты
├── repo-manifest.json                     # машиночитаемый индекс репозитория
├── package.json
└── pnpm-workspace.yaml
```

## 4. Правила для целевого дерева

### 4.1. `apps/`

Только конечные приложения и оболочки. Здесь не живут доменные контракты и runtime-ядро.

### 4.2. `services/`

Только deployable units. На ближайшей фазе здесь должен быть один backend:

- `runtime-api`

Если позже появляются отдельные сервисы, они добавляются сюда только после подтверждённой необходимости.

### 4.3. `packages/`

Только повторно используемые исполнимые модули:

- contracts;
- SDK;
- runtime;
- viewer;
- tooling;
- AI orchestration.

### 4.4. `games/`

Канонический content layer. Каждая игра — self-contained bundle с манифестами, scripts, сценариями и тестами.

### 4.5. `schemas/`

Формальные схемы и примеры:

- `core` — базовые обязательные границы;
- `capabilities` — расширяемые паттерны;
- `api` — схемы транспортных контрактов;
- `examples` — валидные образцы.

### 4.6. `draft/` и `archive/`

Их роль должна быть резко упрощена:

- `draft/` — только короткоживущие эксперименты;
- `archive/` — только исторические артефакты;
- ни один из этих каталогов не должен быть implicit source of truth.

## 5. Карта миграции `as-is -> to-be`

## Этап 0. Зафиксировать новый архитектурный baseline

Цель:

- признать, что ближайшая backend-фаза — это модульный монолит;
- прекратить рассматривать текущий набор `services/*` как уже существующую распределённую систему;
- ввести понятия `actual`, `target`, `draft`, `archive`, `placeholder`.

Шаги:

1. Принять ADR-017.
2. Добавить `repo-manifest.json`.
3. Явно пометить существующие сервисы и приложения по статусам.

## Этап 1. Нормализовать структуру репозитория

Цель:

- сделать дерево репозитория понятным;
- уменьшить шум для людей и AI-агентов.

Шаги:

1. Подготовить `apps/`, `packages/`, `schemas/`, `tools/`.
2. Переместить:
   - `SDK/core -> packages/sdk-core`
   - `SDK/react-sdk -> packages/sdk-react`
   - `SDK/shared -> packages/ui-kit`
   - `SDK/viewers/web-base -> packages/viewer-web`
3. Оставить `games/` как есть, но считать его каноническим content layer.
4. Перенести или пересобрать рабочий web player в `apps/player-web`.
5. Очистить роль `draft/`: оставить только то, что действительно экспериментально и временно.

## Этап 2. Собрать единый backend `runtime-api`

Цель:

- получить один deployable backend и один честный execution path.

Шаги:

1. Создать `services/runtime-api`.
2. Перенести в него существующие router contracts как основу модулей `player-api` и `session`.
3. Добавить модуль `content` для загрузки manifest bundle из `games/`.
4. Добавить `runtime` модуль с deterministic execution path.
5. Добавить `ai` модуль как optional capability layer.
6. Добавить `telemetry` и `admin`.

Результат:

- `client -> runtime-api -> session/runtime/content -> state/result`

## Этап 3. Стабилизировать contracts layer

Цель:

- вынести границы из реализаций в отдельные контракты.

Шаги:

1. Создать `packages/contracts/manifest`.
2. Создать `packages/contracts/session`.
3. Создать `packages/contracts/runtime`.
4. Создать `packages/contracts/ai`.
5. Синхронизировать SDK и backend через эти contracts packages.

## Этап 4. Стабилизировать player и viewer

Цель:

- отделить viewer runtime от конкретного приложения.

Шаги:

1. Перевести player в `apps/player-web`.
2. Вынести универсальный viewer runtime в `packages/viewer-web`.
3. Сделать `packages/sdk-react` тонким integration layer поверх contracts и viewer.
4. Прекратить использовать `draft` player как фактический источник истины.

## Этап 5. Ввести capability-first schema model

Цель:

- сохранить extensibility для неизвестных будущих игр.

Шаги:

1. Выделить `schemas/core`.
2. Выделить `schemas/capabilities`.
3. Описать policy для custom extensions.
4. Подготовить validator/compiler tooling в `packages/manifest-tooling`.

## Этап 6. Собрать один production-grade vertical slice

Цель:

- получить минимально честную платформу, а не только набор архитектурных намерений.

Шаги:

1. Игра `Antarctica`.
2. `apps/player-web`.
3. `services/runtime-api`.
4. `packages/contracts/*`.
5. `packages/viewer-web`.
6. unit + integration + schema validation tests.

## Этап 7. Выделять микросервисы только по факту

Цель:

- не замораживать архитектуру раньше времени.

Шаги:

1. Собирать метрики нагрузки, latency и ownership.
2. Проверять зрелость контракта модуля.
3. При необходимости выделять модуль в сервис:
   - сначала `ai`;
   - затем `content`;
   - затем `session/runtime`;
   - затем аналитические и ops-компоненты.

## 6. Рекомендованная судьба текущих каталогов

### `services/router/`

Краткосрочно:

- использовать как источник контрактов и наработок для `services/runtime-api/src/modules/player-api` и `session`.

Долгосрочно:

- не развивать как отдельный deployable сервис до появления реальной причины.

### `services/game-engine/`

Краткосрочно:

- использовать как концептуальную основу для модуля `runtime` и части `ai`.

Долгосрочно:

- развивать внутри `runtime-api`, а не отдельно.

### `services/game-repository/`

Краткосрочно:

- трактовать как будущий `content` модуль.

Долгосрочно:

- выделять отдельно только если публикация, версионирование и distribution действительно станут самостоятельным контуром.

### `services/metadata-db/`

Краткосрочно:

- держать как внутренний telemetry/audit слой.

Долгосрочно:

- выделять отдельно только при росте аналитического контура.

### `SDK/*`

Краткосрочно:

- последовательно перенести в `packages/`.

### `draft/antarctica-nextjs-player/`

Краткосрочно:

- использовать как источник миграции для `apps/player-web`.

Долгосрочно:

- вывести из роли референсной рабочей реализации.

## 7. Минимальные правила, чтобы потом легко выделять сервисы

1. Не импортировать приватные файлы соседнего модуля.
2. Держать DTO и события в contracts layer.
3. Интеграционные тесты писать через публичные интерфейсы.
4. Избегать общего “god repository layer” на весь backend.
5. Логику состояния и side effects разделять.
6. Вводить внутренние доменные события уже на стадии монолита.

## 8. Критерии готовности миграции

Миграция в целевую форму считается успешной, когда:

- есть один рабочий deployable backend `runtime-api`;
- есть один активный player в `apps/player-web`;
- `draft` больше не содержит фактический runtime source of truth;
- contracts layer используется и SDK, и backend;
- `games/antarctica` работает как канонический content bundle;
- CI проверяет schemas, contracts и vertical slice;
- будущая сервисная декомпозиция становится технически простой, а не концептуально красивой.
