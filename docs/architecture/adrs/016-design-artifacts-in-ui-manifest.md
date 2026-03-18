# ADR-016: Дизайн-артефакты для ИИ-агентов в UI-манифесте

- **Дата**: 2026-01-17
- **Статус**: Accepted
- **Авторы**: AI Agent (Claude)
- **Компоненты**: Game Editor, Game Repository, SDK/viewers, UI-манифесты

## Оглавление

- [Контекст](#контекст)
- [Альтернативы](#альтернативы)
- [Решение](#решение)
  - [1. Типы дизайн-артефактов](#1-типы-дизайн-артефактов)
  - [2. Структура хранения](#2-структура-хранения)
  - [3. JSON-схема описания артефакта](#3-json-схема-описания-артефакта)
  - [4. Связи и версионирование](#4-связи-и-версионирование)
  - [5. Интеграция с UI-манифестом](#5-интеграция-с-ui-манифестом)
- [Последствия](#последствия)
- [План внедрения](#план-внедрения)
- [Связанные артефакты](#связанные-артефакты)

## Контекст

Платформа Cubica ориентирована на разработку игр с помощью ИИ-агентов (ИИ-агент — автономная программа на базе большой языковой модели, способная выполнять сложные задачи). В текущей архитектуре (ADR-013) UI-манифест содержит секцию `layouts` для хранения макетов интерфейса с полями `image` (путь к изображению) и `spec` (произвольный JSON).

Однако этого недостаточно для эффективной работы ИИ-агентов с дизайном:

1. **Отсутствует иерархия артефактов** — нет разделения на концепты, wireframes, mockups и финальные assets
2. **Нет семантических описаний** — ИИ-агенту сложно понять, что изображено на картинке, без детального структурированного описания
3. **Нет связей между артефактами** — невозможно отследить эволюцию дизайна от идеи до реализации
4. **Раздувание манифеста** — при большом количестве артефактов манифест становится нечитабельным

Для того чтобы ИИ-агенты могли эффективно:
- генерировать UI-код по макетам;
- редактировать и улучшать дизайн;
- поддерживать консистентность между версиями;
- понимать намерения дизайнера,

необходимо формализовать структуру хранения дизайн-артефактов с детальными JSON-описаниями.

## Альтернативы

### А1. Расширить существующую секцию `layouts` в UI-манифесте

- **Плюсы**: минимальные изменения в схеме, всё в одном файле.
- **Минусы**: манифест быстро разрастается; описания «размазаны» по разным местам; сложно версионировать отдельные артефакты.

### А2. Хранить описания в манифесте, изображения — внешние файлы

- **Плюсы**: изображения не дублируются; манифест содержит всю мета-информацию.
- **Минусы**: большие JSON-описания всё равно раздувают манифест; сложно редактировать отдельные описания.

### А3. Полностью внешнее хранение с ссылками `source_ref` (выбрано)

- **Плюсы**: консистентность с ADR-013 (текстовые якоря); манифест компактен; описания редактируются независимо; чистые git-дифы; переиспользование описаний.
- **Минусы**: больше файлов; нужно следить за консистентностью ссылок.

### А4. Не формализовать, оставить произвольный `spec`

- **Плюсы**: максимальная гибкость.
- **Минусы**: ИИ-агенты не могут полагаться на структуру; нет стандарта для инструментов; сложно валидировать.

## Решение

Мы расширяем архитектуру UI-манифеста, вводя:

1. **Четыре типа дизайн-артефактов** с чёткой семантикой
2. **Внешние JSON-файлы описаний** (паттерн `source_ref` из ADR-013)
3. **Стандартизированную JSON-схему** для описания каждого артефакта
4. **Файл истории версий** для отслеживания эволюции дизайна
5. **Секцию `design_artifacts`** в UI-манифесте для реестра артефактов

### 1. Типы дизайн-артефактов

| Тип | Описание | Назначение для ИИ-агента |
|-----|----------|--------------------------|
| `concept` | Концептуальное изображение, скетч, мудборд | Понимание стиля, настроения, общей идеи |
| `reference` | Референс из другой игры/продукта | Понимание желаемого стиля через примеры |
| `wireframe` | Каркас (структурная схема без визуального оформления) | Понимание компоновки, иерархии элементов |
| `flowchart` | Схема пользовательского пути или игровой логики | Понимание навигации и переходов между экранами |
| `storyboard` | Раскадровка переходов и анимаций | Генерация анимаций и понимание UI-flow |
| `mockup` | Детальный макет с финальным визуальным оформлением | Генерация UI-кода, извлечение стилей |
| `asset` | Готовый графический элемент (иконка, фон, персонаж) | Прямое использование в игре |

**Иерархия и эволюция дизайна:**

```
reference ──┐
            ├──► concept ──► wireframe ──► mockup ──► asset
flowchart ──┘         │
                      └──► storyboard
```

### 2. Структура хранения

Артефакты хранятся в структурированном каталоге рядом с UI-манифестом:

```
games/<game-id>/
├── ui-manifest.json           # UI-манифест со ссылками
├── design/                    # Каталог дизайн-артефактов
│   ├── design-history.json    # История версий и связи
│   ├── references/            # Референсы из других продуктов
│   │   ├── ui-inspiration.png
│   │   └── ui-inspiration.design.json
│   ├── concepts/              # Концепты и мудборды
│   │   ├── main-style.png
│   │   └── main-style.design.json
│   ├── flowcharts/            # Схемы навигации и логики
│   │   ├── game-flow.png
│   │   └── game-flow.design.json
│   ├── wireframes/            # Структурные каркасы
│   │   ├── game-screen.png
│   │   └── game-screen.design.json
│   ├── storyboards/           # Раскадровки анимаций
│   │   ├── screen-transition.png
│   │   └── screen-transition.design.json
│   ├── mockups/               # Детальные макеты
│   │   ├── game-screen-v1.png
│   │   ├── game-screen-v1.design.json
│   │   ├── game-screen-v2.png
│   │   └── game-screen-v2.design.json
│   └── assets/                # Готовые графические элементы
│       ├── icons/
│       │   ├── icon-settings.png
│       │   └── icon-settings.design.json
│       └── backgrounds/
│           ├── arctic-bg.png
│           └── arctic-bg.design.json
```

### 3. JSON-схема описания артефакта

Каждый артефакт сопровождается файлом `*.design.json` со следующей структурой:

```json
{
  "$schema": "https://cubica.platform/schemas/design-artifact.v1.json",
  "id": "game-screen-v2",
  "type": "mockup",
  "name": "Основной игровой экран (версия 2)",
  "description": "Детальный макет игрового экрана с панелью ресурсов, игровым полем и панелью действий",

  "image": {
    "path": "mockups/game-screen-v2.png",
    "format": "png",
    "dimensions": { "width": 1920, "height": 1080 },
    "dpi": 72
  },

  "generation": {
    "prompt": "Game screen for Arctic survival game, dark blue color scheme, minimalist UI, resource panel at top, action buttons at bottom",
    "negative_prompt": "cluttered, bright colors, realistic",
    "style_reference": "concepts/main-style",
    "model": "midjourney-v6",
    "parameters": {
      "aspect_ratio": "16:9",
      "stylize": 750
    }
  },

  "regions": [
    {
      "id": "resource-panel",
      "bounds": { "x": 0, "y": 0, "width": 1920, "height": 80 },
      "type": "container",
      "description": "Горизонтальная панель с ресурсами: топливо, еда, здоровье экипажа",
      "layout": {
        "type": "flex",
        "gap": 20
      },
      "generation": {
        "prompt": "Horizontal metal panel with sci-fi indicators, dark matte finish"
      },
      "elements": [
        {
          "id": "fuel-indicator",
          "bounds": { "x": 20, "y": 10, "width": 200, "height": 60 },
          "type": "progress-bar",
          "description": "Индикатор топлива с иконкой канистры",
          "generation": {
             "prompt": "Glowing orange liquid in glass tube, metal frame, realistic reflections"
          },
          "style": {
            "background": "#1a2a3a",
            "fill": "#ff6b35",
            "border_radius": 8
          },
          "maps_to_component": "gameVariableComponent",
          "maps_to_state": "state.public.resources.fuel"
        }
      ]
    },
    {
      "id": "game-field",
      "bounds": { "x": 0, "y": 80, "width": 1920, "height": 800 },
      "type": "canvas",
      "description": "Основное игровое поле с картой и юнитами",
      "generation": {
         "prompt": "Top-down view of arctic terrain, ice floes, snow storms"
      }
    },
    {
      "id": "action-panel",
      "bounds": { "x": 0, "y": 880, "width": 1920, "height": 200 },
      "type": "container",
      "description": "Панель действий с кнопками",
      "layout": { "type": "flex", "gap": 15 },
      "elements": [
        {
          "id": "btn-move",
          "bounds": { "x": 100, "y": 920, "width": 150, "height": 60 },
          "type": "button",
          "description": "Кнопка перемещения",
          "label": "Переместить",
          "state": "default",
          "visual_tags": ["bevel-edged", "metallic"],
          "generation": {
             "prompt": "Rectangular metallic button with 'MOVE' embossed text"
          },
          "maps_to_action": "move_unit"
        }
      ]
    }
  ],

  "style_tokens": {
    "colors": {
      "primary": "#1a2a3a",
      "secondary": "#2a3a4a",
      "accent": "#ff6b35",
      "text": "#ffffff",
      "text_muted": "#8899aa"
    },
    "typography": {
      "font_family": "Inter",
      "heading_size": 24,
      "body_size": 16
    },
    "spacing": {
      "unit": 8,
      "padding": 16,
      "gap": 12
    }
  },

  "meta": {
    "author": "AI Agent",
    "created_at": "2026-01-15T10:00:00Z",
    "updated_at": "2026-01-17T14:30:00Z",
    "version": "2.0",
    "tags": ["game-screen", "arctic", "dark-theme"],
    "notes": "Вторая версия с улучшенной читабельностью ресурсов"
  }
}
```

**Ключевые секции и нововведения:**

- **`image`** — технические параметры изображения.
- **`generation`** (глобальная) — общий контекст стиля и промпты.
- **`style_tokens`** — источник истины для дизайн-системы. Используются для формирования промптов (Prompt Injection) и обеспечения единообразия (например, "led-blue" может раскрываться в промпт "glowing cyan neon light").
- **`regions`** — семантическая разметка с поддержкой:
  - **`generation` (local)** — по-элементные промпты для точечной генерации (inpainting) или композитинга (ControlNet). **Обязательно для визуальных элементов (поле `prompt` является обязательным).**
  - **`layout`** — описание сетки (grid/flex) для понимания композиции.
  - **`state` / `visual_tags`** — описание визуального состояния ("active", "glowing"), помогающее ИИ понять контекст стиля.
- **`meta`** — метаданные и версионирование.

### 4. Связи и версионирование

Файл `design-history.json` хранит граф связей между артефактами и историю версий:

```json
{
  "$schema": "https://cubica.platform/schemas/design-history.v1.json",
  "game_id": "antarctica",
  "updated_at": "2026-01-17T14:30:00Z",

  "artifacts": {
    "arctic-ui-ref": {
      "type": "reference",
      "current_version": "1.0",
      "versions": [
        { "version": "1.0", "file": "references/arctic-ui-ref.design.json", "date": "2026-01-08" }
      ]
    },
    "main-style": {
      "type": "concept",
      "current_version": "1.0",
      "derived_from": "arctic-ui-ref",
      "versions": [
        { "version": "1.0", "file": "concepts/main-style.design.json", "date": "2026-01-10" }
      ]
    },
    "game-flow": {
      "type": "flowchart",
      "current_version": "1.0",
      "versions": [
        { "version": "1.0", "file": "flowcharts/game-flow.design.json", "date": "2026-01-09" }
      ]
    },
    "game-screen": {
      "type": "wireframe",
      "current_version": "1.0",
      "derived_from": ["main-style", "game-flow"],
      "versions": [
        { "version": "1.0", "file": "wireframes/game-screen.design.json", "date": "2026-01-12" }
      ]
    },
    "screen-transitions": {
      "type": "storyboard",
      "current_version": "1.0",
      "derived_from": "game-flow",
      "versions": [
        { "version": "1.0", "file": "storyboards/screen-transitions.design.json", "date": "2026-01-13" }
      ]
    },
    "game-screen-mockup": {
      "type": "mockup",
      "current_version": "2.0",
      "derived_from": "game-screen",
      "versions": [
        { "version": "1.0", "file": "mockups/game-screen-v1.design.json", "date": "2026-01-14" },
        { "version": "2.0", "file": "mockups/game-screen-v2.design.json", "date": "2026-01-17", "changes": "Улучшена читабельность ресурсов" }
      ]
    }
  },

  "relationships": [
    { "from": "arctic-ui-ref", "to": "main-style", "type": "inspires" },
    { "from": "game-flow", "to": "game-screen", "type": "structures" },
    { "from": "game-flow", "to": "screen-transitions", "type": "animates" },
    { "from": "main-style", "to": "game-screen", "type": "inspires" },
    { "from": "game-screen", "to": "game-screen-mockup", "type": "refines" },
    { "from": "game-screen-mockup", "to": "icon-settings", "type": "extracts" }
  ]
}
```

**Типы связей:**
- `inspires` — reference/concept вдохновляет другой артефакт
- `structures` — flowchart определяет структуру wireframe
- `animates` — flowchart определяет анимации в storyboard
- `refines` — wireframe детализируется в mockup
- `extracts` — из mockup извлекается asset
- `replaces` — новая версия заменяет старую

### 5. Интеграция с UI-манифестом

В UI-манифест добавляется секция `design_artifacts` с реестром артефактов и ссылками:

```json
{
  "meta": { "id": "antarctica-web", "version": "1.0.0", "..." },

  "design_artifacts": {
    "history": "design/design-history.json",
    "base_path": "design/",

    "registry": {
      "main-style": {
        "type": "concept",
        "source_ref": {
          "file": "concepts/main-style.design.json"
        }
      },
      "game-screen-mockup": {
        "type": "mockup",
        "source_ref": {
          "file": "mockups/game-screen-v2.design.json"
        },
        "target": {
          "kind": "screen",
          "id": "game"
        }
      },
      "icon-settings": {
        "type": "asset",
        "source_ref": {
          "file": "assets/icons/icon-settings.design.json"
        }
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

**Ключевые изменения:**
- Добавлена секция `design_artifacts` со ссылками на файлы описаний
- Экраны и компоненты могут ссылаться на артефакты через `design_artifact_id`
- Используется паттерн `source_ref` из ADR-013

## Последствия

### Положительные эффекты

1. **Эффективность ИИ-агентов** — структурированные описания позволяют агентам точно понимать дизайн и генерировать качественный UI-код
2. **Воспроизводимость** — секция `generation` позволяет воспроизвести или модифицировать артефакт
3. **Трассируемость** — связи между артефактами документируют эволюцию дизайна
4. **Компактность манифеста** — описания вынесены во внешние файлы
5. **Консистентность** — `style_tokens` обеспечивают единообразие дизайна
6. **Переиспользование** — описания можно использовать в разных UI-манифестах

### Риски и технический долг

1. **Сложность поддержки** — требуется синхронизация между изображениями и их описаниями
2. **Ручная разметка `regions`** — на начальном этапе требует ручной работы (в будущем можно автоматизировать через CV-модели)
3. **Миграция существующих `layouts`** — текущая секция `layouts` должна быть либо мигрирована, либо объявлена deprecated

### Требуемые изменения

1. Обновить `ui-manifest.schema.json` — добавить секцию `design_artifacts`
2. Создать `design-artifact.schema.json` — схема файла описания
3. Создать `design-history.schema.json` — схема файла истории
4. Обновить документацию (`PROJECT_ARCHITECTURE.md`, `manifest-structure.md`)
5. Создать примеры для игры «Antarctica»

## План внедрения

1. **Формализация схем** (F_00074)
   - Создать JSON Schema для `design-artifact.v1.json`
   - Создать JSON Schema для `design-history.v1.json`
   - Обновить `ui-manifest.schema.json`

2. **Документация**
   - Обновить `docs/architecture/schemas/manifest-structure.md`
   - Обновить `PROJECT_ARCHITECTURE.md`
   - Добавить примеры в `docs/architecture/schemas/examples/`

3. **Пилотное применение** (в рамках Antarctica)
   - Создать структуру `games/antarctica/design/`
   - Создать описания для ключевых экранов
   - Связать с UI-манифестом

4. **Инструменты** (отдельная задача)
   - CLI для валидации описаний
   - Генератор `regions` из изображения (CV-модель)
   - Визуализатор связей между артефактами

## Связанные артефакты

- `docs/architecture/PROJECT_ARCHITECTURE.md` — раздел 2.3 (Данные и игровые манифесты)
- `docs/architecture/adrs/009-asset-management-strategy.md` — управление медиа-ассетами
- `docs/architecture/adrs/013-manifest-text-anchors-and-ui-split.md` — паттерн `source_ref`
- `docs/architecture/schemas/ui-manifest.schema.json` — текущая схема UI-манифеста
- `docs/tasks/epics/E_0010_game_manifest_architecture.md` — родительский эпик
- `docs/tasks/features/F_00074-design-artifacts-for-ai-agents.md` — Feature-задача реализации
