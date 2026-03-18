---
id: F_00005
title: SDK Viewers Web Base
status: done
owner: @claude-code
epic: E_00001
area: sdk
tags: [priority:P1, type:feature]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/adrs/014-viewers-library-architecture.md
  - SDK/viewers/
---

# FEATURE: SDK Viewers Web Base

## Контекст и цели

По результатам архитектурного ревью от 2026-01-13 выявлено отсутствие SDK/viewers/ (P1):

- Директория `SDK/viewers/` не существует
- Viewer реализован как монолитное приложение `games/antarctica-nextjs-player/`
- Невозможно переиспользовать viewer для других игр
- Нарушает ADR-014 (Viewers Library Architecture)

**Цели:**
- [x] Создать базовую структуру `SDK/viewers/web-base/`
- [x] Экстрактовать переиспользуемые компоненты
- [x] Обеспечить возможность подключения viewer к любой игре

## Объём

**In scope:**
- Создание структуры `SDK/viewers/web-base/`
- Создание `package.json` для @cubica/viewer-web-base
- Создание `viewer.json` с метаданными
- Экстракция базовых компонентов рендеринга

**Out of scope:**
- Полная реализация viewer
- Telegram/Mobile viewers
- Публикация в npm

## Задачи

- [x] **Шаг 1: Создать структуру SDK/viewers/web-base/**
  - [x] Создать директорию `SDK/viewers/web-base/`
  - [x] Создать `package.json` с базовой конфигурацией
  - [x] Создать `viewer.json` с метаданными viewer

- [x] **Шаг 2: Создать базовые типы и интерфейсы**
  - [x] Создать `src/types.ts` — типы для viewer
  - [x] Создать `src/index.ts` — экспорты

- [x] **Шаг 3: Экстрактовать базовые компоненты**
  - [x] `src/components/ManifestLoader.tsx` — загрузка манифестов
  - [x] `src/components/StateManager.tsx` — управление состоянием
  - [x] `src/components/ActionRouter.tsx` — маршрутизация действий

- [x] **Шаг 4: Документация**
  - [x] Создать `README.md` с инструкциями по использованию
  - [x] Обновить PROJECT_STRUCTURE.md

## Acceptance Criteria

- [x] `SDK/viewers/web-base/` существует с корректной структурой
- [x] `viewer.json` содержит метаданные по ADR-014
- [x] Базовые типы определены и экспортированы
- [x] README.md документирует использование

## Definition of Done

- [x] Структура SDK/viewers/web-base/ создана
- [x] package.json и viewer.json созданы
- [x] Базовые типы определены
- [x] Документация создана
- [x] PROJECT_STRUCTURE.md обновлен
- [x] ROADMAP.md обновлен
- [ ] Эпик E_00001 обновлен
- [ ] CI зелёный

## Результаты выполнения

**Дата выполнения:** 2026-01-14

**Созданные файлы:**

```
SDK/viewers/web-base/
├── package.json          # NPM пакет @cubica/viewer-web-base v0.1.0
├── viewer.json           # Метаданные viewer (id, version, supportedSchemas, capabilities)
├── README.md             # Документация на русском языке
└── src/
    ├── index.ts          # Точка входа, экспорты всех типов и компонентов
    ├── types.ts          # Типы: GameManifest, UIManifest, ViewerConfig, GameState и др.
    └── components/
        ├── index.ts            # Barrel export компонентов
        ├── ManifestLoader.tsx  # Загрузка манифестов (hook + component)
        ├── StateManager.tsx    # Управление состоянием (hook + component + factory)
        └── ActionRouter.tsx    # Маршрутизация действий (hook + component + factory)
```

**Ключевые типы (src/types.ts):**
- `GameManifest`, `GameManifestMeta`, `GameVariable`, `GameScene`
- `UIManifest`, `UIScreen`, `UIComponent`
- `ViewerConfig`
- `GameState`
- `ManifestLoadResult`, `ManifestLoaderOptions`
- `ActionContext`, `ActionResult`, `ActionHandler`
- `IStateManager`, `StateSubscriber`

**Компоненты:**
- `ManifestLoader` — загружает GameManifest и UIManifest, кеширует результаты
- `StateManager` — хранит состояние, применяет патчи (JSON Merge Patch), поддерживает localStorage
- `ActionRouter` — маршрутизирует действия, поддерживает встроенные команды (navigate, updateState, setVariable, playEffect, sendCommand, noop)

**Обновлённая документация:**
- `PROJECT_STRUCTURE.md` — добавлен раздел SDK/viewers/

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md) (Раздел 4.2)
- [Epic E_00001](../epics/E_00001_architecture_review_consolidation.md)
- [ADR-014 Viewers Library Architecture](../../architecture/adrs/014-viewers-library-architecture.md)
- [F_00071 Архитектура библиотеки viewers](F_00071_viewers_library_architecture_(E_0010).md)
- [README.md пакета](../../../SDK/viewers/web-base/README.md)
