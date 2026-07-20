import { createHash } from "node:crypto";
import type { GameBundle } from "../content/manifestLoader.ts";
import type {
  RuntimeActionContext,
  RuntimeActionHandler,
  RuntimeActionResult,
  RuntimeManifestActionDefinition,
  RuntimeActionRegistry
} from "@cubica/contracts-runtime";
import type { Predicate, Step } from "@cubica/contracts-manifest";
import { getManifestActionDefinition, listManifestActionDefinitions } from "./manifestActions.ts";
import { executeMechanicsTransaction, MechanicsExecutionError } from "../mechanics/index.ts";
import { executeMechanicsTransactionWithTrustedPrefix } from "../mechanics/mechanicsExecutor.ts";

type RuntimeState = Record<string, unknown>;

const SYSTEM_TRIGGER_FALSE_CODE = "SYSTEM_SCHEDULE_TRIGGER_FALSE";

const createRegistryMap = (bundle: GameBundle) => {
  const registry = new Map<string, RuntimeActionHandler<RuntimeState>>();

  for (const definition of listManifestActionDefinitions(bundle)) {
    const plan = bundle.manifest.mechanics.plans[definition.binding.planRef];
    if (!plan) continue;
    registry.set(definition.actionId, (context) =>
      executePublishedRuntimeAction(bundle, definition, context));
  }

  return registry;
};

export function createRuntimeActionRegistry(bundle: GameBundle): RuntimeActionRegistry<RuntimeState> {
  const registry = createRegistryMap(bundle);

  return {
    get(actionId: string) {
      return registry.get(actionId);
    },
    has(actionId: string) {
      return registry.has(actionId);
    },
    list() {
      return [...registry.keys()];
    }
  };
}

export function getRegisteredActionDefinition(bundle: GameBundle, actionId: string) {
  return getManifestActionDefinition(bundle, actionId);
}

export interface ExecuteSystemScheduledRuntimeActionOptions {
  bundle: GameBundle;
  definition: RuntimeManifestActionDefinition;
  context: RuntimeActionContext<RuntimeState>;
  scheduleId: string;
  trigger: Predicate;
  /**
   * Revalidate live resource references after the trigger succeeds.
   *
   * A deferred false trigger must remain pending even when a target reference
   * is not currently available. Running this callback between the protected
   * prefix and target steps preserves that behavior without a second
   * Mechanics context or resource budget.
   */
  admitTarget: () => void;
}

export type ExecuteSystemScheduledRuntimeActionOutcome =
  | { triggerPassed: false }
  | { triggerPassed: true; result: RuntimeActionResult<RuntimeState> };

/**
 * Execute one protected trigger and its system-only target under one budget.
 *
 * The generated step id hashes the opaque random schedule id. Published
 * content cannot predict it and therefore cannot collide with the protected
 * result slot. The published target plan and its planHash remain unchanged;
 * only this runtime-owned execution envelope is synthetic.
 */
export function executeSystemScheduledRuntimeAction(
  options: ExecuteSystemScheduledRuntimeActionOptions
): ExecuteSystemScheduledRuntimeActionOutcome {
  if (options.definition.invocation !== "system") {
    throw new MechanicsExecutionError(
      "MECHANICS_SYSTEM_INVOCATION_REQUIRED",
      "Protected schedule target must be a system-only action"
    );
  }
  const plan = options.bundle.manifest.mechanics.plans[options.definition.binding.planRef];
  if (!plan) {
    throw new MechanicsExecutionError(
      "MECHANICS_PLAN_UNKNOWN",
      "Protected schedule target has no published Mechanics plan"
    );
  }
  const triggerStepId = createSystemTriggerStepId(options.scheduleId);
  if (plan.transaction.steps.some((step) => step.id === triggerStepId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_SYSTEM_TRIGGER_STEP_COLLISION",
      "Protected trigger identity collides with a published step"
    );
  }
  const triggerStep: Step = {
    id: triggerStepId,
    kind: "assert",
    op: "core.assert",
    predicate: options.trigger,
    errorCode: SYSTEM_TRIGGER_FALSE_CODE
  };

  try {
    const executed = executeMechanicsTransactionWithTrustedPrefix(
      mechanicsInput(options.bundle, plan, options.context),
      [triggerStep],
      options.admitTarget
    );
    return {
      triggerPassed: true,
      result: successfulRuntimeResult(executed)
    };
  } catch (error) {
    if (
      error instanceof MechanicsExecutionError &&
      error.code === SYSTEM_TRIGGER_FALSE_CODE &&
      error.stepId === triggerStepId
    ) {
      return { triggerPassed: false };
    }
    // Only the expected false assertion controls defer/skip. Any other
    // protected-prefix failure indicates a broken pinned trigger or runtime
    // invariant and must leave the occurrence untouched for recovery.
    if (error instanceof MechanicsExecutionError && error.stepId === triggerStepId) {
      throw error;
    }
    if (error instanceof MechanicsExecutionError) {
      return {
        triggerPassed: true,
        result: { ok: false, error: { code: error.code, message: error.message } }
      };
    }
    throw error;
  }
}

