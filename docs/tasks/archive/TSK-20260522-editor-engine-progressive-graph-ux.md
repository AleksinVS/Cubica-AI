# TSK-20260522-editor-engine-progressive-graph-ux: Progressive Semantic Graph UX

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Current UI Evidence](#current-ui-evidence)
- [Problem Statement](#problem-statement)
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

implemented-e2e-accepted

## Understanding

Задача понята так: текущий editor-engine уже умеел открыть authoring-манифест, но прежний flow-chart был непригоден как рабочее представление. Этот UX-срез реализован: диаграмма раскрывается поэтапно, использует semantic node types, показывает понятные названия узлов и поддерживает сворачиваемые JSON/property panels.

Реализация выполнена Codex worker-субагентом, затем проверена отдельным e2e-субагентом. Первый e2e нашел два blocker-а, repair worker их исправил, повторный e2e прошел.

## Current UI Evidence

Снятые артефакты текущего Antarctica editor UI:

- screenshot: `.tmp/antarctica-editor-current-20260522-1440x1000.png`;
- DOM metrics: `.tmp/antarctica-editor-current-20260522-metrics.json`;
- accessibility snapshot: `.tmp/antarctica-editor-current-20260522-snapshot.md`.

Факты из DOM metrics:

| Metric | Value |
| --- | --- |
| Viewport | `1440 x 1000` |
| Loaded document | `antarctica/game.authoring.json` |
| React Flow nodes | `120` |
| Visible nodes | `120` |
| React Flow edges | `0` |
| Distinct node roles | `document`, `property`, `object`, `definition`, `collection` |
| JSON editor width | about `605px` |
| Graph width | about `834px` |

UI observations:

- all graph nodes are rendered at once;
- edges are absent in the rendered React Flow DOM;
- labels show `role + label + JSON Pointer` rather than semantic names;
- visual difference between roles is a thin left border only;
- property panel opens over the graph even when selected node is only the document root;
- JSON editor permanently consumes the right side of the workspace;
- Playwright click on a visible graph node timed out after pointer interception, which is an interaction risk for dense graphs.

## Problem Statement

Текущая диаграмма is a JSON tree preview, not an authoring flow-chart.

Root causes:

- `apps/editor-web` renders `viewModel.nodes.slice(0, 120)` instead of a semantic visible graph.
- Raw property nodes are first-class canvas nodes, so high-value scenario/action/UI nodes drown in scalar fields.
- Edges are filtered by the sliced node set; on large documents this leaves zero rendered edges.
- `type: "default"` is used for all React Flow nodes, so semantic roles are not visible.
- Inline JSX labels are generated for every node every render, increasing React work.
- JSON editor and property panel have no collapsed states, so the graph never gets enough workspace.

## Architecture Baseline

Work is governed by:

- ADR-025: JSON Schema remains the structure source of truth.
- ADR-030: authoring JSON compiles into runtime JSON.
- ADR-034: editor-engine is a projection editor; authoring JSON remains source of truth.
- ADR-035: progressive semantic graph UX for editor-engine.

Code entry points:

- `packages/editor-engine/src/index.ts`;
- `apps/editor-web/src/lib/editor-web-adapter.ts`;
- `apps/editor-web/src/components/editor-workspace.tsx`;
- `apps/editor-web/app/globals.css`.

## Scope

In scope:

- introduce semantic projection metadata in `@cubica/editor-engine`;
- split full projection from visible graph projection;
- add progressive disclosure state: active branch, expanded nodes and collapsed nodes;
- collapse previous branch when user selects another branch;
- hide raw property nodes from the default canvas;
- show semantic node labels from `title`, `name`, `displayName`, `id`, `_type`, `_semantics` and schema/projection rules;
- add custom React Flow node and edge renderers;
- render non-zero semantic edges where relationships exist;
- make JSON editor collapsible;
- make property panel collapsible and auto-open on graph node selection;
- keep property panel floating by default, with docked mode optional;
- add e2e checks and screenshot evidence for Antarctica.

## Non-Goals

Not in this slice:

- changing authoring JSON format;
- adding game-specific branches for Antarctica in core editor-engine;
- replacing Monaco;
- building collaborative editing;
- changing runtime-api/player-web contracts;
- implementing a full schema editor;
- removing raw JSON editing.

## Requirements

### R1. Progressive Visible Graph

Canvas must render a visible graph derived from expansion state, not the first N nodes of the full projection.

### R2. Branch Switching Collapses Previous Branch

When a user selects a node in another top-level branch, the previously active branch must collapse into a summary node.

### R3. Semantic Nodes

Nodes must carry `semanticRole`, `semanticTitle`, `semanticSummary` and `presentationRole`. These are editor metadata derived from authoring content and schemas.

### R4. Differentiated Node Rendering

At minimum, `manifest-root`, `definition`, `collection`, `action`, `condition`, `state`, `metric`, `ui-screen`, `ui-component`, `reference` and `property` must have visibly different presentation.

### R5. Meaningful Labels

Graph labels must prefer author-facing labels over JSON Pointer paths. Pointer remains available as secondary metadata or tooltip.

### R6. Collapsible JSON Editor

JSON editor can collapse to a narrow rail. "Open in JSON" expands it and reveals the selected pointer.

### R7. Collapsible Property Panel

Property panel is collapsed by default, opens when a graph node is selected, and can be collapsed without clearing selection.

### R8. Performance Budget

Initial Antarctica visible graph should render no more than 25 nodes. Expanded branch should stay below 60 nodes unless user explicitly opens raw/debug view.

### R9. Runtime Purity

Runtime-api and player-web must not import editor-engine projection code and must not understand editor-only graph state.

## Execution Plan

### Phase 0. Documentation And Guardrails

1. Create ADR-035.
2. Create this TSK and execution matrix.
3. Update service design doc and project architecture index.
4. Record current UI screenshot and DOM metrics.

### Phase 1. Projection Model v2

1. Add semantic metadata types to `packages/editor-engine`.
2. Preserve existing projection API or provide compatibility adapter.
3. Add full projection model with all semantic nodes and raw nodes.
4. Add visible graph projection function driven by expansion state.
5. Add unit tests for Antarctica-like and simple-choice-like fixtures.

### Phase 2. Semantic Rules And Labels

1. Implement game-agnostic role inference from `_type`, `_semantics`, schema pointer, collection path and label fields.
2. Implement semantic title fallback chain.
3. Add relationship extraction for references and scenario/UI composition.
4. Ensure raw property nodes are hidden by default but remain addressable.

### Phase 3. Progressive Disclosure UX

1. Add `activeBranchRootId`, `expandedNodeIds` and `collapsedNodeIds` to editor state.
2. Selecting another branch collapses sibling branches.
3. Add expand/collapse affordances on collection and semantic branch nodes.
4. Keep selected pointer synchronized with Monaco and property panel.

### Phase 4. Custom React Flow Rendering

1. Add custom `nodeTypes`.
2. Add custom `edgeTypes`.
3. Make node styling role-specific and readable at normal zoom.
4. Remove arbitrary `slice(0, 120)` from default path.
5. Enable React Flow visible-element optimization where useful.

### Phase 5. Collapsible Panels

1. Add JSON panel open/collapsed state.
2. Add property panel open/collapsed/pinned state.
3. Selecting graph node opens property panel.
4. "Open in JSON" expands JSON editor and reveals pointer.
5. Persist panel state in layout companion file when safe.

### Phase 6. Verification And E2E

1. Add unit tests for projection and expansion.
2. Add editor-web tests for panel state.
3. Run browser e2e against Antarctica.
4. Capture before/after screenshots in `.tmp/`.
5. Run static purity scans.

## Acceptance

| Criterion | Expected result |
| --- | --- |
| Initial Antarctica graph is usable. | <= 25 visible nodes, non-zero semantic branches, no raw scalar flood. |
| Branch selection collapses previous branch. | Selecting another branch changes active branch and hides sibling internals. |
| Graph shows relationships. | Visible semantic edges render when source and target are visible. |
| Node types are visually distinct. | Different semantic roles have different shape/color/layout, not only a thin border. |
| Node labels are semantic. | Main label uses `title/name/displayName/id/_type` fallback, pointer is secondary. |
| JSON editor collapses. | User can hide/show JSON editor; diagnostics and Open in JSON still work. |
| Property panel collapses. | Default collapsed; selecting graph node opens it automatically. |
| Performance improves. | Browser e2e confirms no interaction timeout on ordinary node selection. |
| Source of truth is preserved. | Visual state writes only layout companion file; authoring data edits use JSON Patch. |
| Runtime purity preserved. | Static scans show no editor-engine imports in runtime/player. |

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

- Antarctica editor opens without blank canvas;
- initial graph has <= 25 visible nodes;
- graph has at least one visible edge after expanding a branch with relationships;
- selecting a node opens property panel;
- collapsing property panel hides inspector without clearing selection;
- collapsing JSON editor increases canvas width;
- Open in JSON expands JSON editor and reveals pointer;
- branch switch collapses the previous branch.

## Artifacts

- `docs/architecture/adrs/035-editor-engine-progressive-semantic-graph-ux.md`
- `docs/tasks/artifacts/TSK-20260522-editor-engine-progressive-graph-ux/execution-matrix.md`
- `.tmp/antarctica-editor-current-20260522-1440x1000.png`
- `.tmp/antarctica-editor-current-20260522-metrics.json`
- `.tmp/antarctica-editor-current-20260522-snapshot.md`
- `.tmp/editor-progressive-graph-e2e-rerun-selection-report-2026-05-22T11-03-50-478Z.json`
- `.tmp/editor-progressive-graph-rerun-game-authoring-2026-05-22T11-03-50-478Z.png`
- `.tmp/editor-progressive-graph-rerun-ui-web-authoring-2026-05-22T11-03-50-478Z.png`

## Handoff Log

### 2026-05-22 - Design Start

- User reported current graph UX is unusable: too many nodes, no edges, no semantics, uniform node visual style and slow interaction.
- Captured current Antarctica editor screenshot and DOM metrics before the host process stopped.
- Context7 React Flow docs reviewed for custom node types, custom edges and visible-element optimization.
- ADR-035, this TSK and execution matrix created for the next implementation slice.

### 2026-05-22 - Implementation Handoff

- Implemented full vs visible semantic graph projection in `packages/editor-engine`; raw property nodes remain addressable but hidden from the default canvas.
- Wired `apps/editor-web` to render the visible projection through custom React Flow node and edge types, with active-branch expansion state instead of arbitrary full-graph slicing.
- Added collapsible JSON and property panels; graph selection opens the property panel, and Open in JSON expands Monaco and reveals the selected pointer.
- Verification completed: editor-engine verify, editor-web tests/build, manifest-authoring verify, diff check, and runtime purity scans passed.
- Browser e2e was intentionally left for the separate e2e acceptance subagent.

### 2026-05-22 - E2E Attempt 1 Failed

- Separate e2e subagent tested `antarctica/game.authoring.json` and `antarctica/ui/web.authoring.json`.
- Passed checks:
  - initial visible nodes were `3`;
  - branch labels were meaningful;
  - expansion stayed within budget (`3 -> 15` and `3 -> 22`);
  - JSON/property panels collapsed and expanded correctly;
  - basic graph click did not time out.
- Blockers found:
  - semantic edges existed in the toolbar count but did not render in DOM;
  - after branch expansion, selecting another branch was intercepted by the JSON panel.

### 2026-05-22 - Repair Complete

- Repair worker fixed both blockers in `apps/editor-web/src/components/editor-workspace.tsx` and `apps/editor-web/app/globals.css`.
- Root causes:
  - React Flow could not build stable edge positions for custom nodes without explicit handles/positions/sizes;
  - expanded graph layout could place nodes under the JSON panel.
- Fixes:
  - added explicit node handles, `sourcePosition`, `targetPosition`, width and height;
  - added React Flow instance ref and `fitView` after visible graph and panel state changes;
  - changed layout to a depth-aware grid;
  - added graph surface overflow control and panel stacking.
- Verification passed:
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `git diff --check`;
  - runtime purity and editor-only leakage scans.

### 2026-05-22 - E2E Accepted

- Repeat independent e2e passed on `http://127.0.0.1:3002`.
- `game.authoring.json`:
  - initial visible nodes: `3`;
  - expand: `3 -> 15`;
  - edge DOM after expand: `24` edge elements;
  - branch switch collapsed previous branch: `15 -> 12`;
  - graph click timing: `1850ms`.
- `ui/web.authoring.json`:
  - initial visible nodes: `3`;
  - expand: `3 -> 22`;
  - edge DOM after expand: `36` edge elements;
  - branch switch collapsed previous branch: `22 -> 12`;
  - graph click timing: `1207ms`.
- Additional passed assertions:
  - meaningful branch labels;
  - property panel starts collapsed, opens on graph selection and can collapse without clearing selection;
  - JSON collapse increases graph width from `835px` to `1384px`;
  - Open in JSON expands Monaco and reveals pointer;
  - no console errors;
  - no `games/*/authoring` layout sidecar side effects remained.
- Command checks passed:
  - `npm run verify:editor-engine` (`17` tests);
  - `npm test --workspace @cubica/editor-web` (`18` tests);
  - `npm run verify:editor-web`;
  - `git diff --check`;
  - runtime purity and editor-only leakage scans.
