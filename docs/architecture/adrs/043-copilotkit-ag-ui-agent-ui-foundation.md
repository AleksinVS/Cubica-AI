# ADR-043: CopilotKit And AG-UI Agent UI Foundation

- **Дата**: 2026-06-09
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Editor Web, Portal, Player Web, Runtime API, Agent UI, AI Contracts, Platform Security
- **Связанные решения**: ADR-001, ADR-002, ADR-017, ADR-019, ADR-025, ADR-030, ADR-034, ADR-036, ADR-038, ADR-040, ADR-042

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Архитектурные инварианты](#5-архитектурные-инварианты)
- [6. Границы по приложениям](#6-границы-по-приложениям)
- [7. Безопасность и управление данными](#7-безопасность-и-управление-данными)
- [8. Альтернативы](#8-альтернативы)
- [9. Последствия](#9-последствия)
- [10. Связанные артефакты](#10-связанные-артефакты)

## 1. Понимание решения

Решение понято так: Cubica принимает CopilotKit и AG-UI как базовый пользовательский UI-слой для ИИ-агентов платформы. Это решение относится не только к текущему редактору игр, но и к будущим помощникам в портале, запуске сессий, сопровождении ведущего, подсказках игроку и административных сценариях.

При этом CopilotKit и AG-UI не становятся источником истины для игровых манифестов, authoring-документов, runtime-состояния, лицензий или бизнес-данных. Они дают стандартный слой отображения, событий и инструментов агента, а все изменения проходят через существующие Cubica-контракты, схемы, Presenter/runtime boundaries and validation gates. Последующее ADR-044 уточняет, что CopilotKit и AG-UI являются заменяемыми адаптерами, а не внутренней предметной моделью Cubica.

## 2. Контекст

В текущем canonical slice:

- `apps/editor-web` уже имеет preview-first editor, AI prompt surface, bounded `EditorChangeSet`, dry-run validation, undo/redo journal and session-backed Save.
- `services/runtime-api` владеет runtime/player content boundary and session execution.
- `apps/player-web` получает `PlayerFacingContent` and session snapshots, not authoring/editor state.
- JSON Schema remains the source of truth for manifest structures.
- New runtime mechanics must be manifest-first and platform capability-first, not agent-specific code paths.

Следующий шаг для AI layer - перейти от локального deterministic planner к нормальному UI and protocol foundation for agents. Нужно одновременно закрыть две потребности:

1. дать редактору игр полноценный AI assistant UI;
2. не создать отдельную одноразовую интеграцию, которую потом придется заменять для portal, facilitator and player assistants.

## 3. Термины

- **CopilotKit** - open-source React/Next.js framework for embedding AI assistants into applications. In Cubica it is the default UI integration layer for user-facing assistants.
- **AG-UI** - Agent-User Interaction protocol, event-based protocol for communication between a user-facing application and an AI agent backend.
- **Agent UI** - пользовательский слой помощника: чат, поток ответа, предложения действий, human approval and visible execution state.
- **Human-in-the-loop** - режим, при котором человек явно подтверждает или отклоняет действие агента before the side effect is applied.
- **Tool** - разрешенное действие, которое агент может вызвать. In Cubica a tool is always an adapter to an existing platform capability or an explicit new platform contract.
- **Agent context** - минимальная проекция данных приложения, которую помощник получает для ответа or planning.
- **Canonical state** - authoritative state owned by Cubica: manifests, session state, launch sessions, licenses, project files and saved commits.

## 4. Решение

Cubica adopts CopilotKit and AG-UI as the default foundation for user-facing AI assistants.

1. **CopilotKit is the default React/Next.js Agent UI layer.**
   - `apps/editor-web` uses CopilotKit for the first production-grade authoring assistant surface.
   - Future React/Next.js surfaces, including portal and player-adjacent assistants, should use the same foundation unless an ADR records a stronger reason.
   - CopilotKit components and hooks are UI integration details; they do not own Cubica domain state.

2. **AG-UI is the default external event protocol for agent backends.**
   - AG-UI events may carry streaming text, tool call lifecycle, state snapshots, state deltas, message snapshots and custom events.
   - Cubica maps AG-UI events into application-specific UI state and diagnostics.
   - AG-UI `STATE_DELTA` patches are never applied directly to canonical Cubica state.

3. **Every assistant is registered as a bounded platform capability.**
   - Each assistant must have an `agentId`, owning app, allowed tools, allowed context, side-effect policy, version and audit policy.
   - The initial registry can be local documentation/configuration. A later implementation may move stable shapes into `packages/contracts/ai`.

4. **Mutating agent output must use Cubica commands, not direct state writes.**
   - Editor assistant output becomes `EditorChangeSet` or a rejected diagnostic.
   - Portal assistant output becomes portal API commands, not direct database writes.
   - Player/facilitator assistant output becomes manifest-defined player actions, presenter commands or runtime/session API calls, never hidden mutation of gameplay state.

5. **Production traffic goes through a server-side runtime endpoint.**
   - React apps talk to a local route such as `/api/copilotkit`.
   - That route owns authentication, authorization, redaction, rate limits and server-side secrets.
   - Direct browser-to-agent connections are allowed only for local prototypes.

6. **Existing Cubica boundaries remain authoritative.**
   - JSON Schema stays the source of truth for data structures.
   - `editor-engine` stays framework-agnostic.
   - `runtime-api` stays the owner of runtime/player session state.
   - `player-web` does not import editor agent state.
   - CopilotKit state is derived UI state, not a durable domain store.

## 5. Архитектурные инварианты

Mandatory invariants:

1. Agent UI must not become a second source of truth for manifests, sessions, licenses or project files.
2. Agent tools must call Cubica boundaries and validations, not mutate local domain state behind them.
3. Mutating editor assistant actions must pass dry-run, JSON Schema validation, semantic validation, plugin boundary validation where relevant and undo journal recording.
4. Zod schemas or CopilotKit tool parameter schemas may validate UI inputs, but they must not replace JSON Schema as the manifest SSOT.
5. AG-UI state snapshots and deltas may drive assistant UI, progress display or temporary planning state only.
6. Deterministic public player runtime must remain playable without any agent backend; AI-driven games may require Agent Runtime only through an explicit manifest execution mode and readiness policy.
7. Production assistants must be authenticated, authorized, rate-limited and audited.
8. Telemetry and external network calls from assistant libraries must be explicitly configured and documented.
9. Agent prompts must receive scoped context, not whole large manifests or unredacted secrets.
10. New game mechanics still follow ADR-040: manifest/platform capability first, no game-specific branches in generic runtime layers.

## 6. Границы по приложениям

### Editor Web

`apps/editor-web` is the first adoption target.

Allowed:

- Chat or inline prompt UI for selected preview entities, property panel context and manifest diagnostics.
- Agent tools that plan bounded `EditorChangeSet` values.
- Human-in-the-loop confirmation for high-risk changes, save, publish and plugin edits.
- Agent-visible context assembled from active file, selected pointers, diagnostics, preview trace summaries and schema metadata.

Forbidden:

- Whole-manifest rewrite as the primary output.
- Direct write to session worktree without `EditorChangeSet` and validation gates.
- Persisting CopilotKit or AG-UI state inside authoring or runtime manifests.

### Portal And Catalog

Future portal assistants may help users find games, explain license options, prepare launch sessions and guide consultants.

Allowed:

- Read-only catalog guidance.
- Drafting launch-session settings for user confirmation.
- Calling portal APIs after RBAC and human confirmation.

Forbidden:

- Direct database writes.
- Payment, purchase, deletion or irreversible license changes without explicit user confirmation and audit event.
- Runtime session mutation outside the portal-runtime binding contracts from ADR-032 and ADR-033.

### Player And Facilitator Helpers

Future player or facilitator assistants may explain rules, summarize progress or suggest next steps.

Allowed:

- Read-only explanation from player-facing content and public session state.
- Manifest-defined hints when the game exposes such capability.
- Facilitator-facing summaries built from public or role-authorized data.

Forbidden:

- Hidden mutation of gameplay state.
- Access to `state.secret` unless a role-specific contract explicitly allows it.
- Bypassing Presenter and runtime action dispatch.

### Admin And Operations

Future operator assistants may summarize diagnostics, surface readiness failures and guide cleanup actions.

Allowed:

- Read-only operational summaries.
- Drafting remediation commands for operator approval.
- Calling admin APIs with explicit RBAC and audit.

Forbidden:

- Destructive cleanup, deploy, rollback or key rotation without human-in-the-loop approval.

## 7. Безопасность и управление данными

Security rules:

- Server-side agent runtime endpoints must be the production boundary for secrets and provider keys.
- Assistant context must be minimized, redacted and tied to the user's role.
- Tool calls must be allowlisted per assistant.
- Mutating tool calls must be logged with user id, agent id, tool name, input summary, result, timestamp and correlation id.
- AI provider output must be treated as untrusted until validated by Cubica.
- Telemetry from third-party agent UI libraries must be disabled by default unless approved separately.
- Dependency versions for CopilotKit and AG-UI must be pinned and covered by compatibility checks before upgrade.

## 8. Альтернативы

### A. Build a custom Cubica-only agent UI

Rejected. This gives maximum control but duplicates common chat, streaming, tool-call and multi-agent UI work. It also slows the editor assistant and future portal assistants.

### B. Use direct provider SDK calls from each app

Rejected. Direct SDK integration would fragment tool handling, state streaming, auth and audit across apps.

### C. Adopt AG-UI but build all UI ourselves

Rejected for the first platform phase. AG-UI remains valuable as protocol, but CopilotKit reduces UI implementation cost and gives a common React/Next.js surface.

### D. Adopt CopilotKit without AG-UI as platform protocol

Rejected. Cubica needs a protocol-level boundary so future non-React clients and agent backends can interoperate without tying the platform to one UI package forever.

### E. Put agent execution inside `runtime-api` gameplay path first

Rejected. Current Cubica runtime is deterministic and manifest-first. AI helpers are accepted as a UI/capability layer first, while gameplay mechanics still follow ADR-040.

## 9. Последствия

Positive consequences:

- One reusable Agent UI foundation for editor, portal and future helpers.
- Faster delivery of the editor assistant without replacing `editor-engine`.
- A protocol boundary for future agent backends and non-editor assistants.
- Better fit for human-in-the-loop workflows and streamed tool execution.
- A clearer path from local planner to production assistant.

Costs and risks:

- CopilotKit and AG-UI become platform dependencies that require version governance.
- AG-UI protocol and packages are still relatively young, so upgrades need compatibility tests.
- The team must prevent accidental use of CopilotKit state as durable domain state.
- Server-side runtime endpoints need auth, redaction, audit and rate limits before production rollout.
- Legal/license and telemetry settings need explicit review before production deployment.

## 10. Связанные артефакты

- `docs/architecture/agent-ui-foundation.md` - project architecture for the Agent UI foundation.
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md` - уточнение переносимости и протокольных границ для этого решения.
- `docs/architecture/agent-ui-portability-and-risk-controls.md` - контроль рисков, контроль узких мест и планы миграции.
- `docs/tasks/active/TSK-20260609-copilotkit-ag-ui-agent-ui-foundation.md` - execution plan.
- `docs/tasks/active/TSK-20260610-agent-ui-portability-and-risk-controls.md` - план закрепления границ адаптеров и production handoff gates.
- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md` - editor baseline that provides AI prompt and `EditorChangeSet`.
- `docs/architecture/adrs/038-testing-architecture-and-policy.md` - testing policy for agent and LLM behavior.
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md` - manifest/platform capability policy for runtime mechanics.
- External references:
  - `https://github.com/CopilotKit/CopilotKit`
  - `https://www.copilotkit.ai/ag-ui`
