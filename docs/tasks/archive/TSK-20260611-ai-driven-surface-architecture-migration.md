# TSK-20260611-ai-driven-surface-architecture-migration: Migration To Cubica Surface And AI-Driven Runtime

- **Дата создания**: 2026-06-11
- **Статус**: completed
- **Владелец**: Codex
- **Связанные ADR**: ADR-025, ADR-040, ADR-043, ADR-044, ADR-045, ADR-046
- **Связанные документы**: `docs/architecture/generative-ui-surface-protocol.md`, `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`, `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`, `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`

## Оглавление

- [1. Цель](#1-цель)
- [2. Как Понята Миграция](#2-как-понята-миграция)
- [3. Текущее Состояние](#3-текущее-состояние)
- [4. Целевое Состояние](#4-целевое-состояние)
- [5. Правила Миграции](#5-правила-миграции)
- [6. План Миграции](#6-план-миграции)
- [7. Влияние На Подсистемы](#7-влияние-на-подсистемы)
- [8. Риски И Обходные Пути](#8-риски-и-обходные-пути)
- [9. Критерии Приёмки](#9-критерии-приёмки)
- [10. План Проверки](#10-план-проверки)
- [11. Артефакты](#11-артефакты)
- [12. Журнал Передачи](#12-журнал-передачи)

## 1. Цель

Перевести платформу от текущего deterministic canonical slice к архитектуре, где:

- CopilotKit остаётся MVP-адаптером первого этапа для UI ИИ-помощников;
- Cubica Surface становится собственным переносимым контрактом для ограниченных UI-поверхностей;
- Agent Runtime становится опциональной или обязательной runtime-зависимостью в зависимости от manifest execution mode;
- deterministic игры продолжают работать без Agent Runtime;
- AI-driven игры получают официальный путь, где агент управляет ходом, валидируемыми эффектами состояния и основной игровой UI-поверхностью.

## 2. Как Понята Миграция

Миграция понята как поэтапный переход, а не как одномоментная замена runtime, player или CopilotKit.

Нужно сохранить уже работающий путь `game.manifest.json -> runtime-api -> player-web`, а новые возможности вводить контрактами и проверками:

- **Cubica Surface** - JSON-описание ограниченной UI-поверхности, которое проверяется схемой Cubica и рендерится разными каналами.
- **Agent Runtime** - серверная граница, которая выполняет ход ИИ-агента и возвращает структурированный результат для проверки runtime.
- **Agent Turn** - один ход агента: входной контекст сессии и выход с narration, эффектами состояния, доступными действиями, диагностикой и `CubicaSurface`.
- **Execution mode** - режим исполнения игры в манифесте: `deterministic`, `hybrid` или `ai-driven`.

Эта работа не принимает новое архитектурное решение. Она исполняет уже принятые ADR-045 и ADR-046 и связывает две отдельные задачи в один порядок внедрения.

## 3. Текущее Состояние

Уже есть:

- `services/runtime-api` как канонический deterministic runtime;
- `apps/player-web` как канонический web delivery layer;
- `games/antarctica` и `games/simple-choice` как проверочные игры;
- `games/ai-driven-choice` как минимальная committed AI-driven fixture-игра;
- `packages/contracts/*` как общий contracts layer;
- CopilotKit/AG-UI baseline в `apps/editor-web`, выключенный по умолчанию;
- ADR-045 с решением о Cubica-owned Surface Protocol;
- ADR-046 с решением о first-class AI-driven game runtime mode;
- `packages/contracts/ai` contract foundation for `CubicaSurface`, Agent Turn, execution-mode proposal, default catalog, validation helpers, Telegram/Phaser projections, plugin contribution metadata and replay/eval/audit fixtures;
- `docs/architecture/schemas/game-manifest.schema.json` additive execution-mode and Agent Runtime declaration support.
- `apps/player-web` paused/retry/unavailable state for required Agent Runtime and first Web `CubicaSurface` renderer for the MVP gameplay catalog.

Не хватает:

- concrete Telegram and Phaser client adapters that consume the projection contracts;
- post-MVP custom Cubica Agent UI implementation after parity acceptance.

## 4. Целевое Состояние

После миграции платформа должна поддерживать три режима:

1. `deterministic`: игра исполняется манифестом и platform capabilities. Agent Runtime не нужен.
2. `hybrid`: часть ходов deterministic, часть ходов проходит через Agent Runtime по разрешённым точкам манифеста.
3. `ai-driven`: Agent Runtime является обязательной частью игрового исполнения; агент возвращает валидируемые эффекты состояния, доступные действия и `CubicaSurface`.

Общий поток для AI-driven игры:

```text
player action or system event
  -> runtime-api
  -> Agent Runtime
  -> Agent Turn result
  -> JSON Schema validation
  -> semantic validation
  -> accepted state effects and CubicaSurface
  -> player-facing projection
  -> Web, Telegram or Phaser renderer
```

Общий поток для deterministic игры остаётся прежним:

```text
player action
  -> runtime-api
  -> manifest-defined deterministic handler
  -> validated session state
  -> player-facing projection
  -> player-web or another channel
```

## 5. Правила Миграции

1. Сначала контракты, потом UI. Нельзя начинать с React-компонентов как источника истины.
2. JSON Schema остаётся SSOT для новых структур. Ручные TypeScript-only проверки не заменяют схемы.
3. Agent Runtime не пишет напрямую в session storage. Runtime принимает или отклоняет результат агента.
4. CopilotKit не попадает в предметные пакеты, runtime core, game manifests or player contracts.
5. Web renderer не должен диктовать формат Telegram или Phaser renderer.
6. Deterministic игры должны проходить smoke-проверки при выключенном Agent Runtime.
7. AI-driven игра должна явно объявлять failure policy: `pause`, `retry`, `deterministicFallback` или `facilitatorTakeover`.
8. Новая механика классифицируется как общая platform capability или game-specific content. В core нельзя добавлять ветки под конкретную игру.
9. Неподдерживаемый компонент Surface должен давать безопасную диагностику или объявленный fallback, а не падение всего клиента.
10. Производственная AI-driven игра не публикуется без replay/eval fixtures и audit metadata.

## 6. План Миграции

### Phase 0 - Документационная Синхронизация

Статус: completed.

- [x] Принять ADR-045: CopilotKit как MVP-адаптер, Cubica Surface как целевой контракт.
- [x] Принять ADR-046: AI-driven runtime mode как first-class platform capability.
- [x] Обновить архитектурные обзоры и стратегию.
- [x] Использовать этот TSK как главный порядок внедрения для Surface + AI-driven работ.

Выход фазы: архитектурные решения не противоречат друг другу, а исполнительные TSK связаны одним migration plan.

### Phase 1 - Contract Foundation

Зависимости: Phase 0.

- [x] Выбрать финальное место для общих AI/surface contracts: `packages/contracts/ai`.
- [x] Добавить `CubicaSurface` TypeScript types.
- [x] Добавить `CubicaSurface` JSON Schema.
- [x] Добавить `AgentTurnInput` and `AgentTurnResult` types.
- [x] Добавить Agent Turn JSON Schema.
- [x] Добавить manifest schema proposal for `executionMode`, `agentRuntime`, `allowedCapabilities`, `surfaceCatalog` and `failurePolicy` as `CubicaExecutionModeConfig`.
- [x] Добавить минимальные fixtures for valid/invalid surface and agent turn results.

Выход фазы: новые структуры описаны декларативно и могут проверяться без React, CopilotKit или provider SDK.

### Phase 2 - Validation And Boundaries

Зависимости: Phase 1.

- [x] Добавить AJV validation helpers for Surface and Agent Turn.
- [x] Добавить semantic validation: unknown component, unknown action, unsupported channel, forbidden state path, missing failure policy.
- [x] Расширить import-boundary проверки: CopilotKit, AG-UI and provider SDK imports allowed only in adapter/application boundaries.
- [x] Добавить policy for direct state mutation rejection.
- [x] Зафиксировать event log shape для accepted/rejected agent turns.

Выход фазы: runtime and editor can reject unsafe agent output before persistence or UI execution.

### Phase 3 - Editor MVP Surface Renderer

Зависимости: Phase 2, active TSK-20260610.

- [x] Render controlled tool progress surface in `apps/editor-web`.
- [x] Render declarative diagnostics and diff summary surface in `apps/editor-web`.
- [x] Подключить mutating actions только через existing `EditorChangeSet`, dry-run, approval and undo journal.
- [x] Оставить CopilotKit как shell/transport adapter for MVP.
- [x] Добавить custom Cubica Agent UI parity checklist.

Выход фазы: редактор показывает Surface через Cubica contract, а не через постоянную привязку к CopilotKit render API.

### Phase 4 - Deterministic Player Preservation

Зависимости: Phase 2.

- [x] Проверить `simple-choice` без Agent Runtime.
- [x] Проверить `Antarctica` без Agent Runtime.
- [x] Добавить smoke for Agent Runtime disabled mode.
- [x] Убедиться, что player readiness clearly separates deterministic content readiness from AI-driven agent readiness.
- [x] Убедиться, что `player-web` does not import CopilotKit, AG-UI or provider SDK.

Выход фазы: новая архитектура не ломает текущий canonical gameplay path.

### Phase 5 - AI-Driven Runtime Pilot

Зависимости: Phase 1, Phase 2, active TSK-20260611.

- [x] Создать маленькую fixture-игру, например `ai-driven-choice`, вместо изменения Antarctica первой.
- [x] Объявить в манифесте `executionMode: "ai-driven"`.
- [x] Добавить local/mock Agent Runtime adapter for deterministic tests.
- [x] Реализовать Agent Turn endpoint or internal route behind feature flag.
- [x] Agent result returns validated state effects, available actions and primary `CubicaSurface`.
- [x] Добавить readiness behavior for missing Agent Runtime.
- [x] Добавить failure policy behavior for pause/retry/unavailable in `player-web`.
- [x] Добавить production behavior for facilitator takeover and deterministic fallback policies.

Выход фазы: платформа доказывает AI-driven игру как общий путь без game-specific branches.

### Phase 6 - Channel Renderers

Зависимости: Phase 3, Phase 5.

- [x] Web renderer: first implementation for MVP gameplay catalog.
- [x] Telegram renderer: framework-neutral projection rules for text, button, choice list, metrics summary, fallback text and inline keyboard data.
- [x] Phaser renderer: framework-neutral projection rules for HUD-like elements, choices, cards, metrics, hints and interactive zones.
- [x] Add channel support metadata: `native`, `fallback`, `unsupported`.
- [x] Add fixtures showing one source `CubicaSurface` degrades safely across Web, Telegram and Phaser contract projections.

Выход фазы: Cubica Surface proves it is channel-neutral, not React-specific.

### Phase 7 - Plugin Contribution Path

Зависимости: Phase 1, Phase 6.

- [x] Define how a game plugin contributes a new Surface component to catalog metadata.
- [x] Require namespace, version, props schema, allowed actions and channel support.
- [x] Require renderer implementation per supported channel or explicit fallback.
- [x] Add review gate before a plugin component becomes available to agent output.
- [x] Document how unknown components are rejected or rendered as diagnostics.

Выход фазы: новые UI элементы добавляются контролируемо через catalog extension, not arbitrary generated React or HTML.

### Phase 8 - Production Hardening

Зависимости: Phase 5, Phase 6.

- [x] Add replay transcript format for AI-driven sessions.
- [x] Add evaluation fixtures for agent quality and safety.
- [x] Add audit metadata for prompts, tool calls, accepted/rejected effects and user approvals.
- [x] Add rate limits, timeout policy, retry policy and cost controls.
- [x] Add redaction policy for private/session data sent to Agent Runtime.
- [x] Add production provider handoff checklist.

Выход фазы: AI-driven games can be reviewed, replayed and operated safely.

### Phase 9 - Custom Cubica Agent UI Replacement

Зависимости: Phase 3, Phase 8.

Статус: post-MVP follow-up, not required to complete the current MVP migration.

- Минимальная parity checklist зафиксирована в `docs/architecture/generative-ui-surface-protocol.md`.
- Current MVP keeps CopilotKit as shell/transport adapter.
- Product dependency removal requires separate parity acceptance after the custom shell implements messages, streaming text, tool progress, approvals, diagnostics and Surface renderer.
- AG-UI/A2UI-like compatibility remains behind adapters and transcript tests.

Выход фазы: Cubica owns the long-term Agent UI while preserving MVP learnings.

## 7. Влияние На Подсистемы

### Contracts

Добавляются схемы Surface, Agent Turn, manifest execution mode, plugin component contribution, channel projection, event log, replay transcript and evaluation fixture. Это главный слой миграции.

### Runtime API

Runtime получает orchestration boundary for agent turns, validation before persistence and readiness/failure policy. Deterministic handlers должны остаться независимыми от Agent Runtime.

### Player Web

Player Web получает Surface renderer for validated surfaces. Он не получает прямой model/provider integration.

### Editor Web

Editor Web остаётся первым MVP-потребителем CopilotKit, но generated UI должен постепенно переходить на Cubica Surface renderer.

### Telegram And Phaser

Telegram и Phaser получают framework-neutral projections (канальные JSON-представления для адаптеров) and later concrete renderers or fallback mappings. Они не должны исполнять React-компоненты и не должны читать provider-specific payload.

### Plugins

Плагины получают новый способ расширения UI: component contribution metadata, namespace, props schema, allowed actions, channel support, renderer/fallback declaration and approval gate. Это строже старого подхода, но даёт проверяемость и кроссплатформенность.

### Portal And Facilitator Tools

Portal может использовать Cubica Surface для launch drafts, session summaries and facilitator debriefs. Но portal commands still go through portal APIs, not agent-side direct mutation.

### QA And Operations

AI-driven игры добавляют replay, eval, audit, timeout, retry and cost controls as обязательные production gates.
Текущая миграция закрывает replay/eval/audit contracts; timeout, retry, rate limit and cost controls remain production-provider work.

## 8. Риски И Обходные Пути

| Риск | Что Произойдёт | Обходной Путь |
| --- | --- | --- |
| Перегрузка схемами | Команды будут медленнее добавлять новые UI элементы. | Начать с малого catalog and fixtures; добавлять компоненты только после реального use case. |
| React lock-in | Surface незаметно станет React props contract. | Проверять отсутствие React types/hooks in shared contracts; добавить Telegram/Phaser fixtures early. |
| Дублирование UI manifests | Generated surfaces начнут конкурировать с persistent UI manifests. | Treat Surface as runtime/helper UI state. Persist only through validated authoring flows. |
| Слишком жёсткий allowlist | Агент не сможет быстро пробовать новые формы UI. | Использовать experimental catalog namespace behind flags and diagnostics, then graduate stable components. |
| Слабая проверка agent effects | Agent Turn сможет испортить session state. | Reject direct patches; allow only schema-defined effects and semantic validators. |
| Поломка текущих игр | AI dependencies accidentally become required for deterministic games. | Mandatory disabled-Agent smoke for `simple-choice` and `Antarctica`. |
| Слишком дорогие AI-driven sessions | Production cost grows unpredictably. | Add limits, budgets, caching, replay-based eval and provider timeout policies before publish. |
| Неподдержанный канал | Surface works on Web but fails in Telegram or Phaser. | Require channel support metadata and safe fallback before catalog publication. |

## 9. Критерии Приёмки

1. Migration plan exists and links ADR-045, ADR-046 and the two implementation TSK files.
2. Each migration phase has dependencies, work items and expected output.
3. Deterministic preservation is an explicit phase and acceptance criterion.
4. AI-driven pilot is planned as a small generic fixture, not an Antarctica-specific runtime branch.
5. Surface renderer migration starts with framework-neutral contracts; Web implementation consumes JSON Surface data and does not become the shared contract.
6. Web, Telegram and Phaser are represented in renderer/fallback planning.
7. Plugin component extension path is explicit and schema-bound.
8. Risks include mitigation for catalog growth, experimentation, React lock-in, state safety and production cost.
9. `NEXT_STEPS.md` links this task.
10. `docs/tasks/active/.desc.json` registers this task.

## 10. План Проверки

Documentation-only checks for this change:

- `node scripts/dev/generate-structure.js`
- `node -e "JSON.parse(require('fs').readFileSync('docs/tasks/active/.desc.json', 'utf8'))"`
- `git diff --check -- docs/tasks/archive/TSK-20260611-ai-driven-surface-architecture-migration.md docs/tasks/active/.desc.json NEXT_STEPS.md PROJECT_STRUCTURE.yaml`

Future implementation checks:

- `npm run verify:agent-ui-boundaries`
- `npm run typecheck --workspace @cubica/editor-web`
- `npm test --workspace @cubica/editor-web`
- manifest schema validation tests
- Surface JSON Schema validation tests
- Agent Turn contract validation tests
- runtime readiness tests for deterministic and AI-driven modes
- player smoke for Agent Runtime disabled mode
- AI-driven pilot e2e with mock Agent Runtime
- renderer fallback tests for Web, Telegram and Phaser

## 11. Артефакты

- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md` - Surface architecture decision.
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md` - AI-driven runtime architecture decision.
- `docs/architecture/generative-ui-surface-protocol.md` - project architecture for Cubica Surface.
- `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md` - implementation task for Surface Protocol.
- `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md` - implementation task for AI-driven runtime mode.
- `packages/contracts/ai/src/index.ts` - implemented contract types, JSON Schema constants, default catalog, validation helpers, channel projection helpers, plugin contribution contracts and replay/eval/audit contracts.
- `packages/contracts/ai/tests/index.test.ts` - contract validation coverage for Surface, Agent Turn, execution mode, Telegram/Phaser projections, plugin contribution and replay/eval/audit shapes.
- `docs/architecture/schemas/game-manifest.schema.json` - additive execution-mode and Agent Runtime declaration schema.
- `services/runtime-api/src/modules/ai/agentRuntime.ts` - mock Agent Runtime adapter and validated Agent Turn execution.
- `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts` - Agent Runtime readiness policy including opt-in mock adapter.
- `services/runtime-api/src/modules/player-api/httpServer.ts` - `POST /agent-turns` and game readiness routes.
- `services/runtime-api/src/modules/player-api/requestValidation.ts` - Agent Turn request parser.
- `services/runtime-api/tests/runtime-api.integration.ts` - deterministic, unavailable and opt-in mock Agent Runtime coverage.
- `apps/player-web/app/api/runtime/agent-turns/route.ts` - browser-safe Agent Turn proxy.
- `apps/player-web/app/api/runtime/games/[gameId]/readiness/route.ts` - browser-safe game readiness proxy.
- `apps/player-web/src/presenter/runtime-client.ts` - typed runtime errors, readiness client and Agent Turn client.
- `apps/player-web/src/presenter/game-presenter.ts` - AI-driven readiness gate, pause/retry/unavailable status and Surface action routing.
- `apps/player-web/src/components/surface/cubica-surface-renderer.tsx` - first Web Surface renderer for validated MVP catalog payloads.
- `apps/player-web/src/components/runtime-status-panel.tsx` - player-facing paused/retry/unavailable screen.
- `apps/player-web/src/presenter/runtime-client.test.ts` and `apps/player-web/src/components/game-player-dom.test.tsx` - player readiness and Surface rendering coverage.
- `games/ai-driven-choice/` - committed AI-driven fixture generated from ADR-030 authoring manifests.

## 12. Журнал Передачи

### 2026-06-11 - Migration Plan Created

- Changed:
  - `docs/tasks/archive/TSK-20260611-ai-driven-surface-architecture-migration.md`
  - `docs/tasks/active/.desc.json`
  - `NEXT_STEPS.md`
- Done:
  - created executable migration plan for Cubica Surface and AI-driven runtime;
  - linked existing ADR-045/046 decisions and active implementation TSK files;
  - documented phases, dependencies, acceptance criteria, checks, risks and mitigations.
- Remaining:
  - implement Phase 1 contract foundation in `packages/contracts/ai` and JSON Schema files;
  - keep deterministic smoke checks green while adding Agent Runtime boundaries.
- Next:
  - start with `CubicaSurface` and Agent Turn schema design before editor/player renderer work.
- Risks:
  - do not let Web/React MVP renderer become the shared contract;
  - do not make Agent Runtime mandatory for deterministic games.

### 2026-06-11 - Contract Foundation Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `packages/contracts/ai/package.json`
  - `packages/contracts/ai/tsconfig.json`
  - `packages/contracts/ai/vitest.config.ts`
  - `packages/contracts/ai/tests/.desc.json`
  - `package.json`
  - `package-lock.json`
  - `PROJECT_STRUCTURE.yaml`
- Done:
  - implemented `CubicaSurface`, `CubicaSurfaceComponent`, `CubicaSurfaceAction`, catalog metadata and default catalog;
  - implemented `CubicaAgentTurnInput`, `CubicaAgentTurnResult`, state effects, available actions, diagnostics and audit metadata;
  - implemented `CubicaExecutionModeConfig` for `deterministic`, `hybrid` and `ai-driven` execution-mode proposals;
  - added JSON Schema constants and AJV validation helpers for Surface, Agent Turn input/result and execution-mode config;
  - added semantic validation for unknown components, unsupported channel components, disallowed component actions, direct state mutation keys, unsafe generated HTML keys and forbidden secret state targets;
  - added `verify:contracts-ai` root script and Vitest coverage.
- Subagents:
  - contracts explorer confirmed `packages/contracts/ai` as the minimal safe write set;
  - runtime/player explorer identified future readiness and deterministic-preservation gates;
  - editor explorer identified `EditorCopilotChatPanel`/workspace sidebar as the future renderer integration point.
- Verified:
  - `npm run verify:contracts-ai`
  - `npm run verify:agent-ui-boundaries`
  - `node scripts/dev/generate-structure.js`
- Remaining:
  - add import-boundary checks for new provider/runtime leaks if new adapters are introduced;
  - define runtime event log shape for accepted/rejected agent turns;
  - integrate execution-mode runtime readiness in a separate phase.
- Next:
  - implement Phase 4 deterministic preservation smoke and game-aware runtime readiness before the mock Agent Runtime pilot.
- Risks:
  - current implementation is contract-level only; no player or runtime behavior has changed yet.

### 2026-06-11 - Manifest Schema Widening Implemented

- Changed:
  - `packages/contracts/manifest/src/index.ts`
  - `docs/architecture/schemas/game-manifest.schema.json`
  - `services/runtime-api/tests/manifest-validation.test.ts`
  - `docs/architecture/schemas/.desc.json`
- Done:
  - added optional manifest `executionMode` with `deterministic`, `hybrid` and `ai-driven`;
  - added `agentRuntime` declaration with agent id, required flag, allowed capabilities/tools, surface catalog, failure policy, deterministic fallback and context exposure policy;
  - JSON Schema now requires `agentRuntime.required: true` for explicit `hybrid` or `ai-driven` games;
  - JSON Schema rejects a required Agent Runtime unless the manifest explicitly declares `hybrid` or `ai-driven`;
  - runtime manifest validation tests cover deterministic compatibility and AI-driven declaration errors.
- Verified:
  - `node --test --experimental-strip-types tests/manifest-validation.test.ts` from `services/runtime-api`
  - `npm run verify:contracts-ai`
  - schema JSON parse check for `docs/architecture/schemas/game-manifest.schema.json`
- Remaining:
  - player-web still has no paused/retry/unavailable AI-driven state.
- Next:
  - implement player paused/retry/unavailable state and then mock Agent Runtime pilot.
- Risks:
  - existing manifests inherit deterministic behavior when `executionMode` is absent; do not change that default during runtime integration.

### 2026-06-11 - Game-Aware Runtime Readiness Implemented

- Changed:
  - `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts`
  - `services/runtime-api/src/modules/admin/health.ts`
  - `services/runtime-api/src/modules/content/contentService.ts`
  - `services/runtime-api/src/modules/player-api/httpServer.ts`
  - `services/runtime-api/src/modules/session/session.service.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
  - `services/runtime-api/src/modules/ai/.desc.json`
- Done:
  - added `GET /games/:gameId/readiness` with optional `contentSourceId`;
  - kept service-level `GET /readiness` independent from Agent Runtime;
  - deterministic games report `agentRuntime.required=false` and remain ready;
  - AI-driven preview content with required Agent Runtime reports readiness `503`;
  - `POST /sessions` rejects agent-required AI-driven launches when Agent Runtime is unavailable;
  - non-existent games still map to `404` after the session gate.
- Verified:
  - `npm run typecheck --workspace services/runtime-api`
  - `node --test --experimental-strip-types tests/runtime-api.integration.ts` from `services/runtime-api`
- Remaining:
  - implement actual Agent Runtime adapter and Agent Turn execution;
  - add player-web UI handling for AI-driven unavailable/pause states.
- Next:
  - add player-facing unavailable state and a mock Agent Runtime adapter before the first AI-driven pilot fixture.
- Risks:
  - current Agent Runtime readiness intentionally reports missing for required agent games until a real or mock adapter is introduced.

### 2026-06-11 - Mock Agent Runtime And Agent Turn Execution Implemented

- Changed:
  - `services/runtime-api/package.json`
  - `services/runtime-api/src/modules/ai/agentRuntime.ts`
  - `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts`
  - `services/runtime-api/src/modules/player-api/httpServer.ts`
  - `services/runtime-api/src/modules/player-api/requestValidation.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
  - `package-lock.json`
- Done:
  - added `POST /agent-turns` for hybrid and AI-driven sessions;
  - added opt-in local mock Agent Runtime selected by manifest `agentRuntime.runtimeId: "mock"` and `CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true`;
  - kept mock unavailable when the opt-in environment flag is absent;
  - built and validated `CubicaAgentTurnInput` before adapter execution;
  - validated `CubicaAgentTurnResult`, `CubicaSurface` and manifest `surfaceCatalog` before session persistence;
  - applied only bounded runtime-owned state effects: `appendLog`, `setMetric`, `setFlag` and `replaceStep`;
  - preserved deterministic games: `POST /agent-turns` rejects deterministic sessions instead of changing `/actions` behavior.
- Subagents:
  - runtime explorer verified existing HTTP/session/content patterns and identified additional request/mock-gate tests;
  - docs explorer verified which TSK checklist items can be marked done without overstating ADR scope.
- Verified:
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
- Remaining:
  - create a committed AI-driven fixture game instead of only preview-content test fixtures;
  - define event log shape for accepted and rejected agent turns;
  - add idempotency, timeout, retry and production provider adapter policy;
  - implement player-web unavailable/pause/retry UI states.
- Next:
  - add the first small AI-driven fixture and player-facing unavailable state before wiring a real provider adapter.
- Risks:
  - mock Agent Runtime is for local tests only and must not be treated as production backend;
  - Agent Turn HTTP response is currently runtime-local and should move to shared contracts once player channels consume it;
  - `allowedCapabilities` is passed to Agent Runtime but not yet used as a per-effect runtime allowlist.

### 2026-06-11 - Committed AI-Driven Fixture Implemented

- Changed:
  - `games/ai-driven-choice/.desc.json`
  - `games/ai-driven-choice/authoring/game.authoring.json`
  - `games/ai-driven-choice/authoring/ui/web.authoring.json`
  - `games/ai-driven-choice/game.manifest.json`
  - `games/ai-driven-choice/game.manifest.source-map.json`
  - `games/ai-driven-choice/ui/web/ui.manifest.json`
  - `games/ai-driven-choice/ui/web/ui.manifest.source-map.json`
  - `services/runtime-api/tests/runtime-api.integration.ts`
  - `PROJECT_OVERVIEW.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `NEXT_STEPS.md`
- Done:
  - added committed `ai-driven-choice` fixture with `executionMode: "ai-driven"` and required `agentRuntime`;
  - generated runtime game and web UI manifests from ADR-030 authoring sources;
  - added runtime coverage for unavailable readiness/session launch when mock Agent Runtime is disabled;
  - added runtime coverage for session launch, player content projection and Agent Turn execution when mock Agent Runtime is explicitly enabled;
  - kept the fixture plugin-free and did not add game-specific runtime branches.
- Verified:
  - `node scripts/manifest-tools/compile-authoring-manifests.cjs --game ai-driven-choice`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - `npm run verify:manifest-authoring`
- Remaining:
  - implement player-web unavailable/pause/retry UI state;
  - render Agent Turn `CubicaSurface` as a player screen instead of only returning it from runtime;
  - define Agent Turn event log/replay/eval gates.
- Next:
  - build player-facing unavailable state for AI-driven games before production provider work.
- Risks:
  - `ai-driven-choice` currently uses the local mock adapter only; it proves platform wiring, not production agent quality.

### 2026-06-11 - Player Web AI-Driven Surface Slice Implemented

- Changed:
  - `apps/player-web/app/api/runtime/agent-turns/route.ts`
  - `apps/player-web/app/api/runtime/games/[gameId]/readiness/route.ts`
  - `apps/player-web/src/presenter/runtime-client.ts`
  - `apps/player-web/src/presenter/game-presenter.ts`
  - `apps/player-web/src/components/game-player.tsx`
  - `apps/player-web/src/components/runtime-status-panel.tsx`
  - `apps/player-web/src/components/surface/cubica-surface-renderer.tsx`
  - `apps/player-web/src/lib/locale/ru.ts`
  - `apps/player-web/app/globals.css`
  - `apps/player-web/src/presenter/runtime-client.test.ts`
  - `apps/player-web/src/components/game-player-dom.test.tsx`
  - `apps/player-web/README.md`
- Done:
  - added browser-safe proxies for game readiness and Agent Turns;
  - added typed runtime client errors that preserve backend `{ error }` payloads;
  - added `player-web` readiness gate before AI-driven session creation;
  - added paused/retry/unavailable player state for required Agent Runtime;
  - fixed stale-session recovery so `resumeSession` falls back to a new session only on 404, not on every runtime error;
  - added first Web `CubicaSurface` renderer for validated JSON Surface payloads without arbitrary HTML, arbitrary React components or provider messages;
  - routed Surface actions back through runtime APIs instead of mutating React state directly.
- Verified:
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web`
  - `npm run build --workspace @cubica/player-web`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - `npm run verify:contracts-ai`
  - `npm run verify:agent-ui-boundaries`
  - `npm run verify:manifest-authoring`
  - `npm run verify:game-agnostic`
  - targeted `apps/player-web/e2e/player-web.spec.ts` Playwright run against local runtime-api/player-web dev servers
- Remaining:
  - define accepted/rejected Agent Turn event log shape;
  - add replay/eval fixtures and production provider handoff gates;
  - implement Telegram and Phaser Surface renderers and cross-channel degradation fixtures.
- Next:
  - harden Agent Turn event logging and replay/evaluation before any production provider adapter.
- Risks:
  - Web Surface rendering is implemented, but channel neutrality still requires Telegram and Phaser fixtures.

### 2026-06-11 - Contract Hardening Slice Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `docs/architecture/generative-ui-surface-protocol.md`
  - `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
  - `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
  - `docs/tasks/archive/TSK-20260611-ai-driven-surface-architecture-migration.md`
- Done:
  - added accepted/rejected Agent Turn event log shape and builders;
  - added replay transcript and evaluation fixture contracts with JSON Schema validation;
  - added Telegram and Phaser framework-neutral projection helpers and tests;
  - added plugin Surface component contribution schema, semantic validation and catalog promotion helper;
  - documented which production gaps remain outside the contract slice.
- Verified:
  - `npm run typecheck --workspace @cubica/contracts-ai`
  - `npm test --workspace @cubica/contracts-ai`
- Remaining:
  - production facilitator takeover and deterministic fallback behavior;
  - idempotency, timeout, retry, rate limit and cost-control policies;
  - concrete Telegram/Phaser adapters and production provider handoff checklist;
  - editor Surface renderer and custom Cubica Agent UI parity.
- Next:
  - move from contract hardening to concrete production/runtime persistence only after provider policy is designed.
- Risks:
  - contract completion should not be read as production LLM readiness; provider operations still need separate implementation and acceptance.

### 2026-06-11 - MVP Migration Completion Slice Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `packages/contracts/manifest/src/index.ts`
  - `apps/editor-web/src/components/editor-cubica-surface.tsx`
  - `apps/editor-web/src/components/editor-agent-ui.tsx`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `services/runtime-api/src/modules/admin/health.ts`
  - `apps/player-web/src/presenter/game-presenter.ts`
  - `scripts/ci/validate-agent-ui-boundaries.js`
  - `docs/architecture/generative-ui-surface-protocol.md`
- Done:
  - completed A2UI-like adapter mapping and AG-UI custom event boundary checks;
  - added editor Surface renderer for tool progress, diagnostics, diff summary and approval actions;
  - added provider SDK import-boundary rule;
  - added operation policy contract for idempotency, timeout, retry, rate limits and cost controls;
  - implemented explicit deterministic fallback behavior while keeping facilitator takeover as an explicit non-silent takeover state;
  - documented custom Cubica Agent UI parity and production provider handoff checklists.
- Verified:
  - `npm run verify:contracts-ai`
  - `npm run typecheck --workspace @cubica/editor-web`
  - `npm test --workspace @cubica/editor-web`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web`
- Remaining:
  - concrete Telegram and Phaser clients that consume projection contracts;
  - post-MVP custom Cubica Agent UI replacement after parity acceptance;
  - real provider adapter and persisted audit store implementation.
- Next:
  - treat future work as channel/provider/product expansion, not as a blocker for the MVP migration contract.
- Risks:
  - no real LLM provider is enabled; operation policy and handoff gates prevent accidental production rollout without separate adapter work.
