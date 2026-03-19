import type {
  CreateSessionCommand,
  DispatchActionCommand,
  SessionSnapshot,
  SessionStorePort
} from "./contracts.ts";

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemorySessionStore<TState = unknown> implements SessionStorePort<TState> {
  private readonly sessions = new Map<string, SessionSnapshot<TState>>();

  async createSession(command: CreateSessionCommand<TState>): Promise<SessionSnapshot<TState>> {
    const sessionId = createId("session");
    const now = new Date();
    const snapshot: SessionSnapshot<TState> = {
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

  async getSession(sessionId: string): Promise<SessionSnapshot<TState> | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async dispatchAction(command: DispatchActionCommand): Promise<SessionSnapshot<TState>> {
    const current = this.sessions.get(command.sessionId);
    if (!current) {
      throw new Error(`Session "${command.sessionId}" was not found`);
    }

    const nextVersion = {
      sessionId: current.sessionId,
      stateVersion: current.version.stateVersion + 1,
      lastEventSequence: current.version.lastEventSequence + 1
    };

    const nextState = {
      ...(current.state as Record<string, unknown>),
      runtime: {
        lastActionId: command.actionId,
        lastPayload: command.payload ?? null,
        lastUpdatedAt: new Date().toISOString()
      }
    } as TState;

    const nextSnapshot: SessionSnapshot<TState> = {
      ...current,
      state: nextState,
      version: nextVersion,
      updatedAt: new Date()
    };

    this.sessions.set(command.sessionId, nextSnapshot);
    return nextSnapshot;
  }
}
