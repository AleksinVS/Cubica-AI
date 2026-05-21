import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";
import type {
  GameManifestDeterministicActionMetadata,
  GameManifestDeterministicMetricCondition,
  GameManifestDeterministicMetricDelta,
  GameManifestTemplateMap,
  JsonLogicExpression
} from "@cubica/contracts-manifest";
import jsonLogic from "json-logic-js";

type RuntimeState = Record<string, unknown>;

type CapabilityFamily = "runtime.server" | "ui.panel" | "ui.screen" | "unknown";
type DeterministicHandlerMode = "capability" | "manifest-action";

interface DeterministicHandlerOptions {
  mode?: DeterministicHandlerMode;
  templates?: GameManifestTemplateMap;
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
  templates: GameManifestTemplateMap | undefined
): Record<string, unknown> => {
  if (!action.templateId || !templates) {
    return action.raw || {};
  }

  const template = templates[action.templateId];
  if (!isObjectRecord(template)) {
    return action.raw || {};
  }

  // Step 1: Resolve the template with params (substitute {{param}} placeholders).
  const resolvedTemplate = isObjectRecord(action.params)
    ? resolveValue(template, action.params)
    : template;

  // Step 2: Extract the action's deterministic overrides. Some migrated
  // actions still carry direct metadata (for example audit flags) while bounded
  // gameplay details live under `overrides.deterministic`; both shapes must be
  // merged instead of choosing one and silently dropping the other.
  const raw = action.raw || {};
  const directDeterministic = isObjectRecord(raw.deterministic) ? raw.deterministic : {};
  const overrideDeterministic =
    isObjectRecord(raw.overrides) && isObjectRecord(raw.overrides.deterministic)
      ? raw.overrides.deterministic
      : {};
  const actionDeterministic = { ...directDeterministic, ...overrideDeterministic };


  // Step 3: If no overrides, return the resolved template as-is.
  if (!isObjectRecord(resolvedTemplate.deterministic)) {
    return { deterministic: resolvedTemplate.deterministic };
  }

  // Step 4: Deep merge — action deterministic overrides take precedence.
  // Top-level deterministic fields: action replaces template.
  const templateDet = resolvedTemplate.deterministic as Record<string, unknown>;
  const mergedDeterministic = { ...templateDet, ...actionDeterministic };

  // Guard: deep merge so action can override individual guard fields
  // (e.g., adding stateConditions or overriding timeline).
  const directGuard = isObjectRecord(directDeterministic.guard) ? directDeterministic.guard : {};
  const overrideGuard = isObjectRecord(overrideDeterministic.guard) ? overrideDeterministic.guard : {};
  const actionGuard = { ...directGuard, ...overrideGuard };
  if (isObjectRecord(templateDet.guard) && Object.keys(actionGuard).length > 0) {
    mergedDeterministic.guard = { ...templateDet.guard, ...actionGuard };
  } else if (Object.keys(actionGuard).length > 0) {
    // Action has guard but template doesn't (or template guard is not an object).
    mergedDeterministic.guard = actionGuard;
  }

  // StateUpdate: deep merge so action can add/override individual fields
  // (e.g., adding activeInfoId or selectedCardId).
  const directStateUpdate = isObjectRecord(directDeterministic.stateUpdate) ? directDeterministic.stateUpdate : {};
  const overrideStateUpdate = isObjectRecord(overrideDeterministic.stateUpdate) ? overrideDeterministic.stateUpdate : {};
  const actionStateUpdate = { ...directStateUpdate, ...overrideStateUpdate };
  if (isObjectRecord(templateDet.stateUpdate) && Object.keys(actionStateUpdate).length > 0) {
    mergedDeterministic.stateUpdate = { ...templateDet.stateUpdate, ...actionStateUpdate };
  } else if (Object.keys(actionStateUpdate).length > 0) {
    mergedDeterministic.stateUpdate = actionStateUpdate;
  }

  return { deterministic: mergedDeterministic };
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
  templates?: GameManifestTemplateMap
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

const countResolvedCards = (cards: Record<string, any>, cardIds: Array<string>) => {
  let resolvedCount = 0;
  for (const cardId of cardIds) {
    const cardState = ensureObject(cards[cardId]);
    if (cardState.resolved === true) {
      resolvedCount++;
    }
  }
  return resolvedCount;
};

const readMetricValue = (state: RuntimeState, metricId: string) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);
  return typeof metrics[metricId] === "number" ? (metrics[metricId] as number) : 0;
};

