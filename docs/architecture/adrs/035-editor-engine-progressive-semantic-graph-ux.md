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

Решение понимается так: диаграмма `editor-engine` является прогрессивно
раскрываемым семантическим графом authoring JSON, а не отображением полного
плоского JSON-дерева.

Прогрессивное раскрытие - это режим, в котором редактор показывает только выбранную ветку и ближайший контекст, а соседние ветки сворачивает. Семантический граф - это проекция authoring JSON, где узлы называются и выглядят по смыслу элемента: действие, экран, состояние, метрика, условие, ссылка, коллекция или свойство. Эти смыслы выводятся из JSON Schema, `_type`, `_semantics`, `id`, `name`, `title`, пути коллекции и декларативных правил проекции, а не из hardcoded game IDs.

## 2. Контекст

ADR-034 закрепил, что flow-chart является проекцией authoring JSON, а не вторым
источником истины. Полное плоское дерево плохо масштабируется: технические
свойства вытесняют смысловые связи, произвольное усечение может разорвать граф,
а плотная сцена становится непригодной для навигации. Поэтому ограничение
видимого графа должно следовать семантике раскрытия, а не позиции узла в массиве.

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

- по умолчанию открывается корневое резюме смысловых ветвей;
- выбор ветви раскрывает ближайший контекст и сворачивает нерелевантные соседние ветви;
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

Core editor-engine остается game-agnostic. Он не должен знать идентификатор
конкретной игры или конкретные игровые объекты.

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

Панель свойств и текстовый редактор являются сворачиваемыми проекциями того же
выбора. Их состояние может храниться в editor-only layout, а диагностика должна
оставаться активной независимо от видимости панели.

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

Visible graph должен иметь явный бюджет сложности, сохранять существующие
семантические связи и оставаться интерактивным. Конкретные числовые бюджеты и
проверяемые сценарии принадлежат исполнительской задаче.

## 9. Инварианты

- Authoring JSON remains the only editable source of truth.
- Progressive disclosure state is editor-only layout state.
- Semantic roles are projection metadata, not runtime contract.
- Runtime-api and player-web must not import editor projection code.
- No game-specific IDs or game-only branches in core editor-engine.
- Raw JSON view must remain available for exact editing.

## 10. Отклоненные альтернативы

### Keep Full JSON Tree And Style Nodes Better

Отклонено: styling не решает 120 visible nodes, 0 edges, duplicate property nodes and poor semantic labels.

### Store A Separate Visual Graph Manifest

Отклонено: это создает второй source of truth and breaks ADR-030/ADR-034.

### Make Game-Specific Projection Rules In Core

Отклонено: это нарушает platform purity. Game-specific meaning may exist only
in its authoring content or optional game-local projection metadata, not in
generic core.

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
- проверка редактора должна учитывать пригодность графа для навигации, а не
  только возможность его построения.

## 12. Связанные артефакты

- `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`
