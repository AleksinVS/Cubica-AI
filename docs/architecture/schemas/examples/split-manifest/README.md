# Split Manifest Example: Escape Room Quest

## Оглавление

- [Обзор](#обзор)
- [Структура файлов](#структура-файлов)
- [Логический манифест (game.manifest.json)](#логический-манифест-gamemanifestjson)
- [UI-манифест (ui.manifest.json)](#ui-манифест-uimanifestjson)
- [Сценарий с якорями (scenario.md)](#сценарий-с-якорями-scenariomd)
- [Как это работает](#как-это-работает)
- [Связь с ADR](#связь-с-adr)

---

## Обзор

Этот пример демонстрирует **разделение манифестов** согласно [ADR-013: Текстовые якоря и разделение логического и UI-манифестов](../../../adrs/013-manifest-text-anchors-and-ui-split.md).

**Ключевые концепции:**

1. **Логический манифест** (`game.manifest.json`) — содержит логику игры, состояние, действия и ссылки на текстовые фрагменты.
2. **UI-манифест** (`ui.manifest.json`) — содержит описание экранов, компонентов, темы и макетов для конкретного канала (Web).
3. **Сценарий с якорями** (`scenario.md`) — единый источник истины для всех текстов, использует `<!-- anchor: ... -->` для привязки.

---

## Структура файлов

```
split-manifest/
  game.manifest.json   # Логический манифест (логика, состояние, действия)
  ui.manifest.json     # UI-манифест для Web-канала
  scenario.md          # Сценарий с текстовыми якорями
  README.md            # Этот файл
```

---

## Логический манифест (game.manifest.json)

Логический манифест **не содержит** описания UI-компонентов. Вместо этого он:

### Использует `source_ref` для текстов

Все смысловые тексты (названия, описания, подсказки) хранятся как ссылки на сценарий:

```json
"name": {
  "source_ref": {
    "file": "scenario",
    "anchor": "game.meta.name"
  },
  "resolved": "Escape Room: Mystery Mansion",
  "format": "text"
}
```

- `source_ref.file` — логическое имя файла (соответствует `assets.scenario`).
- `source_ref.anchor` — идентификатор якоря в файле.
- `resolved` — кэшированное значение текста (генерируется автоматически).
- `format` — формат текста (`text`, `markdown`, `html`).

### Определяет состояние игры

```json
"state": {
  "public": {
    "current_room": "intro",
    "inventory": [],
    "discovered_hints": []
  },
  "secret": {
    "puzzle_solutions": { ... },
    "visited_rooms": ["intro"]
  }
}
```

- `public` — данные, видимые игроку и передаваемые в LLM.
- `secret` — скрытые данные, недоступные игроку.

### Регистрирует действия

```json
"actions": {
  "move": {
    "handler_type": "llm",
    "metadata": { "description": "Player moves to a different room" }
  },
  "take": {
    "handler_type": "script",
    "function": "takeItem",
    "metadata": { "description": "Player picks up an item" }
  }
}
```

- `handler_type: "llm"` — действие обрабатывается языковой моделью.
- `handler_type: "script"` — действие обрабатывается JavaScript-функцией.

---

## UI-манифест (ui.manifest.json)

UI-манифест описывает **как** отображать игру в конкретном канале (Web).

### Связь с логическим манифестом

```json
"meta": {
  "id": "escape-room-demo:web",
  "game_id": "escape-room-demo",
  "game_manifest_version": "1.0.0",
  "channel": "web"
}
```

### Тема оформления

```json
"theme": {
  "colors": {
    "primary": "#4A3728",
    "background": "#1A1A1A",
    "accent": "#D4AF37"
  },
  "typography": {
    "fontFamily": "'Crimson Text', Georgia, serif"
  }
}
```

### Экраны и компоненты

Каждый экран содержит дерево UI-компонентов с привязками к данным:

```json
"screens": {
  "intro": {
    "type": "screen",
    "root": {
      "type": "container",
      "children": [
        {
          "type": "text",
          "props": {
            "content": "{{screens.intro.title}}"  // Привязка к данным из логического манифеста
          }
        }
      ]
    }
  }
}
```

### Макеты (layouts)

Макеты связывают дизайн-артефакты с экранами:

```json
"layouts": {
  "layout-intro": {
    "target": { "kind": "screen", "id": "intro" },
    "image": "assets/layouts/intro-screen.png",
    "spec": {
      "grid": "1fr",
      "zones": [
        { "name": "title", "position": "top" },
        { "name": "content", "position": "center" },
        { "name": "actions", "position": "bottom" }
      ]
    }
  }
}
```

---

## Сценарий с якорями (scenario.md)

Сценарий — **единственный источник истины** для текстового контента игры.

### Формат якорей

Якоря размещаются как HTML-комментарии перед текстовым блоком:

```markdown
<!-- anchor: screen.intro.title -->
### Welcome to the Mystery

<!-- anchor: screen.intro.body -->
The door slams shut behind you...
```

### Преимущества

1. **Единый источник истины** — тексты редактируются только в сценарии.
2. **Читаемость** — сценарий остается обычным Markdown-документом.
3. **Автоматизация** — генератор извлекает тексты по якорям и обновляет `resolved`.
4. **Верификация** — можно проверять целостность ссылок.

---

## Как это работает

### Процесс генерации манифеста

```
scenario.md (с якорями)
        ↓
   [Генератор]  ← читает файл, ищет <!-- anchor: ... -->
        ↓
game.manifest.json (обновляет resolved, хэши)
```

### Процесс загрузки игры

```
1. Viewer загружает game.manifest.json
2. Viewer загружает ui.manifest.json (по channel)
3. Presenter объединяет данные логики и UI
4. Рендерер отображает компоненты с привязанными данными
```

### Поток обработки действия

```
Игрок нажимает кнопку
        ↓
UI отправляет команду (например, "move")
        ↓
Engine проверяет handler_type:
  - "llm" → отправляет в LLM с контекстом
  - "script" → выполняет JS-функцию
        ↓
Engine обновляет state
        ↓
Presenter получает новое состояние
        ↓
UI перерисовывается
```

---

## Связь с ADR

Этот пример реализует следующие решения из [ADR-013](../../../adrs/013-manifest-text-anchors-and-ui-split.md):

| Решение ADR | Реализация в примере |
|-------------|---------------------|
| Текстовые якоря `<!-- anchor: ... -->` | `scenario.md` содержит якоря для всех текстов |
| Структура `source_ref` | `game.manifest.json` использует `source_ref` + `resolved` |
| Разделение логического и UI-манифеста | Два отдельных файла: `game.manifest.json` и `ui.manifest.json` |
| Секция `layouts` | `ui.manifest.json` содержит `layouts` с привязкой к экранам |
| Привязка UI к логике | `meta.game_id` связывает UI-манифест с логическим |

---

## Полезные ссылки

- [ADR-013: Текстовые якоря и разделение манифестов](../../../adrs/013-manifest-text-anchors-and-ui-split.md)
- [JSON Schema: game-manifest](../../game-manifest.schema.json)
- [JSON Schema: ui-manifest](../../ui-manifest.schema.json)
- [Документация по структуре манифестов](../../manifest-structure.md)
