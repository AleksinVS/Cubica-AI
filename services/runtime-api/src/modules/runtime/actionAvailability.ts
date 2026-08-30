/**
 * Projects manifest actions into safe availability data for delivery clients.
 *
 * This module never changes session state and never returns technical guard
 * details. It evaluates assertion-only projections through the protected
 * read-only Mechanics evaluator, preventing UI/runtime rule drift without
 * cloning the complete state once per action or exposing assertion internals.
 */

import type {
  SessionActionAvailability,
  SessionRecord
} from "@cubica/contracts-session";
import type { CubicaMechanicsIRV1Alpha1, Plan, Predicate } from "@cubica/contracts-manifest";
import type { GameBundle } from "../content/manifestLoader.ts";
import {
  evaluateReadOnlyMechanicsPredicates,
  type MechanicsReadOnlyPredicateOutcome
} from "../mechanics/index.ts";
import { listManifestActionDefinitions } from "./manifestActions.ts";

type RuntimeState = Record<string, unknown>;
type ManifestActionDefinition = ReturnType<typeof listManifestActionDefinitions>[number];

/**
 * Immutable preparation derived only from one admitted game bundle.
 *
 * Availability still evaluates state, actor context and role for every
 * snapshot. This metadata merely avoids re-reading the same action catalog,
 * resolving the same plan references and rebuilding the same safe public
 * predicates while the immutable bundle remains alive.
 */
interface ActionAvailabilityMetadata {
  definition: ManifestActionDefinition;
  plan: Plan | null;
  publicPredicate: Predicate | null;
  predicatePreparationFailed: boolean;
}

const actionAvailabilityMetadataCache = new WeakMap<
  GameBundle,
  ReadonlyArray<Readonly<ActionAvailabilityMetadata>>
>();

