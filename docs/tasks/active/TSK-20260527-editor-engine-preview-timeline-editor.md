# TSK-20260527-editor-engine-preview-timeline-editor: Preview-Timeline Editor Redesign

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Baseline](#architecture-baseline)
- [Current State](#current-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

phase-10-runtime-preview-rollback-baseline

## Understanding

Задача понята так: editor-engine нужно переосмыслить не как flow-chart редактор, а как preview-first редактор authoring-манифестов. Разработчик игры должен проходить игру в окне предпросмотра, видеть timeline прохождения, выбирать визуальные и невизуальные сущности, редактировать свойства/JSON или формулировать AI prompt рядом с выбранным объектом.

Flow-chart остается возможной вторичной проекцией для анализа связей, но больше не является главным рабочим экраном.

## Architecture Baseline

Работа опирается на:

- ADR-025: JSON Schema остается source of truth для структуры манифестов.
- ADR-030: authoring-манифесты компилируются в runtime game/UI manifests.
- ADR-034: editor-engine работает через DocumentStore, JSON Patch, tree/text/property representations and validation.
- ADR-036: semantic authoring structure and preview-timeline editor become the next target architecture.
- ADR-037: user-editable plugins are project-local now and marketplace-safe later.
- ADR-040: runtime-api extension policy is manifest-first; functionality tied to one concrete game is forbidden in generic `runtime-api`.
- `services/game-editor/docs/editor-engine-preview-timeline-editor.md`: проектный контекст UX, renderer adapter, timeline and AI prompt surface.

Ключевое правило: preview state, timeline traces and editor layout are tooling-only. They must not become runtime manifest data.

## Current State

Уже реализовано:

- `packages/editor-engine`: DocumentStore, JSON Pointer/JSON Patch helpers, graph/tree projections, validation diagnostics and reverse projection.
- `apps/editor-web`: preview-first workspace shell, iframe preview bridge, semantic entity tree, React Flow secondary projection, JSON Tree view, Monaco/JSON editor, floating property panel, session-backed authoring file workflow, compile/preview actions.
- progressive semantic graph UX from ADR-035.
- iframe preview selection baseline and AI intent queue from Phase 6/7.
- automatic AI ChangeSet apply baseline from Phase 8: engine dry-run/inverse patch helpers, local scoped AI patch planner route, automatic JSON Patch apply, undo/redo journal and plain-language diff summary in the editor.
- Project Git Workspace foundation from Phase 9: session worktree helper, Save commit helper, restore-commit rollback helper, generated-artifact allowlist policy and plugin ChangeSet boundary validation.
- Session-backed editor file workflow baseline: editor-web opens a Git worktree session, reads authoring files/layouts through that session, and Save writes to the session worktree and creates a Git commit.
- Session-aware validation/compile baseline: editor-web sends `sessionId` to validate/compile/preview routes; validation and compile load the authoring compiler from the session worktree so generated manifests are written there, not into the main checkout.
- Session-aware preview runtime baseline: runtime-api can register a temporary `contentSourceId` backed by an editor worktree, runtime sessions remember that source, player-web loads PlayerFacingContent with the same source, and editor preview URLs include `contentSourceId`.
- Multi-service browser e2e baseline: Playwright can launch runtime-api, player-web and editor-web together, open an editor session, prepare preview and verify the player iframe uses the session `contentSourceId`.
- Plugin architecture decision from ADR-037: target plugins live under `games/<gameId>/plugins/<pluginId>/`; first implementation is trusted project-local `player-web` plugins with no npm dependencies; marketplace and first-class runtime-api plugins are reserved for sandboxed later evolution; Antarctica plugin must migrate to `games/antarctica/plugins/antarctica-player`.
- Runtime-api extension policy from ADR-040: new server-side mechanics must first be expressed through manifest/platform capabilities where possible; functionality tied to one concrete game is forbidden in generic `runtime-api`; trusted project runtime plugins use a separate process with a JSON protocol and separate review; marketplace plugins require a container sandbox or WebAssembly/WASI for pure computation.
- Runtime-authoritative preview rollback decision is accepted for time travel: editor preview is a debugger for server-side game logic, `runtime-api` owns preview session restore, and rollback/new play keeps one linear trace without branching.
- Preview trace persistence baseline: editor-web writes runtime timeline events and snapshots to `.tmp/editor-playthroughs/` through a server route, and rollback truncates persisted future events to keep one linear path.

Оставшиеся ограничения:

- preview-first workspace, iframe selection, overlay, object picker and region prompt exist as a baseline; deeper browser e2e for selection/prompt/time-travel flows remains follow-up;
- Phase 8 AI apply is active-authoring-file JSON only and uses a deterministic local planner until a production AI provider and repair loop are wired;
- local session preview uses a runtime content source registered from the session worktree; production player mode now uses ADR-039 published plugin bundle references instead of editor worktree code;
- plugin-aware validation now covers project/plugin boundaries, `plugin.json` schema, `platform-only` dependency policy, discovery, direct typecheck execution with timeout, preview bundle handoff, player-web hot preview reload, exact `apiVersion: "1.0"` checks, production published bundle references and a dedicated editor UI journal row for plugin diagnostics. Cleanup манифеста `Antarctica` описан отдельно, а полноценный runtime-api plugin runner зафиксирован как долг `LEGACY-0014`;
- richer timeline time-travel controls are still open beyond the initial runtime snapshot restore path;
- the preview rollback transport/state decision is accepted as Variant B in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/time-travel-rollback-options.md`: variants A/C are not target paths for server-authoritative games.
- Phaser/canvas support is documented at the renderer adapter contract level, but concrete non-DOM adapter tests remain planned.

## Scope

In scope:

- design authoring schema v2 conventions for semantic entities, `_label` and `root`-owned game/UI structure;
- design and implement renderer adapter protocol, with thin React DOM adapter as the reference first implementation;
- redesign editor layout around full-screen preview, top menu, non-visual entity toolbar, timeline, status bar, collapsible tree and Monaco rails, floating property panel;
- implement entity tree mode that hides technical fields by default;
- implement preview overlay selection, object picker and selection rectangle;
- implement manifest chronology timeline for pearl-string/linear flows;
- implement recorded playthrough trace model with event log + snapshots for nonlinear games;
- add AI prompt flow that produces bounded ChangeSets, applies them automatically after validation, records undo and shows a plain-language diff summary;
- add project Git workspace model with session worktrees, Save commits and non-destructive rollback;
- support user plugin edits through plugin-boundary ChangeSets and plugin validation gates;
- document and test Phaser/canvas adapter requirements without making Phaser a core dependency.

## Non-Goals

Not in this slice:

- replacing runtime-api with an editor runtime;
- making timeline trace a source of game logic;
- adding Phaser as a mandatory rendering engine;
- removing Monaco or full JSON access;
- implementing collaborative editing;
- applying AI changes without dry-run validation, undo journal and user-facing diff summary;
- exposing technical patch confirmation as the primary UX for non-technical users;
- hardcoding Antarctica-specific rules into editor-engine.

## Requirements

### R1. Semantic Authoring V2

Real game/UI entities must live under `root`. `_definitions` remain reusable prototypes. Semantic entities must have stable `id` where applicable and an author-facing `_label`.

### R2. Preview-First Workspace

The main workspace must prioritize game preview. Tree and Monaco are collapsible side rails; property panel is floating; status/timeline/toolbars are narrow bands.

### R3. Thin Renderer Adapter First

The first production implementation must use a thin React DOM adapter. It may read `data-editor-entity-id` and `data-authoring-pointer`, but editor-engine must depend only on renderer-neutral descriptors.

### R4. Renderer-Agnostic Contract

The adapter protocol must also support Phaser/canvas/WebGL by explicit descriptors, hit-test and bounds. Core editor-engine must not import React DOM, Phaser, canvas or renderer-specific types.

### R5. Entity Tree

Default tree mode shows semantic entities only and hides technical fields. Tree row names are resolved from `_label`; temporary display fallback to `title`, `name` or `id` is allowed, but missing `_label` remains a validation diagnostic. Scalar parameters and technical fields are edited through the property panel or Monaco, not shown as default tree nodes. Advanced full JSON tree remains available for technical debugging.

### R6. Timeline Modes

Timeline supports manifest chronology for linear flows and recorded playthrough traces for nonlinear games. Timeline rollback changes preview session state only, not authoring JSON history. Runtime-api is the authoritative restore owner for preview sessions; rollback followed by new play discards future trace events instead of branching history.

### R7. Preview Selection

Clicking preview selects the topmost entity, syncs tree/property/Monaco, draws overlay highlight and opens a small AI prompt input near the cursor. Overlapping entities show an object picker.

### R8. Region Selection

Dragging a rectangle in preview creates a region selection context with intersecting entities and optional screenshot crop for AI prompt.

### R9. AI Patch Discipline

AI prompt output must become a bounded `ChangeSet`, not a full source rewrite. The system applies it automatically only after dry-run, schema/semantic/plugin validation and undo journal recording. The user sees the result and a plain-language diff summary, then can continue, undo or save.

### R10. Runtime Purity

Runtime-api and player-web must not import editor-engine. Generated runtime manifests must not contain editor layout, playthrough traces, `_label` if not part of runtime schema, or editor overlay metadata.

### R11. Incremental Session Editing And Undo

Multiple AI patches may be applied sequentially before Save. Each patch creates a journal entry with forward and inverse ChangeSets. Undo before Save applies inverse ChangeSets in the session, not Git reset.

### R12. Project Git Workspace And Plugins

Versioning is project-scoped, not manifest-only. Each project/game has a local Git repo; each editor opening uses a session branch/worktree; Save creates a commit; saved rollback creates a new revert/restore commit. User plugins live inside the project repo and must pass plugin-specific validation when touched.

### R13. Project-Local Plugin Architecture

User-editable plugins must live under `games/<gameId>/plugins/<pluginId>/`, not under platform app source. First implementation supports trusted local `player-web` plugins only. `runtime-api` and `editor-web` plugin targets are reserved for future decisions. npm dependencies are forbidden until plugin verification exists. Preview must pick up plugin code changes without restarting `player-web`.

## Execution Plan

### Phase 0. Documentation And Guardrails

1. Keep ADR-036 and project design doc in sync.
2. Create this TSK and execution matrix.
3. Update `NEXT_STEPS.md`, `PROJECT_ARCHITECTURE.md` and `.desc.json` indexes.
4. Record a baseline inventory for current schemas, compiler entrypoints and large authoring manifests.
5. Require targeted JSON Pointer or script-based inspection for large authoring JSON files instead of direct model-context rewrites.

### Phase 1A. Authoring Schema V2 Contract And Small Fixtures

1. Define semantic entity base shape with `id`, `_type`, `_label`, `_semantics`.
2. Make `_label` the final field name for the editor-facing "Синоним".
3. Draft game authoring v2 structure: `root.meta`, `root.logic.flows`, `root.logic.systems`, `root.logic.rules`, `root.logic.actions[]`, `root.state`.
4. Draft UI authoring v2 tree structure: `root.screens[]`, screen root, component `children[]`.
5. Add compiler support for minimal v2 game/UI fixtures.
6. Validate that `_label` and other authoring-only fields do not leak into generated runtime manifests.

### Phase 1B. Full Manifest Migration To V2

1. Migrate existing authoring manifests to v2 structure.
2. Use deterministic scripts and JSON Pointer summaries for large files; do not rewrite large authoring JSON manually in model context.
3. Remove or explicitly retire temporary v1 support after migrated manifests compile and validate.
4. Confirm generated runtime manifests remain valid and editor entity tree can read semantic `_label` values from v2 manifests.

### Phase 2. Renderer Adapter Protocol

1. Define `PreviewEntityDescriptor`, point hit-test, rectangle hit-test and highlight commands.
2. Implement thin React DOM adapter as reference path.
3. Keep Phaser/canvas support as contract tests and documentation until a concrete Phaser game is in scope.

### Phase 3. Preview Workspace Shell

1. Rework `apps/editor-web` layout around preview canvas.
2. Add menu bar, non-visual entity toolbar, timeline band and status bar.
3. Convert tree and Monaco to collapsible rails.
4. Keep property panel floating and selection-driven.

### Phase 4. Entity Tree And Selection Sync

1. Define the schema/projection rule for "tree-visible semantic entity" so the editor does not rely on game-specific branches.
2. Build semantic entity outline from authoring v2 adapter and use `_label` as the primary row name.
3. Keep temporary display fallback to `title`, `name` or `id`, but emit a missing-label diagnostic for every tree-visible entity without `_label`.
4. Hide technical fields and scalar parameters by default; expose them through property panel groups, Monaco reveal and advanced full JSON tree.
5. Sync preview selection, tree, property panel and Monaco pointer.

### Phase 5. Timeline And Playthrough Trace

1. Build manifest chronology timeline for linear flows.
2. Add local `.tmp/editor-playthroughs/` trace writer for recorded playthrough.
3. Add event log + snapshot restore model.
4. Ensure rollback changes preview session only.

### Phase 6. Preview Overlay And AI Prompt

1. Add overlay frame for selected entity.
2. Add object picker for overlapping entities.
3. Add selection rectangle and region context.
4. Add AI prompt surface that captures editor intents and target pointers.

### Phase 7. Preview Selection Verification And E2E

1. Add unit tests for schema/entity projection, adapter hit-test and timeline model.
2. Add component/e2e tests for selection sync and panel behavior.
3. Run separate e2e subagent after implementation.
4. Run manifest compile/validation and runtime leakage scans.

### Phase 8. Automatic AI ChangeSet Apply And Undo

1. [x] Define `EditorPatchIntent`, `EditorChangeSet`, `PatchJournalStep`, inverse ChangeSet rules and user-facing diff summary model.
2. [x] Implement scoped context assembly for large authoring JSON baseline: selected preview entities from the active file only, no whole-manifest AI route payload.
3. [x] Add AI patch route that returns bounded ChangeSets, not full manifest rewrites. Current implementation is a deterministic local planner for simple text/label edits.
4. [x] Validate and dry-run ChangeSets before automatic apply.
5. [x] Apply accepted ChangeSets to the editor document automatically and refresh preview/tree/property/Monaco. Session worktree persistence remains Phase 9.
6. [x] Implement undo/redo for unsaved journal steps.
7. [x] Add unit tests for inverse patch correctness, failed `test` guards, dry-run output and local planner output.

Baseline limitations:

- only JSON Patch operations for the active authoring file are applied;
- text/file/plugin operations are modeled in `EditorChangeSet` but rejected by the Phase 8 dry-run gate until Phase 9;
- production AI provider integration is not added yet; the route uses a local bounded planner so the end-to-end editor contract is testable.

### Phase 9. Project Git Workspace And Plugin-Aware Save

1. [x] Introduce project repository abstraction for local Git repo, session branch and worktree lifecycle.
2. [x] Move editor file/layout open and save workflow from direct repository files to session worktree files, with legacy direct path retained as fallback when no `sessionId` is present.
3. [x] Implement Save as project commit helper with generated artifact policy allowlist. Browser Save now uses it for authoring file commits inside the session worktree.
4. [x] Implement saved rollback helper through a new restore commit, never destructive reset.
5. [x] Extend ChangeSet contract and boundary checks for user plugins: text patches, file creates/deletes/renames and plugin manifests.
6. [x] Make editor validation and generated-manifest compile session-aware by loading the shared compiler from the session worktree.
7. [x] Add session-aware runtime preview content loading: runtime-api consumes a session-scoped content root through `contentSourceId` instead of the main checkout.
8. [x] Add browser e2e coverage for the full local session preview path with runtime-api, player-web and editor-web running together.
9. [x] Add first full plugin validation gates: plugin manifest schema, dependency policy, direct `typecheck` execution with timeout and diagnostics. `build`/`test` remain reserved command names until a plugin test runner contract is added.
10. [x] Add platform purity boundary checks blocking plugin ChangeSets from touching platform core paths.
11. [x] Implement ADR-037 project-local plugin baseline: `plugin.json` schema, `games/<gameId>/plugins/<pluginId>/` discovery, no npm dependencies, command allowlist, direct process execution with timeout, player-web bundle registration and hot preview reload.
12. [x] Migrate Antarctica plugin from its former platform-local directory to `games/antarctica/plugins/antarctica-player`.

Current limitations:

- `ProjectGitWorkspace` and session file workflow are server-side/browser wired for authoring files and editor layout sidecars;
- validate/compile/session preview are session-aware for the local editor worktree path;
- browser e2e covers local editor session creation, preview compile, runtime-api `contentSourceId`, player-web iframe boot and preview metadata emission;
- runtime-api accepts editor preview content roots only through a local `.tmp/editor-worktrees/` allowlist; e2e/local runs may extend it with `EDITOR_PREVIEW_WORKTREES_ROOTS`, while production player mode uses generated published plugin bundle metadata instead of editor worktree paths;
- plugin validation now discovers `games/<gameId>/plugins/<pluginId>/plugin.json`, validates schema/dependency/path policy, runs direct `typecheck` with timeout and blocks preview/save on errors;
- Antarctica player plugin now lives in `games/antarctica/plugins/antarctica-player`; `apps/player-web/src/plugins` keeps only the public plugin API facade and bundle loader, while non-preview mode loads the generated published bundle.
- Local preview bundle handoff is implemented: editor-web builds a content-hashed session module, runtime-api carries only bundle references through `contentSourceId`, and player-web imports the module only in editor preview mode.

### Phase 10. Runtime-Authoritative Preview Rollback

1. [x] Record accepted Variant B: preview rollback restores runtime-api session state, because editor preview debugs server-side game logic.
2. [x] Add a preview-only runtime-api session restore contract guarded by editor preview `contentSourceId`.
3. [x] Add player-web preview snapshot messages containing session version, runtime state and last completed runtime action.
4. [x] Add editor-web snapshot message validation, linear trace recording and UI rollback buttons in the timeline band.
5. [x] Add editor-web server proxy route for restore calls so the browser editor does not call runtime-api directly.
6. [x] Ensure rollback truncates future trace events locally and reloads the iframe on the restored runtime session.
7. [x] Persist trace snapshots under `.tmp/editor-playthroughs/` for long sessions.
8. [ ] Add richer time-travel controls: current marker, explicit reset/replay affordances and event detail panel.
9. [x] Add browser e2e that plays a preview action, rolls back, verifies player state reverted and verifies authoring dirty state did not change.

Current limitations:

- first implementation captures a runtime snapshot for every runtime state version, so exact rollback does not need sparse replay yet;
- timeline event labels are action ids or generic runtime state labels; richer author-facing summaries remain follow-up;
- richer rollback controls are still pending, but the baseline timeline buttons already restore runtime-api preview state and discard future trace events.

## Acceptance

| Criterion | Expected result |
| --- | --- |
| Architecture documented | ADR-036, design doc, this TSK and execution matrix agree on preview-first direction. |
| Authoring v2 shape exists | Schema/design defines semantic entity base, `_label` and root-owned game/UI structures. |
| Authoring v2 fixtures compile | Minimal game/UI v2 fixtures compile into runtime-schema-valid manifests without `_label` leakage. |
| Existing manifests migrate to v2 | Existing authoring manifests use root-owned semantic entities and meaningful Cyrillic `_label` values. |
| React adapter exists | React preview objects expose renderer-neutral entity descriptors through adapter. |
| Preview is primary | Editor opens to preview workspace, not graph canvas. |
| Entity tree is semantic | Tree shows game/UI entities, uses `_label` for row names, marks `title`/`name`/`id` fallback diagnostics, hides technical fields and keeps scalar parameters in property panel by default. |
| Click selection works | Preview click selects topmost entity and syncs tree/property/Monaco. |
| Overlap picker works | Multiple hit-test results show a picker without blocking normal selection. |
| Region AI context works | Drag rectangle captures intersecting entities and prompt context. |
| Timeline works | Linear chronology is built from manifest; recorded trace can rollback preview session. |
| AI changes are automatic but controlled | AI prompt applies a bounded ChangeSet only after dry-run validation, records undo, updates editor state and shows a plain-language diff summary. |
| Incremental AI edits work | Multiple prompt patches can be applied before Save and undone one by one. |
| Project Git versioning works | Editor sessions use project worktrees; Save creates a Git commit; saved rollback creates a new commit. |
| Session compile is isolated | Validate/compile use the session worktree when `sessionId` is present and do not write generated files to the main checkout. |
| Session preview is isolated | Runtime-api/player-web use a session `contentSourceId`, so player preview reads generated manifests from the session worktree instead of stale main-checkout content. |
| Plugin edits are bounded | Plugin-touching ChangeSets stay inside project plugin directories and run plugin validation gates. |
| Project plugins are local | User-editable plugins live under `games/<gameId>/plugins/<pluginId>/`, have schema-validated `plugin.json` and do not live in platform app source. |
| Plugin preview hot reload works | Editing plugin code refreshes session preview without restarting `player-web`. |
| Runtime purity holds | Runtime/player do not depend on editor adapter; generated manifests contain no editor-only state. |

## Validation

Required checks:

```text
git diff --check
node scripts/dev/generate-structure.js
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
npm run verify:manifest-authoring
npm run verify:runtime-api
npm run verify:player-web
npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts
```

Phase 1A also requires the small fixture gate inside `validate-manifest-authoring`: `docs/architecture/schemas/examples/authoring-v2/minimal-game.authoring.json` and `minimal-ui.authoring.json` must validate as authoring v2, compile through the shared compiler and validate against runtime schemas.

Required static scans:

```text
rg -n "editor-engine" apps/player-web services/runtime-api
rg -n "_source_trace|editor\\.layout|editor-playthrough" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
rg -ni "antarctica|simple-choice|Phaser|GameObject" packages/editor-engine
```

Required e2e assertions:

- editor opens preview-first workspace;
- tree and Monaco rails collapse/expand without preview rerender stalls;
- default entity tree shows semantic game/UI entities by `_label` and does not show `$schema`, `_schemaVersion`, `_manifestType`, `_definitions` internals or raw scalar props;
- missing `_label` on a tree-visible semantic entity produces validation diagnostics while the UI may still show `title`, `name` or `id` fallback;
- selecting an entity shows its editable parameters in property panel rather than expanding them as default tree rows;
- click on preview entity selects same pointer in tree/property/Monaco;
- overlap picker exposes layered objects;
- drag rectangle opens AI prompt context;
- timeline rollback does not change authoring dirty state;
- rollback followed by continued play keeps a single linear runtime trace without duplicate branch events;
- AI prompt can apply multiple validated ChangeSets before Save;
- undo reverses unsaved AI ChangeSets without Git reset;
- user-facing diff summary appears after automatic AI apply;
- Save creates a project Git commit from a session worktree;
- validate and compile use session worktree content after a session Save;
- session preview uses the session `contentSourceId` for runtime-api session creation and player-web content loading;
- saved rollback creates a new revert/restore commit;
- plugin-touching ChangeSets run plugin validation gates;
- project-local player-web plugin changes refresh preview without restarting `player-web`;
- generated runtime manifests do not contain editor-only traces.

## Artifacts

- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md`
- `docs/architecture/adrs/037-project-local-plugins-and-marketplace-safe-evolution.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
- `docs/architecture/runtime-mechanics-language.md`
- `services/game-editor/docs/editor-engine-preview-timeline-editor.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/execution-matrix.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-manifest-cleanup.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/plugin-gap-closure-plan.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/phase-1a-v2-contract-report.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/phase-1b-v2-migration-report.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/time-travel-rollback-options.md`

## Handoff Log

### 2026-05-27 - Documentation Created

- Created ADR-036 for semantic authoring structure and preview-timeline editor.
- Created project context doc for preview-first editor UX, renderer adapter, Phaser considerations, timeline and AI prompt surface.
- Created this TSK and execution matrix for implementation planning.
- Recommended first implementation path: thin React DOM adapter as reference, with renderer-neutral protocol preserved for Phaser/canvas later.

### 2026-05-28 - Phase 1A Implemented

- Added authoring v2 JSON Schemas for game and UI manifests.
- Fixed the editor-facing synonym field name as `_label`.
- Added minimal authoring v2 game/UI fixtures and compiler support for those fixtures.
- Added CI coverage that compiles v2 fixtures and validates generated runtime manifests without `_label` or other authoring-only leakage.
- Deferred full existing manifest migration to Phase 1B; large JSON migration must be script-driven and pointer-scoped.
- Validation run: `node scripts/dev/generate-structure.js`, `npm run verify:manifest-authoring`, `npm run verify:editor-engine`, `npm test --workspace @cubica/editor-web`, `git diff --check` and runtime/editor leakage scans passed.

### 2026-05-28 - Phase 1B Implemented

- Added deterministic migration script `scripts/manifest-tools/migrate-authoring-v2.cjs`.
- Migrated all existing authoring manifests under `games/*/authoring` to `_schemaVersion: "2.0"`.
- Rebuilt generated source maps after authoring pointer changes; runtime manifests stayed generated from v2 authoring and validated.
- Enforced v2 authoring manifests in `scripts/ci/validate-manifest-authoring.js`.
- Updated editor-web local schema registry to validate authoring documents against v2 schemas.
- Validation run: `node scripts/manifest-tools/migrate-authoring-v2.cjs --dry-run`, `node scripts/manifest-tools/compile-authoring-manifests.cjs --check --quiet`, `npm run verify:manifest-authoring`, `npm run verify:editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run verify:editor-web`, `git diff --check`, runtime/editor leakage scans.

### 2026-05-28 - Entity Tree Contract Clarified

- Clarified that default entity tree is semantic, not a pointer-complete JSON tree.
- Fixed `_label` as the primary row name for tree-visible game/UI entities.
- Kept temporary display fallback to `title`, `name` or `id`, but documented that fallback does not satisfy authoring validation and must produce missing-label diagnostics.
- Added execution requirements that scalar parameters and technical fields stay out of the default tree and are edited through property panel, Monaco or advanced full JSON tree.

### 2026-05-28 - Phase 2/3 Implemented

- Added renderer-neutral preview adapter protocol to `packages/editor-engine`: `PreviewEntityDescriptor`, preview geometry, point/rectangle hit-test, topmost sorting, highlight commands and static test adapter.
- Added thin DOM preview adapter baseline in `apps/editor-web/src/lib/preview-dom-adapter.ts`; it reads explicit `data-editor-entity-id` and `data-authoring-pointer` metadata and maps DOM bounds to neutral descriptors.
- Reworked `apps/editor-web` shell so preview is the central workspace, manifest tree/graph lives in the collapsible left rail, Monaco remains the collapsible right rail, and top bands expose non-visual entity counts plus timeline status.
- The current preview is embedded through the existing preview URL iframe after `Preview`/`Prepare preview`; live click selection through adapter remains Phase 7.
- Validation run: `npm test --workspace @cubica/editor-engine`, `npm run typecheck --workspace @cubica/editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/editor-web`; browser smoke captured the preview-first shell on `http://127.0.0.1:3102`.

### 2026-05-28 - Phase 4 Implemented

- Added default semantic entity tree projection in `packages/editor-engine`: it shows only tree-visible game/UI entities, uses `_label` as the primary row name and falls back to `title`, `name` or `id` only for temporary display.
- Added missing-label semantic diagnostics for every tree-visible entity without a non-empty `_label`.
- Kept advanced pointer-complete JSON tree as `jsonTree` in editor-web view model and added Entities/JSON toggle in the left manifest rail.
- Default tree now hides `$schema`, `_schemaVersion`, `_manifestType`, `_definitions` internals and raw scalar parameters; selected entity parameters remain available through property panel/Monaco.
- Validation run: `npm test --workspace @cubica/editor-engine`, `npm run typecheck --workspace @cubica/editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/editor-web`; browser smoke confirmed the default tree no longer exposes technical nodes.

### 2026-05-28 - Phase 5 Implemented

- Added manifest chronology timeline model in `packages/editor-engine`; it builds flow and step entries from authoring v2 `root.logic.flows[].steps[]`.
- Added preview playthrough trace model: immutable trace values, event append helper and restore plan builder that rehydrates from the nearest preview snapshot and replay events.
- Exposed timeline from `createEditorViewModel` and rendered the first chronology steps in the editor timeline band for pointer selection.
- Phase 6/7 are now the next UI integration targets: preview click selection, overlay highlight, object picker, selection rectangle and AI prompt surface.
- Validation run: `npm test --workspace @cubica/editor-engine`, `npm run typecheck --workspace @cubica/editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/editor-web`.

### 2026-05-28 - Phase 6/7 Baseline Implemented

- Added iframe preview message bridge: `apps/player-web` emits generic preview-only runtime pointer metadata in editor preview mode and posts neutral descriptors to parent `editor-web`; it does not import `editor-engine` and does not write editor metadata into runtime manifests.
- Extended `apps/editor-web` preview route to pass editor origin to player-web and expose sidecar source maps so runtime pointers can be mapped back to authoring JSON Pointers.
- Added `PreviewSelectionOverlay`: preview click selects the topmost mapped entity, draws an overlay frame, synchronizes tree/property/Monaco for the active authoring file, exposes a hover object picker for overlapping entities and supports drag rectangle region context.
- Added AI prompt surface baseline: prompt text is queued as an editor intent with target authoring pointers; it does not mutate authoring JSON and does not call an AI backend yet.
- Added Inspect/Play mode switch so the overlay can be disabled for normal gameplay interaction inside the iframe.
- Validation run: `npm run verify:editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run verify:editor-web`, `npm run verify:manifest-authoring`, `npm run verify:player-web`, runtime/editor leakage scans and `git diff --check`.
- Independent e2e subagent validation: `npm run verify:editor-web`, `npm run verify:player-web` and `PLAYWRIGHT_HTML_REPORT=.tmp/playwright-report-player npm run test:e2e -- --output=.tmp/playwright-output-player` passed. Manual editor smoke stopped on an ambiguous test selector (`Game` select vs `Game preview` region), not on a confirmed product failure.

### 2026-05-28 - AI Apply And Versioning Contract Updated

- Replaced the target UX for AI edits: users no longer confirm technical patches. AI prompt must produce a bounded ChangeSet, the system dry-runs and validates it, then applies it automatically and shows a plain-language diff summary.
- Added incremental patch requirement: multiple AI patches can be applied before Save, each one recorded in a patch journal with forward and inverse ChangeSets for undo.
- Adopted Project Git Workspace with Session Worktrees: each game project is a local Git repo, each editor opening uses a session branch/worktree, Save creates a commit, and saved rollback creates a new revert/restore commit without destructive reset.
- Extended the model for user plugins: versioning is project-wide, ChangeSets can include plugin text/file operations, and plugin-touching edits require plugin manifest/schema/typecheck/test validation plus platform purity checks.

### 2026-05-28 - Phase 8 Baseline Implemented

- Added `EditorPatchIntent`, `EditorChangeSet`, `PatchJournalStep`, `EditorDiffSummaryItem`, dry-run and inverse patch helpers to `packages/editor-engine`.
- Extended JSON Patch support with guarded `test` operations and inverse generation for `add`, `replace` and `remove`.
- Added `/api/editor/ai/patch` in `apps/editor-web`; the current route uses a deterministic scoped planner for simple text/label edits and returns bounded ChangeSets instead of full file rewrites.
- Connected preview prompt submit to automatic dry-run, schema/semantic validation, editor-state apply, undo/redo journal and postfactum diff summary.
- Current Phase 8 scope is active-authoring-file JSON only. Project session worktrees, Git Save commits, rollback commits, plugin text/file ChangeSets and production AI provider integration remain Phase 9/follow-up work.
- Validation run: `npm test --workspace @cubica/editor-engine`, `npm run typecheck --workspace @cubica/editor-engine`, `npm test --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/editor-web`, `npm run verify:editor-engine`, `npm run verify:editor-web`, `git diff --check`.

### 2026-05-28 - Phase 9 Foundation Implemented

- Added `apps/editor-web/src/lib/project-git-workspace.ts`.
- Implemented project session worktree creation via `git worktree add -b editor/session/<sessionId>`.
- Implemented `saveProjectGitSession`: stages only allowed project paths and creates a normal Git commit with deterministic editor author defaults.
- Implemented `restoreSavedVersion`: restores allowed paths from a saved ref and creates a new commit instead of using destructive reset.
- Added generated artifact policy through `allowedSavePathsForGame`.
- Added plugin ChangeSet boundary validation that allows `games/<gameId>/plugins/**`, requires a plugin manifest validation target for plugin edits and blocks platform paths such as `apps/`, `services/`, `packages/`, `SDK/` and `scripts/`.
- Added integration tests over a temporary Git repository in `.tmp/project-git-workspace-tests`.
- Not yet wired: editor browser session lifecycle, direct file API replacement, production plugin schema/typecheck/test gates.
- Validation run: `npm test --workspace @cubica/editor-web -- project-git-workspace`, `npm test --workspace @cubica/editor-web -- project-git-workspace ai-change-planner`, `npm run typecheck --workspace @cubica/editor-web`.

### 2026-05-28 - Session File Workflow Baseline Implemented

- Added `apps/editor-web/src/lib/editor-session-store.ts` and `/api/editor/session`.
- Editor session metadata is persisted under `.tmp/editor-sessions/<sessionId>.json`; worktrees are created under `.tmp/editor-worktrees/<sessionId>`.
- Existing `/api/editor/files`, `/api/editor/file` and `/api/editor/layout` now accept optional `sessionId`; with `sessionId` they operate on the session worktree, without it they retain legacy direct repository behavior.
- `PUT /api/editor/file` creates a Git commit in the session worktree when `sessionId` is present.
- `EditorWorkspace` now opens/reuses a session per selected game, loads files/layouts through that session and sends `sessionId` on Save/layout writes.
- Added `editor-session-store` tests proving session edits do not mutate the main checkout before Save/commit routing.
- Remaining gap at this point: compile/preview and runtime-api still needed session-aware content loading, otherwise player preview would read the main checkout instead of the session worktree.
- Validation run: `npm test --workspace @cubica/editor-web -- editor-session-store`, `npm test --workspace @cubica/editor-web -- project-git-workspace editor-repository`, `npm run typecheck --workspace @cubica/editor-web`.

### 2026-05-28 - Session Compile Baseline Implemented

- Made `apps/editor-web/src/lib/compiler-workflow.ts` repository-root aware and cached compiler modules by root.
- `/api/editor/validate`, `/api/editor/compile` and `/api/editor/preview` now accept optional `sessionId` and resolve it through the editor session store.
- Validation and generated-manifest compile run against the session worktree when `sessionId` is present, so generated files are written to the isolated worktree.
- Remaining gap at this point: runtime-api still needed a session-scoped content root or generated runtime bundle handoff before player preview could open from session edits.

### 2026-05-28 - Session Runtime Preview Baseline Implemented

- Added runtime-api `contentSourceId` support for editor preview content roots under `.tmp/editor-worktrees/`.
- Runtime sessions created with `contentSourceId` now keep using that source when dispatching actions, so action handling reads the same generated manifests as initial session creation.
- PlayerFacingContent can be loaded with `?contentSourceId=...`; player-web preview URLs now include this value and the page uses it while loading content.
- `/api/editor/preview` registers the session worktree through runtime-api `/content/reload`, creates the runtime session with the same `contentSourceId`, and returns a player URL that preserves the source.
- Added runtime-api integration coverage that registers a temporary editor worktree content source, reads player content from it and creates a session from it.
- Remaining gap: production/remote project publication needs a policy for non-local generated bundle handoff; local editor preview is covered.
- Validation run: `npm run typecheck --workspace services/runtime-api`, `npm test --workspace services/runtime-api`, `npm run smoke --workspace services/runtime-api`, `npm run typecheck --workspace @cubica/player-web`, `npm test --workspace @cubica/player-web`, `npm run build --workspace @cubica/player-web`, `npm run typecheck --workspace @cubica/editor-web`, `npm test --workspace @cubica/editor-web`, `npm run build --workspace @cubica/editor-web`, `npm run verify:manifest-authoring`, `npm run verify:editor-engine`, `npm run verify:game-agnostic`, runtime/editor leakage scans and `git diff --check`.

### 2026-05-28 - Session Preview E2E Baseline Implemented

- Added `EDITOR_PROJECT_ROOT` support for editor-web route handlers so local/e2e runs can create sessions from an isolated project repository instead of the developer checkout.
- Added `EDITOR_PREVIEW_WORKTREES_ROOTS` support to runtime-api so the local content-root guard can allow isolated e2e/project repositories without accepting arbitrary filesystem paths.
- Updated Playwright config to launch runtime-api, player-web and editor-web together.
- Added an e2e fixture project builder under `.tmp/e2e-editor-project`; it copies current `games/`, authoring schemas and manifest compiler scripts into a temporary Git repository before Playwright starts services.
- Added `apps/editor-web/e2e/editor-session-preview.spec.ts`: it opens simple-choice in editor-web, captures the created editor session, prepares Preview, asserts the returned player URL contains the session `contentSourceId`, verifies runtime-api can serve player content from that source, and verifies the player iframe emits preview metadata.
- Validation run: `npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts --output=.tmp/playwright-output-editor-session-preview`, `npm run verify:editor-engine`, `npm run typecheck --workspace @cubica/editor-web`, `npm test --workspace @cubica/editor-web`, `npm run build --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/player-web`, `npm test --workspace @cubica/player-web`, `npm run build --workspace @cubica/player-web`, `npm run verify:runtime-api`, `npm run verify:manifest-authoring`, `npm run verify:game-agnostic`, runtime/editor leakage scans, editor-engine renderer purity scan and `git diff --check`.
- Architecture decision boundary reached after this slice: full plugin validation gates need a durable plugin contract before implementation can continue. Open decisions are plugin manifest schema, allowed plugin runtime/build commands, sandbox/isolation rules for command execution, plugin location in project repo versus current player-web plugin layer, and whether production/remote generated bundle handoff is handled now or in a separate ADR.

### 2026-05-28 - Project-Local Plugin Architecture Accepted

- Accepted ADR-037: project-local trusted plugins now, marketplace-safe sandbox evolution later.
- Target plugin home is `games/<gameId>/plugins/<pluginId>/`; current `apps/player-web/src/plugins/*` is not the target architecture.
- First implementation supports trusted local `player-web` plugins only. First-class `runtime-api` plugins are reserved because they affect authoritative backend state and require separate sandbox/permissions/observability decisions. If unavoidable before that ADR, runtime-api plugin-like code may be created only as documented legacy/technical debt with tests and migration path.
- Plugin npm dependencies are forbidden until verification exists; later they are allowed only for verified marketplace plugins with pinned/provenance policy.
- Preview must hot reload plugin code changes without restarting `player-web`.
- Antarctica plugin migration target is `games/antarctica/plugins/antarctica-player`.
- After plugin system implementation and Antarctica migration, the next editor-engine step is production/remote generated bundle handoff policy, then richer playthrough rollback UI and e2e time-travel coverage.

### 2026-05-29 - Plugin Bundle And Runtime Plugin Options Proposed

- Proposed ADR-039 for player-web plugin bundle handoff: editor-web builds a session-scoped browser bundle, runtime-api carries only bundle references through the preview content-source boundary, and player-web loads the bundle only in editor preview mode.
- At this point ADR-040 was proposed for runtime-api plugin architecture options: runtime-плагины остаются вне текущей реализации ADR-037, новая механика сначала проверяется на выразимость через манифест или платформенную возможность, а перед sandboxed marketplace runtime plugins нужен протокол отдельного процесса-исполнителя.
- Implementation remained blocked on accepting or revising ADR-039 for local player-web hot preview reload. This ADR-040 proposal was accepted on 2026-05-30; concrete runtime-api plugin implementation still remains future work.

### 2026-05-30 - Runtime-api Extension Policy Accepted

- Accepted ADR-040: server-side mechanics must use manifest/platform capabilities wherever possible; functionality tied to one concrete game is forbidden in generic `runtime-api`.
- Trusted project runtime plugins use a separate process with a JSON protocol and require separate review, owner assignment, tests, diagnostics and migration path.
- Marketplace runtime plugins require a container sandbox, or WebAssembly/WASI for pure computation.
- Added `docs/architecture/runtime-mechanics-language.md` to describe the minimal JSON-based mechanics language: action, guard/when, effects, state paths and journal.
- Added `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration.md` to document the Antarctica migration target, manifest cleanup direction and runtime-api extension mechanism.
- ADR-039 remained the implementation direction for local `player-web` hot preview reload.

### 2026-05-30 - Project-Local Player Plugin Gaps Closed For Local Preview

- Added `apps/editor-web/src/lib/project-plugin-validation.ts`: discovers `games/<gameId>/plugins/<pluginId>/plugin.json`, validates with JSON Schema, enforces `platform-only`, rejects unsafe script declarations, runs platform-owned `typecheck` via direct `spawn` with timeout and builds content-hashed preview bundles.
- `/api/editor/preview` now validates and bundles session plugins before calling runtime-api. `/api/editor/compile` and `/api/editor/file` surface plugin diagnostics; Save commit is blocked when plugin validation fails.
- `runtime-api` now registers player-web plugin bundle references under the same `contentSourceId` as generated manifests and serves bundle files without executing plugin code.
- `player-web` now loads session plugin bundles only in editor preview mode, exposes the public plugin API facade to the bundle, calls `activate(api)` and rebuilds config data after the bundle hash changes.
- `PlayerFacingContent` now has optional `pluginBundles`; production/default requests omit editor session bundle references.
- Added focused unit tests for schema/dependency/command/timeout/bundle behavior and player preview loader behavior. Added Playwright coverage that mutates the Antarctica session plugin and verifies runtime-api serves the changed bundle under the session `contentSourceId`.
- Remaining gaps after this local-preview slice were production/published bundle handoff, explicit supported `apiVersion` policy, dedicated visual validation journal row, and runtime plugins as a separate ADR-040 implementation. The first two were closed by `TSK-20260531-player-web-published-plugin-bundle-handoff`.

### 2026-05-31 - Antarctica Manifest Cleanup Documented

- Added `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-manifest-cleanup.md`.
- The cleanup plan records the pre-cleanup manifest facts: 145 actions, 140 `manifest-data` actions, 5 `script` actions, and 140 `capabilityFamily: "antarctica.opening"` entries.
- Cleanup is bounded to manifest/platform-capability evolution: no game-specific branches in `runtime-api`, no full runtime-api plugin runner, no marketplace sandbox work.
- Full runtime-api plugin runner явно зафиксирован как legacy/debt `LEGACY-0014`; ADR-040 остается границей для любого будущего доверенного проектного runner или marketplace runner.

### 2026-05-31 - Antarctica Manifest Cleanup Implemented

- `games/antarctica/authoring/game.authoring.json` and generated `games/antarctica/game.manifest.json` now have 145 `manifest-data` actions, 0 `script` actions, and no `capabilityFamily: "antarctica.opening"`.
- The 140 old `antarctica.opening` actions now use neutral families: `game.card.resolve`, `game.timeline.advance`, `game.info.advance`, `game.team.select`, `game.team.confirm`, and `game.collection.threshold`.
- The 5 former UI/runtime script actions now use schema-defined `deterministic.effects`: `runtime.server.request`, `ui.panel.open`, `ui.screen.open`, and `log.append`.
- The obsolete `content.scripts` reference and `games/antarctica/scripts/actions.js` placeholder were removed.
- Runtime-api still has no game-specific branch and no runtime plugin runner. Deterministic manifest changes now go through generic `effects[]`.

### 2026-05-31 - Antarctica Plugin Migration Closeout Documented

- Added `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`.
- The closeout records final project state, execution state, repository facts, acceptance criteria, validation commands and remaining non-blocking debt.
- The migration is complete for the trusted project-local `player-web` plugin stage: `Antarctica` lives under `games/antarctica/plugins/antarctica-player`, `simple-choice` remains plugin-free, local preview uses session plugin bundles, and runtime-api does not execute client plugin code.
- Remaining follow-ups are published plugin bundle handoff, explicit `apiVersion` policy, editor UI journal row for plugin diagnostics, and the separate `LEGACY-0014` runtime-api plugin runner debt.

### 2026-06-01 - Time-Travel Restore Decision Boundary

- Added `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/time-travel-rollback-options.md`.
- The document records the open options for preview rollback: editor-only recorded trace UI, runtime-api snapshot restore API, or player-local snapshot restore through the iframe bridge.
- No runtime/player restore protocol is accepted yet. Implementation may continue only on UI and diagnostics work that does not mutate preview runtime state or authoring JSON history.

### 2026-06-01 - Plugin Diagnostics Journal Implemented

- Added a dedicated `PluginDiagnosticsJournal` in `apps/editor-web` so plugin validation status appears separately from ordinary authoring JSON diagnostics.
- Save HTTP 422 responses with `pluginValidation` now surface the actual `plugin-schema` and `plugin-validation` diagnostics instead of a generic save failure.
- Routed diagnostics preserve optional plugin file context such as `filePath`, so the journal can show the plugin file and pointer that failed validation.

### 2026-06-01 - Runtime Preview Rollback Baseline Implemented

- Accepted the user's Variant B refinement: editor preview debugs authoritative server-side game logic, so rollback restores the `runtime-api` preview session and variants based on editor-only or player-local state are no longer target paths.
- Added preview-only session restore in `runtime-api`, guarded by editor preview `contentSourceId`, plus a browser-safe editor-web proxy route at `/api/editor/preview/rollback`.
- Player-web now emits preview runtime snapshots to editor-web; editor-web records a linear in-memory trace, shows runtime trace buttons in the timeline band and truncates future events after rollback instead of branching history.
- The editor hides the floating property panel in preview Play mode so gameplay clicks reach the iframe without manual panel cleanup.
- Browser e2e now covers `simple-choice` preview action, rollback to `T0`, restored player state and unchanged authoring dirty state. The same e2e file still verifies session `contentSourceId` preview and Antarctica session plugin bundle hot handoff.
- Subagent delegation was attempted but unavailable because the current environment reported `agent thread limit reached`; implementation and verification were completed locally.
- Validation run: `npm run typecheck --workspace @cubica/editor-web`, `npm run typecheck --workspace @cubica/player-web`, `npm run typecheck --workspace services/runtime-api`, `npm test --workspace @cubica/editor-engine`, `npm test --workspace @cubica/editor-web`, `npm test --workspace @cubica/player-web`, `npm test --workspace services/runtime-api`, `npm run build --workspace @cubica/editor-web`, `npm run build --workspace @cubica/player-web`, `npm run smoke --workspace services/runtime-api`, `npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts --output=.tmp/playwright-output-preview-rollback-final`, runtime/editor leakage scans and `git diff --check`.

### 2026-06-01 - Preview Trace Persistence Baseline Implemented

- Added `apps/editor-web/src/lib/preview-trace-store.ts` and `/api/editor/preview/trace`.
- Player-web snapshot messages are now persisted incrementally as editor-only trace documents under `.tmp/editor-playthroughs/`.
- Runtime rollback also sends a trace truncation update, so persisted traces follow the accepted linear-history rule and do not keep discarded future events.
- The persisted trace remains temporary tooling data: it is outside authoring JSON, generated manifests and Git commits.
- Validation run: `npm run typecheck --workspace @cubica/editor-web`, `npm test --workspace @cubica/editor-web -- preview-trace-store preview-message-adapter`, `npm test --workspace @cubica/editor-web`, `npm run build --workspace @cubica/editor-web`, `npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts --output=.tmp/playwright-output-preview-trace-store-final`.
