# ADR-036: Semantic Authoring Structure And Preview-Timeline Editor

- **Дата**: 2026-05-27
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Manifest Authoring, Editor Engine, Editor Web, Runtime API, Player Preview, Manifest Compiler
- **Связанные решения**: ADR-025, ADR-030, ADR-034, ADR-035, ADR-037

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Authoring-структура](#5-authoring-структура)
- [6. Preview-first редактор](#6-preview-first-редактор)
- [7. Renderer adapter boundary](#7-renderer-adapter-boundary)
- [8. Timeline и история прохождения](#8-timeline-и-история-прохождения)
- [9. Выбор объектов в предпросмотре](#9-выбор-объектов-в-предпросмотре)
- [10. AI-правки, undo и версионирование](#10-ai-правки-undo-и-версионирование)
- [11. Инварианты](#11-инварианты)
- [12. Отклоненные альтернативы](#12-отклоненные-альтернативы)
- [13. Последствия](#13-последствия)
- [14. Открытые вопросы](#14-открытые-вопросы)
- [15. Связанные артефакты](#15-связанные-артефакты)

## 1. Понимание решения

Решение понимается так: прежний фокус на flow-chart больше не считается достаточным для редактора authoring-манифестов. Основной рабочий экран должен стать preview-first редактором: разработчик проходит игру в окне предпросмотра, видит хронологическую шкалу и редактирует authoring-манифест рядом с живым результатом.

Это не отменяет ADR-034 полностью: DocumentStore, JSON Patch, JSON tree, Monaco/JSON editor, property panel, schema validation и compile/preview boundary сохраняются. Меняется главный пользовательский центр тяжести: flow-chart становится optional projection, а не главным способом работы.

## 2. Контекст

ADR-034 и ADR-035 сделали редактор projection-based: граф, дерево и JSON-редактор показывают один authoring JSON. Практика показала, что даже семантическая диаграмма остается слабой моделью для игр, где важен опыт прохождения, состояние, экранный результат и повторяемая проверка изменений.

Принято концептуальное направление:

- authoring-манифест должен сам выражать смысловую структуру игры и UI;
- дерево манифеста показывает сущности, а не технические поля;
- окно предпросмотра занимает основной экран;
- timeline становится основным навигационным способом для прохождения;
- для линейных игр chronology задается authoring-манифестом;
- для нелинейных игр chronology строится из записанной истории прохождения;
- визуальный выбор объекта в предпросмотре синхронизируется с деревом, панелью свойств и AI prompt surface.

## 3. Термины

- **Preview-first редактор** - редактор, в котором основным экраном является живой предпросмотр игры, а JSON/tree/property инструменты работают как вспомогательные панели.
- **Предпросмотр** - запуск игры внутри редактора через изолированную preview session, не меняющую production session.
- **Timeline** - хронологическая шкала этапов прохождения. Для линейной игры может быть рассчитана из authoring-манифеста, для нелинейной - из записанных событий прохождения.
- **Playthrough trace** - временная запись прохождения: события игрока, состояния, selected screen/entity metadata and snapshots. Это tooling-only данные, а не часть authoring-манифеста.
- **Сущность манифеста** - смысловой объект authoring-манифеста: экран, визуальный компонент, действие, правило, состояние, метрика, поток или шаг.
- **Техническое поле** - поле, нужное компилятору, схеме, наследованию, трассировке или layout-у редактора, но не являющееся отдельной игровой или UI-сущностью для автора.
- **Hit-test** - определение объекта под координатой курсора в preview. Если объектов несколько, редактор получает stack объектов от верхнего к нижнему.
- **JSON Patch** - стандартный формат точечных изменений JSON-документа: список операций `add`, `remove`, `replace`, `test` and related operations against JSON Pointer paths.
- **ChangeSet** - группа изменений редактора. В отличие от JSON Patch, может включать JSON-патчи, текстовые diff для кода, создание/удаление файлов and generated artifact updates.
- **Worktree** - отдельная рабочая папка Git-репозитория, связанная с той же историей коммитов. Нужна, чтобы editor session могла менять файлы изолированно от основной ветки.
- **Session branch** - временная ветка Git для одной сессии редактирования.
- **Project repo** - локальный Git-репозиторий конкретного игрового проекта. Он хранит authoring-манифесты, пользовательские плагины, assets and project-specific tests.
- **Content source** - именованный источник скомпилированного runtime-контента. Обычные игроки используют опубликованный источник по умолчанию; editor preview может временно указать на generated manifests внутри session worktree.

## 4. Решение

Принять два связанных архитектурных изменения:

1. Authoring-манифесты переходят к semantic entity structure. Реальные игровые и UI-сущности живут в `root`, а `_definitions` остаются registry прототипов, а не контейнером всего документа.
2. Основной editor surface становится preview-first + timeline. Flow-chart остается допустимой вторичной проекцией для отдельных задач анализа, но больше не является обязательным главным представлением.
3. AI prompt становится автоматическим editing command: агент применяет проверенный инкрементальный ChangeSet в session worktree, пользователь видит результат и может сделать undo или save, но не подтверждает технический JSON Patch.
4. Local editor preview uses a session `contentSourceId`: editor-web compiles generated manifests into the session worktree, runtime-api registers that worktree as a temporary content source, runtime sessions remember the source, and player-web loads PlayerFacingContent from the same source.

При этом сохраняются базовые ограничения:

- authoring JSON остается source of truth для редактируемого игрового/UI-описания;
- runtime manifests остаются generated output;
- editor-only state и playthrough traces не компилируются в runtime manifests;
- runtime-api и player-web не начинают понимать authoring-only/editor-only поля.
- runtime-api и player-web могут знать только about generated runtime content sources, not authoring JSON, editor layout or editor-engine internals.
- durable версии создаются только через Git commit в project repo при Save; rollback сохраненной версии делается новым commit, not destructive reset.

## 5. Authoring-структура

Authoring schema v2 должна добавить обязательные author-facing metadata для смысловых сущностей:

- `id` - стабильный технический идентификатор, предпочтительно ASCII slug;
- `_type` - семантический тип;
- `_label` - отображаемое в редакторе имя, в UI называется "Синоним";
- `_semantics` - короткое объяснение смысла объекта, где это нужно для автора, схемы или AI assistant.

Кириллица допустима и желательна в `_label`, `title`, `name`, `description` and `_semantics`. Технические `id`, object keys, `_type` и reference keys должны оставаться ASCII-first, чтобы ссылки, JSON Pointer, diffs and CI checks были устойчивыми.

Default entity tree должен брать отображаемое имя узла из `_label`. До полного ручного выравнивания authoring-контента редактор может показывать fallback из `title`, `name` или `id`, но такой fallback не считается выполнением контракта: отсутствие `_label` у смысловой сущности должно давать диагностику authoring validation.

Game authoring structure должна отражать логику игры:

- `root.meta` - сведения об игре;
- `root.logic.flows` - сценарные или процедурные потоки;
- `root.logic.steps` или `flow.steps` - шаги для линейных и частично линейных игр;
- `root.logic.systems` - системы/подсистемы для нелинейных игр;
- `root.logic.rules` - правила и условия;
- `root.logic.actions` - действия, команды и переходы;
- `root.state` - редактируемая модель состояния;
- `root.content` - контент и assets.

UI authoring structure должна отражать дерево UI:

- `root.screens[]` содержит экраны как сущности;
- экран содержит `root` component tree;
- components use `children[]` для вложенности;
- runtime object maps вроде `screens: { "S1": ... }` могут оставаться generated output, но authoring layer должен быть удобен для tree editing and preview hit-test.

## 6. Preview-first редактор

Целевой editor layout:

- окно предпросмотра занимает почти весь экран;
- сверху узкая menu bar;
- ниже narrow toolbar для невизуальных элементов;
- ниже timeline;
- снизу status bar;
- слева collapsible manifest entity tree;
- справа collapsible Monaco/text editor;
- property panel остается floating inspector рядом с выбранной сущностью;
- AI prompt surface появляется рядом с курсором после selection или selection rectangle.

Preview должен работать через изолированную editor preview session. Редактор может использовать existing player/runtime contracts, но должен иметь быстрый feedback loop:

- документ редактируется в DocumentStore;
- изменения валидируются локально;
- compile/preview обновляется debounce-ом или по явному apply в зависимости от стоимости;
- preview получает manifest snapshot/version hash;
- тяжелые операции не блокируют ввод текста и выбор объектов.

Для локального preview session worktree является временным content source. Editor-web передает runtime-api только путь к generated runtime bundle inside `.tmp/editor-worktrees/<sessionId>` and a `contentSourceId`; runtime-api still reads generated manifests through its repository abstraction and does not import editor-engine or authoring schemas. Player-web receives the same `contentSourceId` in the preview URL, so initial PlayerFacingContent, runtime session creation and action dispatch use the same generated content.

## 7. Renderer adapter boundary

Preview-first editor must not assume that the player is rendered as DOM/React. A game can be rendered by React, Phaser, canvas, WebGL, SVG, native bridge or another engine. Therefore editor selection, overlay, timeline metadata and AI context must go through a renderer adapter boundary.

Renderer adapter - small editor-facing contract implemented by a concrete renderer. It exposes selectable entities and preview events without leaking renderer internals into `editor-engine`.

Minimum adapter responsibilities:

- report rendered entity descriptors: `entityId`, `authoringPointer`, `runtimePointer`, `_label`, semantic role, layer, bounds and visibility;
- perform hit-test for point selection and region selection;
- emit preview events for timeline recording;
- accept editor commands: highlight entity, clear highlight, jump to preview state, apply preview snapshot;
- map renderer-local objects back to authoring entities.

For Phaser specifically this means selectable objects are Phaser Game Objects, not DOM elements. The adapter must attach editor metadata to Game Objects when they are created from the manifest, enable or calculate hit areas for selectable objects, and translate Phaser camera/world coordinates into editor overlay coordinates.

The editor overlay remains outside the renderer where possible. For Phaser/canvas preview the selection frame, object picker and AI prompt should be rendered by the editor overlay above the canvas, using adapter-provided bounds. The Phaser scene may draw internal debug highlights, but those highlights are not the source of truth.

The core editor-engine remains renderer-agnostic. It works with `PreviewEntityDescriptor` and editor intents, not with `Phaser.GameObjects.GameObject`, React component instances or DOM nodes.

## 8. Timeline и история прохождения

Timeline имеет два источника:

1. **Manifest chronology** - для игр с заранее заданной последовательностью. Шкала строится из `flow.steps`, `next`, `branches`, screen/action references and state transitions.
2. **Recorded playthrough trace** - для нелинейных игр. Редактор записывает события прохождения и snapshots в tooling-only хранилище, чтобы можно было переместиться во времени или откатить preview до выбранного этапа.

Playthrough trace должен быть временным и не должен становиться source of truth для игры. Для локальной разработки он может храниться под `.tmp/editor-playthroughs/`. Если позже понадобится командная работа с зафиксированными сценариями прохождения, это должно стать отдельным reviewable artifact с отдельной схемой.

Time travel должен опираться на event log плюс snapshots. Полный replay каждого клика с начала игры допустим только для маленьких сценариев; для больших игр редактор должен восстанавливать ближайший snapshot и replay events after it.

## 9. Выбор объектов в предпросмотре

Player preview должен отдавать editor overlay metadata:

- manifest entity id;
- authoring JSON Pointer;
- generated runtime pointer if available;
- bounding rect;
- z-order/layer;
- component kind/semantic role;
- display label.

Preview не должен пытаться угадывать связь DOM -> manifest через brittle CSS selectors. Renderer должен явно проставлять editor metadata в безопасном канале: data attributes for same-origin preview, structured overlay map, or postMessage payload for iframe isolation.

При клике:

1. preview делает hit-test;
2. верхний объект становится active entity;
3. tree selection, property panel and Monaco pointer синхронизируются;
4. overlay показывает рамку выбранного объекта;
5. рядом с курсором открывается однострочный AI prompt input, который растет до заданного максимума;
6. если hit stack содержит несколько объектов, рядом появляется object picker.

При drag selection rectangle редактор должен создать region selection intent. AI assistant получает выбранную область, список intersecting entities, screenshot crop if available, current authoring pointers and diagnostics. AI-правка может применяться автоматически только после dry-run, validation and undo journal entry; пользователь не подтверждает технический patch вручную.

## 10. AI-правки, undo и версионирование

AI editing flow должен быть инкрементальным:

1. Пользователь пишет prompt на выбранной сущности или регионе preview.
2. Редактор создает `EditorPatchIntent` с prompt, target pointers, active file, session id, selected preview entities, diagnostics and scoped context.
3. Агент получает только ограниченный context: выбранные JSON subtrees, nearby siblings, schema fragments, relevant source-map entries and plugin boundary metadata. Большие authoring JSON не передаются целиком.
4. Агент возвращает `ChangeSet`, not a full rewritten manifest.
5. Редактор делает dry-run в session worktree, validates the result and applies the ChangeSet automatically if checks pass.
6. Пользователь видит результат в preview/tree/property/Monaco and a plain-language diff summary after the fact.
7. Пользователь может вызвать undo или продолжить следующими prompt-правками.
8. Save creates a Git commit in the project repo.

`ChangeSet` должен поддерживать не только JSON Patch, потому что game project может содержать пользовательские плагины:

- `jsonPatches` for authoring manifests and JSON config;
- `textPatches` or file replacement with before/after content for plugin source files;
- `fileCreates`, `fileDeletes`, `fileRenames` for plugin files, tests and assets metadata;
- generated artifacts only when project policy requires reproducible runtime bundle commits.

Undo до Save работает через session journal. Каждый инкрементальный шаг сохраняет:

- prompt and author-facing summary;
- affected files and pointers;
- forward ChangeSet;
- inverse ChangeSet;
- before/after hashes;
- validation summary.

For reliability, AI-generated JSON Patch should initially allow only `add`, `remove`, `replace` and `test`. `move` and `copy` are deferred because inverse generation and author-facing explanation are harder to guarantee.

Versioning model is Project Git Workspace with Session Worktrees:

- each game project is a local Git repository;
- each editor opening creates a session branch/worktree under `.tmp/editor-worktrees/<sessionId>`;
- all unsaved prompt edits accumulate in that session worktree and session journal;
- Save stages allowed changed files and creates one project commit;
- generated manifests/source maps are committed only by explicit project policy;
- rollback of a saved version uses a new revert/restore commit, never `reset --hard`;
- user plugins live inside the project repo and are validated as part of the same transaction;
- ADR-037 fixes the concrete plugin direction: project-local trusted plugins now, marketplace-safe sandbox evolution later, no target continuation of `apps/player-web/src/plugins` as a platform plugin home.

Plugin changes extend validation gates. A ChangeSet touching plugins must run plugin manifest schema validation, TypeScript typecheck/build where applicable, plugin unit tests if present, runtime integration smoke where applicable and platform purity checks that prevent game-specific code from leaking into platform core. The concrete plugin contract, marketplace direction, dependency policy and Antarctica plugin migration target are defined in ADR-037.

## 11. Инварианты

- JSON Schema остается source of truth для структуры authoring и runtime manifests.
- `_label` не заменяет `id`; это author-facing имя, а не ссылка.
- Каждая смысловая сущность, попадающая в default entity tree, должна иметь непустой `_label`; display fallback на `title`, `name` или `id` нужен только для временной читаемости UI.
- `_definitions` не должны снова превращаться в единственный контейнер реальных game/UI сущностей.
- Tree view показывает semantic entities by default and hides technical fields by default.
- Technical fields remain reachable through Monaco/JSON editor and optional advanced tree mode.
- Preview integration goes through renderer adapters; editor-engine must not depend on React DOM, Phaser, canvas or a concrete renderer.
- Preview trace and editor layout are tooling-only.
- Time travel changes preview session state, not authoring source.
- AI prompt creates bounded ChangeSet operations and applies them only after dry-run, validation and undo journal recording; it never performs uncontrolled full-file rewrite.
- Unsaved AI edits remain session-scoped until Save creates a Git commit.
- Runtime/player layers не импортируют editor-engine and do not depend on editor-only traces.
- Editor preview content sources expose generated manifests only; they must not expose authoring JSON, editor layouts, patch journals or playthrough traces to runtime/player layers.
- Game-specific plugins live in the project repo/plugin boundary and must not introduce game-specific branches into platform core.
- Project-local plugins are the target model for user-editable plugins; current `apps/player-web/src/plugins/*` code is migration input, not the long-term plugin home.

## 12. Отклоненные альтернативы

### Keep Flow-Chart As Primary Surface

Отклонено как primary direction: flow-chart плохо отражает реальный опыт прохождения, состояние и layered UI. Он может остаться вторичной проекцией.

### Store Chronology Only In Editor Sidecar

Отклонено для линейных игр: если chronology является логикой игры, она должна быть в authoring-манифесте. Sidecar допустим только для recorded playthrough traces and editor layout.

### Put Display Names Only In Sidecar

Отклонено как основной путь: отображаемое имя сущности является authoring-смыслом. Sidecar mapping допустим только как временная миграционная помощь.

### Infer Preview Selection From DOM Structure Only

Отклонено: CSS/DOM shape is implementation detail. Renderer must provide explicit manifest metadata for reliable selection.

### Make Phaser The Editor Contract

Отклонено: Phaser can be a supported renderer, but the editor contract must be renderer-agnostic. Otherwise future React, DOM, Three.js, PixiJS or native renderers would require editor-engine rewrites.

### Apply AI Prompt By Rewriting Full Source

Отклонено: это нарушает locality, undo/redo, validation discipline and large-manifest guardrails. AI must produce bounded ChangeSet operations.

### Require User To Confirm Technical Patch

Отклонено для целевого UX: пользователь может быть нетехническим автором. Patch confirmation is replaced by automatic dry-run, validation, plain-language diff summary and undo.

### Version Only Manifests Instead Of Whole Game Project

Отклонено: game development can include user plugins, assets and tests. Versioning must cover the project repository, not only authoring manifests.

## 13. Последствия

Положительные:

- редактор становится ближе к реальному процессу разработки игры: автор проходит, видит, выбирает и правит;
- semantic authoring structure improves tree, property panel, preview selection and AI editing;
- timeline covers both scripted and nonlinear games;
- flow-chart перестает быть forced abstraction для всех типов игр.
- prompt-based edits become safe for non-technical users because technical patch details are hidden behind validation, diff summary and undo.
- local Git worktrees isolate editor sessions and support durable rollback through commits.
- `contentSourceId` lets local preview show session-generated runtime content without copying those generated files into the main checkout.

Costs:

- нужны authoring schemas v2 and migration path;
- нужен renderer adapter protocol and at least one concrete adapter for current player-web rendering;
- Phaser/canvas renderers must annotate game objects with authoring metadata and expose hit-test/bounds explicitly;
- player preview needs editor overlay metadata;
- preview bridge должен поддерживать fast snapshot updates and isolated sessions;
- playthrough trace storage and time travel require explicit validation and cleanup policy.
- editor needs a project repository service that can create worktrees, session branches, commits, revert commits and conflict checks.
- plugin editing requires broader ChangeSet support and stronger validation than manifest-only editing.
- production or remote project preview needs a generated bundle handoff policy that does not rely on local filesystem paths.

## 14. Открытые вопросы

- Нужна ли совместимость authoring schema v1/v2 через compiler adapter или миграция должна быть one-way.
- Должен ли preview быть same-origin embedded component or iframe with postMessage boundary.
- Какой первый renderer adapter должен стать reference implementation: current React player renderer или Phaser prototype.
- Где хранить long-lived named playthrough scenarios, если они станут частью тестирования.
- Какой минимальный protocol нужен AI assistant для region selection, automatic ChangeSet generation and repair attempts.
- Какие technical fields скрывать в entity tree by default, and how to expose advanced mode.
- Где проходит граница между reusable platform capability and game-specific plugin code.
- Какая политика проекта определяет, коммитятся ли generated manifests/source maps together with authoring files.
- Как переносить `contentSourceId` model в удаленную/production среду: через uploaded generated bundle, object storage, repository service API или isolated runtime worker.

## 15. Связанные артефакты

- `services/game-editor/docs/editor-engine-preview-timeline-editor.md`
- `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`
- `docs/architecture/adrs/034-editor-engine-authoring-manifest-editor.md`
- `docs/architecture/adrs/035-editor-engine-progressive-semantic-graph-ux.md`
