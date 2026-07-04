# Full Project Review — 2026-06-27

- **Branch**: `codex/ai-driven-surface-migration`
- **Reviewer**: AI agent (Claude / Opus 4.8), с делегированием 4 субагентам по областям
- **Scope**: весь проект (не только последние изменения): `services/runtime-api`, `apps/player-web`, `apps/editor-web` + `packages/editor-engine`, `packages/contracts/*`, `SDK/*`, `scripts/*`, схемы, структурное управление и legacy-реестр.

## Оглавление

- [Резюме](#резюме)
- [Карта проекта и метод](#карта-проекта-и-метод)
- [1. Несоответствия целевой архитектуре (запланированные vs недокументированные)](#1-несоответствия-целевой-архитектуре)
- [2. Явные ошибки в коде](#2-явные-ошибки-в-коде)
- [3. Неоптимальный и избыточный код](#3-неоптимальный-и-избыточный-код)
- [4. Что можно улучшить](#4-что-можно-улучшить)
- [Приложение: статус проверок](#приложение-статус-проверок)

## Резюме

Проект в **рабочем, зелёном** состоянии: typecheck чист по всем пакетам, тесты проходят
(runtime-api 118, player-web 124, editor-engine 34, contracts-ai 33), канонические
CI-инварианты (`game-agnostic`, `manifest-authoring`, `agent-ui-boundaries`,
`api-contracts`) — OK. Система документированного долга (`docs/legacy/`) реально
работает: большинство известных разрывов (AJV `strict:false`, `InMemorySessionStore`,
пустые сервисы-заглушки, Antarctica-утечки в contracts, `SDK/viewers/web-base`)
зафиксированы как осознанный долг.

Тем не менее обнаружены **недокументированные несоответствия целевой архитектуре** и
**подтверждённые баги**, главные из которых:

- **Нарушение platform purity в player-web**: в generic-рендерере захардкожены ID кнопок
  Antarctica (`nav-right`, `btn-advance`, `btn-finish`), CSS-класс `info-screen-shell`
  и русско-языковая карта подписей → ID. Это игровая логика в платформенном слое, нигде
  не зафиксирована.
- **Подтверждённый баг порчи документа** в editor-engine: инверсия JSON Patch для вставки
  в середину массива даёт `replace` вместо `remove` → undo ломает документ.
- **Дрейф контрактов**: поле `overrides` есть в JSON Schema, в данных и в runtime, но
  отсутствует в TS-контракте; схема и TS синхронизируются вручную, без генератора, а
  3 из 4 contract-пакетов вообще не имеют тестов (скрипты = `exit 1`).
- **Editor-долг не задокументирован**: `editor-engine/src/index.ts` — один файл на 5400
  строк, `EditorWorkspace` — компонент на ~2500 строк с 63 `useState`; в `debt-log.csv`
  для editor нет ни одной записи (нарушение правила CLAUDE №9).

## Карта проекта и метод

Реальный код (строк TS/TSX, без node_modules/.next/dist): editor-web ~17k, packages ~12k,
player-web ~11k, runtime-api ~10k, SDK ~3.3k, portal-backend ~1.6k (JS, legacy),
router ~0.5k. Пустые сервисы (`game-engine`, `game-catalog`, `game-repository`,
`game-editor`, `metadata-db`) содержат только `.gitkeep` и **задокументированы** как
заглушки в `docs/legacy/stubs-register.md` / `debt-log.csv`. Каталоги `archive/`,
`draft/`, `sandbox/`, `SDK/`, `data/` имеют `.desc.json`.

Метод: 4 параллельных субагента-ревьюера (read-only) по областям + ручная проверка
структурного управления и точечная валидация ключевых находок.

---

## 1. Несоответствия целевой архитектуре

### 1.1. Недокументированный дрейф (нарушения, не зафиксированные нигде)

**A. (Высокий) player-web: игровая логика Antarctica в generic-рендерере.**
`apps/player-web/src/components/manifest/ui-component-node.tsx`
- `:27-28,51-85` — захардкожены ID кнопок `FORWARD_NAV_BUTTON_ID="nav-right"`,
  `ADVANCE_BUTTON_IDS={"btn-advance","btn-finish"}`; функция
  `moveAdvanceActionToForwardNavigation` переписывает дерево UI (переносит `actions`
  с кнопки advance на nav-кнопку) — вызывается безусловно на каждом узле (`:154`).
- `:263` — `cssClass.includes("info-screen-shell")` (игровой CSS-класс Antarctica)
  управляет рендером фонового блока.
- `apps/player-web/src/lib/layout-helpers.ts:29-39` — `resolveButtonId` маппит русские
  подписи («журнал», «подсказ», «назад», «вперед») на ID кнопок (и локаль-, и
  игро-специфично); `:17-22` — маппинг по структурным классам Antarctica.

Нарушает CLAUDE §10 (platform purity), ADR-001 (View решает структуру UI), ADR-054
(presentation принадлежит ui-манифесту). В `docs/architecture/universality-analysis.md`
этих пунктов нет → недокументированный дрейф. «Какая кнопка несёт forward-действие»
должно выражаться декларативно в ui-манифесте (поле `actionRole`/`navSlot`).

**B. (Высокий) contracts: дрейф `overrides` между JSON Schema и TS.**
Поле `GameManifestActionDefinition.overrides` есть в схеме
(`docs/architecture/schemas/game-manifest.schema.json`), используется в данных
(`games/antarctica/game.manifest.json:2142,2212,2272`) и читается в runtime
(`services/runtime-api/.../deterministicHandlers.ts:85-86` через нетипизированный
`raw`), но **отсутствует** в TS-контракте
(`packages/contracts/manifest/src/index.ts:473-486`). Не зафиксировано в debt-log/задачах.

**C. (Высокий) contracts: схема↔TS синхронизируются вручную, контракты без тестов.**
Имена `$defs` 1:1 совпадают с TS-интерфейсами, `schema-export.ts:3` экспортирует
`RootGameManifest = GameManifest` — признак, что схема когда-то генерировалась из TS,
но **генератор не подключён**. При этом `packages/contracts/manifest|runtime|session`
имеют `test/build/lint = "echo TODO && exit 1"` — типизированные контракты не покрыты
тестами. Это корневая причина дрейфа (B). Недокументировано.

**D. (Средний) runtime-api: две сосуществующие системы guard-ов.**
`services/runtime-api/.../deterministicHandlers.ts:766-876` — legacy «семантические»
guard-ы Antarctica (`board`, `opening`, `team`, `teamSelection`) живут рядом с дженерик-
guard-ами ADR-041 (`object`, `stateConditions`, `jsonLogic`). Сами семантические guard-ы
покрыты gameplay-slice записями (GSR-020/021/025-029, ADR-024) — это запланированный
gap. Но **миграция legacy-guard-ов на дженерик (ADR-041 §7.2) и их удаление из платформенной
схемы ничем не отслеживается** — этот reconciliation-разрыв не зафиксирован.

**E. (Средний) editor: структурный долг не задокументирован.**
`docs/legacy/editor-debt.md` — заглушка на 4 строки, в `debt-log.csv` нет записей по
editor-engine/editor-web/projection/changeset. Поэтому крупные долги (см. §3) —
`editor-engine/src/index.ts` 5400 строк, `EditorWorkspace` ~2500 строк/63 `useState`,
keyword-based инференс ролей — являются **недокументированным** дрейфом (нарушение
CLAUDE §9 «разрыв должен быть осознанным и задокументированным»).

**F. (Низкий) SDK/react-sdk — мёртвый workspace, не зафиксирован.**
`SDK/react-sdk` зарегистрирован в `package.json:11`, но ноль импортов в
apps/services/packages (ссылается только `draft/` и архив). `SDK/viewers/web-base`
задокументирован (LEGACY-0005/0011), а `react-sdk` — нет.

**G. (Низкий) AI-схемы встроены в TS вне SSOT-каталога.**
`packages/contracts/ai/src/index.ts` определяет 15+ JSON Schema инлайн как TS-консты
(с ID вида `https://cubica.ai/schemas/ai/...`), при этом `.schema.json` файлов на диске
нет, хотя `docs/architecture/schemas/.desc.json` объявляет этот каталог домом JSON Schema.
Не анти-паттерн (валидируются через AJV), но несогласованность с тем, как хранятся
manifest/ui/authoring-схемы; нужен ADR или перенос.

### 1.2. Запланированный / задокументированный долг (для контраста — НЕ дрейф)

- AJV `strict:false` + императивная доппроверка templateId → **LEGACY-0016**
  (`TSK-20260518-json-schema-strict-validation`).
- `InMemorySessionStore` → **LEGACY-0009**.
- Глобальный `/readiness` не проверяет загрузку контента → **LEGACY-0010**.
- Нет production Agent Runtime (только mock) → **LEGACY-0014**.
- Antarctica-утечки в shared contracts (комментарии `index.ts:21,340,367,1026`) →
  `TSK-20260518-contracts-neutrality-cleanup`.
- Antarctica-формы состояния в player lib (`game-content-resolvers.ts`) →
  `universality-analysis.md §4`.
- Пустые сервисы и `SDK/viewers/web-base` → `stubs-register.md`, LEGACY-0003/0004/0005/0011.

---

## 2. Явные ошибки в коде

**2.1. (Высокий, подтверждено эмпирически) editor-engine: инверсия JSON Patch для
вставки в середину массива портит документ.**
`packages/editor-engine/src/index.ts:4509-4548`. Для `add` по числовому индексу массива
(семантика вставки, `splice(index,0,value)` на `:4400`) `inverseOperationForMutation`
видит `existedBefore===true` и выдаёт `replace` вместо `remove`. Проверено:
`{arr:["a","b","c"]}` + `add /arr/1 = "X"` → инверсия `replace /arr/1 = "b"` → undo даёт
`["a","b","b","c"]` (документ испорчен). Проходит через
`dryRunEditorChangeSet → inverseChangeSet → undo`; локальный планировщик это обходит
(только object-add), но agent/CopilotKit-путь — нет. Исправление: инверсия вставки в
массив обязана быть `remove` по индексу.

**2.2. (Средний) player-web: устаревший `screenKey` не сбрасывается → не тот экран.**
`apps/player-web/src/components/game-player.tsx:190-195` выставляет `screenKey`/`layoutMode`
только когда они truthy и никогда не сбрасывает; presenter эмитит `NAVIGATE` только при
truthy `state.screenKey` (`game-presenter.ts:433`). После перехода в состояние без экрана
локальный `screenKey` «залипает», и рендер (`game-player.tsx:380`) продолжает показывать
прежний manifest-экран вместо `SafeModeRenderer`/agent-surface. Фикс: в `SYNC_STATE`
зеркалить `state.screenKey ?? undefined` либо рендерить от `state.screenKey` напрямую.

**2.3. (Средний) runtime-api: `POST /sessions` без `gameId` → 500 вместо 400.**
`requestValidation.ts:59` валидирует `gameId` только если он присутствует, а
`session.service.ts:31-33` бросает обычный `Error`, который не `HttpError`, поэтому
`httpServer.ts:264-266` отдаёт 500 на клиентскую ошибку. Фикс: бросать
`RequestValidationError` (→ 400).

**2.4. (Средний) runtime-api: readiness-заглушки.**
`admin/health.ts:65-79` `checkContentSubsystem` имеет недостижимый `catch` (в `try` нет
бросающего вызова) → глобальный `/readiness` всегда `ok` (LEGACY-0010, но это и баг).
`health.ts:85-92` `checkSessionStore` хардкодит `mode:"in-memory"` независимо от
внедрённого `SessionStorePort`.

**2.5. (Средний) contracts: сломанные скрипты `test/build/lint` в 3 пакетах.**
`contracts/manifest|runtime|session` — все три скрипта `echo "TODO" && exit 1`. Любой
агрегатный `npm test`/`build --workspaces` упадёт; типизированные контракты не тестируются.

**2.6. (Низкий) editor: неточности agent-context.**
`apps/editor-web/src/lib/agent-context-projection.ts:158` — `truncated` сравнивает длину
ДО дедупликации (`[...new Set(...)]` на `:119`) → ложноположительный `truncated`.
`:203,:213` — молчаливое усечение массивов/ключей объекта без флага `truncated`/`redacted`.

**2.7. (Низкий) прочее.**
player-web `ui-component-node.tsx:73-80` — `moveAdvance...` форсит `disabled` на nav-кнопку
даже когда у advance не было явного disabled. editor `ai-change-planner.ts:82-83` — при
`exists===false` эмитит `add` без `test`-guard (тихо перезатрёт non-string значение).

---

## 3. Неоптимальный и избыточный код

**player-web**
- `formatValue` дублируется трижды: `lib/formatting.ts:5`, `lib/metric-resolvers.ts:19`,
  `components/manifest/game-variable-component.tsx:143`. `readNumber` — трижды
  (`formatting.ts:18`, `editor-preview-bridge.ts:163`, `safe-mode-renderer.tsx:830`).
- Мёртвый код: `lib/formatting.ts` (нет прямых импортов), весь `components/panels/`
  (`MetricCluster`) и транзитивно `resolveMetricValueByAliases`, `resolveButtonId`
  (`layout-helpers.ts:29`), мёртвые импорты/пропсы (`game-player.tsx:11-12`,
  `safe-mode-renderer.tsx onJournal/onHint`).
- `tsconfig.json` без `noUnusedLocals` → мёртвый код не ловится.

**editor**
- `packages/editor-engine/src/index.ts` — один модуль на **5400 строк** (pointer/patch,
  graph, entity-projection, preview, schema, prototype-extraction, эвристики ролей).
- `apps/editor-web/src/components/editor-workspace.tsx` — компонент ~2500 строк, 63
  `useState`, 20 `useEffect`, лишь 2 `useCallback` (хендлеры пересоздаются каждый рендер).
- Мёртвые/только-тестовые экспорты: `buildEditorEntityYamlProjection`,
  `createStaticPreviewRendererAdapter`, `previewRectsIntersect`, `TreeViewModelBuilder`.
  Пустой интерфейс `BuildEntityTreeViewModelInput extends ... {}` (`index.ts:290`).
  `isPlainJsonObject` дублируется в 3 файлах.

**runtime-api**
- Реестр действий пересобирается на каждый dispatch: `actionDispatcher.ts:45` и `:53`
  дважды зовут `listManifestActionDefinitions` (2 полных скана + новый `Map`) ради одного
  lookup → мемоизировать на bundle.
- `deterministicHandlers.ts:766,815-871` — `(guard as any)` хотя поля объявлены в
  `GameManifestDeterministicGuard` (теряется типобезопасность, непоследовательно).
- Дублирование чтения JSON-pointer/state-condition: `evaluateStateConditionValue`+
  `readJsonPointer` (`:198-212,428-453`) vs инлайновый разбор в `evaluateManifestGuard`
  (`:781-813`, без `~0/~1`-анэкранирования). Мёртвый импорт `SessionRecord`
  (`runtime.service.ts:4`).

**contracts / SDK**
- `SDK/core` session-половина (`createSession`, `validateSessionOptions`, `SessionOptions`)
  — ноль импортов, дублирует `packages/contracts/session`. `SDK/react-sdk` мёртв.
  `schema-export.ts` — осиротевший хук без генератора. `GamePlayerS1UiContent`
  (`index.ts:891`) помечен `@deprecated`.

**Недавние изменения (из прошлого ревью):** дубль `formatMetricValue` и собственный
интерпретатор JsonLogic в player-web (дублирует `json-logic-js` runtime).

---

## 4. Что можно улучшить

**Архитектура / границы**
1. Убрать advance→nav-переписывание и проверку `info-screen-shell` из
   `ui-component-node.tsx`; выразить «forward-кнопку» декларативно в ui-манифесте
   (`actionRole`/`navSlot`). Перенести Antarctica-резолверы состояния из player lib в
   плагин Antarctica.
2. Закрыть дрейф контрактов: добавить `overrides` в TS-тип; выбрать одно направление SSOT
   (генерировать схему из TS по `RootGameManifest`, либо TS из схемы) и добавить CI
   `--check` на расхождение.
3. Зафиксировать reconciliation-план для двух систем guard-ов (ADR-041 §7.2) либо явно
   принять семантические guard-ы навсегда.
4. Определить статус `SDK/react-sdk` и мёртвой session-половины `SDK/core` — удалить из
   workspaces или внести в debt-log/`TSK-...workspace-project-references-cleanup`.
5. Решить размещение AI-схем (перенести в `docs/architecture/schemas/ai/` или ADR).

**Корректность (баги выше)**
6. Починить инверсию вставки в массив (editor-engine) + регресс-тест.
7. Сбрасывать `screenKey` в player (баг не того экрана).
8. `POST /sessions` без gameId → 400 (бросать `RequestValidationError`).
9. Сделать readiness-пробы реальными (`checkContentSubsystem`/`checkSessionStore`).

**Качество / тесты / долг**
10. Заменить `exit 1`-заглушки в contract-пакетах на AJV round-trip тесты (валидировать
    все `games/*/game.manifest.json` против схемы) — ловит дрейф вида (B).
11. Удалить мёртвый код player-web (panels, formatting, resolveButtonId) и включить
    `noUnusedLocals`/`noUnusedParameters`.
12. Разбить `editor-engine/index.ts` на модули и декомпозировать `EditorWorkspace`
    (`useReducer` + дочерние панели); вынести общие утилиты (`isPlainJsonObject`,
    `formatValue`, `readNumber`).
13. Мемоизировать реестр действий per-bundle в runtime-api; убрать `as any` на guard-ах.
14. Завести записи в `docs/legacy/debt-log.csv` для editor-долга, keyword-инференса ролей,
    дублированного интерпретатора JsonLogic — сделать долг осознанным (CLAUDE §9).
15. Сделать role-инференс editor-engine schema-driven (по `_type`/`role`/аннотациям, а не
    по английским подстрокам — иначе не-английские манифесты молча деградируют).

## Приложение: статус проверок

| Проверка | Итог |
| --- | --- |
| runtime-api typecheck / `node --test` | clean / 118 pass |
| player-web typecheck / vitest | clean / 124 pass |
| editor-engine `verify:editor-engine` | typecheck + 34 pass |
| editor-web typecheck | clean |
| contracts-ai `verify:contracts-ai` | typecheck + 33 pass |
| `verify:manifest-authoring` / `verify:game-agnostic` / `verify:agent-ui-boundaries` / `verify:api-contracts` | OK |
| contracts manifest/runtime/session test/build/lint | сломаны (`exit 1`) |
