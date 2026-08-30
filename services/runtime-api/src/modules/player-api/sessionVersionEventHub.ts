import type { ServerResponse } from "node:http";
import type { SessionStateVersion } from "@cubica/contracts-session";

export const MAX_SESSION_VERSION_STREAMS = 128;
const KEEPALIVE_INTERVAL_MS = 20_000;
export const SESSION_VERSION_STREAM_DRAIN_TIMEOUT_MS = 10_000;

interface StreamSubscription {
  readonly sessionId: string;
  readonly principalId: string;
  readonly key: string;
  readonly response: ServerResponse;
  lastStateVersion: number;
  lastEventSequence: number;
  pendingVersion?: SessionStateVersion;
  backpressured: boolean;
  keepalive?: NodeJS.Timeout;
  drainTimeout?: NodeJS.Timeout;
  cleanup?: () => void;
  onDrain?: () => void;
}

export interface SessionVersionStreamReservation {
  readonly sessionId: string;
  readonly principalId: string;
  readonly token: symbol;
}

/**
 * Process-local, bounded notification hub for the accepted single-instance
 * runtime. Messages carry only durable cursors; clients fetch their complete
 * authenticated projection over the ordinary session endpoint.
 */
export class SessionVersionEventHub {
  private readonly subscriptions = new Set<StreamSubscription>();
  private readonly subscriptionsByPrincipal = new Map<string, StreamSubscription>();
  private readonly pendingByPrincipal = new Map<string, symbol>();
  private readonly maxStreams: number;

  constructor(maxStreams = MAX_SESSION_VERSION_STREAMS) {
    if (!Number.isSafeInteger(maxStreams) || maxStreams < 1) {
      throw new Error("Session event stream capacity must be a positive safe integer");
    }
    this.maxStreams = maxStreams;
  }

  get size(): number {
    return this.subscriptions.size;
  }

  /**
   * Reserve the principal slot before the final durable credential check.
   * Rotation can invalidate this pending registration even when no response
   * stream exists yet, closing the authenticate-then-subscribe race.
   */
  reservePrincipal(sessionId: string, principalId: string): SessionVersionStreamReservation {
    const token = Symbol("session-version-stream-reservation");
    this.pendingByPrincipal.set(subscriptionKey(sessionId, principalId), token);
    return { sessionId, principalId, token };
  }

  subscribeReserved(
    response: ServerResponse,
    version: SessionStateVersion,
    reservation: SessionVersionStreamReservation
  ): () => void {
    const key = subscriptionKey(reservation.sessionId, reservation.principalId);
    if (this.pendingByPrincipal.get(key) !== reservation.token) {
      throw new SessionVersionStreamReservationInvalidError();
    }
    this.pendingByPrincipal.delete(key);
    return this.subscribe(response, version, reservation.principalId);
  }

  cancelReservation(reservation: SessionVersionStreamReservation): void {
    const key = subscriptionKey(reservation.sessionId, reservation.principalId);
    if (this.pendingByPrincipal.get(key) === reservation.token) {
      this.pendingByPrincipal.delete(key);
    }
  }

  subscribe(response: ServerResponse, version: SessionStateVersion, principalId: string): () => void {
    const key = subscriptionKey(version.sessionId, principalId);
    const previous = this.subscriptionsByPrincipal.get(key);
    if (previous !== undefined) {
      previous.cleanup?.();
      previous.response.end();
    }
    if (this.subscriptions.size >= this.maxStreams) {
      throw new SessionVersionStreamCapacityError();
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders?.();

    const subscription: StreamSubscription = {
      sessionId: version.sessionId,
      principalId,
      key,
      response,
      lastStateVersion: version.stateVersion,
      lastEventSequence: version.lastEventSequence,
      backpressured: false
    };
    this.subscriptions.add(subscription);
    this.subscriptionsByPrincipal.set(key, subscription);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (subscription.keepalive !== undefined) clearInterval(subscription.keepalive);
      if (subscription.drainTimeout !== undefined) clearTimeout(subscription.drainTimeout);
      if (subscription.onDrain !== undefined) response.off("drain", subscription.onDrain);
      this.subscriptions.delete(subscription);
      if (this.subscriptionsByPrincipal.get(subscription.key) === subscription) {
        this.subscriptionsByPrincipal.delete(subscription.key);
      }
    };
    subscription.cleanup = cleanup;
    subscription.onDrain = () => this.resumeAfterDrain(subscription);
    response.once("close", cleanup);
    response.once("error", cleanup);
    response.on("drain", subscription.onDrain);
    subscription.keepalive = setInterval(() => this.writeKeepalive(subscription), KEEPALIVE_INTERVAL_MS);
    subscription.keepalive.unref();
    try {
      this.writeVersion(subscription, version);
    } catch (error) {
      cleanup();
      response.destroy();
      throw error;
    }
    return cleanup;
  }

