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
 * Generic snapshot writes must not fabricate or skip protected event ids.
 *
 * Only `withCommandTransaction` owns the event ledger and may advance its
 * cursor together with the exact committed event rows. Editor restore and
 * other trusted snapshot updates can advance `stateVersion`, but preserve the
 * ledger cursor verbatim.
 */
export function assertProtectedEventSequenceUnchanged<TState>(
  current: SessionRecord<TState>,
  updated: SessionRecord<TState>
): void {
  if (updated.version.lastEventSequence !== current.version.lastEventSequence) {
    throw new SessionStoreUnavailableError();
  }
}

/** Missing or invalid session credential; callers must not infer membership. */
export class SessionAuthenticationError extends HttpError {
  constructor() {
    super(401, "A valid Bearer credential is required for this session.", "SESSION_AUTHENTICATION_REQUIRED");
  }
}

/** The authenticated principal is not permitted to perform the requested operation. */
export class SessionAuthorizationError extends HttpError {
  constructor() {
    super(403, "The authenticated session principal is not allowed to perform this operation.", "SESSION_FORBIDDEN");
  }
}

/** One command identity cannot be rebound to different command contents. */
export class CommandIdReusedError extends HttpError {
  constructor(commandId: string) {
    super(409, `Command "${commandId}" was already accepted with different contents.`, "COMMAND_ID_REUSED");
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
