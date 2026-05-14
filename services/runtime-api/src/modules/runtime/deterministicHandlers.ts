import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";
import type {
  GameManifestDeterministicActionMetadata,
  GameManifestDeterministicMetricCondition,
  GameManifestDeterministicMetricDelta
} from "@cubica/contracts-manifest";

type RuntimeState = Record<string, unknown>;

type CapabilityFamily = "runtime.server" | "ui.panel" | "ui.screen" | "unknown";
type DeterministicHandlerMode = "capability" | "manifest-action";

interface DeterministicHandlerOptions {
  mode?: DeterministicHandlerMode;
  templates?: Record<string, unknown>;
}

const resolveValue = (value: unknown, params: Record<string, unknown>): any => {
  if (typeof value === "string") {
    const match = value.match(/^\{\{(.+?)\}\}$/);
    if (match) {
      const key = match[1].trim();
      return params[key] !== undefined ? params[key] : value;
    }
    return value.replace(/\{\{(.+?)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      return params[trimmedKey] !== undefined ? String(params[trimmedKey]) : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, params));
  }
  if (isObjectRecord(value)) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = resolveValue(v, params);
    }
    return res;
  }
  return value;
};

const resolveTemplate = (
  action: any,
  templates: Record<string, unknown> | undefined
): Record<string, unknown> => {
  if (!action.templateId || !templates) {
    return action.raw;
  }

  const template = templates[action.templateId];
  if (!isObjectRecord(template)) {
    return action.raw;
  }

  // Deep merge template with action raw (action raw takes precedence)
  const merged = { ...template, ...action.raw };
  if (isObjectRecord(template.deterministic) && isObjectRecord(action.raw.deterministic)) {
    merged.deterministic = { ...template.deterministic, ...action.raw.deterministic };
  }

  // Substitute params
  if (isObjectRecord(action.params)) {
    return resolveValue(merged, action.params);
  }

  return merged;
};

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
  context: RuntimeActionContext<RuntimeState>,
  templates?: Record<string, unknown>
): GameManifestDeterministicActionMetadata | null => {
  const resolved = resolveTemplate(context.manifestAction, templates);

  if (!isObjectRecord(resolved) || !isObjectRecord(resolved.deterministic)) {
    return null;
  }

  return resolved.deterministic as unknown as GameManifestDeterministicActionMetadata;
};

const readCardState = (state: RuntimeState, cardId: string) => {
  const publicState = ensureObject(state.public);
  const flags = ensureObject(publicState.flags);
  const cards = ensureObject(flags.cards);
  return ensureObject(cards[cardId]);
};

const evaluateCardCondition = (
  state: RuntimeState,
  condition: {
    cardId: string;
    selected?: boolean;
    resolved?: boolean;
    locked?: boolean;
    available?: boolean;
  }
) => {
  const cardState = readCardState(state, condition.cardId);

  if (condition.selected !== undefined && cardState.selected !== condition.selected) {
    return false;
  }
  if (condition.resolved !== undefined && cardState.resolved !== condition.resolved) {
    return false;
  }
  if (condition.locked !== undefined && cardState.locked !== condition.locked) {
    return false;
  }
  if (condition.available !== undefined && cardState.available !== condition.available) {
    return false;
  }

  return true;
};

const writeCardState = (cards: RuntimeState, cardId: string, nextCardState: RuntimeState) => {
  cards[cardId] = nextCardState;
};

const countResolvedCards = (state: RuntimeState, cardIds: Array<string>) => {
  let resolvedCount = 0;

  for (const cardId of cardIds) {
    const cardState = readCardState(state, cardId);
    if (cardState.resolved === true) {
      resolvedCount += 1;
    }
  }

  return resolvedCount;
};

const readTeamMemberState = (state: RuntimeState, memberId: string) => {
  const publicState = ensureObject(state.public);
  const flags = ensureObject(publicState.flags);
  const team = ensureObject(flags.team);
  return ensureObject(team[memberId]);
};

const readTeamSelectionState = (state: RuntimeState) => {
  const publicState = ensureObject(state.public);
  return ensureObject(publicState.teamSelection);
};

const readMetricValue = (state: RuntimeState, metricId: string) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);
  return typeof metrics[metricId] === "number" ? (metrics[metricId] as number) : 0;
};

