# GSR-020: Antarctica Step 15 Team Selection

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

This record keeps the bounded delivery details that were previously embedded in ADR-020.

## Boundary

`opening.card.18.advance` and `opening.info.i9.advance` reach Antarctica `stepIndex = 15`.
At this boundary the runtime must support a bounded team-selection mechanic without introducing a generic workflow engine.

## Slice Requirements

1. Manifest actions stay explicit.
   - Member selection uses hand-authored actions such as `team.select.member.<memberId>`.
   - Confirmation is a separate explicit action such as `team.confirm`.
2. Confirmation opens only after exactly five picks.
   - Selection guards require `stepIndex = 15`, the member not yet selected, and `pickCount < 5`.
   - Confirm requires `pickCount === 5`.
3. Player-visible selection state lives in `state.public`.
   - `state.public.flags.team[memberId].selected`
   - `state.public.teamSelection.pickCount`
   - `state.public.teamSelection.selectedMemberIds`
4. Runtime behavior remains bounded and deterministic.
   - Each selection action flips the member flag, increments the count, and syncs the selected member list.
   - Premature confirm and over-limit selection attempts are rejected.

## Out Of Scope

- a generic selector engine;
- payload-driven selection DSL;
- reusable multi-stage workflow abstractions beyond the current step-15 boundary.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
