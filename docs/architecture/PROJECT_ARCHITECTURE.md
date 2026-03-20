# Архитектура платформы Cubica (MVP)

Документ описывает целевую и фактическую архитектуру платформы Cubica на уровне сервисов, SDK и данных. Он дополняет `PROJECT_OVERVIEW.md` (бизнес‑и логический обзор) и ADR‑решения в `docs/architecture/adrs/` и помогает быстро понять, как концепции отражены в структуре репозитория.

> Термины:
> - **LLM** — Large Language Model, «большая языковая модель», используемая как игровой движок.
> - **SDK** — Software Development Kit, набор библиотек и утилит для интеграции с платформой.
> - **MVP‑паттерн** — Model–View–Presenter, шаблон разделения модели данных, представления и прослойки‑«презентера».
> - **ADR** — Architecture Decision Record, документ с зафиксированным архитектурным решением.

## Текущий канонический срез

Текущий канонический срез уже реализован и должен читаться первым:

- `games/antarctica/` - canonical content bundle.
- `games/antarctica/game.manifest.json` - source of truth для исполнимой логики игры.
- `games/antarctica/design/mockups/` - source of truth для UI intent.
- `draft/Antarctica/Game.html` - текущий factual extraction source для Antarctica mechanics migration; это не canonical runtime source of truth и не новое архитектурное решение.
- `services/runtime-api/` - канонический backend runtime в формате модульного монолита и owner загрузки игрового контента для runtime/player delivery (ADR-019).
- `apps/player-web/` - канонический web delivery layer, который должен потреблять player-facing content API/DTO, а не читать repo files напрямую (ADR-019).
- `packages/contracts/*` - общий contracts layer.
- `draft/*` и импортированные portal/player drafts - reference only, а не canonical runtime/architecture sources.

## Оглавление

