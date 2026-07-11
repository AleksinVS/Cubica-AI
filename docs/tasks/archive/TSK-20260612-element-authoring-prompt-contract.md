# TSK-20260612-element-authoring-prompt-contract: Реализация Контракта Элементного Промта

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented-first-slice

## Understanding

Задача понята так: ADR-048 принят как целевая архитектура элементных промтов. Теперь нужно привести текущее состояние к этому контракту: authoring-схемы, прототипы, правила удаления полей, существующих только в authoring-слое, метаданные редактора и проверочные fixtures (минимальные тестовые данные) должны начать понимать `_prompt` на конкретных экземплярах и `_promptTemplate` на прототипах.

Элементный промт - это сохраненное authoring-описание конкретного элемента: содержимое, поведение, связи с состоянием, переходы и методический смысл. Это не `generation.prompt` design artifact и не временный `EditorPatchIntent.prompt`.

Классификация механики: это общий authoring-механизм платформы. Он нужен всем играм и UI-каналам, не является поведением конкретной игры Antarctica и не должен создавать ветки под конкретную игру в слоях `runtime-api` и `player-web`.

## Why

Сейчас проект имеет только частичные механизмы:

- `generation.prompt` описывает визуальную генерацию для design artifacts;
- `_semantics` хранит короткое смысловое описание узла;
- `EditorPatchIntent.prompt` хранит запрос на одну правку;
- `PatchJournalStep` хранит историю применения ChangeSet.

Ни один из них не является сохраненным, подтвержденным промтом элемента. Из-за этого агент не имеет устойчивого authoring-источника для повторной генерации, проверки смысла и создания структурированных изменений.

## Architecture Baseline

Эта задача реализует первый срез ADR-048.

Связанная архитектура:

- ADR-025: JSON Schema остается источником истины для структур манифеста.
- ADR-030: агенты редактируют authoring-манифесты; generated runtime manifests являются результатом компилятора.
- ADR-036: AI-правки по промту должны проходить через `EditorPatchIntent -> EditorChangeSet -> dry-run -> apply/undo/save`.
- ADR-048: принятый контракт элементного authoring-промта.
- `docs/architecture/element-prompt-contract.md`: проектное описание и примеры.
- `docs/processes/editor-prompts.md`: категории промтов редактора и правила безопасности.

## Scope

В объеме:

- расширить authoring JSON Schema definitions полями `_prompt` и `_promptTemplate`;
- сделать `_prompt` доступным для конкретных semantic entities в game/UI authoring manifests;
- сделать `_promptTemplate` доступным для authoring definitions/prototypes;
- выбрать первую конкретную форму схемы для:
  - `status`;
  - `raw`;
  - `normalized`;
  - `source`;
  - `language`;
  - `updatedAt`;
- обновить компилятор authoring-манифестов так, чтобы `_prompt` и `_promptTemplate` не попадали в generated runtime manifests;
- обновить загрузку схем в редакторе так, чтобы Monaco, JSON tree и property panel могли валидировать и показывать новые поля;
- добавить минимальные authoring fixtures/examples, подтверждающие валидацию обоих полей;
- добавить указания по миграции существующих authoring-файлов;
- после реализации обновить документы фактическими деталями схемы.

## Non-Goals

- Не реализовывать reverse-sync от структурированных полей манифеста обратно к `_prompt`.
- Не реализовывать автоматическую генерацию промта из структуры манифеста.
- Не реализовывать обнаружение дрейфа, hash coverage или предложения исправлений.
- Не выводить `_prompt` в generated runtime `game.manifest.json` или `ui.manifest.json`.
- Не добавлять обработку промтов под конкретную игру `Antarctica`.
- Не заменять `_semantics`, `generation.prompt` или `EditorPatchIntent.prompt`.
- Не делать production LLM backend обязательным для этого среза.

## Execution Plan

### Phase 1. Schema Contract

1. [x] Добавить общие definitions для элементного промта и шаблона промта в `manifest-authoring-common.schema.json`.
2. [x] Разрешить `_prompt` на `semanticEntity`.
3. [x] Разрешить `_promptTemplate` на `authoringDefinition`.
4. [x] Определить, какие значения `status` разрешены в первом срезе, с `confirmed` как целевым сохраненным состоянием.
5. [x] Не добавлять sync metadata в первую форму схемы, если она не нужна строго для валидации.

### Phase 2. Compiler Boundary

1. [x] Обновить правила удаления authoring-only полей в компиляторе так, чтобы `_prompt` и `_promptTemplate` не появлялись в generated runtime manifests.
2. [x] Расширять поведение source map только если это нужно для diagnostics; не использовать source maps как механизм синхронизации промта.
3. [x] Добавить regression checks, подтверждающие, что generated game/UI manifests не содержат `_prompt` или `_promptTemplate`.

### Phase 3. Fixtures And Examples

1. [x] Добавить минимальную game authoring fixture с `_prompt` на конкретной semantic entity.
2. [x] Добавить минимальную UI authoring fixture с `_prompt` на компоненте.
3. [x] Добавить prototype fixture с `_promptTemplate`.
4. [x] Добавить хотя бы один пример на основе card-like элемента без привязки к Antarctica.

