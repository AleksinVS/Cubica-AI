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

**Completed.** All card flags migrated to `objects.cards` with facets. Runtime API updated to support object-state-based guards and collection thresholds. Tests passing.

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
| `{ available: false }` | `availability: hidden` | Decide per current UI semantics during inventory. |

## Action Inventory

| Action/template | Current guard/effect | Target guard/effect | Notes |
| --- | --- | --- | --- |
| `opening-card-resolution` template | `guard.card: { selected: false, resolved: false }`, `flag.set: { selected: true, resolved: true }` | `guard.object: { facets: { selection: "idle", resolution: "idle" } }`, `object.state.set` | Need two `object.state.set` effects (one for `selection`, one for `resolution`) since it updates one facet at a time. |
| Actions 0-100+ (auto-generated logic) | `guard.card: { id: ..., selected: false, resolved: false }` | `guard.object: { collection: "cards", objectId: "{{cardId}}", facets: { selection: "idle", resolution: "idle" } }` | Convert all boolean card flag checks into facet state checks. |
| Actions 36, 37, 40+ (overrides) | `flag.set` to `/public/flags/cards/<id>` with `{ locked: false, available: true }` | `object.state.set` with `facet: "availability"`, `value: "available"` | Replace direct JSON pointer flag mutation with formal object state effects. |

## Plugin Inventory

| File | Current dependency | Target dependency | Notes |
| --- | --- | --- | --- |
| `state-resolvers.ts` (Antarctica) | `readCardFlags` (generic & local) | `objects.cards` / `objectViews.cards` | Either rewrite to consume object model directly or eliminate if generic Presenter handles projection. |
| `register.ts` (Antarctica) | `readCardFlags` | `objectViews.cards` | Migrate custom presentation mapping to generic Presenter projection. |
| `apps/player-web/src/lib/game-content-resolvers.ts` | `readCardFlags` | remove or deprecate | If Antarctica is the sole user of `flags.cards`, remove this generic fallback helper entirely to enforce ADR-041. |

## Validation Notes

After migration, `flags.cards` must not remain in runtime/player behavior. Historical docs may still mention it as legacy if clearly labeled.
