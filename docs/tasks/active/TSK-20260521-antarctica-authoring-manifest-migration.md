# TSK-20260521-antarctica-authoring-manifest-migration: Antarctica Authoring Manifest Migration

## Оглавление

- [Status](#status)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Current Inventory](#current-inventory)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

remediation-complete

## Why

ADR-030 вводит обязательный authoring-слой для `game.manifest` и `ui.manifest`. `games/simple-choice` уже доказал минимальный путь, но `games/antarctica` остается большим плоским runtime-пакетом и поэтому является документированным переходным состоянием.

Эта задача нужна, чтобы перенести манифесты `Antarctica` на новую архитектуру без потери поведения, без ручной синхронизации двух слоев и без попадания authoring-only ключей в runtime.

## Terms

- Authoring-манифест - исходный JSON-файл для редактирования игры; он может содержать `_type`, `_definitions`, `_extends` и `_semantics`.
- Runtime-манифест - сгенерированный JSON-файл, который потребляют `runtime-api`, `player-web` и другие каналы.
- Сопутствующий файл - файл рядом с основным артефактом, который используют инструменты, но не runtime. Для этой задачи это `.source-map.json`.
- Source map - карта соответствий между JSON Pointer в runtime-манифесте и исходным authoring-узлом.
- JSON Pointer - путь к узлу внутри JSON-документа, например `/actions/opening.card.1`.
- Идемпотентная сборка - повторный запуск компилятора без изменения входных файлов дает тот же результат.

## Architecture Baseline

Работа опирается на следующие решения и ограничения:

- ADR-018: исполнимая логика `Antarctica` остается JSON manifest truth model.
- ADR-024: bounded gameplay mechanics `Antarctica` описываются явными manifest actions, follow-up paths и детерминированным состоянием.
- ADR-025: JSON Schema является single source of truth для runtime и authoring структур.
- ADR-028: runtime action templates остаются механизмом runtime-манифеста; authoring-прототипы не заменяют их.
- ADR-029: новая gameplay logic выбирает минимально мощный слой: templates, declarative logic, затем scripts.
- ADR-030: агенты редактируют authoring-файлы, generated runtime manifests создаются компилятором.
- ADR-031: этот файл и исполнительская матрица содержат план исполнения; ADR не используется как tracker.

## Current Inventory

Фактический вход на 2026-05-21:

| File | Role | Current size | Notes |
| --- | --- | ---: | --- |
| `games/antarctica/game.manifest.json` | runtime game manifest | 8260 lines | 144 actions; уже содержит runtime `templates`. |
| `games/antarctica/ui/web/ui.manifest.json` | runtime web UI manifest | 2944 lines | 11 screens, `topbar` and `leftsidebar` layouts, design artifacts. |
| `games/antarctica/ui/telegram/ui.manifest.json` | runtime telegram UI manifest | 71 lines | 1 minimal screen. |

Распределение runtime actions:

| Runtime action group | Count |
| --- | ---: |
| `opening-card-resolution` | 71 |
| `opening-card-advance` | 30 |
| `opening-info-advance` | 26 |
| `opening-team-selection` | 10 |
| no `templateId` | 7 |

Действия без `templateId` требуют отдельного review при authoring-миграции:

- `opening.board.25_30.advance`;
- `opening.team.confirm`;
- `requestServer`;
- `showHint`;
- `showHistory`;
- `showTopBar`;
- `showScreenWithLeftSideBar`.

## Scope

Входит в работу:

- создать `games/antarctica/authoring/game.authoring.json`;
- создать `games/antarctica/authoring/ui/web.authoring.json`;
- создать `games/antarctica/authoring/ui/telegram.authoring.json`;
- добавить `games/antarctica/authoring/.desc.json` и `games/antarctica/authoring/ui/.desc.json`;
- сгенерировать и закоммитить:
  - `games/antarctica/game.manifest.source-map.json`;
  - `games/antarctica/ui/web/ui.manifest.source-map.json`;
  - `games/antarctica/ui/telegram/ui.manifest.source-map.json`;
- сохранить runtime behavior текущей `Antarctica`;
- использовать существующий compiler `scripts/manifest-tools/compile-authoring-manifests.cjs`;
- обновить `PROJECT_STRUCTURE.yaml` после структурных изменений;
- подтвердить миграцию через `verify:manifest-authoring`, `verify:canonical` и e2e-проверку.

## Non-Goals

Не входит в работу:

- менять `runtime-api` или `player-web`, чтобы они понимали authoring-only ключи;
- удалять runtime action templates ADR-028;
- делать новый runtime DSL для `Antarctica`;
- переносить `draft/Antarctica/GameFull.html` в canonical source of truth;
- дробить authoring-файлы на include-пакеты до появления поддержки includes в compiler;
- переписывать визуальный дизайн `Antarctica`.

## Requirements

### R1. Authoring Becomes The Edit Target

После миграции любые изменения `Antarctica` manifest layer выполняются через `games/antarctica/authoring/**`. Runtime manifests изменяются только компилятором.

### R2. First Slice Is Parity Adoption

Первый implementation slice должен дать поведенчески идентичный output. Допустимая стратегия: обернуть текущий runtime manifest в верхнеуровневый authoring definition и получить semantic JSON parity после компиляции. Semantic JSON parity означает равенство разобранных JSON-значений без требования совпадения порядка ключей и финальных переводов строки.

### R3. Semantic Extraction Is Incremental

После parity adoption повторяющиеся структуры выносятся в `_definitions` малыми reviewable slices. Каждый такой slice должен сохранять generated output или иметь явно документированное intentional runtime изменение.

### R4. ADR-028 Templates Stay Runtime Output

Authoring-прототипы могут генерировать действия с `templateId` и `params`, но не должны заменять runtime templates как архитектурный слой.

### R5. UI Channels Are Covered

Миграция считается полной только после adoption для `web` и `telegram` UI manifests. Один канал не должен оставаться ручным runtime-файлом без зарегистрированного переходного статуса.

### R6. Source Maps Are Required

Для каждого adopted manifest output должен существовать сопутствующий `.source-map.json`, валидный по `manifest-source-map.schema.json`.

### R7. No Authoring Leakage

Сгенерированные runtime manifests не должны содержать `_type`, `_extends`, `_definitions`, `_semantics`, `_schemaVersion`, `_manifestType`, `_channel` или `_source_trace`.

### R8. Keep Game-Specific Definitions Local

Antarctica-specific prototypes должны жить в `games/antarctica/authoring/**`. Core registry или shared runtime contracts не получают типы, полезные только для `Antarctica`.

## Execution Plan

### Phase 1. Baseline And Guardrails

1. Зафиксировать baseline проверками `npm run verify:manifest-authoring`, `npm run verify:canonical` и `npm run test:e2e`.
2. Снять инвентарь action templates, no-template actions, UI screens и design artifacts.
3. Создать authoring directories и `.desc.json`.
4. Обновить `PROJECT_STRUCTURE.yaml`.

### Phase 2. Game Manifest Parity Adoption

1. Создать `games/antarctica/authoring/game.authoring.json`.
2. Добавить `_definitions.game.AntarcticaManifest` с текущим runtime содержимым.
3. Сделать `root` с `_type: "game.AntarcticaManifest"`.
4. Запустить `npm run compile:manifests -- --game antarctica`.
5. Подтвердить, что `games/antarctica/game.manifest.json` не меняет runtime behavior и проходит runtime schema.

### Phase 3. UI Manifest Parity Adoption

1. Создать `games/antarctica/authoring/ui/web.authoring.json`.
2. Создать `games/antarctica/authoring/ui/telegram.authoring.json`.
3. Для каждого канала начать с parity authoring definition.
4. Сгенерировать `ui.manifest.json` и `.source-map.json` для обоих каналов.
5. Подтвердить, что web и telegram runtime manifests проходят `ui-manifest.schema.json`.

### Phase 4. Semantic Prototype Extraction

1. Выделить game-level definitions:
   - `game.AntarcticaManifest`;
   - `game.OpeningInfoAdvanceAction`;
   - `game.OpeningCardResolutionAction`;
   - `game.OpeningCardAdvanceAction`;
   - `game.OpeningTeamSelectionAction`;
   - локальные definitions для no-template actions.
2. Выделить UI definitions:
   - `ui.AntarcticaWebManifest`;
   - `ui.TopbarScreen`;
   - `ui.LeftSidebarScreen`;
   - `ui.MetricPanel`;
   - `ui.InfoContentArea`;
   - `ui.ActionButton`;
   - `ui.TelegramScreen`.
3. Делать каждый extraction slice отдельно и проверять, что compiler output остается стабильным.

### Phase 5. Governance And Handoff

1. Убедиться, что `verify:manifest-authoring` включает adopted `Antarctica` files.
2. Проверить source maps для game, web UI и telegram UI.
3. Обновить этот TSK-файл и execution matrix фактическими результатами.
4. Если какие-либо плоские runtime-фрагменты оставлены намеренно, зарегистрировать их как bounded transition debt с владельцем и условием снятия.

## Acceptance

- `games/antarctica/authoring/game.authoring.json` существует и является источником `games/antarctica/game.manifest.json`.
- `games/antarctica/authoring/ui/web.authoring.json` существует и является источником `games/antarctica/ui/web/ui.manifest.json`.
- `games/antarctica/authoring/ui/telegram.authoring.json` существует и является источником `games/antarctica/ui/telegram/ui.manifest.json`.
- Все три source map файла существуют и валидируются.
- `npm run compile:manifests -- --game antarctica --check` проходит.
- `npm run verify:manifest-authoring` проходит.
- `npm run verify:canonical` проходит.
- `npm run test:e2e` проходит.
- Runtime/player код не импортирует compiler и не резолвит authoring-only ключи.
- `PROJECT_STRUCTURE.yaml` отражает новые authoring directories.

## Validation

```text
npm run verify:manifest-authoring
npm run compile:manifests -- --game antarctica --check
npm run verify:canonical
npm run test:e2e
node scripts/dev/generate-structure.js
git diff --check
rg -n '"_type"|"_extends"|"_definitions"|"_semantics"|"_source_trace"' games/antarctica/game.manifest.json games/antarctica/ui/web/ui.manifest.json games/antarctica/ui/telegram/ui.manifest.json
```

Последний `rg` является review aid: expected result после миграции - отсутствие authoring-only ключей в runtime output.

## Artifacts

- `docs/tasks/artifacts/TSK-20260521-antarctica-authoring-manifest-migration/execution-matrix.md`

## Handoff Log

### 2026-05-21 - Review remediation complete

- Follow-up remediation task completed: `docs/tasks/active/TSK-20260521-antarctica-authoring-review-remediation.md`.
- `opening.info.i21.advance` now exists as a terminal no-op action generated from `games/antarctica/authoring/game.authoring.json`.
- Source-map generation now points to existing authoring JSON Pointers after `_type` resolution; `verify:manifest-authoring` validates source-map files, pointers and dangling action references for adopted manifests.
- Documentation evidence was corrected to semantic JSON parity unless byte-level comparison is explicitly proven.
- Final validation passed: `npm run compile:manifests -- --game antarctica`, `npm run compile:manifests -- --game antarctica --check`, `npm run verify:manifest-authoring`, `npm run verify:canonical`, `npm run test:e2e`, `node scripts/dev/generate-structure.js`, `git diff --check`, and runtime authoring-key leakage scan.

### 2026-05-21 - Post-migration review follow-up

- Review found that the migration cannot be accepted as complete until three remediation items are addressed:
  - `opening.info.i21.advance` is referenced by web UI/game content but is not present in runtime actions;
  - generated source maps contain source pointers that do not exist after semantic prototype extraction;
  - handoff text overstates byte-equivalence where semantic JSON parity was the verified property.
- Follow-up task created: `docs/tasks/active/TSK-20260521-antarctica-authoring-review-remediation.md`.
- Follow-up matrix created: `docs/tasks/artifacts/TSK-20260521-antarctica-authoring-review-remediation/execution-matrix.md`.
- This migration task should remain under review until the remediation task passes acceptance.

### 2026-05-21 - Planning documentation

- Created execution documentation for migrating `Antarctica` manifests under ADR-030.
- Captured the current manifest inventory: game manifest, web UI manifest and telegram UI manifest.
- Defined the safe migration order: parity adoption first, semantic extraction second.
- Next implementation step: create `games/antarctica/authoring/**` and prove semantic JSON parity for the game manifest before extracting smaller prototypes.

### 2026-05-21 - Parity adoption (Slices A1–A4)

- Created `games/antarctica/authoring/.desc.json` and `games/antarctica/authoring/ui/.desc.json`.
- Created parity-adoption authoring manifests:
  - `games/antarctica/authoring/game.authoring.json` — wraps entire game runtime manifest in `game.AntarcticaManifest` definition.
  - `games/antarctica/authoring/ui/web.authoring.json` — wraps entire web UI runtime manifest in `ui.AntarcticaWebManifest` definition.
  - `games/antarctica/authoring/ui/telegram.authoring.json` — wraps entire telegram UI runtime manifest in `ui.AntarcticaTelegramManifest` definition.
- Compiled all three manifests; generated output has semantic JSON parity with the pre-existing runtime manifests (no behavioral change).
- Generated companion source maps:
  - `games/antarctica/game.manifest.source-map.json`
  - `games/antarctica/ui/web/ui.manifest.source-map.json`
  - `games/antarctica/ui/telegram/ui.manifest.source-map.json`
- All validation gates pass:
  - `npm run compile:manifests -- --game antarctica --check` — OK.
  - `npm run verify:manifest-authoring` — OK.
  - `npm run verify:canonical` — OK (runtime-api tests, player-web tests, build).
  - `npm run test:e2e` — 3 passed.
  - `git diff --check` — no whitespace errors.
  - `rg` for authoring-only keys in runtime output — zero matches.
- `PROJECT_STRUCTURE.yaml` regenerated via `node scripts/dev/generate-structure.js`.
- No runtime diff after compilation: parity adoption preserves behavior.
- Remaining work: semantic prototype extraction (Slices A5–A7), governance closeout (Slice A8).

### 2026-05-21 - Semantic prototype extraction (Slices A5–A7)

- Extracted game semantic prototypes (Slice A5):
  - `game.OpeningCardResolutionAction` — 71 actions sharing 3 identical fields (`handlerType`, `templateId`, `capabilityFamily`).
  - `game.OpeningCardAdvanceAction` — 30 actions sharing 3 identical fields.
  - `game.OpeningInfoAdvanceAction` — 26 actions sharing 4 identical fields (includes `deterministic.excludeFromLog`).
  - `game.OpeningTeamSelectionAction` — 10 actions sharing 4 identical fields.
  - 7 no-template actions extracted as unique definitions (`game.OpeningBoard2530Advance`, `game.OpeningTeamConfirm`, `game.RequestServer`, `game.ShowHint`, `game.ShowHistory`, `game.ShowTopBar`, `game.ShowScreenWithLeftSideBar`).
  - Total: 12 definitions in `_definitions`, 144 action references in `root.actions`.

- Extracted web UI semantic prototypes (Slice A6):
  - `ui.TopbarScreen` — shared screen shell for topbar layout (10 screens).
  - `ui.LeftSidebarScreen` — shared screen shell for leftsidebar layout (1 screen).
  - 16 metric variable definitions (`ui.MetricVariable{Id}{Topbar|LeftSidebar}`) — 8 metrics × 2 layout variants.
  - Total: 19 definitions in `_definitions`.

- Extracted telegram UI semantic prototypes (Slice A7):
  - `ui.TelegramScreen` — extracted single telegram screen into its own definition.
  - Total: 2 definitions in `_definitions`.

- All three compiled outputs keep semantic JSON parity with pre-extraction runtime manifests (zero behavioral drift).
- All validation gates pass:
  - `npm run compile:manifests -- --game antarctica --check` — OK.
  - `npm run verify:manifest-authoring` — OK.
  - `npm run verify:canonical` — OK (runtime-api 74 tests, player-web 102 tests, build).
  - `npm run test:e2e` — 3 passed.
  - `git diff --check` — no whitespace errors.
  - `rg` for authoring-only keys in runtime output — zero matches.
- Remaining work: governance closeout (Slice A8).
