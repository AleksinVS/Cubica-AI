# Phase 1A Report: Authoring V2 Contract And Small Fixtures

## Оглавление

- [1. Понимание этапа](#1-понимание-этапа)
- [2. Что реализовано](#2-что-реализовано)
- [3. Контракт v2](#3-контракт-v2)
- [4. Компиляция v2](#4-компиляция-v2)
- [5. Ограничение на большие JSON](#5-ограничение-на-большие-json)
- [6. Проверки](#6-проверки)
- [7. Вход в Phase 1B](#7-вход-в-phase-1b)

## 1. Понимание этапа

Phase 1A делает рабочий authoring v2 контракт без полной миграции существующих манифестов. Цель этапа - подготовить схемы, маленькие проверяемые фикстуры и compiler path, чтобы следующая часть могла мигрировать большие authoring-манифесты скриптами, а не ручным переписыванием JSON в контексте модели.

В этом документе **authoring-манифест** означает редактируемый source JSON, а не generated runtime manifest.

## 2. Что реализовано

- Добавлены `docs/architecture/schemas/game-authoring-v2.schema.json` and `docs/architecture/schemas/ui-authoring-v2.schema.json`.
- В `manifest-authoring-common.schema.json` добавлены общие определения `entityId`, `editorLabel`, `semanticDescription` and `semanticEntity`.
- Поле "Синоним" зафиксировано как `_label`.
- Добавлены минимальные v2 фикстуры:
  - `docs/architecture/schemas/examples/authoring-v2/minimal-game.authoring.json`;
  - `docs/architecture/schemas/examples/authoring-v2/minimal-ui.authoring.json`.
- `scripts/manifest-tools/authoring-compiler.cjs` умеет компилировать эти v2 фикстуры в runtime-schema-valid output.
- `scripts/ci/validate-manifest-authoring.js` проверяет v2 фикстуры как часть authoring governance gate.

## 3. Контракт v2

Общий semantic entity shape:

```json
{
  "id": "stable.ascii-id",
  "_type": "game.Action",
  "_label": "Отображаемое имя",
  "_semantics": "Краткое объяснение смысла сущности"
}
```

Game authoring v2:

- реальные сущности живут под `root`;
- `root.logic.flows[]` задает authoring chronology для timeline;
- `root.logic.actions[]` хранит игровые действия как сущности с `_label`;
- compiler emits runtime `actions` map keyed by action `id`;
- `_definitions` остаются прототипами and are not the container for real game content.

UI authoring v2:

- `root.screens[]` хранит экраны как сущности;
- каждый screen содержит `root` component tree;
- components use `children[]`;
- compiler emits runtime `screens` map keyed by screen `id`.

## 4. Компиляция v2

Compiler behavior added in Phase 1A:

- `_label`, `_type`, `_semantics`, `_schemaVersion`, `_manifestType`, `_channel`, `_definitions` are authoring-only and stripped from runtime output.
- In v2, `_type` is allowed to be semantic metadata even when there is no matching `_definitions` prototype.
- Game v2 transform maps:

```text
root.meta -> meta
root.config -> config
root.state -> state
root.engine -> engine
root.content -> content
root.logic.templates -> templates
root.logic.actions[] -> actions map
```

- UI v2 transform maps:

```text
root.meta -> meta
root.entry_point -> entry_point
root.screens[] -> screens map
```

This is intentionally minimal. It proves the v2 direction and keeps Phase 1B focused on real migration instead of schema guessing.

## 5. Ограничение на большие JSON

Current large authoring files:

| File | Size |
| --- | ---: |
| `games/antarctica/authoring/game.authoring.json` | 347879 bytes |
| `games/antarctica/authoring/ui/web.authoring.json` | 99359 bytes |
| `games/antarctica/authoring/ui/telegram.authoring.json` | 2526 bytes |
| `games/simple-choice/authoring/game.authoring.json` | 3633 bytes |
| `games/simple-choice/authoring/ui/web.authoring.json` | 4364 bytes |

Phase 1B must not ask a model to read or rewrite these files whole. Required workflow:

- inspect with `jq`, `rg` and dedicated Node.js scripts;
- operate through JSON Pointer summaries;
- produce deterministic migration scripts with `--dry-run`;
- write migration reports under this artifact directory;
- run compile and runtime schema checks after each bounded migration step.

## 6. Проверки

Phase 1A checks:

```text
node scripts/ci/validate-manifest-authoring.js
```

The gate validates current authoring manifests, compiles existing generated outputs in check mode and additionally compiles the v2 fixtures into runtime-valid manifests.

## 7. Вход в Phase 1B

Phase 1B starts from this state:

- `_label` is final.
- v2 schema and compiler fixture path exist.
- Existing authoring manifests are still structurally v1 and must be migrated.
- Temporary v1 validation remains only to keep the repository green before full migration.
- After Phase 1B, v1 support should be removed or explicitly marked as retired.
