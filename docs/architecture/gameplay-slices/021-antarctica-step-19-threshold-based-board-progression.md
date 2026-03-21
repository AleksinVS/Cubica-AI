# GSR-021: Antarctica Step 19 Threshold-Based Board Progression

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

This record keeps the bounded delivery details that were previously embedded in ADR-021.

## Boundary

After the step-15 team-selection slice and its explicit follow-up path, Antarctica reaches `stepIndex = 19`, which maps to board `25..30`.

## Slice Requirements

1. Board card actions remain explicit manifest actions.
   - The slice uses hand-authored actions for the concrete board card ids only.
   - Runtime accepts only the declared actions for this board.
2. Board progression uses a separate explicit advance action.
   - Advance is not hidden inside a single go-card.
   - Advance becomes available only after the board reaches its resolved-card threshold.
3. Threshold evaluation stays local to the board.
   - Runtime tracks explicit resolved card ids and a derived resolved-card count for board `25..30`.
   - Player-facing projection may expose this progress, but gating remains deterministic and bounded.

## Out Of Scope

- conditional metric gates from the later step-21 slice;
- line switching and branching semantics;
- a generic workflow engine or selector abstraction.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
