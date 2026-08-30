# TSK-20260831-project-review-remediation: Исправление находок ревью 2026-08-31

## Оглавление

- [Status](#status)
- [Parent](#parent)
- [Why](#why)
- [Scope](#scope)
- [Plan Approval](#plan-approval)
- [Architecture Decisions](#architecture-decisions)
- [Plan](#plan)
- [Execution](#execution)
- [Оркестрация и границы владения](#оркестрация-и-границы-владения)
- [Проверка на упрощение](#проверка-на-упрощение)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Plan Amendments](#plan-amendments)
- [Handoff Log](#handoff-log)

## Status

planned

Независимые fail-closed исправления готовы к исполнению. Семь блоков,
меняющих public/trust/storage/product boundary, ожидают решений PM; они не
блокируют остальные волны.

## Parent

none

Источник: `TSK-20260717-code-architecture-conformance-review`.

## Why

Ревью базовой линии `1f916d5` подтвердило зелёный основной pipeline, но нашло
49 незарегистрированных дефектов и 12 противоречий архитектурной документации.
Три находки блокируют безопасное продолжение: гонка аренды Editor допускает
потерю данных, preview может пересечь файловую границу сессий, а Portal не
способен создать первую Runtime-сессию по строгому контракту.

После фиксации реестра проверен входящий диапазон `1f916d5..09cd863`.
Добавленная локальная диагностика Product Context DR-20 не закрывает F-037
(lease fencing), F-038 (потоковый лимит ответа) или F-039 (CI isolation gate);
остальные изменения этого диапазона относятся к правилам worktree и статусу
shadow-evaluation. Поэтому состав находок сохранён, а исполнять их нужно уже от
актуального `main` с повтором узких baseline-проверок затронутого потока.

Пользовательский результат этой задачи: authoring и preview не теряют и не
исполняют чужие данные, portal-запуск и оплата имеют честную атомарную
семантику, runtime/player контракты проверяются в обе стороны, CMT regression
stand не скрывает красные сценарии, а архитектурная документация снова
однозначно описывает действующую платформу.

## Scope

Входит:

- все F-001..F-049 из реестра ревью;
- синхронизация D-001..D-012 с уже принятыми решениями;
- focused negative/integration tests и усиление affected/canonical gates;
- bounded debt только для остатка, который PM явно отложит;
- обновление ADR/`PROJECT_ARCHITECTURE.md` после решений PM.

Не входит:

- новая продуктовая функциональность, не нужная для снятия находки;
- полная переработка Editor, Portal, Runtime или Player;
- реальный production rollout Robokassa, Z.AI либо hosted collaborative
  authoring;
- перенос всего проекта на новый service/framework;
- повторное ревью неизменённых частей репозитория после каждого блока.

## Plan Approval

`not_required`: задача создана по прямому запросу PM подготовить документацию
для исправления подтверждённых находок. Новые архитектурные границы
согласуются отдельно в `architecture-decisions.md`.

## Architecture Decisions

Сейчас явно требуют решения PM:

1. server-owned commercial offer и payment state machine (AD-01);
2. cross-device Runtime credential claim/reissue (AD-02);
3. межсервисная идемпотентность Portal binding (AD-03);
4. Cubica Surface catalog/props compatibility (AD-04);
5. hybrid failure policy (AD-05);
6. trusted preview origin bootstrap (AD-06);
7. фактическая гарантия ИИ-разбора CMT (AD-07).

Этот список не отменяет условный stop: F-010, F-020, F-029, F-037, F-046 и
любой другой блок возвращаются на архитектурную классификацию, если
минимальное исправление меняет публичную форму, source of truth, trust
boundary или постоянное хранение. F-035 исполняет уже одобренную code-owned
политику закрытия core routes из `TSK-20260803-portal-access-control`, а D-009
сужает только web/runtime-часть ADR-006 по более позднему Accepted ADR-059.

Рекомендуемые варианты и последствия находятся в
`docs/tasks/artifacts/TSK-20260831-project-review-remediation/architecture-decisions.md`.

## Plan

### Волна 0. Честная базовая линия

- [ ] F-002: исправить Portal `CreateSessionRequest` и добавить настоящий
  Portal -> Runtime contract test.
- [ ] F-044: восстановить CMT mock control/full replay, привести provenance к
  схеме и подключить focused gate к affected pipeline.
- [ ] Зафиксировать исходные отрицательные тесты для F-001 и F-003 до
  изменения реализации.

Gate: узкие тесты воспроизводят прежний отказ и проходят после исправления;
существующий canonical slice остаётся зелёным.

### Волна 1. Потеря данных и межсессионная изоляция

- [ ] W1 Editor: F-001, F-004..F-007, F-010.
- [ ] W2 Preview: F-003, F-018, fail-closed часть F-028, F-029.
- [ ] W6 Product Context: F-037, F-038.

Gate: concurrency, stale-owner, dirty-worktree, symlink, cross-session,
hash-substitution, credential-rotation и oversized chunked-response scenarios
имеют отрицательные тесты. Изменение постоянной схемы или trust contract
останавливает только соответствующий блок для PM-классификации.

### Волна 2. Runtime и клиентские границы

- [ ] W4 Runtime: F-013..F-018, F-041, F-048.
- [ ] W5 Player: F-019..F-025, F-049.
- [ ] W2 Preview UI: F-030 и одобренная часть AD-06.

Gate: anonymous/schema, wrong-role/stale-version, budget overflow, mock-in-prod,
invite cleanup, principal handoff, SSE recovery, plugin disposal и malformed
message corpus проверены. Сравнение с визуальным эталоном выполняет
Sol-high critical reviewer; без эталона итоговую UI/UX-приёмку выполняет
primary Sol-high.

### Волна 3. Portal и коммерческий контур

- [ ] Без новых решений: F-035, F-036 и существующий-browser resume там, где
  он использует уже выданную HttpOnly credential без смены контракта.
- [ ] После AD-01: F-031, F-032.
- [ ] После AD-02: F-033.
- [ ] После AD-03: F-034.

Gate: live-compatible Portal -> Runtime integration, DB transaction failure,
duplicate callback, parallel launch, retry after ambiguous failure, route
inventory и error redaction. Реальный Robokassa rollout остаётся вне задачи.

### Волна 4. Единые источники истины и контрольные шлюзы

- [ ] F-008, F-009, F-011, F-012.
- [ ] F-026 и F-027 после AD-04/AD-05.
- [ ] F-039..F-043.
- [ ] F-045, F-046.

Gate: compiler cache нельзя подменить parseable файлами; schema/route/skill
inventory двунаправленны; OpenAPI запускает affected contract checks;
Product Context isolation входит в CI; game-owned semantics не живёт только в
общем UI.

### Волна 5. ИИ-разбор и архитектурная синхронизация

- [ ] F-047 после AD-07; F-048/F-049 закрыть независимо.
- [ ] D-001..D-012: обновить старые ADR, `PROJECT_ARCHITECTURE.md`, summaries
  и ссылки на долг без создания конкурирующих решений.
- [ ] Зарегистрировать только явно отложенный остаток как bounded debt с
  owner, trigger и removal plan.

Gate: обещания ADR соответствуют реально доказанным гарантиям; все новые или
изменённые статусы имеют однозначное основание в позднем принятом решении либо
явное одобрение PM.

### Интеграционная приёмка

- [ ] Свести законченные потоки в чистом отдельном worktree актуального main.
- [ ] Выполнить review только изменённых shared boundaries и потребителей;
  отдельный Sol-high reviewer обязателен для Editor concurrency/preview trust,
  Portal payments/transactions и общей cross-module интеграции.
- [ ] Запустить полный canonical gate один раз после сведения крупных потоков,
  затем production builds и выбранные browser E2E.
- [ ] Перепроверить реестр F-001..F-049: `fixed`, `accepted-debt` или
  `not-reproducible` с доказательством; молча выпавших пунктов быть не должно.

## Execution

| Поток | Статус | Зависимость | Владелец/ветка |
| --- | --- | --- | --- |
| W0 baseline | pending | нет | назначается перед реализацией |
| W1 Editor lease/mutations/GC | pending | нет | exclusive: `apps/editor-web` session/lease/mutating routes |
| W2 Preview trust/messages | pending | AD-06 только для hosted origin | exclusive integration owner: Runtime preview routes, preview message schema и их OpenAPI; W4 только потребитель до handoff SHA |
| W3 Portal | partially_blocked | AD-01..AD-03 | exclusive integration owner: Portal/Runtime launch contract и его OpenAPI; W4 только потребитель до handoff SHA |
| W4 Runtime/Mechanics/contracts | pending | AD-04/AD-05 только для соответствующих схем | exclusive: остальные Runtime/Mechanics/shared contracts, исключая границы W2/W3 |
| W5 Player/game packages | pending | handoff SHA W2/W3/W4 для contract changes, AD-07 для semantics | exclusive: Player/game files; shared schema не меняет |
| W6 Product Context/operations/CI | pending | нет | разделять concurrency и mechanical CI blocks |
| W7 architecture/docs | partially_blocked | решения PM только при неоднозначном status | primary agent |

Точный исполнитель и branch не фиксируются заранее: оркестратор сверяет
`NEXT_STEPS.md` и текущий diff непосредственно перед делегированием.

## Оркестрация и границы владения

- Архитектура, planning, security/concurrency/payments design, review и
  итоговая приёмка принадлежат primary Sol-high.
- Обычный немеханический bounded block может идти по циклу: Luna executor ->
  focused tests -> optional Luna-xhigh preliminary critic -> Luna correction
  -> primary Sol-high diff/evidence acceptance.
- Механическая правка по уже точному плану может быть выполнена builder-low.
- Не более двух субагентов активируются без трёх действительно независимых
  потоков и доказанной выгоды. Задания передаются на английском с узким и
  глубоким контекстом.
- Субагент не принимает архитектурное решение и не сливает shared boundary.
- На каждой точной shared-границе ровно один integration owner. Зависимый
  поток начинает запись только после handoff с head SHA и bounded Sol-high
  gate изменённого контракта; «совместного exclusive-владения» нет.
- Sol-high этапное ревью ограничивается diff, контрактами и затронутыми
  потребителями; это не просмотр всего репозитория после мелкой правки.

## Проверка на упрощение

Приняты упрощения:

- один корневой TSK и два постоянных источника — реестр находок и решения PM;
- дочерние TSK создаются только при отдельной ветке/приёмке/передаче;
- preview/confirm получают один расчётный путь вместо новой подсистемы;
- existing lease/credential/storage primitives переиспользуются, если это
  сохраняет safety invariant и доказывается тестами;
- один общий streaming response limiter вместо двух реализаций;
- полный canonical прогон выполняется на интеграционном gate, а не после
  каждого небольшого блока.

Дальнейшее упрощение объединением Portal, Runtime и Player credential ownership
изменило бы принятую границу подсистем и поэтому не предлагается.

## Acceptance

- F-001..F-049 имеют доказанный конечный статус; blocker/high не остаются
  незарегистрированными.
- F-001, F-003, F-032, F-034 и F-037 доказаны negative concurrency/security/
  transaction tests, а не только code review.
- Публичные schema/OpenAPI изменения валидируются стандартными валидаторами;
  derived types сгенерированы, handwritten duplicate schema не добавлены.
- Portal впервые создаёт и повторно открывает Runtime-сессию в одобренных
  сценариях; платёжный ACK не возможен без committed purchase.
- CMT mock focused suite и provenance зелёные и входят в релевантный gate.
- D-001..D-012 устранены либо имеют явное решение PM/ограниченный долг.
- Этапное и итоговое Sol-high review не имеют незакрытых blocker/high.
- Не затронуты чужие параллельные изменения; интеграция выполнена из чистого
  worktree без переписывания истории.

## Validation

Точный список уточняется по diff, но минимальный интеграционный набор:

```text
npm run typecheck
npm run verify:canonical
npm run verify:mechanics-locks
npm run verify:api-contracts
npm run verify:contracts-schema-parity
npm run verify:legacy
npm run verify:agent-instructions
node scripts/dev/generate-structure.js --check
node --test games/cards-money-trains-mock/tests/*.test.mjs
git diff --check
```

Дополнительно обязательны focused suites каждого потока, Portal с настоящим
Runtime, disposable PostgreSQL tests для транзакций/аренд и выбранные
two-browser Editor/Player E2E. Z.AI/Robokassa live calls не являются
обязательными для code acceptance и выполняются только отдельным безопасным
rollout-планом.

## Artifacts

- `docs/tasks/artifacts/TSK-20260717-code-architecture-conformance-review/findings.md`
  — исходный проверенный реестр.
- `docs/tasks/artifacts/TSK-20260717-code-architecture-conformance-review/remediation-proposal.md`
  — приоритизация и границы потоков.
- `docs/tasks/artifacts/TSK-20260831-project-review-remediation/architecture-decisions.md`
  — вопросы PM и рекомендуемые варианты.

## Plan Amendments

Нет.

## Handoff Log

### 2026-08-31 — primary agent, документация исполнения

- Baseline: `origin/main` `1f916d5eed7603f63107be543902d8456b921047`.
- Changed: создан корневой remediation TSK, реестр находок, предложение
  очередности и decision packet; исходная review-задача переведена из
  отложенной в выполненное ревью.
- Validation before documentation: `typecheck`, `verify:canonical`,
  `verify:mechanics-locks` прошли; CMT mock — 15/18, provenance — fail.
- Remaining: решения AD-01..AD-07 и реализация волн 0–5.
- Next safe step: Волна 0 без изменения архитектуры — Portal create contract,
  CMT mock/provenance и исходные regression tests F-001/F-003.
- Risks: live PostgreSQL/Strapi/Z.AI/Robokassa и browser E2E не выполнялись;
  текущий основной worktree имеет чужие незакоммиченные docs changes и не
  должен использоваться для интеграции.

### 2026-08-31 — независимое Sol-high ревью документации

- Review scope: новый TSK, реестр F-001..F-049/D-001..D-012, decision packet,
  proposal, task status и `NEXT_STEPS.md`; код повторно целиком не ревьюился.
- Corrections: добавлена traceability до path/symbol, инварианта,
  свидетельства и debt-result; матрица 15 исходных + 3 актуальных срезов;
  условные архитектурные stop; один integration owner на точную shared
  boundary; явная Sol-high UI/UX-приёмка; конкретный stale-registry сценарий
  F-022.
- Result: `ACCEPT`, blocker/high/medium замечаний не осталось.
- Validation: `verify:legacy` и вложенный `verify:agent-instructions` прошли,
  `generate-structure.js --check` и `git diff --check` прошли; JSON metadata
  разобраны, найдено ровно 49 finding ids, 12 drift ids и 46 подробных
  трассировок F-004..F-049.
