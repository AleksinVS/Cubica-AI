/** Authenticated, idempotent dispatch of one immutable Mechanics IR action. */
import type {
  DispatchActionInput,
  PublicSessionCommandReceipt,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord,
  SessionRole,
  SessionStorePort,
  SessionSystemScheduleMutation
} from "@cubica/contracts-session";
import type {
  RuntimeActionResult,
  RuntimeManifestActionDefinition
} from "@cubica/contracts-runtime";
import type { Predicate } from "@cubica/contracts-manifest";
import type { GameBundle } from "../content/manifestLoader.ts";
import {
  loadImmutableGameBundle,
  loadImmutableGameBundleForReceipt
} from "../content/manifestLoader.ts";
import { RequestValidationError } from "../errors.ts";
import { executeMechanicsTransaction, MechanicsExecutionError } from "../mechanics/index.ts";
import {
  createAppliedCommandReceipt,
  createDurableCommandResult,
  createExternalCommandFingerprint,
  createRejectedCommandReceipt,
  requireDurableCommandResult
} from "../session/commandIdentity.ts";
import {
  resolveSessionActor,
  resolveSessionViewerActor
} from "../session/sessionAuthentication.ts";
import {
  CommandIdReusedError,
  SessionStoreUnavailableError,
  SessionVersionConflictError
} from "../session/sessionStoreErrors.ts";
import {
  createRuntimeActionRegistry,
  executeSystemScheduledRuntimeAction,
  getRegisteredActionDefinition
} from "./actionRegistry.ts";
import { resolveActionReferences, validateActionParameters } from "./actionParameters.ts";
import type { CommandAdmissionController } from "./commandAdmission.ts";

type RuntimeState = Record<string, unknown>;

export interface DispatchRuntimeActionOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  credentialSha256: string;
  input: DispatchActionInput;
  admissionController: CommandAdmissionController;
}

export interface DispatchRuntimeActionOutcome {
  snapshot: SessionRecord<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
  receipt: PublicSessionCommandReceipt;
  bundle: GameBundle;
  /** Actor branch allowed for the authenticated viewer on the returned snapshot. */
  actorPlayerId?: string;
  /** Role of the authenticated principal, never a session-wide default. */
  sessionRole: SessionRole;
  /** True only when this delivery committed a new state transition. */
  committedState: boolean;
}

export type PublishedGameIntentSessionRole = "player" | "facilitator" | "assistant" | "observer";

/**
 * Inputs for executing a published Game Intent against a transaction-local
 * candidate state.
 *
 * The caller owns authentication and the surrounding session transaction.
 * This intentionally has no store, command id, version, receipt, or lock
 * parameters, so an Agent Turn can reuse the exact action validation and
 * Mechanics execution path without nesting a second session transaction.
 */
export interface ExecutePublishedGameIntentCandidateOptions {
  bundle: GameBundle;
  state: RuntimeState;
  actionId: string;
  params?: Record<string, unknown>;
  actorPlayerId?: string;
  sessionRole: PublishedGameIntentSessionRole;
  sessionId?: string;
  now?: Date;
}

/** Rule identity and candidate result needed by both public and Agent dispatch. */
export interface ExecutePublishedGameIntentCandidateOutcome {
  definition: RuntimeManifestActionDefinition;
  planHash: string;
  result: RuntimeActionResult<RuntimeState>;
  candidateState?: RuntimeState;
  events: Array<PublishedGameIntentEvent>;
}

/** Protected Mechanics event before the session transaction allocates ids. */
export interface PublishedGameIntentEvent {
  audience: "public" | "actor" | "server";
  eventType: string;
  summary: unknown;
  data: Record<string, unknown>;
}

/**
 * Internal scheduler input. Unlike the public/Agent candidate shape above,
 * this type has a protected trigger and always selects `system` invocation.
 */
export interface ExecuteProtectedSystemIntentCandidateOptions
  extends ExecutePublishedGameIntentCandidateOptions {
  scheduleId: string;
  trigger: Predicate;
}

export interface ExecuteProtectedSystemIntentCandidateOutcome
  extends ExecutePublishedGameIntentCandidateOutcome {
  triggerPassed: boolean;
}

/**
 * Run the non-mutating admission checks that must precede rate charging.
 *
 * Candidate execution repeats these checks defensively because it is also a
 * standalone boundary for Agent-selected intents. Keeping this function free
 * of Mechanics execution lets invalid roles, parameters, and live references
 * fail without consuming command admission capacity.
 */
