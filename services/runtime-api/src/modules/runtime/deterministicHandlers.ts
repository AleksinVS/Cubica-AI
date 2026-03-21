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

  if (condition.operator === ">") {
    return metricValue > condition.threshold;
  }

  if (condition.operator === "<") {
    return metricValue < condition.threshold;
  }

  return metricValue === condition.threshold;
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

    if (guard.card.locked !== undefined && cardState.locked !== guard.card.locked) {
      failures.push(`public.flags.cards["${guard.card.id}"].locked expected ${String(guard.card.locked)}`);
    }

    if (guard.card.available !== undefined && cardState.available !== guard.card.available) {
      failures.push(`public.flags.cards["${guard.card.id}"].available expected ${String(guard.card.available)}`);
    }
  }

  if (guard.teamSelection) {
    const teamSelection = readTeamSelectionState(state);
    const pickCount = typeof teamSelection.pickCount === "number" ? teamSelection.pickCount : 0;

    if (
      guard.teamSelection.pickCountLessThan !== undefined &&
      !(pickCount < guard.teamSelection.pickCountLessThan)
    ) {
      failures.push(`public.teamSelection.pickCount expected < ${guard.teamSelection.pickCountLessThan}`);
    }

    if (
      guard.teamSelection.pickCountEquals !== undefined &&
      pickCount !== guard.teamSelection.pickCountEquals
    ) {
      failures.push(`public.teamSelection.pickCount expected ${guard.teamSelection.pickCountEquals}`);
    }
  }

  if (guard.team) {
    const teamMemberState = readTeamMemberState(state, guard.team.memberId);

    if (guard.team.selected !== undefined && teamMemberState.selected !== guard.team.selected) {
      failures.push(`public.flags.team["${guard.team.memberId}"].selected expected ${String(guard.team.selected)}`);
    }
  }

  if (guard.board) {
    const resolvedCount = countResolvedCards(state, guard.board.cardIds);

    if (
      guard.board.resolvedCountAtLeast !== undefined &&
      resolvedCount < guard.board.resolvedCountAtLeast
    ) {
      failures.push(
        `public.flags.cards resolved count for board [${guard.board.cardIds.join(", ")}] expected >= ${guard.board.resolvedCountAtLeast} (got ${resolvedCount})`
      );
    }
  }

  return failures;
};

const applyMetricDeltas = (state: RuntimeState, deltas: Array<GameManifestDeterministicMetricDelta>) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);

  for (const delta of deltas) {
    const current = typeof metrics[delta.metricId] === "number" ? (metrics[delta.metricId] as number) : 0;
    const nextValue = current + delta.delta;
    metrics[delta.metricId] = Math.round(nextValue * 1_000_000) / 1_000_000;
  }

  publicState.metrics = metrics;
  state.public = publicState;
};