function executePublishedRuntimeAction(
  bundle: GameBundle,
  definition: RuntimeManifestActionDefinition,
  context: RuntimeActionContext<RuntimeState>
): RuntimeActionResult<RuntimeState> {
  const plan = bundle.manifest.mechanics.plans[definition.binding.planRef];
  if (!plan) {
    return {
      ok: false,
      error: { code: "MECHANICS_PLAN_UNKNOWN", message: "Action has no published Mechanics plan" }
    };
  }
  try {
    return successfulRuntimeResult(executeMechanicsTransaction(mechanicsInput(bundle, plan, context)));
  } catch (error) {
    if (error instanceof MechanicsExecutionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}

function mechanicsInput(
  bundle: GameBundle,
  plan: GameBundle["manifest"]["mechanics"]["plans"][string],
  context: RuntimeActionContext<RuntimeState>
) {
  return {
    mechanics: bundle.manifest.mechanics,
    plan,
    state: context.state,
    params: context.params,
    actorContext: {
      actorPlayerId: context.actorPlayerId,
      sessionRole: context.sessionRole
    },
    networkModels: bundle.manifest.networkModels,
    objectModels: bundle.manifest.objectModels,
    turnPhases: bundle.manifest.config.turnModel?.phases,
    publicMetrics: resolvePublicMetricRefs(bundle)
  };
}

/**
 * Cache of derived public metric catalogs, keyed by the immutable bundle.
 *
 * The bundle is frozen, so the result cannot be stored on it; a WeakMap avoids
 * re-scanning the catalog on every action dispatch without retaining bundles.
 */
const publicMetricRefsByBundle = new WeakMap<
  GameBundle,
  ReadonlyArray<{ metricId: string; statePath: string }>
>();

/**
 * ADR-092: derive the ordered public metric catalog the executor snapshots.
 *
 * The platform stays game-agnostic: it reads the declarative metric catalog
 * (`content.data.metrics`, schema-defined) and keeps only `state` metrics whose
 * declared `statePath` lives under the public `public.` subtree. Computed
 * metrics are excluded (they are derived from source state metrics), and games
 * without such a catalog produce an empty list, so no metric block is emitted.
 */
function resolvePublicMetricRefs(
  bundle: GameBundle
): ReadonlyArray<{ metricId: string; statePath: string }> {
  const cached = publicMetricRefsByBundle.get(bundle);
  if (cached !== undefined) return cached;

  const content = (bundle.manifest as { content?: { data?: { metrics?: unknown } } }).content;
  const catalog = content?.data?.metrics;
  const refs: Array<{ metricId: string; statePath: string }> = [];
  if (Array.isArray(catalog)) {
    for (const metric of catalog) {
      if (
        metric !== null &&
        typeof metric === "object" &&
        (metric as { kind?: unknown }).kind === "state" &&
        typeof (metric as { metricId?: unknown }).metricId === "string" &&
        typeof (metric as { statePath?: unknown }).statePath === "string" &&
        (metric as { statePath: string }).statePath.startsWith("public.")
      ) {
        refs.push({
          metricId: (metric as { metricId: string }).metricId,
          statePath: (metric as { statePath: string }).statePath
        });
      }
    }
  }

  const frozen = Object.freeze(refs);
  publicMetricRefsByBundle.set(bundle, frozen);
  return frozen;
}

function successfulRuntimeResult(
  executed: ReturnType<typeof executeMechanicsTransaction>
): RuntimeActionResult<RuntimeState> {
  return {
    ok: true,
    candidateState: executed.candidateState,
    events: executed.events,
    // This trace is protected data. The dispatcher moves it into the
    // internal receipt; the public action response exposes only its safe
    // receipt projection.
    mechanicsAudit: {
      formatVersion: "1.0.0",
      steps: executed.audit,
      cost: executed.cost
    },
    ...(executed.systemScheduleMutations.length === 0
      ? {}
      : { systemScheduleMutations: executed.systemScheduleMutations })
  };
}

function createSystemTriggerStepId(scheduleId: string): string {
  const digest = createHash("sha256").update(scheduleId).digest("hex");
  return `system.trigger.${digest}`;
}
