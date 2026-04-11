# GSR-030: Antarctica Full Scenario Parity And Playthrough

- **Date**: 2026-04-11
- **Status**: Implemented for runtime parity; web screen split follow-up pending
- **Architecture**: `ADR-018`, `ADR-024`
- **Components**: `draft/Antarctica/GameFull.html`, `games/antarctica`, `scripts/antarctica`, `services/runtime-api`, `apps/player-web`

This record captures the next migration plan for proving that the legacy Antarctica scenario and rules have been correctly transferred into `games/antarctica/game.manifest.json`, then making the canonical runtime walk the whole migrated scenario.

## Terms

- **Parity report**: a generated comparison artifact that lists matching and mismatching legacy-vs-manifest scenario facts.
- **Playthrough**: an automated run that creates a runtime session and dispatches actions until a terminal state is reached.
- **Legacy source**: `draft/Antarctica/GameFull.html`; it is a factual extraction source during migration, not a runtime source of truth.

## Boundary

The migration starts from script-based extraction of the legacy main line in `GameFull.html` and the current canonical manifest in `games/antarctica/game.manifest.json`.
The first acceptance boundary is not a gameplay rewrite; it is a repeatable verification tool that identifies exact gaps before changing manifest/runtime behavior.

The full scenario target is the main-line opening flow through terminal `i21`, including already documented bounded mechanics from `GSR-020` through `GSR-029`.
The currently known high-risk boundary is the final legacy tail: targeted extraction reports `stepIndex = 34` as board `67,68`, then `stepIndex = 36` as board `69,70`, while the manifest player-facing board currently groups `67,68,69,70` under one `stepIndex = 34` board.

## Implementation Result

The parity report tooling now generates `.tmp/agent-workflow/antarctica-full-scenario-parity-2026-04-11/parity-report.json` and `.tmp/agent-workflow/antarctica-full-scenario-parity-2026-04-11/parity-report.md`.

The report confirmed the final-tail projection mismatch:

- legacy `stepIndex = 34`: cards `67,68`;
- legacy `stepIndex = 36`: cards `69,70`;
- previous manifest projection: one board `67,68,69,70` at `stepIndex = 34`;
- action provenance already pointed cards `69` and `70` to `stepIndex = 36`.

The manifest player-facing content has been split into:

- `opening.board.67_68` at `stepIndex = 34`;
- `opening.board.69_70` at `stepIndex = 36`.

After the split, the generated report shows `timelineMismatchCount = 0`, `metricMismatchCount = 0`, `actionIssueCount = 0`, and final-tail status `match`.

Residual follow-up: `apps/player-web` still has older explicit UI screen key assumptions for `67..70`. Runtime/API parity is fixed, but web-specific screen-key alignment for split boards should be handled in a separate UI/content alignment slice.

## Migration Plan

1. Build a script-based parity report.
   - Extend or add Antarctica tooling under `scripts/antarctica/`.
   - Do not manually read `GameFull.html` as prose.
   - The report must extract legacy timeline blocks, card ids, info ids, team-selection ids, and initial metric values.
   - The report must compare them with manifest content, actions, deterministic metadata, and player-facing board/info projection.
2. Freeze the detected gaps as generated evidence.
   - Write generated reports under `.tmp/agent-workflow/...` or another temporary workspace, not as canonical product truth.
   - If the report finds intentional transformations, document why they are intentional in this GSR or a follow-up GSR.
   - If the report finds incorrect transformations, fix manifest/runtime behavior in bounded slices.
3. Implement canonical playthrough coverage.
   - Add an automated runtime playthrough that dispatches actions from a fresh runtime session to a terminal state.
   - The playthrough must cover at least one main-line path and one known loss/alternate path already represented by `GSR-022`, `GSR-023`, and `GSR-029`.
   - The playthrough must assert explicit runtime state: `timeline.line`, `timeline.stepIndex`, `timeline.activeInfoId` where relevant, card flags, and terminal `i21`.
4. Normalize final-tail projection if the parity report confirms the manifest is wrong.
   - Keep explicit actions and explicit follow-up paths.
   - Do not introduce a generic workflow engine, selector DSL, or hidden auto-advance mechanism.
   - Prefer manifest-level correction plus minimal runtime/player projection changes.
5. Update documentation and checks.
   - Keep this GSR as the migration plan and gap record.
   - Update `NEXT_STEPS.md` after the verification result changes the known project state.
   - Add a root verification command only if it becomes a stable developer workflow.

## Acceptance Criteria

- A script can produce a machine-readable parity report without manual whole-file reading of `GameFull.html`.
- The parity report explicitly lists legacy main-line blocks and manifest blocks by step/index/card ids.
- Existing extraction checks still pass.
- Runtime API tests include automated playthrough coverage to terminal `i21`.
- Any mismatch around boards `67,68` and `69,70` is either fixed or explicitly documented as an intentional projection difference.

## Out Of Scope

- introducing persistence, locks, recovery, or distributed runtime behavior;
- introducing a platform-wide generic workflow engine or rule DSL;
- making `apps/player-web` read `games/*` directly;
- changing UI visuals unless a manifest/runtime correction requires a small display update.

## Related Artifacts

- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `docs/architecture/gameplay-slices/020-antarctica-step-15-team-selection.md`
- `docs/architecture/gameplay-slices/029-antarctica-step-34-relocation-aftermath-and-ending.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
