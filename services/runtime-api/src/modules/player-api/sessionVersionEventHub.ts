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

/**
 * Process-local, bounded notification hub for the accepted single-instance
 * runtime. Messages carry only durable cursors; clients fetch their complete
 * authenticated projection over the ordinary session endpoint.
 */
export class SessionVersionEventHub {
  private readonly subscriptions = new Set<StreamSubscription>();
  private readonly subscriptionsByPrincipal = new Map<string, StreamSubscription>();
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

  close(): void {
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
