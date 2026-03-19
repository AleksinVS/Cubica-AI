# `player-web`

Canonical web player scaffold for `Antarctica`.

## Run

1. Start `runtime-api` at `http://127.0.0.1:3001`.
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

Those routes forward to `RUNTIME_API_URL` or `http://127.0.0.1:3001` by default.

## Source material

The scaffold reads canonical local content from:

- `games/antarctica/game.manifest.json`
- `games/antarctica/design/mockups/*.design.json`

It intentionally does not reuse the imported portal drafts as architecture reference.
