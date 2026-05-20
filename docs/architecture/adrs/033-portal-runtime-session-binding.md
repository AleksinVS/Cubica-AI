# ADR-033: Portal Runtime Session Binding

- **Дата**: 2026-05-20
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Portal Backend, Portal Frontend, Player Web, Runtime API, Session, Admin

## Оглавление

- [Контекст](#контекст)
- [Решение](#решение)
- [Правила ссылок](#правила-ссылок)
- [Правила типа игры](#правила-типа-игры)
- [Доменная модель](#доменная-модель)
- [API boundary](#api-boundary)
- [Admin window](#admin-window)
- [Журнал и архивирование](#журнал-и-архивирование)
- [Отклоненные альтернативы](#отклоненные-альтернативы)
- [Последствия](#последствия)
- [Открытые решения](#открытые-решения)
- [Связанные артефакты](#связанные-артефакты)

## Контекст

ADR-032 закрепил границу: портал управляет покупками, ссылками запуска и доступом, а `runtime-api` владеет игровым состоянием. После первого тестового контура обнаружен архитектурный разрыв: portal link уже резолвится в `runtimeSessionId`, но `apps/player-web` продолжает старую browser-local модель и читает `sessionId` из `localStorage` по ключу игры.

Термины:

- **Launch session** — портальная сессия доступа по ссылке: запись с токеном, счетчиком, сроком действия и связью с покупкой.
- **Runtime session** — сессия игрового состояния в `runtime-api`: состояние, ход игрока и журнал ходов.
- **Device binding** — привязка устройства игрока к runtime session внутри launch session; нужна для однопользовательских игр, где разные устройства должны получать свое состояние.
- **Admin window** — административное окно сессии для консультанта или администратора, защищенное логином/паролем и проверкой прав.

Без явного binding layer разные портальные ссылки в одном браузере могут попадать в одну и ту же runtime session, потому что player-web продолжает последний `localStorage` session id.

## Решение

Ввести явное связывание `portal launch session -> runtime session`.

Портал остается владельцем доступа, а `runtime-api` остается владельцем состояния игры. Создание или продолжение runtime session должно происходить через backend boundary, а не через произвольное чтение `localStorage` в player-web.

Целевая цепочка:

1. Консультант копирует ссылку в портале.
2. Portal backend создает или переиспользует launch session по правилам типа ссылки.
3. Игрок открывает `/launch/:token::counter`.
4. Portal backend проверяет токен, счетчик, срок, статус, покупку и тип игры.
5. Player Web получает launch context и запрашивает runtime binding.
6. Portal backend решает, какой runtime session id вернуть:
   - общий runtime session для one-time ссылки и multiplayer;
   - device-bound runtime session для single-player day/month.
7. Player Web использует runtime session id из portal binding как приоритетный источник и не подменяет его старым `localStorage`.

Для первого VPS эта boundary реализуется как Strapi custom API с thin controller и service logic, что соответствует Strapi-подходу: контроллер принимает HTTP-контекст, а бизнес-правила живут в service layer. В будущем этот блок можно вынести из Strapi в отдельный portal/session module без изменения доменной модели.

## Правила ссылок

### One-Time

- Одна покупка one-time имеет ровно одну launch session.
- Ссылка бессрочная до полного прохождения игры.
- Runtime session одна на ссылку независимо от устройства.
- При повторном переходе открывается последнее состояние этой runtime session.
- После полного прохождения покупка переводится в архив, `end_date` покупки заполняется датой завершения.
- После завершения повторный переход открывает сохраненный журнал ходов, а не новую игру.

### Day

- Launch session действует в дату покупки с `00:00:00` до `23:59:59` по timezone `Europe/Moscow`.
- Каждое копирование ссылки создает новую launch session.
- Если нужно продлить ссылку на следующий день, пользователь обращается в поддержку; автоматическое продление не выполняется.
- Runtime binding зависит от типа игры:
  - single-player: отдельная runtime session на устройство;
  - multiplayer: одна runtime session на launch session.

### Month

- Покупка задает купленный период.
- Копирование ссылки допустимо только внутри купленного периода.
- Каждое копирование создает новую launch session.
- Каждая launch session действует 48 часов с момента генерации, но не должна выходить за предел купленного периода.
- Runtime binding зависит от типа игры:
  - single-player: отдельная runtime session на устройство;
  - multiplayer: одна runtime session на launch session.

## Правила типа игры

Тип игры задается при создании game record в портале и является платформенной настройкой, не game-specific branch.

### Single-Player

- Для day/month launch session состояние возвращается отдельно для каждого устройства.
- Устройство получает device token в cookie или другом стабильном browser storage.
- Device token не должен давать права доступа сам по себе: он работает только внутри валидной launch session.
- `launch_count` считается по числу созданных runtime sessions, то есть по новым device bindings.

### Multiplayer

- Состояние привязано к номеру launch session, то есть к `counter` и token.
- Все игроки, открывшие одну ссылку, попадают в одну runtime session.
- `launch_count` для multiplayer увеличивается при создании runtime session для launch session, а не при каждом переходе игрока.
- Портал показывает кнопку `Сессии` в строках ссылок многопользовательских игр.

### One-Time Override

One-time ссылка сильнее правила single-player device binding: она всегда ведет в одну runtime session. Это следует из продуктового правила "разовая ссылка всегда имеет только одну сессию и переходит на последнее состояние независимо от устройства".

## Доменная модель

Минимальная целевая модель:

- `purchase`
  - `id`, `documentId`
  - `game_id`
  - `package_type`: `one-time | day | month`
  - `start_date`, `end_date`
  - `status`: `active | completed | archived | revoked`
  - `completed_at`
- `launch_session`
  - `domain`
  - `token`
  - `counter`
  - `purchase_id`
  - `game_id`
  - `package_type`
  - `valid_from`, `valid_to`
  - `status`: `active | expired | completed | archived | revoked`
  - `runtime_session_id` for shared-session modes
  - `launch_count`
  - `portal_url`, `player_url`, `admin_url`, `journal_url`
- `runtime_session_binding`
  - `binding_key`: stable unique key for `(launch_session, binding_type, device token or shared marker)`
  - `launch_session_id`
  - `device_token_hash`
  - `runtime_session_id`
  - `binding_type`: `shared | device`
  - `created_at`, `last_seen_at`
  - `status`: `active | completed | archived | revoked`
- `session_launch_event`
  - `event_type`: `copy-link | resolve | binding-created | binding-resumed | runtime-created | completed | archived | rejected | admin-opened`
  - `launch_session_id`
  - `runtime_session_id`
  - `device_token_hash`
  - `metadata`
  - `occurred_at`
- `game_session_journal`
  - `runtime_session_id`
  - `launch_session_id`
  - `game_id`
  - `journal_payload`
  - `completed_at`

`runtime_session_binding` is the missing bridge in the current implementation.

## API boundary

Portal-facing endpoints:

- `POST /api/launch-sessions/copy-link`
  - authenticated consultant endpoint;
  - creates/reuses launch session;
  - returns portal launch URL.
- `GET /api/launch-sessions/resolve/:token/:counter`
  - public resolver;
  - validates token, counter, status and validity window;
  - returns launch context, not an unverified browser-local runtime decision.
- `POST /api/launch-sessions/resolve/:token/:counter/runtime-binding`
  - called by Player Web after resolve;
  - receives device token when single-player day/month needs device-bound state;
  - creates/resumes runtime session through `runtime-api`;
  - records `binding-created` or `binding-resumed`.
- `GET /api/launch-sessions/active`
  - authenticated consultant endpoint;
  - returns active launch sessions for a purchase/link.
- `GET /api/launch-sessions/:id/journal`
  - returns saved journal for completed one-time sessions.

Player Web rules:

- If launch context is present in URL, Player Web must use portal runtime binding first.
- Stored `localStorage` session id may be used only when it belongs to the same launch context.
- If no launch context exists, legacy local development behavior can still create a local runtime session, but this mode must be marked as local/demo.

Runtime API rules:

- Runtime API creates, resumes and completes runtime sessions.
- Runtime API must expose enough completion/journal data for portal archive flow.
- Runtime API does not know purchases, payments or portal permissions.

## Admin window

Canonical admin route variant:

```text
/launch/:token::counter/admin
```

The plain product rule "add `admin` to the end of the link" maps to the route above.

Admin window requirements:

- Requires login/password.
- Requires consultant ownership of the purchase or admin role.
- Opens session state/log controls for multiplayer launch session.
- Must not be authorized only by URL knowledge.
- The portal session list must include an `Admin` button that opens the same route.

## Журнал и архивирование

Completion flow:

1. Runtime API marks runtime session as completed.
2. Runtime API exposes or sends completion event with journal payload or journal pointer.
3. Portal backend records `completed` event.
4. For one-time purchase:
   - launch session becomes `completed`;
   - purchase becomes `archived`;
   - purchase `end_date` becomes completion date.
5. Reopening the one-time link after completion returns journal route instead of player route.

For `Antarctica`, the journal is general platform data: it is the game-visible move log saved from runtime state. The portal must not know Antarctica-specific steps or cards.

## Отклоненные альтернативы

- **Let Player Web continue using only `localStorage`** — rejected because different portal links in one browser collapse into one runtime session.
- **Make Portal Backend own game state** — rejected because it violates ADR-032 and duplicates runtime-api responsibility.
- **Encode all rules in URL parameters** — rejected because URL knowledge would become authority and admin access would be weak.
- **Create a separate session service before test VPS** — postponed; Strapi custom API is enough for the first VPS if service boundaries and tests remain explicit.

## Последствия

- Current implementation keeps `launch-session.runtime_session_id` only for shared-session modes; device-specific sessions live in `runtime_session_binding`.
- `apps/player-web` must prefer portal launch context over browser-local demo sessions.
- A new Strapi content-type or equivalent table is needed for `runtime_session_binding`.
- Runtime API needs either persisted sessions or a stable recovery path before VPS tests can guarantee resume after service restart.
- The `Сессии` modal can use current `active` endpoint, but admin buttons and active runtime binding data require the binding model.
- Runtime binding creation must be protected by a unique binding key, otherwise parallel opens of the same shared link can create duplicate runtime sessions.

## Открытые решения

1. What exact journal DTO must Runtime API return for completed sessions? Recommendation: start with `runtimeSessionId`, `gameId`, `completedAt`, `entries[]`, and `summary`.

## Связанные артефакты

- `docs/architecture/adrs/032-portal-session-launch-boundary.md`
- `docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md`
- `docs/tasks/artifacts/TSK-20260518-portal-test-vps-and-antarctica-launch/session-management-design.md`
- `docs/architecture/adrs/005-session-persistence.md`
- `docs/architecture/adrs/011-multiplayer-architecture.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
