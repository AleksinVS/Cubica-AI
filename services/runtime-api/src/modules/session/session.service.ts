import type {
  CreateSessionRequest,
  CreateSessionResponse,
  PlayerId,
  RestorePreviewSessionRequest,
  RestorePreviewSessionResponse,
  SessionId
} from "@cubica/contracts-session";
import { assertGameLaunchReady } from "../admin/health.ts";
import { contentService } from "../content/contentService.ts";
import { HttpError, NotFoundError, RequestValidationError } from "../errors.ts";
import { initializeTurnBasedSessionState } from "./turnBasedSessionState.ts";
import { projectPlayerSessionState } from "./playerSessionProjection.ts";
import type { SessionStorePort } from "@cubica/contracts-session";
import { projectSessionActionAvailability } from "../runtime/actionAvailability.ts";

type RuntimeState = Record<string, unknown>;

interface SessionServiceOptions {
  sessionStore: SessionStorePort<RuntimeState>;
}

export class SessionService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;

  constructor(options: SessionServiceOptions) {
    this.sessionStore = options.sessionStore;
  }

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse<RuntimeState>> {
    const gameId = request.gameId;
    if (!gameId) {
      // WHY: A missing gameId is a client error, not a server fault. Throwing a
      // `RequestValidationError` (HTTP 400) instead of a plain `Error` prevents
      // `httpServer.ts` from mapping it to a misleading HTTP 500. The request
      // validation layer normally catches this first; this guard defends the
      // service when it is invoked directly (e.g. tests, internal callers).
      throw new RequestValidationError("gameId is required to create a session");
    }
    const playerId: PlayerId | undefined = request.playerId;

    await assertGameLaunchReady({ gameId, contentSourceId: request.contentSourceId });

    const manifest = await contentService.getGameManifest(gameId, request.contentSourceId);
    const declaredState = (await contentService.getInitialState(gameId, request.contentSourceId)) as RuntimeState;
    // The manifest declares templates; runtime creates concrete participants,
    // turn ownership and replay state for this particular session.
    const initialState = initializeTurnBasedSessionState(manifest, declaredState);
    // The local facilitator role is derived from trusted game configuration.
    // Accepting it from POST /sessions or POST /actions would let a client grant
    // itself privileges, so facilitated mode is the only source for this role.
    const sessionRole = manifest.config.sessionMode === "facilitated" ? "facilitator" : "player";

    const snapshot = await this.sessionStore.createSession({
      gameId,
      playerId,
      contentSourceId: request.contentSourceId,
      initialState,
      sessionRole
    });
    const bundle = await contentService.getBundle(snapshot.gameId, snapshot.contentSourceId);

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: projectPlayerSessionState(snapshot.state),
      actionAvailability: projectSessionActionAvailability(snapshot, bundle)
    };
  }

  async getSession(sessionId: SessionId): Promise<CreateSessionResponse<RuntimeState> | null> {
    const snapshot = await this.sessionStore.getSession(sessionId);
    if (!snapshot) {
      return null;
    }
    const bundle = await contentService.getBundle(snapshot.gameId, snapshot.contentSourceId);

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: projectPlayerSessionState(snapshot.state),
      actionAvailability: projectSessionActionAvailability(snapshot, bundle)
    };
  }

  async restorePreviewSession(
    sessionId: SessionId,
    request: RestorePreviewSessionRequest<RuntimeState>
  ): Promise<RestorePreviewSessionResponse<RuntimeState>> {
    return this.sessionStore.withLockedSession(sessionId, async (current) => {
    if (!current) {
      throw new NotFoundError(`Session "${sessionId}" was not found`);
    }

    if (current.contentSourceId === undefined) {
      throw new HttpError(403, "Preview session restore is available only for editor preview sessions.");
    }

    const restored = {
      ...current,
      state: request.state,
      version: {
        sessionId,
        // A rewind creates a NEW durable snapshot. Only the gameplay/event
        // cursor moves backwards; stateVersion remains a monotonic concurrency
        // token and therefore advances exactly once.
        stateVersion: current.version.stateVersion + 1,
        lastEventSequence: request.version.lastEventSequence
      },
      updatedAt: new Date()
    };
    const bundle = await contentService.getBundle(restored.gameId, restored.contentSourceId);

    return {
      updatedSession: restored,
      result: {
        sessionId: restored.sessionId,
        gameId: restored.gameId,
        version: restored.version,
        state: projectPlayerSessionState(restored.state),
        actionAvailability: projectSessionActionAvailability(restored, bundle),
        restored: true
      }
    };
    });
  }

  getSessionStore(): SessionStorePort<RuntimeState> {
    return this.sessionStore;
  }

  async getContentSourceId(sessionId: SessionId): Promise<string | undefined> {
    return (await this.sessionStore.getSession(sessionId))?.contentSourceId;
  }
}
