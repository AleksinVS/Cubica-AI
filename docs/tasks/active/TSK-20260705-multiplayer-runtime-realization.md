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

awaiting_approval

Status note: архитектура ADR-059 принята 2026-07-06; S8 реализован и принят
2026-08-13; S9 интегрирован в `main` 2026-08-23. S10 заблокирован до решения PM
о lifecycle приглашения и места, аутентификации WebSocket и точном
snapshot/resync-протоколе. Рекомендация и альтернативы вынесены в
`docs/tasks/artifacts/TSK-20260705-monopoly-classic-game/s10-private-invite-architecture-decision.md`.
Сквозное доказательство (Phase 6) требует фикстурной игры
`games/dice-track/` из `TSK-20260705-board-game-platform-capabilities`.

## Understanding

Работа понята так: реализовать принятую модель мультиплеера (ADR-011: очередь
`session_events`, `state_version`, последовательная обработка, broadcast) внутри
модульного монолита `runtime-api` по решениям ADR-059: PostgreSQL-хранилище
сессий как предусловие, модель участников с join-токенами, WebSocket-доставка
персональных проекций. Игровые манифесты при этом не меняются.

## Architecture Source

- `docs/architecture/adrs/059-multiplayer-realization-in-modular-monolith.md` (Accepted)
- ADR-005 (session persistence), ADR-011 (модель мультиплеера), ADR-017
  (модульный монолит), ADR-019 (player content boundary), ADR-033 (portal
  binding), ADR-051 (current API contract), ADR-058 (playersTemplate/turn)
- `docs/architecture/backend/session-persistence.md`, `docs/architecture/backend/redis-usage.md`
- `docs/architecture/board-game-platform-design.md` §9 — обязательные правила
  работы исполнителя (фазовая дисциплина, запреты, чек-лист среза)

## Why

Сетевой мультиплеер — вторая модель доставки настольных игр и заявленная
возможность платформы (`PROJECT_OVERVIEW.md`). S8 сначала закрепляет общую
session-owned модель участников для локальной доставки; сетевой join/reconnect
остаётся S10.

## Current Findings

1. S8 не переносит участников в game state или manifest: session-owned модель
   имеет публичный элемент `seatId:string`, `playerId:string`,
   `kind:"human"|"agent"`, `joinState:"local"`.
2. S8 создаёт `human`/`local`, а принятый S9 добавляет локальный
   `kind:"agent"`; network join и reconnect остаются границей S10.
3. Канонические actor-scoped projection и доступность действий переиспользуются;
   `seatId` — стабильное место, `playerId` — actor/key в `state.players`.
4. Остальные WebSocket, durable-session и network acceptance criteria остаются
   последующими фазами и не считаются доказанными текущим статусом.
5. ADR-059 не фиксирует срок/одноразовость join-токена, допустимый переход
   `joinState`, браузерную WebSocket-аутентификацию и точные кадры resync. Это
   публичные и защитные границы, требующие решения PM до реализации S10.

## Target State

1. Сессии и события — в PostgreSQL по ADR-005/ADR-011; `InMemorySessionStore`
   остаётся только как test double.
2. Session-owned participants: `seatId:string`, `playerId:string`,
   `kind: human|agent`, `joinState: "local"`; S8 создаёт только human/local,
   без изменения game state/manifest.
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
- Вторая обслуживающая реплика `runtime-api` — вне области; предусловие её
  появления (фиксируется здесь, чтобы не потерять): перевод ограниченного
  квотного контроллера ADR-086 с памяти одного процесса на общий атомарный
  backend.

## Execution Plan

### Phase 0. Принятие ADR-059

1. Ревью/принятие; решить судьбу `TSK-20260518-session-persistence-hardening`
   (поглощение фазой 1).

### Phase 1. PostgreSQL session store — done

1. Миграции `game_sessions` (+`state_version`, `last_event_sequence`) и
   `session_events` по ADR-005/ADR-011.
2. Store-реализация, конфигурация окружения, локальный docker-compose для БД.
3. Все текущие тесты зелёные на новом store; InMemory — test double.

### Phase 2. Participants — S8 done; join-токены ожидают S10

1. S8: принять session-owned элемент `seatId`/`playerId`/`kind`/`joinState`,
   создавать только `human`/`local`, переиспользовать actor-scoped projection и
   available actions; агентские места передать S9.
