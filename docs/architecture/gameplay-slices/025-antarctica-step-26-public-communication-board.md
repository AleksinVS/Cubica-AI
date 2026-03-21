# GSR-025: Antarctica Step 26 Public Communication Board

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `apps/player-web`

This record captures the bounded delivery details for the main-line board at `stepIndex = 26`.

## Boundary

After `opening.info.i14_2.advance`, Antarctica reaches board `43..48` on main line `stepIndex = 26`.
This slice ends after the explicit follow-up through `i15` reaches the next boundary at `stepIndex = 28`.

## Slice Requirements

1. Board `43..48` stays explicit in the manifest.
   - Actions `opening.card.43` through `opening.card.48` are all hand-authored.
   - Go-card continuation stays explicit through follow-up actions to `i15`.
2. Card-local metric hooks stay bounded and deterministic.
   - Cards `43`, `44`, and `48` use `rep < 15`.
   - Card `45` uses `cont > 10`.
   - Cards `46` and `47` do not introduce new conditional mechanics.
3. Player-visible progression remains explicit.
   - Go-cards `43`, `45`, `47`, and `48` set `canAdvance = true`.
   - Non-go cards keep `canAdvance = false`.
   - `opening.info.i15.advance` is a separate explicit action to the next boundary.

## Out Of Scope

- the next board `49..54`;
- any new workflow, rule, or selector abstraction;
- hidden auto-advance from a resolved card to `i15` or from `i15` to `stepIndex = 28`.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
