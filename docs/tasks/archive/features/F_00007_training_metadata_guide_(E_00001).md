---
id: F_00007
title: Training Metadata Usage Guide
status: planned
owner: @claude-code
epic: E_00001
area: architecture
tags: [priority:P2, type:doc]
links:
  - docs/architecture/reviews/2026-01-13-architecture-review-comprehensive.md
  - docs/architecture/adrs/012-training-metadata.md
---

# FEATURE: Training Metadata Usage Guide

## Контекст и цели

По результатам архитектурного ревью от 2026-01-13 выявлено отсутствие примеров использования обучающих метаданных (P2):

- ADR-012 описывает структуру training metadata, но нет примеров использования
- Неясно, как компетенции отображаются в UI
- Неясно, как Game Engine использует методические материалы
- Нет интеграции с Game Catalog (поиск по компетенциям)

**Цели:**
- [ ] Создать руководство по использованию training metadata
- [ ] Предоставить примеры интеграции с UI и Engine

## Объём

**In scope:**
- Создание `docs/architecture/training-metadata-usage-guide.md`
- Примеры отображения компетенций в UI
- Примеры использования методических материалов движком
- Примеры аналитических отчетов

**Out of scope:**
- Реализация UI компонентов
- Реализация аналитической системы
- Интеграция с Game Catalog

## Задачи

- [ ] **Шаг 1: Создать training-metadata-usage-guide.md**
  - [ ] Обзор структуры training metadata по ADR-012
  - [ ] Примеры `meta.training.competencies` с описанием
  - [ ] Примеры `meta.training.format` (single, single_team, multi)
  - [ ] Примеры `assets.methodology` (participants, facilitators)

- [ ] **Шаг 2: Документировать UI интеграцию**
  - [ ] Пример компонента CompetencyBadge
  - [ ] Пример экрана GameInfo с компетенциями
  - [ ] Пример карточки игры в каталоге

- [ ] **Шаг 3: Документировать Engine интеграцию**
  - [ ] Как Engine использует methodology для подсказок
  - [ ] Как Engine формирует feedback на основе компетенций
  - [ ] Как Engine генерирует отчеты

- [ ] **Шаг 4: Документировать аналитику**
  - [ ] Структура аналитического отчета по компетенциям
  - [ ] Пример JSON с результатами сессии
  - [ ] Интеграция с Metadata DB

## Acceptance Criteria

- [ ] training-metadata-usage-guide.md содержит полные примеры
- [ ] Документированы все поля из ADR-012
- [ ] Примеры UI интеграции наглядны
- [ ] Примеры Engine интеграции понятны

## Definition of Done

- [ ] Руководство создано
- [ ] Примеры документированы
- [ ] ADR-012 содержит ссылку на guide
- [ ] ROADMAP.md обновлен
- [ ] Эпик E_00001 обновлен
- [ ] CI зелёный

## Ссылки

- [Комплексное архитектурное ревью 2026-01-13](../../architecture/reviews/2026-01-13-architecture-review-comprehensive.md) (Раздел 5.1)
- [Epic E_00001](../epics/E_00001_architecture_review_consolidation.md)
- [ADR-012 Training Metadata](../../architecture/adrs/012-training-metadata.md)
- [F_00023 Antarctica Training Metadata](F_00023_antarctica_training_metadata_and_methodology.md)
