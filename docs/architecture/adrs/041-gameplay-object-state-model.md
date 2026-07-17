# ADR-041: Gameplay Object State Model

- **Дата**: 2026-06-03
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `games/*`, `docs/architecture/schemas`, `packages/contracts/manifest`, `services/runtime-api`, `apps/player-web`, `packages/editor-engine`
- **Связанные решения**: ADR-024, ADR-025, ADR-029, ADR-030, ADR-040, ADR-083, ADR-084

> [!IMPORTANT]
> Поправка ADR-084: принятая фасетная модель объектов и Presenter-проекция
> сохраняются, но описанные ниже object effects, object guards, JsonLogic и
> transitions больше не являются исполнимым контрактом. Их семантика
> переносится в типизированные selectors/query/assert/command узлы Mechanics
> IR. Старый executor удалён и не может использоваться как резервный путь.

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Классификация механики](#4-классификация-механики)
- [5. Решение](#5-решение)
- [6. Модель данных](#6-модель-данных)
- [7. Runtime-операции](#7-runtime-операции)
- [8. Presenter-проекция для UI](#8-presenter-проекция-для-ui)
- [9. Варианты и статус](#9-варианты-и-статус)
- [10. Архитектурные инварианты](#10-архитектурные-инварианты)
- [11. Последствия](#11-последствия)
- [12. Открытые вопросы](#12-открытые-вопросы)
- [13. Источники](#13-источники)

## 1. Понимание решения

Решение понято так: Cubica вводит **игровое состояние объекта** - авторитетное состояние предметной игровой сущности в session state, а не локальное состояние React-компонента или другого фронтенда.

Состояние должно быть многомерным. Карточка, персонаж, ресурс, клетка поля или задача могут одновременно иметь несколько независимых осей состояния: например `face`, `availability`, `resolution`, `location` или `ownership`.

Автор редактирует эту модель в authoring-манифесте. Runtime-манифест получает скомпилированный JSON, валидный по JSON Schema. UI получает не сырое состояние, а производную модель от Presenter.

## 2. Контекст

Текущий canonical runtime уже хранит игровое состояние сессии в `state.public` и `state.secret`, а действия меняют его через manifest-declared `effects[]`.

Для `Antarctica` уже есть частный случай объектного состояния: `state.public.flags.cards.<cardId>` хранит флаги `selected`, `resolved`, `locked`, `available`. Карточный текст хранится в `content.data.cards`, а `player-web` или игровой плагин собирает из контента и состояния модель для отображения.

Этого достаточно для текущих bounded slices, но недостаточно как платформа:

- флаги карточек не являются общим контрактом для любых игровых объектов;
- булевые флаги плохо описывают несколько независимых осей состояния;
- текущая модель не описывает динамически создаваемые во время сессии ресурсы;
- UI-компоненты уже имеют `backText` и `visualState`, но нет общего правила, как они выводятся из серверного игрового состояния;
- простая игра без плагина должна иметь возможность описать это через манифест, а не через custom code.

## 3. Термины

- **Игровой объект** - сущность предметной области игры: карточка, жетон, персонаж, ресурс, клетка поля, задача или любой другой объект, на который могут ссылаться правила.
- **Игровое состояние объекта** - серверное значение, которое описывает текущее положение объекта в правилах игры. Это не UI state, а часть session state.
- **Фасет состояния** - независимая ось состояния объекта. Например, у карточки могут быть фасеты `face` со значениями `front/back`, `availability` со значениями `available/locked/hidden` и `resolution` со значениями `idle/resolved`.
- **Динамический объект** - игровой объект, который создается во время сессии, а не заранее перечислен в `content.data`.
- **Проекция отображения** - производная модель для View: текст, видимость, отключенность, визуальный класс и доступные действия, полученные из контента объекта и его игрового состояния.
- **Authoring-манифест** - исходный JSON-файл для разработки игры. Он компилируется в runtime-манифест и не исполняется напрямую.
- **Runtime-манифест** - скомпилированный JSON-файл, который потребляют `runtime-api`, `player-web` и другие delivery layers.

## 4. Классификация механики

Механика является **общей**.
Она подходит не только карточкам `Antarctica`, но и многим классам игр:

- карточные и настольные игры;
- квесты с предметами и локациями;
- стратегические игры с ресурсами;
- обучающие симуляции с задачами, документами или персонажами.

Поэтому новая механика не должна добавляться как `Antarctica`-specific код в `runtime-api` или `player-web`.
Она должна развиваться как schema-defined platform capability: authoring schema, runtime JSON Schema, общие effects/guards и Presenter-level projection.

## 5. Решение

Принять Object State Model как общую декларативную механику.

Ключевые решения:

1. Состояние объекта является многомерным и описывается фасетами.
2. Authoring layer является основным редактируемым слоем.
3. Runtime state хранит состояние и динамические экземпляры объектов.
4. UI-проекция строится в Presenter, а не в React-компоненте.
5. Модель проектируется сразу для любых игровых объектов, а не только для карточек.
6. Динамически создаваемые ресурсы поддерживаются через `object.create`.
7. Per-player состояние не реализуется в первом срезе, но schema должна иметь расширяемый `scope`, чтобы позже добавить player-scoped состояние без переписывания модели.
8. State model перечисляет допустимые значения и хранит текущее состояние, а универсальный язык механик ADR-083 выбирает объекты и описывает переходы, массовые изменения, ветвления и последовательности. Хранилище состояния не дублирует исполнитель языка, но и не ограничивает его предметными операциями.
9. Первый implementation proof выполняется на fixture-игре. Затем выполняется полная миграция `Antarctica` без сохранения legacy dual path.

## 6. Модель данных

### 6.1. Authoring layer

Authoring-манифест описывает типы объектов, их коллекции, фасеты и правила проекции:

```json
{
  "objectTypes": {
    "card.basic": {
      "collection": "cards",
      "idField": "cardId",
      "scope": "session",
      "facets": {
        "face": {
          "initial": "front",
          "values": {
            "front": {
              "view": {
                "summaryFrom": "summary",
                "visualState": "default"
              }
            },
            "back": {
              "view": {
                "summaryFrom": "backText",
                "visualState": "resolved"
              }
            }
          }
        },
        "availability": {
          "initial": "available",
          "values": {
            "available": {
              "visible": true,
              "interactive": true
            },
            "locked": {
              "visible": true,
              "interactive": false,
              "view": {
                "visualState": "locked"
              }
            },
            "hidden": {
              "visible": false
            }
          }
        }
      }
    }
  }
}
```

`scope: "session"` означает, что состояние общее для всей игровой сессии. Для будущего per-player состояния reserved value может быть `player`, но первый runtime slice должен отклонять или игнорировать его как unsupported feature, пока player-scoped state не реализован.

### 6.2. Runtime manifest

Runtime manifest получает скомпилированный раздел `objectModels`.
Runtime не читает authoring-only ключи и не выполняет наследование, merge-операторы или прототипы ADR-030.

```json
{
  "objectModels": {
    "card.basic": {
      "collection": "cards",
      "scope": "session",
      "facets": {
        "face": {
          "initial": "front",
          "values": ["front", "back"]
        },
        "availability": {
          "initial": "available",
          "values": ["available", "locked", "hidden"]
        }
      },
      "view": {
        "facets": {
          "face.front": { "summaryFrom": "summary", "visualState": "default" },
          "face.back": { "summaryFrom": "backText", "visualState": "resolved" },
          "availability.locked": { "interactive": false, "visualState": "locked" },
          "availability.hidden": { "visible": false }
        }
      }
    }
  }
}
```

### 6.3. Session state

Static objects are declared in `content.data`.
Their mutable state lives in `state.public.objects` or `state.secret.objects`:

```json
{
  "state": {
    "public": {
      "objects": {
        "cards": {
          "1": {
            "objectType": "card.basic",
            "facets": {
              "face": "front",
              "availability": "available",
              "resolution": "idle"
            },
            "attributes": {}
          }
        }
      }
    },
    "secret": {
      "objects": {}
    }
  }
}
```

Runtime-created objects use the same instance shape, but store required dynamic data in `attributes`:

```json
{
  "objectType": "resource.supply",
  "facets": {
    "availability": "available"
  },
  "attributes": {
    "title": "Emergency fuel",
    "amount": 3,
    "unit": "crate"
  }
}
```

This is allowed because dynamic objects do not have a static `content.data` row.
For static objects, state should not duplicate static text unless an action intentionally writes a runtime override.

## 7. Runtime-операции

Object State Model adds reusable manifest effects and guards.

### 7.1. Effects

`object.create` creates a dynamic object instance:

```json
{
  "op": "object.create",
  "visibility": "public",
  "collection": "resources",
  "objectId": "fuel-1",
  "objectType": "resource.supply",
  "facets": {
    "availability": "available"
  },
  "attributes": {
    "title": "Emergency fuel",
    "amount": 3
  }
}
```

`object.state.set` changes one facet:

```json
{
  "op": "object.state.set",
  "visibility": "public",
  "collection": "cards",
  "objectId": "{{cardId}}",
  "facet": "face",
  "value": "back"
}
```

`object.attribute.patch` changes mutable attributes of a dynamic or stateful object:

```json
{
  "op": "object.attribute.patch",
  "visibility": "public",
  "collection": "resources",
  "objectId": "fuel-1",
  "patches": [
    { "op": "replace", "path": "/amount", "value": 2 }
  ]
}
```

These effects are general platform capabilities. They must be defined in JSON Schema before runtime code is added.

### 7.2. Guards

Actions can depend on object state through generic guards:

```json
{
  "objectState": {
    "visibility": "public",
    "collection": "cards",
    "objectId": "1",
    "facet": "availability",
    "value": "available"
  }
}
```

For complex logic, actions can still use `stateConditions` or JsonLogic, but authoring should prefer object-state guards where they express the intent directly.

### 7.3. Transitions

Allowed transitions are not part of the state model itself.
They belong to action logic:

- guards define when an action is allowed;
- effects define how state changes;
- JsonLogic can express compound conditions;
- action templates can hide repeated patterns.

This keeps "state" separate from "logic", while still allowing logic to depend on state.

## 8. Presenter-проекция для UI

Presenter builds object views by combining:

1. static content from `content.data`;
2. object instance state from session state;
3. `objectModels` projection rules;
4. action availability if the UI needs it.

Example object view:

```json
{
  "objectId": "1",
  "collection": "cards",
  "objectType": "card.basic",
  "title": "Создать клуб изучения айсберга",
  "summary": "Есть идея! Создать клуб изучения айсберга!",
  "visualState": "default",
  "visible": true,
  "interactive": true,
  "actions": {
    "primary": "opening.card.1"
  }
}
```

After `face = "back"`:

```json
{
  "objectId": "1",
  "collection": "cards",
  "objectType": "card.basic",
  "title": "Создать клуб изучения айсберга",
  "summary": "Некоторым понравились пещеры...",
  "visualState": "resolved",
  "visible": true,
  "interactive": false
}
```

React components should receive this projected model.
They should not contain game rules such as "if face is back, use backText".

## 9. Варианты и статус

### 9.1. Existing `flags` and `state.patch`

Статус: rejected as target.

This is the current factual model for `Antarctica`, but it is not the target architecture.
The migration must replace it instead of keeping a permanent legacy dual path.

### 9.2. Single `stateId`

Статус: rejected.

A single state works for linear lifecycle objects, but breaks down when an object can be simultaneously flipped, locked, selected and resolved.

### 9.3. Faceted object state

Статус: accepted.

Facets avoid combinatorial state names, support many object classes and keep authoring readable.

### 9.4. Player plugin only

Статус: rejected as platform mechanism.

Plugins may still customize presentation for complex games, but the object-state capability must exist for simple manifest-only games and editor preview.

## 10. Архитектурные инварианты

1. Авторитетное состояние объекта хранится в session state, а не во frontend state.
2. Authoring-манифест является редактируемым источником, runtime-манифест является исполнимым output.
3. JSON Schema является единственным источником истины для `objectTypes`, `objectModels`, object-state effects и object-state guards.
4. Runtime state хранит значения состояния и runtime-created instances, а не дублирует static content без причины.
5. Generic `runtime-api` не должен знать конкретные gameId или конкретные карточки `Antarctica`.
6. UI получает производную модель отображения; UI-компоненты не должны содержать правила игровой механики.
7. `state.public.objects` используется для player-visible состояния; `state.secret.objects` допустим для скрытых игровых фактов.
8. First implementation proof uses a fixture game before `Antarctica` migration.
9. `Antarctica` migration replaces `flags.cards`; permanent fallback from object state to `flags.cards` is not accepted.
10. Per-player state is reserved through explicit scope, but not implemented until a concrete multiplayer requirement lands.

## 11. Последствия

Положительные:

- появляется общий язык для состояний карточек, ресурсов, персонажей и других объектов;
- редактор сможет показывать и менять состояние объекта через schema-driven forms;
- простые игры смогут обходиться без custom player-web plugin;
- динамически создаваемые ресурсы получают понятную модель;
- состояния станут проверяемыми, журналируемыми и переносимыми между каналами доставки.

Trade-offs:

- увеличится поверхность game authoring schema, runtime manifest schema и contracts package;
- понадобится синхронизировать runtime schema, TypeScript contracts, UI schema и authoring compiler;
- полная миграция `Antarctica` будет больше, чем точечное добавление `face` в `flags.cards`.

## 12. Открытые вопросы

1. Точный wire format для `objectModels.view`: плоские ключи `facet.value` или вложенная структура.
2. Нужно ли `object.attribute.patch` в первом fixture slice, или достаточно `object.create` и `object.state.set`.
3. Где хранить generated object view source maps для editor preview selection.
4. Какой минимальный fixture выбрать: карточка с `face` или ресурс с `object.create`.

## 13. Источники

- JSON Schema Understanding docs: reusable definitions through `$defs`, dynamic key validation through `patternProperties` and schema composition with `oneOf`/`allOf` are suitable for validated manifest variants.
- Ajv strict mode docs: strict schema validation should fail on unknown or ignored keywords so manifest typos do not silently pass.
- ADR-025: JSON Schema is the SSOT for manifest validation.
- ADR-029: prefer the lowest-power logic tier before scripts.
- ADR-030: authoring manifests compile into runtime manifests.
- ADR-040: new server mechanics must be manifest/platform capabilities first, not game-specific runtime code.
