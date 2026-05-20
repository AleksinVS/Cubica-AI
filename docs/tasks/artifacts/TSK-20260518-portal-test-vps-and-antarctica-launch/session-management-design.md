# Session Management Design for Portal Test Launch

## Оглавление

- [Назначение](#назначение)
- [Текущая проблема](#текущая-проблема)
- [Целевая модель](#целевая-модель)
- [Матрица правил](#матрица-правил)
- [Пользовательские сценарии](#пользовательские-сценарии)
- [Backend work items](#backend-work-items)
- [Frontend work items](#frontend-work-items)
- [Runtime work items](#runtime-work-items)
- [Тестирование](#тестирование)
- [Acceptance](#acceptance)
- [Открытые вопросы](#открытые-вопросы)

## Назначение

Этот артефакт переводит ADR-033 в исполняемый план для активной задачи `TSK-20260518-portal-test-vps-and-antarctica-launch`.

Термины:

- **Launch session** — портальная сессия доступа по ссылке.
- **Runtime session** — игровая сессия состояния в `runtime-api`.
- **Device binding** — привязка устройства к runtime session внутри launch session.

## Текущая проблема

Сейчас портал уже умеет:

- создавать `launch-session`;
- копировать portal URL;
- резолвить `/launch/:token::counter`;
- показывать ссылку и список активных сессий.

Но player-web еще не связан с portal session management:

- player-web читает `sessionId` из `localStorage`;
- portal `runtimeSessionId` не является обязательным источником истины для player-web;
- runtime-api не получает проверенный portal launch context;
- из-за этого разные ссылки в одном браузере могут открывать одну и ту же runtime session.

Это зафиксированный архитектурный долг, который нужно закрыть до приемки test VPS launch.

## Целевая модель

1. Portal Backend проверяет доступ по ссылке.
2. Portal Backend создает или находит runtime binding.
3. Player Web получает runtime session id, который соответствует текущей portal launch session.
4. Player Web не использует старый `localStorage` session id, если он относится к другой launch session.
5. Runtime API остается владельцем состояния и журнала.

## Матрица правил

| Link type | Game type | Launch session | Runtime session |
| --- | --- | --- | --- |
| `one-time` | single-player | одна на покупку | одна на ссылку для всех устройств |
| `one-time` | multiplayer | одна на покупку | одна на ссылку |
| `day` | single-player | новая при каждом копировании | отдельная на устройство |
| `day` | multiplayer | новая при каждом копировании | одна на launch session |
| `month` | single-player | новая при каждом копировании | отдельная на устройство |
| `month` | multiplayer | новая при каждом копировании | одна на launch session |

Примечание: one-time override сильнее правила single-player per-device, потому что продуктово разовая ссылка должна продолжать одно последнее состояние независимо от устройства.

## Пользовательские сценарии

### Consultant Copies Link

1. Консультант открывает `/games/my`.
2. Нажимает копирование ссылки.
3. Backend создает launch session или переиспользует one-time session.
4. UI показывает `Ссылка скопирована в буфер обмена`.

### Player Opens Single-Player Day/Month Link

1. Игрок открывает `/launch/:token::counter`.
2. Portal validates launch session.
3. Player Web получает или создает device token.
4. Portal Backend создает runtime binding для `(launch_session, device_token)`.
5. Player Web открывает runtime session из binding.

### Player Opens Multiplayer Link

1. Игрок открывает `/launch/:token::counter`.
2. Portal validates launch session.
3. Portal Backend возвращает shared runtime session для launch session.
4. Все игроки по этой ссылке получают одно состояние.

### Consultant Opens Admin Window

1. В таблице ссылок для multiplayer появляется кнопка `Сессии`.
2. В модальном окне активных сессий есть кнопка `Admin`.
3. Кнопка открывает `/launch/:token::counter/admin`.
4. Portal требует login/password и проверяет права.

### Completed One-Time Link

1. Runtime API сообщает о completion.
2. Portal архивирует purchase и launch session.
3. Повторный переход по ссылке открывает journal route.

## Backend work items

1. Add `runtime-session-binding` content-type or equivalent persistence table with unique `binding_key`.
2. Extend `session-launch-event` with `binding-created`, `binding-resumed`, `completed`, `archived`, `admin-opened`.
3. Change launch resolver to return launch context, not only player URL.
4. Add `POST /api/launch-sessions/resolve/:token/:counter/runtime-binding`.
5. Make Portal Backend call Runtime API to create/resume runtime session for the first VPS.
6. Add completion endpoint or event receiver from Runtime API.
7. Add journal endpoint for completed sessions.
8. Add admin route validation.

## Frontend work items

1. Add player launch bootstrap in `apps/player-web`:
   - parse launch context;
   - create/read device token;
   - call runtime-binding endpoint;
   - use returned runtime session id.
2. Scope stored player session id by launch session id, not only by game id.
3. Keep local/demo mode only when no launch context exists.
4. Add `Admin` button to multiplayer sessions modal. Basic button is implemented; backend rights validation remains.
5. Render expired/completed/journal states clearly.

## Runtime work items

1. Ensure runtime sessions can be created by backend call and then resumed by Player Web.
2. Persist runtime sessions for VPS; in-memory storage is not enough for reliable resume.
3. Expose completion signal and journal DTO.
4. Keep runtime free of purchase/link/payment rules.

## Тестирование

Unit tests:

- one-time reuses launch session;
- day window is `00:00:00` to `23:59:59` Europe/Moscow;
- month session expires after 48 hours and stays inside purchased period;
- one-time override ignores device token.

Integration tests:

- two day links create two launch sessions;
- same single-player day link opened from two device tokens creates two runtime sessions;
- same multiplayer link opened twice reuses one runtime session;
- one-time link opened from two device tokens reuses one runtime session;
- expired link rejects runtime binding.
- parallel opens of one shared link do not create duplicate active bindings.

E2E smoke tests:

- consultant buys Antarctica through payment stub;
- consultant copies one-time/day/month links;
- player opens each link;
- second device behavior matches matrix;
- multiplayer sessions modal shows active sessions and admin button;
- completed one-time link opens journal.

## Acceptance

- Different portal links no longer collapse into one player-web localStorage session.
- `launch_count` equals created runtime sessions.
- One-time link continues the same runtime session across devices.
- Single-player day/month creates device-specific runtime sessions.
- Multiplayer uses one runtime session per launch session.
- Admin window requires login/password and rights check.
- Completed one-time game archives purchase and shows saved journal.

## Открытые вопросы

1. Confirm exact journal DTO for completed one-time sessions after runtime starts returning a user-facing journal.
