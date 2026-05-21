# TSK-20260521-semantic-prototype-authoring-layer: Semantic Prototype Authoring Layer

## Оглавление

- [Status](#status)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented-mvp

## Why

ADR-030 вводит обязательный authoring layer для game/UI manifests: агенты и разработчики редактируют компактные исходные манифесты, а runtime/player получают только generated JSON, валидируемый runtime JSON Schema.

Эта задача нужна, чтобы превратить решение ADR-030 в проверяемую реализацию без архитектурного дрейфа:

- не создать второй runtime-контракт;
- не нарушить JSON Schema как single source of truth;
- не усложнить работу ИИ-агентов ручной синхронизацией двух слоев;
- не потерять game-agnostic дисциплину после появления прототипов.

## Terms

- Authoring manifest - исходный JSON-манифест для разработки, где разрешены `_type`, `_definitions`, `_extends`, `_semantics` и merge-операторы.
- Runtime manifest - generated JSON-манифест, который потребляют `runtime-api`, `player-web` и другие каналы.
- Generated output - файл, созданный компилятором. Его нельзя править вручную.
- Source map - сопутствующий файл соответствий между runtime JSON Pointer и authoring-источником.
- JSON Pointer - путь к узлу внутри JSON-документа, например `/screens/intro/components/0`.
- Идемпотентная сборка - повторная сборка без изменения входов дает тот же output.
- CI - автоматическая проверка изменений перед слиянием.

## Architecture Baseline

Работа опирается на уже зафиксированные решения:

- ADR-018: исполнимая логика игры остается JSON manifest truth model.
- ADR-025: JSON Schema является single source of truth для структуры манифестов.
- ADR-027: простая игра должна запускаться через game-agnostic default path.
- ADR-028: action templates остаются runtime-механизмом для компактных game manifests.
- ADR-029: lowest-tier logic rule сохраняется для gameplay logic.
- ADR-030: semantic prototype authoring layer применяется и к game manifest, и к UI manifest.
- ADR-031: task-файл и execution matrix содержат план исполнения, а ADR содержит только устойчивые решения.

## Scope

Входит в работу:

- определить физическую структуру authoring-файлов внутри `games/<id>/`;
- добавить JSON Schema для game authoring и UI authoring слоев;
- реализовать compiler для `_type`, `_definitions`, `_extends`, `_semantics` и минимального deterministic merge;
- генерировать runtime `game.manifest.json` и `ui.manifest.json`;
- генерировать source map как сопутствующий файл;
- добавить CI-проверку `compile -> diff --exit-code`;
- запретить ручные изменения generated runtime manifests без изменения authoring-входов;
- мигрировать минимальный pilot, чтобы доказать workflow на game и UI manifest;
- обновить документацию для агентов и разработчиков.

## Non-Goals

Не входит в работу:

- менять runtime-api так, чтобы он понимал authoring-прототипы;
- переносить весь `Antarctica` manifest за один шаг;
- вводить новый runtime DSL поверх ADR-028/029;
- заменять runtime JSON Schema authoring-схемой;
- менять portal/session boundary;
- удалять уже работающий game-agnostic default path.

## Requirements

### R1. Mandatory Authoring Layer

Для новых и изменяемых manifest-пакетов authoring layer является обязательным. Плоские runtime-манифесты, которые существуют до compiler-а, считаются переходным состоянием и должны получить план миграции.

### R2. Agent Editing Boundary

Агент редактирует authoring-файлы. Generated runtime manifests изменяются только компилятором. Если нужно изменить runtime output, сначала меняется authoring input.

### R3. Runtime Contract Purity

`runtime-api`, `player-web` и contracts layer не должны резолвить authoring-only ключи. Runtime получает только JSON, валидный по runtime schema.

### R4. Game And UI Coverage

Решение применяется к двум веткам:

- `game.manifest` authoring -> `game.manifest.json`;
- `ui.manifest` authoring -> `ui/<channel>/ui.manifest.json`.

### R5. JSON Schema SSOT

Authoring schemas должны быть JSON Schema. TypeScript-код компилятора может проверять графовые свойства и диагностировать ошибки, но не заменяет schema validation структуры.

### R6. `_type` And `_extends`

`_type` у экземпляра является семантическим типом. Наследование идет через `_extends` в definition. Каждое definition обязано иметь `_semantics`.

### R7. Source Map As Companion File

Трассировка источников хранится в source map как сопутствующем файле. Runtime manifests не получают `_source_trace`.

### R8. Determinism And Idempotence

Компилятор должен выдавать стабильный output: одинаковые входы дают одинаковые файлы без timestamp, сетевых запросов и скрытых зависимостей от окружения.

### R9. CI Enforcement

CI должен блокировать:

- рассинхрон authoring input и generated output;
- ручные изменения generated runtime manifests без изменения authoring-файлов;
- unknown authoring types;
- циклы и превышение глубины `_extends`;
- попадание authoring-only ключей в runtime manifests.

### R10. Platform Purity

Прототипы могут быть core, template или local, но core не должен получать game-specific типы. Game-specific definitions остаются внутри game bundle.

## Plan

### Phase 1. Structure And Conventions

1. Выбрать структуру файлов, например `games/<id>/authoring/game.authoring.json` и `games/<id>/authoring/ui/web.authoring.json`.
2. Описать naming rules для `_type` и `_definitions`.
3. Зафиксировать маркер generated files, чтобы CI мог отличать output от authoring input.
4. Обновить `.desc.json` для новых значимых каталогов.

### Phase 2. Authoring Schemas

1. Добавить общую schema для authoring system keys.
2. Добавить `game-authoring.schema.json`.
3. Добавить `ui-authoring.schema.json`.
4. Проверить, что schemas используют declarative validation и не дублируют TypeScript guards.

### Phase 3. Compiler MVP

1. Реализовать deterministic resolver для `_type` -> definition.
2. Реализовать `_extends` chain resolution с лимитом глубины 5.
3. Реализовать object deep merge и array replace.
4. Добавить guarded support для `+field` и `-field` только там, где schema разрешает merge.
5. Удалять authoring-only ключи из runtime output.

### Phase 4. Source Maps And Diagnostics

1. Генерировать `.source-map.json` для game manifest.
2. Генерировать `.source-map.json` для UI manifest.
3. Выводить ошибки с authoring file path и JSON Pointer.
4. Добавить тесты на понятную диагностику циклов, unknown type и conflict merge operators.

### Phase 5. Pilot Migration

1. Выбрать минимальный pilot: `games/simple-choice/`.
2. Перенести game manifest и web UI manifest в authoring-файлы.
3. Сгенерировать runtime manifests без изменения поведения.
4. Проверить, что player e2e по `simple-choice` проходит.

### Phase 6. CI And Governance

1. Добавить `npm run compile:manifests`.
2. Добавить `npm run verify:manifest-authoring`.
3. Включить проверку в `verify:canonical`.
4. Добавить проверку, что generated manifests не содержат `_type`, `_extends`, `_definitions`, `_semantics`.
5. Добавить документацию для агентов: где править, что запускать, как читать source map.

### Phase 7. Antarctica Migration Planning

1. Зарегистрировать текущий flat `Antarctica` как documented transition gap.
2. Разбить миграцию `Antarctica` на малые slices: UI screens, repetitive actions, content collections.
3. Не начинать полную миграцию до успешного pilot и зеленого CI.

## Acceptance

- ADR-030 отражает обязательный authoring layer, связь с ADR-028, game/UI coverage, `_type`/`_extends`, source map как сопутствующий файл и CI discipline.
- Для pilot game существуют authoring game/UI inputs и generated runtime outputs.
- Generated runtime manifests проходят runtime schemas.
- CI блокирует рассинхрон authoring/generated файлов.
- Агентская документация явно говорит: править authoring input, не generated output.
- Runtime/player code не содержит поддержки authoring-only ключей.
- Source map позволяет найти authoring-источник для generated action/screen/component.

## Validation

```text
npm run compile:manifests
npm run verify:manifest-authoring
npm run verify:canonical
npm run test:e2e
node scripts/dev/generate-structure.js
rg -n '"_type"|"_extends"|"_definitions"|"_semantics"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
```

Последний `rg` является review aid. После миграции expected result: runtime manifests не содержат authoring-only ключей, если они не являются явно разрешенным runtime contract.

## Artifacts

- `docs/tasks/artifacts/TSK-20260521-semantic-prototype-authoring-layer/execution-matrix.md`

## Handoff Log

### 2026-05-21 - Antarctica migration planning

- Added bounded execution documentation for migrating `Antarctica` game, web UI and telegram UI manifests to the ADR-030 authoring layer.
- New task: `docs/tasks/active/TSK-20260521-antarctica-authoring-manifest-migration.md`.
- New matrix: `docs/tasks/artifacts/TSK-20260521-antarctica-authoring-manifest-migration/execution-matrix.md`.
- Recommended next step remains parity adoption first: generate identical runtime output from authoring inputs before extracting semantic prototypes.

### 2026-05-21 - Implementation pass

- Added authoring schemas: `game-authoring.schema.json`, `ui-authoring.schema.json`, shared authoring definitions and source map schema.
- Added compiler CLI: `npm run compile:manifests`.
- Added governance check: `npm run verify:manifest-authoring`; `verify:canonical` now includes it.
- Added GitHub CI job `manifest authoring gate`.
- Migrated pilot `games/simple-choice` to authoring inputs:
  - `games/simple-choice/authoring/game.authoring.json`;
  - `games/simple-choice/authoring/ui/web.authoring.json`.
- Generated source maps next to runtime outputs:
  - `games/simple-choice/game.manifest.source-map.json`;
  - `games/simple-choice/ui/web/ui.manifest.source-map.json`.
- Updated UI manifest schema to match the currently executed UI manifest shape used by `simple-choice` and `Antarctica`: `layout_mode`, optional screen `type`, `richTextComponent`, and `helperComponent`.
- Remaining work: migrate `Antarctica` in bounded slices and decide whether the source map schema becomes a stable external contract or remains tooling-only.

### 2026-05-21 - AI agent

- Created project documentation for implementing ADR-030 after architecture review and user clarification.
- Updated ADR-030 to state that the authoring layer is mandatory for new/changed manifests, applies to both game and UI manifests, and supplements ADR-028.
- Captured the `_type` decision: semantic instance type plus `_extends` in definitions for inheritance.
- Captured source map as a сопутствующий файл, not `_source_trace` inside runtime manifests.
- Added execution matrix artifact for implementation planning.
- Next safe step: implement Phase 1 structure conventions and authoring schema skeletons before compiler code.
