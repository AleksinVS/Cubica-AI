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
| A0 | Baseline capture | docs only | Current inventory recorded; no code/content change | `git diff --check` |
| A1 | Authoring directories | `games/antarctica/authoring`, `.desc.json`, `PROJECT_STRUCTURE.yaml` | Directories are described and indexed | `node scripts/dev/generate-structure.js` |
| A2 | Game parity adoption | `games/antarctica/authoring/game.authoring.json`, generated game manifest/source map | Compiler can regenerate game manifest from authoring input | `npm run compile:manifests -- --game antarctica --check` |
| A3 | Web UI parity adoption | `games/antarctica/authoring/ui/web.authoring.json`, generated web UI/source map | Web UI manifest generated and schema-valid | `npm run verify:manifest-authoring` |
| A4 | Telegram UI parity adoption | `games/antarctica/authoring/ui/telegram.authoring.json`, generated telegram UI/source map | Telegram UI manifest generated and schema-valid | `npm run verify:manifest-authoring` |
| A5 | Game semantic extraction | `games/antarctica/authoring/game.authoring.json` | Repeated action shapes use local `_definitions`; runtime output stays stable | compile check + runtime-api tests |
| A6 | Web UI semantic extraction | `games/antarctica/authoring/ui/web.authoring.json` | Repeated screen/component shells use local `_definitions`; output stays stable | compile check + player-web tests |
| A7 | Telegram UI semantic extraction | `games/antarctica/authoring/ui/telegram.authoring.json` | Telegram screen uses shared local definitions without overfitting web layout | compile check |
| A8 | Full governance closeout | docs, task handoff, generated files | All validation gates pass; remaining gaps documented | `npm run verify:canonical && npm run test:e2e` |

## 5. Prototype Extraction Matrix

| Candidate | File | Recommended `_type` | Extraction Rule | Notes |
| --- | --- | --- | --- | --- |
| Whole game manifest | game authoring | `game.AntarcticaManifest` | Required for parity adoption. | Start here before any compaction. |
| Info advance actions | game authoring | `game.OpeningInfoAdvanceAction` | Use when runtime action has `templateId: opening-info-advance`. | Keep `templateId` and `params` in generated output. |
| Card resolution actions | game authoring | `game.OpeningCardResolutionAction` | Use when runtime action has `templateId: opening-card-resolution`. | Largest repeated group: 71 actions. |
| Card advance actions | game authoring | `game.OpeningCardAdvanceAction` | Use when runtime action has `templateId: opening-card-advance`. | Preserve follow-up routing fields. |
| Team selection actions | game authoring | `game.OpeningTeamSelectionAction` | Use when runtime action has `templateId: opening-team-selection`. | Keep team-selection state explicit. |
| No-template runtime actions | game authoring | local, action-specific definitions | Review one by one. | Do not force templates if behavior is unique. |
| Web manifest shell | web UI authoring | `ui.AntarcticaWebManifest` | Required for parity adoption. | Includes `metric_specs`, `screen_routing`, layouts and design artifacts. |
| Topbar screens | web UI authoring | `ui.TopbarScreen` | Use for screens with `layout_mode: topbar`. | Current web UI has most screens in this mode. |
| Left-sidebar screen | web UI authoring | `ui.LeftSidebarScreen` | Use for `S1_LEFT`. | Keep layout-specific props explicit. |
| Metric area | web UI authoring | `ui.MetricPanel` | Use for repeated metric display nodes. | Should remain game UI local until reused by another game. |
| Info content area | web UI authoring | `ui.InfoContentArea` | Use for repeated text/action composition. | Avoid hiding unique screen copy. |
| Action button | web UI authoring | `ui.ActionButton` | Use only for repeated request-server buttons. | Preserve payload action IDs. |
| Telegram screen | telegram UI authoring | `ui.TelegramScreen` | Required for parity adoption. | Do not inherit web-only layout assumptions. |

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
