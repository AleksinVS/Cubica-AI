# GSR-027: Antarctica Step 30 Acceleration Board

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `apps/player-web`

This record captures the bounded delivery details for the main-line board at `stepIndex = 30`.

## Boundary

After `opening.info.i16.advance`, Antarctica reaches board `55..60` on main line `stepIndex = 30`.
This slice ends after the explicit follow-up through `i17` reaches the next boundary at `stepIndex = 32`.

## Slice Requirements

1. Board `55..60` stays explicit in the manifest.
   - Actions `opening.card.55` through `opening.card.60` are all hand-authored.
   - Go-card continuation stays explicit through follow-up actions to `i17`.
2. Card-local metric hooks stay bounded and deterministic.
   - Cards `55`, `58`, `59`, and `60` use multiple existing metric-gated conditional bonuses.
   - Card `57` uses a single `rep < 25` conditional bonus.
   - Card `56` does not introduce new conditional mechanics.
3. Progression remains explicit.
   - Go-cards `55`, `57`, `58`, and `60` use explicit `opening.card.<id>.advance` actions.
   - `opening.info.i17.advance` is a separate explicit action to the next boundary.

## Out Of Scope

- the next board `61..66`;
- any new workflow, rule, or selector abstraction;
- hidden auto-advance from a resolved card to `i17` or from `i17` to `stepIndex = 32`.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
