---
id: F_00032
title: View Adapters Deployment Architecture
status: done
owner: @todo
epic: E_0030
area: backend
tags: [priority:P2, type:feature]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - docs/architecture/adrs/006-view-adapters-architecture.md
---

# FEATURE: View Adapters Deployment Architecture

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты](#артефакты)

## Цели
- [x] Определить архитектурный паттерн развертывания адаптеров (Telegram, Discord, Web Socket Gateway).
- [x] Спроектировать протокол обмена сообщениями между Router и Adapters (gRPC, HTTP, Queue?).
- [x] Обеспечить возможность горизонтального масштабирования адаптеров независимо от ядра.

## Scope
- In scope:
  - Сравнение вариантов: Monolith (модули внутри Router) vs Microservices vs Sidecars.
  - Диаграмма потоков данных (Data Flow) для входящих (User Action) и исходящих (View Command) сообщений.
  - Вопросы аутентификации (где проверяется токен: в адаптере или роутере?).
- Out of scope:
  - Реализация конкретных адаптеров (Telegram Bot API и т.д.).

## User-Stories--Задачи
- [x] Как архитектор, я хочу, чтобы падение Telegram-адаптера не влияло на работу Web-клиентов.
- [x] Как разработчик, я хочу иметь простой способ добавить новый канал (например, Slack), написав минимальный код адаптера.
- [x] Как DevOps, я хочу иметь возможность деплоить обновления адаптеров без простоя основного движка.

## Acceptance-Criteria
- [x] Выбран паттерн развертывания (обоснование в ADR).
- [x] Создана диаграмма развертывания (Deployment Diagram).
- [x] Описан интерфейс взаимодействия между Router и Adapter.

## Definition-of-Done
- [x] Создан документ дизайна или ADR.
- [x] Обновлен `PROJECT_ARCHITECTURE.md` (раздел Backend-сервисы).

## Артефакты
- Документ: `docs/architecture/backend/view-adapters.md`.
