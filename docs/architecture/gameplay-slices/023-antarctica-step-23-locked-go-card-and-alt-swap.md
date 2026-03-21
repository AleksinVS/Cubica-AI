# GSR-023: Antarctica Step 23 Locked Go-Card And Alt Swap

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

This record keeps the bounded delivery details that were previously embedded in ADR-023.

## Boundary

After `opening.info.i13.advance`, Antarctica opens board `37..42` at `stepIndex = 23`.
This slice ends at the next boundary on `stepIndex = 26`.

## Slice Requirements

1. Board `37..42` stays explicit in the manifest.
   - Actions `opening.card.37` through `opening.card.42` are all hand-authored.
   - Card `39` remains a distinct explicit go-card.
2. Card `39` unlocks through board-local threshold tracking.
   - It starts locked.
   - It becomes available after at least three resolved cards on the same board.
3. Card `39` may swap to alternate outcome `3902` on entry.
   - The entry-time gate is `pro > 40`.
   - If the gate passes, runtime resolves the explicit alternate card `3902`; otherwise it resolves normal `39`.
4. Follow-up path stays explicit.
   - Post-card continuation to `i14` is an explicit action.
   - `i14 -> i14_2` is also explicit.
   - Cards `43..48` belong to the next slice and are not part of this record.

## Out Of Scope

- the board that starts at `stepIndex = 26`;
- reusable locked-card, variant-card, or branch-routing DSLs;
- hidden auto-advance behavior after resolving `39` or `3902`.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
