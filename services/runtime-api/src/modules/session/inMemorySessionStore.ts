import type {
  CreateSessionInput,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemorySessionStore<TState = unknown> implements SessionStorePort<TState> {
  private readonly sessions = new Map<string, SessionRecord<TState>>();

  async createSession(command: CreateSessionInput<TState>): Promise<SessionRecord<TState>> {
    const sessionId = createId("session");
    const now = new Date();
    const snapshot: SessionRecord<TState> = {
      sessionId,
      gameId: command.gameId,
      state: command.initialState,
      version: {
        sessionId,
        stateVersion: 0,
        lastEventSequence: 0
      },
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(sessionId, snapshot);
    return snapshot;
  }

  async getSession(sessionId: string): Promise<SessionRecord<TState> | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async updateSession(session: SessionRecord<TState>): Promise<SessionRecord<TState>> {
    this.sessions.set(session.sessionId, session);
    return session;
  }
}
