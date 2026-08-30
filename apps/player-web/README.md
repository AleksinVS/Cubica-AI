# `player-web`

Canonical web player for Cubica games.

## Table of Contents

- [Run](#run)
- [Runtime Boundary](#runtime-boundary)
- [Content Loading And Rendering](#content-loading-and-rendering)
- [AI-Driven Games](#ai-driven-games)
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
Open `http://127.0.0.1:3000/?gameId=antarctica` in your browser. Use
`?gameId=simple-choice` to run the minimal game-agnostic fixture instead.
`player-web` is a game-agnostic entry point (ARC-003): opening the URL
without `?gameId=` shows an error screen instead of booting a default game.

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
- `POST /api/runtime/action-previews/transport-road`
- `POST /api/runtime/agent-turns`
- `GET /api/runtime/games/:gameId/readiness`
- `GET /api/runtime/player-content/:gameId`

Those routes forward to `RUNTIME_API_URL` or `http://127.0.0.1:3001` by default.
They are explicit server-side handlers: a broad `/api/runtime/*` rewrite is
forbidden because it could bypass session-scoped HttpOnly authentication for
dynamic routes.

The create-session route removes the runtime credential from browser JSON and
stores it in a session-specific `HttpOnly`, `SameSite=Strict` cookie. Session
reads, actions, protected previews, and Agent Turns recover that cookie in the
server-side proxy and attach `Authorization: Bearer`; browser JavaScript never
stores or reads the bearer. The cookie lives for 30 days so a local session id
survives an ordinary browser restart; if the credential or server session is no
longer available, local boot discards that session's pending command and starts
a new session. Portal launches remain bound through the portal exchange only.

Gameplay writes use an immutable envelope containing `sessionId`, the exact
published `actionId`, schema-validated `params`, `expectedStateVersion`, and a
`commandId`. The Presenter stores an unfinished envelope in a local outbox
(a journal of commands awaiting a confirmed result) and reuses it unchanged
after a lost response. Network errors plus HTTP 408, 429 and 5xx retain the
outbox entry; deterministic 4xx responses and admitted rejected receipts remove
it. A server snapshot replaces the complete local snapshot; it is never
interpreted as JSON Merge Patch.

## Content Loading And Rendering

The Server Component loads game content directly from `runtime-api`'s `GET /games/:gameId/player-content` endpoint using `RUNTIME_API_URL`. Browser-side runtime calls still go through local route handlers. This follows ADR-019: `runtime-api` is the sole owner of loading `games/*` content, and `player-web` consumes it through a typed DTO contract.

The player-web supports three rendering paths:
1. **Manifest-Driven Multi-Screen Renderer**: The UI is rendered dynamically from a bounded UI manifest provided by the `runtime-api` (see `antarcticaUi` in the DTO). This covers:
   - **S1 entry screen** (`screenId: "S1"` at `stepIndex: 0`): Opening screen with left-sidebar-6-cards layout, 8 metric components, 6 narrative cards, bottom controls.
   - **Reusable board UI variant** (`screenId: "S2"`): A single `board-topbar` screen renders board title/body and card actions from `currentBoard` and `boardCards` in the player-facing projection.
   - **Reusable info UI variant** (`screenId: "S1"` with `activeInfoId`): A single `info-topbar` screen renders concrete info entries such as i17, i18, i19, i19_1, i20, and i21 from `currentInfo`; the UI manifest does not duplicate those entries as separate screens.
   - **Game-defined panels** (`panels.<id>`): Temporary UI layers such as the Antarctica move journal and hint overlay are declared in the game UI manifest and rendered through the same manifest renderer. Local commands such as `showPanel` and `closePanel` update Presenter UI state only; they do not dispatch game actions to `runtime-api`.
   
   Screen selection is driven by runtime snapshot fields (`timeline.screenId`, `timeline.stepIndex`, `timeline.activeInfoId`) following the typed DTOs in `packages/contracts/manifest` and `apps/player-web/src/types/`. The screen key selects the reusable UI variant; scenario text, board content, and action ids stay in game content and the player-facing projection. When a screen is not in the manifest, the player may render the published action catalog but never invent or infer an action id.

2. **Cubica Surface Renderer**: AI-driven games can receive a validated `CubicaSurface` from `POST /agent-turns`. The Web renderer currently supports the MVP catalog entries used by gameplay surfaces (`cubica.text`, `cubica.button`, `cubica.choiceList`, `cubica.metricsBar`, `cubica.hintPanel`, `cubica.cardGrid`) and renders an explicit diagnostic block for unsupported components. Surface actions are routed back through runtime APIs; React components never mutate session state directly.

3. **Specialized Resolver Renderer**: For scenes outside the bounded manifest scope, the player uses registered project-local game plugins such as `games/antarctica/plugins/antarctica-player` to map session state to structured UI components (boards `1..70`, infos `i0..i21`, team-selection). In editor preview, `player-web` loads session plugin bundles from `PlayerFacingContent.pluginBundles` and activates them through the public `@cubica/player-web/plugin-api` facade. Outside preview, `player-web` loads only published plugin bundle references generated under `games/<gameId>/published/`; it does not statically import game plugin source.

For games without a registered plugin, `player-web` builds a default config from `PlayerFacingContent.ui`. The default path uses UI manifest `screen_routing`, `metric_specs`, and explicit `actionId` values in UI payloads.

`player-web` combines that player-facing content with the live session snapshot (`timeline`, `selectedCardId`, metrics, `objectViews`, `objects.cards`, etc.) to render the current scene. Board card rendering uses object-state facets such as `availability: "hidden"` or `availability: "locked"`, so locked or alt-swap cards stay hidden or disabled until runtime exposes them through object state. For steps that are not modeled yet in the content DTO, the player falls back to the global action catalog.

## AI-Driven Games

AI-driven games declare `executionMode: "ai-driven"` and a required `agentRuntime` in `PlayerFacingContent`. Before creating a session, `player-web` checks `GET /api/runtime/games/:gameId/readiness`. If Agent Runtime is unavailable, the player shows a blocking paused/retry/unavailable state and does not silently fall back to deterministic gameplay.

When readiness is green, `player-web` creates or resumes the session and requests the first Agent Turn through an explicitly published initial action binding and `POST /api/runtime/agent-turns`. The returned `CubicaSurface` becomes the active gameplay surface. Every mutating Surface action must publish its exact runtime `actionId` in `target`; the renderer never falls back to the Surface component id. Provider SDKs and CopilotKit/AG-UI are not imported into `player-web`.

## Adding A Simple Game

A simple game does not need a `player-web` plugin. Add:

- `games/<gameId>/game.manifest.json`;
- `games/<gameId>/ui/web/ui.manifest.json`;
- `screen_routing` entries that map runtime `timeline.screenId` to UI screens;
- UI actions with `command: "requestServer"` and payload `{ "actionId": "<manifest-action-id>" }`.

Use a plugin only when the game needs custom state projection or a custom scene that cannot be expressed in the manifest. Command resolution is not a plugin extension point: every server-bound UI event must carry an exact published `actionId`. `scripts/dev/scaffold-game.js` generates that optional plugin without no-op routing resolvers, so manifest routing remains active by default.

### Asset Policy
Static assets (images) are located in `public/images/`. The UI manifest uses root-relative paths (e.g., `/images/arctic-background.png`) which are resolved by the browser.

### Testing
Run `npm test` to execute Vitest suites:
- `src/components/manifest-renderer.test.tsx`: DOM tests for the manifest-driven renderer.
- `src/components/game-player-dom.test.tsx`: Integration tests for the full GamePlayer component.
- `src/components/game-player.test.tsx`: Logic and resolver tests.
- `src/test/entry-missing-game-id.test.tsx`: entry-point (`app/page.tsx`) test asserting a missing/empty `?gameId=` renders the generic error screen and never reaches content loading (ARC-003).

Run `npm run test:e2e` from the repository root to execute Playwright browser tests against `player-web` and `runtime-api`.

It intentionally does not reuse the imported portal drafts as architecture reference.
