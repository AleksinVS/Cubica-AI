# `player-web`

Canonical web player scaffold for `Antarctica`.

## Run

### One-command local play (recommended)

From repo root:

```bash
npm run antarctica:play
```

This starts both `runtime-api` (port 3001) and `player-web` (port 3000) together.
Open `http://127.0.0.1:3000` in your browser.

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

## Runtime boundary

The app does not talk to `runtime-api` directly from the browser. It proxies requests through local route handlers:

- `POST /api/runtime/sessions`
- `GET /api/runtime/sessions/:sessionId`
- `POST /api/runtime/actions`
- `GET /api/runtime/player-content/:gameId`

Those routes forward to `RUNTIME_API_URL` or `http://127.0.0.1:3001` by default.

## Content loading & Rendering

The app loads game content through the player-facing content API (`GET /api/runtime/player-content/:gameId`) which proxies to `runtime-api`'s `GET /games/:gameId/player-content` endpoint. This follows ADR-019: `runtime-api` is the sole owner of loading `games/*` content, and `player-web` consumes it through a typed DTO contract.

The player-web supports two rendering paths for Antarctica:
1. **Manifest-Driven Multi-Screen Renderer**: The UI is rendered dynamically from a bounded UI manifest provided by the `runtime-api` (see `antarcticaUi` in the DTO). This covers:
   - **S1 entry screen** (`screenId: "S1"` at `stepIndex: 0`): Opening screen with left-sidebar-6-cards layout, 8 metric components, 6 narrative cards, bottom controls.
   - **S2 board screens** (`screenId: "S2"`): Board screens keyed by stepIndex (55..60 at stepIndex 30, 61..66 at stepIndex 32, 67..70 at stepIndex 34) with top-sidebar-6-cards layout, horizontal metrics bar, board header, and 6-card selection grid.
   - **S1 info variant screens** (`screenId: "S1"` with `activeInfoId`): Info screens i17, i18, i19, i19_1, i20, i21 where `activeInfoId` disambiguates between variants (e.g., i19 vs i19_1 at the same stepIndex 35).
   
   Screen selection is driven by runtime snapshot fields (`timeline.screenId`, `timeline.stepIndex`, `timeline.activeInfoId`) following the contract in `CONTRACT_INDEX.md`. When a screen is not in the manifest, the player falls back to the action catalog resolver.

2. **Specialized Resolver Renderer**: For scenes outside the bounded manifest scope, the player uses a structured resolver logic (`src/lib/antarctica.ts`) to map session state to structured UI components (boards `1..70`, infos `i0..i21`, team-selection).

`player-web` combines that player-facing content with the live session snapshot (`timeline`, `selectedCardId`, metrics, card flags, etc.) to render the current scene. Board card rendering respects `flags.cards[cardId].available === false`, so locked or alt-swap cards stay hidden until runtime exposes them. For steps that are not modeled yet in the content DTO, the player falls back to the global action catalog.

### Asset Policy
Static assets (images) are located in `public/images/`. The UI manifest uses root-relative paths (e.g., `/images/arctic-background.png`) which are resolved by the browser.

### Testing
Run `npm test` to execute Vitest suites:
- `src/components/antarctica-s1-renderer.test.tsx`: DOM/Snapshot tests for the manifest-driven renderer.
- `src/components/antarctica-player-dom.test.tsx`: Integration tests for the full AntarcticaPlayer component.
- `src/components/antarctica-player.test.tsx`: Logic and resolver tests.

It intentionally does not reuse the imported portal drafts as architecture reference.
