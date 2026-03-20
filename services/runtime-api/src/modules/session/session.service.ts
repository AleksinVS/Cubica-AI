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

const DEFAULT_GAME_ID = "antarctica";

export class SessionService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;

  constructor(options: SessionServiceOptions = {}) {
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore<RuntimeState>();
  }

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse<RuntimeState>> {
    const gameId = request.gameId ?? DEFAULT_GAME_ID;
    const playerId: PlayerId | undefined = request.playerId;

    const initialState = (await contentService.getInitialState(gameId)) as RuntimeState;

    const snapshot = await this.sessionStore.createSession({
      gameId,
      playerId,
      initialState
    });

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
}
