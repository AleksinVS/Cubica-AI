import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";

type RuntimeState = Record<string, unknown>;

const UI_EFFECTS: Record<string, { kind: string; target: string; value: string }> = {
  requestServer: { kind: "ui", target: "server", value: "requested" },
  showHint: { kind: "ui", target: "panel", value: "hint" },
  showHistory: { kind: "ui", target: "panel", value: "history" },
  showTopBar: { kind: "ui", target: "panel", value: "top-bar" },
  showScreenWithLeftSideBar: { kind: "ui", target: "screen", value: "left-sidebar" }
};

const ensureObject = (value: unknown): RuntimeState =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RuntimeState) : {};

const cloneState = <TState,>(state: TState): TState => structuredClone(state);

const appendLogEntry = (state: RuntimeState, entry: Record<string, unknown>) => {
  const publicState = ensureObject(state.public);
  const log = Array.isArray(publicState.log) ? [...publicState.log] : [];
  log.push(entry);
  publicState.log = log;
  state.public = publicState;
};

const setRuntimeMetadata = (
  state: RuntimeState,
  context: RuntimeActionContext<RuntimeState>,
  effect: RuntimeActionEffect
) => {
  const runtime = ensureObject(state.runtime);
  runtime.lastActionId = context.actionId;
  runtime.lastActionFunction = context.manifestAction.functionName ?? context.actionId;
  runtime.lastUpdatedAt = context.now.toISOString();
  runtime.lastPayload = context.payload ?? null;
  runtime.lastEffect = effect;
  state.runtime = runtime;
};

const buildTransition = (context: RuntimeActionContext<RuntimeState>): RuntimeActionResult<RuntimeState> => {
  const effect = UI_EFFECTS[context.manifestAction.functionName ?? context.actionId] ?? {
    kind: "runtime",
    target: "session",
    value: context.actionId
  };
  const nextState = cloneState(context.state);
  const logEntry = {
    actionId: context.actionId,
    functionName: context.manifestAction.functionName ?? context.actionId,
    handlerType: context.manifestAction.handlerType,
    at: context.now.toISOString(),
    payload: context.payload ?? null
  };

  appendLogEntry(nextState, logEntry);
  setRuntimeMetadata(nextState, context, effect);

  return {
    ok: true,
    delta: {
      state: nextState
    },
    effects: [effect, { kind: "log", target: "public.log", data: logEntry }]
  };
};

export function createDeterministicHandler(): RuntimeActionHandler<RuntimeState> {
  return (context) => buildTransition(context);
}
