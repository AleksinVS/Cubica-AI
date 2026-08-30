<!-- AUTO-GENERATED: do not edit manually. Run node scripts/dev/generate-adr-index.js. -->
# ADR index

This catalogue is generated from the ADR headers. Status values describe the current state of each architecture decision.

## PM review required

The following proposed decisions require explicit product-manager review before they can become binding architecture.

- [ADR-012: Обучающие метаданные и методические материалы в манифесте игры](012-training-metadata-and-methodology-in-manifest.md) — Proposed
- [ADR-017: Переход к модульному монолиту и правила будущего выделения микросервисов](017-modular-monolith-transition-and-service-extraction.md) — Proposed
- [ADR-018: Source of Truth для логики игры находится в JSON-манифесте](018-game-logic-source-of-truth-is-json-manifest.md) — Proposed

## All ADRs

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-000](000-template.md) | Шаблон ADR | Proposed \| Accepted \| Rejected \| Superseded |
| [ADR-001](001-mvp-and-llm-first-game-manifests.md) | MVP и LLM-first архитектура игровых манифестов | Superseded by ADR-013 в части структуры манифестов. |
| [ADR-002](002-abstract-view-protocol.md) | Abstract View Protocol (Command Pattern + Promises) | Accepted |
| [ADR-003](003-hybrid-sdui-schema.md) | Hybrid Server-Driven UI (SDUI) Schema | Accepted |
| [ADR-004](004-llm-context-pipeline.md) | LLM Context Pipeline and Game Editor Role | Accepted |
| [ADR-005](005-session-persistence.md) | Session State Persistence Strategy | Accepted |
| [ADR-006](006-view-adapters-architecture.md) | View Adapters Deployment Architecture | Accepted |
| [ADR-007](007-hybrid-execution-model.md) | Hybrid Execution Model (LLM + JS Script) | Accepted |
| [ADR-008](008-manifest-versioning.md) | Стратегия версионирования манифеста игры | Accepted |
| [ADR-009](009-asset-management-strategy.md) | Centralized Asset Management Strategy | Accepted |
| [ADR-010](010-js-sandbox-security.md) | JS Sandbox Security Strategy | Accepted |
| [ADR-011](011-multiplayer-architecture.md) | Архитектура мультиплеера (Free-form с очередью событий) | Accepted |
| [ADR-012](012-training-metadata-and-methodology-in-manifest.md) | Обучающие метаданные и методические материалы в манифесте игры | Proposed |
| [ADR-013](013-manifest-text-anchors-and-ui-split.md) | Текстовые якоря и разделение логического и UI-манифестов | Accepted (historical lineage; truth-model parts superseded by ADR-018) |
| [ADR-014](014-viewers-library-architecture.md) | Архитектура библиотеки viewers и проверенных клиентских скриптов | Superseded by ADR-064 (2026-07-07) |
| [ADR-015](015-extension-packs-architecture.md) | Архитектура пакетов расширений (Extension Packs) и Гибридная модель Engine | Accepted |
| [ADR-016](016-design-artifacts-in-ui-manifest.md) | Дизайн-артефакты для ИИ-агентов в UI-манифесте | Accepted |
| [ADR-017](017-modular-monolith-transition-and-service-extraction.md) | Переход к модульному монолиту и правила будущего выделения микросервисов | Proposed |
| [ADR-018](018-game-logic-source-of-truth-is-json-manifest.md) | Source of Truth для логики игры находится в JSON-манифесте | Proposed |
| [ADR-019](019-runtime-api-owns-content-loading-and-player-facing-content-api.md) | Runtime API владеет загрузкой игрового контента и player-facing content API | Accepted |
| [ADR-024](024-bounded-manifest-driven-gameplay-mechanics.md) | Manifest-Driven Gameplay Mechanics In Cubica | Accepted |
| [ADR-025](025-json-schema-as-ssot-for-manifest-validation.md) | JSON Schema as Single Source of Truth for Manifest Validation | Accepted |
| [ADR-026](026-game-agnostic-plugin-architecture.md) | Game-Agnostic Plugin Architecture | Accepted |
| [ADR-027](027-universality-improvements.md) | Platform Universality Improvements | Accepted |
| [ADR-028](028-action-templates-for-compact-manifests.md) | Action Templates for Compact Manifests | Superseded by ADR-084 |
| [ADR-029](029-three-tier-logic-model-ladder-of-power.md) | Three-Tier Logic Model (The Ladder of Power) | Superseded by ADR-084 |
| [ADR-030](030-semantic-prototype-manifests.md) | Семантические прототипы манифестов с компиляцией | Draft |
| [ADR-031](031-lightweight-task-plan-and-handoff-system.md) | Lightweight Task, Plan, and Handoff System | Accepted |
| [ADR-032](032-portal-session-launch-boundary.md) | Portal Session Launch Boundary | Proposed |
| [ADR-033](033-portal-runtime-session-binding.md) | Portal Runtime Session Binding | Accepted |
| [ADR-034](034-editor-engine-authoring-manifest-editor.md) | Editor Engine For Authoring Manifest Editing | Draft |
| [ADR-035](035-editor-engine-progressive-semantic-graph-ux.md) | Progressive Semantic Graph UX For Editor Engine | Draft |
| [ADR-036](036-semantic-authoring-and-preview-timeline-editor.md) | Semantic Authoring Structure And Preview-Timeline Editor | Accepted |
| [ADR-037](037-project-local-plugins-and-marketplace-safe-evolution.md) | Project-Local Plugins And Marketplace-Safe Evolution | Accepted |
| [ADR-038](038-testing-architecture-and-policy.md) | Testing Architecture And Policy | Accepted |
| [ADR-039](039-player-web-plugin-bundle-handoff.md) | Player-web Plugin Bundle Handoff | Accepted |
| [ADR-040](040-runtime-api-plugin-architecture.md) | Runtime-api Extension Policy And Declarative Mechanics First | Accepted |
| [ADR-041](041-gameplay-object-state-model.md) | Gameplay Object State Model | Accepted |
| [ADR-042](042-editor-session-versioning-and-lifecycle.md) | Editor Session Versioning And Lifecycle | Accepted |
| [ADR-043](043-copilotkit-ag-ui-agent-ui-foundation.md) | CopilotKit And AG-UI Agent UI Foundation | Accepted |
| [ADR-044](044-agent-ui-portability-and-protocol-boundaries.md) | Переносимость Agent UI и границы протоколов | Accepted |
| [ADR-045](045-cubica-owned-generative-ui-and-mvp-copilotkit.md) | Cubica-Owned Generative UI And MVP CopilotKit Adapter | Accepted |
| [ADR-046](046-ai-driven-game-runtime-mode.md) | AI-Driven Game Runtime Mode | Accepted |
| [ADR-047](047-ai-agent-safety-remediation-gates.md) | AI Agent Safety Remediation Gates | Accepted |
| [ADR-048](048-element-authoring-prompt-contract.md) | Element Authoring Prompt Contract | Accepted |
| [ADR-049](049-dynamic-element-prompt-projection-and-sync-strategy.md) | Dynamic Element Prompt Projection And Sync Strategy | Accepted |
| [ADR-050](050-authoring-prototype-extraction-and-promotion.md) | Authoring Prototype Extraction And Promotion | Accepted |
| [ADR-051](051-api-first-contract-for-modular-monolith.md) | API First Contract For Modular Monolith | Accepted |
| [ADR-052](052-editor-entity-projection-sidecar.md) | In-Memory Editor Entity Projection And Optional Hints Sidecar | Accepted |
| [ADR-053](053-game-defined-ui-panels.md) | Game-Defined UI Panels | Accepted |
| [ADR-054](054-game-ui-manifest-boundary-and-metric-projection.md) | Game/UI Manifest Boundary And Metric Projection | Accepted |
| [ADR-055](055-player-renderer-purity-and-declarative-ui-action-binding.md) | Player Renderer Purity And Declarative UI Action Binding | Accepted |
| [ADR-056](056-manifest-contract-schema-parity-and-testing.md) | Manifest Contract ↔ JSON Schema Parity And Contract Testing | Accepted |
| [ADR-057](057-preview-first-editor-ux-architecture.md) | Preview-First Editor UX Architecture (Unified Entity, Prompt Projection Editing, Editor Caching) | Accepted |
| [ADR-058](058-turn-based-board-game-platform-capabilities.md) | Платформенные возможности пошаговых настольных игр | Accepted (2026-07-06) |
| [ADR-059](059-multiplayer-realization-in-modular-monolith.md) | Реализация мультиплеера в модульном монолите runtime-api | Accepted (2026-07-06) |
| [ADR-060](060-agent-controlled-players.md) | Игроки под управлением ИИ-агента (ИИ-оппоненты) | Accepted (2026-07-06; concrete S9 contract amended 2026-08-13) |
| [ADR-061](061-action-parameters.md) | Параметры действий манифеста (action parameters) | Accepted (2026-07-06) |
| [ADR-062](062-realtime-client-simulation-and-phaser-channel.md) | Класс игр «клиентская симуляция реального времени» и Phaser-канал доставки | Accepted (2026-07-06) |
| [ADR-063](063-game-asset-channel.md) | Канал игровых ассетов (game asset channel) | Accepted (2026-07-06); amended 2026-07-19 (см. [Поправка 2026-07-19](#поправка-2026-07-19-лимиты--рекомендации-тип-css)) |
| [ADR-064](064-headless-core-and-channel-adapters.md) | Стратегия клиентского ядра — headless core и адаптеры каналов (supersedes ADR-014) | Accepted (2026-07-07) |
| [ADR-065](065-editor-as-product-hosted-authoring-studio.md) | Редактор как продукт (hosted authoring studio) | Accepted |
| [ADR-066](066-renderer-core-and-ui-capability-packs.md) | Декомпозиция рендерера — ядро и жанровые UI capability packs | Accepted (2026-07-07) |
| [ADR-067](067-minimal-service-recovery.md) | Минимальное восстановление сервисов на одном хосте (промежуточное) | Accepted (2026-07-08) |
| [ADR-068](068-human-approved-autonomous-agent-workflow.md) | Утверждаемый план и автономное агентное исполнение | Accepted |
| [ADR-069](069-managed-external-skill-adaptation.md) | Управляемая адаптация внешних навыков | Accepted |
| [ADR-070](070-shared-project-skill-catalog.md) | Единый каталог проектных навыков | Accepted |
| [ADR-071](071-facilitated-training-sessions.md) | Фасилитируемые учебные сессии | Accepted |
| [ADR-072](072-declarative-transport-network-board.md) | Декларативное динамическое транспортное поле-граф | Accepted |
| [ADR-073](073-phaser-interactive-board-surface.md) | Интерактивное пошаговое поле на Phaser | Accepted (2026-07-11) |
| [ADR-074](074-schema-declared-resource-references.md) | Объявленные схемой ссылки на игровые ресурсы | Accepted |
| [ADR-075](075-durable-author-version-history.md) | Долговечная история авторских версий | Accepted |
| [ADR-076](076-player-aware-economic-transfers.md) | Единый контракт денежных переводов между областями состояния | Accepted (2026-07-11) |
| [ADR-077](077-serialized-editor-session-mutations.md) | Сериализация изменений рабочей сессии редактора | Accepted |
| [ADR-078](078-canonical-replay-state-fingerprint.md) | Канонический отпечаток состояния для replay | Accepted |
| [ADR-079](079-server-projected-action-availability.md) | Серверная проекция доступности действий | Accepted |
| [ADR-080](080-declarative-map-first-workspace.md) | Декларативное рабочее пространство «карта — основа» | Accepted |
| [ADR-081](081-server-planned-region-minimal-roads.md) | Серверное построение дороги с минимумом областей | Accepted (в части, не замещённой ADR-100) |
| [ADR-082](082-project-knowledge-system.md) | Проектная система знаний Cubica | Accepted |
| [ADR-083](083-universal-composable-gameplay-mechanisms.md) | Универсальные комбинируемые механизмы игрового движка | Accepted |
| [ADR-084](084-typed-transactional-mechanics-ir.md) | Игровые намерения, каталог возможностей и типизированный язык механик | Accepted |
| [ADR-085](085-universal-deck-order-and-geometry-mechanics.md) | Универсальные операции жизненного цикла колод, упорядочивания и геометрических доказательств | Accepted |
| [ADR-086](086-versioned-mechanics-execution.md) | Многоверсионное исполнение закреплённых Mechanics-модулей | Accepted |
| [ADR-087](087-finite-number-and-read-only-nested-projections.md) | Ограниченные конечные числа и типизированные вложенные проекции | Accepted |
| [ADR-088](088-bounded-entity-iteration.md) | Ограниченный атомарный обход выбранных объектов | Accepted |
| [ADR-089](089-bounded-set-add-and-deck-reference-mechanics.md) | Ограниченное добавление в множество и параметризованная ссылка на колоду | Accepted |
| [ADR-090](090-schema-backed-accessible-text-action-field.md) | Доступное текстовое поле параметра игрового действия | Accepted |
| [ADR-091](091-game-owned-stylesheets-channel.md) | Канал game-owned стилей (game-owned stylesheets channel) | Accepted (2026-07-19) |
| [ADR-092](092-public-metric-deltas-on-events.md) | Дельты публичных метрик в публичных событиях (public metric deltas on events) | Accepted (2026-07-19) |
| [ADR-093](093-design-time-screen-layout.md) | Design-time объявление раскладки экрана | Accepted |
| [ADR-094](094-declarative-card-face-flip.md) | Декларативный переворот карточки (front/back face flip) | Superseded (2026-07-21; самостоятельной архитектурной границы |
| [ADR-095](095-non-failing-path-and-dynamic-score-selection.md) | Неаварийный поиск пути и динамические выборки подсчёта | Accepted |
| [ADR-096](096-bounded-random-stream-recovery.md) | Серверная случайность без сохраняемого генератора | Accepted |
| [ADR-098](098-author-material-intake-contract.md) | Общий контракт приёма авторских материалов игры | Draft |
| [ADR-099](099-preview-is-a-read.md) | Предварительный расчёт — это чтение | Accepted |
| [ADR-100](100-region-road-planning-navigation-mesh.md) | Планирование дорог по областям, версия 3 — точная геометрия на навигационной сетке | Accepted |
| [ADR-101](101-product-context-system-boundaries.md) | Границы продуктовой системы знаний | Accepted |
| [ADR-102](102-ordered-bounded-iteration.md) | Упорядоченный обход и позиция в нём | Accepted |
| [ADR-103](103-portable-public-gameplay-journal.md) | Переносимый журнал подтверждённых публичных событий | Accepted |
| [ADR-104](104-facilitator-ai-debrief.md) | Проверяемый ИИ-черновик итогового разбора для ведущего | Accepted |
