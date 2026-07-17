# AI Agent Safety Remediation

Документ описывает, как исправить findings review по миграции Cubica Surface, Agent Runtime and Agent UI. Он дополняет ADR-047 and translates it into design rules for implementation.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Что Нужно Исправить](#2-что-нужно-исправить)
- [3. Целевые Потоки](#3-целевые-потоки)
  - [3.1. Approval Flow](#31-approval-flow)
  - [3.2. Agent Turn Acceptance Flow](#32-agent-turn-acceptance-flow)
  - [3.3. Channel Surface Flow](#33-channel-surface-flow)
- [4. Требуемые Контракты](#4-требуемые-контракты)
- [5. Runtime Rules](#5-runtime-rules)
- [6. Editor Rules](#6-editor-rules)
- [7. Channel Rules](#7-channel-rules)
- [8. Production Backend Gate](#8-production-backend-gate)
- [9. Test Matrix](#9-test-matrix)
- [10. Non-Goals](#10-non-goals)
- [11. Связанные Документы](#11-связанные-документы)

## 1. Назначение

MVP migration intentionally introduced a mock Agent Runtime and a first Surface renderer. Review found gaps that are acceptable for a mock-only slice but unsafe for production providers.

This document defines the remediation target:

- agent cannot approve its own mutating tool call;
- failed Agent Turn cannot select or execute a gameplay intent;
- an agent may choose only an actor-scoped published Game Intent (игровое действие, описанное в терминах конкретной игры);
- channel projections do not expose unsupported actions;
- external provider backend cannot be enabled without auth and audit gates.

Implementation status as of 2026-07-15: Agent Turn no longer accepts direct state effects. The model returns exactly one `selectedIntent` with `actionId` and bounded `params`; runtime verifies that the intent is published and available for the current actor, executes its Mechanics IR in the common session transaction, and writes the common durable command receipt. A rejected turn records no `selectedActionId` and cannot change the session.

## 2. Что Нужно Исправить

| Finding | Target Fix | Owner Layer |
| --- | --- | --- |
| `approved=true` is read from tool args | Replace argument-based approval with Cubica approval envelope produced by UI/human flow | `apps/editor-web`, `packages/contracts/ai` |
| `ok=false` result can still carry a mutating choice | Reject `selectedIntent` and gameplay Surface for a failed Agent Turn | `services/runtime-api`, `packages/contracts/ai` |
| A model can invent low-level state changes | Expose only actor-scoped published Game Intents and execute the selected intent through Mechanics IR | `packages/contracts/ai`, `services/runtime-api`, game manifest |
| Surface action can be valid globally but unsupported by player | Add channel action policy validation | `packages/contracts/ai`, `services/runtime-api`, `apps/player-web` |
| Telegram/Phaser projections return diagnostics but still expose actions | Add projection status and suppress actions on validation errors | `packages/contracts/ai` |
| External AG-UI backend can be configured without token | Require production auth policy for external backend | `apps/editor-web`, docs/deploy policy |

## 3. Целевые Потоки

### 3.1. Approval Flow

```text
agent requests mutating tool
  -> Cubica UI renders approval request
  -> human approves or rejects
  -> Cubica creates approval envelope
  -> mutating tool verifies envelope scope and expiry
  -> tool executes or returns blocked result
```

Approval envelope must include:

- `approvalId`;
- `agentId`;
- `runId` or equivalent correlation id;
- `toolName` or Surface action id;
- `approvedBy`;
- `approvedAt`;
- `expiresAt`;
- `scopeHash` for the exact change summary or payload being approved;
- `status`: `approved` or `rejected`.

CopilotKit MVP may implement the UI with `useHumanInTheLoop`, but the handler must verify a Cubica approval envelope, not trust `approved=true` from model-generated arguments.

### 3.2. Agent Turn Acceptance Flow

```text
Agent Turn result
  -> JSON Schema validation
  -> semantic validation
  -> ok/status gate
  -> published and actor-scoped intent gate
  -> channel policy gate
  -> execute selected intent through Mechanics IR
  -> commit state, events and command receipt atomically
```

Rules:

- `ok: false` means rejected.
- Rejected turn writes audit/replay entry only.
- Rejected turn has no `selectedActionId`.
- An accepted result contains exactly one `selectedIntent: { actionId, params }`.
- `actionId` must be present in the trusted `availableIntents` input for this actor and snapshot.
- Runtime may show a diagnostic message, but it must not execute an unpublished, unavailable or malformed intent.

### 3.3. Channel Surface Flow

```text
CubicaSurface
  -> catalog validation
  -> target channel support validation
  -> target channel action policy validation
  -> projection or renderer data
```

Web player primary gameplay policy:

- allowed action kinds: `agentTurn`, `runtimeAction`, `noop`;
- disallowed action kinds: `editorTool`, `portalCommand`;
- `openUrl` is disallowed until an explicit safe URL policy exists.

Editor helper Surface policy:

- allowed action kind: `editorTool` and `noop`;
- target must be listed in editor agent tool catalog;
- mutating targets require approval envelope.

Telegram and Phaser policy:

- projection must return validation status;
- invalid Surface suppresses interactive controls;
- unsupported components become diagnostics or declared fallback text.

## 4. Требуемые Контракты

Add or extend contracts in `packages/contracts/ai`:

- `CubicaAgentApprovalEnvelope`;
- `CubicaPublishedGameIntent`;
- `CubicaAgentSelectedIntent`;
- `CubicaSurfaceChannelActionPolicy`;
- projection result status: `ok`, `diagnostics`, `actionsSuppressed`;
- Agent Turn semantic rule: `ok=false` cannot include a selected intent or primary gameplay Surface.

The schema source remains JSON Schema/AJV. TypeScript-only checks are not enough.

## 5. Runtime Rules

Runtime API must enforce:

- Agent Turn rejected when result schema or semantic validation fails;
- Agent Turn rejected when `ok=false`;
- AI-driven configuration must explicitly allow `selectPublishedIntent` and declare one exact `initialActionId`;
- no Game Intent is executed for rejected turns;
- the Agent Turn input contains only currently published actor-scoped intents;
- the selected intent is checked again through the normal action parameter, role, reference and Mechanics validation path;
- the Agent Turn entry intent is excluded from selectable intents, preventing recursive Agent Turn calls;
- every Surface action is checked against channel/action policy and targets an exact published `actionId`;
- accepted/rejected command receipts use the common durable command ledger;
- deterministic games remain independent from Agent Runtime.

The mock Agent Runtime can remain as a deterministic test adapter, but it must pass the same gates as a provider adapter.

## 6. Editor Rules

Editor Agent UI must enforce:

- `editor.applyChangeSet`, `editor.saveSession` and `editor.undoLastPatch` require Cubica approval envelope;
- `approved` in tool args is ignored or treated only as an agent request;
- approval UI displays diff summary, tool name and scope;
- approval is bound to the latest planned/dry-run ChangeSet;
- stale approvals fail closed;
- CopilotKit-specific `useHumanInTheLoop` stays in adapter files only.

## 7. Channel Rules

Channel renderers and projections must enforce:

- channel policy is explicit and testable;
- invalid projection data does not include executable actions;
- player-web never executes editor or portal actions from gameplay Surface;
- non-Web projections do not leak provider payloads;
- unsupported components degrade to safe diagnostics.

## 8. Production Backend Gate

Before external provider traffic:

- external backend URL has auth policy;
- server-side token is required or an explicitly approved non-token auth scheme exists;
- local fallback is disabled where production policy requires it;
- provider SDK imports are confined to adapter boundary;
- replay/eval fixtures exist for the assistant/game;
- operation policy includes timeout, retry, rate limits and cost controls;
- audit envelope is captured for mutating tools and accepted/rejected Agent Turns.

## 9. Test Matrix

Required tests:

| Area | Required Test |
| --- | --- |
| Editor approval | Agent-supplied `approved=true` does not execute mutating tool without approval envelope |
| Editor approval | Valid approval envelope allows exactly the scoped change |
| Editor approval | Stale approval envelope fails closed |
| Agent Turn | `ok=false` with `selectedIntent` does not mutate session |
| Agent Turn | invented or unavailable `actionId` is rejected |
| Agent Turn | a published selected intent is executed through Mechanics IR and one command receipt |
| Agent Turn | the Agent Turn entry action cannot be selected recursively |
| Surface Web player | `editorTool`/`portalCommand`/unsafe `openUrl` rejected for primary gameplay |
| Telegram projection | invalid Surface suppresses inline buttons |
| Phaser projection | invalid Surface suppresses interactive zones |
| External backend | external URL without auth policy fails production readiness gate |
| Import boundary | provider SDK imports stay adapter-only |

## 10. Non-Goals

This remediation does not require:

- replacing CopilotKit immediately;
- adding a real model provider adapter;
- implementing Telegram or Phaser clients;
- changing deterministic `Antarctica` mechanics;
- moving runtime sessions out of in-memory storage.

## 11. Связанные Документы

- `docs/architecture/adrs/047-ai-agent-safety-remediation-gates.md`
- `docs/tasks/archive/TSK-20260611-ai-agent-safety-remediation.md`
- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
