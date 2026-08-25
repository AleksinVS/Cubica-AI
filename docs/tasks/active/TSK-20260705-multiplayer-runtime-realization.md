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

review

Status note: архитектура ADR-059 принята 2026-07-06; S8 принят
2026-08-13, S9 интегрирован в `main` 2026-08-23. 2026-08-25 PM принял
упрощённую гибридную границу S10: одноразовое 24-часовое приглашение
атомарно заменяется долговечным participant credential в `HttpOnly` cookie;
SSE несёт только курсор версии, а полная персональная проекция заново
читается по защищённому HTTP GET. WebSocket, realtime tickets, presence, Redis и
дельты отложены. Исходное решение и аудит вариантов сохранены в
`docs/tasks/artifacts/TSK-20260705-monopoly-classic-game/s10-private-invite-architecture-decision.md`
и `docs/tasks/artifacts/TSK-20260705-monopoly-classic-game/s10-parallel-implementation-review.md`.
Сквозное доказательство (Phase 6) использует готовый Estate Race как
конкретный игровой срез и нейтральную runtime-фикстуру для общих гарантий.
Канонические OpenAPI/generated session contracts, runtime neutral in-memory
tests, disposable PostgreSQL migrations 001–006 с restart и concurrent
single-winner/replay, а также runtime и contract typechecks уже проходят.
Player Web integration, PostgreSQL restart и двухбраузерный Estate Race flow
реализованы и проверены. S10 принят для закрытой альфы: two-browser E2E прошёл
с desktop+narrow primary visual inspection; runtime — `403 pass / 3 skip`,
Player Web — `328/328` + typecheck и production build, Estate Race — `53/53`,
plugin — `37/37` + typecheck, disposable PostgreSQL integration — `2/2`,
канонические constituent gates пройдены. Задача остаётся в `review` только для
каталожных и production/content/economy/product publication ворот.
Если claim уже записан, но ответ с credential потерян, ведущий пересоздаёт
тестовый сеанс. Recoverable handoff обязателен до каталога/production. Cookie
браузера живёт 30 дней, а credential runtime durable — это операционный
residual до согласования архивирования.

## Understanding

Работа понята так: реализовать принятую модель мультиплеера (ADR-011: очередь
`session_events`, `state_version`, последовательная обработка, broadcast) внутри
модульного монолита `runtime-api` по решениям ADR-059: PostgreSQL-хранилище
сессий как предусловие, модель участников с закрытым приглашением и
аутентифицированная доставка уведомлений с полной персональной
ресинхронизацией. Приглашения, credentials и подписки принадлежат сессии
и общему runtime, а не игровому state или манифесту; игровые манифесты не меняются.

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
4. S10 выбрал одноразовый 24-часовый invite, атомарный `invited → joined`,
   долговечный participant credential и SSE cursor с полным HTTP resync.
5. Реальный provider для агентских мест, public rooms, matchmaking, spectators,
   чат, revoke/reissue приглашения, дельты и несколько runtime-реплик не входят
   в этот срез.

## Target State

1. Сессии и события — в PostgreSQL по ADR-005/ADR-011; `InMemorySessionStore`
   остаётся только как test double.
2. Session-owned participants: `seatId:string`, `playerId:string`,
   `kind: human|agent`, `joinState: local|invited|joined`; сетевое занятие места
   меняет только `joinState`, без изменения game state/manifest.
3. Действия проходят через `session_events` с последовательной обработкой и
   PostgreSQL row-level `SELECT FOR UPDATE NOWAIT` по строке сессии;
   `{{actor}}` в сетевом режиме — только из аутентифицированного участника.
4. SSE сообщает только подтверждённые `stateVersion` и `lastEventSequence`;
   клиент получает полную аутентифицированную персональную проекцию через HTTP GET
   после каждого уведомления и переподключения.
5. `player-web` умеет: занять место по ссылке-приглашению, играть свой ход,
   получать чужие ходы пушем, реконнект с полной ресинхронизацией.

## Scope

- Схема БД + миграции (`game_sessions`, `session_events`), конфигурация подключения.
- Session store на PostgreSQL; выбор и снятие долга `InMemorySessionStore`
  (поглощает `TSK-20260518-session-persistence-hardening` — отметить в нём).
- Participants/join API (+OpenAPI update по ADR-051).
- Обработчик очереди, блокировки, жизненный цикл событий (таймауты/попытки).
- Network delivery module + контракт SSE-уведомления
  `{stateVersion,lastEventSequence}` и полного HTTP resync.
- Параметр наблюдателя в строителе player-facing проекции (ADR-019 + ADR-058 §2.3).
- Интеграция `player-web` (подписка, версии, реконнект) и e2e-доказательство.

## Non-Goals

- Пакет игровых возможностей ADR-058 (отдельная задача).
- Агентские места (ADR-060, отдельная задача) — здесь только поле `kind`.
- Портальный UI приглашений (ADR-033 launch surface — задача портала); здесь
  только runtime-API invite/claim и Player Web BFF handoff.
- Telegram/др. каналы, Redis-кэширование, горизонтальное масштабирование
  воркеров (модель это допускает, реализация — позже).
- Дельта-синхронизация при реконнекте (полная ресинхронизация достаточна).
- WebSocket, realtime-ticket, presence, rooms, Redis, второй runtime instance,
  public rooms, matchmaking, spectators, чат, multi-use invites и
  revoke/reissue приглашений.
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

### Phase 2. Participants — S8 done; invite/claim completed in S10

