# TSK-20260630-review-remediation-correctness: Correctness fixes from full project review

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
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

Работа понята так: ревью всего проекта (`docs/reviews/2026-06-27-full-project-review.md`)
выявило набор подтверждённых дефектов корректности, разбросанных по областям. Их нужно
исправить как один приоритетный (P0) пакет, потому что часть из них портит данные или
выдаёт неверный ответ пользователю. Это исправление багов, а не изменение архитектуры.

## Architecture Source

- `docs/reviews/2026-06-27-full-project-review.md` (раздел «2. Явные ошибки в коде»)
- `docs/architecture/adrs/051-api-first-contract-for-modular-monolith.md` (контракт runtime-api)
- `docs/architecture/PROJECT_ARCHITECTURE.md`

Если фикс потребует нового платформенного механизма, сначала обновить ADR. Иначе вся
исполнительная деталь остаётся в этом TSK.

## Why

Дефекты ниже наблюдаемы и проверяемы; часть приводит к порче документа при undo,
показу не того экрана и неверным HTTP-кодам. Зелёные сейчас проверки их не ловят из-за
пробелов в тестах.

## Current Findings

Подтверждено в ревью (file:line):

1. **(Критично) Порча документа при undo вставки в середину массива.**
   `packages/editor-engine/src/index.ts:4509-4548`. Для `add` по числовому индексу
   массива (вставка, `splice(index,0,value)` на `:4400`) инверсия эмитит `replace`
   вместо `remove`. Проверено эмпирически: `["a","b","c"]` + `add /arr/1="X"` → undo
   даёт `["a","b","b","c"]`. Затрагивает agent/CopilotKit ChangeSet path.
2. **«Залипающий» screenKey в player.** `apps/player-web/src/components/game-player.tsx:190-195`
   выставляет `screenKey`/`layoutMode` только при truthy и не сбрасывает; presenter
   эмитит `NAVIGATE` только при truthy `state.screenKey` (`game-presenter.ts:433`).
   После перехода в состояние без экрана рендерится прежний manifest-экран
   (`game-player.tsx:380`) вместо `SafeModeRenderer`/agent-surface.
3. **POST /sessions без gameId → 500 вместо 400.**
   `services/runtime-api/src/modules/player-api/requestValidation.ts:59` валидирует
   `gameId` только если он присутствует; `session.service.ts:31-33` бросает обычный
   `Error` (не `HttpError`) → `httpServer.ts:264-266` отдаёт 500.
4. **Фиктивная readiness.** `services/runtime-api/src/modules/admin/health.ts:65-79`:
   недостижимый `catch` в `checkContentSubsystem` → глобальный `/readiness` всегда `ok`.
   `health.ts:85-92`: `checkSessionStore` хардкодит `mode:"in-memory"` независимо от
   внедрённого `SessionStorePort`. (Связано с LEGACY-0010.)
5. **Сломанные скрипты контракт-пакетов.** `packages/contracts/manifest|runtime|session`
   имеют `test/build/lint = "echo TODO && exit 1"` → агрегатный `npm test`/`build
   --workspaces` падает. (Замена реальными тестами - в TSK manifest-contract-parity;
   здесь только снять `exit 1`-хазард, поставив временный no-op `test` до появления
   реальных тестов, если parity-TSK ещё не выполнен.)
6. **Неточности agent-context.** `apps/editor-web/src/lib/agent-context-projection.ts:158`
   считает `truncated` по длине ДО дедупликации (`[...new Set(...)]` на `:119`) →
   ложноположительный `truncated`. `:203,:213` молча усекают массивы/ключи без флага.
7. **Прочее.** `apps/player-web/src/components/manifest/ui-component-node.tsx:73-80`
   `moveAdvanceActionToForwardNavigation` форсит `disabled` на nav-кнопку даже когда у
   advance не было явного disabled (полное удаление этой функции - в renderer-purity
   TSK; здесь только убрать ошибочный форс disabled, если purity-TSK ещё не выполнен).
   `apps/editor-web/src/lib/ai-change-planner.ts:82-83` эмитит `add` без `test`-guard
   при `exists===false`.

## Scope

- Точечные фиксы дефектов 1-7 и регресс-тесты на каждый.
- Закрытие пробелов в тестах, из-за которых баги не ловились.

## Non-Goals

- Не выполнять структурный рефакторинг (вынесено в отдельные TSK).
- Не удалять `moveAdvanceActionToForwardNavigation` целиком и не вводить декларативную
  привязку - это TSK player-web-renderer-purity (ADR-055).
- Не вводить генератор контрактов - это TSK manifest-contract-parity (ADR-056).

## Execution Plan

### Phase 1. Critical: array-insert inverse

1. В `inverseOperationForMutation` (editor-engine) для `op==="add"` с числовым индексом
   массива всегда эмитить `{op:"remove", path: actualPath}` независимо от `existedBefore`.
2. Добавить регресс-тест в `packages/editor-engine/tests/index.test.ts` (insert в начало,
   середину, конец; undo восстанавливает исходный массив).

### Phase 2. Player screenKey

1. В редьюсере `SYNC_STATE` зеркалить `state.screenKey ?? undefined` (и `layoutMode`),
   либо рендерить ветку экрана от `state.screenKey` напрямую.
2. Тест: переход screen → no-screen возвращает `SafeModeRenderer`/surface.

### Phase 3. runtime-api correctness

1. `session.service.ts`: бросать `RequestValidationError` (→ 400) при отсутствии `gameId`.
2. `health.ts`: сделать `checkContentSubsystem` реальной пробой (попытка чтения
   манифеста дефолтной игры) и отражать реальный класс/режим store в `checkSessionStore`.
3. Тесты: `POST /sessions {}` → 400; readiness отражает реальное состояние.

### Phase 4. contracts script hazard

1. Заменить `exit 1` в `test` пакетов contracts на проходящий no-op до появления
   реальных тестов (или сразу выполнить parity-TSK). Зафиксировать выбор в Handoff Log.

### Phase 5. agent-context and minor

1. Дедуплицировать перед измерением `truncated`; протягивать усечение массивов/ключей
   в `limits.truncated`.
2. Убрать ошибочный форс `disabled` в nav-переносе (если renderer-purity ещё не сделан).
3. `ai-change-planner`: добавить `test`-guard перед `add` при существующем не-string поле.

### Phase 6. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`.

## Acceptance

- Undo вставки в массив восстанавливает исходный документ (регресс-тест зелёный).
- Player не показывает устаревший экран после перехода в состояние без экрана.
- `POST /sessions` без `gameId` отвечает 400.
- `/readiness` отражает реальное состояние контента и store.
- Агрегатный `npm test --workspaces` не падает на контракт-пакетах.
- `agent-context-projection` не даёт ложный `truncated` и сигналит реальное усечение.
- Все существующие проверки остаются зелёными.

## Validation

```text
npm run verify:editor-engine
cd services/runtime-api && npm run typecheck && npm test
npm run typecheck --workspace @cubica/player-web && npm test --workspace @cubica/player-web
npm run typecheck --workspace @cubica/editor-web
```

## Risks

- Изменение инверсии патча может затронуть существующее поведение undo для object-add -
  покрыть тестами обе ветки.
- Реальные readiness-пробы могут вскрыть скрытые сбои загрузки контента - это ожидаемо.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью проекта; реализация не начата.