export function validatePublishedGameIntentAdmission(
  options: ExecutePublishedGameIntentCandidateOptions
): void {
  const definition = getRegisteredActionDefinition(options.bundle, options.actionId);
  if (!definition) {
    throw new RequestValidationError(`Action "${options.actionId}" is not defined for this game`);
  }
  if ((definition.invocation ?? "external") !== "external") {
    throw new RequestValidationError(`Action "${options.actionId}" is not defined for this invocation path`);
  }
  if (definition.allowedSessionRoles &&
      !definition.allowedSessionRoles.includes(options.sessionRole)) {
    throw new RequestValidationError(`Action "${options.actionId}" is not available to this session role`);
  }

  const params = validateActionParameters(definition, options.params);
  resolveActionReferences(definition, params, options.state);
  const plan = options.bundle.manifest.mechanics.plans[definition.binding.planRef];
  const handler = createRuntimeActionRegistry(options.bundle).get(options.actionId);
  if (!plan || !handler) {
    throw new RequestValidationError(`Action "${options.actionId}" has no published Mechanics plan`);
  }
}

/**
 * Admit an Agent Turn entry intent without executing its gameplay commands.
 *
 * The entry action is a trigger, not the intent selected by the model. Its
 * leading assertions still define whether the model call is allowed now. Run
 * exactly that assertion prefix with real parameters and actor context so a
 * failed phase/actor guard cannot consume provider capacity or observe a state
 * from which the entry intent was unavailable.
 */
export function validatePublishedGameIntentEntryAdmission(
  options: ExecutePublishedGameIntentCandidateOptions
): void {
  validatePublishedGameIntentAdmission(options);
  const definition = getRegisteredActionDefinition(options.bundle, options.actionId)!;
  const params = validateActionParameters(definition, options.params);
  const plan = options.bundle.manifest.mechanics.plans[definition.binding.planRef]!;
  const firstCommandIndex = plan.transaction.steps.findIndex((step) => step.op !== "core.assert");
  const assertionPrefix = plan.transaction.steps.slice(
    0,
    firstCommandIndex === -1 ? plan.transaction.steps.length : firstCommandIndex
  );
  if (assertionPrefix.length === 0) return;

  try {
    executeMechanicsTransaction({
      mechanics: options.bundle.manifest.mechanics,
      plan: {
        planHash: plan.planHash,
        transaction: { steps: assertionPrefix as typeof plan.transaction.steps }
      },
      state: options.state,
      params,
      actorContext: {
        actorPlayerId: options.actorPlayerId,
        sessionRole: options.sessionRole
      },
      networkModels: options.bundle.manifest.networkModels,
      objectModels: options.bundle.manifest.objectModels,
      turnPhases: options.bundle.manifest.config.turnModel?.phases
    });
  } catch (error) {
    if (error instanceof MechanicsExecutionError) {
      throw new RequestValidationError(`Action "${options.actionId}" is not available in the current session state`);
    }
    throw error;
  }
}

interface TransactionOutcome {
  outcome?: DispatchRuntimeActionOutcome;
}

/**
 * Validate and execute one immutable manifest action without committing it.
 *
 * Publication, JSON-Schema parameters, live resource references, session role
 * and Mechanics assertions all fail closed here. A rejected Mechanics result
 * is returned (rather than thrown) so the outer command owner can write the
 * correct durable rejection receipt in its own atomic transaction.
 */
export async function executePublishedGameIntentCandidate(
  options: ExecutePublishedGameIntentCandidateOptions
): Promise<ExecutePublishedGameIntentCandidateOutcome> {
  const definition = getRegisteredActionDefinition(options.bundle, options.actionId);
  if (!definition) {
    throw new RequestValidationError(`Action "${options.actionId}" is not defined for this game`);
  }
  if ((definition.invocation ?? "external") !== "external") {
    throw new RequestValidationError(`Action "${options.actionId}" is not defined for this invocation path`);
  }
  if (definition.allowedSessionRoles &&
      !definition.allowedSessionRoles.includes(options.sessionRole)) {
    throw new RequestValidationError(`Action "${options.actionId}" is not available to this session role`);
  }

  const params = validateActionParameters(definition, options.params);
  const resolvedRefs = resolveActionReferences(definition, params, options.state);
  const plan = options.bundle.manifest.mechanics.plans[definition.binding.planRef];
  const handler = createRuntimeActionRegistry(options.bundle).get(options.actionId);
  if (!plan || !handler) {
    throw new RequestValidationError(`Action "${options.actionId}" has no published Mechanics plan`);
  }

  const result = await handler({
    sessionId: options.sessionId ?? "transaction-local-candidate",
    gameId: options.bundle.manifest.meta.id,
    actionId: options.actionId,
    params,
    actorPlayerId: options.actorPlayerId,
    sessionRole: options.sessionRole,
    resolvedRefs,
    state: options.state,
    now: options.now ?? new Date(),
    manifestAction: definition
  });
  const candidateState = result.ok ? result.candidateState : undefined;
  const events = (result.events ?? []).map(requirePublishedGameIntentEvent);

  return {
    definition,
    planHash: plan.planHash,
    result,
    candidateState,
    events
  };
}

