# Editor Engine: Preview-Timeline Manifest Editor Context

Документ фиксирует текущий контекст архитектурного переосмысления редактора authoring-манифестов. Это проектный документ для доработки концепции; durable architecture decisions вынесены в ADR-036.

## Оглавление

- [1. Понимание изменения](#1-понимание-изменения)
- [2. Что уже принято концептуально](#2-что-уже-принято-концептуально)
- [3. Почему flow-chart больше не главный экран](#3-почему-flow-chart-больше-не-главный-экран)
- [4. Целевая модель authoring-манифеста](#4-целевая-модель-authoring-манифеста)
- [5. Целевой UI редактора](#5-целевой-ui-редактора)
- [6. Preview loop](#6-preview-loop)
- [7. Timeline и time travel](#7-timeline-и-time-travel)
- [8. Manifest entity tree](#8-manifest-entity-tree)
- [9. Выбор объектов в preview](#9-выбор-объектов-в-preview)
- [10. AI prompt surface](#10-ai-prompt-surface)
- [11. Project Git workspace, undo и плагины](#11-project-git-workspace-undo-и-плагины)
- [12. Если renderer основан на Phaser](#12-если-renderer-основан-на-phaser)
- [13. Быстродействие](#13-быстродействие)
- [14. Проверяемость](#14-проверяемость)
- [15. Варианты реализации](#15-варианты-реализации)
- [16. Риски](#16-риски)
- [17. Открытые вопросы](#17-открытые-вопросы)
- [18. Источники и практики](#18-источники-и-практики)

## 1. Понимание изменения

Задача понята так: редактор authoring-манифестов должен перестать быть прежде всего редактором схемы/графа. Основной пользовательский сценарий - разработчик проходит игру в окне предпросмотра, выбирает элементы прямо на экране, редактирует свойства, JSON или через AI prompt, и сразу видит результат.

Flow-chart остается возможной аналитической проекцией, но больше не определяет архитектуру редактора. Главным становится связка:

```text
authoring JSON -> compile/preview snapshot -> player preview -> timeline -> selection/edit -> JSON Patch -> authoring JSON
```

## 2. Что уже принято концептуально

Приняты следующие предложения:

- authoring-манифест должен отражать semantic entity structure, а не быть почти копией generated runtime JSON;
- реальные game/UI сущности должны жить в `root`, а `_definitions` должны быть прототипами;
- у каждой смысловой сущности должен быть человекочитаемый editor label, в UI называемый "Синоним";
- JSON-поле для синонима окончательно называется `_label`;
- кириллица допустима для `_label`, `title`, `name`, `description`, `_semantics`;
- технические `id`, object keys, `_type` and refs должны оставаться ASCII-first;
- default entity tree должен показывать имена узлов из `_label`; временный fallback на `title`, `name` или `id` допускается только для отображения неполных данных и должен сопровождаться диагностикой;
- UI authoring manifest должен быть деревом UI, повторяющим вложенность компонентов;
- sidecar должен хранить только editor-only state: layout, collapsed state, timeline traces and preview session data.

## 3. Почему flow-chart больше не главный экран

Flow-chart полезен, когда нужно увидеть связи между объектами. Но он плохо подходит как основной интерфейс:

- игра воспринимается через прохождение, экран, состояние и последствия действий;
- один graph layout не одинаково хорош для линейного сценария, симулятора, настольной игры or sandbox;
- визуальное редактирование через узлы плохо показывает layered UI;
- большое количество технических объектов превращает canvas в перегруженную карту.

Новая цель: preview is the primary mental model, timeline is the navigation model, tree/Monaco/property panel are editing tools.

## 4. Целевая модель authoring-манифеста

Game authoring:

```json
{
  "_schemaVersion": "2.0",
  "_manifestType": "game",
  "_definitions": {},
  "root": {
    "_type": "game.Game",
    "_label": "Антарктическая корпорация",
    "logic": {
      "entry": "opening",
      "flows": [
        {
          "id": "opening",
          "_type": "game.Flow",
          "_label": "Открывающая цепочка",
          "pattern": "pearl-string",
          "steps": []
        }
      ],
      "systems": [],
      "rules": [],
      "actions": {}
    },
    "state": {}
  }
}
```

UI authoring:

```json
{
  "_schemaVersion": "2.0",
  "_manifestType": "ui",
  "_channel": "web",
  "_definitions": {},
  "root": {
    "_type": "ui.Manifest",
    "_label": "Web UI",
    "screens": [
      {
        "id": "S1",
        "_type": "ui.Screen",
        "_label": "Главный экран",
        "root": {
          "id": "S1.root",
          "_type": "ui.Layout",
          "_label": "Основной контейнер",
          "children": []
        }
      }
    ]
  }
}
```

Для runtime output compiler может сохранить текущий формат, например map by id. Authoring format should optimize authoring, not runtime lookup.

Phase 1A implementation adds the first executable v2 contract:

- `docs/architecture/schemas/game-authoring-v2.schema.json`;
- `docs/architecture/schemas/ui-authoring-v2.schema.json`;
- minimal v2 fixtures under `docs/architecture/schemas/examples/authoring-v2/`;
- compiler support for mapping `root.logic.actions[]` into runtime `actions` and `root.screens[]` into runtime `screens`;
- `_label` is stripped from generated runtime manifests as an authoring-only field.

Full migration of existing large authoring manifests is a separate Phase 1B. It must be script-driven and JSON Pointer scoped because current `Antarctica` authoring JSON files are too large for safe direct model-context rewrites.

Phase 1B implementation migrated all existing authoring manifests to `_schemaVersion: "2.0"`:

- game authoring manifests now store runtime-facing game data under `root` and semantic actions under `root.logic.actions[]`;
- UI authoring manifests now store screens as `root.screens[]` and components as nested `children[]`;
- every typed semantic entity produced by the migration has `_label`;
- `_definitions` are empty and reserved for future reusable prototypes;
- generated runtime manifests remain produced by the compiler and do not contain `_label`.

Phase 2/3 implementation added the first preview-first editor runtime shape:

- `packages/editor-engine` exposes renderer-neutral preview descriptors, point/rectangle hit-test and highlight commands;
- `apps/editor-web/src/lib/preview-dom-adapter.ts` is the thin DOM reference adapter and reads only explicit `data-editor-entity-id` and `data-authoring-pointer` metadata;
- editor-web now opens with a central preview workspace, collapsible left manifest rail, collapsible right Monaco rail, non-visual entity toolbar, timeline band and bottom diagnostics status;
- embedded preview currently uses the existing player preview URL in an iframe after `Preview`/`Prepare preview`;
- live preview click selection and overlay highlighting are intentionally left for the later selection/overlay phases.

Phase 4 implementation added the first default entity tree:

- `packages/editor-engine` builds a semantic entity tree separately from the pointer-complete JSON tree;
- default tree uses `_label` as the primary row name and allows temporary `title`/`name`/`id` display fallback with missing-label diagnostics;
- technical fields and scalar parameters are hidden from the default tree;
- editor-web keeps an advanced JSON tree toggle in the left manifest rail for technical debugging.

Phase 5 implementation added the first timeline model:

- manifest chronology is built from authoring v2 `root.logic.flows[].steps[]`;
- each timeline entry keeps an authoring pointer so clicking timeline can select the same entity as tree/property/Monaco;
- preview playthrough traces are immutable editor-only values with event log, snapshots and restore plans;
- rollback planning rehydrates from the nearest snapshot and replay events, but does not mutate authoring JSON.

Phase 6/7 baseline implementation connected the iframe preview to editor selection:

- player-web emits preview-only runtime pointer metadata when opened with `preview=1`;
- editor-web listens to versioned `postMessage` descriptor batches from the iframe and maps runtime JSON Pointers to authoring JSON Pointers through sidecar source maps;
- preview overlay supports topmost click selection, highlight frame, overlap object picker and drag rectangle region context;
- the overlay has Inspect/Play mode so normal gameplay inside the iframe remains possible;
- the prompt surface queues an editor intent with target authoring pointers; automatic validated ChangeSet generation/apply, undo journal and plain-language diff summary remain follow-up work.

## 5. Целевой UI редактора

Экран:

```text
┌──────────────────────────────────────────────┐
│ menu bar: game/file/save/validate/compile    │
├──────────────────────────────────────────────┤
│ non-visual entity toolbar: state/actions/... │
├──────────────────────────────────────────────┤
│ timeline                                      │
├──────┬───────────────────────────────┬───────┤
│ tree │ full-screen player preview    │ JSON  │
│ rail │ + overlay + AI prompt         │ rail  │
├──────┴───────────────────────────────┴───────┤
│ status bar: diagnostics, dirty, preview hash │
└──────────────────────────────────────────────┘
```

Панели:

- left manifest tree is collapsible;
- right Monaco/text editor is collapsible;
- property panel floats near selected entity and can be pinned later;
- AI prompt input appears near pointer after click or drag selection;
- object picker appears if hit-test returns multiple layered entities.

## 6. Preview loop

Preview loop должен быть быстрым and predictable:

1. User edits authoring JSON through property panel, tree, Monaco or AI patch.
2. DocumentStore applies JSON Patch or text update.
3. Local syntax/schema validation runs immediately.
4. Preview update is scheduled with debounce.
5. Compiler produces runtime snapshot or partial preview projection.
6. Player preview receives snapshot/version hash.
7. Overlay metadata maps rendered objects back to authoring pointers.

Для маленьких изменений property panel может использовать optimistic preview: UI shows changed authoring value before full compile finishes, but status bar must clearly show pending validation/compile.

## 7. Timeline и time travel

Timeline has two modes:

| Mode | Source | Use case |
| --- | --- | --- |
| Manifest chronology | `root.logic.flows`, `steps`, `next`, branches | Linear and pearl-string games |
| Recorded playthrough | local event log + snapshots | Nonlinear games and exploratory play |

For recorded playthroughs:

- record runtime events and snapshots from player-web preview messages;
- keep the active trace in browser state and persist long-session trace documents under `.tmp/editor-playthroughs/`;
- keep them out of generated manifests and commits;
- restore exact snapshots through runtime-api first; sparse snapshot replay from nearest snapshot remains compatible follow-up work;
- allow rollback preview session to a selected event through a preview-only runtime-api restore endpoint;
- after rollback and new play, discard future events and truncate the persisted trace to keep one linear playthrough path;
- distinguish rollback preview state from authoring document undo/redo.

Important distinction:

- **Document undo** changes authoring JSON history.
- **Timeline rollback** changes runtime-api preview session state.

These must not share one undo stack.

Accepted server-authoritative path:

- Preview in the editor is also a debugger for server-side game logic.
- `runtime-api` owns preview rollback and rejects restore for sessions without a temporary editor `contentSourceId`.
- `player-web` does not keep authoritative rollback state; it sends preview snapshots and reloads/resumes the restored session after editor-web calls restore.

## 8. Manifest entity tree

Manifest entity tree - это основное дерево сущностей манифеста, а не полный JSON tree. По умолчанию оно показывает только объекты, которые projection layer распознал как игровые или UI-сущности. Полный JSON tree остается отдельным advanced mode для технической отладки.

Tree should show only semantic entities by default:

- game, flow, step, action, rule, condition, state node, metric;
- UI manifest, screen, layout, component, action binding, asset;
- diagnostics grouped by entity.

Tree node label policy:

- primary source is `_label`;
- temporary display fallback may use `title`, `name` or `id`, in that order;
- fallback never satisfies authoring validation; a tree-visible semantic entity without `_label` must produce a diagnostic on its authoring pointer;
- fallback rows should be visually marked so the author can find and fix incomplete labels.

Property ownership:

- tree rows represent entities and entity containers, not scalar parameters;
- selected entity properties are edited in the floating property panel;
- raw fields such as component `props.text`, layout numbers, guards, action parameters and bindings are shown in property panel groups, not as default tree nodes;
- diagnostics for hidden fields are grouped under the nearest visible entity and can reveal the exact JSON Pointer in Monaco.

Tree should hide by default:

- `$schema`;
- `_schemaVersion`;
- `_manifestType`;
- `_definitions` internals unless in prototype mode;
- `_extends`, generated mapping fields, source-map details;
- raw scalar props that are edited in property panel.

Advanced mode can show full JSON tree for technical authors, but the default tree should be an entity outline.

## 9. Выбор объектов в preview

Renderer must expose editor metadata for every selectable visual entity:

```json
{
  "entityId": "S1.metrics.score",
  "authoringPointer": "/root/screens/0/root/children/0",
  "label": "Остаток дней",
  "semanticRole": "ui-component",
  "rect": { "x": 24, "y": 80, "width": 160, "height": 48 },
  "zIndex": 20
}
```

Click behavior:

- select topmost hit-test entity;
- sync selection to tree, property panel and Monaco pointer;
- draw overlay frame;
- show AI prompt input near cursor;
- if several entities overlap, show object picker with labels and roles.

The object picker should not block normal click selection. It appears only when stack length is greater than one.

## 10. AI prompt surface

AI prompt is an automatic editing command, not a direct source editor. Пользователь не подтверждает технический JSON Patch. Система применяет изменение сама после dry-run validation, показывает результат в редакторе and records undo.

For click selection, the prompt context includes:

- selected entity;
- authoring pointer;
- current value subset;
- nearby entities;
- diagnostics;
- optional screenshot crop.

For drag rectangle, the prompt context includes:

- rectangle coordinates;
- intersecting visual entities;
- preview screenshot crop;
- active timeline event;
- active manifest file and selected pointers.

AI output must become a bounded ChangeSet:

- JSON Patch for authoring manifests and JSON config;
- property edit intent;
- structural insert/remove/reorder intent;
- text patch or file operation for user plugins;
- or rejected/no-op with diagnostics.

Apply is automatic after checks pass. Reviewability is provided after the fact through a plain-language diff summary, affected entity list, validation status and undo.

Patch flow:

```text
prompt
  -> EditorPatchIntent
  -> scoped context, not full manifest
  -> AI ChangeSet
  -> dry-run apply in session worktree
  -> JSON/schema/semantic/plugin validation
  -> apply to DocumentStore and worktree
  -> preview refresh
  -> append undo journal step
  -> show user-facing diff summary
```

Large manifest rule: AI must receive selected subtrees, nearest parent/sibling context, schema fragments and diagnostics. It must not receive or rewrite a whole large authoring file when a pointer-scoped edit is enough.

Implementation status on 2026-07-12:

- `packages/editor-engine` now exposes the Phase 8 contract and safety helpers: `EditorPatchIntent`, `EditorChangeSet`, `PatchJournalStep`, guarded JSON Patch `test`, inverse patch generation, dry-run validation and diff summaries.
- `apps/editor-web` has a baseline `/api/editor/ai/patch` route. It uses a deterministic local planner for simple text/label edits so the automatic apply flow is testable before a production AI provider is connected.
- Preview prompt submit now applies active-file JSON ChangeSets automatically after dry-run/schema/semantic validation, records undo/redo journal steps and shows a postfactum diff summary.
- The baseline deliberately rejects plugin/file operations at dry-run time. They stay in the ChangeSet contract for Phase 9 project worktrees and plugin-aware validation.

## 11. Project Git workspace, undo и плагины

Versioning model is Project Git Workspace with Session Worktrees.

Project repo means the Git repository of one game project. It stores authoring manifests, user plugins, assets, plugin tests and project configuration. It is not limited to manifests.

Worktree means an isolated working folder linked to the same Git history. Each editor opening creates a session worktree and session branch:

```text
.tmp/editor-worktrees/<sessionId>/
  games/<gameId>/authoring/...
  games/<gameId>/plugins/...
  games/<gameId>/assets/...
```

Editing lifecycle:

- opening the editor creates `editor/session/<sessionId>` from the current project commit;
- prompt edits are applied incrementally inside this worktree;
- each prompt appends a `PatchJournal` step, but does not create a Git commit;
- multiple patches can be applied before Save;
- `Undo` before Save applies the inverse ChangeSet from the journal;
- Save stages allowed files and creates one project commit;
- generated manifests/source maps are committed only if the project policy requires reproducible runtime bundles;
- rollback after Save creates a new revert/restore commit, never destructive reset.

Implementation status on 2026-05-28:

- `apps/editor-web/src/lib/project-git-workspace.ts` implements the server-side foundation for this model.
- `createProjectGitSession` creates a `git worktree` session branch under `.tmp/editor-worktrees/<sessionId>`.
- `saveProjectGitSession` commits only explicitly allowed project paths. `allowedSavePathsForGame` keeps generated manifests/source maps out of commits unless the project policy includes them.
- `restoreSavedVersion` restores allowed paths from a saved ref and creates a new commit instead of using `reset --hard`.
- `/api/editor/session` creates and closes session worktrees. Session metadata is stored under `.tmp/editor-sessions/<sessionId>.json`.
- `/api/editor/files` and `/api/editor/layout` accept optional `sessionId` for reads/layout compatibility; user-facing `PUT /api/editor/file` requires `sessionId` and always saves through the session worktree and durable line.
- `EditorWorkspace` opens/reuses a session per selected game and sends `sessionId` on file/layout reads and Save. Save commits the session draft and advances the durable project version line from ADR-075.
- `/api/editor/validate` and `/api/editor/compile` accept optional `sessionId`; with `sessionId` they load the shared authoring compiler from the session worktree, so validation and generated-manifest writes use isolated session content.
- `/api/editor/preview` also accepts optional `sessionId`, compiles the session worktree, registers that worktree in runtime-api as a temporary `contentSourceId`, creates a runtime session with that source and opens player-web with the same source.
- runtime-api guards local preview content roots with an allowlist. By default it accepts the monorepo `.tmp/editor-worktrees` root; e2e and local isolated project runs can extend this with `EDITOR_PREVIEW_WORKTREES_ROOTS`.
- runtime-api keeps `contentSourceId` attached to the runtime session, so later action dispatches read the same generated manifests as the preview boot state.
- player-web accepts `contentSourceId` in preview URLs and loads PlayerFacingContent from runtime-api with that source instead of the main checkout.
- Playwright e2e launches runtime-api, player-web and editor-web together and verifies local session preview through a temporary Git project root.
- Remaining runtime gap: production/remote project publication needs a non-local generated bundle handoff policy; the local editor worktree baseline is implemented.

`PatchJournal` step:

```ts
interface PatchJournalStep {
  id: string;
  prompt: string;
  summaryForUser: string;
  forwardChangeSet: EditorChangeSet;
  inverseChangeSet: EditorChangeSet;
  affectedFiles: readonly string[];
  affectedPointers: readonly string[];
  beforeHash: string;
  afterHash: string;
  validationSummary: string;
}
```

`EditorChangeSet`:

```ts
interface EditorChangeSet {
  jsonPatches: readonly JsonFilePatch[];
  textPatches: readonly TextFilePatch[];
  fileCreates: readonly FileCreate[];
  fileDeletes: readonly FileDelete[];
  fileRenames: readonly FileRename[];
}
```

For JSON Patch, the first implementation should allow only `add`, `remove`, `replace` and `test`. `move` and `copy` are postponed because reliable inverse generation and readable summaries are harder.

ADR-037 defines the target plugin architecture. User-editable plugins are project-local, not platform-source plugins:

```text
games/<gameId>/plugins/<pluginId>/
  plugin.json
  package.json
  src/
  tests/
```

First implementation supports trusted local `player-web` plugins only. First-class `runtime-api` plugins are reserved because they would run or influence backend runtime behavior such as authoritative action handlers, state transitions, validators or integrations. ADR-040 is accepted as the `runtime-api` extension policy: server-side mechanics must use manifest/platform capabilities wherever possible, functionality tied to one concrete game is forbidden in generic `runtime-api`, trusted project runtime plugins use a separate process with a JSON protocol and separate review, and marketplace plugins require a container sandbox or WebAssembly/WASI for pure computation.

Because authoritative game logic lives on the server, runtime-api plugin-like code may still be created only for internal separately reviewed cases when a mechanic cannot reasonably be expressed through manifests, reusable handlers, JSON Patch-like effects or JsonLogic. Such code is legacy/technical debt, not part of the target marketplace plugin system: it must be documented with owner/reason/migration path, covered by focused tests and kept out of marketplace/editor-editable plugin flows.

Plugins change the validation boundary:

- plugin code tied to one concrete game must live under the game project/plugin directory;
- platform core must not receive `if gameId` branches tied to one concrete game;
- plugin manifest schema validation runs before Save;
- TypeScript typecheck/build and plugin unit tests run when the ChangeSet touches plugin code;
- runtime smoke runs when plugin output affects gameplay behavior;
- if a plugin change reveals a reusable platform mechanic, it must be promoted through schema/capability design instead of staying as hidden platform code.
- npm dependencies are forbidden until plugin verification exists; after verification, dependencies are allowed only for verified marketplace plugins under a pinned/provenance policy;
- preview must pick up plugin code changes without restarting `player-web`.

Current local-preview plugin baseline validates path boundaries, discovers `games/<gameId>/plugins/<pluginId>/plugin.json`, validates `plugin.json` by JSON Schema, enforces `dependenciesPolicy: "platform-only"`, rejects unsafe package script declarations and runs the platform-owned `typecheck` command through direct process execution with timeout. `Antarctica` has been migrated to `games/antarctica/plugins/antarctica-player`. For editor preview, `editor-web` builds a content-hashed browser module from the session worktree, `runtime-api` carries only the bundle reference under the same `contentSourceId`, and `player-web` imports the module only in preview mode before rebuilding config. The editor footer now has a dedicated plugin diagnostics journal row, including Save HTTP 422 plugin validation failures. Follow-up gates are plugin-local test runner policy and future marketplace/runtime hardening.

Accepted migration target:

```text
games/antarctica/plugins/antarctica-player/
  plugin.json
  package.json
  src/index.ts
  src/config-data.ts
  src/contracts.ts
  src/state-resolvers.ts
  src/register.ts
```

The plugin closure record is documented in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/plugin-gap-closure-plan.md`. Production/published player-web plugin bundle handoff is implemented through ADR-039. The concrete preview restore protocol is accepted as runtime-authoritative Variant B and recorded in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/time-travel-rollback-options.md`; the baseline rollback UI now exposes a current marker, selected event detail panel and explicit restore/reset/replay controls.

## 12. Если renderer основан на Phaser

Phaser changes implementation details, not the preview-first architecture.

What changes:

- preview object selection cannot rely on DOM node traversal;
- rendered entities are Phaser Game Objects inside canvas/WebGL;
- bounds and layers must be reported by the Phaser scene or adapter;
- hit-test must use Phaser input/hit-area logic or adapter-owned geometry;
- overlay, object picker and AI prompt should be editor DOM above the canvas;
- camera scroll, zoom, scale mode and multiple scenes must be accounted for when converting bounds to editor coordinates.

Required adapter contract:

```ts
interface PreviewEntityDescriptor {
  entityId: string;
  authoringPointer: string;
  runtimePointer?: string;
  label: string;
  semanticRole: string;
  layer: number;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

interface PreviewRendererAdapter {
  getEntities(): readonly PreviewEntityDescriptor[];
  hitTest(point: { x: number; y: number }): readonly PreviewEntityDescriptor[];
  hitTestRect(rect: { x: number; y: number; width: number; height: number }): readonly PreviewEntityDescriptor[];
  highlight(entityId: string): void;
  clearHighlight(): void;
}
```

Implementation notes for Phaser:

- attach editor metadata to Game Objects at manifest-to-scene creation time;
- call `setInteractive` or provide explicit hit geometry for selectable objects;
- prefer adapter-managed hit-test for editor selection, so gameplay input and editor selection can be separated;
- convert world/camera coordinates to canvas/client coordinates before passing bounds to the editor overlay;
- do not store Phaser object ids in authoring JSON; use stable manifest `id` and authoring pointer;
- emit timeline events from the same action/session boundary that gameplay uses, not from low-level pointer events only.

This keeps `editor-engine` independent of Phaser. Phaser becomes one renderer adapter beside React/DOM or future renderers.

## 13. Быстродействие

Performance recommendations:

- preview should not re-render because Monaco text cursor moved;
- editor state should be split: document state, preview session state, panel UI state and AI draft state;
- AI patch application should update the session worktree and DocumentStore incrementally, not reload full project state;
- use stable subscriptions for external editor stores;
- debounce compile/preview refresh;
- keep overlay rendering separate from player rendering;
- use pointer events for selection and drag rectangle;
- use event log + snapshots for timeline rehydration;
- avoid using React state for every pointermove; use refs and requestAnimationFrame for selection rectangle visuals;
- run expensive compile/validation outside urgent input updates.

Open question: same-origin embedded preview or iframe. Same-origin embedded preview is fastest to integrate and easier to inspect; iframe gives stronger isolation and cleaner reload boundary. If iframe is used, communication should use postMessage with strict origin and message schema checks.

## 14. Проверяемость

Required checks for this architecture:

- authoring schema validates `_label`, entity ids and entity structure;
- entity projection validates that every default-tree semantic entity has a non-empty `_label`; display fallback to `title`, `name` or `id` must still produce a missing-label diagnostic;
- compiler v2 output remains runtime-schema-valid;
- source maps map runtime diagnostics back to authoring entities;
- entity tree hides technical fields by default but advanced mode can reveal full JSON;
- entity tree does not show scalar parameters or technical fields as default rows; selected entity parameters are visible in property panel;
- preview overlay metadata exists for every selectable rendered object;
- click selection syncs preview, tree, property panel and Monaco;
- overlapping objects open object picker;
- timeline rollback changes preview session state only;
- document undo changes authoring JSON only;
- AI prompt applies automatically only after dry-run validation and appends undo journal step;
- multiple prompt patches can be applied before Save without writing the canonical project commit;
- Save creates a Git commit in the project repo/session branch workflow;
- post-Save rollback creates a new commit and never uses destructive reset;
- plugin-touching ChangeSets run plugin schema/typecheck/test gates;
- playthrough traces never appear in generated runtime manifests.
- Phaser adapter tests, if Phaser is used, must verify point hit-test, rectangle hit-test, camera/scale coordinate conversion and highlight commands.

## 15. Варианты реализации

### Option A. Embedded Same-Origin Preview

Player preview is rendered as React subtree inside editor page.

Pros:

- fastest selection metadata access;
- no postMessage protocol initially;
- easy overlay integration.

Cons:

- weaker isolation;
- editor state and player state can accidentally couple;
- harder to test production-like delivery boundary.

### Option B. Iframe Preview With Message Protocol

Player preview runs in iframe, editor overlay communicates through structured messages.

Pros:

- stronger isolation;
- closer to real player/runtime boundary;
- easier hard reload of preview session.

Cons:

- requires explicit protocol for selection, snapshots and errors;
- hit-test across iframe boundary needs preview-side participation.

Recommended first production direction: iframe boundary if preview must be trustworthy and close to runtime behavior; embedded same-origin prototype is acceptable for a spike only if protocol is designed before broad implementation.

### Option C. Hybrid

Use embedded preview for local fast authoring and iframe mode for verification.

Pros:

- fast iteration and production-like verification.

Cons:

- two preview paths can drift unless both consume the same preview snapshot and overlay metadata protocol.

### Option D. Thin React DOM Adapter First

Implement the renderer adapter boundary immediately, but keep the first adapter deliberately thin.

For React/DOM preview the adapter may read explicit attributes from rendered elements:

```html
<div
  data-editor-entity-id="S1.metrics.score"
  data-authoring-pointer="/root/screens/0/root/children/0"
/>
```

Pros:

- preserves most of the simplicity of direct DOM selection;
- keeps editor-engine independent from DOM details;
- makes later Phaser/canvas support possible without rewriting selection, tree sync and AI prompt flow.

Cons:

- adds a small descriptor layer even for React;
- requires descriptor invalidation after layout, resize and preview state changes;
- needs tests for adapter hit-test and stale bounds.

Decision for first implementation: use thin React DOM adapter as the reference implementation. Do not implement Phaser support until a concrete Phaser renderer or game prototype enters scope.

## 16. Риски

| Risk | Mitigation |
| --- | --- |
| Preview becomes a second runtime. | Preview must consume generated runtime snapshot or the same player-facing projection. |
| AI prompt makes uncontrolled source edits. | Require bounded ChangeSet, dry-run validation, undo journal and scoped context. |
| Unsaved prompt edits are lost or cannot be undone. | Store per-session patch journal with inverse ChangeSets in the session worktree. |
| Git workflow damages project history. | Use session worktrees, Save commits and revert/restore commits; never destructive reset from platform UI. |
| Concurrent Save/Restore/Close/GC partially changes one worktree. | ADR-077 is implemented with one inter-process session lease, fresh Git status under that lease and a verified worktree root. |
| Plugin edits bypass platform boundaries. | Keep plugins inside project repo, run plugin validation gates and block platform core branches tied to one concrete game. |
| Timeline trace becomes hidden source of game logic. | Keep traces temporary; manifest chronology remains in authoring JSON. |
| Entity tree hides too much for technical debugging. | Provide advanced full JSON mode. |
| Iframe communication is unsafe. | Validate origin, source and message schema. |
| Performance degrades on every keystroke. | Split state, debounce compile, isolate preview rendering. |
| Phaser/canvas preview cannot be inspected like DOM. | Require explicit renderer adapter metadata and hit-test API. |

## 17. Открытые вопросы

Закрыто: authoring schema v2 реализована; flow-chart сохранён как secondary
tab; reference renderer adapter — current React/DOM preview; named fixtures,
ChangeSet diff summary и project-local player plugin discovery/bundle wiring
реализованы последующими срезами ADR-037/039/057.

Остаётся открыто:

- How to represent nonlinear systems in `root.logic.systems` without inventing a full DSL too early.
- Which generated artifacts should be committed by default for each project type.
- Which plugin capabilities need sandboxing before AI can edit plugin code automatically or before marketplace plugins can run.
- Plugin-local unit test runner (`LEGACY-0047`) and concrete Phaser adapter
  metadata/hit-test integration.
- Закрыто ADR-075: Save продвигает разрешённое authoring-содержимое в
  долговечную проектную линию, доступную новым сессиям; возврат создаёт новую
  версию, а текущий platform checkout не откатывается вместе с игровым
  содержимым.
- Принято ADR-077: пользовательский Save требует действующую сессию, а
  Save/Restore/Close/GC одной сессии сериализуются общей межпроцессной арендой.
  Реализация защиты и корневая сквозная проверка завершены 2026-07-12;
  `LEGACY-0051` закрыт.

## 18. Источники и практики

- JSON Schema annotation keywords such as `title`, `description`, `default`, `examples`, `deprecated`, `readOnly` and `writeOnly` are intended for descriptive metadata and self-documenting schemas: https://json-schema.org/understanding-json-schema/reference/annotations
- JSON Schema `required` and string `minLength` are the schema-level mechanism for requiring a present, non-empty `_label`: https://json-schema.org/understanding-json-schema/reference/object and https://json-schema.org/understanding-json-schema/reference/string
- JSON Patch defines sequential JSON document operations such as `add`, `remove`, `replace` and `test`: https://www.rfc-editor.org/rfc/rfc6902
- Git worktree supports multiple working trees connected to one repository history, which fits isolated editor sessions: https://git-scm.com/docs/git-worktree
- Git revert creates a new commit that undoes an earlier commit, which fits non-destructive saved-version rollback: https://git-scm.com/docs/git-revert
- Git restore restores selected paths from a source tree and should be wrapped by platform policy rather than exposed destructively to users: https://git-scm.com/docs/git-restore
- React `useTransition` supports non-blocking updates for expensive UI changes; it should not control text inputs: https://react.dev/reference/react/useTransition
- React `memo` is an optimization for skipping re-renders when props are unchanged, not a semantic guarantee: https://react.dev/reference/react/memo
- `useSyncExternalStore` is the standard React hook for subscribing to external stores, with stable subscribe functions to avoid resubscription churn: https://react.dev/reference/react/useSyncExternalStore
- MDN documents iframe isolation, same-origin restrictions and cross-origin communication through `postMessage`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- MDN recommends validating `origin` and message syntax when using `window.postMessage`: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- Event sourcing guidance recommends snapshots plus replay from the nearest snapshot for efficient time reconstruction: https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
- Chrome DevTools Recorder shows the established pattern of recording, replaying, stepping through and exporting user flows: https://developer.chrome.com/docs/devtools/recorder/overview
- Phaser input docs describe interactive objects, hit areas and hit testing for Game Objects: https://docs.phaser.io/api-documentation/function/input and https://docs.phaser.io/api-documentation/class/input-inputmanager
- Phaser DOM Element docs note that DOM Elements are placed in a DOM container above the canvas and cannot be interleaved with sprites, which is why editor overlays should not depend on Phaser DOM Elements as the only selection mechanism: https://docs.phaser.io/api-documentation/class/gameobjects-gameobjectfactory
