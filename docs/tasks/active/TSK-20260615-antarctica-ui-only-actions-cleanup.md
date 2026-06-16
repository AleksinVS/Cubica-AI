# TSK-20260615-antarctica-ui-only-actions-cleanup: remove remaining UI-only actions from Antarctica game manifest

## Status

implemented

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Decision Basis](#decision-basis)
- [Terms](#terms)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Understanding

Работа понята так: после переноса журнала ходов в `ui.panels.history` в game manifest `Antarctica` оставались три UI-only actions: `showHint`, `showTopBar`, `showScreenWithLeftSideBar`. Их нужно было убрать из логического манифеста, потому что они меняли только отображение web player и не были игровыми ходами.

Задача реализована. Текущий путь: подсказка описана как `ui.panels.hint`, кнопки вызывают Presenter-local command `showPanel`, а `showTopBar` и `showScreenWithLeftSideBar` не имеют runtime-замены.

## Decision Basis

- ADR: `docs/architecture/adrs/053-game-defined-ui-panels.md`.
- Previous task: `docs/tasks/active/TSK-20260615-game-defined-ui-panels-journal.md`.
- Architecture summary: `docs/architecture/PROJECT_ARCHITECTURE.md`.

Новый ADR не требуется: ADR-053 уже принял правило, что UI-only commands belong to UI manifest and Presenter state, not to deterministic game actions. Эта задача является исполнительным follow-up для оставшегося дрейфа.

JSON Schema остается источником истины для manifest structures. Если нужно расширять UI command payloads or panel definitions, это должно идти через JSON Schema, а не через отдельные ручные проверки в TypeScript.

## Terms

- **UI-only action** - команда интерфейса, которая меняет только локальное отображение игрока: открыть подсказку, переключить вариант раскладки, закрыть панель.
- **Game action** - действие игровой модели, которое проходит через `runtime-api`, меняет authoritative session state, участвует в replay/audit and can write domain log entries.
- **Panel** - временный UI-слой поверх текущего экрана. Панель не является шагом сценария.
- **Layout selector** - локальный выбор варианта раскладки, например `topbar` or `leftsidebar`; сам по себе не является игровым событием.
- **Drift** - расхождение текущего кода с целевой архитектурой. Здесь drift состоит в том, что UI-only commands живут в game manifest.

## Current Findings

Checked files:

- `games/antarctica/authoring/game.authoring.json`
- `games/antarctica/game.manifest.json`
- `games/antarctica/authoring/ui/web.authoring.json`
- `games/antarctica/ui/web/ui.manifest.json`
- `apps/player-web/src/lib/manifest-action-adapter.ts`
- `apps/player-web/src/presenter/game-presenter.ts`
- `apps/player-web/src/components/game-player.tsx`
- `apps/player-web/src/components/safe-mode-renderer.tsx`

Initial game manifest actions before implementation:

- `showHint`
  - capability: `ui.panel.open`;
  - effect: `ui.panel.open` with `panelId: "hint"`;
  - extra log effect: `kind: "ui-panel-open"`;
  - UI manifest still calls `"command": "showHint"` in several web panel button rows.

- `showTopBar`
  - capability: `ui.panel.open`;
  - effect: `ui.panel.open` with `panelId: "top-bar"`;
  - extra log effect: `kind: "ui-panel-open"`;
  - no current web UI command references were found.

- `showScreenWithLeftSideBar`
  - capability: `ui.screen.open`;
  - effect: `ui.screen.open` with `screenId: "left-sidebar"` and `layoutId: "left-sidebar"`;
  - extra log effect: `kind: "ui-screen-open"`;
  - no current web UI command references were found.

Initial player-web drift before implementation:

- `ManifestAction.SHOW_HINT` still exists and is handled as a special Presenter command.
- `ManifestAction.SHOW_LEFT_SIDEBAR` still exists and is mapped by the manifest action adapter to a runtime action.
- `HintRenderer` is still a platform React path for `activePanel === "hint"`.
- `SafeModeRenderer` still emits `showHint`.

Initial routing/layout facts:

- `Antarctica` initial state has `state.public.ui.activeScreen: "topbar"`.
- `screen_routing` already contains a left-sidebar route with `layoutMode: "leftsidebar"`.
- `player-web` can resolve layout from `screen_routing`, `layout_mode`, and runtime UI state.

Implemented state:

- `games/antarctica/authoring/game.authoring.json` and generated `games/antarctica/game.manifest.json` no longer contain `showHint`, `showTopBar`, or `showScreenWithLeftSideBar`.
- `games/antarctica/authoring/ui/web.authoring.json` and generated `games/antarctica/ui/web/ui.manifest.json` contain `panels.hint`.
- Antarctica web UI commands now use `showPanel` with `panelId: "hint"` and `closePanel` for closing the hint panel.
- `AntarcticaGameState` projection exposes `hintText` and `hasHintText`; the panel renders those fields through `ManifestRenderer`.
- `ManifestAction.SHOW_HINT`, `ManifestAction.SHOW_LEFT_SIDEBAR`, platform `HintRenderer`, and default runtime dispatch for those aliases were removed.
- Published Antarctica player-web plugin bundle was rebuilt with content hash `88085843565cd0f7f20eaa695a3e8f50a519df171063bbefc1e1dd74f3e3222c`.

## Target State

### `showHint`

Target:

- remove `actions.showHint` from `games/antarctica/authoring/game.authoring.json`;
- generated `games/antarctica/game.manifest.json` must not contain `actions.showHint`;
- replace UI commands from `"command": "showHint"` to:

```json
{
  "command": "showPanel",
  "payload": { "panelId": "hint" }
}
```

- add or confirm `ui.panels.hint` in the web UI manifest;
- expose hint text through the Antarctica player-facing projection, for example `hintText`;
- render hint through `ManifestRenderer`, not a hardcoded `HintRenderer` branch;
- remove `ManifestAction.SHOW_HINT` only after all player-web callers are migrated.

### `showTopBar`

Target:

- remove `actions.showTopBar` from authoring and generated game manifests;
- do not add a replacement runtime action;
- topbar selection should come from the active screen's `layout_mode`, `screen_routing`, or local Presenter UI state if a future UI control really needs a toggle.

### `showScreenWithLeftSideBar`

Target:

- remove `actions.showScreenWithLeftSideBar` from authoring and generated game manifests;
- remove default adapter dispatch from `ManifestAction.SHOW_LEFT_SIDEBAR` to runtime action;
- if a user-facing layout toggle is needed, define a local Presenter command such as `setLayoutMode` or `showScreenVariant` and validate it through UI manifest schema;
- do not write `ui-screen-open` log entries for local layout selection.

## Scope

In scope:

1. Remove the three UI-only actions from Antarctica game authoring manifest.
2. Compile generated game manifest and source map.
3. Replace web UI `showHint` commands with `showPanel` and `panelId: "hint"`.
4. Add `panels.hint` to Antarctica web UI manifest or explicitly migrate hint rendering to an existing manifest panel if already present.
5. Move hint display data into Antarctica plugin projection.
6. Remove or deprecate player-web special handling for `SHOW_HINT` and `SHOW_LEFT_SIDEBAR` after callers are gone.
7. Update tests to assert local UI command behavior and absence of runtime POST for hint/layout controls.
8. Add CI invariants for absence of these action ids in game manifest.
9. Rebuild published Antarctica player-web plugin bundle if plugin projection changes.

## Non-Goals

- Do not redesign the visual style of hints or topbar/left-sidebar screens.
- Do not remove JSON Schema support for `ui.panel.open` or `ui.screen.open` globally unless a separate cross-game audit confirms it is safe.
- Do not remove runtime support for manifest-declared UI effects used by other games without a dedicated architecture decision.
- Do not add Antarctica-specific branches to `services/runtime-api`.
- Do not create a second fallback path where both `showHint` and `showPanel/hint` remain permanent commands.

## Execution Plan

1. Contract audit:
   - search all source, tests, and generated manifests for `showHint`, `showTopBar`, `showScreenWithLeftSideBar`;
   - classify each occurrence as game manifest action, UI manifest command, player-web command alias, test fixture, or documentation.

2. Hint panel migration:
   - add `panels.hint` to `games/antarctica/authoring/ui/web.authoring.json`;
   - expose `hintText` and, if useful, `hasHintText` from `games/antarctica/plugins/antarctica-player`;
   - replace UI commands with `showPanel` payload `{ "panelId": "hint" }`;
   - remove hardcoded `HintRenderer` branch only after `panels.hint` covers the expected DOM/tests.

3. Layout action cleanup:
   - remove `showTopBar` and `showScreenWithLeftSideBar` from `games/antarctica/authoring/game.authoring.json`;
   - confirm no web UI command depends on them;
   - remove default adapter mapping for `SHOW_LEFT_SIDEBAR` if no callers remain.

4. Game manifest cleanup:
   - remove `showHint` from `games/antarctica/authoring/game.authoring.json`;
   - compile manifests;
   - verify no generated `ui-panel-open` or `ui-screen-open` log effect remains for these local UI commands.

5. Tests and invariants:
   - update player-web DOM tests for hint panel opening through `showPanel`;
   - add/adjust game-agnostic CI invariant for UI-only action ids;
   - verify no runtime POST is sent for hint open or local layout selector.

6. Bundle and docs:
   - rebuild Antarctica published player-web bundle if plugin projection changes;
   - update task handoff and any relevant README/test references.

## Acceptance

- `games/antarctica/game.manifest.json` has no `actions.showHint`.
- `games/antarctica/game.manifest.json` has no `actions.showTopBar`.
- `games/antarctica/game.manifest.json` has no `actions.showScreenWithLeftSideBar`.
- `games/antarctica/game.manifest.json` has no `log.append` entries with `kind: "ui-panel-open"` or `kind: "ui-screen-open"` for these removed UI-only actions.
- `games/antarctica/ui/web/ui.manifest.json` uses `showPanel` with `panelId: "hint"` instead of `showHint`.
- Hint UI is declared as a game UI panel or another explicit UI-manifest surface, not as a hidden game action.
- Opening hint does not call `POST /api/runtime/actions`.
- `showTopBar` and `showScreenWithLeftSideBar` have no replacement runtime action unless a future game mechanic explicitly needs synchronized UI state and gets its own schema-backed decision.
- No game-specific branches are added to `services/runtime-api`.
- Published Antarctica plugin bundle is rebuilt if plugin projection changes.

## Validation

Required commands:

```text
npm run compile:manifests -- --game antarctica --check
npm run verify:manifest-authoring
npm run verify:player-web
npm run verify:game-agnostic
npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts tests/runtime-api.integration.ts
npm run build:player-web-plugin-bundles -- --game antarctica
git diff --check
```

Focused invariants:

```text
node -e "const g=require('./games/antarctica/game.manifest.json'); for (const id of ['showHint','showTopBar','showScreenWithLeftSideBar']) if (g.actions?.[id]) throw new Error(id)"
! rg -n '\"command\": \"showHint\"|showTopBar|showScreenWithLeftSideBar' games/antarctica/authoring/ui/web.authoring.json apps/player-web/src
! rg -n '\"kind\": \"ui-panel-open\"|\"kind\": \"ui-screen-open\"' games/antarctica/game.manifest.json
```

Manual check:

- Open Antarctica in player-web.
- Click "Подсказка".
- Verify hint opens as a UI panel without changing timeline.
- Verify closing hint returns to the current screen.
- Verify no runtime action is dispatched for opening hint.
- Verify topbar and left-sidebar visual routing still resolves from UI manifest/state without the removed game actions.

## Risks

- Removing `HintRenderer` before `panels.hint` reaches visual parity can regress the hint overlay.
- `state.public.ui.activeScreen` still exists as initial UI state in the game manifest. If this is considered out of bounds for the logical manifest, remove or migrate it in a separate task after checking screen routing defaults.
- `ui.panel.open` and `ui.screen.open` schema support may still be valid for synchronized UI effects in other games. Do not remove the schema globally inside this cleanup unless the scope is explicitly widened.
- Tests may currently assert old runtime behavior for `showHint`; update them to local Presenter behavior.

## Handoff Log

### 2026-06-15 - Implemented

- Added `panels.hint` to Antarctica web UI authoring manifest and regenerated `games/antarctica/ui/web/ui.manifest.json`.
- Removed `showHint`, `showTopBar`, and `showScreenWithLeftSideBar` from Antarctica game authoring manifest and regenerated `games/antarctica/game.manifest.json`.
- Moved hint text to Antarctica plugin projection as `hintText`/`hasHintText`.
- Removed player-web special handling for `SHOW_HINT`, `SHOW_LEFT_SIDEBAR`, and platform `HintRenderer`; manifest panels now render through the generic panel path.
- Added game-agnostic CI invariants that fail if the removed UI-only actions return to the generated Antarctica game manifest or if platform hint/journal renderers return.
- Updated runtime-api integration tests so they no longer dispatch removed UI-only actions as server actions; player-facing content now asserts that `showHint` is absent and `ui.panels.hint` is present.
- Rebuilt published Antarctica player-web plugin bundle: `88085843565cd0f7f20eaa695a3e8f50a519df171063bbefc1e1dd74f3e3222c`.

Validation completed:

- `npm run compile:manifests -- --game antarctica --check` - passed.
- `npm run verify:manifest-authoring` - passed.
- `npm run verify:player-web` - passed.
- `npm run verify:game-agnostic` - passed.
- `npm test --workspace services/runtime-api -- tests/manifest-validation.test.ts tests/runtime-api.integration.ts` - passed.
- `npm run build:player-web-plugin-bundles -- --game antarctica` - passed.
- `git diff --check` - passed.

### 2026-06-15 - Documentation

- Created this task as the follow-up for the remaining UI-only action drift recorded after the `ui.panels.history` migration.
- Confirmed current game manifest still contains `showHint`, `showTopBar`, and `showScreenWithLeftSideBar`.
- Confirmed web UI authoring still uses `showHint` commands, while `showTopBar` and `showScreenWithLeftSideBar` appear to be unreferenced by current web UI.
- Next: implement the cleanup sequentially, starting with `panels.hint`, then remove the three game actions and adapter aliases.
