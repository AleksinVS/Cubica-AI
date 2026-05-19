# Cubica Portal Next.js

Next.js portal draft for the Cubica test launch surface. The app shows the game catalog, purchased launch links, and the first frontend integration points for backend-managed launch links and active sessions.

## Оглавление

- [Development](#development)
- [Environment](#environment)
- [Portal API Integration](#portal-api-integration)
- [Verification](#verification)

## Development

Install dependencies and run the development server from this folder:

```bash
npm install
npm run dev
```

The default local URL is [http://localhost:3000](http://localhost:3000).

## Environment

Copy `.env.example` to `.env.local` for local work and set:

```bash
NEXT_PUBLIC_PORTAL_API_URL=http://localhost:1337
```

`NEXT_PUBLIC_PORTAL_API_URL` is exposed to browser code by Next.js because launch-link copy and active-session listing are triggered from client components.

## Portal API Integration

`src/lib/portalApi.js` contains the thin browser API client. It sends a JWT (JSON Web Token, a signed authorization token) from `localStorage` when one is present and exposes:

- `copyLaunchLink({ purchaseId, linkId })`
- `listActiveSessions({ purchaseId, linkId })`

The purchased-games table uses the backend first. If the backend is not configured, unavailable, or a row has no purchase/link `documentId`, the UI falls back to the static URL and local session data from `src/data/gameDataWithLinks.json`.

## Verification

```bash
npm run build
```