  /** Notify matching streams after a mutation has committed. */
  publish(version: SessionStateVersion): void {
    for (const subscription of this.subscriptions) {
      if (
        subscription.sessionId !== version.sessionId ||
        version.stateVersion < subscription.lastStateVersion ||
        (version.stateVersion === subscription.lastStateVersion &&
          version.lastEventSequence <= subscription.lastEventSequence)
      ) {
        continue;
      }
      if (subscription.backpressured) {
        if (isVersionAfter(version, subscription.pendingVersion ?? {
          stateVersion: subscription.lastStateVersion,
          lastEventSequence: subscription.lastEventSequence
        })) {
          subscription.pendingVersion = version;
        }
        continue;
      }
      try {
        this.writeVersion(subscription, version);
      } catch {
        // Delivery is explicitly post-commit and best effort. A disconnected
        // client repairs any missed notification through full resync.
        subscription.response.destroy();
      }
    }
  }

  /** Close the already-authenticated stream when its durable credential rotates. */
  disconnectPrincipal(sessionId: string, principalId: string): boolean {
    const key = subscriptionKey(sessionId, principalId);
    const pendingDisconnected = this.pendingByPrincipal.delete(key);
    const subscription = this.subscriptionsByPrincipal.get(key);
    if (subscription === undefined) return pendingDisconnected;
    subscription.cleanup?.();
    try {
      subscription.response.end();
    } catch {
      try {
        subscription.response.destroy();
      } catch {
        // cleanup already removed the subscription, so no later cursor can leak.
      }
    }
    return true;
  }

  close(): void {
    this.pendingByPrincipal.clear();
    for (const subscription of [...this.subscriptions]) {
      subscription.cleanup?.();
      subscription.response.end();
    }
  }

  private writeKeepalive(subscription: StreamSubscription): void {
    const { response } = subscription;
    if (subscription.backpressured || response.destroyed || response.writableEnded) return;
    try {
      if (!response.write(": keepalive\n\n")) this.pauseUntilDrain(subscription);
    } catch {
      response.destroy();
    }
  }

  private writeVersion(subscription: StreamSubscription, version: SessionStateVersion): void {
    const accepted = subscription.response.write(formatVersion(version));
    subscription.lastStateVersion = version.stateVersion;
    subscription.lastEventSequence = version.lastEventSequence;
    if (!accepted) this.pauseUntilDrain(subscription);
  }

  private pauseUntilDrain(subscription: StreamSubscription): void {
    if (subscription.backpressured) return;
    subscription.backpressured = true;
    subscription.drainTimeout = setTimeout(() => {
      subscription.cleanup?.();
      subscription.response.destroy();
    }, SESSION_VERSION_STREAM_DRAIN_TIMEOUT_MS);
    subscription.drainTimeout.unref();
  }

  private resumeAfterDrain(subscription: StreamSubscription): void {
    if (!subscription.backpressured) return;
    subscription.backpressured = false;
    if (subscription.drainTimeout !== undefined) {
      clearTimeout(subscription.drainTimeout);
      subscription.drainTimeout = undefined;
    }
    const pendingVersion = subscription.pendingVersion;
    subscription.pendingVersion = undefined;
    if (pendingVersion === undefined) return;
    try {
      this.writeVersion(subscription, pendingVersion);
    } catch {
      subscription.response.destroy();
    }
  }
}

function subscriptionKey(sessionId: string, principalId: string): string {
  return JSON.stringify([sessionId, principalId]);
}

/** Deterministic client retry hint for the process-local stream admission cap. */
export const SESSION_VERSION_STREAM_RETRY_AFTER_SECONDS = 1;

export class SessionVersionStreamCapacityError extends Error {
  readonly retryAfterSeconds = SESSION_VERSION_STREAM_RETRY_AFTER_SECONDS;

  constructor() {
    super("Session event stream capacity is exhausted");
    this.name = "SessionVersionStreamCapacityError";
  }
}

export class SessionVersionStreamReservationInvalidError extends Error {
  constructor() {
    super("Session event stream reservation is no longer valid");
    this.name = "SessionVersionStreamReservationInvalidError";
  }
}

function formatVersion(version: SessionStateVersion): string {
  return `event: version\ndata: ${JSON.stringify({
    stateVersion: version.stateVersion,
    lastEventSequence: version.lastEventSequence
  })}\n\n`;
}

function isVersionAfter(
  candidate: SessionStateVersion,
  current: Pick<SessionStateVersion, "stateVersion" | "lastEventSequence">
): boolean {
  return candidate.stateVersion > current.stateVersion || (
    candidate.stateVersion === current.stateVersion &&
    candidate.lastEventSequence > current.lastEventSequence
  );
}
