# TSK-20260522-editor-engine-authoring-manifest-editor: Editor Engine Authoring Manifest Editor

## Оглавление

- [Status](#status)
- [Current State](#current-state)
- [Why](#why)
- [Terms](#terms)
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

implemented-full

## Current State

На 2026-05-22 полный первый срез `editor-engine` реализован. Редактор остается локальным developer-facing инструментом и покрывает целевой контур этой задачи: authoring JSON, flow-chart projection, Monaco/JSON editor, floating property panel, repository-backed save, validation, compile, preview и ограниченные writable graph operations.

Архитектурная корректировка от 2026-05-22: исходная целевая модель editor-engine включает три режима редактирования JSON - flow-chart, JSON tree view и text editor. Этот TSK реализовал flow-chart и text editor, но не JSON tree view. Разрыв теперь зафиксирован как отдельная follow-up task: `TSK-20260522-editor-engine-json-tree-view`.

Реализовано:

- `packages/editor-engine` - framework-agnostic core package для единого состояния authoring JSON, JSON Pointer/JSON Patch операций, точной text location map, локального Ajv schema registry, нейтральной graph projection, reverse projection и editor diagnostics.
- `apps/editor-web` - Next.js editor surface с React Flow canvas, Monaco JSON editor, floating property panel, repository-backed file open/save, diagnostics strip, layout companion persistence и validate/compile/preview actions.
- Repository API разрешает только `games/<id>/authoring/**/*.authoring.json`, проверяет version hash и блокирует traversal, absolute paths, generated runtime manifests и symlink escapes.
- Reverse projection пишет authoring changes в JSON Patch, а canvas layout changes - в editor-only companion files (`editor.layout.json` и `ui/<channel>.layout.json`).
- Compiler bridge запускает authoring compile, runtime schema validation и preview через HTTP/tooling boundary, не импортируя `editor-engine` в runtime/player layers.
- Runtime/player boundary расширен только generic reload/preview контрактом: `runtime-api` получил `POST /content/reload`, а `player-web` принимает preview query params.
- Root workspace знает `apps/editor-web` и `packages/editor-engine`; добавлены `verify:editor-engine` и `verify:editor-web`.

Осознанно отложено за пределы первого полного среза:

- schema-pointer based UI metadata для точного выбора виджетов property panel;
- JSON tree view как третий целевой режим редактирования JSON рядом с flow-chart и Monaco; tracked by `TSK-20260522-editor-engine-json-tree-view`;
- collaborative editing и AI patch review workflow;
- очистка pre-existing `teamSelection` drift в runtime/player вне editor-engine scope.

## Why

Cubica уже имеет обязательный authoring layer по ADR-030, но авторы и агенты пока работают с JSON-файлами напрямую. Для создания игр нужен `editor-engine`: универсальный редактор authoring-манифестов с flow-chart представлением, JSON-редактором, property panel, компиляцией, валидацией и preview.

Эта задача нужна, чтобы начать реализацию без архитектурного дрейфа:

- не превратить flow-chart в новый source of truth;
- не зашить игровые сущности в core editor-engine;
- не создать второй runtime contract;
- сохранить JSON Schema как single source of truth;
- обеспечить обратную проекцию visual edits в authoring JSON.

## Terms

- Authoring manifest - исходный JSON-манифест для редактирования игры или UI.
- Runtime manifest - generated JSON-манифест для `runtime-api`, `player-web` и других delivery layers.
- Flow-chart - диаграмма потока: визуальное представление узлов и связей.
- Projection - построение graph view из authoring JSON.
- Reverse projection - преобразование visual edit в изменение authoring JSON.
- JSON Patch - стандарт точечных изменений JSON-документа по RFC 6902.
- JSON Pointer - путь к узлу внутри JSON-документа, например `/root/actions/start`.
- Property panel - панель редактирования свойств выбранного узла.
- UI schema - декларативное описание раскладки формы и виджетов property panel.
- DocumentStore - единое состояние открытого authoring-документа.
- Text location map - карта authoring JSON Pointer -> line/column в JSON editor.

## Architecture Baseline

Работа опирается на:

- ADR-025: JSON Schema является single source of truth для manifest validation.
- ADR-030: authoring manifests являются редактируемым слоем, runtime manifests generated.
- ADR-031: execution plan живет в TSK и artifacts, а не в ADR.
- ADR-034: editor-engine строится как schema-first projection editor.
- `scripts/manifest-tools/compile-authoring-manifests.cjs`: текущий authoring compiler.
- `docs/architecture/schemas/game-authoring.schema.json`.
- `docs/architecture/schemas/ui-authoring.schema.json`.

## Scope

В реализованный целевой срез входит:

- создать базовый `editor-engine` module для DocumentStore, projections and diagnostics;
- подключить Monaco/JSON editor с локальными schemas;
- построить read-only graph projection для authoring manifests;
- реализовать floating property panel;
- реализовать обратную проекцию для безопасных property edits;
- сохранять изменения в authoring JSON через JSON Patch;
- добавить editor-only layout companion file;
- запускать compile and validation из editor workflow;
- синхронизировать diagnostics между graph, property panel и JSON editor;
- обновить документацию и verification checklist.

## Non-Goals

Не входит:

- исполнять graph как runtime logic;
- менять `runtime-api`, чтобы он понимал editor-only или authoring-only ключи;
- создавать game-specific node types в core editor-engine;
- строить полноценный visual programming editor;
- редактировать JSON Schema через UI;
- внедрять collaborative editing в первом slice;
- переносить compiler logic в player/runtime;
- заменять Monaco на кастомный text editor без отдельного решения.

## Requirements

### R1. Authoring JSON Is The Source Of Truth

Flow-chart, Monaco/JSON editor и property panel работают поверх одного authoring JSON. Graph state не является отдельным data source.

### R2. Game-Agnostic Core

Core editor-engine использует универсальные node roles. Конкретные игровые смыслы выводятся из `_type`, `_semantics`, schema и projection rules.

### R3. Bidirectional Projection

Projection строит graph view из authoring JSON. Reverse projection превращает visual edits в JSON Patch или отклоняет операцию с диагностикой.

### R4. Local Schema Registry

Editor использует локальные schemas из репозитория. Remote schema fetching выключен по умолчанию.

### R5. One DocumentStore

Все представления используют один DocumentStore. Нет отдельного React state для графа как источника данных.

### R6. Floating Property Panel

Property panel открывается рядом с выбранным узлом, умеет закрепляться и на узких экранах превращается в bottom sheet.

### R7. JSON Editor Navigation

Выбор graph node должен уметь открыть соответствующий JSON Pointer в Monaco. Ошибка из JSON editor должна уметь подсветить graph node, если он есть.

### R8. Diagnostics Use The Correct Maps

Authoring errors используют authoring JSON Pointer и text location map. Runtime validation errors используют compiler source map.

### R9. No Full-Document Rewrite For Small Edits

Точечные visual edits должны сохраняться как JSON Patch и текстовые edits, а не как полная перезапись authoring file.

### R10. Validation Pipeline

Editor workflow должен запускать syntax, authoring schema, semantic, compile и runtime schema validation.

## Execution Plan

### Phase 0. Documentation And Guardrails

1. Зафиксировать ADR-034.
2. Создать service design doc.
3. Создать эту TSK и execution matrix.
4. Обновить `NEXT_STEPS.md`, `PROJECT_ARCHITECTURE.md` и `PROJECT_STRUCTURE.yaml`.

### Phase 1. Module Boundary

1. Выбрать физическое место для `editor-engine` implementation.
2. Если создается новый значимый каталог, добавить `.desc.json`.
3. Определить public API:
   - `loadDocument`;
   - `applyPatch`;
   - `buildProjection`;
   - `reverseProject`;
   - `validateDocument`.
4. Добавить unit tests для JSON Pointer utilities and patch application.

### Phase 2. DocumentStore And JSON Editing

1. Реализовать DocumentStore для authoring JSON text.
2. Подключить Monaco Editor.
3. Зарегистрировать local schemas по model URI.
4. Добавить text location map.
5. Синхронизировать selection by JSON Pointer.

### Phase 3. Read-Only Graph Projection

1. Построить generic graph model.
2. Реализовать baseline projection rules.
3. Отрисовать graph view через React Flow или выбранную библиотеку.
4. Добавить layout companion file.
5. Синхронизировать graph selection с JSON editor.

### Phase 4. Floating Property Panel

1. Добавить floating property panel рядом с selected node.
2. Сгенерировать поля из JSON Schema and UI schema.
3. Поддержать primitive fields, enum, arrays and objects.
4. Показать diagnostics рядом с полями.
5. Добавить "open in JSON" action.

### Phase 5. Reverse Projection Baseline

1. Разрешить safe property edits.
2. Преобразовывать field edits в JSON Patch.
3. Отклонять небезопасные graph operations.
4. Добавить undo/redo на уровне patch history.
5. Проверить сохранение formatting policy.

### Phase 6. Validation And Preview

1. Подключить authoring schema validation.
2. Добавить semantic validation для references and duplicates.
3. Запускать manifest compiler.
4. Привязывать runtime validation diagnostics к authoring source через source map.
5. Запускать preview через player/runtime boundary.

### Phase 7. Writable Graph Operations

1. Разрешить создание узлов только для known collection rules.
2. Разрешить edge creation только для known reference fields.
3. Добавить validation before apply.
4. Добавить diff preview перед сохранением.

### Phase 8. Governance Closeout

1. Обновить service docs.
2. Добавить тесты и e2e smoke.
3. Обновить handoff log.
4. Зафиксировать deferred items as debt or follow-up TSK.

## Acceptance

| Criterion | Full implementation state |
| --- | --- |
| ADR-034 принят или явно оставлен Draft with blocker list. | Done: ADR-034 добавлен. |
| `editor-engine` имеет documented module boundary. | Done: core живет в `packages/editor-engine`, UI surface в `apps/editor-web`. |
| Monaco/JSON editor открывает authoring JSON. | Done: открывает repository-backed `games/<id>/authoring/**/*.authoring.json`. |
| Local schemas применяются без remote fetch. | Done: локальный schema registry подключен через canonical authoring schemas. |
| Read-only graph projection строится автоматически для authoring JSON. | Done for generic JSON traversal/projection. |
| Floating property panel открывается для выбранного graph node. | Done. |
| Safe property edits меняют authoring JSON через JSON Patch. | Done. |
| Selection синхронизируется между graph, property panel and JSON editor. | Done: graph selection updates panel and JSON pointer reveal. |
| Diagnostics показываются в graph, property panel and JSON editor. | Done for syntax/schema/semantic/reverse-projection diagnostics and Monaco markers. |
| Compile and runtime validation запускаются из editor workflow. | Done: `/api/editor/validate`, `/api/editor/compile`, `/api/editor/preview`. |
| Runtime/player не импортируют editor-engine. | Done by package boundary and static scan. |
| Editor-only layout data не попадает в runtime manifests. | Done: layout sidecars are separate and runtime manifest scans pass. |
| Writable graph operations доступны в безопасном подмножестве. | Done: add/remove collection item and connect/disconnect local reference fields. |

## Validation

Фактически выполненные проверки:

```text
npm run verify:manifest-authoring
npm run verify:legacy
npm run verify:game-agnostic
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
node scripts/dev/generate-structure.js
git diff --check
```

Дополнительные review checks, выполненные для platform purity and runtime leakage:

```text
rg -n "antarctica|simple-choice|Card|TeamSelection|Info" packages/editor-engine apps/editor-web/src apps/editor-web/app
rg -n "_source_trace|editor.layout" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
```

Первый `rg` должен подтверждать отсутствие game-specific branches в core editor code. Второй `rg` должен подтверждать отсутствие editor-only данных в runtime manifests.

Browser/e2e smoke checks подтвердили:

- repository-backed authoring file open/save;
- React Flow graph rendering and node drag layout persistence;
- Monaco loaded with JSON text and diagnostics;
- property panel scalar/JSON edits propagated into authoring JSON;
- add/remove/connect/disconnect graph operations;
- validate/compile/preview workflow with runtime-api and player-web;
- browser console errors were not observed after hydration.

## Artifacts

- `docs/tasks/artifacts/TSK-20260522-editor-engine-authoring-manifest-editor/execution-matrix.md`

## Handoff Log

### 2026-05-22 - Documentation Start

- Created ADR-034 for schema-first projection-based editor-engine.
- Created service design doc under `services/game-editor/docs/`.
- Created execution task and matrix for implementation.
- Next safe step: choose physical implementation boundary and create a small read-only prototype with Monaco and graph projection.

### 2026-05-22 - MVP Implementation

- Added framework-agnostic `packages/editor-engine` package:
  - JSON Pointer helpers;
  - immutable JSON Patch helpers for `add`, `replace` and `remove`;
  - `DocumentStore` snapshot/apply/select API;
  - neutral authoring graph projection;
  - reverse projection for safe property edits and layout-only node movement.
- Added `apps/editor-web` Next.js prototype:
  - React Flow canvas backed by `@cubica/editor-engine`;
  - Monaco JSON editor with local bundled authoring schema diagnostics;
  - floating property panel for scalar property edits;
  - embedded authoring sample shaped like ADR-030 game authoring input;
  - client-only editor shell to avoid React Flow and Monaco hydration drift.
- Updated root workspace scripts:
  - `verify:editor-engine`;
  - `verify:editor-web`.
- Validation passed:
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:manifest-authoring`;
  - `npm run verify:legacy`;
  - `npm run verify:game-agnostic`;
  - `node scripts/dev/generate-structure.js`;
  - `git diff --check`.
- Browser smoke passed on `http://localhost:3002`: React Flow rendered 120 visible nodes, Monaco loaded, and no browser console errors were observed after hydration.
- At that point, remaining follow-up was to connect editor workflow to real repository-backed authoring files, compiler validation and player preview. Later stages completed that follow-up.

### 2026-05-22 - Documentation Refresh

- Updated this task with Current State, MVP acceptance status and factual verification evidence.
- Updated the execution matrix with MVP verification evidence and follow-up slices.
- Updated project documentation so `PROJECT_ARCHITECTURE.md`, `services/game-editor/DEV_GUIDE.md`, `NEXT_STEPS.md` and the service design doc no longer describe `editor-engine` as only planned work.

### 2026-05-22 - Full Implementation Resumed

- User requested continuing until the full `editor-engine` scope is implemented.
- Implementation policy for this continuation: Codex worker subagents own production code changes; orchestrator owns routing, verification, documentation and acceptance control.
- Stage 1 started with `packages/editor-engine` as the only write scope: precise text location map, schema registry, validation diagnostics and writable reverse projection primitives.

### 2026-05-22 - Stage 1 Core Accepted

- Stage 1 worker completed `packages/editor-engine` core primitives:
  - precise `TextLocationMap`;
  - Ajv-backed local schema registry;
  - generic semantic diagnostics for duplicate `id` values and unresolved local `$ref`;
  - guarded reverse projection for add/remove/connect/disconnect intents;
  - rejected reverse projection diagnostics for unsafe operations.
- Stage 1 e2e/verification worker passed:
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - browser smoke on `http://127.0.0.1:3002`;
  - game-specific and runtime leakage scans.
- Stage 2 started for `apps/editor-web`: repository-backed file workflow, Monaco pointer navigation and diagnostics routing.

### 2026-05-22 - Stage 2 Implementation Complete, E2E Started

- Stage 2 worker completed repository-backed editor workflow in `apps/editor-web`:
  - `GET /api/editor/files`;
  - `GET /api/editor/file`;
  - `PUT /api/editor/file` with version hash conflict check;
  - file selector, dirty/saved states and save/reload flow;
  - canonical authoring schema registration;
  - Monaco marker and pointer reveal wiring;
  - diagnostics strip for syntax/schema/semantic/reverse-projection diagnostics.
- Stage 2 worker verification passed:
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`.
- Separate Stage 2 e2e/verification subagent started for file-backed browser workflow, API path guards and static scans.

### 2026-05-22 - Stage 2 Accepted

- Stage 2 e2e/verification worker passed:
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:editor-engine`;
  - browser smoke for `/?gameId=simple-choice&file=game.authoring.json`;
  - API path guard checks for traversal and generated runtime manifests;
  - runtime leakage scan.
- File-backed save smoke changed `games/simple-choice/authoring/game.authoring.json` and restored it through the API; final diff for that file was clean.
- Stage 3 started for compiler validation and preview bridge. Guardrail: runtime/player integration must stay over HTTP or tooling boundaries, not imports into `packages/editor-engine`.

### 2026-05-22 - Stage 3 Implementation Complete, E2E Started

- Stage 3 worker completed compiler validation and preview bridge:
  - reusable `scripts/manifest-tools/authoring-compiler.cjs`;
  - preserved `compile-authoring-manifests.cjs` CLI wrapper;
  - `POST /api/editor/validate`;
  - `POST /api/editor/compile`;
  - `POST /api/editor/preview`;
  - runtime-api `POST /content/reload`;
  - player-web support for preview URL query params.
- Stage 3 worker verification passed:
  - `npm run verify:manifest-authoring`;
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:player-web`;
  - `npm run verify:runtime-api`;
  - `git diff --check`.
- Separate Stage 3 e2e/verification subagent started for validate/compile/preview browser workflow and HTTP boundary checks.

### 2026-05-22 - Stage 3 E2E Blocked

- Stage 3 e2e worker passed command-level checks:
  - `npm run verify:manifest-authoring`;
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:runtime-api`;
  - `npm run verify:player-web`.
- Browser/API e2e found a real blocker: editor-web route handlers returned `500` for `/api/editor/validate`, `/api/editor/compile` and `/api/editor/preview` because Next route runtime could not load `scripts/manifest-tools/authoring-compiler.cjs`.
- Runtime/player preview sanity outside editor route worked for `simple-choice`, but does not satisfy acceptance until editor preview route works.
- Static scan for `teamSelection` across runtime/player also matched pre-existing non-editor code. This is tracked as broader platform drift and must not be used as the editor-engine purity gate; editor-engine purity scans remain scoped to `packages/editor-engine` and `apps/editor-web`.
- Blocker fix worker started for server-runtime-safe compiler module loading in editor-web routes.

### 2026-05-22 - Stage 3 Blocker Fixed, E2E Retry Started

- Blocker fix worker replaced bundled CJS require with server-runtime file URL dynamic import for `authoring-compiler.cjs`.
- Added route-level validate smoke coverage in `apps/editor-web`.
- Verification passed:
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:manifest-authoring`;
  - dev and production route smoke for `POST /api/editor/validate`.
- Stage 3 e2e retry started. Purity scan is now scoped to editor boundaries; pre-existing runtime/player `teamSelection` matches are documented as separate architecture drift.

### 2026-05-22 - Stage 3 Accepted

- Stage 3 e2e retry passed:
  - validate route returned `200`, `ok: true`, zero diagnostics for saved `simple-choice`;
  - compile route returned `200`, `ok: true`, two artifacts and zero diagnostics;
  - preview route returned `200`, `ready: true` and a player URL with `gameId=simple-choice`, `preview=1` and `sessionId`;
  - player-web opened the returned preview URL and rendered `simple-choice` content without fatal error text;
  - invalid unsaved validate request returned structured `syntax` diagnostics;
  - runtime-api `POST /content/reload` returned `200`;
  - editor purity and runtime leakage scans passed.
- No authoring or generated manifest diffs were introduced by e2e.
- Stage 4 started for remaining full-scope editor UI work: writable graph operations, editor-only layout companion persistence and richer property panel editing.

### 2026-05-22 - Stage 4 Implementation Complete, E2E Started

- Stage 4 worker completed remaining editor UI behavior:
  - `GET /api/editor/layout`;
  - `PUT /api/editor/layout`;
  - layout companion path derivation for `editor.layout.json` and `ui/<channel>.layout.json`;
  - React Flow drag position load/save through editor-only layout files;
  - UI controls for add/remove/connect/disconnect through reverse projection;
  - richer property panel with string, number, boolean, enum-hint and JSON textarea editing;
  - field-level diagnostics and explicit Open in JSON action.
- Stage 4 worker verification passed:
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `node scripts/dev/generate-structure.js`;
  - `git diff --check`;
  - runtime leakage scan.
- Separate Stage 4 e2e/verification subagent started.

### 2026-05-22 - Stage 4 Accepted

- Stage 4 e2e worker passed API and browser workflow checks:
  - `GET /api/editor/layout` and `PUT /api/editor/layout`;
  - invalid `gameId`, traversal paths and generated runtime paths rejected;
  - React Flow node drag saved editor-only layout through the layout API;
  - layout sidecar data did not appear in Monaco authoring JSON;
  - property panel numeric edit updated authoring JSON and dirty state;
  - add/remove collection item controls updated JSON through reverse projection;
  - connect/disconnect reference controls executed through reverse projection.
- Stage 4 e2e restored `games/simple-choice/authoring/game.authoring.json` and removed the temporary layout sidecar it created.
- No authoring or generated manifest diffs were introduced by Stage 4 e2e.

### 2026-05-22 - Dependency Metadata Hardening

- Worker added direct `ajv` runtime dependency to `@cubica/editor-engine`, because the package imports Ajv directly for schema validation.
- `package-lock.json` was updated through npm.
- Verification passed:
  - `npm run verify:editor-engine`.

### 2026-05-22 - Final Full-Scope Closeout

- Project and execution docs were updated to describe the full implemented state instead of the earlier MVP state.
- Structure index regenerated:
  - `node scripts/dev/generate-structure.js`.
- Final verification passed:
  - `npm run verify:manifest-authoring`;
  - `npm run verify:editor-engine`;
  - `npm test --workspace @cubica/editor-web`;
  - `npm run verify:editor-web`;
  - `npm run verify:runtime-api`;
  - `npm run verify:player-web`;
  - `npm run verify:legacy`;
  - `npm run verify:game-agnostic`;
  - `git diff --check`.
- Static invariants passed with no matches:
  - `rg -n "editor-engine" apps/player-web services/runtime-api`;
  - `rg -n "_source_trace|editor\\.layout" games/*/game.manifest.json games/*/ui/*/ui.manifest.json`;
  - `rg -ni "teamselection|teamSelection|TeamSelection" packages/editor-engine apps/editor-web/src apps/editor-web/app`.
- Remaining items are documented as follow-up work, not blockers for this task: schema-pointer UI metadata, JSON tree view (`TSK-20260522-editor-engine-json-tree-view`), collaborative editing, AI patch review and separate cleanup of pre-existing runtime/player `teamSelection` drift.

### 2026-05-22 - JSON Tree View Gap Documented

- User clarified that the original editor plan had three JSON editing modes: flow-chart, tree and text editor.
- Current implementation has flow-chart and Monaco/text editor, plus property panel, but no JSON tree view.
- ADR-034 and the service design doc were updated to make JSON tree view an explicit target mode instead of a vague future navigation layer.
- Created follow-up implementation task:
  - `docs/tasks/active/TSK-20260522-editor-engine-json-tree-view.md`;
  - `docs/tasks/artifacts/TSK-20260522-editor-engine-json-tree-view/execution-matrix.md`.