/**
 * Execute a protected scheduler target without widening the public/Agent seam.
 *
 * Target admission runs only after the persisted trigger succeeds, but before
 * the first target step, inside the same Mechanics execution. This preserves
 * `defer` semantics for temporarily unavailable resources and still turns a
 * deterministic target-admission failure into a terminal poison occurrence.
 */
export async function executeProtectedSystemIntentCandidate(
  options: ExecuteProtectedSystemIntentCandidateOptions
): Promise<ExecuteProtectedSystemIntentCandidateOutcome> {
  const definition = getRegisteredActionDefinition(options.bundle, options.actionId);
  if (!definition || definition.invocation !== "system") {
    throw new RequestValidationError(`Action "${options.actionId}" is not defined for the protected system path`);
  }
  const plan = options.bundle.manifest.mechanics.plans[definition.binding.planRef];
  if (!plan || !createRuntimeActionRegistry(options.bundle).has(options.actionId)) {
    throw new RequestValidationError(`Action "${options.actionId}" has no published Mechanics plan`);
  }

  // Stored schedule params are bounded scalars, but their action schema and
  // live references are deliberately rechecked only after a true trigger.
  let validatedParams: Record<string, unknown> | undefined;
  const execution = executeSystemScheduledRuntimeAction({
    bundle: options.bundle,
    definition,
    scheduleId: options.scheduleId,
    trigger: options.trigger,
    context: {
      sessionId: options.sessionId ?? "transaction-local-system-candidate",
      gameId: options.bundle.manifest.meta.id,
      actionId: options.actionId,
      params: options.params,
      actorPlayerId: options.actorPlayerId,
      sessionRole: options.sessionRole,
      state: options.state,
      now: options.now ?? new Date(),
      manifestAction: definition
    },
    admitTarget: () => {
      if (definition.allowedSessionRoles &&
          !definition.allowedSessionRoles.includes(options.sessionRole)) {
        throw new RequestValidationError(`Action "${options.actionId}" is not available to this session role`);
      }
      validatedParams = validateActionParameters(definition, options.params);
      resolveActionReferences(definition, validatedParams, options.state);
    }
  });

  if (!execution.triggerPassed) {
    return {
      triggerPassed: false,
      definition,
      planHash: plan.planHash,
      result: { ok: false },
      events: []
    };
  }
  // A true trigger always ran target admission before the target plan. This
  // assertion guards future executor refactors that might skip that callback.
  if (validatedParams === undefined) throw new SessionStoreUnavailableError();
  const candidateState = execution.result.ok ? execution.result.candidateState : undefined;
  const events = (execution.result.events ?? []).map(requirePublishedGameIntentEvent);
  return {
    triggerPassed: true,
    definition,
    planHash: plan.planHash,
    result: execution.result,
    candidateState,
    events
  };
}

