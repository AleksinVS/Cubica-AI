# Cubica Generative UI Surface Protocol

Документ описывает проектную архитектуру Cubica-owned Generative UI layer после принятия ADR-045. Он показывает, как идеи CopilotKit (React/Next.js-фреймворка для встраивания ИИ-помощников) Generative UI Spectrum (классификации режимов генерации UI по свободе агента) and A2UI (декларативной JSONL-спецификации UI-поверхностей) применяются в Cubica без переноса авторитетного состояния в CopilotKit, AG-UI (событийный протокол между пользовательским приложением и backend-сервисом агента) or A2UI.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Термины](#2-термины)
- [3. Архитектурная позиция](#3-архитектурная-позиция)
- [4. Generative UI Spectrum В Cubica](#4-generative-ui-spectrum-в-cubica)
- [5. Cubica Surface Protocol](#5-cubica-surface-protocol)
- [6. Словарь Компонентов](#6-словарь-компонентов)
- [7. Практические Проблемы И Способы Решения](#7-практические-проблемы-и-способы-решения)
- [8. Влияние На Подсистемы](#8-влияние-на-подсистемы)
- [9. Кроссплатформенный Рендеринг](#9-кроссплатформенный-рендеринг)
- [10. Действия И Изменения Состояния](#10-действия-и-изменения-состояния)
- [11. Совместимость С A2UI И AG-UI](#11-совместимость-с-a2ui-и-ag-ui)
- [12. Слои Реализации](#12-слои-реализации)
- [13. Безопасность И Валидация](#13-безопасность-и-валидация)
- [14. Внедрение](#14-внедрение)
- [15. Тестирование](#15-тестирование)
- [16. Связанные Документы](#16-связанные-документы)

## 1. Назначение

Cubica needs a stable way for AI assistants and future game authoring tools to propose or render interface surfaces without making a third-party UI framework the platform source of truth.

This protocol has four goals:

- keep CopilotKit useful for MVP while preserving a path to a custom Cubica Agent UI;
- let assistants render structured UI blocks such as diff summaries, diagnostics, forms, hints and facilitator panels;
- reuse the platform's manifest-first and Presenter-first architecture;
- keep every state change behind Cubica validation, approval and audit.

## 2. Термины

- **Generative UI** - интерфейс, который ИИ-агент выбирает, описывает или обновляет во время работы.
- **Surface** - ограниченная область интерфейса: панель, карточка, форма, модальное окно, боковая панель или участок preview.
- **Cubica Surface** - JSON-описание Surface, принадлежащее Cubica and validated by Cubica schemas.
- **CopilotKit** - React/Next.js-фреймворк для встраивания ИИ-помощников в приложения.
- **AG-UI** - событийный протокол между пользовательским приложением и backend-сервисом агента.
- **MVP-этап** - первый минимально достаточный продуктовый этап, на котором допустим внешний адаптер ради быстрой проверки пользовательской ценности.
- **Component catalog** - список разрешённых компонентов и их свойств, например `text`, `button`, `editor.diffSummary`, `game.metricsBar`.
- **Data model** - данные, на которые ссылается Surface. Для игрока это только player-facing projection, для редактора - scoped authoring context.
- **Binding** - привязка свойства компонента к данным из data model.
- **Action** - явно объявленное пользовательское действие, которое мапится на инструмент агента, Presenter command, portal API or runtime action.
- **A2UI** - внешний JSONL-протокол декларативного UI; для Cubica это compatibility reference, not the source of truth.
- **AI-driven game** - игра, где ИИ-агент является обязательной частью runtime и может управлять ходом игры, состоянием шага and UI-поверхностью через валидируемые Cubica-контракты.
- **Agent Runtime** - backend-граница, которая выполняет шаг агента, вызывает модель или локального агента and возвращает структурированный результат для runtime validation.

## 3. Архитектурная позиция

После ADR-045 целевая позиция выглядит так:

```text
Player or editor channel
  -> MVP CopilotKit adapter, future Cubica Agent UI, or player renderer
  -> Cubica Agent Run and Surface contracts
  -> protocol adapter: AG-UI, A2UI-like stream, or Cubica-native events
  -> local/dev backend, production LLM backend, or Agent Runtime
  -> Cubica tools, Presenter commands, runtime effects and validation gates
```

Правило состояния:

```text
generated surface != authoritative Cubica state
```

Generated surface becomes durable only after it is converted to a Cubica command, runtime effect or change set and passes validation. For editor flows this means `EditorChangeSet`; for deterministic gameplay this means manifest-defined runtime action; for AI-driven gameplay this means an accepted agent turn with validated state effects and `CubicaSurface`; for portal flows this means portal API command.

## 4. Generative UI Spectrum В Cubica

### Controlled Generative UI

Controlled mode means the assistant chooses from predefined tools and components. The agent controls data and timing, while Cubica controls the renderer.

Use it for:

- deterministic `player-web` runtime screens;
- mutating tools such as apply, save, purchase, archive and launch;
- critical gameplay decisions;
- assistant approval cards and tool progress.

This is the default safe mode for production.

### Declarative Generative UI

Declarative mode means the assistant returns a structured Cubica Surface from an allowlisted component catalog.

Use it for:

- editor diagnostics, diff previews and small forms;
- authoring suggestions that later become `EditorChangeSet`;
- portal launch-session drafts;
- facilitator summaries;
- player-facing hint or explanation panels when the game manifest allows them.
- primary AI-driven game screens when the game declares `ai-driven` or `hybrid` runtime mode under ADR-046.

The surface is still untrusted input and must be schema-validated before rendering or applying actions.

### Open-Ended Generative UI

Open-ended mode means the assistant can create highly flexible or custom UI beyond the shared catalog.

Use it only for:

- editor sandbox experiments;
- visual mockup exploration;
- temporary research artifacts.

Do not use it for production gameplay, payment, launch sessions, runtime state mutation or persisted manifests. AI-driven games may use agent-authored declarative surfaces in production, but not arbitrary HTML, arbitrary React components or executable code.

## 5. Cubica Surface Protocol

Initial framework-neutral shape:

```json
{
  "surfaceId": "editor.diff.preview",
  "surfaceVersion": "0.1.0",
  "mode": "declarative",
  "componentCatalog": {
    "catalogId": "cubica.editor.agent",
    "version": "0.1.0"
  },
  "source": {
    "agentId": "editor.authoring",
    "runId": "run_123",
    "contextVersion": 1
  },
  "dataModel": {
    "diffSummary": ["Set card title", "Add validation note"],
    "diagnostics": []
  },
  "root": {
    "id": "root",
    "type": "editor.diffSummary",
    "props": {
      "title": "Planned change",
      "itemsBinding": "/diffSummary"
    },
    "actions": {
      "confirm": "editor.applyChangeSet",
      "cancel": "editor.undoLastPatch"
    }
  },
  "actions": {
    "editor.applyChangeSet": {
      "toolName": "editor.applyChangeSet",
      "sideEffectPolicy": "human-approved",
      "requiresApproval": true
    },
    "editor.undoLastPatch": {
      "toolName": "editor.undoLastPatch",
      "sideEffectPolicy": "human-approved",
      "requiresApproval": true
    }
  }
}
```

The final schema should live in a Cubica-owned contract package when implementation starts. Until then, this document is the project-level specification target.

Required fields:

- `surfaceId` - stable id for the UI area.
- `surfaceVersion` - version of the surface spec shape.
- `mode` - `controlled`, `declarative` or `sandbox`.
- `componentCatalog` - catalog id and version.
- `source` - agent, run and context provenance.
- `dataModel` - scoped data visible to the surface.
- `root` - component tree root.
- `actions` - allowlisted actions available from the surface.

Forbidden fields:

- raw HTML;
- executable JavaScript;
- direct file paths for writes;
- database mutation descriptors;
- runtime state patches;
- unredacted secrets or `state.secret`.

## 6. Словарь Компонентов

The component catalog should stay small and domain-oriented.

Atomic components:

- `layout.stack`
- `layout.grid`
- `text`
- `button`
- `image`
- `form`
- `list`
- `status`
- `progress`

Editor semantic components:

- `editor.diffSummary`
- `editor.diagnosticList`
- `editor.changeSetPreview`
- `editor.pointerInspector`
- `editor.previewEntityCard`
- `editor.approvalCard`

Game semantic components:

- `game.cardGrid`
- `game.cardDetail`
- `game.metricsBar`
- `game.choiceList`
- `game.timeline`
- `game.history`
- `game.hintPanel`

Portal and facilitator components:

- `portal.catalogResultList`
- `portal.launchSessionDraft`
- `portal.licenseSummary`
- `facilitator.progressSummary`
- `facilitator.debriefDraft`

Renderer rule:

```text
unknown component type -> reject surface or render safe diagnostic
```

The client must not silently treat unknown components as raw HTML or arbitrary React components.

## 7. Практические Проблемы И Способы Решения

Cubica Surface adds explicit contracts where older plugin code could stay implicit. This improves safety and AI authoring, but it introduces extra work. The expected problems and mitigation rules are part of the architecture.

| Problem | Why It Appears | Required Mitigation |
| --- | --- | --- |
| More files for a new UI element | A renderer alone is not enough; AI and validators need a machine-readable contract. | Provide a scaffold generator or template that creates renderer, props schema, catalog entry and tests together. |
| Slower experimentation | Production surfaces reject unknown components and unknown actions. | Use editor sandbox mode for exploration, then promote a useful prototype into the catalog through schema and tests. |
| Catalog can become too large | Teams may add game-specific components to the platform catalog. | Classify every component as platform-general or game-specific. General components go to platform catalog; game-specific components go to plugin contribution namespace. |
| Channel mismatch | A rich web component may not make sense in Telegram or Phaser. | Require per-channel renderer support or a semantic fallback such as text summary, choice list or safe diagnostic. |
| Duplicate UI manifests | Surface specs can start to repeat persistent UI-manifest definitions. | Treat Cubica Surface as assistant/runtime UI state. Persist only through authoring flows that generate or update UI manifests via validation. |
| Version drift | A saved surface may reference a component catalog version the client does not support. | Use explicit catalog versions, fail closed for unknown versions, and provide fallback components for non-critical surfaces. |
| Hidden state mutation | Buttons in generated surfaces can look harmless but trigger state changes. | Every action must map to a Cubica tool, Presenter command, portal API or runtime action with side-effect policy and approval rules. |
| Too much burden on plugin authors | Plugin authors must write metadata, not just React code. | Keep the first contribution API small, provide examples, and allow advanced capabilities only after the simple path is stable. |

Preferred promotion flow:

```text
sandbox idea
  -> classify as general or game-specific
  -> add plugin or platform contribution metadata
  -> add props schema, version and allowed action kinds
  -> add renderer id for native channels
  -> add fallback kind for fallback channels
  -> pass review gate
  -> promote contribution into effective catalog
  -> add action mapping and tests
  -> allow AI/editor to use it in Cubica Surface
```

Current implementation note:

- `packages/contracts/ai` defines `CubicaSurfaceComponentContribution`.
- A contribution must declare namespace, version, props schema, allowed actions and Web/Telegram/Phaser support.
- `native` support requires a renderer id; `fallback` support requires a fallback component kind.
- Only an approved contribution can be promoted into `CubicaSurfaceCatalogComponent` for agent output.

## 8. Влияние На Подсистемы

The architecture affects more than project-local plugins.

### Editor Web

Editor Web becomes the first consumer of Cubica Surface. It should render AI diff summaries, diagnostics, approval cards and small forms through a surface renderer instead of treating CopilotKit tool UI as the permanent domain shape.

Required effect:

- AI suggestions remain `EditorChangeSet` before they mutate files.
- Property panel, Monaco and precise editors stay authoritative editing surfaces.
- Surface renderer can improve review and approval UX without replacing editor-engine.

### Player Web

Player Web has two different responsibilities:

- deterministic games must remain playable without any agent backend;
- AI-driven games may require Agent Runtime as part of gameplay when the manifest declares that runtime mode.

Cubica Surface can therefore be optional helper UI for deterministic games and primary gameplay UI for AI-driven games.

Required effect:

- deterministic production gameplay uses controlled or validated declarative surfaces only;
- AI-driven production gameplay may use agent-authored `CubicaSurface` as the current screen after validation;
- open-ended generated UI is not allowed in player runtime;
- player actions still dispatch manifest-defined runtime actions.
- AI-driven player actions dispatch agent turns through Cubica runtime/session APIs, not direct model calls.

### Runtime API

Runtime API does not execute surface renderer code. It may provide player-facing projections, deterministic action dispatch boundaries and AI-driven agent-turn orchestration. Generated UI does not become runtime state until an agent turn result is validated and accepted.

Required effect:

- no CopilotKit, AG-UI or A2UI imports in runtime core;
- no game-specific branches to support surface components;
- runtime actions remain schema-defined and manifest-first.
- AI-driven games declare Agent Runtime dependency, failure policy and allowed agent capabilities in manifest/contracts.

### Contracts And Schemas

Contracts become the stable layer for surface types, catalog metadata, action policies and validation diagnostics.

Required effect:

- surface shape must be JSON Schema-first;
- TypeScript types are generated from or aligned with the schema;
- UI framework-specific types stay out of shared contracts.

### Portal And Facilitator Surfaces

Portal and facilitator helpers can use Cubica Surface for launch-session drafts, license summaries, progress summaries and debrief drafts.

Required effect:

- mutating portal actions require RBAC, approval and audit;
- facilitator summaries use role-authorized session data only;
- generated surfaces cannot write directly to database rows or session state.

### Authoring Manifests

Authoring manifests can receive changes inspired by a surface only through the authoring workflow.

Required effect:

- raw generated surface is not persisted as the UI manifest;
- accepted UI changes compile through the existing authoring/runtime manifest pipeline;
- source maps and diagnostics remain tied to validated authoring files.

## 9. Кроссплатформенный Рендеринг

Cubica Surface is not a React contract. It is a channel-neutral contract that different renderers consume.

Target layering:

```text
CubicaSurface JSON
  -> validation and effective catalog
  -> channel projection
     -> React DOM for Web
     -> Telegram message and inline keyboard data
     -> Phaser HUD elements and interactive-zone data
  -> concrete channel adapter
```

A projection is a renderer-ready JSON view of the validated Surface. It is not a
Telegram SDK object, Phaser object or React component. This keeps channel
adapters replaceable and keeps shared contracts free from UI framework imports.

### Web React Renderer

The React renderer is only one adapter. It maps surface components to React components in `editor-web`, `player-web` or future shared UI packages.

Examples:

- `text` -> text component;
- `button` -> HTML button;
- `editor.diffSummary` -> editor-specific React panel;
- `game.cardGrid` -> player-web card grid or plugin component.

React-specific props, hooks and component instances must not appear in `CubicaSurface`.

### Telegram Renderer

Telegram does not have arbitrary layout, hover states or rich component trees. The Telegram renderer must translate semantic intent into messages and inline keyboards.

Examples:

- `layout.stack` -> ordered text blocks;
- `image` -> photo or ignored image reference with alt text;
- `button` -> inline keyboard button;
- `game.choiceList` -> numbered options with callback actions;
- `game.metricsBar` -> compact text summary.

Unsupported visual components must degrade to `text`, `list`, `choiceList` or safe diagnostic. A component that cannot degrade must declare that Telegram is unsupported.

Current contract:

- `projectSurfaceForTelegram(surface)` returns messages and inline keyboard button data.
- Supported actions stay as Cubica action objects and must still be dispatched through Cubica runtime/session APIs.
- Unsupported components produce diagnostics or fallback text; provider-specific payloads are not exposed to Telegram.

### Phaser Renderer

Phaser.js is a 2D game engine, so the renderer target is not DOM-first. A Phaser adapter can map surface components to scene objects, sprites, text objects and input handlers.

Examples:

- `image` -> sprite or texture reference;
- `text` -> Phaser text object;
- `button` -> interactive sprite or text object;
- `game.cardGrid` -> Phaser container with card sprites;
- `game.timeline` -> scene overlay or HUD layer.

Phaser-specific coordinates, textures and animations belong in renderer implementation or plugin contribution metadata, not in the generic Cubica Surface core unless the component catalog explicitly defines them as cross-renderer props.

Current contract:

- `projectSurfaceForPhaser(surface)` returns HUD-like elements and interactive zones.
- The Phaser adapter decides concrete sprites, coordinates and animations.
- Unsupported components produce diagnostic elements; provider-specific payloads are not exposed to Phaser.

### Channel Support Metadata

Every component should declare channel support:

```json
{
  "type": "game.choiceList",
  "channels": {
    "web": "native",
    "telegram": "native",
    "phaser": "fallback"
  },
  "fallback": "list"
}
```

Policy:

- `native` means the channel has a direct renderer.
- `fallback` means the renderer can degrade safely.
- `unsupported` means the surface must not use that component for the channel.
- critical gameplay controls must not rely on unsupported components.

Plugin components follow the same rule. A plugin may provide a web-only rich component, but then it must also provide a fallback or explicitly mark Telegram/Phaser as unsupported.

## 10. Действия И Изменения Состояния

Every action in a surface must map to an existing Cubica boundary.

Editor mapping:

```text
surface action -> editor tool -> EditorChangeSet or diagnostics -> dry-run -> approved apply
```

Runtime mapping:

```text
surface action -> Presenter command -> runtime-api action dispatch -> manifest-defined handler
```

AI-driven runtime mapping:

```text
surface action or player input
  -> runtime-api agent turn endpoint
  -> Agent Runtime
  -> validated state effects + CubicaSurface + available actions
  -> accepted or rejected Agent Turn event log entry
  -> persisted session event
```

Portal mapping:

```text
surface action -> portal API command -> RBAC -> audit -> state change
```

Action policy fields:

- `toolName` or `command`;
- `sideEffectPolicy`;
- `requiresApproval`;
- `auditLevel`;
- optional `correlationId`;
- optional `domainIds` for game/session/file identifiers.

The renderer may display an action button, but it cannot apply side effects itself.

Agent Turn event log contract:

- accepted entries record turn id, session id, game id, agent id, trigger, effect count, optional surface id, audit metadata and correlation id;
- rejected entries record the same identity fields plus rejection reason and rejected diagnostics;
- rejected entries must not record accepted effects;
- replay transcripts collect these entries and must declare that secret state is not included;
- evaluation fixtures bind a deterministic Agent Turn input to expected surface kinds, required effect kinds and forbidden diagnostic codes.

## 11. Совместимость С A2UI И AG-UI

A2UI-like mapping:

| A2UI idea | Cubica equivalent |
| --- | --- |
| `surfaceUpdate` | `CubicaSurface.root` and component tree |
| `dataModelUpdate` | `CubicaSurface.dataModel` or bounded data update |
| `beginRendering` | renderer instruction after validation |
| platform-agnostic widgets | Cubica component catalog |
| action callbacks | Cubica action catalog |

AG-UI mapping:

| AG-UI event | Cubica equivalent |
| --- | --- |
| run lifecycle | `CubicaAgentEvent.kind = "run"` |
| text message | `CubicaAgentEvent.kind = "text"` |
| tool call | Cubica tool event and result envelope |
| state snapshot/delta | assistant-state-only event, never authoritative state |
| custom event | adapter-owned event mapped to Cubica event or diagnostic |

Compatibility requirement:

```text
external protocol -> adapter -> CubicaAgentEvent or CubicaSurface -> validation -> UI
```

No external protocol event should bypass the adapter and reach domain code directly.

## 12. Слои Реализации

### Stage 1 - MVP CopilotKit Adapter

Current and near-term implementation:

- CopilotKit renders chat and tool UI.
- AG-UI or local backend streams agent events.
- Cubica owns assistant registry, tool catalog and result envelopes.
- Editor tools operate through `EditorChangeSet`.

### Stage 2 - Cubica Surface Contracts

Current architecture implementation:

- add framework-neutral TypeScript types and JSON Schema for `CubicaSurface`;
- add surface validation tests;
- add plugin contribution, channel projection, replay transcript and evaluation fixture contracts;
- keep A2UI/AG-UI objects restricted to adapter files.

### Stage 3 - Cubica Surface Renderer

Renderer implementation:

- render controlled and declarative surfaces without CopilotKit-specific UI state;
- keep component catalog explicit;
- support approval cards, tool progress, diagnostics and diff previews.
- support AI-driven game surfaces once ADR-046 contracts and agent-turn validation exist.
- consume channel projections in Telegram/Phaser adapters when those delivery channels are implemented.

### Stage 4 - Custom Compatible Agent UI

Target implementation:

- replace `CopilotChat` with Cubica-owned panel when product quality is sufficient;
- preserve the same assistant registry, context projection, tool catalog and surface renderer;
- keep compatibility routes or adapters for AG-UI/A2UI-like backends as needed.

Parity checklist before replacing CopilotKit:

- message list with streaming text and assistant/user roles;
- tool progress for started, args, result and error states;
- approval UI for human-approved actions before any mutation;
- diagnostics and diff summary Surface renderer;
- disabled-agent fallback that leaves editor and player workflows usable;
- transcript tests for AG-UI/A2UI-like compatibility adapters;
- bundle-size, accessibility, auth and audit review.

## 13. Безопасность И Валидация

Required controls:

- JSON Schema validation for surface shape;
- JSON Schema validation for Agent Turn event log, replay transcript and evaluation fixture shape;
- component catalog allowlist;
- plugin contribution approval gate before catalog promotion;
- action allowlist per assistant;
- context redaction before agent run;
- approval for mutating actions;
- audit envelope for production tool calls;
- replay transcript redaction with `secretStateIncluded: false`;
- max size limits for surface payload and data model;
- rejection of executable content;
- role checks for player, facilitator and portal surfaces.

Rendering policy:

```text
invalid surface -> diagnostic UI, no action execution
```

## 14. Внедрение

Recommended order:

1. Keep CopilotKit as MVP adapter and document it explicitly as replaceable.
2. Define Cubica Surface JSON Schema and types in Cubica-owned contracts.
3. Add renderer tests for a small catalog: text, button, diagnostic list, diff summary and approval card.
4. Add an editor-only surface adapter that turns a validated surface into UI inside the existing assistant panel.
5. Add A2UI-like import/export adapter only after Cubica Surface validation exists.
6. Build a custom Cubica Agent UI panel that consumes `CubicaAgentEvent`, `CubicaAgentToolResult` and `CubicaSurface`.
7. Use the custom panel as the default target when it reaches parity with the MVP CopilotKit flow.
8. Before production AI-driven games, require replay/eval/audit fixtures plus timeout, retry, rate-limit and cost-control policy.

Production provider handoff checklist:

1. Register provider adapter in an allowed adapter boundary only.
2. Attach `CubicaAgentRuntimeOperationPolicy` with idempotency, timeout, retry, rate-limit and cost-control values.
3. Store accepted/rejected Agent Turn event log entries.
4. Run replay transcript and evaluation fixtures for the target game.
5. Verify redaction policy keeps secret state out of replay transcripts unless a later role-scoped policy explicitly permits it.
6. Confirm player clients still call Cubica runtime/session APIs, not provider SDKs.

## 15. Тестирование

Minimum checks before implementation is considered safe:

- schema tests for valid and invalid surfaces;
- unknown component rejection tests;
- unknown action rejection tests;
- mutating action approval tests;
- unsafe field rejection tests for HTML, scripts, secrets and runtime patches;
- adapter transcript tests for AG-UI and A2UI-like inputs;
- channel projection tests proving one Surface can become Telegram/Phaser data without provider payloads;
- plugin contribution tests for namespace, props schema, renderer/fallback declarations and approval gate;
- replay/eval/audit tests for accepted and rejected Agent Turn entries;
- editor smoke for plan, dry-run, approval and apply;
- player smoke proving runtime works with agent UI disabled.
- AI-driven smoke proving a declared agent-required game fails readiness or pauses clearly when Agent Runtime is unavailable.

## 16. Связанные Документы

- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
- `docs/architecture/adrs/003-hybrid-sdui-schema.md`
- `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md`
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/agent-ui-foundation.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- `packages/contracts/ai/src/index.ts`
- `apps/editor-web/src/lib/editor-agent-tool-catalog.ts`
- `https://www.copilotkit.ai/generative-ui`
- `https://www.copilotkit.ai/ag-ui`
