/**
 * In-memory implementation of the authenticated, transactional session store.
 *
 * It mirrors the PostgreSQL adapter's immediate per-session lock, immutable
 * bundle registry and atomic state-plus-receipt commit so development and unit
 * tests do not silently use weaker trust or idempotency semantics.
 */

import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.ts";
import type {
  ArchivedSessionAudit,
  CreateSessionInput,
  CreatedSession,
  DebugCheckpointMetadata,
  StoredDebugCheckpointMetadata,
  DebugCheckpointRestoreInput,
  DebugCheckpointRestoreResult,
  ImmutableGameBundle,
  LockedSessionOperation,
  SessionAuthenticationInput,
  SessionCommandReceipt,
  SessionCommandTransaction,
  SessionCommandTransactionInput,
  SessionEventRecord,
  SessionPrincipal,
  SessionPublicJournalSource,
  SessionRecord,
  SessionStorePort,
  SessionSystemCommandTransaction,
  SessionSystemCommandTransactionInput,
  SessionSystemSchedule,
  SessionSystemScheduleMutation,
  UpdateSessionOptions
} from "@cubica/contracts-session";
import { isValidImmutableBundleInput } from "../content/immutableBundle.ts";
import { assertCommandTransactionResult } from "./commandTransactionValidation.ts";
import { createPublicGameplayJournalByteAccumulator } from "./publicGameplayJournal.ts";
import {
  createSystemCommandFingerprint,
  createSystemCommandId
} from "./commandIdentity.ts";
import {
  assertNextSessionVersion,
  assertProtectedEventSequenceUnchanged,
  DebugCheckpointLimitError,
  DebugSessionPausedError,
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";
import {
  assertDebugController,
  assertDebugPauseUnchanged,
  DEBUG_CHECKPOINT_LIMIT,
  makeProtectedDebugCheckpoint,
  type ProtectedDebugCheckpoint
} from "./debugSession.ts";
import {
  assertCreationPrincipalsMatchParticipants,
  assertSessionParticipantsImmutable,
  assertSessionParticipantsMatchState
} from "./sessionParticipants.ts";

interface StoredPrincipal {
  principal: SessionPrincipal;
  credentialSha256: string;
}

function toWireDebugCheckpointMetadata(metadata: StoredDebugCheckpointMetadata): DebugCheckpointMetadata {
  return {
    ...metadata,
    createdAt: metadata.createdAt.toISOString(),
    expiresAt: metadata.expiresAt.toISOString()
  };
}

export class InMemorySessionStore<TState = unknown> implements SessionStorePort<TState> {
  readonly mode = "in-memory";
  private readonly sessions = new Map<string, SessionRecord<TState>>();
  private readonly bundles = new Map<string, ImmutableGameBundle>();
  private readonly principalsBySessionId = new Map<string, Array<StoredPrincipal>>();
  private readonly receipts = new Map<string, SessionCommandReceipt>();
  private readonly eventsBySessionId = new Map<string, Array<SessionEventRecord>>();
  private readonly schedules = new Map<string, SessionSystemSchedule>();
  /** Lifecycle metadata is separate so archiving cannot rewrite a snapshot. */
  private readonly archivedAtBySessionId = new Map<string, Date>();
  private readonly lockedSessionIds = new Set<string>();
  private readonly lockWaiters = new Map<string, Set<() => void>>();
  private readonly debugCheckpoints = new Map<string, ProtectedDebugCheckpoint<TState>>();
  private readonly debugCheckpointIdsBySource = new Map<string, Set<string>>();
  private debugCheckpointSweep?: IterableIterator<[string, ProtectedDebugCheckpoint<TState>]>;

  async createSession(command: CreateSessionInput<TState>): Promise<CreatedSession<TState>> {
    assertBundleInput(command);
    assertSessionParticipantsMatchState(command.participants, command.initialState, { allowAgents: true });
    const additionalPrincipals = command.additionalPrincipals ?? [];
    const creationPrincipals = [command.principal, ...additionalPrincipals];
    assertCreationPrincipalsMatchParticipants(creationPrincipals, command.participants);
    const sessionId = randomUUID();
    const now = new Date();
    const existingBundle = this.bundles.get(command.immutableBundle.bundleHash);
    if (
      existingBundle !== undefined &&
      !byteArraysEqual(existingBundle.canonicalBytes, command.immutableBundle.canonicalBytes)
    ) {
      throw new SessionStoreUnavailableError();
    }

    const bundle: ImmutableGameBundle = existingBundle ?? {
      ...structuredClone(command.immutableBundle),
      createdAt: now
    };
    const snapshot: SessionRecord<TState> = {
      sessionId,
      gameId: command.gameId,
      bundleHash: command.immutableBundle.bundleHash,
      ...(command.contentSourceId === undefined ? {} : { contentSourceId: command.contentSourceId }),
      ...(command.debugPaused === undefined ? {} : { debugPaused: command.debugPaused }),
      participants: structuredClone(command.participants),
      state: structuredClone(command.initialState),
      ...(command.sessionRole === undefined ? {} : { sessionRole: command.sessionRole }),
      version: {
        sessionId,
        stateVersion: 0,
        lastEventSequence: 0
      },
      createdAt: now,
      updatedAt: now
    };
    const storedPrincipals = creationPrincipals.map((input) => ({
      principal: {
        principalId: input.principalId,
        sessionId,
        kind: input.kind,
        role: input.role,
        actorScope: structuredClone(input.actorScope),
        createdAt: now
      } satisfies SessionPrincipal,
      credentialSha256: input.credentialSha256
    }));

    // All writes happen only after every invariant has been checked, which is
    // the in-memory equivalent of committing one database transaction.
    this.bundles.set(bundle.bundleHash, bundle);
    this.sessions.set(sessionId, snapshot);
    this.principalsBySessionId.set(sessionId, storedPrincipals);
    return { session: clone(snapshot), principal: clone(storedPrincipals[0].principal) };
  }

  async getSession(sessionId: string): Promise<SessionRecord<TState> | null> {
    if (this.archivedAtBySessionId.has(sessionId)) return null;
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : clone(session);
  }

  async readDebugControl(input: SessionAuthenticationInput): Promise<SessionRecord<TState>> {
    return this.withSessionLock(input.sessionId, async () => clone(this.requireDebugController(input)));
  }

  async setDebugPaused(
    input: SessionAuthenticationInput & { expectedStateVersion: number; paused: boolean }
  ): Promise<SessionRecord<TState>> {
    return this.withWaitingSessionLock(input.sessionId, async () => {
      const current = this.requireDebugController(input);
      if (current.debugPaused === input.paused) return clone(current);
      if (current.version.stateVersion !== input.expectedStateVersion) {
        throw new SessionVersionConflictError(input.sessionId, input.expectedStateVersion);
      }
      const next: SessionRecord<TState> = {
        ...current, debugPaused: input.paused,
        version: { ...current.version, stateVersion: current.version.stateVersion + 1 },
        updatedAt: new Date()
      };
      this.sessions.set(input.sessionId, clone(next));
      return clone(next);
    });
  }

  async saveDebugCheckpoint(
    input: SessionAuthenticationInput & { label: string }
  ): Promise<DebugCheckpointMetadata> {
    return this.withSessionLock(input.sessionId, async () => {
      const current = this.requireDebugController(input);
      this.removeExpiredDebugCheckpoints(new Date());
      if (!current.debugPaused) throw new HttpError(409, "Pause the preview before saving a checkpoint.");
      const now = new Date();
      this.removeExpiredSourceCheckpoints(input.sessionId, now);
      if ((this.debugCheckpointIdsBySource.get(input.sessionId)?.size ?? 0) >= DEBUG_CHECKPOINT_LIMIT) {
        throw new DebugCheckpointLimitError();
      }
      const schedules = [...this.schedules.values()].filter((schedule) => schedule.sessionId === input.sessionId);
      const checkpoint = makeProtectedDebugCheckpoint(current, schedules, input.label, randomUUID(), now);
      this.debugCheckpoints.set(checkpoint.metadata.checkpointId, checkpoint);
      const ids = this.debugCheckpointIdsBySource.get(input.sessionId) ?? new Set<string>();
      ids.add(checkpoint.metadata.checkpointId);
      this.debugCheckpointIdsBySource.set(input.sessionId, ids);
      return toWireDebugCheckpointMetadata(checkpoint.metadata);
    });
  }

  async listDebugCheckpoints(input: SessionAuthenticationInput): Promise<Array<DebugCheckpointMetadata>> {
    return this.withSessionLock(input.sessionId, async () => {
      this.requireDebugController(input);
      const now = new Date();
      this.removeExpiredDebugCheckpoints(now);
      this.removeExpiredSourceCheckpoints(input.sessionId, now);
      return [...(this.debugCheckpointIdsBySource.get(input.sessionId) ?? [])]
        .map((id) => this.debugCheckpoints.get(id)!)
        .sort((left, right) => right.metadata.createdAt.getTime() - left.metadata.createdAt.getTime())
        .map((entry) => toWireDebugCheckpointMetadata(entry.metadata));
    });
  }

  async deleteDebugCheckpoint(input: SessionAuthenticationInput & { checkpointId: string }): Promise<void> {
    await this.withSessionLock(input.sessionId, async () => {
      this.requireDebugController(input);
      this.removeExpiredDebugCheckpoints(new Date());
      const checkpoint = this.debugCheckpoints.get(input.checkpointId);
      if (checkpoint?.sourceSessionId === input.sessionId) this.deleteStoredCheckpoint(input.checkpointId, checkpoint);
    });
  }

  async restoreDebugCheckpoint(input: DebugCheckpointRestoreInput): Promise<DebugCheckpointRestoreResult<TState>> {
    return this.withSessionLock(input.sessionId, async () => {
      this.requireDebugController(input);
      this.removeExpiredDebugCheckpoints(new Date());
      const checkpoint = this.debugCheckpoints.get(input.checkpointId);
      if (checkpoint?.sourceSessionId !== input.sessionId || checkpoint.metadata.expiresAt <= new Date()) {
        throw new HttpError(404, "Debug checkpoint was not found.");
      }
      const bundle = this.bundles.get(checkpoint.bundleHash);
      if (bundle === undefined) throw new SessionStoreUnavailableError();
      const sourcePrincipal = this.findStoredPrincipal(input)?.principal;
      if (input.principal.kind !== "local-controller" || input.principal.role !== sourcePrincipal?.role) {
        throw new SessionStoreUnavailableError();
      }
      const created = await this.createSession({
        gameId: checkpoint.gameId,
        contentSourceId: checkpoint.contentSourceId,
        debugPaused: true,
        participants: checkpoint.participants,
        initialState: checkpoint.state,
        ...(checkpoint.sessionRole === undefined ? {} : { sessionRole: checkpoint.sessionRole }),
        immutableBundle: bundle,
        principal: input.principal
      });
      for (const schedule of checkpoint.schedules) {
        const rebound = { ...clone(schedule), sessionId: created.session.sessionId };
        this.schedules.set(systemScheduleKey(rebound.sessionId, rebound.scheduleId), rebound);
      }
      return { ...created, checkpoint: toWireDebugCheckpointMetadata(checkpoint.metadata) };
    });
  }

  async authenticateSession(input: SessionAuthenticationInput): Promise<SessionPrincipal | null> {
    if (this.archivedAtBySessionId.has(input.sessionId)) return null;
    const match = this.principalsBySessionId.get(input.sessionId)?.find(
      (candidate) => candidate.credentialSha256 === input.credentialSha256
    );
    return match === undefined ? null : clone(match.principal);
  }

  async getCommandReceipt(input: SessionCommandTransactionInput): Promise<SessionCommandReceipt | null> {
    if (this.archivedAtBySessionId.has(input.sessionId)) return null;
    const storedPrincipal = this.findStoredPrincipal(input);
    if (storedPrincipal === undefined) return null;
    const receipt = this.receipts.get(commandReceiptKey(
      input.sessionId,
      storedPrincipal.principal.principalId,
      input.commandId
    ));
    return receipt === undefined ? null : clone(receipt);
  }

  async archiveSession(
    input: SessionAuthenticationInput
  ): Promise<ArchivedSessionAudit<TState> | null> {
    return this.withSessionLock(input.sessionId, async () => {
      const session = this.sessions.get(input.sessionId);
      const storedPrincipal = this.findStoredPrincipal(input);
      const bundle = session === undefined ? undefined : this.bundles.get(session.bundleHash);
      if (
        session === undefined ||
        storedPrincipal?.principal.role !== "facilitator" ||
        bundle === undefined
      ) {
        return null;
      }

      // The timestamp is the only lifecycle write. Repeated authorized archive
      // requests preserve the first boundary instead of manufacturing a new one.
      if (!this.archivedAtBySessionId.has(input.sessionId)) {
        this.archivedAtBySessionId.set(input.sessionId, new Date());
      }
      return this.buildArchivedAudit(session, storedPrincipal.principal, bundle);
    });
  }

  async readArchivedSession(
    input: SessionAuthenticationInput
  ): Promise<ArchivedSessionAudit<TState> | null> {
    const session = this.sessions.get(input.sessionId);
    const storedPrincipal = this.findStoredPrincipal(input);
    const bundle = session === undefined ? undefined : this.bundles.get(session.bundleHash);
    if (
      session === undefined ||
      storedPrincipal?.principal.role !== "facilitator" ||
      bundle === undefined ||
      !this.archivedAtBySessionId.has(input.sessionId)
    ) {
      return null;
    }
    return this.buildArchivedAudit(session, storedPrincipal.principal, bundle);
  }

  async readPublicJournalSource(
    input: SessionAuthenticationInput,
    limit: number
  ): Promise<SessionPublicJournalSource<TState> | null> {
    assertPublicJournalLimit(limit);
    return this.withSessionLock(input.sessionId, async () => {
      const session = this.sessions.get(input.sessionId);
      const principal = this.findStoredPrincipal(input);
      if (session === undefined || principal === undefined) return null;
      const archivedAt = this.archivedAtBySessionId.get(input.sessionId);
      if (archivedAt !== undefined && principal.principal.role !== "facilitator") return null;
      const events: SessionEventRecord[] = [];
      const accumulator = createPublicGameplayJournalByteAccumulator({
        session,
        lifecycle: archivedAt === undefined ? "active" : "archived",
        ...(archivedAt === undefined ? {} : { archivedAt }),
        maxEntries: limit
      });
      for (const event of this.eventsBySessionId.get(input.sessionId) ?? []) {
        if (event.audience !== "public" || event.sequence > session.version.lastEventSequence) continue;
        accumulator.addEvent(event);
        events.push(event);
        if (events.length === limit) break;
      }
      return {
        session: clone(session),
        lifecycle: archivedAt === undefined ? "active" : "archived",
        ...(archivedAt === undefined ? {} : { archivedAt: new Date(archivedAt) }),
        events: clone(events)
      };
    });
  }

  async getImmutableBundle(bundleHash: string): Promise<ImmutableGameBundle | null> {
    const bundle = this.bundles.get(bundleHash);
    return bundle === undefined ? null : clone(bundle);
  }

  async getSessionEvents(sessionId: string, afterSequence = 0): Promise<Array<SessionEventRecord>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new SessionStoreUnavailableError();
    if (this.archivedAtBySessionId.has(sessionId)) return [];
    return clone((this.eventsBySessionId.get(sessionId) ?? []).filter((event) => event.sequence > afterSequence));
  }

  async listPendingSystemSchedules(sessionId: string, limit = 64): Promise<Array<SessionSystemSchedule>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new SessionStoreUnavailableError();
    }
    if (this.archivedAtBySessionId.has(sessionId)) return [];
    if (this.sessions.get(sessionId)?.debugPaused) return [];
    return clone([...this.schedules.values()]
      .filter((schedule) => schedule.sessionId === sessionId && schedule.status === "pending")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() ||
        (left.scheduleId < right.scheduleId ? -1 : left.scheduleId > right.scheduleId ? 1 : 0))
      .slice(0, limit));
  }

  async updateSession(
    session: SessionRecord<TState>,
    options: UpdateSessionOptions
  ): Promise<SessionRecord<TState>> {
    if (this.lockedSessionIds.has(session.sessionId)) {
      throw new SessionWriteLockedError(session.sessionId);
    }
    const current = this.sessions.get(session.sessionId);
    if (
      !current ||
      this.archivedAtBySessionId.has(session.sessionId) ||
      current.version.stateVersion !== options.expectedStateVersion
    ) {
      throw new SessionVersionConflictError(session.sessionId, options.expectedStateVersion);
    }
    if (current.debugPaused) throw new DebugSessionPausedError();
    assertDebugPauseUnchanged(current, session);
    assertNextSessionVersion(session.sessionId, current, session);
    assertProtectedEventSequenceUnchanged(current, session);
    assertSessionParticipantsImmutable(current, session);
    this.sessions.set(session.sessionId, clone(session));
    return clone(session);
  }

  async withLockedSession<TResult>(
    sessionId: string,
    operation: LockedSessionOperation<TState, TResult>
  ): Promise<TResult> {
    return this.withSessionLock(sessionId, async () => {
      const current = this.archivedAtBySessionId.has(sessionId)
        ? undefined
        : this.sessions.get(sessionId);
      const operationResult = await operation(current === undefined ? null : clone(current));

      if (operationResult.updatedSession !== undefined) {
        if (current === undefined) {
          throw new SessionVersionConflictError(sessionId, 0);
        }
        if (current.debugPaused) throw new DebugSessionPausedError();
        assertDebugPauseUnchanged(current, operationResult.updatedSession);
        assertNextSessionVersion(sessionId, current, operationResult.updatedSession);
        assertProtectedEventSequenceUnchanged(current, operationResult.updatedSession);
        assertSessionParticipantsImmutable(current, operationResult.updatedSession);
        this.sessions.set(sessionId, clone(operationResult.updatedSession));
      }

      return operationResult.result;
    });
  }

  async withCommandTransaction<TResult>(
    input: SessionCommandTransactionInput,
    operation: SessionCommandTransaction<TState, TResult>
  ): Promise<TResult> {
    return this.withSessionLock(input.sessionId, async () => {
      const current = this.sessions.get(input.sessionId);
      const storedPrincipal = this.principalsBySessionId.get(input.sessionId)?.find(
        (candidate) => candidate.credentialSha256 === input.credentialSha256
      );
      if (
        current === undefined ||
        storedPrincipal === undefined ||
        this.archivedAtBySessionId.has(input.sessionId)
      ) {
        throw new SessionAuthenticationError();
      }
      const bundle = this.bundles.get(current.bundleHash);
      if (bundle === undefined) {
        throw new SessionStoreUnavailableError();
      }

      const receiptKey = commandReceiptKey(
        input.sessionId,
        storedPrincipal.principal.principalId,
        input.commandId
      );
      const existingReceipt = this.receipts.get(receiptKey);
      if (current.debugPaused && existingReceipt === undefined) throw new DebugSessionPausedError();
      const operationResult = await operation({
        currentSession: clone(current),
        principal: clone(storedPrincipal.principal),
        bundle: clone(bundle),
        ...(existingReceipt === undefined ? {} : { existingReceipt: clone(existingReceipt) }),
        getCommandReceipt: async (commandId) => {
          const receipt = this.receipts.get(commandReceiptKey(
            input.sessionId,
            storedPrincipal.principal.principalId,
            commandId
          ));
          return receipt === undefined ? null : clone(receipt);
        }
      });
      if (current.debugPaused && (operationResult.updatedSession !== undefined || operationResult.receipt !== undefined || (operationResult.events?.length ?? 0) > 0 || (operationResult.scheduleMutations?.length ?? 0) > 0)) {
        throw new DebugSessionPausedError();
      }

      assertCommandTransactionResult({
        input,
        current,
        principal: storedPrincipal.principal,
        existingReceipt,
        updatedSession: operationResult.updatedSession,
        receipt: operationResult.receipt,
        events: operationResult.events
      });
      if (operationResult.updatedSession !== undefined) {
        assertDebugPauseUnchanged(current, operationResult.updatedSession);
        assertSessionParticipantsImmutable(current, operationResult.updatedSession);
      }
      if ((operationResult.scheduleMutations?.length ?? 0) > 0 && (
        operationResult.receipt?.status !== "applied" || operationResult.updatedSession === undefined
      )) {
        throw new SessionStoreUnavailableError();
      }
      const scheduleChanges = planScheduleMutations(
        this.schedules,
        current,
        operationResult.scheduleMutations ?? []
      );

      // Commit both maps only after the callback and all validation complete.
      if (operationResult.updatedSession !== undefined) {
        this.sessions.set(input.sessionId, clone(operationResult.updatedSession));
      }
      if (operationResult.receipt !== undefined) {
        this.receipts.set(receiptKey, clone(operationResult.receipt));
      }
      if (operationResult.events !== undefined && operationResult.events.length > 0) {
        this.eventsBySessionId.set(input.sessionId, [
          ...(this.eventsBySessionId.get(input.sessionId) ?? []),
          ...clone(operationResult.events)
        ]);
      }
      for (const [key, schedule] of scheduleChanges) this.schedules.set(key, schedule);
      return operationResult.result;
    });
  }

  async withSystemCommandTransaction<TResult>(
    input: SessionSystemCommandTransactionInput,
    operation: SessionSystemCommandTransaction<TState, TResult>
  ): Promise<TResult> {
    return this.withSessionLock(input.sessionId, async () => {
      if (!isExactSystemCommandId(input)) {
        throw new SessionAuthenticationError();
      }
      const current = this.sessions.get(input.sessionId);
      const scheduleKey = systemScheduleKey(input.sessionId, input.scheduleId);
      const schedule = this.schedules.get(scheduleKey);
      const bundle = current === undefined ? undefined : this.bundles.get(current.bundleHash);
      if (!current || this.archivedAtBySessionId.has(input.sessionId) ||
          !schedule || !bundle || schedule.sessionId !== current.sessionId ||
          schedule.bundleHash !== current.bundleHash) {
        throw new SessionAuthenticationError();
      }
      const principal = systemSchedulerPrincipal(current.sessionId, schedule.createdAt);
      const receiptKey = commandReceiptKey(input.sessionId, principal.principalId, input.commandId);
      const existingReceipt = this.receipts.get(receiptKey);
      if (current.debugPaused && existingReceipt === undefined) throw new DebugSessionPausedError();
      if (existingReceipt !== undefined) {
        assertSystemReceiptPins(input, schedule, existingReceipt);
      }
      if (existingReceipt === undefined && (
        schedule.status !== "pending" || schedule.nextOccurrence !== input.occurrence
      )) {
        throw new SessionAuthenticationError();
      }

      const operationResult = await operation({
        currentSession: clone(current),
        principal: clone(principal),
        bundle: clone(bundle),
        schedule: clone(schedule),
        ...(existingReceipt === undefined ? {} : { existingReceipt: clone(existingReceipt) }),
        getCommandReceipt: async (commandId) => {
          const receipt = this.receipts.get(commandReceiptKey(
            input.sessionId,
            principal.principalId,
            commandId
          ));
          return receipt === undefined ? null : clone(receipt);
        }
      });
      if (current.debugPaused && (operationResult.updatedSession !== undefined || operationResult.receipt !== undefined || (operationResult.events?.length ?? 0) > 0)) {
        throw new DebugSessionPausedError();
      }
      assertSystemDisposition(existingReceipt, operationResult);
      assertCommandTransactionResult({
        input: { sessionId: input.sessionId, commandId: input.commandId, credentialSha256: "" },
        current,
        principal,
        existingReceipt,
        updatedSession: operationResult.updatedSession,
        receipt: operationResult.receipt,
        events: operationResult.events
      });
      if (operationResult.updatedSession !== undefined) {
        assertDebugPauseUnchanged(current, operationResult.updatedSession);
        assertSessionParticipantsImmutable(current, operationResult.updatedSession);
      }
      if (operationResult.receipt !== undefined) {
        assertSystemReceiptPins(input, schedule, operationResult.receipt);
      }

      if (operationResult.updatedSession !== undefined) {
        this.sessions.set(input.sessionId, clone(operationResult.updatedSession));
      }
      if (operationResult.receipt !== undefined) {
        this.receipts.set(receiptKey, clone(operationResult.receipt));
      }
      if (operationResult.events !== undefined && operationResult.events.length > 0) {
        this.eventsBySessionId.set(input.sessionId, [
          ...(this.eventsBySessionId.get(input.sessionId) ?? []),
          ...clone(operationResult.events)
        ]);
      }
      if (existingReceipt === undefined && operationResult.scheduleDisposition !== "defer") {
        this.schedules.set(scheduleKey, consumeScheduleOccurrence(schedule));
      }
      return operationResult.result;
    });
  }

  async checkReadiness(): Promise<void> {
    // No external dependency exists in the explicit dev/test adapter.
  }

  async close(): Promise<void> {
    // The adapter owns no connections or timers.
  }

  private async withSessionLock<TResult>(sessionId: string, operation: () => Promise<TResult>): Promise<TResult> {
    if (this.lockedSessionIds.has(sessionId)) {
      throw new SessionWriteLockedError(sessionId);
    }
    this.lockedSessionIds.add(sessionId);
    try {
      return await operation();
    } finally {
      this.lockedSessionIds.delete(sessionId);
      for (const wake of this.lockWaiters.get(sessionId) ?? []) wake();
      this.lockWaiters.delete(sessionId);
    }
  }

  private async withWaitingSessionLock<TResult>(sessionId: string, operation: () => Promise<TResult>): Promise<TResult> {
    while (this.lockedSessionIds.has(sessionId)) {
      await new Promise<void>((resolve) => {
        const waiters = this.lockWaiters.get(sessionId) ?? new Set<() => void>();
        waiters.add(resolve);
        this.lockWaiters.set(sessionId, waiters);
      });
    }
    return this.withSessionLock(sessionId, operation);
  }

  private requireDebugController(input: SessionAuthenticationInput): SessionRecord<TState> {
    const current = this.archivedAtBySessionId.has(input.sessionId) ? undefined : this.sessions.get(input.sessionId);
    const principal = this.findStoredPrincipal(input)?.principal;
    if (current === undefined || principal === undefined) throw new SessionAuthenticationError();
    assertDebugController(current, principal);
    return current;
  }

  private removeExpiredDebugCheckpoints(now: Date): void {
    this.debugCheckpointSweep ??= this.debugCheckpoints.entries();
    for (let inspected = 0; inspected < 100; inspected += 1) {
      const next = this.debugCheckpointSweep.next();
      if (next.done) {
        this.debugCheckpointSweep = undefined;
        break;
      }
      const [id, checkpoint] = next.value;
      if (checkpoint.metadata.expiresAt <= now) this.deleteStoredCheckpoint(id, checkpoint);
    }
  }

  private removeExpiredSourceCheckpoints(sessionId: string, now: Date): void {
    for (const id of this.debugCheckpointIdsBySource.get(sessionId) ?? []) {
      const checkpoint = this.debugCheckpoints.get(id);
      if (checkpoint && checkpoint.metadata.expiresAt <= now) this.deleteStoredCheckpoint(id, checkpoint);
    }
  }

  private deleteStoredCheckpoint(id: string, checkpoint: ProtectedDebugCheckpoint<TState>): void {
    this.debugCheckpoints.delete(id);
    const ids = this.debugCheckpointIdsBySource.get(checkpoint.sourceSessionId);
    ids?.delete(id);
    if (ids?.size === 0) this.debugCheckpointIdsBySource.delete(checkpoint.sourceSessionId);
  }

  private findStoredPrincipal(input: SessionAuthenticationInput): StoredPrincipal | undefined {
    return this.principalsBySessionId.get(input.sessionId)?.find(
      (candidate) => candidate.credentialSha256 === input.credentialSha256
    );
  }

  private buildArchivedAudit(
    session: SessionRecord<TState>,
    principal: SessionPrincipal,
    bundle: ImmutableGameBundle
  ): ArchivedSessionAudit<TState> {
    const archivedAt = this.archivedAtBySessionId.get(session.sessionId);
    if (archivedAt === undefined) throw new SessionStoreUnavailableError();

    const receipts = [...this.receipts.values()]
      .filter((receipt) => receipt.sessionId === session.sessionId)
      .sort((left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.receiptId.localeCompare(right.receiptId));
    const events = [...(this.eventsBySessionId.get(session.sessionId) ?? [])]
      .sort((left, right) => left.sequence - right.sequence);
    return clone({ session, archivedAt, principal, bundle, events, receipts });
  }
}

