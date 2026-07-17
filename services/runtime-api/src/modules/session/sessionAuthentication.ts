/**
 * Session credential creation and HTTP Bearer authentication helpers.
 *
 * A raw credential is returned exactly once when a session is created. All
 * later layers pass only its SHA-256 digest to storage, so a database read
 * cannot recover a usable session credential.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type {
  CreateSessionPrincipalInput,
  SessionPrincipal,
  SessionRecord,
  SessionRole
} from "@cubica/contracts-session";
import { SessionAuthenticationError, SessionAuthorizationError } from "./sessionStoreErrors.ts";

const SESSION_CREDENTIAL_PATTERN = /^ses_[A-Za-z0-9_-]{43}$/u;

export interface NewLocalSessionAccess {
  accessToken: string;
  principal: CreateSessionPrincipalInput;
}

/** Create a local-controller principal backed by 32 random credential bytes. */
export function createLocalSessionAccess(role: SessionRole): NewLocalSessionAccess {
  const accessToken = `ses_${randomBytes(32).toString("base64url")}`;
  return {
    accessToken,
    principal: {
      principalId: randomUUID(),
      kind: "local-controller",
      role,
      actorScope: { kind: "all-session-actors" },
      credentialSha256: hashSessionCredential(accessToken)
    }
  };
}

/** Hash a credential before it crosses the session-store boundary. */
export function hashSessionCredential(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}

/** Parse the single supported HTTP Authorization form without accepting aliases. */
export function requireBearerCredential(headers: IncomingHttpHeaders): string {
  const authorization = headers.authorization;
  if (typeof authorization !== "string") {
    throw new SessionAuthenticationError();
  }
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  if (!match || !SESSION_CREDENTIAL_PATTERN.test(match[1])) {
    throw new SessionAuthenticationError();
  }
  return match[1];
}

/**
 * Resolve the gameplay actor only from authenticated scope and server state.
 *
 * Hot-seat sessions use the active participant from `state.public.turn`. A
 * session without a turn model has no actor unless the principal is bound to a
 * single explicit actor; mechanics that do not address per-player state can
 * safely execute with `undefined`.
 */
export function resolveSessionActor<TState>(
  session: SessionRecord<TState>,
  principal: SessionPrincipal
): string | undefined {
  if (principal.sessionId !== session.sessionId) {
    throw new SessionAuthorizationError();
  }

  const activeActorId = readActiveActorId(session.state);
  if (principal.actorScope.kind === "all-session-actors") {
    return activeActorId;
  }
  if (activeActorId !== undefined) {
    if (!principal.actorScope.actorIds.includes(activeActorId)) {
      throw new SessionAuthorizationError();
    }
    return activeActorId;
  }
  if (principal.actorScope.actorIds.length === 1) {
    return principal.actorScope.actorIds[0];
  }
  return undefined;
}

/**
 * Resolve the actor branch an authenticated caller may view after a command.
 *
 * Command execution and response projection have different time semantics:
 * the command actor is pinned from the pre-action snapshot for audit, while a
 * response must be projected from the snapshot it actually returns. A
 * participant bound to one actor keeps that own branch even while another
 * actor is active; an all-actor hot-seat controller follows the current turn.
 */
export function resolveSessionViewerActor<TState>(
  session: SessionRecord<TState>,
  principal: SessionPrincipal
): string | undefined {
  if (principal.sessionId !== session.sessionId) {
    throw new SessionAuthorizationError();
  }
  const activeActorId = readActiveActorId(session.state);
  if (principal.actorScope.kind === "all-session-actors") {
    return activeActorId;
  }
  if (principal.actorScope.actorIds.length === 1) {
    return principal.actorScope.actorIds[0];
  }
  return activeActorId !== undefined && principal.actorScope.actorIds.includes(activeActorId)
    ? activeActorId
    : undefined;
}

function readActiveActorId(state: unknown): string | undefined {
  if (!isRecord(state) || !isRecord(state.public) || !isRecord(state.public.turn)) {
    return undefined;
  }
  return typeof state.public.turn.activePlayerId === "string"
    ? state.public.turn.activePlayerId
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
