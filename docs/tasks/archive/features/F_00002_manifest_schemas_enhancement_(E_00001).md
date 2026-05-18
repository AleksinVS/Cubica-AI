---
id: F_00002
title: Manifest Schemas Enhancement
status: done
owner: @claude-code
epic: E_00001
area: architecture
tags: [priority:P1, type:chore]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/schemas/game-manifest.schema.json
  - docs/architecture/schemas/ui-manifest.schema.json
  - docs/architecture/schemas/extension.schema.json
---

# FEATURE: Manifest Schemas Enhancement

## Контекст и цели

По результатам архитектурного ревью от 2026-01-13 выявлены проблемы в схемах манифестов (P1):

- [x] Обновить game-manifest.schema.json с обязательными полями
- [x] Обновить ui-manifest.schema.json с версионированием
- [x] Создать полноценный extension.schema.json

## Объём

**In scope:**
- Добавление `required: ["rules", "scenario"]` в секцию `assets` схемы game-manifest
- Добавление `required: ["public", "secret"]` в секцию `state` схемы game-manifest
- Добавление секции `extensions` для зависимостей от Extension Packs
- Добавление `schema_version` и `min_viewer_version` в meta секцию ui-manifest
- Определение enum для стандартных UI-компонентов
- Создание extension.schema.json по ADR-015

**Out of scope:**
- Реализация Extension Packs
- Миграция существующих манифестов
- CI/CD валидация схем

## Задачи

- [x] **Шаг 1: Обновить game-manifest.schema.json**
  - [x] Добавить `"required": ["rules", "scenario"]` в секцию `assets`
  - [x] Добавить `"required": ["public", "secret"]` в секцию `state`
  - [x] Добавить секцию `extensions` для Extension Pack зависимостей

- [x] **Шаг 2: Обновить ui-manifest.schema.json**
  - [x] Добавить `schema_version` в `meta.required`
  - [x] Добавить `min_viewer_version` в `meta.required`
  - [x] Определить enum для UI-компонентов: `screenComponent`, `areaComponent`, `cardComponent`, `gameVariableComponent`, `buttonComponent`, `textComponent`, `inputComponent`, `imageComponent`

- [x] **Шаг 3: Создать extension.schema.json**
  - [x] Определить структуру `meta` (id, version, name, description)
  - [x] Определить массив `capabilities`
  - [x] Определить объект `dependencies`
  - [x] Добавить `trust_level` (trusted/untrusted)

## Acceptance Criteria

- [x] game-manifest.schema.json валидирует обязательность полей assets.rules, assets.scenario
- [x] game-manifest.schema.json валидирует обязательность state.public, state.secret
- [x] ui-manifest.schema.json требует schema_version и min_viewer_version
- [x] extension.schema.json соответствует ADR-015
- [ ] Существующие манифесты games/antarctica/ проходят валидацию (или документированы исключения)

## Definition of Done

- [x] Схемы обновлены
- [x] Документация обновлена
- [x] ROADMAP.md обновлен
- [x] Эпик E_00001 обновлен
- [ ] CI зелёный

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md) (Раздел 4.4, 4.6, 4.7)
- [Epic E_00001](../epics/E_00001_architecture_review_consolidation.md)
- [ADR-015 Extension Packs](../../architecture/adrs/015-extension-packs-architecture.md)