export async function dispatchRuntimeAction(
  options: DispatchRuntimeActionOptions
): Promise<DispatchRuntimeActionOutcome> {
  const transaction = await options.sessionStore.withCommandTransaction<TransactionOutcome>({
    sessionId: options.input.sessionId,
    commandId: options.input.commandId,
    credentialSha256: options.credentialSha256
  }, async ({ currentSession: current, principal, bundle: storedBundle, existingReceipt }) => {
    // A committed receipt is readable even after its pinned executor version
    // leaves the active registry. New execution still takes the full current
    // schema/module admission path below.
    const bundle = existingReceipt === undefined
      ? loadImmutableGameBundle(storedBundle)
      : loadImmutableGameBundleForReceipt(storedBundle);
    const definition = existingReceipt === undefined
      ? getRegisteredActionDefinition(bundle, options.input.actionId)
      : undefined;
    if (existingReceipt === undefined && (!definition || (definition.invocation ?? "external") !== "external")) {
      throw new RequestValidationError(`Action "${options.input.actionId}" is not defined for this game`);
    }

    const fingerprint = createExternalCommandFingerprint({
      command: options.input,
      bundleHash: current.bundleHash,
      // Receipt identity must be checked before current action resolution. A
      // changed/unknown actionId using an existing command key is canonical
      // command-id reuse, not a fresh "action not found" request.
      definitionHash: existingReceipt?.definitionHash ?? definition!.definitionHash
    });

    // Receipt lookup deliberately precedes version and actor resolution. An
    // exact retry after a lost response must return the original rule identity
    // even if the hot-seat active participant has since changed.
    if (existingReceipt) {
      if (existingReceipt.actionId !== options.input.actionId || existingReceipt.fingerprint !== fingerprint) {
        throw new CommandIdReusedError(options.input.commandId);
      }
      const storedResult = readStoredGameIntentResult(existingReceipt.result);
      const viewerActorPlayerId = resolveSessionViewerActor(current, principal);
      return {
        result: {
          outcome: {
            snapshot: current,
            result: storedResult,
            receipt: existingReceipt.publicReceipt,
            bundle,
            ...(viewerActorPlayerId === undefined ? {} : { actorPlayerId: viewerActorPlayerId }),
            sessionRole: principal.role,
            committedState: false
          }
        }
      };
    }

    // `definition` was resolved for every new command above; this assertion
    // documents the post-receipt narrowing for TypeScript and future readers.
    if (!definition) throw new SessionStoreUnavailableError();

    if (current.version.stateVersion !== options.input.expectedStateVersion) {
      throw new SessionVersionConflictError(current.sessionId, options.input.expectedStateVersion);
    }
    const sessionRole = principal.role;
    const commandActorPlayerId = resolveSessionActor(current, principal);
    const candidateOptions: ExecutePublishedGameIntentCandidateOptions = {
      bundle,
      state: current.state,
      sessionId: current.sessionId,
      actionId: options.input.actionId,
      params: options.input.params,
      actorPlayerId: commandActorPlayerId,
      sessionRole,
      now: new Date()
    };
    validatePublishedGameIntentAdmission(candidateOptions);
    await options.admissionController.assertNewCommandAdmitted({
      sessionId: current.sessionId,
      principalId: principal.principalId,
      commandId: options.input.commandId,
      kind: "game-intent"
    });
    const executed = await executePublishedGameIntentCandidate({
      ...candidateOptions,
      // Keep the rule's wall-clock input close to actual execution rather than
      // any future asynchronous shared admission backend latency.
      now: new Date()
    });
    const { result } = executed;

    if (!result.ok || !executed.candidateState) {
      const receipt = createRejectedCommandReceipt({
        command: options.input,
        principal,
        actorId: commandActorPlayerId,
        current,
        fingerprint,
        definitionHash: definition.definitionHash,
        planHash: executed.planHash,
        rejectionCode: result.error?.code ?? "MECHANICS_ACTION_REJECTED",
        durableResult: createDurableCommandResult("game-intent", {
          ok: false,
          ...(result.error === undefined ? {} : { error: structuredClone(result.error) })
        })
      });
      // An admitted terminal gameplay rejection is itself a durable outcome.
      // Return its public receipt on the first delivery as well as on an exact
      // retry; otherwise one logical command would have two transport shapes
      // (error first, success on retry) despite sharing one ledger record.
      return {
        receipt,
        result: {
          outcome: {
            snapshot: current,
            result,
            receipt: receipt.publicReceipt,
            bundle,
            ...viewerIdentity(current, principal),
            committedState: false
          }
        }
      };
    }

    const eventCount = executed.events.length;
    const eventRefs = Array.from({ length: eventCount }, (_, index) =>
      `${current.sessionId}:${current.version.lastEventSequence + index + 1}`
    );
    const snapshot: SessionRecord<RuntimeState> = {
      ...current,
      state: executed.candidateState,
      version: {
        sessionId: current.sessionId,
        stateVersion: current.version.stateVersion + 1,
        lastEventSequence: current.version.lastEventSequence + eventCount
      },
      updatedAt: new Date()
    };
    const receipt = createAppliedCommandReceipt({
      command: options.input,
      principal,
      actorId: commandActorPlayerId,
      before: current,
      after: snapshot,
      fingerprint,
      definitionHash: definition.definitionHash,
      planHash: executed.planHash,
      eventRefs,
      ...(result.mechanicsAudit === undefined ? {} : { mechanicsAudit: result.mechanicsAudit }),
      durableResult: createDurableCommandResult("game-intent", { ok: true })
    });
    const scheduleMutations = materializeSystemScheduleMutations({
      mutations: result.systemScheduleMutations ?? [],
      bundle,
      sessionId: current.sessionId,
      bundleHash: current.bundleHash,
      now: snapshot.updatedAt
    });
    const events: Array<SessionEventRecord> = executed.events.map((event, index) => ({
      eventId: eventRefs[index],
      sessionId: current.sessionId,
      sequence: current.version.lastEventSequence + index + 1,
      receiptId: receipt.receiptId,
      commandId: options.input.commandId,
      actionId: options.input.actionId,
      principalId: principal.principalId,
      ...(commandActorPlayerId === undefined ? {} : { actorId: commandActorPlayerId }),
      audience: event.audience,
      eventType: event.eventType,
      summary: structuredClone(event.summary),
      data: structuredClone(event.data),
      createdAt: snapshot.updatedAt
    }));
    return {
      updatedSession: snapshot,
      receipt,
      events,
      ...(scheduleMutations.length === 0 ? {} : { scheduleMutations }),
      result: {
        outcome: {
          snapshot,
          result,
          receipt: receipt.publicReceipt,
          bundle,
          ...viewerIdentity(snapshot, principal),
          committedState: true
        }
      }
    };
  });

  if (!transaction.outcome) throw new SessionStoreUnavailableError();
  return transaction.outcome;
}

