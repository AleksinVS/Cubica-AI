# TSK-20260827-cmt-ai-debrief: ИИ-черновик итогового разбора CMT

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

Ведущему нужен проверяемый черновик итогового разбора партии, который опирается
на подтверждённые игровые факты и помогает провести учебную рефлексию без
ручного просмотра всего журнала. Первый срез должен доказать полезность ИИ, не
отдавая ему управление игрой и не создавая новую непрозрачную оценку людей.

## Scope

Входит:

- принятая архитектурная граница ADR-104;
- schema-first контракт фактов, интерпретаций и вопросов;
- facilitator-only Runtime API для чтения и явного запуска;
- Z.AI `glm-4.7` adapter с ограничениями времени/размера и без auto-retry;
- один долговечный черновик и полный аудит без повторной копии журнала;
- одинаковая семантика PostgreSQL и in-memory;
- credential-holding BFF и CMT UI после финала;
- нейтральные проверки и CMT browser proof;
- два новых долга по приватности и окончательной политике аудита.

Не входит:

- изменение счёта, состояния, квитанций, событий или доступности действий;
- production Agent Runtime provider для AI-driven игроков;
- ручное редактирование/версии черновика и автоматическая публикация командам;
- психометрия, индивидуальные скрытые оценки, PDF и сравнение партий;
- отдельный сервис, очередь, векторная база или RAG.

## Plan Approval

not_required для исполнительского плана. PM 2026-08-27 отдельно принял
архитектурные решения о Z.AI `glm-4.7`, временно широкой внешней обработке,
жизненном цикле одного черновика и составе аудита. Они записаны в Accepted
ADR-104; оставшиеся решения являются ограниченными деталями реализации.

## Plan

1. Основной агент, Sol high: зафиксировать ADR-104, GSR-051, JSON Schema,
   доверительную границу, хранение, ошибки и критерии проверки.
2. Основной агент, Sol high, критический блок: реализовать аутентификацию,
   provider adapter, конкурентное хранение и миграцию без зависимости от
   мутационного Agent Turn.
3. Luna-исполнитель: в фиксированном контракте реализовать BFF, доступный CMT
   UI и сфокусированные тесты без изменений серверной архитектуры.
4. Основной агент последовательно запускает contract/runtime/store/player/CMT
   проверки. Полные suites и builds не запускаются параллельно.
5. После Luna-исполнителя Luna xhigh выполняет предварительный read-only обзор
   его UI/BFF diff; подтверждённые дефекты исправляет Luna-исполнитель, затем
   сфокусированные тесты повторяются.
6. Независимый Sol-high reviewer проверяет изменённые public contract, trust,
   storage, provider и UI boundaries. Основной агент выполняет финальную
   этапную приёмку, после чего изменения могут быть объединены в `main`.

Проверка на упрощение: один модуль Runtime, одна таблица попыток с уникальным
успешным результатом, существующий event ledger, session credential и BFF.
Отдельные service/worker/queue, shared provider framework, Cubica Surface и
редактор черновика не нужны первому доказанному случаю.

## Execution

- Architecture and planning — `completed`: решения PM записаны в ADR-104 и
  GSR-051; официальный API Z.AI подтверждает `glm-4.7`, Chat Completions и JSON
  mode.
- Contract/provider/runtime/store — `completed-focused`: schema-first контракт,
  фиксированный Z.AI adapter, одинаковые in-memory/PostgreSQL операции,
  facilitator-only GET/POST и восстановление stale-run реализованы; реальная
  PostgreSQL integration ожидает доступную disposable БД.
- Player/CMT — `completed`: CMT-плагин сообщает доступность только из
  проверенного финального результата, Player показывает сворачиваемый разбор,
  а опубликованный bundle пересобран с новым хешем.
- Critic/fix — `completed`: Luna xhigh обнаружил устаревший production bundle;
  Luna-исполнитель пересобрал его каноническим генератором, основной агент
  добавил проверки выгрузки provider и отсутствующей регистрации.
- Primary acceptance — `completed-focused`: Sol high проверил общий diff,
  provenance UI, production build и настоящий CMT browser flow до финала и
  reload. Независимый Sol-high review перед `main` остаётся последним gate.

Параллельный блок participant credential recovery владеет другим смысловым
контрактом, но меняет часть тех же session/runtime/player файлов. До его
интеграции эта задача пишет только новые документы и не перезаписывает чужие
решения; общий код будет перенесён на свежий `origin/main`.

## Acceptance

- [x] JSON Schema — источник формы; derived TypeScript и OpenAPI не расходятся.
- [x] Только facilitator может узнать статус, запустить и прочитать черновик.
- [x] Runtime отправляет Z.AI фиксированную модель `glm-4.7`, не принимает
  endpoint/model/prompt от клиента и не раскрывает API key.
