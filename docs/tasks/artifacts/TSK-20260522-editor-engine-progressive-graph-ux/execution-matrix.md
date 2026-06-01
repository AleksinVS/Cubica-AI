# Execution Matrix: Progressive Semantic Graph UX

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Inputs And Outputs](#2-inputs-and-outputs)
- [3. Invariants](#3-invariants)
- [4. Execution Slices](#4-execution-slices)
- [5. Semantic Projection Matrix](#5-semantic-projection-matrix)
- [6. Panel State Matrix](#6-panel-state-matrix)
- [7. Validation Gates](#7-validation-gates)
- [8. E2E Checklist](#8-e2e-checklist)
- [9. Risks](#9-risks)
- [10. Handoff Checklist](#10-handoff-checklist)

## 1. Purpose

This matrix turns `docs/tasks/active/TSK-20260522-editor-engine-progressive-graph-ux.md` into implementation slices.

Goal: replace the current raw JSON-tree graph with a usable progressive semantic graph and collapsible editing panels, while keeping authoring JSON as the only editable source of truth.

## 2. Inputs And Outputs

| Input | Output |
| --- | --- |
| Authoring JSON | Full projection model with semantic nodes, raw nodes and relationships. |
| JSON Schema and `_semantics` | Semantic roles, titles, summaries and property panel hints. |
| Layout companion file | Expansion state, node positions and panel state. |
| User branch selection | Visible graph model with one active branch and collapsed siblings. |
| User node selection | Open property panel, selected pointer and optional JSON reveal. |

## 3. Invariants

| ID | Invariant | Enforcement |
| --- | --- | --- |
| I1 | Authoring JSON remains the source of truth. | Data edits go through JSON Patch. |
| I2 | Graph state is derived or editor-only. | Expansion/layout/panel state stored only in companion file. |
| I3 | Core stays game-agnostic. | No game IDs or Antarctica-specific branches in `packages/editor-engine`. |
| I4 | Runtime does not know editor graph state. | Static import and runtime manifest scans. |
| I5 | Semantic roles are projection metadata. | They do not become runtime manifest contract. |
| I6 | Raw JSON remains available. | JSON editor can collapse, not disappear. |
| I7 | Big manifests render bounded visible graphs. | Visible graph budget and e2e assertions. |

## 4. Execution Slices

| Slice | Goal | Main write scope | Acceptance evidence | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| P0 | Documentation and baseline evidence | ADR, TSK, matrix, service docs | Screenshot and DOM metrics captured | `git diff --check` | Done |
| P1 | Projection model v2 | `packages/editor-engine` | Full vs visible graph APIs exist | unit tests | Done |
| P2 | Semantic rules and labels | `packages/editor-engine`, adapter tests | Roles/titles inferred without game IDs | unit tests + purity scan | Done |
| P3 | Progressive expansion state | editor-engine + editor-web adapter | Branch switch collapses previous branch | tests | Done |
| P4 | React Flow custom nodes/edges | `apps/editor-web` | Distinct node types and visible semantic edges | component/e2e | Done |
| P5 | Collapsible JSON/property panels | `apps/editor-web` | Panels collapse/expand and selection opens inspector | component/e2e | Done |
| P6 | Performance hardening | editor-engine + editor-web | Antarctica initial graph <= 25 nodes | browser e2e | Done |
| P7 | Governance closeout | docs and checks | TSK handoff updated | full verification | Done |

Recommended implementation order: P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7.

Final implementation status on 2026-05-22: all slices are implemented and independently e2e-accepted. The first e2e found edge-rendering and branch-switch blockers; both were repaired and the repeat e2e passed.

## 5. Semantic Projection Matrix

| Semantic role | Detection signals | Display title | Edges |
| --- | --- | --- | --- |
| `manifest-root` | root, root definition | manifest name or file path | to top-level branches |
| `definition` | `/_definitions/*`, definition shape | definition key or `name` | definition containment |
| `scenario` | scenario/root flow collection | `title`, `name`, collection key | to steps/actions |
| `step` | step-like sequence item | `title`, `id`, index label | to actions/next steps |
| `action` | action collection item, action-like `_type` | `title`, `name`, `id` | to target/reference/condition |
| `condition` | guard/condition/branch expression | condition summary | labeled branch edges |
| `state` | state object or state extension | state key/name | state reference edges |
| `metric` | metric/stat variable definition | metric name/id | usage/reference edges |
| `ui-screen` | UI screen `_type` or schema role | screen `title` | composition and navigation |
| `ui-component` | UI component `_type` | component title/id/type | composition |
| `asset` | asset/design reference path | file name or asset id | reference edge |
| `reference` | `$ref`, local pointer string | referenced target label | references |
| `collection` | array/object group | collection key + count | expands to items |
| `property` | scalar/raw value | property key | hidden by default |

## 6. Panel State Matrix

| Panel | Default | Trigger | Collapsed affordance | Persistence |
| --- | --- | --- | --- | --- |
| Property panel | collapsed | graph node selection | inspector tab with selected title | layout companion |
| JSON editor | open or user preference | Open in JSON, diagnostics click | narrow rail with diagnostics count | layout companion |
| Diagnostics | compact bottom strip | validation error click | bottom rail | layout companion optional |

Property panel auto-open rule: selecting any visible semantic node opens the panel unless the user explicitly pinned it closed for the current session.

## 7. Validation Gates

| Gate | Command/check | Blocks |
| --- | --- | --- |
| Core verification | `npm run verify:editor-engine` | Projection and reverse projection regressions. |
| Editor tests | `npm test --workspace @cubica/editor-web` | Panel state and adapter regressions. |
| Editor build | `npm run verify:editor-web` | Next.js/typecheck regressions. |
| Authoring governance | `npm run verify:manifest-authoring` | Compiler/runtime authoring drift. |
| Structure index | `node scripts/dev/generate-structure.js` | Stale repository structure after new docs. |
| Diff hygiene | `git diff --check` | Whitespace/format issues. |
| Runtime purity | `rg -n "editor-engine" apps/player-web services/runtime-api` | Editor leakage into runtime/player. |
| Game-specific scan | `rg -ni "antarctica|teamSelection" packages/editor-engine apps/editor-web/src apps/editor-web/app` | Game-specific editor core/UI branch. |
| Runtime leakage | `rg -n "_source_trace|editor\\.layout" games/*/game.manifest.json games/*/ui/*/ui.manifest.json` | Editor-only data in generated manifests. |

## 8. E2E Checklist

Run against:

```text
http://127.0.0.1:3002/?gameId=antarctica&file=game.authoring.json
http://127.0.0.1:3002/?gameId=antarctica&file=ui/web.authoring.json
```

Assertions:

- initial canvas renders <= 25 visible nodes;
- initial canvas has meaningful top-level branch labels;
- expanding a branch increases node count but stays <= 60;
- selecting another branch collapses the previous branch;
- at least one semantic edge renders after branch expansion;
- property panel starts collapsed and opens on graph node selection;
- property panel collapse button hides it without clearing selected node;
- JSON editor collapse increases graph width;
- Open in JSON expands JSON editor and reveals selected pointer;
- no browser console errors except optional favicon 404;
- graph click does not time out in Playwright.

Screenshots:

- before screenshot already captured at `.tmp/antarctica-editor-current-20260522-1440x1000.png`;
- after screenshots should use timestamped `.tmp/editor-progressive-graph-*.png` names.

## 9. Risks

| Risk | Impact | Control |
| --- | --- | --- |
| Semantic inference becomes game-specific. | Platform purity violation. | Use schema/path/type rules, not game IDs. |
| Progressive disclosure hides too much. | Author loses orientation. | Keep breadcrumbs and collapsed branch summaries. |
| Edges become visually noisy. | Graph remains unreadable. | Render semantic edges only; raw containment edges muted or hidden. |
| Panel auto-open annoys technical users. | Slower JSON workflow. | Allow explicit collapse and remember session/layout state. |
| Performance budget still missed. | Antarctica remains slow. | Visible graph budget and Playwright interaction timing. |

## 10. Handoff Checklist

- ADR-035 is read before implementation.
- Current before screenshot and metrics are referenced in the task.
- `packages/editor-engine` changes stay framework-free.
- `apps/editor-web` uses React Flow custom `nodeTypes` and `edgeTypes` rather than default nodes.
- No arbitrary first-N node slicing remains in default graph path.
- Raw property nodes are hidden by default.
- E2E proves branch switching collapses previous branch.
- Documentation is updated after implementation with actual screenshots and command results.
