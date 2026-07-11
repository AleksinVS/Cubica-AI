# TSK-20260616-antarctica-metric-projection-boundary-migration: Antarctica metric catalog and game/UI boundary migration

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Terms](#terms)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Migration Rules](#migration-rules)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

implemented

## Understanding

Работа понята так: нужно выполнить миграцию `Antarctica` к правилу ADR-054, где `game`-манифест владеет игровым смыслом, `ui`-манифест владеет channel-specific отображением, а Presenter строит player-facing projection.

Главная целевая правка: игровые метрики должны получить канонический словарь в game manifest, а UI должен ссылаться на метрики или `metricViews`, не быть единственным владельцем подписей "Знания", "Доверие", "Энергия" and similar gameplay concepts.

Отдельно согласовано:

- `time` - авторитетная игровая метрика "прошло дней";
- `remainingDays` - вычисляемая player-facing метрика "осталось дней";
- `score` не должен оставаться скрытым alias для "осталось дней".

## Architecture Source

- `docs/architecture/adrs/054-game-ui-manifest-boundary-and-metric-projection.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
- `docs/architecture/adrs/041-gameplay-object-state-model.md`
- `docs/architecture/adrs/053-game-defined-ui-panels.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`

Если миграция выявит новый platform-level механизм, которого нет в ADR-054, сначала обновить архитектурное решение. Исполнительные детали остаются в этом TSK и артефактах задачи, не в ADR.

## Why

Сейчас граница выглядит неровно:

- карточки `Antarctica` хранят игровые тексты в `game.manifest.json`, что соответствует target model;
- метрики хранят числовые значения в `state.public.metrics`, но их человекочитаемые подписи и часть смысловой классификации находятся в web UI authoring manifest;
- UI topbar/sidebar сам знает, что `pro` означает "Знания", `rep` означает "Доверие", `lid` означает "Энергия";
- plugin currently derives a display value from `time` into `score`, which hides the distinction between elapsed days and remaining days;
- Telegram, reports, facilitator views and future channels would have to duplicate metric names or infer meaning from web UI data.

This creates drift between Model and View. The migration should make metric meaning game-owned and leave UI with presentation-only details such as layout, icon paths and channel labels.

## Terms

- **Game meaning** - смысл сущности в правилах и методике игры: что такое метрика, карточка, этап, действие или событие.
- **UI presentation** - способ показать данные в конкретном канале: topbar, sidebar, panel, css class, icon, background and button label.
- **Player-facing projection** - модель данных, подготовленная для игрока Presenter or game plugin из game content and session state.
- **Metric catalog** - канонический словарь игровых метрик: id, label, description, source, computed rule and display metadata that is not channel-specific.
- **Computed metric** - вычисляемое значение, derived from authoritative session state. It is not independently mutable state.
- **Authoritative state** - состояние сессии, которое runtime хранит and mutates as source of truth.

## Current Findings

Baseline facts verified before implementation:

- `games/antarctica/authoring/game.authoring.json` and generated `games/antarctica/game.manifest.json` define `state.public.metrics.time`, `pro`, `rep`, `lid`, `man`, `stat`, `cont`, `constr`.
- Web UI authoring contained metric captions and value bindings in `games/antarctica/authoring/ui/web.authoring.json`.
- `games/antarctica/authoring/ui/web.authoring.json` also contained `root.metric_specs` with `time`, `score`, `pro`, `rep`, `lid`, `money`, `team`, `climate`; this list diverged from the rendered topbar metrics.
- Rendered topbar metrics included `score`, `pro`, `rep`, `lid`, `man`, `stat`, `cont`, `constr`.
- `games/antarctica/plugins/antarctica-player/src/register.ts` derived `metrics.score = 60 - metrics.time` when `time` was numeric and `score` was absent.
- Card texts already belong to game content and should not be moved to UI manifest in this task.

Initial inventory commands:

```text
rg -n '"metrics"|"metric_specs"|"score"|"remainingDays"|"caption"|"metricId"' \
  games/antarctica/authoring \
  games/antarctica/game.manifest.json \
  games/antarctica/ui \
  games/antarctica/plugins/antarctica-player/src \
  apps/player-web/src \
  services/runtime-api/src \
  packages/contracts
```

## Target State

Target manifest and projection model:

1. Game authoring/runtime manifest contains a metric catalog for `Antarctica`.
2. The catalog defines at least:
   - `time`: elapsed game days, state-backed by `public.metrics.time`;
   - `remainingDays`: computed days left, derived from `time` and declared game limit;
   - `pro`, `rep`, `lid`, `man`, `stat`, `cont`, `constr`: state-backed game metrics with canonical labels and descriptions.
3. `remainingDays` is available to player UI through `metricViews` or an equivalent player-facing projection.
4. UI topbar/sidebar uses metric ids or `metricViews` and keeps only presentation details:
   - order;
   - topbar/sidebar variant;
   - icon/background image paths;
   - CSS classes;
   - local UI-only labels when they are not gameplay concepts.
5. `score` is not used as an alias for remaining days.
6. Runtime state does not store both `time` and `remainingDays` as independently mutable fields.
7. No game-specific branch is added to `services/runtime-api`.

Suggested runtime-facing shape, subject to schema review:

```json
{
  "content": {
    "data": {
      "metrics": [
        {
          "metricId": "time",
          "label": "Прошло дней",
          "description": "Количество игровых дней, потраченных командой.",
          "kind": "state",
          "statePath": "public.metrics.time"
        },
        {
          "metricId": "remainingDays",
          "label": "Осталось дней",
          "description": "Сколько дней осталось до предельного срока.",
          "kind": "computed",
          "computed": {
            "expression": {
              "-": [
                { "var": "content.rules.dayLimit" },
                { "var": "public.metrics.time" }
              ]
            }
          }
        }
      ]
    }
  }
}
```

If the current manifest schema makes a different location more appropriate, choose the schema-compatible location but keep the ownership rule: metric meaning is game-owned, channel styling is UI-owned.

## Classification

The migration contains both general and game-specific parts.

General platform mechanics:

- metric catalog schema;
- computed metric contract;
- player-facing metric projection shape;
- validation that computed metrics are not independently mutable state.

Game-specific content:

- `Antarctica` metric ids, labels and descriptions;
- `Antarctica` day limit and `remainingDays` formula;
- Web topbar/sidebar image paths and layout choices;
- cleanup of the historical `score` alias.

General mechanics belong in schemas, contracts, content projection or reusable Presenter behavior. Antarctica-specific labels and day-limit semantics belong in `games/antarctica` manifests and plugin/projection code, not in generic runtime-api branches.

## Scope

In scope:

1. Inventory all metric semantics and bindings in game/UI manifests, plugin code, player-web and tests.
2. Add or extend schema/contract support for a game-owned metric catalog if current schema cannot express it.
3. Add `Antarctica` metric catalog in game authoring manifest and regenerate runtime manifest.
4. Add player-facing metric projection that resolves:
   - state-backed metric values;
   - computed `remainingDays`;
   - canonical labels/descriptions from game content.
5. Update web UI authoring manifest to reference projected metric data or metric ids.
6. Remove `score` as remaining-days alias from plugin and UI manifests.
7. Regenerate generated manifests and source maps.
8. Update tests and invariants.
9. Update this task and execution matrix with actual implementation evidence.

Potential implementation files:

- `docs/architecture/schemas/game-authoring-v2.schema.json`;
- `docs/architecture/schemas/game-manifest.schema.json`;
- `packages/contracts/manifest/src/index.ts`;
- `services/runtime-api/src/modules/content/*`;
- `games/antarctica/authoring/game.authoring.json`;
- `games/antarctica/game.manifest.json`;
- `games/antarctica/game.manifest.source-map.json`;
- `games/antarctica/authoring/ui/web.authoring.json`;
- `games/antarctica/ui/web/ui.manifest.json`;
- `games/antarctica/ui/web/ui.manifest.source-map.json`;
- `games/antarctica/plugins/antarctica-player/src/*`;
- `apps/player-web/src/*` only for game-agnostic projection/rendering behavior;
- relevant tests and documentation.

## Non-Goals

- Do not redesign Antarctica UI visuals.
- Do not move card text from game manifest to UI manifest.
- Do not change Antarctica branching, card effects or story content.
- Do not introduce game-specific branches in `services/runtime-api`.
- Do not store `remainingDays` as an independent mutable session metric.
- Do not keep `score` and `remainingDays` as permanent aliases for the same value.
- Do not replace JSON Schema validation with TypeScript-only guards.
- Do not promote Antarctica metric prototypes to platform-level prototypes.

## Migration Rules

1. `state.public.metrics.time` remains authoritative elapsed days.
2. `remainingDays` is computed from elapsed days and a declared game limit.
3. Metric labels and descriptions are gameplay metadata, not UI-only labels.
4. UI may own icon paths, visual variants and placement order.
5. UI should not infer meaning from raw state keys.
6. Presenter or game plugin builds `metricViews` from:
   - metric catalog;
   - session public state;
   - computed metric expressions;
   - channel-safe formatting rules.
7. Generated runtime manifests must not contain authoring-only fields.
8. Schema changes must be declarative and validated by Ajv or existing schema validation commands.
9. Every intermediate slice must compile and must not leave a permanent dual path.

## Execution Plan

### Phase 0. Baseline Inventory

1. Capture all current metric references and classify them as state, game meaning, UI presentation, projection or tests.
2. Record current rendered topbar/sidebar metric set.
3. Identify all `score` hits and classify each as real score, remaining-days alias or unrelated text.
4. Save canonical generated manifest snapshots if implementation needs runtime-diff checks.

### Phase 1. Contract And Schema

1. Check whether existing schemas already allow `content.data.metrics` with the required structure.
2. If not, extend JSON Schema for metric definitions:
   - state-backed metric;
   - computed metric;
   - labels/descriptions;
   - expression format.
3. Update TypeScript contracts generated or maintained from schema.
4. Add validation tests that reject invalid metric definitions and unsupported computed sources.

### Phase 2. Game Manifest Metric Catalog

1. Add metric catalog to `games/antarctica/authoring/game.authoring.json`.
2. Define canonical labels and descriptions for:
   - `time`;
   - `remainingDays`;
   - `pro`;
   - `rep`;
   - `lid`;
   - `man`;
   - `stat`;
   - `cont`;
   - `constr`.
3. Declare the day limit used by `remainingDays`.
4. Compile generated game manifest and source map.
5. Verify no authoring-only fields leak into runtime manifest.

### Phase 3. Player-Facing Metric Projection

1. Add generic or plugin-local projection that builds `metricViews`.
2. Compute `remainingDays` from `time` and declared limit.
3. Remove plugin behavior that writes `score = 60 - time`.
4. Ensure projection preserves current visible values for the player.
5. Add tests for elapsed days and remaining days at multiple `time` values.

### Phase 4. UI Manifest Migration

1. Update web UI authoring metric components to use `metricId` or `metricViews`.
2. Move gameplay captions out of UI component instances if they now come from `metricViews`.
3. Keep icon/background paths and visual layout in UI.
4. Replace remaining-days UI references from `score` to `remainingDays`.
5. Reconcile or remove `root.metric_specs` if it remains divergent and unused.
6. Compile generated UI manifest and source map.

### Phase 5. Tests And Invariants

1. Update player-web tests to assert `remainingDays` display and absence of `score` alias.
2. Add manifest invariants for:
   - metric catalog exists;
   - `remainingDays` is computed;
   - `state.public.metrics.remainingDays` is absent;
   - UI does not own gameplay metric captions as the only source.
3. Run game-agnostic validation to ensure no Antarctica branch leaked into platform runtime.

### Phase 6. Closeout

1. Update this task with implementation evidence.
2. Update execution matrix statuses.
3. Update `NEXT_STEPS.md`.
4. Record any deferred items as explicit debt, not silent drift.

## Acceptance

- `Antarctica` game manifest has a canonical metric catalog.
- `time` is documented and modeled as elapsed days.
- `remainingDays` is modeled as a computed metric, not mutable session state.
- `score` is not used as remaining-days alias in game/UI manifests or plugin projection.
- Web UI renders the same player-facing days-left value through `remainingDays`.
- Metric labels such as "Знания", "Доверие", "Энергия" come from game-owned metric metadata or `metricViews`.
- UI manifest owns visual placement, css classes and icon/background paths only.
- `root.metric_specs` is either reconciled with the target model or removed if unused.
- Runtime-api remains game-agnostic; no `gameId === "antarctica"` or equivalent branch is introduced.
- JSON Schema remains the source of truth for any new manifest shape.
- Generated manifests compile and validate.

## Validation

Required commands:

```text
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
npm run verify:player-web
npm run verify:game-agnostic
npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts tests/runtime-api.integration.ts
git diff --check
```

Focused review commands:

```text
rg -n '"score"|remainingDays|"metric_specs"|"metricViews"|metrics\\.score|metrics\\.time' \
  games/antarctica \
  apps/player-web/src \
  services/runtime-api/src \
  packages/contracts \
  docs/tasks/archive/TSK-20260616-antarctica-metric-projection-boundary-migration.md

rg -n "gameId.*antarctica|com\\.cubica\\.antarctica" \
  services/runtime-api/src \
  packages/contracts
```

Suggested invariant script:

```text
node - <<'NODE'
const fs = require("fs");
const game = JSON.parse(fs.readFileSync("games/antarctica/game.manifest.json", "utf8"));
const metrics = game.content?.data?.metrics || [];
const byId = new Map(metrics.map((metric) => [metric.metricId, metric]));
for (const id of ["time", "remainingDays", "pro", "rep", "lid", "man", "stat", "cont", "constr"]) {
  if (!byId.has(id)) throw new Error(`Missing metric catalog entry: ${id}`);
}
if (game.state?.public?.metrics && Object.prototype.hasOwnProperty.call(game.state.public.metrics, "remainingDays")) {
  throw new Error("remainingDays must be computed, not stored in state.public.metrics");
}
if (byId.get("remainingDays")?.kind !== "computed") {
  throw new Error("remainingDays must be a computed metric");
}
NODE
```

Manual checks:

- Open Antarctica in player-web.
- Confirm the days display still shows the expected remaining-day value.
- Trigger actions that change `time`.
- Confirm `remainingDays` updates while `time` remains elapsed days in runtime state.
- Confirm metric captions remain correct in topbar, hint panel and journal panel if present.

Actual automated validation on 2026-06-17:

```text
npm run compile:manifests -- --game antarctica --check
npm run build:player-web-plugin-bundles -- --game antarctica --check
npm test --workspace @cubica/player-web -- src/lib/metric-projection.test.ts src/components/manifest-renderer.test.tsx src/components/game-player-dom.test.tsx
npm run typecheck --workspace @cubica/player-web
npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts
npm run typecheck --workspace services/runtime-api
npm run verify:manifest-authoring
npm run verify:game-agnostic
npm run verify:player-web
git diff --check
```

Results:

- generated game/UI manifests and published player-web plugin bundle are current;
- player-web focused tests passed: 48 tests;
- full player-web verification passed: 124 tests and production build;
- runtime-api test command passed: 118 tests;
- runtime-api and player-web typechecks passed;
- manifest authoring and game-agnostic checks passed;
- whitespace check passed.

## Artifacts

- `docs/tasks/artifacts/TSK-20260616-antarctica-metric-projection-boundary-migration/execution-matrix.md`

## Risks

- Metric schema changes may be larger than the Antarctica-only migration if current schemas are too permissive or too narrow.
- Removing `score` too early can break existing UI tests or visual bindings. Replace with `remainingDays` in the same slice.
- `root.metric_specs` may be unused but still relied on by editor tooling. Inventory before deleting it.
- A generic computed metric evaluator can grow into a broad expression engine. Keep it limited to existing JsonLogic-style expression handling or projection-local evaluation already accepted by schemas.
- If `remainingDays` formula depends on a hardcoded day limit, put the limit in game-owned content/config, not in player-web code.

## Handoff Log

### 2026-06-16 - Documentation Created

- Created this execution package for ADR-054 migration.
- Captured the agreed metric semantics: `time` is elapsed days; `remainingDays` is computed days left; `score` is not the target name for days left.
- Created execution matrix artifact for phased implementation.
- Next safe step: run Phase 0 inventory before editing schemas or manifests.

### 2026-06-17 - Implementation Completed

- Added JSON Schema and TypeScript contracts for game-owned metric catalog entries and `GameMetricView`.
- Added `Antarctica` metric catalog under `content.data.metrics` and `content.data.rules.dayLimit = 60`.
- Added generic player-web metric projection from game content and session state.
- Exposed projected `metrics.remainingDays` and `metricViews` through `GamePresenter`.
- Updated `gameVariableComponent` to render by `metricId` from `metricViews`.
- Removed `metrics.score = 60 - metrics.time` from the Antarctica player plugin.
- Updated Antarctica web UI authoring/generated manifests to use `remainingDays` and metric ids; removed legacy `root.metric_specs`.
- Rebuilt the published Antarctica player-web plugin bundle.
- Added schema, projection, renderer and player-content tests.
- Remaining `score` hits are generic fixtures/tests or unrelated simple-choice score examples, not Antarctica days-left behavior.
