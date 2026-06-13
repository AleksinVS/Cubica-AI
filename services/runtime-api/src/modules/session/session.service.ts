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
import { HttpError, NotFoundError } from "../errors.ts";
import { InMemorySessionStore } from "./inMemorySessionStore.ts";
import type { SessionStorePort } from "@cubica/contracts-session";

type RuntimeState = Record<string, unknown>;

interface SessionServiceOptions {
  sessionStore?: SessionStorePort<RuntimeState>;
}

export class SessionService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;
  private readonly contentSourceBySessionId = new Map<string, string>();

  constructor(options: SessionServiceOptions = {}) {
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore<RuntimeState>();
  }

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse<RuntimeState>> {
    const gameId = request.gameId;
    if (!gameId) {
      throw new Error("gameId is required to create a session");
    }
    const playerId: PlayerId | undefined = request.playerId;

    await assertGameLaunchReady({ gameId, contentSourceId: request.contentSourceId });

    const initialState = (await contentService.getInitialState(gameId, request.contentSourceId)) as RuntimeState;

    const snapshot = await this.sessionStore.createSession({
      gameId,
      playerId,
      initialState
    });

    if (request.contentSourceId !== undefined) {
      this.contentSourceBySessionId.set(snapshot.sessionId, request.contentSourceId);
    }

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: snapshot.state
    };
  }

  async getSession(sessionId: SessionId): Promise<CreateSessionResponse<RuntimeState> | null> {
    const snapshot = await this.sessionStore.getSession(sessionId);
    if (!snapshot) {
      return null;
    }

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: snapshot.state
    };
  }

  async restorePreviewSession(
    sessionId: SessionId,
    request: RestorePreviewSessionRequest<RuntimeState>
  ): Promise<RestorePreviewSessionResponse<RuntimeState>> {
    const current = await this.sessionStore.getSession(sessionId);
    if (!current) {
      throw new NotFoundError(`Session "${sessionId}" was not found`);
    }

    if (!this.contentSourceBySessionId.has(sessionId)) {
      throw new HttpError(403, "Preview session restore is available only for editor preview sessions.");
    }

    const restored = await this.sessionStore.updateSession({
      ...current,
      state: request.state,
      version: {
        sessionId,
        stateVersion: request.version.stateVersion,
        lastEventSequence: request.version.lastEventSequence
      },
      updatedAt: new Date()
    });

    return {
      sessionId: restored.sessionId,
      gameId: restored.gameId,
      version: restored.version,
      state: restored.state,
      restored: true
    };
  }

  getSessionStore(): SessionStorePort<RuntimeState> {
    return this.sessionStore;
  }

  getContentSourceId(sessionId: SessionId): string | undefined {
    return this.contentSourceBySessionId.get(sessionId);
  }
}
