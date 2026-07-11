# TSK-20260610-cubica-generative-ui-surface-protocol: Cubica Generative UI Surface Protocol

- **Дата создания**: 2026-06-10
- **Статус**: completed
- **Владелец**: Codex
- **Связанные ADR**: ADR-003, ADR-043, ADR-044, ADR-045, ADR-046
- **Связанные документы**: `docs/architecture/generative-ui-surface-protocol.md`, `docs/architecture/agent-ui-foundation.md`, `docs/architecture/agent-ui-portability-and-risk-controls.md`, `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`

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

Перевести идеи CopilotKit Generative UI Spectrum and A2UI (декларативной JSONL-спецификации UI-поверхностей) в собственный Cubica-owned contract для интерфейсных поверхностей ИИ-помощников и будущих игровых UI-сценариев.

Итог должен сохранить CopilotKit как MVP-адаптер первого этапа (внешний адаптер для минимально достаточной продуктовой проверки), но дать проверяемый путь к собственному совместимому Cubica Agent UI и Cubica Surface (собственному JSON-описанию ограниченной UI-поверхности помощника).

## 2. Контекст

Уже есть:

- CopilotKit/AG-UI baseline in `apps/editor-web`;
- Cubica-owned AI contracts in `packages/contracts/ai`;
- editor assistant tool catalog;
- AG-UI import-boundary gate;
- ADR-044 portability constraints;
- Hybrid SDUI foundation from ADR-003.

Contract foundation now exists in `packages/contracts/ai`:

- Cubica-owned surface contract for declarative Generative UI;
- JSON Schema constants and validation helpers for surface validation;
- renderer-neutral default component catalog;
- channel support metadata for Web, Telegram and Phaser;
- Telegram/Phaser framework-neutral projection helpers and fixtures;
- plugin contribution metadata and approval gate;
- AI-driven gameplay-safe component flags.

Не хватает:

- adapter rules for A2UI-like streams;
- explicit custom UI parity target replacing CopilotKit after MVP.
- renderer consumption in editor channels and concrete Telegram/Phaser adapters.

## 3. Область Работ

Входит в работу:

- определить `CubicaSurface` TypeScript contract and JSON Schema;
- добавить component catalog for first editor surfaces;
- добавить validation helpers and tests;
- описать A2UI-like adapter mapping without making A2UI a source of truth;
- добавить minimal renderer layer for controlled/declarative assistant surfaces;
- добавить channel support metadata and fallback policy for Web, Telegram and Phaser.js renderers;
- подготовить parity checklist for replacing CopilotKit chat/tool UI with a custom Cubica panel.

Не входит в работу:

- немедленная замена CopilotKit;
- production LLM backend;
- открытый произвольный HTML/React renderer;
- изменение runtime gameplay mechanics;
- запись generated UI directly into manifests;
- портальные платежи или launch-session mutation beyond existing APIs.

## 4. Критерии Приёмки

1. ADR-045 explicitly states that CopilotKit is an MVP adapter and the target is a custom compatible Cubica Agent UI.
2. `docs/architecture/generative-ui-surface-protocol.md` describes Cubica Surface, component catalog, action model, A2UI/AG-UI compatibility and security rules.
3. `packages/contracts/ai` contains framework-neutral types for Cubica surfaces or the task records a narrower first implementation location.
4. A JSON Schema validates Cubica Surface payloads.
5. Unknown components and unknown actions are rejected or rendered as safe diagnostics.
6. Mutating actions cannot execute without the assistant's side-effect policy and approval rule.
7. A2UI-like input is parsed only through an adapter and mapped to Cubica Surface or diagnostics.
8. `apps/editor-web` can render at least one controlled surface and one declarative surface without leaking CopilotKit-specific types into domain packages.
9. Agent UI disabled mode still leaves editor/player core workflows usable.
10. A documented parity checklist exists for replacing CopilotKit with the custom Cubica panel.
11. The architecture documents problem mitigation for experimentation, catalog growth, duplicated UI manifests, version drift and plugin-author burden.
12. Component definitions declare Web/Telegram/Phaser support or a safe fallback.
13. The surface contract supports AI-driven gameplay surfaces without allowing arbitrary HTML, arbitrary React components or direct state mutation.

## 5. Пакеты Работ

### WP1 - Contract Design

- [x] Define `CubicaSurface`, `CubicaSurfaceComponent`, `CubicaSurfaceAction` and catalog metadata.
- [x] Decide final package location for shared types.
- [x] Add comments explaining why surfaces are assistant UI state, not authoritative Cubica state.

### WP2 - JSON Schema And Validation

- [x] Add JSON Schema for surface payloads.
- [x] Add validation helper that returns structured diagnostics.
- [x] Reject raw HTML, executable scripts, direct state patches and secret paths.

