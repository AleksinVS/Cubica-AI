# ADR-046: AI-Driven Game Runtime Mode

- **Дата**: 2026-06-11
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Runtime API, Player Web, Game Manifests, Agent Runtime, AI Contracts, Cubica Surface, Portal, Session State
- **Связанные решения**: ADR-001, ADR-003, ADR-004, ADR-025, ADR-029, ADR-040, ADR-043, ADR-044, ADR-045, ADR-084
- **Целевой изменяющий контракт уточнён ADR-084:** прямые agent effects и
  patches являются legacy; долговременное изменение проходит через
  schema-validated outcome → опубликованный Game Intent → Mechanics IR

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Архитектурные инварианты](#5-архитектурные-инварианты)
- [6. Границы по слоям](#6-границы-по-слоям)
- [7. Отказоустойчивость](#7-отказоустойчивость)
- [8. Альтернативы](#8-альтернативы)
- [9. Последствия](#9-последствия)
- [10. Связанные артефакты](#10-связанные-артефакты)

## 1. Понимание решения

Решение понято так: Cubica должна изначально поддерживать не только deterministic games, где ход игры исполняется манифестом и `runtime-api`, но и AI-driven games, где ИИ-агент является частью игрового движка, управляет ходом игры, выбирает или генерирует UI-поверхности и определяет следующие доступные действия.

Это общая платформенная возможность для класса игр, а не механика конкретной игры. Поэтому она должна быть выражена через manifest/runtime contracts, JSON Schema, Agent Runtime boundary and Cubica Surface validation. Реализация не должна добавлять game-specific branches в `runtime-api`, `player-web` или общие контракты.

## 2. Контекст

Текущий canonical slice исполняет `Antarctica` and `simple-choice` детерминированно: manifest actions, deterministic handlers, session state and player-facing content projection. Это остаётся важным baseline, потому он даёт проверяемость, воспроизводимость и запуск без LLM-инфраструктуры.

При этом целевая LLM-first архитектура проекта уже предполагала, что LLM может выступать игровым движком. ADR-045 добавил Cubica Surface как внутренний декларативный контракт для UI-поверхностей, которые могут генерироваться агентом. Нужно явно связать эти идеи с runtime: некоторые игры должны иметь право объявить agent runtime обязательной частью игрового исполнения.

## 3. Термины

- **Deterministic game** - игра, где состояние меняется только через манифест, deterministic handlers and runtime API без обязательного обращения к ИИ-агенту.
- **AI-driven game** - игра, где ИИ-агент является обязательной частью runtime: он получает контекст сессии, принимает или предлагает ход, возвращает состояние, UI-поверхность and available actions.
- **Hybrid game** - игра, где часть хода исполняется deterministic-механиками, а часть шагов явно делегируется агенту.
- **Agent Runtime** - backend-граница, которая исполняет agent turn: вызывает модель или локального агента, применяет политики, вызывает разрешённые инструменты and возвращает структурированный результат.
- **Agent turn** - один шаг обработки: вход игрока или системного события передаётся агенту, агент возвращает валидируемый результат для runtime and player UI.
- **Agent-authored surface** - `CubicaSurface`, созданная или выбранная агентом для текущего шага игры.
- **Failure policy** - явно описанная политика поведения при недоступности агента: pause, retry, deterministic fallback or facilitator takeover.
- **Авторитетное состояние** - долговременное состояние Cubica: session state, event log, manifest version, launch binding, audit records.

## 4. Решение

Cubica вводит AI-driven game runtime mode как first-class platform capability.

1. **Game manifest declares execution mode.**
   - Every game must declare or inherit an execution mode: `deterministic`, `ai-driven` or `hybrid`.
   - `deterministic` remains the default and current canonical implementation.
   - `ai-driven` means agent backend is a declared runtime dependency for that game.
   - `hybrid` means manifest-defined deterministic steps and agent-driven steps coexist through explicit transitions.

2. **AI-driven games require an Agent Runtime boundary.**
   - Player clients do not call model providers directly.
   - `player-web`, Telegram and Phaser clients talk to Cubica runtime/session APIs.
   - Runtime routes agent-driven turns through an Agent Runtime adapter with auth, rate limits, audit and replay metadata.

3. **Agent output is structured and validated before it mutates state.**
   - Agent can return narration, `CubicaSurface`, available player actions,
     tool-call requests, game-declared structured outcomes or diagnostics.
   - `runtime-api` or a future extracted game-engine boundary validates all outputs against Cubica JSON Schema and semantic rules.
   - Agent does not write directly to databases, manifests, session rows or plugin files.
   - A durable outcome becomes parameters of a fixed published `actionId` and
     is applied through Mechanics IR. Direct state effects and JSON Patch-like
     deltas remain only as migration input until the ADR-084 cutover.

4. **AI-generated UI can be primary gameplay UI.**
   - In AI-driven games, `CubicaSurface` is allowed to be the primary current screen, not only helper UI.
   - The surface must still use allowlisted component catalogs, channel support metadata and action policies.
   - Arbitrary HTML, arbitrary React components and executable JavaScript remain forbidden in production gameplay.

5. **Agent controls game flow through declared capabilities.**
   - The agent may choose an available Game Intent, generate a surface, ask for
     structured player input, call allowed tools or propose a game-declared
     structured outcome.
   - Each capability must be declared in the manifest or platform contracts.
   - New mechanics still follow ADR-040: if a mechanic is reusable, it becomes a platform capability; if game-specific, it stays in the game bundle/plugin/manifest and does not leak into core runtime.

6. **Deterministic games remain independent from agent backend.**
   - Existing and simple games must remain playable when Agent UI and Agent Runtime are disabled.
   - The earlier rule "gameplay does not depend on agent backend" applies to deterministic and non-agent hybrid paths only.
   - For AI-driven games, agent availability is part of readiness and launch validation.

7. **Replay and evaluation become required for AI-driven production games.**
   - Agent turns must be logged as structured transcripts with inputs, outputs, validation results, model/provider metadata where allowed and correlation ids.
   - Production readiness requires replay fixtures, failure tests and quality/evaluation gates appropriate to the game.

## 5. Архитектурные инварианты

1. AI-driven runtime mode is declared by manifest/schema, not by hardcoded game IDs.
2. Player clients never receive provider secrets and never call model providers directly.
3. Agent Runtime can be required for an AI-driven game, but it remains behind Cubica runtime/session APIs.
4. Agent-authored surfaces are untrusted until schema and catalog validation pass.
5. Agent state, AG-UI state and provider message state are not authoritative Cubica state.
6. Every mutating agent output becomes schema-validated parameters of a fixed
   published Game Intent and passes the ordinary Mechanics IR transaction;
   agent-selected IR, effect kinds and state paths are forbidden.
7. Deterministic games and deterministic paths must keep working without Agent Runtime.
8. AI-driven games must declare failure policy before publish or launch.
9. `state.secret` exposure to agents must be role-scoped and manifest/policy controlled.
10. Replay/audit metadata is mandatory for production AI-driven sessions.

## 6. Границы по слоям

### Manifest And Contracts

The manifest owns:

- execution mode;
- allowed agent capabilities;
- allowed tools;
- allowed surface catalogs;
- failure policy;
- context exposure policy;
- deterministic fallback, if one exists.

### Runtime API

Runtime API owns:

- session state and event log;
- agent-turn orchestration boundary;
- validation of agent outputs;
- persistence of accepted effects;
- readiness status for required Agent Runtime.

Runtime API does not own:

- model provider SDK details;
- prompt experimentation as code branches;
- game-specific agent behavior outside manifest/contracts.

### Agent Runtime

Agent Runtime owns:

- model/provider calls or local agent execution;
- prompt templates;
- tool choice;
- structured response generation;
- model-level observability and eval hooks.

Agent Runtime does not own:

- direct persistence of session state;
- direct write access to manifests;
- bypassing Cubica validators.

### Player Channels

Player channels render validated player-facing state and `CubicaSurface`.

- Web may render React components.
- Telegram may render messages and inline keyboards.
- Phaser may render scene objects and overlays.

The channel renderer does not decide authoritative game state.

## 7. Отказоустойчивость

AI-driven games must declare one of the allowed failure policies:

- `pause`: session pauses and tells the user that the game engine is temporarily unavailable.
- `retry`: runtime retries within bounded limits and then pauses.
- `deterministicFallback`: runtime uses a manifest-declared fallback path.
- `facilitatorTakeover`: a facilitator or operator can choose from approved recovery actions.

No silent fallback is allowed. If a game needs the agent to be playable, launch readiness must check that the Agent Runtime is configured and reachable.

## 8. Альтернативы

### A. Keep Agent Backend Optional For All Player Gameplay

Rejected. This would make AI-driven games impossible or force them into ad hoc plugin/runtime hacks.

### B. Let Player Web Call LLM Providers Directly

Rejected. It would expose secrets, split audit and validation, and make non-web channels inconsistent.

### C. Let Agent Output Directly Patch Session State

Rejected. It would bypass JSON Schema, runtime validation and replay requirements.

### D. Use Arbitrary Generated React/HTML For AI-Driven Games

Rejected. It is not portable to Telegram/Phaser, weakens security and blocks marketplace-safe review.

## 9. Последствия

Positive:

- Cubica can support fully AI-driven games as a first-class platform mode.
- Deterministic games remain simple and independent from LLM infrastructure.
- AI-generated UI can become primary gameplay UI while staying portable and validated.
- Runtime readiness can clearly distinguish deterministic games from agent-required games.
- Replay/eval infrastructure has a clear target for production AI game quality.

Costs and risks:

- Runtime contracts become more complex because they must represent agent turns and validated agent effects.
- Launch readiness must include Agent Runtime configuration for AI-driven games.
- AI-driven sessions need stronger observability, cost controls, rate limits and failure handling.
- Authoring tools must help designers choose execution mode and failure policy.
- Agent quality becomes part of game quality, so replay/eval cannot be optional for production AI-driven games.

## 10. Связанные артефакты

- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/architecture/agent-ui-foundation.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
