# Архитектура платформы Cubica (MVP)

Документ описывает целевую и фактическую архитектуру платформы Cubica на уровне сервисов, SDK и данных. Он дополняет `PROJECT_OVERVIEW.md` (бизнес‑и логический обзор) и ADR‑решения в `docs/architecture/adrs/` и помогает быстро понять, как концепции отражены в структуре репозитория.

Для общего понимания архитектуры этот файл является обязательной краткой выжимкой ADR: сами ADR нужно читать только для дополнительного контекста, альтернатив или глубокого разбора решения.

> Термины:
> - **LLM** — Large Language Model, «большая языковая модель», используемая как игровой движок.
> - **SDK** — Software Development Kit, набор библиотек и утилит для интеграции с платформой.
> - **MVP‑паттерн** — Model–View–Presenter, шаблон разделения модели данных, представления и прослойки‑«презентера».
> - **ADR** — Architecture Decision Record, документ с зафиксированным архитектурным решением.
> - **CopilotKit** — React/Next.js-фреймворк для встраивания ИИ-помощников в приложения; в Cubica это текущий адаптер UI для Agent UI.
> - **AG-UI** — Agent-User Interaction protocol, событийный протокол между пользовательскими приложениями и backend-сервисами ИИ-агентов.
> - **Generative UI** — подход, при котором ИИ-агент выбирает, описывает или обновляет часть интерфейса во время работы.
> - **Элементный промт** — сохраненный authoring-промт конкретного элемента манифеста: описание намерения, содержимого и поведения экземпляра, из которого агент может строить или проверять структурированные поля.
> - **A2UI** — декларативная JSONL-спецификация UI-поверхностей, которую Cubica рассматривает как внешний compatibility reference, а не как источник истины.
> - **Cubica Surface Protocol** — собственный протокол Cubica для описания ограниченных UI-поверхностей помощника: словаря компонентов, модели данных, действий и проверок.
> - **AI-driven game** — игра, где ИИ-агент является обязательной частью runtime и управляет ходом, состоянием шага и UI-поверхностью через валидируемые контракты Cubica.
> - **Agent Runtime** — backend-граница, которая выполняет шаг агента, вызывает модель или локального агента и возвращает структурированный результат для runtime validation.
> - **Game-level prototype** — authoring-прототип, принадлежащий конкретной игре и допускающий локальные предметные детали.
> - **Platform-level prototype** — authoring-прототип платформы Cubica, предназначенный для класса игр или UI-паттернов и не содержащий game-specific деталей.
> - **API First** — подход, при котором внешний контракт API фиксируется и проверяется до или вместе с реализацией endpoint'а.
> - **OpenAPI** — машинно-читаемая спецификация HTTP API: пути, операции, параметры, тела запросов, ответы, ошибки и переиспользуемые схемы.

## Текущий канонический срез

Текущий канонический срез уже реализован и должен читаться первым:

- `games/antarctica/` - canonical content bundle.
- `games/antarctica/game.manifest.json` - source of truth для исполнимой логики игры.
- `games/simple-choice/` - minimal second game fixture that proves the game-agnostic runtime/player path without a custom web plugin.
- `games/ai-driven-choice/` - minimal AI-driven fixture that proves manifest-declared Agent Runtime readiness, Agent Turn execution, Web `CubicaSurface` rendering, deterministic fallback behavior and replay/eval/audit contract gates without runtime game-specific branches.
- `games/antarctica/design/mockups/` - source of truth для UI intent.
- `games/antarctica/game.manifest.json` уже покрывает bounded gameplay slice records до terminal `i21`; архитектурное правило для этих механик закреплено в ADR-024, а step-specific delivery details вынесены в `docs/architecture/gameplay-slices/`.
- `draft/Antarctica/GameFull.html` - текущий factual extraction source для Antarctica mechanics migration; это состояние миграции, а не новое архитектурное решение, и это не canonical runtime source of truth.
- `services/runtime-api/` - канонический backend runtime в формате модульного монолита и owner загрузки игрового контента для runtime/player delivery (ADR-019).
- ADR-051 закрепляет API First для текущего монолита: current `runtime-api` имеет собственный OpenAPI-контракт `docs/architecture/runtime-api-openapi.yaml`, а старые Router/Engine/Repository specs остаются future extraction references до физического выделения сервисов.
- `apps/player-web/` - канонический web delivery layer, который потребляет player-facing content API/DTO и рендерит игры из session snapshot + manifest content projection, а не из repo files напрямую (ADR-019). Для простых игр используется default config builder из `PlayerFacingContent.ui`; для сложных игр сохраняется plugin layer; для AI-driven игр `player-web` проверяет game readiness, показывает pause/retry/unavailable state при недоступном Agent Runtime и рендерит validated `CubicaSurface` из Agent Turn. ADR-053 уточняет UI panels: player-web owns generic panel lifecycle and manifest rendering, but game-specific panel UI such as Antarctica move history must be declared in the game UI manifest, not in platform React components. В editor preview mode player-web может отдавать generic runtime pointer metadata через `postMessage`, не импортирует `editor-engine` и не хранит authoring/editor state. ADR-037 меняет целевой plugin home: пользовательские плагины должны жить в `games/<gameId>/plugins/<pluginId>/`; Antarctica уже перенесена в `games/antarctica/plugins/antarctica-player`. Local preview loads session-scoped plugin bundles through `PlayerFacingContent.pluginBundles`; non-preview mode loads only published bundle references generated under `games/<gameId>/published/`.
- ADR-054 фиксирует границу game/UI manifests: game manifest owns game meaning, UI manifest owns channel presentation, а Presenter owns player-facing projection. В `Antarctica` `time` означает прошедшие игровые дни, `remainingDays` является вычисляемой метрикой "осталось дней", а `score` не должен оставаться скрытым alias for remaining days.
- `packages/contracts/*` - общий contracts layer. `packages/contracts/ai` owns framework-neutral AI contracts: Cubica Surface, Agent Turn, A2UI-like adapter mapping, channel projections for Telegram/Phaser adapters, plugin Surface component contribution metadata, operation policy and replay/eval/audit fixtures.
- `packages/editor-engine/` - framework-agnostic core первого полного authoring editor slice: DocumentStore, JSON Pointer/JSON Patch helpers, text location map, schema registry, graph/tree projections, `TreeViewModelBuilder`, semantic entity tree projection, renderer-neutral preview descriptors, manifest chronology timeline, preview playthrough trace model, diagnostics и reverse projection (ADR-034/ADR-036). Phase 1A добавила authoring v2 schemas, `_label` как поле "Синоним" and minimal compiler fixtures; Phase 1B migrated current authoring manifests to v2; preview hit-test/highlight contracts stay renderer-neutral.
- `apps/editor-web/` - текущий Next.js authoring editor surface: preview-first shell with central preview workspace, iframe preview message bridge, preview selection overlay/object picker/region prompt baseline, collapsible manifest entity tree/graph rail, advanced JSON tree toggle, Monaco JSON editor rail, floating property panel, session-backed authoring file workflow, layout persistence и validate/compile/preview actions; это editor surface, а не runtime/player delivery layer. Phase 8 baseline added automatic active-file JSON ChangeSet apply from preview AI prompts, dry-run validation, undo/redo journal and diff summary. The MVP Agent UI keeps CopilotKit as shell, while editor helper `CubicaSurface` renders tool progress, diagnostics, diff summary and approved editor-tool actions from framework-neutral data. Phase 9 now opens Git worktree sessions for file/layout reads and Save commits; validate/compile run from the session worktree when `sessionId` is present, local preview registers an allowlisted session worktree as runtime-api/player-web `contentSourceId`, and Playwright covers the three-service session preview path. ADR-042 baseline is implemented locally: editor sessions carry platform/plugin API version metadata, reuse compatible active sessions by default, expose upgrade dry-run diagnostics, and provide garbage-collected lifecycle management for expired/orphaned worktrees. JSON Tree mode реализован в `TSK-20260522-editor-engine-json-tree-view`; structural tree operations пока отложены.
- ADR-057 и `docs/architecture/editor-preview-first-ux.md` - accepted UX-архитектура preview-first редактора: единая игровая сущность как проекция фасетов (смысл/содержание/вид) поверх `EditorEntityProjection`, текстовое редактирование через промт-проекцию с интерпретатором возвращённого намерения и шкалой риска, дерево с переключаемой группировкой «По экранам/По типам», разделение осей времени, фикстуры состояния как authoring-артефакт и трёхуровневое кэширование редактора. Реализовано в `TSK-20260704-editor-preview-first-ux-implementation` (Phases 0–9 core, 2026-07-07): проектная game+ui проекция, дерево с occurrences и панель сущности по эталонному макету, интерпретатор возвращённого намерения и текстовый режим, оси времени с лестницей восстановления, фикстуры состояния (`games/<id>/authoring/fixtures/`), атомарные кросс-манифестные операции создания/удаления/рефакторинга через мультидок-конвейер с approval envelope, очередь интентов, диагностический поток с last-valid снимком, регион-снимок как optional adapter capability и секция ассетов; кэш L1/L2/L3 поверх алгофикса компилятора. Концепты §9.7–9.8 (история версий, Telegram-просмотрщик, viewport) — `TSK-20260707-editor-concept-surfaces`.
- `docs/architecture/agent-ui-foundation.md` и ADR-043 - принятая и baseline-реализованная основа пользовательских ИИ-помощников. CopilotKit владеет React/Next.js UI помощника, AG-UI владеет внешним событийным протоколом, а контракты Cubica продолжают владеть манифестами, сессиями, launch-данными и валидацией. Первый кодовый срез находится в `apps/editor-web`: выключенный по умолчанию provider, app-local `/api/copilotkit`, реестр помощников, ограниченная проекция контекста, frontend tools поверх `EditorChangeSet` и нормализация событий AG-UI.
- `docs/architecture/agent-ui-portability-and-risk-controls.md` и ADR-044 - слой переносимости Agent UI: CopilotKit и AG-UI считаются заменяемыми адаптерами, production LLM backend не получает прямую запись в состояние Cubica, а новые помощники проходят через собственные Cubica-контракты, контроль рисков и планы миграции.
- `docs/architecture/generative-ui-surface-protocol.md` и ADR-045 - целевая архитектура Cubica-owned Generative UI: CopilotKit является MVP-адаптером первого этапа, будущий самописный совместимый Cubica Agent UI потребляет те же Cubica-контракты, а декларативные поверхности UI описываются как Cubica Surface specs вместо сохранения CopilotKit/AG-UI/A2UI state в предметных данных.
- `docs/architecture/ai-agent-safety-remediation.md` и ADR-047 - accepted remediation layer после review миграции: approval envelope, rejected Agent Turn semantics, manifest capability gates, channel action policies and production backend auth readiness.
- `docs/architecture/element-prompt-contract.md` и ADR-048 - accepted контракт элементного промта: первый срез реализовал `_prompt` для authoring-экземпляров, `_promptTemplate` для прототипов, compiler stripping и editor schema readiness; `generation.prompt` остается только metadata визуальной генерации для design artifacts. Механизм синхронизации промта и структуры манифеста вынесен в следующий этап.
- ADR-046 - целевой AI-driven game runtime mode: манифест может объявить `ai-driven` или `hybrid` execution mode, Agent Runtime становится обязательной runtime-зависимостью этой игры, а агент возвращает валидируемые state effects, available actions and Cubica Surface.
- `docs/architecture/runtime-mechanics-language.md` - проектное описание минимального декларативного псевдоязыка механик: action, guard/when, effects, state paths, журнал и правила расширения `runtime-api` без веток под конкретную игру.
- `draft/cubica-portal-nextjs/` - current portal draft for test launch analysis; портал должен стать launch surface для покупок, ссылок и игровых сессий, но не runtime source of truth (ADR-032).
- `draft/*` и импортированные portal/player drafts - reference only, а не canonical runtime/architecture sources.

