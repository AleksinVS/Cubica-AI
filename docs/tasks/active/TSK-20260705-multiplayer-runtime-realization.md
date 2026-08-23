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

in_progress

Status note: архитектура ADR-059 принята 2026-07-06; S8 и S9 приняты локально.
Реализация S10/GSR-050 private-invite network v1 существует, но production two-browser E2E
и primary visual acceptance ещё ожидаются. Полный runtime result — 395 pass /
2 skipped / 0 fail, contracts-session — 16/16, player-web — 332/332,
typechecks/API contract gate — green, disposable PostgreSQL restart — 1/1.
Каталог и публичная публикация остаются отдельными продуктовыми воротами.
ADR-058; S10 proof ограничен Estate Race двумя browser contexts по GSR-050.
Оставшиеся network gates — production two-browser E2E как финальная проверка SSE
и primary visual acceptance; Phase 7 — отдельный документационный closeout,
включая синхронизацию TSK-20260518 и debt-log.

## Understanding

Работа понята так: реализовать принятую модель мультиплеера (ADR-011:
immutable journal подтверждённых фактов `session_events`, `state_version`,
последовательная обработка, broadcast) внутри
модульного монолита `runtime-api` по решениям ADR-059: PostgreSQL-хранилище
сессий как предусловие, immutable session-owned participants, creation-only
private invites и SSE с последующим аутентифицированным полным GET/resync.
Игровые манифесты при этом не меняются.

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
2. S8 создаёт только `human`/`local`; `kind:"agent"` — граница S9, network join
   и reconnect — граница S10.
3. Канонические actor-scoped projection и доступность действий переиспользуются;
   `seatId` — стабильное место, `playerId` — actor/key в `state.players`.
4. S10 network delivery существует в bounded v1; production two-browser E2E и
   primary visual acceptance остаются pending и не считаются доказанными текущим
   статусом.

## Target State

1. Сессии и события — в PostgreSQL по ADR-005/ADR-011; `InMemorySessionStore`
   остаётся только как test double.
2. Session-owned participants: `seatId:string`, `playerId:string`,
   `kind: human|agent`, `joinState: "local"|"private-invite"`; S8 сам создавал
   только `human`/`local`, без изменения game state/manifest.
3. Действия проходят через последовательную HTTP-транзакцию с блокировкой строки
   сессии PostgreSQL через `SELECT FOR UPDATE NOWAIT`; `session_events` — только
   immutable journal подтверждённых фактов. `{{actor}}` в сетевом режиме — только
   из аутентифицированного участника.
4. SSE endpoint: подписка по сессии+credential, передающая только
   `{stateVersion,lastEventSequence}`; клиент получает полную
   аутентифицированную проекцию через GET/resync.
5. `player-web` умеет: занять место по ссылке-приглашению, играть свой ход,
   получать чужие ходы пушем, реконнект с полной ресинхронизацией.

## Scope

- Схема БД + миграции (`game_sessions`, `session_events`), конфигурация подключения.
- Session store на PostgreSQL; выбор и снятие долга `InMemorySessionStore`
  (поглощает `TSK-20260518-session-persistence-hardening` — отметить в нём).
- Participants API + creation-only invite handoff (OpenAPI update по ADR-051);
  invite lifecycle/table в v1 исключены.
- Последовательные HTTP-команды с блокировкой строки сессии через
  `SELECT FOR UPDATE NOWAIT`; queue transport, worker и жизненный цикл очереди
  (таймауты/попытки) в текущий scope не входят и остаются будущим решением.
- SSE delivery module + authenticated full GET/resync.
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

### Phase 1. PostgreSQL session store

1. Миграции `game_sessions` (+`state_version`, `last_event_sequence`) и
   `session_events` по ADR-005/ADR-011.
2. Store-реализация, конфигурация окружения, локальный docker-compose для БД.
3. Все текущие тесты зелёные на новом store; InMemory — test double.