function assertBundleInput<TState>(command: CreateSessionInput<TState>): void {
  if (
    (command.debugPaused === true && command.contentSourceId === undefined) ||
    command.immutableBundle.gameId !== command.gameId ||
    !isValidImmutableBundleInput(command.immutableBundle) ||
    !/^[a-f0-9]{64}$/u.test(command.principal.credentialSha256)
  ) {
    throw new SessionStoreUnavailableError();
  }
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function assertPublicJournalLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new SessionStoreUnavailableError();
  }
}

function commandReceiptKey(sessionId: string, principalId: string, commandId: string): string {
  return JSON.stringify([sessionId, principalId, commandId]);
}

function systemScheduleKey(sessionId: string, scheduleId: string): string {
  return JSON.stringify([sessionId, scheduleId]);
}

function systemSchedulerPrincipal(sessionId: string, createdAt: Date): SessionPrincipal {
  return {
    principalId: `system-scheduler:${sessionId}`,
    sessionId,
    kind: "system",
    role: "assistant",
    actorScope: { kind: "all-session-actors" },
    createdAt
  };
}

function isExactSystemCommandId(input: SessionSystemCommandTransactionInput): boolean {
  try {
    return input.commandId === createSystemCommandId(input.sessionId, input.scheduleId, input.occurrence);
  } catch {
    return false;
  }
}

