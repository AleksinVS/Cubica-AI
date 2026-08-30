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
PORTAL_TEST_CORS_ORIGIN=http://test-host.example:12345
PAYMENT_STUB_ENABLED=true
```

Keep Strapi secrets (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`) unique per VPS environment.
`PORTAL_TEST_CORS_ORIGIN` is optional and must contain one exact additional browser origin, including the port when applicable. Local origins and the configured public portal/player origins remain allowed without it.

## Payment Stub

`POST /orders/payment-stub` creates a paid order and purchase for the authenticated user without Robokassa. It is intended for test launch flows only and is disabled unless `PAYMENT_STUB_ENABLED=true`. The request must carry a JWT for an existing portal user; the backend never creates or logs in a test account.

For local browser testing, Strapi CORS allows `PORTAL_PUBLIC_URL` plus the local portal ports used by the current test contour. Enable `NEXT_PUBLIC_PAYMENT_STUB_ENABLED=true` in the non-production portal, log in with a pre-created test account, and then use the `Тестовая покупка` action. The browser opt-in and this backend gate must both be enabled.

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

The payment-link request requires an authenticated JWT and returns a link only when the order belongs to that user.

Configure Robokassa with:

```bash
ROBO_MERCHANT_LOGIN=...
ROBO_PASSWORD1=...
ROBO_PASSWORD2=...
ROBO_PAYMENT_SUCCESS_URL=https://portal.example.test/payment/success
ROBO_PAYMENT_FAIL_URL=https://portal.example.test/payment/fail
```
