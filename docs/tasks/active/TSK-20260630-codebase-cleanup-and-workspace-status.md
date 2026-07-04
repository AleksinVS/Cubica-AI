# TSK-20260630-codebase-cleanup-and-workspace-status: Dead code removal, dedup and SDK/workspace status

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

partially-implemented (2026-07-04) — player-web dead code + strict flags done; JsonLogic + SDK + readNumber deferred

Выполнены Phase 1 (мёртвый код player-web удалён, `noUnusedLocals`/`noUnusedParameters`
включены и зелёные) и часть Phase 2 (дедуп `formatValue` — через удаление мёртвого
`formatting.ts`). **Отложены (нужны решения/крупнее):** Phase 3 (унификация JsonLogic —
стратегия shared evaluator vs документированное подмножество + CI), Phase 4 (статус
`SDK/react-sdk` и session-половины `SDK/core` + `exit 1`-хазард в `SDK/*`), и консолидация
`readNumber` (три копии с РАЗНЫМИ сигнатурами — не безопасный blind-merge).
`GamePlayerS1UiContent` НЕ удалён — есть потребители (тесты + контракт). Также
`resolveButtonId` уже удалён в renderer-purity (0d440b0), а `game-content-resolvers`
team/card/opening перенос закреплён за renderer-purity follow-up.

## Understanding

Работа понята так: ревью нашло мёртвый и дублированный код в `player-web`, мёртвые
SDK-пакеты и дублированный интерпретатор JsonLogic. Нужно удалить мусор, устранить
дубли и определить статус неиспользуемых workspace-членов (удалить или внести в долг).

**Поглощает (2026-07-04):** классификацию workspace/scaffold из закрытой
`TSK-20260518-workspace-project-references-cleanup` — статус `SDK/viewers/web-base`,
`services/router`, portal drafts (`apps/portal-nextjs`, `services/portal-backend`) и
TypeScript project references. Часть portal/router уже отвечена ADR-032/033.

## Architecture Source

- `docs/reviews/2026-06-27-full-project-review.md` (разделы 1.1.F, 1.1.G, 3)
- `docs/tasks/active/TSK-20260518-workspace-project-references-cleanup.md`
- `docs/legacy/debt-log.csv` (LEGACY-0021, LEGACY-0022; LEGACY-0005/0011 - web-base)
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`

## Why

Мёртвый код и дубли увеличивают площадь сопровождения и скрывают game-specific утечки.
Два интерпретатора JsonLogic (runtime `json-logic-js` и собственный в player-web)
рискуют разойтись между каналами.

## Current Findings

1. **player-web мёртвый код**: `lib/formatting.ts` (нет прямых импортов), весь
   `components/panels/` (`MetricCluster`) и транзитивно `resolveMetricValueByAliases`,
   `resolveButtonId` (`layout-helpers.ts:29`), мёртвые импорты/пропсы
   (`game-player.tsx:11-12`; `safe-mode-renderer.tsx onJournal/onHint`).
2. **Дубли**: `formatValue` ×3 (`lib/formatting.ts:5`, `lib/metric-resolvers.ts:19`,
   `components/manifest/game-variable-component.tsx:143`); `readNumber` ×3
   (`formatting.ts:18`, `editor-preview-bridge.ts:163`, `safe-mode-renderer.tsx:830`).
3. **JsonLogic дубль**: `apps/player-web/src/lib/metric-projection.ts` реализует свой
   вычислитель, дублируя `json-logic-js` из runtime (риск расхождения).
4. **SDK**: `SDK/react-sdk` зарегистрирован в `package.json:11`, но ноль импортов в
   apps/services/packages; мёртвая session-половина `SDK/core` (`createSession`,
   `validateSessionOptions`, `SessionOptions`) дублирует `packages/contracts/session`.
   **(2026-07-04)** Дополнительно: `SDK/core`, `SDK/shared`, `SDK/react-sdk` содержат тот
   же `test = "... && exit 1"`-хазард, из-за которого агрегатный `npm test --workspaces`
   всё ещё падает (передано из P0 `TSK-20260630-review-remediation-correctness`, где
   аналогичный хазард снят в контракт-пакетах). Решить вместе со статусом SDK: удалить
   пакеты из workspaces или снять `exit 1` и внести в долг.
5. `packages/contracts/manifest/src/index.ts:891` `GamePlayerS1UiContent` помечен
   `@deprecated`.
6. `apps/player-web/tsconfig.json` без `noUnusedLocals`/`noUnusedParameters`.

## Target State

1. Мёртвый код player-web удалён; `noUnusedLocals`/`noUnusedParameters` включены.
2. `formatValue`/`readNumber` сведены в один общий util.
3. Вычисление JsonLogic унифицировано (общий evaluator либо явно документированное
   подмножество с CI-ограничением допустимых операторов в computed-метриках).
4. Статус `SDK/react-sdk` и session-половины `SDK/core` решён: удалить из workspaces
   или внести в `debt-log.csv`/workspace-cleanup TSK.
5. `@deprecated GamePlayerS1UiContent` удалён, если нет потребителей.

## Scope

- Удаление мёртвого кода и дублей в player-web.
- Унификация JsonLogic.
- Решение по SDK workspace-членам.
- Включение строгих unused-проверок tsconfig.

## Non-Goals

- Не выполнять renderer purity (это отдельный TSK; здесь только удаление безусловно
  мёртвого `resolveButtonId`, если purity-TSK ещё не закрыл его).
- Не трогать реально используемые части `SDK/core` (`view-protocol`, `state`).

## Execution Plan

### Phase 1. player-web dead code

1. Удалить `components/panels/`, `lib/formatting.ts` (после переноса хелперов),
   `resolveMetricValueByAliases`, мёртвые импорты/пропсы.
2. Включить `noUnusedLocals`/`noUnusedParameters`; устранить всплывшие предупреждения.

### Phase 2. Dedup

1. Свести `formatValue`/`readNumber` в один util и переиспользовать.

### Phase 3. JsonLogic unify

1. Либо вынести единый evaluator в общий пакет и использовать в runtime и player,
   либо задокументировать подмножество (ADR/debt) и добавить CI-проверку операторов.

### Phase 4. SDK/workspace status

1. Определить статус `SDK/react-sdk` и мёртвой session-половины `SDK/core`: удалить из
   `package.json` workspaces или внести в debt-log/workspace-cleanup TSK.
2. Удалить `GamePlayerS1UiContent`, если потребителей нет.

### Phase 5. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`; обновить LEGACY-0021/0022.

