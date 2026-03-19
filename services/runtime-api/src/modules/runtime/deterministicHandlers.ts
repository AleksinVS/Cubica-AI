import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";

type RuntimeState = Record<string, unknown>;

type CapabilityFamily = "runtime.server" | "ui.panel" | "ui.screen" | "unknown";

const ensureObject = (value: unknown): RuntimeState =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RuntimeState) : {};

const cloneState = <TState,>(state: TState): TState => structuredClone(state);

const resolveCapabilityFamily = (capabilityFamily?: string, capability?: string): CapabilityFamily => {
  const source = capabilityFamily ?? capability ?? "";

  if (source.startsWith("runtime.server")) {
    return "runtime.server";
  }

  if (source.startsWith("ui.panel")) {
    return "ui.panel";
  }

  if (source.startsWith("ui.screen")) {
    return "ui.screen";
  }

  return "unknown";
};

const resolveCapabilityLeaf = (capability?: string, fallback?: string) => {
  const source = capability ?? fallback ?? "unknown";
  const segments = source.split(".");
  return segments[segments.length - 1] || "unknown";
};

const appendLogEntry = (state: RuntimeState, entry: Record<string, unknown>) => {
  const publicState = ensureObject(state.public);
  const log = Array.isArray(publicState.log) ? [...publicState.log] : [];
  log.push(entry);
  publicState.log = log;
  state.public = publicState;
};

const ensureUiState = (state: RuntimeState) => {
  const publicState = ensureObject(state.public);
  const uiState = ensureObject(publicState.ui);
  publicState.ui = uiState;
  state.public = publicState;
  return uiState;
};

const setRuntimeMetadata = (
  state: RuntimeState,
  context: RuntimeActionContext<RuntimeState>,
  effect: RuntimeActionEffect,
  capabilityFamily: CapabilityFamily
) => {
  const runtime = ensureObject(state.runtime);
  runtime.lastActionId = context.actionId;
  runtime.lastActionFunction = context.manifestAction.functionName ?? context.actionId;
  runtime.lastCapabilityFamily = capabilityFamily;
  runtime.lastCapability = context.manifestAction.capability ?? context.manifestAction.functionName ?? context.actionId;
  runtime.lastUpdatedAt = context.now.toISOString();
  runtime.lastPayload = context.payload ?? null;
  runtime.lastEffect = effect;
  state.runtime = runtime;
};

const buildCapabilityEffect = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily
): RuntimeActionEffect => {
  const capabilityLeaf = resolveCapabilityLeaf(
    context.manifestAction.capability,
    context.manifestAction.functionName ?? context.actionId
  );

  if (capabilityFamily === "runtime.server") {
    return {
      kind: "runtime",
      target: "server",
      value: "requested",
      data: {
        capability: context.manifestAction.capability,
        family: capabilityFamily
      }
    };
  }

  if (capabilityFamily === "ui.panel") {
    return {
      kind: "ui",
      target: "panel",
      value: capabilityLeaf,
      data: {
        capability: context.manifestAction.capability,
        family: capabilityFamily
      }
    };
  }

  if (capabilityFamily === "ui.screen") {
    return {
      kind: "ui",
      target: "screen",
      value: capabilityLeaf,
      data: {
        capability: context.manifestAction.capability,
        family: capabilityFamily
      }
    };
  }

  return {
    kind: "runtime",
    target: "session",
    value: context.actionId,
    data: {
      capability: context.manifestAction.capability,
      family: capabilityFamily
    }
  };
};

const buildTransition = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily
): RuntimeActionResult<RuntimeState> => {
  const effect = buildCapabilityEffect(context, capabilityFamily);
  const nextState = cloneState(context.state);
  const capabilityLeaf = resolveCapabilityLeaf(
    context.manifestAction.capability,
    context.manifestAction.functionName ?? context.actionId
  );
  const logEntry = {
    actionId: context.actionId,
    capability: context.manifestAction.capability,
    capabilityFamily,
    functionName: context.manifestAction.functionName ?? context.actionId,
    at: context.now.toISOString(),
    payload: context.payload ?? null
  };

  appendLogEntry(nextState, logEntry);

  const uiState = ensureUiState(nextState);
  uiState.lastCapabilityFamily = capabilityFamily;
  uiState.lastCapability = context.manifestAction.capability ?? context.actionId;

  if (capabilityFamily === "ui.panel") {
    uiState.activePanel = capabilityLeaf;
  } else if (capabilityFamily === "ui.screen") {
    uiState.activeScreen = capabilityLeaf;
  } else if (capabilityFamily === "runtime.server") {
    uiState.serverRequested = true;
  }

  setRuntimeMetadata(nextState, context, effect, capabilityFamily);

  return {
    ok: true,
    delta: {
      state: nextState
    },
    effects: [effect, { kind: "log", target: "public.log", data: logEntry }]
  };
};

export function createDeterministicHandler(capabilityFamily: CapabilityFamily): RuntimeActionHandler<RuntimeState> {
  return (context) => buildTransition(context, capabilityFamily);
}

export function resolveActionCapabilityFamily(
  capabilityFamily?: string,
  capability?: string
): CapabilityFamily {
  return resolveCapabilityFamily(capabilityFamily, capability);
}
