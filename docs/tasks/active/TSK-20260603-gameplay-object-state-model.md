# TSK-20260603-gameplay-object-state-model: Gameplay Object State Model

## Оглавление

- [Status](#status)
- [Why](#why)
- [Terms](#terms)
- [Architecture Source](#architecture-source)
- [Decisions Already Made](#decisions-already-made)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

planned

## Why

Cubica needs a platform-level model for **gameplay object state**: authoritative game state of objects inside a session, not frontend-local state.

Current `Antarctica` mechanics already use `state.public.flags.cards` for card flags, but that shape is card-specific and does not support a general authoring/editor model, dynamic resources or manifest-only games.

This task implements ADR-041 so games can define and mutate state for cards, resources, characters, board cells and other objects through JSON Schema-validated manifests.

## Terms

- Gameplay object state - authoritative state of a game object inside session state.
- Facet - independent state axis of an object, for example `face`, `availability`, `resolution` or `location`.
- Dynamic object - object created during a session rather than listed upfront in `content.data`.
- Presenter projection - derived player-facing model built by Presenter for View. It turns content plus object state into fields such as `summary`, `visible`, `interactive` and `visualState`.
- Fixture game - small test game used to prove the generic path before migrating a large real game.
- Per-player state - state visible or applicable to one player only. It is not implemented in this task, but the schema must not block adding it later.

## Architecture Source

This task executes the accepted architecture in:

- `docs/architecture/adrs/041-gameplay-object-state-model.md`
- `docs/architecture/runtime-mechanics-language.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`

If implementation needs a new architectural decision beyond ADR-041, update or add an ADR before changing runtime behavior.

## Decisions Already Made

- Object state is multidimensional and uses facets.
- Authors edit object state definitions in authoring manifests.
- Runtime manifests receive compiled `objectModels`.
- UI projection is built in Presenter, not in React components.
- The model targets all gameplay objects, not only cards.
- Dynamic resources can be created during a session.
- Per-player state is not needed soon, but `scope` must leave a simple extension path.
- State is separate from logic; guards/effects/templates define logic that reads or changes state.
- First implementation proof uses a fixture game.
- `Antarctica` migration replaces `flags.cards`; no permanent legacy fallback is accepted.

## Scope

In scope:

- add authoring schema support for `objectTypes`;
- add runtime manifest schema support for compiled `objectModels`;
- add manifest contracts for object models, object state guards and object effects;
- extend authoring compiler to emit runtime object models;
- add runtime-api support for:
  - `object.create`;
  - `object.state.set`;
  - `object.attribute.patch`;
  - object-state guards;
- add Presenter-level object view projection for `player-web`;
- add a small fixture game that uses object state without a custom plugin;
- migrate `Antarctica` from `state.public.flags.cards` to `state.public.objects.cards`;
- update tests and documentation.

Out of scope unless a separate ADR/task is created:

- marketplace runtime plugins;
- arbitrary user scripts;
- full per-player object state execution;
- generic workflow engine;
- persistence hardening beyond existing session storage behavior.

## Non-Goals

- Do not keep `flags.cards` as a permanent compatibility path after `Antarctica` migration.
- Do not add game-specific `if (gameId === "antarctica")` branches to `runtime-api`, contracts or generic `player-web`.
- Do not make React components decide gameplay rules such as which card side is active.
- Do not bypass JSON Schema with TypeScript-only validators.

## Plan

### Phase 1. Schema And Contract Baseline

1. Update `docs/architecture/schemas/game-authoring.schema.json` with authoring `objectTypes`.
2. Update `docs/architecture/schemas/game-manifest.schema.json` with runtime `objectModels`, object-state guards and object effects.
3. Update `packages/contracts/manifest/src/index.ts` with matching TypeScript contracts.
4. Add schema tests proving dynamic object maps, facet values and unsupported `scope` behavior are validated.

### Phase 2. Authoring Compiler

1. Extend `scripts/manifest-tools/compile-authoring-manifests.cjs` to compile `objectTypes` into `objectModels`.
2. Preserve source maps from runtime `objectModels` back to authoring nodes.
3. Confirm generated runtime manifests do not leak authoring-only keys.

### Phase 3. Fixture Game Proof

1. Add or update a small fixture game with:
   - one static object with multiple facets;
   - one dynamic resource created by an action;
   - UI bound to Presenter-projected object views;
   - no custom `player-web` plugin.
2. Cover at least:
   - initial object state;
   - `object.state.set`;
   - `object.create`;
   - `object.attribute.patch` if included in the first fixture.

### Phase 4. Runtime-api Handlers

1. Implement object-state guard evaluation without game-specific branches.
2. Implement `object.create`.
3. Implement `object.state.set`.
4. Implement `object.attribute.patch`.
5. Ensure effects are atomic: failed validation leaves state unchanged.
6. Add neutral runtime tests with at least two object collections.

### Phase 5. Player-web Presenter Projection

1. Add generic object view projection in Presenter/player layer.
2. Keep React components rule-free: components receive projected props.
3. Support `itemTemplate` binding to projected object views.
4. Add tests for visible/interactive/visualState/text projection.

### Phase 6. Antarctica Migration

1. Convert `Antarctica` authoring manifests to object-state definitions.
2. Replace generated `state.public.flags.cards` with `state.public.objects.cards`.
3. Convert card guards/effects to object-state guards/effects.
4. Update Antarctica plugin or remove card flag assumptions where generic projection can cover them.
5. Remove permanent fallback reads from `flags.cards`.
6. Run runtime and player e2e coverage for existing Antarctica flows.

### Phase 7. Documentation And Governance

1. Update `docs/architecture/GAME_AUTHORING_GUIDE.md`.
2. Update `PROJECT_OVERVIEW.md` and `docs/architecture/PROJECT_ARCHITECTURE.md` if canonical behavior changes.
3. Update active task handoff and any migration artifacts.
4. Run structure generation only if significant directories or `.desc.json` files are added.

## Acceptance

- JSON Schema validates authoring `objectTypes` and runtime `objectModels`.
- Authoring compiler emits runtime object models with stable output and source maps.
- Fixture game runs without a custom plugin and proves static object state plus dynamic resource creation.
- Runtime supports object-state effects and guards with no game-specific branches.
- Presenter builds UI-ready object views; React components do not contain object-state gameplay rules.
- `Antarctica` no longer relies on `state.public.flags.cards` after migration.
- Per-player state is not implemented, but schema has an explicit `scope` path that can be extended later.
- `npm run verify:canonical` passes or any failure is documented with a concrete unrelated cause.

## Validation

Recommended validation commands:

```text
npm run verify:canonical
npm test --workspace services/runtime-api
npm test --workspace apps/player-web
node scripts/ci/validate-manifest-authoring.js
node scripts/ci/validate-legacy.js
rg -n 'flags\.cards|readCardFlags|state\.public\.flags|gameId === "antarctica"|object\.state|object\.create|object\.attribute' games services packages apps docs
```

The final `rg` command is a review aid. After full `Antarctica` migration, remaining `flags.cards` hits must be limited to historical docs or explicitly updated test names, not runtime/player behavior.

## Artifacts

Planned artifacts:

- `docs/tasks/artifacts/TSK-20260603-gameplay-object-state-model/fixture-proof.md`
- `docs/tasks/artifacts/TSK-20260603-gameplay-object-state-model/antarctica-migration-map.md`

## Handoff Log

### 2026-06-03 - Codex

- Created execution task from the accepted ADR-041 decisions.
- Bound implementation order to fixture-first proof and then full `Antarctica` migration.
- Next safe step: implement Phase 1 schema and contract baseline before writing runtime handlers.
