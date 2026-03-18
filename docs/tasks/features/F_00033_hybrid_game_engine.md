---
id: F_00033
title: Hybrid Game Engine & Scripting Architecture
status: done
owner: @todo
epic: E_0030
area: backend/game-engine
tags: [priority:P1, type:feature]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - docs/architecture/adrs/007-hybrid-execution-model.md
---

# FEATURE: Hybrid Game Engine & Scripting Architecture

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты](#артефакты)

## Цели
- [x] Спроектировать гибридную модель исполнения, позволяющую движку переключаться между LLM и локальным исполнением (Script/Native).
- [x] Определить механизм "Predefined Functions" для детерминированной логики (например, математика, таймеры, проверки условий).
- [x] Внедрить поддержку внешних Markdown-файлов (Rules, Scenarios) как "Source of Truth" с возможностью ссылаться на них из манифеста.

## Scope
- In scope:
  - Архитектура **Logic Router** внутри движка.
  - Типизация обработчиков событий: `handler_type: "llm" | "script"`.
  - Механизм резолвинга ссылок на `.md` файлы (`assets` в манифесте).
  - Использование JS (Sandbox) для выполнения скриптов.
- Out of scope:
  - Реализация конкретных игр с использованием гибридной модели.

## User-Stories--Задачи
- [x] Как разработчик игры, я хочу указать, что кнопка "Открыть Инвентарь" обрабатывается скриптом, чтобы это происходило мгновенно.
- [x] Как разработчик игры, я хочу хранить сценарий и правила в отдельных Markdown-файлах, чтобы их было удобно редактировать и скармливать генератору игр.
- [x] Как архитектор, я хочу, чтобы движок автоматически подгружал нужные куски правил из MD-файлов перед отправкой промпта в LLM.

## Acceptance-Criteria
- [x] Создан ADR-007, описывающий Hybrid Execution Model.
- [x] Обновлен ADR-004 с учетом Reference Resolution (подгрузка MD).
- [x] Обновлена схема манифеста (добавлена секция `assets` / `context_sources`).
- [x] Определена поддержка JS в изолированной среде (Sandbox).

## Definition-of-Done
- [x] Документация обновлена.
- [x] `PROJECT_ARCHITECTURE.md` отражает изменения.

## Артефакты
- ADR-007: Hybrid Execution Model.
- Обновленные схемы и дизайн-документы.
