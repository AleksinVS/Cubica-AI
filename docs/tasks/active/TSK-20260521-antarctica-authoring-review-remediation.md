# TSK-20260521-antarctica-authoring-review-remediation: Antarctica Authoring Migration Review Remediation

## Оглавление

- [Status](#status)
- [Why](#why)
- [Terms](#terms)
- [Review Findings](#review-findings)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

complete

## Why

Review of the `Antarctica` ADR-030 authoring migration found that the main compiler and runtime gates pass, but acceptance evidence is incomplete:

- the web UI and game content still reference a missing runtime action;
- generated source maps are structurally valid JSON but many source pointers do not exist in authoring files;
- task handoff text claims byte-equivalent runtime output, while current generated files are only semantically equivalent after JSON normalization.

This task documents the exact remediation path before the migration can be accepted as complete.

## Terms

- Authoring manifest - editable source JSON under `games/antarctica/authoring/**`.
- Runtime manifest - generated JSON consumed by `runtime-api` and `player-web`.
- Source map - companion JSON file mapping generated runtime JSON Pointers back to authoring file pointers.
- JSON Pointer - path inside a JSON document, for example `/actions/opening.card.1`.
- Semantic JSON parity - equality of parsed JSON values even if key order or final newline differs.
- Byte equivalence - exact byte-for-byte file equality.
- Governance check - CI or script rule that blocks undocumented drift.

## Review Findings

| ID | Severity | Finding | Evidence | Required Outcome |
| --- | --- | --- | --- | --- |
| AR-001 | High | Web UI and game content reference missing action `opening.info.i21.advance`. | `games/antarctica/ui/web/ui.manifest.json`, `games/antarctica/authoring/ui/web.authoring.json`, `games/antarctica/game.manifest.json`, `games/antarctica/authoring/game.authoring.json`. | Either add a valid runtime action through authoring, or intentionally remove/replace the references; no dangling action IDs remain. |
| AR-002 | Medium | Source maps contain many pointers that do not exist in the authoring files after prototype extraction. | Example: source map points to `/root/actions/opening.card.1`, while authoring `root` only contains `_type`. | Source maps point to existing authoring JSON Pointers, and CI validates pointer existence. |
| AR-003 | Low | Documentation says outputs are byte-equivalent, but generated runtime files are only semantically equivalent to the previous committed JSON. | `cmp` fails for all three generated runtime manifests; normalized JSON comparison passes. | Documentation uses accurate wording and distinguishes semantic parity from byte equivalence. |

## Architecture Baseline

The remediation must preserve:

- ADR-018: runtime game truth remains generated JSON manifest.
- ADR-025: JSON Schema remains the structural source of truth; imperative checks may validate graph relationships but must not replace schema validation.
- ADR-028: runtime action templates remain runtime output and are not replaced by authoring prototypes.
- ADR-030: agents edit authoring files, not generated runtime manifests.
- ADR-031: execution details live in task files and artifacts, not ADRs.

## Scope

In scope:

- fix the missing `opening.info.i21.advance` reference or explicitly remove/replace it through authoring;
- add a source-map pointer-existence validator to `scripts/ci/validate-manifest-authoring.js` or an equivalent CI-owned script;
- fix compiler/source-map generation so mappings refer to existing authoring pointers after `_type` resolution and `_definitions` extraction;
- regenerate affected `Antarctica` source maps and generated manifests through `npm run compile:manifests`;
- update migration task handoff text and execution matrix to replace byte-equivalence claims with semantic JSON parity where appropriate;
- add focused validation notes for dangling action references in UI payloads and game content references.

## Non-Goals

Out of scope:

- redesigning the final `Antarctica` scenario;
- adding runtime/player support for authoring-only keys;
- introducing include files for authoring manifests;
- moving `screen_routing` or `metric_specs` between UI/game manifests;
- broad UI schema normalization beyond the checks required by this review;
- committing temporary scripts from `.tmp/`.

## Requirements

### R1. Fix Through Authoring

All content fixes must be made in `games/antarctica/authoring/**`; generated runtime files are updated only by the compiler.

### R2. No Dangling Runtime Actions

After remediation, every UI `payload.actionId` and every game content `advanceActionId` that is meant to dispatch a runtime action must resolve to `game.manifest.json.actions`.

If `opening.info.i21.advance` is intentionally terminal and should not dispatch, remove the dispatch reference and document why no action is needed.

### R3. Source Map Pointers Must Exist

Every source entry in every generated `.source-map.json` must point to an existing file and an existing JSON Pointer inside that file.

### R4. CI Must Catch The Reviewed Defects

`npm run verify:manifest-authoring` must fail for:

- missing source-map target files;
- source-map source pointers that do not exist;
- dangling action references in adopted `Antarctica` game/UI manifests, unless a documented exception is added with a removal condition.

### R5. Accurate Evidence Language

Documentation must not claim byte equivalence when only semantic JSON parity was verified.

### R6. Preserve Runtime Behavior Unless Deliberate

Any runtime behavior change needed for the final action must be explicitly described in the Handoff Log with the user-visible effect and validation evidence.

## Execution Plan

### Phase 1. Reproduce Review Findings

1. Run a structured missing-action scan over:
   - `games/antarctica/game.manifest.json`;
   - `games/antarctica/ui/web/ui.manifest.json`;
   - `games/antarctica/ui/telegram/ui.manifest.json`.
2. Run a source-map pointer-existence scan for:
   - `games/antarctica/game.manifest.source-map.json`;
   - `games/antarctica/ui/web/ui.manifest.source-map.json`;
   - `games/antarctica/ui/telegram/ui.manifest.source-map.json`;
   - existing `simple-choice` source maps.
3. Record exact counts in the Handoff Log before fixing.

### Phase 2. Missing Action Remediation

1. Inspect terminal `i21` semantics through structured JSON queries, not by reading the whole manifest.
2. Choose one path:
   - add `opening.info.i21.advance` as a valid terminal/no-op action through `games/antarctica/authoring/game.authoring.json`;
   - or remove/replace `advanceActionId` and `btn-finish` dispatch through authoring files.
3. Compile with `npm run compile:manifests -- --game antarctica`.
4. Re-run the missing-action scan and ensure zero unresolved references.

### Phase 3. Source Map Correctness

1. Fix source-map generation so inherited values from definitions map to real definition pointers, not synthetic `/root/...` paths that do not exist.
2. Add pointer-existence validation to CI governance.
3. Regenerate source maps for `Antarctica` and keep `simple-choice` passing.
4. Verify every source pointer exists.

### Phase 4. Documentation Correction

1. Update `TSK-20260521-antarctica-authoring-manifest-migration.md`.
2. Update `docs/tasks/artifacts/TSK-20260521-antarctica-authoring-manifest-migration/execution-matrix.md`.
3. Replace inaccurate byte-equivalence claims with semantic JSON parity claims where appropriate.
4. Add any remaining accepted gaps with owner, reason and removal condition.

### Phase 5. Final Governance

1. Run all validation commands listed below.
2. Update this task Handoff Log with results.
3. Mark the original migration task complete only after this remediation task passes acceptance.

## Acceptance

- No unresolved `payload.actionId` or `advanceActionId` remains in adopted `Antarctica` manifests.
- All source-map source files exist.
- All source-map source pointers exist in their source files.
- `npm run verify:manifest-authoring` includes the new source-map pointer-existence guard.
- Documentation no longer claims byte equivalence unless `cmp` actually proves it.
- `npm run verify:canonical` passes.
- `npm run test:e2e` passes in an isolated run.
- Runtime manifests contain no authoring-only keys.

## Validation

```text
npm run compile:manifests -- --game antarctica
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
npm run verify:canonical
npm run test:e2e
node scripts/dev/generate-structure.js
git diff --check
rg -n '"_type"|"_extends"|"_definitions"|"_semantics"|"_source_trace"' games/antarctica/game.manifest.json games/antarctica/ui/web/ui.manifest.json games/antarctica/ui/telegram/ui.manifest.json
```

Review aid scripts may be temporary under `.tmp/`, but the final pointer-existence and dangling-action checks must be part of committed governance code.

## Artifacts

- `docs/tasks/artifacts/TSK-20260521-antarctica-authoring-review-remediation/execution-matrix.md`

## Handoff Log

### 2026-05-21 - Review remediation documentation

- Created this task from review findings after `Antarctica` authoring migration.
- Captured three required remediation areas: missing final action, broken source-map source pointers and inaccurate byte-equivalence claims.
- Next implementation step: reproduce AR-001 and AR-002 with committed governance checks before fixing content, so CI blocks regressions.

### 2026-05-21 - AR-001/AR-002/AR-003 implementation

- Reproduced AR-001 before the fix:
  - `games/antarctica/game.manifest.json`: 56 action references, 1 missing (`advanceActionId` -> `opening.info.i21.advance`).
  - `games/antarctica/ui/web/ui.manifest.json`: 22 action references, 1 missing (`payload.actionId` -> `opening.info.i21.advance`).
  - `games/antarctica/ui/telegram/ui.manifest.json`: 0 action references, 0 missing.
- Chosen AR-001 remediation: keep the final `Завершить` button dispatchable and add `opening.info.i21.advance` as a terminal no-op action through `games/antarctica/authoring/game.authoring.json`. User-visible effect: clicking the final button is now a valid server action and keeps the scenario on terminal info screen `i21` instead of advancing to a new screen.
- Added generic dangling action governance to `npm run verify:manifest-authoring` for adopted game/UI pairs:
  - UI `payload.actionId` must resolve to generated game manifest `actions`.
  - Game content `advanceActionId` must resolve to generated game manifest `actions`.
- Reproduced AR-002 before the fix:
  - `games/simple-choice/game.manifest.source-map.json`: 174 source entries, 0 invalid.
  - `games/simple-choice/ui/web/ui.manifest.source-map.json`: 194 source entries, 12 invalid.
  - `games/antarctica/game.manifest.source-map.json`: 12702 source entries, 4922 invalid.
  - `games/antarctica/ui/web/ui.manifest.source-map.json`: 4226 source entries, 1970 invalid.
  - `games/antarctica/ui/telegram/ui.manifest.source-map.json`: 98 source entries, 28 invalid.
- Fixed source-map generation in `scripts/manifest-tools/compile-authoring-manifests.cjs` so child mappings derive real authoring pointers from inherited definition and instance sources instead of synthetic `/root/...` paths.
- Added generic source-map file and pointer existence governance to `npm run verify:manifest-authoring`.
- Regenerated adopted generated outputs with the compiler. After the fix:
  - `games/simple-choice/game.manifest.source-map.json`: 89 source entries, 0 invalid.
  - `games/simple-choice/ui/web/ui.manifest.source-map.json`: 119 source entries, 0 invalid.
  - `games/antarctica/game.manifest.source-map.json`: 6521 source entries, 0 invalid.
  - `games/antarctica/ui/web/ui.manifest.source-map.json`: 2283 source entries, 0 invalid.
  - `games/antarctica/ui/telegram/ui.manifest.source-map.json`: 51 source entries, 0 invalid.
- Corrected AR-003 evidence wording in the original migration task and execution matrix: claims now say semantic JSON parity unless byte-level comparison is explicitly proven.
- Validation completed:
  - `npm run compile:manifests -- --game antarctica` - OK.
  - `npm run compile:manifests -- --game antarctica --check` - OK.
  - `npm run verify:manifest-authoring` - OK with new dangling-action and source-map pointer guards.
  - `npm run verify:canonical` - OK (`runtime-api` 74 tests, `player-web` 102 tests, Next build OK).
  - `npm run test:e2e` - OK (3 passed).
  - `node scripts/dev/generate-structure.js` - OK (`PROJECT_STRUCTURE.yaml` regenerated strictly with documented nodes).
  - `git diff --check` - OK.
  - Runtime authoring-key leakage scan - OK, zero matches for `_type`, `_extends`, `_definitions`, `_semantics`, `_source_trace` in generated Antarctica runtime manifests.
- Remaining gaps: none for AR-001, AR-002 or AR-003.