const hasMissingRequiredParameters = (
  definition: ManifestActionDefinition
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
 * Combine only the leading, visible assertion prefix of a published plan.
 *
 * Returning data instead of evaluating here lets the caller submit all safe
 * predicates to one read-only Mechanics batch. Commands and random operations
 * remain unreachable because this function never returns any step after the
 * first non-assertion.
 */
const visibleStatePredicate = (
  bundle: GameBundle,
  plan: Plan
): Predicate | null => {
  const firstCommandIndex = plan.transaction.steps.findIndex((step) => step.op !== "core.assert");
  const assertionPrefix = plan.transaction.steps
    .slice(0, firstCommandIndex === -1 ? plan.transaction.steps.length : firstCommandIndex)
    .filter((step): step is Extract<Plan["transaction"]["steps"][number], { op: "core.assert" }> =>
      step.op === "core.assert");

  const [firstAssertion, ...remainingAssertions] = assertionPrefix;
  if (!firstAssertion) return null;
  return remainingAssertions.length === 0
    ? projectVisiblePredicateBound(firstAssertion.predicate, bundle.manifest.mechanics, "upper")
    : {
        op: "predicate.all",
        items: [
          projectVisiblePredicateBound(firstAssertion.predicate, bundle.manifest.mechanics, "upper"),
          ...remainingAssertions.map((step) =>
            projectVisiblePredicateBound(step.predicate, bundle.manifest.mechanics, "upper"))
        ]
      };
};

/**
 * Prepare bundle-derived data once without caching any session-dependent
 * decision. A WeakMap lets garbage collection release the entry together with
 * its bundle and prevents equal-looking but distinct historic bundles from
 * sharing metadata accidentally.
 */
const listActionAvailabilityMetadata = (
  bundle: GameBundle
): ReadonlyArray<Readonly<ActionAvailabilityMetadata>> => {
  const cached = actionAvailabilityMetadataCache.get(bundle);
  if (cached) return cached;

  const metadata = listManifestActionDefinitions(bundle)
    .filter((definition) => definition.invocation === "external")
    .map((definition): Readonly<ActionAvailabilityMetadata> => {
      const plan = bundle.manifest.mechanics.plans[definition.binding.planRef] ?? null;
      if (!plan) {
        return Object.freeze({
          definition,
          plan,
          publicPredicate: null,
          predicatePreparationFailed: false
        });
      }

      try {
        return Object.freeze({
          definition,
          plan,
          publicPredicate: visibleStatePredicate(bundle, plan),
          predicatePreparationFailed: false
        });
      } catch {
        // Keep malformed-plan failure local to this action. Shared Mechanics
        // preparation below still runs for every role-admitted real plan.
        return Object.freeze({
          definition,
          plan,
          publicPredicate: null,
          predicatePreparationFailed: true
        });
      }
    });

  const immutableMetadata = Object.freeze(metadata);
  actionAvailabilityMetadataCache.set(bundle, immutableMetadata);
  return immutableMetadata;
};

/** Build the complete action projection for one authoritative session snapshot. */
export function projectSessionActionAvailability(
  snapshot: SessionRecord<RuntimeState>,
  bundle: GameBundle,
  viewer: ActionAvailabilityViewer
): Array<SessionActionAvailability> {
  const { sessionRole, actorPlayerId } = viewer;
  const basisStateVersion = snapshot.version.stateVersion;
  const metadata = listActionAvailabilityMetadata(bundle);
  const predicates: Array<Predicate> = [];
  const predicateIndexByAction = new Map<string, number>();
  let needsSharedMechanicsPreparation = false;

  // Select cached predicates only for actions that survive the role gate.
  // Role admission and every state-dependent evaluation remain per request.
  for (const entry of metadata) {
    const { definition, plan, publicPredicate, predicatePreparationFailed } = entry;
    if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
      continue;
    }
    if (!plan) continue;
    needsSharedMechanicsPreparation = true;
    if (!predicatePreparationFailed && publicPredicate) {
      predicateIndexByAction.set(definition.actionId, predicates.length);
      predicates.push(publicPredicate);
    }
  }

  let predicateOutcomes: Array<MechanicsReadOnlyPredicateOutcome> = [];
  let sharedMechanicsPreparationFailed = false;
  if (needsSharedMechanicsPreparation) {
    try {
      // A plan without a leading visible assertion must still cross the same
      // module-lock, budget and typed-state boundary as guarded actions. The
      // constant sentinel performs no rule check; it only forces that shared
      // preparation to run when there are no actual public predicates.
      const predicatesToEvaluate: Array<Predicate> = predicates.length > 0
        ? predicates
        : [{ op: "predicate.constant", value: true }];
      predicateOutcomes = evaluateReadOnlyMechanicsPredicates({
        mechanics: bundle.manifest.mechanics,
        predicates: predicatesToEvaluate,
        state: snapshot.state,
        actorContext: { actorPlayerId, sessionRole },
        networkModels: bundle.manifest.networkModels,
        objectModels: bundle.manifest.objectModels,
        turnPhases: bundle.manifest.config.turnModel?.phases
      });
      if (predicates.length === 0 && predicateOutcomes[0]?.status !== "passed") {
        sharedMechanicsPreparationFailed = true;
      }
    } catch {
      // Module-lock, state-model or resource-boundary corruption affects the
      // shared preparation. Every role-admitted action with a real plan fails
      // closed, including plans without a leading visible assertion.
      sharedMechanicsPreparationFailed = true;
    }
  }

  return metadata.map(({ definition, plan, predicatePreparationFailed }) => {
    if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "role_not_allowed",
        basisStateVersion
      };
    }
    if (!plan) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported",
        basisStateVersion
      };
    }
    if (predicatePreparationFailed) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported",
        basisStateVersion
      };
    }
    if (sharedMechanicsPreparationFailed) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported",
        basisStateVersion
      };
    }
    const predicateIndex = predicateIndexByAction.get(definition.actionId);
    if (predicateIndex !== undefined) {
      const outcome = predicateOutcomes[predicateIndex];
      if (!outcome || outcome.status === "error") {
        return {
          actionId: definition.actionId,
          status: "unavailable",
          reasonCode: "runtime_unsupported",
          basisStateVersion
        };
      }
      if (outcome.status === "rejected") {
        return {
          actionId: definition.actionId,
          status: "unavailable",
          reasonCode: "state_condition_failed",
          basisStateVersion
        };
      }
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
