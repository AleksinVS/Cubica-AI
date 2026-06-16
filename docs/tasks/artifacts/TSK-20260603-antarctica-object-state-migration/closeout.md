# Antarctica Object State Migration Closeout

## Оглавление

- [Status](#status)
- [Purpose](#purpose)
- [Execution Boundary](#execution-boundary)
- [Current Gap Inventory](#current-gap-inventory)
- [Work Packages](#work-packages)
- [Legacy Rules](#legacy-rules)
- [Acceptance Checklist](#acceptance-checklist)
- [Validation Evidence](#validation-evidence)
- [Handoff Notes](#handoff-notes)

## Status

**Code closeout implemented.** Targeted validation passes for the current
runtime/player migration path. The deprecated `readCardFlags` compatibility
export has been retired.

## Purpose

This document turns the remaining `Antarctica` Object State Model work into a
bounded execution checklist. It does not create a new architecture decision:
ADR-041 remains the source of truth for object state, and ADR-025 remains the
source of truth for JSON Schema validation. The former ADR-042 compatibility
exception for `readCardFlags` is now closed.

## Execution Boundary

The mechanic classification is unchanged:

- object state is a general platform capability for cards, resources,
  characters, cells and other game objects;
- `Antarctica` card content, texts, metrics and branching are game-specific
  data and must stay in the game bundle or authoring manifest;
- runtime-api, contracts and generic player-web must not add
  `gameId === "antarctica"` branches.

The executor must preserve current `Antarctica` behavior while changing the
state shape from card flags to object facets.

## Current Gap Inventory

Use this inventory as the first pass. Refresh it before editing because line
numbers and hits may change.

- [x] Remaining `flag.set` effects in
  `games/antarctica/authoring/game.authoring.json` are classified: the only
  current hits write `/public/flags/team/*`, not card state, so they are outside
  this card object-state migration.
- [x] Generated `games/antarctica/game.manifest.json` was regenerated from
  authoring and contains no card-state `flag.set` effects.
- [x] `services/runtime-api/src/modules/runtime/deterministicHandlers.ts` no
  longer exposes current `guard.card` behavior for canonical manifests.
- [x] `docs/architecture/schemas/game-manifest.schema.json` no longer exposes
  `guard.card` in the current manifest schema and rejects `guard.card`.
- [x] `packages/contracts/manifest/src/index.ts` matches the current manifest
  schema and does not advertise `guard.card` as a current capability.
- [x] Current `Antarctica` plugin code uses `objects.cards` through
  `readCardObjects`, not `readCardFlags`.
- [x] `apps/player-web/src/plugins/player-plugin-api.ts` no longer exposes
  `readCardFlags`; current plugins use `readCardObjects`.
- [x] `apps/player-web/README.md` describes object-state/player-facing
  projection instead of `flags.cards`.

## Work Packages

### 1. Refresh The Search Inventory

Run:

```text
rg -n 'flags\.cards|readCardFlags|state\.public\.flags|guard\.card|"op": "flag\.set"|object\.state|guard\.object' games/antarctica services/runtime-api packages/contracts apps/player-web docs/architecture/schemas docs/tasks docs/legacy
```

Classify every hit as current behavior, historical documentation or bounded
legacy. Current behavior must be migrated. Historical documentation must say
that `flags.cards` is old state. Bounded legacy must have a row in
`docs/legacy/debt-log.csv`.

### 2. Finish Authoring And Generated Manifest Migration

Convert remaining card-state mutations in
`games/antarctica/authoring/game.authoring.json`:

- selected/resolved state maps to `selection` and `resolution`;
- locked/available state maps to `availability`;
- card face state maps to `face`;
- runtime-only card data maps to `attributes` only when it is not static
  content.

Then run the authoring compiler and review generated output.

### 3. Remove Current Runtime `guard.card`

Replace current `guard.card` usage with `guard.object` and remove the current
runtime handler/schema/contract surface. If an old published manifest still
needs `guard.card`, do not keep it in the current manifest path silently:
create a documented legacy schema/version path and a removal rule.

### 4. Remove Plugin API Compatibility

`readCardFlags` was a temporary compatibility export for old editor sessions.
It is now removed from the public player plugin API. Current `Antarctica`
plugin and production player behavior use `readCardObjects`, and current
plugin bundles declare `apiVersion: "2.0"`.

### 5. Update Documentation And Tests

Update README and test names so they describe object state as the current
model. Any test fixture that still contains `flags.cards` must be clearly
named as legacy compatibility or converted.

## Legacy Rules

No temporary card-flag compatibility remains active. `LEGACY-0015` is archived
as removed.

Not allowed as unregistered behavior:

- `runtime-api` reading `state.public.flags.cards` for current manifests;
- current manifest schema advertising `guard.card`;
- current `Antarctica` actions mutating card state through `flag.set`;
- TypeScript-only validation that bypasses JSON Schema for current manifest
  structure.

## Acceptance Checklist

- [x] `Antarctica` authoring card state uses `objectTypes` and object facets.
- [x] Generated runtime card state lives in `state.public.objects.cards`.
- [x] Card guards use `guard.object`.
- [x] Card effects use `object.state.set` or `object.attribute.patch`.
- [x] Runtime/player current behavior has no path that reads
  `state.public.flags.cards`.
- [x] `guard.card` is removed from current runtime/schema/contracts and current
  schema validation rejects it.
- [x] `readCardFlags` is removed from current `player-web` plugin API.
- [x] Documentation and test names no longer present `flags.cards` as current
  behavior.
- [x] Targeted validation passes; `npm run verify:canonical` was not run in this
  code slice.

## Validation Evidence

```text
npm run compile:manifests -- --game antarctica
PASS - compiled games/antarctica/authoring/game.authoring.json to games/antarctica/game.manifest.json; no generated diff remained.

node scripts/ci/validate-manifest-authoring.js
PASS - validate-manifest-authoring: OK.

npm test --workspace services/runtime-api
PASS - 115 tests passed.

npm test --workspace @cubica/player-web
PASS - 9 files passed, 122 tests passed.

git diff --check
PASS - no whitespace errors.
```

Search evidence:

```text
rg -n 'flags\.cards|readCardFlags|state\.public\.flags|guard\.card|"op": "flag\.set"|object\.state|guard\.object' games/antarctica services/runtime-api packages/contracts apps/player-web docs/architecture/schemas docs/tasks docs/legacy
```

PASS - no current runtime/player production behavior reads
`state.public.flags.cards`; no current runtime/schema/contract surface executes
or advertises `guard.card`; remaining hits are accepted below.

Final accepted remaining hits:

| Hit | Classification | Owner | Removal rule |
| --- | --- | --- | --- |
| `games/antarctica/**` `flag.set` effects for `/public/flags/team/*` | Current non-card team-selection state, outside the card object-state migration | Game Content / Runtime | Migrate only if a future team object-state model is accepted. |
| `services/runtime-api/tests/**` `public.flags.team` assertions | Current non-card team-selection runtime coverage | Runtime API | Migrate only with a future team object-state model. |
| `services/runtime-api/tests/manifest-validation.test.ts` `guard.card` fixture | Negative schema test proving current manifests reject `guard.card` | Runtime API | Keep while the current manifest schema must reject `guard.card`. |
| Archived task artifacts under `docs/tasks/archive` and older preview-timeline artifacts | Historical documentation | Documentation | Leave clearly historical; do not treat as runtime/player behavior. |

Latest `readCardFlags` retirement validation on 2026-06-13:

```text
npm run typecheck --workspace @cubica/player-web
PASS - TypeScript compile completed.

npm test --workspace @cubica/player-web
PASS - 9 test files passed, 121 tests passed.

npm test --workspace services/runtime-api
PASS - 115 tests passed.

npm run build --workspace @cubica/player-web
PASS - Next.js production build completed.

npm run build:player-web-plugin-bundles
PASS - build-player-web-plugin-bundles: OK (antarctica/antarctica-player).

npm run build:player-web-plugin-bundles -- --check
PASS - build-player-web-plugin-bundles: OK (antarctica/antarctica-player).

npm run verify:api-contracts
PASS - validate-runtime-api-openapi: OK.

git diff --check
PASS - no whitespace errors.

rg -n 'readCardFlags|flags\.cards' apps/player-web games/antarctica services/runtime-api packages/contracts
PASS - no matches.
```

`node scripts/ci/validate-legacy.js` still fails on unrelated pre-existing
`mock/not implemented` marker findings in AI/runtime/editor files. The
`LEGACY-0015` debt/register status reaches marker scanning, so the removed
legacy row is structurally consistent.

## Handoff Notes

- 2026-06-13: Created from architecture review findings. No implementation
  changes were made in this artifact; it is the execution checklist for the
  next code slice.
- 2026-06-13: Code closeout removed current `guard.card` runtime/schema/contract
  support, initially kept `readCardFlags` only as `LEGACY-0015`, verified
  current Antarctica card actions use object state, and classified remaining
  `/public/flags/team/*` hits as non-card team-selection state.
- 2026-06-13: Retired `readCardFlags` from current `player-web` plugin API and
  moved `LEGACY-0015` to removed status.