function planScheduleMutations<TState>(
  currentSchedules: ReadonlyMap<string, SessionSystemSchedule>,
  current: SessionRecord<TState>,
  mutations: ReadonlyArray<SessionSystemScheduleMutation>
): Map<string, SessionSystemSchedule> {
  const planned = new Map<string, SessionSystemSchedule>();
  for (const mutation of mutations) {
    if (mutation.kind === "register") {
      const schedule = mutation.schedule;
      const key = systemScheduleKey(current.sessionId, schedule.scheduleId);
      if (currentSchedules.has(key) || planned.has(key) || schedule.sessionId !== current.sessionId ||
          schedule.bundleHash !== current.bundleHash || schedule.status !== "pending" ||
          schedule.nextOccurrence !== 1 || !Number.isSafeInteger(schedule.maxOccurrences) ||
          schedule.maxOccurrences < 1 || schedule.maxOccurrences > 64 ||
          !/^[A-Za-z0-9_-]{22,128}$/u.test(schedule.scheduleId) ||
          !/^sha256:[a-f0-9]{64}$/u.test(schedule.definitionHash) ||
          typeof schedule.actionId !== "string" || schedule.actionId.length === 0 ||
          !isRecord(schedule.params) ||
          Object.keys(schedule.params).length > 16 ||
          Object.values(schedule.params).some((value) =>
            typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" ||
            typeof value === "number" && !Number.isFinite(value)) ||
          !isRecord(schedule.trigger) ||
          !["defer", "skip"].includes(schedule.falsePolicy) ||
          !(schedule.createdAt instanceof Date) || !(schedule.updatedAt instanceof Date) ||
          Number.isNaN(schedule.createdAt.getTime()) || Number.isNaN(schedule.updatedAt.getTime())) {
        throw new SessionStoreUnavailableError();
      }
      planned.set(key, clone(schedule));
      continue;
    }
    const key = systemScheduleKey(current.sessionId, mutation.scheduleId);
    const schedule = planned.get(key) ?? currentSchedules.get(key);
    if (!schedule || schedule.status !== "pending") throw new SessionStoreUnavailableError();
    planned.set(key, { ...clone(schedule), status: "cancelled", updatedAt: new Date() });
  }
  return planned;
}

