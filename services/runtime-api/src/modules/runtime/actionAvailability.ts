/**
 * Projects manifest actions into safe availability data for delivery clients.
 *
 * This module never changes session state and never returns technical guard
 * details. It evaluates the same immutable Mechanics plan on a candidate clone,
 * preventing UI/runtime rule drift without exposing assertion internals.
 */

import type {
  SessionActionAvailability,
  SessionRecord
} from "@cubica/contracts-session";
import type { CubicaMechanicsIRV1Alpha1, Plan, Predicate } from "@cubica/contracts-manifest";
import type { GameBundle } from "../content/manifestLoader.ts";
import { executeMechanicsTransaction, MechanicsExecutionError } from "../mechanics/index.ts";
import { listManifestActionDefinitions } from "./manifestActions.ts";

type RuntimeState = Record<string, unknown>;

const hasMissingRequiredParameters = (
  definition: ReturnType<typeof listManifestActionDefinitions>[number]
): boolean => {
  const required = Array.isArray(definition.paramsSchema?.required)
    ? definition.paramsSchema.required.filter((name): name is string => typeof name === "string")
    : [];
  return required.length > 0;
};

export interface ActionAvailabilityViewer {
  /** Actor resolved from the authenticated principal, never from request data. */
  actorPlayerId?: string;
  /** Trusted role stored on the session/principal boundary. */
  sessionRole: "player" | "facilitator" | "assistant" | "observer";
}

/**
 * Build a conservative public predicate from one transactional assertion.
 *
 * A leaf that needs command parameters, a previous step result, or server-only
 * state becomes an unknown boolean. `upper` substitutes the value that gives
 * the action the best chance of being available; `lower` does the opposite.
 * Keeping both bounds is necessary under `not`: the upper bound of `not X` is
 * the negation of X's lower bound. If the final upper bound is false, the
 * visible state alone proves that the original assertion cannot pass.
 */
const projectVisiblePredicateBound = (
  predicate: Predicate,
  mechanics: CubicaMechanicsIRV1Alpha1,
  bound: "lower" | "upper"
): Predicate => {
  if (predicate.op === "predicate.all" || predicate.op === "predicate.any") {
    const [first, ...rest] = predicate.items;
    return {
      ...predicate,
      items: [
        projectVisiblePredicateBound(first, mechanics, bound),
        ...rest.map((item) => projectVisiblePredicateBound(item, mechanics, bound))
      ]
    };
  }
  if (predicate.op === "predicate.not") {
    return {
      ...predicate,
      item: projectVisiblePredicateBound(
        predicate.item,
        mechanics,
        bound === "upper" ? "lower" : "upper"
      )
    };
  }
  return isVisibleParameterIndependentLeaf(predicate, mechanics)
    ? predicate
    : { op: "predicate.constant", value: bound === "upper" };
};

/**
 * Decide whether the normal Mechanics evaluator may safely read one leaf.
 * JSON Schema remains the source of truth for predicate structure; this walk
 * only enforces the stricter information-flow boundary of public availability.
 */
const isVisibleParameterIndependentLeaf = (
  value: unknown,
  mechanics: CubicaMechanicsIRV1Alpha1
): boolean => {
  if (Array.isArray(value)) {
    return value.every((item) => isVisibleParameterIndependentLeaf(item, mechanics));
  }
  if (!isRecord(value)) return true;

  if (value.op === "value.param" || value.op === "value.result") return false;
  if (value.op === "value.state") {
    const ref = isRecord(value.ref) ? value.ref : {};
    const endpoint = typeof ref.endpoint === "string"
      ? mechanics.stateModel.endpoints[ref.endpoint]
      : undefined;
    if (endpoint?.audienceRef === "server" || storageNeedsCommandParameter(endpoint?.storage.segments)) {
      return false;
    }
  }
  if (value.op === "predicate.entity.matches" || value.op === "predicate.collection.count") {
    const collectionId = value.op === "predicate.entity.matches" && isRecord(value.entity)
      ? value.entity.collection
      : value.collection;
    const collection = typeof collectionId === "string"
      ? mechanics.stateModel.collections[collectionId]
      : undefined;
    if (collection?.audienceRef === "server" || storageNeedsCommandParameter(collection?.storage.segments)) {
      return false;
    }
  }

  return Object.values(value).every((item) => isVisibleParameterIndependentLeaf(item, mechanics));
};

