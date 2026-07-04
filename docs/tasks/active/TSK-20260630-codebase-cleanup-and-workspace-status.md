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

planned

## Understanding

Работа понята так: ревью нашло мёртвый и дублированный код в `player-web`, мёртвые
SDK-пакеты и дублированный интерпретатор JsonLogic. Нужно удалить мусор, устранить
дубли и определить статус неиспользуемых workspace-членов (удалить или внести в долг).

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
