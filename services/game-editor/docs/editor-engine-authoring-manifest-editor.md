# Editor Engine: Authoring Manifest Editor Design

Документ описывает проектный контур первого `editor-engine` для редактирования authoring-манифестов Cubica.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Пользователи и сценарии](#2-пользователи-и-сценарии)
- [3. Границы](#3-границы)
- [4. Термины](#4-термины)
- [5. Архитектура](#5-архитектура)
- [6. Представления документа](#6-представления-документа)
- [7. Проекция графа](#7-проекция-графа)
- [8. Обратная проекция](#8-обратная-проекция)
- [9. JSON Tree view](#9-json-tree-view)
- [10. JSON-редактор](#10-json-редактор)
- [11. Property panel](#11-property-panel)
- [12. Валидация](#12-валидация)
- [13. Хранение файлов](#13-хранение-файлов)
- [14. Реализованное состояние](#14-реализованное-состояние)
- [15. Риски](#15-риски)
- [16. Открытые вопросы](#16-открытые-вопросы)
- [17. Реализованный UX-срез: семантическая диаграмма](#17-реализованный-ux-срез-семантическая-диаграмма)
- [18. Следующий архитектурный поворот: preview и timeline](#18-следующий-архитектурный-поворот-preview-и-timeline)

## 1. Назначение

`editor-engine` нужен, чтобы авторы могли редактировать authoring-манифесты не только как сырой JSON, но и через визуальную диаграмму потока, дерево JSON и форму свойств.

Authoring-манифест - исходный JSON-документ, который компилируется в runtime-манифест. Runtime-манифест - generated JSON, который потребляют `runtime-api`, `player-web` и другие delivery layers.

Главная цель: дать удобное редактирование без второго источника истины. Все представления должны менять один и тот же authoring JSON.

## 2. Пользователи и сценарии

Основные пользователи:

- автор игры, который собирает сценарий и UI-поведение;
- технический автор, который правит JSON напрямую;
- AI agent, который предлагает точечные изменения;
- разработчик платформы, который расширяет schemas и projection rules.

Основные сценарии:

- открыть игру и канал UI;
- увидеть flow-chart authoring-манифеста;
- открыть JSON tree для полной структуры документа;
- выбрать узел и изменить свойства в плавающей панели;
- открыть тот же узел в Monaco/JSON editor;
- создать или удалить связь на диаграмме;
- получить диагностику без запуска всего приложения;
- скомпилировать и открыть preview.

## 3. Границы

Входит:

- построение graph projection из authoring JSON;
- построение JSON tree view из authoring JSON;
- обратная проекция visual edits в JSON Patch;
- Monaco/JSON editor;
- floating property panel;
- локальная валидация authoring JSON;
- compile and preview bridge.

Не входит в первый проектный срез:

- новый runtime DSL;
- исполнение графа как отдельной логики;
- game-specific knowledge в core editor-engine;
- поддержка collaborative editing;
- полноценный schema builder;
- визуальный редактор самих JSON Schema.

## 4. Термины

- **Flow-chart** - диаграмма потока, то есть визуальное представление узлов и связей.
- **Projection** - построение представления из authoring JSON.
- **Reverse projection** - преобразование действия пользователя в изменение authoring JSON.
- **JSON Patch** - стандарт точечных изменений JSON-документа по RFC 6902.
- **JSON Pointer** - путь к узлу JSON, например `/root/screens/S1/title`.
- **Property panel** - форма свойств выбранного узла.
- **DocumentStore** - единое состояние открытого authoring-документа.
- **Diagnostics** - ошибки и предупреждения редактора, схемы, компилятора или preview.

## 5. Архитектура

Целевой поток данных:

```text
authoring JSON text
  -> DocumentStore
  -> parsed JSON + pointer index
  -> ProjectionEngine / TreeViewModelBuilder
  -> graph view / JSON tree view / JSON text editor / property panel
  -> user edit intent
  -> ReverseProjectionEngine
  -> JSON Patch
  -> DocumentStore
  -> validation + compile + preview
```

Компоненты:

| Компонент | Назначение |
| --- | --- |
| `DocumentStore` | Хранит текст, parsed JSON, undo/redo, selection, dirty state и JSON Patch history. |
| `ProjectionEngine` | Строит graph nodes и edges из authoring JSON. |
| `TreeViewModelBuilder` | Строит дерево JSON из parsed JSON, pointer index, schema metadata and diagnostics. |
| `ReverseProjectionEngine` | Проверяет visual edit и превращает его в JSON Patch или layout patch. |
| `SchemaRegistry` | Хранит разрешенные schemas, UI schemas и projection rules. |
| `ValidationEngine` | Запускает syntax, authoring schema, semantic, compile и runtime validation. |
| `DiagnosticsRouter` | Привязывает ошибку к graph node, property field и строке JSON. |
| `PreviewBridge` | Запускает preview через существующие runtime/player contracts. |

Фактическая реализация на 2026-05-22:

- `packages/editor-engine` содержит framework-agnostic core: `DocumentStore`, JSON Pointer helpers, immutable JSON Patch helpers, text location map, Ajv-backed local schema registry, neutral graph projection, `TreeViewModelBuilder`, semantic diagnostics и reverse projection intents.
- `apps/editor-web` содержит Next.js App Router editor surface: React Flow canvas, custom JSON Tree view, Monaco JSON editor, floating property panel, local canonical schema diagnostics, repository-backed authoring file open/save, editor-only layout sidecar persistence и validate/compile/preview workflow.
- `scripts/manifest-tools/authoring-compiler.cjs` предоставляет reusable compiler module, а `compile-authoring-manifests.cjs` остается CLI wrapper.
- `services/runtime-api/` предоставляет generic `POST /content/reload` для сброса generated content cache перед preview.
- `apps/player-web/` принимает preview query params, возвращенные editor preview route.
- `services/game-editor/` остается service/documentation boundary и owner проектного контекста editor workflows.

## 6. Представления документа

Целевой обязательный набор:

- graph view;
- JSON tree view;
- Monaco/JSON editor;
- floating property panel;
- diagnostics panel.

Целевая архитектура содержит три режима редактирования JSON:

| Режим | Основная задача | Ограничение |
| --- | --- | --- |
| Flow-chart | Показать смысловые связи, ветки сценария, UI-композицию и reference edges. | Не должен показывать все raw properties как canvas nodes. |
| JSON tree view | Показать полную структуру authoring JSON с раскрытием, поиском и точечными операциями над узлами. | Не должен иметь собственный mutable source of truth. |
| Text JSON editor | Дать точный контроль текста, форматирования и сложных ручных правок. | Не должен обходить validation and DocumentStore sync. |

## 7. Проекция графа

Core editor-engine не знает конкретные игровые сущности. Узлы графа строятся по общим правилам:

- объект с `_definitions` может дать `DefinitionNode`;
- объект с `_type` может дать semantic node;
- объект с `id` или ключом коллекции может дать stable node identity;
- поле со ссылкой может дать edge;
- массив объектов может стать grouped collection.

Графовый узел должен хранить:

- `nodeId`;
- `pointer`;
- `label`;
- `role`;
- `schemaPointer`;
- `diagnostics`;
- `layoutState`.

`role` не является runtime-сущностью. Это роль редактора, например `definition`, `reference`, `collection-item`, `view-like`, `action-like`.

## 8. Обратная проекция

Visual edit не должен сохраняться как отдельный graph JSON.

Каждая операция превращается в:

- JSON Patch authoring-документа;
- layout patch для companion-файла;
- отказ с объяснением, если операция невозможна.

Примеры:

| Действие пользователя | Результат |
| --- | --- |
| Изменить текст поля в property panel | `replace` по JSON Pointer. |
| Добавить элемент коллекции | `add` в JSON object или array. |
| Удалить узел | `remove` плюс semantic validation ссылок. |
| Соединить два узла | `add` или `replace` ссылочного поля, если projection rule знает это поле. |
| Переместить узел на canvas | Изменение `editor.layout.json`, не authoring JSON. |

Операции должны быть атомарными: если одна операция patch sequence невозможна, весь intent отклоняется.

## 9. JSON Tree view

JSON Tree view - это древовидный редактор структуры authoring JSON. Он нужен между semantic graph и текстовым JSON: graph показывает только полезную смысловую проекцию, а Monaco показывает весь текст; tree дает полный, но управляемый иерархический обзор.

Целевой UX:

- левая или центральная вкладка `Tree` рядом с `Graph` и `JSON`;
- раскрытие и сворачивание веток с сохранением состояния в editor-only layout companion file;
- поиск по ключам, значениям, `_type`, `_semantics`, `id`, `title` и diagnostics;
- клик по узлу выбирает JSON Pointer и синхронизирует graph, property panel and Monaco;
- двойной клик или inline action запускает безопасное редактирование значения, ключа или элемента коллекции;
- context actions для add/remove/rename/reorder доступны только если schema/projection metadata разрешают операцию;
- узлы дерева показывают value preview, value type, diagnostics badge и schema title/description, если они есть.

Архитектурный контракт:

- tree строится из `DocumentStore.snapshot().json`, pointer index, schema registry and diagnostics;
- каждый tree node обязан иметь JSON Pointer;
- tree edits возвращаются как editor intent или JSON Patch через `editor-engine`;
- локальный state tree-компонента хранит только UI state: раскрытие, focus, scroll, temporary edit draft;
- библиотека отображения не применяет изменения к документу напрямую.

Кандидаты для первого implementation slice:

| Вариант | Сильные стороны | Ограничения |
| --- | --- | --- |
| `json-edit-react` | Богатые callbacks, inline editing, collapse control, custom buttons, Ajv validation examples. | Нужно жестко отключить прямую мутацию и обернуть updates в DocumentStore intents. |
| `@uiw/react-json-view/editor` | Хороший tree renderer, editable mode, controlled collapse and display options. | Требуется адаптер путей и validation rejection через callbacks. |
| Собственный renderer поверх `TreeViewModel` | Полный контроль pointer sync, schema badges and actions. | Больше кода и тестов; стоит выбирать только если готовые библиотеки мешают архитектуре. |

Context7 spike 2026-05-22 показал, что `json-edit-react` и `@uiw/react-json-view/editor` подходят как готовые tree components, но их edit APIs требуют library callbacks и key-path arrays. Для первого среза выбран собственный renderer поверх `TreeViewModel`, потому что он сохраняет JSON Pointer как явный contract и не создает library-owned mutable JSON state.

## 10. JSON-редактор

Первый выбор - Monaco Editor.

Требования:

- schema association по model URI и file path;
- отключенное remote schema fetching по умолчанию;
- подсветка syntax и schema diagnostics;
- переход к JSON Pointer;
- синхронизация selection с graph view;
- форматирование по единому стилю;
- поддержка больших файлов без full-document rewrite на каждое действие.

Для навигации нужен text location map: authoring JSON Pointer -> line/column. Это отдельная карта, не compiler source map.

## 11. Property panel

Property panel плавает рядом с выбранным узлом. Пользователь может закрепить ее справа или снизу.

Панель строится из:

- JSON Schema;
- UI schema;
- `_semantics`;
- текущего JSON value;
- diagnostics.

Панель должна поддерживать:

- обязательные поля;
- enum/select;
- boolean toggles;
- array/object editors;
- read-only/deprecated indicators;
- inline validation;
- reset field;
- open in JSON editor.

UI schema нужна отдельно от JSON Schema, чтобы не загрязнять data contract layout-настройками.

## 12. Валидация

Порядок проверок:

1. JSON syntax.
2. Authoring JSON Schema.
3. Semantic validation редактора.
4. Manifest compiler.
5. Runtime JSON Schema.
6. Preview smoke validation.

Ошибки должны иметь:

- severity;
- source;
- message;
- authoring pointer;
- tree node pointer, если найден;
- graph node id, если найден;
- text range, если найден;
- suggested fix, если безопасно.

Compiler source map используется только для ошибок generated runtime. Для authoring JSON используется pointer index и text location map.

## 13. Хранение файлов

Authoring input:

```text
games/<id>/authoring/game.authoring.json
games/<id>/authoring/ui/<channel>.authoring.json
```

Editor companion files:

```text
games/<id>/authoring/editor.layout.json
games/<id>/authoring/ui/<channel>.layout.json
```

Generated runtime output остается там, где уже определено ADR-030:

```text
games/<id>/game.manifest.json
games/<id>/ui/<channel>/ui.manifest.json
```

## 14. Реализованное состояние

Первый полный срез реализован как локальный developer-facing редактор authoring-манифестов:

- Monaco/JSON editor открывает реальные `games/<id>/authoring/**/*.authoring.json` файлы и применяет локальные schema diagnostics.
- React Flow строит graph projection автоматически из authoring JSON.
- Floating property panel открывается для выбранного узла и применяет string, number, boolean, enum-hint, array/object edits через JSON Patch.
- Reverse projection разделяет authoring patches и layout patches, а также поддерживает add/remove collection item и connect/disconnect local reference fields.
- JSON Tree view реализован как вкладка `Tree` рядом с `Graph`: дерево pointer-complete, показывает type/value preview/child count/diagnostics, поддерживает search, UI-only collapse, selection sync, `Open in JSON` и scalar `set value` через существующий patch path.
- Canvas drag сохраняет позиции в editor-only companion files (`editor.layout.json` и `ui/<channel>.layout.json`), не меняя authoring JSON.
- File API открывает и сохраняет только allowlisted authoring paths и блокирует traversal/generated runtime paths.
- Validate/compile/preview actions вызывают editor route handlers, reusable compiler, runtime-api reload boundary и player-web preview URL.
- Root workspace содержит `verify:editor-engine` и `verify:editor-web`.

Не включено в первый полный срез и остается следующим production work:

- schema-pointer based UI metadata для точного выбора property panel widgets;
- schema-aware structural tree operations: `add/remove/rename/reorder`;
- сохранение collapse/expand state дерева в editor-only layout sidecar;
- сложный drag-and-drop между коллекциями;
- multi-user editing;
- AI editing без JSON Patch review.

## 15. Риски

| Риск | Последствие | Контроль |
| --- | --- | --- |
| Граф становится вторым источником истины. | Drift между visual state и authoring JSON. | Хранить только layout state, все data edits через JSON Patch. |
| Core знает игровые сущности. | Game-specific drift в платформе. | Role and label выводятся из schema/projection rules. |
| JSON editor и graph имеют разные state. | Потеря изменений и конфликт UX. | Один DocumentStore. |
| Ошибки runtime не мапятся обратно к authoring. | Автор видит generated pointer, который трудно исправить. | Использовать compiler source map для runtime diagnostics. |
| Schema annotations бедные. | Property panel выглядит непонятно. | Обновлять schemas с `title`, `description`, `examples`, `deprecated`, `readOnly`. |

## 16. Открытые вопросы

- Где хранить UI schema и projection rules физически, когда schema-pointer based widgets станут обязательными.
- Как синхронизировать editor layout при массовых JSON Patch changes от AI agent.
- Какой UX нужен для сложного drag-and-drop между коллекциями и preview diff перед сохранением.
- Какие schema rules должны открывать structural tree operations после безопасного scalar edit subset.

## 17. Реализованный UX-срез: семантическая диаграмма

Первый raw graph доказал architecture boundary, но был непригоден как рабочая диаграмма для больших authoring-манифестов. Antarctica UI snapshot на 2026-05-22 показал:

- 120 узлов на экране сразу;
- 0 отрисованных связей;
- все узлы используют default React Flow presentation;
- подписи основаны на JSON Pointer, а не на смысле элемента;
- JSON editor и property panel постоянно занимают пространство canvas.

UX-срез ADR-035 реализован: raw JSON-tree canvas заменен на progressive semantic graph.

Текущее поведение:

- initial graph показывает root summary и несколько top-level semantic branches, а не весь JSON;
- выбор branch раскрывает текущую ветку и сворачивает предыдущую;
- raw property nodes скрыты по умолчанию и редактируются через property panel;
- semantic nodes получают `semanticRole`, `semanticTitle`, `semanticSummary` and `presentationRole`;
- React Flow uses custom node and edge renderers for semantic roles;
- visible graph has non-zero semantic edges when relationships exist;
- JSON editor can collapse to a rail and expand on "Open in JSON";
- property panel is collapsed by default and opens when user selects a graph or tree node;
- JSON Tree view дополняет graph: показывает полную структуру документа, но не возвращает raw-property canvas.

Semantic roles are editor projection metadata, not runtime contracts. They must be inferred from JSON Schema, `_type`, `_semantics`, collection path and authoring labels without hardcoded game IDs.

Performance budget for the first implementation:

- initial Antarctica graph: no more than 25 visible nodes;
- expanded branch: no more than 60 visible nodes;
- ordinary graph node click must not time out in Playwright e2e;
- graph view must not rely on arbitrary `slice(0, 120)`.
## 18. Следующий архитектурный поворот: preview и timeline

ADR-036 фиксирует следующую целевую переоценку editor-engine: flow-chart больше не считается главным рабочим экраном. Он остается допустимой проекцией для анализа связей, но основной editor surface должен стать preview-first workspace.

Новый контекст доработки хранится в `services/game-editor/docs/editor-engine-preview-timeline-editor.md`.

Ключевые изменения:

- authoring-манифесты должны перейти к semantic entity structure: реальные game/UI сущности живут в `root`, а `_definitions` остаются прототипами;
- у смысловых сущностей появляется editor label, отображаемый в UI как "Синоним";
- preview занимает основной экран редактора;
- timeline становится главным способом навигации по прохождению;
- tree показывает сущности манифеста, а technical fields скрывает по умолчанию;
- выбор объекта в preview синхронизирует tree, Monaco, property panel and AI prompt surface.
