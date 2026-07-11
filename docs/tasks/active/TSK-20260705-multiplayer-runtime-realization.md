# TSK-20260705-multiplayer-runtime-realization: Реализация сетевого мультиплеера в runtime-api

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

planned

Status note: архитектура ADR-059 принята 2026-07-06, но отдельного разрешения на исполнение всего плана нет. Нужные фазы активируются игровым срезом или приоритетом PM. Фазы 1–2 не зависят от пакета настольных механик.
ADR-058; сквозное доказательство (Phase 6) требует фикстурной игры
`games/dice-track/` из `TSK-20260705-board-game-platform-capabilities`.

## Understanding

Работа понята так: реализовать принятую модель мультиплеера (ADR-011: очередь
`session_events`, `state_version`, последовательная обработка, broadcast) внутри
модульного монолита `runtime-api` по решениям ADR-059: PostgreSQL-хранилище
сессий как предусловие, модель участников с join-токенами, WebSocket-доставка
персональных проекций. Игровые манифесты при этом не меняются.

## Architecture Source

- `docs/architecture/adrs/059-multiplayer-realization-in-modular-monolith.md` (Proposed)
- ADR-005 (session persistence), ADR-011 (модель мультиплеера), ADR-017
  (модульный монолит), ADR-019 (player content boundary), ADR-033 (portal
  binding), ADR-051 (current API contract), ADR-058 (playersTemplate/turn)
- `docs/architecture/backend/session-persistence.md`, `docs/architecture/backend/redis-usage.md`
- `docs/architecture/board-game-platform-design.md` §9 — обязательные правила
  работы исполнителя (фазовая дисциплина, запреты, чек-лист среза)

## Why

Сетевой мультиплеер — вторая модель доставки настольных игр и заявленная
возможность платформы (`PROJECT_OVERVIEW.md`). Сейчас его нет совсем: сессии в
памяти одного процесса, один `playerId`, обновления только ответом на своё
действие.

## Current Findings

1. `services/runtime-api/src/modules/session/inMemorySessionStore.ts` —
   единственное хранилище сессий (долг `TSK-20260518-session-persistence-hardening`).
2. `session.service.ts` принимает один необязательный `playerId`; модели
   участников нет.
3. WebSocket/стриминга в `runtime-api` нет — клиент получает состояние только
   ответом на собственный HTTP-запрос.
4. Таблиц `game_sessions`/`session_events` нет — БД в контуре пока не используется.
5. Персональная проекция не нужна была ранее (один игрок) — строитель
   проекции не принимает наблюдателя.

## Target State

1. Сессии и события — в PostgreSQL по ADR-005/ADR-011; `InMemorySessionStore`
   остаётся только как test double.
2. Модель participants: места из `config.players`, join-токены, `kind: human|agent`,
   хотсит как `joinState: "local"`.
3. Действия проходят через `session_events` с последовательной обработкой и
   advisory-lock на сессию; `{{actor}}` в сетевом режиме — только из
   аутентифицированного участника.
4. WebSocket endpoint: подписка по сессии+токену, сообщения с `state_version`,
   `last_event_sequence` и персональной проекцией; протокол описан схемой в
   `packages/contracts/session` + протокол-док рядом с OpenAPI.
5. `player-web` умеет: занять место по ссылке-приглашению, играть свой ход,
   получать чужие ходы пушем, реконнект с полной ресинхронизацией.

## Scope

- Схема БД + миграции (`game_sessions`, `session_events`), конфигурация подключения.
- Session store на PostgreSQL; выбор и снятие долга `InMemorySessionStore`
  (поглощает `TSK-20260518-session-persistence-hardening` — отметить в нём).
- Participants/join API (+OpenAPI update по ADR-051).
- Обработчик очереди, блокировки, жизненный цикл событий (таймауты/попытки).
- WebSocket delivery module + контракт сообщений.
- Параметр наблюдателя в строителе player-facing проекции (ADR-019 + ADR-058 §2.3).
- Интеграция `player-web` (подписка, версии, реконнект) и e2e-доказательство.

