# TSK-20260616 Antarctica Metric Projection Boundary Execution Matrix

## Оглавление

- [Purpose](#purpose)
- [Invariants](#invariants)
- [Slice Matrix](#slice-matrix)
- [Metric Inventory](#metric-inventory)
- [File Impact Matrix](#file-impact-matrix)
- [Validation Gates](#validation-gates)
- [Deferred Decisions](#deferred-decisions)
- [Handoff Checklist](#handoff-checklist)

## Purpose

Эта матрица переводит ADR-054 в маленькие implementation slices для `Antarctica`.

Цель миграции: игровые подписи и смысл метрик должны жить в game manifest, UI должен владеть только представлением, а Presenter/player plugin должен отдавать renderer-ready `metricViews`, including computed `remainingDays`.

## Invariants

| Invariant | Required Control |
| --- | --- |
| `game` owns metric meaning. | Metric labels/descriptions are in game manifest metric catalog. |
| `ui` owns presentation. | Web icon paths, layout variants and CSS remain in UI manifest. |
| Presenter owns projection. | UI reads `metricViews` or `metricId`, not raw gameplay semantics from UI-only captions. |
| `time` is elapsed days. | Runtime state stores `state.public.metrics.time` only as elapsed days. |
| `remainingDays` is computed. | No mutable `state.public.metrics.remainingDays`; value is projected. |
| `score` is not remaining-days alias. | Remove `metrics.score = 60 - metrics.time` and replace UI references. |
| Platform stays game-agnostic. | No Antarctica-specific branch in `runtime-api` or contracts. |
| JSON Schema is source of truth. | Schema/contract changes are declarative and validated. |

## Slice Matrix

| Slice | Goal | Primary Edits | Done When | Status |
| --- | --- | --- | --- | --- |
| S0. Inventory | Classify all metric and score references. | No source edits except task log. | Inventory recorded with score classification. | completed |
| S1. Schema contract | Add or confirm metric catalog contract. | Schemas, contracts, validation tests. | Invalid metric shapes fail schema validation. | completed |
| S2. Game catalog | Add Antarctica metric catalog. | `games/antarctica/authoring/game.authoring.json`, generated game manifest/source map. | Catalog includes `time`, `remainingDays`, and core metrics. | completed |
| S3. Projection | Build `metricViews` and computed `remainingDays`. | Antarctica plugin or generic Presenter projection. | UI can read remaining days without `score` alias. | completed |
| S4. UI migration | Move UI bindings from gameplay captions/`score` to metric projection. | Web UI authoring and generated UI manifest/source map. | Topbar/sidebar render same values through target ids. | completed |
| S5. Cleanup | Remove stale aliases and unused divergent specs. | Plugin, tests, maybe `root.metric_specs`. | `score` is no longer days-left alias. | completed |
| S6. Closeout | Record evidence. | Task docs and matrix. | Acceptance and validation results recorded. | completed |

## Metric Inventory

Target metric catalog for `Antarctica`:

| Metric ID | Type | Meaning | Authoritative Source | UI Presentation Owner |
| --- | --- | --- | --- | --- |
| `time` | state | Прошло дней | `state.public.metrics.time` | UI may choose whether to show it. |
| `remainingDays` | computed | Осталось дней | formula from game day limit and `time` | UI may show as prominent metric. |
| `pro` | state | Знания | `state.public.metrics.pro` | UI owns icon/layout only. |
| `rep` | state | Доверие | `state.public.metrics.rep` | UI owns icon/layout only. |
| `lid` | state | Энергия | `state.public.metrics.lid` | UI owns icon/layout only. |
| `man` | state | Контроль | `state.public.metrics.man` | UI owns icon/layout only. |
| `stat` | state | Статус | `state.public.metrics.stat` | UI owns icon/layout only. |
| `cont` | state | Контакт | `state.public.metrics.cont` | UI owns icon/layout only. |
| `constr` | state | Конструктив | `state.public.metrics.constr` | UI owns icon/layout only. |

Current divergent or suspicious fields to classify:

| Current Field | Current Meaning | Target Handling |
| --- | --- | --- |
| `score` | previously used as days-left display in UI/plugin paths | Replaced with `remainingDays`; remaining `score` hits are generic tests or unrelated simple-choice fixtures. |
| `root.metric_specs.money` | appeared in UI specs, not current rendered topbar state | Removed with legacy `root.metric_specs`. |
| `root.metric_specs.team` | appeared in UI specs, not current rendered topbar state | Removed with legacy `root.metric_specs`. |
| `root.metric_specs.climate` | appeared in UI specs, not current rendered topbar state | Removed with legacy `root.metric_specs`. |

## File Impact Matrix

| File or Area | Expected Change | Slice |
| --- | --- | --- |
| `docs/architecture/schemas/game-authoring-v2.schema.json` | No change needed; runtime-facing `root.content` already allows structured data. | S1 |
| `docs/architecture/schemas/game-manifest.schema.json` | Added `content.data.metrics` and `content.data.rules.dayLimit` contract. | S1 |
| `packages/contracts/manifest/src/index.ts` | Added metric definition and `GameMetricView` types; `gameVariableComponent` now supports `metricId`. | S1 |
| `services/runtime-api/src/modules/content/*` | No behavior branch needed; existing game-agnostic `content.data` projection carries catalog. | S1/S3 |
| `games/antarctica/authoring/game.authoring.json` | Added metric catalog and day limit. | S2 |
| `games/antarctica/game.manifest.json` | Generated metric catalog. | S2 |
| `games/antarctica/plugins/antarctica-player/src/register.ts` | Removed `score` alias projection. | S3 |
| `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts` | Journal summaries now use state-metric labels from game-owned catalog. | S3/S4 |
| `games/antarctica/authoring/ui/web.authoring.json` | Uses metric ids/projection; removed metric gameplay captions/descriptions and `root.metric_specs`. | S4 |
| `games/antarctica/ui/web/ui.manifest.json` | Generated UI update. | S4 |
| `apps/player-web/src/*` | Added game-agnostic metric projection and renderer support for `metricViews`. | S3/S4 |
| Tests | Added schema, projection, UI behavior and player-content assertions. | S1-S5 |

## Validation Gates

Run after S1:

```text
npm run verify:manifest-authoring
npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts
git diff --check
```

Run after S2 and S4:

```text
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
git diff --check
```

Run after S3/S5:

```text
npm run verify:player-web
npm run verify:game-agnostic
npm test --workspace services/runtime-api -- tests/runtime-api.integration.ts
git diff --check
```

Final focused scans:

```text
rg -n 'metrics\\.score|\"score\"|remainingDays|metricViews|metric_specs' \
  games/antarctica \
  apps/player-web/src \
  services/runtime-api/src \
  packages/contracts

rg -n "gameId.*antarctica|com\\.cubica\\.antarctica" \
  services/runtime-api/src \
  packages/contracts
```

Expected interpretation:

- `remainingDays` hits should exist in game metric catalog, projection and UI binding.
- `"score"` hits must not be the days-left display path.
- Antarctica id hits must not appear in generic runtime/contracts code as behavior branches.

## Deferred Decisions

| Decision | Defer Until | Constraint |
| --- | --- | --- |
| Exact schema field names for metric catalog | closed | Runtime field is `content.data.metrics`; rule constants live under `content.data.rules`. |
| Whether computed metric expressions use JsonLogic exactly | closed | `remainingDays` uses declarative JsonLogic-style `-` expression; player-web evaluator is intentionally bounded. |
| Whether `root.metric_specs` is removed or reconciled | closed | Removed from Antarctica web UI manifest; fallback config remains only as legacy player fallback. |
| Whether true `score` is introduced later | Separate gameplay/product decision | Must not mean remaining days. |
| Platform-level metric UI prototype | Evidence from another game/channel | Antarctica-specific paths cannot be promoted. |

## Handoff Checklist

Before stopping implementation, update:

- active task `Handoff Log`;
- statuses in [Slice Matrix](#slice-matrix);
- metric inventory decisions;
- changed files;
- validation commands and results;
- remaining `score` hits classification;
- any deferred schema or projection decisions.