const evaluateMetricCondition = (
  state: RuntimeState,
  condition: { metricId: string; operator: string; threshold: number | string }
) => {
  const metricValue = readMetricValue(state, condition.metricId);
  const threshold = typeof condition.threshold === "string" ? Number(condition.threshold) : condition.threshold;

  switch (condition.operator) {
    case ">":
      return metricValue > threshold;
    case ">=":
      return metricValue >= threshold;
    case "<":
      return metricValue < threshold;
    case "<=":
      return metricValue <= threshold;
    case "==":
      return metricValue === threshold;
    case "!=":
      return metricValue !== threshold;
  }

  return metricValue === threshold;
};

const evaluateManifestGuard = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata
): Array<string> => {
  const failures: Array<string> = [];
  const guard = metadata.guard;

  if (!guard) {
    return failures;
  }

  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);

  if (guard.timeline?.line !== undefined && timeline.line !== guard.timeline.line) {
    failures.push(`public.timeline.line expected "${guard.timeline.line}"`);
  }

  if (guard.timeline?.stepIndex !== undefined) {
    const expectedStepIndex = typeof guard.timeline.stepIndex === 'string' ? Number(guard.timeline.stepIndex) : guard.timeline.stepIndex;
    if (timeline.stepIndex !== expectedStepIndex) {
      failures.push(`public.timeline.stepIndex expected ${String(expectedStepIndex)}`);
    }
  }

  if (guard.timeline?.canAdvance !== undefined) {
    const expectedCanAdvance = typeof guard.timeline.canAdvance === 'string' ? guard.timeline.canAdvance === 'true' : guard.timeline.canAdvance;
    if (timeline.canAdvance !== expectedCanAdvance) {
      failures.push(`public.timeline.canAdvance expected ${String(expectedCanAdvance)}`);
    }
  }

  if ((guard as any).board) {
    const flags = ensureObject(ensureObject(state.public).flags);
    const cards = ensureObject(flags.cards);
    const resolvedCount = countResolvedCards(cards, (guard as any).board.cardIds);

    if (
      (guard as any).board.resolvedCountAtLeast !== undefined &&
      resolvedCount < (guard as any).board.resolvedCountAtLeast
    ) {
      failures.push(
        `public.flags.cards resolved count for board [${(guard as any).board.cardIds.join(", ")}] expected >= ${(guard as any).board.resolvedCountAtLeast} (got ${resolvedCount})`
      );
    }
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

  // Semantic guard: card — checks card state in public.flags.cards[card.id]
  if ((guard as any).card) {
    const cardGuard = (guard as any).card;
    const flags = ensureObject(publicState.flags);
    const cards = ensureObject(flags.cards);
    const cardState = ensureObject(cards[cardGuard.id]);

    if (cardGuard.selected !== undefined && cardState.selected !== cardGuard.selected) {
      failures.push(`card[${cardGuard.id}].selected expected ${cardGuard.selected}`);
    }
    if (cardGuard.resolved !== undefined && cardState.resolved !== cardGuard.resolved) {
      failures.push(`card[${cardGuard.id}].resolved expected ${cardGuard.resolved}`);
    }
    if (cardGuard.locked !== undefined && cardState.locked !== cardGuard.locked) {
      failures.push(`card[${cardGuard.id}].locked expected ${cardGuard.locked}`);
    }
    if (cardGuard.available !== undefined && cardState.available !== cardGuard.available) {
      failures.push(`card[${cardGuard.id}].available expected ${cardGuard.available}`);
    }
  }

  // Semantic guard: opening — checks secret.opening.selectedCardId
  if ((guard as any).opening) {
    const openingGuard = (guard as any).opening;
    const secret = ensureObject((state as any).secret);
    const opening = ensureObject(secret.opening);
    const selectedCardId = opening.selectedCardId as string | undefined;

    if (openingGuard.selectedCardIdAbsent === true) {
      if (selectedCardId !== undefined && selectedCardId !== null) {
        failures.push(`opening.selectedCardId expected absent, got "${selectedCardId}"`);
      }
    }
    if (openingGuard.selectedCardIdEquals !== undefined) {
      if (String(selectedCardId) !== String(openingGuard.selectedCardIdEquals)) {
        failures.push(`opening.selectedCardId expected "${openingGuard.selectedCardIdEquals}", got "${String(selectedCardId)}"`);
      }
    }
  }

  // Semantic guard: team — checks public.flags.team[memberId]
  if ((guard as any).team) {
    const teamGuard = (guard as any).team;
    const flags = ensureObject(publicState.flags);
    const team = ensureObject(flags.team);
    const memberState = ensureObject(team[teamGuard.memberId]);

    if (teamGuard.selected !== undefined && memberState.selected !== teamGuard.selected) {
      failures.push(`team[${teamGuard.memberId}].selected expected ${teamGuard.selected}`);
    }
  }

  // Semantic guard: teamSelection — checks public.teamSelection.pickCount
  if ((guard as any).teamSelection) {
    const tsGuard = (guard as any).teamSelection;
    const teamSelection = ensureObject(publicState.teamSelection);
    const pickCount = Number(teamSelection.pickCount) || 0;

    if (tsGuard.pickCountLessThan !== undefined && pickCount >= tsGuard.pickCountLessThan) {
      failures.push(`teamSelection.pickCount expected < ${tsGuard.pickCountLessThan}, got ${pickCount}`);
    }
    if (tsGuard.pickCountEquals !== undefined && pickCount !== tsGuard.pickCountEquals) {
      failures.push(`teamSelection.pickCount expected ${tsGuard.pickCountEquals}, got ${pickCount}`);
    }
  }

  // Tier 2 guard: JsonLogic expression evaluation
  if ((guard as any).jsonLogic) {
    const result = jsonLogic.apply((guard as any).jsonLogic, state);
    if (!result) {
      failures.push(`JsonLogic guard evaluated to false`);
    }
  }

  return failures;
};