function assertSystemDisposition(
  existingReceipt: SessionCommandReceipt | undefined,
  result: {
    scheduleDisposition: "apply" | "skip" | "defer";
    updatedSession?: unknown;
    receipt?: SessionCommandReceipt;
    events?: ReadonlyArray<SessionEventRecord>;
    scheduleMutations?: ReadonlyArray<SessionSystemScheduleMutation>;
  }
): void {
  if (existingReceipt !== undefined) {
    if (result.updatedSession || result.receipt || result.events?.length || result.scheduleMutations?.length) {
      throw new SessionStoreUnavailableError();
    }
    return;
  }
  if (result.scheduleMutations?.length) throw new SessionStoreUnavailableError();
  if (result.scheduleDisposition === "defer") {
    if (result.updatedSession || result.receipt || result.events?.length || result.scheduleMutations?.length) {
      throw new SessionStoreUnavailableError();
    }
  } else if (result.scheduleDisposition === "apply") {
    if (result.receipt?.status !== "applied" || result.updatedSession === undefined) {
      throw new SessionStoreUnavailableError();
    }
  } else if (result.scheduleDisposition === "skip") {
    if (result.receipt?.status !== "rejected" || result.updatedSession !== undefined ||
        result.events?.length || result.scheduleMutations?.length) {
      throw new SessionStoreUnavailableError();
    }
  } else {
    throw new SessionStoreUnavailableError();
  }
}

function assertSystemReceiptPins(
  input: SessionSystemCommandTransactionInput,
  schedule: SessionSystemSchedule,
  receipt: SessionCommandReceipt
): void {
  const expectedFingerprint = createSystemCommandFingerprint({
    sessionId: input.sessionId,
    scheduleId: input.scheduleId,
    occurrence: input.occurrence,
    actionId: schedule.actionId,
    params: schedule.params,
    bundleHash: schedule.bundleHash,
    definitionHash: schedule.definitionHash
  });
  if (
    receipt.principalId !== `system-scheduler:${input.sessionId}` ||
    receipt.actionId !== schedule.actionId ||
    receipt.bundleHash !== schedule.bundleHash ||
    receipt.definitionHash !== schedule.definitionHash ||
    receipt.fingerprint !== expectedFingerprint
  ) {
    throw new SessionStoreUnavailableError();
  }
}

function consumeScheduleOccurrence(schedule: SessionSystemSchedule): SessionSystemSchedule {
  const nextOccurrence = schedule.nextOccurrence + 1;
  return {
    ...clone(schedule),
    nextOccurrence,
    status: nextOccurrence > schedule.maxOccurrences ? "completed" : "pending",
    updatedAt: new Date()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
