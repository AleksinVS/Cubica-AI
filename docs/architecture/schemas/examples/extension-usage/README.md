# Extension Usage Example: Fantasy RPG with Custom Mechanics

## Оглавление

- [Обзор](#обзор)
- [Структура файлов](#структура-файлов)
- [Типы расширений](#типы-расширений)
- [Конфигурация расширений в манифесте](#конфигурация-расширений-в-манифесте)
- [Локальные расширения](#локальные-расширения)
- [Вызов функций расширений](#вызов-функций-расширений)
- [UI-компоненты из расширений](#ui-компоненты-из-расширений)
- [Сборка и деплой](#сборка-и-деплой)
- [Связь с ADR](#связь-с-adr)

---

## Обзор

Этот пример демонстрирует использование **Extension Packs (Пакетов расширений)** согласно [ADR-015: Архитектура пакетов расширений](../../../adrs/015-extension-packs-architecture.md).

**Ключевая идея:** Игра собирается из ядра платформы и подключаемых расширений:
- **NPM-пакеты** — публичные расширения из реестра (`@cubica/ext-*`).
- **Локальные модули** — специфичные для игры расширения (`./extensions/*`).

### Гибридная модель Engine

```
┌─────────────────────────────────────────────────┐
│                Engine Instance                   │
│  ┌───────────────────────────────────────────┐  │
│  │           Engine Core (Cubica)            │  │
│  └───────────────────────────────────────────┘  │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │ ext-rpg-    │ │ ext-quest-  │ │ ext-      │  │
│  │ mechanics   │ │ system      │ │ weather   │  │
│  └─────────────┘ └─────────────┘ └───────────┘  │
│  ┌─────────────────────────────────────────────┐│
│  │       Local: custom-mechanics              ││
│  └─────────────────────────────────────────────┘│
│  - - - - - - - - - - - - - - - - - - - - - - - -│
│  ┌─────────────────────────────────────────────┐│
│  │    User Scripts (Sandbox / isolated-vm)    ││
│  │    game.manifest.json + scripts/*.js       ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
        Build-time (нативный код)
        Runtime (изолированный код)
```

---

## Структура файлов

```
extension-usage/
  game.manifest.json                    # Манифест игры с секцией extensions
  extensions/
    custom-mechanics/
      extension.json                    # Манифест локального расширения
      src/
        engine/
          index.js                      # Engine-логика (crafting, reputation)
        viewer/
          index.js                      # React-компоненты
  README.md                             # Этот файл
```

---

## Типы расширений

### Viewer Extensions (Клиентские)

Добавляют UI-компоненты и визуальные эффекты:

```json
"extensions": {
  "viewer": [
    {
      "package": "@cubica/ext-rpg-hud",
      "version": "^1.2.0",
      "source": "npm",
      "description": "RPG HUD components"
    }
  ]
}
```

**Возможности:**
- Новые React-компоненты
- CSS-темы и стили
- Анимации и эффекты
- Звуковые эффекты

### Engine Extensions (Серверные)

Добавляют игровую логику и интеграции:

```json
"extensions": {
  "engine": [
    {
      "package": "@cubica/ext-rpg-mechanics",
      "version": "^2.0.0",
      "source": "npm",
      "config": {
        "combat_system": "turn-based"
      }
    }
  ]
}
```

**Возможности:**
- Новые Action handlers
- Интеграции с API
- Доступ к базе данных
- Функции для Sandbox API

---

## Конфигурация расширений в манифесте

### Секция `extensions`

Секция `extensions` представляет собой объект, где ключи - это идентификаторы расширений (npm-пакеты или локальные пути):

```json
"extensions": {
  "@cubica/ext-rpg-mechanics": { ... },      // NPM-пакет
  "./extensions/custom-mechanics": { ... }   // Локальное расширение
}
```

### Формат записи расширения

```json
"@cubica/ext-rpg-mechanics": {
  "version": "^2.0.0",           // Semver-версия (обязательно)
  "type": "engine",              // "viewer", "engine" или "both"
  "optional": false,             // Опциональная зависимость (по умолчанию false)
  "config": {                    // Конфигурация расширения
    "combat_system": "turn-based",
    "experience_curve": "exponential"
  }
}
```

### Локальные расширения

```json
"./extensions/custom-mechanics": {
  "version": "^1.0.0",
  "type": "both"
}
```

---

## Локальные расширения

### Структура extension.json

```json
{
  "meta": {
    "id": "custom-mechanics",
    "version": "1.0.0",
    "type": "hybrid"              // "viewer", "engine", или "hybrid"
  },
  "engine": {
    "entry_point": "src/engine/index.js",
    "exports": { ... },           // Экспортируемые функции
    "sandbox_api": { ... },       // Функции, доступные скриптам
    "hooks": { ... }              // Хуки жизненного цикла
  },
  "viewer": {
    "entry_point": "src/viewer/index.js",
    "components": { ... },        // UI-компоненты
    "styles": { ... }             // CSS-переменные
  },
  "data": { ... }                 // Статические данные
}
```

### Engine exports

Функции, которые можно вызвать из манифеста:

```json
"exports": {
  "crafting": {
    "craftItem": {
      "description": "Craft an item from materials",
      "params": {
        "recipeId": "string - ID of the recipe"
      },
      "returns": "CraftResult"
    }
  }
}
```

### Sandbox API

Функции, доступные пользовательским скриптам:

```json
"sandbox_api": {
  "crafting.craft": {
    "description": "Craft item (safe for scripts)",
    "risk_level": "low"
  }
}
```

**Уровни риска:**
- `low` — безопасные операции (чтение данных, расчеты)
- `medium` — изменяют состояние (inventory, stats)
- `high` — могут влиять на других игроков или систему

### Viewer components

React-компоненты для UI:

```json
"components": {
  "reputation-display": {
    "description": "Displays reputation levels",
    "props": {
      "factions": { "type": "object", "required": true },
      "showLabels": { "type": "boolean", "default": true }
    }
  }
}
```

---

## Вызов функций расширений

### В манифесте (actions)

```json
"actions": {
  "attack": {
    "handler_type": "extension",
    "extension": "@cubica/ext-rpg-mechanics",
    "function": "combat.attack"
  },
  "craft_item": {
    "handler_type": "extension",
    "extension": "./extensions/custom-mechanics",
    "function": "crafting.craftItem"
  }
}
```

### Типы handler_type

| Тип | Описание |
|-----|----------|
| `llm` | Обработка языковой моделью |
| `script` | Пользовательский скрипт (Sandbox) |
| `extension` | Функция из Extension Pack (нативно) |

### Из пользовательского скрипта

```javascript
// scripts/game-logic.js
export function onQuestComplete(state, args, std) {
  // Вызов функции расширения через std
  const reputationResult = std.extensions.call(
    'custom-mechanics',
    'reputation.modify',
    { factionId: 'village', amount: 50 }
  );

  // Или через sandbox API (если разрешено)
  const canCraft = std.crafting.checkMaterials('health_potion');

  return { success: true };
}
```

---

## UI-компоненты из расширений

### Использование в UI-манифесте

```json
"children": [
  {
    "type": "widget:rpg-hud:health-bar",
    "props": {
      "current": "{{state.public.player.hp}}",
      "max": "{{state.public.player.max_hp}}"
    }
  },
  {
    "type": "widget:custom-mechanics:reputation-display",
    "props": {
      "factions": "{{state.reputation}}"
    }
  }
]
```

### Формат type для виджетов

```
widget:<extension-id>:<component-name>

Примеры:
- widget:rpg-hud:health-bar
- widget:rpg-hud:minimap
- widget:custom-mechanics:crafting-panel
- widget:weather:indicator
```

### Регистрация компонентов

При сборке Viewer:

```javascript
// Viewer Core регистрирует компоненты из расширений
extensionManager.registerComponents({
  'rpg-hud:health-bar': HealthBarComponent,
  'rpg-hud:minimap': MinimapComponent,
  'custom-mechanics:reputation-display': ReputationDisplay,
});
```

---

## Сборка и деплой

### Build-time Composition

```
┌──────────────────────────────────────────────┐
│              CI/CD Pipeline                   │
│                                               │
│  1. Read game.manifest.json                   │
│  2. npm install @cubica/ext-*                │
│  3. Build local extensions                    │
│  4. Bundle Viewer (Webpack/Vite)              │
│  5. Bundle Engine (Docker image)              │
│  6. Deploy to infrastructure                  │
└──────────────────────────────────────────────┘
```

### Viewer Build

```bash
# Vite/Webpack собирает SPA с расширениями
npm run build:viewer

# Результат: статика в dist/
# - Все компоненты из @cubica/ext-ui-kit
# - Все компоненты из @cubica/ext-rpg-hud
# - Компоненты из ./extensions/custom-mechanics
# - Tree-shaking удаляет неиспользуемое
```

### Engine Build

```bash
# Docker-образ с движком и расширениями
npm run build:engine

# Результат: Docker image
# - Cubica Engine Core
# - @cubica/ext-rpg-mechanics
# - @cubica/ext-quest-system
# - @cubica/ext-weather
# - ./extensions/custom-mechanics
# - User scripts загружаются в Runtime (Sandbox)
```

---

## Безопасность

### Разделение уровней доверия

```
┌─────────────────────────────────────────────────┐
│  Trusted Code (Build-time / Нативный)           │
│  - Engine Core                                   │
│  - NPM Extensions (проверены через Code Review) │
│  - Local Extensions (часть репозитория)          │
│                                                  │
│  Доступ: Полный (fs, network, DB)               │
├─────────────────────────────────────────────────┤
│  Untrusted Code (Runtime / Sandbox)             │
│  - User Scripts из game.manifest.json           │
│  - Динамически загружаемый контент              │
│                                                  │
│  Доступ: Только state, args, std (белый список)│
│  Лимиты: CPU, память, время                     │
└─────────────────────────────────────────────────┘
```

### Sandbox API ограничения

Расширения явно объявляют, какие функции доступны скриптам:

```json
"sandbox_api": {
  "crafting.craft": { "risk_level": "low" },
  "reputation.modify": { "risk_level": "medium" }
}
```

Скрипты **не могут**:
- Напрямую вызывать функции расширений
- Обходить Sandbox-изоляцию
- Получать доступ к fs/network

---

## Связь с ADR

Этот пример реализует следующие решения из [ADR-015](../../../adrs/015-extension-packs-architecture.md):

| Решение ADR | Реализация в примере |
|-------------|---------------------|
| Build-time Composition | Расширения подключаются в `extensions` |
| NPM Packages | `@cubica/ext-rpg-mechanics`, `@cubica/ext-quest-system` |
| Local Modules | `./extensions/custom-mechanics` |
| Viewer Extensions | `widget:rpg-hud:*`, `widget:custom-mechanics:*` |
| Engine Extensions | `handler_type: "extension"` |
| Sandbox API | `sandbox_api` в extension.json |
| Config для расширений | `config` в записи расширения |
| Hybrid Extensions | `type: "hybrid"` — и viewer, и engine |

---

## Полезные ссылки

- [ADR-015: Архитектура пакетов расширений](../../../adrs/015-extension-packs-architecture.md)
- [ADR-007: Hybrid Execution Model](../../../adrs/007-hybrid-execution-model.md)
- [ADR-010: JS Sandbox Security](../../../adrs/010-js-sandbox-security.md)
- [JSON Schema: extension](../../extension.schema.json)
- [Hybrid Execution Example](../hybrid-execution/)
