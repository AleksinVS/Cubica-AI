import type {
  CreateSessionRequest,
  CreateSessionResponse,
  PlayerId,
  SessionId
} from "@cubica/contracts-session";
import { contentService } from "../content/contentService.ts";
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

  getSessionStore(): SessionStorePort<RuntimeState> {
    return this.sessionStore;
  }

  getContentSourceId(sessionId: SessionId): string | undefined {
    return this.contentSourceBySessionId.get(sessionId);
  }
}
