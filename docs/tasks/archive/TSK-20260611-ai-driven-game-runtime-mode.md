# TSK-20260611-ai-driven-game-runtime-mode: AI-Driven Game Runtime Mode

- **Дата создания**: 2026-06-11
- **Статус**: completed
- **Владелец**: Codex
- **Связанные ADR**: ADR-004, ADR-025, ADR-040, ADR-045, ADR-046
- **Связанные документы**: `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`, `docs/architecture/generative-ui-surface-protocol.md`, `docs/architecture/agent-ui-foundation.md`

## Оглавление

- [1. Цель](#1-цель)
- [2. Контекст](#2-контекст)
- [3. Область Работ](#3-область-работ)
- [4. Критерии Приёмки](#4-критерии-приёмки)
- [5. Пакеты Работ](#5-пакеты-работ)
- [6. План Проверки](#6-план-проверки)
- [7. Артефакты](#7-артефакты)
- [8. Журнал Передачи](#8-журнал-передачи)

## 1. Цель

Заложить в Cubica first-class режим AI-driven games: игры, где ИИ-агент является обязательной частью runtime, управляет ходом игры and returns validated state effects, available actions and `CubicaSurface`.

## 2. Контекст

Текущий canonical slice остаётся deterministic: `runtime-api` исполняет manifest actions без обязательного agent backend. Это нужно сохранить.

Новый целевой режим по ADR-046 добавляет другой класс игр:

- manifest declares `deterministic`, `ai-driven` or `hybrid` execution mode;
- AI-driven games require Agent Runtime readiness;
- player channels still talk to Cubica runtime/session APIs, not provider SDKs;
- agent output is validated before it mutates session state;
- `CubicaSurface` can be primary gameplay UI for AI-driven games.

## 3. Область Работ

Входит в работу:

- design manifest fields for execution mode, agent runtime dependency, allowed tools, surface catalog and failure policy;
- define Agent Turn input/output contracts;
- define readiness checks for AI-driven games;
- define validation of agent effects, actions and `CubicaSurface`;
- define replay/eval fixtures for production AI-driven game quality;
- prove deterministic games still run without Agent Runtime.

Не входит в работу:

- production LLM provider integration;
- direct browser-to-provider calls;
- arbitrary HTML/React generated UI;
- game-specific branches in `runtime-api`;
- runtime plugin execution outside ADR-040 policy.

## 4. Критерии Приёмки

1. ADR-046 documents AI-driven runtime as a platform capability, not a game-specific hack.
2. Manifest schema proposal includes execution mode, agent id/runtime dependency, allowed capabilities and failure policy.
3. Agent Turn result has structured fields for state effects, `CubicaSurface`, available actions, diagnostics and audit metadata.
4. Runtime validation rejects direct session patches that bypass allowed effects.
5. Player clients cannot call model providers directly.
6. Deterministic games remain playable when Agent Runtime is disabled.
7. AI-driven games fail readiness or pause clearly when Agent Runtime is unavailable.
8. Replay/eval fixture requirements are documented before production rollout.
9. No CopilotKit, AG-UI or provider-specific types leak into runtime core contracts.

## 5. Пакеты Работ

### WP1 - Manifest Contract

- [x] Add execution mode proposal: `deterministic`, `ai-driven`, `hybrid`.
- [x] Add Agent Runtime dependency fields.
- [x] Add failure policy fields: `pause`, `retry`, `deterministicFallback`, `facilitatorTakeover`.
- [x] Add allowed capabilities, tools and surface catalogs.

### WP2 - Agent Turn Contract

- [x] Define Agent Turn input: session context, player input, manifest projection, state scope and allowed capabilities.
- [x] Define Agent Turn output: narration, effects, actions, `CubicaSurface`, diagnostics and audit metadata.
- [x] Keep contract JSON Schema-first.

### WP3 - Runtime Boundary

- [x] Define runtime route shape for agent turns.
- [x] Define validation before persistence.
- [x] Define idempotency, timeout and retry rules.
- [x] Define event log entries for accepted and rejected agent turns.

### WP4 - Player Channel Behavior

- [x] Define readiness behavior when Agent Runtime is required and unavailable.
- [x] Define player loading, retry and paused states for `player-web`.
- [x] Confirm Web channel receives validated `CubicaSurface`, not provider messages.
- [x] Confirm Telegram and Phaser channels receive validated `CubicaSurface`, not provider messages, through framework-neutral projection contracts.

### WP5 - Replay And Evaluation

- [x] Define transcript fixture format.
- [x] Define smoke tests for deterministic mode and AI-driven unavailable mode.
- [x] Define evaluation gates for production AI-driven games.

## 6. План Проверки

Documentation-only checks:

- `git diff --check -- docs/architecture/adrs/046-ai-driven-game-runtime-mode.md docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
- `node scripts/dev/generate-structure.js`

Implementation checks:

- manifest schema validation tests;
- agent turn contract tests;
- runtime validation tests for accepted/rejected agent effects;
- readiness tests for deterministic and AI-driven games;
- player smoke for clear pause/error state when required Agent Runtime is unavailable.

## 7. Артефакты

- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md` - architecture decision.
- `packages/contracts/ai/src/index.ts` - implemented Agent Turn, execution-mode, channel projection, event log, replay transcript, evaluation fixture and operation-policy contracts.
- `packages/contracts/ai/tests/index.test.ts` - Agent Turn, execution-mode, channel projection, operation-policy and replay/eval/audit validation coverage.
- `packages/contracts/manifest/src/index.ts` - manifest execution-mode and Agent Runtime declaration types.
- `docs/architecture/schemas/game-manifest.schema.json` - manifest execution-mode and Agent Runtime declaration schema.
- `services/runtime-api/tests/manifest-validation.test.ts` - validation coverage for deterministic and AI-driven manifest declarations.
- `services/runtime-api/src/modules/ai/agentRuntime.ts` - opt-in mock Agent Runtime and Agent Turn execution service.
- `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts` - readiness policy for missing/configured Agent Runtime.
- `services/runtime-api/src/modules/player-api/httpServer.ts` - `POST /agent-turns` and game readiness route wiring.
- `services/runtime-api/src/modules/player-api/requestValidation.ts` - Agent Turn request validation.
- `services/runtime-api/tests/runtime-api.integration.ts` - runtime coverage for deterministic rejection, unavailable Agent Runtime and opt-in mock Agent Runtime.
- `games/ai-driven-choice/` - committed AI-driven fixture with authoring source, generated runtime manifest and web UI manifest.
- `apps/player-web/src/presenter/runtime-client.ts` - readiness and Agent Turn browser client over player-web proxies.
- `apps/player-web/src/presenter/game-presenter.ts` - player-side AI-driven readiness gate and Surface action routing.
- `apps/player-web/src/components/runtime-status-panel.tsx` - pause/retry/unavailable state for required Agent Runtime.
- `apps/player-web/src/components/surface/cubica-surface-renderer.tsx` - Web renderer for validated `CubicaSurface`.
- Future production provider, timeout, retry, rate-limit and cost-control artifacts should be linked here.

## 8. Журнал Передачи

### 2026-06-11 - Документация Создана

- Changed:
  - `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
  - `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
- Done:
  - accepted ADR-046 for first-class AI-driven game runtime mode;
  - recorded implementation plan for manifest contract, agent turn contract, runtime boundary, player behavior and replay/eval.
- Remaining:
  - implement schema/contracts and runtime readiness behavior.
- Next:
  - design JSON Schema additions for execution mode and Agent Turn result.
- Risks:
  - avoid turning Agent Runtime into direct state persistence or game-specific runtime branches.

### 2026-06-11 - Contract Foundation Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
- Done:
  - implemented `CubicaExecutionModeConfig` with `deterministic`, `hybrid` and `ai-driven`;
  - implemented Agent Runtime dependency fields, allowed capabilities, surface catalog and failure policy;
  - implemented Agent Turn input/output contracts with schema validation and structured diagnostics;
  - added validation that rejects direct state mutation keys and forbidden secret state targets.
- Verified:
  - `npm run verify:contracts-ai`
- Remaining:
  - implement runtime route/readiness behavior;
  - prove deterministic games still run with Agent Runtime disabled.
- Next:
  - add runtime readiness tests before creating the AI-driven pilot fixture.
- Risks:
  - Agent Turn is contract-only at this stage; runtime-api does not yet execute or persist agent turns.

### 2026-06-11 - Manifest Schema Widening Implemented

- Changed:
  - `packages/contracts/manifest/src/index.ts`
  - `docs/architecture/schemas/game-manifest.schema.json`
  - `services/runtime-api/tests/manifest-validation.test.ts`
- Done:
  - added manifest-level `executionMode` as an optional additive field with deterministic default semantics when absent;
  - added manifest-level `agentRuntime` declaration for AI-driven and hybrid games;
  - schema requires `agentRuntime` for `hybrid` and `ai-driven`;
  - schema rejects required Agent Runtime unless the manifest explicitly declares agent execution mode.
- Verified:
  - `node --test --experimental-strip-types tests/manifest-validation.test.ts` from `services/runtime-api`
- Remaining:
  - implement configured mock/real Agent Runtime adapter and failure-policy behavior beyond unavailable rejection;
  - add player paused/retry/unavailable state for AI-driven game launch failures.
- Next:
  - implement game-aware readiness without changing deterministic game readiness.
- Risks:
  - do not make `/readiness` globally fail when Agent Runtime is absent; only agent-required games should depend on it.

### 2026-06-11 - Runtime Readiness Gate Implemented

- Changed:
  - `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts`
  - `services/runtime-api/src/modules/admin/health.ts`
  - `services/runtime-api/src/modules/player-api/httpServer.ts`
  - `services/runtime-api/src/modules/session/session.service.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
- Done:
  - added game-aware readiness endpoint `GET /games/:gameId/readiness`;
  - kept service-level `/readiness` green for deterministic games without Agent Runtime;
  - added session launch gate that rejects required Agent Runtime when unavailable;
  - added integration coverage for deterministic readiness, AI-driven unavailable readiness and rejected AI-driven session launch.
- Verified:
  - `npm run typecheck --workspace services/runtime-api`
  - `node --test --experimental-strip-types tests/runtime-api.integration.ts` from `services/runtime-api`
- Remaining:
  - implement Agent Turn execution route and persistence validation;
  - implement player paused/retry/unavailable UI state.
- Next:
  - add mock Agent Runtime adapter so AI-driven pilot fixtures can run deterministically in tests.
- Risks:
  - readiness is intentionally conservative until a configured adapter exists.

### 2026-06-11 - Agent Turn Runtime Boundary Implemented

- Changed:
  - `services/runtime-api/package.json`
  - `services/runtime-api/src/modules/ai/agentRuntime.ts`
  - `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts`
  - `services/runtime-api/src/modules/player-api/httpServer.ts`
  - `services/runtime-api/src/modules/player-api/requestValidation.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
  - `package-lock.json`
- Done:
  - added `POST /agent-turns` as the first runtime route for Agent Turn execution;
  - added local mock Agent Runtime for tests and preview content, enabled only by `agentRuntime.runtimeId: "mock"` plus `CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true`;
  - runtime validates Agent Turn input before adapter execution and validates Agent Turn result plus `CubicaSurface` before persistence;
  - runtime applies a bounded effect allowlist instead of letting the agent write session storage directly;
  - deterministic sessions reject `/agent-turns` and continue to use `/actions`;
  - tests cover invalid Agent Turn requests, unknown session, deterministic rejection, disabled mock gate and successful opt-in mock execution.
- Verified:
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
- Remaining:
  - define idempotency, timeout and retry rules;
  - define accepted/rejected Agent Turn event log shape;
  - move public Agent Turn response shape into shared contracts when player channels start consuming it;
  - add production adapter policy and replay/eval fixtures.
- Next:
  - implement player unavailable/pause/retry UI and then add a committed AI-driven fixture game.
- Risks:
  - mock Agent Runtime is not a production backend;
  - `allowedCapabilities` is still descriptive at runtime and needs a stricter effect/capability policy before real providers.

### 2026-06-11 - AI-Driven Fixture Added

- Changed:
  - `games/ai-driven-choice/.desc.json`
  - `games/ai-driven-choice/authoring/game.authoring.json`
  - `games/ai-driven-choice/authoring/ui/web.authoring.json`
  - `games/ai-driven-choice/game.manifest.json`
  - `games/ai-driven-choice/game.manifest.source-map.json`
  - `games/ai-driven-choice/ui/web/ui.manifest.json`
  - `games/ai-driven-choice/ui/web/ui.manifest.source-map.json`
  - `services/runtime-api/tests/runtime-api.integration.ts`
- Done:
  - added plugin-free `ai-driven-choice` fixture with manifest-declared Agent Runtime dependency;
  - generated runtime manifests from authoring sources;
  - tests prove unavailable behavior when mock Agent Runtime is disabled;
  - tests prove session launch, player content projection and Agent Turn execution when mock Agent Runtime is enabled.
- Verified:
  - `node scripts/manifest-tools/compile-authoring-manifests.cjs --game ai-driven-choice`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - `npm run verify:manifest-authoring`
- Remaining:
  - add player paused/retry/unavailable UI;
  - define transcript/replay fixture format and production eval gates.
- Next:
  - wire player-web to present AI-driven unavailable state and later consume returned `CubicaSurface`.
- Risks:
  - this fixture proves runtime wiring only; production provider behavior still requires replay/eval and cost controls.

### 2026-06-11 - Player Channel Behavior Implemented For Web

- Changed:
  - `packages/contracts/manifest/src/index.ts`
  - `services/runtime-api/src/modules/content/contentService.ts`
  - `apps/player-web/app/api/runtime/agent-turns/route.ts`
  - `apps/player-web/app/api/runtime/games/[gameId]/readiness/route.ts`
  - `apps/player-web/src/presenter/runtime-client.ts`
  - `apps/player-web/src/presenter/game-presenter.ts`
  - `apps/player-web/src/components/game-player.tsx`
  - `apps/player-web/src/components/runtime-status-panel.tsx`
  - `apps/player-web/src/components/surface/cubica-surface-renderer.tsx`
  - `apps/player-web/src/components/game-player-dom.test.tsx`
  - `apps/player-web/src/presenter/runtime-client.test.ts`
- Done:
  - `PlayerFacingContent` now exposes public execution-mode and Agent Runtime dependency metadata;
  - `player-web` checks game readiness before AI-driven session creation;
  - required Agent Runtime failures render pause/retry/unavailable state with manual retry instead of an endless loading screen;
  - stale session fallback is limited to 404, so 503 Agent Runtime failures are not masked by new session creation;
  - Web channel renders the validated Agent Turn `CubicaSurface` and routes actions back through `/api/runtime/agent-turns` or `/api/runtime/actions`.
- Verified:
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web`
  - `npm run build --workspace @cubica/player-web`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - targeted `apps/player-web/e2e/player-web.spec.ts` Playwright run against local runtime-api/player-web dev servers
- Remaining:
  - define idempotency, timeout and retry rules;
  - define accepted/rejected Agent Turn event log shape;
  - define transcript/replay fixture format and production eval gates;
  - implement Telegram and Phaser channel behavior.
- Next:
  - move from Web pilot to replay/eval/event-log hardening before real provider adapters.
- Risks:
  - Web channel no longer consumes provider messages, but non-Web channels still need implementation proof.

### 2026-06-11 - Replay, Evaluation And Channel Projection Contracts Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
- Done:
  - added accepted/rejected Agent Turn event log entry contract and builders;
  - added replay transcript contract with explicit redaction policy and `secretStateIncluded: false`;
  - added evaluation fixture contract for production AI-driven quality gates;
  - added Telegram and Phaser channel projection contracts so non-Web channels receive validated `CubicaSurface` data, not provider messages.
- Verified:
  - `npm run typecheck --workspace @cubica/contracts-ai`
  - `npm test --workspace @cubica/contracts-ai`
- Remaining:
  - define idempotency, timeout and retry rules;
  - implement rate limits and cost controls for production provider adapters;
  - wire event log persistence in `runtime-api` when the production storage slice is implemented.
- Next:
  - keep production provider work blocked on replay/eval/audit acceptance plus timeout/rate/cost policy.
- Risks:
  - these are contract gates, not a real provider integration or persisted audit store.

### 2026-06-11 - Operation Policy And Fallback Behavior Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `packages/contracts/manifest/src/index.ts`
  - `services/runtime-api/src/modules/admin/health.ts`
  - `services/runtime-api/src/modules/content/contentService.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
  - `apps/player-web/src/presenter/game-presenter.ts`
  - `apps/player-web/src/presenter/runtime-client.ts`
  - `apps/player-web/src/components/game-player-dom.test.tsx`
- Done:
  - added `CubicaAgentRuntimeOperationPolicy` contract for idempotency, timeout, retry, rate limits and cost controls;
  - allowed explicit deterministic fallback launch only when manifest declares `failurePolicy: "deterministicFallback"` and `deterministicFallbackActionId`;
  - kept missing Agent Runtime blocked for pause/retry and facilitator takeover policies;
  - player-web skips initial Agent Turn when deterministic fallback is active.
- Verified:
  - `npm run verify:contracts-ai`
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web`
- Remaining:
  - real provider adapter and persisted audit store implementation;
  - concrete facilitator UI for takeover workflows outside player-web fallback state.
- Next:
  - require operation policy plus replay/eval/audit fixtures before enabling any real provider adapter.
- Risks:
  - operation policy is validated but not yet enforced by a production provider runner because no real provider adapter is enabled.
