# ADR-033: Portal Runtime Session Binding

- **Дата**: 2026-05-20
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Portal Backend, Portal Frontend, Player Web, Runtime API, Session, Admin

## Оглавление

- [Контекст](#контекст)
- [Решение](#решение)
- [Политика доступа](#политика-доступа)
- [Правила типа игры](#правила-типа-игры)
- [Доменная модель](#доменная-модель)
- [API boundary](#api-boundary)
- [Admin window](#admin-window)
- [Журнал и архивирование](#журнал-и-архивирование)
- [Отклоненные альтернативы](#отклоненные-альтернативы)
- [Последствия](#последствия)
- [Связанные артефакты](#связанные-артефакты)

## Контекст

ADR-032 закрепил границу: портал управляет покупками, ссылками запуска и
доступом, а Runtime API владеет игровым состоянием. Для сохранения этой границы
нужен явный контракт между портальной сессией доступа и runtime-сессией: клиент
не может самостоятельно выбирать игровое состояние из локального хранилища.

Термины:

- **Портальная сессия доступа** — запись с токеном, сроком действия, политикой
  доступа и связью с покупкой.
- **Runtime-сессия** — сессия игрового состояния в Runtime API: состояние, ход
  игрока и журнал ходов.
- **Привязка устройства** — связь устройства игрока с runtime-сессией внутри
  портальной сессии доступа; нужна там, где разные устройства должны получать
  раздельное состояние.
- **Административная поверхность** — защищённый интерфейс управления сессией
  для консультанта или администратора.

Без явного слоя привязки разные портальные ссылки в одном браузере могут
ошибочно попадать в одну runtime-сессию.

## Решение

Ввести явное связывание `portal launch session -> runtime session`.

Портал остается владельцем доступа, а `runtime-api` остается владельцем состояния игры. Создание или продолжение runtime session должно происходить через backend boundary, а не через произвольное чтение `localStorage` в player-web.

Целевая цепочка состоит из проверки порталом токена, статуса, срока действия,
покупки и политики доступа, после чего портал создаёт или возобновляет
разрешённую привязку к runtime-сессии. Player Web использует только полученный
из этой привязки идентификатор и не подменяет его локально сохранённым выбором.

Граница реализуется модулем portal/session: транспортный контроллер принимает
HTTP-контекст, а правила доступа и привязки живут в сервисном слое. Физическое
размещение модуля может меняться без изменения доменной модели.

## Политика доступа

Коммерческий вариант доступа задаётся принятым полем `package_type`; его
продуктовый контракт определяет:

- создаётся ли новая портальная сессия или переиспользуется существующая;
- срок действия и допустимость повторного открытия;
- должна ли runtime-сессия быть общей или привязанной к устройству;
- переводятся ли покупка и сессия в архив после завершения;
- доступен ли сохранённый журнал после завершения.

Каталог конкретных тарифов, их названия и длительности не является частью ADR.
Backend исполняет правила выбранного типа и ограничивает срок портальной
сессии сроком покупки; интерфейс не может переопределять эти правила.

## Правила типа игры

Тип игры задается при создании game record в портале и является платформенной настройкой, не game-specific branch.

### Single-Player

- Когда политика требует раздельного состояния, каждому устройству возвращается
  собственная runtime-сессия.
- Устройство получает device token в cookie или другом стабильном browser storage.
- Device token не должен давать права доступа сам по себе: он работает только внутри валидной launch session.
- `launch_count` считается по числу созданных runtime sessions, то есть по новым device bindings.

### Multiplayer

- Состояние привязано к номеру launch session, то есть к `counter` и token.
- Все игроки, открывшие одну ссылку, попадают в одну runtime session.
- `launch_count` для multiplayer увеличивается при создании runtime session для launch session, а не при каждом переходе игрока.

## Доменная модель

Минимальная целевая модель:

- `purchase`
  - `id`, `documentId`
  - `game_id`
  - `package_type`: тип приобретённого продукта; допустимые значения задаёт
    продуктовый контракт
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

`runtime_session_binding` является явной доменной связью между портальным
доступом и игровым состоянием.

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
  - получает токен устройства, когда политика требует отдельного состояния;
  - creates/resumes runtime session through `runtime-api`;
  - records `binding-created` or `binding-resumed`.
- `GET /api/launch-sessions/active`
  - authenticated consultant endpoint;
  - returns active launch sessions for a purchase/link.
- `GET /api/launch-sessions/:id/journal`
  - возвращает сохранённый журнал, если это разрешено политикой доступа.

Player Web rules:

- If launch context is present in URL, Player Web must use portal runtime binding first.
- Stored `localStorage` session id may be used only when it belongs to the same launch context.
- Запуск без портального контекста является отдельным локальным режимом и не
  даёт портальных прав доступа.

Runtime API rules:

- Runtime API creates, resumes and completes runtime sessions.
- Runtime API must expose enough completion/journal data for portal archive flow.
- Runtime API does not know purchases, payments or portal permissions.

## Admin window

Канонический административный маршрут:

```text
/launch/:token::counter/admin
```

Требования к административной поверхности:

- Requires login/password.
- Requires consultant ownership of the purchase or admin role.
- Opens session state/log controls for multiplayer launch session.
- Must not be authorized only by URL knowledge.
- Все административные поверхности используют тот же защищённый маршрут.

## Журнал и архивирование

Runtime API отмечает runtime-сессию завершённой и публикует событие завершения
со ссылкой на журнал или его проекцией. Portal backend фиксирует событие и
изменяет статусы покупки и портальной сессии согласно политике доступа.
Повторное открытие возвращает журнал только тогда, когда это разрешено политикой.

Журнал является общей player-facing проекцией сохранённых runtime-событий.
Портал не должен знать шаги, карточки или другие сущности конкретной игры.

## Отклоненные альтернативы

- **Let Player Web continue using only `localStorage`** — rejected because different portal links in one browser collapse into one runtime session.
- **Make Portal Backend own game state** — rejected because it violates ADR-032 and duplicates runtime-api responsibility.
- **Encode all rules in URL parameters** — rejected because URL knowledge would become authority and admin access would be weak.
- **Create a separate session service immediately** — postponed; modular backend
  placement is sufficient while service boundaries and tests remain explicit.

## Последствия

- Общая runtime-сессия может храниться непосредственно в портальной сессии;
  привязки к устройствам хранятся отдельно.
- Player Web обязан отдавать приоритет портальному контексту над локальным
  демонстрационным режимом.
- Хранилище должно поддерживать отдельную сущность `runtime_session_binding`.
- Runtime API должен обеспечивать устойчивое возобновление сессии после
  перезапуска процесса.
- Runtime binding creation must be protected by a unique binding key, otherwise parallel opens of the same shared link can create duplicate runtime sessions.

## Связанные артефакты

- `docs/architecture/adrs/032-portal-session-launch-boundary.md`
- `docs/architecture/adrs/005-session-persistence.md`
- `docs/architecture/adrs/011-multiplayer-architecture.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
