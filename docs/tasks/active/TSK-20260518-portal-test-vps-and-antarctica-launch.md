# TSK-20260518-portal-test-vps-and-antarctica-launch: Portal Test VPS and Antarctica Launch

## Оглавление

- [Status](#status)
- [Why](#why)
- [Strategic Goal](#strategic-goal)
- [Current Portal Snapshot](#current-portal-snapshot)
- [Target Architecture Assumption](#target-architecture-assumption)
- [Resolved Product Decisions](#resolved-product-decisions)
- [Current Portal Analysis](#current-portal-analysis)
- [Strapi Decision Gate](#strapi-decision-gate)
- [Session Management Design](#session-management-design)
- [MVP Execution Slices](#mvp-execution-slices)
- [Work Plan](#work-plan)
- [Acceptance](#acceptance)
- [Open Questions](#open-questions)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

in_progress

## Why

Следующий стратегический шаг проекта — доработать портал и выполнить тестовый запуск через одну игру `Antarctica`. Этот шаг проверяет не только UI портала, но и общую платформенную механику покупок, ссылок запуска, игровых сессий, сроков действия и архивации.

## Strategic Goal

Получить проверяемый test VPS, где консультант может открыть портал, увидеть купленную `Antarctica`, скопировать ссылку запуска, создать или продолжить игровую сессию и проверить ограничения по сроку действия и количеству запусков.

## Current Portal Snapshot

- Локальный каталог `draft/cubica-portal-nextjs` обновлен из `https://github.com/aproskur/cubica-portal-nextjs`.
- Проверенный upstream commit: `6f1eef790737f498e3d434ffc38f9cf6226a668c`.
- Стек: Next.js `15.1.6`, React `19`, styled-components, App Router.
- Production build проходит командой `npm run build`.
- В репозитории есть `services/portal-backend` на Strapi `5.10.2`; он содержит content-types `game`, `order`, `purchase`, `link`, `payment-event` и Robokassa-интеграцию.
- Физические миграции Strapi пока не описаны: `services/portal-backend/database/migrations` содержит только `.gitkeep`, а структура базы задается content-type schema files.

## Target Architecture Assumption

Механика ссылок и игровых сессий классифицируется как общая платформенная механика, а не как game-specific behavior `Antarctica`.

Следствие: портал может хранить `game_id = antarctica` как данные покупки, но не должен содержать специальных условий для сценария, карточек, шагов или правил `Antarctica`. Исполнимая логика остается в `games/antarctica`, `services/runtime-api`, `apps/player-web` и `packages/contracts/*`.

## Resolved Product Decisions

- Launch link shape: path внутри портала; физически портал, player и runtime могут быть разными серверами за маршрутизацией.
- First VPS purchase source: платежная заглушка вместо реальной оплаты.
- Payment integration candidate: существующая Robokassa-интеграция в `services/portal-backend`; восстановление не требуется, код найден.
- Day link timezone: Москва.
- `launch_count`: количество созданных runtime sessions.
- Minimal auth: логин/пароль для консультанта и admin window.
- Completed one-time game log: показывать журнал ходов `Antarctica`; нужно проверить и при необходимости реализовать сохранение журнала после закрытия игровой сессии.

## Current Portal Analysis

### What Exists

- Главная страница каталога с карточками игр.
- Страница игры `/games/[slug]` с галереей, ценами и кнопками `Играть` / `Купить`.
- Страница покупок `/games/my`.
- Таблица ссылок в `src/components/GameLinksTable.js`.
- Копирование URL через `navigator.clipboard.writeText`.
- Фильтр поиска по локальным данным.

### Remaining Gaps Against Target Architecture

Часть первичных gaps уже закрыта в `apps/portal-nextjs` и `services/portal-backend`: backend-first payment stub, login form, реальные покупки `/games/my`, launch-session API, portal route `/launch/:token::counter`, выбор `one-time/day/month`, copy message `Ссылка скопирована в буфер обмена`, базовый список активных сессий.

Оставшиеся gaps:

1. `apps/player-web` пока не использует portal launch context как источник истины и продолжает брать runtime `sessionId` из `localStorage`.
2. Нет `runtime_session_binding` — привязки launch session к runtime session с учетом устройства и типа игры.
3. Portal backend сейчас создает `runtime_session_id` как placeholder-style идентификатор, но еще не оркестрирует фактическое создание runtime session в `services/runtime-api`.
4. Нет завершения one-time покупки через completion event, архивации и открытия журнала ходов.
5. Есть минимальный admin route `/launch/:token::counter/admin` и кнопка `Admin` в модальном окне сессий; остается backend-проверка прав консультанта или администратора.
6. Нет persisted runtime sessions для надежного VPS resume после рестарта runtime-api.
7. Нет миграций/production deploy-контура, health/readiness для портального backend и полного наблюдения launch lifecycle.
8. Страница сессий для multiplayer уже имеет UI основу, но еще не показывает runtime binding/admin actions как целевую модель.

### Existing Strapi/Payment Findings

- `services/portal-backend/src/api/order/controllers/order.js` создает order, генерирует Robokassa payment link и обрабатывает `/robokassa/result`.
- Успешный Robokassa callback переводит order в `paid` и создает `purchase`.
- `payment-event` сохраняет отправленные и полученные платежные события.
- `link.generate` уже содержит базовую генерацию ссылок по `purchaseId`, но сейчас:
  - использует UTC helpers вместо московской timezone;
  - создает link, а не отдельную launch session;
  - формирует URL через `GAMESERVER_URL`, а целевой путь должен быть portal path;
  - не считает `launch_count` по runtime sessions;
  - не закрывает журнал ходов/архивирование.
- `.env.example` не содержит Robokassa и `GAMESERVER_URL` переменные, хотя код их использует.

### Strapi Recommendation

Для test VPS имеет смысл сохранить Strapi как краткосрочный backend для каталога, пользователей, платежной заглушки, Robokassa и административного наполнения данных.

Для launch sessions нужно ввести явную service boundary. На первом шаге ее можно реализовать как custom Strapi API, чтобы быстрее использовать существующие user/order/purchase/link content-types. При росте правил и нагрузки этот блок лучше вынести в собственный portal/session module с явными PostgreSQL migrations и тестами.

### Weakly Worked Blocks

- Domain model: покупки, ссылки, игровые сессии, устройства, запуски, архивы.
- Session lifecycle: генерация, продолжение, завершение, истечение срока, журнал.
- Data persistence: PostgreSQL schema, migrations, seed-данные, транзакции.
- API contracts: portal-facing и player-launch endpoints.
- Security: auth, roles, signed/admin links, защита от перебора токенов.
- Deployment: production env, reverse proxy, process manager or containers, backup path.
- Observability: structured logs, launch audit, error tracking.
- Testing: unit rules for link validity, integration tests for session generation, e2e path from portal to player.
- Frontend architecture: многие страницы являются client components, данные дублируются, `SearchProvider` подключен дважды, в production build остается `console.log`.

## Strapi Decision Gate

Перед началом реализации launch sessions нужно принять и зафиксировать короткое решение по роли Strapi на первом VPS.

### Keep in Strapi for Test VPS

- Каталог игр и карточки портала.
- Пользователи и login/password авторизация через `users-permissions`.
- `order`, `purchase`, `payment-event` и Robokassa-интеграция.
- Платежная заглушка для создания paid order/purchase без внешней оплаты.
- Административное наполнение тестовых данных.

### Do Not Hide in Strapi CMS Rules

- Создание и продолжение launch sessions.
- Расчет сроков действия ссылок.
- `launch_count` как число созданных runtime sessions.
- Архивация разовой покупки после завершения.
- Доступ к admin window игровой сессии.
- Сохранение и выдача журнала ходов `Antarctica`.

### Decision Criteria

- Если логика является простой CRUD-операцией над каталогом, покупкой или платежным событием, ее можно оставить в Strapi.
- Если логика влияет на запуск игры, срок действия ссылки, состояние игровой сессии или журнал ходов, она должна быть выделена в custom service boundary с тестами.
- На первом VPS эта boundary может быть реализована как custom Strapi API, но с кодовой структурой, которую можно вынести из Strapi без переписывания правил.

## Session Management Design

Архитектурное решение по связке portal launch session и runtime session зафиксировано в `docs/architecture/adrs/033-portal-runtime-session-binding.md`.

Исполняемый дизайн и приемка блока управления сессиями зафиксированы в `docs/tasks/artifacts/TSK-20260518-portal-test-vps-and-antarctica-launch/session-management-design.md`.

Ключевые решения:

1. Разделить `launch session` и `runtime session`.
2. Добавить `runtime_session_binding` как мост между портальной ссылкой, устройством игрока и runtime state.
3. Для `one-time` всегда использовать одну runtime session независимо от устройства.
4. Для `day/month` single-player использовать отдельную runtime session на устройство.
5. Для multiplayer использовать одну runtime session на launch session.
6. Player Web должен приоритетно использовать portal launch context и не подменять его старым `localStorage` session id.
7. Admin route canonical form: `/launch/:token::counter/admin`, с login/password и проверкой прав.

## MVP Execution Slices

### Slice 0. Portal Static Review

Цель: посмотреть текущий портал с тестовыми данными и зафиксировать UX/структурные разрывы.

Acceptance:

- Портал запускается локально.
- Главная показывает `Antarctica`.
- `/games/antarctica` открывает карточку игры.
- `/games/my` показывает разовую, дневную и месячную ссылки.
- Копирование показывает `Ссылка скопирована в буфер обмена`.

### Slice 1. Payment Stub to Purchase

Цель: создать покупку `Antarctica` на test VPS без реальной оплаты.

Acceptance:

- Консультант входит по логину/паролю.
- Payment stub создает paid order и purchase.
- Purchase связан с user, game, package type, start/end dates.
- Robokassa-код остается доступен, но не обязателен для test VPS.

### Slice 2. Copy Link to Launch Session

Цель: копирование ссылки становится backend operation, а не копированием статического URL.

Acceptance:

- Для one-time ссылки создается или переиспользуется ровно одна launch session.
- Для day/month ссылки создается новая launch session при каждом копировании.
- Ссылка имеет portal path форму.
- Событие копирования записывается в audit/event log.

### Slice 3. Launch Link to Runtime Session

Цель: переход по portal path запускает resolver, который создает или продолжает runtime session.

Acceptance:

- Resolver проверяет token, link counter, purchase owner/scope, status и срок действия.
- `launch_count` увеличивается только при создании новой runtime session.
- Day link использует московскую timezone.
- Player открывается через `apps/player-web` и runtime/player boundary.
- Player Web не использует старый `localStorage` session id, если открыт portal launch context.
- Для single-player day/month создается device-bound runtime session; для multiplayer создается shared runtime session.

### Slice 4. Completed One-Time to Archive and Journal

Цель: завершенная разовая `Antarctica` больше не открывает игру как новую сессию.

Acceptance:

- Runtime/player передает completion event.
- Purchase или launch session получает статус archived/completed.
- Журнал ходов `Antarctica` сохраняется после закрытия игровой сессии.
- Повторный переход по завершенной разовой ссылке открывает сохраненный журнал.

### Slice 5. Multiplayer Sessions and Admin Window

Цель: подготовить поведение для многопользовательского режима без game-specific branch в портале.

Acceptance:

- Для multiplayer game type таблица ссылок показывает кнопку `Сессии`.
- Модальное окно показывает активные launch sessions.
- Admin window открывается после login/password проверки; backend-проверка прав консультанта или администратора остается обязательной до приемки slice.
- Добавление `admin` в конец ссылки открывает `/launch/:token::counter/admin`.

### Slice 6. Player Runtime Binding

Цель: устранить текущий gap, из-за которого разные portal links могут открывать одну browser-local runtime session.

Acceptance:

- `player-web` читает launch context из URL.
- `player-web` создает или читает device token.
- `player-web` вызывает portal runtime-binding endpoint.
- Binding endpoint создает или возобновляет runtime session через `services/runtime-api`.
- Stored browser session scoped by launch session id; чужой старый `localStorage` session id игнорируется.
- Unit/integration tests покрывают matrix из session-management artifact.

## Work Plan

### 1. Stabilize Portal Draft for Test Use

1. Зафиксировать статус `draft/cubica-portal-nextjs` как current portal draft for test launch.
2. Добавить минимальную документацию запуска: dev, production build, environment variables.
3. Убрать явные демонстрационные данные из UI-слоя и подготовить переход на backend/API.
4. Проверить, нужен ли `output: "standalone"` для VPS; если да, запускать production build через `node .next/standalone/server.js`, а не через `next start`.
5. Закрыть Slice 0 и зафиксировать найденные UI/UX gaps отдельным artifact или Handoff entry.

### 2. Pass Strapi Decision Gate

1. Зафиксировать, какие content-types остаются в Strapi на test VPS.
2. Выделить launch session lifecycle как custom service boundary.
3. Добавить в `.env.example` недостающие переменные Robokassa, portal URL и runtime/player URL.
4. Решить, где хранится новая schema: Strapi content-types для test VPS или SQL migration для собственного module.

### 3. Define Portal Launch Domain

1. Сверить текущие Strapi content-types `purchase`, `link`, `order`, `payment-event` с целевой launch model.
2. Спроектировать недостающую schema для `game_launch_sessions`, `session_launch_events` и сохранения журнала ходов.
3. Описать enum-значения типов ссылок: `single_use`, `day`, `month`.
4. Описать enum-значения типов игр: `single_player`, `multi_player`.
5. Определить поля статуса: `active`, `expired`, `completed`, `archived`, `revoked`.
6. Зафиксировать правила московской timezone для дневной ссылки.
7. Описать минимальный journal DTO для завершенной `Antarctica`.

### 4. Build Backend/API Boundary

1. Добавить portal API для каталога и покупок.
2. Добавить платежную заглушку, которая создает paid order/purchase для test VPS без обращения к Robokassa.
3. Добавить endpoint копирования ссылки, который создает или переиспользует launch session и возвращает готовый portal path URL.
4. Добавить endpoint перехода по ссылке, который валидирует токен, счетчик, срок действия и статус.
5. Добавить endpoint списка активных сессий для многопользовательской игры.
6. Добавить admin endpoint для сессии с проверкой прав.
7. Добавить endpoint журнала завершенной сессии.

### 5. Integrate Antarctica

1. Создать seed-покупку и ссылки для `game_id = antarctica` через платежную заглушку или seed script.
2. Привязать portal game record к каноническому `games/antarctica/game.manifest.json` через данные/конфиг, а не через game-specific code branch.
3. Настроить переход из portal launch resolver в `apps/player-web` с runtime session reference.
4. При завершении `Antarctica` записывать completion event и архивировать разовую покупку.
5. Для завершенной разовой игры открывать журнал ходов `Antarctica` и проверить сохранение журнала после закрытия игровой сессии.

### 6. Implement Link Rules

1. Разовая ссылка: одна launch session на весь срок, продолжение последнего состояния независимо от устройства, архивирование после завершения.
2. Дневная ссылка: срок действия с `00:00:00` до `23:59:59` московского времени выбранной даты.
3. Месячная ссылка: генерация сессии только в купленный период, срок каждой сессии 48 часов с момента генерации.
4. Вести счетчик копирований/ссылок и журнал событий.
5. Для истекшей ссылки показывать понятное состояние и рекомендацию обратиться в поддержку для продления.

### 7. Implement Game Type Behavior

1. Однопользовательская игра: device token в cookie определяет, какое состояние продолжать.
2. Многопользовательская игра: состояние привязано к номеру launch session.
3. Для многопользовательских покупок показать кнопку `Сессии` в таблице ссылок.
4. В модальном окне сессий показать активные сессии, сроки действия, счетчик запусков и кнопку admin.

### 8. Prepare Test VPS Deployment

1. Выбрать минимальный deploy shape: Docker Compose или process manager behind reverse proxy.
2. Поднять PostgreSQL как источник истины для портала и сессий.
3. Развернуть portal, runtime-api и player-web в одном тестовом окружении.
4. Настроить домены, HTTPS, `.env`, миграции и seed.
5. Добавить health/readiness checks и базовые structured logs.
6. Описать backup/restore минимум для PostgreSQL.

### 9. Verification

1. `npm run build` для портала.
2. Runtime/player canonical checks.
3. Unit tests для расчета сроков ссылок.
4. Integration tests для копирования ссылки, перехода, повторного перехода и истечения срока.
5. E2E smoke test: консультант копирует ссылку `Antarctica`, игрок запускает игру, повторный переход продолжает нужную сессию.
6. Admin smoke test: многопользовательская сессия видна в списке и открывает admin window только с правами.
7. Journal smoke test: завершенная разовая ссылка открывает сохраненный журнал ходов.

## Acceptance

- Test VPS открывает портал и страницу покупок.
- Консультант входит по логину/паролю.
- В портале есть купленная `Antarctica`, созданная через платежную заглушку.
- Копирование ссылки показывает `Ссылка скопирована в буфер обмена`.
- Для разовой, дневной и месячной ссылки выполняются разные правила генерации launch session.
- Переход по ссылке запускает или продолжает `Antarctica` через runtime/player boundary.
- Срок действия и статус ссылки проверяются на backend side.
- `launch_count` увеличивается только при создании новой runtime session.
- Дневная ссылка считается по московскому времени.
- Для многопользовательской игры доступен список активных сессий.
- Admin window требует login/password и проверку прав.
- Завершенная разовая игра переводится в архив и открывает сохраненный журнал ходов `Antarctica`.

## Open Questions

1. Где именно будет проходить boundary между Strapi custom API и будущим собственным portal/session module?
2. Какой минимальный формат журнала ходов `Antarctica` должен быть возвращен player/runtime API после завершения?
3. Подтвердить one-time override: разовая ссылка всегда одна runtime session даже для single-player.
4. Подтвердить storage для device token на первом VPS: рекомендуется cookie; localStorage оставить только для demo/local mode.

## Validation

```text
npm run build --prefix draft/cubica-portal-nextjs
npm run build --prefix apps/portal-nextjs
npm run test:portal-rules --prefix services/portal-backend
npm run verify:canonical
```

Current validation notes:

- `npm run build --prefix apps/portal-nextjs` passes after the first frontend/backend launch-link integration.
- `npm run test:portal-rules --prefix services/portal-backend` passes for Moscow day bounds, month 48-hour windows and closed/expired session checks.
- `node --check` passes for new portal-backend JavaScript files; new Strapi JSON schemas parse successfully.
- `npm ci --prefix services/portal-backend` passed after retrying with longer npm fetch timeouts.
- `npm run build --prefix services/portal-backend` passed for the Strapi admin build.
- `apps/player-web` now contains the first portal launch binding path through `src/presenter/portal-launch-client.ts` and `GamePresenter`; remaining gaps are portal-player-runtime integration coverage, completion event handling, archive/journal behavior, deploy readiness and production policy for the payment stub.

## Artifacts

- `docs/architecture/adrs/032-portal-session-launch-boundary.md`
- `docs/architecture/adrs/033-portal-runtime-session-binding.md`
- `docs/tasks/artifacts/TSK-20260518-portal-test-vps-and-antarctica-launch/session-management-design.md`
- `services/portal-backend/src/api/launch-session/`
- `services/portal-backend/src/api/session-launch-event/`
- `services/portal-backend/src/utils/portal-launch-rules.js`
- `apps/portal-nextjs/src/lib/portalApi.js`

## Handoff Log

### 2026-05-18 — AI agent

- Updated local portal draft from `https://github.com/aproskur/cubica-portal-nextjs` commit `6f1eef790737f498e3d434ffc38f9cf6226a668c`.
- Reviewed current portal structure and recorded architecture gaps against the session-launch target.
- Verified current portal production build with `npm run build`.

### 2026-05-19 — AI agent

- Recorded product decisions: portal path launch links, Moscow timezone, login/password auth, payment stub for first VPS, and `launch_count` as created runtime sessions.
- Found existing Strapi backend and Robokassa payment block in `services/portal-backend`.
- Recommended keeping Strapi short-term for catalog/users/payment/admin while keeping launch session lifecycle behind an explicit service boundary.
- Filled local `draft/cubica-portal-nextjs` with temporary Antarctica test data for visual review.
- Started local draft portal dev server on `http://localhost:3002` and verified `/`, `/games/antarctica`, `/games/my` return `200 OK`.
- Added Strapi decision gate, MVP execution slices, stronger journal/session acceptance, and fixed work-plan numbering.

### 2026-05-19 — AI agent implementation pass

- Added generic Strapi launch-session boundary with `POST /launch-sessions/copy-link`, `GET /launch-sessions/resolve/:token/:counter` and `GET /launch-sessions/active`.
- Added `launch-session` and `session-launch-event` content-types for portal-owned launch records and audit events.
- Added pure portal launch-rule helper and unit tests for Moscow day links, month 48-hour sessions and closed/expired sessions.
- Added generic `POST /orders/payment-stub` for paid order/purchase creation without Robokassa when `PAYMENT_STUB_ENABLED=true`.
- Updated tracked env examples for portal/backend URLs, runtime/player URLs, Robokassa settings and the payment stub flag.
- Integrated `apps/portal-nextjs` with backend-first copy-link behavior, static fallback, exact copy message and multiplayer `Сессии` modal.
- Updated local static portal data to focus on `Antarctica` one-time/day/month plus one multiplayer demo row.
- Known remaining gap: current `player-web` still owns browser-side runtime session creation through localStorage, so the portal resolver returns `runtimeSessionId` and `playerUrl`, but player consumption of that id needs the next player-web integration slice.

### 2026-05-20 — AI agent session-management design pass

- Documented the discovered session gap: portal launch sessions exist, but player-web can still collapse different portal links into one browser-local runtime session.
- Added ADR-033 for portal runtime session binding.
- Added task artifact `session-management-design.md` with link-type/game-type matrix, backend/frontend/runtime work items and acceptance.
- Updated this TSK with remaining gaps, Slice 6 Player Runtime Binding, admin route shape and open decisions.
