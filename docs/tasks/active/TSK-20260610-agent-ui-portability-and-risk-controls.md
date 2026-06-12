# TSK-20260610-agent-ui-portability-and-risk-controls: Переносимость Agent UI и контроль рисков

- **Дата создания**: 2026-06-10
- **Статус**: completed
- **Владелец**: Codex
- **Связанные ADR**: ADR-043, ADR-044
- **Связанные документы**: `docs/architecture/agent-ui-portability-and-risk-controls.md`, `docs/architecture/agent-ui-foundation.md`, `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`

## Оглавление

- [1. Цель](#1-цель)
- [2. Контекст](#2-контекст)
- [3. Область работ](#3-область-работ)
- [4. Критерии приёмки](#4-критерии-приёмки)
- [5. Пакеты работ](#5-пакеты-работ)
- [6. План проверки](#6-план-проверки)
- [7. Журнал передачи](#7-журнал-передачи)

## 1. Цель

Снизить риск зависимости от CopilotKit, AG-UI и production LLM backend, превратив архитектурные решения из ADR-044 в проверяемые контракты, тесты и контрольные точки ревью.

## 2. Контекст

Редактор уже имеет:

- CopilotKit UI shell;
- app-local маршрут `/api/copilotkit`;
- built-in local AG-UI backend;
- реестр помощников;
- ограниченную проекцию контекста;
- frontend tools поверх `EditorChangeSet`.

Этого достаточно для базовой проверки, но production rollout требует более строгого контроля переносимости. Без него хуки CopilotKit, форма событий AG-UI или допущения production backend могут попасть в основные модули Cubica.

## 3. Область работ

Входит в работу:

- описать стабильные контракты агентов Cubica;
- добавить проверки границ импортов для CopilotKit/AG-UI;
- добавить transcript-тесты протокола для локального AG-UI backend и будущих smoke-тестов production backend;
- описать планы замены CopilotKit/AG-UI;
- сделать контрольные точки ревью видимыми в активном планировании.

Не входит в работу:

- замена CopilotKit сейчас;
- замена AG-UI сейчас;
- создание production LLM backend;
- изменение схем authoring-манифестов;
- изменение runtime-механик игры.

## 4. Критерии приёмки

1. ADR-044 фиксирует CopilotKit и AG-UI как заменяемые адаптеры, а не как предметные контракты Cubica.
2. `docs/architecture/agent-ui-portability-and-risk-controls.md` содержит матрицу рисков, контроль узких мест и планы миграции.
3. Активная задача перечисляет конкретные implementation gates для переносимости.
4. Импорты CopilotKit остаются ограничены app-local adapter/UI files.
5. Объекты событий AG-UI остаются ограничены protocol adapter и тестами.
6. `EditorChangeSet`, dry-run, apply, undo и save остаются независимыми от UI-фреймворка.
7. Локальный AG-UI backend явно обозначен как local/dev, а не как production LLM behavior.
8. Передача на production LLM backend требует auth, audit, replay/eval и smoke-тестов.

## 5. Пакеты работ

### WP1 - Базовая документация

- [x] Добавить ADR-044 для переносимости и границ протоколов.
- [x] Добавить проектный архитектурный документ по переносимости и контролю рисков.
- [x] Связать новые документы с архитектурной навигацией и текущими планами.

### WP2 - Выделение внутренних контрактов

- [x] Определить `CubicaAgentContext`, `CubicaAgentToolDefinition`, `CubicaAgentToolResult` и `CubicaAgentEvent` как типы, принадлежащие Cubica.
- [x] Разместить стабильные типы в `packages/contracts/ai`, потому что workspace-пакет уже существует и нужен будущим portal/player helpers.
- [x] Сопоставить существующие `editor.planChangeSet`, `editor.dryRunChangeSet`, `editor.applyChangeSet`, `editor.preparePreview`, `editor.saveSession` и `editor.undoLastPatch` с этими типами через CopilotKit adapter result envelope.

### WP3 - Тесты границ импортов

- [x] Добавить repository check, который запрещает импорты CopilotKit вне разрешённых adapter files.
- [x] Добавить repository check, который запрещает импорты AG-UI вне разрешённых protocol adapter files и тестов.
- [x] Описать allowlist прямо в тесте или скрипте.

### WP4 - Тесты протокольных сценариев

- [x] Добавить transcript fixtures для text-only run, вызова plan tool, вызова dry-run tool и follow-up после tool result.
- [x] Проверять одну и ту же ожидаемую проекцию событий Cubica на выходе локального AG-UI backend.
- [x] Сохранить fixtures переиспользуемыми для smoke-тестов production LLM backend.

### WP5 - Контроль передачи на production backend

- [x] Определить минимальный smoke suite для production backend.
- [x] Потребовать auth и token handling для `CUBICA_EDITOR_AGENT_AG_UI_URL`.
- [x] Потребовать audit envelope для изменяющих tool calls.
- [x] Потребовать replay/eval fixtures до production rollout модели.
- [x] Потребовать явное решение `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0` для production-развёртываний, где local fallback запрещён.

### WP6 - Готовность к замене UI

- [x] Определить минимальный custom UI interface, необходимый для замены `CopilotChat`.
- [x] Описать требования к рендеру сообщений, tool calls, approval и ошибок.
- [x] Поддерживать parity checklist для будущей оценки custom UI или альтернативного фреймворка.

## 6. План проверки

Для изменений только в документации:

- `git diff --check`
- `node scripts/dev/generate-structure.js`, когда добавлены новые файлы в structure-tracked directories

Для работ по реализации:

- `npm run typecheck --workspace @cubica/editor-web`
- `npm test --workspace @cubica/editor-web`
- `npm run build --workspace @cubica/editor-web`
- `npm run verify:agent-ui-boundaries`
- protocol transcript tests в `apps/editor-web/src/lib/ag-ui-event-adapter.test.ts`
- ручной или Playwright smoke для AI panel, text response, tool call и tool result

## 7. Журнал передачи

### 2026-06-10 - Документация создана

- Добавлен ADR-044 с границами заменяемости CopilotKit, AG-UI и production LLM backend.
- Добавлен проектный архитектурный документ с матрицей рисков, контролем узких мест и планами миграции.
- Добавлена эта активная задача для отслеживания работ по принудительному контролю границ.
- Обновлены архитектурная навигация, текущий архитектурный контекст и планирование следующих шагов.

### 2026-06-10 - Границы реализованы

- Добавлены Cubica-owned контракты агента в `packages/contracts/ai`: context, tool definition, tool result, assistant record и event projection.
- `editor-web` подключён к этим контрактам через assistant registry, context projection, CopilotKit tool result envelope и AG-UI event adapter.
- Добавлен `scripts/ci/validate-agent-ui-boundaries.js` и root script `npm run verify:agent-ui-boundaries`; `verify:canonical` теперь запускает этот gate.
- Расширены AG-UI transcript tests: text-only run, plan tool call, dry-run tool call, tool result и unsafe state delta.

### 2026-06-10 - Tool Catalog Drift Закрыт

- Добавлен `apps/editor-web/src/lib/editor-agent-tool-catalog.ts` как единый Cubica-owned catalog для editor assistant tools.
- `editor.authoring.allowedTools` теперь берётся из catalog, а CopilotKit adapter берёт tool name/description из catalog definitions.
- Добавлен `apps/editor-web/src/lib/editor-agent-tool-catalog.test.ts`: тестирует синхронизацию catalog/registry/UI adapter и требует approval для mutating tools.

### 2026-06-11 - Production handoff and custom UI gates закрыты

- ADR-044 расширен инвариантами production handoff: external backend проходит через app-local gateway, token остаётся server-side, mutating tool calls требуют audit envelope, replay/eval and smoke suite.
- `docs/architecture/agent-ui-portability-and-risk-controls.md` теперь содержит минимальный production backend smoke suite, требования к `CUBICA_EDITOR_AGENT_AG_UI_TOKEN`, `CUBICA_EDITOR_AGENT_LOCAL_BACKEND=0`, replay/eval fixtures and operation policy.
- Минимальный интерфейс собственной Agent UI панели зафиксирован через Cubica-owned events, tool result envelope and `CubicaSurface`; `CopilotChat` остаётся MVP-адаптером до parity review.
- Реализация уже поддерживает server-side token forwarding and local fallback switch в `apps/editor-web/app/api/copilotkit/route.ts`; проверка границ импортов покрыта `scripts/ci/validate-agent-ui-boundaries.js`.
