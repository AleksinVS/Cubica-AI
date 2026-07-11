# Agent UI Foundation

Документ описывает проектную архитектуру UI ИИ-агентов Cubica после принятия ADR-043. Он связывает CopilotKit, AG-UI и собственные контракты Cubica в общий паттерн для редактора и будущих помощников. Ограничения переносимости и защиты от привязки к библиотекам закреплены отдельно в ADR-044 и `docs/architecture/agent-ui-portability-and-risk-controls.md`.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Термины](#2-термины)
- [3. Архитектурная позиция](#3-архитектурная-позиция)
  - [3.1. MVP-роль CopilotKit И Целевой Собственный Слой](#31-mvp-роль-copilotkit-и-целевой-собственный-слой)
- [4. Слои](#4-слои)
- [5. Реестр помощников](#5-реестр-помощников)
- [6. Контекст агента](#6-контекст-агента)
- [7. Инструменты агента](#7-инструменты-агента)
- [8. Состояние и события](#8-состояние-и-события)
- [9. Редактор игр](#9-редактор-игр)
- [10. Будущие помощники платформы](#10-будущие-помощники-платформы)
- [11. Dependency Governance](#11-dependency-governance)
- [12. Безопасность](#12-безопасность)
- [13. Тестирование](#13-тестирование)
- [14. Rollout](#14-rollout)
- [15. Связанные документы](#15-связанные-документы)

## 1. Назначение

Cubica needs one foundation for user-facing AI assistants:

- editor assistant for authoring manifests, UI and project-local plugins;
- portal assistant for catalog, launch links and consultant workflows;
- facilitator assistant for session progress and training support;
- player helper for rules and hints where a game allows them;
- admin assistant for diagnostics and operational summaries.

This foundation must reuse common UI and protocol mechanics without moving domain ownership away from Cubica.

## 2. Термины

- **ИИ-агент** - программный помощник, который получает контекст, отвечает пользователю и может запрашивать разрешённые вызовы инструментов.
- **CopilotKit** - React/Next.js-фреймворк, который Cubica использует для чата, боковых панелей, потокового UI помощника и регистрации frontend tools.
- **AG-UI** - Agent-User Interaction protocol, который Cubica использует как событийный протокол между пользовательскими приложениями и backend-сервисами агентов.
- **Инструмент агента** - разрешённая операция, которую может вызвать помощник. Она должна соответствовать API, команде или проверочному шлюзу Cubica.
- **Контекст агента** - minimal projected data given to the assistant for one run.
- **Human-in-the-loop** - явное подтверждение пользователем перед применением изменяющей или рискованной операции.
- **Авторитетное состояние** - данные, которыми владеет Cubica: манифесты, состояние сессий, launch sessions, лицензии и Git worktrees.
- **Generative UI** - интерфейс, который ИИ-агент выбирает, описывает или обновляет во время работы.
- **A2UI** - декларативная JSONL-спецификация UI-поверхностей; в Cubica это внешний reference для совместимости, а не внутренний source of truth.
- **Cubica Surface** - собственное JSON-описание ограниченной UI-поверхности помощника: дерева компонентов, data model, actions and validation diagnostics.
- **AI-driven game** - игра, где ИИ-агент является обязательной частью runtime и управляет ходом, состоянием шага и UI-поверхностью через валидируемые Cubica-контракты.

## 3. Архитектурная позиция

CopilotKit и AG-UI приняты как основа Agent UI, но не как замена предметным контрактам Cubica. ADR-044 дополнительно требует, чтобы CopilotKit оставался заменяемым UI/runtime-адаптером, AG-UI оставался заменяемым протокольным адаптером, а стабильные контракты инструментов, контекста, валидации и аудита принадлежали Cubica.

The main rule:

```text
assistant suggestion -> Cubica command/change set -> Cubica validation -> Cubica state change
```

The assistant can propose, explain and request allowed actions. Cubica validates and applies. For AI-driven games under ADR-046, the agent can also be part of runtime execution, but its output still becomes Cubica-validated effects, actions and surfaces before state is persisted.

### 3.1. MVP-роль CopilotKit И Целевой Собственный Слой

ADR-045 уточняет долгосрочную позицию: CopilotKit is the MVP adapter for the first stage, not the permanent domain foundation of Cubica Agent UI. It is accepted because it accelerates chat, tool rendering, streaming responses and human-in-the-loop controls for the editor MVP.

The target direction is a Cubica-owned compatible Agent UI:

- Cubica owns assistant registry, context projection, tool catalog, result envelopes, approval policies, audit metadata and surface contracts.
- CopilotKit can render the first implementation, but future custom Cubica UI must be able to consume the same Cubica contracts.
- New assistant features should avoid CopilotKit-specific domain assumptions, so replacing `CopilotChat` later does not require changes in `editor-engine`, `runtime-api`, game bundles or manifest schemas.
- Declarative Generative UI surfaces should be represented as Cubica Surface specs, not persisted CopilotKit, AG-UI or A2UI state.

## 4. Слои

Target layering:

```text
React/Next.js app
  -> CopilotKit UI provider and assistant components
  -> app-local /api/copilotkit route
  -> Cubica agent runtime adapter
  -> AG-UI agent backend or built-in agent
  -> Cubica domain APIs, contracts and validation gates
```

Responsibilities:

- **CopilotKit UI provider** owns assistant rendering, chat surface, streaming and tool-call UI.
- **App-local runtime route** owns auth, redaction, rate limiting and agent routing for the current app.
- **Cubica agent runtime adapter** translates between CopilotKit/AG-UI and Cubica assistant registry, context and tools.
- **AG-UI agent backend** produces protocol events and tool-call requests.
- **Cubica domain APIs** remain the only layer allowed to apply durable changes.

## 5. Реестр помощников

Every assistant must be declared before production use.

Minimal assistant record:

```json
{
  "agentId": "editor.authoring",
  "ownerApp": "apps/editor-web",
  "surface": "sidebar",
  "allowedContext": ["activeFile", "selectedPointers", "diagnostics", "previewTraceSummary"],
  "allowedTools": ["editor.planChangeSet", "editor.dryRunChangeSet", "editor.applyChangeSet"],
  "sideEffectPolicy": "human-approved",
  "auditLevel": "mutating",
  "version": "1.0"
}
```

The initial implementation may store this registry as TypeScript or JSON near the app. Stable cross-app shapes should later move to `packages/contracts/ai`.

## 6. Контекст агента

Context rules:

- Send only scoped projections, not whole repositories or large manifests.
- Prefer selected JSON pointers, diagnostics, schema snippets and short summaries.
- Redact secrets and private session state before the assistant sees them.
- Include source identifiers so tool output can be validated against the same file/session/version.
- Keep runtime player context separate from editor authoring context.

Editor context may include:

- `sessionId`;
- `gameId`;
- active authoring file path;
- selected authoring pointers;
- selected preview descriptors;
- validation diagnostics;
- preview trace summary;
- plugin validation summary.

Portal context may include:

- authenticated user role;
- visible catalog entries;
- launch-session draft;
- license summary visible to that user.

Player helper context may include only player-facing content and role-authorized public session state.

## 7. Инструменты агента

Tool rules:

- Tools are allowlisted per assistant.
- Every mutating tool must call an existing Cubica route or command handler.
- Tool parameters can use CopilotKit/Zod validation for UI input shape, but canonical domain validation remains JSON Schema, API validation or service-level validation.
- Tools must return structured diagnostics, not only natural-language success text.
- Tools that save, publish, purchase, delete, launch paid resources or mutate runtime state require human-in-the-loop approval.

Initial editor tool set:

- `editor.planChangeSet` - creates an `EditorChangeSet` from scoped context.
- `editor.dryRunChangeSet` - validates the change set without applying it.
- `editor.applyChangeSet` - applies the validated change set to the active session and records undo.
- `editor.undoLastPatch` - applies the inverse change set.
- `editor.preparePreview` - compiles and prepares preview through existing session-aware routes.
- `editor.saveSession` - creates a Save commit after explicit confirmation.

Forbidden tool behavior:

- direct filesystem writes from the assistant UI;
- direct database writes;
- direct runtime session mutation outside `runtime-api`;
- hidden side effects during answer generation.

## 8. Состояние и события

AG-UI events can be used for:

- run lifecycle;
- streamed assistant text;
- tool call start, arguments, result and end;
- temporary assistant state snapshot;
- temporary assistant state delta;
- message history snapshot;
- custom app events.

State rule:

```text
AG-UI state != Cubica authoritative state
```

AG-UI `STATE_SNAPSHOT` and `STATE_DELTA` can drive assistant UI progress, drafts and temporary planning state. They cannot mutate manifests, session state, launch sessions or licenses. To affect Cubica state, an event must become a Cubica command or change set and pass validation.

## 9. Редактор игр

The editor is the first adoption target.

Target flow:

1. User selects an object or region in preview.
2. `apps/editor-web` exposes scoped context through CopilotKit.
3. Assistant proposes a bounded `EditorChangeSet`.
4. Existing dry-run validates JSON Patch, schema, semantic rules and plugin boundaries.
5. The user sees a plain-language diff and diagnostics.
6. Mutating apply records an undo journal entry.
7. Save creates a Git commit in the editor session worktree.

Non-negotiable editor constraints:

- Do not bypass `EditorPatchIntent` and `EditorChangeSet`.
- Do not replace Monaco or property panel as precise editing surfaces.
- Do not store assistant state in authoring manifests.
- Do not let assistant edits touch platform core paths unless a separate platform task allows it.

Current implementation baseline:

- `apps/editor-web` wraps the editor with CopilotKit only when `NEXT_PUBLIC_CUBICA_EDITOR_AGENT_UI=1`.
- `apps/editor-web/app/api/copilotkit/route.ts` exposes the app-local runtime endpoint only when `CUBICA_EDITOR_AGENT_RUNTIME=1`.
- `apps/editor-web/app/api/editor/agent/ag-ui/route.ts` provides a local AG-UI backend for baseline/dev verification. It is deterministic, registers `editor.authoring`, can call editor frontend tools and does not own production LLM behavior.
- The route can connect to an external AG-UI backend through `CUBICA_EDITOR_AGENT_AG_UI_URL` and optional `CUBICA_EDITOR_AGENT_AG_UI_TOKEN`; that external URL overrides the local backend.
- If the UI flag is enabled but no AG-UI backend is available, `apps/editor-web` renders a connection status panel and does not mount agent-bound CopilotKit hooks. This is primarily a failure/explicit-disable mode because the local backend is enabled by default unless `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0`.
- `apps/editor-web/src/lib/agent-assistant-registry.ts` declares `editor.authoring` and documentation-ready future helpers.
- `apps/editor-web/src/lib/agent-context-projection.ts` sends scoped selected-pointer context and redacts secret-like paths.
- `apps/editor-web/src/components/editor-agent-ui.tsx` registers frontend tools for plan, dry-run, apply, undo, preview and save.
- `apps/editor-web/src/lib/ag-ui-event-adapter.ts` normalizes AG-UI events and rejects unsafe canonical state paths in `STATE_DELTA`.

## 10. Будущие помощники платформы

### Portal Assistant

Purpose:

- help consultants choose games;
- explain licenses;
- draft launch-session settings;
- guide session continuation and archival workflows.

Main boundary:

- works through portal APIs and portal-runtime binding contracts.

### Facilitator Assistant

Purpose:

- summarize session progress;
- explain participant status;
- prepare debrief notes from allowed session data.

Main boundary:

- read role-authorized session data and write only approved facilitator notes or explicit runtime actions.

### Player Helper

Purpose:

- explain rules and available choices;
- provide hints when the game manifest exposes hints;
- improve accessibility and onboarding.

Main boundary:

- read player-facing content and dispatch only manifest-defined actions.

### Admin Assistant

Purpose:

- summarize readiness failures;
- guide cleanup or upgrade actions;
- explain telemetry and diagnostic events.

Main boundary:

- read operational APIs by role and require human approval for destructive actions.

## 11. Dependency Governance

Current pinned editor-web dependency baseline:

- `@copilotkit/react-core`: `1.59.5`
- `@copilotkit/runtime`: `1.59.5`
- `@ag-ui/client`: `0.0.53`
- `@ag-ui/core`: `0.0.53`
- `zod`: `3.25.76`

Version policy:

- Pin CopilotKit and AG-UI versions together because CopilotKit `1.59.5` depends on AG-UI `0.0.53`.
- Do not mix a newer direct AG-UI package with an older CopilotKit runtime without compatibility tests.
- Keep third-party telemetry disabled by default: no Copilot Cloud public key, no CopilotKit inspector, no runtime observability config unless separately approved.
- Production enablement requires an explicit npm audit review. After introducing CopilotKit/runtime dependencies, `npm install` reported 18 audit findings in the dependency tree; this is acceptable for the disabled-by-default baseline, not for production rollout without review.
- Upgrades must run `npm run typecheck --workspace @cubica/editor-web`, `npm test --workspace @cubica/editor-web`, `npm run build --workspace @cubica/editor-web` and an npm audit review.

## 12. Безопасность

Production requirements:

- App-local `/api/copilotkit` route must authenticate the user.
- Tool calls must check RBAC in server-side code.
- Secrets must never reach browser-side agent context.
- Third-party telemetry must be disabled by default until approved.
- Agent requests and tool calls must have correlation ids.
- Mutating tool calls must be audited.
- Rate limits must protect both AI provider calls and platform-side tools.
- Assistant-generated data must be treated as untrusted input until validated.

## 13. Тестирование

Required checks for initial adoption:

- unit tests for assistant registry and context projection;
- tests that forbidden context fields are redacted;
- tests that mutating editor tools produce `EditorChangeSet` only;
- dry-run tests for valid and invalid change sets;
- browser component tests for chat/panel tool rendering;
- Playwright coverage for editor assistant happy path;
- contract tests for AG-UI event normalization;
- Cubica Surface schema and renderer tests before declarative Generative UI is used beyond prototypes;
- dependency compatibility checks for pinned CopilotKit/AG-UI versions.

Live model quality should use replay/eval outside the fast PR gate, consistent with ADR-038.

## 14. Rollout

Recommended adoption order:

1. Document the foundation and add dependency governance.
2. Add a disabled-by-default editor assistant shell.
3. Route the current local AI planner through the new assistant boundary.
4. Define Cubica Surface Protocol for declarative Generative UI while keeping CopilotKit as the MVP adapter.
5. Replace the planner backend with a production agent while preserving `EditorChangeSet`.
6. Add a custom Cubica Agent UI parity checklist and renderer target before expanding assistant surfaces.
7. Add portal read-only assistant.
8. Add mutating portal tools with human-in-the-loop approval.
9. Add player/facilitator helpers only after role and session data boundaries are explicit.

## 15. Связанные документы

- `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md`
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/tasks/archive/TSK-20260609-copilotkit-ag-ui-agent-ui-foundation.md`
- `docs/tasks/archive/TSK-20260610-agent-ui-portability-and-risk-controls.md`
- `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `PROJECT_OVERVIEW.md`
- `packages/editor-engine/src/index.ts`
- `apps/editor-web/app/api/editor/ai/patch/route.ts`
- `https://github.com/CopilotKit/CopilotKit`
- `https://www.copilotkit.ai/ag-ui`
