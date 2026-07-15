export type SessionId = string;
export type PlayerId = string;
export type EventId = string;
export type SessionRole = "player" | "facilitator" | "assistant" | "observer";

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
  /** Optional owner/player retained so durable adapters do not discard launch identity. */
  playerId?: PlayerId;
  /**
   * Editor-preview content source bound to this session.
   * It must survive a runtime restart together with the state; otherwise the
   * restored session could accidentally load canonical content instead.
   */
  contentSourceId?: string;
  state: TState;
  /** Trusted role chosen by runtime from the loaded manifest, never per action request. */
  sessionRole?: SessionRole;
  version: SessionStateVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionRequest {
  gameId?: string;
  playerId?: PlayerId;
  /**
   * Optional runtime content source for editor preview sessions.
   * Normal player sessions omit it and use the canonical published content.
   */
  contentSourceId?: string;
}

export interface CreateSessionInput<TState = unknown> {
  gameId: string;
  playerId?: PlayerId;
  contentSourceId?: string;
  initialState: TState;
  sessionRole?: SessionRole;
}

/**
 * Stable, non-technical explanation for why an action cannot be used now.
 *
 * Runtime deliberately does not expose guard expressions, JSON paths, or
 * secret state through this contract. Delivery clients translate these codes
 * into localized product copy and may add a more specific manifest-authored
 * explanation when one is available.
 */
export type SessionActionAvailabilityReasonCode =
  | "role_not_allowed"
  | "state_condition_failed"
  | "parameters_required"
  | "runtime_unsupported";

/**
 * Server projection of one declared action for the current session snapshot.
 *
 * `parameter-dependent` means the state-only checks passed, but the final
 * decision needs parameters selected by the player (for example a road id).
 * Such an action may remain interactive; runtime validates the completed
 * command again against the latest authoritative state.
 */
export interface SessionActionAvailability {
  actionId: string;
  status: "available" | "unavailable" | "parameter-dependent";
  reasonCode?: SessionActionAvailabilityReasonCode;
}

/**
 * Compare-and-set precondition for a session write.
 *
 * The caller supplies the state version it read before computing the next
 * snapshot. A store must reject the write when another request has already
 * advanced that version, preventing a stale action from overwriting progress.
 */
export interface UpdateSessionOptions {
  expectedStateVersion: number;
}

/**
 * Result produced while a session is exclusively locked for mutation.
 *
 * Omitting `updatedSession` makes the operation read-only. When it is present,
 * the store persists it before releasing the lock and returns `result` only
 * after the transaction commits.
 */
export interface LockedSessionOperationResult<TState, TResult> {
  result: TResult;
  updatedSession?: SessionRecord<TState>;
}

export type LockedSessionOperation<TState, TResult> = (
  current: SessionRecord<TState> | null
) => Promise<LockedSessionOperationResult<TState, TResult>>;

export interface CreateSessionResponse<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
}

export interface DispatchActionInput {
  sessionId: SessionId;
  /**
   * Version of the authoritative snapshot on which the caller based this
   * action. Runtime rejects stale or repeated requests before any effect runs.
   */
  expectedStateVersion: number;
  playerId?: PlayerId;
  actionId: string;
  params?: Record<string, unknown>;
  /** Legacy untrusted UI payload; deterministic action params use `params`. */
  payload?: unknown;
}

export interface DispatchActionResponse<TState = unknown> {
  sessionId: SessionId;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
}

/**
 * Read-only request for the server-owned road planner.
 *
 * `params` intentionally contains only the two endpoint references declared by
 * the selected manifest action. Payment parameters belong to the later
 * authoritative `POST /actions` command and are never trusted as preview input.
 */
export interface TransportRoadPreviewRequest {
  sessionId: SessionId;
  expectedStateVersion: number;
  playerId?: PlayerId;
  actionId: string;
  params: Record<string, unknown>;
}

/** Canonical map-space point returned by a transport-road preview. */
export interface TransportRoadPreviewPoint {
  x: number;
  y: number;
}

/**
 * Safe read-only projection of one planned road.
 *
 * The response deliberately excludes the session seed and random counters.
 * `candidateCount` explains whether the confirmed action may choose among
 * equally priced routes, while `usedStateVersion` identifies the snapshot on
 * which this non-authoritative calculation was made.
 */
export interface TransportRoadPreviewResponse {
  sessionId: SessionId;
  actionId: string;
  usedStateVersion: number;
  networkId: string;
  fromNodeId: string;
  toNodeId: string;
  polyline: Array<TransportRoadPreviewPoint>;
  regionSequence: Array<string>;
  regionSegments: number;
  cost: number;
  candidateCount: number;
  planning: {
    mode: "region-segment-minimum";
    algorithmVersion: string;
    geometryVersion: string;
    geometryHash: string;
    boundaryPolicy: string;
  };
}

export interface RestorePreviewSessionRequest<TState = unknown> {
  /**
   * Runtime state captured from the same preview session earlier in the
   * playthrough. This endpoint is intended for editor debugging only.
   */
  state: TState;
  /**
   * Version that belongs to the restored state. The runtime-api normalizes the
   * session id to the target session so callers cannot move state between ids.
   */
  version: Omit<SessionStateVersion, "sessionId"> & { sessionId?: SessionId };
  /** Editor trace sequence selected by the author. Used for diagnostics/UI. */
  targetEventSequence?: number;
  /** Human-readable reason for audit logs and diagnostics. */
  reason?: string;
}

export interface RestorePreviewSessionResponse<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
  restored: true;
}

export interface SessionStorePort<TState = unknown> {
  /** Human-readable backing-store mode exposed through the readiness endpoint. */
  readonly mode: string;
  createSession(input: CreateSessionInput<TState>): Promise<SessionRecord<TState>>;
  getSession(sessionId: SessionId): Promise<SessionRecord<TState> | null>;
  updateSession(
    session: SessionRecord<TState>,
    options: UpdateSessionOptions
  ): Promise<SessionRecord<TState>>;
  /**
   * Execute the complete state transition while holding an exclusive lock.
   * Durable stores must keep the same checked-out connection and transaction
   * from the locked read through the final write.
   */
  withLockedSession<TResult>(
    sessionId: SessionId,
    operation: LockedSessionOperation<TState, TResult>
  ): Promise<TResult>;
  /** Execute the real dependency probe used by `/readiness`. */
  checkReadiness(): Promise<void>;
  /** Release connections and timers owned by the store. */
  close(): Promise<void>;
}

export type SessionSnapshot<TState = unknown> = SessionRecord<TState>;
export type CreateSessionCommand<TState = unknown> = CreateSessionInput<TState>;
export type DispatchActionCommand = DispatchActionInput;

/**
 * Bounded HTTP response shape for session creation and retrieval.
 * Covers current `POST /sessions` and `GET /sessions/:id` consumer surface.
 */
export interface SessionResponse<TState = unknown> {
  sessionId: SessionId;
  gameId: string;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
}

/**
 * Bounded HTTP response shape for action dispatch.
 * Covers current `POST /actions` consumer surface.
 */
export interface ActionResponse<TState = unknown> {
  sessionId: SessionId;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
}

/**
 * Bounded HTTP response shape for editor-preview session restore.
 * Production gameplay sessions must not expose this operation.
 */
export type RestorePreviewSessionSnapshot<TState = unknown> = RestorePreviewSessionResponse<TState>;
