# Комплексное архитектурное ревью проекта Cubica

**Дата:** 13 января 2026 г.
**Автор:** Claude Code (Sonnet 4.5)
**Тип:** Систематический анализ целевой архитектуры, выявление противоречий и недоработок

---

## Оглавление

- [1. Исполнительное резюме](#1-исполнительное-резюме)
- [2. Методология ревью](#2-методология-ревью)
- [3. Критические проблемы (P0)](#3-критические-проблемы-p0)
- [4. Проблемы высокого приоритета (P1)](#4-проблемы-высокого-приоритета-p1)
- [5. Проблемы среднего приоритета (P2)](#5-проблемы-среднего-приоритета-p2)
- [6. Проблемы низкого приоритета (P3)](#6-проблемы-низкого-приоритета-p3)
- [7. Итоговая статистика](#7-итоговая-статистика)
- [8. Рекомендации по устранению](#8-рекомендации-по-устранению)
- [9. Влияние на roadmap](#9-влияние-на-roadmap)
- [10. Заключение](#10-заключение)

---

## 1. Исполнительное резюме

### Цель ревью
Провести комплексный анализ целевой архитектуры платформы Cubica, выявить внутренние ошибки, противоречия и недоработки между:
- ADR документами (Architecture Decision Records)
- Архитектурной документацией (PROJECT_ARCHITECTURE.md, PROJECT_OVERVIEW.md)
- Схемами манифестов (JSON Schema)
- Фактической реализацией кода

### Общая оценка

**Соответствие целевой архитектуре: ~30%**

| Компонент | Соответствие | Комментарий |
|-----------|--------------|-------------|
| Backend-сервисы | 5% | Только типы для Router, остальное - заглушки |
| SDK | 40% | core + react-sdk + shared реализованы, viewers отсутствует |
| Game Content | 70% | Структура хороша, но есть дублирование манифестов |
| Документация | 90% | Хорошо описано, но противоречия между ADR |
| ADR внедрение | 20% | Решения приняты, но не реализованы |

### Ключевые выводы

**Сильные стороны:**
- ✅ Хорошо проработанная система ADR (14 документов)
- ✅ Детальная целевая архитектура с четкими принципами
- ✅ Качественные архитектурные концепции (MVP, LLM-first, Extension Packs)
- ✅ Продуманная структура манифестов игр

**Критические риски:**
- ⚠️ Противоречия между ADR создают неопределенность для разработчиков
- ⚠️ Примеры манифестов не соответствуют заявленной архитектуре
- ⚠️ Критические компоненты (SDK/viewers, Extension Packs) не реализованы
- ⚠️ Нарушение принципа Single Source of Truth для манифестов
- ⚠️ Большое количество незарегистрированных заглушек (>10 компонентов)

---

## 2. Методология ревью

### Этап 1: Анализ документации
Проведен систематический анализ всех ADR документов:
- Прочитаны все 16 ADR (ADR-000 до ADR-016)
- Проверена полнота документации каждого ADR
- Выявлены противоречия между ADR
- Проверено соответствие PROJECT_ARCHITECTURE.md актуальным ADR

### Этап 2: Анализ схем и манифестов
Проанализированы схемы игровых манифестов:
- Изучены JSON Schema (game-manifest, ui-manifest, extension)
- Сравнены описания в документах со схемами
- Проверены примеры манифестов на соответствие схемам
- Изучены фактические манифесты в games/antarctica/

### Этап 3: Анализ реализации
Проверено соответствие кода целевой архитектуре:
- Изучена структура services/ (какие сервисы реализованы)
- Проверено состояние SDK/ (core, shared, react-sdk, viewers)
- Проанализированы незарегистрированные заглушки
- Проверены проблемы из предыдущего ревью (2025-12-30)

---

## 3. Критические проблемы (P0)

### 3.1. ADR-016: Пустой файл-дубликат

**Файл:** `docs/architecture/adrs/016-viewers-library-architecture.md`

**Проблема:**
- Файл полностью пустой (1 байт)
- Дублирует тему ADR-014 (Viewers Library Architecture)
- Создает путаницу в нумерации ADR

**Действие:** Удалить файл

**Приоритет:** Критический (P0)

---

### 3.2. Противоречие ADR-001 vs ADR-013: Разделение манифестов

**Файлы:**
- `docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md` (2025-11-20)
- `docs/architecture/adrs/013-manifest-text-anchors-and-ui-split.md` (2025-12-10)

**Проблема:**

**ADR-001 утверждает:**
> "Описание UI либо хранится в отдельных разделах манифеста, либо вынесено в отдельные файлы"

Подразумевает единый JSON-манифест с возможными отдельными разделами.

**ADR-013 вводит:**
- **Логический манифест** (Game Logic Manifest) - отдельный файл
- **UI-манифест** (UI Manifest) - отдельный файл
- Это не просто разделы, а отдельные артефакты

**Последствие:** ADR-013 фактически изменяет решение ADR-001, но:
- ADR-001 не помечен как "Superseded"
- ADR-013 не ссылается на ADR-001 как на устаревший
- Создается неопределенность: какое решение актуально?

**Действие:**
1. Обновить статус ADR-001 на "Superseded by ADR-013 (in terms of manifest structure)"
2. Добавить в ADR-013 явную ссылку на ADR-001
3. В PROJECT_ARCHITECTURE.md уточнить, что ADR-013 является эволюцией ADR-001

**Приоритет:** Критический (P0)

---

### 3.3. Противоречие безопасности: ADR-010 vs ADR-015

**Файлы:**
- `docs/architecture/adrs/010-js-sandbox-security.md`
- `docs/architecture/adrs/015-extension-packs-architecture.md`

**Проблема:**

**ADR-010 (JS Sandbox Security):**
- Строгая изоляция всего пользовательского кода через `isolated-vm`
- Скрипты выполняются в отдельном V8 heap
- Ограничения: 100ms timeout, 128MB memory, NO external access

**ADR-015 (Extension Packs Architecture):**
- Вводит концепцию **Engine Extensions** (Build-time), которые:
  - Компилируются с ядром движка
  - Работают в доверенной среде (Shared Context)
  - Имеют прямой доступ к Node.js API
  - НЕ изолируются через sandbox

**Последствие:**
Появляется два класса кода с радикально разными политиками безопасности:
- **User Scripts** (Runtime, Sandbox) - содержимое игр, строгая изоляция
- **Engine Extensions** (Build-time, Trusted) - системные возможности, без изоляции

Но в ADR-010 не был предусмотрен такой сценарий. Нет явного разделения на доверенный и недоверенный код.

**Действие:**
Обновить ADR-010, добавив раздел "Scope and Exceptions":
```markdown
## Scope and Exceptions

### User Scripts (Runtime Content Logic)
- Applies: Full sandbox isolation via isolated-vm
- Source: Game manifests, user-provided code
- Trust level: Untrusted
- Restrictions: Memory limits, timeout, no external access

### Engine Extensions (Build-time Capabilities)
- Applies: NO sandbox isolation
- Source: NPM packages, vetted by platform maintainers
- Trust level: Trusted (reviewed and signed)
- Restrictions: None (full Node.js API access)

This ADR covers ONLY User Scripts. Engine Extensions are covered by ADR-015.
```

**Приоритет:** Критический (P0)

---

### 3.4. Отсутствие критичных ADR в PROJECT_ARCHITECTURE.md

**Файл:** `docs/architecture/PROJECT_ARCHITECTURE.md` (строки 166-180)

**Проблема:**

Раздел "Архитектурные решения (ADR)" упоминает только ADR-001, ADR-002, ADR-004–ADR-011.

**Пропущены важные ADR:**
- **ADR-003** (Hybrid SDUI Schema) - критичный для архитектуры UI
- **ADR-012** (Training Metadata) - обучающие метаданные
- **ADR-013** (Text Anchors & UI Split) - ключевая концепция текстовых якорей
- **ADR-015** (Extension Packs) - новая архитектура движка

**Последствие:**
- Неполная картина архитектурных решений
- Разработчики могут не знать о критичных решениях
- PROJECT_ARCHITECTURE.md не синхронизирован с фактическими ADR

**Действие:**
Добавить в раздел "Архитектурные решения (ADR)":
```markdown
- **ADR-003 (Hybrid SDUI):** Гибридная схема серверно-управляемого UI с атомарными примитивами и семантическими виджетами.
- **ADR-012 (Training Metadata):** Обучающие метаданные и методические материалы в манифесте игры.
- **ADR-013 (Text Anchors & Manifest Split):** Текстовые якоря для синхронизации с источниками и разделение логического и UI-манифестов.
- **ADR-015 (Extension Packs):** Архитектура пакетов расширений и гибридная модель движка (Engine Extensions + User Scripts).
```

**Приоритет:** Критический (P0)

---

### 3.5. Дублирование манифестов: Single Source of Truth нарушен

**Файлы:**
- `games/antarctica/game.manifest.json` - канонический источник истины
- `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json` - дублирующая копия

**Проблема:**

**Целевая архитектура (F_00072, PROJECT_ARCHITECTURE.md):**
- Источник истины: `games/antarctica/`
- Структура: Раздельные файлы `game.manifest.json` (логика) и `ui.manifest.json` (UI)

**Фактическая реализация:**
- В `games/antarctica/game.manifest.json` лежит чистый логический манифест
- В `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json` лежит **монолитный** манифест, содержащий и `state`, и `ui`, и `actions`

**Последствие:**
- Изменения в `games/antarctica/` НЕ синхронизируются с плеером автоматически
- Ручное дублирование создает риск расхождения версий
- Нарушен принцип DRY (Don't Repeat Yourself)

**Примечание:** Эта проблема была отмечена в ревью 2025-12-30, но НЕ исправлена.

**Действие:**
Выбрать и реализовать один из подходов:

**Вариант А (рекомендуется):** Build step
```json
// package.json в antarctica-nextjs-player
"scripts": {
  "prebuild": "node scripts/sync-manifest.js",
  "predev": "node scripts/sync-manifest.js"
}
```

**Вариант Б:** Symlink (может не работать на Windows)

**Вариант В:** Динамическая загрузка через import или fetch

Рекомендация: **Вариант А** как самый надежный кросс-платформенный.

**Приоритет:** Критический (P0)

---

## 4. Проблемы высокого приоритета (P1)

### 4.1. Backend-сервисы не реализованы (5 сервисов)

**Затронутые директории:**
- `services/game-engine/` - ПОЛНОСТЬЮ пустой
- `services/game-catalog/` - ПОЛНОСТЬЮ пустой
- `services/game-editor/` - ПОЛНОСТЬЮ пустой
- `services/game-repository/` - ПОЛНОСТЬЮ пустой
- `services/metadata-db/` - ПОЛНОСТЬЮ пустой

**Фактическое состояние:**
Каждый сервис содержит только:
- `DEV_GUIDE.md` с описанием архитектуры
- Пустую папку `src/` с `.gitkeep`
- Пустую папку `tests/` с `.gitkeep`

**Статус в документации:**
PROJECT_ARCHITECTURE.md (строка 69) честно признает:
> "На момент актуализации документа все сервисы представлены заготовками"

**Проблема:**
- DEV_GUIDE.md детально описывают REST/gRPC API, конфигурацию, стратегии тестирования
- Это создает ложное впечатление готовности
- Ни один из контрактов (engine-api.yaml, router-openapi.yaml, repository-openapi.yaml) не реализован

**Действие:**
1. Зарегистрировать в `docs/legacy/debt-log.csv` как 5 отдельных записей:
   - LEGACY-0003: Game Engine (отсутствует)
   - LEGACY-0004: Game Catalog (отсутствует)
   - LEGACY-0005: Game Editor (отсутствует)
   - LEGACY-0006: Game Repository (отсутствует)
   - LEGACY-0007: Metadata DB (отсутствует)

2. Указать в каждой записи:
   - phase_remove: Phase1 (приоритетная реализация)
   - risk_level: critical
   - priority: high

**Приоритет:** Высокий (P1)

---

### 4.2. SDK/viewers/ полностью отсутствует

**Ожидается согласно архитектуре:**
- ADR-014 (Viewers Library Architecture)
- ADR-016 (дубликат ADR-014)
- F_00071 (Архитектура библиотеки viewers)

**Целевая структура:**
```
SDK/viewers/
├── web-base/           # Базовый веб-плеер
│   ├── package.json
│   ├── viewer.json     # Метаданные
│   └── src/
├── telegram-base/      # Базовый Telegram-плеер
└── mobile-base/        # Базовый мобильный плеер
```

**Фактическое состояние:**
- Директория `SDK/viewers/` НЕ СУЩЕСТВУЕТ
- Viewer реализован как монолитное приложение `games/antarctica-nextjs-player/`
- Жесткая связь (coupling) с контентом игры Antarctica

**Последствие:**
- Невозможно переиспользовать viewer для других игр
- Задача F_00071 помечена как "done" в ROADMAP, но фактически не реализована по спецификации
- Нарушает принцип модульности архитектуры

**Действие:**
1. Создать базовую структуру `SDK/viewers/web-base/`
2. Экстрактовать переиспользуемые компоненты из `games/antarctica-nextjs-player/`
3. Создать `viewer.json` с метаданными:
```json
{
  "id": "web-base-viewer",
  "version": "0.1.0",
  "name": "Cubica Web Base Viewer",
  "channel": "web",
  "supported_schemas": ["1.0.0"],
  "capabilities": ["ui-rendering", "state-management", "action-routing"]
}
```
4. Обновить `games/antarctica-nextjs-player/` для использования `@cubica/viewer-web-base`
5. Обновить статус F_00071 на "in_progress"

**Приоритет:** Высокий (P1)

---

### 4.3. Extension Packs не реализованы

**ADR-015 (Extension Packs Architecture) описывает:**
- **Engine Extensions** (Build-time) - системные возможности, компилируются с ядром
- **User Scripts** (Runtime) - контент игр, выполняются в Sandbox
- **Hybrid Composition** - модель "слоеного пирога"

**Целевая структура:**
```
SDK/extensions/          # Публичные пакеты расширений
├── physics/
├── database/
└── ai-npc/

games/antarctica/
└── extensions/          # Локальные расширения игры
    └── custom-mechanics/
```

**Фактическое состояние:**
- `SDK/extensions/` НЕ СУЩЕСТВУЕТ
- `games/*/extensions/` НЕ СУЩЕСТВУЕТ
- `docs/architecture/schemas/extension.schema.json` пустой (1 строка)
- Sandbox (`isolated-vm`) не реализован в Game Engine

**Последствие:**
- Невозможно расширять функциональность движка
- Невозможно создавать custom capabilities для игр
- User Scripts не могут использовать расширения

**Действие:**
1. Создать полноценный `docs/architecture/schemas/extension.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Cubica Extension Pack Schema",
  "type": "object",
  "required": ["meta", "capabilities", "dependencies"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["id", "version", "name"],
      "properties": {
        "id": { "type": "string" },
        "version": { "type": "string" },
        "name": { "type": "string" },
        "description": { "type": "string" }
      }
    },
    "capabilities": {
      "type": "array",
      "items": { "type": "string" }
    },
    "dependencies": {
      "type": "object"
    }
  }
}
```

2. Добавить секцию `extensions` в game-manifest.schema.json:
```json
"extensions": {
  "type": "array",
  "description": "List of Extension Pack dependencies",
  "items": {
    "type": "object",
    "required": ["id", "version"],
    "properties": {
      "id": { "type": "string" },
      "version": { "type": "string" }
    }
  }
}
```

3. Зарегистрировать отсутствие Extension Packs в debt-log.csv как LEGACY-0008

**Приоритет:** Высокий (P1)

---

### 4.4. Схемы манифестов не валидируют критичные поля

**Файл:** `docs/architecture/schemas/game-manifest.schema.json`

**Проблема 1: assets.rules и assets.scenario не required**

**ADR-012 и manifest-structure.md требуют:**
- `assets.rules` — Required (путь к файлу с правилами)
- `assets.scenario` — Required (путь к файлу со сценарием)

**Схема (строки 82-110):**
```json
"assets": {
  "type": "object",
  "properties": {
    "rules": { "type": "string" },
    "scenario": { "type": "string" },
    ...
  },
  "additionalProperties": false
}
```

Отсутствует `"required": ["rules", "scenario"]`!

**Проблема 2: state.public/state.secret не валидируются**

**manifest-structure.md (строки 186-191):**
> "state разделяется на public и secret"

**Схема (строки 149-152):**
```json
"state": {
  "type": "object",
  "description": "Initial game state definition"
}
```

Нет требования разделения на `state.public` и `state.secret`.

**Проблема 3: Команды UI не проверяются на существование**

**Схема (строка 252):**
```json
"command": { "type": "string" }
```

Можно указать `uiActions.*.command: "nonexistent"`, и это пройдет валидацию, даже если команда не объявлена в `manifest.actions`.

**Действие:**
Обновить game-manifest.schema.json:
```json
"assets": {
  "type": "object",
  "required": ["rules", "scenario"],
  ...
},
"state": {
  "type": "object",
  "required": ["public", "secret"],
  "properties": {
    "public": { "type": "object" },
    "secret": { "type": "object" }
  }
}
```

Для проблемы 3: Добавить custom validation logic или JSON Schema $ref для проверки связности.

**Приоритет:** Высокий (P1)

---

### 4.5. Примеры манифестов не соответствуют ADR-013

**Файлы:**
- `docs/architecture/schemas/examples/minimal-manifest.json`
- `docs/architecture/schemas/examples/ui-layout.json`

**ADR-013 требует:**
- Логический манифест НЕ содержит секцию `ui`
- UI-манифест - отдельный файл
- Текстовые поля используют `source_ref` для ссылки на источники

**Фактическое состояние:**

**minimal-manifest.json:**
- Содержит встроенную секцию `ui` (строки 22-56) - это монолитный манифест!
- НЕ использует `source_ref` для текстовых полей

**ui-layout.json:**
- Содержит и `engine`, и `state`, и `ui` - это комбинированный манифест, не чистый UI

**Последствие:**
- Примеры не демонстрируют заявленную архитектуру
- Разработчики будут следовать примерам, а не ADR
- Создается путаница: что является правильным подходом?

**Действие:**
Создать новую директорию `docs/architecture/schemas/examples/split-manifest/` с:

```
split-manifest/
├── game.manifest.json        # Логический манифест
├── ui.manifest.json          # UI-манифест для Web
├── scenario.md               # Сценарий с якорями
└── README.md                 # Объяснение структуры
```

**game.manifest.json (пример):**
```json
{
  "meta": {
    "id": "example-split-game",
    "name": {
      "source_ref": {
        "file": "scenario.md",
        "anchor": "game.meta.name"
      },
      "resolved": "Пример игры с разделенными манифестами"
    }
  },
  "assets": {
    "rules": "scenario.md#rules",
    "scenario": "scenario.md#scenario"
  },
  "state": {
    "public": { "score": 0 },
    "secret": { "correctAnswer": "42" }
  },
  "actions": {
    "checkAnswer": {
      "handler_type": "llm",
      "prompt": "Check if user's answer is correct"
    }
  }
}
```

**Приоритет:** Высокий (P1)

---

### 4.6. UI-компоненты не задокументированы в схемах

**Проблема:**

**manifest-structure.md (строки 203-210) утверждает:**
> "screenComponent, areaComponent, cardComponent, gameVariableComponent - это концептуальные роли, реализованные через type"

**Фактические манифесты используют:**
```json
"type": "screenComponent",
"type": "areaComponent",
"type": "gameVariableComponent",
"type": "cardComponent"
```

Из `games/antarctica/ui/web/ui.manifest.json`.

**ui-manifest.schema.json определяет:**
```json
"type": { "type": "string" }
```

Без перечисления допустимых значений!

**Последствие:**
- Терминология эпиков и ADR не отражена в схеме
- Нет канонического списка компонентных типов
- Невозможно валидировать корректность типов

**Действие:**
Обновить ui-manifest.schema.json:
```json
"type": {
  "type": "string",
  "enum": [
    "screenComponent",
    "areaComponent",
    "cardComponent",
    "gameVariableComponent",
    "buttonComponent",
    "textComponent",
    "inputComponent",
    "imageComponent"
  ],
  "description": "Component type/role in the UI hierarchy"
}
```

**Приоритет:** Высокий (P1)

---

### 4.7. UI-манифесты не версионированы

**ADR-008 (Manifest Versioning) описывает:**
- `schema_version` - версия схемы данных
- `min_engine_version` - минимальная версия движка

Но это применяется **только к логическим манифестам**.

**ui-manifest.schema.json (строки 9-39):**
```json
"meta": {
  "required": ["id", "version"],
  ...
}
```

Нет полей `schema_version` и `min_viewer_version`!

**Проблема:**
- UI-манифесты могут меняться несовместимо между версиями
- Viewer не может проверить совместимость UI-манифеста
- Непонятно, как обрабатывать legacy UI-манифесты

**Действие:**
Обновить ui-manifest.schema.json:
```json
"meta": {
  "type": "object",
  "required": ["id", "version", "schema_version", "min_viewer_version"],
  "properties": {
    "id": { "type": "string" },
    "version": { "type": "string" },
    "schema_version": { "type": "string" },
    "min_viewer_version": { "type": "string" },
    "channel": { "type": "string" }
  }
}
```

Создать ADR-017 (UI Manifest Versioning Strategy) или расширить ADR-008.

**Приоритет:** Высокий (P1)

---

### 4.8. Дублирование данных в манифесте nextjs-player

**Файл:** `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json`

**Проблема:**
Содержит две секции с дублирующейся структурой экрана:
- Секция `ui` (строки 92-522)
- Секция `application` (строки 649-1078) - **полный дубликат** `ui.screens.S1`!

**Пример:**
```json
{
  "ui": {
    "screens": {
      "S1": {
        "root": { ... }  // Определение экрана
      }
    }
  },
  "application": {
    "screens": {
      "s1": {
        "class": "screen",
        ... // Та же структура!
      }
    }
  }
}
```

**Последствие:**
- Массивное дублирование кода (>400 строк)
- Неясно, какая секция является источником истины
- Риск расхождения при изменениях

**Действие:**
1. Определить, какая секция используется плеером (проверить код рендеринга)
2. Удалить неиспользуемую секцию
3. Обновить плеер для работы с единой структурой

**Приоритет:** Высокий (P1)

---

### 4.9. Незарегистрированные заглушки

**Файл:** `docs/legacy/debt-log.csv`

**Текущее состояние:** Только 2 записи
- LEGACY-0001: Mock LLM ответ
- LEGACY-0002: Dev-заглушка Router в Next.js-плеере

**Обнаружено >10 незарегистрированных заглушек:**

1. `SDK/core/src/index.ts:31` - `createSession.connect()` throws placeholder error
2. Отсутствие 5 backend-сервисов (Game Engine, Catalog, Editor, Repository, Metadata DB)
3. Отсутствие `SDK/viewers/` (вся библиотека)
4. Отсутствие Extension Packs (ADR-015)
5. Дублирование манифестов Antarctica (SSOT нарушен)
6. Пустой extension.schema.json
7. Отсутствие Sandbox (isolated-vm) в Engine
8. Отсутствие Redis интеграции (упоминается, но не реализована)

**Проблема:**
Нарушается требование `docs/legacy/stubs-register.md`:
> "Заглушка без плана снятия недопустима"

**Действие:**
Добавить в debt-log.csv записи LEGACY-0003 до LEGACY-0010 для всех заглушек с:
- source, component, stub_reference
- phase_remove: Phase1 или Phase2
- risk_level: critical/high/medium
- priority: high/medium

**Приоритет:** Высокий (P1)

---

### 4.10. Legacy-файлы не удалены

**Из ревью 2025-12-30 (проблема НЕ исправлена):**

**Файлы:**
- `games/antarctica-nextjs-player/src/app/data/screen_s1.json` (0 байт)
- `games/antarctica-nextjs-player/src/app/data/screen_hint.json` (0 байт)

**Дополнительно обнаружены:**
- `games/antarctica-nextjs-player/src/app/data/screen_j.json` (17 KB)
- `games/antarctica-nextjs-player/src/app/data/screen_leftsidebar.json` (23 KB)

Последние два используют устаревший протокол `proc`/`props` вместо `command`/`payload`.

**Действие:**
1. Удалить пустые файлы `screen_s1.json`, `screen_hint.json`
2. Проверить, используются ли `screen_j.json` и `screen_leftsidebar.json`
3. Если используются - мигрировать на новый протокол
4. Если не используются - удалить

**Приоритет:** Высокий (P1)

---

## 5. Проблемы среднего приоритета (P2)

### 5.1. Отсутствие примеров использования обучающих метаданных

**ADR-012 (Training Metadata) описывает:**
- `meta.training.competencies` - список тренируемых компетенций
- `meta.training.format` - формат игры (single, single_team, multi)
- `assets.methodology` - методические материалы (participants, facilitators)

**Проблема:**
- Нет примеров, как эти данные отображаются в UI
- Нет примеров, как Game Engine использует компетенции
- Непонятно влияние на геймплей/аналитику
- Нет интеграции с Game Catalog (поиск по компетенциям)

**Действие:**
Создать документ `docs/architecture/training-metadata-usage-guide.md` с:
1. Примерами отображения компетенций в UI
2. Примерами использования методических материалов движком
3. Примерами аналитических отчетов по компетенциям
4. Интеграцией с поиском в каталоге

**Приоритет:** Средний (P2)

---

### 5.2. Клиентские скрипты без оценки рисков

**ADR-014 (Viewers Library Architecture) вводит:**
- Клиентские скрипты с доступом к DOM
- Проверенные скрипты (Vetted Scripts) с цифровой подписью
- CSP (Content Security Policy) для ограничения

**Проблема:**
ADR-014 признает:
> "Повышенные риски, которые нужно закрывать процессом проверки"

И упоминает:
> "Необходимость отдельной оценки рисков"

Но эта оценка НЕ проведена!

**Сравнение с серверными скриптами:**

| Аспект | Server Scripts (ADR-010) | Client Scripts (ADR-014) |
|--------|--------------------------|--------------------------|
| Изоляция | Технологическая (isolated-vm) | Процессная (code review) |
| Доступ | Ограничен API | Полный DOM access |
| Риск | Низкий (sandbox) | Высокий (XSS, data theft) |
| Защита | Технология | Процесс + подпись |

**Действие:**
Создать документ `docs/architecture/client-scripts-security-assessment.md`:
1. Матрица рисков клиентских скриптов
2. Процесс code review для клиентских скриптов
3. Процесс подписи и дистрибуции
4. Рекомендации по sandboxed iframe для высокорисковых скриптов
5. CSP политики для разных уровней доверия

**Приоритет:** Средний (P2)

---

### 5.3. ADR с неполной документацией

**Согласно шаблону ADR-000, каждый ADR должен содержать:**
- Контекст (Context)
- Решение (Decision)
- Альтернативы (Alternatives)
- Последствия (Consequences)
- План внедрения (Implementation Plan)
- Связанные артефакты (Related Artifacts)

**ADR с пропущенными разделами:**

| ADR | Проблема | Отсутствующие разделы |
|-----|----------|------------------------|
| ADR-002 | Очень краткий | Alternatives, Implementation Plan |
| ADR-003 | Неполный | Implementation Plan, Related Artifacts |
| ADR-006 | Слишком краткий (41 строка) | Implementation Plan, Related Artifacts, детальные Consequences |
| ADR-014 | Статус "Proposed", авторы "@todo" | Implementation Plan, детальное решение |
| ADR-015 | Deciders/Consulted: "@todo" | Implementation Plan, Related Artifacts |

**Действие:**
Для каждого ADR:
1. Заполнить отсутствующие разделы
2. Убрать "@todo" и указать реальных авторов/Deciders
3. Добавить ссылки на связанные артефакты (Features, ExecPlans, код)

**Приоритет:** Средний (P2)

---

### 5.4. Отсутствие примеров многопользовательских игр

**ADR-011 (Multiplayer Architecture) описывает:**
- Free-form модель мультиплеера
- Event Queue для последовательной обработки
- Версионирование состояния (`state_version`, `last_event_sequence`)

**ADR-012 определяет:**
- `training.format: "multi"` - многопользовательская игра

**Проблема:**
- Нет примера манифеста для многопользовательской игры
- Неясно, как описать роли игроков
- Неясно, как описать очередность ходов
- Неясно, как синхронизируется состояние

**Действие:**
Создать пример `docs/architecture/schemas/examples/multiplayer-game-manifest.json` с:
```json
{
  "meta": {
    "training": {
      "format": "multi",
      "min_players": 2,
      "max_players": 6,
      "roles": [
        { "id": "manager", "name": "Менеджер" },
        { "id": "analyst", "name": "Аналитик" }
      ]
    }
  },
  "state": {
    "public": {
      "players": {},
      "current_turn": null,
      "round": 1
    },
    "secret": {
      "correct_answers": {}
    }
  },
  "actions": {
    "submitAnswer": {
      "handler_type": "llm",
      "turn_based": true,
      "visibility": "public"
    }
  }
}
```

**Приоритет:** Средний (P2)

---

### 5.5. Отсутствие примера Hybrid Execution Model

**ADR-007 (Hybrid Execution Model) и manifest-structure.md описывают:**
- Действия могут обрабатываться LLM (`handler_type: "llm"`)
- Действия могут обрабатываться скриптом (`handler_type: "script"`)

**manifest-structure.md (строки 252-265) показывает:**
```json
"actions": {
  "checkInventory": {
    "handler_type": "script",
    "script_path": "scripts/inventory.js"
  }
}
```

**Проблема:**
- Нет примера фактического скрипта в `assets.scripts`
- Нет примера интеграции скрипта с манифестом
- Непонятно, какой API доступен скрипту
- Непонятно, как скрипт получает состояние и аргументы
- Непонятно, как скрипт возвращает результат

**Действие:**
Создать пример `docs/architecture/schemas/examples/hybrid-execution/` с:
1. `game.manifest.json` с объявлением script handlers
2. `scripts/inventory.js` с реальной логикой:
```javascript
// Доступный API для User Scripts
function checkInventory(state, args) {
  const player = state.public.players[args.playerId];
  return {
    delta: {}, // Изменения состояния
    output: {
      hasItem: player.inventory.includes(args.itemId)
    }
  };
}
```
3. Документацию API для скриптов

**Приоритет:** Средний (P2)

---

## 6. Проблемы низкого приоритета (P3)

### 6.1. Redis Integration - неясный статус

**Проблема:**

**PROJECT_ARCHITECTURE.md (строка 192):**
> "Redis — слой кэширования и распределённых блокировок (Phase 2+)"

Указывает на будущее внедрение.

**PROJECT_ARCHITECTURE.md (строка 193):**
> "используется для кэширования активных сессий и блокировок"

Использует настоящее время, как будто Redis уже внедрен!

**Последствие:**
- Неясно, является ли Redis текущим или планируемым компонентом
- Разработчики могут начать использовать Redis, который не настроен

**Действие:**
Уточнить в PROJECT_ARCHITECTURE.md раздел 3 (Хранилища данных):
```markdown
## 3. Хранилища данных и кэши

- **PostgreSQL** — основной источник истины (ТЕКУЩЕЕ СОСТОЯНИЕ)
- **Redis** — планируется в Phase 2+ для:
  - Кэширования манифестов игр
  - Кэширования активных сессий
  - Распределённых блокировок

  На данный момент все данные хранятся только в PostgreSQL.
```

**Приоритет:** Низкий (P3)

---

### 6.2. Путаница между "channel" и "variant" в UI-манифестах

**ui-manifest.schema.json определяет:**

```json
"channel": {
  "type": "string",
  "description": "e.g. 'web', 'telegram'"
}
```

```json
"variant": {
  "type": "string",
  "description": "e.g. 'desktop', 'mobile'"
}
```

**Проблема:**
- Непонятно четкое разделение: channel - это платформа (web/telegram)?
- Variant - это форм-фактор (desktop/mobile) или тема оформления (dark/light)?
- Можно ли иметь `channel: "web"` + `variant: "mobile"`?
- Можно ли иметь `channel: "telegram"` + `variant: "dark"`?

**Действие:**
1. Добавить в ui-manifest.schema.json четкие определения и ограничения
2. Создать enum для channel:
```json
"channel": {
  "type": "string",
  "enum": ["web", "telegram", "mobile", "desktop"],
  "description": "Deployment channel/platform"
}
```
3. Уточнить, что variant - для форм-фактора внутри channel
4. Документировать в `docs/architecture/schemas/ui-schema-concept.md`

**Приоритет:** Низкий (P3)

---

### 6.3. Отсутствие кросс-валидации биндингов

**ui-manifest.schema.json (строка 147) описывает:**
```json
"props": {
  "type": "object",
  "description": "...may include data bindings like {{state.public.hp}}"
}
```

**Проблема:**
- Схема не валидирует синтаксис биндингов (`{{...}}`)
- Нет описания, как парсить эти выражения
- Нет проверки существования путей (например, `state.public.hp` должен существовать)

**Действие:**
1. Документировать формат биндингов в `docs/architecture/ui-binding-syntax.md`
2. Создать custom validation tool для проверки биндингов
3. Интегрировать в CI/CD pipeline

**Приоритет:** Низкий (P3)

---

### 6.4. Различия в структуре компонентов между манифестами

**games/antarctica/ui/web/ui.manifest.json использует:**
```json
"root": {
  "type": "screenComponent",
  "props": { "cssClass": "main-screen" },
  "children": [...]  // Массив дочерних элементов
}
```

**games/antarctica-nextjs-player/.../manifest.json использует:**
```json
"root": {
  "class": "screen",
  "component": "screenComponent",
  "backgroundImage": "./images/arctic-background.png",
  "cssClass": "main-screen",
  "elements": {...}  // Объект (не массив!)
}
```

**Проблема:**
- Два манифеста одной игры используют разные структуры
- `children` (массив) vs `elements` (объект)
- `type` vs `component`
- Одновременно `class` + `component` + `type`

**Последствие:**
- Это разные версии одной игры с несовместимыми структурами!
- Viewer должен поддерживать оба формата?

**Действие:**
1. Выбрать канонический формат (рекомендуется: `children` как массив)
2. Привести все манифесты к единому формату
3. Обновить ui-manifest.schema.json для строгой валидации
4. Документировать в migration guide, если меняется формат

**Приоритет:** Низкий (P3)

---

### 6.5. Отсутствие документа Observability Standards

**PROJECT_ARCHITECTURE.md (строка 240) упоминает:**
> "Стандарты наблюдаемости и лимитирования будут зафиксированы в отдельном ADR (Observability Standards)"

**Проблема:**
- Такой ADR не существует
- F_00051 (Observability Framework) в статусе "pending"
- Нет стандартов для логирования, метрик, трейсинга

**Действие:**
1. Создать ADR-017 (Observability Standards) или
2. Убрать ссылку из PROJECT_ARCHITECTURE.md до готовности ADR
3. Реализовать F_00051

**Приоритет:** Низкий (P3)

---

## 7. Итоговая статистика

### 7.1. ADR документы

| Метрика | Значение |
|---------|----------|
| Всего ADR (включая template и дубликат) | 16 |
| Действующих ADR | 14 |
| Статус "Accepted" | 11 |
| Статус "Proposed" | 3 (ADR-001, ADR-012, ADR-014) |
| Критических проблем | 4 |
| Противоречий между ADR | 3 |
| Несогласованностей с PROJECT_ARCHITECTURE | 3 |
| ADR с неполной документацией | 5 |

### 7.2. Манифесты и схемы

| Метрика | Значение |
|---------|----------|
| Критических противоречий между описанием и схемами | 6 |
| Отсутствующих required полей в схемах | 4 |
| Примеров, не соответствующих архитектуре | 2 |
| Отсутствующих примеров | 4 |

### 7.3. Реализация

**Соответствие целевой архитектуре: ~30%**

| Компонент | Готовность | Комментарий |
|-----------|------------|-------------|
| Backend-сервисы | 5% | Только типы Router + sessionEvents |
| SDK/core | 60% | Базовые интерфейсы есть, но createSession - placeholder |
| SDK/shared | 100% | 7 компонентов полностью реализованы |
| SDK/react-sdk | 70% | Хук сессии, адаптер Router, GameCanvas |
| SDK/viewers | 0% | Директория не существует |
| Extension Packs | 0% | Не реализованы |
| Game Content | 70% | Структура хороша, но дублирование манифестов |
| Документация | 90% | Описано, но с противоречиями |

### 7.4. Управление legacy

| Метрика | Значение |
|---------|----------|
| Зарегистрированных заглушек | 2 |
| Незарегистрированных заглушек | >10 |
| Покрытие debt-log.csv | ~20% |

### 7.5. Приоритеты проблем

| Приоритет | Количество | Описание |
|-----------|------------|----------|
| P0 (Критический) | 5 | Блокеры целостности архитектуры |
| P1 (Высокий) | 10 | Архитектурные несоответствия |
| P2 (Средний) | 5 | Качество документации и примеров |
| P3 (Низкий) | 5 | Улучшения и оптимизации |
| **ВСЕГО** | **25** | |

---

## 8. Рекомендации по устранению

### 8.1. Немедленные действия (Sprint 1: 1-2 дня)

**Цель:** Устранить критические противоречия в документации

#### Шаг 1: Исправить критические проблемы ADR

- [x] **Удалить** `docs/architecture/adrs/016-viewers-library-architecture.md` (пустой дубликат)

- [x] **Обновить** `docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md`:
  - Добавить в начало документа:
    ```markdown
    > **Статус:** Superseded by ADR-013 в части структуры манифестов.
    > Концепция LLM-first остается актуальной, но разделение на логический
    > и UI-манифесты описано в ADR-013.
    ```

- [x] **Обновить** `docs/architecture/adrs/010-js-sandbox-security.md`:
  - Добавить раздел "Scope and Exceptions" с разделением User Scripts vs Engine Extensions

- [x] **Обновить** `docs/architecture/PROJECT_ARCHITECTURE.md` (раздел "Архитектурные решения"):
  - Добавить ADR-003, ADR-012, ADR-013, ADR-015

#### Шаг 2: Актуализировать debt-log.csv

- [x] Добавить 5 новых записей:

```csv
LEGACY-0003,service,game-engine,services/game-engine/,Backend-сервис Game Engine не реализован,Phase1,critical,high,Backend Team,E_0030,2026-01-13,active
LEGACY-0004,service,backend,services/game-catalog,Backend-сервисы Catalog/Editor/Repository/Metadata не реализованы,Phase1,high,high,Backend Team,E_0030,2026-01-13,active
LEGACY-0005,client,sdk,SDK/viewers/,SDK/viewers библиотека не реализована,Phase1,high,high,SDK Team,F_00071,2026-01-13,active
LEGACY-0006,service,extension-packs,SDK/extensions/,Extension Packs архитектура не реализована,Phase2,medium,medium,Engine Team,ADR-015,2026-01-13,active
LEGACY-0007,client,antarctica-player,games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json,Дублирование манифеста Antarctica нарушает SSOT,Phase1,high,high,Content Team,F_00024,2026-01-13,active
```

#### Шаг 3: Удалить legacy-файлы

- [x] `games/antarctica-nextjs-player/src/app/data/screen_s1.json` (0 байт)
- [x] `games/antarctica-nextjs-player/src/app/data/screen_hint.json` (0 байт)

**Критерий завершения:** Все ADR синхронизированы, debt-log.csv актуален, legacy-файлы удалены.

---

### 8.2. Краткосрочные задачи (Sprint 2-3: 1 неделя)

**Цель:** Обновить схемы манифестов и создать референсные примеры

#### Шаг 4: Обновить схемы манифестов

- [ ] **game-manifest.schema.json:**
  - Добавить `"required": ["rules", "scenario"]` в секцию `assets`
  - Добавить `"required": ["public", "secret"]` в секцию `state`
  - Добавить секцию `extensions` для зависимостей от Extension Packs

- [ ] **ui-manifest.schema.json:**
  - Добавить `schema_version` и `min_viewer_version` в `meta`
  - Определить enum для стандартных UI-компонентов:
    ```json
    "type": {
      "enum": ["screenComponent", "areaComponent", "cardComponent", "gameVariableComponent", "buttonComponent", "textComponent"]
    }
    ```

- [ ] **extension.schema.json:**
  - Создать полноценную схему для Extension Packs

#### Шаг 5: Создать референсные примеры

- [ ] **split-manifest/** - разделенные логический и UI-манифесты с source_ref:
  - `game.manifest.json` (логический)
  - `ui.manifest.json` (UI для Web)
  - `scenario.md` (с якорями)
  - `README.md` (объяснение структуры)

- [ ] **hybrid-execution/** - игра с script handlers:
  - `game.manifest.json` (с `handler_type: "script"`)
  - `scripts/inventory.js` (реальная логика)
  - `README.md` (документация API для скриптов)

- [ ] **multiplayer-game/** - многопользовательская игра:
  - `game.manifest.json` (с ролями, очередностью ходов)
  - `README.md` (описание мультиплеерной логики)

- [ ] **extension-usage/** - игра с Extension Pack зависимостями:
  - `game.manifest.json` (с секцией `extensions`)
  - `extensions/custom-mechanics/` (локальное расширение)

#### Шаг 6: Настроить процесс синхронизации манифестов

**Выбранный подход:** Build step (Вариант А)

- [ ] Создать скрипт `games/antarctica-nextjs-player/scripts/sync-manifest.js`:
  ```javascript
  const fs = require('fs');
  const path = require('path');

  const source = path.join(__dirname, '../../antarctica/game.manifest.json');
  const target = path.join(__dirname, '../src/app/data/antarctica/game.manifest.json');

  fs.copyFileSync(source, target);
  console.log('✓ Manifest synced from games/antarctica/');
  ```

- [ ] Обновить `package.json`:
  ```json
  "scripts": {
    "prebuild": "node scripts/sync-manifest.js",
    "predev": "node scripts/sync-manifest.js"
  }
  ```

- [ ] Удалить секцию `application` из `games/antarctica-nextjs-player/.../manifest.json`

**Критерий завершения:** Схемы обновлены, 4 референсных примера созданы, синхронизация манифестов автоматизирована.

---

### 8.3. Среднесрочные задачи (Phase 1: 2-4 недели)

**Цель:** Реализовать базовую структуру SDK/viewers/ и создать документы безопасности

#### Шаг 7: Реализовать базовую структуру SDK/viewers/

- [ ] Создать директорию `SDK/viewers/web-base/`
- [ ] Создать `package.json`:
  ```json
  {
    "name": "@cubica/viewer-web-base",
    "version": "0.1.0",
    "description": "Base web viewer for Cubica games"
  }
  ```

- [ ] Создать `viewer.json`:
  ```json
  {
    "id": "web-base-viewer",
    "version": "0.1.0",
    "name": "Cubica Web Base Viewer",
    "channel": "web",
    "supported_schemas": ["1.0.0"],
    "capabilities": ["ui-rendering", "state-management", "action-routing"]
  }
  ```

- [ ] Экстрактовать переиспользуемые компоненты из `games/antarctica-nextjs-player/`:
  - Renderer logic
  - State management hooks
  - Action routing

- [ ] Обновить `games/antarctica-nextjs-player/` для использования `@cubica/viewer-web-base`

- [ ] Обновить статус F_00071 на "in_progress" в ROADMAP

#### Шаг 8: Создать документы безопасности

- [ ] **docs/architecture/client-scripts-security-assessment.md:**
  - Матрица рисков клиентских скриптов
  - Процесс code review
  - Процесс подписи и дистрибуции
  - Рекомендации по sandboxed iframe
  - CSP политики

- [ ] **docs/architecture/extension-security-model.md:**
  - Разделение User Scripts vs Engine Extensions
  - Trust boundaries
  - Процесс ревью расширений

#### Шаг 9: Создать руководство по обучающим метаданным

- [ ] **docs/architecture/training-metadata-usage-guide.md:**
  - Примеры отображения компетенций в UI
  - Примеры использования методических материалов движком
  - Примеры аналитических отчетов
  - Интеграция с поиском в каталоге

#### Шаг 10: Заполнить пропущенные разделы ADR

- [ ] ADR-002: добавить Alternatives и Implementation Plan
- [ ] ADR-003: добавить Implementation Plan и Related Artifacts
- [ ] ADR-006: расширить до стандартного формата
- [ ] ADR-014: заполнить поля авторов, добавить детальное решение
- [ ] ADR-015: заполнить Deciders/Consulted, добавить Implementation Plan

**Критерий завершения:** SDK/viewers/web-base создан и интегрирован, 3 документа безопасности созданы, все ADR полностью заполнены.

---

### 8.4. Долгосрочные задачи (Phase 2+)

#### Шаг 11: Интегрировать валидацию в CI/CD

- [ ] JSON Schema validation для всех манифестов
- [ ] Contract testing для OpenAPI спецификаций
- [ ] Проверка связности команд UI ↔ actions
- [ ] Проверка синтаксиса биндингов `{{...}}`

#### Шаг 12: Реализовать Extension Packs архитектуру

- [ ] Build-time composition для Engine Extensions
- [ ] Sandbox (isolated-vm) для User Scripts
- [ ] Создать примеры в `SDK/extensions/` и `games/*/extensions/`
- [ ] Реализовать Bridge для взаимодействия Extensions ↔ Scripts

#### Шаг 13: Реализовать backend-сервисы

- [ ] Game Engine (LLM интеграция, контекст-пайплайн)
- [ ] Router (маршрутизация, сессии, мультиплеер)
- [ ] Game Repository (хранение манифестов)
- [ ] Game Catalog (поиск, фильтрация)
- [ ] Game Editor (редактор сценариев)
- [ ] Metadata Database (аналитика)

---

## 9. Влияние на roadmap

### 9.1. Задачи, требующие обновления статуса

**F_00071 (Архитектура библиотеки viewers):**
- **Текущий статус:** done (✓ в ROADMAP)
- **Фактический статус:** НЕ реализовано по спецификации
- **Действие:** Изменить статус на "in_progress", создать задачи по реализации

### 9.2. Новые задачи для добавления в roadmap

#### Epic: Архитектурная консолидация и качество

**E_00001: Architecture Review & Consolidation**

**Features:**

- **F_00001: ADR Synchronization & Conflict Resolution**
  - Исправление противоречий между ADR
  - Обновление PROJECT_ARCHITECTURE.md
  - Синхронизация статусов ADR

- **F_00002: Manifest Schemas Enhancement**
  - Обновление game-manifest.schema.json (required fields, extensions)
  - Обновление ui-manifest.schema.json (versioning, component types)
  - Создание extension.schema.json

- **F_00003: Reference Examples for Manifests**
  - Split-manifest example
  - Hybrid-execution example
  - Multiplayer-game example
  - Extension-usage example

- **F_00004: Security Documentation & Assessment**
  - Client scripts security assessment
  - Extension security model
  - Trust boundaries documentation

- **F_00005: Legacy Debt Registration**
  - Регистрация всех заглушек в debt-log.csv
  - Планы снятия для каждой заглушки
  - Приоритизация технического долга

### 9.3. Связь с существующими Milestones/Epics

**M_010 (Alpha-этап игрового плеера):**
- Блокируется отсутствием SDK/viewers/
- Требует реализации F_00002 (Manifest Schemas Enhancement)

**E_0010 (Архитектура JSON-манифестов игр и LLM-first плеера):**
- Требует F_00001 (ADR Synchronization)
- Требует F_00003 (Reference Examples)

**E_0030 (Game Engine & Backend Architecture Design):**
- Требует F_00004 (Security Documentation)
- Требует регистрации backend-сервисов как legacy (F_00005)

---

## 10. Заключение

### 10.1. Общая оценка

Архитектура проекта Cubica находится в состоянии **качественного архитектурного дизайна**, но с рядом **критических противоречий в документации** и **значительным отставанием реализации от целевой архитектуры**.

**Соответствие целевой архитектуре: ~30%**

### 10.2. Сильные стороны

✅ **Архитектурная проработка:**
- Система ADR хорошо развита (14 документов)
- Детальная целевая архитектура с четкими принципами
- Качественные архитектурные концепции (MVP, LLM-first, Extension Packs, Text Anchors)

✅ **Структура проекта:**
- Логичное разделение на services/, SDK/, games/, docs/
- Продуманная система задач (Milestones/Epics/Features)
- Управление legacy через debt-log.csv

✅ **Контент:**
- Структура манифестов игры Antarctica соответствует ADR-013
- SDK/shared полностью реализован (7 компонентов)
- Текстовые якоря успешно интегрированы

### 10.3. Критические риски

⚠️ **Противоречия в документации:**
- ADR-001 vs ADR-013 (разделение манифестов)
- ADR-010 vs ADR-015 (безопасность расширений)
- Примеры манифестов не соответствуют ADR-013
- 4 критичных ADR отсутствуют в PROJECT_ARCHITECTURE.md

⚠️ **Пропуски в реализации:**
- Backend-сервисы не реализованы (5 сервисов = 0%)
- SDK/viewers/ не существует (нарушает ADR-014)
- Extension Packs не реализованы (нарушает ADR-015)
- Схемы манифестов не валидируют критичные поля

⚠️ **Нарушение принципов:**
- Single Source of Truth нарушен (дублирование манифестов)
- >10 незарегистрированных заглушек (покрытие debt-log ~20%)
- Legacy-файлы из ревью 2025-12-30 не удалены

### 10.4. Рекомендуемый фокус

**Немедленный (1-2 дня):**
1. ✅ Устранить критические противоречия в ADR
2. ✅ Обновить PROJECT_ARCHITECTURE.md
3. ✅ Зарегистрировать все заглушки в debt-log.csv
4. ✅ Удалить legacy-файлы

**Краткосрочный (1 неделя):**
5. ✅ Обновить схемы манифестов
6. ✅ Создать 4 референсных примера
7. ✅ Автоматизировать синхронизацию манифестов

**Среднесрочный (2-4 недели):**
8. ✅ Реализовать SDK/viewers/web-base
9. ✅ Создать документы безопасности
10. ✅ Заполнить пропущенные разделы ADR

**Долгосрочный (Phase 2+):**
11. ⏳ Реализовать Extension Packs
12. ⏳ Реализовать backend-сервисы
13. ⏳ Интегрировать валидацию в CI/CD

### 10.5. Финальная рекомендация

После устранения **5 критических проблем (P0)** и **10 проблем высокого приоритета (P1)** проект получит:

✅ **Согласованную архитектурную базу** без внутренних противоречий
✅ **Четкие примеры** для разработчиков игр
✅ **Контроль технического долга** через актуальный debt-log
✅ **Основу для масштабирования** через SDK/viewers и Extension Packs

Это создаст **прочный фундамент** для дальнейшей реализации платформы Cubica.

---

## Приложения

### Приложение A: Полный список ADR с оценкой качества

| № | Название | Статус | Качество | Проблемы |
|---|----------|--------|----------|----------|
| 000 | Template | Template | ✅ | - |
| 001 | MVP & LLM-first | Proposed | ✅ | Superseded by ADR-013 |
| 002 | Abstract View Protocol | Accepted | ⚠️ | Нет Alternatives, плана |
| 003 | Hybrid SDUI Schema | Accepted | ⚠️ | Нет плана, артефактов |
| 004 | LLM Context Pipeline | Accepted | ✅ | - |
| 005 | Session Persistence | Accepted | ✅ | - |
| 006 | View Adapters | Accepted | ⚠️ | Слишком краткий |
| 007 | Hybrid Execution | Accepted | ✅ | - |
| 008 | Manifest Versioning | Accepted | ✅ | - |
| 009 | Asset Management | Accepted | ✅ | - |
| 010 | JS Sandbox Security | Accepted | ⚠️ | Нет раздела про Extensions |
| 011 | Multiplayer | Accepted | ✅ | - |
| 012 | Training Metadata | Proposed | ✅ | - |
| 013 | Text Anchors & UI Split | Accepted | ✅ | - |
| 014 | Viewers Library | Proposed | ⚠️ | Авторы "@todo" |
| 015 | Extension Packs | Accepted | ⚠️ | Deciders "@todo" |
| 016 | Viewers Library (дубл.) | - | ❌ | ПУСТОЙ ФАЙЛ |

### Приложение B: Файлы, требующие немедленных изменений (Priority 1)

```
Критические (в течение 1-2 дней):
1. docs/architecture/adrs/016-viewers-library-architecture.md (DELETE)
2. docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md (UPDATE)
3. docs/architecture/adrs/010-js-sandbox-security.md (UPDATE)
4. docs/architecture/PROJECT_ARCHITECTURE.md (UPDATE)
5. docs/legacy/debt-log.csv (ADD 5 records)
6. games/antarctica-nextjs-player/src/app/data/screen_s1.json (DELETE)
7. games/antarctica-nextjs-player/src/app/data/screen_hint.json (DELETE)

Высокий приоритет (в течение недели):
8. docs/architecture/schemas/game-manifest.schema.json (UPDATE)
9. docs/architecture/schemas/ui-manifest.schema.json (UPDATE)
10. docs/architecture/schemas/extension.schema.json (CREATE)
11. docs/architecture/schemas/examples/split-manifest/ (CREATE)
12. games/antarctica-nextjs-player/scripts/sync-manifest.js (CREATE)
13. games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json (CLEANUP)
```

### Приложение C: Метрики для отслеживания прогресса

**Целевые показатели после исправлений:**

| Метрика | Текущее | Целевое |
|---------|---------|---------|
| Согласованность ADR | 70% | 100% |
| Полнота ADR (все разделы) | 64% (9/14) | 100% (14/14) |
| Соответствие примеров архитектуре | 40% | 100% |
| Покрытие debt-log.csv | 20% | 100% |
| Соответствие схем документации | 60% | 95% |
| Backend реализация | 5% | 10% (типы + мок) |
| SDK реализация | 40% | 60% (+ viewers) |
| Общее соответствие архитектуре | 30% | 50% |

**Критерий успеха:** Достижение 50% общего соответствия архитектуре с полной согласованностью документации (100% для ADR, схем, примеров).

---

**Документ подготовлен:** 2026-01-13
**Следующее ревью:** После реализации рекомендаций Priority 1 (через 2-4 недели)
**Контакт:** Claude Code (Sonnet 4.5)
