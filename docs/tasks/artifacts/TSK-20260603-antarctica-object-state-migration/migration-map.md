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

**Code closeout verified.** Current `Antarctica` card state uses object facets.
The remaining `flag.set` hits are team-selection flags, not card state, and
the former `readCardFlags` plugin API compatibility export has been removed.

## Purpose

This artifact maps existing `Antarctica` card flags to the ADR-041 gameplay
object state model. It is still relevant during closeout because any remaining
card-state `flag.set` or `guard.card` hit must map to one of the target object
facets below or be explicitly classified as non-card behavior.

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
| Actions 36, 37, 40+ (overrides) | Historical `flag.set` to `/public/flags/cards/<id>` with `{ locked: false, available: true }` | `object.state.set` with `facet: "availability"`, `value: "available"` | Implemented in current authoring/generated manifests. |
| Team selection actions 128-137 | `flag.set` to `/public/flags/team/<memberId>` | Unchanged in this migration | Classified as non-card state. It belongs to a future team object-state migration only if that architecture is accepted. |

## Plugin Inventory

| File | Current dependency | Target dependency | Notes |
| --- | --- | --- | --- |
| `state-resolvers.ts` (Antarctica) | Historical `readCardFlags` dependency | `objects.cards` | Current code resolves board cards from card object facets. |
| `register.ts` (Antarctica) | Historical `readCardFlags` dependency | `readCardObjects(session)` | Current code passes `objects.cards` into Antarctica board resolution. |
| `apps/player-web/src/lib/game-content-resolvers.ts` | Historical `readCardFlags` helper | Removed from current plugin API | Current production player behavior and current Antarctica plugin use `readCardObjects`. |

## Validation Notes

After migration, `flags.cards` must not remain in runtime/player behavior.
Current closeout verification found no production runtime/player reads of
`state.public.flags.cards`. Historical docs may still mention it as retired
legacy if clearly labeled.
