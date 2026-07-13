import type {
  DispatchActionInput,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import type { GameBundle } from "../content/manifestLoader.ts";
import { NotFoundError, RequestValidationError } from "../errors.ts";
import { SessionVersionConflictError } from "../session/sessionStoreErrors.ts";
import { createRuntimeActionRegistry, getRegisteredActionDefinition } from "./actionRegistry.ts";
import { resolveActionReferences, validateActionParameters } from "./actionParameters.ts";

type RuntimeState = Record<string, unknown>;
/**
 * Trusted in-process callers (for example deterministic fixture runners) may
 * omit the HTTP concurrency precondition. Every public request is parsed as
 * DispatchActionInput and therefore always carries it.
 */
type InternalDispatchActionInput = Omit<DispatchActionInput, "expectedStateVersion"> & {
  expectedStateVersion?: number;
};
const RUNTIME_VALIDATION_ERROR_CODES = new Set([
  "RUNTIME_ACTION_GUARD_FAILED",
  "RUNTIME_ACTION_EFFECT_FAILED",
  "RUNTIME_ACTION_METADATA_MISSING",
  "RUNTIME_ACTION_MANIFEST_UNSUPPORTED"
]);

const createNextVersion = (current: SessionRecord<RuntimeState>) => ({
  sessionId: current.sessionId,
  stateVersion: current.version.stateVersion + 1,
  lastEventSequence: current.version.lastEventSequence + 1
});

export interface DispatchRuntimeActionOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  bundle: GameBundle;
  input: DispatchActionInput | InternalDispatchActionInput;
}

export interface DispatchRuntimeActionOutcome {
  snapshot: SessionRecord<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
}

export async function dispatchRuntimeAction(
  options: DispatchRuntimeActionOptions
): Promise<DispatchRuntimeActionOutcome> {
  return options.sessionStore.withLockedSession(options.input.sessionId, async (current) => {

  if (!current) {
    throw new NotFoundError(`Session "${options.input.sessionId}" was not found`);
  }

  // WHY: this comparison must happen while the store's exclusive session lock
  // is held. Checking before the lock would leave a race in which two callers
  // both observe the same version and apply the same payment or move twice.
  if (
    options.input.expectedStateVersion !== undefined &&
    current.version.stateVersion !== options.input.expectedStateVersion
  ) {
    throw new SessionVersionConflictError(
      current.sessionId,
      options.input.expectedStateVersion
    );
  }

  const { bundle } = options;
  const definition = getRegisteredActionDefinition(bundle, options.input.actionId);

  if (!definition) {
    throw new RequestValidationError(
      `Action "${options.input.actionId}" is not defined for game "${current.gameId}"`
    );
  }

  const params = validateActionParameters(definition, options.input.params);
  const resolvedRefs = resolveActionReferences(definition, params, current.state);
  const sessionRole = current.sessionRole ?? "player";
  if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
    throw new RequestValidationError(
      `Action "${options.input.actionId}" is not available to the current session role`
    );
  }

  const registry = createRuntimeActionRegistry(bundle);
  const handler = registry.get(options.input.actionId);

  if (!handler) {
    throw new RequestValidationError(
      `Action "${options.input.actionId}" is not supported by deterministic runtime for game "${current.gameId}"`
    );
  }

  const result = await handler({
    sessionId: current.sessionId,
    gameId: current.gameId,
    actionId: options.input.actionId,
    params,
    actorPlayerId: options.input.playerId,
    sessionRole,
    resolvedRefs,
    payload: options.input.payload,
    state: current.state,
    now: new Date(),
    manifestAction: definition
  });

  if (!result.ok) {
    const message = result.error?.message ?? `Action "${options.input.actionId}" did not produce a state transition`;
    if (result.error?.code === "RUNTIME_ACTION_GUARD_FAILED") {
      // Internal guard diagnostics can contain JSON paths and actual values.
      // They are useful inside runtime tests/logging but are not a safe or
      // understandable public API response for a player or facilitator.
      throw new RequestValidationError(
        `Action "${options.input.actionId}" is not available in the current session state`
      );
    }
    if (result.error && RUNTIME_VALIDATION_ERROR_CODES.has(result.error.code)) {
      throw new RequestValidationError(message);
    }
    throw new Error(message);
  }

  if (!result.delta?.state) {
    const message = result.error?.message ?? `Action "${options.input.actionId}" did not produce a state transition`;
    throw new Error(message);
  }

  const snapshot: SessionRecord<RuntimeState> = {
    ...current,
    state: result.delta.state,
    version: createNextVersion(current),
    updatedAt: new Date()
  };

  return {
    updatedSession: snapshot,
    result: {
      snapshot,
      result
    }
  };
  });
}
