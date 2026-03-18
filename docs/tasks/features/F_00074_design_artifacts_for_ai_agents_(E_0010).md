---
id: F_00074
title: Дизайн-артефакты для ИИ-агентов в UI-манифесте
status: done
owner: @todo
epic: E_0010
area: game-manifest
tags: [priority:P1, type:feature, risk:med, effort:M, area:sdk]
links:
  - docs/architecture/adrs/016-design-artifacts-in-ui-manifest.md
  - docs/architecture/adrs/013-manifest-text-anchors-and-ui-split.md
  - docs/architecture/schemas/ui-manifest.schema.json
  - docs/tasks/content-packs/CP_00074_design_artifacts_for_ai_agents.yaml
---

# FEATURE: Дизайн-артефакты для ИИ-агентов в UI-манифесте

## Оглавление

- [Контекст и цели](#контекст-и-цели)
- [Объём](#объём)
- [Задачи](#задачи)
- [Acceptance Criteria](#acceptance-criteria)
- [Definition of Done](#definition-of-done)
- [Ссылки](#ссылки)

## Контекст и цели

Платформа Cubica ориентирована на разработку игр с помощью ИИ-агентов (ИИ-агент — автономная программа на базе большой языковой модели, способная выполнять сложные задачи: генерация кода, редактирование дизайна, анализ изображений).

Текущая архитектура UI-манифеста (ADR-013) содержит секцию `layouts` для макетов, но она недостаточна для эффективной работы ИИ-агентов:

- Нет разделения на типы артефактов (concepts, wireframes, mockups, assets)
- Нет семантических описаний элементов на изображениях
- Нет связей между артефактами для отслеживания эволюции дизайна
- Описания встроены в манифест, что приводит к его раздуванию

**Цель:** Внедрить архитектуру хранения дизайн-артефактов с детальными JSON-описаниями, оптимизированную для работы ИИ-агентов.

**Ключевые возможности после реализации:**

1. ИИ-агент может точно понять структуру и элементы макета по JSON-описанию
2. ИИ-агент может генерировать или модифицировать изображения, используя сохранённые промпты
3. ИИ-агент может отследить эволюцию дизайна от концепта до финального asset
4. ИИ-агент может извлечь style-токены для консистентной генерации UI-кода

## Объём

### In scope

- Разработка JSON Schema для описания дизайн-артефакта (`design-artifact.schema.json`)
- Разработка JSON Schema для истории версий (`design-history.schema.json`)
- Обновление JSON Schema UI-манифеста с секцией `design_artifacts`
- Документирование структуры каталогов для дизайн-артефактов
- Обновление `PROJECT_ARCHITECTURE.md` и `manifest-structure.md`

### Out of scope

- Реализация инструментов автоматической разметки изображений (CV-модели)
- Реализация CLI для валидации описаний
- Миграция существующей секции `layouts` (отдельная задача)
- Интеграция с Game Editor

## Задачи

### Схемы и спецификации

- [x] Создать `docs/architecture/schemas/design-artifact.schema.json` с секциями:
  - `image` — параметры изображения
  - `generation` — промпты и параметры генерации
  - `regions` — семантическая разметка зон
  - `style_tokens` — дизайн-токены
  - `meta` — метаданные
- [x] Создать `docs/architecture/schemas/design-history.schema.json` для:
  - Реестра артефактов с версиями
  - Графа связей между артефактами
- [x] Обновить `docs/architecture/schemas/ui-manifest.schema.json`:
  - Добавить секцию `design_artifacts`
  - Добавить поле `design_artifact_id` в screens/components

### Документация

- [x] Обновить `docs/architecture/schemas/manifest-structure.md`:
  - Добавить раздел про дизайн-артефакты
  - Описать структуру каталогов
  - Привести примеры использования
- [x] Обновить `docs/architecture/PROJECT_ARCHITECTURE.md`:
  - В разделе 2.3 добавить описание дизайн-артефактов
  - Добавить ссылку на ADR-016
- [x] Создать примеры в `docs/architecture/schemas/examples/`:
  - `design-artifact-concept.json`
  - `design-artifact-mockup.json`
  - `design-history.json`

### Пилотное применение (Antarctica)

- [x] Создать структуру `games/antarctica/design/`:
  - `design-history.json`
  - `references/`
  - `concepts/`
  - `flowcharts/`
  - `wireframes/`
  - `storyboards/`
  - `mockups/`
  - `assets/`

## Acceptance Criteria

- [x] Созданы и валидны JSON Schema для `design-artifact` и `design-history`
- [x] UI-манифест расширен секцией `design_artifacts` с поддержкой `source_ref`
- [x] Документация содержит:
  - Описание всех 7 типов артефактов (reference, concept, flowchart, wireframe, storyboard, mockup, asset)
  - Структуру JSON-описания с объяснением каждой секции
  - Примеры для каждого типа артефакта
  - Описание связей между артефактами (inspires, structures, animates, refines, extracts)

## Definition of Done

- [x] ADR-016 утверждён (статус: Accepted)
- [x] Все JSON Schema проходят валидацию (JSON Schema Draft-07)
- [x] Обновлена документация:
  - [x] `PROJECT_ARCHITECTURE.md`
  - [x] `manifest-structure.md`
- [x] ROADMAP.md обновлён
- [x] Эпик E_0010 содержит ссылку на эту фичу

## Ссылки

- [ADR-016: Дизайн-артефакты для ИИ-агентов](../../architecture/adrs/016-design-artifacts-in-ui-manifest.md)
- [ADR-013: Текстовые якоря и разделение манифестов](../../architecture/adrs/013-manifest-text-anchors-and-ui-split.md)
- [ADR-009: Centralized Asset Management](../../architecture/adrs/009-asset-management-strategy.md)
- [Текущая схема UI-манифеста](../../architecture/schemas/ui-manifest.schema.json)
- [Схема design-artifact](../../architecture/schemas/design-artifact.schema.json)
- [Схема design-history](../../architecture/schemas/design-history.schema.json)
- [Эпик E_0010](../epics/E_0010_game_manifest_architecture.md)
- [ExecPlan CP_00074](../content-packs/CP_00074_design_artifacts_for_ai_agents.yaml)