## Non-Goals

- Пакет игровых возможностей ADR-058 (отдельная задача).
- Агентские места (ADR-060, отдельная задача) — здесь только поле `kind`.
- Портальный UI приглашений (ADR-033 launch surface — задача портала); здесь
  только runtime-API токенов.
- Telegram/др. каналы, Redis-кэширование, горизонтальное масштабирование
  воркеров (модель это допускает, реализация — позже).
- Дельта-синхронизация при реконнекте (полная ресинхронизация достаточна).

## Execution Plan

### Phase 0. Принятие ADR-059

1. Ревью/принятие; решить судьбу `TSK-20260518-session-persistence-hardening`
   (поглощение фазой 1).

### Phase 1. PostgreSQL session store

1. Миграции `game_sessions` (+`state_version`, `last_event_sequence`) и
   `session_events` по ADR-005/ADR-011.
2. Store-реализация, конфигурация окружения, локальный docker-compose для БД.
3. Все текущие тесты зелёные на новом store; InMemory — test double.

### Phase 2. Participants и join-токены

1. Контракты и API: создание сессии с местами, выдача токенов, занятие места,
   `kind: human|agent`, хотсит-режим `local`.
2. Обновление OpenAPI + контрактные тесты.

### Phase 3. Очередь и последовательная обработка

1. Запись действий в `session_events`, воркер с advisory-lock, транзакционное
   применение (state + version + status события).
2. Резолвинг `{{actor}}` из участника; отклонение действий не в свой ход
   существующими guard-механизмами.
3. Тесты конкуренции: два одновременных действия → последовательное применение,
   проигравшее отклонено управляемо.

### Phase 4. WebSocket delivery

1. Endpoint подписки, аутентификация токеном, рассылка после каждого
   применённого события.
2. Схема сообщений в `packages/contracts/session`; протокол-док.

### Phase 5. Персональные проекции

1. `viewerPlayerId` в строителе проекции; фильтрация по `visibility` (ADR-058);
   тесты на отсутствие утечки `secret`/чужих приватных полей/порядка колод.

### Phase 6. Интеграция player-web и e2e

1. Подписка, применение версий, реконнект-ресинхронизация, экран «ожидание хода».
2. E2E (Playwright, два контекста браузера): партия `games/dice-track/` по сети
   от начала до победителя.

### Phase 7. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, debt-log
   (`InMemorySessionStore`), Handoff Log.

## Acceptance

- Партия `dice-track` двумя браузерами по сети: ходы доставляются пушем,
  `{{actor}}` подделать нельзя (действие за чужое место → управляемая ошибка).
- Рестарт `runtime-api` посреди партии: клиенты реконнектятся и продолжают
  с последнего зафиксированного состояния.
- Тест конкуренции проходит; replay-тест пакета ADR-058 проходит на
  PostgreSQL-хранилище.
- Никаких game-specific веток; `verify:canonical` зелёный; OpenAPI drift check
  зелёный.

## Validation

```text
cd services/runtime-api && npm run typecheck && npm test
npm run verify:canonical
npx playwright test  # двухбраузерный e2e dice-track
```

## Risks

- Первая реальная БД в контуре: миграции/локальная среда могут затормозить
  смежные задачи — держать docker-compose и CI-настройку в Phase 1, не позже.
- WebSocket в dev-стеке Next.js/прокси редактора: проверить проксирование в
  editor preview рано (spike в Phase 4).
- Поглощение `TSK-20260518-session-persistence-hardening` требует явной
  синхронизации статусов, иначе появится двойной трекинг одного долга.

## Handoff Log

- 2026-07-05: задача создана вместе с ADR-059 (Proposed). Реализация не начата.
- 2026-07-06: ADR-059 принят владельцем проекта (Accepted 2026-07-06).
  Реализация не начата.