const evaluateMetricCondition = (
  state: RuntimeState,
  condition: GameManifestDeterministicMetricCondition
) => {
  const metricValue = readMetricValue(state, condition.metricId);
  const threshold = typeof condition.threshold === "string" ? Number(condition.threshold) : condition.threshold;

  if (condition.operator === ">") {
    return metricValue > threshold;
  }

  if (condition.operator === "<") {
    return metricValue < threshold;
  }

  return metricValue === threshold;
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

  if (guard.stateConditions) {
    for (const condition of guard.stateConditions) {
      const pathParts = condition.path.split('/');
      let current: unknown = state;
      for (const part of pathParts) {
        if (part === '') continue;
        if (current == null || typeof current !== 'object') {
          current = undefined;
          break;
        }
        current = (current as Record<string, unknown>)[part];
      }
      
      const value = current;
      const expected = condition.value;
      
      let conditionMet = false;
      switch (condition.operator) {
        case "==": conditionMet = value === expected; break;
        case "!=": conditionMet = value !== expected; break;
        case ">": conditionMet = typeof value === 'number' && typeof expected === 'number' && value > expected; break;
        case ">=": conditionMet = typeof value === 'number' && typeof expected === 'number' && value >= expected; break;
        case "<": conditionMet = typeof value === 'number' && typeof expected === 'number' && value < expected; break;
        case "<=": conditionMet = typeof value === 'number' && typeof expected === 'number' && value <= expected; break;
        case "exists": conditionMet = value !== undefined && value !== null; break;
        case "not_exists": conditionMet = value === undefined || value === null; break;
      }
      
      if (!conditionMet) {
        failures.push(`Condition failed: ${condition.path} ${condition.operator} ${String(expected)} (actual: ${String(value)})`);
      }
    }
  }

  return failures;
};

const applyMetricDeltas = (state: RuntimeState, deltas: Array<GameManifestDeterministicMetricDelta>) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);

  for (const delta of deltas) {
    const current = typeof metrics[delta.metricId] === "number" ? (metrics[delta.metricId] as number) : 0;
    const deltaValue = typeof delta.delta === "string" ? Number(delta.delta) : delta.delta;
    const nextValue = current + deltaValue;
    metrics[delta.metricId] = Math.round(nextValue * 1_000_000) / 1_000_000;
  }

  publicState.metrics = metrics;
  state.public = publicState;
};


const applyManifestMetricDeltas = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
) => {
  applyMetricDeltas(state, metadata.metricDeltas);

  for (const bonus of metadata.conditionalMetricBonuses ?? []) {
    if (evaluateMetricCondition(state, bonus.when)) {
      applyMetricDeltas(state, bonus.metricDeltas);
    }
  }

  for (const bonus of metadata.conditionalStateBonuses ?? []) {
    let allMet = true;
    for (const condition of bonus.when) {
      // Evaluate generic state condition
      const pathParts = condition.path.split('/');
      let current: unknown = state;
      for (const part of pathParts) {
        if (part === '') continue;
        if (current == null || typeof current !== 'object') {
          current = undefined;
          break;
        }
        current = (current as Record<string, unknown>)[part];
      }
      
      const value = current;
      const expected = condition.value;
      
      let conditionMet = false;
      switch (condition.operator) {
        case "==": conditionMet = value === expected; break;
        case "!=": conditionMet = value !== expected; break;
        case ">": conditionMet = typeof value === 'number' && typeof expected === 'number' && value > expected; break;
        case ">=": conditionMet = typeof value === 'number' && typeof expected === 'number' && value >= expected; break;
        case "<": conditionMet = typeof value === 'number' && typeof expected === 'number' && value < expected; break;
        case "<=": conditionMet = typeof value === 'number' && typeof expected === 'number' && value <= expected; break;
        case "exists": conditionMet = value !== undefined && value !== null; break;
        case "not_exists": conditionMet = value === undefined || value === null; break;
      }
      if (!conditionMet) {
        allMet = false;
        break;
      }
    }
    if (allMet) {
      applyMetricDeltas(state, bonus.metricDeltas);
    }
  }

};

const resolveConditionalLineSwitch = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
) => {
  const lineSwitch = metadata.conditionalLineSwitch;
  if (!lineSwitch) {
    return null;
  }

  return evaluateMetricCondition(state, lineSwitch.when) ? lineSwitch : null;
};

