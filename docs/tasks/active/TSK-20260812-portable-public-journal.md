# TSK-20260812-portable-public-journal: Общий переносимый журнал партии

## Оглавление

- [Status](#status)
- [Parent](#parent)
- [Why](#why)
- [Scope](#scope)
- [Plan Approval](#plan-approval)
- [Plan](#plan)
- [Execution](#execution)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Plan Amendments](#plan-amendments)
- [Handoff Log](#handoff-log)

## Status

review

## Parent

TSK-20260711-cards-money-trains-game

## Why

Ведущему нужен полный фактический журнал партии, который можно сохранить,
проверить и передать независимо от интерфейса конкретной игры. Технический
`public.log` уже помогает отрисовке, но не является переносимым контрактом и не
гарантирует связь с защищённой последовательностью подтверждённых событий.

## Scope

Входит:

- schema-first JSON-формат безопасной проекции публичных событий;
- аутентифицированное чтение живой сессии и архива ведущего;
- общий browser-safe путь скачивания JSON;
- нейтральная серверная фикстура и сценарий «Карты, деньги, поезда»;
- синхронизация OpenAPI, архитектуры, игрового среза и legacy-записи.

Не входит:

- ИИ-интерпретация, рефлексия или оценка участников (`LEGACY-0054`);
- изменение счёта, состояния, квитанций или доступности действий;
- CSV/PDF, редактор отчётов и отдельное хранилище журнала;
- публикация журнала по ссылке без session credential.

## Plan Approval

not_required для исполнительского плана. Архитектурная граница отдельно принята
PM 2026-08-12 и записана в ADR-103.

## Plan

1. Основной агент (Sol high, высокий риск) фиксирует ADR, JSON Schema, безопасные
   поля, доверительную границу и критерии общей возможности.
2. Luna-исполнитель реализует ограниченную серверную проекцию, маршрут, OpenAPI
   wiring и нейтральные тесты в заранее фиксированном контракте.
3. Второй Luna-исполнитель реализует общий BFF/client download и доступный UI без
   игровых идентификаторов, затем добавляет CMT browser proof.
4. Основной агент последовательно запускает schema, runtime, Player Web и CMT
   проверки. Дорогие suites и сборки не идут параллельно.
5. Независимый Luna-критик проверяет интегрированный diff, безопасность,
   отрицательные случаи и соответствие принятой границе. Luna-исполнитель
   исправляет подтверждённые дефекты; основной агент выполняет финальную приёмку.

Проверка на упрощение: используется существующий event ledger, session bearer и
BFF; новые база, очередь, фоновая задача, игровой плагин и второй формат не нужны.

## Execution

- Architecture and contract: completed (primary/Sol high). ADR-103, JSON Schema,
  derived TypeScript and bounded store boundary are synchronized.
- Runtime projection and route: completed (Luna high, reviewed by primary).
  Live/archive authorization, limit-plus-one scan and PostgreSQL
  `metricChanges` persistence are implemented.
- Player Web and CMT proof: completed (Luna high, reviewed by primary). BFF
  preserves exact bytes, the map-first link is clickable and the real CMT flow
  verifies `cargo.loaded` on the exact boundary.
- Critic/fix cycle: completed. Independent Luna review found four defects;
  bounded reading, PostgreSQL persistence, E2E specificity and UI overlap were
  corrected and rechecked.

## Acceptance

- [x] JSON Schema является источником истины, производный TS не имеет drift.
- [x] В документ попадают только `audience=public`; защищённые идентификаторы и
  события других аудиторий отсутствуют.
- [x] Записи строго упорядочены, граница `throughEventSequence` полна и не
  меняется от чтения.
- [x] Live export требует credential сессии; архивный export доступен только
  ведущему через существующую archive boundary.
- [x] Плеер скачивает точные серверные JSON-байты и не реконструирует журнал.
- [x] Нейтральная фикстура и настоящий CMT-сценарий проходят без game-id ветки в
  общих слоях.
- [x] ИИ-зависимости, интерпретация и изменение gameplay state отсутствуют.

## Validation

- schema generation/check и AJV contract tests;
- `npm run verify:api-contracts`;
- сфокусированные runtime journal tests и runtime typecheck;
- сфокусированные Player Web BFF/client/component tests и typecheck;
- CMT browser/integration proof;
- `npm run verify:game-agnostic`, `npm run verify:legacy`,
  `npm run verify:agent-instructions`, `git diff --check`;
- полные затронутые suites на финальной границе, если узких доказательств
  недостаточно.

Фактически выполнено 2026-08-13:

- contracts schema parity, session AJV tests и typecheck — пройдены (7/7);
- runtime journal — 4/4, PostgreSQL store — пройден, полный Runtime API — 371
  успешно и 2 штатно пропущено; runtime typecheck и OpenAPI validator пройдены;
- Player Web BFF/component — 19/19, полный Player Web — 280/280;
  после нормализации fixtures участников сессии Player Web typecheck — пройден;
- CMT browser proof повторно запущен основным агентом на изолированных портах
  3230/3231 и пройден; проверено точное событие `cargo.loaded` в скачанном
  журнале;
- реальная PostgreSQL integration не запускалась: в окружении отсутствует
  `TEST_POSTGRES_DATABASE_URL`; миграция и адаптер доказаны unit-контуром.

## Artifacts

- `docs/tasks/artifacts/TSK-20260812-portable-public-journal/implementation-decisions.md`
  — спорные исполнительские решения и условия пересмотра.

## Plan Amendments

- 2026-08-12: PM принял общий переносимый журнал; ИИ-интерпретация явно оставлена
  следующему этапу. Это активировало `LEGACY-0053`, но не `LEGACY-0054`.

## Handoff Log

### 2026-08-12 — primary/Sol high

- Прочитаны обязательные инструкции contracts/runtime/player/tasks/games и
  правила маршрутизации субагентов.
- Два Luna scout независимо подтвердили источник истины, отсутствие export API,
  существующий BFF и пригодность CMT production scenario.
- Принятая граница записана в ADR-103; начата schema-first реализация.

### 2026-08-13 — primary/Sol high

- Два Luna-исполнителя реализовали независимые runtime и Player Web блоки;
  основной агент проверил интегрированный diff и свежие результаты.
- Luna-критик обнаружил неограниченное чтение, потерю `metricChanges` в
  PostgreSQL, слабое browser assertion и перекрытие ссылки картой. Luna-fix
  cycle устранил все четыре дефекта; дополнительный E2E воспроизвёл и закрыл
  фактическое перекрытие pointer events.
- Первый browser запуск случайно переиспользовал чужой Runtime от 2026-07-20 на
  порту 3201. Чистый повтор на изолированных 3230/3231 прошёл; чужой процесс не
  останавливался и не изменялся.
- `LEGACY-0053` закрыт. `LEGACY-0054` сохранён активным; переход к
  ИИ-интерпретации намеренно остановлен по указанию PM.
