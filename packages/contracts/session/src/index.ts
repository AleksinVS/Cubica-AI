export type SessionId = string;
export type PlayerId = string;
export type EventId = string;
export type SessionRole = "player" | "facilitator" | "assistant" | "observer";
export type SessionPrincipalId = string;

/**
 * Authentication identity bound to one session.
 *
 * A principal identifies the caller that proved possession of a credential;
 * it is deliberately separate from the actor whose turn is currently being
 * executed. In local hot-seat play one controller principal can therefore act
 * for whichever participant the authoritative state selects.
 */
export interface SessionPrincipal {
  principalId: SessionPrincipalId;
  sessionId: SessionId;
  kind: "local-controller" | "participant" | "facilitator" | "agent" | "system";
  role: SessionRole;
  actorScope:
    | { kind: "all-session-actors" }
    | { kind: "listed-actors"; actorIds: ReadonlyArray<PlayerId> };
  createdAt: Date;
}

/** Store-only principal material supplied while an authenticated session is created. */
export interface CreateSessionPrincipalInput {
  principalId: SessionPrincipalId;
  kind: SessionPrincipal["kind"];
  role: SessionRole;
  actorScope: SessionPrincipal["actorScope"];
  /** Lowercase SHA-256 digest. The raw bearer credential must never reach storage. */
  credentialSha256: string;
}

/** Immutable, content-addressed rules captured when a session is created. */
export interface ImmutableGameBundle {
  /** Self-describing byte identity, for example `cubica-bundle-v1:sha256:...`. */
  bundleHash: string;
  gameId: string;
  /** Exact canonical UTF-8 bytes hashed by `bundleHash`; JSONB is not a substitute. */
  canonicalBytes: Uint8Array;
  /** Parsed copy retained for safe inspection and indexed database queries. */
  canonicalBundle: unknown;
  createdAt: Date;
}

/** Store input for persisting an immutable bundle alongside a new session. */
export type CreateImmutableGameBundleInput = Omit<ImmutableGameBundle, "createdAt">;

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
  /** Exact immutable rules used for every command and replay in this session. */
  bundleHash: string;
  /**
   * Editor-preview content source bound to this session.
   * It must survive a runtime restart together with the state; otherwise the
   * restored session could accidentally load canonical content instead.
   */
  contentSourceId?: string;
  state: TState;
  /**
   * Legacy/default session presentation role captured at creation.
   * Authorization always uses the authenticated SessionPrincipal.role; this
   * field must never grant authority to another credential in the session.
   */
  sessionRole?: SessionRole;
  version: SessionStateVersion;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionRequest {
  gameId?: string;
  /**
   * Optional runtime content source for editor preview sessions.
   * Normal player sessions omit it and use the canonical published content.
   */
  contentSourceId?: string;
}

export interface CreateSessionInput<TState = unknown> {
  gameId: string;
  contentSourceId?: string;
  initialState: TState;
  sessionRole?: SessionRole;
  immutableBundle: CreateImmutableGameBundleInput;
  principal: CreateSessionPrincipalInput;
}

/** Session and principal records created atomically by a store adapter. */
export interface CreatedSession<TState = unknown> {
  session: SessionRecord<TState>;
  principal: SessionPrincipal;
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
  /** Authoritative state version from which this dynamic decision was derived. */
  basisStateVersion: number;
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
  /** Returned only by direct creation so a trusted BFF can store and hand it off. */
  credential: string;
}

/** Public session projection returned after the one-time credential handoff. */
export type GetSessionResponse<TState = unknown> = Omit<CreateSessionResponse<TState>, "credential">;

export interface DispatchActionInput {
  sessionId: SessionId;
  /**
   * Version of the authoritative snapshot on which the caller based this
   * action. Runtime checks an existing command receipt first; only a new
   * logical command is rejected when this concurrency precondition is stale.
   */
  expectedStateVersion: number;
  actionId: string;
  /** Stable identity of one logical command across all transport retries. */
  commandId: string;
  /** Optional identity of one HTTP delivery attempt; never an idempotency key. */
  requestId?: string;
  params: Record<string, unknown>;
}

export type SessionCommandReceiptStatus = "applied" | "rejected";

/** One versioned Mechanics step retained only in the protected command ledger. */
export interface SessionMechanicsAuditStep {
  stepId: string;
  operation: string;
  result?: unknown;
}

