# ADR-034: Editor Engine For Authoring Manifest Editing

- **Дата**: 2026-05-22
- **Статус**: Draft
- **Авторы**: Codex
- **Компоненты**: Game Editor, Editor Engine, Manifest Authoring, Manifest Compiler, Player Web Preview
- **Связанные решения**: ADR-025, ADR-030, ADR-031

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Архитектурные инварианты](#5-архитектурные-инварианты)
- [6. Модель редактора](#6-модель-редактора)
- [7. Проекция графа и обратная проекция](#7-проекция-графа-и-обратная-проекция)
- [8. JSON-представления: дерево и текст](#8-json-представления-дерево-и-текст)
- [9. UI и UX](#9-ui-и-ux)
- [10. Валидация и диагностика](#10-валидация-и-диагностика)
- [11. Хранение служебных данных редактора](#11-хранение-служебных-данных-редактора)
- [12. Рассмотренные варианты](#12-рассмотренные-варианты)
- [13. Отклоненные альтернативы](#13-отклоненные-альтернативы)
- [14. Последствия](#14-последствия)
- [15. Открытые вопросы](#15-открытые-вопросы)
- [16. Связанные артефакты](#16-связанные-артефакты)

## 1. Понимание решения

Решение понимается так: Cubica проектирует `editor-engine` как универсальный движок редактирования authoring-манифестов. Authoring-манифест - исходный JSON-документ для разработки игры или UI, который компилируется в runtime-манифест по ADR-030.

Редактор должен показывать authoring-манифест в нескольких представлениях: диаграмма потока, дерево JSON, текстовый JSON-редактор и инспектор свойств. При этом источник истины не меняется: редактируемым документом остается authoring JSON, а диаграмма и дерево являются его проекциями, то есть автоматически построенными представлениями.

Core editor-engine не должен знать конкретные игровые сущности вроде карточек, информационных экранов или выбора команды. Такие смыслы могут появляться только из authoring JSON, JSON Schema, UI schema и декларативных правил проекции.

## 2. Контекст

ADR-030 уже ввел обязательный authoring layer для game/UI manifests. Это решило проблему ручного редактирования больших generated runtime JSON, но не решило проблему удобного пользовательского редактирования.

Нужен инструмент, который позволит автору:

- видеть сценарные и UI-связи на диаграмме;
- видеть полную структуру authoring JSON в дереве, когда диаграмма скрывает raw details;
- править свойства выбранного узла без прямого поиска JSON Pointer;
- иметь точный JSON-режим для сложных правок;
- сразу видеть ошибки schema validation, compile validation и runtime validation;
- запускать preview через существующий player/runtime path.

Главный риск: если диаграмма станет самостоятельным форматом хранения, появится второй источник истины рядом с authoring JSON. Это нарушит ADR-030 и создаст drift между визуальным редактором, компилятором и runtime.

## 3. Термины

- **Editor engine** - платформенный модуль, который строит представления authoring JSON, принимает действия редактора и превращает их в изменения authoring JSON.
- **Диаграмма потока** - визуальное представление узлов и связей authoring-манифеста. Это не отдельный формат манифеста.
- **Проекция графа** - автоматическое построение диаграммы из authoring JSON, JSON Schema и правил проекции.
- **Обратная проекция** - превращение действия на диаграмме в изменение authoring JSON.
- **JSON Patch** - стандарт точечных изменений JSON-документа по RFC 6902. Операции используют JSON Pointer и применяются последовательно.
- **JSON Pointer** - стандартный путь к узлу внутри JSON-документа, например `/root/actions/start`.
- **Property panel** - панель свойств выбранного узла. Она редактирует JSON Pointer authoring-документа.
- **UI schema** - декларативное описание интерфейса формы: порядок полей, группы, виджеты, скрытие и режим read-only. UI schema не заменяет JSON Schema.
- **Source map compiler-а** - сопутствующий файл, который связывает generated runtime JSON Pointer с authoring-источником.
- **Text location map** - карта связи authoring JSON Pointer с line/column в текстовом JSON-редакторе.

## 4. Решение

Принять `editor-engine` как schema-first and projection-based editor.

Базовые решения:

1. Authoring JSON остается единственным редактируемым источником истины.
2. Диаграмма потока является автоматически построенной проекцией authoring JSON.
3. Любое действие на диаграмме проходит через обратную проекцию и изменяет authoring JSON.
4. Обратная проекция должна выдавать JSON Patch или более высокоуровневую editor operation, которая детерминированно сводится к JSON Patch.
5. Дерево JSON является обязательным целевым представлением для навигации, точечных структурных операций и работы с частями документа, которые намеренно скрыты из flow-chart.
6. Текстовый JSON-редактор строится на Monaco Editor или совместимом кодовом редакторе и использует те же schemas и diagnostics, что visual editor.
7. Property panel строится из JSON Schema и UI schema, но сохраняет изменения в тот же authoring JSON.
8. Позиции узлов, раскрытие групп и пользовательская раскладка хранятся в companion-файле редактора, а не в runtime-манифесте.
9. Runtime-api и player-web не получают поддержку editor-only или authoring-only ключей.

## 5. Архитектурные инварианты

- Core editor-engine game-agnostic: в нем нет hardcoded game IDs и game-specific типов.
- Конкретные смыслы узлов выводятся из authoring JSON, `_type`, `_semantics`, JSON Schema, UI schema и projection rules.
- Projection rules не являются runtime contract.
- Редактор не заменяет manifest compiler. Компиляция остается отдельным deterministic step.
- Валидация структуры authoring и runtime manifests остается JSON Schema based по ADR-025.
- Flow-chart, JSON tree, Monaco/JSON editor и property panel используют один DocumentStore.
- DocumentStore хранит текст authoring-документа, parsed JSON, pointer index, validation diagnostics и историю изменений.
- Изменения должны быть reviewable: редактор не должен переписывать весь JSON при точечной правке.
- Remote schema fetching выключен по умолчанию. Редактор использует локальный schema registry.

## 6. Модель редактора

Целевая модель состоит из следующих модулей:

| Модуль | Ответственность |
| --- | --- |
| `DocumentStore` | Единое состояние authoring-файла: текст, parsed JSON, dirty state, undo/redo, JSON Patch history. |
| `SchemaRegistry` | Локальная регистрация game/UI authoring schemas, runtime schemas, UI schemas и projection rules. |
| `ProjectionEngine` | Построение graph view из authoring JSON. |
| `TreeViewModelBuilder` | Построение JSON tree view из parsed JSON, pointer index, schema metadata и diagnostics. |
| `ReverseProjectionEngine` | Преобразование действий на графе в JSON Patch. |
| `ValidationEngine` | Синтаксическая проверка, Ajv authoring validation, semantic validation, compile validation и runtime validation. |
| `DiagnosticsRouter` | Связь ошибок с graph node, property field и строкой в JSON-редакторе. |
| `LayoutStore` | Хранение позиций узлов и раскрытия групп в editor companion file. |
| `PreviewBridge` | Запуск preview через existing runtime/player path, а не через отдельный editor runtime. |

Базовые типы узлов в core editor-engine должны быть универсальными:

- `DocumentNode`;
- `ObjectNode`;
- `CollectionNode`;
- `CollectionItemNode`;
- `DefinitionNode`;
- `ReferenceNode`;
- `PropertyNode`;
- `ExpressionNode`;
- `AssetReferenceNode`.

Специализированные подписи вроде `Action`, `Screen`, `State`, `Metric` допустимы только как projection role, вычисленная из схемы или правил. Они не должны быть game-specific.

## 7. Проекция графа и обратная проекция

ProjectionEngine строит граф из authoring JSON автоматически.

Минимальные входы:

- authoring JSON;
- JSON Schema;
- UI schema для property panel;
- projection rules;
- editor layout companion file.

ProjectionEngine не требует compiler source map, потому что работает с authoring JSON напрямую. Для каждого узла он должен сохранять:

- stable node id;
- authoring JSON Pointer;
- display label;
- projection role;
- schema pointer или resolved schema fragment;
- validation diagnostics.

Stable node id не должен зависеть только от array index. Если у объекта есть явный `id`, ключ коллекции или `_type`, они используются как часть identity. JSON Pointer остается обязательным адресом редактирования, но не единственной identity.

ReverseProjectionEngine принимает editor intent:

- изменить значение свойства;
- создать объект;
- удалить объект;
- соединить два узла;
- разорвать связь;
- переместить узел на canvas;
- переупорядочить элемент коллекции.

Каждый intent должен давать один из результатов:

- JSON Patch для authoring JSON;
- layout patch для editor layout file;
- validation error, если операция невозможна по schema/projection rules.

Соединение узлов не означает свободное рисование связи. Оно допустимо только если projection rules знают, какое поле authoring JSON должно быть изменено.

## 8. JSON-представления: дерево и текст

Первый кодовый редактор для JSON должен быть Monaco Editor, если будущий prototype не покажет блокирующую проблему. Monaco выбран из-за mature JSON language service, schema diagnostics, привычного поведения VS Code и поддержки model URI.

CodeMirror 6 остается технической альтернативой, если нужен меньший bundle, более тонкая extension architecture или встроенная collaborative editing модель.

JSON tree view является отдельным обязательным представлением, а не заменой property panel. Tree view - это древовидный вид документа: он показывает JSON-объекты, массивы и значения в иерархии, но все изменения проводит через тот же DocumentStore и JSON Patch.

Tree view нужен для задач, где flow-chart намеренно скрывает детали:

- быстрая навигация по полному authoring JSON;
- раскрытие и сворачивание произвольных JSON Pointer веток;
- создание, удаление, переименование и переупорядочивание элементов коллекций;
- поиск по ключам, значениям, `_type`, `_semantics`, `id`, `title` и diagnostics;
- выбор узла, который сразу синхронизирует flow-chart, property panel и текстовый JSON;
- показ schema title/description and validation state рядом с узлом дерева.

Tree view не должен мутировать локальный React state отдельно от DocumentStore. Его edit callbacks должны возвращать editor intents или JSON Patch. Если выбранная open-source библиотека умеет inline edit, эти callbacks должны только валидировать намерение и передавать его в editor-engine; библиотека не становится источником истины.

Для первого production slice на 2026-05-22 принято использовать собственный React renderer поверх framework-agnostic `TreeViewModel`. `json-edit-react` и `@uiw/react-json-view/editor` рассмотрены через Context7 spike, но не выбраны для первого среза: обе библиотеки удобны для tree UI, однако их edit APIs основаны на library callbacks и key-path arrays, а Cubica нужен явный JSON Pointer contract и запрет library-owned mutable JSON state. Это решение не запрещает будущий adapter, если он сохранит тот же `TreeViewModel`/DocumentStore boundary.

Минимальный контракт `TreeViewModel`:

- `pointer` для каждого узла;
- `key`, `label`, `valuePreview`, `valueType`;
- `schemaPointer` или resolved schema summary;
- `diagnostics`;
- `collapsed/expanded` state;
- `canAdd`, `canRemove`, `canRename`, `canReorder`, `readOnly`;
- связь с graph node id, если узел присутствует в visible или full graph projection.

Текстовый JSON-редактор должен:

- привязывать schema по file path/model URI, а не только через `$schema`;
- показывать syntax errors и schema errors;
- уметь перейти к JSON Pointer выбранного graph node;
- подсвечивать authoring pointer, связанный с ошибкой;
- синхронизировать selection с graph view и property panel;
- использовать formatting policy проекта;
- сохранять изменения через DocumentStore.

Для связи JSON Pointer с line/column нужен text location map. Она отличается от compiler source map:

- text location map: authoring JSON Pointer -> строка/колонка в authoring JSON text;
- compiler source map: generated runtime JSON Pointer -> authoring file/pointer.

## 9. UI и UX

Первый экран должен быть рабочим пространством автора, а не landing page.

Основные области:

- верхняя панель: game selector, channel selector, save, validate, compile, preview, undo, redo;
- центральная область: переключаемые или совместимые views `Graph`, `Tree` and `JSON text`;
- плавающий property panel рядом с выбранным узлом;
- нижняя diagnostics panel для ошибок и предупреждений;
- боковая навигация может использовать JSON tree или document outline, но tree view остается отдельным режимом редактирования, а не только меню навигации.

Property panel по умолчанию плавающий. Пользователь может закрепить его как боковую панель, если редактирует большой объект. На узких экранах он превращается в нижнюю панель.

Property panel не должен объяснять пользователю устройство редактора длинным встроенным текстом. Подсказки берутся из `title`, `description`, `examples`, `_semantics` и UI schema.

Лучшие JSON-редакторы обычно используют несколько синхронных представлений: text, tree, table/form. Поэтому DocumentStore не должен зависеть от flow-chart или Monaco. Целевой editor-engine должен иметь три способа редактирования JSON: flow-chart для смысловых связей, tree view для полной структуры и text editor для точного контроля.

## 10. Валидация и диагностика

Валидация должна быть многоступенчатой:

1. Syntax validation: JSON text корректно парсится.
2. Authoring schema validation: Ajv проверяет `game-authoring.schema.json` или `ui-authoring.schema.json`.
3. Semantic validation: редактор проверяет ссылки, уникальность id, допустимость graph connections и dangling references.
4. Compile validation: authoring compiler успешно генерирует runtime manifests и source maps.
5. Runtime schema validation: generated manifests проходят runtime JSON Schema.
6. Preview validation: player preview запускается через runtime/player boundary.

Ошибки должны маршрутизироваться сразу в четыре места:

- graph node или edge;
- JSON tree node;
- поле property panel;
- строка/колонка в JSON editor.

Ошибки runtime validation используют compiler source map, чтобы найти authoring-источник. Ошибки authoring validation используют JSON Pointer и text location map.

## 11. Хранение служебных данных редактора

Editor-only state хранится отдельно от runtime manifests.

Рекомендуемый первый формат:

```text
games/<id>/authoring/editor.layout.json
```

Для UI channel specific layout допускается:

```text
games/<id>/authoring/ui/<channel>.layout.json
```

Эти файлы могут хранить:

- позиции graph nodes;
- раскрытие групп;
- zoom/pan defaults;
- закрепленные панели;
- выбранные projection views.

Они не должны попадать в generated runtime manifests.

## 12. Рассмотренные варианты

### Вариант A. Hybrid Projection Editor

Flow-chart, JSON tree, JSON text editor и property panel работают поверх одного DocumentStore.

Плюсы:

- сохраняет ADR-030 source of truth;
- подходит для разных игр и UI channels;
- поддерживает visual editing и precise JSON editing;
- упрощает diagnostics и preview.

Минусы:

- требует ProjectionEngine и ReverseProjectionEngine;
- первый MVP сложнее простого Monaco-only редактора.

Статус: принят как целевой вариант.

### Вариант B. Monaco-First Editor

Сначала реализуется только JSON editor с schema validation, потом добавляется graph projection.

Плюсы: быстрый старт, меньше UI риска.

Минусы: не решает основной запрос на flow-chart authoring.

Статус: допустимый fallback для технического spike, но не целевая архитектура.

### Вариант B2. Custom TreeViewModel Renderer

JSON tree отрисовывается собственным UI-компонентом, а вся структура дерева строится в `packages/editor-engine` через `TreeViewModelBuilder`.

Плюсы:

- полный контроль JSON Pointer, diagnostics badges и selection sync;
- отсутствие прямой мутации документа внутри стороннего tree component;
- одинаковый model contract для graph, property panel и Monaco reveal.

Минусы:

- больше собственного UI-кода и тестов;
- schema-aware structural actions нужно добавлять поэтапно.

Статус: принят для первого JSON tree slice.

### Вариант C. Flow-Chart As Source Of Truth

Граф становится собственным форматом, из которого генерируется authoring JSON.

Плюсы: визуальная модель может быть проще для автора.

Минусы: появляется второй source of truth и отдельный DSL редактора.

Статус: отклонено.

### Вариант D. Full Visual Programming Engine

Использовать Rete.js или аналог, где граф сам становится исполняемой моделью.

Плюсы: сильная модель для visual programming.

Минусы: конфликтует с текущим manifest compiler/runtime boundary и может заменить существующую архитектуру новым DSL.

Статус: отклонено для первого editor-engine.

## 13. Отклоненные альтернативы

- Зашить в core editor-engine игровые типы вроде карточек или выбора команды. Отклонено: это нарушает platform purity.
- Хранить позиции узлов внутри runtime manifest. Отклонено: runtime contract загрязняется editor-only данными.
- Полагаться только на compiler source map для работы editor graph. Отклонено: graph строится из authoring JSON напрямую.
- Полагаться только на JSON Schema для формы property panel. Отклонено: layout формы должен задаваться UI schema.
- Включить remote schema fetching по умолчанию. Отклонено: нарушает детерминированность и усложняет безопасность.
- Переписывать весь authoring JSON при каждом visual edit. Отклонено: это ухудшает review, undo/redo и conflict handling.
- Реализовать JSON tree как локальный React state, который меняет объект в обход DocumentStore. Отклонено: это создает четвертый источник поведения рядом с flow-chart, Monaco и property panel.
- Использовать `json-edit-react` или `@uiw/react-json-view/editor` напрямую как editable tree в первом срезе. Отклонено: для текущих требований безопаснее собственный renderer над `TreeViewModel`, потому что он не создает промежуточный mutable JSON state и не переводит JSON Pointer в неявный library-specific path contract.

## 14. Последствия

Положительные:

- editor-engine остается платформенным и game-agnostic;
- authoring JSON остается единственным источником истины;
- flow-chart, JSON tree, JSON text editor и property panel не расходятся между собой;
- ошибки runtime validation можно вернуть к authoring-узлу через source map;
- будущая совместная работа и LLM-assisted editing могут использовать JSON Patch.

Trade-offs:

- нужен отдельный слой projection rules;
- reverse projection сложнее, чем простое сохранение графа;
- нужно поддерживать две карты: compiler source map и text location map;
- UI schema становится новым tooling artifact, который нужно версионировать и валидировать.

## 15. Открытые вопросы

- Где хранить projection rules: в `packages/editor-engine`, `docs/architecture/schemas`, authoring package или отдельном registry.
- Нужен ли отдельный JSON Schema для `editor.layout.json`.
- Какой минимальный schema-aware набор structural tree operations (`add/remove/rename/reorder`) разрешить после scalar `set value`.
- Нужно ли сохранять collapse/expand state дерева в `editor.layout.json` и какой schema contract нужен для этого state.
- Нужно ли поддерживать collaborative editing в первом production slice.
- Какой минимальный набор graph operations разрешить в первом writable MVP.

## 16. Связанные артефакты

- `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`
- `docs/tasks/active/TSK-20260522-editor-engine-authoring-manifest-editor.md`
- `docs/tasks/artifacts/TSK-20260522-editor-engine-authoring-manifest-editor/execution-matrix.md`
- `docs/tasks/active/TSK-20260522-editor-engine-json-tree-view.md`
- `docs/tasks/artifacts/TSK-20260522-editor-engine-json-tree-view/execution-matrix.md`
- `docs/architecture/adrs/035-editor-engine-progressive-semantic-graph-ux.md`