const resolveConditionalInfoVariant = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
) => {
  const infoVariant = metadata.conditionalInfoVariant;
  if (!infoVariant) {
    return null;
  }

  return evaluateMetricCondition(state, infoVariant.when) ? infoVariant : null;
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
  metadata: GameManifestDeterministicActionMetadata,
  conditionalLineSwitch: GameManifestDeterministicActionMetadata["conditionalLineSwitch"] | null = null,
  conditionalInfoVariant: GameManifestDeterministicActionMetadata["conditionalInfoVariant"] | null = null
) => {
  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);
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
  if (stateUpdate.activeInfoId !== undefined) {
    timeline.activeInfoId = stateUpdate.activeInfoId;
  }

  if (stateUpdate.selectedCardId !== undefined) {
    const secretState = ensureObject(state.secret);
    const opening = ensureObject(secretState.opening);
    opening.selectedCardId = stateUpdate.selectedCardId;
    secretState.opening = opening;
    state.secret = secretState;
  }

  if (stateUpdate.statePatches) {
    for (const patch of stateUpdate.statePatches) {
      const pathParts = patch.path.split('/');
      let current: Record<string, unknown> = state as Record<string, unknown>;
      
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part === '') continue;
        if (typeof current[part] !== 'object' || current[part] === null) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
      
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart === '') continue;
      
      if (patch.op === "add" || patch.op === "replace") {
        current[lastPart] = patch.value;
      } else if (patch.op === "remove") {
        delete current[lastPart];
      } else if (patch.op === "increment") {
        current[lastPart] = ((current[lastPart] as number) || 0) + (patch.value as number);
      } else if (patch.op === "append") {
        if (!Array.isArray(current[lastPart])) {
          current[lastPart] = [];
        }
        (current[lastPart] as Array<unknown>).push(patch.value);
      }
    }
  }

  publicState.timeline = timeline;
  state.public = publicState;

  if (conditionalInfoVariant) {
    timeline.activeInfoId = conditionalInfoVariant.activeInfoId;
  }

  if (conditionalLineSwitch) {
    timeline.line = conditionalLineSwitch.targetLine;
    timeline.stepIndex = conditionalLineSwitch.targetStepIndex;
    timeline.step_index = conditionalLineSwitch.targetStepIndex;

    if (conditionalLineSwitch.targetStageId !== undefined) {
      timeline.stageId = conditionalLineSwitch.targetStageId;
      timeline.stage_id = conditionalLineSwitch.targetStageId;
    }

    if (conditionalLineSwitch.targetScreenId !== undefined) {
      timeline.screenId = conditionalLineSwitch.targetScreenId;
      timeline.screen_id = conditionalLineSwitch.targetScreenId;
    }
    if (conditionalLineSwitch.targetInfoId !== undefined) {
      timeline.activeInfoId = conditionalLineSwitch.targetInfoId;
    }

    if (conditionalLineSwitch.timelineCanAdvance !== undefined) {
      timeline.canAdvance = conditionalLineSwitch.timelineCanAdvance;
    }
  }
};

const buildManifestActionTransition = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily,
  templates?: Record<string, unknown>
): RuntimeActionResult<RuntimeState> => {
  if (
    context.manifestAction.handlerType !== "manifest-data" &&
    context.manifestAction.handlerType !== "manifest-template"
  ) {
    return {
      ok: false,
      error: {
        code: "RUNTIME_ACTION_MANIFEST_UNSUPPORTED",
        message: `Action "${context.actionId}" has unsupported manifest-action handler type "${context.manifestAction.handlerType}"`
      }
    };
  }

  const metadata = readManifestDeterministicMetadata(context, templates);

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
  const conditionalLineSwitch = resolveConditionalLineSwitch(context.state, metadata);
  const conditionalInfoVariant = resolveConditionalInfoVariant(context.state, metadata);
  applyManifestMetricDeltas(nextState, metadata);
  const logEntry = appendManifestLogEntry(nextState, context, metadata);
  applyManifestStateUpdate(nextState, metadata, conditionalLineSwitch, conditionalInfoVariant);

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
    return (context) => buildManifestActionTransition(context, capabilityFamily, options.templates);
  }

  return (context) => buildTransition(context, capabilityFamily);
}

export function resolveActionCapabilityFamily(
  capabilityFamily?: string,
  capability?: string
): CapabilityFamily {
  return resolveCapabilityFamily(capabilityFamily, capability);
}
