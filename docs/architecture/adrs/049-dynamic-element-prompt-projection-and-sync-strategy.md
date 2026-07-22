# ADR-049: Dynamic Element Prompt Projection And Sync Strategy

- **Дата**: 2026-06-13
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Authoring manifests, UI authoring manifests, Game Editor, editor-engine, Agent UI, manifest schemas
- **Связанные решения**: ADR-025, ADR-030, ADR-034, ADR-036, ADR-048

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Принятое решение](#3-принятое-решение)
- [4. UI-правило показа промта](#4-ui-правило-показа-промта)
- [5. Контракт `_prompt` для невосстановимого остатка](#5-контракт-_prompt-для-невосстановимого-остатка)
- [6. Dynamic YAML projection](#6-dynamic-yaml-projection)
- [7. Field dictionary и русские названия](#7-field-dictionary-и-русские-названия)
- [8. Стартовая генерация заготовки](#8-стартовая-генерация-заготовки)
- [9. Хранение inline и Markdown](#9-хранение-inline-и-markdown)
- [10. Drift diagnostics и repair suggestions](#10-drift-diagnostics-и-repair-suggestions)
- [11. JSON vs YAML для манифестов](#11-json-vs-yaml-для-манифестов)
- [12. Инварианты](#12-инварианты)
- [13. Альтернативы](#13-альтернативы)
- [14. Последствия](#14-последствия)

## 1. Понимание решения

Решение понято так: Cubica возвращается к динамическому compiled prompt, но не как к сохраненному второму источнику истины. Пользователь видит единый промт, собранный из двух частей:

1. Статическая часть из `_prompt` хранит только невосстановимое авторское намерение: то, что агент не смог надежно сопоставить с существующими структурированными полями.
2. Динамическая часть является YAML-проекцией выбранного JSON-узла. Проекция - это человеко-читаемое представление значимых игровых или визуальных данных для редактора, а не новый формат хранения и не локализованная техническая копия JSON.

Обратное преобразование из отредактированного пользователем compiled prompt в manifest changes должно идти через ИИ-агента и возвращать `EditorChangeSet`, потому что пользователь может менять порядок, отступы, формулировки и русские названия полей. После применения change set динамический YAML-блок пересобирается из JSON.

Этот ADR объединяет принятые направления хранения prompt residue, dynamic YAML projection, словаря русских названий полей и A + B lite sync: drift diagnostics + repair suggestions через `EditorChangeSet`.

## 2. Контекст

ADR-048 ввёл `_prompt` и `_promptTemplate`. Legacy-форма хранит `raw` и
`normalized` inline в authoring JSON; она остаётся миграционным входом, а не
целевым контрактом синхронизации.

После обсуждения выявлены проблемы:

- `raw` и `normalized` легко начинают расходиться;
- сохранять полный compiled prompt нельзя: его динамическая часть уже есть в JSON-структуре и должна пересобираться;
- хранить русские названия полей внутри каждого элемента нельзя: это размножает одинаковую справочную информацию и создает риск противоречий;
- хранить длинные промты inline неудобно;
- без drift diagnostics пользователь не увидит, что статический авторский остаток больше не соответствует структуре элемента.

## 3. Принятое решение

Принять dynamic projection direction:

1. `_prompt` хранит только static prompt residue - статический текст, который не восстановим из game/UI authoring JSON.
2. Динамическая часть compiled prompt всегда строится из выбранного JSON-узла и связанных узлов.
3. Динамическая часть показывается пользователю в YAML-форме с русскими названиями только значимых игровых, методических или визуальных свойств.
4. Русские названия берутся из schema annotations и field dictionary, а не из каждого элемента.
5. Если у элемента нет `_prompt`, редактор строит temporary prompt draft из `_promptTemplate`, static residue placeholder и YAML-проекции текущих структурных полей.
6. Temporary prompt draft не сохраняется в authoring JSON, пока пользователь не подтвердит или не отредактирует статическую часть.
7. Изменение YAML-блока пользователем не применяется напрямую. Агент получает compiled prompt, schema context, field dictionary и projection source map, после чего возвращает `EditorChangeSet`.
8. Inline-хранение остается default для короткого static residue.
9. External Markdown разрешается для длинного static residue.
10. Drift diagnostics работает для static residue через covered pointers и hash.
11. LLM может предложить repair только как `EditorChangeSet`, без автоматического применения.

## 4. UI-правило показа промта

Когда пользователь выбирает элемент в дереве редактора:

1. UI всегда показывает compiled prompt: static residue + dynamic YAML projection.
2. Если у элемента есть сохраненный `_prompt`, static residue берется из него.
3. Если `_prompt` отсутствует, static residue берется из `_promptTemplate` или пустой заготовки.
4. Dynamic YAML projection всегда пересобирается из текущего JSON-узла и связанных authoring-файлов.
5. Если `_prompt` отсутствует, UI помечает compiled prompt как unsaved draft:
   - берет `_promptTemplate` из прототипа;
   - добавляет текущие параметры элемента из game/UI authoring fields;
   - добавляет видимые связи: action, effects, bindings, screen/component context, если они доступны;
   - показывает заготовку как unsaved draft.
6. Пользователь может:
   - принять заготовку как prompt;
   - отредактировать заготовку и сохранить;
   - оставить элемент без prompt.

Важное правило: dynamic YAML projection является UI view, а не source of truth. Он может быть пересобран в любой момент из JSON.

## 5. Контракт `_prompt` для невосстановимого остатка

Предпочтительный будущий контракт хранит не полный prompt, а static residue:

```json
{
  "_prompt": {
    "version": 3,
    "status": "confirmed",
    "staticText": "Методический смысл и авторские ограничения, которые не выражены отдельными полями манифеста.",
    "origin": "user",
    "language": "ru",
    "updatedAt": "2026-06-13T00:00:00Z"
  }
}
```

Для external Markdown:

```json
{
  "_prompt": {
    "version": 3,
    "status": "confirmed",
    "ref": "prompts/items/example-choice.prompt.md",
    "contentHash": "sha256:...",
    "origin": "user",
    "language": "ru",
    "updatedAt": "2026-06-13T00:00:00Z"
  }
}
```

Предлагаемые поля:

- `version` - версия prompt contract.
- `status` - `draft`, `confirmed`, `stale`, `conflict`, `ignored`.
- `staticText` - inline static residue, если он хранится в JSON.
- `ref` - путь к Markdown-файлу, если static residue хранится отдельно.
- `contentHash` - hash Markdown-файла для external static residue.
- `origin` - `user`, `generated-starter`, `imported`, `migration`.
- `language` - язык static residue.
- `updatedAt` - время последнего подтвержденного изменения.

JSON Schema разрешает либо `staticText`, либо `ref + contentHash`, но не оба
варианта одновременно.

Полный compiled prompt не хранится. Он строится как:

```text
compiledPrompt = _prompt.staticText/ref + YAML projection(selected node + related nodes)
```

## 6. Dynamic YAML projection

Dynamic YAML projection (динамическая YAML-проекция) - это временное YAML-представление значимых authoring-сущностей и свойств с локализованными названиями полей.

Проекция не должна показывать технические поля. К техническим относятся, например, `id`, `_type`, `_label`, `_semantics`, `_prompt`, `_promptTemplate`, указатели source map, ссылки на схемы, metadata импорта, внутренние ссылки, пути файлов, hash-поля и другие служебные данные редактора или runtime. Эти значения могут использоваться скрыто для сопоставления, но не должны появляться в YAML как редактируемые пользовательские свойства.

Сборщик проекции должен строить не локализованную копию JSON, а смысловую проекцию:

- включать видимые тексты, игровые действия, изменения показателей, условия доступности, переходы, привязки действий и визуально значимые свойства компонентов;
- группировать свойства по игровым или визуальным сущностям, например "Карточка выбора", "Поведение при выборе", "Изменения показателей";
- использовать технические идентификаторы только в скрытой source map, если они нужны для reverse direction;
- не показывать поле только потому, что оно существует в JSON.

Пример:

```yaml
Интерактивный объект:
  Видимый текст: "Example choice"
  Действие при выборе: "Apply declared action"
  Изменение показателя:
    Значение: +1
```

Сборщик проекции должен строить скрытую source map, которая не видна пользователю по умолчанию:

```json
{
  "projectionId": "prompt-projection-...",
  "locale": "ru",
  "entries": [
    {
      "displayPath": ["Интерактивный объект", "Видимый текст"],
      "sourcePointer": "/root/content/items/0/label",
      "schemaPointer": "https://cubica.platform/schemas/game-authoring.v2.json#/definitions/gameAction/properties/params",
      "valueHash": "sha256:..."
    }
  ]
}
```

Reverse direction:

1. Пользователь редактирует compiled prompt.
2. Editor отправляет агенту compiled prompt, JSON-фрагменты, schema context, field dictionary и projection source map.
3. Агент разбирает изменения, отделяет static residue от структурных правок и возвращает:
   - новый `_prompt.staticText` или `ref` content;
   - `EditorChangeSet` для JSON-структуры;
   - diagnostics для неоднозначных или нераспознанных полей.
4. Editor выполняет dry-run, JSON Schema validation, semantic validation и показывает diff summary.
5. После подтверждения пользователя change set применяется, а YAML projection пересобирается из JSON.

## 7. Field dictionary и русские названия

Field dictionary (словарь полей) - это authoring/editor metadata, которая сопоставляет стабильные machine keys с русскими названиями, описаниями и синонимами.

Слои словаря:

1. **JSON Schema annotations** - базовый слой. Для стабильных platform fields использовать стандартные `title` и `description`; они уже предназначены для документации и UI display.
2. **Platform field dictionary** - future authoring-only каталог для платформенных прототипов и полей, которые требуют локализации или синонимов поверх схемы.
3. **Game/editor manifest overlay** - локальные переопределения для конкретной игры, прототипа или предметной области.

Словарь не должен ключеваться только по имени свойства (`title`, `id`, `type`). Ключ должен включать контекст:

```json
{
  "_editor": {
    "locale": "ru",
    "fieldDictionary": {
      "schema:https://cubica.platform/schemas/game-authoring.v2.json#/definitions/gameAction/properties/displayName": {
        "label": "Видимое название",
        "aliases": ["Название действия", "Подпись действия"]
      },
      "semanticType:game.InteractiveItem/params/label": {
        "label": "Видимый текст",
        "aliases": ["Подпись", "Текст элемента"]
      }
    }
  }
}
```

Если словарь живет в editor-manifest, он должен быть overlay: хранить только локальные переопределения и дополнительные semantic type mappings, а не дублировать все платформенные названия. Для него нужны validation gates:

- no duplicate dictionary keys;
- no conflicting labels for one key in one locale;
- warning when sibling properties render with identical labels;
- warning when a YAML edit mentions a label that maps to multiple fields in the same projection;
- warning when a dictionary entry exposes a technical field as user-editable YAML content;
- source map must remain the primary resolver for existing projected fields.

## 8. Стартовая генерация заготовки

Prompt draft builder (сборщик стартовой заготовки) должен быть deterministic where possible.

Источники:

- `_promptTemplate` прототипа;
- human-facing `title`, `name`, `description`;
- `_label` and `_semantics` only as internal context for headings and grouping, not as projected editable fields;
- game action metadata: handler, effects, guards, transitions;
- UI metadata: component type, visible text, actions, bindings, screen context;
- selected preview entity metadata, если выбор пришел из preview.

Пример результата:

```text
Создать описание элемента на основе нейтрального прототипа.

Текущее содержимое:
- Заголовок: Example item
- Действие: Apply declared action
- Эффект: metric +1

Дополните авторский смысл, методическую цель и ограничения поведения.
```

LLM можно использовать только для polish step, если deterministic draft уже собран. Но LLM-generated starter не сохраняется автоматически.

## 9. Хранение inline и Markdown

Inline остается default:

- короткий static residue;
- частые JSON Patch edits;
- простое копирование элемента;
- низкий риск merge conflicts.

Markdown разрешается как opt-in:

```text
games/<game-id>/authoring/prompts/<domain>/<prompt-id>.prompt.md
```

Markdown-файл хранит только prompt text, без обязательного frontmatter. Metadata остается в JSON `_prompt`.

Editor обязан показывать inline и Markdown static residue одинаково в UI. Save должен быть атомарным: если меняется `ref`/`contentHash` и Markdown text, это один `EditorChangeSet`.

## 10. Drift diagnostics и repair suggestions

Drift diagnostics (диагностика дрейфа: проверка, что prompt residue и структура больше не совпадают) работает по covered pointers.

Минимальная sync metadata:

```json
{
  "sync": {
    "version": 1,
    "state": "in-sync",
    "coveredPointers": [
      {
        "pointer": "/root/logic/actions/0/displayName",
        "role": "action.label",
        "hash": "sha256:..."
      }
    ],
    "structureHash": "sha256:...",
    "promptHash": "sha256:...",
    "checkedAt": "2026-06-13T00:00:00Z",
    "changeSetId": "editor-change-..."
  }
}
```

Если covered fields изменились после подтверждения `_prompt`, редактор показывает diagnostic `prompt-stale`.

LLM repair может предложить:

- обновить `_prompt.staticText` по текущей структуре;
- предложить `EditorChangeSet`, который меняет структуру под сохраненный prompt;
- сформировать conflict summary.

Repair нельзя применять без dry-run, JSON Schema validation, semantic validation и подтверждения пользователя.

## 11. JSON vs YAML для манифестов

Канонические authoring/runtime manifests остаются JSON.

YAML принимается как presentation format только для prompt projection, потому что:

- current validation, compiler, source maps, JSON Pointer paths и `EditorChangeSet` уже построены вокруг JSON;
- JSON Schema остается source of truth для структуры;
- YAML comments, scalar styles, anchors and formatting are presentation details and should not carry source-of-truth semantics;
- YAML reverse parsing needs additional ambiguity handling for localized labels, duplicate-looking names and free-form edits.

Если в будущем понадобится authoring YAML import/export, это должен быть отдельный compatibility layer with strict subset:

- YAML 1.2;
- no custom tags;
- no anchors or aliases as semantic input;
- unique keys required;
- string keys required;
- comments preserved only as editor presentation, not as manifest data;
- parsed result must be canonicalized and validated as the same JSON data model.

## 12. Инварианты

- Runtime manifests не получают `_prompt`, prompt refs, Markdown prompt text или sync metadata.
- Структурированные authoring-поля остаются source of truth для runtime-поведения.
- `_prompt` хранит невосстановимый authoring intent, а не runtime logic.
- Dynamic YAML projection не хранится как source of truth.
- Dynamic YAML projection показывает только значимые игровые, методические или визуальные сущности и свойства.
- Технические поля манифеста или редактора не попадают в YAML projection; они остаются только в скрытом context/source map.
- Generated starter prompt не сохраняется без подтверждения пользователя.
- В `_prompt` не должно быть двух постоянных текстовых источников одного смысла.
- Markdown prompt file не хранит дублирующий frontmatter.
- `ref` не может выходить за пределы authoring prompt directory.
- Drift diagnostics не заменяет JSON Schema validation.
- Repair всегда идет через `EditorChangeSet`.
- User confirmation приходит из UI workflow Cubica, не из LLM response.
- Русские названия полей не являются идентификаторами. Идентификатором остается schema pointer, semantic type path или JSON Pointer.
- Field dictionary не попадает в generated runtime manifests.

## 13. Альтернативы

- **Оставить `raw + normalized` навсегда.** Отклоняется как основной будущий путь: два текстовых поля одного смысла создают drift внутри самого `_prompt`.
- **Хранить только `raw`.** Недостаточно: пользовательский ввод может быть неструктурированным и тяжелым для дальнейшего agent parsing.
- **Хранить один полный `text`, а raw в journal.** Упрощает форму, но всё равно
  дублирует динамическую структуру JSON внутри prompt.
- **Всегда генерировать prompt из структуры.** Отклоняется: теряется невосстановимое авторское намерение.
- **Показывать пользователю локализованную копию JSON.** Отклоняется: технические поля смешиваются с игровым смыслом и ухудшают reverse direction.
- **Хранить русские labels на каждом элементе.** Отклоняется: справочные названия начнут расходиться между экземплярами.
- **Ключевать словарь только по property name.** Отклоняется: `id`, `title`, `type`, `description`, `props` имеют разные смыслы в разных контекстах.
- **Перевести манифесты на YAML.** Отклоняется для canonical manifests: YAML полезен как UI-представление, но усложняет validation, patching, source maps and deterministic compilation.
- **Всегда external Markdown.** Отклоняется: слишком тяжело для коротких элементов.
- **Full prototype lenses сразу.** Отложено: сначала нужны повторяющиеся element families и UX proof.

## 14. Последствия

Положительные:

- меньше внутренних источников рассинхронизации;
- динамическая часть prompt всегда соответствует текущему JSON;
- пользователь видит prompt даже для нового элемента без ручного ввода;
- русские названия полей централизованы и проверяемы;
- длинные промты можно вынести в Markdown;
- drift становится видимым diagnostic, а не скрытой проблемой;
- repair остается безопасным и проверяемым.

Риски:

- потребуется миграция текущего `raw/normalized` shape к `staticText` или `ref`;
- raw input нужно сохранять в journal/history, если он важен для аудита;
- deterministic starter может быть бедным без prototype-specific extractors;
- нужен field dictionary и validation против неоднозначных labels;
- reverse direction зависит от качества агента, поэтому обязателен `EditorChangeSet` с проверками;
- covered pointers сначала будут неполными;
- external Markdown потребует file-aware editor operations.