/** Resource counters charged by the Mechanics executor for one command. */
export interface SessionMechanicsCost {
  steps: number;
  expressionNodes: number;
  /**
   * Deterministic work units consumed by registered bounded algorithms.
   * Absent only on protected receipts written before algorithm metering.
   */
  algorithmWork?: number;
  scannedEntities: number;
  resultEntities: number;
  writes: number;
  events: number;
  intermediateBytes: number;
  eventBytes: number;
  auditBytes: number;
}

/** Bounded protected Mechanics trace persisted atomically with the command. */
export interface SessionMechanicsAudit {
  formatVersion: "1.0.0";
  steps: ReadonlyArray<SessionMechanicsAuditStep>;
  cost: SessionMechanicsCost;
}

/** Safe receipt projection that can be returned to an authenticated client. */
export interface PublicSessionCommandReceipt {
  commandId: string;
  actionId: string;
  status: SessionCommandReceiptStatus;
  stateVersionBefore: number;
  stateVersionAfter: number;
  eventRefs: ReadonlyArray<string>;
  planHash?: string;
  rejectionCode?: string;
}

/**
 * Protected command-ledger record.
 *
 * This is the first internal audit record for an accepted logical command. It
 * stores stable actor and rule identities so an exact retry never re-resolves
 * them from a later snapshot.
 */
export interface SessionCommandReceipt {
  receiptId: string;
  sessionId: SessionId;
  principalId: SessionPrincipalId;
  commandId: string;
  fingerprint: string;
  actionId: string;
  actorId?: PlayerId;
  bundleHash: string;
  definitionHash: string;
  planHash?: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  status: SessionCommandReceiptStatus;
  eventRefs: ReadonlyArray<string>;
  publicReceipt: PublicSessionCommandReceipt;
  /** Deterministic internal result needed to reconstruct an exact retry response. */
  result?: unknown;
  audit: {
    acceptedAt: Date;
    requestId?: string;
    commandKind?: "game-intent" | "agent-turn";
    /** External command entry action; equals `actionId` for ordinary intents. */
    triggerActionId?: string;
    /** Published Game Intent actually executed after an Agent Turn selection. */
    selectedActionId?: string;
    /** Full bounded Mechanics trace; deliberately absent from the public receipt. */
    mechanics?: SessionMechanicsAudit;
  };
  createdAt: Date;
}

/**
 * Durable event produced by one applied command.
 *
 * This is an immutable gameplay fact, not a pending item from the separate
 * future `session_command_queue`. Its sequence is allocated under the session
 * lock and it commits atomically with state and the command receipt.
 */