### WP3 - Component Catalog

- [x] Add a minimal editor catalog: text, button, diagnostic list, diff summary and approval card.
- [x] Add a minimal game catalog draft: metrics bar, card grid, hint panel and choice list.
- [x] Document catalog versioning and renderer fallback behavior.
- [x] Add channel support metadata: `native`, `fallback` or `unsupported` for Web, Telegram and Phaser.
- [x] Mark which components are safe for primary AI-driven gameplay and which are helper-only.

### WP4 - Adapter Mapping

- [x] Add an A2UI-like adapter spec and test fixtures.
- [x] Confirm AG-UI custom events map to Cubica events or diagnostics only.
- [x] Keep external protocol imports behind adapter allowlists.

### WP5 - Renderer Slice

- [x] Render a controlled tool progress surface in `apps/editor-web`.
- [x] Render a declarative diff/diagnostic surface in `apps/editor-web`.
- [x] Keep mutating buttons connected to existing editor tools and approval flow.
- [x] Prove the renderer consumes framework-neutral data, not React component instances or hooks.

### WP5A - Non-Web Rendering Policy

- [x] Define Telegram translation rules for text, list-like summaries, button, choice list and metrics summary.
- [x] Define Phaser translation rules for text, button, choice list, card grid and HUD-like overlays.
- [x] Add safe diagnostic behavior for unsupported critical components.
- [x] Add fixtures proving one surface can degrade from Web to Telegram/Phaser without changing the source surface contract.

### WP5C - Plugin Surface Contribution Path

- [x] Define namespace, version, props schema, allowed actions and channel support contract for plugin Surface components.
- [x] Require native renderer id per supported channel or explicit fallback kind.
- [x] Add approval gate before a plugin component becomes available to agent output.
- [x] Add tests for accepted contribution and rejected draft/unsafe namespace contribution.

### WP5B - AI-Driven Gameplay Surface Policy

- [x] Define when `CubicaSurface` may be the primary current screen of a game.
- [x] Require every primary gameplay action to map to an agent turn, runtime action or approved tool in Web player.
- [x] Add readiness/failure behavior for AI-driven surfaces when Agent Runtime is unavailable.
- [x] Keep deterministic gameplay surfaces independent from Agent Runtime.

### WP6 - Custom UI Parity Checklist

- [x] Define minimum custom panel capabilities: messages, streaming text, tool progress, approvals, diagnostics and surface renderer.
- [x] Define migration steps from `CopilotChat` to Cubica Agent UI.
- [x] Add review gates for bundle size, accessibility, auth, audit and disabled-agent fallback.

## 6. План Проверки

Documentation-only checks:

- `git diff --check -- docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md docs/architecture/generative-ui-surface-protocol.md docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- `node scripts/dev/generate-structure.js`

Implementation checks:

- `npm run verify:agent-ui-boundaries`
- `npm run typecheck --workspace @cubica/editor-web`
- `npm test --workspace @cubica/editor-web`
- `npm run build --workspace @cubica/editor-web`
- surface schema unit tests
- adapter transcript tests for AG-UI and A2UI-like inputs
- player smoke confirming no agent backend is required for gameplay
- renderer fallback tests for unknown component, unsupported channel and unsupported action
- AI-driven gameplay surface tests for primary screen validation and unavailable Agent Runtime behavior

## 7. Артефакты

- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md` - architecture decision.
- `docs/architecture/generative-ui-surface-protocol.md` - project architecture.
- `packages/contracts/ai/src/index.ts` - implemented Surface contracts, schema constants, catalog, validation helpers, Telegram/Phaser projection helpers, plugin contribution contracts and replay/eval/audit contracts.
- `packages/contracts/ai/tests/index.test.ts` - Surface validation, channel projection, plugin contribution and replay/eval/audit coverage.
- `services/runtime-api/src/modules/ai/agentRuntime.ts` - first runtime producer of validated primary-gameplay `CubicaSurface` from Agent Turn.
- `games/ai-driven-choice/` - committed fixture that receives validated primary-gameplay `CubicaSurface` from Agent Turn during runtime tests.
- `apps/player-web/src/components/surface/cubica-surface-renderer.tsx` - first Web renderer for validated `CubicaSurface` gameplay payloads.
- `apps/player-web/src/components/game-player-dom.test.tsx` - Web player paused/unavailable and Surface rendering tests.
- `apps/editor-web/src/components/editor-cubica-surface.tsx` - editor sidebar renderer for validated helper `CubicaSurface` payloads.
- `apps/editor-web/src/components/editor-cubica-surface.test.tsx` - editor Surface rendering and action dispatch coverage.
- `apps/editor-web/src/lib/ag-ui-event-adapter.test.ts` - AG-UI custom event and transcript boundary coverage.
- `scripts/ci/validate-agent-ui-boundaries.js` - CopilotKit, AG-UI and provider SDK import-boundary gate.

