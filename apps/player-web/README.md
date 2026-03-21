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
- `GET /api/runtime/player-content/:gameId`

Those routes forward to `RUNTIME_API_URL` or `http://127.0.0.1:3001` by default.

## Content loading

The app loads game content through the player-facing content API (`GET /api/runtime/player-content/:gameId`) which proxies to `runtime-api`'s `GET /games/:gameId/player-content` endpoint. This follows ADR-019: `runtime-api` is the sole owner of loading `games/*` content, and `player-web` consumes it through a typed DTO contract.

The current bounded Antarctica delivery slice uses structured `content.antarctica` from `games/antarctica/game.manifest.json` for:

- intro info `i0`
- first board `1..6`
- info `i7`
- second board `7..12`
- info `i8`
- third board `13..18`
- info `i9`
- team-selection scene at step `15`
- info `i10`

`player-web` combines that static player-facing content with the live session snapshot (`timeline`, `selectedCardId`, card flags, team flags, and teamSelection state) to render the current scene. For steps that are not modeled yet in `content.antarctica`, the player falls back to the global action catalog instead of guessing missing content.

It intentionally does not reuse the imported portal drafts as architecture reference.
