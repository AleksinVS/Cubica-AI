# TSK-20260603-antarctica-object-state-migration: Antarctica Object State Migration

## Оглавление

- [Status](#status)
- [Why](#why)
- [Architecture Source](#architecture-source)
- [Dependency](#dependency)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Migration Rules](#migration-rules)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

**Completed.** Antarctica card state fully migrated to object model. Targeted player-web review checks passing.

## Why

`Antarctica` still stores card gameplay state in `state.public.flags.cards`.
That shape is a legacy card-specific model. It conflicts with ADR-041 because object state should live in `state.public.objects` and use generic object guards/effects.

This package owns only the `Antarctica` migration from card flags to gameplay object state. The generic platform implementation already lives in `TSK-20260603-gameplay-object-state-model`.

## Architecture Source

- `docs/architecture/adrs/041-gameplay-object-state-model.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
- `docs/architecture/runtime-mechanics-language.md`
- `docs/tasks/active/TSK-20260603-gameplay-object-state-model.md`

If this migration reveals a new platform decision, update or add an ADR before changing runtime behavior.

## Dependency

Requires the generic Object State Model platform path:

- authoring `objectTypes`;
- runtime `objectModels`;
- `guard.object`;
- `object.create`;
- `object.state.set`;
- `object.attribute.patch`;
- Presenter-projected `objectViews`.

These are implemented by `TSK-20260603-gameplay-object-state-model`.

## Scope

In scope:

- add `Antarctica` object type definitions for cards in `games/antarctica/authoring/game.authoring.json`;
- replace generated `state.public.flags.cards` card state with `state.public.objects.cards`;
- convert card guards from `guard.card` to `guard.object`;
- convert card state effects from `flag.set` to `object.state.set` and, where needed, `object.attribute.patch`;
- update `Antarctica` player plugin assumptions that read `flags.cards`;
- use generic Presenter projection where it can replace card-specific projection;
- regenerate `games/antarctica/game.manifest.json` and source map through the authoring compiler;
- update tests for existing `Antarctica` flows;
- prove that no permanent runtime/player fallback reads `flags.cards`.

## Non-Goals

- Do not add `gameId === "antarctica"` branches to `runtime-api`, contracts or generic `player-web`.
- Do not keep dual reads from `flags.cards` and `objects.cards` after the migration.
- Do not change `Antarctica` story content, metrics or branching semantics unless required to preserve behavior under the new state shape.
- Do not introduce per-player object state in this migration.
- Do not bypass JSON Schema with TypeScript-only validators.

## Migration Rules

1. `state.public.objects.cards.<cardId>` is the new authoritative card state.
2. `objectType` for migrated cards should be stable, for example `antarctica.card`.
3. Facets must represent internal game state, not only display:
   - `face`: `front` or `back`;
   - `selection`: `idle`, `selected` or another explicit value if migration inventory proves it is needed;
   - `resolution`: `idle` or `resolved`;
   - `availability`: `available`, `locked` or `hidden`.
4. Mutable card-specific runtime data goes in `attributes`.
5. Existing content fields such as `title`, `summary`, `backText`, `selectActionId` stay in `content.data.cards` unless an action intentionally writes a runtime override.
6. All generated manifest changes must come from authoring changes and compiler output.
7. Any remaining `flags.cards` usage after migration must be historical documentation or explicitly tracked debt, not runtime/player behavior.

## Plan

### Phase 1. Inventory And Migration Map

1. Inventory every current `flags.cards` state shape in:
   - `games/antarctica/authoring/game.authoring.json`;
   - `games/antarctica/game.manifest.json`;
   - `games/antarctica/plugins/antarctica-player/src`;
   - runtime/player tests.
2. Map current booleans to object facets.
3. Record action-by-action conversion rules in `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/migration-map.md`.

### Phase 2. Authoring Manifest Conversion

1. Add `objectTypes.antarctica.card`.
2. Replace initial `state.public.flags.cards` with `state.public.objects.cards`.
3. Convert action guards to `guard.object`.
4. Convert card mutation effects to object effects.
5. Run authoring compiler and verify generated source maps.

### Phase 3. Player Plugin And Presenter Cleanup

1. Replace plugin reads of `flags.cards` with `objects.cards` or `objectViews.cards`.
2. Remove card-specific projection where generic Presenter projection covers the same UI fields.
3. Keep plugin code only for truly `Antarctica`-specific presentation or flow behavior.

### Phase 4. Runtime And Player Verification

1. Run existing runtime integration flows for `Antarctica`.
2. Add or update tests that assert object state after key card actions.
3. Add player tests or e2e coverage for visible/interactable/resolved card states.
4. Confirm no permanent fallback reads `flags.cards`.

### Phase 5. Closeout

1. Update this task handoff.
2. Update related docs if migration changes visible authoring guidance.
3. Record closeout evidence in `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/closeout.md`.

## Acceptance

- `Antarctica` authoring defines card object state through `objectTypes`.
- Generated `Antarctica` runtime state uses `state.public.objects.cards` for card state.
- `Antarctica` card guards use `guard.object`.
- `Antarctica` card mutation effects use `object.state.set` and, where needed, `object.attribute.patch`.
- Runtime/player code has no permanent behavior path reading `state.public.flags.cards`.
- Existing `Antarctica` runtime integration flows still pass.
- `npm run verify:canonical` passes.

## Validation

Recommended validation commands:

```text
npm run compile:manifests -- --game antarctica
node scripts/ci/validate-manifest-authoring.js
npm test --workspace services/runtime-api
npm test --workspace @cubica/player-web
npm run verify:canonical
rg -n 'flags\\.cards|readCardFlags|state\\.public\\.flags|guard\\.card|\"op\": \"flag\\.set\"|object\\.state|guard\\.object' games/antarctica services packages apps docs
```

The final `rg` command is a review aid. After migration, `flags.cards` hits must not remain in runtime/player behavior.

## Artifacts

- `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/migration-map.md`
- `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/closeout.md`

## Handoff Log

### 2026-06-03 - Codex

- Split `Antarctica` migration out of `TSK-20260603-gameplay-object-state-model`.
- Created this dedicated execution package for the migration from `flags.cards` to `objects.cards`.
- Next safe step: build the migration map before editing `games/antarctica/authoring/game.authoring.json`.

### 2026-06-03 - Codex follow-up

- Updated player-web Antarctica opening-tail fixtures to use `public.objects.cards` and kept locked/selected/resolved semantics aligned with the object model.
- Renamed the player-web test case to reflect hidden-card filtering under object state.
- Verified `npm test --workspace @cubica/player-web -- src/components/game-player.test.tsx` and `git diff --check`.