## 8. Журнал Передачи

### 2026-06-10 - Документация Создана

- Changed:
  - `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
  - `docs/architecture/generative-ui-surface-protocol.md`
  - `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- Done:
  - accepted ADR-045 records CopilotKit as MVP adapter and custom compatible Cubica Agent UI as target;
  - project document defines Cubica Surface Protocol and A2UI/AG-UI compatibility boundaries;
  - execution task records future implementation work packages and validation.
- Remaining:
  - implement contracts, schema, adapter fixtures and renderer slice.
- Next:
  - start with `packages/contracts/ai` surface types and JSON Schema location decision.
- Risks:
  - avoid duplicating UI manifests; Cubica Surface is assistant/UI runtime surface state until validated authoring flow persists it.

### 2026-06-11 - Проблемы И Кроссплатформенность Уточнены

- Changed:
  - `docs/architecture/generative-ui-surface-protocol.md`
  - `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- Done:
  - documented practical mitigation for the new architecture's added schema/catalog work, slower experimentation, catalog growth, version drift and plugin-author burden;
  - documented impact beyond plugins: editor, player, runtime, contracts, portal/facilitator surfaces and authoring manifests;
  - documented channel-neutral rendering for Web React, Telegram and Phaser.js.
- Remaining:
  - implement types, schemas, component catalog, channel metadata and renderer fallback tests.
- Next:
  - start implementation by defining the minimal `CubicaSurface` contract and component channel metadata.
- Risks:
  - do not let the first React renderer leak React-specific props into shared Cubica contracts.

### 2026-06-11 - Contract Foundation Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `packages/contracts/ai/package.json`
  - `packages/contracts/ai/tsconfig.json`
  - `packages/contracts/ai/vitest.config.ts`
- Done:
  - implemented Surface types, JSON Schema constants, validation helpers and default component catalog;
  - catalog now includes editor components and game components with Web/Telegram/Phaser channel support;
  - validation rejects unknown components, unsupported component actions, unsupported channel components, unsafe generated HTML keys and direct state mutation keys.
- Verified:
  - `npm run verify:contracts-ai`
  - `npm run verify:agent-ui-boundaries`
- Remaining:
  - implement A2UI-like adapter mapping;
  - implement editor renderer slice;
  - add non-web renderer fallback fixtures once renderer code exists.
- Next:
  - add a minimal `apps/editor-web` Surface renderer behind the existing Agent UI sidebar boundary.
- Risks:
  - Surface schema and catalog are now available, but no production player channel consumes them yet.

### 2026-06-11 - AI-Driven Surface Producer Implemented

- Changed:
  - `services/runtime-api/src/modules/ai/agentRuntime.ts`
  - `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts`
  - `services/runtime-api/src/modules/player-api/httpServer.ts`
  - `services/runtime-api/tests/runtime-api.integration.ts`
- Done:
  - `POST /agent-turns` can now return a validated primary-gameplay `CubicaSurface` from the opt-in mock Agent Runtime;
  - runtime validates Surface catalog membership before persisting accepted state effects;
  - deterministic gameplay stays independent from Agent Runtime and rejects `/agent-turns`;
  - AI-driven content with missing Agent Runtime fails readiness/session launch instead of exposing broken player UI.
- Verified:
  - `npm run typecheck --workspace services/runtime-api`
  - `npm test --workspace services/runtime-api`
- Remaining:
  - implement actual Web/Telegram/Phaser renderers for returned surfaces;
  - require every primary gameplay action to map to a declared agent turn, runtime action or approved tool across renderer channels;
  - add renderer fallback tests for unsupported components and channels.
- Next:
  - implement the first player/editor Surface renderer slice after the AI-driven fixture is committed.
- Risks:
  - runtime can produce a validated Surface, but player-web does not yet render it as the active screen.

### 2026-06-11 - AI-Driven Surface Fixture Added

- Changed:
  - `games/ai-driven-choice/authoring/game.authoring.json`
  - `games/ai-driven-choice/authoring/ui/web.authoring.json`
  - `games/ai-driven-choice/game.manifest.json`
  - `games/ai-driven-choice/ui/web/ui.manifest.json`
  - `services/runtime-api/tests/runtime-api.integration.ts`
- Done:
  - added a committed AI-driven fixture that declares `surfaceCatalog: ["cubica.choiceList"]`;
  - tests verify that Agent Turn returns a validated `cubica.choiceList` primary-gameplay surface for this fixture;
  - fallback web UI manifest exists only as a bridge until player channels render `CubicaSurface` directly.
- Verified:
  - `npm test --workspace services/runtime-api`
  - `npm run verify:manifest-authoring`
- Remaining:
  - implement Web/Telegram/Phaser Surface renderers;
  - add renderer-level tests for the fixture's returned Surface.
- Next:
  - make player-web show unavailable state and then render the returned Surface as the active screen.
- Risks:
  - the fixture proves Surface production and validation, not player-side rendering yet.

### 2026-06-11 - Web Player Surface Renderer Implemented

- Changed:
  - `apps/player-web/src/components/surface/cubica-surface-renderer.tsx`
  - `apps/player-web/src/components/game-player.tsx`
  - `apps/player-web/src/presenter/game-presenter.ts`
  - `apps/player-web/src/presenter/runtime-client.ts`
  - `apps/player-web/src/components/runtime-status-panel.tsx`
  - `apps/player-web/src/components/game-player-dom.test.tsx`
  - `apps/player-web/src/presenter/runtime-client.test.ts`
  - `apps/player-web/README.md`
- Done:
  - Web player renders validated `CubicaSurface` as the active AI-driven gameplay surface;
  - renderer supports the MVP gameplay catalog entries and returns safe diagnostics for unsupported components;
  - Surface actions route only to Agent Turn or runtime action APIs;
  - paused/unavailable Agent Runtime state is shown before session creation, so AI-driven games do not fall through to deterministic fallback accidentally.
- Verified:
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web`
  - `npm run build --workspace @cubica/player-web`
  - `npm run verify:agent-ui-boundaries`
  - targeted `apps/player-web/e2e/player-web.spec.ts` Playwright run against local runtime-api/player-web dev servers
