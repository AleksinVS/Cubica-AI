# TSK-20260603-antarctica-object-state-migration: Antarctica Object State Migration

## Оглавление

- [Status](#status)
- [Why](#why)
- [Architecture Source](#architecture-source)
- [Dependency](#dependency)
- [Current Closeout Findings](#current-closeout-findings)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Migration Rules](#migration-rules)
- [Closeout Work Packages](#closeout-work-packages)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

done

Previous closeout note: целевые проверки прошли, а общая каноническая проверка на момент первого закрытия еще ожидалась. Она подтверждена архивной записью 2026-07-10 ниже.

The generic Object State Model platform path is implemented and `Antarctica`
already uses `state.public.objects.cards` for a large part of card state.
The closeout removed current card-state runtime/player behavior paths that read
`flags.cards`; the former `readCardFlags` compatibility export was also retired.
Full task acceptance still requires a successful `npm run verify:canonical` or
a documented unrelated canonical failure.

## Why

`Antarctica` used to store card gameplay state in `state.public.flags.cards`.
That shape is a legacy card-specific model. It conflicts with ADR-041 because
object state should live in `state.public.objects` and use generic object
guards/effects.

This package owns only the `Antarctica` migration from card flags to gameplay object state. The generic platform implementation already lives in `TSK-20260603-gameplay-object-state-model`.

## Architecture Source

- `docs/architecture/adrs/041-gameplay-object-state-model.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
- `docs/architecture/runtime-mechanics-language.md`
- `docs/tasks/archive/TSK-20260603-gameplay-object-state-model.md`

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

## Current Closeout Findings

The 2026-06-13 architecture review found that the task status and closeout
evidence were ahead of the actual codebase state. The closeout now resolves or
classifies those findings:

1. `games/antarctica/authoring/game.authoring.json` and generated
   `games/antarctica/game.manifest.json` previously contained some `flag.set`
   effects. Current card-state mutations are migrated; remaining team-selection
   `flag.set` effects are classified as non-card state.
2. `services/runtime-api/src/modules/runtime/deterministicHandlers.ts`
   previously contained the generic `guard.card` behavior path that read
   `public.flags.cards`; it is now removed from current runtime behavior.
3. `docs/architecture/schemas/game-manifest.schema.json` and
   `packages/contracts/manifest/src/index.ts` previously exposed `guard.card`;
   current manifest validation rejects it.
4. `apps/player-web/src/lib/game-content-resolvers.ts` and
   `apps/player-web/src/plugins/player-plugin-api.ts` exposed
   `readCardFlags`. That compatibility export is now removed; current
   production player behavior and current `Antarctica` plugin code use
   `readCardObjects`.
5. `apps/player-web/README.md` previously described `flags.cards` as current
   board rendering behavior; current docs describe object-state facets.
6. `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/closeout.md`
   was referenced but missing; it is now the required closeout artifact.

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
- prove that no permanent runtime/player fallback reads `flags.cards`;
- remove `guard.card` from the current runtime manifest path, or move it behind
  a separately documented legacy schema/version path if an older published
  manifest still requires it;
- remove the deprecated `readCardFlags` plugin API export after verifying
  current player/plugin code uses `readCardObjects`.

## Non-Goals

- Do not add `gameId === "antarctica"` branches to `runtime-api`, contracts or generic `player-web`.
- Do not keep dual reads from `flags.cards` and `objects.cards` after the migration.
- Do not change `Antarctica` story content, metrics or branching semantics unless required to preserve behavior under the new state shape.
- Do not introduce per-player object state in this migration.
- Do not bypass JSON Schema with TypeScript-only validators.
- Do not remove public plugin API exports without verifying current published
  and preview plugin paths. Retired exports must be reflected in the legacy
  register and migration closeout.

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

## Closeout Work Packages

### Package 1. Inventory And Classification

1. Inventory every current `flags.cards` state shape in:
   - `games/antarctica/authoring/game.authoring.json`;
   - `games/antarctica/game.manifest.json`;
   - `games/antarctica/plugins/antarctica-player/src`;
   - runtime/player tests.
2. Map current booleans to object facets.
3. Re-run the review search from the Validation section.
4. Classify every hit as:
   - current behavior that must be migrated;
   - historical documentation that must be clearly labeled;
   - bounded legacy with a debt-log row and removal rule.
5. Record action-by-action conversion rules in
   `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/migration-map.md`.

### Package 2. Authoring Manifest Conversion

1. Add `objectTypes.antarctica.card`.
2. Replace initial `state.public.flags.cards` with `state.public.objects.cards`.
3. Convert action guards to `guard.object`.
4. Convert card mutation effects to object effects.
5. Run authoring compiler and verify generated source maps.
6. Convert remaining card-related `flag.set` effects to `object.state.set` or
   `object.attribute.patch`. If a `flag.set` hit is not card state, document
   why it remains outside this migration.

### Package 3. Runtime Contract Cleanup

1. Remove current-manifest `guard.card` from runtime handlers, JSON Schema and
   manifest contracts, or isolate it behind a documented legacy schema/version
   path that current canonical manifests cannot use.
2. Ensure runtime tests cover the equivalent `guard.object` behavior.
3. Add or update a validation check that prevents new current manifests from
   using `guard.card`.
4. Keep runtime-api game-agnostic: no `gameId === "antarctica"` branch is
   allowed.

### Package 4. Player Plugin And Presenter Cleanup

1. Replace current plugin reads of `flags.cards` with `objects.cards` or
   `objectViews.cards`.
2. Remove card-specific projection where generic Presenter projection covers
   the same UI fields.
3. Keep plugin code only for truly `Antarctica`-specific presentation or flow
   behavior.
4. Remove deprecated `readCardFlags` compatibility after proving that current
   `Antarctica` and player-web paths use `readCardObjects`.

### Package 5. Documentation And Closeout

1. Update `apps/player-web/README.md` to describe object views/object state
   instead of `flags.cards`.
2. Update the migration map status after implementation.
3. Record closeout evidence in
   `docs/tasks/artifacts/TSK-20260603-antarctica-object-state-migration/closeout.md`.
4. Update this task handoff and `NEXT_STEPS.md`.

## Acceptance

- `Antarctica` authoring defines card object state through `objectTypes`.
- Generated `Antarctica` runtime state uses `state.public.objects.cards` for card state.
- `Antarctica` card guards use `guard.object`.
- `Antarctica` card mutation effects use `object.state.set` and, where needed, `object.attribute.patch`.
- Runtime/player code has no permanent behavior path reading `state.public.flags.cards`.
- Current runtime manifest schema and contracts do not expose `guard.card`
  for canonical manifests.
- No `readCardFlags` export remains in current `player-web` plugin API.
- Documentation no longer describes `flags.cards` as current player behavior.
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
rg -n 'flags\\.cards|readCardFlags|state\\.public\\.flags|guard\\.card|\"op\": \"flag\\.set\"|object\\.state|guard\\.object' games/antarctica services/runtime-api packages/contracts apps/player-web docs/architecture/schemas docs/tasks docs/legacy
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

### 2026-06-13 - Architecture review closeout reset

- Reopened the task because review found remaining `flags.cards`, `guard.card`,
  `flag.set` and `readCardFlags` paths that were not compatible with the
  previous `Completed` status.
- Converted the remaining work into explicit closeout packages.
- Registered the temporary compatibility path found during review:
  `readCardFlags` as ADR-042 same-major plugin API legacy under `LEGACY-0015`.

### 2026-06-13 - Code closeout implementation

- Removed current `guard.card` execution from `runtime-api`, removed the
  explicit `guard.card` contract surface from `packages/contracts/manifest`,
  and made the current JSON Schema reject `guard.card`.
- Reworked runtime tests so card template/effect coverage uses `guard.object`
  and `object.state.set` against `state.public.objects.cards`.
- Confirmed regenerated `Antarctica` manifests have no card-state `flag.set`;
  remaining `/public/flags/team/*` effects are classified as non-card
  team-selection state.
- Initially kept `readCardFlags` only as `LEGACY-0015` plugin API
  compatibility and updated player-web documentation to describe object state
  as current behavior.
- Verified `npm run compile:manifests -- --game antarctica`,
  `node scripts/ci/validate-manifest-authoring.js`,
  `npm test --workspace services/runtime-api`, and
  `npm test --workspace @cubica/player-web`.
- `npm run verify:canonical` was not run in this code slice.

### 2026-06-13 - readCardFlags retirement

- Removed the deprecated `readCardFlags` implementation and public plugin API
  export from `player-web`.
- Removed compatibility tests that kept `readCardFlags` available in API 1.x.
- Bumped current player-web plugin API usage to `apiVersion: "2.0"` so old
  bundles that depended on API 1.x are not treated as compatible.
- Moved `LEGACY-0015` from active debt to the removed archive after verifying
  current `Antarctica` plugin code uses `readCardObjects`.
- Verified `npm run typecheck --workspace @cubica/player-web`,
  `npm test --workspace @cubica/player-web`,
  `npm run build --workspace @cubica/player-web`,
  `npm test --workspace services/runtime-api`,
  `npm run build:player-web-plugin-bundles`,
  `npm run build:player-web-plugin-bundles -- --check`,
  `npm run verify:api-contracts`, and `git diff --check`.
- `node scripts/ci/validate-legacy.js` still fails on unrelated pre-existing
  `mock/not implemented` marker findings in AI/runtime/editor files; the
  `LEGACY-0015` register/debt transition itself reaches marker scanning.

### 2026-07-10 - Archive acceptance closeout

- Общая `npm run verify:canonical` прошла в рамках `TSK-20260710-pre-game-development-readiness` после исправления не связанного с этой миграцией smoke-сценария.
- Отложенный общий критерий приемки тем самым закрыт; задача корректно остается в архиве.
