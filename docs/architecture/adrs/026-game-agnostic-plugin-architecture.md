# ADR-026: Game-Agnostic Plugin Architecture

**Status:** Accepted
**Date:** 2026-05-07
**Context:** Game Platform "Cubica"

## Context and Problem Statement

The platform had 10 identified problems rooted in a single cause: Antarctica-specific concerns leaked into platform code. Key symptoms:

1. `FallbackRenderer` imported Antarctica types and rendered game-specific screens
2. Two divergent rendering paths (ManifestRenderer + FallbackRenderer)
3. `AntarcticaGameState` defined in platform files instead of the plugin
4. Manifest action adapter only handled 4 commands
5. Data binding limited to `{{game.state.public.metrics.*}}`
6. Hard-coded step→screen mapping in plugin code
7. Layout resolution via heuristics instead of manifest data
8. Design mockups not linked to rendering
9. Three SDK packages had zero live consumers
10. Content resolvers imported Antarctica types into platform layer

## Decision

We adopt a **Game-Agnostic Plugin Architecture** built on the existing game config registry pattern with the following enhancements:

### 1. Type System Cleanup (Problems 3, 10)

- `GameState = Record<string, unknown>` added to contracts as the generic platform state type
- `AntarcticaGameState` moved to `plugins/antarctica/contracts.ts`
- `GameConfig`, `GameConfigResolvers`, `ResolverFactory` default to `GameState` — no game-specific generics in platform code
- `PlayerState` is no longer generic — `Record<string, unknown> & { sessionId, metrics, screenKey, ... }`
- `GamePresenter` is no longer generic
- `game-content-resolvers.ts` split: generic utilities remain, Antarctica-specific moved to `plugins/antarctica/state-resolvers.ts`

### 2. Unified Rendering via SafeModeRenderer (Problems 1, 2)

- `SafeModeRenderer` replaces `FallbackRenderer` as the catch-all renderer
- Uses convention-based screen synthesis from generic `GameState` (currentBoard, currentInfo, currentTeamSelection)
- Game plugins can provide a `fallbackScreenBuilder` for custom rendering
- `FallbackRenderer` marked `@deprecated`, retained for backward compatibility
- Single rendering path: ManifestRenderer (primary) → SafeModeRenderer (fallback) → loading/error

### 3. Extensible Action Adapter (Problem 4)

- `createManifestActionAdapter` now accepts `commandMap` and `resolveActionId` callbacks
- `commandMap`: static mapping of manifest commands to action IDs
- `resolveActionId`: dynamic resolution (e.g., card selection by cardId)
- Default 4 commands preserved for backward compatibility
- Plugin provides game-specific resolution via `resolveActionId`

### 4. Context-Based Expression Resolver (Problem 5)

- New `expression-resolver.ts` with `resolveExpression()` and `resolveExpressions()`
- Supports: path binding (`{{game.state.public.metrics.score}}`), context binding (`{{card.title}}`), fallback values (`{{value || 0}}`)
- `GameUiItemTemplate` added to `GameUiComponent` for collection iteration with local context
- `metric-resolvers.ts` updated to delegate to `resolveExpression`

### 5. Manifest-Driven Screen Routing (Problem 6)

- `ScreenRoutingEntry` type added to contracts
- New `screen-router.ts` with `resolveScreenKey()` and `resolveLayoutModeFromRouting()`
- Priority: manifest routing entries → direct screenId lookup → info disambiguation → layout override
- Plugin can still provide custom `resolveBoardScreenKey` but should migrate to manifest data

### 6. Manifest-Driven Layout (Problem 7)

- `layoutMode` field added to `GameUiScreenDefinition` (`"leftsidebar" | "topbar" | "auto"`)
- `ManifestRenderer` reads `layoutMode` from screen definition with prop fallback
- When `"auto"` or absent, falls back to prop-based resolution

### 7. Design Region Annotations (Problem 8)

- `DesignRegion` type added to contracts with `id`, `type`, `description`, `layout` hints, `style` overrides
- `designRegions` field added to `GameUiScreenDefinition`
- Renderer can use design regions for CSS class mapping and spacing

### 8. SDK Cleanup (Problem 9)

- `@cubica/sdk-shared`, `@cubica/react-sdk`, `@cubica/viewer-web-base` marked as `@deprecated` with NOTE.md files
- Only `@cubica/sdk-core` remains active (used for `ViewCommand` and `applyJsonMergePatch`)
- Dead packages retained for reference, removal after full ADR-026 implementation

## Consequences

### Positive

- New games can be added by creating a plugin directory with `contracts.ts`, `state-resolvers.ts`, and `register.ts` — zero changes to platform code
- `GamePlayer`, `GamePresenter`, and `SafeModeRenderer` are game-agnostic
- Data binding supports arbitrary state paths and local context
- Screen routing and layout can be manifest-driven instead of code-driven
- Manifest action adapter is extensible per game

### Negative

- Convention-based screen synthesis in SafeModeRenderer may not cover all game mechanics
- `fallbackScreenBuilder` in plugin config adds complexity to the registration interface
- `AntarcticaGameState` cast in `game-player.tsx` is temporary until all screens are manifest-driven

## Related ADRs

- ADR-001: MVP and LLM-first game manifests
- ADR-002: Abstract View Protocol
- ADR-003: Hybrid SDUI Schema
- ADR-013: Manifest text anchors and UI split
- ADR-014: Viewers library architecture
- ADR-018: Game logic source of truth is JSON manifest
- ADR-019: Runtime-api owns content loading