/**
 * Operational errors shared by durable and in-memory session-store adapters.
 *
 * Keeping these errors above the concrete database adapter lets deterministic
 * runtime code receive the same safe HTTP behavior in tests and production.
 */

import type { SessionRecord } from "@cubica/contracts-session";
import { HttpError } from "../errors.ts";

/** A newer state version exists, so applying this stale snapshot is unsafe. */
export class SessionVersionConflictError extends HttpError {
  constructor(sessionId: string, expectedStateVersion: number) {
    super(
      409,
      `Session "${sessionId}" changed after version ${expectedStateVersion}; reload it before retrying.`
    );
  }
}

/** Another transaction is currently writing the same session. */
export class SessionWriteLockedError extends HttpError {
  constructor(sessionId: string) {
    super(423, `Session "${sessionId}" is being updated by another request.`);
  }
}

/** Database outage or invalid database readiness, without leaking SQL details. */
export class SessionStoreUnavailableError extends HttpError {
  constructor() {
    super(503, "Session storage is temporarily unavailable.");
  }
}

/**
 * A durable snapshot version always advances exactly once.
 *
 * Rewinding gameplay is represented by older state/event content in a new
 * snapshot. Reusing or decreasing `stateVersion` would make concurrency checks
 * ambiguous and is therefore rejected by every store adapter.
 */
export function assertNextSessionVersion<TState>(
  lockedSessionId: string,
  current: SessionRecord<TState>,
  updated: SessionRecord<TState>
): void {
  if (
    updated.sessionId !== lockedSessionId ||
    updated.version.sessionId !== lockedSessionId ||
    updated.version.stateVersion !== current.version.stateVersion + 1
  ) {
    throw new SessionVersionConflictError(lockedSessionId, current.version.stateVersion);
  }
}