- [1. Контекст и цели](#1-контекст-и-цели)
- [2. Логическая архитектура платформы](#2-логическая-архитектура-платформы)
  - [2.1. Backend‑сервисы](#21-backend-сервисы)
  - [2.2. Клиентские компоненты и SDK](#22-клиентские-компоненты-и-sdk)
  - [2.3. Данные и игровые манифесты](#23-данные-и-игровые-манифесты)
  - [2.4. Execution Model и LLM Context Pipeline](#24-execution-model-и-llm-context-pipeline)
  - [2.5. Модель сессий и мультиплеера](#25-модель-сессий-и-мультиплеера)
- [3. Хранилища данных и кэши](#3-хранилища-данных-и-кэши)
- [4. Отражение архитектуры в репозитории](#4-отражение-архитектуры-в-репозитории)
  - [4.1. Структура каталогов](#41-структура-каталогов)
  - [4.2. Текущее состояние реализации](#42-текущее-состояние-реализации)
- [5. Тестирование, наблюдаемость и эксплуатация](#5-тестирование-наблюдаемость-и-эксплуатация)
- [6. Управление legacy и заглушками](#6-управление-legacy-и-заглушками)
- [7. Связь с дорожной картой и ADR](#7-связь-с-дорожной-картой-и-adr)

---

## 1. Контекст и цели

### Бизнес‑контекст
- Платформа Cubica предназначена для создания и проведения обучающих и бизнес‑игр.
- Игры должны поддерживать разные клиентские каналы (браузер, мобильные клиенты, мессенджеры и др.).
- Основная ценность — возможность быстро разрабатывать сценарии (игровые «манифесты») и переиспользовать инфраструктуру запуска игр.

### Техническая стратегия
- Исторический target дизайна платформы опирался на LLM‑first подход, но текущий canonical slice уже использует deterministic runtime и JSON‑manifest source of truth.
- LLM остаётся будущим capability layer для authoring, assistance и richer runtime modes, а не текущим основанием канонического execution path.
- Формат данных: **JSON‑манифесты игр** и версионируемый каталог контента (`data/fixtures/`, `games/`, схемы в `docs/architecture/schemas/`).
- Архитектурные принципы MVP и формат манифестов формализованы в ADR‑001 (`docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md`).
- Протоколы взаимодействия слоев зафиксированы в ADR-002 (`docs/architecture/adrs/002-abstract-view-protocol.md`) и описывают взаимодействие Presenter и View через абстрактный шлюз (Command Pattern + Promises).

---

## 2. Логическая архитектура платформы

### 2.1. Backend‑сервисы (target)

Target backend layer still describes a set of independent services (each in `services/`):

- **Game Editor** (`services/game-editor/`) — редактор игр и сценариев.
  - Позволяет редактировать сценарии и манифесты (JSON) и публиковать их в репозиторий.
- **Game Repository** (`services/game-repository/`) — авторитетное хранилище игровых манифестов и ассетов.
  - На ранних этапах использует файловое хранилище (`data/fixtures/`), в будущем — полноценный сервис с API по спецификации `docs/architecture/repository-openapi.yaml`.
- **Game Catalog** (`services/game-catalog/`) — каталог опубликованных игр.
  - Обеспечивает поиск и фильтрацию игр, интегрируется с системой индексации (см. `docs/architecture/search/qdrant.md`).
- **Router** (`services/router/`) — фронтовой API‑шлюз (маршрутизатор игровых действий).
  - Принимает запросы от клиентов, управляет сессиями и пересылает действия в Game Engine, а также читает данные из Game Repository.
  - **Мультиплеер (ADR-011):** Поддерживает несколько игроков в одной сессии через Event Queue и бродкастинг обновлений.
- **Game Engine** (`services/game-engine/`) — слой интеграции с LLM и выполнения скриптов.
  - **Гибридная композиция (ADR-015):**
    - **Engine Extensions (Build-time):** Компилируются с ядром, отвечают за системные возможности (БД, физика).
    - **User Scripts (Runtime):** Загружаются динамически, отвечают за контент игры.
  - **Безопасность (ADR-010):** Использует `isolated-vm` для изоляции пользовательских скриптов (Sandbox). Расширения работают в доверенной среде.
  - Возвращает структурированные дельты состояния в Router.
- **Metadata Database** (`services/metadata-db/`) — аналитический слой.
  - Сводит события из Router, Engine и Repository для аналитики и отчетности (детально будет развиваться во Фазе 2+).

Outside the current canonical `runtime-api` slice, most service folders remain scaffolds with `DEV_GUIDE.md` and mostly empty `src/`/`tests/`. Это target architecture scaffolding, а не текущая runtime reality.

### 2.2. Клиентские компоненты и SDK

Клиентская часть построена вокруг модульного SDK и конкретных приложений‑клиентов.

**Базовые пакеты SDK (`SDK/`):**
- `SDK/core/` — общие контракты и транспортный слой.
  - Предоставляет тип `SessionOptions`, функцию `createSession` (`SDK/core/src/index.ts`) и протоколы представления (`view-protocol.ts`).
- `SDK/shared/` — переиспользуемые UI‑компоненты и темы (`SDK/shared/src/index.ts`).
- `SDK/react-sdk/` — основной веб‑SDK для React/Next.js.
  - Адаптер Router (`src/adapters/routerClient.ts`) пока реализован как заглушка.
  - Хук `useCubicaSession` (`src/features/session.ts`) инкапсулирует подключение к игровым сессиям.
  - Компонент `GameCanvas` (`src/ui/GameCanvas.tsx`) задаёт базовый макет игрового полотна.
- `SDK/viewers/` — библиотека готовых плееров (Viewers) для различных типов контента.
- `SDK/simulators/` — симуляторы для разработки и тестирования сценариев.
- `SDK/custom-examples/` — примерные и вспомогательные пакеты с документацией.

**Клиентские приложения:**
- `draft/antarctica-nextjs-player/` — archived UI prototype and visual reference only.
- `apps/player-web/` — current canonical web-player scaffold.
  - Должен опираться на `runtime-api` как на session/action boundary и player-facing content boundary.
- `apps/portal-nextjs/` и `services/portal-backend/` — imported portal drafts for later analysis and redesign.
- `draft/Antarctica/` — legacy mechanics reference. На текущем migration этапе `draft/Antarctica/Game.html` остаётся фактическим extraction source для ещё не перенесённой gameplay-логики, но не считается canonical runtime truth.

### 2.3. Данные и игровые манифесты (current conventions + target model)

Игровые манифесты описывают сценарий игры как данные: сущности, переменные, действия, поток экранов и правила формирования контекста для LLM. Они являются источником истины для движка и редактора.

В актуальной архитектуре слой манифестов разделён на два уровня (см. ADR‑001 и ADR‑013):

- **логический манифест** описывает метаданные игры, ссылку на текстовые ассеты (`assets.rules`, `assets.scenario`, `assets.methodology.*`), конфигурацию движка, начальное состояние (`state`) и реестр действий (`actions`). Все смысловые тексты хранятся в Markdown/HTML‑файлах, а в манифесте представлены через ссылки `source_ref` (указание файла и якоря) и, при необходимости, кэш‑поле `resolved`;
- **UI‑манифесты** описывают экраны и компоненты (Hybrid SDUI), привязку UI‑событий к действиям из логического манифеста, а также макеты (изображения + JSON‑описания дизайна), которые служат мостом между дизайнерами и разработчиками. Для одной и той же игры может существовать несколько UI‑манифестов под разные каналы и темы (например, Web и Telegram).

**Дизайн-артефакты для ИИ-агентов (ADR-016):**

Для эффективной работы ИИ-агентов с дизайном UI-манифест поддерживает секцию `design_artifacts`, содержащую:
- реестр дизайн-артефактов (reference, concept, flowchart, wireframe, storyboard, mockup, asset);
- ссылки на внешние JSON-описания изображений с семантической разметкой зон (`regions`) и дизайн-токенами (`style_tokens`);
- граф связей и историю версий артефактов (`design-history.json`).

Это позволяет ИИ-агентам понимать структуру макетов, генерировать UI-код по описаниям и отслеживать эволюцию дизайна от концепта до финального asset.

Текстовое содержимое (правила, сценарий, методические материалы) хранится в отдельных файлах и помечается **якорями** (`<!-- anchor: ... -->` или Markdown‑ID у заголовков). Логический манифест ссылается на эти якоря через `source_ref`, что позволяет автоматически регенерировать кэш‑тексты и держать JSON синхронизированным с естественно‑языковыми описаниями.

- `games/antarctica/` — эталонный пакет игры (манифесты + ассеты).
- **Схемы и форматы:**
  - `docs/architecture/schemas/manifest-structure.md` — концептуальное описание структуры манифеста.
    - `docs/architecture/schemas/ui-schema-concept.md` — концепция гибридной схемы интерфейса (Hybrid SDUI).
    - `docs/architecture/schemas/game-manifest.schema.json` — формальная JSON Schema логического манифеста.
    - `docs/architecture/schemas/ui-manifest.schema.json` — формальная JSON Schema UI‑манифеста (экраны, компоненты, макеты).
    - `docs/architecture/schemas/examples/*.json` — примеры валидных манифестов.
  
  **Версионирование манифестов:**

- Метаданные манифеста содержат поля `schema_version` и `min_engine_version`, описанные в ADR‑008.
  - `schema_version` фиксирует версию схемы данных, а `min_engine_version` — минимальную версию движка, на которой игра может выполняться.
  - Game Engine при загрузке игры проверяет совместимость версий и отклоняет манифесты с неподдерживаемой схемой.

  **Обучающие метаданные и методические материалы:**
  
  - В секции `meta.training` манифеста описываются тренируемые компетенции (список компетенций с идентификаторами и описаниями), формат игры (`single`, `single_team`, `multi`) и рекомендуемая продолжительность сессии (минимум/максимум в минутах).
  - В секции `assets.methodology` задаются пути к markdown‑файлам с методическими материалами:
    - `participants` — материалы для участников (правила, описания сущностей, рекомендации, подсказки, чек‑листы);
    - `facilitators` — материалы для ведущих (интерпретации, вопросы, подсказки, критерии оценки и индикаторы паттернов поведения).
  - Эти поля формализуют обучение поверх игрового сценария и позволяют каталогу/редактору и LLM‑движку учитывать обучательные цели при работе с играми.

**Хранение и доставка манифестов:**

- Канонические манифесты хранятся в Game Repository (файловая система или БД в зависимости от фазы).
- Для ускорения чтения используется Redis‑кэш манифестов (см. `docs/architecture/redis-keys.md` и `docs/architecture/backend/redis-usage.md`), но источником истины остаётся Repository.

### 2.4. Execution Model и LLM Context Pipeline

Execution Model определяет, как платформа обрабатывает ход игрока: какая часть логики выполняется LLM, а какая — детерминированными скриптами, и как формируется контекст запроса к модели.

**LLM Context Pipeline** (`docs/architecture/engine/llm-context-pipeline.md`, ADR‑004):
- Загружает текущее состояние сессии и разделяет его на `public` и `secret` ветки.
- Формирует историю сообщений (sliding window) и, при необходимости, добавляет краткое резюме долгих сессий.
- Подгружает markdown‑ассеты (правила, лор, описания) по ссылкам из манифеста и подставляет их в системный промпт.
- Собирает финальный запрос к LLM с учётом настроек контекста (`include`, размер окна истории и т.п.).

**Hybrid Execution Model** (ADR‑007, ADR-015):
- Действия в манифесте могут обрабатываться LLM (`llm`) или скриптом (`script`), что позволяет совмещать творческую и детерминированную логику.
- **User Scripts** выполняются в защищённой JS‑песочнице (`isolated-vm`) (см. ADR‑010), имеют доступ только к разрешенным API, например, получают копию состояния и аргументы действия и возвращают дельту состояния.
- **Engine Extensions** предоставляют нативные функции, которые могут быть вызваны из скриптов (Bridge), обеспечивая доступ к тяжелым вычислениям или внешним системам.
- Такое разделение ("Слоеный пирог") обеспечивает баланс между безопасностью контента и мощностью движка.

**Протокол взаимодействия с View** (ADR‑002, `docs/architecture/protocols/mvp-interaction.md`):
- Presenter общается с клиентом через абстрактный шлюз команд (`ViewCommand` / `ViewResponse`), не завися от конкретного UI‑фреймворка.
- Это позволяет подключать разные каналы (Web, Telegram и др.) через View Adapters без изменения игровой логики.

### 2.5. Модель сессий и мультиплеера

Модель сессий описывает, как хранится и изменяется состояние игры между ходами и как несколько игроков могут участвовать в одной игровой сессии.

**Сессии и хранение состояния** (ADR‑005, `docs/architecture/backend/session-persistence.md`):
- Состояние сессии хранится в таблице `game_sessions` в PostgreSQL как JSONB (`state` + `history`), с полями `state_version` и `last_event_sequence`.
- Для предотвращения гонок используется пессимистичная или распределённая блокировка сессии на время обработки хода.
- Механизм Session Recovery основан на концепции checkpoint: в БД всегда хранится последнее устойчивое состояние, а при сбоях обработка откатывается к нему с учётом TTL блокировки.

**Мультиплеерная модель** (ADR‑011):
- Для многопользовательских игр вводится очередь событий (`session_events`) и явная версионность состояния (`state_version`, `last_event_sequence`).
- Игроки отправляют действия, которые попадают в очередь; Router и Engine последовательно обрабатывают события и обновляют состояние.
- Обновления состояния рассылаются всем участникам сессии через View Adapters (WebSocket‑шлюз и др.), что обеспечивает консистентность отображения.

### Архитектурные решения (ADR)

Ключевые решения зафиксированы в документах `docs/architecture/adrs/`:

- **ADR-001 (MVP & LLM-first):** Отделение данных (манифеста) от движка.
- **ADR-002 (View Protocol):** Абстрактный протокол UI команд.
- **ADR-003 (Hybrid SDUI):** Гибридная схема серверно-управляемого UI с атомарными примитивами и семантическими виджетами.
- **ADR-004 (LLM Context Pipeline):** Формирование контекста для LLM с разделением public/secret состояния и историей.
- **ADR-005 (Session Persistence):** Хранение состояния сессий, блокировки и стратегия восстановления.
- **ADR-006 (View Adapters):** Архитектура развёртывания и взаимодействия View Adapters.
- **ADR-007 (Hybrid Engine):** Совмещение LLM и JS‑скриптов.
- **ADR-008 (Versioning):** Стратегия версионирования манифестов (`schema_version`, `min_engine_version`).
- **ADR-009 (Assets):** Централизованное управление медиа-ассетами в манифесте.
- **ADR-010 (JS Security):** Использование `isolated-vm` для безопасного выполнения кода.
- **ADR-011 (Multiplayer):** Free-form модель с очередью событий для поддержки нескольких игроков в сессии, явной версионностью состояния (`state_version`) и последовательностью событий (`sequence`), а также правилами обработки зависших и ошибочных событий.
- **ADR-012 (Training Metadata):** Обучающие метаданные и методические материалы в манифесте игры.
- **ADR-013 (Text Anchors & Manifest Split):** Текстовые якоря для синхронизации с источниками и разделение логического и UI-манифестов.
- **ADR-015 (Extension Packs):** Архитектура пакетов расширений и гибридная модель движка (Engine Extensions + User Scripts).
- **ADR-016 (Design Artifacts):** Дизайн-артефакты для ИИ-агентов в UI-манифесте — JSON-описания изображений с семантической разметкой и дизайн-токенами.
- **ADR-017 (Modular Monolith Transition):** Ближайшая backend-фаза строится как модульный монолит с жёсткими внутренними границами; выделение микросервисов откладывается до появления подтверждённых operational boundaries.
- **ADR-018 (JSON Manifest Truth Model):** Исполнимая логика игры закрепляется в `games/<id>/game.manifest.json`, а narrative и draft-артефакты не считаются runtime source of truth.
- **ADR-019 (Runtime-Owned Player Content Boundary):** `runtime-api` владеет загрузкой game content и проекцией player-facing content DTO/API; `player-web` не должен читать `games/*` напрямую.


---
 
## 3. Хранилища данных и кэши
 
Архитектура Cubica использует сочетание реляционной базы данных и высокопроизводительного in‑memory‑хранилища для балансировки надёжности и производительности.
 
- **PostgreSQL** — основной источник истины:
  - хранит игровые сессии (`game_sessions`), манифесты и служебные данные;
  - обеспечивает транзакционность (ACID) и гибкую работу с JSONB.
- **Redis** — слой кэширования и распределённых блокировок (Phase 2+):
  - кэширует манифесты игр и их версии (см. `docs/architecture/redis-keys.md`);
  - используется для кэширования активных сессий и блокировок `lock:session:{session_id}` (см. `docs/architecture/backend/redis-usage.md`);
  - при этом PostgreSQL остаётся единственным источником истины, а потеря данных в Redis не должна приводить к потере прогресса игр.
 
---
 
## 4. Отражение архитектуры в репозитории
 
### 4.1. Структура каталогов
 
Фактическая структура репозитория описана в `PROJECT_STRUCTURE.md`. В контексте архитектуры важно следующее соответствие:

- `services/*` — backend‑сервисы платформы (Editor, Repository, Router, Engine, Catalog, Metadata DB).
- `SDK/*` — SDK‑пакеты и вспомогательные библиотеки для клиентских приложений.
- `draft/*` — прототипы и экспериментальные реализации (портал, плеер, legacy‑игра).
- `data/fixtures/` и `data/mocks/` — игровые данные и моки внешних интеграций (LLM, Router).
- `docs/architecture/*` — архитектурные артефакты (ADR, схемы, SQL, поиск, протоколы).

### 4.2. Текущее состояние реализации

На момент актуализации:

- `services/runtime-api/`, `apps/player-web/`, `packages/contracts/*` и `games/antarctica/` составляют current canonical slice.
- Внутри этого slice filesystem ownership для `games/*` закреплён за `runtime-api`; `player-web` должен зависеть от player-facing backend contracts, а не от прямого чтения repo content.
- `draft/antarctica-nextjs-player/` и imported portal drafts остаются reference/draft artifacts.
- `SDK/core`, `SDK/shared` и `SDK/react-sdk` остаются legacy/supporting packages and do not define the current canonical runtime boundary.
- Future games should be added through `games/*`, `packages/contracts/*` and `runtime-api`, not by extending old draft paths.

---

## 5. Тестирование, наблюдаемость и эксплуатация

Текущая стратегия тестирования задаёт целевой уровень качества для развёртывания сервисов и SDK. Фактическое покрытие ограничено, но ориентиры следующие:

- **Unit‑тесты** — проверка бизнес‑логики, валидации данных и вспомогательных утилит.
- **Интеграционные тесты** — проверка согласованности контрактов между сервисами и SDK.
- **Нагрузочные тесты** — сценарии для Router и Engine.
- **End‑to‑End‑тесты** — сценарии уровня пользователя через веб‑плеер (Next.js) и SDK.

Детальная стратегия тестирования LLM‑игр (включая snapshot/semantic‑подходы и replay LLM‑ответов) будет оформлена в отдельном документе `docs/architecture/testing-strategy.md` и задачах `docs/tasks/features/F_00050_testing_strategy.md`.

**Наблюдаемость и эксплуатация:**

- Все сервисы должны писать структурированные логи в JSON‑формате с correlation/trace ID для трассировки запросов.
- Ключевые метрики (latency, error rate, использование токенов LLM, попадания в rate limit) экспортируются в формате Prometheus.
- Распределённый трейсинг строится на базе OpenTelemetry и охватывает путь запроса через Router, Engine и View Adapters.
- Стандарты наблюдаемости и лимитирования будут зафиксированы в отдельном ADR (Observability Standards) и задачах `docs/tasks/features/F_00051_observability_framework.md` и `docs/tasks/features/F_00052_rate_limiting.md`.

---

## 6. Управление legacy и заглушками

Для контроля временных решений (legacy‑код, заглушки, моки) используется единый реестр.

- **Центральный реестр долга**: `docs/legacy/debt-log.csv`.
- **Реестр заглушек**: `docs/legacy/stubs-register.md`.
- **Моки для сервисов**: `data/mocks/*`.

---

## 7. Связь с дорожной картой и ADR

Архитектурные решения и планы реализации синхронизированы с системой задач:

- `docs/tasks/ROADMAP.md` — высокоуровневый список Milestone/Epic/Feature.
- `docs/tasks/milestones/M_010_game_player_alpha.md` — веха Alpha‑версии игрового плеера.
- `docs/tasks/epics/E_0010_game_manifest_architecture.md` — эпик про архитектуру JSON‑манифестов и LLM‑first плеера.
- `docs/tasks/epics/E_0020_antarctica_nextjs_game_player.md` — эпик по переносу сценария «Antarctica» на Next.js‑плеер.
- `docs/tasks/epics/E_0030_backend_architecture_design.md` — эпик, охватывающий архитектуру Backend и Game Engine.
- `docs/tasks/epics/E_0050_observability_and_quality.md` — эпик, описывающий стратегию тестирования, наблюдаемости и rate limiting.

ADR‑файлы в `docs/architecture/adrs/` фиксируют архитектурные решения. `PROJECT_ARCHITECTURE.md` должен оставаться согласованным с актуальными ADR и ROADMAP.
