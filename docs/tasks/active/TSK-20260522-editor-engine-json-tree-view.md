# TSK-20260522-editor-engine-json-tree-view: JSON Tree View For Editor Engine

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Current State](#current-state)
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

implemented-e2e-accepted (2026-05-22)

## Understanding

Задача понята так: исходный план editor-engine включал три способа редактирования JSON - flow-chart, дерево и текстовый редактор. До этого среза были реализованы flow-chart, Monaco/JSON text editor и property panel, но отсутствовал JSON Tree view как полный иерархический обзор authoring JSON.

JSON tree view - это древовидное представление JSON-документа: пользователь видит объекты, массивы и значения как раскрываемую иерархию, выбирает любой JSON Pointer и выполняет безопасные структурные операции. Tree view должен работать через тот же DocumentStore, что flow-chart, Monaco и property panel.

## Current State

Реализовано:

- `packages/editor-engine` уже хранит parsed JSON, JSON Pointer helpers, JSON Patch helpers, diagnostics и graph projection.
- `apps/editor-web` уже синхронизирует selection между React Flow, property panel and Monaco.
- Progressive graph intentionally hides raw property nodes and sibling branches, so users need a full-structure view that is not raw text.
- JSON Tree view добавлен как третий целевой режим редактирования JSON рядом с flow-chart и Monaco/text editor.

Не реализовано:

- persist collapse/expand state дерева в layout sidecar (отложено как низкорисковое улучшение);
- структурные операции дерева `add/remove/rename/reorder` (отложено, чтобы не ослабить schema/pointer guarantees);
- schema-aware structural actions для дерева после scalar edit subset.

Context7 documentation review on 2026-05-22:

- `json-edit-react` provides collapse control, custom buttons, edit callbacks, custom node definitions and Ajv validation examples.
- `@uiw/react-json-view/editor` provides editable tree rendering, controlled collapse/expand behavior, display options and edit rejection callbacks.
- Итог выбора: выбран **кастомный tree renderer** поверх `TreeViewModel`, чтобы гарантировать pointer control и отсутствие library-owned mutable JSON state (в соответствии с ADR-034).

## Architecture Baseline

Work is governed by:

- ADR-025: JSON Schema remains the structural source of truth.
- ADR-030: authoring manifests are edited and compiled into generated runtime manifests.
- ADR-034: target editor architecture has flow-chart, JSON tree, JSON text editor and property panel over one DocumentStore.
- ADR-035: graph view uses progressive disclosure and intentionally hides raw details from the canvas.

Relevant code entry points:

- `packages/editor-engine/src/index.ts`;
- `apps/editor-web/src/lib/editor-web-adapter.ts`;
- `apps/editor-web/src/components/editor-workspace.tsx`;
- `apps/editor-web/app/globals.css`.

## Scope

In scope:

- add a framework-agnostic `TreeViewModel` builder to `@cubica/editor-engine`;
- make every tree node addressable by JSON Pointer;
- attach diagnostics and schema metadata to tree nodes where available;
- add `Tree` view to `apps/editor-web` next to `Graph` and `JSON`;
- synchronize tree selection with graph selection, property panel and Monaco pointer reveal;
- support collapse/expand state, search and keyboard-friendly navigation;
- route tree edits through editor intents or JSON Patch;
- support the first safe edit subset: scalar `set value` through the existing patch path;
- keep collapse/search state UI-only in this slice; persist it to editor-only layout companion files only in a follow-up with an explicit layout schema;
- add unit, component and e2e checks.

## Non-Goals

Not in this slice:

- replacing React Flow graph or Monaco;
- turning tree view into a separate saved document format;
- adding game-specific tree node types or Antarctica-only shortcuts;
- editing JSON Schema through the tree;
- full collaborative editing or AI patch review;
- arbitrary drag-and-drop between incompatible collections.

## Requirements

### R1. One Source Of Truth

Tree view must read from DocumentStore and write through DocumentStore patches or editor intents. It must not own a separate mutable JSON object.

### R2. Pointer-Complete Tree

Every visible tree node must carry a valid JSON Pointer. Selection, diagnostics and edits are routed by that pointer.

### R3. Schema-Aware Actions

Add/remove/rename/reorder actions must be enabled only when schema metadata and current JSON shape make the operation safe.

### R4. Cross-View Selection

Selecting a tree node selects the same pointer in property panel, reveals it in Monaco and highlights the matching graph node if the pointer is represented in graph projection.

### R5. Diagnostics Routing

Syntax, schema, semantic, compile and runtime diagnostics should be visible in tree nodes when they have an authoring pointer.

### R6. Controlled Open-Source Adapter

If `json-edit-react` or `@uiw/react-json-view/editor` is used, wrap it behind an internal adapter. Library callbacks must return accepted/rejected intents; library-local mutation is not accepted as document state.

### R7. No Runtime Leakage

Tree collapse state and UI preferences stay in editor-only layout files and never compile into runtime manifests.

### R8. Performance Budget

Initial tree render for Antarctica authoring files must remain interactive. Large branches should start collapsed and search should not require rendering every scalar row at once.

## Execution Plan

### Phase 0. Design Closeout

1. Update ADR-034 and service design doc to make JSON tree view a required target mode.
2. Create this TSK and execution matrix.
3. Update `NEXT_STEPS.md`, `PROJECT_ARCHITECTURE.md` and `services/game-editor/DEV_GUIDE.md`.

### Phase 1. Tree Model

1. Add `TreeViewNode`, `TreeViewModel` and builder API to `packages/editor-engine`.
2. Reuse JSON Pointer helpers and diagnostics routing.
3. Add unit tests for objects, arrays, scalar values, escaped keys and diagnostics.

### Phase 2. Library Spike

1. Compare `json-edit-react` and `@uiw/react-json-view/editor` against pointer control, edit callbacks, collapse control, accessibility and bundle impact.
2. Pick the adapter path or document why a custom renderer is needed.
3. Record the final choice in this TSK handoff log.

### Phase 3. Editor Web Integration

1. Add `Tree` tab/view without breaking current graph and JSON layouts.
2. Wire selection sync tree -> DocumentStore -> graph/property/Monaco.
3. Add collapse/search UI and persist tree state in layout companion file when safe.

### Phase 4. Writable Tree Operations

1. Implement set value through existing JSON Patch path.
2. Defer add/remove using existing reverse projection until tree-specific schema action metadata is explicit.
3. Defer rename object key and reorder array item until pointer stability and schema checks are designed.
4. Reject unsupported operations by not exposing actions in the tree UI.

### Phase 5. Verification And E2E

1. Add editor-engine and editor-web tests.
2. Run a dedicated e2e subagent after implementation.
3. Verify Antarctica game authoring, web UI authoring and telegram UI authoring files.
4. Run static purity and runtime leakage scans.

## Acceptance

| Criterion | Expected result |
| --- | --- |
| Tree view exists. | `apps/editor-web` exposes a `Tree` view next to `Graph` and `JSON`. |
| Tree is pointer-complete. | Every tree row maps to JSON Pointer and can reveal the same pointer in Monaco. |
| Cross-view sync works. | Tree selection opens property panel and highlights matching graph node when available. |
| Diagnostics are visible. | Pointer diagnostics appear on matching tree rows. |
| Safe tree edits work. | Минимальный набор: scalar `set value` обновляет authoring JSON через reverse projection -> JSON Patch. Структурные операции отложены и явно описаны в handoff. |
| Unsafe edits are rejected. | Для реализованных операций: reverse projection возвращает diagnostics и не мутирует документ. |
| State is editor-only. | Tree collapse/search/layout state does not appear in generated runtime manifests. |
| Runtime purity remains. | Runtime-api and player-web do not import tree/editor-engine UI code. |
| E2E passes. | Separate browser e2e confirms tree workflow for Antarctica authoring files. |

## Validation

Required checks:

```text
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
npm run verify:manifest-authoring
node scripts/dev/generate-structure.js
git diff --check
```

Required static scans:

```text
rg -n "editor-engine" apps/player-web services/runtime-api
rg -n "_source_trace|editor\\.layout" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
rg -ni "teamselection|teamSelection|TeamSelection|antarctica" packages/editor-engine apps/editor-web/src apps/editor-web/app
```

Required e2e assertions:

- editor opens with `Graph`, `Tree` and `JSON` views available;
- selecting a tree row opens property panel;
- `Open in JSON` from tree selection reveals the same pointer in Monaco;
- selecting a graph node selects or reveals the matching tree row;
- collapsed JSON/property panels do not block tree interaction;
- tree search finds a known `_type`, `id` or title in Antarctica authoring files;
- safe tree value edit changes Monaco text and dirty state;
- generated runtime manifests contain no tree/editor-only state.

## Artifacts

- `docs/architecture/adrs/034-editor-engine-authoring-manifest-editor.md`
- `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`
- `docs/tasks/artifacts/TSK-20260522-editor-engine-json-tree-view/execution-matrix.md`

## Handoff Log

### 2026-05-22 - Documentation Gap Analysis

- User pointed out that the original plan had three JSON editing modes: flow-chart, tree and text editor.
- Current implementation has flow-chart and Monaco/text editor, plus property panel, but no JSON tree view.
- ADR-034 and service design docs were updated to make tree view an explicit target mode.
- This follow-up implementation task was created so the gap is visible and executable rather than hidden in generic deferred work.

### 2026-05-22 - Implementation Completed (worker)

- `@cubica/editor-engine`: добавлен `TreeViewModelBuilder` + `buildTreeViewModel`, pointer-complete tree (RFC 6901 escaping), diagnostics attachment, базовые action hints.
- `@cubica/editor-web`: `createEditorViewModel` теперь включает `tree` и `documentDiagnostics`; добавлен `Tree` режим рядом с `Graph` и существующим Monaco JSON panel.
- Tree selection синхронизирует property panel; действие `Open in JSON` раскрывает JSON panel и делает reveal по тому же pointer.
- Поиск по ключам/значениям/типам/id/title реализован в tree UI.
- Collapse/expand хранится как UI state в React и **не** пишется в layout sidecar в этом срезе.
- Safe edits: реализован только scalar `set value` через existing patch path; `add/remove/rename/reorder` отложены как follow-up.

### 2026-05-22 - E2E Accepted And Graph Highlight Repair

- Dedicated e2e subagent first confirmed Tree search/collapse/property/Open in JSON/scalar edit, and exposed that Tree -> Graph selection did not visually mark the selected React Flow node.
- UI repair: projected React Flow nodes now receive controlled `selected` state from the shared selected graph node id, so Tree selection both reveals the branch and highlights the matching graph node.
- Focused e2e subagent passed after the repair:
  - result JSON: `.tmp/editor-tree-focused-20260522-235137.json`;
  - screenshots: `.tmp/screenshots/editor-tree-focused-game-authoring-20260522-235137.png`, `.tmp/screenshots/editor-tree-focused-ui-web-authoring-20260522-235137.png`;
  - confirmed Tree search, UI-only collapse, property panel, Open in JSON, scalar edit and Graph selected-node highlight;
  - console errors: none.
