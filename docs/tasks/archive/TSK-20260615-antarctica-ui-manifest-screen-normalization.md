# TSK-20260615-antarctica-ui-manifest-screen-normalization: Antarctica UI Manifest Screen Normalization

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Current Evidence](#current-evidence)
- [Target Model](#target-model)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

complete

## Understanding

Задача понята так: текущий web UI-манифест `Antarctica` смешал два разных понятия:

- UI-вариант экрана - переиспользуемый способ отображения данных, например информационный экран или доска выбора карточек.
- Сценарный экземпляр - конкретный шаг игры, например `i17`, `i19_1` или доска `55..60`.

UI-манифест должен описывать варианты интерфейса, а не заводить отдельный `screen` на каждый сценарный шаг. Для `Antarctica` ожидаемый порядок величины - примерно 4-7 UI-вариантов, а не 11 screen entries.

## Why

Сейчас `games/antarctica/ui/web/ui.manifest.json` содержит 11 экранов. Это затрудняет редактирование, порождает дубли в authoring-файле и делает UI-манифест похожим на сценарный manifest.

Работа нужна, чтобы:

- убрать дублирование одинаковых экранных каркасов;
- вернуть сценарные данные в игровой manifest и player-facing projection;
- упростить дальнейшее редактирование UI через authoring-манифесты;
- не переносить Antarctica-specific ids в общие platform contracts.

## Terms

- UI-манифест - декларативное описание интерфейса канала, например web; он описывает компоненты, компоновку и привязки к данным.
- UI-экран - запись в `screens`, которая задает самостоятельный вариант интерфейса с корневым компонентом.
- UI-шаблон - переиспользуемый UI-экран или компонентный каркас, который получает разные игровые данные через привязки.
- Presenter - слой между игровым состоянием и View; он выбирает текущую UI-проекцию и передает View готовые данные для отображения.
- Player-facing projection - данные, подготовленные для игрока из runtime state и manifest content; View должна читать их, а не повторять сценарный контент.

## Architecture Baseline

Работа опирается на уже принятые правила:

- ADR-013: логический манифест и UI-манифест разделены.
- ADR-024: bounded gameplay mechanics `Antarctica` остаются явными manifest-driven действиями и состоянием.
- ADR-025: JSON Schema остается source of truth для структур манифеста.
- ADR-027: простые игры могут идти через data-driven UI; game-specific логика допускается только в локальном plugin/config слое.
- ADR-030: редактируемым источником являются authoring manifests; runtime manifests генерируются.
- ADR-037: game-specific web plugin живет внутри `games/antarctica/plugins/antarctica-player`.
- ADR-040: новые server-side механики сначала выражаются через manifest/platform capabilities; game-specific ветки в `runtime-api` запрещены.

Новый ADR не требуется, если нормализация идет в рамках существующих контрактов: authoring UI, player-facing projection, локальный Antarctica plugin и текущие schema-defined UI components.

Если реализация потребует расширить общий `screen_routing` или UI schema новым универсальным механизмом, это нужно отдельно классифицировать как platform capability и синхронизировать ADR/`PROJECT_ARCHITECTURE.md`.

## Current Evidence

Текущий web UI runtime manifest:

- `games/antarctica/ui/web/ui.manifest.json` содержит 11 ключей в `screens`:
  - `S1`;
  - `55..60`, `61..66`, `67..70`;
  - `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21`;
  - `S1_LEFT`.
- `55..60`, `61..66`, `67..70` используют один layout `layout.web.board` и отличаются в основном `title`, `body`, card ids and action ids.
- `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21` используют один layout `layout.web.info` и отличаются только контентом: картинка, заголовок, текст, action id and button label.
- Те же сущности заведены отдельно в `games/antarctica/authoring/ui/web.authoring.json`, поэтому проблема находится в исходной authoring-модели, а не только в compiler output.

Игровой manifest уже содержит данные, которые UI сейчас дублирует:

- `content.data.infos[]` содержит `id`, `stepIndex`, `screenId`, `title`, `body`, `advanceActionId`, `advanceLabel`.
- `content.data.boards[]` содержит `id`, `title`, `body`, `stepIndex`, `screenId`, `cardIds`.
- `content.data.cards[]` содержит данные карточек и action ids.

## Target Model

Целевой web UI `Antarctica` должен иметь небольшой набор UI-вариантов. Рабочий ориентир:

| Target screen key | Role | Data source |
| --- | --- | --- |
| `card-grid-topbar` or equivalent | Верхняя панель + сетка карточек | Current board/card projection or opening fallback |
| `card-grid-leftsidebar` or equivalent | Левая панель + сетка карточек | Same projection, alternate layout |
| `board-topbar` or equivalent | Доска выбора действий | `currentBoard` + `boardCards` |
| `info-topbar` or equivalent | Информационный экран | `currentInfo` |
| `team-selection` or equivalent | Выбор команды, если переносится в manifest-driven UI | `currentTeamSelection` |

`i17`, `i18`, `i19`, `i19_1`, `i20`, `i21`, `55..60`, `61..66`, `67..70` не должны быть самостоятельными UI screen keys, если их отличие выражается данными.

Terminal state вроде `i21` не требует отдельного UI-экрана, если отличается только `advanceLabel` или `advanceActionId`.

## Scope

Входит в работу:

- нормализовать `games/antarctica/authoring/ui/web.authoring.json`;
- сгенерировать `games/antarctica/ui/web/ui.manifest.json` и `games/antarctica/ui/web/ui.manifest.source-map.json`;
- заменить step-specific UI screen keys на template-like screen keys;
- обновить routing/resolver слой для `Antarctica`, чтобы он выбирал UI-вариант и данные отдельно;
- сохранить runtime/game manifest как источник сценарных данных;
- обновить focused tests в `apps/player-web`;
- обновить документацию `apps/player-web/README.md`, если там перечислены старые screen keys as target model.

Возможные файлы реализации:

- `games/antarctica/authoring/ui/web.authoring.json`;
- `games/antarctica/ui/web/ui.manifest.json`;
- `games/antarctica/ui/web/ui.manifest.source-map.json`;
- `games/antarctica/plugins/antarctica-player/src/register.ts`;
- `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts`;
- `apps/player-web/src/lib/screen-router.ts`, только если требуется общий data-driven route behavior;
- `apps/player-web/src/components/manifest/*`, если существующих bindings/itemTemplate недостаточно;
- `apps/player-web/src/components/game-player*.test.tsx`;
- `apps/player-web/README.md`.

## Non-Goals

Не входит в эту задачу:

- менять сценарий `Antarctica`;
- переносить игровые тексты из game manifest в UI manifest;
- добавлять game-specific ветки в `services/runtime-api`;
- переименовывать canonical game content ids, если это не нужно для UI normalization;
- менять визуальный дизайн макетов;
- решать весь contracts neutrality cleanup, кроме точечных правок, напрямую вызванных этой задачей.

## Requirements

### R1. UI Screens Represent Interface Variants

`screens` в web UI manifest должны описывать варианты интерфейса. Сценарные id не должны становиться screen keys только потому, что меняются текст, картинка, список карточек или action id.

### R2. Scenario Data Stays In Game Content

Заголовки и тексты `infos`, board metadata, card ids and card action ids остаются в `games/antarctica/game.manifest.json` and player-facing content projection.

### R3. Routing Selects Template And Content Separately

Presenter/plugin должен сначала определить текущий content object (`currentInfo`, `currentBoard`, `currentTeamSelection`), а затем выбрать UI-вариант (`info-topbar`, `board-topbar`, etc.).

### R4. No Runtime-API Game Branches

Если нужен special case для `Antarctica`, он должен жить в `games/antarctica/plugins/antarctica-player` или в manifest data. `services/runtime-api` не получает branches по game id.

### R5. Preserve Player Behavior

После нормализации игрок должен видеть те же шаги, карточки, тексты, кнопки и переходы. Изменяется структура UI-манифеста, а не игровой сценарий.

### R6. Authoring Is The Edit Target

Правки выполняются через `games/antarctica/authoring/ui/web.authoring.json`; runtime UI manifest генерируется compiler flow.

### R7. Keep Fallback Safe

Если какой-то шаг пока не удается выразить через normalized UI screen, он должен оставаться через existing plugin/SafeModeRenderer fallback with documented reason, not by reintroducing per-step UI screens.

## Execution Plan

### Phase 0. Baseline And Inventory

1. Run or record baseline checks for manifest compilation and player-web tests.
2. Confirm current duplicate groups:
   - info group: `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21`;
   - board group: `55..60`, `61..66`, `67..70`.
3. Record exact current screen count and target screen keys before editing.

### Phase 1. Define Normalized UI Shape

1. Pick final target screen keys, avoiding scenario ids.
2. Define data contract for:
   - `currentInfo.title/body/image/advanceActionId/advanceLabel`;
   - `currentBoard.title/body/cardIds`;
   - `boardCards[]` with display text, availability and action id;
   - optional `currentTeamSelection`.
3. Check whether existing `itemTemplate` and expression resolver can bind this projection.
4. If not, add the smallest player-web Presenter/View extension without touching `runtime-api`.

### Phase 2. Normalize Authoring UI Manifest

1. Replace six `layout.web.info` screens with one reusable info screen.
2. Replace three `layout.web.board` screens with one reusable board screen.
3. Replace hardcoded card children in board screens with collection-driven rendering where practical.
4. Remove scenario-specific css suffixes like `info-content--i17` unless they encode a real visual variant.
5. Keep `S1`/`S1_LEFT` only if they represent distinct layout variants, not scenario steps.

### Phase 3. Update Routing And Projection

1. Update `Antarctica` plugin resolver to return normalized screen keys.
2. Ensure `currentInfo` and `currentBoard` continue to come from game content/state resolvers.
3. Keep `screen_routing` data-driven where current schema supports it.
4. Do not add step-specific route entries unless there is a real UI variant.

### Phase 4. Tests And Documentation

1. Update player-web unit/component tests to assert template reuse instead of per-step screen keys.
2. Add a focused invariant test or CI helper that fails if `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21`, `55..60`, `61..66`, `67..70` return as UI screen keys.
3. Update `apps/player-web/README.md` to describe UI variants instead of step-specific screens.
4. Run manifest compiler and verification commands.

## Acceptance

- `games/antarctica/ui/web/ui.manifest.json` has no more than 7 screen keys.
- `screens` does not contain `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21`, `55..60`, `61..66`, or `67..70`.
- Information steps render from one reusable info UI variant.
- Board steps render from one reusable board UI variant.
- Scenario text, board content and card actions are read from game content/player-facing projection, not duplicated as separate UI screens.
- `games/antarctica/authoring/ui/web.authoring.json` is the edited source and compiles to the runtime UI manifest.
- Existing Antarctica playthrough behavior is preserved for steps 30-38 and terminal `i21`.
- No game-specific logic is added to `services/runtime-api`.
- Player-web tests cover normalized routing and rendering.
- Documentation no longer presents step-specific screen keys as the target UI model.

## Validation

Required commands:

```text
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
npm run verify:player-web
npm run verify:game-agnostic
git diff --check
```

Recommended broader checks:

```text
npm run verify:canonical
npm run test:e2e
```

Focused screen-key invariant:

```text
node - <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("games/antarctica/ui/web/ui.manifest.json", "utf8"));
const forbidden = ["i17", "i18", "i19", "i19_1", "i20", "i21", "55..60", "61..66", "67..70"];
const keys = Object.keys(manifest.screens ?? {});
const leaked = forbidden.filter((key) => keys.includes(key));
if (keys.length > 7 || leaked.length > 0) {
  throw new Error(`Unexpected UI screen keys: count=${keys.length}, leaked=${leaked.join(",")}`);
}
NODE
```

## Artifacts

No separate artifact directory is required at planning time.

If implementation produces a comparison report, store it under:

```text
docs/tasks/artifacts/TSK-20260615-antarctica-ui-manifest-screen-normalization/
```

## Handoff Log

### 2026-06-15 - Planning documentation

- Changed: `docs/tasks/active/TSK-20260615-antarctica-ui-manifest-screen-normalization.md`.
- Done: captured the problem, current evidence, target UI model, execution phases, acceptance criteria and validation commands.
- Remaining: implement normalized authoring UI manifest, generated runtime UI manifest, plugin/player-web routing updates and tests.
- Next: start from `games/antarctica/authoring/ui/web.authoring.json`, reduce repeated info/board screens to reusable UI variants, then compile and update player-web tests.
- Risks: current generic `screen_routing` may not express "active info exists" cleanly; if so, keep that resolution in the local Antarctica plugin or propose a small platform capability separately.

### 2026-06-15 - Worker implementation

- Changed: `games/antarctica/authoring/ui/web.authoring.json`, generated `games/antarctica/ui/web/ui.manifest.json`, generated `games/antarctica/ui/web/ui.manifest.source-map.json`, `games/antarctica/plugins/antarctica-player/src/register.ts`, `games/antarctica/plugins/antarctica-player/src/config-data.ts`, published Antarctica player bundle metadata/artifact, `apps/player-web/src/components/manifest/button-component.tsx`, `apps/player-web/src/components/manifest/image-component.tsx`, `apps/player-web/src/components/manifest/ui-component-node.tsx`, `apps/player-web/src/components/game-player-dom.test.tsx`, `apps/player-web/README.md`, and this TSK.
- Done: normalized web UI screens to `S1`, `board-topbar`, `info-topbar`, and `S1_LEFT`; removed scenario screen keys from runtime UI manifest; routed Antarctica board steps through one reusable board UI variant and info steps through one reusable info UI variant; kept board/info text and action resolution in player-facing content projection/local Antarctica plugin.
- Validation: `npm run compile:manifests -- --game antarctica --check` OK; focused screen-key invariant OK with 4 screen keys and no forbidden keys; `npm run verify:manifest-authoring` OK; `npm run verify:player-web` OK; `npm run verify:game-agnostic` OK; `git diff --check` OK.
- Remaining: none for this task.
- Risks: the reusable info UI derives the illustration path from `currentInfo.id` (`/images/info/{{currentInfo.id}}.png`); this preserves the existing naming convention but still assumes the image asset naming stays aligned with info ids.

### 2026-06-15 - Parent verification

- Changed: `games/antarctica/plugins/antarctica-player/src/register.ts`, `apps/player-web/src/components/game-player.test.tsx`, and regenerated the published Antarctica player bundle.
- Done: limited `board-topbar` routing to real Antarctica board step indexes only; preserved the existing fallback path for the S2 team-selection step (`stepIndex: 15`), which is not a board screen.
- Validation: focused screen-key invariant OK with 4 screen keys; `npm test --workspace @cubica/player-web -- src/components/game-player.test.tsx` OK; `npm run compile:manifests -- --game antarctica --check` OK; `npm run verify:manifest-authoring` OK; `npm run verify:game-agnostic` OK; `npm run verify:player-web` OK; targeted `git diff --check` OK.
- Remaining: none for this task.
