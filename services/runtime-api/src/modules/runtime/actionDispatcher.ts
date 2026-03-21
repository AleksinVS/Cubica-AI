import type {
  DispatchActionInput,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import type { GameBundle } from "../content/manifestLoader.ts";
import { NotFoundError, RequestValidationError } from "../errors.ts";
import { createRuntimeActionRegistry, getRegisteredActionDefinition } from "./actionRegistry.ts";

type RuntimeState = Record<string, unknown>;
const RUNTIME_VALIDATION_ERROR_CODES = new Set([
  "RUNTIME_ACTION_GUARD_FAILED",
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
  input: DispatchActionInput;
}

export interface DispatchRuntimeActionOutcome {
  snapshot: SessionRecord<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
}

export async function dispatchRuntimeAction(
  options: DispatchRuntimeActionOptions
): Promise<DispatchRuntimeActionOutcome> {
  const current = await options.sessionStore.getSession(options.input.sessionId);

  if (!current) {
    throw new NotFoundError(`Session "${options.input.sessionId}" was not found`);
  }

  const { bundle } = options;
  const definition = getRegisteredActionDefinition(bundle, options.input.actionId);

  if (!definition) {
    throw new RequestValidationError(
      `Action "${options.input.actionId}" is not defined for game "${current.gameId}"`
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
    payload: options.input.payload,
    state: current.state,
    now: new Date(),
    manifestAction: definition
  });

  if (!result.ok) {
    const message = result.error?.message ?? `Action "${options.input.actionId}" did not produce a state transition`;
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

  await options.sessionStore.updateSession(snapshot);

  return {
    snapshot,
    result
  };
}
