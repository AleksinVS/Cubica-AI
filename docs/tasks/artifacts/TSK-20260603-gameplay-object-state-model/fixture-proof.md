# TSK-20260603 Fixture Proof

## Table of Contents

- [Summary](#summary)
- [Fixture](#fixture)
- [Implemented Surface](#implemented-surface)
- [Validation](#validation)
- [Remaining Work](#remaining-work)

## Summary

`simple-choice` now proves the generic Gameplay Object State Model without a custom player plugin.

The proof covers authoring `objectTypes`, compiled runtime `objectModels`, object-state guards, object effects, dynamic resource creation and Presenter-built `objectViews`.

## Fixture

Updated files:

- `games/simple-choice/authoring/game.authoring.json`
- `games/simple-choice/game.manifest.json`
- `games/simple-choice/game.manifest.source-map.json`
- `games/simple-choice/authoring/ui/web.authoring.json`
- `games/simple-choice/ui/web/ui.manifest.json`
- `games/simple-choice/ui/web/ui.manifest.source-map.json`

The fixture defines:

- static object `public.objects.choices.accept` with object type `choice.card`;
- facets `face` and `availability`;
- dynamic collection `public.objects.resources`;
- runtime-created object `resources.supply-1` with object type `resource.supply`.

## Implemented Surface

Runtime effects:

- `object.create`
- `object.state.set`
- `object.attribute.patch`

Runtime guard:

- `guard.object` checks visibility, collection, object id, object type, facets and attributes.

Presenter:

- default game config projects `objectViews` from player-facing content, `objectModels` and `state.public.objects`;
- React components receive projected `summary`, `visualState`, `visible` and `interactive` props.

## Validation

Focused validation passed:

```text
node --test --experimental-strip-types services/runtime-api/tests/object-state.test.ts
npm test --workspace @cubica/player-web -- --run src/presenter/game-config.test.ts src/components/manifest-renderer.test.tsx
node scripts/ci/validate-manifest-authoring.js
npm run typecheck --workspace services/runtime-api
npm run typecheck --workspace @cubica/player-web
npm test --workspace services/runtime-api
npm test --workspace @cubica/player-web
```

## Remaining Work

`Antarctica` migration is intentionally not included in this implementation package.

The migration is tracked in `docs/tasks/active/TSK-20260603-antarctica-object-state-migration.md`.