export interface SessionEventRecord {
  eventId: EventId;
  sessionId: SessionId;
  sequence: number;
  receiptId: string;
  commandId: string;
  actionId: string;
  principalId: SessionPrincipalId;
  actorId?: PlayerId;
  audience: "public" | "actor" | "server";
  eventType: string;
  summary: unknown;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface SessionAuthenticationInput {
  sessionId: SessionId;
  credentialSha256: string;
}

/** Input for one authenticated command transaction. */
export interface SessionCommandTransactionInput extends SessionAuthenticationInput {
  commandId: string;
}

/** Protected deferred Game Intent pinned to one immutable session bundle. */
export interface SessionSystemSchedule {
  scheduleId: string;
  sessionId: SessionId;
  bundleHash: string;
  actionId: string;
  params: Record<string, string | number | boolean>;
  definitionHash: string;
  /** Bounded Mechanics predicate re-evaluated on authoritative state. */
  trigger: unknown;
  falsePolicy: "defer" | "skip";
  maxOccurrences: number;
  nextOccurrence: number;
  status: "pending" | "cancelled" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

/** Atomic protected-schedule changes emitted by one successful command. */
export type SessionSystemScheduleMutation =
  | { kind: "register"; schedule: SessionSystemSchedule }
  | { kind: "cancel"; scheduleId: string };

export interface SessionSystemCommandTransactionInput {
  sessionId: SessionId;
  scheduleId: string;
  occurrence: number;
  commandId: string;
}

export interface SessionSystemCommandTransactionContext<TState = unknown>
  extends SessionCommandTransactionContext<TState> {
  schedule: SessionSystemSchedule;
}

/**
 * `defer` is deliberately non-terminal: it cannot commit state or a receipt.
 * `apply` and `skip` atomically consume exactly the loaded occurrence.
 */
export type SessionSystemScheduleDisposition = "apply" | "skip" | "defer";

export interface SessionCommandTransactionContext<TState = unknown> {
  currentSession: SessionRecord<TState>;
  principal: SessionPrincipal;
  bundle: ImmutableGameBundle;
  existingReceipt?: SessionCommandReceipt;
}

export interface SessionCommandTransactionResult<TState, TResult> {
  result: TResult;
  updatedSession?: SessionRecord<TState>;
  /** Persisted atomically with `updatedSession`; may also record a stable rejection. */
  receipt?: SessionCommandReceipt;
  /** Applied-command events persisted in the same transaction and sequence. */
  events?: ReadonlyArray<SessionEventRecord>;
  /** Protected schedule changes committed with the originating command. */
  scheduleMutations?: ReadonlyArray<SessionSystemScheduleMutation>;
}

export type SessionCommandTransaction<TState, TResult> = (
  context: SessionCommandTransactionContext<TState>
) => Promise<SessionCommandTransactionResult<TState, TResult>>;

export interface SessionSystemCommandTransactionResult<TState, TResult>
  extends SessionCommandTransactionResult<TState, TResult> {
  scheduleDisposition: SessionSystemScheduleDisposition;
}

export type SessionSystemCommandTransaction<TState, TResult> = (
  context: SessionSystemCommandTransactionContext<TState>
) => Promise<SessionSystemCommandTransactionResult<TState, TResult>>;

export interface DispatchActionResponse<TState = unknown> {
  sessionId: SessionId;
  version: SessionStateVersion;
  state: TState;
  actionAvailability: Array<SessionActionAvailability>;
  receipt: PublicSessionCommandReceipt;
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
 * equally minimal routes, while `usedStateVersion` identifies the snapshot on
 * which this non-authoritative calculation was made. The two hashes bind a UI
 * confirmation to the exact normalized endpoint selection and immutable Game
 * Intent definition without trusting a client-generated identity.
 */
export interface TransportRoadPreviewResponse {
  sessionId: SessionId;
  actionId: string;
  usedStateVersion: number;
  /** Canonical SHA-256 identity of the server-validated preview parameters. */
  paramsFingerprint: string;
  /** Immutable published action identity used to produce this preview. */
  definitionHash: string;
  networkId: string;
  fromNodeId: string;
  toNodeId: string;
  polyline: Array<TransportRoadPreviewPoint>;
  regionSequence: Array<string>;
  regionSegments: number;
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
   * Version captured with the restored state. Runtime uses it to validate the
   * editor trace request, but creates a new monotonic state version and keeps
   * the protected event-ledger sequence; callers cannot rewind audit history.
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
  createSession(input: CreateSessionInput<TState>): Promise<CreatedSession<TState>>;
  getSession(sessionId: SessionId): Promise<SessionRecord<TState> | null>;
  /** Authenticate a live session from a credential digest without exposing it. */
  authenticateSession(input: SessionAuthenticationInput): Promise<SessionPrincipal | null>;
  /** Resolve rules only by the immutable hash pinned into the session record. */
  getImmutableBundle(bundleHash: string): Promise<ImmutableGameBundle | null>;
  /** Read the immutable gameplay event ledger in canonical sequence order. */
  getSessionEvents(sessionId: SessionId, afterSequence?: number): Promise<Array<SessionEventRecord>>;
  /** Internal bounded scan used by the scheduler; never exposed as player API. */
  listPendingSystemSchedules(
    sessionId: SessionId,
    limit?: number
  ): Promise<Array<SessionSystemSchedule>>;
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
  /**
   * Execute one authenticated command and atomically store its state/receipt.
   * Receipt lookup happens under the session lock before version or actor
   * checks, which makes a lost successful HTTP response safe to retry.
   */
  withCommandTransaction<TResult>(
    input: SessionCommandTransactionInput,
    operation: SessionCommandTransaction<TState, TResult>
  ): Promise<TResult>;
  /**
   * Execute a scheduler delivery through a trusted internal-only boundary.
   * The command prefix is never treated as authentication.
   */
  withSystemCommandTransaction<TResult>(
    input: SessionSystemCommandTransactionInput,
    operation: SessionSystemCommandTransaction<TState, TResult>
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
  receipt: PublicSessionCommandReceipt;
}

/**
 * Bounded HTTP response shape for editor-preview session restore.
 * Production gameplay sessions must not expose this operation.
 */
export type RestorePreviewSessionSnapshot<TState = unknown> = RestorePreviewSessionResponse<TState>;
