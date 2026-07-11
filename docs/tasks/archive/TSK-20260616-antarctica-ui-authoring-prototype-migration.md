# TSK-20260616-antarctica-ui-authoring-prototype-migration: Antarctica UI Authoring Prototype Migration

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Current Evidence](#current-evidence)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Target Prototype Set](#target-prototype-set)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Risks And Controls](#risks-and-controls)
- [Handoff Log](#handoff-log)

## Status

implemented

## Understanding

Задача понята так: нужно подготовить и затем выполнить локальную миграцию `games/antarctica/authoring/ui/web.authoring.json` на authoring-прототипы. Цель - убрать повторяющиеся UI-деревья внутри текущих screen и panel вариантов `Antarctica`, не меняя поведение player, generated runtime UI manifest, сценарные данные или runtime-api.

Это исполнительная документация, а не новое архитектурное решение. Архитектурный источник истины остается в ADR-030, ADR-036, ADR-048, ADR-050 и `docs/architecture/PROJECT_ARCHITECTURE.md`.

## Why

Текущий web UI authoring-манифест уже хранит UI как данные, но `_definitions` пустой. Повторяются:

- строки кнопок для журнала, подсказки и навигации;
- карточки с одинаковым `requestServer` действием;
- метрики верхней панели;
- shell-компоненты screen/panel;
- пары rich text компонентов для заголовка и тела;
- структура записи журнала.

Без локальных прототипов редактор и агент видят много копий вместо нескольких осмысленных UI-паттернов. Это повышает риск несогласованных правок и затрудняет последующую нормализацию UI-манифеста.

## Terms

- **Authoring-манифест** - исходный JSON для редактирования, где разрешены `_definitions`, `_type`, `_extends`, `_label`, `_semantics`, `_prompt` и `_promptTemplate`.
- **Runtime UI-манифест** - сгенерированный JSON, который потребляет `player-web`; authoring-only поля туда не попадают.
- **Прототип** - переиспользуемая authoring-only запись в `_definitions`; компилятор раскрывает ее в обычный JSON перед генерацией runtime-манифеста.
- **Game-level prototype** - локальный прототип конкретной игры. Он может содержать названия, css classes и asset paths, специфичные для `Antarctica`.
- **Platform-level prototype** - общий прототип платформы. Он не должен содержать game-specific id, тексты, пути к ассетам или правила одной игры.
- **Нулевая runtime-разница** - после изменения authoring-файла generated `ui.manifest.json` остается канонически тем же по содержанию; допустимо изменение source map из-за новых definition sources.

## Architecture Baseline

Работа следует существующим правилам:

- ADR-030: authoring-файлы являются редактируемым источником, runtime-файлы генерируются.
- ADR-036: реальные game/UI сущности живут в `root`, а `_definitions` остаются реестром прототипов.
- ADR-048: `_promptTemplate` хранится на прототипах и не попадает в runtime output.
- ADR-050: сначала вводятся локальные game-level prototypes; platform promotion идет только вручную.
- ADR-053: панели `history` и `hint` остаются game-defined UI panels, а не platform React-компонентами.

Компилятор уже поддерживает нужный механизм:

- экземпляр с `_type` подтягивает поля из `_definitions`;
- `_extends` используется внутри definition;
- массивы не сливаются, а заменяются целиком;
- authoring-only ключи удаляются из runtime output;
- для authoring v2 unresolved `_type` пока допускаются, поэтому новые локальные типы нужно вводить постепенно и проверять diff.

## Current Evidence

Исходный файл:

- `games/antarctica/authoring/ui/web.authoring.json`;
- `_schemaVersion`: `2.0`;
- `_definitions`: 20 локальных UI-прототипов после реализации;
- `root.screens`: `S1`, `board-topbar`, `info-topbar`, `S1_LEFT`;
- `root.panels`: `history`, `hint`.

Текущая структура компонентов в `root.screens` и `root.panels`:

| Component type | Count |
| --- | ---: |
| `areaComponent` | 45 |
| `buttonComponent` | 23 |
| `cardComponent` | 13 |
| `gameVariableComponent` | 40 |
| `imageComponent` | 1 |
| `panel` | 2 |
| `richTextComponent` | 12 |
| `screen` | 4 |
| `screenComponent` | 6 |

Baseline audit command:

```bash
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --scope file \
  --file games/antarctica/authoring/ui/web.authoring.json \
  --format json \
  --min-repeat 2 \
  --min-fields 3
```

Observed result:

- `filesScanned`: 1;
- `localPrototypes`: 20 after implementation;
- deterministic candidates: 47 after implementation with `--min-fields 3`;
- semantic candidates: 0;
- promotion candidates: 0.

The deterministic candidate count increased after implementation because the current scanner still reports small repeated residual shapes such as `props` and left-sidebar metric structures. This is not a runtime regression. The accepted migration evidence is the presence of local prototypes, zero canonical runtime UI diff, clean source-map pointers and clean generated-manifest leakage scan.

High-value candidate groups:

| Group | Evidence | Recommended handling |
| --- | --- | --- |
| Topbar metrics | 40 `gameVariableComponent`, 4 topbar/hint copies per metric plus one left-sidebar variant | Add metric prototypes, but preserve exact descriptions and asset paths through instance overrides. |
| Helper panel buttons | 12 show/close panel actions for `history` and `hint` | Add show/close panel button prototypes. |
| Navigation buttons | 8 `nav-left`/`nav-right` buttons | Add nav button prototype. |
| Static cards | 12 `cardComponent` instances on `S1` and `S1_LEFT` with `requestServer` | Add request-server card prototype. |
| Board card | Dynamic `board-card` for `boardCards` | Add separate board-choice card prototype. |
| Default bottom controls | 3 repeated four-button rows on `S1`, `board-topbar`, `S1_LEFT` | Add composite control-row prototype after leaf button prototypes. |
| Panel shell | `history` and `hint` share overlay panel structure | Add shell/container prototypes, but keep panel-specific content local. |
| Journal entry side | Front/back journal columns share `label + text` shape | Add journal entry side prototype in a later batch. |

## Classification

This migration is **game-specific authoring cleanup**. The proposed prototypes should start as local game-level prototypes in `games/antarctica/authoring/ui/web.authoring.json`.

General mechanics:

- compiler resolution of `_definitions`, `_type` and `_extends`;
- authoring-only stripping;
- prototype audit and proposal tooling.

Game-specific content:

- Antarctica css classes;
- Antarctica panel ids `history` and `hint`;
- Antarctica metric names and images;
- Antarctica card layout and journal wording.

Do not create platform-level prototypes in this task. Potential platform candidates such as generic panel button, nav button and overlay panel may be reviewed only after another game or channel proves the same shape without Antarctica-specific fields.

## Scope

In scope:

- add local `_definitions` to `games/antarctica/authoring/ui/web.authoring.json`;
- replace repeated authoring instances with `_type` references and only necessary overrides;
- preserve generated `games/antarctica/ui/web/ui.manifest.json` content;
- regenerate `games/antarctica/ui/web/ui.manifest.source-map.json`;
- use existing compiler and validation gates;
- update this task and execution matrix with actual validation results during implementation.

Potential implementation files:

- `games/antarctica/authoring/ui/web.authoring.json`;
- `games/antarctica/ui/web/ui.manifest.json`;
- `games/antarctica/ui/web/ui.manifest.source-map.json`;
- documentation under this task.

## Non-Goals

Out of scope:

- changing player-web rendering behavior;
- changing runtime-api;
- changing game manifest scenario data;
- changing screen routing;
- reducing screen count as part of this task;
- creating platform-level prototype catalog;
- introducing `_prototypeImports`;
- replacing JSON Schema validation with manual TypeScript guards.

## Target Prototype Set

First target set:

| Prototype `_type` | Kind | Applies to | Notes |
| --- | --- | --- | --- |
| `ui.AntarcticaShowPanelButton` | Leaf component | Buttons that open `history` or `hint` | Instance keeps `id`, `caption`, `panelId`. |
| `ui.AntarcticaClosePanelButton` | Leaf component | Buttons that close the active panel | Instance keeps `id`, `caption`, `panelId`. |
| `ui.AntarcticaNavButton` | Leaf component | `nav-left`, `nav-right` | Instance keeps caption and optional `disabled`. |
| `ui.AntarcticaRequestServerCard` | Leaf component | Static `S1` and `S1_LEFT` cards | Instance keeps `id` and `props.text`. |
| `ui.AntarcticaBoardChoiceCard` | Leaf component | `board-card` item template child | Keeps dynamic `card.*` bindings and `requestServer` payload shape. |
| `ui.AntarcticaTopbarMetricBadge` | Base leaf component | Topbar metric instances | Common `type: gameVariableComponent`; per metric fields stay in derived prototypes or instances. |
| `ui.AntarcticaTopbarScoreMetric` and metric-specific siblings | Leaf component | Repeated topbar/hint metric badges | Include stable caption, image and value; keep differing descriptions as overrides. |
| `ui.AntarcticaScreenRoot` | Shell component | Screen roots with arctic background | Include `type: screenComponent` and background image; instances keep css class. |
| `ui.AntarcticaOverlayPanel` | Panel shell | `history`, `hint` | Include `type`, `mode`, `layout_mode`; panel-specific title/design/content stays in instance. |
| `ui.AntarcticaPanelButtonContainer` | Container component | Panel button rows | Common css and children structure after leaf buttons are stable. |
| `ui.AntarcticaDefaultBottomControls` | Composite component | `S1`, `board-topbar`, `S1_LEFT` controls | Introduce only after leaf button prototypes pass zero runtime diff. |
| `ui.AntarcticaJournalEntrySide` | Composite component | Front/back journal columns | Later batch; use only if it remains readable. |

Rejected for first pass:

- `ui.Component` or another broad base for all components, because it would silently affect too many unrelated nodes.
- Prototype for only `props.cssClass`, because this is micro-deduplication and makes JSON harder to read.
- Prototype for only `payload.panelId`, because it should be absorbed into button prototypes.
- Full-screen prototypes with large `children[]`, because arrays are replaced, not merged; this can make overrides brittle.

## Execution Plan

### Phase 0. Baseline

1. [x] Run manifest compilation checks before editing.
2. [x] Save current generated runtime UI manifest for canonical diff.
3. [x] Run deterministic prototype audit and record summary in `Handoff Log`.
4. [x] Confirm `_definitions` is still empty before migration.

### Phase 1. Leaf Buttons

1. [x] Add `ui.AntarcticaShowPanelButton`, `ui.AntarcticaClosePanelButton` and `ui.AntarcticaNavButton`.
2. [x] Replace only repeated button instances.
3. [x] Do not change button order or container structure.
4. [x] Compile and verify zero runtime UI diff.

### Phase 2. Cards

1. [x] Add `ui.AntarcticaRequestServerCard`.
2. [x] Replace the 12 static `S1`/`S1_LEFT` card instances.
3. [x] Add `ui.AntarcticaBoardChoiceCard` for the dynamic `board-card`.
4. [x] Keep card text and dynamic bindings on instances where needed.
5. [x] Compile and verify zero runtime UI diff.

### Phase 3. Metrics

1. [x] Add `ui.AntarcticaTopbarMetricBadge` as a small base prototype.
2. [x] Add metric-specific topbar prototypes for `score`, `pro`, `rep`, `lid`, `man`, `stat`, `cont`, `constr`.
3. [x] Replace repeated topbar and hint metric instances.
4. [x] Keep differing `description` fields as instance overrides.
5. [x] Do not migrate left-sidebar metrics unless there are at least two identical source instances or a clear follow-up variant.

### Phase 4. Containers And Shells

1. [x] Add `ui.AntarcticaScreenRoot` for common screen root fields.
2. [x] Add `ui.AntarcticaDefaultBottomControls` for the repeated four-button row on `S1`, `board-topbar`, `S1_LEFT`.
3. [x] Add `ui.AntarcticaOverlayPanel` and `ui.AntarcticaPanelButtonContainer` if they do not hide panel-specific meaning.
4. [x] Do not extract large screen-level prototypes with full `children[]`.

### Phase 5. Journal Internals

1. [x] Review journal-specific candidates after earlier phases reduce noise.
2. [x] Defer `ui.AntarcticaJournalEntrySide`: current compiler array replacement makes a parameterized two-child side prototype awkward without hiding the label/text bindings.
3. [x] Keep journal wording and binding values explicit on instances.

### Phase 6. Closeout

1. [x] Re-run prototype audit.
2. [x] Record final `localPrototypes` and remaining high-confidence candidates.
3. [x] Confirm runtime UI manifest has no authoring-only keys.
4. [x] Update task status and handoff log.

## Acceptance

1. [x] `games/antarctica/authoring/ui/web.authoring.json` contains local UI prototypes in `_definitions`.
2. [x] Leaf button and card prototypes are applied.
3. [x] Metric prototypes are applied where they reduce meaningful duplication without hiding variant descriptions.
4. [x] Generated `games/antarctica/ui/web/ui.manifest.json` has zero intentional runtime UI diff by canonical JSON comparison.
5. [x] Generated runtime manifests contain no `_definitions`, `_type`, `_extends`, `_promptTemplate`, `_prototypeImports` or `_source_trace`.
6. [x] Source map pointers refer to existing authoring nodes.
7. [x] No changes are made to `runtime-api` or generic `player-web` to support these prototypes.
8. [x] No platform-level prototype is created from Antarctica-specific UI.
9. [x] Prototype audit reports 20 local prototypes. Remaining deterministic candidates are residual/deferred small shapes, not a blocker.
10. [x] Handoff log records changed files, validation commands and deferred candidates.

## Validation

Required after each phase:

```bash
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --scope file \
  --file games/antarctica/authoring/ui/web.authoring.json \
  --format json \
  --min-repeat 2 \
  --min-fields 3
git diff --check
```

Runtime leakage scan:

```bash
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' \
  games/*/game.manifest.json \
  games/*/ui/*/ui.manifest.json
```

Optional player check when generated UI output changes unexpectedly:

```bash
npm run verify:player-web
```

## Artifacts

- `docs/tasks/artifacts/TSK-20260616-antarctica-ui-authoring-prototype-migration/execution-matrix.md` - executable slice matrix, candidate list and validation gates.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Over-extraction makes the manifest harder to read. | Start with leaf prototypes; avoid screen-level prototypes with large arrays. |
| Arrays are replaced, not merged. | Do not put large `children[]` into definitions unless all source instances are identical. |
| Source map points to removed authoring paths. | Run source-map pointer existence checks through compile/validation flow. |
| Runtime UI changes accidentally. | Require canonical runtime diff after every batch. |
| Antarctica UI leaks into platform-level prototype catalog. | Keep all prototypes local in this task. |
| Metric descriptions differ by instance. | Keep differing descriptions as overrides, not in a shared definition. |

## Handoff Log

### 2026-06-16 - AI agent

- Changed: created this active task, added the execution-matrix artifact, added the task to `NEXT_STEPS.md`, documented the active task in `docs/tasks/active/.desc.json`, and regenerated `PROJECT_STRUCTURE.yaml`.
- Validation: `node scripts/dev/generate-structure.js` passed; `git diff --check` passed.
- Done: documented local UI prototype migration target, phased plan, acceptance criteria, risks and required validation.
- Remaining: implement prototypes in `games/antarctica/authoring/ui/web.authoring.json` in small phases with zero runtime diff.
- Next: start with Phase 0 baseline, then Phase 1 leaf button prototypes.
- Risks: current worktree is dirty with unrelated changes; implementation must not revert or normalize unrelated files.

### 2026-06-16 - AI agent implementation

- Changed:
  - `games/antarctica/authoring/ui/web.authoring.json`
  - `games/antarctica/ui/web/ui.manifest.json`
  - `games/antarctica/ui/web/ui.manifest.source-map.json`
  - `docs/tasks/archive/TSK-20260616-antarctica-ui-authoring-prototype-migration.md`
  - `docs/tasks/artifacts/TSK-20260616-antarctica-ui-authoring-prototype-migration/execution-matrix.md`
  - `NEXT_STEPS.md`
- Done:
  - Added 20 local `ui.Antarctica*` game-level prototypes.
  - Applied prototypes to helper buttons, nav buttons, static cards, dynamic board card, repeated topbar metrics, screen roots, overlay panels, panel button containers, fallback rich text and default bottom controls.
  - Deferred journal side extraction because current array replacement would make parameterization less readable.
- Validation:
  - `npm run compile:manifests -- --game antarctica --check` - passed.
  - `npm run verify:manifest-authoring` - passed.
  - Source-map pointer existence check for `games/antarctica/ui/web/ui.manifest.source-map.json` - passed, 0 missing pointers.
  - Generated runtime leakage scan for `_definitions`, `_type`, `_extends`, `_promptTemplate`, `_prototypeImports`, `_source_trace` - passed, no matches.
  - Canonical JSON comparison of `games/antarctica/ui/web/ui.manifest.json` before/after prototypes - passed, identical.
  - `npm run verify:player-web` - passed, 120 tests and production build.
  - `git diff --check` - passed.
- Audit:
  - `localPrototypes`: 20.
  - `deterministicCandidates`: 47 with `--min-fields 3`; remaining candidates are mostly residual `props`, left-sidebar metric variants, `metric_specs` and journal internals.
- Remaining:
  - Consider a separate cleanup for left-sidebar metrics and `root.metric_specs` reconciliation.
  - Consider journal internals only after editor readability for array-backed prototypes is improved.
- Next:
  - If continuing this line, implement a smarter audit suppression or grouping rule so extracted prototype instances do not create noisy micro-candidates.
