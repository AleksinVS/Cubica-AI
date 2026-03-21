# GSR-022: Antarctica Step 21 Metric Gates And Line Switch

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

This record keeps the bounded delivery details that were previously embedded in ADR-022.

## Boundary

Main line `stepIndex = 20` exposes legacy info block `i12`.
The next bounded slice covers the transition into board `31..36`, its card-local metric gates, and one bounded line switch.

## Slice Requirements

1. The path into the board stays explicit.
   - `opening.info.i12.advance` is a hand-authored action on the main line.
   - Board actions are explicit `opening.card.31` through `opening.card.36`.
2. Metric-gated behavior stays card-local and bounded.
   - Cards `31`, `33`, `35`, and `36` use `cont`.
   - Card `32` uses `pro`.
   - Card `34` uses `stat`.
3. Card `34` can switch to the losing line.
   - The switch happens only when `stat < 25`.
   - The canonical target is a string line id such as `loss`, not a numeric runtime line index.
4. Follow-up actions remain explicit.
   - Normal continuation to `i13` uses explicit follow-up actions.
   - The losing path continues through explicit actions `i34 -> i34_2 -> i21`.

## Out Of Scope

- the next main-line board `37..42`;
- a generic rule engine for card gates or branching;
- implicit auto-play of the active line.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
