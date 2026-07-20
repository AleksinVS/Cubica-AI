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
  SessionAuthenticationInput,
  SessionCommandReceipt,
  SessionCommandTransaction,
  SessionCommandTransactionInput,
  SessionEventRecord,
  SessionPrincipal,
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
import {
  createSystemCommandFingerprint,
  createSystemCommandId
} from "./commandIdentity.ts";
import {
  assertNextSessionVersion,
  assertProtectedEventSequenceUnchanged,
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError,
  SessionWriteLockedError
} from "./sessionStoreErrors.ts";

interface StoredPrincipal {
  principal: SessionPrincipal;
  credentialSha256: string;
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

  async createSession(command: CreateSessionInput<TState>): Promise<CreatedSession<TState>> {
    assertBundleInput(command);
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
    const principal: SessionPrincipal = {
      principalId: command.principal.principalId,
      sessionId,
      kind: command.principal.kind,
      role: command.principal.role,
      actorScope: structuredClone(command.principal.actorScope),
      createdAt: now
    };

    // All writes happen only after every invariant has been checked, which is
    // the in-memory equivalent of committing one database transaction.
    this.bundles.set(bundle.bundleHash, bundle);
    this.sessions.set(sessionId, snapshot);
    this.principalsBySessionId.set(sessionId, [{
      principal,
      credentialSha256: command.principal.credentialSha256
    }]);
    return { session: clone(snapshot), principal: clone(principal) };
  }

  async getSession(sessionId: string): Promise<SessionRecord<TState> | null> {
    if (this.archivedAtBySessionId.has(sessionId)) return null;
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : clone(session);
  }

  async authenticateSession(input: SessionAuthenticationInput): Promise<SessionPrincipal | null> {
    if (this.archivedAtBySessionId.has(input.sessionId)) return null;
    const match = this.principalsBySessionId.get(input.sessionId)?.find(
      (candidate) => candidate.credentialSha256 === input.credentialSha256
    );
    return match === undefined ? null : clone(match.principal);
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
      const operationResult = await operation({
        currentSession: clone(current),
        principal: clone(storedPrincipal.principal),
        bundle: clone(bundle),
        ...(existingReceipt === undefined ? {} : { existingReceipt: clone(existingReceipt) })
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
        ...(existingReceipt === undefined ? {} : { existingReceipt: clone(existingReceipt) })
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