## Оглавление

- [1. Контекст и цели](#1-контекст-и-цели)
- [2. Логическая архитектура платформы](#2-логическая-архитектура-платформы)
  - [2.1. Backend‑сервисы](#21-backend-сервисы)
  - [2.2. Клиентские компоненты и SDK](#22-клиентские-компоненты-и-sdk)
  - [2.3. Данные и игровые манифесты](#23-данные-и-игровые-манифесты)
  - [2.4. Execution Model и LLM Context Pipeline](#24-execution-model-и-llm-context-pipeline)
  - [2.5. Модель сессий и мультиплеера](#25-модель-сессий-и-мультиплеера)
  - [2.6. Agent UI Foundation](#26-agent-ui-foundation)
- [3. Хранилища данных и кэши](#3-хранилища-данных-и-кэши)
- [4. Отражение архитектуры в репозитории](#4-отражение-архитектуры-в-репозитории)
  - [4.1. Структура каталогов](#41-структура-каталогов)
  - [4.2. Текущее состояние реализации](#42-текущее-состояние-реализации)
- [5. Тестирование, наблюдаемость и эксплуатация](#5-тестирование-наблюдаемость-и-эксплуатация)
- [6. Управление legacy и заглушками](#6-управление-legacy-и-заглушками)
- [7. Связь с планированием и ADR](#7-связь-с-планированием-и-adr)

---

## 1. Контекст и цели

### Бизнес‑контекст
- Платформа Cubica предназначена для создания и проведения обучающих и бизнес‑игр.
- Игры должны поддерживать разные клиентские каналы (браузер, мобильные клиенты, мессенджеры и др.).
- Основная ценность — возможность быстро разрабатывать сценарии (игровые «манифесты») и переиспользовать инфраструктуру запуска игр.

### Техническая стратегия
- Исторический target дизайна платформы опирался на LLM‑first подход; текущий canonical slice использует deterministic runtime и JSON‑manifest source of truth, а ADR-046 закрепляет AI-driven runtime как целевой first-class mode для игр, которые явно требуют Agent Runtime.
- LLM остаётся future/current capability layer в зависимости от execution mode: для deterministic games это authoring/assistance layer, для AI-driven games это обязательная runtime dependency через Agent Runtime.
- Пользовательские ИИ-помощники используют CopilotKit/AG-UI как MVP-адаптер Agent UI, но не владеют каноническим состоянием игры, редактора или платформы; целевой слой по ADR-045 - собственный совместимый Cubica Agent UI and Cubica Surface Protocol.
- Review findings по AI agent safety закрыты remediation slice по ADR-047 for MVP provider-safety: approval is not model input, rejected turns do not persist effects, capabilities are executable gates, and channels fail closed for unsupported Surface actions.
- Формат данных: **JSON‑манифесты игр** и версионируемый каталог контента (`data/fixtures/`, `games/`, схемы в `docs/architecture/schemas/`).
- Архитектурные принципы MVP и формат манифестов формализованы в ADR‑001 (`docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md`).
- Протоколы взаимодействия слоев зафиксированы в ADR-002 (`docs/architecture/adrs/002-abstract-view-protocol.md`) и описывают взаимодействие Presenter и View через абстрактный шлюз (Command Pattern + Promises).

---

## 2. Логическая архитектура платформы

### 2.1. Backend‑сервисы (target)

Target backend layer still describes a set of independent services (each in `services/`):

API First applies during the modular-monolith phase. The implemented HTTP API
of `services/runtime-api` is documented in
`docs/architecture/runtime-api-openapi.yaml`; future Router, Game Engine and
Game Repository OpenAPI files describe extraction targets, not current
production coverage, until those services exist as deployable boundaries.

- **Game Editor** (`services/game-editor/`) — редактор игр и сценариев.
  - Позволяет редактировать сценарии и манифесты (JSON) и публиковать их в репозиторий.
  - Первый полный `editor-engine` slice реализован вне service folder: `packages/editor-engine` содержит framework-agnostic core, а `apps/editor-web` содержит Next.js authoring editor surface.
  - Архитектурное правило ADR-034 сохраняется: flow-chart и JSON tree view являются проекциями authoring JSON, Monaco/JSON editor и property panel работают через единый DocumentStore, а visual edits возвращаются в authoring JSON через JSON Patch или в отдельный layout target для editor-only операций.
- **Game Repository** (`services/game-repository/`) — авторитетное хранилище игровых манифестов и ассетов.
  - На ранних этапах использует файловое хранилище (`data/fixtures/`), в будущем — полноценный сервис с API по спецификации `docs/architecture/repository-openapi.yaml`.
- **Game Catalog** (`services/game-catalog/`) — каталог опубликованных игр.
  - Обеспечивает поиск и фильтрацию игр, интегрируется с системой индексации (см. `docs/architecture/search/qdrant.md`).
- **Router** (`services/router/`) — фронтовой API‑шлюз (маршрутизатор игровых действий).
  - Принимает запросы от клиентов, управляет сессиями и пересылает действия в Game Engine, а также читает данные из Game Repository.
  - **Мультиплеер (ADR-011):** Поддерживает несколько игроков в одной сессии через Event Queue и бродкастинг обновлений.
- **Game Engine** (`services/game-engine/`) — слой интеграции с LLM и выполнения скриптов.
  - **Историческая гибридная композиция (ADR-015):**
    - **Engine Extensions (Build-time):** компилируются с ядром, отвечают за системные возможности (БД, физика).
    - **User Scripts (Runtime):** были ранней идеей для динамической контентной логики.
  - **Текущая граница (ADR-040):** новая серверная механика сначала выражается через манифест, JSON Schema и общие platform capabilities. `isolated-vm`, `node:vm` и `worker_threads` не считаются защитой для чужого кода; доверенные runtime-плагины требуют отдельного процесса с JSON-протоколом и отдельного ревью.
  - Возвращает структурированные дельты состояния в Router.
- **Metadata Database** (`services/metadata-db/`) — аналитический слой.
  - Сводит события из Router, Engine и Repository для аналитики и отчетности (детально будет развиваться во Фазе 2+).

Outside the current canonical `runtime-api` slice, most service folders remain scaffolds with `DEV_GUIDE.md` and mostly empty `src/`/`tests/`. Это target architecture scaffolding, а не текущая runtime reality.

### 2.2. Клиентские компоненты и стратегия клиентского ядра

Клиентская часть построена вокруг игро-агностичного плеера `apps/player-web`
(декларативный рендерер UI-манифестов по ADR-055 + проектные плагины по
ADR-037/039), общих контрактов и стратегии «headless core + адаптеры каналов»
(ADR-064). Headless core — ядро без привязки к UI-фреймворку; адаптер канала —
тонкий слой, связывающий ядро с конкретным способом доставки (React/DOM,
Phaser, будущие каналы).

**Опорные слои клиентской части:**
- `packages/contracts/*` — генерируемые из JSON Schema контракты (ADR-056);
  вместе с OpenAPI `runtime-api` (ADR-051) это универсальная интеграционная
  поверхность платформы для любого канала на любом стеке.
- `packages/view-protocol/` — Abstract View Protocol (ADR-002: команды
  Presenter → View) и утилиты JSON Merge Patch / JSON Patch; framework-agnostic
  пакет, семя будущего `player-core`.
- `apps/player-web/src/presenter/` и `src/lib/` — presenter-слой и клиент
  runtime-api; по ADR-064 эти каталоги не импортируют React/Next (шов охраняет
  `npm run verify:player-core-seam`), поэтому извлечение `packages/player-core`
  по триггерам ADR-064 (агентный headless-клиент ADR-060, Phaser-канал ADR-062,
  встраивание вне Next.js) останется механическим переносом.

Историческая слоистая SDK-стратегия (`SDK/core`/`shared`/`react-sdk`/`viewers`,
ADR-014) заменена ADR-064: каталог `SDK/` упразднён, живой код перенесён в
`packages/view-protocol`, внешний публикуемый SDK отложен как планируемая
работа (LEGACY-0037).

Рост самого рендерера управляется ADR-066: зафиксирована ось декомпозиции
«ядро + жанровые UI capability packs» с ленивыми канальными поверхностями,
именованными триггерами и CI-бюджетом бандла как датчиком; до срабатывания
триггеров рендерер остаётся единым (LEGACY-0039).

**Клиентские приложения:**
- `draft/antarctica-nextjs-player/` — archived UI prototype and visual reference only.
- `apps/player-web/` — current canonical web-player scaffold.
  - Должен опираться на `runtime-api` как на session/action boundary и player-facing content boundary.
- `draft/cubica-portal-nextjs/` — current portal draft from upstream `aproskur/cubica-portal-nextjs`; используется для анализа и подготовки test VPS launch with `Antarctica`.
- `apps/portal-nextjs/` и `services/portal-backend/` — imported portal drafts for later analysis and redesign.
- `apps/editor-web/` — current authoring editor surface for ADR-034/ADR-036. Он содержит preview-first workspace, manifest entity tree, advanced JSON tree, JSON editing через Monaco, floating property panel, preview selection overlay/object picker/region prompt baseline, repository file workflow и validate/compile/preview actions поверх `@cubica/editor-engine`.
- `draft/Antarctica/` — legacy mechanics reference. На текущем migration этапе `draft/Antarctica/GameFull.html` остаётся фактическим extraction source для ещё не перенесённой gameplay-логики, но не считается canonical runtime truth.

### 2.3. Данные и игровые манифесты (current canonical model + historical lineage)

Игровые манифесты описывают игру как данные: метаданные, состояние, действия, design references и runtime-facing content. Для current canonical slice `Antarctica` источником истины для исполнимой логики является `games/antarctica/game.manifest.json`, а не narrative markdown.

Практически это означает:

- **game manifest** содержит метаданные игры, конфигурацию, `content` references, конфигурацию движка, начальное состояние (`state`) и реестр действий (`actions`);
- **UI manifests** продолжают существовать как отдельный delivery layer для каналов (`games/<id>/ui/<channel>/ui.manifest.json`), но не являются источником истины для runtime-логики;
- `games/antarctica/design/mockups/` остаётся источником UI intent;
- `draft/Antarctica/GameFull.html` на текущем этапе является только фактическим extraction source для ещё не перенесённой механики. Это текущее состояние миграции, а не новое архитектурное решение, и не canonical runtime truth.

**Game-defined UI panels (ADR-053, Accepted):**

UI-манифесты должны различать primary screens and panels. `screens` описывает основные визуальные состояния игры, связанные с текущим scenario/timeline state. `panels` описывает временные UI-слои поверх текущего экрана: журнал ходов, подсказки, справку, инвентарь и похожие элементы. Платформа владеет только общим lifecycle панели и декларативным manifest rendering. Конкретный UI журнала ходов и подсказки `Antarctica` живет в `games/antarctica/ui/web/ui.manifest.json` как `panels.history` and `panels.hint`, а не в платформенных React-компонентах.

Game manifest не должен содержать UI-only actions для локального открытия таких панелей. Runtime log entries остаются игровыми событиями и могут быть источником данных журнала, но команды "открыть журнал" и "открыть подсказку" принадлежат UI layer and Presenter state. В `Antarctica` старые platform-specific `JournalRenderer`, `HintRenderer`, `showHistory`, `showHint`, `showTopBar` and `showScreenWithLeftSideBar` удалены; layout-only переключатели должны задаваться UI-манифестом, routing state or future schema-backed Presenter commands, not runtime actions.

**Граница game/UI manifest и метрики (ADR-054, Accepted):**

Cubica использует правило смыслового владения: game manifest owns meaning, UI manifest owns presentation, Presenter owns player-facing projection. `game`-манифест хранит игровые сущности и их смысловые тексты: карточки, этапы, персонажей, игровые метрики, названия и описания этих метрик, правила and actions. UI-манифест хранит channel-specific отображение: screen variants, panels, layout, CSS classes, web icons, backgrounds, button labels and local UI-only copy.

Если значение должно быть одинаково понятно в Web, Telegram, Mobile and facilitator reports, оно принадлежит game manifest или player-facing projection из game manifest. Если значение можно заменить при смене канала без изменения игры, оно принадлежит UI manifest.

Для `Antarctica` `state.public.metrics.time` является авторитетной метрикой прошедших игровых дней. `remainingDays` является вычисляемой player-facing метрикой "осталось дней", которую Presenter строит из `time` and declared game limit. `remainingDays` не должен храниться как независимое изменяемое session state, а `score` не должен использоваться как скрытый alias for remaining days. UI topbar/sidebar должны ссылаться на metric identifiers or `metricViews`, а не быть единственным владельцем подписей "Знания", "Доверие", "Энергия" and similar gameplay concepts.

**Дизайн-артефакты для ИИ-агентов (ADR-016):**

Для эффективной работы ИИ-агентов с дизайном UI-манифест поддерживает секцию `design_artifacts`, содержащую:
- реестр дизайн-артефактов (reference, concept, flowchart, wireframe, storyboard, mockup, asset);
- ссылки на внешние JSON-описания изображений с семантической разметкой зон (`regions`) и дизайн-токенами (`style_tokens`);
- граф связей и историю версий артефактов (`design-history.json`).

Это позволяет ИИ-агентам понимать структуру макетов, генерировать UI-код по описаниям и отслеживать эволюцию дизайна от концепта до финального asset.

**Элементные промты (ADR-048, Accepted):**

Authoring-экземпляры получают отдельное поле `_prompt`, а прототипы - `_promptTemplate`. Эти поля описывают авторское намерение конкретного элемента: содержимое, поведение, связи с состоянием, переходы и методический смысл. Они не заменяют `generation.prompt` из design artifacts, потому что `generation.prompt` описывает визуальную генерацию изображения или региона. Первый срез реализован в `manifest-authoring-common.schema.json`, authoring v2 examples, compiler stripping rules и editor schema readiness. Reverse-sync и механизм синхронизации промта со структурой остаются отдельной последующей проработкой.

**Dynamic element prompts, хранение и drift diagnostics (ADR-049, Accepted):**

Принятое направление объединяет storage и A + B lite sync вокруг динамического compiled prompt. `_prompt` должен хранить только static residue - невосстановимое авторское намерение, которое агент не смог надежно сопоставить со структурированными полями. Динамическая часть prompt пересобирается из выбранного game/UI JSON-узла и связанных узлов как YAML-проекция с русскими названиями только значимых игровых, методических или визуальных свойств; технические поля остаются в скрытом source map/context и не показываются пользователю. Русские названия берутся из JSON Schema annotations и authoring/editor field dictionary, а не записываются в каждый элемент. Reverse direction идет через ИИ-агента, который получает compiled prompt, schema context, dictionary и projection source map и возвращает только `EditorChangeSet` с dry-run, validation и подтверждением пользователя. Канонические manifests остаются JSON; YAML используется как presentation format для prompt projection.

**Извлечение и повышение authoring-прототипов (ADR-050, Accepted):**

Cubica принимает три направления для прототипов: локальное извлечение повторяющихся game/UI authoring-элементов в `_definitions` конкретной игры; двухуровневую модель, где локальный game-level prototype может вручную повышаться до platform-level prototype; и AI-assisted prototype designer, который предлагает имя, параметры, `_semantics`, `_promptTemplate` и `EditorChangeSet`, но не применяет изменения напрямую. Platform-level prototype является authoring-only артефактом, не попадает в runtime-api/player-web и не может содержать game-specific id, тексты, метрики или правила. Полностью автоматическое повышение в платформенный каталог отклонено.

Регулярный поиск кандидатов делится на быстрый детерминированный аудит и недельный LLM-семантический аудит. PR-аудит проверяет только измененные authoring-файлы и сначала работает как advisory report; недельный цикл выполняется через CI scheduled workflow на default branch и включает полный deterministic scan, semantic LLM review и promotion backlog review. LLM-аудит может находить смысловые повторы, которые не совпали по JSON-форме, но он создает только candidate records и не может применять `EditorChangeSet`, писать `_definitions` или повышать прототипы без deterministic gates и ручного решения. Editor surface должен показывать неблокирующее уведомление, если weekly audit отсутствует, просрочен, упал или прошел без LLM-семантической части.

Текстовые источники и якоря из более ранней manifest-lineage остаются историческим направлением (см. ADR-013), но не считаются текущей канонической truth model для `Antarctica`. В текущем срезе narrative/extraction artifacts могут существовать как reference material или migration input, но не как runtime source of truth.

- `games/antarctica/` — эталонный пакет игры (манифесты + ассеты).
- `games/simple-choice/` — минимальный второй пакет игры для проверки generic runtime/player boundary без custom plugin.
- `games/ai-driven-choice/` — минимальный AI-driven пакет игры для проверки Agent Runtime readiness, local mock adapter and Agent Turn execution.
- **Схемы и форматы:**
  - `docs/architecture/schemas/manifest-structure.md` — описание концепции манифестов.
  - **Важно:** Согласно ADR-025, единственным источником истины (SSOT) для структуры манифеста является `docs/architecture/schemas/game-manifest.schema.json`. Императивные TypeScript-проверки структуры запрещены; бэкенд использует `ajv` для декларативной валидации.
  - `docs/architecture/schemas/ui-manifest.schema.json` — формальная JSON Schema UI‑манифеста (экраны, компоненты, макеты).
  - `docs/architecture/schemas/examples/*.json` — примеры валидных манифестов.
  
  **Версионирование манифестов:**

- Метаданные манифеста содержат поля `schema_version` и `min_engine_version`, описанные в ADR‑008.
  - `schema_version` фиксирует версию схемы данных, а `min_engine_version` — минимальную версию движка, на которой игра может выполняться.
  - Game Engine при загрузке игры проверяет совместимость версий и отклоняет манифесты с неподдерживаемой схемой.

  **Обучающие метаданные и методические материалы:**
  
  - В секции `meta.training` манифеста описываются тренируемые компетенции (список компетенций с идентификаторами и описаниями), формат игры (`single`, `single_team`, `multi`) и рекомендуемая продолжительность сессии (минимум/максимум в минутах).
  - В текущем manifest shape методические материалы живут в `content.methodology`:
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

**Hybrid Execution Model** (ADR-007, ADR-015, updated by ADR-040):
- Исторически действия в манифесте могли обрабатываться LLM (`llm`) или скриптом (`script`).
- Текущий runtime-api путь для новой детерминированной механики - `manifest-data`: guard, metric deltas, state patches and schema-defined `effects[]`.
- **User Scripts** больше не считаются безопасным путем по умолчанию. Если нужен доверенный runtime-плагин, он должен запускаться отдельным процессом, принимать JSON-вход и возвращать JSON-патч, эффект или событие. Runtime-api проверяет результат и применяет его сам.
- **Engine Extensions** остаются будущей доверенной моделью для тяжелых вычислений или внешних систем, но не заменяют manifest/platform capabilities.

**AI-driven runtime mode** (ADR-046):
- Cubica supports `deterministic`, `ai-driven` and `hybrid` execution modes as manifest-declared platform capabilities.
- In `ai-driven` mode, an Agent Runtime is part of gameplay execution: a player action or system event starts an agent turn, and the agent returns structured output.
- Agent output may include narration, validated state effects, available player actions, diagnostics and a `CubicaSurface` that can be the primary gameplay screen.
- Runtime validates agent output through JSON Schema and semantic rules before persisting state; the agent never writes directly to session storage.
- Deterministic games and deterministic paths remain playable without Agent Runtime. AI-driven games must declare readiness and failure policy before launch.
- Telegram and Phaser integrations consume validated Surface projections, not provider messages or React component instances.
- Production AI-driven rollout requires accepted/rejected event log entries, replay transcripts, evaluation fixtures, audit metadata and operation policy before real provider adapters.

**Antarctica bounded manifest-driven gameplay mechanics** (ADR-024):
- Antarctica gameplay migration uses explicit manifest actions, explicit follow-up paths, and deterministic bounded state instead of a generic workflow engine.
- Threshold progression, metric-gated outcomes, bounded line switching, locked-card unlock, and entry-time alt-card swap are allowed as local manifest mechanics without introducing a platform-wide DSL.
- Player-visible availability and progress must stay auditable through explicit deterministic state, typically in `state.public`.
- Delivery-specific step-, board-, and card-level rules live in Gameplay Slice Records under `docs/architecture/gameplay-slices/`, not in ADRs.

**Runtime mechanics language** (ADR-029, ADR-040):
- Новая серверная механика сначала должна выражаться через manifest templates, guards, JsonLogic, JSON Patch-like effects, metrics, flags, timeline transitions and log entries.
- Этот псевдоязык остается маленьким JSON-форматом для типовых правил; он не должен превращаться в большой workflow engine.
- Если механика требует расширения `runtime-api`, расширение добавляется как общая platform capability with JSON Schema, not as `gameId` branch.
- Cleanup манифеста `Antarctica`, описанный в `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-manifest-cleanup.md`, следует этому правилу: привязанные к игре family names, старые script markers и ссылка на runtime-script заглушку закрыты через manifest/platform capabilities, без runtime plugin и без веток под конкретную игру.

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

### 2.6. Agent UI Foundation

ADR-043 принимает CopilotKit и AG-UI как текущую основу пользовательских ИИ-помощников. ADR-044 уточняет переносимость: CopilotKit и AG-UI являются заменяемыми адаптерами, а стабильным внутренним интерфейсом остаются контракты Cubica. ADR-045 задаёт целевую траекторию: CopilotKit остаётся MVP-адаптером первого этапа, а долгосрочный слой должен стать собственным совместимым Cubica Agent UI с Cubica Surface Protocol для декларативных UI-поверхностей. ADR-046 расширяет применение Surface: в AI-driven games агент может возвращать основную игровую UI-поверхность, если манифест объявляет такой execution mode.

Разделение ролей:

- **CopilotKit** владеет UI помощника в React/Next.js-приложениях: чатом, боковыми панелями, потоковыми ответами, рендером frontend tools и human-in-the-loop controls.
- **AG-UI** владеет внешним событийным протоколом между пользовательскими приложениями и backend-сервисами агентов: run lifecycle, потоковым текстом, tool calls, state snapshots, state deltas и custom events.
- **Контракты Cubica** владеют долговременным предметным состоянием: манифестами, рабочими копиями editor session, runtime sessions, portal launch sessions, лицензиями и аудитом.
- **Cubica Surface Protocol** владеет будущим внутренним форматом декларативных UI-поверхностей помощника: словарём компонентов, data model, actions, validation diagnostics and side-effect policy. A2UI-подобные события могут переводиться в этот формат только через адаптер.

Принятое правило:

```text
assistant suggestion -> Cubica command/change set -> Cubica validation -> Cubica state change
```

Для редактора это означает, что вывод помощника должен стать `EditorChangeSet` и пройти dry-run, JSON Schema validation, semantic validation, plugin boundary checks и запись в undo journal до apply. Для помощников портала, игрока, ведущего и администратора тот же паттерн применяется через их собственные domain APIs и RBAC.

Состояние CopilotKit/AG-UI является производным состоянием UI помощника. Оно не записывается в generated runtime manifests и не меняет gameplay state напрямую. Deterministic public player runtime остаётся работоспособным без agent backend; AI-driven games могут требовать Agent Runtime только через явно объявленный execution mode и readiness policy.

Текущий baseline редактора защищён feature flags:

- `NEXT_PUBLIC_CUBICA_EDITOR_AGENT_UI=1` включает браузерную оболочку помощника.
- `CUBICA_EDITOR_AGENT_RUNTIME=1` включает app-local маршрут CopilotKit runtime.
- `CUBICA_EDITOR_AGENT_AG_UI_URL` и необязательный `CUBICA_EDITOR_AGENT_AG_UI_TOKEN` подключают внешний AG-UI backend.
- Если `CUBICA_EDITOR_AGENT_AG_UI_URL` отсутствует, editor-web использует встроенный локальный AG-UI backend по `/api/editor/agent/ag-ui`, если не задано `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0`.

Без этих флагов `apps/editor-web` сохраняет прежнее поведение редактора. Если локальный backend явно отключён и внешний backend URL не задан, редактор показывает статус подключения помощника и не монтирует CopilotKit hooks, привязанные к агенту.

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
- **ADR-010 (JS Security):** Историческое решение про `isolated-vm`; для текущего runtime-plugin направления действует уточнение ADR-040: `isolated-vm`, `node:vm` и `worker_threads` не являются защитной границей для чужого кода.
- **ADR-011 (Multiplayer):** Free-form модель с очередью событий для поддержки нескольких игроков в сессии, явной версионностью состояния (`state_version`) и последовательностью событий (`sequence`), а также правилами обработки зависших и ошибочных событий.
- **ADR-012 (Training Metadata):** Обучающие метаданные и методические материалы в манифесте игры.
- **ADR-013 (Text Anchors & Manifest Split):** Текстовые якоря для синхронизации с источниками и разделение логического и UI-манифестов.
- **ADR-014 (Viewers Library Architecture):** superseded by ADR-064. Исторический proposed путь для библиотеки viewers в `SDK/viewers/` и проверенных клиентских скриптов; роль viewer закрыта декларативным рендерером (ADR-055) и плагинами (ADR-037/039), а подпись/реестр стороннего кода отложены до появления недоверенного кода (LEGACY-0036).
- **ADR-015 (Extension Packs):** Историческая архитектура пакетов расширений и гибридная модель движка; текущая runtime-api политика уточнена ADR-040.
- **ADR-016 (Design Artifacts):** Дизайн-артефакты для ИИ-агентов в UI-манифесте — JSON-описания изображений с семантической разметкой и дизайн-токенами.
- **ADR-017 (Modular Monolith Transition):** Ближайшая backend‑фаза строится как модульный монолит с жёсткими внутренними границами; выделение микросервисов откладывается до появления подтверждённых operational boundaries.
- **ADR-018 (JSON Manifest Truth Model):** Исполнимая логика игры закрепляется в `games/<id>/game.manifest.json`, а narrative и draft-артефакты не считаются runtime source of truth.
- **ADR-019 (Runtime-Owned Player Content Boundary):** `runtime-api` владеет загрузкой game content и проекцией player-facing content DTO/API; `player-web` не должен читать `games/*` напрямую.
- **ADR-024 (Bounded Manifest-Driven Gameplay Mechanics):** Cubica моделирует bounded gameplay mechanics через explicit manifest actions, explicit follow-up paths и auditable deterministic state; generic workflow/rule/selector engine откладывается до подтверждённого повторного use case, а delivery-specific slice specs выносятся в Gameplay Slice Records.
- **ADR-025 (JSON Schema SSOT):** Runtime manifest structures валидируются через JSON Schema как cross-platform source of truth; TypeScript-only guards не должны заменять декларативные схемы.
- **ADR-026 (Game-Agnostic Plugin Architecture):** Game-specific presentation logic остается в plugin layer, а generic player/runtime слои не получают hardcoded game branches.
- **ADR-027 (Platform Universality Improvements):** `player-web` поддерживает data-driven routing, metric specs и plugin-optional default path для простых игр.
- **ADR-028 (Action Templates):** Runtime game manifest может использовать action templates для компактного описания повторяющихся действий.
- **ADR-029 (Three-Tier Logic Model):** Новая gameplay logic выбирает минимально мощный слой: templates, declarative logic, затем scripts.
- **ADR-030 (Semantic Prototype Manifests):** Draft-решение вводит обязательный authoring layer для game/UI manifests, который компилируется в runtime JSON без authoring-only ключей.
- **ADR-031 (Lightweight Task System):** Текущая работа планируется через `NEXT_STEPS.md`, активные `TSK-*` файлы и артефакты задач, а ADR не используется как execution tracker.
- **ADR-032 (Portal Session Launch Boundary):** Портал управляет покупками, ссылками запуска и launch sessions, а runtime/player сохраняют владение игровым состоянием и отображением.
- **ADR-033 (Portal Runtime Session Binding):** Портальная launch session должна явно связываться с runtime session; single-player day/month используют per-device binding, multiplayer использует shared binding, а one-time всегда ведет в одну runtime session.
- **ADR-034 (Editor Engine For Authoring Manifest Editing):** `editor-engine` редактирует authoring-манифесты через schema-first graph projection, JSON tree view, Monaco/JSON editor, floating property panel и reverse projection в JSON Patch, не создавая второго source of truth. Текущая реализация закрывает graph/tree/text/panel; у Tree mode реализован scalar `set value`, а structural operations вынесены в follow-up.
- **ADR-035 (Progressive Semantic Graph UX For Editor Engine):** следующий UX-срез `editor-engine` заменяет полный JSON-tree canvas на progressive semantic graph: текущая ветка раскрывается поэтапно, соседние ветки сворачиваются, узлы получают semantic roles/titles, а JSON/property panels становятся сворачиваемыми.
- **ADR-036 (Semantic Authoring Structure And Preview-Timeline Editor):** следующий архитектурный поворот editor-engine: реальные game/UI сущности должны жить в `root` authoring-манифестов, `_definitions` остаются прототипами, `_label` хранит отображаемое имя сущности, а основным editor surface становится preview-first workspace с timeline, playthrough traces, entity tree and AI prompt overlay. Phase 1A реализовала v2 schema/fixture/compiler baseline; Phase 1B migrated current authoring manifests to v2; Phase 2/3 added renderer-neutral preview adapter contracts, a thin DOM adapter baseline and the preview-first editor shell; Phase 4 added default semantic entity tree with `_label` diagnostics; Phase 5 added manifest chronology timeline and preview trace restore planning; Phase 6/7 baseline added iframe preview descriptors, source-map pointer mapping, click/region selection overlay, object picker and AI intent queue. Phase 8 baseline added automatic active-file JSON ChangeSet apply, dry-run validation, undo/redo journal and diff summary. Phase 9 added Git worktree sessions for editor file/layout reads, Save commits, restore-commit rollback helpers, plugin boundary checks, session-aware validate/compile, allowlisted local session-aware runtime preview through `contentSourceId` and browser e2e for that local path.
- **ADR-037 (Project-Local Plugins And Marketplace-Safe Evolution):** user-editable plugins move to project-local `games/<gameId>/plugins/<pluginId>/`; first implementation supports trusted local player-web plugins with schema/typecheck/build/test validation, no npm dependencies, hot preview reload and Antarctica migration to `games/antarctica/plugins/antarctica-player`. Marketplace and first-class runtime-api plugins are reserved for later sandboxed evolution. Runtime-api plugin-like code may exist before that ADR only as documented legacy/technical debt when server-side game logic cannot be expressed otherwise.
- **ADR-038 (Testing Architecture And Policy):** тестовая архитектура строится как policy layer (слой правил, который определяет обязательные проверки) поверх текущих runners (запускателей тестов): `node:test` для backend, Vitest для TypeScript/UI packages, Playwright для browser E2E, Ajv/JSON Schema для contract validation и replay/eval contour для gameplay/LLM behavior.
- **ADR-039 (Player-web Plugin Bundle Handoff):** local preview baseline is implemented: `editor-web` builds a session-scoped browser file for project `player-web` plugins, `runtime-api` carries only references through the preview content-source boundary, and `player-web` loads that file only in preview mode. The production model is implemented through immutable content-hash published bundles exposed through `PlayerFacingContent.pluginBundles`; `TSK-20260531-player-web-published-plugin-bundle-handoff` records that slice.
- **ADR-040 (Runtime-api Extension Policy And Declarative Mechanics First):** новая серверная механика сначала обязана проверяться на выразимость через манифест или общую платформенную возможность; функционал под конкретную игру в общем `runtime-api` запрещен; доверенные проектные runtime-плагины запускаются отдельным процессом с JSON-протоколом и отдельным ревью; для marketplace целевой путь - контейнерная песочница или WebAssembly/WASI для чистых вычислений. Полноценный runtime-api plugin runner не реализован и зафиксирован как legacy/debt `LEGACY-0014`.
- **ADR-041 (Gameplay Object State Model):** вводит общий контракт для игрового состояния объектов: authoring-манифест описывает типы объектов и фасеты состояния, runtime state хранит session-scoped object instances, динамические ресурсы создаются через общие effects, а Presenter строит player-facing projection для View. Общий путь и proof на `simple-choice` реализованы; миграция `Antarctica` должна заменить текущие `flags.cards`, а не оставлять постоянный legacy fallback.
- **ADR-042 (Editor Session Versioning And Lifecycle):** accepted editor hardening step: editor sessions are versioned resources with platform release and plugin API metadata, active-session reuse, upgrade dry-run diagnostics and automatic cleanup for expired/orphaned worktrees.
- **ADR-043 (CopilotKit And AG-UI Agent UI Foundation):** accepted platform foundation for user-facing AI assistants. CopilotKit is the default React/Next.js assistant UI layer, AG-UI is the default external agent event protocol, and all durable changes still pass through Cubica contracts and validation boundaries.
- **ADR-044 (Переносимость Agent UI и границы протоколов):** фиксирует CopilotKit как заменяемый UI/runtime-адаптер, AG-UI как заменяемый адаптер внешнего протокола и Cubica agent contracts как долговременную границу для инструментов, контекста, валидации, аудита и production LLM backend.
- **ADR-045 (Cubica-Owned Generative UI And MVP CopilotKit Adapter):** фиксирует CopilotKit как MVP-адаптер первого этапа, целевой собственный compatible Cubica Agent UI и Cubica Surface Protocol for declarative Generative UI.
- **ADR-046 (AI-Driven Game Runtime Mode):** фиксирует `ai-driven` и `hybrid` execution modes, где Agent Runtime может быть обязательной частью игрового исполнения, а агент возвращает валидируемые state effects, actions and Cubica Surface.
- **ADR-047 (AI Agent Safety Remediation Gates):** accepted safety gates перед production Agent Runtime: human approval хранится как Cubica approval envelope, rejected Agent Turn не применяет effects, `allowedCapabilities` является исполняемым runtime allowlist, Surface actions проверяются channel policy, а non-Web projections fail closed.
- **ADR-048 (Element Authoring Prompt Contract):** принятый контракт `_prompt` для authoring-экземпляров и `_promptTemplate` для прототипов; фиксирует отличие элементного промта от `generation.prompt`, `_semantics` и временных editor prompts. Обратная синхронизация и механизм синхронизации промта со структурой остаются отдельной последующей проработкой.
- **ADR-049 (Dynamic Element Prompt Projection And Sync Strategy):** accepted направление: `_prompt` хранит только невосстановимый static residue, dynamic YAML projection строится из текущего JSON-узла с русскими field labels из schema annotations/field dictionary, но показывает только значимые игровые, методические или визуальные свойства; reverse direction идет через agent-produced `EditorChangeSet`, optional Markdown refs разрешены для длинного static residue, covered pointers/hash дают `prompt-stale`, а canonical manifests остаются JSON.
- **ADR-050 (Authoring Prototype Extraction And Promotion):** accepted модель локального извлечения прототипов, ручного повышения game-level prototype до platform-level prototype, AI-assisted designer, регулярного аудита кандидатов и editor notifications о пропущенных weekly audits; runtime/player не резолвят эти прототипы, platform-level catalog остается authoring-only слоем с явными gates против game-specific drift, а недельный LLM-семантический аудит создает только candidate records.
- **ADR-051 (API First Contract For Modular Monolith):** API First применяется уже к current `services/runtime-api`: внешний OpenAPI-контракт описывает реализованные монолитные HTTP endpoints, future service boundaries выражаются тегами/компонентами, а старые Router/Engine/Repository OpenAPI specs считаются target/extraction references до реального выделения сервисов.
- **ADR-052 (In-Memory Editor Entity Projection And Optional Hints Sidecar):** accepted решение вводит project-level `EditorEntityProjection` как in-memory индекс редактора, который связывает logic, content, state, view, design and plugin source pointers across multiple authoring files. Первый срез не создает persisted `editor.entities.json`; optional hints sidecar допустим только позднее и только для невосстановимых editor-only подсказок. Runtime-api, player-web and compiler не читают projection или hints sidecar, а все player-visible изменения записываются через `EditorChangeSet` в исходные authoring manifests.
- **ADR-053 (Game-Defined UI Panels):** accepted решение отделяет primary screens от UI panels. Платформа владеет общим lifecycle and manifest renderer for panels, а game-specific panel UI, включая журнал ходов `Antarctica`, описывается в UI-манифесте игры. UI-only actions вроде открытия журнала не должны жить в game manifest как deterministic game actions, а миграция выполняется без постоянного legacy fallback.
- **ADR-054 (Game/UI Manifest Boundary And Metric Projection):** accepted правило смысловой границы: game manifest owns gameplay meaning, UI manifest owns channel presentation, Presenter owns player-facing projection. Для `Antarctica` `time` означает прошедшие дни, `remainingDays` является вычисляемой метрикой остатка дней, а `score` не должен использоваться как скрытый alias for remaining days.
- **ADR-055 (Player Renderer Purity And Declarative UI Action Binding):** accepted правило чистоты рендерера: generic `player-web` renderer не содержит game-specific идентификаторов кнопок, CSS-классов и карт подписей; привязка действий и ролей блоков объявляется декларативно в UI-манифесте и его схеме, а рендерер только исполняет декларацию.
- **ADR-056 (Manifest Contract ↔ JSON Schema Parity And Contract Testing):** accepted направление синхронизации контрактов: JSON Schema остаётся SSOT (ADR-025), TypeScript-контракты `packages/contracts/*` генерируются из схемы, дрейф ловится CI drift check и контрактными тестами и становится ошибкой сборки, а не тихой рассинхронизацией.
- **ADR-057 (Preview-First Editor UX Architecture):** accepted UX-архитектура редактора: целостность игровой сущности достигается проекцией (чтение) и `EditorChangeSet` (запись) без материализованного editor-manifest; текстовый режим промт-проекции интерпретирует возвращённое намерение с детерминированным быстрым путём, построчным отчётом и шкалой риска через approval envelope; дерево — одна структура с группировками «По экранам/По типам» и вхождениями; оси времени документа и прохождения разделены; закреплённые фикстуры состояния — проверяемый authoring-артефакт; кэш редактора трёхуровневый и никогда не источник истины. Детальный источник — `docs/architecture/editor-preview-first-ux.md`.
- **ADR-058 (Turn-Based Board Game Platform Capabilities):** accepted пакет общих платформенных возможностей пошаговых настольных игр: детерминированная случайность с зерном (`random.roll`, PRNG-состояние в `state.secret.random`), колоды (`deck.shuffle`/`deck.draw` со скрытым порядком), состояние «на игрока» (`state.playersTemplate` → `state.players.<playerId>` по структуре ADR-011, scope `player`, подстановки `{{actor}}`/`{{activePlayer}}`), модель хода (`state.public.turn`, эффекты `turn.next`/`turn.repeat`/`turn.phase.set`, guard `turn`), экономические операции (`metric.transfer`, `metric.set` с JsonLogic) и ограниченное условное ветвление (`when`/одноуровневый `branch`) плюс жизненный цикл игрока и `endConditions`. Торги/аукционы остаются механиками уровня манифеста (ADR-024); доставка настольных игр идёт последовательно: хотсит → сетевой мультиплеер (реализация ADR-011) → ИИ-оппоненты (`hybrid` по ADR-046). Детальный источник — `docs/architecture/board-game-platform-design.md`.
- **ADR-059 (Multiplayer Realization In Modular Monolith):** accepted посадка принятой модели мультиплеера ADR-011 на текущий модульный монолит: PostgreSQL-хранилище сессий (ADR-005) как предусловие, модель участников (seats) с join-токенами и `kind: human|agent`, хотсит как вырожденный случай той же модели, очередь `session_events` с последовательной обработкой под advisory lock, WebSocket endpoint в `runtime-api` и единственный строитель персональной проекции (playerView) для REST/WebSocket/агентов. Router/Web Gateway не выделяются до подтверждённых operational boundaries (ADR-017).
- **ADR-060 (Agent-Controlled Players):** accepted модель ИИ-оппонентов для детерминированных пошаговых игр: агент — участник сессии, а не execution mode; платформа даёт общую проекцию «доступные действия» (реестр × guards), системный Agent Turn на ходе агентского места, выбор действия исполняется тем же детерминированным путём, что и ход человека; честность гарантируется той же персональной проекцией без чужих секретов; отказ агента ведёт к детерминированному fallback-действию по failure policy ADR-046, safety gates ADR-047 действуют без изменений.
- **ADR-061 (Action Parameters):** accepted параметры действий манифеста: действие объявляет `paramsSchema` (плоский объект со скалярными свойствами, явный `additionalProperties: false`), клиент передаёт `params` в `POST /actions`, runtime валидирует их Ajv до guards, провалидированные значения доступны выражениям через ветку `params` контекста JsonLogic и попадают в состояние только явными эффектами. Params — инертные данные: они никогда не интерпретируются как пути, идентификаторы или выражения (нормативные анти-инъекционные правила — `docs/architecture/flow-simulation-platform-design.md` §4.1). Потребители: игры-симуляции (ADR-062), торги/аукционы настольных игр (ADR-058 §2.7), проекция `availableActions` (ADR-060).
- **ADR-062 (Realtime Client Simulation And Phaser Channel):** accepted класс игр «клиентская симуляция реального времени» и Phaser-канал доставки: реальное время живёт в клиентской сцене плагина игры, runtime владеет границами раундов через обычные детерминированные действия (старт раунда фиксирует зерно эффектом `random.seed`, фиксация итогов идёт параметрами по ADR-061 с guard-инвариантами); вся случайность сцены выводится из зерна платформенной утилитой seeded PRNG (алгоритм идентичен серверному xoshiro128**); Phaser — зависимость платформы (`apps/player-web`, ленивая загрузка) с инъекцией в плагин через точку вклада `phaserSceneFactory` и компонент UI-манифеста `simulationSurface`; граница честности MVP — сервер проверяет итоги схемой и инвариантами, но не пересимулирует (соревновательные режимы — только через новый ADR). Детальный источник — `docs/architecture/flow-simulation-platform-design.md`.
- **ADR-063 (Game Asset Channel):** accepted канал игровых ассетов: файлы изображений живут в `games/<id>/assets/` с декларативным реестром `assets.json` (новая JSON Schema, обязательное происхождение/лицензия), runtime-api раздаёт их контент-адресуемо (индекс id→URL + файлы `/game-assets/{gameId}/{assetId}/{sha256}.{ext}` с иммутабельным кэшем) по образцу published-бандлов плагинов; Phaser-сцена получает резолвер `assets` в контексте (по id, не по пути), UI-манифест использует форму `asset:<id>`, SVG — основной агенто-писаемый формат с нормативной CI-санитизацией и защитными заголовками. Существующее размещение картинок «Антарктиды» в `apps/player-web/public/` оформлено долгом LEGACY-0023. Детальный источник — `docs/architecture/game-asset-channel-design.md`.
- **ADR-064 (Headless Core And Channel Adapters, supersedes ADR-014):** accepted стратегия клиентского ядра: универсальная интеграционная поверхность платформы — контракты (OpenAPI ADR-051 + JSON Schema ADR-025/056), а не код-библиотека; каталог `SDK/` упразднён, живой код бывшего `SDK/core` (Abstract View Protocol ADR-002 + JSON Merge Patch/JSON Patch) перенесён в `packages/view-protocol`; шов будущего `player-core` (`presenter/`+`lib/` в `player-web` без React/Next-импортов) охраняется CI-проверкой `verify:player-core-seam`; извлечение `packages/player-core` выполняется по именованным триггерам (первый не-React потребитель: headless-клиент агентного игрока ADR-060, Phaser-канал ADR-062, встраивание вне Next.js); внешний публикуемый SDK — отложенная планируемая работа (LEGACY-0037); транспортные клиенты при росте API генерируются из OpenAPI, а не пишутся вручную.
- **ADR-065 (Editor As Product — Hosted Authoring Studio):** proposed (черновик к согласованию): целевая модель хостируемой студии — раздельные authoring/delivery-контуры (инвариант ADR-042 §8.1 как граница развёртывания); контент внешних авторов выносится из монорепозитория в Git-репозитории проектов (промежуточная ступень — контентный репозиторий арендатора) с привязкой к `platformReleaseId` (ADR-042), канонические игры остаются CI-фикстурами платформы, хранилищем проектов и опубликованных версий владеет Game Repository; единый вход портала и студии (IdP фиксируется отдельным ADR о доступе), мультиарендность — общий пул с логической изоляцией (`tenant_id`, префиксы путей) и квотами; публикация — неизменяемые контент-адресуемые версии игры по образцу ADR-039/063, публичный runtime читает только опубликованное; LLM-операции — через шлюз с бюджетами арендатора и журналом аудита (ADR-046/047); производительность сессий — только кэш ADR-057 §10 (без отдельного prebuild-механизма).
- **ADR-066 (Renderer Core And UI Capability Packs):** accepted ось декомпозиции рендерера: ядро (layout, экраны, привязка действий, выражения, базовые компоненты) + жанровые UI capability packs — клиентская симметрия серверных capabilities ADR-058; UI-манифест объявляет требуемые пакеты, загрузка ленивая, реестр типов компонентов заменяет статический switch вместе с первым реальным пакетом; каналы — ленивые острова по прецеденту Phaser (ADR-062); каждый пакет приносит композируемый модуль схемы и конформанс-фикстуру; объективный датчик — CI-бюджет first-load JS (`TSK-20260707-player-web-bundle-budget`); триггеры декомпозиции: второй жанровый набор компонентов, срабатывание бюджета, третий канал доставки. Сама декомпозиция до триггеров не выполняется; game-specific компоненты в пакетах запрещены (правило 10, ADR-055).
- **ADR-067 (Minimal Service Recovery — single-host, interim):** accepted промежуточный механизм восстановления: однохостовый супервайзер процессов с рестартом по health-проверке (`scripts/ops/service-supervisor.mjs`, без внешних зависимостей) как временная замена оркестратору до реализации задекларированной модели k8s/serverless (PROJECT_OVERVIEW §5, LEGACY-0026). Профиль по умолчанию — прод-контур доставки (runtime-api + player-web; редактор — локальный инструмент, LEGACY-0036); сигналы — существующие `/health`+`/readiness` (runtime-api) и `/` (Next). Восстанавливает только процесс: живые сессии теряются при рестарте до персистентности (LEGACY-0009). Границы (нет HA/rolling-restart/распределённой готовности/восстановления состояния) и триггеры обязательной замены на orchestrator-grade восстановление зафиксированы; разрыв — долг LEGACY-0042. Исполнительная документация — `docs/processes/service-recovery-runbook.md`.


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
 
Фактическая структура репозитория описана в `PROJECT_STRUCTURE.yaml`. В контексте архитектуры важно следующее соответствие:

- `services/*` — backend‑сервисы платформы (Editor, Repository, Router, Engine, Catalog, Metadata DB).
- `apps/*` — web applications and prototypes, including canonical `apps/player-web` and current authoring editor prototype `apps/editor-web`.
- `packages/*` — shared TypeScript packages, including contracts, the framework-agnostic `packages/editor-engine` and `packages/view-protocol` (ADR-064).
- `draft/*` — прототипы и экспериментальные реализации (портал, плеер, legacy‑игра).
- `data/fixtures/` и `data/mocks/` — игровые данные и моки внешних интеграций (LLM, Router).
- `docs/architecture/*` — архитектурные артефакты (ADR, gameplay slice records, схемы, SQL, поиск, протоколы).

### 4.2. Текущее состояние реализации

На момент актуализации:

- `services/runtime-api/`, `apps/player-web/`, `packages/contracts/*` и `games/antarctica/` составляют current canonical slice.
- Current `runtime-api` API coverage по ADR-051 идет через `docs/architecture/runtime-api-openapi.yaml`; физическое выделение Router/Game Engine/Game Repository не требуется для API First, но будущая extraction должна сохранять или версионировать этот контракт.
- `games/simple-choice/` входит в canonical verification как game-agnostic fixture: он создаёт сессию, рендерится через UI manifest и выполняет deterministic action без Antarctica-specific player plugin.
- `games/ai-driven-choice/` входит в canonical verification как AI-driven fixture: без Agent Runtime readiness он не запускается, а при явном local mock opt-in проходит session launch и `POST /agent-turns` без веток по `gameId` в runtime core.
- `packages/editor-engine/` и `apps/editor-web` составляют current authoring editor implementation по ADR-034/ADR-036. Этот срез не меняет runtime/player boundary и не является источником runtime logic.
- В authoring editor реализованы generic graph projection, semantic entity tree, advanced JSON Tree view, Monaco JSON editor, floating property panel, session-backed authoring file saving, editor-only layout persistence, session-aware validate/compile and local runtime preview baseline with browser e2e coverage, compiler/runtime validation, player preview, безопасное подмножество writable graph/tree operations через JSON Patch, renderer-neutral preview adapter protocol, thin DOM adapter baseline, iframe preview bridge, preview selection overlay/object picker/region prompt baseline, manifest chronology timeline, preview trace restore planning, automatic active-file JSON ChangeSet apply with undo/redo baseline and server-side Project Git Workspace helpers. ADR-052 first implementation adds project-level in-memory `EditorEntityProjection` contracts, builder, first game/UI lenses, YAML prompt projection helper, editor-web read-only view-model integration and selected-entity Agent context. It unifies logic/content/view pointers across multiple authoring manifests while preserving authoring manifests as source of truth; persisted projection hints remain a future, hints-only option rather than a canonical editor manifest.
- ADR-037 is the current plugin architecture boundary for this editor work: project-local plugin schema, Antarctica migration, discovery, `platform-only` dependency checks, direct typecheck diagnostics, local preview bundle handoff, player-web hot preview reload and production published bundle handoff are implemented for trusted local `player-web` plugins. Completion record for `Antarctica`: `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`. ADR-039 now has an implemented production/published model: publish creates immutable content-hash `player-web` plugin bundles, runtime-api exposes published bundle references in `PlayerFacingContent`, and player-web loads only published bundle references outside editor preview. Remaining plugin architecture gaps are dedicated editor UI journal rows and future marketplace/runtime hardening. ADR-040 принят как политика runtime-api extension: манифест сначала, никаких веток под конкретную игру в runtime core, trusted project runtime plugins через отдельный процесс с JSON-протоколом и отдельное ревью, container/WASI sandbox для marketplace. Cleanup манифестов `Antarctica` и `simple-choice` завершен: deterministic-изменения состояния, метрик, timeline и журнала идут через `effects[]`, а schema/runtime принимают один текущий формат deterministic-изменений. Полноценный runtime-api plugin runner зафиксирован как `LEGACY-0014`. Исполнительный record закрытия разрывов: `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/plugin-gap-closure-plan.md`.
- Editor UX-срез по ADR-035 и `TSK-20260522-editor-engine-progressive-graph-ux` реализован и e2e-принят: raw JSON-tree graph заменен на progressive semantic graph, видимая диаграмма ограничена active branch, JSON/property panels могут сворачиваться. ADR-036 now has a baseline preview-first workspace shell, semantic entity tree, timeline model, preview selection overlay, automatic AI JSON ChangeSet apply, Project Git Workspace file workflow, session-aware validate/compile, local runtime preview content sources and local player plugin bundle preview; next architectural gap is full rollback UI, production/remote generated bundle handoff policy, plugin test runner policy and richer playthrough rollback UI.
- `draft/cubica-portal-nextjs/` является текущим portal draft для следующего стратегического шага: test VPS launch с одной игрой `Antarctica`. Он не должен становиться источником исполнимой игровой логики.
- В этом canonical slice bounded gameplay records `GSR-020`..`GSR-029` уже реализованы и доводят opening flow до terminal `i21`; архитектурные ограничения для такого моделирования зафиксированы в ADR-024.
- Внутри этого slice filesystem ownership для `games/*` закреплён за `runtime-api`; `player-web` должен зависеть от player-facing backend contracts, а не от прямого чтения repo content.
- `draft/antarctica-nextjs-player/` и imported portal drafts остаются reference/draft artifacts.
- Каталог `SDK/` упразднён по ADR-064: живой код бывшего `SDK/core` живёт в `packages/view-protocol`, мёртвые пакеты (`react-sdk`, `shared`, `viewers`) удалены.
- Future games should be added through `games/*`, `packages/contracts/*` and `runtime-api`, not by extending old draft paths. Новые серверные механики должны проходить через `docs/architecture/runtime-mechanics-language.md` and ADR-040 before runtime code is added.

---

## 5. Тестирование, наблюдаемость и эксплуатация

Текущая стратегия тестирования задаёт целевой уровень качества для развёртывания сервисов, SDK и игровых пакетов. Детальная политика зафиксирована в `docs/architecture/testing-strategy.md`, а архитектурный выбор — в ADR-038.

Основной подход: сохранить текущие runners (запускатели тестов) по зонам ответственности и добавить единый policy layer (слой правил, который определяет обязательные проверки) поверх них.

- **Static/governance checks** — проверка типов, generated drift, legacy/stub registers, game-agnostic invariants и JSON Schema как source of truth.
- **Unit‑тесты** — проверка бизнес‑логики, валидации данных и вспомогательных утилит.
- **Contract‑тесты** — проверка DTO (Data Transfer Object, объект передачи данных между слоями), manifests, schemas и compiler output между слоями.
- **API contract checks** — OpenAPI validation, endpoint inventory drift checks and representative request/response fixture validation for current `runtime-api` по ADR-051.
- **Интеграционные тесты** — проверка согласованности публичных границ между сервисами, SDK и adapters.
- **Component‑тесты** — проверка поведения React‑компонентов через пользовательские роли, текст и доступные состояния.
- **End‑to‑End‑тесты** — сценарии уровня пользователя через Playwright, runtime-api, player-web и editor-web.
- **Replay/eval‑тесты** — будущий контур для gameplay/LLM behavior, где replay означает повтор записанного сценария, а eval — оценочный тест качества ответа или состояния.

Live LLM, реальные платежи и внешние сети не входят в быстрый PR-гейт; они проверяются через replay, моки, test VPS или отдельные release/nightly checks.

**Наблюдаемость и эксплуатация:**

- Все сервисы должны писать структурированные логи в JSON‑формате с correlation/trace ID для трассировки запросов.
- Ключевые метрики (latency, error rate, использование токенов LLM, попадания в rate limit) экспортируются в формате Prometheus.
- Распределённый трейсинг строится на базе OpenTelemetry и охватывает путь запроса через Router, Engine и View Adapters.
- Стандарты наблюдаемости и лимитирования должны фиксироваться в отдельном ADR и активной рабочей задаче в `docs/tasks/active/`.

---

## 6. Управление legacy и заглушками

Для контроля временных решений (legacy‑код, заглушки, моки) используется единый реестр.

- **Центральный реестр долга**: `docs/legacy/debt-log.csv`.
- **Реестр заглушек**: `docs/legacy/stubs-register.md`.
- **Моки для сервисов**: `data/mocks/*`.

---

## 7. Связь с планированием и ADR

Архитектурные решения и планы реализации синхронизированы с легковесной системой задач из ADR-031:

- `NEXT_STEPS.md` — текущая доска проекта (`Now / Next / Later / Blocked`).
- `docs/tasks/active/` — активные рабочие задачи `TSK-*`, объединяющие план, критерии приемки, проверки, артефакты и журнал передачи.
- `docs/tasks/artifacts/` — постоянные артефакты рабочих задач.
- `docs/tasks/archive/` — архив старой системы `milestones/`, `epics/`, `features/`, `content-packs/`.

ADR‑файлы в `docs/architecture/adrs/` фиксируют архитектурные решения. `PROJECT_ARCHITECTURE.md` является обязательной краткой выжимкой этих решений и должен оставаться согласованным с актуальными ADR, `NEXT_STEPS.md` и активными задачами.

Правило синхронизации:

- любое добавление или изменение ADR должно в том же изменении обновлять `PROJECT_ARCHITECTURE.md`;
- в `PROJECT_ARCHITECTURE.md` должны быть отражены все текущие активные и перспективные ADR, включая `Accepted`, `Proposed` и `Draft`, если они описывают живое или возможное направление архитектуры;
- описание решения должно быть минимально необходимым и достаточным: суть решения, ключевые ограничения, инварианты и последствия, без планов исполнения и без дублирования всего ADR;
- агенты должны проверять актуальность `PROJECT_ARCHITECTURE.md` при изменении статуса, области действия, ограничений или последствий ADR;
- для общего понимания архитектуры достаточно `PROJECT_ARCHITECTURE.md`; отдельные ADR читаются только для дополнительного контекста, альтернатив или глубокого разбора.
