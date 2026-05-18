---
id: F_00012
title: Абстрактный протокол представления (Abstract View Protocol)
status: done
owner: @todo
epic: E-25-00010
area: game-platform
tags: [priority:P1, type:feature]
links:
  - docs/tasks/epics/E_0010_game_manifest_architecture.md
  - docs/architecture/adrs/002-abstract-view-protocol.md
  - docs/architecture/protocols/mvp-interaction.md
---

# FEATURE: Абстрактный протокол представления (Abstract View Protocol)

## Контекст и цели
Для обеспечения независимости игровой логики (Presenter) от реализации интерфейса (Web, Telegram, Unity) необходимо внедрить слой абстракции. Presenter не должен вызывать методы UI напрямую, а должен отправлять абстрактные команды через унифицированный шлюз.

Этот подход позволяет:
1. Использовать одну и ту же бизнес-логику для разных клиентов.
2. Управлять асинхронностью (анимациями) через Promise-based интерфейс.
3. Легко тестировать логику без UI.

## Цели
- [x] Определить интерфейс `IViewGateway` с единым методом `dispatch`.
- [x] Определить структуры данных `ViewCommand` и `ViewResponse`.
- [x] Описать правила трансляции абстрактных команд в конкретные действия UI (анимации, сообщения).
- [x] Обновить документацию протоколов.

## Объём

In scope:
- TypeScript интерфейсы для Gateway, Command, Response.
- Описание паттерна Command + Promises.
- Примеры реализации "View как Микросервис" (получение команды -> трансляция по манифесту -> действие).

Out of scope:
- Реализация конкретных адаптеров (Web/Telegram) — это отдельные задачи.
- Написание кода движка анимаций.

## Задачи
- [x] Создать ADR с обоснованием выбора Command Pattern + Promises (ADR-002).
- [x] Обновить `docs/architecture/protocols/mvp-interaction.md`, добавив секцию про Abstract View Layer.
- [x] Определить JSON-схемы для команд View (аналогично ClientRequest, но в обратную сторону).
- [x] Описать примеры обработки долгих действий (Long-running actions) через этот протокол.

## Acceptance Criteria
- [x] В документации зафиксирован интерфейс `dispatch(command): Promise<Response>`.
- [x] Описан формат `ViewCommand` и `ViewResponse`.
- [x] Приведен пример маппинга "Игровая команда" -> "Анимация" -> "Завершение".

## Definition of Done
- [x] Документация обновлена.
- [x] Feature-задача связана с Эпиком.
