# TSK-20260611-ai-agent-safety-remediation: AI Agent Safety Remediation

- **Дата создания**: 2026-06-11
- **Статус**: completed
- **Владелец**: Codex
- **Связанные ADR**: ADR-044, ADR-045, ADR-046, ADR-047
- **Связанные документы**: `docs/architecture/ai-agent-safety-remediation.md`, `docs/architecture/adrs/047-ai-agent-safety-remediation-gates.md`

## Оглавление

- [1. Цель](#1-цель)
- [2. Как Понята Задача](#2-как-понята-задача)
- [3. Review Findings](#3-review-findings)
- [4. Область Работ](#4-область-работ)
- [5. Критерии Приёмки](#5-критерии-приёмки)
- [6. Пакеты Работ](#6-пакеты-работ)
- [7. План Проверки](#7-план-проверки)
- [8. Риски](#8-риски)
- [9. Артефакты](#9-артефакты)
- [10. Журнал Передачи](#10-журнал-передачи)

## 1. Цель

Закрыть findings review по миграции Cubica Surface and AI-driven runtime before any real provider backend or production Agent Runtime rollout.

Основная цель: превратить текущий mock-safe MVP в provider-safe architecture slice.

## 2. Как Понята Задача

Задача понята так: кодовая миграция MVP завершена, но review выявил safety gaps. Нужно исправлять их отдельным remediation slice, потому что они затрагивают несколько слоёв:

- `packages/contracts/ai`;
- `services/runtime-api`;
- `apps/player-web`;
- `apps/editor-web`;
- production backend handoff policy.

Задача не является новой фичей игры. Это hardening platform boundaries.

## 3. Review Findings

1. `approved=true` из tool args не является human approval.
2. `CubicaAgentTurnResult.ok=false` сейчас не гарантирует отсутствие persisted effects.
3. `agentRuntime.allowedCapabilities` описывает намерение, но не является runtime allowlist.
4. Global Surface catalog может разрешить actions, которые конкретный channel renderer не поддерживает.
5. Telegram/Phaser projections need fail-closed interactive behavior.
6. External AG-UI/provider backend needs stricter auth readiness gate.

## 4. Область Работ

Входит:

- approval envelope contract and validation;
- editor approval adapter flow;
- Agent Turn `ok=false` rejection semantics;
- capability policy contract and runtime enforcement;
- channel action policy for Web player/editor/Telegram/Phaser;
- projection `ok/actionsSuppressed` status;
- production external backend auth gate;
- tests and documentation updates.

Не входит:

- replacing CopilotKit now;
- real provider adapter implementation;
- concrete Telegram/Phaser client implementation;
- persistence migration for sessions;
- changing deterministic game mechanics.

## 5. Критерии Приёмки

1. ADR-047 is accepted.
2. `packages/contracts/ai` includes JSON Schema-backed approval, capability and channel policy contracts.
3. Editor mutating tools ignore agent-supplied `approved=true` unless a valid Cubica approval envelope exists.
4. `editor.applyChangeSet`, `editor.saveSession` and `editor.undoLastPatch` validate missing, valid and stale approval through the shared approval envelope contract; editor adapter tests prove `approved=true` no longer calls mutating tools directly.
5. Runtime rejects effects from `ok=false` Agent Turn results before persistence.
6. Runtime enforces manifest-declared capability policy before persisting Agent Turn effects.
7. Web player primary gameplay rejects unsupported Surface action kinds before execution.
8. Telegram/Phaser projections suppress interactive actions/zones when validation has errors.
9. External backend production mode fails closed without auth policy.
10. `npm run verify:contracts-ai`, editor-web tests, player-web tests and runtime-api tests pass.

## 6. Пакеты Работ

### WP1 - Approval Envelope Contract

- [x] Add `CubicaAgentApprovalEnvelope` type and JSON Schema.
- [x] Add validator and tests for scope, expiry, status and correlation fields.
- [x] Define how approval envelope references tool name, action id, run id and payload/change summary hash.

### WP2 - Editor Human Approval Flow

- [x] Replace `approved` argument trust with approval envelope validation.
- [x] Use CopilotKit `useHumanInTheLoop` only as MVP UI adapter, not as domain source of truth.
- [x] Add approval UI for apply/save/undo that carries exact scope.
- [x] Add tests proving agent-supplied `approved=true` alone is blocked.
- [x] Add tests for valid and stale approval envelope.

### WP3 - Agent Turn Acceptance Semantics

- [x] Add semantic validation: `ok=false` cannot carry accepted effects.
- [x] Runtime must not persist effects for rejected turns.
- [x] Keep accepted/rejected Agent Turn event log builders in contracts; full audit storage remains future infrastructure work.
- [x] Add contract/runtime tests for rejected or unauthorized Agent Turn effects.

### WP4 - Capability Policy Enforcement

- [x] Add `CubicaAgentCapabilityPolicy` contract.
- [x] Define initial platform capability mappings for current effect kinds: `appendLog`, `setMetric`, `setFlag`, `replaceStep`.
- [x] Map manifest `allowedCapabilities` to concrete effect/action allowlist.
- [x] Reject Agent Turn effects outside allowed capabilities.
- [x] Add tests for accepted and rejected capability cases.

### WP5 - Channel Action Policy

- [x] Add `CubicaSurfaceChannelActionPolicy` contract and validation options.
- [x] Enforce Web player primary gameplay action kinds: `agentTurn`, `runtimeAction`, `noop`.
- [x] Enforce editor helper Surface targets through editor tool catalog and approval envelope checks.
- [x] Add tests for rejected `editorTool`, `portalCommand` and unsafe `openUrl` in player gameplay.

### WP6 - Projection Fail-Closed Behavior

- [x] Add projection status fields: `ok`, `actionsSuppressed`.
- [x] Suppress Telegram inline keyboard when validation has errors.
- [x] Suppress Phaser interactive zones when validation has errors.
- [x] Add tests for invalid Surface projections.

### WP7 - Production Backend Auth Gate

- [x] Define production mode signal for editor agent runtime.
- [x] Fail external AG-UI/backend readiness when production mode has no auth policy.
- [x] Keep local fallback separate from external production backend readiness.
- [x] Add route tests for auth gate.

### WP8 - Documentation And Navigation

- [x] Update architecture remediation documentation.
- [x] Update project architecture navigation and next steps.
- [x] Update `PROJECT_OVERVIEW.md`, `docs/architecture/PROJECT_ARCHITECTURE.md` and `NEXT_STEPS.md`.
- [x] Record implementation handoff in this task.

## 7. План Проверки

Required and completed:

- [x] `npm run verify:contracts-ai`
- [x] `npm run typecheck --workspace @cubica/runtime-api`
- [x] `npm test --workspace @cubica/runtime-api`
- [x] `npm run typecheck --workspace @cubica/editor-web`
- [x] `npm test --workspace @cubica/editor-web`
- [x] `npm run typecheck --workspace @cubica/player-web`
- [x] `npm test --workspace @cubica/player-web`

Remaining final hygiene:

- [x] `git diff --check`
- [x] `npm run verify:agent-ui-boundaries`

Recommended after code changes:

- `npm run verify:canonical`
- targeted Playwright for editor approval and AI-driven player unavailable/fallback behavior

## 8. Риски

| Risk | Mitigation |
| --- | --- |
| Approval UI becomes CopilotKit-specific | Keep Cubica approval envelope as stable contract and CopilotKit as adapter only |
| Capability policy becomes too broad | Start with small mappings and require tests for each capability |
| Channel validation duplicates catalog validation | Keep catalog validation and channel action policy as separate helpers |
| Runtime hardening breaks mock fixture | Make mock adapter pass the same gates as providers |
| Docs overstate implementation | Keep this task active until tests and code pass |

## 9. Артефакты

Expected implementation artifacts:

- `packages/contracts/ai/src/index.ts`
- `packages/contracts/ai/tests/index.test.ts`
- `services/runtime-api/src/modules/ai/agentRuntime.ts`
- `services/runtime-api/tests/runtime-api.integration.ts`
- `apps/editor-web/src/components/editor-agent-ui.tsx`
- `apps/editor-web/src/components/editor-cubica-surface.tsx`
- `apps/editor-web/src/components/editor-workspace.tsx`
- `apps/editor-web/src/lib/editor-agent-tool-catalog.test.ts`
- `apps/player-web/src/presenter/game-presenter.ts`
- `apps/player-web/src/components/game-player-dom.test.tsx`
- `docs/architecture/ai-agent-safety-remediation.md`
- `docs/architecture/adrs/047-ai-agent-safety-remediation-gates.md`

## 10. Журнал Передачи

### 2026-06-11 - Remediation documentation created

- Created ADR-047 proposal for approval, Agent Turn acceptance, capability, channel action and production backend safety gates.
- Created project remediation document with target flows and test matrix.
- Created this active execution task for implementation.

### 2026-06-12 - Remediation implementation completed

- Accepted ADR-047 and implemented the safety gates across `packages/contracts/ai`, `services/runtime-api`, `apps/editor-web` and `apps/player-web`.
- Added JSON Schema-backed contracts for approval envelopes, capability policies and channel action policies.
- Replaced `approved=true` trust with Cubica approval envelopes; CopilotKit `useHumanInTheLoop` is now an MVP adapter that creates a local approval id, not the domain source of truth.
- Added runtime checks for `ok=false`, manifest `allowedCapabilities`, Web player primary gameplay action policy and production external AG-UI auth readiness.
- Added fail-closed Telegram/Phaser projection status and player-web action suppression for unsupported action kinds.
