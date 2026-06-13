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
- failed Agent Turn cannot persist effects;
- manifest capabilities become executable runtime gates;
- channel projections do not expose unsupported actions;
- external provider backend cannot be enabled without auth and audit gates.

Implementation status as of 2026-06-12: the MVP code path implements these gates for contracts, runtime-api, editor-web and player-web. Durable audit storage for accepted/rejected Agent Turns remains a future infrastructure step; the event-log contract builders already enforce `effectCount: 0` for rejected turns.

## 2. Что Нужно Исправить

| Finding | Target Fix | Owner Layer |
| --- | --- | --- |
| `approved=true` is read from tool args | Replace argument-based approval with Cubica approval envelope produced by UI/human flow | `apps/editor-web`, `packages/contracts/ai` |
| `ok=false` result can still carry persisted effects | Reject or ignore effects for failed Agent Turn and log rejected turn with zero effects | `services/runtime-api`, `packages/contracts/ai` |
| `allowedCapabilities` is descriptive | Add capability policy mapping and enforce it before persistence | `packages/contracts/ai`, `services/runtime-api`, manifest docs |
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
  -> capability gate
  -> channel policy gate
  -> persist accepted effects
  -> write accepted/rejected event log
```

Rules:

- `ok: false` means rejected.
- Rejected turn writes audit/replay entry only.
- Rejected turn has `effectCount: 0`.
- Runtime may show a diagnostic message, but it must not use returned effects or gameplay actions.

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
- `CubicaAgentCapabilityPolicy`;
- `CubicaAgentCapabilityRule`;
- `CubicaSurfaceChannelActionPolicy`;
- projection result status: `ok`, `diagnostics`, `actionsSuppressed`;
- Agent Turn semantic rule: `ok=false` cannot include accepted effects.

The schema source remains JSON Schema/AJV. TypeScript-only checks are not enough.

## 5. Runtime Rules

Runtime API must enforce:

- Agent Turn rejected when result schema or semantic validation fails;
- Agent Turn rejected when `ok=false`;
- no effects are persisted for rejected turns;
- every effect target is checked against capability policy;
- every available action and Surface action is checked against channel/action policy;
- accepted/rejected log entry is built for each turn once persistence audit storage exists;
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
| Agent Turn | `ok=false` with effects does not mutate session |
| Agent Turn | effect outside declared capability is rejected |
| Agent Turn | accepted effect inside capability is persisted |
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
- `docs/tasks/active/TSK-20260611-ai-agent-safety-remediation.md`
- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
