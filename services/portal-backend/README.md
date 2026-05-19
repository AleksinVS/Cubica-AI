# Portal Backend

Strapi backend for the Cubica portal catalog, orders, purchases, and payment callbacks.

## Table of Contents

- [Quick Start](#quick-start)
- [Build](#build)
- [Test VPS Environment](#test-vps-environment)
- [Payment Stub](#payment-stub)
- [Robokassa](#robokassa)

## Quick Start

```bash
cd services/portal-backend
cp .env.example .env
npm install
npm run develop
```

Production-style start:

```bash
npm run start
```

## Build

Build the Strapi admin panel:

```bash
npm run build
```

## Test VPS Environment

Use `.env.example` as the baseline and set public URLs for the deployed portal, player, and runtime API:

```bash
PORTAL_PUBLIC_URL=https://portal.example.test
PLAYER_PUBLIC_URL=https://player.example.test
RUNTIME_API_URL=https://runtime.example.test
PAYMENT_STUB_ENABLED=true
```

Keep Strapi secrets (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`) unique per VPS environment.

## Payment Stub

`POST /orders/payment-stub` creates a paid order and purchase for the authenticated user without Robokassa. It is intended for test launch flows only and is disabled unless `PAYMENT_STUB_ENABLED=true`.

For local browser testing, Strapi CORS allows `PORTAL_PUBLIC_URL` plus the local portal ports used by the current test contour. With the portal on `http://localhost:3010`, clicking `Купить` on `/games/antarctica` logs in the local test user and calls this endpoint directly.

Request body:

```json
{
  "gameDocumentId": "game-document-id",
  "gameSlug": "optional-game-slug",
  "packageType": "one-time",
  "startDate": "2026-05-19",
  "endDate": "2026-05-20",
  "price": 1000
}
```

Use either `gameDocumentId` or `gameSlug`. The endpoint is generic and does not contain game-specific branching.

Successful response:

```json
{
  "order": {
    "documentId": "order-document-id",
    "status": "paid"
  },
  "purchase": {
    "documentId": "purchase-document-id",
    "status": "paid"
  },
  "status": "paid"
}
```

## Robokassa

The existing Robokassa flow remains available:

- `GET /robokassa/payment-link?documentId=<orderDocumentId>`
- `POST /robokassa/result`

Configure Robokassa with:

```bash
ROBO_MERCHANT_LOGIN=...
ROBO_PASSWORD1=...
ROBO_PASSWORD2=...
ROBO_PAYMENT_SUCCESS_URL=https://portal.example.test/payment/success
ROBO_PAYMENT_FAIL_URL=https://portal.example.test/payment/fail
```