- [x] В accepted draft факты и интерпретации разделены, ссылки событий валидны.
- [x] Один успешный draft сохраняется на сессию и переживает restart/archive;
  повтор не вызывает provider.
- [x] Неуспешные попытки сохраняются, auto-retry отсутствует, явный повтор
  безопасен, конкурентный запуск не создаёт два provider calls.
- [x] Аудит хранит согласованный корпус без копии журнала, но с точным SHA-256.
- [x] Создание/чтение не меняют state version, event sequence и gameplay state.
- [x] CMT показывает control только после финала, доступно сообщает статус и
  после reload показывает тот же результат.
- [x] Нейтральная фикстура доказывает отсутствие CMT id/семантики в общих слоях.
- [x] Privacy и audit-governance gaps записаны как ограниченный долг.

## Validation

- генерация контрактов и schema/OpenAPI parity;
- focused contracts-session tests и typecheck;
- focused Runtime debrief/provider/store tests и runtime typecheck;
- миграция PostgreSQL и disposable integration при доступной локальной БД;
- focused Player BFF/component tests и typecheck;
- CMT plugin tests, bundle freshness и один browser proof после финала;
- `npm run verify:game-agnostic`, `npm run verify:legacy`,
  `npm run verify:agent-instructions`, `git diff --check`;
- production build только после low-memory preflight.

Реальный внешний вызов Z.AI не выполняется без отдельно предоставленного
credential и разрешённого тестового окна; adapter проверяется injected fake
transport. Это не препятствует проверке контракта и fail-closed поведения.

Свежая этапная проверка 2026-08-27:

- Runtime provider/service/store/PostgreSQL mapping/migration — `61/61`,
  runtime typecheck, OpenAPI и generated-contract drift — PASS;
- Player debrief/BFF/registry/loader/GamePlayer — `70/70`, Player typecheck —
  PASS;
- CMT plugin — `83/83`, typecheck — PASS; plugin schema — `61/61`, published
  bundle integrity — `2/2`, game-agnostic — `10/10`;
- production Player build — PASS;
- нормативный production browser flow — `1/1` за 6,8 минуты: реальный финал
  CMT, точная `expectedStateVersion`, видимые draft id/journal SHA-256 и тот же
  результат после reload;
- полный `verify:canonical:ci` прошёл все продуктовые проверки; первый запуск
  остановился только перед Editor Web из-за отсутствующего workspace-link
  `@cubica/product-context` в отдельном worktree, после безопасной локальной
  связи его typecheck и production build прошли без изменений исходников.

Не выполнены намеренно: реальный вызов Z.AI без credential и disposable
PostgreSQL integration без `TEST_POSTGRES_DATABASE_URL`/локальной БД. Тест
реального restart/archive присутствует и компилируется; миграция и оба store
проверены сфокусированно, но фактический драйвер PostgreSQL остаётся
эксплуатационной проверкой следующего доступного DB-окна.

## Artifacts

- `docs/tasks/artifacts/TSK-20260827-cmt-ai-debrief/implementation-decisions.md`
  — автономные детали и условия пересмотра.

## Plan Amendments

- 2026-08-27: PM активировал `LEGACY-0054` и принял provider/model, временную
  внешнюю обработку, один session-lifetime draft и audit-with-journal-hash.

## Handoff Log

### 2026-08-27 — primary/Sol high

- Base: `origin/main` at `86c4c2a`; working branch
  `agent/cmt-ai-debrief-20260827` in a clean separate worktree.
- Coordination: exclusive shared boundary опубликована в `NEXT_STEPS.md`;
  чужой participant credential recovery не изменялся.
- Research: официальный Z.AI API подтвердил general Chat Completions endpoint,
  `glm-4.7`, управляемый thinking и `json_object` response format.
- Next: дождаться интеграции пересекающегося recovery-блока, обновиться от
  `origin/main`, затем реализовать contract/runtime/store.

### 2026-08-27 — completion candidate

- Recovery-блок объединён в `main`, после чего ветка обновлена без потери его
  participant/session границ.
- Contract, provider, migration, in-memory/PostgreSQL stores, facilitator-only
  HTTP, BFF, Player и CMT plugin реализованы отдельными проверяемыми коммитами.
- Luna-цикл UI завершён; единственная находка критика — stale published bundle
  — исправлена генератором. Основной агент добавил видимый provenance и
  production browser proof после reload.
- Ветка готова к независимому Sol-high review и отдельной чистой интеграции в
  `main`; открыты только принятые `LEGACY-0084/0085` и описанные выше внешние
  проверки credential/PostgreSQL.