const storageNeedsCommandParameter = (
  segments: ReadonlyArray<string | { context: "actor" } | { binding: string }> | undefined
): boolean => segments?.some((segment) =>
  isRecord(segment) && "binding" in segment && typeof segment.binding === "string") ?? false;

/**
 * Evaluate only the leading, visible assertion prefix of a published plan.
 * The temporary plan can contain no command or algorithm step, so availability
 * cannot mutate candidate state, advance a random stream, or execute a costly
 * domain operation merely to decide whether a button should be offered.
 */
const evaluateVisibleStateAssertions = (
  snapshot: SessionRecord<RuntimeState>,
  bundle: GameBundle,
  plan: Plan,
  actorPlayerId: string | undefined,
  sessionRole: "player" | "facilitator" | "assistant" | "observer"
): "passed" | "rejected" => {
  const firstCommandIndex = plan.transaction.steps.findIndex((step) => step.op !== "core.assert");
  const assertionPrefix = plan.transaction.steps
    .slice(0, firstCommandIndex === -1 ? plan.transaction.steps.length : firstCommandIndex)
    .filter((step): step is Extract<Plan["transaction"]["steps"][number], { op: "core.assert" }> =>
      step.op === "core.assert");

  const [firstAssertion, ...remainingAssertions] = assertionPrefix;
  if (!firstAssertion) return "passed";
  const predicate: Predicate = remainingAssertions.length === 0
    ? projectVisiblePredicateBound(firstAssertion.predicate, bundle.manifest.mechanics, "upper")
    : {
        op: "predicate.all",
        items: [
          projectVisiblePredicateBound(firstAssertion.predicate, bundle.manifest.mechanics, "upper"),
          ...remainingAssertions.map((step) =>
            projectVisiblePredicateBound(step.predicate, bundle.manifest.mechanics, "upper"))
        ]
      };
  const availabilityPlan: Plan = {
    planHash: plan.planHash,
    transaction: {
      steps: [{
        id: "availability.precondition",
        kind: "assert",
        op: "core.assert",
        predicate,
        errorCode: "AVAILABILITY_STATE_CONDITION_FAILED"
      }]
    }
  };

  try {
    executeMechanicsTransaction({
      mechanics: bundle.manifest.mechanics,
      plan: availabilityPlan,
      state: snapshot.state,
      actorContext: { actorPlayerId, sessionRole },
      networkModels: bundle.manifest.networkModels,
      objectModels: bundle.manifest.objectModels,
      turnPhases: bundle.manifest.config.turnModel?.phases
    });
    return "passed";
  } catch (error) {
    if (error instanceof MechanicsExecutionError &&
        error.stepId === "availability.precondition" &&
        error.code === "AVAILABILITY_STATE_CONDITION_FAILED") {
      return "rejected";
    }
    throw error;
  }
};

/** Build the complete action projection for one authoritative session snapshot. */
export function projectSessionActionAvailability(
  snapshot: SessionRecord<RuntimeState>,
  bundle: GameBundle,
  viewer: ActionAvailabilityViewer
): Array<SessionActionAvailability> {
  const { sessionRole, actorPlayerId } = viewer;
  const basisStateVersion = snapshot.version.stateVersion;

  return listManifestActionDefinitions(bundle)
    .filter((definition) => definition.invocation === "external")
    .map((definition) => {
    if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "role_not_allowed",
        basisStateVersion
      };
    }

    const plan = bundle.manifest.mechanics.plans[definition.binding.planRef];
    if (!plan) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported",
        basisStateVersion
      };
    }
    try {
      if (evaluateVisibleStateAssertions(snapshot, bundle, plan, actorPlayerId, sessionRole) === "rejected") {
        return {
          actionId: definition.actionId,
          status: "unavailable",
          reasonCode: "state_condition_failed",
          basisStateVersion
        };
      }
    } catch (error) {
      // A malformed assertion or incompatible immutable bundle fails closed
      // without returning its internal diagnostic to an untrusted client.
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported",
        basisStateVersion
      };
    }

    if (hasMissingRequiredParameters(definition)) {
      return {
        actionId: definition.actionId,
        status: "parameter-dependent",
        reasonCode: "parameters_required",
        basisStateVersion
      };
    }
    return { actionId: definition.actionId, status: "available", basisStateVersion };
    });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
