export type SessionId = string;
export type PlayerId = string;
export type EventId = string;

export type SessionEventStatus = "pending" | "processing" | "completed" | "failed";

export interface SessionEvent {
  id: EventId;
  sessionId: SessionId;
  playerId: PlayerId;
  sequence: number;
  actionId: string;
  payload: unknown;
  status: SessionEventStatus;
  attempts: number;
  errorCode?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface SessionStateVersion {
  sessionId: SessionId;
  stateVersion: number;
  lastEventSequence: number;
}

export type SessionLockStatus = "active" | "expired" | "released";

export interface SessionLock {
  sessionId: SessionId;
  lockId: string;
  ownerId: string;
  acquiredAt: Date;
  ttlMs: number;
  status: SessionLockStatus;
}

export interface SessionRecoveryResult {
  sessionId: SessionId;
  recovered: boolean;
  reason: "timeout" | "internal_error";
  message: string;
}

export interface SessionSnapshot<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  state: TState;
  version: SessionStateVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionCommand<TState = unknown> {
  gameId: string;
  playerId?: PlayerId;
  initialState: TState;
}

export interface DispatchActionCommand {
  sessionId: SessionId;
  playerId?: PlayerId;
  actionId: string;
  payload?: unknown;
}

export interface SessionStorePort<TState = unknown> {
  createSession(command: CreateSessionCommand<TState>): Promise<SessionSnapshot<TState>>;
  getSession(sessionId: SessionId): Promise<SessionSnapshot<TState> | null>;
  dispatchAction(command: DispatchActionCommand): Promise<SessionSnapshot<TState>>;
}
