/**
 * In-memory implementation of the authenticated, transactional session store.
 *
 * It mirrors the PostgreSQL adapter's immediate per-session lock, immutable
 * bundle registry and atomic state-plus-receipt commit so development and unit
 * tests do not silently use weaker trust or idempotency semantics.
 */

import { randomUUID } from "node:crypto";
import type {
  ArchivedSessionAudit,
  CreateSessionInput,
  CreatedSession,
  ImmutableGameBundle,
  LockedSessionOperation,
  PrivateInviteClaimStoreInput,
  PrivateInviteClaimStoreResult,
  PrivateSeatRecoveryInviteStoreInput,
  PrivateSeatRecoveryInviteStoreResult,
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
import type {
  BeginFacilitatorDebriefAttemptInput,
  BeginFacilitatorDebriefAttemptResult,
  CompleteFacilitatorDebriefAttemptInput,
  FacilitatorDebriefGenerationSource,
  FacilitatorDebriefStatusSource,
  FacilitatorDebriefStorePort,
  StoredFacilitatorDebriefAttempt
} from "../ai/facilitatorDebriefStore.ts";
import { assertCommandTransactionResult } from "./commandTransactionValidation.ts";
import { createPublicGameplayJournalByteAccumulator } from "./publicGameplayJournal.ts";
import {
  createSystemCommandFingerprint,
  createSystemCommandId
} from "./commandIdentity.ts";
import {
  assertNextSessionVersion,
  assertProtectedEventSequenceUnchanged,
  PrivateSeatRecoveryUnavailableError,
  SessionAuthenticationError,
  SessionAuthorizationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";
import {
  applyPrivateInviteClaim,
  assertCreationPrincipalsMatchParticipants,
  assertSessionParticipantsImmutable,
  assertSessionParticipantsMatchState,
  isPrivateSessionHostPrincipal,
  resolvePrivateSeatRecoveryTarget
} from "./sessionParticipants.ts";

interface StoredPrincipal {
  principal: SessionPrincipal;
  credentialSha256: string;
  credentialExpiresAt?: Date;
  recoveryTokenSha256?: string;
  recoveryTokenExpiresAt?: Date;
}

export class InMemorySessionStore<TState = unknown>
  implements SessionStorePort<TState>, FacilitatorDebriefStorePort<TState> {
  readonly mode = "in-memory";
  private readonly sessions = new Map<string, SessionRecord<TState>>();
  private readonly bundles = new Map<string, ImmutableGameBundle>();
  private readonly principalsBySessionId = new Map<string, Array<StoredPrincipal>>();
  private readonly receipts = new Map<string, SessionCommandReceipt>();
  private readonly eventsBySessionId = new Map<string, Array<SessionEventRecord>>();
  private readonly schedules = new Map<string, SessionSystemSchedule>();
  private readonly facilitatorDebriefAttemptsBySessionId = new Map<
    string,
    Array<StoredFacilitatorDebriefAttempt>
  >();
  /** Lifecycle metadata is separate so archiving cannot rewrite a snapshot. */
  private readonly archivedAtBySessionId = new Map<string, Date>();
  private readonly lockedSessionIds = new Set<string>();

  async createSession(command: CreateSessionInput<TState>): Promise<CreatedSession<TState>> {
    assertBundleInput(command);
    assertSessionParticipantsMatchState(command.participants, command.initialState, { allowAgents: true });
    const principalInputs = [command.principal, ...(command.additionalPrincipals ?? [])];
    assertCreationPrincipalsMatchParticipants(principalInputs, command.participants);
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
    const storedPrincipals = principalInputs.map((principalInput): StoredPrincipal => ({
      principal: {
        principalId: principalInput.principalId,
        sessionId,
        kind: principalInput.kind,
        role: principalInput.role,
        actorScope: structuredClone(principalInput.actorScope),
        createdAt: now
      },
      credentialSha256: principalInput.credentialSha256,
      ...(principalInput.credentialExpiresAt === undefined
        ? {}
        : { credentialExpiresAt: new Date(principalInput.credentialExpiresAt) })
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

  async authenticateSession(input: SessionAuthenticationInput): Promise<SessionPrincipal | null> {
    if (this.archivedAtBySessionId.has(input.sessionId)) return null;
    const match = this.principalsBySessionId.get(input.sessionId)?.find(
      (candidate) => candidate.credentialExpiresAt === undefined &&
        candidate.credentialSha256 === input.credentialSha256
    );
    return match === undefined ? null : clone(match.principal);
  }

  async issuePrivateSeatRecoveryInvite(
    input: PrivateSeatRecoveryInviteStoreInput
  ): Promise<PrivateSeatRecoveryInviteStoreResult | null> {
    return this.withSessionLock(input.sessionId, async () => {
      if (this.archivedAtBySessionId.has(input.sessionId)) return null;
      const session = this.sessions.get(input.sessionId);
      const issuer = this.findStoredPrincipal(input);
      if (session === undefined || issuer === undefined) return null;
      if (!isPrivateSessionHostPrincipal(session, issuer.principal)) {
        throw new SessionAuthorizationError();
      }
      const target = resolvePrivateSeatRecoveryTarget(session, input.seatId);
      const targetPrincipals = target === undefined ? [] : (this.principalsBySessionId.get(input.sessionId) ?? [])
        .filter((candidate) =>
          candidate.principal.kind === "participant" &&
          candidate.principal.role === "player" &&
          candidate.principal.actorScope.kind === "listed-actors" &&
          candidate.principal.actorScope.actorIds.length === 1 &&
          candidate.principal.actorScope.actorIds[0] === target.playerId &&
          candidate.credentialExpiresAt === undefined
        );
      if (target === undefined || targetPrincipals.length !== 1) {
        throw new PrivateSeatRecoveryUnavailableError();
      }
      if (
        !/^[a-f0-9]{64}$/u.test(input.recoveryTokenSha256) ||
        !Number.isFinite(input.issuedAt.valueOf()) ||
        !Number.isFinite(input.recoveryTokenExpiresAt.valueOf()) ||
        input.recoveryTokenExpiresAt.getTime() <= input.issuedAt.getTime() ||
        (this.principalsBySessionId.get(input.sessionId) ?? []).some((candidate) =>
          candidate.credentialSha256 === input.recoveryTokenSha256 ||
          candidate.recoveryTokenSha256 === input.recoveryTokenSha256
        )
      ) {
        throw new SessionStoreUnavailableError();
      }
      const targetPrincipal = targetPrincipals[0];
      targetPrincipal.recoveryTokenSha256 = input.recoveryTokenSha256;
      targetPrincipal.recoveryTokenExpiresAt = new Date(input.recoveryTokenExpiresAt);
      return {
        seatId: target.seatId,
        playerId: target.playerId,
        recoveryTokenExpiresAt: new Date(input.recoveryTokenExpiresAt)
      };
    });
  }

  async claimPrivateInvite(
    input: PrivateInviteClaimStoreInput
  ): Promise<PrivateInviteClaimStoreResult<TState> | null> {
    return this.withSessionLock(input.sessionId, async () => {
      if (
        input.currentCredentialSha256 !== undefined &&
        !/^[a-f0-9]{64}$/u.test(input.currentCredentialSha256)
      ) {
        throw new SessionStoreUnavailableError();
      }
      if (this.archivedAtBySessionId.has(input.sessionId)) return null;
      const session = this.sessions.get(input.sessionId);
      const principals = this.principalsBySessionId.get(input.sessionId) ?? [];
      const currentPrincipal = input.currentCredentialSha256 === undefined
        ? undefined
        : principals.find((candidate) =>
            candidate.credentialSha256 === input.currentCredentialSha256 &&
            candidate.credentialExpiresAt === undefined
          );
      const initialPrincipal = principals.find((candidate) =>
        candidate.credentialSha256 === input.inviteCredentialSha256 &&
        candidate.credentialExpiresAt !== undefined &&
        candidate.credentialExpiresAt.getTime() > input.claimedAt.getTime()
      );
      const recoveryPrincipal = principals.find((candidate) =>
        candidate.recoveryTokenSha256 === input.inviteCredentialSha256 &&
        candidate.recoveryTokenExpiresAt !== undefined &&
        candidate.recoveryTokenExpiresAt.getTime() > input.claimedAt.getTime()
      );
      const principal = currentPrincipal === undefined
        ? initialPrincipal ?? recoveryPrincipal
        : currentPrincipal === recoveryPrincipal
          ? recoveryPrincipal
          : undefined;
      if (session === undefined || principal === undefined || principal.principal.actorScope.kind !== "listed-actors") {
        return null;
      }
      if (principals.some(
        (candidate) => candidate.credentialSha256 === input.participantCredentialSha256
      )) {
        throw new SessionStoreUnavailableError();
      }
      if (recoveryPrincipal !== undefined) {
        principal.credentialSha256 = input.participantCredentialSha256;
        delete principal.recoveryTokenSha256;
        delete principal.recoveryTokenExpiresAt;
        return {
          session: clone(session),
          principal: clone(principal.principal),
          transition: "credential-recovery"
        };
      }
      const updated = applyPrivateInviteClaim(
        session,
        principal.principal.actorScope.actorIds[0],
        input.claimedAt
      );
      principal.credentialSha256 = input.participantCredentialSha256;
      delete principal.credentialExpiresAt;
      this.sessions.set(input.sessionId, updated);
      return {
        session: clone(updated),
        principal: clone(principal.principal),
        transition: "initial-join"
      };
    });
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

  async readFacilitatorDebriefStatus(
    input: SessionAuthenticationInput
  ): Promise<FacilitatorDebriefStatusSource<TState> | null> {
    return this.withSessionLock(input.sessionId, async () => {
      const session = this.sessions.get(input.sessionId);
      const principal = this.findStoredPrincipal(input);
      if (session === undefined || principal?.principal.role !== "facilitator") return null;
      const attempt = this.currentFacilitatorDebriefAttempt(input.sessionId);
      assertFacilitatorDebriefAttemptSessionBinding(attempt, session);
      return {
        session: clone(session),
        attempt: clone(attempt)
      };
    });
  }

  async readFacilitatorDebriefGenerationSource(
    input: SessionAuthenticationInput,
    limit: number
  ): Promise<FacilitatorDebriefGenerationSource<TState> | null> {
    assertPublicJournalLimit(limit);
    return this.withSessionLock(input.sessionId, async () => {
      const session = this.sessions.get(input.sessionId);
      const principal = this.findStoredPrincipal(input);
      const bundle = session === undefined ? undefined : this.bundles.get(session.bundleHash);
      if (session === undefined || principal?.principal.role !== "facilitator" || bundle === undefined) {
        return null;
      }
      const archivedAt = this.archivedAtBySessionId.get(input.sessionId);
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
      const attempt = this.currentFacilitatorDebriefAttempt(input.sessionId);
      assertFacilitatorDebriefAttemptSessionBinding(attempt, session);
      return {
        session: clone(session),
        attempt: clone(attempt),
        bundle: clone(bundle),
        lifecycle: archivedAt === undefined ? "active" : "archived",
        ...(archivedAt === undefined ? {} : { archivedAt: new Date(archivedAt) }),
        events: clone(events)
      };
    });
  }

  async beginFacilitatorDebriefAttempt(
    input: BeginFacilitatorDebriefAttemptInput
  ): Promise<BeginFacilitatorDebriefAttemptResult> {
    assertFacilitatorDebriefBeginInput(input);
    return this.withSessionLock(input.sessionId, async () => {
      const session = this.sessions.get(input.sessionId);
      const principal = this.findStoredPrincipal({
        sessionId: input.sessionId,
        credentialSha256: input.credentialSha256
      });
      if (session === undefined || principal?.principal.role !== "facilitator") {
        return { kind: "authentication-failed" };
      }
      const snapshot = input.requestAudit.inputSnapshotWithoutJournal;
      if (snapshot.gameId !== session.gameId || snapshot.bundleHash !== session.bundleHash) {
        throw new SessionStoreUnavailableError();
      }
      if (session.version.stateVersion !== input.expectedStateVersion) {
        return { kind: "version-conflict" };
      }
      const current = this.currentFacilitatorDebriefAttempt(input.sessionId);
      if (current?.status === "ready") return { kind: "existing", attempt: clone(current) };
      if (current?.status === "generating" &&
          current.requestedAt.getTime() > input.staleGeneratingBefore.getTime()) {
        return { kind: "existing", attempt: clone(current) };
      }
      if (current?.status === "generating") {
        Object.assign(current, {
          status: "failed" as const,
          completedAt: new Date(input.requestedAt),
          durationMs: Math.min(3_600_000, Math.max(0,
            input.requestedAt.getTime() - current.requestedAt.getTime())),
          error: {
            code: "internal_error" as const,
            message: "Предыдущий запуск не завершился; ведущий начал новую попытку."
          }
        });
      }
      const attempt: StoredFacilitatorDebriefAttempt = {
        runId: input.runId,
        sessionId: input.sessionId,
        status: "generating",
        expectedStateVersion: input.expectedStateVersion,
        throughEventSequence: input.throughEventSequence,
        journalSha256: input.journalSha256,
        requestAudit: clone(input.requestAudit),
        requestedAt: new Date(input.requestedAt)
      };
      const attempts = this.facilitatorDebriefAttemptsBySessionId.get(input.sessionId) ?? [];
      attempts.push(attempt);
      this.facilitatorDebriefAttemptsBySessionId.set(input.sessionId, attempts);
      return { kind: "created", attempt: clone(attempt) };
    });
  }

  async completeFacilitatorDebriefAttempt(
    input: CompleteFacilitatorDebriefAttemptInput
  ): Promise<StoredFacilitatorDebriefAttempt | null> {
    return this.withSessionLock(input.sessionId, async () => {
      const attempt = (this.facilitatorDebriefAttemptsBySessionId.get(input.sessionId) ?? [])
        .find((candidate) => candidate.runId === input.runId);
      if (attempt?.status !== "generating") return null;
      const completed: StoredFacilitatorDebriefAttempt = {
        ...attempt,
        status: input.status,
        completedAt: new Date(input.completedAt),
        ...(input.audit.providerRequestId === undefined ? {} : {
          providerRequestId: input.audit.providerRequestId
        }),
        ...((input.status === "failed" ? input.providerStatus : input.audit.providerStatus) === undefined
          ? {}
          : { providerStatus: input.status === "failed" ? input.providerStatus : input.audit.providerStatus }),
        ...(input.audit.providerUsage === undefined ? {} : {
          providerUsage: clone(input.audit.providerUsage)
        }),
        ...(input.audit.responseBytes === undefined ? {} : { responseBytes: input.audit.responseBytes }),
        durationMs: input.audit.durationMs,
        ...(input.audit.rawResponseUtf8 === undefined ? {} : {
          rawResponseUtf8: input.audit.rawResponseUtf8
        }),
        ...(input.status === "ready"
          ? { draft: clone(input.draft) }
          : { error: clone(input.error) })
      };
      const attempts = this.facilitatorDebriefAttemptsBySessionId.get(input.sessionId)!;
      attempts[attempts.indexOf(attempt)] = completed;
      return clone(completed);
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
        (candidate) => candidate.credentialExpiresAt === undefined &&
          candidate.credentialSha256 === input.credentialSha256
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
    }
  }

  private findStoredPrincipal(input: SessionAuthenticationInput): StoredPrincipal | undefined {
    return this.principalsBySessionId.get(input.sessionId)?.find(
      (candidate) => candidate.credentialExpiresAt === undefined &&
        candidate.credentialSha256 === input.credentialSha256
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

  private currentFacilitatorDebriefAttempt(
    sessionId: string
  ): StoredFacilitatorDebriefAttempt | null {
    const attempts = this.facilitatorDebriefAttemptsBySessionId.get(sessionId) ?? [];
    return attempts.find((attempt) => attempt.status === "ready") ??
      attempts.find((attempt) => attempt.status === "generating") ??
      [...attempts].sort((left, right) =>
        right.requestedAt.getTime() - left.requestedAt.getTime())[0] ?? null;
  }
}

function assertBundleInput<TState>(command: CreateSessionInput<TState>): void {
  if (
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

function assertFacilitatorDebriefBeginInput(input: BeginFacilitatorDebriefAttemptInput): void {
  const snapshot = input.requestAudit.inputSnapshotWithoutJournal;
  if (!/^debrief_[A-Za-z0-9_-]{8,128}$/u.test(input.runId) ||
      !/^[a-f0-9]{64}$/u.test(input.credentialSha256) ||
      !Number.isSafeInteger(input.expectedStateVersion) || input.expectedStateVersion < 0 ||
      !Number.isSafeInteger(input.throughEventSequence) || input.throughEventSequence < 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.journalSha256) ||
      !Number.isFinite(input.requestedAt.getTime()) ||
      !Number.isFinite(input.staleGeneratingBefore.getTime()) ||
      input.staleGeneratingBefore.getTime() > input.requestedAt.getTime() ||
      snapshot.runId !== input.runId || snapshot.sessionId !== input.sessionId ||
      snapshot.stateVersion !== input.expectedStateVersion ||
      snapshot.throughEventSequence !== input.throughEventSequence ||
      snapshot.journalSha256 !== input.journalSha256) {
    throw new SessionStoreUnavailableError();
  }
}

function assertFacilitatorDebriefAttemptSessionBinding<TState>(
  attempt: StoredFacilitatorDebriefAttempt | null,
  session: SessionRecord<TState>
): void {
  if (attempt === null) return;
  const snapshot = attempt.requestAudit.inputSnapshotWithoutJournal;
  if (attempt.sessionId !== session.sessionId || snapshot.gameId !== session.gameId ||
      snapshot.bundleHash !== session.bundleHash) {
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
