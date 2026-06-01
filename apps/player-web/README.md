# `player-web`

Canonical web player for Cubica games.

## Table of Contents

- [Run](#run)
- [Runtime Boundary](#runtime-boundary)
- [Content Loading And Rendering](#content-loading-and-rendering)
- [Adding A Simple Game](#adding-a-simple-game)
- [Asset Policy](#asset-policy)
- [Testing](#testing)

## Run

### One-command local play (recommended)

From repo root:

```bash
npm run antarctica:play
```

This starts both `runtime-api` (port 3001) and `player-web` (port 3000) together.
Open `http://127.0.0.1:3000` in your browser. Add `?gameId=simple-choice`
to run the minimal game-agnostic fixture.

Press `Ctrl+C` to stop both services.

### Manual start

1. Start `runtime-api` at `http://127.0.0.1:3001`:
   ```bash
   npm run dev --workspace services/runtime-api
   ```
2. From repo root run:
   ```bash
   npm install
   npm run dev --workspace @cubica/player-web
   ```
3. Open the Next.js dev server URL printed in the terminal.

## Runtime Boundary

The app does not talk to `runtime-api` directly from the browser. It proxies requests through local route handlers:

- `POST /api/runtime/sessions`
- `GET /api/runtime/sessions/:sessionId`
- `POST /api/runtime/actions`
- `GET /api/runtime/player-content/:gameId`

Those routes forward to `RUNTIME_API_URL` or `http://127.0.0.1:3001` by default.

## Content Loading And Rendering

The Server Component loads game content directly from `runtime-api`'s `GET /games/:gameId/player-content` endpoint using `RUNTIME_API_URL`. Browser-side runtime calls still go through local route handlers. This follows ADR-019: `runtime-api` is the sole owner of loading `games/*` content, and `player-web` consumes it through a typed DTO contract.

The player-web supports two rendering paths:
1. **Manifest-Driven Multi-Screen Renderer**: The UI is rendered dynamically from a bounded UI manifest provided by the `runtime-api` (see `antarcticaUi` in the DTO). This covers:
   - **S1 entry screen** (`screenId: "S1"` at `stepIndex: 0`): Opening screen with left-sidebar-6-cards layout, 8 metric components, 6 narrative cards, bottom controls.
   - **S2 board screens** (`screenId: "S2"`): Board screens keyed by stepIndex (55..60 at stepIndex 30, 61..66 at stepIndex 32, 67..68 at stepIndex 34, 69..70 at stepIndex 36) with top-sidebar layout, horizontal metrics bar, board header, and card selection grid.
   - **S1 info variant screens** (`screenId: "S1"` with `activeInfoId`): Info screens i17, i18, i19, i19_1, i20, i21 where `activeInfoId` disambiguates between variants (e.g., i19 vs i19_1 at the same stepIndex 35).
   
   Screen selection is driven by runtime snapshot fields (`timeline.screenId`, `timeline.stepIndex`, `timeline.activeInfoId`) following the typed DTOs in `packages/contracts/manifest` and `apps/player-web/src/types/`. When a screen is not in the manifest, the player falls back to the action catalog resolver.

2. **Specialized Resolver Renderer**: For scenes outside the bounded manifest scope, the player uses registered project-local game plugins such as `games/antarctica/plugins/antarctica-player` to map session state to structured UI components (boards `1..70`, infos `i0..i21`, team-selection). In editor preview, `player-web` loads session plugin bundles from `PlayerFacingContent.pluginBundles` and activates them through the public `@cubica/player-web/plugin-api` facade. Outside preview, `player-web` loads only published plugin bundle references generated under `games/<gameId>/published/`; it does not statically import game plugin source.

For games without a registered plugin, `player-web` builds a default config from `PlayerFacingContent.ui`. The default path uses UI manifest `screen_routing`, `metric_specs`, and explicit `actionId` values in UI payloads.

`player-web` combines that player-facing content with the live session snapshot (`timeline`, `selectedCardId`, metrics, card flags, etc.) to render the current scene. Board card rendering respects `flags.cards[cardId].available === false`, so locked or alt-swap cards stay hidden until runtime exposes them. For steps that are not modeled yet in the content DTO, the player falls back to the global action catalog.

## Adding A Simple Game

A simple game does not need a `player-web` plugin. Add:

- `games/<gameId>/game.manifest.json`;
- `games/<gameId>/ui/web/ui.manifest.json`;
- `screen_routing` entries that map runtime `timeline.screenId` to UI screens;
- UI actions with `command: "requestServer"` and payload `{ "actionId": "<manifest-action-id>" }`.

Use a plugin only when the game needs custom state projection or command resolution that cannot be expressed in the manifest. `scripts/dev/scaffold-game.js` generates that optional plugin without no-op routing resolvers, so manifest routing remains active by default.

### Asset Policy
Static assets (images) are located in `public/images/`. The UI manifest uses root-relative paths (e.g., `/images/arctic-background.png`) which are resolved by the browser.

### Testing
Run `npm test` to execute Vitest suites:
- `src/components/manifest-renderer.test.tsx`: DOM tests for the manifest-driven renderer.
- `src/components/game-player-dom.test.tsx`: Integration tests for the full GamePlayer component.
- `src/components/game-player.test.tsx`: Logic and resolver tests.
- `src/components/panels/journal-renderer.test.tsx`: Journal and metrics panel rendering tests.

Run `npm run test:e2e` from the repository root to execute Playwright browser tests against `player-web` and `runtime-api`.

It intentionally does not reuse the imported portal drafts as architecture reference.
