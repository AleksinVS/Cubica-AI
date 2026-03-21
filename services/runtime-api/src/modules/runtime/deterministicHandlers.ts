import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";
import type { GameManifestDeterministicActionMetadata } from "@cubica/contracts-manifest";

type RuntimeState = Record<string, unknown>;

type CapabilityFamily = "runtime.server" | "ui.panel" | "ui.screen" | "unknown";
type DeterministicHandlerMode = "capability" | "manifest-action";

interface DeterministicHandlerOptions {
  mode?: DeterministicHandlerMode;
}

const ensureObject = (value: unknown): RuntimeState =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RuntimeState) : {};

const cloneState = <TState,>(state: TState): TState => structuredClone(state);
const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

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

const readManifestDeterministicMetadata = (
  context: RuntimeActionContext<RuntimeState>
): GameManifestDeterministicActionMetadata | null => {
  const raw = context.manifestAction.raw;
  if (!isObjectRecord(raw) || !isObjectRecord(raw.deterministic)) {
    return null;
  }

  return raw.deterministic as unknown as GameManifestDeterministicActionMetadata;
};

const readCardState = (state: RuntimeState, cardId: string) => {
  const publicState = ensureObject(state.public);
  const flags = ensureObject(publicState.flags);
  const cards = ensureObject(flags.cards);
  return ensureObject(cards[cardId]);
};

const evaluateManifestGuard = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
): Array<string> => {
  const failures: Array<string> = [];
  const guard = metadata.guard;

  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);

  if (guard.timeline?.line !== undefined && timeline.line !== guard.timeline.line) {
    failures.push(`public.timeline.line expected "${guard.timeline.line}"`);
  }

  if (guard.timeline?.stepIndex !== undefined && timeline.stepIndex !== guard.timeline.stepIndex) {
    failures.push(`public.timeline.stepIndex expected ${guard.timeline.stepIndex}`);
  }

  if (guard.timeline?.canAdvance !== undefined && timeline.canAdvance !== guard.timeline.canAdvance) {
    failures.push(`public.timeline.canAdvance expected ${String(guard.timeline.canAdvance)}`);
  }

  const secretState = ensureObject(state.secret);
  const opening = ensureObject(secretState.opening);

  if (guard.opening?.selectedCardIdAbsent === true && opening.selectedCardId !== undefined) {
    failures.push("secret.opening.selectedCardId must be absent");
  }

  if (guard.opening?.selectedCardIdEquals !== undefined && opening.selectedCardId !== guard.opening.selectedCardIdEquals) {
    failures.push(`secret.opening.selectedCardId expected "${guard.opening.selectedCardIdEquals}"`);
  }

  if (guard.card) {
    const cardState = readCardState(state, guard.card.id);

    if (guard.card.selected !== undefined && cardState.selected !== guard.card.selected) {
      failures.push(`public.flags.cards["${guard.card.id}"].selected expected ${String(guard.card.selected)}`);
    }

    if (guard.card.resolved !== undefined && cardState.resolved !== guard.card.resolved) {
      failures.push(`public.flags.cards["${guard.card.id}"].resolved expected ${String(guard.card.resolved)}`);
    }
  }

  return failures;
};

const applyManifestMetricDeltas = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);

  for (const delta of metadata.metricDeltas) {
    const current = typeof metrics[delta.metricId] === "number" ? (metrics[delta.metricId] as number) : 0;
    metrics[delta.metricId] = current + delta.delta;
  }

  const time = typeof metrics.time === "number" ? metrics.time : 0;
  metrics.score = 60 - time;
  publicState.metrics = metrics;
  state.public = publicState;
};

const appendManifestLogEntry = (
  state: RuntimeState,
  context: RuntimeActionContext<RuntimeState>,
  metadata: GameManifestDeterministicActionMetadata
) => {
  const log = metadata.log;
  const logEntry: Record<string, unknown> = {
    actionId: context.actionId,
    kind: log.kind,
    summary: log.summary,
    at: context.now.toISOString(),
    legacyProvenance: metadata.provenance.map((item) => ({ ...item }))
  };

  if (log.stageId !== undefined) {
    logEntry.stageId = log.stageId;
  }

  if (log.cardId !== undefined) {
    logEntry.cardId = log.cardId;
  }

  appendLogEntry(state, logEntry);

  return logEntry;
};