- Remaining:
  - implement editor Surface renderer slices;
  - implement Telegram and Phaser Surface mappings;
  - add cross-channel fallback fixtures and A2UI-like adapter transcript tests.
- Next:
  - define non-Web rendering rules and event/replay fixtures before expanding the catalog.
- Risks:
  - Web renderer is intentionally bounded; it is not a license for arbitrary generated React or HTML.

### 2026-06-11 - Non-Web Projection And Plugin Contribution Contracts Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `docs/architecture/generative-ui-surface-protocol.md`
  - `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- Done:
  - added Telegram and Phaser projection helpers that convert validated `CubicaSurface` JSON into channel-neutral messages, buttons, HUD-like elements and interactive zones;
  - added safe diagnostic behavior for unsupported channel components;
  - added plugin Surface component contribution contract with namespace, version, props schema, allowed actions, channel renderer/fallback declarations and approval gate;
  - added tests proving one Surface can project to Telegram/Phaser without provider payloads or React objects.
- Verified:
  - `npm run typecheck --workspace @cubica/contracts-ai`
  - `npm test --workspace @cubica/contracts-ai`
- Remaining:
  - implement concrete Telegram bot and Phaser.js adapters that consume the projection contracts;
  - implement editor Surface renderer slices;
  - add A2UI-like adapter transcript tests.
- Next:
  - use the projection helpers when the first Telegram/Phaser delivery channel is introduced.
- Risks:
  - projection contracts are not full channel clients; production channel adapters still need their own rendering and input tests.

### 2026-06-11 - Editor Surface And Adapter Mapping Implemented

- Changed:
  - `packages/contracts/ai/src/index.ts`
  - `packages/contracts/ai/tests/index.test.ts`
  - `apps/editor-web/src/components/editor-cubica-surface.tsx`
  - `apps/editor-web/src/components/editor-cubica-surface.test.tsx`
  - `apps/editor-web/src/components/editor-agent-ui.tsx`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `apps/editor-web/src/lib/ag-ui-event-adapter.test.ts`
  - `apps/editor-web/app/globals.css`
  - `scripts/ci/validate-agent-ui-boundaries.js`
- Done:
  - added A2UI-like adapter event schema, validator and stream-to-Surface adapter;
  - added editor sidebar Cubica Surface renderer for tool progress, diagnostics, diff summary and approval actions;
  - connected editor Surface actions to existing editor tools: dry-run, approved apply and undo journal;
  - added AG-UI custom event test proving custom events remain adapter-owned and cannot mutate canonical state;
  - extended import-boundary validation to provider SDK imports.
- Verified:
  - `npm run verify:contracts-ai`
  - `npm run typecheck --workspace @cubica/editor-web`
  - `npm test --workspace @cubica/editor-web`
- Remaining:
  - concrete custom Cubica Agent UI replacement after post-MVP parity acceptance;
  - concrete Telegram/Phaser delivery clients that consume projection data.
- Next:
  - keep CopilotKit as MVP shell until the parity checklist is implemented and accepted.
- Risks:
  - editor Surface renderer is a bounded helper panel, not a full replacement for CopilotChat yet.
