/** Transactional executor for one already validated Mechanics IR plan. */
import {
  RUNTIME_BUDGETS,
  assertMechanicsParamsWithinBudget,
  assertMechanicsStateWithinBudget,
  charge,
  chargeAuditOutput,
  chargeIntermediateValue,
  createJsonPrimitiveMeasurementCache,
  type JsonPrimitiveMeasurementCache
} from "./budget.ts";
import { applyTransactionMetricAudit } from "./coreOperations.ts";
import { MechanicsExecutionError } from "./errors.ts";
import { evaluatePredicate } from "./expressionEvaluator.ts";
import { assertRuntimeModuleLock, executeOperation } from "./operationRegistry.ts";
import {
  assertStateMatchesModel,
  isRecord,
  validateReadOnlyStateAccess,
  type VerifiedReadOnlyStateAccess
} from "./stateModel.ts";
import { randomBytes } from "node:crypto";
import type {
  MechanicsExecutionContext,
  MechanicsExecutionInput,
  MechanicsExecutionOutput,
  MechanicsRuntimeCost,
  Predicate,
  Step
} from "./types.ts";

export function executeMechanicsTransaction(input: MechanicsExecutionInput): MechanicsExecutionOutput {
  return executeMechanicsTransactionInternal(input);
}

/**
 * One result from the protected read-only predicate evaluator.
 *
 * `errorCode` is intentionally a stable internal code rather than an exception
 * message: availability callers need a fail-closed decision, not state paths or
 * values from a validation diagnostic.
 */
export type MechanicsReadOnlyPredicateOutcome =
  | { status: "passed" }
  | { status: "rejected" }
  | { status: "error"; errorCode: string };

export type MechanicsReadOnlyPredicateBatchInput = Omit<
  MechanicsExecutionInput,
  "plan" | "params" | "random" | "createScheduleId"
> & {
  predicates: ReadonlyArray<Predicate>;
};

/**
 * Evaluate multiple schema-admitted predicates against one authoritative
 * snapshot without cloning that complete snapshot for every predicate.
 *
 * This is deliberately narrower than transaction execution:
 * - the runtime evaluates only the pure predicate language after proving that
 *   the equivalent assertion operation belongs to the locked core module;
 * - no caller-supplied command, random or scheduler operation can run;
 * - module lock, state resource limits and the complete typed state model are
 *   checked once before the shared snapshot is read;
 * - every predicate gets fresh counters, results and output arrays, preserving
 *   the former per-action runtime budgets instead of pooling them across a
 *   batch;
 * - state is never frozen or written, so the caller retains ownership and sees
 *   exactly the same object after evaluation.
 *
 * A preparation failure (for example, an invalid module lock or oversized
 * state) throws for the batch. A malformed individual predicate is isolated as
 * an `error` outcome so one corrupt action cannot hide otherwise valid actions.
 */