const applyMetricDeltas = (state: RuntimeState, deltas: Array<GameManifestDeterministicMetricDelta>) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);

  for (const delta of deltas) {
    const current = typeof metrics[delta.metricId] === "number" ? (metrics[delta.metricId] as number) : 0;
    // Resolve delta value: number literal, template string, or JsonLogic expression.
    let deltaValue: number;
    if (typeof delta.delta === "number") {
      deltaValue = delta.delta;
    } else if (typeof delta.delta === "string") {
      deltaValue = Number(delta.delta);
    } else if (typeof delta.delta === "object" && delta.delta !== null) {
      // JsonLogic expression — evaluate against the current state.
      deltaValue = Number(jsonLogic.apply(delta.delta as any, state)) || 0;
    } else {
      deltaValue = 0;
    }
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
  if (metadata.metricDeltas) {
    applyMetricDeltas(state, metadata.metricDeltas);
  }

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
  metadata: GameManifestDeterministicActionMetadata,
  metricsBefore?: Record<string, unknown>,
  metricsAfter?: Record<string, unknown>
) => {
  const log = metadata.log;
  const logEntry: Record<string, unknown> = {
    actionId: context.actionId,
    kind: log?.kind,
    summary: log?.summary,
    at: context.now.toISOString(),
    legacyProvenance: metadata.provenance ? metadata.provenance.map((item) => ({ ...item })) : []
  };

  if (log?.stageId !== undefined) {
    logEntry.stageId = log.stageId;
  }

  if (log?.displayMode !== undefined) {
    logEntry.displayMode = log.displayMode;
  }

  if (log?.entityType !== undefined) {
    logEntry.entityType = log.entityType;
  }

  if (log?.cardId !== undefined) {
    logEntry.cardId = log.cardId;
  }

  if (log?.backText !== undefined) {
    logEntry.backText = log.backText;
  }

  if (metricsBefore) {
    logEntry.metricsBefore = metricsBefore;
  }

  if (metricsAfter) {
    logEntry.metricsAfter = metricsAfter;
  }

  if (metricsBefore && metricsAfter) {
    const deltas: Array<{ metricId: string; delta: number }> = [];
    const allKeys = new Set([...Object.keys(metricsBefore), ...Object.keys(metricsAfter)]);
    for (const key of allKeys) {
      const before = typeof metricsBefore[key] === "number" ? (metricsBefore[key] as number) : 0;
      const after = typeof metricsAfter[key] === "number" ? (metricsAfter[key] as number) : 0;
      const delta = after - before;
      if (delta !== 0) {
        deltas.push({ metricId: key, delta });
      }
    }
    if (deltas.length > 0) {
      logEntry.metricDeltas = deltas;
    }
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
  const stateUpdate = metadata.stateUpdate;
  if (!stateUpdate) {
    return;
  }

  // 1. Process Manual Updates (Timeline, etc.)
  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);

  if (stateUpdate.timelineCanAdvance !== undefined) {
    const nextCanAdvance = typeof stateUpdate.timelineCanAdvance === 'string' ? stateUpdate.timelineCanAdvance === 'true' : stateUpdate.timelineCanAdvance;
    timeline.canAdvance = nextCanAdvance;
  }
  if (stateUpdate.timelineStepIndex !== undefined) {
    const nextStepIndex = typeof stateUpdate.timelineStepIndex === 'string' ? Number(stateUpdate.timelineStepIndex) : stateUpdate.timelineStepIndex;
    timeline.stepIndex = nextStepIndex;
    timeline.step_index = nextStepIndex;
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

  // Sync references
  publicState.timeline = timeline;
  state.public = publicState;

  if (stateUpdate.selectedCardId !== undefined) {
    const secretState = ensureObject(state.secret);
    const opening = ensureObject(secretState.opening);
    opening.selectedCardId = stateUpdate.selectedCardId;
    secretState.opening = opening;
    state.secret = secretState;
  }

  // 2. Process Generic State Patches
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
        current[lastPart] = (Number(current[lastPart]) || 0) + Number(patch.value);
      } else if (patch.op === "append") {
        if (!Array.isArray(current[lastPart])) {
          current[lastPart] = [];
        }
        (current[lastPart] as Array<unknown>).push(patch.value);
      }
    }
  }

  // 3. Process Semantic State Updates (cardFlags, teamFlags, teamSelection)
  const publicStateFinal = ensureObject(state.public);
  const flags = ensureObject(publicStateFinal.flags);
  const cards = ensureObject(flags.cards);

  // cardFlags: update card state in public.flags.cards[cardId]
  if ((stateUpdate as any).cardFlags) {
    const cf = (stateUpdate as any).cardFlags;
    const cardId = cf.cardId;
    if (cardId !== undefined) {
      const cardState = ensureObject(cards[cardId]);
      if (cf.selected !== undefined) cardState.selected = cf.selected;
      if (cf.resolved !== undefined) cardState.resolved = cf.resolved;
      if (cf.locked !== undefined) cardState.locked = cf.locked;
      if (cf.available !== undefined) cardState.available = cf.available;
      cards[cardId] = cardState;
    }
  }

  // teamFlags: update team member state in public.flags.team[memberId]
  if ((stateUpdate as any).teamFlags) {
    const tf = (stateUpdate as any).teamFlags;
    const memberId = tf.memberId;
    if (memberId !== undefined) {
      const team = ensureObject(flags.team);
      const memberState = ensureObject(team[memberId]);
      if (tf.selected !== undefined) memberState.selected = tf.selected;
      team[memberId] = memberState;
      flags.team = team;
    }
  }

  // teamSelection: update pickCount and selectedMemberIds
  if ((stateUpdate as any).teamSelection) {
    const ts = (stateUpdate as any).teamSelection;
    const teamSelection = ensureObject(publicStateFinal.teamSelection);
    if (ts.pickCountDelta !== undefined) {
      teamSelection.pickCount = (Number(teamSelection.pickCount) || 0) + Number(ts.pickCountDelta);
    }
    if (ts.selectedMemberIdsAppend !== undefined) {
      if (!Array.isArray(teamSelection.selectedMemberIds)) {
        teamSelection.selectedMemberIds = [];
      }
      (teamSelection.selectedMemberIds as Array<unknown>).push(ts.selectedMemberIdsAppend);
    }
    publicStateFinal.teamSelection = teamSelection;
  }

  if ((stateUpdate as any).boardCardUnlock) {
    const board = (stateUpdate as any).boardCardUnlock;
    const resolvedCount = countResolvedCards(cards, board.cardIds);

    if (resolvedCount >= board.resolvedCountAtLeast) {
      const unlessCardId = board.unlessCardAvailable;
      const shouldUnlock = !unlessCardId || (cards[unlessCardId] && (cards[unlessCardId] as any).available !== true);
      if (shouldUnlock) {
        const unlockCardId = board.unlockCardId;
        const unlockCardState = ensureObject(cards[unlockCardId]);
        unlockCardState.locked = false;
        unlockCardState.available = true;
        cards[unlockCardId] = unlockCardState;
      }
    }
  }

  if (
    (stateUpdate as any).boardEntryAltCardSwap &&
    evaluateMetricCondition(state, (stateUpdate as any).boardEntryAltCardSwap.when)
  ) {
    const swap = (stateUpdate as any).boardEntryAltCardSwap;
    const baseCardState = ensureObject(cards[swap.baseCardId]);
    baseCardState.available = false;
    cards[swap.baseCardId] = baseCardState;

    const altCardState = ensureObject(cards[swap.altCardId]);
    altCardState.locked = false;
    altCardState.available = true;
    cards[swap.altCardId] = altCardState;
  }

  if ((stateUpdate as any).boardThreshold) {
    const board = (stateUpdate as any).boardThreshold;
    const resolvedCount = countResolvedCards(cards, board.cardIds);

    if (resolvedCount >= board.resolvedCountAtLeast) {
      const timelineFinal = ensureObject(publicStateFinal.timeline);
      timelineFinal.canAdvance = board.timelineCanAdvance ?? true;
      publicStateFinal.timeline = timelineFinal;
    }
  }

  flags.cards = cards;
  publicStateFinal.flags = flags;
  state.public = publicStateFinal;
};

const buildManifestActionTransition = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily,
  templates?: GameManifestTemplateMap
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

  const publicStateBefore = ensureObject(nextState.public);
  const metricsBefore = { ...ensureObject(publicStateBefore.metrics) };

  applyManifestMetricDeltas(nextState, metadata);

  const publicStateAfter = ensureObject(nextState.public);
  const metricsAfter = { ...ensureObject(publicStateAfter.metrics) };

  // `public.log` is the runtime audit trail used by integration checks and by
  // presenters. Player-facing journal views filter card-resolution entries in
  // the frontend, so runtime keeps every deterministic action auditable.
  const skipLog = false;
  let logEntry: Record<string, unknown> | null = null;
  if (!skipLog) {
    logEntry = appendManifestLogEntry(nextState, context, metadata, metricsBefore, metricsAfter);
  }

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

  const effects: Array<RuntimeActionEffect> = [effect];
  if (logEntry) {
    effects.push({ kind: "log", target: "public.log", data: logEntry as Record<string, unknown> });
  }

  return {
    ok: true,
    delta: {
      state: nextState
    },
    effects
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
