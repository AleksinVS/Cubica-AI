# Execution Matrix: Editor Engine JSON Tree View

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Inputs And Outputs](#2-inputs-and-outputs)
- [3. Non-Negotiable Invariants](#3-non-negotiable-invariants)
- [4. Execution Slices](#4-execution-slices)
- [5. Tree Projection Matrix](#5-tree-projection-matrix)
- [6. Validation Gates](#6-validation-gates)
- [7. Risk Register](#7-risk-register)
- [8. Handoff Checklist](#8-handoff-checklist)

## 1. Purpose

This matrix turns `docs/tasks/archive/TSK-20260522-editor-engine-json-tree-view.md` into bounded execution slices.

The goal is to add the missing JSON tree editing mode to the ADR-034 editor architecture without creating a second document state beside authoring JSON.

## 2. Inputs And Outputs

| Area | Input | Editor output | Runtime output |
| --- | --- | --- | --- |
| Game authoring | `games/<id>/authoring/game.authoring.json` | tree model, tree UI state, JSON Patch edits | generated `game.manifest.json` through existing compiler |
| UI authoring | `games/<id>/authoring/ui/<channel>.authoring.json` | tree model, tree UI state, JSON Patch edits | generated `ui.manifest.json` through existing compiler |
| Schemas | `docs/architecture/schemas/*.schema.json` | action availability, labels, diagnostics | none |
| Layout sidecars | `editor.layout.json` and `ui/<channel>.layout.json` | optional tree collapse/search preferences | none |

## 3. Non-Negotiable Invariants

| ID | Invariant | Enforcement |
| --- | --- | --- |
| I1 | Authoring JSON remains the only editable source of truth. | Tree callbacks call DocumentStore/editor-engine, never mutate saved data directly. |
| I2 | Tree view is pointer-complete. | Every row has JSON Pointer tests, including escaped keys and arrays. |
| I3 | Core editor-engine stays game-agnostic. | No game IDs, Antarctica-specific labels or concrete game entity branches. |
| I4 | JSON Schema stays structural SSOT. | Actions are derived from schema metadata and JSON shape; no TypeScript-only schema replacement. |
| I5 | Tree UI state is editor-only. | Runtime manifest leakage scan after compile. |
| I6 | Existing graph/Monaco UX must not regress. | E2E covers Graph, Tree and JSON tabs together. |

## 4. Execution Slices

| Slice | Goal | Main Write Scope | Acceptance Evidence | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| E0 | Documentation closeout | ADR, design docs, TSK, matrix | Tri-modal target documented | `git diff --check` | Done |
| E1 | Tree model API | `packages/editor-engine` | `TreeViewModel` generated from JSON pointers | `verify:editor-engine` | Done |
| E2 | Library spike | task handoff + package metadata if needed | Custom renderer choice documented (no new deps) | focused UI smoke | Done |
| E3 | Tree view shell | `apps/editor-web` | `Tree` view appears beside Graph/JSON | editor-web tests | Done |
| E4 | Selection sync | editor-web adapter/workspace | tree, graph, panel and Monaco share pointer selection | component tests + e2e | Done |
| E5 | Tree search/collapse | editor-web | search and collapse state work (UI-only state) | e2e + scans | Done |
| E6 | Writable tree edits | editor-engine + editor-web | safe scalar `set value` produces JSON Patch via reverse projection | unit + browser tests | Done |
| E7 | Governance closeout | docs and checks | handoff updated; screenshots/e2e evidence captured | full validation gate | Done |

Active orchestration result: after the implementation worker completed E1-E6, a separate e2e/testing subagent ran Tree mode checks. The first run exposed missing Graph highlight after Tree selection; after the UI repair, focused e2e passed with result `.tmp/editor-tree-focused-20260522-235137.json`.

## 5. Tree Projection Matrix

| JSON shape | Tree role | Required pointer behavior | First edit support |
| --- | --- | --- | --- |
| Document root | `document` | `/` or empty root pointer normalized consistently | read-only metadata edits later |
| Object | `object` | child pointers escape `~` and `/` per JSON Pointer | deferred (follow-up) |
| Array | `array` | child pointers use stable current index and refresh after reorder | deferred (follow-up) |
| String/number/boolean/null | `scalar` | pointer selects value range in Monaco | set value |
| `$ref` or local pointer string | `reference` | value pointer routes to graph reference when available | connect/disconnect later if compatible |
| Schema deprecated/readOnly field | `schema-annotated` | pointer carries read-only/deprecated state | disable edit with diagnostic |
| Diagnostic target | `diagnostic` | pointer maps to tree row and text range when possible | suggested fix later |

## 6. Validation Gates

| Gate | Command or Check | Blocks |
| --- | --- | --- |
| Diff hygiene | `git diff --check` | Markdown and whitespace drift. |
| Structure index | `node scripts/dev/generate-structure.js` | Stale `PROJECT_STRUCTURE.yaml` after new task artifact directory. |
| Core verification | `npm run verify:editor-engine` | Broken JSON Pointer, patch or tree model behavior. |
| Editor web verification | `npm test --workspace @cubica/editor-web` and `npm run verify:editor-web` | UI integration regressions. |
| Authoring verification | `npm run verify:manifest-authoring` | Broken authoring/generated relation. |
| Runtime purity scan | `rg -n "editor-engine" apps/player-web services/runtime-api` | Runtime/player imports editor code. |
| Runtime leakage scan | `rg -n "_source_trace|editor\\.layout" games/*/game.manifest.json games/*/ui/*/ui.manifest.json` | Editor-only state in generated manifests. |
| Game-specific scan | `rg -ni "teamselection|teamSelection|TeamSelection|antarctica" packages/editor-engine apps/editor-web/src apps/editor-web/app` | Game-specific logic in editor core/UI. |

## 7. Risk Register

| Risk | Impact | Control |
| --- | --- | --- |
| Open-source tree component mutates data internally. | DocumentStore loses source-of-truth control. | Use controlled adapter and reject direct mutation as saved state. |
| Pointer paths are not stable after rename/reorder. | Selection and diagnostics jump to wrong node. | Rebuild tree from DocumentStore after each accepted patch. |
| Tree duplicates property panel functionality poorly. | UI becomes cluttered and confusing. | Tree owns navigation/structure; property panel owns schema-guided forms. |
| Large files render too many rows. | Antarctica editor slows down again. | Collapse deep branches by default and render visible rows only if needed. |
| Schema action rules are guessed imperatively. | Declarative contract drift. | Derive action availability from JSON Schema and editor projection metadata. |

## 8. Handoff Checklist

- ADR-034 includes JSON tree as target mode.
- Service design doc explains tree role and boundaries.
- Chosen tree library or custom renderer is documented with reason.
- Tree model unit tests cover escaped JSON Pointer keys.
- Tree selection sync e2e covers Graph, Tree, JSON and property panel together. Evidence: `.tmp/editor-tree-focused-20260522-235137.json`.
- Generated runtime manifests are scanned for editor-only state.
- `NEXT_STEPS.md` and this matrix are updated after implementation and e2e.