### Phase 4. Editor Surface Readiness

1. [x] Убедиться, что registry схем редактора принимает новые поля.
2. [x] Убедиться, что JSON tree и property panel показывают и редактируют `_prompt`, не скрывая его как неизвестные данные.
3. [x] Не менять flow AI-операций по промту: `EditorPatchIntent.prompt` остается промтом операции.
4. [x] Если редактор в этом срезе автоматически создает элементы из прототипов, копировать `_promptTemplate` в `_prompt.raw`; иначе зафиксировать это как следующий UX-шаг редактора.

### Phase 5. Documentation Closeout

1. [x] Обновить `docs/architecture/element-prompt-contract.md`: отделить уже реализованное поведение первого среза от целевого контракта.
2. [x] Обновить `docs/processes/editor-prompts.md` точными значениями `status` и поведением редактора.
3. [x] Обновить `PROJECT_OVERVIEW.md`, `PROJECT_ARCHITECTURE.md` и `PROJECT_STRUCTURE.yaml`, если реализация меняет структуру или статус.
4. [x] Записать оставшуюся работу по reverse-sync как отдельную последующую задачу, а не как скрытый объем этой задачи.

## Acceptance

1. ADR-048 принят и ссылается на эту задачу как на первый срез реализации.
2. Authoring-схемы валидируют `_prompt` на конкретных semantic entities.
3. Authoring-схемы валидируют `_promptTemplate` на прототипах.
4. Generated runtime manifests не содержат `_prompt` или `_promptTemplate`.
5. `npm run verify:manifest-authoring` проходит.
6. Загрузка схем в редакторе не отклоняет authoring-файлы с `_prompt`/`_promptTemplate`.
7. Документация явно говорит, что reverse-sync и синхронизация промта со структурой отложены.
8. Не добавлены ветки под конкретную игру в `runtime-api` или `player-web`.

## Validation

Обязательные команды для implementation PR:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
npm run verify:editor-web
rg -n '"_prompt"|"_promptTemplate"|_promptTemplate' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
git diff --check
```

Ожидаемый результат проверки утечки в runtime:

- нет `_prompt`;
- нет `_promptTemplate`.

Известное ограничение проекта:

- `npm run verify:canonical` сейчас падает в `verify:legacy` на уже существующих незарегистрированных `mock/not implemented` markers вне этой задачи. Эта задача не должна добавлять новые незарегистрированные markers.

## Artifacts

- `docs/architecture/adrs/048-element-authoring-prompt-contract.md` - принятое архитектурное решение.
- `docs/architecture/element-prompt-contract.md` - проектный контракт и примеры.
- `docs/processes/editor-prompts.md` - правила процесса работы с промтами редактора.
- `docs/tasks/archive/TSK-20260612-element-authoring-prompt-contract.md` - этот исполнительный план.

## Handoff Log

### 2026-06-12 - Codex Documentation Setup

- Изменено:
  - `docs/architecture/adrs/048-element-authoring-prompt-contract.md`
  - `docs/architecture/element-prompt-contract.md`
  - `docs/processes/editor-prompts.md`
  - `PROJECT_OVERVIEW.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `docs/architecture/schemas/manifest-structure.md`
  - `docs/architecture/README.md`
  - `docs/tasks/archive/TSK-20260612-element-authoring-prompt-contract.md`
- Сделано: ADR-048 принят как целевая архитектура; исполнительный объем отделен от последующей проработки reverse-sync.
- Осталось: реализовать изменения схем, компилятора и редактора.
- Следующий шаг: начать Phase 1 с `docs/architecture/schemas/manifest-authoring-common.schema.json`.
- Риск: если `_prompt` сделать обязательным слишком широко, существующие adopted authoring manifests могут начать падать на валидации до миграции.

### 2026-06-12 - First Slice Implemented

- Изменено:
  - `docs/architecture/schemas/manifest-authoring-common.schema.json`
  - `scripts/manifest-tools/authoring-compiler.cjs`
  - `scripts/ci/validate-manifest-authoring.js`
  - `docs/architecture/schemas/examples/authoring-v2/minimal-game.authoring.json`
  - `docs/architecture/schemas/examples/authoring-v2/minimal-ui.authoring.json`
  - `apps/editor-web/src/lib/editor-web-adapter.test.ts`
- Сделано: `_prompt` валидируется на `semanticEntity`, `_promptTemplate` валидируется на `authoringDefinition`, оба поля удаляются из generated runtime manifests.
- Сделано: editor-web local schema registry проверен тестом для game/UI authoring documents с `_prompt` и `_promptTemplate`; JSON tree/property surface видят `_prompt`.
- Проверки:
  - `npm run compile:manifests -- --check`
  - `npm run verify:manifest-authoring`
  - `npm run verify:editor-engine`
  - `npm run verify:editor-web`
  - `npm test --workspace @cubica/editor-web`
  - `rg -n '"_prompt"|"_promptTemplate"|_promptTemplate' games/*/game.manifest.json games/*/ui/*/ui.manifest.json` returned no matches.
- Осталось вне этого среза: reverse-sync, автогенерация промта из структуры, hash/coverage metadata, drift diagnostics and automatic prompt repair.
