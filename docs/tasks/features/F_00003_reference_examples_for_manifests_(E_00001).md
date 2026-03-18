---
id: F_00003
title: Reference Examples for Manifests
status: done
owner: @claude-code
epic: E_00001
area: architecture
tags: [priority:P1, type:doc]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/schemas/examples/
---

# FEATURE: Reference Examples for Manifests

## Контекст и цели

По результатам архитектурного ревью от 2026-01-13 выявлено отсутствие референсных примеров, соответствующих ADR-013 (P1):

- [x] Создать пример разделённых манифестов (split-manifest)
- [x] Создать пример гибридного выполнения (hybrid-execution)
- [x] Создать пример многопользовательской игры (multiplayer-game)
- [x] Создать пример использования Extension Packs (extension-usage)

## Объём

**In scope:**
- Создание директории `docs/architecture/schemas/examples/split-manifest/`
- Создание директории `docs/architecture/schemas/examples/hybrid-execution/`
- Создание директории `docs/architecture/schemas/examples/multiplayer-game/`
- Создание директории `docs/architecture/schemas/examples/extension-usage/`
- Документация каждого примера в README.md

**Out of scope:**
- Реализация backend для примеров
- Создание UI для примеров
- Валидация примеров в CI

## Задачи

- [x] **Шаг 1: Создать split-manifest example**
  - [x] `game.manifest.json` — логический манифест с source_ref
  - [x] `ui.manifest.json` — UI-манифест для Web
  - [x] `scenario.md` — сценарий с якорями
  - [x] `README.md` — объяснение структуры

- [x] **Шаг 2: Создать hybrid-execution example**
  - [x] `game.manifest.json` — с `handler_type: "script"`
  - [x] `scripts/inventory.js` — реальная логика скрипта
  - [x] `README.md` — документация API для скриптов

- [x] **Шаг 3: Создать multiplayer-game example**
  - [x] `game.manifest.json` — с ролями, очередностью ходов, min/max players
  - [x] `README.md` — описание мультиплеерной логики

- [x] **Шаг 4: Создать extension-usage example**
  - [x] `game.manifest.json` — с секцией `extensions`
  - [x] `extensions/custom-mechanics/extension.json` — локальное расширение
  - [x] `README.md` — описание использования Extension Packs

## Acceptance Criteria

- [x] split-manifest демонстрирует разделение по ADR-013
- [x] hybrid-execution показывает работу script handlers по ADR-007
- [x] multiplayer-game соответствует ADR-011
- [x] extension-usage соответствует ADR-015
- [x] Все примеры содержат README.md с объяснением

## Definition of Done

- [x] 4 референсных примера созданы
- [x] Каждый пример документирован
- [x] ROADMAP.md обновлен
- [x] Эпик E_00001 обновлен
- [ ] CI зелёный

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md) (Раздел 4.5, 5.4, 5.5)
- [Epic E_00001](../epics/E_00001_architecture_review_consolidation.md)
- [ADR-007 Hybrid Execution](../../architecture/adrs/007-hybrid-game-engine-and-scripting.md)
- [ADR-011 Multiplayer](../../architecture/adrs/011-multiplayer-architecture.md)
- [ADR-013 Text Anchors & UI Split](../../architecture/adrs/013-manifest-text-anchors-and-ui-split.md)
- [ADR-015 Extension Packs](../../architecture/adrs/015-extension-packs-architecture.md)
