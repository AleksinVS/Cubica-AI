# TSK-20260630-manifest-contract-parity: Schema→TS generation, drift checks and contract tests

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

Работа понята так: нужно сделать JSON Schema механически защищённым источником истины
по ADR-056: генерировать TS-контракты из схемы, проверять расхождение в CI и покрыть
контракт-пакеты тестами. Первый практический результат - устранить подтверждённый
дрейф поля `overrides`.

## Architecture Source

- `docs/architecture/adrs/056-manifest-contract-schema-parity-and-testing.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/reviews/2026-06-27-full-project-review.md` (раздел 1.1.B, 1.1.C, 2.5)
- `docs/legacy/debt-log.csv` (LEGACY-0016 - связанный strict-validation долг)

## Why

TS-контракты сейчас пишутся вручную и уже разошлись со схемой (`overrides`). Скрипты
тестов контракт-пакетов - заглушки `exit 1`, поэтому дрейф не ловится. Это нарушает
гарантию ADR-025.

## Current Findings

1. `GameManifestActionDefinition.overrides` есть в `game-manifest.schema.json` и данных
   (`games/antarctica/game.manifest.json:2142,2212,2272`), читается runtime
   (`services/runtime-api/.../deterministicHandlers.ts:85-86` через `raw`), но
   отсутствует в TS (`packages/contracts/manifest/src/index.ts:473-486`).
2. `packages/contracts/manifest/src/schema-export.ts:3` - `RootGameManifest =
   GameManifest`, признак ручной парности без генератора.
3. `contracts/manifest|runtime|session` `test/build/lint = "echo TODO && exit 1"`.
4. AI-схемы инлайн в `packages/contracts/ai/src/index.ts` без `.schema.json` на диске.

## Target State

1. Подключён генератор схема → TS (например `json-schema-to-typescript`) для
   `packages/contracts/manifest` (и при необходимости runtime/session).
2. CI drift check перегенерирует TS и сравнивает с закоммиченным (ошибка при разнице).
3. `overrides` типизирован; runtime читает его без `raw`-обхода.
4. `contracts/manifest|runtime|session` имеют реальные тесты (AJV round-trip всех
   поставляемых манифестов + компиляция типов над данными).
5. AI-схемы имеют единое обнаружимое место (`docs/architecture/schemas/ai/*.schema.json`)
   или явно задокументированное исключение.

## Scope

- Генератор и npm-скрипты генерации.
- CI drift check (новый `scripts/ci/validate-contracts-schema-parity.js` или расширение).
- Контрактные тесты вместо `exit 1`.
- Устранение дрейфа `overrides`.
- Решение по размещению AI-схем.

## Non-Goals

- Не переходить на TS как SSOT (запрещено ADR-025/ADR-056).
- Не включать strict AJV здесь (это LEGACY-0016 / отдельный TSK).
- Не менять сами игровые данные, кроме как для прохождения валидации.

## Execution Plan

### Phase 1. Generator

1. Выбрать и подключить генератор схема → TS; добавить `generate:contracts` скрипт.
2. Регенерировать TS для manifest contract; зафиксировать diff (включая `overrides`).

### Phase 2. Drift check

1. Добавить CI-проверку: перегенерировать и сравнить с закоммиченным TS.
2. Включить её в `verify:canonical`.

### Phase 3. overrides и runtime

1. Убедиться, что `overrides` присутствует в TS после генерации.
2. Заменить `raw.overrides...` чтение в runtime на типизированный доступ.

### Phase 4. Contract tests

1. Заменить `exit 1` на тесты: валидировать все `games/*/game.manifest.json` и
   `ui.manifest.json` против схем; проверить компиляцию типов над данными.
2. Подключить тесты в `verify:canonical`.

### Phase 5. AI schema location

1. Эмитировать AI-схемы как `.schema.json` в `docs/architecture/schemas/ai/` или
   задокументировать TS-colocation решением (короткая запись/ADR-ссылка).

### Phase 6. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`; снять/обновить связанные пункты.

## Acceptance

- TS-контракты генерируются из схемы; ручные правки структур переносятся в схему.
- CI падает при расхождении TS и схемы.
- `overrides` типизирован; runtime не читает его через `raw`.
- Контракт-пакеты имеют проходящие тесты вместо `exit 1`.
- AI-схемы имеют единое место или документированное исключение.
- `verify:canonical` зелёный.

## Validation

```text
npm run verify:contracts-ai
cd services/runtime-api && npm run typecheck && npm test
npm run verify:manifest-authoring
npm run verify:canonical
```

## Risks

- Генерация может изменить форму TS-типов и затронуть импортирующий код - провести
  миграцию импортов и typecheck по всем workspace.
- Round-trip валидация может вскрыть иные расхождения схема/данные - фиксировать и чинить.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью; реализует ADR-056.
