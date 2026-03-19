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

export interface SessionRecord<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  state: TState;
  version: SessionStateVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionRequest {
  gameId?: string;
  playerId?: PlayerId;
}

export interface CreateSessionInput<TState = unknown> {
  gameId: string;
  playerId?: PlayerId;
  initialState: TState;
}

export interface CreateSessionResponse<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  version: SessionStateVersion;
  state: TState;
}

export interface DispatchActionInput {
  sessionId: SessionId;
  playerId?: PlayerId;
  actionId: string;
  payload?: unknown;
}

export interface DispatchActionResponse<TState = unknown> {
  sessionId: SessionId;
  version: SessionStateVersion;
  state: TState;
}

export interface SessionStorePort<TState = unknown> {
  createSession(input: CreateSessionInput<TState>): Promise<SessionRecord<TState>>;
  getSession(sessionId: SessionId): Promise<SessionRecord<TState> | null>;
  updateSession(session: SessionRecord<TState>): Promise<SessionRecord<TState>>;
}

export type SessionSnapshot<TState = unknown> = SessionRecord<TState>;
export type CreateSessionCommand<TState = unknown> = CreateSessionInput<TState>;
export type DispatchActionCommand = DispatchActionInput;
