# GSR-026: Antarctica Step 28 Trusted Messengers Board

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `apps/player-web`

This record captures the bounded delivery details for the main-line board at `stepIndex = 28`.

## Boundary

After `opening.info.i15.advance`, Antarctica reaches board `49..54` on main line `stepIndex = 28`.
This slice ends after the explicit follow-up through `i16` reaches the next boundary at `stepIndex = 30`.

## Slice Requirements

1. Board `49..54` stays explicit in the manifest.
   - Actions `opening.card.49` through `opening.card.54` are all hand-authored.
   - Every card on this board is a go-card with an explicit follow-up to `i16`.
2. Card-local metric hooks stay bounded and deterministic.
   - Card `49` uses `cont < 10`.
   - Card `51` uses `cont < 20`.
   - Cards `50`, `52`, `53`, and `54` do not introduce new conditional mechanics.
3. Progression remains explicit.
   - Go-card follow-up uses explicit `opening.card.<id>.advance` actions.
   - `opening.info.i16.advance` is a separate explicit action to the next boundary.

## Out Of Scope

- the next board `55..60`;
- any new workflow, rule, or selector abstraction;
- hidden auto-advance from a resolved card to `i16` or from `i16` to `stepIndex = 30`.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
