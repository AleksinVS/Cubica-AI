import type {
  CreateSessionInput,
  LockedSessionOperation,
  SessionRecord,
  SessionStorePort,
  UpdateSessionOptions
} from "@cubica/contracts-session";
import {
  assertNextSessionVersion,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemorySessionStore<TState = unknown> implements SessionStorePort<TState> {
  readonly mode = "in-memory";
  private readonly sessions = new Map<string, SessionRecord<TState>>();
  private readonly lockedSessionIds = new Set<string>();

  async createSession(command: CreateSessionInput<TState>): Promise<SessionRecord<TState>> {
    const sessionId = createId("session");
    const now = new Date();
    const snapshot: SessionRecord<TState> = {
      sessionId,
      gameId: command.gameId,
      playerId: command.playerId,
      contentSourceId: command.contentSourceId,
      state: command.initialState,
      sessionRole: command.sessionRole,
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

  async updateSession(
    session: SessionRecord<TState>,
    options: UpdateSessionOptions
  ): Promise<SessionRecord<TState>> {
    if (this.lockedSessionIds.has(session.sessionId)) {
      throw new SessionWriteLockedError(session.sessionId);
    }
    const current = this.sessions.get(session.sessionId);
    if (!current || current.version.stateVersion !== options.expectedStateVersion) {
      throw new SessionVersionConflictError(session.sessionId, options.expectedStateVersion);
    }
    assertNextSessionVersion(session.sessionId, current, session);
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async withLockedSession<TResult>(
    sessionId: string,
    operation: LockedSessionOperation<TState, TResult>
  ): Promise<TResult> {
    // The in-memory adapter mirrors PostgreSQL `FOR UPDATE NOWAIT`: a second
    // mutation is rejected immediately instead of silently queueing behind a
    // potentially long agent turn. This makes dev/test concurrency behavior
    // representative of production.
    if (this.lockedSessionIds.has(sessionId)) {
      throw new SessionWriteLockedError(sessionId);
    }

    this.lockedSessionIds.add(sessionId);
    try {
      const current = this.sessions.get(sessionId) ?? null;
      const operationResult = await operation(current);

      if (operationResult.updatedSession !== undefined) {
        if (current === null) {
          throw new SessionVersionConflictError(sessionId, 0);
        }

        assertNextSessionVersion(sessionId, current, operationResult.updatedSession);

        const latest = this.sessions.get(sessionId);
        if (latest?.version.stateVersion !== current.version.stateVersion) {
          throw new SessionVersionConflictError(sessionId, current.version.stateVersion);
        }
        this.sessions.set(sessionId, operationResult.updatedSession);
      }

      return operationResult.result;
    } finally {
      this.lockedSessionIds.delete(sessionId);
    }
  }

  async checkReadiness(): Promise<void> {
    // No external dependency exists in the explicit dev/test adapter.
  }

  async close(): Promise<void> {
    // The adapter owns no connections or timers.
  }
}