const recalculateDerivedMetrics = (state: RuntimeState) => {
  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);
  const time = typeof metrics.time === "number" ? metrics.time : 0;
  metrics.score = 60 - time;
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

  for (const bonus of metadata.conditionalCardBonuses ?? []) {
    if (evaluateCardCondition(state, bonus.whenCard)) {
      applyMetricDeltas(state, bonus.metricDeltas);
    }
  }

  recalculateDerivedMetrics(state);
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
  conditionalLineSwitch: GameManifestDeterministicActionMetadata["conditionalLineSwitch"] | null = null
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

    if (stateUpdate.cardFlags.locked !== undefined) {
      cardState.locked = stateUpdate.cardFlags.locked;
    }

    if (stateUpdate.cardFlags.available !== undefined) {
      cardState.available = stateUpdate.cardFlags.available;
    }

    writeCardState(cards, cardId, cardState);
  }

  if (stateUpdate.teamFlags) {
    const memberId = stateUpdate.teamFlags.memberId;
    const flagsTeam = ensureObject(flags.team);
    const teamMemberState = ensureObject(flagsTeam[memberId]);

    if (stateUpdate.teamFlags.selected !== undefined) {
      teamMemberState.selected = stateUpdate.teamFlags.selected;
    }

    flagsTeam[memberId] = teamMemberState;
    flags.team = flagsTeam;
  }

  if (stateUpdate.boardCardUnlock) {
    const resolvedCount = countResolvedCards(state, stateUpdate.boardCardUnlock.cardIds);

    // GSR-023 keeps the entry-time 39 -> 3902 swap as a board-local snapshot
    // under the bounded-manifest architecture from ADR-024.
    // Once 3902 is exposed, the later unlock threshold must not re-enable base card 39.
    const alt3902State =
      stateUpdate.boardCardUnlock.unlockCardId === "39" ? readCardState(state, "3902") : null;

    if (
      resolvedCount >= stateUpdate.boardCardUnlock.resolvedCountAtLeast &&
      alt3902State?.available !== true
    ) {
      const unlockCardState = ensureObject(cards[stateUpdate.boardCardUnlock.unlockCardId]);
      unlockCardState.locked = false;
      unlockCardState.available = true;
      writeCardState(cards, stateUpdate.boardCardUnlock.unlockCardId, unlockCardState);
    }
  }

  if (
    stateUpdate.boardEntryAltCardSwap &&
    evaluateMetricCondition(state, stateUpdate.boardEntryAltCardSwap.when)
  ) {
    const baseCardState = ensureObject(cards[stateUpdate.boardEntryAltCardSwap.baseCardId]);
    baseCardState.available = false;
    writeCardState(cards, stateUpdate.boardEntryAltCardSwap.baseCardId, baseCardState);

    const altCardState = ensureObject(cards[stateUpdate.boardEntryAltCardSwap.altCardId]);
    altCardState.locked = false;
    altCardState.available = true;
    writeCardState(cards, stateUpdate.boardEntryAltCardSwap.altCardId, altCardState);
  }

  if (stateUpdate.boardThreshold) {
    const resolvedCount = countResolvedCards(state, stateUpdate.boardThreshold.cardIds);

    if (resolvedCount >= stateUpdate.boardThreshold.resolvedCountAtLeast) {
      timeline.canAdvance = stateUpdate.boardThreshold.timelineCanAdvance ?? true;
    }
  }

  flags.cards = cards;
  publicState.flags = flags;
  publicState.timeline = timeline;

  if (stateUpdate.teamSelection) {
    const teamSelection = ensureObject(publicState.teamSelection);
    const currentPickCount = typeof teamSelection.pickCount === "number" ? teamSelection.pickCount : 0;

    if (
      stateUpdate.teamSelection.pickCountDelta !== undefined &&
      stateUpdate.teamSelection.selectedMemberIdsAppend === undefined
    ) {
      teamSelection.pickCount = currentPickCount + stateUpdate.teamSelection.pickCountDelta;
    }

    if (stateUpdate.teamSelection.selectedMemberIdsAppend !== undefined) {
      const selectedMemberIds = Array.isArray(teamSelection.selectedMemberIds)
        ? [...teamSelection.selectedMemberIds]
        : [];
      selectedMemberIds.push(stateUpdate.teamSelection.selectedMemberIdsAppend);
      teamSelection.selectedMemberIds = selectedMemberIds;
      teamSelection.pickCount = currentPickCount + (stateUpdate.teamSelection.pickCountDelta ?? 1);
    }

    publicState.teamSelection = teamSelection;
  }

  state.public = publicState;

  if (stateUpdate.selectedCardId !== undefined) {
    const secretState = ensureObject(state.secret);
    const opening = ensureObject(secretState.opening);
    opening.selectedCardId = stateUpdate.selectedCardId;
    secretState.opening = opening;
    state.secret = secretState;
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

    if (conditionalLineSwitch.timelineCanAdvance !== undefined) {
      timeline.canAdvance = conditionalLineSwitch.timelineCanAdvance;
    }
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
  const conditionalLineSwitch = resolveConditionalLineSwitch(context.state, metadata);
  applyManifestMetricDeltas(nextState, metadata);
  const logEntry = appendManifestLogEntry(nextState, context, metadata);
  applyManifestStateUpdate(nextState, metadata, conditionalLineSwitch);

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