export function evaluateReadOnlyMechanicsPredicates(
  input: MechanicsReadOnlyPredicateBatchInput
): Array<MechanicsReadOnlyPredicateOutcome> {
  if (input.predicates.length === 0) {
    return [];
  }

  // Validate the complete lock once even though this specialized read path
  // evaluates only the pure predicate language and invokes no command module.
  // Missing `cubica.core` is still reported per predicate below so one
  // malformed admitted bundle cannot accidentally make an action available.
  const lockedModules = assertRuntimeModuleLock(input.mechanics.moduleLock);
  const limits = RUNTIME_BUDGETS[input.mechanics.budgetProfile];
  if (!limits) {
    throw new MechanicsExecutionError(
      "MECHANICS_BUDGET_PROFILE_UNKNOWN",
      "Unknown runtime budget profile"
    );
  }

  // These two traversals replace the same work formerly repeated once per
  // action. Empty params are still checked so this boundary stays in parity
  // with the normal executor rather than quietly creating a weaker path.
  const jsonPrimitiveMeasurements = createJsonPrimitiveMeasurementCache();
  assertMechanicsStateWithinBudget(input.state, limits, "input", jsonPrimitiveMeasurements);
  const params = Object.freeze({});
  assertMechanicsParamsWithinBudget(params, limits);
  const actor = Object.freeze({
    ...input.actorContext,
    activePlayerId: input.actorContext.activePlayerId ?? readActivePlayerId(input.state)
  });

  type ReadOnlyMechanicsExecutionContext = MechanicsExecutionContext & {
    /**
     * Opaque request-local proof. It is absent from ordinary transactions and
     * therefore cannot let a mutating plan reuse a stale validation result.
     */
    verifiedReadOnlyStateAccess?: VerifiedReadOnlyStateAccess;
    /** Primitive encoding costs only; never an object/state validation proof. */
    jsonPrimitiveMeasurements?: JsonPrimitiveMeasurementCache;
  };

  const createContext = (
    verifiedReadOnlyStateAccess?: VerifiedReadOnlyStateAccess
  ): ReadOnlyMechanicsExecutionContext => ({
    stateModel: input.mechanics.stateModel,
    state: input.state,
    preActionState: input.state,
    params,
    actor,
    results: new Map(),
    events: [],
    audit: [],
    cost: emptyMechanicsCost(),
    limits,
    systemScheduleMutations: [],
    createScheduleId: () => {
      throw new MechanicsExecutionError(
        "MECHANICS_READ_ONLY_SIDE_EFFECT_FORBIDDEN",
        "Read-only predicate evaluation cannot create scheduler identities"
      );
    },
    networkModels: input.networkModels,
    objectModels: input.objectModels,
    turnPhases: input.turnPhases,
    jsonPrimitiveMeasurements,
    ...(verifiedReadOnlyStateAccess === undefined ? {} : { verifiedReadOnlyStateAccess })
  });

  // This complete validation is the proof that every later context may reuse
  // the same snapshot. The selected operation is assertion-only, so there is no
  // candidate mutation that would require the normal executor's final repeat.
  const verifiedReadOnlyStateAccess = validateReadOnlyStateAccess(createContext());

  return input.predicates.map((predicate, index) => {
    // Counters, result maps and output arrays remain fresh for every predicate.
    // Only already validated reads of the same synchronous snapshot are shared.
    const context = createContext(verifiedReadOnlyStateAccess);
    const stepId = `read-only-predicate-${index}`;
    try {
      charge(context, "steps");
      // A false public condition is the ordinary result for most actions in
      // most phases, not an exceptional runtime failure. Calling
      // `core.assert` here formerly constructed and caught an Error for every
      // such action. Evaluate the same pure predicate directly after proving
      // that the core module is locked, preserving all predicate budgets while
      // keeping the normal rejection path allocation-light.
      const assertionModuleId = lockedModules.operationModules.get("core.assert");
      if (!assertionModuleId) {
        throw new MechanicsExecutionError(
          "MECHANICS_OPERATION_UNKNOWN",
          "Unknown operation core.assert",
          stepId
        );
      }
      if (!lockedModules.moduleIds.has(assertionModuleId)) {
        throw new MechanicsExecutionError(
          "MECHANICS_MODULE_NOT_LOCKED",
          `Operation core.assert requires locked module ${assertionModuleId}`,
          stepId
        );
      }
      const result = evaluatePredicate(predicate, context);
      if (!result) {
        return { status: "rejected" };
      }
      chargeIntermediateValue(context, result);
      context.results.set(stepId, result);
      const auditEntry = { stepId, operation: "core.assert", result };
      chargeAuditOutput(context, auditEntry);
      context.audit.push(auditEntry);
      return { status: "passed" };
    } catch (error) {
      return {
        status: "error",
        errorCode: error instanceof MechanicsExecutionError
          ? error.code
          : "MECHANICS_READ_ONLY_EVALUATION_FAILED"
      };
    }
  });
}

/**
 * Execute an internal, runtime-owned prefix and a published plan atomically.
 *
 * This function is deliberately not re-exported from `mechanics/index.ts`.
 * Public commands and Agent Turns can therefore execute only the published
 * plan, while the protected scheduler can prepend its persisted trigger
 * without opening a caller-controlled prefix seam. `afterPrefix` runs only
 * after every prefix assertion succeeded and before the first published step;
 * it is used for live-reference admission whose failure must be terminal only
 * when a deferred trigger has actually become true.
 */
