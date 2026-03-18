# Structure of the Game Manifest

The **Game Manifest** is a JSON document that describes a game scenario in the Cubica platform. It adheres to the **LLM-first** architecture but supports a **Hybrid Execution Model** (ADR-007), mixing LLM logic with deterministic JS scripts stored in external files.

In the current design the manifest layer is split into two cooperating documents:
- a **Logical Game Manifest** (logic manifest) that describes game metadata, configuration, content assets, engine configuration, initial state and the registry of actions;
- one or more **UI Manifests** that describe how the logical data is presented to the player (screens, components, layouts, bindings).

Textual content (rules, scenario, methodology) lives in separate Markdown/HTML files and is referenced from the logical manifest via **anchors**.

## Table of Contents

- [High-Level Structure](#high-level-structure)
- [Text Sources and Anchors](#text-sources-and-anchors)
- [Logical Manifest Sections](#logical-manifest-sections)
  - [1. Meta (`meta`)](#1-meta-meta)
  - [2. Configuration (`config`)](#2-configuration-config)
  - [3. Assets (`assets`)](#3-assets-assets)
  - [4. Engine (`engine`)](#4-engine-engine)
  - [5. State (`state`)](#5-state-state)
  - [6. UI (`ui`)](#6-ui-ui)
  - [7. Actions (`actions`)](#7-actions-actions)
- [Complete Example](#complete-example)
- [Design Artifacts](#design-artifacts-дизайн-артефакты-для-ии-агентов)
- [Storage and Validation](#storage-and-validation)

## High-Level Structure

### Logical Game Manifest (logic)

A logical manifest describes game metadata, assets, engine configuration, initial state and action handlers. It intentionally does **not** hard‑code UI; instead, it points to UI manifests via IDs and uses text anchors for human‑readable content.

Top-level structure (logic):

```json
{
  "meta": { ... },
  "config": { ... },
  "assets": { ... },
  "engine": { ... },
  "state": { ... },
  "actions": { ... }
}
```

### UI Manifest

A UI manifest describes how the logical data is presented to the player using Hybrid SDUI (see `ui-schema-concept.md` and ADR-003). Several UI manifests can target the same logical manifest (for example, a web UI and a Telegram UI).

Top-level structure (UI):

```json
{
  "meta": { ... },
  "theme": { ... },
  "screens": { ... },
  "layouts": { ... }
}
```

The same UI component tree model (atomic primitives, semantic widgets, data bindings) is used regardless of whether the UI is stored inline in an older combined manifest or in a dedicated UI manifest.

## Text Sources and Anchors

Textual content for a game is stored in separate files and treated as the **Source of Truth** for all human‑readable strings. The logical manifest only stores references and (optionally) short machine‑friendly projections.

Typical text sources:
- `assets.rules` — rules of the game in natural language (Markdown/HTML).
- `assets.scenario` — scenario file with scenes, cards, dialogues and narrative text.
- `assets.methodology.participants` — methodological notes for players/participants.
- `assets.methodology.facilitators` — methodological notes for facilitators/game masters.

To refer to precise fragments inside these files we use **anchors**.

### Anchor conventions

Anchors provide stable identifiers that the manifest can use to point at specific text blocks. We use two complementary mechanisms:

- **Markdown heading IDs** — for large sections and chapters:
  - `### Rules Overview {#rules-overview}`
  - `## Scene 1: Arrival {#scene-1-arrival}`
- **Explicit anchor comments** — for everything that directly drives the manifest (screens, cards, hints, etc.):
  - `<!-- anchor: game.screen.intro.title -->`
  - `<!-- anchor: game.card.C5.body -->`
  - `<!-- anchor: game.hint.main.description -->`

Anchor comments can appear immediately before the relevant paragraph or inside it; the generator interprets them according to repository conventions. For fragments that are critical for the manifest (screen titles, card texts, important descriptions) anchor comments are the **primary mechanism**.

### Referencing text from the manifest

The logical manifest references text blocks via a `source_ref` object and may cache the resolved text for convenience:

```json
{
  "title": {
    "source_ref": {
      "file": "scenario",
      "anchor": "game.screen.intro.title"
    },
    "resolved": "Intro screen",
    "format": "markdown"
  }
}
```

Semantics:
- `file` — logical name of the source file (`"rules"`, `"scenario"`, `"methodology.participants"`, `"methodology.facilitators"` and similar);
- `anchor` — anchor identifier inside that file (from a Markdown ID or `<!-- anchor: ... -->`);
- `resolved` — cached text extracted from the source file (always re‑generatable);
- `format` — optional hint for the renderer: `"plain"`, `"markdown"`, `"html"` etc.

Generation rules:
- all meaningful text that appears in the manifest should be reachable via `source_ref`;
- `resolved` is treated as a **projection** and may be automatically overwritten by tooling;
- authors edit the source files and anchors, not the `resolved` strings in JSON.

## Logical Manifest Sections

### 1. Meta (`meta`)
Contains metadata about the game module itself.
- `id`: Unique string identifier (e.g., "com.cubica.antarctica").
- `version`: Semantic version string of the game content (e.g., "1.0.0").
- `schema_version`: **[Required]** Version of the manifest schema used (e.g., "1.0"). See ADR-008.
- `min_engine_version`: **[Required]** Minimum Cubica Engine version required (e.g., "0.1.0").
- `name`: Human-readable title.
- `description`: Short description for the catalog.
- `author`: Author name or object.
- `training`: Optional training‑oriented metadata describing what this game teaches and how it is usually run:
  - `competencies`: Array of objects describing **trained competencies** (skills or behaviours that the game is designed to develop). Each item:
    - `id`: Stable machine‑readable identifier (e.g., `"leadership"`, `"communication"`).
    - `name`: Human‑readable name of the competency.
    - `description`: Short explanation of what is trained in the context of this game.
  - `format`: String describing the **game format** from a training perspective:
    - `"single"` — single‑player game, one player controls one role.
    - `"single_team"` — a single game instance played by a team together (one shared role, group decisions).
    - `"multi"` — multiplayer game with several concurrent players/roles in one session.
  - `duration`: Object describing the **expected duration** of the game session:
    - `min_minutes`: Minimal recommended duration in minutes.
    - `max_minutes`: Maximal recommended duration in minutes.

Textual fields such as `name` and `description` can be represented either as plain strings (for very short labels) or as objects with `source_ref` and `resolved` as described above. This is reflected in the JSON Schema via a dedicated `localizedText` definition and keeps the manifest aligned with the underlying Markdown/HTML descriptions.

### 2. Configuration (`config`)
Technical settings for the game session.
- `players`:
  - `min`: Minimum number of players.
  - `max`: Maximum number of players.
- `settings`: Arbitrary game-specific settings.

### 3. Assets (`assets`)
Defines external content files that serve as the "Source of Truth" and logic container, as well as media resources (ADR-009).

#### Logic Assets (Consumed by Engine)
- `rules`: Path to the rules file (e.g., "assets/rules.md"). **Required.**
- `scenario`: Path to the scenario file (e.g., "assets/scenario.md"). **Required.**
- `scripts`: Path to the JavaScript file exporting action handlers (e.g., "assets/game.js"). **Optional (for Hybrid Mode).**

#### Media Assets (Consumed by Client/UI)
- `images`: Key-Value map of Image ID to Path/URL.
- `audio`: Key-Value map of Audio ID to Path/URL.
- `video`: Key-Value map of Video ID to Path/URL.

Usage in UI: `{{assets.images.my_image}}`.

#### Methodology Assets (Training Materials)
Markdown files with **methodological guidance** that support running the game as a training:

- `methodology`:
  - `participants`: Path to a `.md` file with materials for players/participants. Typical contents:
    - game rules in natural language;
    - descriptions of objects, characters, variables and metrics used in the game;
    - generic recommendations for decision‑making (reference models, concepts, frameworks);
    - context‑specific hints for difficult situations in the scenario;
    - checklists or quick reference cards when the game trains a specific algorithm (for example, a step‑by‑step decision process).
  - `facilitators`: Path to a `.md` file with materials for facilitators (game masters / trainers). Typical contents:
    - explanations and interpretations of in‑game events;
    - suggested questions to ask when players take particular actions;
    - possible hints or guiding questions the facilitator may use;
    - evaluation criteria and indicators of specific thinking/behaviour patterns the game is intended to surface.

### 4. Engine (`engine`)
Instructions for the LLM Game Engine.
- `system_prompt`: The core prompt template. Uses `{{assets.rules}}` and `{{assets.scenario}}`.
- `model_config`: Hints for model selection.
- `context`: Configuration for the Context Pipeline.

### 5. State (`state`)
Defines the **Initial Game State**.
- `public`: State visible to the client.
- `secret`: State visible only to the Engine/Script.

### 6. UI (`ui`)
Defines the Abstract View for the game (Screens, Components).

At schema level (`game-manifest.schema.json`) the UI tree is expressed through:
- `ui.entry_point`: ID of the initial screen;
- `ui.screens[screen_id].type = "screen"`: logical screen (what the epic calls a `screenComponent`);
- `ui.screens[screen_id].root`: a `uiComponent` – generic node with:
  - `type`: string identifier of the visual role (for example, `"container"`, `"h-stack"`, `"text"`, `"button"`, `"widget:stats-bar"`);
  - `props`: component properties (title, label, bound state, etc.);
  - `children`: nested `uiComponent` elements;
  - `actions`: map of UI event handlers, where keys follow the `on*` convention (e.g. `onClick`) and values describe commands (see below).

> **Terminology mapping:**  
> - In epics and high-level docs we sometimes use domain terms like **`screenComponent`**, **`areaComponent`**, **`cardComponent`**, **`gameVariableComponent`**.  
> - These are *conceptual roles* and are implemented as specific values of the `uiComponent.type` field and layout conventions:
>   - `screenComponent` → entries of `ui.screens[*]` with `type: "screen"`;
>   - `areaComponent` → layout containers (for example, `type: "container"`, `"h-stack"`, `"v-stack"` or custom `"widget:*"` used as regions/areas of the screen);
>   - `cardComponent` → components that represent interactive cards; typically a `uiComponent` with `type: "card"` or a custom widget type (for example, `"widget:card"`), often used inside an area/container;
>   - `gameVariableComponent` → components that visualise metrics and variables from `state` (for example, `type: "text"`, `"progress-bar"`, `"widget:stats-bar"` with `props` bound to `state.*`).
> - There are **no special extra fields** in the JSON schema for these conceptual names – they are realised purely through `type`, `props` and where the component is placed in the tree. When you see these terms in epics (e.g. for «Antarctica»), interpret them as guidelines for choosing `type` and structuring the `ui` tree rather than as additional JSON keys.

### 7. Actions (`actions`)
Defines how specific game actions are handled (Hybrid Model).
- Key: **Action ID** (e.g., `"drink_potion"`, `"INCREMENT"`, `"MOVE_UNIT"`).
- Value: **Action handler configuration object**:
  - `handler_type`: `"llm"` or `"script"`.
  - `function`: Name of the exported function in `assets.scripts` (required if `handler_type` is `"script"`).
  - (Optional) additional metadata fields for engine/router can be added, as long as they validate against `game-manifest.schema.json`.

> At schema level this registry is represented by the top-level `actions` object (see `game-manifest.schema.json`), where keys follow the same identifier pattern as other IDs (letters, digits, `_` and `-`).

#### 7.1. Mapping UI `actions` to manifest `actions`

UI components declare **view-level events** inside `uiComponent.actions` using the `uiActions` definition from `game-manifest.schema.json`:

- Each UI event key starts with `on` and a capitalised event name, for example:
  - `"onClick"`, `"onChange"`, `"onSubmit"`, etc.
- The value is an object:
  - `command`: string identifier of the action that should be triggered (for example, `"INCREMENT"`, `"EXPLORE"`, `"use_item"`);
  - `payload`: (optional) JSON object with parameters for this particular invocation (for example, `{ "itemId": "{{item.id}}" }`).

The mapping between UI and game-level actions is as follows:

- `ui.screens[*].root` (and any nested `uiComponent`) may contain:
  - `"actions": { "onClick": { "command": "SOME_ACTION_ID", "payload": { ... } } }`
- `SOME_ACTION_ID` **MUST correspond** to a key in the top-level `actions` section:
  - `actions["SOME_ACTION_ID"]` describes how this action is processed:
    - via LLM (`handler_type: "llm"`);
    - or via a JS script (`handler_type: "script"`, `function: "someFunctionName"` in `assets.scripts`).

This gives a two-level separation:

1. **UI‑level commands (`uiComponent.actions.*.command`)** — describe *what* the user did in abstract terms (for example, `"EQUIP_ITEM"`, `"OPEN_HINT"`), independent of how the engine will handle it.
2. **Game‑level handlers (`manifest.actions`)** — describe *how* each command is executed in the Hybrid Execution Model (LLM vs script, which function to call, optional metadata).

In practice, the presenter/router layer:
- reads the `command` from UI;
- looks up the corresponding entry in `manifest.actions`;
- routes the request either to LLM or to the JS sandbox, and then applies returned patches (`APPLY_PATCH`, `REPLACE_STATE`) to `state` and propagates updates back to the UI.

**Example:**
```json
"assets": {
  "scripts": "assets/game.js"
},
"actions": {
  "use_item": {
    "handler_type": "script",
    "function": "useItem"
  },
  "negotiate": {
    "handler_type": "llm"
  }
}
```

## Complete Example

```json
{
  "meta": {
    "id": "com.cubica.antarctica",
    "version": "1.0.0",
    "schema_version": "1.0",
    "min_engine_version": "0.1.0",
    "name": "Antarctica",
    "description": "Survival in the frozen wastes.",
    "training": {
      "competencies": [
        {
          "id": "leadership",
          "name": "Leadership",
          "description": "Practising decision-making and influence in uncertain conditions."
        }
      ],
      "format": "single_team",
      "duration": {
        "min_minutes": 60,
        "max_minutes": 90
      }
    }
  },
  "config": {
    "players": { "min": 1, "max": 1 }
  },
  "assets": {
    "rules": "assets/rules.md",
    "scenario": "assets/scenario.md",
    "scripts": "assets/game.js",
    "images": {
      "hero_icon": "assets/img/hero.png"
    },
    "methodology": {
      "participants": "assets/methodology/antarctica-participants.md",
      "facilitators": "assets/methodology/antarctica-facilitators.md"
    }
  },
  "engine": {
    "system_prompt": "You are the Game Master...",
    "model_config": { "temperature": 0.7 }
  },
  "state": {
    "public": { "health": 100 },
    "secret": { "hidden_treasure": true }
  },
  "actions": {
    "move": { "handler_type": "llm" },
    "check_inventory": { "handler_type": "script", "function": "checkInventory" }
  }
}
```

## Design Artifacts (Дизайн-артефакты для ИИ-агентов)

Дизайн-артефакты — это изображения с JSON-описаниями, оптимизированные для работы ИИ-агентов. Они позволяют агентам понимать структуру макетов, генерировать UI-код и отслеживать эволюцию дизайна. См. [ADR-016](../adrs/016-design-artifacts-in-ui-manifest.md).

### Типы дизайн-артефактов

| Тип | Описание | Назначение для ИИ-агента |
|-----|----------|--------------------------|
| `reference` | Референс из другой игры/продукта | Понимание желаемого стиля через примеры |
| `concept` | Концептуальное изображение, скетч, мудборд | Понимание стиля, настроения, общей идеи |
| `flowchart` | Схема пользовательского пути или игровой логики | Понимание навигации и переходов между экранами |
| `wireframe` | Каркас (структурная схема без визуального оформления) | Понимание компоновки, иерархии элементов |
| `storyboard` | Раскадровка переходов и анимаций | Генерация анимаций и понимание UI-flow |
| `mockup` | Детальный макет с финальным визуальным оформлением | Генерация UI-кода, извлечение стилей |
| `asset` | Готовый графический элемент (иконка, фон, персонаж) | Прямое использование в игре |

### Иерархия и эволюция дизайна

```
reference ──┐
            ├──► concept ──► wireframe ──► mockup ──► asset
flowchart ──┘         │
                      └──► storyboard
```

### Типы связей между артефактами

- `inspires` — reference/concept вдохновляет другой артефакт
- `structures` — flowchart определяет структуру wireframe
- `animates` — flowchart определяет анимации в storyboard
- `refines` — wireframe детализируется в mockup
- `extracts` — из mockup извлекается asset
- `replaces` — новая версия заменяет старую
- `references` — артефакт ссылается на другой как источник информации
- `extends` — артефакт расширяет другой артефакт

### Структура каталогов

Артефакты хранятся в каталоге `design/` рядом с UI-манифестом:

```
games/<game-id>/
├── ui-manifest.json           # UI-манифест со ссылками
├── design/                    # Каталог дизайн-артефактов
│   ├── design-history.json    # История версий и связи
│   ├── references/            # Референсы из других продуктов
│   │   ├── ui-inspiration.png
│   │   └── ui-inspiration.design.json
│   ├── concepts/              # Концепты и мудборды
│   ├── flowcharts/            # Схемы навигации и логики
│   ├── wireframes/            # Структурные каркасы
│   ├── storyboards/           # Раскадровки анимаций
│   ├── mockups/               # Детальные макеты
│   └── assets/                # Готовые графические элементы
│       ├── icons/
│       └── backgrounds/
```

### Схема описания артефакта (design-artifact.schema.json)

Каждый артефакт сопровождается файлом `*.design.json` со следующими секциями:

- **`id`, `type`, `name`** — обязательные поля идентификации
- **`image`** — параметры изображения (path, format, dimensions, dpi)
- **`generation`** — контекст генерации для воспроизведения ИИ-моделями (prompt, negative_prompt, model, parameters, seed)
- **`regions`** — семантическая разметка зон и элементов с координатами, типами и связями с UI-компонентами
- **`style_tokens`** — извлечённые дизайн-токены (colors, typography, spacing, effects)
- **`meta`** — метаданные (author, created_at, version, tags, status)

Пример:

```json
{
  "$schema": "https://cubica.platform/schemas/design-artifact.v1.json",
  "id": "game-screen-v2",
  "type": "mockup",
  "name": "Основной игровой экран (версия 2)",
  "description": "Детальный макет игрового экрана с панелью ресурсов",

  "image": {
    "path": "mockups/game-screen-v2.png",
    "format": "png",
    "dimensions": { "width": 1920, "height": 1080 }
  },

  "generation": {
    "prompt": "Game screen for Arctic survival game...",
    "model": "midjourney-v6"
  },

  "regions": [
    {
      "id": "resource-panel",
      "bounds": { "x": 0, "y": 0, "width": 1920, "height": 80 },
      "type": "container",
      "description": "Горизонтальная панель с ресурсами"
    }
  ],

  "style_tokens": {
    "colors": {
      "primary": "#1a2a3a",
      "accent": "#ff6b35"
    }
  },

  "meta": {
    "author": "AI Agent",
    "version": "2.0",
    "status": "approved"
  }
}
```

### Схема истории версий (design-history.schema.json)

Файл `design-history.json` хранит реестр артефактов и граф связей:

```json
{
  "$schema": "https://cubica.platform/schemas/design-history.v1.json",
  "game_id": "antarctica",
  "updated_at": "2026-01-17T14:30:00Z",

  "artifacts": {
    "main-style": {
      "type": "concept",
      "current_version": "1.0",
      "versions": [
        { "version": "1.0", "file": "concepts/main-style.design.json", "date": "2026-01-10" }
      ]
    }
  },

  "relationships": [
    { "from": "reference-1", "to": "main-style", "type": "inspires" },
    { "from": "main-style", "to": "game-screen", "type": "inspires" }
  ]
}
```

### Интеграция с UI-манифестом

В UI-манифест добавляется секция `design_artifacts`:

```json
{
  "design_artifacts": {
    "history": "design/design-history.json",
    "base_path": "design/",
    "registry": {
      "main-style": {
        "type": "concept",
        "source_ref": { "file": "concepts/main-style.design.json" }
      },
      "game-screen-mockup": {
        "type": "mockup",
        "source_ref": { "file": "mockups/game-screen-v2.design.json" },
        "target": { "kind": "screen", "id": "game" }
      }
    }
  },

  "screens": {
    "game": {
      "type": "screen",
      "design_artifact_id": "game-screen-mockup",
      "root": { "..." }
    }
  }
}
```

Экраны и компоненты могут ссылаться на артефакты через `design_artifact_id`.

## Storage and Validation

- Logical manifests are stored as `.json` files and must validate against the [Game Manifest Schema](./game-manifest.schema.json) or its versioned successors.
- UI manifests are stored as `.json` files and must validate against the dedicated [UI Manifest Schema](./ui-manifest.schema.json).
- Design artifact descriptions are stored as `*.design.json` files and must validate against [Design Artifact Schema](./design-artifact.schema.json).
- Design history is stored in `design-history.json` and must validate against [Design History Schema](./design-history.schema.json).