const applyManifestStateUpdate = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
) => {
  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);
  const flags = ensureObject(publicState.flags);
  const cards = ensureObject(flags.cards);
  const stateUpdate = metadata.stateUpdate;

  if (stateUpdate.timelineCanAdvance !== undefined) {
    timeline.canAdvance = stateUpdate.timelineCanAdvance;
  }
  if (stateUpdate.timelineStepIndex !== undefined) {
    timeline.stepIndex = stateUpdate.timelineStepIndex;
    timeline.step_index = stateUpdate.timelineStepIndex;
  }
  if (stateUpdate.timelineStageId !== undefined) {
    timeline.stageId = stateUpdate.timelineStageId;
    timeline.stage_id = stateUpdate.timelineStageId;
  }
  if (stateUpdate.timelineScreenId !== undefined) {
    timeline.screenId = stateUpdate.timelineScreenId;
    timeline.screen_id = stateUpdate.timelineScreenId;
  }

  if (stateUpdate.cardFlags) {
    const cardId = stateUpdate.cardFlags.cardId;
    const cardState = ensureObject(cards[cardId]);

    if (stateUpdate.cardFlags.selected !== undefined) {
      cardState.selected = stateUpdate.cardFlags.selected;
    }

    if (stateUpdate.cardFlags.resolved !== undefined) {
      cardState.resolved = stateUpdate.cardFlags.resolved;
    }

    cards[cardId] = cardState;
  }

  flags.cards = cards;
  publicState.flags = flags;
  publicState.timeline = timeline;
  state.public = publicState;

  if (stateUpdate.selectedCardId !== undefined) {
    const secretState = ensureObject(state.secret);
    const opening = ensureObject(secretState.opening);
    opening.selectedCardId = stateUpdate.selectedCardId;
    secretState.opening = opening;
    state.secret = secretState;
  }
};

const buildManifestActionTransition = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily
): RuntimeActionResult<RuntimeState> => {
  if (context.manifestAction.handlerType !== "manifest-data") {
    return {
      ok: false,
      error: {
        code: "RUNTIME_ACTION_MANIFEST_UNSUPPORTED",
        message: `Action "${context.actionId}" has unsupported manifest-action handler type "${context.manifestAction.handlerType}"`
      }
    };
  }

  const metadata = readManifestDeterministicMetadata(context);

  if (!metadata) {
    return {
      ok: false,
      error: {
        code: "RUNTIME_ACTION_METADATA_MISSING",
        message: `Action "${context.actionId}" is missing manifest deterministic metadata`
      }
    };
  }

  const guardFailures = evaluateManifestGuard(context.state, metadata);
  if (guardFailures.length > 0) {
    return {
      ok: false,
      error: {
        code: "RUNTIME_ACTION_GUARD_FAILED",
        message: `Action "${context.actionId}" guard failed: ${guardFailures.join("; ")}`
      }
    };
  }

  const nextState = cloneState(context.state);
  applyManifestMetricDeltas(nextState, metadata);
  const logEntry = appendManifestLogEntry(nextState, context, metadata);
  applyManifestStateUpdate(nextState, metadata);

  const effect: RuntimeActionEffect = {
    kind: "runtime",
    target: "deterministic",
    value: context.actionId,
    data: {
      capability: context.manifestAction.capability,
      family: capabilityFamily
    }
  };

  setRuntimeMetadata(nextState, context, effect, capabilityFamily);

  return {
    ok: true,
    delta: {
      state: nextState
    },
    effects: [effect, { kind: "log", target: "public.log", data: logEntry }]
  };
};

export function createDeterministicHandler(
  capabilityFamily: CapabilityFamily,
  options: DeterministicHandlerOptions = {}
): RuntimeActionHandler<RuntimeState> {
  const mode = options.mode ?? "capability";
  if (mode === "manifest-action") {
    return (context) => buildManifestActionTransition(context, capabilityFamily);
  }

  return (context) => buildTransition(context, capabilityFamily);
}

export function resolveActionCapabilityFamily(
  capabilityFamily?: string,
  capability?: string
): CapabilityFamily {
  return resolveCapabilityFamily(capabilityFamily, capability);
}