export function executeMechanicsTransactionWithTrustedPrefix(
  input: MechanicsExecutionInput,
  trustedPrefix: ReadonlyArray<Step>,
  afterPrefix: () => void
): MechanicsExecutionOutput {
  if (trustedPrefix.length === 0) {
    throw new MechanicsExecutionError(
      "MECHANICS_TRUSTED_PREFIX_EMPTY",
      "Trusted Mechanics execution requires a non-empty protected prefix"
    );
  }
  return executeMechanicsTransactionInternal(input, { trustedPrefix, afterPrefix });
}

function executeMechanicsTransactionInternal(
  input: MechanicsExecutionInput,
  trusted?: {
    trustedPrefix: ReadonlyArray<Step>;
    afterPrefix: () => void;
  }
): MechanicsExecutionOutput {
  const lockedModules = assertRuntimeModuleLock(input.mechanics.moduleLock);
  const limits = RUNTIME_BUDGETS[input.mechanics.budgetProfile];
  if (!limits) throw new MechanicsExecutionError("MECHANICS_BUDGET_PROFILE_UNKNOWN", "Unknown runtime budget profile");

  const params = input.params ?? {};
  // Measure before cloning: accepting an already oversized snapshot and only
  // checking the result would itself create the avoidable memory spike that
  // this boundary is meant to prevent.
  assertMechanicsStateWithinBudget(input.state, limits, "input");
  assertMechanicsParamsWithinBudget(params, limits);

  // The input snapshot remains untouched. Every state/RNG/event mutation below
  // belongs to this candidate and disappears automatically if any step throws.
  const candidateState = structuredClone(input.state);
  const activePlayerId = readActivePlayerId(candidateState);
  const context: MechanicsExecutionContext = {
    stateModel: input.mechanics.stateModel,
    state: candidateState,
    // The executor is synchronous and never writes through this reference, so
    // the authoritative input is a safe read-only pre-action view. Avoiding a
    // second complete clone keeps peak memory proportional to the declared
    // candidate-state budget.
    preActionState: input.state,
    // Authenticated actor identity has its own typed expression (`value.actor`)
    // and must never be smuggled into the untrusted action-parameter namespace.
    params,
    actor: { ...input.actorContext, activePlayerId: input.actorContext.activePlayerId ?? activePlayerId },
    random: input.random ? structuredClone(input.random) : undefined,
    results: new Map(),
    events: [],
    audit: [],
    cost: emptyMechanicsCost(),
    limits,
    systemScheduleMutations: [],
    createScheduleId: input.createScheduleId ?? (() => randomBytes(16).toString("base64url")),
    networkModels: input.networkModels,
    objectModels: input.objectModels,
    turnPhases: input.turnPhases,
    // ADR-092: the public metric catalog and the collector for public events
    // that must receive whole-transaction metric deltas.
    publicMetrics: input.publicMetrics,
    metricAuditTargets: []
  };

  // Validate the complete authoritative input before any operation consumes
  // it. This is especially important for read-only derived fields: they have
  // no independent storage slot, so their typed contract is established by
  // resolving and validating the nested source value at this boundary.
  assertStateMatchesModel(context);

  const executeStep = (step: Step, auditStepId = step.id): unknown => {
    charge(context, "steps");
    const when = "when" in step ? step.when : undefined;
    if (when && !evaluatePredicate(when, context)) {
      const skipped = { kind: "skipped" as const };
      chargeIntermediateValue(context, skipped);
      context.results.set(step.id, skipped);
      const auditEntry = { stepId: auditStepId, operation: step.op, result: skipped };
      chargeAuditOutput(context, auditEntry);
      context.audit.push(auditEntry);
      return skipped;
    }

    let result: unknown;
    try {
      result = executeOperation(step, context, lockedModules);
    } catch (error) {
      if (error instanceof MechanicsExecutionError && error.stepId === undefined) {
        throw new MechanicsExecutionError(error.code, error.message, step.id);
      }
      throw error;
    }
    chargeIntermediateValue(context, result);
    context.results.set(step.id, result);
    const auditResult = publicAuditResult(step.op, result);
    // `undefined` is a valid internal operation sentinel but not durable JSON.
    // Omitting it keeps every protected audit entry canonically serializable.
    const auditEntry = {
      stepId: auditStepId,
      operation: step.op,
      ...(auditResult === undefined ? {} : { result: auditResult })
    };
    chargeAuditOutput(context, auditEntry);
    context.audit.push(auditEntry);
    return result;
  };

  const executeSteps = (steps: ReadonlyArray<Step>): unknown => {
    let result: unknown;
    for (const step of steps) result = executeStep(step);
    return result;
  };

  context.executeBoundedBody = (steps, item, scopeId) => {
    const previousItem = context.currentItem;
    const previousResults = new Map(steps.map((step) => [
      step.id,
      {
        existed: context.results.has(step.id),
        value: context.results.get(step.id)
      }
    ]));

    // Each iteration receives a fresh local result scope. Without this reset,
    // a skipped first body step could accidentally expose the previous
    // entity's result to a later `value.result` read.
    for (const step of steps) context.results.delete(step.id);
    context.currentItem = item;
    try {
      let result: unknown;
      for (const step of steps) {
        result = executeStep(step, `${scopeId}.${step.id}`);
      }
      return result;
    } finally {
      for (const step of steps) {
        const previous = previousResults.get(step.id);
        if (previous?.existed) context.results.set(step.id, previous.value);
        else context.results.delete(step.id);
      }
      context.currentItem = previousItem;
    }
  };

  let finalResult: unknown;
  if (trusted) {
    executeSteps(trusted.trustedPrefix);
    trusted.afterPrefix();
  }
  finalResult = executeSteps(input.plan.transaction.steps);

  // ADR-092: now that every step has run, snapshot the declared public metrics
  // before/after and attach the block to each recorded public event and its
  // in-state journal entry. Runs before the budget/model gates so the enriched
  // candidate state is what those gates and the durable snapshot observe.
  applyTransactionMetricAudit(context);

  // This is the last gate before action dispatch can construct the session
  // snapshot and enter the repository transaction. It therefore bounds both
  // durable state and the state portion of the later public response.
  assertMechanicsStateWithinBudget(candidateState, limits, "candidate");
  assertStateMatchesModel(context);

  return {
    candidateState,
    randomState: context.random,
    events: context.events,
    audit: context.audit,
    result: finalResult,
    cost: context.cost,
    systemScheduleMutations: structuredClone(context.systemScheduleMutations)
  };
}

