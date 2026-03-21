# GSR-029: Antarctica Step 34 Relocation Aftermath And Ending

- **Date**: 2026-03-21
- **Status**: Implemented
- **Architecture**: `ADR-024`
- **Components**: `games/antarctica`, `packages/contracts/manifest`, `services/runtime-api`, `apps/player-web`

This record captures the bounded delivery details for the final opening-flow slice from board `67..68` to terminal info block `i21`.

## Boundary

After `opening.info.i18.advance`, Antarctica reaches board `67..68` on main line `stepIndex = 34`.
This slice ends when the player reaches terminal info block `i21` either through the main-line ending (`i19/i19_1 -> 69 -> i20 -> i21`) or through the bounded loss jump (`i34_2 -> i21`).

## Slice Requirements

1. Board `67..68` and the final board `69..70` stay explicit in the manifest.
   - Actions `opening.card.67` through `opening.card.70` are all hand-authored.
   - Go-card continuation stays explicit through `opening.card.68.advance`, `opening.card.69.advance`, and `opening.info.i20.advance`.
2. Entry-time info resolution stays bounded and auditable.
   - `opening.card.68.advance` resolves one of three explicit outcomes:
     - default `i19`,
     - fast-variant `i19_1`,
     - direct loss-line jump to `i34_2`.
   - The chosen info block must be projected through explicit runtime state, not hidden inside transport code or player heuristics.
3. No generic branch router is introduced.
   - The slice may extend bounded deterministic metadata with explicit `activeInfoId`, one conditional info variant, and an explicit line-switch target info id.
   - It must not introduce a generic workflow DSL, content query language, or implicit auto-advance chain.

## Out Of Scope

- any new post-`i21` gameplay branch;
- a generic content-navigation engine;
- retrofitting every earlier Antarctica info step with a full content-addressable state model.

## Related Artifacts

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
