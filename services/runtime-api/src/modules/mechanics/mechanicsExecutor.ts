/** Transactional executor for one already validated Mechanics IR plan. */
import {
  RUNTIME_BUDGETS,
  assertMechanicsParamsWithinBudget,
  assertMechanicsStateWithinBudget,
  charge,
  chargeAuditOutput,
  chargeIntermediateValue
} from "./budget.ts";
import { MechanicsExecutionError } from "./errors.ts";
import { evaluatePredicate } from "./expressionEvaluator.ts";
import { assertRuntimeModuleLock, executeOperation } from "./operationRegistry.ts";
import { assertStateMatchesModel, isRecord } from "./stateModel.ts";
import { randomBytes } from "node:crypto";
import type {
  MechanicsExecutionContext,
  MechanicsExecutionInput,
  MechanicsExecutionOutput,
  Step
} from "./types.ts";

export function executeMechanicsTransaction(input: MechanicsExecutionInput): MechanicsExecutionOutput {
  return executeMechanicsTransactionInternal(input);
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
    cost: {
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
    },
    limits,
    systemScheduleMutations: [],
    createScheduleId: input.createScheduleId ?? (() => randomBytes(16).toString("base64url")),
    networkModels: input.networkModels,
    objectModels: input.objectModels,
    turnPhases: input.turnPhases
  };

  let finalResult: unknown;
  const executeSteps = (steps: ReadonlyArray<Step>): void => {
    for (const step of steps) {
      charge(context, "steps");
      const when = "when" in step ? step.when : undefined;
      if (when && !evaluatePredicate(when, context)) {
        const skipped = { kind: "skipped" as const };
        chargeIntermediateValue(context, skipped);
        context.results.set(step.id, skipped);
        const auditEntry = { stepId: step.id, operation: step.op, result: skipped };
        chargeAuditOutput(context, auditEntry);
        context.audit.push(auditEntry);
        finalResult = skipped;
        continue;
      }
      try {
        finalResult = executeOperation(step, context, lockedModules);
      } catch (error) {
        if (error instanceof MechanicsExecutionError && error.stepId === undefined) {
          throw new MechanicsExecutionError(error.code, error.message, step.id);
        }
        throw error;
      }
      chargeIntermediateValue(context, finalResult);
      context.results.set(step.id, finalResult);
      const auditResult = publicAuditResult(finalResult);
      // `undefined` is a valid internal operation sentinel but not durable JSON.
      // Omitting it keeps every protected audit entry canonically serializable.
      const auditEntry = {
        stepId: step.id,
        operation: step.op,
        ...(auditResult === undefined ? {} : { result: auditResult })
      };
      chargeAuditOutput(context, auditEntry);
      context.audit.push(auditEntry);
    }
  };

  if (trusted) {
    executeSteps(trusted.trustedPrefix);
    trusted.afterPrefix();
  }
  executeSteps(input.plan.transaction.steps);

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

function publicAuditResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.kind === "entities" && Array.isArray(value.ids)) {
    return { kind: "entities", collectionId: value.collectionId, count: value.ids.length };
  }
  return structuredClone(value);
}
