# Runtime Session Hardening Baseline

## Table of Contents

- [1. Goal](#1-goal)
- [2. In Scope](#2-in-scope)
- [3. Out Of Scope](#3-out-of-scope)
- [4. Health Contract](#4-health-contract)
- [5. Readiness Contract](#5-readiness-contract)
- [6. Session Evolution Priorities](#6-session-evolution-priorities)
- [7. Verification Plan](#7-verification-plan)

---

## 1. Goal

This document defines the bounded hardening baseline for `services/runtime-api`.

The goal is to make the runtime's liveness and readiness semantics explicit, document the current session store limits honestly, and provide a clear ordered list of future session work — without introducing persistence, distributed locking, recovery workers, or external dependency checks.

This is a **Phase 2 hardening step** per ROADMAP Near-Term Execution block 3 and Milestone M3. It strengthens the modular monolith backend before any service extraction or platform-scale work begins.

---

## 2. In Scope

The following items are in scope for this hardening baseline:

### 2.1 Health Endpoint (`GET /health`)

The existing shallow liveness endpoint stays as-is. It confirms the HTTP server is alive. It does **not** check session store state, manifest loadability, or any external dependency.

Current behavior:
- Returns `{ status: "ok", service: "runtime-api" }` with HTTP 200.
- No dependencies are interrogated.
- Must remain fast (< 5ms under normal load).

### 2.2 Readiness Endpoint (`GET /readiness`)

A bounded readiness endpoint was added in the scaffold phase. It reports only **current in-process runtime dependencies**:

- **Content subsystem**: can the runtime load the current game manifest?
- **Session store mode**: is the session store in-memory and functional?

The readiness endpoint will NOT report:
- External database connectivity
- Distributed system health
- Background worker status
- Game-specific availability (beyond the single current game)

### 2.3 Session Store Mode Signal

The runtime will expose a small, honest signal about the current session store mode:
- `mode: "in-memory"` — sessions exist only in process memory
- `sessionCount: <number>` — approximate count of active sessions (optional, for observability)

No persistence, no durability promise, no recovery state.

### 2.4 Error Response Surface

The current error mapping is already documented:
- HTTP 400 — guard failures, validation errors, malformed requests
- HTTP 404 — session not found, game not found
- HTTP 500 — internal errors (no more specific recovery semantics)

The scaffold phase will not change this surface.

### 2.5 Integration Test Coverage

The current 40 integration tests cover the full Antarctica opening flow through terminal `i21`. The test design notes describe what additional smoke and integration checks are needed for the new readiness baseline.

---

## 3. Out Of Scope

The following items are explicitly **deferred** beyond this block:

### 3.1 Persistence

- No PostgreSQL, SQLite, or any durable storage
- No session checkpointing or WAL-style durability
- Sessions are lost on process restart
- See ADR-005 for the eventual persistence strategy

### 3.2 Distributed Locking

- No Redis-based locks
- No `SELECT FOR UPDATE` or equivalent
- No distributed concurrency control
- Single-process only

### 3.3 Recovery Worker

- No automatic session recovery on crash
- No orphaned action detection
- No TTL-based lock cleanup
- If the process dies, the session is gone

### 3.4 External Readiness Checks

- No database ping checks
- No external service dependency verification
- No CDN or asset availability checks
- Readiness only reflects in-process state

### 3.5 Multi-Game Operational Readiness

- Only Antarctica is currently supported as a runnable game
- No catalog health or multi-game routing
- No game version reporting

### 3.6 Telemetry and Observability Expansion

- No OpenTelemetry SDK
- No distributed tracing
- No structured metrics export
- Log output goes to stdout only

### 3.7 Session Expiry and TTL

- No automatic session expiration
- Sessions live until process restart
- No max-session count enforcement

---

## 4. Health Contract

### `GET /health`

**Purpose**: Liveness probe — confirms the HTTP server is responding.

**Request**: No parameters.

**Response**:
```json
{
  "status": "ok",
  "service": "runtime-api"
}
```

**Status codes**:
- `200` — server is alive
- Any other code — server is unreachable ( infrastructure-level, not runtime semantic)

**Behavior**:
- Returns immediately without checking any subsystem.
- Must remain < 5ms under normal load.
- No authentication required.

**Changes in this block**: None. This endpoint stays shallow.

---

## 5. Readiness Contract

### `GET /readiness`

**Purpose**: Report whether the runtime is ready to serve traffic.

**Request**: No parameters.

**Response**:
```json
{
  "ready": true,
  "service": "runtime-api",
  "dependencies": {
    "content": {
      "status": "ok",
      "gameId": "antarctica"
    },
    "sessionStore": {
      "status": "ok",
      "mode": "in-memory"
    }
  }
}
```

**Status codes**:
- `200` — runtime is ready
- `503 Service Unavailable` — runtime is not ready (e.g., manifest failed to load)

**Behavior**:
- Checks content subsystem: attempts to load `games/antarctica/game.manifest.json`.
- Checks session store: confirms in-memory store is functional.
- Returns `ready: false` with HTTP 503 if any check fails.
- Machine-readable and small payload.

**What this does NOT check**:
- Persistence (not implemented)
- External databases (none exist)
- Distributed system state (single process)
- Background workers (none exist)

**Changes in this block**: This endpoint was added in the scaffold phase (see `services/runtime-api/src/modules/admin/health.ts`).

---

## 6. Session Evolution Priorities

The following future work is deferred but documented here in priority order.

### Priority 1: Bounded Readiness Baseline (scaffold phase) — ✅ COMPLETE

- Add `GET /readiness` endpoint per Section 5.
- Expose session store mode honestly.
- Add smoke and integration coverage for readiness.

**Owner**: Runtime-api scaffold slice.

**Constraints**: No persistence, no external dependencies.

**Status**: Fully implemented. `/readiness` reports content subsystem and session store mode. Smoke and integration tests cover the baseline.

### Priority 2: Session TTL and Basic Expiry

- Add optional session TTL (e.g., 30-minute inactivity timeout).
- Allow the session store to reject new sessions when a max count is reached.
- Prevent orphaned in-memory sessions from accumulating indefinitely.

**Dependencies**: None (in-memory, same process).

**Constraints**: This is still in-memory only. Sessions lost on restart remain a known limitation.

### Priority 3: Graceful Shutdown

- Handle `SIGTERM` to stop accepting new traffic.
- Complete in-flight requests before exiting.
- Optionally drain sessions to support rolling restarts.

**Dependencies**: None (single process).

**Constraints**: No session persistence on shutdown.

### Priority 4: Session State Snapshots for Debugging

- Add an admin endpoint to inspect current session state.
- Useful for debugging without attaching a debugger.

**Dependencies**: None.

**Constraints**: Read-only; no mutation via admin endpoints.

### Priority 5: Structured Logging and Request IDs

- Add request ID propagation through the action dispatch path.
- Emit structured log entries for action dispatch, guard failures, and state transitions.

**Dependencies**: None.

**Constraints**: Logs remain stdout-only; no external log aggregation.

### Priority 6: Basic Operational Metrics

- Count active sessions.
- Count actions dispatched per session.
- Measure p50/p95 request latency.

**Dependencies**: None.

**Constraints**: In-process only; no distributed tracing.

### Priority 7: Persistence Foundation (PostgreSQL)

- Introduce PostgreSQL as session store backend.
- Implement checkpointing per ADR-005.
- Add basic session recovery on restart.

**Dependencies**: PostgreSQL driver, database schema.

**Constraints**: This requires a new ADR-level decision before implementation.

### Priority 8: Distributed Locking (Redis)

- Replace in-process locking with Redis-based distributed locks.
- Enable multi-instance deployment.

**Dependencies**: Redis, Redlock pattern per ADR-005.

**Constraints**: Requires proven operational need and Redis infrastructure.

### Priority 9: Recovery Worker

- Detect orphaned sessions (stale in-flight actions).
- Implement TTL-based lock cleanup.
- Provide client-visible error when a session is recovered.

**Dependencies**: Redis (for distributed TTL tracking) or application-level TTL.

**Constraints**: Requires persistence first.

---

## 7. Verification Plan

### 7.1 Current Verification

Run the full runtime-api verification suite:

```bash
npm run verify:runtime-api
```

This runs:
1. TypeScript type checking
2. 40 integration tests covering the full Antarctica opening flow
3. Smoke script hitting the session and action endpoints

**Current result**: ✅ 45/45 tests pass, smoke passes (2026-04-02).

### 7.2 Readiness Endpoint Verification (scaffold phase) — ✅ COMPLETE

The following was verified during the scaffold phase:

1. **Smoke script update**: `scripts/smoke-runtime-api.ts` will hit `GET /health` and `GET /readiness` before the session/action path.

2. **Integration tests**: Add tests for:
   - `GET /readiness` returns `200` with correct payload when runtime is healthy
   - `GET /readiness` returns `503` when content fails to load
   - `GET /readiness` returns correct `sessionStore.mode: "in-memory"`

3. **Command**: `npm run verify:runtime-api` must pass.

### 7.3 Success Criteria for This Block

- `docs/architecture/backend/runtime-session-hardening-baseline.md` exists with complete sections.
- `TEST_DESIGN_NOTES.md` describes exact test additions for scaffold and harden phases.
- No production code, tests, or smoke scripts are changed in this spec slice.
- `npm run verify:runtime-api` passes (baseline already proven: 40/40 tests + smoke).
- All deferred items are documented explicitly (Section 3 and Section 6).

---

## Summary

| Item | Status | Notes |
|------|--------|-------|
| `GET /health` | ✅ Shallow, unchanged | Already implemented |
| `GET /readiness` | ✅ Implemented in scaffold | In-process checks only |
| Session store mode | 📋 Deferred to scaffold | In-memory only signal |
| Persistence | ❌ Deferred | ADR-005 strategy exists |
| Distributed locks | ❌ Deferred | No Redis in this block |
| Recovery worker | ❌ Deferred | Requires persistence first |
| Telemetry expansion | ❌ Deferred | stdout logs only |
| Integration tests | ✅ 40/40 passing | Covers opening flow to i21 |

---

## Next Steps

After this spec is approved:

1. **Scaffold phase** (`slice-scaffold-runtime-signals`): Implement `GET /readiness` and session store mode signal.
2. **Harden phase** (`slice-harden-runtime-baseline`): Add integration coverage and sync docs.
