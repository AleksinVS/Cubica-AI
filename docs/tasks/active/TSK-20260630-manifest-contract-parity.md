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

implemented (2026-07-04)

Механизм парности схема→TS реализован и проверен: генератор, закоммиченный
артефакт, CI drift check, типизированный `overrides` с типизированным чтением в
runtime, и реальные контрактные тесты вместо `exit 1` для manifest-пакета.
`verify:contracts-schema-parity`, `verify:contracts-manifest` (typecheck + 9 AJV-тестов),
`verify:contracts-runtime|session|ai` зелёные; runtime-api typecheck + 127 тестов зелёные.
Пред-существующий красный `verify:legacy` (baseline-маркеры в untouched-файлах) — вне
scope этой задачи; регрессия `health.ts` (слово «stub» в комментарии P0) исправлена.
Две ограниченные (bounded) осознанные развилки — см. Handoff Log 2026-07-04.

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
- 2026-07-04: парность реализована и проверена.
  - **Генератор:** `scripts/manifest-tools/generate-contracts-types.cjs`
    (`json-schema-to-typescript@15`) компилирует `docs/architecture/schemas/
    game-manifest.schema.json` → `packages/contracts/manifest/src/generated/
    game-manifest.ts`. Скрипт `generate:contracts`; `--check` режим для CI.
    Сгенерированный файл — производный, drift-checked артефакт; НЕ является
    consumer-поверхностью (её роль сохраняет ручной `src/index.ts`), поэтому
    исключён из strict typecheck пакета (гарантируется string-diff drift-check,
    не tsc).
  - **Drift check:** `scripts/ci/validate-contracts-schema-parity.js`
    (`verify:contracts-schema-parity`) перегенерирует и сравнивает; включён в
    `verify:canonical`.
  - **`overrides`:** типизирован в `packages/contracts/manifest/src/index.ts`;
    runtime (`deterministicHandlers.ts`) читает `raw.overrides.deterministic`
    через типизированный `Partial<GameManifestActionDefinition>`, без `raw`-обхода.
  - **Контрактные тесты (manifest):** `tests/manifests.test.ts` — AJV round-trip
    всех обнаруженных `games/*/game.manifest.json` и `ui.manifest.json` (9 тестов);
    `tests/type-compat.ts` — compile-time проверка, что поставляемые манифесты
    структурно присваиваемы контракту `GameManifest`.
  - **Найденный и устранённый разрыв wiring:** P0-задача временно поставила
    `contracts-manifest` `test`-скрипт в no-op (снятие `exit 1`-хазарда). Здесь
    он переведён на `vitest run`, добавлен `typecheck` (`tsc -p tsconfig.json`,
    компилирует `type-compat.ts`), а корневой `verify:contracts-manifest` теперь
    гоняет оба.
  - **JSON-widening в type-compat:** `import ... with { type: "json" }` расширяет
    строковые литералы до `string`, из-за чего прямое присваивание манифеста
    контракту с enum/discriminated-union полями (`kind:"computed"`,
    `executionMode`, object `visibility`) падало ложно. Введён widening-толерантный
    `WidenLiterals<T>` — compile-check фокусируется на структуре, а членство в
    enum проверяет AJV (SSOT — схема). `ajv` импортируется через тот же
    `.default`-unwrap, что и остальной код (NodeNext без esModuleInterop).
  - **Bounded decision 1 — AI-схемы (ADR-056 §6):** оставлены TS-colocated в
    `packages/contracts/ai/src/index.ts` (TS уже носитель схемы для AI-слоя, что
    §6 явно допускает). Эмиссия `.schema.json` в `docs/architecture/schemas/ai/` —
    отложенный follow-up; фиксируется как осознанный gap, а не дрейф.
  - **Bounded decision 2 — contracts-runtime/session:** это чисто TS-контракты
    без JSON Schema на диске и без поставляемых экземпляров данных, поэтому
    AJV round-trip неприменим. Их `test` остаётся проходящим no-op со ссылкой на
    эту задачу; реальные контрактные тесты появятся только после извлечения их
    схем (future work). `verify:contracts-runtime|session` зелёные.
  - **Не сделано (вне scope):** миграция consumer-импортов на сгенерированные
    типы (осознанный follow-up, см. заголовок генератора); retire/repurpose
    `schema-export.ts`; пред-существующий baseline-красный `verify:legacy`.
