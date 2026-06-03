# Antarctica Object State Migration Map

## Оглавление

- [Status](#status)
- [Purpose](#purpose)
- [Current State Sources](#current-state-sources)
- [Target Facets](#target-facets)
- [Conversion Matrix](#conversion-matrix)
- [Action Inventory](#action-inventory)
- [Plugin Inventory](#plugin-inventory)
- [Validation Notes](#validation-notes)

## Status

draft

## Purpose

This artifact will map existing `Antarctica` card flags to the ADR-041 gameplay object state model before implementation edits begin.

## Current State Sources

Inspect these sources during Phase 1:

- `games/antarctica/authoring/game.authoring.json`
- `games/antarctica/game.manifest.json`
- `games/antarctica/plugins/antarctica-player/src/contracts.ts`
- `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts`
- `games/antarctica/plugins/antarctica-player/src/register.ts`
- `services/runtime-api/tests/*.integration.ts`
- `apps/player-web/src/**/*.test.tsx`

## Target Facets

Initial target model:

| Facet | Values | Notes |
| --- | --- | --- |
| `face` | `front`, `back` | Card display side and internal reveal state. |
| `selection` | `idle`, `selected` | Replaces selected boolean. |
| `resolution` | `idle`, `resolved` | Replaces resolved boolean. |
| `availability` | `available`, `locked`, `hidden` | Replaces available/locked booleans and allows hidden state. |

## Conversion Matrix

| Current flag shape | Target object state | Notes |
| --- | --- | --- |
| `{ selected: false, resolved: false, locked: false, available: true }` | `selection: idle`, `resolution: idle`, `availability: available`, `face: front` | Default selectable card. |
| `{ selected: true }` | `selection: selected` | Keep `resolution` separate unless action also resolves. |
| `{ resolved: true }` | `resolution: resolved`, `face: back` | Confirm whether every resolved card must be shown on back side. |
| `{ locked: true }` | `availability: locked` | Preserve non-interactive visible card behavior. |
| `{ available: false }` | `availability: hidden` or `locked` | Decide per current UI semantics during inventory. |

## Action Inventory

Fill during Phase 1.

| Action/template | Current guard/effect | Target guard/effect | Notes |
| --- | --- | --- | --- |
| `opening-card-resolution` | `guard.card`, `flag.set` | `guard.object`, `object.state.set` | Template conversion candidate. |

## Plugin Inventory

Fill during Phase 1.

| File | Current dependency | Target dependency | Notes |
| --- | --- | --- | --- |
| `state-resolvers.ts` | card flags | `objects.cards` or `objectViews.cards` | Decide after inventory. |

## Validation Notes

After migration, `flags.cards` must not remain in runtime/player behavior. Historical docs may still mention it as legacy if clearly labeled.
