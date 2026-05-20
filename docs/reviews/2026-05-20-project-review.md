# Ревью проекта от 2026-05-20

## Оглавление

- [Как понята задача](#как-понята-задача)
- [Термины](#термины)
- [Проверенные источники](#проверенные-источники)
- [Выполненные проверки](#выполненные-проверки)
- [Находки](#находки)
- [Уже зафиксированный долг](#уже-зафиксированный-долг)
- [Рекомендуемый порядок исправления](#рекомендуемый-порядок-исправления)

## Как понята задача

Нужно было провести ревью текущего состояния проекта Cubica и найти ошибки, неполноту или противоречивость документации, а также разрывы между текущей реализацией и целевой архитектурой, которые не выглядят явно оформленными как legacy/debt. Legacy/debt здесь означает намеренно оставленный временный разрыв с планом снятия в `docs/legacy/*`, `NEXT_STEPS.md` или активном `docs/tasks/active/TSK-*`.

## Термины

- TSK - рабочая задача проекта в `docs/tasks/active/`.
- GSR - Gameplay Slice Record, запись с ограниченными деталями переноса конкретного игрового среза.
- CI - Continuous Integration, автоматическая проверка изменений перед слиянием.
- JSON Schema - декларативная схема для проверки структуры JSON-данных.

## Проверенные источники

- `AGENTS.md`
- `PROJECT_OVERVIEW.md`
- `PROJECT_STRUCTURE.yaml`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `docs/architecture/gameplay-slices/README.md`
- `NEXT_STEPS.md`
- `docs/tasks/README.md`
- `docs/tasks/active/*.md`
- `docs/legacy/debt-log.csv`
- `docs/legacy/stubs-register.md`
- `services/runtime-api/`
- `apps/player-web/`
- `apps/portal-nextjs/`
- `services/portal-backend/`
- `packages/contracts/*`

Для проверки подхода к JSON Schema использовалась актуальная документация Ajv через Context7: Ajv компилирует JSON Schema в валидатор и должен быть основным механизмом проверки структуры, а не заменяться ручными проверками.

## Выполненные проверки

- `npm run verify:canonical` - проходит.
  - `services/runtime-api`: typecheck, 71/71 тест, smoke - проходят.
  - `apps/player-web`: typecheck и production build - проходят.
- `npm test --workspace @cubica/player-web` - проходит, 98/98 тестов.
- `npm run test:portal-rules --prefix services/portal-backend` - проходит, 9/9 тестов.
- `pwsh -File scripts/ci/validate-legacy.ps1` - не запущен локально: в окружении нет `pwsh`.
- Проверка парсинга `.desc.json` выявила 5 невалидных файлов.

## Находки

### 1. `PROJECT_STRUCTURE.yaml` не является полным источником текущей структуры задач

Серьезность: high.

`NEXT_STEPS.md:28-33` ссылается на шесть активных TSK-файлов в `docs/tasks/active/`, но `docs/tasks/active/.desc.json:1-4` описывает только один файл, поэтому `PROJECT_STRUCTURE.yaml:20-21` показывает только `TSK-20260518-architecture-repair-and-task-system-migration.md`.

Почему это проблема:

- `PROJECT_STRUCTURE.yaml` объявлен единственным machine-readable источником структуры репозитория.
- Следующий агент или разработчик, читающий структуру проекта, не увидит активные задачи по portal launch, JSON Schema, workspace cleanup, readiness, persistence и contracts neutrality.
- Это не выглядит намеренным legacy-разрывом: в `NEXT_STEPS.md` эти задачи активны, но структурный индекс их скрывает.

### 2. Несколько `.desc.json` невалидны, а генератор структуры молча игнорирует ошибки

Серьезность: high.

Невалидные файлы:

- `services/router/.desc.json:1`
- `services/game-repository/.desc.json:1`
- `apps/player-web/public/images/.desc.json:1`
- `services/game-engine/.desc.json:1`
- `draft/antarctica-nextjs-player/.desc.json:1`

Во всех случаях файл содержит буквальные `\n` внутри JSON вместо настоящих переводов строк, из-за чего `JSON.parse` падает. `scripts/dev/generate-structure.js` при ошибке парсинга делает `catch (e) {}` и продолжает без сообщения, поэтому структурные ошибки становятся невидимыми.

Дополнительное противоречие: `docs/legacy/debt-log.csv:13` говорит, что `services/router` отсутствует в текущей структуре, но каталог и код существуют (`services/router/src/sessionEvents.ts`, `services/router/src/sessionRecovery.ts`). Вероятно, он отсутствует в `PROJECT_STRUCTURE.yaml` именно из-за битого `.desc.json`, а не из-за физического отсутствия.

### 3. Реестр legacy/debt и реестр заглушек расходятся

Серьезность: high.

`docs/legacy/debt-log.csv:4-7` содержит активные записи `LEGACY-0003`, `LEGACY-0004`, `LEGACY-0005`, `LEGACY-0006`, но `docs/legacy/stubs-register.md:31-38` в текущих заглушках содержит только `LEGACY-0001`, `LEGACY-0009`, `LEGACY-0010`, `LEGACY-0011`, `LEGACY-0012`.

Отдельно `LEGACY-0006` указывает `SDK/extensions/`, но такого пути в репозитории нет. Значит, если legacy-валидатор будет запущен в окружении с PowerShell, он должен упасть на проверке `stub_reference`.

Также `PROJECT_OVERVIEW.md:222-223` утверждает, что все заглушки фиксируются в `stubs-register.md`, а CI-проверка блокирует незарегистрированные заглушки. Но `scripts/ci/validate-legacy.ps1:46-50` проверяет только обратное направление: каждый id из `stubs-register.md` должен существовать в `debt-log.csv`. Он не проверяет, что каждая активная строка `debt-log.csv` есть в `stubs-register.md`.

Итог: реестр долга сейчас нельзя считать надежным механизмом управления legacy.

### 4. Документация portal launch устарела относительно реализации runtime binding

Серьезность: medium.

`docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md:76-78`, `:360` и `:398` говорят, что `player-web` еще не использует portal launch context, что `runtime_session_binding` отсутствует, а portal backend создает placeholder `runtime_session_id`.

Фактический код уже содержит:

- чтение `launchToken` / `launchCounter` и scoped storage key в `apps/player-web/src/presenter/portal-launch-client.ts:69-99`;
- приоритетный bind через portal endpoint в `apps/player-web/src/presenter/game-presenter.ts:145-158`;
- повторный bind при reset в `apps/player-web/src/presenter/game-presenter.ts:202-216`;
- backend route `POST /launch-sessions/resolve/:token/:counter/runtime-binding` в `services/portal-backend/src/api/launch-session/routes/01-custom-launch-session.js:26-32`;
- orchestration создания/возобновления runtime session в `services/portal-backend/src/api/launch-session/services/launch-session.js:595-690`.

Что остается реальным gap:

- нужны integration/e2e проверки portal -> player -> runtime на уровне полного окружения;
- completion event, архивирование one-time покупки и журнал завершенной игры еще не закрыты;
- production migrations/deploy/readiness для portal backend не закрыты.

Но текущая TSK формулирует уже реализованную часть как отсутствующую, поэтому следующая работа может пойти по ложному следу.

### 5. Есть ссылки на несуществующие документы и файлы

Серьезность: medium.

Найдены битые ссылки:

- `PROJECT_OVERVIEW.md:65` ссылается на `services/runtime-api/HANDOFF.md`, которого нет.
- Все текущие GSR-файлы `020-029` ссылаются на `services/runtime-api/HANDOFF.md`, которого нет.
- `docs/architecture/gameplay-slices/README.md:36` индексирует `GSR-030`, но файла `docs/architecture/gameplay-slices/030-*.md` нет.
- `apps/player-web/README.md:54` ссылается на `CONTRACT_INDEX.md`, которого нет в `apps/player-web/`.
- `apps/player-web/README.md:56` ссылается на `src/lib/antarctica.ts`, но актуальная Antarctica-логика живет в `src/plugins/antarctica/*` и presenter/config слоях.
- `apps/player-web/README.md:65` ссылается на `src/components/antarctica-s1-renderer.test.tsx`, которого нет.

Это не просто косметика: `HANDOFF.md` и GSR-030 заявлены как источники текущего canonical context и parity plan, но фактически отсутствуют.

### 6. `verify:canonical` не запускает `player-web` тесты

Серьезность: medium.

`package.json:20-22` определяет:

- `verify:runtime-api` = typecheck + tests + smoke;
- `verify:player-web` = typecheck + build;
- `verify:canonical` = runtime-api verification + player-web verification.

При этом `docs/tasks/active/TSK-20260518-architecture-repair-and-task-system-migration.md` требует запускать `npm test --workspace @cubica/player-web`, а в handoff фиксирует прохождение player-web тестов. Фактически главный canonical gate не включает эти тесты. Сейчас они проходят отдельно, но будущий регресс в DOM/rendering тестах может не попасть в `verify:canonical`.

### 7. `PROJECT_OVERVIEW.md` смешивает текущую deterministic reality и исторический LLM-first target

Серьезность: medium.

Документ корректно говорит, что текущий canonical slice использует deterministic runtime (`PROJECT_OVERVIEW.md:61`, `:228-230`). Но ниже раздел `LLM-first архитектура и игровые манифесты` формулирует исторический target как настоящее состояние: `PROJECT_OVERVIEW.md:88`, `:113-114` говорят, что LLM выступает игровым движком.

Риск: новый разработчик может считать, что текущий runtime path обязан идти через Router/Game Engine/LLM, хотя фактически canonical path сейчас `games/antarctica/game.manifest.json` -> `services/runtime-api` deterministic handlers -> `apps/player-web`.

Похожее локальное противоречие есть в `PROJECT_OVERVIEW.md:102`: там заявлена строгая валидация стандартных сущностей в `data`, но текущий код использует `new Ajv({ allErrors: true, strict: false })` в `services/runtime-api/src/modules/content/manifestValidation.ts:23`. Сам `strict: false` уже учтен в `TSK-20260518-json-schema-strict-validation`, но overview все равно описывает целевое состояние как текущее.

### 8. Валидация манифеста частично ушла в императивную проверку

Серьезность: low/medium, потому что частично уже покрыто активной TSK.

ADR-025 и `AGENTS.md` требуют JSON Schema как single source of truth. В `services/runtime-api/src/modules/content/manifestValidation.ts:38-50` после Ajv добавлена ручная cross-validation проверка `templateId`. Это не обязательно неправильно как временный guard, но сейчас не видно отдельной записи, объясняющей, почему это не часть JSON Schema и как этот guard будет снят или перенесен в декларативную схему.

Ближайшая существующая задача `TSK-20260518-json-schema-strict-validation` покрывает строгий режим Ajv, но стоит явно включить туда перенос `templateId` reference validation в JSON Schema или документированное исключение.

## Уже зафиксированный долг

Не считаю новыми незарегистрированными разрывами, потому что они уже есть в активных задачах или legacy-реестре:

- `InMemorySessionStore` как production persistence debt: `LEGACY-0009`, `TSK-20260518-session-persistence-hardening`.
- readiness без проверки content loading: `LEGACY-0010`, `TSK-20260518-runtime-repository-boundary-and-readiness`.
- `SDK/viewers/web-base` как scaffold: `LEGACY-0011`, `TSK-20260518-workspace-project-references-cleanup`.
- game-specific mentions в contracts layer: `TSK-20260518-contracts-neutrality-cleanup`.
- `strict: false` у Ajv: `TSK-20260518-json-schema-strict-validation`.
- portal launch completion/journal/admin/deploy gaps: частично отражены в `TSK-20260518-portal-test-vps-and-antarctica-launch`.

## Рекомендуемый порядок исправления

1. Починить `.desc.json` и сделать `generate-structure.js` fail-fast при невалидном JSON.
2. Обновить `docs/tasks/active/.desc.json`, затем запустить `node scripts/dev/generate-structure.js`.
3. Синхронизировать `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md`; отдельно решить `LEGACY-0006` с несуществующим `SDK/extensions/`.
4. Обновить `TSK-20260518-portal-test-vps-and-antarctica-launch.md`: заменить уже закрытые runtime-binding gaps на оставшиеся integration/completion/deploy gaps.
5. Удалить или заменить ссылки на отсутствующие `HANDOFF.md`, `GSR-030`, `CONTRACT_INDEX.md`, `src/lib/antarctica.ts` и старые test filenames.
6. Добавить `npm test --workspace @cubica/player-web` в `verify:player-web` или явно переименовать `verify:canonical` так, чтобы он не воспринимался как полный test gate.
7. Переформулировать `PROJECT_OVERVIEW.md`: отделить current canonical execution path от historical/target LLM-first architecture.