function readActivePlayerId(state: Record<string, unknown>): string | undefined {
  const publicState = isRecord(state.public) ? state.public : undefined;
  const turn = publicState && isRecord(publicState.turn) ? publicState.turn : undefined;
  return turn && typeof turn.activePlayerId === "string" ? turn.activePlayerId : undefined;
}

function emptyMechanicsCost(): MechanicsRuntimeCost {
  return {
    steps: 0,
    expressionNodes: 0,
    algorithmWork: 0,
    scannedEntities: 0,
    resultEntities: 0,
    writes: 0,
    events: 0,
    intermediateBytes: 0,
    eventBytes: 0,
    auditBytes: 0
  };
}

function publicAuditResult(operation: string, value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (operation === "graph.edge.position.inspect") {
    // The full inspection proof may contain a server-only network's geometry,
    // region memberships and fingerprint. It remains available inside this
    // atomic transaction through `context.results`, but the durable audit only
    // records the non-sensitive proof format. The operation and step id are
    // already carried by the surrounding audit entry.
    return {
      kind: "graph-edge-position-inspection",
      proofVersion: value.proofVersion
    };
  }
  if (value.kind === "entities" && Array.isArray(value.ids)) {
    return { kind: "entities", collectionId: value.collectionId, count: value.ids.length };
  }
  return structuredClone(value);
}