2. Pre-production destructive cutover: удалить `game_sessions` и каскадные
   session-owned principals/receipts/events/schedules; `game_bundles` сохранить.
   Backfill и внешние DB-действия не выполняются.
3. Обновление OpenAPI + контрактные тесты; join-токены и network lifecycle
   остаются S10.

### Phase 3. Последовательная HTTP-обработка — done

1. Запись действий в `session_events`, воркер с advisory-lock, транзакционное
   применение (state + version + status события).
2. Резолвинг `{{actor}}` из участника; отклонение действий не в свой ход
   существующими guard-механизмами.
3. Тесты конкуренции: два одновременных действия → последовательное применение,
   проигравшее отклонено управляемо.

### Phase 4. WebSocket delivery

1. **Architecture gate — основной агент, Sol high, высокий риск:** после
   решения PM уточнить ADR-059 и зафиксировать lifecycle invite/claim,
   realtime-аутентификацию и full-snapshot протокол. До этого пункта реализация
   S10 не начинается.
2. **Contracts — Luna medium, ограниченный schema-first блок:** OpenAPI,
   JSON Schema, генерируемые типы и негативные contract tests; основной агент
   проверяет публичную границу и generated drift.
3. **Runtime invite/claim — Luna high, security-sensitive реализация по уже
   принятому контракту:** hash-only токены, атомарное занятие места, principal
   scope и PostgreSQL tests. Основной агент выполняет security review.
4. **WebSocket delivery — Luna high:** аутентификация коротким ticket,
   персональный полный snapshot после commit, версии и reconnect. Gameplay
   commands остаются в HTTP.

### Phase 5. Персональные проекции — done в S8/S9, переиспользовать

1. `viewerPlayerId` в строителе проекции; фильтрация по `visibility` (ADR-058);
   тесты на отсутствие утечки `secret`/чужих приватных полей/порядка колод.

### Phase 6. Интеграция player-web и e2e

1. **Player Web — Luna medium:** занятие места по ссылке, BFF handoff,
   подписка, применение версий, реконнект-ресинхронизация и экран ожидания хода.
2. **Независимая критика — Luna high:** негативные пути token replay,
   actor spoofing, stale version, disconnect/restart; исправления выполняет
   Luna в том же ограниченном контуре, окончательную оценку делает основной
   агент.
3. **Приёмка — основной агент, Sol high:** Playwright с двумя контекстами
   браузера, партия `games/dice-track/` от подключения до победителя и
   restart/resync на PostgreSQL.

### Phase 7. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, debt-log
   (`InMemorySessionStore`), Handoff Log.
2. Упростить итоговую схему: подтвердить отсутствие отдельного gateway,
   persistent presence, WebSocket gameplay commands, delta-sync и второго
   владельца состояния; любое расширение вернуть на решение PM.

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

- Ошибка в claim transaction способна выдать одно место двум principal или
  оставить использованный токен действующим; обязательны PostgreSQL race и
  replay tests до UI-интеграции.
- WebSocket нельзя аутентифицировать долговечным credential в URL. Принятый
  BFF handoff требует отдельного короткоживущего ticket и негативных тестов на
  replay/expiry до рассылки первого snapshot.
- Реестр соединений живёт в одном runtime-процессе и теряется при рестарте.
  Это ожидаемое поведение первого среза, поэтому restart/resync является
  обязательной приёмкой, а не последующим улучшением.

## Handoff Log

- 2026-07-05: задача создана вместе с ADR-059 (Proposed). Реализация не начата.
- 2026-07-06: ADR-059 принят владельцем проекта (Accepted 2026-07-06).
  Реализация не начата.
- 2026-08-12: S8 передан в исполнение. Session-owned участники, публичная форма
  элемента и границы S9/S10 зафиксированы.
- 2026-08-13: S8 принят после canonical contracts/OpenAPI, contracts 7/7,
  runtime session/PostgreSQL 42/42, player-web 50/50 и disposable PostgreSQL
  restart roundtrip 1/1. Pre-release cutover сохраняет immutable bundles и
  был проверен только на одноразовой локальной базе; полный CMT suite не
  является частью этой приёмки.
- 2026-08-23: S9 интегрирован в актуальный `main`. Репозиторная разведка S10
  подтвердила готовность PostgreSQL, principals, actor-scoped projection и
  HTTP command path, но обнаружила недоопределённые public/security границы
  join-токена, seat claim и WebSocket. Подготовлен пакет решения PM; S10
  остановлен на architecture gate без изменения контрактов.
