# ADR-035: Progressive Semantic Graph UX For Editor Engine

- **Дата**: 2026-05-22
- **Статус**: Draft
- **Авторы**: Codex
- **Компоненты**: Editor Engine, Editor Web, Manifest Authoring
- **Связанные решения**: ADR-025, ADR-030, ADR-034

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Модель прогрессивного раскрытия](#5-модель-прогрессивного-раскрытия)
- [6. Семантика узлов](#6-семантика-узлов)
- [7. Панели редактора](#7-панели-редактора)
- [8. Производительность](#8-производительность)
- [9. Инварианты](#9-инварианты)
- [10. Отклоненные альтернативы](#10-отклоненные-альтернативы)
- [11. Последствия](#11-последствия)
- [12. Связанные артефакты](#12-связанные-артефакты)

## 1. Понимание решения

Решение понимается так: текущая диаграмма `editor-engine` технически строится из authoring JSON, но фактически показывает плоское JSON-дерево, а не рабочую flow-диаграмму. Следующий срез должен заменить отображение полного дерева на прогрессивно раскрываемый семантический граф.

Прогрессивное раскрытие - это режим, в котором редактор показывает только выбранную ветку и ближайший контекст, а соседние ветки сворачивает. Семантический граф - это проекция authoring JSON, где узлы называются и выглядят по смыслу элемента: действие, экран, состояние, метрика, условие, ссылка, коллекция или свойство. Эти смыслы выводятся из JSON Schema, `_type`, `_semantics`, `id`, `name`, `title`, пути коллекции и декларативных правил проекции, а не из hardcoded game IDs.

## 2. Контекст

ADR-034 закрепил, что flow-chart является проекцией authoring JSON, а не вторым источником истины. Первый реализованный срез подтвердил boundary, но UI оказался непригоден для больших манифестов.

Фактический UI-snapshot Antarctica на 2026-05-22:

- screenshot: `.tmp/antarctica-editor-current-20260522-1440x1000.png`;
- DOM metrics: `.tmp/antarctica-editor-current-20260522-metrics.json`;
- accessibility snapshot: `.tmp/antarctica-editor-current-20260522-snapshot.md`.

Наблюдения:

- `nodeCount = 120`;
- `visibleCount = 120`;
- `edgeCount = 0`;
- все visible nodes используют default React Flow node renderer;
- различие ролей сведено к `role-*` CSS class и тонкой цветной линии;
- подписи строятся как role + label + JSON Pointer, поэтому пользователь видит путь JSON, а не смысл элемента;
- JSON editor занимает правую половину экрана постоянно;
- property panel уже открыт поверх graph даже без выбора meaningful node;
- попытка клика по одному узлу через Playwright зависла, что подтверждает интерактивную хрупкость текущей плотной сцены.

Причина 0 edges в UI: core projection строит `contains`/`references` edges, но web layer режет nodes до первых 120, затем фильтрует edges по visible node ids. Для больших документов это легко оставляет сцену без связей.

## 3. Термины

- **Progressive disclosure** - поэтапное раскрытие: интерфейс показывает не весь документ сразу, а выбранную ветку и ближайший контекст.
- **Active branch** - текущая ветка графа от root или выбранного semantic root до selected node.
- **Collapsed branch** - свернутая ветка: в графе виден summary node, а внутренние элементы скрыты.
- **Semantic role** - смысловая роль узла редактора, например `action`, `state`, `ui-screen`, `metric` или `condition`.
- **Presentation role** - визуальный тип узла React Flow: форма, цвет, handles, badges и layout rules.
- **Inspector** - панель свойств выбранного узла; это тот же property panel из ADR-034.

## 4. Решение

Ввести `GraphProjection v2` как две разные модели:

1. **Full projection model** - полный индекс authoring JSON: все адресуемые semantic nodes, raw property nodes, references, diagnostics и text locations.
2. **Visible graph model** - ограниченный набор узлов и связей, который показывается на canvas в текущем режиме раскрытия.

Canvas должен показывать visible graph model, а не первые N узлов полного JSON-дерева.

Принять следующие правила:

- по умолчанию открывается root summary с 3-7 top-level semantic branches;
- выбор branch раскрывает ее первый уровень и сворачивает sibling branches;
- выбор другого branch автоматически сворачивает предыдущую active branch;
- property nodes не показываются на canvas как самостоятельные узлы, если только пользователь явно не включает raw JSON/debug view;
- свойства выбранного semantic node редактируются в inspector/property panel;
- JSON editor остается точным fallback view, но может быть свернут;
- property panel по умолчанию свернут и раскрывается при выборе graph node.

## 5. Модель прогрессивного раскрытия

Editor state должен хранить:

| Поле | Назначение |
| --- | --- |
| `selectedNodeId` | Выбранный semantic node. |
| `activeBranchRootId` | Root текущей раскрытой ветки. |
| `expandedNodeIds` | Узлы, раскрытые внутри active branch. |
| `collapsedNodeIds` | Явно свернутые узлы active branch. |
| `panelState` | Открытость JSON editor и property panel. |

Переключение ветки:

1. Пользователь выбирает node, который не принадлежит текущей active branch.
2. Редактор вычисляет новый `activeBranchRootId`.
3. Старые sibling branches становятся collapsed summary nodes.
4. Новый path to selected node раскрывается.
5. React Flow получает только `visibleNodes` и `visibleEdges`.

Layout companion file может хранить раскрытие и позиции, но эти данные остаются editor-only и не компилируются в runtime manifests.

## 6. Семантика узлов

Core editor-engine остается game-agnostic. Он не должен знать `antarctica` или конкретные игровые карточки.

Semantic role выводится по приоритету:

1. декларативные projection rules;
2. `_type`, если он есть;
3. schema pointer или resolved schema fragment;
4. collection path;
5. поля `id`, `key`, `name`, `title`, `displayName`;
6. `_semantics`;
7. fallback to raw JSON role.

Базовый набор semantic roles:

| Semantic role | Источник | Визуальный смысл |
| --- | --- | --- |
| `manifest-root` | document root and root definition | стартовый overview node |
| `definition` | `/_definitions/*` | reusable prototype |
| `scenario` | scenario/root flow collections | крупная ветка логики |
| `step` | step-like object or sequence item | этап сценария |
| `action` | action collection item or action-like `_type` | команда/переход |
| `condition` | guard/condition/branch expression | branching decision |
| `state` | state object or state extension | состояние |
| `metric` | metric/stat variable definitions | числовой показатель |
| `ui-screen` | UI screen typed object | экран |
| `ui-component` | UI component typed object | визуальный компонент |
| `asset` | asset/design reference path | ресурс |
| `reference` | `$ref` or local pointer reference | связь |
| `collection` | grouped array/object collection | свернутый набор |
| `property` | scalar/raw property | только inspector/debug view |

Semantic title выводится по приоритету:

1. `title`;
2. `name`;
3. `displayName`;
4. `id` или object key;
5. short `_type`;
6. collection label;
7. compact JSON Pointer tail.

## 7. Панели редактора

JSON editor and property panel become collapsible.

Property panel behavior:

- default state: collapsed;
- selecting a graph node opens it automatically;
- close/collapse button hides it without clearing selection;
- on desktop it appears as floating inspector near selected node unless pinned;
- pinned mode docks it to the right side;
- on narrow screens it becomes bottom sheet;
- panel state can be stored in layout companion file.

JSON editor behavior:

- default state can remain open for technical authors, but user can collapse it;
- collapsed JSON editor leaves a narrow tab with diagnostics count and current pointer;
- selecting "Open in JSON" expands JSON editor and reveals the pointer;
- validation markers remain active even while JSON editor is collapsed.

## 8. Производительность

React Flow should render only the visible graph. Performance controls:

- stop rendering raw property nodes by default;
- cap visible graph by progressive disclosure, not by arbitrary `slice(0, 120)`;
- use React Flow `nodeTypes` and `edgeTypes` with memoized custom components;
- use `onlyRenderVisibleElements` for large visible branches;
- keep custom node `data` serializable and stable;
- avoid JSX labels generated inline for every node on each render;
- persist drag layout after drag stop, not on every move;
- keep minimap optional for large graphs.

Target first budget:

- initial Antarctica graph: <= 25 visible nodes;
- expanded active branch: <= 60 visible nodes;
- edge count should be non-zero whenever semantic relationships exist;
- graph interaction should not block click selection for ordinary nodes.

## 9. Инварианты

- Authoring JSON remains the only editable source of truth.
- Progressive disclosure state is editor-only layout state.
- Semantic roles are projection metadata, not runtime contract.
- Runtime-api and player-web must not import editor projection code.
- No game-specific IDs or Antarctica-only branches in core editor-engine.
- Raw JSON view must remain available for exact editing.

## 10. Отклоненные альтернативы

### Keep Full JSON Tree And Style Nodes Better

Отклонено: styling не решает 120 visible nodes, 0 edges, duplicate property nodes and poor semantic labels.

### Store A Separate Visual Graph Manifest

Отклонено: это создает второй source of truth and breaks ADR-030/ADR-034.

### Make Antarctica-Specific Projection Rules In Core

Отклонено: это нарушает platform purity. Antarctica-specific meaning may exist only in its authoring content or optional game-local projection metadata, not in generic core.

### Hide JSON Editor Permanently

Отклонено: JSON editor is required for exact authoring control and diagnostics.

## 11. Последствия

Положительные:

- graph becomes usable for large authoring manifests;
- semantic labels reduce JSON Pointer noise;
- property panel and JSON editor stop competing for canvas space;
- visible graph model gives a real performance boundary.

Costs:

- ProjectionEngine needs richer semantic metadata and expansion state;
- editor-web needs custom React Flow nodes and edges;
- e2e tests must assert graph usability, not just non-blank canvas.

## 12. Связанные артефакты

- `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`
- `docs/tasks/active/TSK-20260522-editor-engine-progressive-graph-ux.md`
- `docs/tasks/artifacts/TSK-20260522-editor-engine-progressive-graph-ux/execution-matrix.md`
