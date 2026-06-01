# Execution Matrix: Antarctica Authoring Manifest Migration

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Migration Inputs And Outputs](#2-migration-inputs-and-outputs)
- [3. Non-Negotiable Invariants](#3-non-negotiable-invariants)
- [4. Execution Slices](#4-execution-slices)
- [5. Prototype Extraction Matrix](#5-prototype-extraction-matrix)
- [6. CI Gates](#6-ci-gates)
- [7. Risk Register](#7-risk-register)
- [8. Handoff Checklist](#8-handoff-checklist)

## 1. Purpose

This matrix turns `docs/tasks/active/TSK-20260521-antarctica-authoring-manifest-migration.md` into bounded implementation slices.

The goal is to migrate `Antarctica` game and UI manifests to the ADR-030 authoring layer without changing runtime behavior unless a slice explicitly documents and validates the change.

## 2. Migration Inputs And Outputs

| Area | Current input | New authoring input | Generated output | Source map |
| --- | --- | --- | --- | --- |
| Game logic | `games/antarctica/game.manifest.json` | `games/antarctica/authoring/game.authoring.json` | `games/antarctica/game.manifest.json` | `games/antarctica/game.manifest.source-map.json` |
| Web UI | `games/antarctica/ui/web/ui.manifest.json` | `games/antarctica/authoring/ui/web.authoring.json` | `games/antarctica/ui/web/ui.manifest.json` | `games/antarctica/ui/web/ui.manifest.source-map.json` |
| Telegram UI | `games/antarctica/ui/telegram/ui.manifest.json` | `games/antarctica/authoring/ui/telegram.authoring.json` | `games/antarctica/ui/telegram/ui.manifest.json` | `games/antarctica/ui/telegram/ui.manifest.source-map.json` |

Current inventory:

| Metric | Value |
| --- | ---: |
| Game manifest lines | 8260 |
| Web UI manifest lines | 2944 |
| Telegram UI manifest lines | 71 |
| Game actions | 144 |
| Actions using runtime templates | 137 |
| Actions without `templateId` | 7 |
| Web UI screens | 11 |
| Telegram UI screens | 1 |

## 3. Non-Negotiable Invariants

| ID | Invariant | Enforcement |
| --- | --- | --- |
| I1 | Agents edit `games/antarctica/authoring/**`, not generated runtime manifests. | `verify:manifest-authoring` and review checklist. |
| I2 | Runtime/player do not resolve `_type`, `_extends`, `_definitions` or `_semantics`. | Runtime output scan and code review. |
| I3 | First adoption slice preserves runtime behavior. | Compile check, schema validation, canonical tests and e2e. |
| I4 | Runtime action templates remain runtime output. | No replacement of ADR-028 templates with runtime-specific authoring logic. |
| I5 | Game-specific prototypes stay local to `games/antarctica`. | No Antarctica definitions in shared compiler core or platform contracts. |
| I6 | Source maps are companion files and never runtime fields. | `.source-map.json` validation and `_source_trace` scan. |
| I7 | Compiler output is deterministic and idempotent. | `npm run compile:manifests -- --game antarctica --check`. |
| I8 | Flat runtime leftovers are temporary and documented. | Debt entry or TSK handoff note with removal condition. |

## 4. Execution Slices

| Slice | Goal | Main Write Scope | Acceptance Evidence | Validation |
| --- | --- | --- | --- | --- |
| A0 | Baseline capture | docs only | Current inventory recorded; no code/content change | `git diff --check` | ✅ Done |
| A1 | Authoring directories | `games/antarctica/authoring`, `.desc.json`, `PROJECT_STRUCTURE.yaml` | Directories are described and indexed | `node scripts/dev/generate-structure.js` | ✅ Done |
| A2 | Game parity adoption | `games/antarctica/authoring/game.authoring.json`, generated game manifest/source map | Compiler can regenerate game manifest from authoring input | `npm run compile:manifests -- --game antarctica --check` | ✅ Done |
| A3 | Web UI parity adoption | `games/antarctica/authoring/ui/web.authoring.json`, generated web UI/source map | Web UI manifest generated and schema-valid | `npm run verify:manifest-authoring` | ✅ Done |
| A4 | Telegram UI parity adoption | `games/antarctica/authoring/ui/telegram.authoring.json`, generated telegram UI/source map | Telegram UI manifest generated and schema-valid | `npm run verify:manifest-authoring` | ✅ Done |
| A5 | Game semantic extraction | `games/antarctica/authoring/game.authoring.json` | Repeated action shapes use local `_definitions`; runtime output stays stable | compile check + runtime-api tests | ✅ Done |
| A6 | Web UI semantic extraction | `games/antarctica/authoring/ui/web.authoring.json` | Repeated screen/component shells use local `_definitions`; output stays stable | compile check + player-web tests | ✅ Done |
| A7 | Telegram UI semantic extraction | `games/antarctica/authoring/ui/telegram.authoring.json` | Telegram screen uses shared local definitions without overfitting web layout | compile check | ✅ Done |
| A8 | Full governance closeout | docs, task handoff, generated files | All validation gates pass; remaining gaps documented | `npm run verify:canonical && npm run test:e2e` | ✅ Done |

## 5. Prototype Extraction Matrix

| Candidate | File | Recommended `_type` | Extraction Rule | Notes |
| --- | --- | --- | --- | --- |
| Whole game manifest | game authoring | `game.AntarcticaManifest` | Required for parity adoption. | ✅ Done — parity wrapper. |
| Info advance actions | game authoring | `game.OpeningInfoAdvanceAction` | Use when runtime action has `templateId: opening-info-advance`. | ✅ Done — 26 actions, 4 shared fields extracted. |
| Card resolution actions | game authoring | `game.OpeningCardResolutionAction` | Use when runtime action has `templateId: opening-card-resolution`. | ✅ Done — 71 actions, 3 shared fields extracted. |
| Card advance actions | game authoring | `game.OpeningCardAdvanceAction` | Use when runtime action has `templateId: opening-card-advance`. | ✅ Done — 30 actions, 3 shared fields extracted. |
| Team selection actions | game authoring | `game.OpeningTeamSelectionAction` | Use when runtime action has `templateId: opening-team-selection`. | ✅ Done — 10 actions, 4 shared fields extracted. |
| No-template runtime actions | game authoring | local, action-specific definitions | Review one by one. | ✅ Done — 7 unique definitions extracted. |
| Web manifest shell | web UI authoring | `ui.AntarcticaWebManifest` | Required for parity adoption. | ✅ Done — parity wrapper. |
| Topbar screens | web UI authoring | `ui.TopbarScreen` | Use for screens with `layout_mode: topbar`. | ✅ Done — 10 topbar screens share shell definition. |
| Left-sidebar screen | web UI authoring | `ui.LeftSidebarScreen` | Use for `S1_LEFT`. | ✅ Done — 1 left-sidebar screen. |
| Metric variables | web UI authoring | `ui.MetricVariable{Id}{Topbar\|LeftSidebar}` | Use for repeated gameVariableComponent nodes by metric ID and layout variant. | ✅ Done — 8 metrics × 2 layout variants = 16 definitions. |
| Telegram screen | telegram UI authoring | `ui.TelegramScreen` | Required for parity adoption. | ✅ Done — single screen extracted into definition. |

## 6. CI Gates

| Gate | Command | Blocks |
| --- | --- | --- |
| Authoring compiler | `npm run compile:manifests -- --game antarctica --check` | Stale generated game/UI manifests or missing source maps. |
| Authoring governance | `npm run verify:manifest-authoring` | Unknown types, schema errors, authoring leakage, source-map errors. |
| Canonical verification | `npm run verify:canonical` | Runtime, player and governance regressions. |
| Browser e2e | `npm run test:e2e` | Player-visible breakage for canonical flows. |
| Runtime leakage scan | `rg -n '"_type"|"_extends"|"_definitions"|"_semantics"|"_source_trace"' games/antarctica/game.manifest.json games/antarctica/ui/web/ui.manifest.json games/antarctica/ui/telegram/ui.manifest.json` | Authoring-only keys in runtime output. |
| Structure index | `node scripts/dev/generate-structure.js` | Missing `.desc.json` or stale `PROJECT_STRUCTURE.yaml`. |

## 7. Risk Register

| Risk | Impact | Control |
| --- | --- | --- |
| Large first diff makes review unreliable. | Behavior regression can hide in migration noise. | Start with parity adoption and generated output stability before semantic extraction. |
| Authoring prototypes duplicate ADR-028 runtime templates. | Two competing abstraction layers. | Use authoring prototypes to generate compact runtime template calls, not to create another runtime action model. |
| Web layout assumptions leak into telegram UI. | Channel-specific bugs and poor reuse. | Keep telegram definitions separate unless reuse is proven by another channel. |
| Current compiler does not support includes. | Over-splitting authoring files would silently fail or require scope creep. | Keep one game authoring file and one UI authoring file per channel until includes are implemented deliberately. |
| Source maps become treated as runtime dependency. | Runtime contract pollution. | Keep source maps as tooling-only companion files and scan runtime manifests for `_source_trace`. |
| Antarctica-specific prototypes move into core. | Game-specific drift in platform layer. | Keep definitions local to `games/antarctica/authoring/**`. |
| Generated manifests are edited manually after migration. | Authoring/generated drift returns. | Require authoring input changes and compile check in every PR touching adopted files. |

## 8. Handoff Checklist

- ADR-030 read before implementation.
- `TSK-20260521-antarctica-authoring-manifest-migration.md` updated after each slice.
- New `games/antarctica/authoring` directories include `.desc.json`.
- `PROJECT_STRUCTURE.yaml` regenerated after structural changes.
- `npm run compile:manifests -- --game antarctica --check` passes after every slice.
- `npm run verify:manifest-authoring` passes before handoff.
- `npm run verify:canonical` and `npm run test:e2e` pass before completion.
- Any intentional runtime output change is documented in the handoff log with exact file paths.

### Review Follow-Up

Post-migration review found acceptance blockers that are tracked separately in `docs/tasks/active/TSK-20260521-antarctica-authoring-review-remediation.md`.

The remediation is complete as of 2026-05-21. The original migration can be treated as accepted after the following completed outcomes:

- `opening.info.i21.advance` is either implemented or removed/replaced through authoring;
- source-map pointers are validated against real authoring JSON Pointers;
- byte-equivalence claims are corrected to semantic JSON parity unless `cmp` proves byte-level equality.

Completion evidence:

- `opening.info.i21.advance` implemented through `games/antarctica/authoring/game.authoring.json` as a terminal no-op action.
- `npm run verify:manifest-authoring` now validates source-map file existence, source-map pointer existence and dangling action references for adopted manifests.
- Full validation passed: `npm run verify:canonical` and `npm run test:e2e`.

### Handoff Record: Parity Adoption (A1–A4)

**Date**: 2026-05-21
**Slices completed**: A1, A2, A3, A4
**Runtime diff**: Semantic JSON parity with pre-existing runtime manifests. Byte equivalence was not accepted as evidence because `cmp` was not the passing check.
**Authoring-only keys in runtime**: Zero (`rg` scan confirms no `_type`, `_extends`, `_definitions`, `_semantics`, `_source_trace` in generated output).
**Validation results**:
- `npm run compile:manifests -- --game antarctica --check`: OK
- `npm run verify:manifest-authoring`: OK
- `npm run verify:canonical`: OK (runtime-api 74 tests, player-web 102 tests, build OK)
- `npm run test:e2e`: 3 passed
- `git diff --check`: no issues
- `rg` for authoring-only keys: zero matches

**Files created**:
- `games/antarctica/authoring/game.authoring.json` — game manifest parity adoption
- `games/antarctica/authoring/ui/web.authoring.json` — web UI parity adoption
- `games/antarctica/authoring/ui/telegram.authoring.json` — telegram UI parity adoption
- `games/antarctica/authoring/.desc.json`
- `games/antarctica/authoring/ui/.desc.json`
- `games/antarctica/game.manifest.source-map.json`
- `games/antarctica/ui/web/ui.manifest.source-map.json`
- `games/antarctica/ui/telegram/ui.manifest.source-map.json`

**Files updated**:
- `games/antarctica/game.manifest.json` — regenerated by compiler (semantic JSON parity)
- `games/antarctica/ui/web/ui.manifest.json` — regenerated by compiler (semantic JSON parity)
- `games/antarctica/ui/telegram/ui.manifest.json` — regenerated by compiler (semantic JSON parity)
- `PROJECT_STRUCTURE.yaml` — regenerated by `generate-structure.js`

**Documented gaps**: None. All three manifests are adopted; no intentional runtime changes.

**Next safe step**: Semantic prototype extraction (Slice A5–A7) — extracting `_definitions` for repeated action shapes and UI patterns while preserving compiler output stability.

### Handoff Record: Semantic Prototype Extraction (A5–A7)

**Date**: 2026-05-21
**Slices completed**: A5, A6, A7
**Runtime diff**: Semantic JSON parity with pre-extraction runtime manifests after each extraction slice. Byte equivalence was not claimed without a passing byte-level comparison.
**Authoring-only keys in runtime**: Zero (`rg` scan confirms no `_type`, `_extends`, `_definitions`, `_semantics`, `_source_trace` in generated output).

**Game authoring definitions extracted (A5)**:
- `game.AntarcticaManifest` — parity wrapper (unchanged from A2)
- `game.OpeningCardResolutionAction` — 71 actions sharing `handlerType`, `templateId`, `capabilityFamily`
- `game.OpeningCardAdvanceAction` — 30 actions sharing `handlerType`, `templateId`, `capabilityFamily`
- `game.OpeningInfoAdvanceAction` — 26 actions sharing `handlerType`, `templateId`, `capabilityFamily`
- `game.OpeningTeamSelectionAction` — 10 actions sharing `handlerType`, `templateId`, `capabilityFamily`
- 7 unique no-template action definitions: `game.OpeningBoard2530Advance`, `game.OpeningTeamConfirm`, `game.RequestServer`, `game.ShowHint`, `game.ShowHistory`, `game.ShowTopBar`, `game.ShowScreenWithLeftSideBar`
- Total: 12 definitions, 144 action references

**Web UI authoring definitions extracted (A6)**:
- `ui.AntarcticaWebManifest` — parity wrapper (unchanged from A3)
- `ui.TopbarScreen` — shared screen shell for 10 topbar-layout screens
- `ui.LeftSidebarScreen` — shared screen shell for 1 left-sidebar screen
- 16 metric variable definitions (`ui.MetricVariable{Id}{Topbar|LeftSidebar}`) for 8 metric IDs × 2 layout variants
- Total: 19 definitions

**Telegram UI authoring definitions extracted (A7)**:
- `ui.AntarcticaTelegramManifest` — parity wrapper (unchanged from A4)
- `ui.TelegramScreen` — single telegram screen definition
- Total: 2 definitions

**Validation results after extraction**:
- `npm run compile:manifests -- --game antarctica --check`: OK
- `npm run verify:manifest-authoring`: OK
- `npm run verify:canonical`: OK (runtime-api 74 tests, player-web 102 tests, build OK)
- `npm run test:e2e`: 3 passed
- `git diff --check`: no issues
- `rg` for authoring-only keys: zero matches

**Documented gaps**: None. All semantic prototypes are extracted; no intentional runtime changes.

**Next safe step**: Governance closeout (Slice A8) — confirm all gates pass, update documentation, declare migration complete.