1. S8: принять session-owned элемент `seatId`/`playerId`/`kind`/`joinState`,
   создавать только `human`/`local`, переиспользовать actor-scoped projection и
   available actions; агентские места передать S9.
2. Pre-production destructive cutover: удалить `game_sessions` и каскадные
   session-owned principals/receipts/events/schedules; `game_bundles` сохранить.
   Backfill и внешние DB-действия не выполняются.
3. Обновление OpenAPI + контрактные тесты, одноразовый invite/claim и network
   lifecycle завершены в S10.

### Phase 3. Последовательная HTTP-обработка — done

1. Запись действий в `session_events`, транзакционное применение под
   PostgreSQL row-level `SELECT FOR UPDATE NOWAIT` (state + version + status
   события).
2. Резолвинг `{{actor}}` из участника; отклонение действий не в свой ход
   существующими guard-механизмами.
3. Тесты конкуренции: два одновременных действия → последовательное применение,
   проигравшее отклонено управляемо.

### Phase 4. Network delivery — implementation complete

1. **Architecture gate — основной агент, Sol high, высокий риск — done:**
   гибридная граница invite/claim, `joinState`, SSE-курсора и HTTP resync принята PM;
   ADR-059 и обзор уточнены до интеграции кода.
2. **Contracts — Luna medium, ограниченный schema-first блок:** OpenAPI,
   JSON Schema, генерируемые типы и негативные contract tests; основной агент
   проверяет публичную границу и generated drift.
3. **Runtime invite/claim — основной агент/Sol high, security-sensitive:**
   hash-only токены, атомарная замена credential, principal scope, гонка/повтор/истечение
   и PostgreSQL tests. Критическая транзакция не делегируется Luna.
4. **Network delivery — Luna high:** ограниченный SSE hub, один поток на principal,
   backpressure/coalescing/cleanup, публикация только после commit и первое событие для
   закрытия гонки GET/subscribe. Gameplay commands остаются в HTTP.

### Phase 5. Персональные проекции — done в S8/S9, переиспользовать

1. `viewerPlayerId` в строителе проекции; фильтрация по `visibility` (ADR-058);
   тесты на отсутствие утечки `secret`/чужих приватных полей/порядка колод.

### Phase 6. Интеграция player-web и e2e — accepted for closed alpha

1. **Player Web — Luna medium:** занятие места по ссылке, BFF handoff,
   подписка, применение версий, реконнект-ресинхронизация и экран ожидания хода.
2. **Независимая предварительная критика — Luna xhigh:** негативные пути token replay,
   actor spoofing, stale version, disconnect/restart; исправления выполняет
   Luna в том же ограниченном контуре, окончательную оценку делает основной
   агент.
3. **Приёмка — основной агент, Sol high:** Playwright с двумя контекстами
   браузера на Estate Race, actor spoof/stale version/privacy и restart/resync на PostgreSQL;
   desktop+narrow primary visual inspection выполнена и принята для закрытой
   альфы.

### Phase 7. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, debt-log
   (`InMemorySessionStore`), Handoff Log.
2. Упростить итоговую схему: подтвердить отсутствие отдельного gateway,
   persistent presence, gameplay commands в delivery transport, delta-sync и
   второго владельца состояния; любое расширение вернуть на решение PM.

## Acceptance

- Партия Estate Race двумя браузерными контекстами: ходы доставляются SSE-
  уведомлением с последующим полным HTTP GET,
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
npx playwright test apps/player-web/e2e/estate-race-private-network.spec.ts
```

## Risks

- Ошибка в claim transaction способна выдать одно место двум principal или
  оставить использованный токен действующим; PostgreSQL race и replay tests
  уже прошли. Остаточный gate до каталога/production — recoverable handoff
  после потери ответа credential; content/economy/product publication и
  production readiness также остаются вне закрытой альфа-приёмки.
- Выбранный delivery transport не должен раскрывать долговечный credential в
  URL или browser JavaScript; invite fragment синхронно очищается, а
  session-scoped `HttpOnly; SameSite=Strict` cookie проверяется негативными
  тестами вместе с replay/expiry одноразового invite.
- Реестр соединений или подписок живёт в одном runtime-процессе и теряется при рестарте.
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
- 2026-08-24: PM принял пакет с одноразовым 24-часовым приглашением и
  WebSocket, затем потребовал сохранить решения параллельного коммита
  `99019ca` до сравнительной приёмки. Sol high review подтвердил полезное
  упрощение SSE, но нашёл три P1 и несовместимость с S9. Автоматическая
  интеграция не выполняется до выбора между исходным пакетом, параллельным
  вариантом и рекомендованным гибридом из аудита.
- 2026-08-25: PM принял переносимый процесс параллельной координации. Основной
  агент этого корневого TSK является координатором и по умолчанию будущим
  интегратором. PM принял гибрид: одноразовый invite и отдельный durable
  credential сочетаются с SSE-курсором и полным authenticated HTTP resync.
  Координатор опубликовал exclusive claim на public contract в `origin/main`
  коммитом `788b843`; S10 переведён в `in_progress`.
- 2026-08-25: S10 implementation integrated: private invite claim, durable
  participant credential, authenticated SSE/full HTTP resync, PostgreSQL restart
  и Estate Race two-browser evidence pass. S10 принят для закрытой альфы после
  desktop+narrow primary visual inspection и полного набора constituent gates;
  задача остаётся `review` для каталожных и production/content/economy/product
  publication ворот. Closed-alpha claim-response-loss limitation и
  recoverable-handoff gate before catalog/production recorded in GSR-050.
