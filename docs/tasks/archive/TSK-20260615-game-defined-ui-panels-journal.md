# TSK-20260615-game-defined-ui-panels-journal: Game-defined UI panels for Antarctica journal

## Status

implemented

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Game Manifest Check](#game-manifest-check)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Understanding

Работа понята так: журнал ходов в `Antarctica` должен перестать быть платформенным React UI. Его нужно описать как panel in the game UI manifest, отрендерить через общий manifest renderer and удалить старый `JournalRenderer` без постоянного fallback.

Дополнительно нужно убрать тот же тип дрейфа из game manifest: UI-only action для открытия журнала не должен жить в `games/antarctica/game.manifest.json` как deterministic game action.

## Why

Предыдущая нормализация web UI-манифеста сократила сценарные `screens` до reusable UI variants. После этого журнал ходов остался вне списка, потому что текущий код открывает его через платформенный `JournalRenderer`.

Это создает два нарушения:

- game-specific journal UI находится в `apps/player-web`;
- `showHistory` хранится в game manifest как игровое действие, хотя открытие журнала является UI-only interaction.

Целевой результат: platform owns panel lifecycle, Antarctica owns journal UI and journal data projection.

## Terms

- **Panel** - временный UI-слой поверх текущего игрового экрана. Он не является шагом сценария.
- **Overlay** - режим панели, при котором она отображается поверх текущего экрана.
- **UI-only action** - действие интерфейса, которое меняет только отображение конкретного клиента, например открывает журнал ходов.
- **Legacy fallback** - старый запасной путь исполнения. В этой задаче он должен быть удален сразу после перехода на manifest-defined panel.
- **Player-facing projection** - данные, подготовленные Presenter or game plugin for rendering by the View.

## Architecture Baseline

- ADR: `docs/architecture/adrs/053-game-defined-ui-panels.md`.
- Architecture summary: `docs/architecture/PROJECT_ARCHITECTURE.md`.
- UI manifest schema remains JSON Schema source of truth.
- Game-specific code must stay in `games/antarctica/plugins/antarctica-player` or game UI manifest, not in `services/runtime-api`.
- Platform player-web may contain generic panel lifecycle and generic manifest rendering only.

## Game Manifest Check

Checked files:

- `games/antarctica/game.manifest.json`
- `games/antarctica/authoring/game.authoring.json`
- `docs/architecture/schemas/game-manifest.schema.json`
- `docs/architecture/schemas/ui-manifest.schema.json`

Initial findings before implementation:

- `games/antarctica/game.manifest.json` contains `showHistory`.
- `showHistory` uses deterministic effect `ui.panel.open` with `panelId: "history"`.
- `showHistory` also appends `log.append` with `kind: "ui-panel-open"`.
- Nearby UI-only actions also exist: `showHint`, `showTopBar`, `showScreenWithLeftSideBar`.
- `docs/architecture/schemas/game-manifest.schema.json` currently allows `ui.panel.open` and `ui.screen.open` deterministic effects.
- `docs/architecture/schemas/ui-manifest.schema.json` currently has `screens`, but no first-class `panels` registry.

Implemented state:

- `games/antarctica/game.manifest.json` no longer contains `actions.showHistory`.
- `games/antarctica/ui/web/ui.manifest.json` contains `panels.history`.
- `showPanel`/`closePanel` are Presenter-local UI commands and do not dispatch runtime actions.
- `apps/player-web/src/components/panels/journal-renderer.tsx` was removed.
- Nearby UI-only actions (`showHint`, `showTopBar`, `showScreenWithLeftSideBar`) remain explicit follow-up drift, not target architecture.

Classification:

- Real card-choice `log.append` effects are game events and may stay in game manifest.
- Opening the journal from a button is UI-only and must move out of game manifest.
- The visual layout and filtering rules of the journal are game-specific UI and must move into the Antarctica UI manifest/plugin projection.

## Scope

In scope:

1. Add `panels` to the UI manifest schema and related TypeScript contracts.
2. Add generic player-web support for active manifest panels.
3. Render `gameUi.panels[activePanel]` through the existing manifest renderer.
4. Add `panels.history` to `games/antarctica/authoring/ui/web.authoring.json`.
5. Compile generated `games/antarctica/ui/web/ui.manifest.json`.
6. Move journal row data preparation to the Antarctica player plugin projection.
7. Replace `showHistory` UI commands with generic `showPanel` and `panelId: "history"`.
8. Remove `showHistory` from Antarctica game authoring and generated game manifests.
9. Remove `JournalRenderer`, direct `activePanel === "history"` branch and dedicated platform journal tests.
10. Rebuild published Antarctica player-web plugin bundle.
11. Add invariants that fail if journal UI returns to platform-specific rendering or if `showHistory` remains in game manifest.

## Non-Goals

- Do not redesign the journal visual style beyond manifest parity with the existing UI.
- Do not convert all future panels for every game.
- Do not introduce server-synchronized panel state.
- Do not add game-specific branches to `services/runtime-api`.
- Do not leave fallback support for `showHistory` or `JournalRenderer`.

## Execution Plan

1. Contract first:
   - extend `docs/architecture/schemas/ui-manifest.schema.json` with `panels`;
   - update manifest contracts/types;
   - keep JSON Schema as source of truth.

2. Generic player-web panel path:
   - introduce generic active panel rendering;
   - support `showPanel` / `closePanel` presenter commands;
   - render panel root through `ManifestRenderer`;
   - keep generic code independent of `history`.

3. Antarctica UI manifest:
   - add `panels.history` in authoring UI manifest;
   - bind panel collection to game-projected journal entries;
   - use `moves-journal` design artifact;
   - compile runtime UI manifest and source map.

4. Antarctica plugin projection:
   - expose journal entries as data for manifest renderer;
   - keep card front/back text and metric deltas sourced from content/session log;
   - avoid platform-specific journal filtering in `apps/player-web`.

5. Game manifest cleanup:
   - remove `showHistory` from `games/antarctica/authoring/game.authoring.json`;
   - compile generated `games/antarctica/game.manifest.json`;
   - ensure UI opening no longer appends `ui-panel-open` log entries.

6. Remove legacy immediately:
   - delete `apps/player-web/src/components/panels/journal-renderer.tsx`;
   - delete or rewrite `journal-renderer.test.tsx`;
   - remove direct `activePanel === "history"` branch;
   - remove `showHistory` command handling as a permanent alias.

7. Tests and bundle:
   - update DOM tests for manifest-defined history panel;
   - add schema/manifest invariants;
   - rebuild published Antarctica player bundle;
   - run validation.

## Acceptance

- `games/antarctica/ui/web/ui.manifest.json` contains `panels.history`.
- `games/antarctica/ui/web/ui.manifest.json` still has no scenario-specific journal screen in `screens`.
- Journal UI is rendered through manifest-defined panel components.
- `apps/player-web` has no platform-specific `JournalRenderer`.
- `apps/player-web` has no direct branch that renders a hardcoded history UI.
- `games/antarctica/game.manifest.json` has no `showHistory` action.
- `games/antarctica/game.manifest.json` does not append `ui-panel-open` log entries for opening history.
- Existing card-choice log entries remain available for journal data.
- `showPanel` command opens `history` without dispatching a game action to runtime-api.
- No game-specific history code is added to `services/runtime-api`.
- Published Antarctica player bundle points to a rebuilt content hash.

## Validation

Required commands:

```text
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
npm run verify:player-web
npm run verify:game-agnostic
npm run build:player-web-plugin-bundles -- --game antarctica
git diff --check
```

Focused invariants:

```text
jq -e '.panels.history' games/antarctica/ui/web/ui.manifest.json
! jq -e '.actions.showHistory' games/antarctica/game.manifest.json
! rg -n 'JournalRenderer|showHistory' apps/player-web/src games/antarctica/game.manifest.json games/antarctica/authoring/game.authoring.json
```

Manual check:

- Open Antarctica in player-web.
- Click "Журнал ходов".
- Verify the journal opens as an overlay/panel.
- Verify card entries show front text, result text and metric deltas.
- Verify closing the panel returns to the current screen without changing timeline.

## Artifacts

No separate artifact directory is required before implementation.

If implementation creates comparison reports or screenshots, store permanent reports under:

```text
docs/tasks/artifacts/TSK-20260615-game-defined-ui-panels-journal/
```

Temporary screenshots/logs must go to `.tmp/` and be removed after verification.

## Handoff Log

### 2026-06-15 - Planning documentation

- Changed: `docs/architecture/adrs/053-game-defined-ui-panels.md`, `docs/architecture/PROJECT_ARCHITECTURE.md`, `docs/tasks/archive/TSK-20260615-game-defined-ui-panels-journal.md`, `NEXT_STEPS.md`.
- Done: captured the architecture decision, checked `game.manifest` for the same UI/game boundary problem, and prepared sequential implementation plan with immediate legacy removal.
- Remaining: implement schema/contracts/player-web/plugin/manifest migration.
- Next: before starting code, update UI manifest schema and generated contracts, then migrate `Antarctica` history panel and remove `JournalRenderer`.
- Risks: nearby UI-only actions (`showHint`, `showTopBar`, `showScreenWithLeftSideBar`) show the same class of drift; if not migrated in this slice, record them as explicit follow-up debt instead of treating them as acceptable target state.

### 2026-06-15 - Implementation

- Changed: UI manifest schema/contracts now support `panels`; `player-web` renders active manifest panels through `ManifestRenderer`; Antarctica plugin projects `journalEntries`; `games/antarctica/authoring/ui/web.authoring.json` declares `panels.history`; `games/antarctica/authoring/game.authoring.json` no longer declares `showHistory`.
- Removed: `JournalRenderer`, `JournalMetricCluster`, their dedicated test, and the old `showHistory` command path.
- Rebuilt: published Antarctica player bundle now points to hash `479a0a7586c5900479cae95c9e6112c11885bdd62f67c6ac635fe85151cf876a`.
- Validation passed: `npm run compile:manifests -- --game antarctica --check`; `npm run verify:manifest-authoring`; `npm test --workspace @cubica/player-web -- src/components/manifest-renderer.test.tsx src/components/game-player-dom.test.tsx`; `npm run verify:player-web`; `npm run verify:game-agnostic`; `npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts tests/runtime-api.integration.ts`; `npm run build:player-web-plugin-bundles -- --game antarctica`; panel/action/legacy invariants; `git diff --check`.
- Remaining: migrate nearby UI-only game actions (`showHint`, `showTopBar`, `showScreenWithLeftSideBar`) in `docs/tasks/archive/TSK-20260615-antarctica-ui-only-actions-cleanup.md`.
