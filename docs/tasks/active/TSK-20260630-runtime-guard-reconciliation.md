# TSK-20260630-runtime-guard-reconciliation: Reconcile legacy semantic guards with ADR-041 generic guards

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

partially-implemented (2026-07-04) — board/team/teamSelection мигрированы; opening отложен

По подтверждённому решению (все 4 guard-а → generic) выполнен первый слайс: `board` →
generic `collectionCount`, `team`/`teamSelection` → generic `stateConditions`; их
game-specific формы удалены из платформенной схемы и контрактов; чтение JSON-pointer
унифицировано (`readJsonPointer`/`evaluateStateCondition`, чинит баг `~0/~1`, находка #4);
`(guard as any)` касты удалены (находка #3). Эквивалентность доказана: runtime-api 127/127,
`verify:contracts-schema-parity|contracts-manifest|manifest-authoring|game-agnostic` зелёные.
**Отложено (Phase 2, отдельный коммит):** `opening` (73 инстанса) → `stateConditions` на
`/secret/opening/selectedCardId`, затем удаление формы `opening` из схемы/контрактов.

## Understanding

Работа понята так: в runtime сосуществуют две системы guard-ов - legacy «семантические»
guard-ы Antarctica и дженерик-guard-ы ADR-041. ADR-041 §7.2 объявил дженерик-механизм
целевым, но миграция legacy-guard-ов на него и их удаление из платформенной схемы
ничем не отслеживаются. Нужно зафиксировать план согласования: мигрировать или явно
оставить навсегда.

## Architecture Source

- `docs/architecture/adrs/041-gameplay-object-state-model.md` (§7.2 generic guards)
- `docs/architecture/adrs/024-...` (gameplay slice governance)
- `docs/architecture/gameplay-slices/` (GSR-020/021/025-029)
- `docs/reviews/2026-06-27-full-project-review.md` (раздел 1.1.D)
- `docs/legacy/debt-log.csv` (LEGACY-0020)

## Why

Две параллельные системы guard-ов - это скрытый архитектурный разрыв: платформенная
схема и runtime несут game-specific семантику (`board`/`opening`/`team`/`teamSelection`),
для которой ADR-041 уже даёт дженерик-замену. Разрыв допустим, но обязан быть
осознанным и отслеживаемым (CLAUDE §9).

## Current Findings

1. `services/runtime-api/src/modules/runtime/deterministicHandlers.ts:766-876` -
   legacy guard-ы `board` (`countResolvedCards` `:647-657`), `opening`
   (`secret.opening.selectedCardId`), `team` (`public.flags.team[memberId]`),
   `teamSelection` (`public.teamSelection.pickCount`) рядом с дженерик `object`,
   `stateConditions`, `jsonLogic`.
2. Семантика захардкожена и в платформенной схеме/контрактах
   (`docs/architecture/schemas/game-manifest.schema.json:462-532`;
   `packages/contracts/manifest/src/index.ts:284-313`).
3. `(guard as any)` касты (`deterministicHandlers.ts:766,815-871`) при наличии типов.
4. Дубль чтения JSON-pointer/state-condition: `evaluateStateConditionValue`+
   `readJsonPointer` (`:198-212,428-453`) vs инлайновый разбор в `evaluateManifestGuard`
   (`:781-813`, без `~0/~1`-анэкранирования).

## Target State

1. Принято и задокументировано решение по каждому legacy guard:
   - `board` ≈ `collectionCount`/`object` count;
   - `team`/`teamSelection` ≈ `stateConditions`;
   - `opening` ≈ `stateConditions` по `secret.opening.selectedCardId`.
2. Antarctica переведена на дженерик-guard-ы там, где это эквивалентно; legacy-форма
   либо удалена из платформенной схемы, либо явно зафиксирована как постоянная.
3. Дубль чтения pointer/state-condition сведён к `readJsonPointer`/
   `evaluateStateConditionValue`.
4. `(guard as any)` касты удалены (типизированный `GameManifestDeterministicGuard`).

## Classification

General: дженерик-guard-механизм, schema, dedup pointer-логики.
Game-specific: конкретные guard-условия Antarctica в её манифесте.

## Scope

- Решение по согласованию (фиксируется здесь и в LEGACY-0020).
- Миграция эквивалентных guard-ов Antarctica на дженерик.
- Чистка платформенной схемы/контрактов от game-specific guard-форм (если мигрируем).
- Удаление `as any` и дубля pointer-логики.

## Non-Goals

- Не менять игровое поведение Antarctica (поведение эквивалентно до/после).
- Не вводить новый game-specific guard в платформу.
- Не выполнять strict-AJV миграцию (LEGACY-0016).

## Execution Plan

### Phase 1. Decision

1. Для каждого legacy guard зафиксировать: мигрировать на дженерик или оставить.
2. Обновить ADR-041 при необходимости (только архитектурное решение, не план).

### Phase 2. Antarctica migration

1. Перевести эквивалентные guard-ы Antarctica на `object`/`stateConditions`/`jsonLogic`.
2. Перекомпилировать манифест; проверить отсутствие gameplay diff.

### Phase 3. Platform cleanup

1. Удалить мигрированные game-specific guard-формы из платформенной схемы/контрактов
   (или явно пометить оставленные как постоянные).
2. Удалить `as any`; свести pointer/state-condition к общим хелперам.

### Phase 4. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`, LEGACY-0020.

## Acceptance

- По каждому legacy guard принято и задокументировано решение.
- Antarctica работает на дженерик-guard-ах там, где эквивалентно; gameplay diff отсутствует.
- Платформенная схема не несёт мигрированных game-specific guard-форм (либо они явно
  зафиксированы как постоянные).
- `as any` на guard-ах удалены; pointer-логика не дублируется.
- runtime-api typecheck/tests и canonical slice зелёные.

## Validation

```text
cd services/runtime-api && npm run typecheck && npm test
npm run verify:game-agnostic
npm run verify:manifest-authoring
npm run verify:canonical
```

## Risks

- Эквивалентность дженерик-guard-ов нужно доказать тестами для каждой ветки Antarctica.
- Чистка схемы может сломать иные манифесты/тесты - двигаться по одному guard.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью; покрывает LEGACY-0020.
- 2026-07-04: **Phase 1** — миграция board/team/teamSelection + платформенная зачистка.
  - **Решение (утверждено владельцем):** мигрировать все 4 guard-а на generic
    `stateConditions`/`collectionCount`; `board`→collectionCount, opening/team/
    teamSelection→stateConditions. opening вынесен в отдельный слайс из-за объёма (73).
  - **Общий примитив:** вынесен `evaluateCollectionCount(state, spec)` — используется и
    эффект-условиями, и guard-ами (без дублирования). В `game-manifest.schema.json`
    добавлено определение `GameManifestDeterministicCollectionCount`, в контракте —
    одноимённый интерфейс (переиспользован в эффект-условии).
  - **board → collectionCount:** `{path:"/public/objects/cards", ids:cardIds,
    field:"facets/resolution", equals:"resolved", countAtLeast:N}`. Эквивалент проверен:
    те же path/field уже используются в эффект-условиях Antarctica.
  - **team → stateConditions:** `{path:"/public/flags/team/<id>/selected", operator:"==",
    value:<selected>}`. **teamSelection → stateConditions:** `pickCountLessThan`→`<`,
    `pickCountEquals`→`==` на `/public/teamSelection/pickCount` (инициализирован `0`).
  - **Унификация чтения:** guard `stateConditions` теперь идёт через `readJsonPointer`/
    `evaluateStateCondition` (с распаковкой `~0/~1`) — устранён дубль-инлайн `/`-split
    (находка #4). `(guard as any)` касты убраны (находка #3); типы guard-а очищены.
  - **Миграция манифеста:** одноразовый transform-скрипт (в job tmp, не коммитится) —
    board=1, team=10, teamSelection=11; распознавание строго по guard-формам, чтобы не
    задеть одноимённые поля в состоянии (team-ростер, teamSelection.pickCount). Authoring
    перекомпилирован; в compiled 0 legacy-форм, 14 collectionCount, 11 stateConditions.
  - **Схема/контракт:** формы `board`/`team`/`teamSelection` удалены; `generate:contracts`
    регенерирован; drift-check зелёный.
  - **Тесты:** устаревший тест валидации `board`-guard заменён на проверку malformed
    `collectionCount`-guard. runtime-api 127/127.
  - **Осталось (Phase 2):** `opening` → `stateConditions` (`/secret/opening/selectedCardId`:
    `selectedCardIdAbsent`→`not_exists`, `selectedCardIdEquals`→`==`), затем удаление
    формы `opening` из схемы/контрактов и последнего game-specific guard из платформы.
