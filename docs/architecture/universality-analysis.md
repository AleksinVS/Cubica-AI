# Architecture Universality Analysis

**Date:** 2026-05-08  
**Status:** Historical analysis; superseded recommendations are retained as evidence

## Table of Contents

- [Status Notice — Read Before Using](#status-notice--read-before-using)
- [1. Executive Summary](#1-executive-summary)
- [2. Current Architecture Overview](#2-current-architecture-overview)
- [3. What Works Well](#3-what-works-well)
- [4. Game-Specific Leaks in Platform Layer](#4-game-specific-leaks-in-platform-layer)
- [5. Coupling That Complicates Adding a New Game](#5-coupling-that-complicates-adding-a-new-game)
- [6. Making AI Agents More Effective](#6-making-ai-agents-more-effective)
- [7. Proposals for Improved Universality](#7-proposals-for-improved-universality)
- [8. Implementation Priority](#8-implementation-priority)
- [Appendix A: File Inventory](#appendix-a-file-inventory)
- [Appendix B: New Game Checklist (Current State)](#appendix-b-new-game-checklist-current-state)
- [Appendix C: Manifest Structure Summary](#appendix-c-manifest-structure-summary)

---

## Status Notice — Read Before Using

> [!IMPORTANT]
> This document is a dated repository analysis from 2026-05-08. It is not a
> current implementation guide or an architecture decision. ADR-084 and the
> completed Game Intent → Cubica Mechanics IR migration supersede its action
> dispatch recommendations and several observations labelled “Current”. Keep
> the body and appendices as historical evidence; verify any file, count or
> runtime statement against the current repository before acting on it.

The most important superseded points are:

| Historical observation or proposal | Current contract |
|---|---|
| Presenter resolves a UI command through `resolveActionId`, `commandMap` and default names | UI bindings target one exact published `actionId`; Presenter routes it without game-rule fallback or subject-state selection |
| Action metadata is described as `deterministic` | An action has `binding.kind = "mechanics-plan"`, `planRef` and compiled definition/plan hashes |
| Runtime mutation is inferred from plugin action conventions | Server executes schema-valid typed Mechanics IR over an explicitly declared `stateModel` |
| Plugin resolution is allowed to determine the write command | Actor-scoped availability is projected by the server; the client or plugin cannot select internal `op`, plan or module |
| An AI agent may need a separate mutation route | Agent Runtime selects one published Game Intent and uses the same authenticated command transaction |

The historical recommendations about localization, generic rendering,
game-specific leakage and separating data from presentation can still be useful
as problem evidence. They do not override later ADRs, JSON Schemas or the
current implementation.

## 1. Executive Summary

The Cubica platform has a well-structured plugin architecture — `GameConfig` + `GameConfigResolvers` + `ResolverFactory` — that cleanly separates game-specific logic from the generic presenter and renderer. However, several Antarctica-specific concepts leak into the platform layer, and the plugin contract itself carries game-concept assumptions (boards, cards, info screens) that wouldn't apply to different game genres.

This analysis identifies **14 specific leaks**, **8 coupling points** that complicate adding new games, and proposes **7 concrete improvements** that would make the platform more universal and make it easier for AI agents to copy/modify games.

The most impactful changes are: (1) moving `resolveBoardScreenKey` out of the generic interface, (2) extracting Russian strings into a localizable layer, (3) making screen routing fully data-driven via manifest `ScreenRoutingEntry`, and (4) creating a game template/scaffold that automates the mechanical parts of adding a new game.

---

## 2. Current Architecture Overview

### 2.1 Layer Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      Server Layer                            │
│  runtime-api: loads manifests, validates, serves DTOs       │
│  GameManifest → AJV validation → PlayerFacingContent DTO     │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP API
┌────────────────────────────▼────────────────────────────────┐
│                    Presenter Layer                            │
│  GamePresenter: boot, dispatch, patch, syncView              │
│  GameConfig: generic interface (data + resolvers)             │
│  GameConfigRegistry: Map<gameId, ResolverFactory>            │
│  GameConfigData: serializable config (metrics, images, keys)  │
└────────────────────────────┬────────────────────────────────┘
                             │ ViewCommand stream
┌────────────────────────────▼────────────────────────────────┐
│                    Component Layer                            │
│  GamePlayer → ManifestRenderer | SafeModeRenderer            │
│  UiComponentNode → card/button/metric/richText/image/area    │
│  Expression resolver: {{path}} → value                        │
└────────────────────────────┬────────────────────────────────┘
                             │ onAction
┌────────────────────────────▼────────────────────────────────┐
│                  Plugin Layer (Antarctica)                    │
│  contracts.ts: AntarcticaGameState, GamePlayerContent         │
│  state-resolvers.ts: resolveCurrentBoard, resolveBoardCards  │
│  register.ts: ResolverFactory → GameConfig<AntarcticaGS>     │
│  antarctica-config-data.ts: hardcoded metrics, images, keys  │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
game.manifest.json ──► runtime-api ──► PlayerFacingContent DTO
                                            │
ui.manifest.json ──► runtime-api ──► GamePlayerUiContent
                                            │
                    session snapshot ──► GamePresenter.playerState
                                            │
                                            ├── config.resolveGameState()
                                            ├── config.resolveScreenKey()
                                            ├── config.resolveLayoutMode()
                                            └── config.resolveMetrics()
                                            │
                                            ▼
                                      PlayerState → ViewCommand[]
                                            │
                                            ▼
                                      ManifestRenderer / SafeModeRenderer
```

### 2.3 Manifest Structure

**Game manifest** (`game.manifest.json`):
- `meta`: id, version, name, description, schemaVersion, tags, training
- `config`: players {min, max}, settings {mode, locale}
- `content.antarctica`: boards (13), cards (71), infos (26), teamSelections (1)
- `engine`: systemPrompt, modelConfig
- `state.public`: flags, log, metrics, teamSelection, timeline, ui
- `actions`: 144 actions with deterministic metadata

**UI manifest** (`ui.manifest.json`):
- `meta`: id, version
- `entry_point`: "S1"
- `screens`: Record<string, GameUiScreenDefinition> — 11 screens
- `design_artifacts.registry`: 5 design artifact refs
- `layouts`: layout.web.s1

**Contract types** (`packages/contracts/manifest/src/index.ts`):
- 654 lines defining the full type hierarchy
- 7 component types: screenComponent, areaComponent, gameVariableComponent, cardComponent, buttonComponent, richTextComponent, imageComponent
- ScreenRoutingEntry: data-driven routing (defined but not yet active for Antarctica)
- GameUiComponent with itemTemplate, actions, visualMode, designImageRef
- Expression binding: `{{path}}`, `{{path || fallback}}`, `{{collection}}` for itemTemplate

---

## 3. What Works Well

These patterns are already correctly implemented and should be preserved:

| Pattern | Implementation | Why It's Good |
|---------|---------------|---------------|
| Plugin registration | `registerGameResolvers(gameId, factory)` — single line per game | Adding a game requires one import + one registration call |
| Serializable boundary | `GameConfigData` (JSON-safe) vs `GameConfig` (includes functions) | Server Components can pass config across the RSC boundary |
| Expression resolver | Generic `{{path}}` binding with aliases and fallbacks | UI components don't need to know about state shape |
| Manifest-driven rendering | `ManifestRenderer` + `UiComponentNode` fully data-driven | New screens can be added by editing JSON, not TypeScript |
| Manifest action adapter | Pluggable `resolveActionId` + `commandMap` + defaults | Three-level resolution with game-specific override |
| itemTemplate | Collection iteration with `{{card.title}}` localContext | Cards/members rendered without per-item code |
| resolvePayloadExpressions | `{{card.selectActionId}}` resolved at click time | Payloads carry dynamic data from itemTemplate context |
| resolveMetrics hook | Optional `GameConfigResolvers.resolveMetrics` | Score derivation stays in the plugin |
| ScreenRoutingEntry contract | Defined in `@cubica/contracts-manifest` | Future games can use data-driven routing without code |

---

## 4. Game-Specific Leaks in Platform Layer

### 4.1 Hardcoded Strings (Russian)

| String | Location | Type |
|--------|----------|------|
| `"Загрузка..."` | `game-player.tsx:160,204` | Loading text |
| `"Выбрать"` | `card-component.tsx:82,131` | Select button label |
| `"журнал ходов"` | `safe-mode-renderer.tsx:253` | Journal button |
| `"подсказка"` | `safe-mode-renderer.tsx:258` | Hint button |
| `"Назад"` / `"Вперед"` | `safe-mode-renderer.tsx:262-265` | Nav buttons |
| `"Продолжить"` | `safe-mode-renderer.tsx:340` | Advance button |
| `"Информация"` | `safe-mode-renderer.tsx:353` | Info screen title |
| `"Выбор команды"` | `safe-mode-renderer.tsx:493` | Team selection title |
| `"Подтвердить"` | `safe-mode-renderer.tsx:549` | Confirm button |

**Impact:** Adding a game in a different language requires editing TypeScript files, not just configuration.

### 4.2 Hardcoded Game Concepts

| Leak | Location | Description |
|------|----------|-------------|
| `"score"` metric special styling | `game-variable-component.tsx:32-44` | The metric with `id === "score"` gets hardcoded CSS dimensions (107×80px). Antarctica-specific visual treatment. |
| `"S1_LEFT"` screen key | `screen-router.ts:58` | Generic router returns Antarctica-specific screen key when `runtimeUi.activeScreen === "left-sidebar"`. |
| `"showScreenWithLeftSideBar"` default action | `manifest-action-adapter.ts:51` | Antarctica-specific command name as a universal fallback. |
| `resolveBoardScreenKey` in `GameConfigResolvers` | `game-config.ts:62` | "Board" is a game concept — not all games have boards. The method is required on every game plugin. |
| `GameConventionState` keys | `safe-mode-renderer.tsx:15-48` | `currentInfo`, `currentBoard`, `currentTeamSelection`, `boardCards` are Antarctica concepts baked into the convention state interface. |
| `topbarScreenKeys` in `GameConfigData` | `game-config.ts:42` | Hardcoded set of screen keys that determine layout. Should be derived from manifest screen definitions. |

### 4.3 camelCase/snake_case Duality

| Location | Fields |
|----------|--------|
| `game-presenter.ts:72-91` | `screenId`/`screen_id`, `stepIndex`/`step_index`, `activeInfoId`/`active_info_id` |
| `game-content-resolvers.ts:81-90` | `readStepIndex`, `readScreenId` both check camelCase and snake_case |

This is a runtime API format inconsistency that leaks into both the presenter and lib layers. It should be normalized once at the API boundary.

### 4.4 Type Duplication

| Type | Location 1 | Location 2 | Issue |
|------|-----------|-----------|-------|
| MetricSpec-like | `game-state.ts:31` (`MetricSpec`) | `game-config.ts:13` (`FallbackMetricSpec`) | Nearly identical interfaces defined in two places |
| CardFlagState | `game-content-resolvers.ts:33-39` | `antarctica/contracts.ts` (inline) | Same structure, two definitions |
| GamePlayerContent | `antarctica/contracts.ts` | Implicit in `content.antarctica` manifest key | Plugin must cast `unknown` to its type |

### 4.5 Action Type String Literals

The following action type strings are scattered as bare string literals across multiple files:

`"showHistory"`, `"showHint"`, `"dismiss_panel"`, `"requestServer"`, `"advance"`, `"reset_game"`, `"showScreenWithLeftSideBar"`

These should be constants in the contracts package.

---

## 5. Coupling That Complicates Adding a New Game

### 5.1 Mandatory Files to Create

When adding a new game (e.g., "arctic"), the following new files are required:

| File | Purpose | Complexity |
|------|---------|-----------|
| `games/arctic/plugins/arctic-player/src/contracts.ts` | Define `ArcticGameState` and content interfaces | Medium — depends on game complexity |
| `games/arctic/plugins/arctic-player/src/state-resolvers.ts` | Implement all resolver functions | Medium — mostly follows Antarctica pattern |
| `games/arctic/plugins/arctic-player/src/register.ts` | Implement plugin registration through `PlayerPluginApi` | Low — boilerplate |
| `games/arctic/plugins/arctic-player/src/config-data.ts` | Define serializable `GameConfigData` (metrics, images, keys) | Medium — requires asset paths and metric definitions |

### 5.2 Mandatory Files to Modify

| File | Change | Risk |
|------|--------|------|
| `games/arctic/plugins/arctic-player/plugin.json` | Declare player-web entry and validation policy | Low |
| `games/arctic/published/player-web-plugin-bundles.json` | Generated by publish builder; do not hand-edit | Low |
| `game.manifest.json` for the new game | Content, state, actions | Medium — must follow schema |
| `ui.manifest.json` for the new game | Screen definitions | Medium — must follow schema |

### 5.3 Implicit Contracts

Even with `GameConventionState` typed as `Record<string, unknown>`, the `SafeModeRenderer` checks specific keys. A new game that doesn't produce `currentInfo`, `currentBoard`, etc. will fall straight through to the action catalog fallback. This isn't a bug — it's the intended design — but it means the convention state is an **undocumented implicit contract** between the plugin's `resolveGameState()` and the renderer.

### 5.4 Configuration That Must Be Known Upfront

Creating `antarctica-config-data.ts` requires knowing:
1. All metric IDs and their display names (8 metrics)
2. All metric background image paths (16 images — topbar + sidebar)
3. All topbar screen keys (3 screen key ranges)
4. The `gameId`, `playerId`, and `storageKey` strings
5. The metric derivation formula (score = 60 - time)

None of these come from the manifest — they're hardcoded in TypeScript.

---

## 6. Making AI Agents More Effective

AI agents copying or editing games need to understand:

1. **Where game data lives** — Currently split across `game.manifest.json` (content/state/actions), `ui.manifest.json` (screen layout), `antarctica-config-data.ts` (display config), and `register.ts` (routing logic). An agent must edit 4+ files in 3+ directories.

2. **What the plugin contract requires** — `GameConfigResolvers` has 6 required methods and 2 optional ones. The required `resolveBoardScreenKey` forces every game to implement a board concept even if it has none.

3. **How state flows from manifest to UI** — The pipeline is: manifest JSON → runtime API → `PlayerFacingContent` DTO → `resolveGameContent()` → game plugin resolvers → `AntarcticaGameState` → `SafeModeRenderer` convention keys. This is 6 transformation steps.

4. **Which strings are user-visible** — Russian strings are scattered in TypeScript. An agent localizing or translating must find and edit 9+ locations in component files.

### 6.1 What Would Help

| Improvement | Benefit for AI Agents |
|------------|---------------------|
| Game scaffold template | One command to generate all 4 plugin files with correct structure |
| Config data from manifest | Remove need for `*-config-data.ts` by reading metrics/images from manifest |
| Constants for action types | Fewer magic strings to search for |
| Convention state documentation | Clear contract for what `resolveGameState` must produce |
| i18n extraction | All user-facing strings in one file per locale |
| Data-driven routing via `screenRouting` | Eliminate `resolveBoardScreenKey` and `resolveScreenKey` for simple games |

---

## 7. Proposals for Improved Universality

### P1: Move `resolveBoardScreenKey` out of `GameConfigResolvers`

**Problem:** `resolveBoardScreenKey` is a required method on `GameConfigResolvers`, but "board" is a card-game concept. A trivia game, adventure game, or simulation has no boards.

**Proposal:** Make it optional (already returns `string | null`) and add a default implementation that returns `null`. Games that use boards override it; others don't.

```typescript
// game-config.ts
export interface GameConfigResolvers<TGameState, TUiContent> {
  // ...existing methods...
  
  /** Optional: maps stepIndex to a board screen key. Default returns null. */
  resolveBoardScreenKey?: (stepIndex: number | null) => string | null;
}
```

**Impact:** Low — existing code already returns `null` for non-matching stepIndices. Just need to add a default in `GamePresenter`.

### P2: Data-Driven Screen Routing via Manifest `screenRouting`

**Problem:** `resolveScreenKey` in `register.ts` contains hardcoded step-to-screen mappings (30→"55..60", 32→"61..66", etc.). The `ScreenRoutingEntry` contract type already exists but is unused.

**Proposal:** Move routing entries into `ui.manifest.json`:

```json
{
  "screenRouting": [
    { "screenKey": "55..60", "conditions": { "screenId": "S2", "stepIndex": 30 } },
    { "screenKey": "61..66", "conditions": { "screenId": "S2", "stepIndex": 32 } },
    { "screenKey": "67..70", "conditions": { "screenId": "S2", "stepIndexRange": { "from": 34, "to": 37 } } },
    { "screenKey": "S1_LEFT", "conditions": { "screenId": "S1", "layoutMode": "leftsidebar" } }
  ]
}
```

For simple games, the generic `resolveScreenKey` from `screen-router.ts` would handle all routing. Only games with complex conditional logic would need a plugin `resolveScreenKey`.

**Impact:** Medium — requires updating the UI manifest pipeline and making the plugin's `resolveScreenKey` optional with a default that delegates to `screen-router.ts`.

### P3: Extract Config Data from Manifest

**Problem:** `antarctica-config-data.ts` hardcodes 8 metric specs, 16 image paths, 3 screen keys, and game IDs. This data could come from the manifest or a separate config JSON.

**Proposal:** Add a `playerConfig` section to `ui.manifest.json`:

```json
{
  "playerConfig": {
    "metrics": [
      { "id": "time", "caption": "Остаток дней", "aliases": ["days"], "images": { "topbar": "/images/top-sidebar/days.png", "sidebar": "/images/left-sidebar/days.png" } },
      { "id": "score", "caption": "Баллы", "aliases": ["points"], "images": { "topbar": "/images/top-sidebar/score.png", "sidebar": "/images/left-sidebar/score.png" } }
    ],
    "screenKeys": {
      "topbar": ["55..60", "61..66", "67..70"]
    }
  }
}
```

Then `GameConfigData` can be auto-generated from the manifest, and `*-config-data.ts` files become unnecessary.

**Impact:** High — changes the server→client data flow, but eliminates an entire class of files per game.

### P4: Constantize Action Types

**Problem:** Action type strings (`"showHistory"`, `"showHint"`, `"dismiss_panel"`, `"requestServer"`, `"advance"`, `"reset_game"`) are scattered as bare string literals.

**Proposal:** Add constants to `@cubica/contracts-manifest`:

```typescript
export const ManifestAction = {
  SHOW_HISTORY: "showHistory",
  SHOW_HINT: "showHint",
  DISMISS_PANEL: "dismiss_panel",
  REQUEST_SERVER: "requestServer",
  ADVANCE: "advance",
  RESET_GAME: "reset_game",
} as const;
```

**Impact:** Low — mechanical replacement. No behavior change.

### P5: Remove `"score"` Special-Casing from `GameVariableComponent`

**Problem:** `game-variable-component.tsx` checks `id === "score"` for special CSS dimensions (107×80px). This is an Antarctica-specific visual rule in a generic component.

**Proposal:** Add a `layout` prop to `GameUiGameVariableComponentProps` in the manifest schema:

```typescript
interface GameUiGameVariableComponentProps {
  caption: string;
  description?: string;
  backgroundImage?: string;
  value: string;
  layout?: "default" | "prominent"; // "prominent" = larger display
}
```

Then check `component.props.layout === "prominent"` instead of `id === "score"`.

**Impact:** Low — one component file change + minor manifest schema addition.

### P6: i18n String Extraction

**Problem:** Russian strings are hardcoded in 9+ locations across component files.

**Proposal:** Create a locale dictionary pattern:

```typescript
// locales/ru.ts
export const locale = {
  loading: "Загрузка...",
  selectCard: "Выбрать",
  journal: "журнал ходов",
  hint: "подсказка",
  back: "Назад",
  forward: "Вперед",
  continue: "Продолжить",
  information: "Информация",
  teamSelection: "Выбор команды",
  confirm: "Подтвердить",
} as const;
```

Pass locale via React context from `GamePlayer`. Manifest-defined screens already carry their own text (via `richTextComponent`, `buttonComponent.caption`, etc.), so the locale layer only affects `SafeModeRenderer` fallback text.

**Impact:** Medium — requires creating the locale file, context provider, and updating all string references. But enables localization and makes all user-facing strings discoverable in one place.

### P7: Game Scaffold Template

**Problem:** Adding a new game requires creating 4+ files with correct structure, imports, and registration. AI agents and developers must follow the Antarctica pattern exactly.

**Proposal:** Create a `scripts/scaffold-game.sh` (or TypeScript) that:

1. Reads `game.manifest.json` for gameId and metric definitions
2. Generates `plugins/<gameId>/contracts.ts` with GameState interfaces
3. Generates `plugins/<gameId>/state-resolvers.ts` with stub resolvers
4. Generates `plugins/<gameId>/register.ts` with ResolverFactory
5. Generates `presenter/<gameId>-config-data.ts` from manifest data
6. Generates `games/<gameId>/plugins/<pluginId>/plugin.json`
7. Optionally generates a stub `ui.manifest.json` with a single S1 screen
8. The publish builder later generates `games/<gameId>/published/player-web-plugin-bundles.json`

This dramatically reduces the mechanical work and ensures consistent structure.

**Impact:** Medium to create, but high value for AI agents — they can scaffold a game in seconds and focus on game logic.

---

## 8. Implementation Priority

| Priority | Proposal | Effort | Impact | Dependencies |
|----------|----------|--------|--------|-------------|
| **P0** | P4: Constantize action types | Low | Low | None |
| **P0** | P1: Make `resolveBoardScreenKey` optional | Low | Medium | None |
| **P1** | P5: Remove `"score"` special-casing | Low | Medium | Manifest schema update |
| **P1** | P2: Data-driven screen routing | Medium | High | P1 (make routing methods optional) |
| **P2** | P3: Extract config from manifest | Medium | High | Server-side manifest pipeline |
| **P2** | P6: i18n string extraction | Medium | Medium | None |
| **P3** | P7: Game scaffold template | Medium | High | P3 (config from manifest) |

**Recommended sequence:**
1. P4 + P1 first (mechanical, no behavior change, low risk)
2. P5 (small manifest schema extension)
3. P2 (makes P1 meaningful — games can use data-driven routing)
4. P6 (enables localization)
5. P3 + P7 (structural changes, highest impact but most work)

---

## Appendix A: File Inventory

### Platform Layer (Generic)

| File | Lines | Role |
|------|-------|------|
| `presenter/game-presenter.ts` | ~230 | Orchestrator: boot, dispatch, patch, syncView |
| `presenter/game-config.ts` | 162 | Plugin contract: GameConfigData + GameConfigResolvers |
| `presenter/game-config-registry.ts` | ~45 | Global registry: Map<gameId, ResolverFactory> |
| `presenter/react-view-gateway.ts` | 23 | Pub-sub view gateway |
| `presenter/runtime-client.ts` | ~60 | REST client for sessions and actions |
| `presenter/types.ts` | ~50 | ClientRequest, PlayerState |
| `components/game-player.tsx` | ~230 | Top-level client component |
| `components/manifest/manifest-renderer.tsx` | ~45 | Manifest-driven screen renderer |
| `components/manifest/ui-component-node.tsx` | ~180 | Recursive component tree renderer |
| `components/manifest/card-component.tsx` | ~140 | Card component with expressions |
| `components/manifest/button-component.tsx` | ~55 | Button component with expressions |
| `components/manifest/game-variable-component.tsx` | ~100 | Metric display component (**leak**: "score" check) |
| `components/safe-mode-renderer.tsx` | ~570 | Convention-based fallback renderer (**leaks**: Russian strings, convention state) |
| `lib/expression-resolver.ts` | ~150 | Generic `{{path}}` expression resolver |
| `lib/manifest-action-adapter.ts` | ~65 | Action dispatch adapter (**leak**: "showScreenWithLeftSideBar") |
| `lib/screen-router.ts` | 135 | Data-driven screen router (**leak**: "S1_LEFT") |
| `lib/game-content-resolvers.ts` | ~230 | Generic state readers |
| `lib/metric-resolvers.ts` | ~45 | Metric binding resolution |
| `packages/contracts/manifest/src/index.ts` | 654 | Contract types |

### Game Plugin (Antarctica)

| File | Lines | Role |
|------|-------|------|
| `games/antarctica/plugins/antarctica-player/src/contracts.ts` | ~80 | GameState and content interfaces |
| `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts` | ~200 | State resolution functions |
| `games/antarctica/plugins/antarctica-player/src/register.ts` | ~190 | ResolverFactory |
| `games/antarctica/plugins/antarctica-player/src/config-data.ts` | ~50 | Serializable player config data |

### Manifest Data

| File | Role |
|------|------|
| `games/antarctica/game.manifest.json` | Game content, state, actions (144 actions) |
| `games/antarctica/ui/web/ui.manifest.json` | 11 screen definitions |
| `games/antarctica/ui/telegram/ui.manifest.json` | Telegram variant |

---

## Appendix B: New Game Checklist (Current State)

To add a new game called "arctic", an AI agent or developer must:

- [ ] Create `games/arctic/game.manifest.json` with meta, config, content, state, actions
- [ ] Create `games/arctic/ui/web/ui.manifest.json` with screen definitions
- [ ] Create `games/arctic/plugins/arctic-player/plugin.json`
- [ ] Create `games/arctic/plugins/arctic-player/src/contracts.ts` with `ArcticGameState` and content interfaces
- [ ] Create `games/arctic/plugins/arctic-player/src/state-resolvers.ts` with resolver functions
- [ ] Create `games/arctic/plugins/arctic-player/src/register.ts` with `activate(api)` registration
- [ ] Create `games/arctic/plugins/arctic-player/src/config-data.ts` with metrics, images, screen keys
- [ ] Run the published bundle builder when the game is ready for non-preview player mode
- [ ] Implement `resolveBoardScreenKey` (even if the game has no boards — must return null)
- [ ] Implement `resolveScreenKey` with game-specific routing
- [ ] Implement `resolveLayoutMode` with game-specific layout decisions
- [ ] Implement `resolveGameState` to produce convention state keys expected by SafeModeRenderer
- [ ] Implement `createManifestActionAdapter` with game-specific action resolution
- [ ] Optionally implement `resolveMetrics` for metric derivation
- [ ] Optionally implement `fallbackScreenBuilder` for custom fallback screens

**Total: 7 new files, 2 modified files, 6+ method implementations**

With P3 (config from manifest) and P7 (scaffold template), this reduces to:
- [ ] Create game manifest JSON
- [ ] Create UI manifest JSON
- [ ] Run scaffold script → generates 4 files with stubs
- [ ] Implement game-specific logic in resolver stubs

**Reduced: 2 new JSON files, scaffold generates 4 TypeScript files, developer fills in game logic**

---

## Appendix C: Manifest Structure Summary

### game.manifest.json Top-Level Structure

```json
{
  "meta": {
    "id": "antarctica",
    "version": "1.0.0",
    "name": "...",
    "description": "...",
    "schemaVersion": "1.1",
    "minEngineVersion": "0.1.0",
    "tags": ["training", "text-quest", "management", "singleplayer"],
    "training": { "format": "single", "duration": { "minMinutes": 45, "maxMinutes": 90 }, "competencies": [...] },
    "references": [...]
  },
  "config": {
    "players": { "min": 1, "max": 1 },
    "settings": { "mode": "singleplayer", "locale": "ru-RU" }
  },
  "content": {
    "antarctica": {
      "boards": [...],      // 13 boards
      "cards": [...],       // 71 cards
      "infos": [...],       // 26 infos
      "teamSelections": [...] // 1 team selection scene
    }
  },
  "engine": {
    "systemPrompt": "...",
    "modelConfig": { "temperature": 0.2, "maxTokens": 512 }
  },
  "state": {
    "public": { "flags": {...}, "log": [...], "metrics": {...}, "teamSelection": {...}, "timeline": {...}, "ui": {...} },
    "secret": { "opening": { "selectedCardId": null } }
  },
  "actions": [...] // 144 actions with deterministic metadata
}
```

### ui.manifest.json Top-Level Structure

```json
{
  "meta": { "id": "...", "version": "..." },
  "entry_point": "S1",
  "screens": {
    "S1": { "type": "screen", "title": "...", "layoutMode": "leftsidebar", "root": {...} },
    "S1_LEFT": { ... },
    "55..60": { ... },
    "61..66": { ... },
    "67..70": { ... },
    "i17": { ... },
    "i18": { ... },
    "i19": { ... },
    "i19_1": { ... },
    "i20": { ... },
    "i21": { ... }
  },
  "design_artifacts": {
    "registry": {
      "left-sidebar-6-cards": { ... },
      "leftsidebar-infocard": { ... },
      "moves-journal": { ... },
      "top-sidebar-6-cards": { ... },
      "topsidebar-infocard": { ... }
    }
  },
  "layouts": { "layout.web.s1": { ... } }
}
```

### UI Component Types (7)

| Type | Props | Purpose |
|------|-------|---------|
| `screenComponent` | cssClass?, backgroundImage?, visualMode? | Root of every screen |
| `areaComponent` | cssClass?, visualMode?, designImageRef? | Layout container |
| `gameVariableComponent` | caption, description?, backgroundImage?, value | Metric display with expression binding |
| `cardComponent` | text?, title?, summary?, chips?, selectLabel?, visualState? | Interactive card with selection |
| `buttonComponent` | caption, variant?, disabled? | Action button (action/helper/nav) |
| `richTextComponent` | html, cssClass? | HTML/text rendering |
| `imageComponent` | src, alt?, cssClass? | Illustration/decoration |

### Expression Binding Syntax

- `{{game.state.public.metrics.score}}` — state path binding
- `{{card.title}}` — localContext binding (in itemTemplate)
- `{{state.public.metrics.score || 0}}` — fallback value
- `{{boardCards}}` — collection binding (for itemTemplate)
- Convenience aliases: `metrics.*` → `state.public.metrics.*`

### Screen Routing Priority (Current)

1. Plugin's `resolveScreenKey` (game-specific logic in GameConfig)
2. Manifest `screenRouting` entries (data-driven, `screen-router.ts`)
3. Direct `screenId` lookup in `uiContent.screens`
4. `activeInfoId` disambiguation
5. `runtimeUi.activeScreen` override

Currently, the plugin's `resolveScreenKey` always wins because `GamePresenter` calls it directly. The `screen-router.ts` module is available for future games that opt into data-driven routing.

### Action Dispatch Priority

1. Dynamic: `resolveActionId(command, payload)` — plugin-provided function
2. Static: `commandMap` — plugin-provided mapping
3. Default: `"showHistory"`, `"showHint"`, `"showScreenWithLeftSideBar"`, `"requestServer"`
4. Error: `onError("Unknown manifest command: ...")`