## Acceptance

- Удалён мёртвый код player-web; строгие unused-проверки включены и зелёные.
- `formatValue`/`readNumber` существуют в одном месте.
- Вычисление JsonLogic унифицировано или подмножество задокументировано + проверяется CI.
- Статус `SDK/react-sdk`/`SDK/core` session-half решён и отражён в долге/удалён.
- Все проверки зелёные.

## Validation

```text
npm run typecheck --workspace @cubica/player-web && npm test --workspace @cubica/player-web
npm run verify:game-agnostic
npm run verify:canonical
```

## Risks

- Удаление «мёртвого» кода, который импортируется динамически/в тестах - проверить
  grep по всему репозиторию перед удалением.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью; покрывает LEGACY-0021/0022.
- 2026-07-04: Phase 1 + часть Phase 2 (player-web, всё греп-проверено перед удалением).
  - **Удалён мёртвый код:** `apps/player-web/src/lib/formatting.ts` (ноль импортёров;
    `export * from "./formatting"` убран из `lib/index.ts`) и весь
    `apps/player-web/src/components/panels/` (`MetricCluster` — ноль потребителей).
    `resolveMetricValueByAliases` оставлен — используется `lib/metric-resolvers.ts`.
  - **Мёртвые импорты/пропсы:** убраны неиспользуемые импорты `LocaleProvider`/`ru` и
    dead `onJournal`/`onHint` (проброс в `SafeModeRenderer` + сами пропсы в
    `safe-mode-renderer.tsx`; кнопки диспатчат `ManifestAction.SHOW_PANEL` напрямую).
  - **Строгие проверки:** `noUnusedLocals`/`noUnusedParameters` включены в
    `apps/player-web/tsconfig.json`; исправлен 21 диагностик в 9 файлах (мёртвые
    импорты/типы/локали, `_`-префикс для нужных-но-неиспользуемых параметров).
  - **Дедуп `formatValue`:** после удаления `formatting.ts` остаётся один в
    `lib/metric-resolvers.ts` — дедуп достигнут удалением.
  - **Проверки:** player-web typecheck, 130 тестов и `next build` — зелёные.
  - **Оставлено осознанно:** `GamePlayerS1UiContent` (есть потребители: тесты +
    контракт); `readNumber` в `safe-mode-renderer.tsx` и `editor-preview-bridge.ts`
    (РАЗНЫЕ сигнатуры/контракты — не сливать вслепую).
  - **Отложено (отдельные срезы, нужны решения):**
    1. **JsonLogic (Phase 3):** `apps/player-web/src/lib/metric-projection.ts` дублирует
       вычислитель `json-logic-js` из runtime. Решить: общий evaluator в общий пакет,
       либо документированное подмножество операторов + CI-проверка. Не тронуто.
    2. **SDK (Phase 4):** статус `SDK/react-sdk` и мёртвой session-половины `SDK/core`
       (удалить из workspaces или внести в debt-log/LEGACY-0021/0022). Плюс тот же
       `exit 1`-хазард в `SDK/core`, `SDK/shared`, `SDK/react-sdk` (найден в P0), из-за
       которого агрегатный `npm test --workspaces` всё ещё падает. Не тронуто.
    3. **`readNumber` консолидация** — при желании унифицировать три варианта с общим
       контрактом (сейчас разные).
