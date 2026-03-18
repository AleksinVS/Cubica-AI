---
id: F_00031
title: Session State Persistence Strategy
status: done
owner: @todo
epic: E_0030
area: backend
tags: [priority:P1, type:feature]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - docs/architecture/adrs/005-session-persistence.md
---

# FEATURE: Session State Persistence Strategy

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты](#артефакты)

## Цели
- [x] Определить технологический стек и паттерны для хранения активного состояния игровых сессий.
- [x] Спроектировать механизм обработки конкурентных запросов (locking/optimistic concurrency) для поддержки Command Pattern.
- [x] Определить TTL и стратегию очистки старых сессий.

## Scope
- In scope:
  - Выбор БД для "горячего" состояния (Redis vs PostgreSQL vs In-Memory).
  - Структура хранения (ключи, JSON-blob, hash maps).
  - Механизмы блокировок для атомарности ходов.
  - Персистентность "холодного" состояния (сохранение прогресса).
- Out of scope:
  - Реализация слоя доступа к данным (DAO) — только дизайн.

## User-Stories--Задачи
- [x] Как разработчик Backend, я хочу быть уверен, что два одновременных клика пользователя не приведут к двойному списанию ресурсов (race condition).
- [x] Как DevOps, я хочу понимать требования к инфраструктуре (нужен ли Redis Cluster, требования к RAM).
- [x] Как игрок, я хочу, чтобы мой прогресс сохранялся даже при перезагрузке сервера.

## Acceptance-Criteria
- [x] Выбрана технология хранения (обоснование в ADR).
- [x] Описан алгоритм обработки `lock`/`unlock` сессии во время обработки хода.
- [x] Определена схема данных для Session State.

## Definition-of-Done
- [x] Создан раздел в архитектурной документации по `Session Persistence` и при необходимости ADR.
- [x] Обновлен `PROJECT_ARCHITECTURE.md`.

## Артефакты
- Документ: `docs/architecture/backend/session-persistence.md` и ADR.
