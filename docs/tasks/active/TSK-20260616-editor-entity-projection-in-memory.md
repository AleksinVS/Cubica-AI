# TSK-20260616-editor-entity-projection-in-memory: In-Memory Editor Entity Projection

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Baseline](#architecture-baseline)
- [Terms](#terms)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Risks And Controls](#risks-and-controls)
- [Handoff Log](#handoff-log)

## Status

implemented-first-slice

## Understanding

Задача понята так: ADR-052 принят как целевая архитектура первого среза
project-level editor entities. Нужно реализовать in-memory
`EditorEntityProjection`, который связывает смысловые грани одного игрового или
визуального объекта across game authoring, UI authoring, source maps, схемы,
preview metadata, design artifacts and plugin metadata.

Первый срез намеренно не создает persisted `editor.entities.json`.
Сохраняемые данные остаются в authoring manifests, схемах, field dictionary,
design artifacts and project-local plugins. Future hints sidecar разрешен
только отдельным решением после доказанной пользы и только для editor-only
подсказок, которые нельзя восстановить из источников.

## Why

Текущий редактор уже умеет открывать authoring JSON, строить semantic tree,
показывать preview selection и применять `EditorChangeSet`. Но основная
единица навигации все еще часто выглядит как file-local JSON node.

Из-за этого возникают ограничения:

- пользователь видит отдельные части сущности в разных файлах, а не один
  игровой объект;
- preview selection не всегда дает полный набор связанных logic/content/view
  источников;
- property panel сложно показывать поля из нескольких authoring manifests как
  одну редактируемую сущность;
- AI assistant получает либо слишком широкий контекст, либо только один
  фрагмент;
- ADR-049 dynamic prompt projection не имеет надежной границы "текущей
  сущности" для сборки промта из нескольких манифестов.

`EditorEntityProjection` нужен как пересобираемый индекс редактора, который
решает эти задачи без создания нового source of truth.

## Architecture Baseline

Работа реализует первый срез ADR-052.

Связанная архитектура:

- ADR-025: JSON Schema остается источником истины для структур манифеста.
- ADR-030: authoring manifests являются редактируемым источником, runtime
  manifests являются compiler output.
- ADR-034: editor-engine редактирует authoring manifests через schema-first
  graph projection and JSON Patch, не создавая второго source of truth.
- ADR-036: preview-first editor, semantic entity tree, preview selection,
  AI intent queue and `EditorChangeSet` flow.
- ADR-037: project-local plugins могут вносить metadata, но не ломают platform
  purity.
- ADR-048: `_prompt` и `_promptTemplate` являются authoring-only полями.
- ADR-049: dynamic prompt projection строится из текущего JSON-узла и field
  labels, но не должна показывать технические свойства.
- ADR-050: authoring prototypes and prototype audit не являются runtime
  контрактом.
- ADR-052: in-memory `EditorEntityProjection` является принятым направлением,
  persisted hints sidecar отложен.

Практика JSON Schema: человеко-читаемые labels, descriptions and defaults
должны по возможности приходить из schema annotations и field dictionary, а не
из повторяющихся полей в каждом манифестном узле.

## Terms

- **Editor entity** - единая сущность редактора: смысловой игровой или
  визуальный объект, собранный из нескольких authoring источников.
- **EditorEntityProjection** - in-memory индекс `editor entity -> source
  facets`, который пересобирается редактором и не является проектным файлом.
- **Source facet** - грань источника: logic, content, state, view, design,
  plugin или diagnostics.
- **Lens** - правило проекции: детерминированная функция, которая узнает
  сущность и ее грани в authoring JSON, source map, schema или metadata.
- **Field dictionary** - словарь человеко-читаемых названий и правил показа
  полей. Он дополняет JSON Schema annotations и помогает скрывать технические
  свойства из пользовательской YAML-проекции.
- **Projection hints sidecar** - будущий необязательный файл подсказок
  редактора. Он не входит в этот срез и не может хранить копии игровых данных.

## Classification

Механизм является **общим платформенным editor/tooling-механизмом**.

Он нужен для классов игр и UI-каналов, не является механикой конкретной игры
`Antarctica` и не должен создавать ветки под конкретную игру в
`runtime-api`, `player-web`, manifest compiler или shared contracts.

## Scope

Входит в первый срез:

- определить TypeScript contracts для `EditorEntityProjection`, `EditorEntity`,
  `SourceFacet`, `SourcePointer`, diagnostics and projection inputs в
  `packages/editor-engine`;
- реализовать projection builder, который принимает несколько authoring
  documents и optional metadata;
- добавить первые game-agnostic lenses для ограниченного набора сущностей;
- связать logic/content/view/state/design/plugin facets через source pointers;
- использовать schema annotations and field dictionary для labels and
  meaningful-field filtering;
- исключить технические свойства из user-facing YAML/dynamic prompt projection;
- добавить diagnostics для unresolved pointers, ambiguous links, stale source
  hashes and hidden technical fields;
- дать editor-web read-only интеграцию: entity tree, property grouping, preview
  selection mapping или AI scoped context, в зависимости от минимального
  безопасного UI-среза;
- провести все durable изменения через существующий `EditorChangeSet`;
- добавить unit/snapshot tests для builder и хотя бы один editor-web integration
  test для потребления projection;
- обновить документацию фактическими деталями после реализации.

Первые lenses должны быть узкими. Предпочтительный начальный набор:

- game flow step;
- content/info block, если есть явная ссылка из step;
- UI screen or component, если есть явная binding/source pointer;
- action/effect summary как facet, а не отдельный canonical entity, если
  отдельная сущность пока не нужна.

## Non-Goals

Не входит в первый срез:

- создавать persisted `editor.entities.json`;
- создавать `games/<gameId>/authoring/editor/projection-hints.json`;
- переносить канонические связи из authoring manifests в sidecar;
- менять runtime `game.manifest.json` или `ui.manifest.json`;
- менять manifest compiler behavior beyond tests that projection is not a
  compiler input;
- реализовывать reverse-sync между `_prompt` и структурой манифеста;
- автоматически генерировать или переписывать пользовательский `_prompt`;
- делать full prompt editor UX;
- добавлять game-specific branches for `Antarctica`;
- делать projection blocking CI gate до появления стабильного контракта.

## Execution Plan

### Phase 0. Baseline And Design Lock

1. [x] Найти текущие editor-engine projection, semantic tree, source map and
   preview selection entry points.
2. [x] Выбрать первый fixture набор: желательно generic fixture и один
   `Antarctica` authoring sample без game-specific branches.
3. [x] Зафиксировать initial entity kinds and lenses в задаче перед кодом.
4. [x] Проверить, что текущие relevant tests проходят или записать unrelated
   failures в Handoff Log.

### Phase 1. Contracts

1. [x] Добавить framework-agnostic TypeScript contracts для projection inputs,
   entities, facets, pointers and diagnostics.
2. [x] Не добавлять persisted JSON Schema, если projection остается только
   process-local. Если понадобится сериализация, сначала добавить schema-first
   контракт по ADR-025.
3. [x] Добавить explicit discriminator или `kind` для entity/facet types без
   привязки к одной игре.
4. [x] Добавить source hash model только как invalidation aid.

### Phase 2. Projection Builder And Lenses

1. [x] Реализовать builder, который принимает список authoring documents and
   metadata inputs.
2. [x] Реализовать lenses для первых entity kinds.
3. [x] Собирать `primarySource`, `facets`, `label`, `entityId` and diagnostics
   без копирования source objects.
4. [x] Стабилизировать `entityId`: сначала из explicit authoring ID, иначе из
   canonical source pointer.
5. [x] Добавить diagnostics для unresolved pointer, ambiguous view link, stale
   hash and hidden technical field.

### Phase 3. Field Labels And Meaningful Projection

1. [x] Подключить schema annotations and field dictionary к builder or prompt
   projection helper.
2. [x] Определить правила скрытия технических свойств для user-facing YAML.
3. [x] Добавить tests, что technical fields не попадают в YAML projection, если
   не помечены как meaningful.
4. [x] Зафиксировать fallback label rule, если schema/field dictionary не
   содержит русского названия.

### Phase 4. Editor-Web Read-Only Integration

1. [x] Выбрать минимальную поверхность интеграции: entity tree, property panel,
   preview selection or AI scoped context.
2. [x] Подключить projection без возможности записи в новый sidecar.
3. [x] Показывать source ownership для cross-file fields.
4. [x] Все edits continue to use existing `EditorChangeSet`.
5. [x] Не менять runtime preview content source: preview получает generated
   runtime manifests.

### Phase 5. AI Context And Prompt Readiness

1. [x] Дать AI assistant scoped context по selected editor entity.
2. [x] Подготовить input для ADR-049 dynamic prompt projection: selected entity,
   significant facets, field labels, hidden technical fields and source
   pointers.
3. [x] Не реализовывать reverse-sync and automatic prompt regeneration in this
   task.

### Phase 6. Validation And Documentation Closeout

1. [x] Добавить unit/snapshot tests для projection builder.
2. [x] Добавить editor-web test для выбранной integration surface.
3. [x] Проверить, что generated runtime manifests не меняются.
4. [x] Обновить `docs/architecture/PROJECT_ARCHITECTURE.md`, если реализация
   уточнит фактический статус.
5. [x] Обновить этот TSK Handoff Log: changed files, commands, results,
   remaining gaps and next safe step.

## Acceptance

1. `packages/editor-engine` exposes in-memory `EditorEntityProjection`
   contracts and builder.
2. Builder принимает несколько authoring documents and metadata inputs.
3. Projection содержит source pointers and facets, but no copied source object
   trees.
4. Первые lenses строят coherent editor entities for at least one game
   authoring plus UI authoring fixture.
5. Technical fields are excluded from user-facing YAML/dynamic prompt
   projection by default.
6. Editor-web consumes projection in at least one read-only surface without
   persisted sidecar.
7. All durable changes still go through `EditorChangeSet`.
8. Runtime generated manifests remain unchanged.
9. No `runtime-api`, `player-web` or manifest compiler dependency on projection
   is introduced.
10. No game-specific platform branches are introduced.
11. Documentation and Handoff Log reflect the implemented scope and remaining
    gaps.

## Validation

Обязательные команды для implementation PR:

```bash
npm run verify:editor-engine
npm run verify:editor-web
npm run verify:manifest-authoring
npm run compile:manifests -- --check
rg -n 'editor.entities.json|projection-hints.json' games/*/authoring docs packages apps
git diff --check
```

Expected result:

- no persisted `editor.entities.json` is introduced;
- no `projection-hints.json` is introduced in the first slice;
- runtime manifests do not change because of projection builder;
- tests cover builder and selected editor-web integration.

If `npm run verify:canonical` is considered for this work, first record current
unrelated failures in Handoff Log. Do not hide unrelated failures by weakening
architecture checks.

## Artifacts

- `docs/architecture/adrs/052-editor-entity-projection-sidecar.md` - accepted
  architecture decision.
- `docs/architecture/PROJECT_ARCHITECTURE.md` - architecture overview synced
  with ADR-052.
- `docs/tasks/active/TSK-20260616-editor-entity-projection-in-memory.md` - this
  execution plan.
- Future implementation files will be recorded in Handoff Log after code work.

## Risks And Controls

- **Risk: hidden third source of truth.** Control: projection is in-memory and
  contains pointers, not copied source objects.
- **Risk: sidecar appears too early.** Control: persisted hints sidecar is
  explicitly non-goal for this task.
- **Risk: technical fields leak into user prompt.** Control: meaningful-field
  filtering and tests for YAML/dynamic prompt projection.
- **Risk: game-specific lenses.** Control: classify every lens as platform
  general; use fixtures without hardcoded game IDs.
- **Risk: unstable entity IDs.** Control: prefer explicit authoring IDs, then
  canonical source pointers, and document any migration risk.
- **Risk: AI context becomes too broad.** Control: assistant receives selected
  entity facets and source pointers, not whole authoring files by default.

## Handoff Log

### 2026-06-16 - Codex Documentation Setup

- Изменено:
  - `PROJECT_OVERVIEW.md`
  - `NEXT_STEPS.md`
  - `docs/architecture/adrs/052-editor-entity-projection-sidecar.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `docs/architecture/adrs/.desc.json`
  - `docs/tasks/active/.desc.json`
  - `docs/tasks/active/TSK-20260616-editor-entity-projection-in-memory.md`
  - `PROJECT_STRUCTURE.yaml`
- Сделано: ADR-052 переведен из broad draft sidecar direction в accepted
  in-memory `EditorEntityProjection` direction; full persisted
  `editor.entities.json` отклонен для первого среза; future hints sidecar
  ограничен editor-only подсказками.
- Сделано: создан исполнительный план первого среза без reverse-sync, без
  persisted sidecar and without runtime/player/compiler dependency.
- Осталось: реализовать contracts, builder, initial lenses, meaningful-field
  filtering, read-only editor-web integration and tests.
- Следующий шаг: начать Phase 0 с инвентаризации текущих `editor-engine`
  projection/source-map/preview-selection entry points.

### 2026-06-17 - First Slice Implemented

- Изменено:
  - `packages/editor-engine/src/index.ts`
  - `packages/editor-engine/tests/index.test.ts`
  - `apps/editor-web/src/lib/editor-web-adapter.ts`
  - `apps/editor-web/src/lib/editor-web-adapter.test.ts`
  - `apps/editor-web/src/lib/agent-context-projection.ts`
  - `apps/editor-web/src/lib/agent-context-projection.test.ts`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `docs/tasks/active/TSK-20260616-editor-entity-projection-in-memory.md`
- Сделано: добавлен `EditorEntityProjection` contract and in-memory builder in
  `editor-engine`. Builder принимает несколько authoring documents, строит
  entities/facets/source pointers, индексирует entities by source pointer and
  keeps source hashes as invalidation metadata.
- Сделано: реализованы первые game-agnostic lenses: game root, flow, step,
  action, metric, state model, UI root, UI screen and UI component. Связи
  строятся через `screenId`/`screen_id`, `actionId`/`actionIds`,
  content-like ids and component action payloads.
- Сделано: добавлен `buildEditorEntityYamlProjection` для ADR-049 readiness.
  Он использует field dictionary labels, скрывает technical fields вроде
  `_type`, `_label`, `_prompt` and `$schema`, and emits diagnostics for hidden
  technical fields.
- Сделано: `editor-web` view model now exposes read-only
  `editorEntityProjection`; caller may pass extra authoring documents through
  `editorEntityProjectionDocuments`.
- Сделано: Agent context now accepts selected editor entities and sends only
  entity metadata plus source pointers to the assistant. `editor-workspace`
  resolves selected pointers through `entitiesBySourcePointer`.
- Проверки:
  - `npm run verify:editor-engine` - passed.
  - `npm run typecheck --workspace @cubica/editor-web` - passed.
  - `npm test --workspace @cubica/editor-web -- src/lib/agent-context-projection.test.ts src/lib/editor-web-adapter.test.ts` - passed.
  - `npm test --workspace @cubica/editor-web` - passed, 23 files / 99 tests.
  - `npm run verify:manifest-authoring` - passed.
  - `npm run compile:manifests -- --check` - passed.
  - `find games -name 'editor.entities.json' -o -name 'projection-hints.json'` - no output.
  - `git diff --check` - passed.
- Ограничение проверки: `npm run verify:editor-web` was attempted earlier; its
  TypeScript phase passed, but Next production build stayed silent for several
  minutes after `Creating an optimized production build ...` and was
  interrupted to avoid repeating the host memory/swap failure. Full Next build
  should be retried on a stable host or with explicit memory limits.
- Осталось вне первого среза: richer cross-file property-panel ownership UI,
  broader lenses for design/plugin metadata, optional hints sidecar decision,
  reverse-sync and automatic prompt regeneration.
