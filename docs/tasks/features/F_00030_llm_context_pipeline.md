---
id: F_00030
title: LLM Context Pipeline Architecture
status: done
owner: @todo
epic: E_0030
area: backend/game-engine
tags: [priority:P1, type:feature]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - docs/architecture/adrs/004-llm-context-pipeline.md
---

# FEATURE: LLM Context Pipeline Architecture

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты](#артефакты)

## Цели
- [x] Спроектировать архитектуру пайплайна подготовки контекста для LLM (Context Management Pipeline).
- [x] Реализовать разделение состояния на `public` (клиент) и `secret` (движок/мастер).
- [x] Внедрить стратегию управления памятью: Sliding Window + Smart Summarization (автогенерация правил суммаризации).
- [x] Определить роль Game Editor в генерации служебных промптов для суммаризации.

## Scope
- In scope:
  - Дизайн компонента "Context Builder" / "State Pruner".
  - Структура манифеста для конфигурации контекста (`engine.context`, `engine.memory`).
  - Стратегия работы с историей: скользящее окно + автогенерируемая суммаризация.
  - Требования к Game Editor: процесс "Game Analysis" при публикации для создания инструкций суммаризации.
- Out of scope:
  - Полная реализация Game Editor (только требования к анализу).
  - Выбор конкретной модели LLM.

## User-Stories--Задачи
- [x] Как архитектор, я хочу иметь механизм фильтрации (Whitelist), чтобы в LLM попадали только релевантные данные.
- [x] Как автор игры, я хочу, чтобы платформа сама создавала правила суммаризации истории, анализируя мою игру, чтобы я не писал сложные промпты вручную.
- [x] Как разработчик Engine, я хочу четко разделять `public` и `secret` данные, чтобы не отправить игроку скрытую информацию.
- [x] Как системный аналитик, я хочу видеть диаграмму потоков данных от "User Action" до "LLM Response".

## Acceptance-Criteria
- [x] Зафиксирован ADR с решениями по `public/secret` стейту и стратегии суммаризации.
- [x] Создана схема пайплайна: Input -> History Manager (Window/Summary) -> State Pruner (Whitelist) -> Prompt Template -> LLM.
- [x] В схеме манифеста (`game-manifest.schema.json`) обновлена структура `state` (public/secret) и добавлен блок `engine.memory`.
- [x] Описан процесс "Game Analysis" в Game Editor.

## Definition-of-Done
- [x] Подготовлен документ дизайна `docs/architecture/engine/llm-context-pipeline.md`.
- [x] Обновлен `PROJECT_ARCHITECTURE.md`.
- [x] Создан ADR-004.

## Артефакты
- Документ: `docs/architecture/engine/llm-context-pipeline.md`.
- ADR: `docs/architecture/adrs/004-llm-context-pipeline.md`.
