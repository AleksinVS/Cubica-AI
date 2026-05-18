---
id: F_00020
title: Определение схемы UI (Hybrid SDUI)
status: done
owner: @todo
epic: E_0010
area: game-platform
tags: [priority:P1, type:feature]
links:
  - PROJECT_OVERVIEW.md
  - docs/architecture/schemas/manifest-structure.md
  - docs/architecture/schemas/game-manifest.schema.json
---

# FEATURE: Определение схемы UI (Hybrid SDUI)

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)

## Цели

- [x] Определить JSON-формат для описания пользовательского интерфейса в игровом манифесте.
- [x] Реализовать "Гибридный подход" (Hybrid SDUI): сочетание атомарных примитивов (layout) и семантических виджетов (game logic).
- [x] Обеспечить поддержку Data Binding (привязка UI к состоянию игры).
- [x] Подготовить схему для генерации UI силами LLM (в том числе на основе изображений).

## Scope

In scope:
- Документация концепции Hybrid SDUI.
- Обновление `game-manifest.schema.json` секцией `ui`.
- Определение базовых атомарных компонентов (`container`, `text`, `button`, `image`, `stack`).
- Определение формата семантических виджетов (`widget:*`).
- Примеры валидных UI-манифестов.

Out of scope:
- Реализация рендерера (Web/Telegram) — это отдельные задачи.
- Визуальный редактор манифестов.

## Acceptance-Criteria

- [x] Документ `docs/architecture/schemas/ui-schema-concept.md` создан и описывает принципы построения UI.
- [x] JSON Schema валидирует корректную структуру UI (вложенность, типы полей).
- [x] Схема поддерживает поле `bind` для связи свойств компонента с переменными состояния (`{{state.hp}}`).
- [x] Схема поддерживает как жесткую верстку (Atomic), так и высокоуровневые виджеты (Semantic).

## Definition-of-Done

- [x] JSON Schema обновлена и валидна.
- [x] Создан пример сложного UI (`ui-layout.json`), проходящий валидацию.
- [x] Feature-task обновлен и закрыт.