/** Add protected bundle/action identity that Mechanics is not allowed to forge. */
export function materializeSystemScheduleMutations(input: {
  mutations: NonNullable<RuntimeActionResult<RuntimeState>["systemScheduleMutations"]>;
  bundle: GameBundle;
  sessionId: string;
  bundleHash: string;
  now: Date;
}): Array<SessionSystemScheduleMutation> {
  return input.mutations.map((mutation) => {
    if (mutation.kind === "cancel") return { kind: "cancel", scheduleId: mutation.scheduleId };
    const target = getRegisteredActionDefinition(input.bundle, mutation.actionId);
    if (!target || (target.invocation ?? "external") !== "system") {
      throw new SessionStoreUnavailableError();
    }
    // Static checking proves the expression types, while this runtime gate
    // enforces value-dependent bounds such as enum membership and string
    // length before an invalid deferred command can enter protected storage.
    const params = validateActionParameters(target, mutation.params) as Record<
      string,
      string | number | boolean
    >;
    return {
      kind: "register",
      schedule: {
        scheduleId: mutation.scheduleId,
        sessionId: input.sessionId,
        bundleHash: input.bundleHash,
        actionId: mutation.actionId,
        params: structuredClone(params),
        definitionHash: target.definitionHash,
        trigger: structuredClone(mutation.trigger),
        falsePolicy: mutation.falsePolicy,
        maxOccurrences: mutation.maxOccurrences,
        nextOccurrence: 1,
        status: "pending",
        createdAt: input.now,
        updatedAt: input.now
      }
    };
  });
}

/** Keep response identity separate from the immutable command actor in audit. */
function viewerIdentity(
  snapshot: SessionRecord<RuntimeState>,
  principal: SessionPrincipal
): Pick<DispatchRuntimeActionOutcome, "actorPlayerId" | "sessionRole"> {
  const actorPlayerId = resolveSessionViewerActor(snapshot, principal);
  return {
    ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
    sessionRole: principal.role
  };
}

function readStoredGameIntentResult(value: unknown): RuntimeActionResult<RuntimeState> {
  try {
    const stored = requireDurableCommandResult(value, "game-intent").value;
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      throw new Error("invalid stored game-intent result");
    }
    if ((stored as { ok?: unknown }).ok === true) return { ok: true };
    const error = (stored as { error?: unknown }).error;
    if (
      (stored as { ok?: unknown }).ok !== false ||
      typeof error !== "object" || error === null || Array.isArray(error) ||
      typeof (error as { code?: unknown }).code !== "string" ||
      typeof (error as { message?: unknown }).message !== "string"
    ) {
      throw new Error("invalid stored rejection result");
    }
    return {
      ok: false,
      error: {
        code: (error as { code: string }).code,
        message: (error as { message: string }).message
      }
    };
  } catch {
    // A receipt without its compact pinned result violates the durable
    // command-ledger contract. Never re-execute it to reconstruct an answer.
    throw new SessionStoreUnavailableError();
  }
}

function requirePublishedGameIntentEvent(value: unknown): PublishedGameIntentEvent {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof (value as { eventType?: unknown }).eventType !== "string" ||
    !["public", "actor", "server"].includes(String((value as { audience?: unknown }).audience)) ||
    typeof (value as { data?: unknown }).data !== "object" ||
    (value as { data?: unknown }).data === null || Array.isArray((value as { data?: unknown }).data)
  ) {
    throw new SessionStoreUnavailableError();
  }
  return value as PublishedGameIntentEvent;
}
