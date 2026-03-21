# GSR-028: Antarctica Step 32 Scout Dispatch Board

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `packages/contracts/manifest`, `services/runtime-api`, `apps/player-web`

This record captures the bounded delivery details for the main-line board at `stepIndex = 32`.

## Boundary

After `opening.info.i17.advance`, Antarctica reaches board `61..66` on main line `stepIndex = 32`.
This slice ends after the explicit follow-up through `i18` reaches the next boundary at `stepIndex = 34`.

## Slice Requirements

1. Board `61..66` stays explicit in the manifest.
   - Actions `opening.card.61` through `opening.card.66` are all hand-authored.
   - Go-card continuation stays explicit through follow-up actions to `i18`.
2. Board-local unlock and card-history bonuses stay bounded.
   - `66` starts locked.
   - `62` and `63` unlock `66` through explicit board-local state updates.
   - `61` and `66` may apply extra time penalties depending on previously resolved cards.
3. Progression remains explicit.
   - Go-cards `61` and `66` use explicit `opening.card.<id>.advance` actions.
   - `opening.info.i18.advance` is a separate explicit action to the next boundary.

## Out Of Scope

- the next board `67..68`;
- any generic event-log query language or workflow DSL;
- hidden auto-advance from a resolved card to `i18` or from `i18` to `stepIndex = 34`.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
