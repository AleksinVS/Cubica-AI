# Переносимость Agent UI и контроль рисков

Документ описывает проектную архитектуру, которая снижает риски зависимости от CopilotKit, AG-UI и будущих production LLM backend. Он дополняет ADR-043 и ADR-044.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Термины](#2-термины)
- [3. Целевая позиция](#3-целевая-позиция)
  - [3.1. Целевой Собственный Agent UI](#31-целевой-собственный-agent-ui)
- [4. Стабильные Cubica-контракты](#4-стабильные-cubica-контракты)
- [5. Слои адаптеров](#5-слои-адаптеров)
- [6. Production LLM Backend](#6-production-llm-backend)
  - [6.1. Ворота передачи на production backend](#61-ворота-передачи-на-production-backend)
  - [6.2. Минимальный smoke suite](#62-минимальный-smoke-suite)
- [7. Матрица контроля рисков](#7-матрица-контроля-рисков)
- [8. Контроль узких мест](#8-контроль-узких-мест)
- [9. Планы миграции](#9-планы-миграции)
  - [9.1. Минимальный интерфейс собственной Agent UI панели](#91-минимальный-интерфейс-собственной-agent-ui-панели)
- [10. Контрольные точки ревью](#10-контрольные-точки-ревью)
- [11. Текущая привязка к реализации](#11-текущая-привязка-к-реализации)
- [12. Связанные документы](#12-связанные-документы)

## 1. Назначение

Cubica использует CopilotKit и AG-UI, чтобы быстрее дать помощника редактора, но платформа должна сохранить возможность:

- заменить CopilotKit на собственный UI или другой фреймворк UI помощников;
- заменить AG-UI на другой протокол агентов или прямой протокол Cubica;
- подключить production LLM backend без изменения предметной логики редактора;
- сохранить работоспособность player/runtime потоков без backend помощников.

Этот документ переводит это намерение в конкретные архитектурные правила, контроль рисков и планы миграции.

## 2. Термины

- **Зависимость от поставщика** - ситуация, когда замена библиотеки или поставщика требует широких изменений в предметном коде вместо ограниченной работы с адаптером.
- **Слой адаптера** - заменяемый код перевода между контрактами Cubica и сторонним API или протоколом.
- **Шлюз агента** - серверный маршрут приложения, который принимает трафик помощника из браузера и направляет его в backend агента, оставляя секреты на сервере.
- **Production LLM backend** - продуктовый сервис больших языковых моделей, который владеет промтами, вызовами провайдера, рассуждением, выбором инструментов, оценками качества и наблюдаемостью модели.
- **Frontend tool** - функция на стороне браузера, которую помощник может запросить через UI-слой. Она должна оборачивать существующую команду Cubica или путь валидации.
- **Авторитетное состояние** - долговременное состояние Cubica: манифесты, рабочие копии редактора, runtime-сессии, данные портала, лицензии и записи аудита.
- **Generative UI** - интерфейс, который ИИ-агент выбирает, описывает или обновляет во время работы.
- **Cubica Surface** - собственный контракт Cubica для декларативной UI-поверхности помощника: словарь компонентов, модель данных, действия и диагностика проверки.

## 3. Целевая позиция

Целевая форма:

```text
Пользовательское приложение
  -> заменяемый Agent UI adapter
  -> app-local agent gateway
  -> заменяемый protocol adapter
  -> local dev backend или production LLM backend
  -> инструменты Cubica и шлюзы валидации
```

Стабильный поток Cubica остаётся таким:

```text
запрос помощника
  -> проекция контекста Cubica
  -> запрос инструмента Cubica
  -> валидация Cubica
  -> изменение состояния Cubica или диагностика
```

CopilotKit и AG-UI могут упрощать взаимодействие с помощником. Они не должны определять модель данных редактора, модель игрового состояния или бизнес-модель портала.

### 3.1. Целевой Собственный Agent UI

ADR-045 переводит замену CopilotKit из аварийного сценария в целевую архитектурную траекторию. CopilotKit remains the first-stage MVP adapter, while Cubica should design new assistant and Generative UI features so they can later run on a custom compatible Cubica Agent UI.

This means:

- CopilotKit-specific hooks and components stay in adapter files.
- Stable behavior is described by Cubica contracts: agent run, events, tools, result envelopes and Cubica Surface specs.
- Feature requirements for chat, streaming text, tool calls, approval cards, diagnostics and declarative surfaces should be written against Cubica behavior, not against CopilotKit component APIs.
- A future custom panel should replace the UI adapter while preserving the same context projection, tool catalog, approval policy and audit envelope.

## 4. Стабильные Cubica-контракты

Следующие контракты должны быть описаны и проверены как собственные контракты Cubica:

- реестр помощников: `agentId`, владеющее приложение, поверхность UI, разрешённый контекст, разрешённые инструменты, политика побочных эффектов, уровень аудита и версия;
- проекция контекста: какие поля видит агент и как скрываются секреты;
- каталог инструментов: имя инструмента Cubica, описание, параметры, форма результата и политика побочных эффектов;
- оболочка результата инструмента: `ok`, `summary`, `diagnostics`, необязательная сводка diff и предметные идентификаторы;
- декларативная поверхность UI: `surfaceId`, словарь компонентов, data model, actions, side-effect policy and validation diagnostics;
- валидация команд/change-set: `EditorChangeSet`, dry-run, undo journal и workflow сохранения;
- метаданные аудита: user id, assistant id, имя инструмента, отметка подтверждения, timestamp и correlation id.

Рекомендуемая внутренняя форма:

```text
CubicaAgentRun
  input: CubicaAgentContext
  tools: CubicaAgentToolDefinition[]
  output: CubicaAgentEvent[]
```

Сначала эта форма может жить как TypeScript-интерфейсы в коде приложения. Когда она понадобится помощникам портала или игрока, её нужно перенести в `packages/contracts/ai`.

## 5. Слои адаптеров

### Адаптер CopilotKit

Текущая реализация:

- `apps/editor-web/src/components/editor-agent-ui.tsx`
- `apps/editor-web/app/api/copilotkit/route.ts`

Ответственность:

- монтировать и размонтировать UI помощника под feature flags;
- регистрировать frontend tools;
- передавать ограниченный контекст в CopilotKit;
- маршрутизировать browser traffic через `/api/copilotkit`;
- держать телеметрию CopilotKit выключенной по умолчанию.

Не должен владеть:

- модель документа редактора;
- семантикой `EditorChangeSet`;
- поведением apply/undo/save;
- состоянием runtime или портала.

Цель заменяемости:

- собственный React-чат и renderer вызовов инструментов могут заменить CopilotKit, если они потребляют тот же каталог инструментов Cubica и ту же проекцию контекста.

### Адаптер AG-UI

Текущая реализация:

- `apps/editor-web/app/api/editor/agent/ag-ui/route.ts`
- `apps/editor-web/src/lib/editor-agent-local-backend.ts`
- `apps/editor-web/src/lib/ag-ui-event-adapter.ts`

Ответственность:

- кодировать и декодировать AG-UI run events;
- переводить AG-UI tool calls в запросы инструментов Cubica;
- отклонять небезопасные state deltas, которые целятся в авторитетное состояние;
- давать локальный детерминированный backend для baseline-проверки.

Не должен владеть:

- изменениями канонического состояния;
- persistent message history как предметным состоянием;
- production model prompts;
- предметной валидацией.

Цель заменяемости:

- будущий protocol adapter может заменить AG-UI, если он выдаёт те же события агента Cubica и вызовы инструментов.

### Адаптер production backend

Production backend подключается за шлюзом:

```text
/api/copilotkit
  -> external AG-UI backend from CUBICA_EDITOR_AGENT_AG_UI_URL
```

Будущий backend без AG-UI может подключаться так:

```text
/api/copilotkit or /api/agent
  -> Cubica protocol adapter
  -> production LLM backend
```

Браузер не должен получать ключи провайдера или прямые учётные данные для записи.

## 6. Production LLM Backend

Production LLM backend владеет:

- model provider и version;
- шаблонами промтов;
- логикой выбора инструментов;
- лимитами многошагового рассуждения;
- наблюдаемостью модели;
- replay/evaluation fixtures;
- обработкой отказов провайдера.

Production LLM backend не владеет:

- правом напрямую менять состояние Cubica;
- обходами валидации;
- game-specific runtime branches;
- persistent domain storage;
- секретами на стороне браузера.

Обязательное поведение при передаче на production backend:

1. Backend получает ограниченный контекст и определения инструментов.
2. Backend возвращает текст и запросы вызова инструментов через выбранный протокол.
3. Инструменты Cubica выполняются только через разрешённые UI/server adapters.
4. Изменяющие инструменты требуют подтверждения согласно политике реестра помощников.
5. Результаты инструментов возвращаются backend для последующего объяснения.
6. Финальные долговременные изменения записываются системами Cubica, а не LLM-провайдером.

### 6.1. Ворота передачи на production backend

Production handoff - это передача трафика помощника с локального deterministic backend на внешний backend модели. Передача считается допустимой только при выполнении всех условий ниже:

- `CUBICA_EDITOR_AGENT_AG_UI_URL` указывает на утверждённый серверный backend, а не на provider endpoint из браузера.
- `CUBICA_EDITOR_AGENT_AG_UI_TOKEN` или эквивалентная server-side auth policy настроены для внешнего backend. Токен хранится только на сервере приложения и передаётся как bearer header из `/api/copilotkit`.
- Для production-окружений, где локальный fallback запрещён, `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0` должен быть явным deploy decision. Если этот флаг не задан, локальный backend остаётся только dev/baseline fallback.
- Каждый изменяющий tool call получает audit envelope: `userId`, `assistantId`, `runId`, `toolName`, `approvalState`, `timestamp`, `correlationId` and краткий result summary.
- Перед включением real model traffic должны существовать replay/eval fixtures (записи воспроизведения и оценки качества), совместимые с `CubicaAgentReplayTranscript` and `CubicaAgentEvaluationFixture` из `packages/contracts/ai`.
- Operation policy должна задавать timeout, retry, rate limits and cost controls для agent run and tool calls.

### 6.2. Минимальный smoke suite

Smoke suite - короткая проверка, которая доказывает, что production backend подключён и не обходит Cubica gates. Минимальный набор:

1. Text-only response: пользовательский запрос без tool call возвращает stream сообщений и завершается без изменения состояния.
2. Plan tool call: backend вызывает `editor.planChangeSet`, результат остаётся планом и не применяет изменения.
3. Dry-run tool call: backend вызывает `editor.dryRunChangeSet`, получает diagnostics and diff summary without mutation.
4. Approved mutation: backend вызывает `editor.applyChangeSet` только при human-approved state; без approval tool должен вернуть blocked result.
5. Tool result follow-up: backend получает result envelope and explains status without direct state write.
6. Disabled backend behavior: при выключенном `CUBICA_EDITOR_AGENT_RUNTIME` или недоступном external backend UI показывает controlled unavailable state.
7. Audit/replay capture: accepted and rejected tool calls produce replay-safe records without secret state.

## 7. Матрица контроля рисков

| Риск | Сценарий отказа | Контроль |
| --- | --- | --- |
| Утечка типов CopilotKit | Основные пакеты импортируют API CopilotKit и становятся трудными для замены. | Держать импорты CopilotKit внутри app adapter files; добавить import-boundary tests до production rollout. |
| Утечка состояния AG-UI | `STATE_DELTA` напрямую меняет манифесты или runtime state. | Нормализовать события AG-UI и отклонять deltas, которые целятся в canonical paths. |
| Дрейф политики инструментов | Новые инструменты помощника обходят подтверждение или валидацию. | Каждый инструмент регистрируется с side-effect policy и result envelope. |
| Локальный backend принят за production | Детерминированный backend ошибочно считается доказательством качества модели. | Обозначать локальный backend только как baseline/dev в UI docs и handoff. |
| Чрезмерные права production backend | LLM-сервис напрямую пишет файлы или строки БД. | Production backend получает только определения инструментов и обязан вызывать инструменты Cubica. |
| Избыточная передача контекста | Модель получает целые манифесты, секреты или приватное состояние сессии. | Context projection, лимиты размера и redaction tests. |
| Дрейф зависимостей | Обновления CopilotKit/AG-UI ломают runtime или последовательности событий. | Закреплять версии и запускать typecheck, unit tests, build и protocol smoke tests. |
| Утечка телеметрии | Сторонняя телеметрия отправляет проектные данные. | Выключать телеметрию по умолчанию; любое включение утверждать отдельно. |
| Задержки инструментов | Чат ждёт медленный compile/preview/tool call без обратной связи. | Стримить lifecycle events и показывать прогресс инструментов. Добавить timeouts для backend и tools. |
| Инструменты только в браузере | Будущие non-web клиенты не могут использовать помощника. | Держать tool contracts принадлежащими Cubica и позже разрешить server-side tool adapters. |
| Разрыв аудита | Изменяющие инструменты нельзя связать с user/agent/run. | Добавить correlation ids и audit envelope до production. |
| Дрейф multi-agent routing | Помощники портала, игрока и редактора случайно делят инструменты. | Реестр помощников ограничивает allowed tools и context для каждого agent id. |

## 8. Контроль узких мест

### Узкие места runtime-шлюза

Потенциальное узкое место:

- весь трафик помощника проходит через app-local gateway routes.

Контроль:

- по возможности держать шлюз stateless;
- добавить request ids и обработку timeout;
- изолировать задержку model provider в backend services;
- не блокировать рендер состояния редактора из-за доступности помощника.

### Узкие места выполнения инструментов

Потенциальное узкое место:

- инструменты preview/compile/save могут быть медленнее, чем streaming ответа чата.

Контроль:

- tool calls должны возвращать структурированный прогресс или диагностику;
- long-running tools перед production scale должны стать server-side jobs;
- frontend должен оставаться интерактивным, пока инструмент выполняется;
- изменяющие инструменты должны сохранять undo или rollback path.

### Узкие места протокола

Потенциальное узкое место:

- AG-UI может не покрыть будущий Cubica-specific сценарий взаимодействия.

Контроль:

- использовать AG-UI `CUSTOM` events только на границе адаптера;
- документировать каждое custom event до использования;
- сопоставлять custom events с событиями агента Cubica;
- не сохранять custom protocol events как предметное состояние.

## 9. Планы миграции

### Замена CopilotKit

Примеры триггеров:

- UI CopilotKit блокирует обязательные workflow редактора;
- лицензирование или телеметрия становятся неприемлемыми;
- performance или bundle size становятся неприемлемыми.

Шаги миграции:

1. Оставить реестр помощников, проекцию контекста и инструменты Cubica неизменными.
2. Построить собственный `AgentPanel`, который потребляет `CubicaAgentRun` и `CubicaAgentEvent`.
3. Заменить регистрации `useFrontendTool` на диспетчер инструментов Cubica.
4. Заменить `/api/copilotkit` на `/api/agent` или compatibility route.
5. Запустить те же tests для allowlist инструментов, подтверждения и ChangeSet validation.
6. Удалить импорты CopilotKit из app UI после подтверждения parity.

Ожидаемые неизменные области:

- пакет editor-engine;
- схемы манифестов;
- gameplay logic в runtime-api;
- game bundles;
- реестр помощников и tool policy, кроме импортов адаптера.

### Замена AG-UI

Примеры триггеров:

- production backend использует более подходящий протокол;
- совместимость пакетов AG-UI ломается;
- custom interaction требует более простого протокола Cubica.

Шаги миграции:

1. Оставить каталог инструментов Cubica и result envelope неизменными.
2. Реализовать новый protocol adapter, который выдаёт события агента Cubica.
3. Добавить transcript tests, эквивалентные AG-UI lifecycle/tool-call tests.
4. Оставить `/api/copilotkit` или app gateway стабильными для браузера.
5. Удалить объекты событий AG-UI из app state после подтверждения protocol parity.

Ожидаемые неизменные области:

- предметная логика редактора;
- portal/runtime APIs;
- реестр помощников;
- шлюзы валидации и подтверждения.

### Замена локального backend на Production LLM Backend

Примеры триггеров:

- model provider и требования безопасности утверждены;
- replay/eval baseline существует;
- audit и auth gates готовы.

Шаги миграции:

1. Развернуть production LLM backend, который говорит через AG-UI или protocol adapter Cubica.
2. Задать `CUBICA_EDITOR_AGENT_AG_UI_URL` и необязательный `CUBICA_EDITOR_AGENT_AG_UI_TOKEN`.
3. Держать `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0` в production, если local fallback запрещён.
4. Запустить smoke tests для text response, plan tool call, dry-run tool call и approved mutation.
5. Сравнить production responses с replay/eval fixtures.

### 9.1. Минимальный интерфейс собственной Agent UI панели

Собственная панель может заменить `CopilotChat` только после parity review. Parity review - это проверка, что новая панель покрывает тот же пользовательский и технический минимум, что MVP-адаптер.

Минимальный интерфейс:

- message list with assistant/user/tool roles;
- streaming text chunks with stable ordering;
- tool progress rows for start, args, result and error;
- approval UI for mutating tools;
- diagnostics and diff summary rendering through Cubica Surface renderer;
- disabled/unavailable state for missing backend;
- action dispatcher that calls Cubica tool catalog entries, not provider-specific callbacks;
- transcript capture for replay/eval and audit review;
- accessibility, keyboard navigation and bundle-size review gates.

Панель не должна читать или писать canonical Cubica state напрямую. Она отображает `CubicaAgentEvent`, `CubicaAgentToolResult` and `CubicaSurface`, а изменения запускает только через существующие Cubica commands.

## 10. Контрольные точки ревью

Перед добавлением нового помощника:

- существует запись в реестре помощников;
- documented allowed context и forbidden context;
- documented allowed tools и side-effect policy;
- production backend route аутентифицирован или отключён feature flag;
- состояние помощника не записывается в canonical Cubica state.

Перед добавлением изменяющего инструмента:

- инструмент имеет принадлежащую Cubica форму входа/результата;
- путь инструмента доходит до существующей валидации;
- approval policy задана явно;
- undo/rollback или компенсирующее действие задокументированы;
- audit fields определены.

Перед обновлением CopilotKit или AG-UI:

- version compatibility проверена;
- `npm run verify:agent-ui-boundaries` проходит;
- `editor-web` typecheck, tests и build проходят;
- AG-UI transcript smoke test проходит;
- telemetry и network behavior перепроверены;
- известные audit findings пересмотрены.

Перед включением production backend:

- external backend URL and token policy утверждены;
- `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0` явно задан там, где fallback запрещён;
- smoke suite из раздела 6.2 проходит;
- replay/eval fixtures существуют для целевого assistant flow;
- audit envelope включён для изменяющих tool calls;
- timeout, retry, rate-limit and cost-control policy задокументированы и проверены.

## 11. Текущая привязка к реализации

| Контракт | Текущая реализация |
| --- | --- |
| Cubica-owned agent contracts | `packages/contracts/ai/src/index.ts` |
| Cubica Surface Protocol target | `docs/architecture/generative-ui-surface-protocol.md` |
| Editor tool catalog | `apps/editor-web/src/lib/editor-agent-tool-catalog.ts` |
| Реестр помощников | `apps/editor-web/src/lib/agent-assistant-registry.ts` |
| Проекция контекста | `apps/editor-web/src/lib/agent-context-projection.ts` |
| Адаптер CopilotKit | `apps/editor-web/src/components/editor-agent-ui.tsx` |
| Шлюз агента | `apps/editor-web/app/api/copilotkit/route.ts` |
| Локальный AG-UI backend | `apps/editor-web/app/api/editor/agent/ag-ui/route.ts` |
| Поведение локального backend | `apps/editor-web/src/lib/editor-agent-local-backend.ts` |
| Адаптер событий AG-UI | `apps/editor-web/src/lib/ag-ui-event-adapter.ts` |
| Protocol transcript tests | `apps/editor-web/src/lib/ag-ui-event-adapter.test.ts` |
| Import-boundary gate | `scripts/ci/validate-agent-ui-boundaries.js` |
| Выполнение инструментов редактора | `apps/editor-web/src/components/editor-workspace.tsx` |
| Валидация ChangeSet | `packages/editor-engine` |
| Production backend token forwarding | `apps/editor-web/app/api/copilotkit/route.ts` |
| Replay/eval/audit contracts | `packages/contracts/ai/src/index.ts` |
| Editor helper Surface renderer | `apps/editor-web/src/components/editor-cubica-surface.tsx` |

## 12. Связанные документы

- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md`
- `docs/architecture/adrs/045-cubica-owned-generative-ui-and-mvp-copilotkit.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
- `docs/architecture/agent-ui-foundation.md`
- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/tasks/archive/TSK-20260610-agent-ui-portability-and-risk-controls.md`
- `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- `docs/tasks/archive/TSK-20260611-ai-driven-game-runtime-mode.md`
- `docs/architecture/adrs/038-testing-architecture-and-policy.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