### Phase 2. Participants и invite handoff

1. S8: принять session-owned элемент `seatId`/`playerId`/`kind`/`joinState`,
   создавать только `human`/`local`, переиспользовать actor-scoped projection и
   available actions; агентские места передать S9.
2. Pre-production destructive cutover: удалить `game_sessions` и каскадные
   session-owned principals/receipts/events/schedules; `game_bundles` сохранить.
   Backfill и внешние DB-действия не выполняются.
3. Обновление OpenAPI + контрактные тесты; creation-only invite handoff входит
   в S10, а invite lifecycle/table исключены из v1.

### Phase 3. Последовательные HTTP-команды и блокировка строки

1. HTTP-команда в транзакции захватывает строку сессии через
   `SELECT FOR UPDATE NOWAIT`, затем применяет изменение и записывает
   `session_events` (state + version + status события).
2. Резолвинг `{{actor}}` из участника; отклонение действий не в свой ход
   существующими guard-механизмами.
3. Тесты конкуренции: два одновременных HTTP-действия → одно получает блокировку,
   второе управляемо отклоняется по `NOWAIT`; queue transport, worker и их
   таймауты/попытки находятся вне текущей фазы и scope и могут быть рассмотрены
   отдельным будущим решением.

### Phase 4. SSE delivery

1. Endpoint подписки, аутентификация credential, одна post-commit notification
   с версией и sequence после committed session mutation.
2. Полный аутентифицированный GET/resync после сигнала SSE.

### Phase 5. Персональные проекции

1. `viewerPlayerId` в строителе проекции; фильтрация по `visibility` (ADR-058);
   тесты на отсутствие утечки `secret`/чужих приватных полей/порядка колод.

### Phase 6. Интеграция player-web и e2e

1. Подписка, применение версий, реконнект-ресинхронизация, экран «ожидание хода».
2. Bounded Estate Race proof (два browser context) как финальная проверка SSE:
   host/private guest handoff,
   one authoritative setup + active actor action, peer SSE-triggered full GET,
   spoof rejection, stale-version rejection, privacy, page reload/resync.

### Phase 7. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, debt-log
   (`InMemorySessionStore`), Handoff Log.

## Acceptance

- Estate Race двумя browser contexts: host/private guest handoff, authoritative
  setup и active actor action, peer SSE-triggered full GET, spoof/stale-version
  rejection, privacy и page reload/resync.
- Disposable PostgreSQL restart proof остаётся отдельной проверкой store; browser
  restart continuation не является требованием v1.
- Тест конкуренции проходит; replay-тест пакета ADR-058 проходит на
  PostgreSQL-хранилище.
- Никаких game-specific веток; `verify:canonical` зелёный; OpenAPI drift check
  зелёный.

## Validation

```text
cd services/runtime-api && npm run typecheck && npm test
npm run verify:canonical
npx playwright test  # final SSE verification: bounded Estate Race two-context proof (pending)
```

## Risks

- Первая реальная БД в контуре: миграции/локальная среда могут затормозить
  смежные задачи — держать docker-compose и CI-настройку в Phase 1, не позже.
- SSE и production two-browser E2E требуют финальной проверки в реальном
  браузерном контуре; primary visual acceptance также остаётся pending.
- Поглощение `TSK-20260518-session-persistence-hardening` требует явной
  синхронизации статусов, иначе появится двойной трекинг одного долга.

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
- 2026-08-23: GSR-050/S10 private-invite network v1 получил реализацию в границе ADR-059:
  runtime 395 pass / 2 skipped / 0 fail, contracts-session 16/16, player-web
  332/332, typechecks/API contract gate green, disposable PostgreSQL restart
  1/1. Production two-browser E2E и primary visual acceptance остаются pending;
  production two-browser E2E является финальной проверкой SSE; Phase 7 остаётся
  отдельным документационным closeout с синхронизацией TSK-20260518 и debt-log.
  Catalog/publication не входят в этот статус.
