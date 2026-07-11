import type {
  RuntimeActionContext,
  RuntimeActionEffect,
  RuntimeActionHandler,
  RuntimeActionResult
} from "@cubica/contracts-runtime";
import type {
  GameManifestActionDefinition,
  GameManifestDeterministicActionMetadata,
  GameManifestDeterministicCollectionCount,
  GameManifestDeterministicEffect,
  GameManifestDeterministicEffectCondition,
  GameManifestDeterministicMetricCondition,
  GameManifestDeterministicStateCondition,
  GameManifestDeterministicStatePatch,
  GameManifestObjectAttributePatch,
  GameManifestObjectFacetValue,
  GameManifestObjectModelMap,
  GameManifestPlayerRef,
  GameManifestObjectState,
  GameManifestObjectStateGuard,
  GameManifestTransportNetworkModelMap,
  GameManifestTemplateMap,
  JsonLogicExpression
} from "@cubica/contracts-manifest";
import jsonLogic from "json-logic-js";
import {
  rollSessionDice,
  type SessionRandomState
} from "./sessionRandom.ts";
import { applyDeckEffect } from "./deckEffects.ts";
import { applyRankingEffect } from "./rankingEffects.ts";
import { applyTransportEffect } from "./transportNetwork.ts";

type RuntimeState = Record<string, unknown>;

type CapabilityFamily = string;
type DeterministicHandlerMode = "capability" | "manifest-action";

interface DeterministicHandlerOptions {
  mode?: DeterministicHandlerMode;
  objectModels?: GameManifestObjectModelMap;
  networkModels?: GameManifestTransportNetworkModelMap;
  templates?: GameManifestTemplateMap;
  turnPhases?: ReadonlyArray<string>;
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
  // `raw` is the raw manifest action object. It follows the typed
  // GameManifestActionDefinition contract, so `deterministic` and the
  // template `overrides` are read through typed fields (ADR-056: no untyped
  // `raw.overrides` bypass for fields that exist in the schema/contract).
  const raw: Partial<GameManifestActionDefinition> = isObjectRecord(action.raw) ? action.raw : {};
  const directDeterministic = isObjectRecord(raw.deterministic) ? raw.deterministic : {};
  const overrideDeterministic = isObjectRecord(raw.overrides?.deterministic)
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

  // Effects are ordered operations, so template and action-level effects must
  // be concatenated instead of object-merged. This lets a generic template set
  // timeline coordinates while a concrete action adds a small extra effect such
  // as activeInfoId without replacing the template effect.
  const directEffects = Array.isArray(directDeterministic.effects)
    ? directDeterministic.effects
    : [];
  const overrideEffects = Array.isArray(overrideDeterministic.effects)
    ? overrideDeterministic.effects
    : [];
  const actionEffects = [...directEffects, ...overrideEffects];
  if (Array.isArray(templateDet.effects) && actionEffects.length > 0) {
    mergedDeterministic.effects = [...templateDet.effects, ...actionEffects];
  } else if (actionEffects.length > 0) {
    mergedDeterministic.effects = actionEffects;
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
  if (!source) {
    return "unknown";
  }

  if (source.startsWith("runtime.server")) {
    return "runtime.server";
  }

  if (source.startsWith("ui.panel")) {
    return "ui.panel";
  }

  if (source.startsWith("ui.screen")) {
    return "ui.screen";
  }

  return source;
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

const coerceManifestBoolean = (value: boolean | string): boolean =>
  typeof value === "string" ? value === "true" : value;

const coerceManifestNumber = (value: number | string): number =>
  typeof value === "string" ? Number(value) : value;

const decodeJsonPointerSegment = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const splitJsonPointer = (path: string): Array<string> => {
  if (!path.startsWith("/")) {
    return [];
  }
  return path.split("/").slice(1).map(decodeJsonPointerSegment);
};

const forbiddenPointerSegments = new Set(["__proto__", "constructor", "prototype"]);
const assertSafeJsonPointer = (path: string) => {
  if (splitJsonPointer(path).some((segment) => forbiddenPointerSegments.has(segment))) {
    throw new Error(`Manifest effect path contains a forbidden segment`);
  }
};

const readJsonPointer = (state: RuntimeState, path: string): unknown => {
  const parts = splitJsonPointer(path);
  if (parts.length === 0) {
    return path === "" ? state : undefined;
  }

  let current: unknown = state;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const ensureJsonPointerParent = (state: RuntimeState, path: string): { parent: Record<string, unknown>; key: string } | null => {
  const parts = splitJsonPointer(path);
  if (parts.length === 0) {
    return null;
  }

  let current: Record<string, unknown> = state;
  for (const part of parts.slice(0, -1)) {
    if (!isObjectRecord(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  return { parent: current, key: parts[parts.length - 1] };
};

const canWriteManifestEffectPath = (path: string) =>
  path.startsWith("/public/") || path.startsWith("/secret/");

const assertWritableManifestEffectPath = (path: string) => {
  assertSafeJsonPointer(path);
  if (!canWriteManifestEffectPath(path)) {
    throw new Error(`Manifest effect cannot write to path "${path}"`);
  }
};

const setJsonPointerValue = (state: RuntimeState, path: string, value: unknown) => {
  assertWritableManifestEffectPath(path);
  const target = ensureJsonPointerParent(state, path);
  if (!target) {
    throw new Error(`Manifest effect cannot write to path "${path}"`);
  }
  target.parent[target.key] = value;
};

const buildManifestParameterScope = (context: RuntimeActionContext<RuntimeState>): Record<string, unknown> => {
  const raw = isObjectRecord(context.manifestAction.raw) ? context.manifestAction.raw : {};
  const publicState = ensureObject(context.state.public);
  const turn = ensureObject(publicState.turn);
  const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : undefined;
  return {
    ...(isObjectRecord(raw.params) ? raw.params : {}),
    ...(isObjectRecord(context.manifestAction.params) ? context.manifestAction.params : {}),
    ...(isObjectRecord(context.params) ? context.params : {}),
    // Reserved runtime values are written last so action parameters cannot
    // impersonate another participant or replace turn ownership. Null is
    // deliberate: absence must also overwrite a client-supplied reserved key.
    actor: context.actorPlayerId ?? null,
    activePlayer: activePlayerId ?? null
  };
};

/** JsonLogic receives params and materialized participant branches explicitly. */
const buildJsonLogicContext = (state: RuntimeState, params: Record<string, unknown>) => {
  const players = ensureObject(state.players);
  const actorId = typeof params.actor === "string" ? params.actor : undefined;
  const activePlayerId = typeof params.activePlayer === "string" ? params.activePlayer : undefined;
  const actorState = actorId && isObjectRecord(players[actorId]) ? players[actorId] : undefined;
  const activePlayerState = activePlayerId && isObjectRecord(players[activePlayerId])
    ? players[activePlayerId]
    : undefined;

  return {
    ...state,
    params,
    ...(actorState ? { actor: { playerId: actorId, ...actorState } } : {}),
    ...(activePlayerState ? { activePlayer: { playerId: activePlayerId, ...activePlayerState } } : {})
  };
};

const objectVisibilityRoot = (
  state: RuntimeState,
  visibility: "public" | "secret"
): Record<string, unknown> => ensureObject(state[visibility]);

const readObjectInstance = (
  state: RuntimeState,
  input: { visibility?: "public" | "secret"; collection: string; objectId: string | number }
): GameManifestObjectState | undefined => {
  const visibility = input.visibility ?? "public";
  const root = objectVisibilityRoot(state, visibility);
  const objects = ensureObject(root.objects);
  const collection = ensureObject(objects[input.collection]);
  const instance = collection[String(input.objectId)];
  return isObjectRecord(instance) ? instance as unknown as GameManifestObjectState : undefined;
};

const ensureObjectStateCollection = (
  state: RuntimeState,
  visibility: "public" | "secret",
  collectionId: string
): Record<string, unknown> => {
  const root = objectVisibilityRoot(state, visibility);
  const objects = ensureObject(root.objects);
  const collection = ensureObject(objects[collectionId]);
  objects[collectionId] = collection;
  root.objects = objects;
  state[visibility] = root;
  return collection;
};

const sameManifestValue = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return false;
  }
  if (isObjectRecord(left) && isObjectRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameManifestValue(left[key], right[key]));
  }
  return false;
};

const assertSessionObjectModel = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  expectedCollection: string
) => {
  const model = objectModels?.[objectType];
  if (!model) {
    throw new Error(`Object type "${objectType}" is not declared in manifest objectModels`);
  }
  if (model.scope !== "session") {
    throw new Error(`Object type "${objectType}" uses unsupported scope "${model.scope}"`);
  }
  if (model.collection !== expectedCollection) {
    throw new Error(`Object type "${objectType}" belongs to collection "${model.collection}", not "${expectedCollection}"`);
  }
  return model;
};

const assertFacetValueAllowed = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  facetId: string,
  value: unknown
) => {
  const model = assertSessionObjectModel(objectModels, objectType, collection);
  const facet = model.facets[facetId];
  if (!facet) {
    throw new Error(`Object type "${objectType}" does not declare facet "${facetId}"`);
  }
  if (!facet.values.some((allowedValue) => sameManifestValue(allowedValue, value))) {
    throw new Error(`Facet "${facetId}" for object type "${objectType}" does not allow value "${String(value)}"`);
  }
};

const buildInitialObjectFacets = (
  objectModels: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  declaredFacets: Record<string, unknown> | undefined
): Record<string, GameManifestObjectFacetValue> => {
  const model = assertSessionObjectModel(objectModels, objectType, collection);
  const facets: Record<string, GameManifestObjectFacetValue> = {};

  for (const [facetId, facet] of Object.entries(model.facets)) {
    facets[facetId] = facet.initial;
  }

  for (const [facetId, value] of Object.entries(declaredFacets ?? {})) {
    assertFacetValueAllowed(objectModels, objectType, collection, facetId, value);
    facets[facetId] = value as GameManifestObjectFacetValue;
  }

  return facets;
};

const ensureLocalPointerParent = (
  target: Record<string, unknown>,
  path: string
): { parent: Record<string, unknown>; key: string } | null => {
  const parts = splitJsonPointer(path);
  if (parts.length === 0) {
    return null;
  }

  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObjectRecord(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  return { parent: current, key: parts[parts.length - 1] };
};

const applyObjectAttributePatch = (
  attributes: Record<string, unknown>,
  patch: GameManifestObjectAttributePatch
) => {
  if (!patch.path.startsWith("/")) {
    throw new Error(`object.attribute.patch path must start with "/": "${patch.path}"`);
  }
  const target = ensureLocalPointerParent(attributes, patch.path);
  if (!target) {
    throw new Error(`object.attribute.patch has invalid path "${patch.path}"`);
  }

  if (patch.op === "add" || patch.op === "replace") {
    target.parent[target.key] = patch.value;
  } else if (patch.op === "remove") {
    delete target.parent[target.key];
  } else if (patch.op === "increment") {
    target.parent[target.key] = (Number(target.parent[target.key]) || 0) + Number(patch.value);
  } else if (patch.op === "append") {
    if (!Array.isArray(target.parent[target.key])) {
      target.parent[target.key] = [];
    }
    (target.parent[target.key] as Array<unknown>).push(patch.value);
  }
};

const applyStatePatchEffect = (state: RuntimeState, patch: GameManifestDeterministicStatePatch) => {
  assertWritableManifestEffectPath(patch.path);
  const target = ensureJsonPointerParent(state, patch.path);
  if (!target) {
    throw new Error(`Manifest state.patch has invalid path "${patch.path}"`);
  }

  if (patch.op === "add" || patch.op === "replace") {
    target.parent[target.key] = patch.value;
  } else if (patch.op === "remove") {
    delete target.parent[target.key];
  } else if (patch.op === "increment") {
    target.parent[target.key] = (Number(target.parent[target.key]) || 0) + Number(patch.value);
  } else if (patch.op === "append") {
    if (!Array.isArray(target.parent[target.key])) {
      target.parent[target.key] = [];
    }
    (target.parent[target.key] as Array<unknown>).push(patch.value);
  }
};

const evaluateStateConditionValue = (
  value: unknown,
  condition: Pick<GameManifestDeterministicStateCondition, "operator" | "value">
) => {
  switch (condition.operator) {
    case "==":
      return value === condition.value;
    case "!=":
      return value !== condition.value;
    case ">":
      return typeof value === "number" && typeof condition.value === "number" && value > condition.value;
    case ">=":
      return typeof value === "number" && typeof condition.value === "number" && value >= condition.value;
    case "<":
      return typeof value === "number" && typeof condition.value === "number" && value < condition.value;
    case "<=":
      return typeof value === "number" && typeof condition.value === "number" && value <= condition.value;
    case "exists":
      return value !== undefined && value !== null;
    case "not_exists":
      return value === undefined || value === null;
  }
};

const evaluateStateCondition = (state: RuntimeState, condition: GameManifestDeterministicStateCondition) =>
  evaluateStateConditionValue(readJsonPointer(state, condition.path), condition);

/**
 * Generic collection-count primitive shared by effect conditions and guards.
 *
 * Reads `spec.path` as a JSON Pointer object, then for each id in `spec.ids`
 * reads `spec.field` (a `/`-separated sub-path relative to the item, e.g.
 * "facets/resolution") and counts how many equal `spec.equals` (default
 * `true`). Returns whether the count reached `spec.countAtLeast`. This is the
 * single evaluator behind both `when.collectionCount` and the `collectionCount`
 * guard, so counting-with-threshold is one platform primitive (ADR-041 §7.2)
 * rather than a game-specific guard shape.
 */
const evaluateCollectionCount = (state: RuntimeState, spec: GameManifestDeterministicCollectionCount): boolean => {
  const collection = readJsonPointer(state, spec.path);
  const expected = spec.equals ?? true;
  const threshold = coerceManifestNumber(spec.countAtLeast);
  let count = 0;
  if (isObjectRecord(collection)) {
    for (const id of spec.ids) {
      const item = collection[id];
      const value =
        isObjectRecord(item) && spec.field.includes("/")
          ? readJsonPointer(item, `/${spec.field}`)
          : isObjectRecord(item)
            ? item[spec.field]
            : undefined;
      if (value === expected) {
        count += 1;
      }
    }
  }
  return count >= threshold;
};

const selectEffectConditionState = (
  currentState: RuntimeState,
  preActionState: RuntimeState,
  readFrom?: "current" | "preAction"
) => (readFrom === "preAction" ? preActionState : currentState);

const evaluateEffectCondition = (
  currentState: RuntimeState,
  preActionState: RuntimeState,
  condition: GameManifestDeterministicEffectCondition,
  params: Record<string, unknown>
): boolean => {
  if ("metric" in condition) {
    return evaluateMetricCondition(
      selectEffectConditionState(currentState, preActionState, condition.readFrom),
      condition.metric
    );
  }

  if ("state" in condition) {
    return evaluateStateCondition(
      selectEffectConditionState(currentState, preActionState, condition.readFrom),
      condition.state
    );
  }

  if ("collectionCount" in condition) {
    const sourceState = selectEffectConditionState(currentState, preActionState, condition.readFrom);
    return evaluateCollectionCount(sourceState, condition.collectionCount);
  }

  if ("jsonLogic" in condition) {
    const sourceState = selectEffectConditionState(currentState, preActionState, condition.readFrom);
    return Boolean(jsonLogic.apply(
      condition.jsonLogic as Parameters<typeof jsonLogic.apply>[0],
      buildJsonLogicContext(sourceState, params)
    ));
  }

  if ("all" in condition) {
    return condition.all.every((item) => evaluateEffectCondition(currentState, preActionState, item, params));
  }

  if ("any" in condition) {
    return condition.any.some((item) => evaluateEffectCondition(currentState, preActionState, item, params));
  }

  if ("not" in condition) {
    return !evaluateEffectCondition(currentState, preActionState, condition.not, params);
  }

  return true;
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
    sessionRole: context.sessionRole ?? "player",
    params: context.params ?? {},
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

const evaluateObjectStateGuard = (
  state: RuntimeState,
  guard: GameManifestObjectStateGuard
): Array<string> => {
  const visibility = guard.visibility ?? "public";
  const objectId = String(guard.objectId);
  const instance = readObjectInstance(state, {
    visibility,
    collection: guard.collection,
    objectId
  });
  const prefix = `${visibility}.objects.${guard.collection}.${objectId}`;
  const failures: Array<string> = [];

  if (!instance) {
    return [`${prefix} expected to exist`];
  }

  if (guard.objectType !== undefined && instance.objectType !== guard.objectType) {
    failures.push(`${prefix}.objectType expected "${guard.objectType}"`);
  }

  if (guard.facets) {
    const facets = isObjectRecord(instance.facets) ? instance.facets : {};
    for (const [facetId, expectedValue] of Object.entries(guard.facets)) {
      if (!sameManifestValue(facets[facetId], expectedValue)) {
        failures.push(`${prefix}.facets.${facetId} expected ${String(expectedValue)} (actual: ${String(facets[facetId])})`);
      }
    }
  }

  if (guard.attributes) {
    const attributes = isObjectRecord(instance.attributes) ? instance.attributes : {};
    for (const [attributeId, expectedValue] of Object.entries(guard.attributes)) {
      if (!sameManifestValue(attributes[attributeId], expectedValue)) {
        failures.push(`${prefix}.attributes.${attributeId} expected ${String(expectedValue)} (actual: ${String(attributes[attributeId])})`);
      }
    }
  }

  return failures;
};

const evaluateManifestGuard = (
  state: RuntimeState,
  metadata: GameManifestDeterministicActionMetadata,
  params: Record<string, unknown> = {}
): Array<string> => {
  const failures: Array<string> = [];
  const guard = metadata.guard;

  if (!guard) {
    return failures;
  }

  const publicState = ensureObject(state.public);
  const timeline = ensureObject(publicState.timeline);
  const turn = ensureObject(publicState.turn);

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

  if (guard.turn?.phase !== undefined && turn.phase !== guard.turn.phase) {
    failures.push(`public.turn.phase expected "${guard.turn.phase}"`);
  }

  if (guard.turn?.actorIsActive !== undefined) {
    const actorPlayerId = typeof params.actor === "string" ? params.actor : undefined;
    if (!actorPlayerId) {
      failures.push("turn guard requires an actor player id");
    } else {
      const actorIsActive = turn.activePlayerId === actorPlayerId;
      if (actorIsActive !== guard.turn.actorIsActive) {
        failures.push(
          `turn actor active expected ${String(guard.turn.actorIsActive)} (actor: ${actorPlayerId}, active: ${String(turn.activePlayerId)})`
        );
      }
    }
  }

  // Generic collection-count guard(s) (ADR-041 §7.2): count items in a
  // collection matching a field condition and require a threshold. Antarctica's
  // former `board` guard (resolved-card count) migrated onto this generic form,
  // reusing the same `evaluateCollectionCount` primitive as effect conditions.
  if (guard.collectionCount) {
    const specs = Array.isArray(guard.collectionCount) ? guard.collectionCount : [guard.collectionCount];
    for (const spec of specs) {
      if (!evaluateCollectionCount(state, spec)) {
        failures.push(
          `collectionCount ${spec.path} [${spec.ids.join(", ")}].${spec.field} == ${String(spec.equals ?? true)} expected >= ${String(spec.countAtLeast)}`
        );
      }
    }
  }

  // Generic state conditions: each path is read as a JSON Pointer (with ~0/~1
  // unescaping) via the SAME readJsonPointer / evaluateStateCondition primitives
  // as effect conditions — no duplicated, non-unescaping inline pointer parsing.
  if (guard.stateConditions) {
    for (const condition of guard.stateConditions) {
      if (!evaluateStateCondition(state, condition)) {
        failures.push(
          `Condition failed: ${condition.path} ${condition.operator} ${String(condition.value)} (actual: ${String(readJsonPointer(state, condition.path))})`
        );
      }
    }
  }

  if (guard.object) {
    const objectGuards = Array.isArray(guard.object) ? guard.object : [guard.object];
    for (const objectGuard of objectGuards) {
      const resolvedGuard = resolveValue(objectGuard, params) as GameManifestObjectStateGuard;
      failures.push(...evaluateObjectStateGuard(state, resolvedGuard));
    }
  }

  // Tier 2 guard: JsonLogic expression evaluation
  if (guard.jsonLogic) {
    const result = jsonLogic.apply(
      guard.jsonLogic as Parameters<typeof jsonLogic.apply>[0],
      buildJsonLogicContext(state, params)
    );
    if (!result) {
      failures.push(`JsonLogic guard evaluated to false`);
    }
  }

  return failures;
};

const readMetricSnapshot = (state: RuntimeState): Record<string, unknown> => {
  const publicState = ensureObject(state.public);
  return { ...ensureObject(publicState.metrics) };
};

const resolvePlayerRef = (
  state: RuntimeState,
  playerRef: GameManifestPlayerRef | undefined,
  params: Record<string, unknown>
): string => {
  if (playerRef && typeof playerRef !== "string") {
    assertSafeJsonPointer(playerRef.fromPath);
    if (!playerRef.fromPath.startsWith("/public/") || playerRef.fromPath.includes("{{")) {
      throw new Error("Player reference paths must be static pointers under public state");
    }
  }
  const resolved = typeof playerRef === "string"
    ? resolveValue(playerRef, params)
    : playerRef && "fromPath" in playerRef
      ? readJsonPointer(state, playerRef.fromPath)
      : undefined;

  if (typeof resolved !== "string" || !resolved) {
    throw new Error("Player-scoped effect could not resolve a participant id");
  }
  const players = ensureObject(state.players);
  if (!isObjectRecord(players[resolved])) {
    throw new Error(`Player-scoped effect references unknown participant "${resolved}"`);
  }
  return resolved;
};

const ensureMetricContainer = (
  state: RuntimeState,
  scope: "session" | "player" | undefined,
  playerRef: GameManifestPlayerRef | undefined,
  params: Record<string, unknown>
): { metrics: Record<string, unknown>; targetPrefix: string } => {
  if (scope === "player") {
    const playerId = resolvePlayerRef(state, playerRef, params);
    const players = ensureObject(state.players);
    const player = players[playerId] as Record<string, unknown>;
    const metrics = ensureObject(player.metrics);
    player.metrics = metrics;
    return { metrics, targetPrefix: `players.${playerId}.metrics` };
  }

  const publicState = ensureObject(state.public);
  const metrics = ensureObject(publicState.metrics);
  publicState.metrics = metrics;
  state.public = publicState;
  return { metrics, targetPrefix: "public.metrics" };
};

const applyMetricChange = (
  state: RuntimeState,
  change: {
    metricId: string;
    delta: number | string | JsonLogicExpression;
    scope?: "session" | "player";
    playerId?: GameManifestPlayerRef;
  },
  params: Record<string, unknown>
): string => {
  const { metrics, targetPrefix } = ensureMetricContainer(state, change.scope, change.playerId, params);

  const current = typeof metrics[change.metricId] === "number" ? (metrics[change.metricId] as number) : 0;
  // Resolve the addition value: number literal, template string, or JsonLogic expression.
  let changeValue: number;
  if (typeof change.delta === "number") {
    changeValue = change.delta;
  } else if (typeof change.delta === "string") {
    changeValue = Number(change.delta);
  } else if (typeof change.delta === "object" && change.delta !== null) {
    // JsonLogic expression — evaluate against the current state.
    changeValue = Number(jsonLogic.apply(change.delta as any, buildJsonLogicContext(state, params))) || 0;
  } else {
    changeValue = 0;
  }
  const nextValue = current + changeValue;
  if (!Number.isFinite(nextValue)) {
    throw new Error(`Metric "${change.metricId}" addition must produce a finite number`);
  }
  metrics[change.metricId] = Math.round(nextValue * 1_000_000) / 1_000_000;
  return `${targetPrefix}.${change.metricId}`;
};

const applyMetricSet = (
  state: RuntimeState,
  effect: Extract<GameManifestDeterministicEffect, { op: "metric.set" }>,
  params: Record<string, unknown>
): string => {
  const { metrics, targetPrefix } = ensureMetricContainer(state, effect.scope, effect.playerId, params);
  const resolved = typeof effect.value === "object" && effect.value !== null
    ? jsonLogic.apply(effect.value as Parameters<typeof jsonLogic.apply>[0], buildJsonLogicContext(state, params))
    : effect.value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new Error(`Metric "${effect.metricId}" assignment must produce a finite number`);
  }
  metrics[effect.metricId] = Math.round(resolved * 1_000_000) / 1_000_000;
  return `${targetPrefix}.${effect.metricId}`;
};

const resolveNumericExpression = (
  value: number | { [operator: string]: JsonLogicExpression | Array<JsonLogicExpression> },
  state: RuntimeState,
  params: Record<string, unknown>
): number => {
  const resolved = typeof value === "object" && value !== null
    ? jsonLogic.apply(value as Parameters<typeof jsonLogic.apply>[0], buildJsonLogicContext(state, params))
    : value;
  const amount = typeof resolved === "number" ? resolved : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Metric transfer amount must be a finite non-negative integer");
  }
  return amount;
};

type ResolvedMetricTransferEndpoint =
  | { scope: "bank"; target: "bank" }
  | {
      scope: "balance";
      target: string;
      value: unknown;
      write: (value: number) => void;
    };

/**
 * Resolve a schema-owned economic endpoint into one balance slot.
 *
 * Player endpoints are intentionally mapped through `resolvePlayerRef` instead
 * of concatenating a manifest or client value into a state path. This keeps
 * participant selection bounded to an existing server-owned player branch.
 */
const resolveMetricTransferEndpoint = (
  state: RuntimeState,
  endpoint: Extract<GameManifestDeterministicEffect, { op: "metric.transfer" }>["from"],
  params: Record<string, unknown>
): ResolvedMetricTransferEndpoint => {
  if (endpoint.scope === "bank") {
    return { scope: "bank", target: "bank" };
  }

  if (endpoint.scope === "state") {
    if (endpoint.path.includes("{{")) {
      throw new Error("Metric transfer state paths must be static");
    }
    assertWritableManifestEffectPath(endpoint.path);
    return {
      scope: "balance",
      target: `state:${endpoint.path}`,
      value: readJsonPointer(state, endpoint.path),
      write: (value) => setJsonPointerValue(state, endpoint.path, value)
    };
  }

  if (forbiddenPointerSegments.has(endpoint.metricId)) {
    throw new Error(`Metric transfer uses forbidden metric id "${endpoint.metricId}"`);
  }
  const playerId = resolvePlayerRef(state, endpoint.playerId, params);
  const players = ensureObject(state.players);
  const player = players[playerId] as Record<string, unknown>;
  const metrics = ensureObject(player.metrics);
  return {
    scope: "balance",
    target: `player:${JSON.stringify([playerId, endpoint.metricId])}`,
    value: metrics[endpoint.metricId],
    write: (value) => {
      metrics[endpoint.metricId] = value;
      player.metrics = metrics;
    }
  };
};

const readValidMetricBalance = (
  endpoint: ResolvedMetricTransferEndpoint,
  role: "source" | "destination"
): number | undefined => {
  if (endpoint.scope === "bank") {
    return undefined;
  }
  if (typeof endpoint.value !== "number" || !Number.isFinite(endpoint.value) || endpoint.value < 0) {
    throw new Error(`Metric transfer ${role} must be a finite non-negative balance`);
  }
  return endpoint.value;
};

/**
 * Apply one nonnegative transfer atomically inside the action's cloned state.
 * Every endpoint and resulting balance is validated before either side writes.
 */
const applyMetricTransfer = (
  state: RuntimeState,
  effect: Extract<GameManifestDeterministicEffect, { op: "metric.transfer" }>,
  params: Record<string, unknown>
): string => {
  const amount = resolveNumericExpression(effect.amount, state, params);
  const source = resolveMetricTransferEndpoint(state, effect.from, params);
  const destination = resolveMetricTransferEndpoint(state, effect.to, params);
  const sourceValue = readValidMetricBalance(source, "source");
  const destinationValue = readValidMetricBalance(destination, "destination");

  if (sourceValue !== undefined && sourceValue < amount) {
    throw new Error("Metric transfer cannot make a source balance negative");
  }

  // A transfer to the same balance is valid but must be a no-op. Handling it
  // explicitly also prevents a second write from overwriting the debit.
  if (source.target === destination.target) {
    return destination.target;
  }

  const nextSource = sourceValue === undefined ? undefined : sourceValue - amount;
  const nextDestination = destinationValue === undefined ? undefined : destinationValue + amount;
  if (nextDestination !== undefined && !Number.isFinite(nextDestination)) {
    throw new Error("Metric transfer destination balance would overflow");
  }

  if (source.scope === "balance") {
    source.write(nextSource as number);
  }
  if (destination.scope === "balance") {
    destination.write(nextDestination as number);
  }
  return destination.target;
};

const applyRandomRoll = (
  state: RuntimeState,
  effect: Extract<GameManifestDeterministicEffect, { op: "random.roll" }>
) => {
  const secretState = ensureObject(state.secret);
  if (!isObjectRecord(secretState.random)) {
    throw new Error("random.roll requires runtime-owned state.secret.random");
  }
  const roll = rollSessionDice(secretState.random as unknown as SessionRandomState, effect.dice);
  secretState.random = roll.random;
  state.secret = secretState;
  setJsonPointerValue(state, effect.storePath, roll.result);
  return roll.result;
};

const applyTurnNext = (state: RuntimeState, turnPhases: ReadonlyArray<string> | undefined) => {
  const publicState = ensureObject(state.public);
  const turn = ensureObject(publicState.turn);
  const order = Array.isArray(turn.order)
    ? turn.order.filter((value): value is string => typeof value === "string")
    : [];
  const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : undefined;
  if (order.length === 0 || !activePlayerId || !order.includes(activePlayerId)) {
    throw new Error("turn.next requires a valid public.turn order and active participant");
  }

  const players = ensureObject(state.players);
  const activeIndex = order.indexOf(activePlayerId);
  let nextPlayerId: string | undefined;
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidateId = order[(activeIndex + offset) % order.length];
    const candidate = players[candidateId];
    if (isObjectRecord(candidate) && candidate.status !== "eliminated") {
      nextPlayerId = candidateId;
      break;
    }
  }
  if (!nextPlayerId) {
    throw new Error("turn.next could not find an active participant");
  }

  turn.activePlayerId = nextPlayerId;
  turn.phase = turnPhases?.[0] ?? turn.phase;
  turn.turnNumber = (typeof turn.turnNumber === "number" ? turn.turnNumber : 0) + 1;
  publicState.turn = turn;
  state.public = publicState;
  return { activePlayerId: nextPlayerId, phase: turn.phase, turnNumber: turn.turnNumber };
};

const applyTurnPhase = (
  state: RuntimeState,
  phase: string,
  turnPhases: ReadonlyArray<string> | undefined
) => {
  if (turnPhases && !turnPhases.includes(phase)) {
    throw new Error(`turn.phase.set cannot select undeclared phase "${phase}"`);
  }
  const publicState = ensureObject(state.public);
  const turn = ensureObject(publicState.turn);
  if (typeof turn.activePlayerId !== "string") {
    throw new Error("turn.phase.set requires initialized public.turn state");
  }
  turn.phase = phase;
  publicState.turn = turn;
  state.public = publicState;
};

const appendStructuredLogEntry = (
  state: RuntimeState,
  context: RuntimeActionContext<RuntimeState>,
  log: Extract<GameManifestDeterministicEffect, { op: "log.append" }>,
  provenance: GameManifestDeterministicActionMetadata["provenance"] | undefined,
  capabilityFamily: CapabilityFamily,
  metricsBefore?: Record<string, unknown>,
  metricsAfter?: Record<string, unknown>
) => {
  const logEntry: Record<string, unknown> = {
    actionId: context.actionId,
    kind: log?.kind,
    summary: log?.summary,
    capability: context.manifestAction.capability,
    capabilityFamily,
    functionName: context.manifestAction.functionName ?? context.actionId,
    at: context.now.toISOString(),
    payload: context.payload ?? null,
    legacyProvenance: provenance ? provenance.map((item) => ({ ...item })) : []
  };

  if ("data" in log && isObjectRecord(log.data)) {
    Object.assign(logEntry, log.data);
  }

  const logRecord = log as unknown as Record<string, unknown>;
  for (const field of ["stageId", "displayMode", "entityType", "cardId", "memberId", "backText"]) {
    if (logRecord[field] !== undefined) {
      logEntry[field] = logRecord[field];
    }
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
      logEntry.metricChanges = deltas;
    }
  }

  appendLogEntry(state, logEntry);

  return logEntry;
};

const applyManifestEffects = (
  state: RuntimeState,
  context: RuntimeActionContext<RuntimeState>,
  metadata: GameManifestDeterministicActionMetadata,
  capabilityFamily: CapabilityFamily,
  preActionState: RuntimeState,
  metricsBefore: Record<string, unknown>,
  objectModels?: GameManifestObjectModelMap,
  networkModels?: GameManifestTransportNetworkModelMap,
  turnPhases?: ReadonlyArray<string>
): Array<RuntimeActionEffect> => {
  const declaredEffects = Array.isArray(metadata.effects) ? metadata.effects : [];
  const runtimeEffects: Array<RuntimeActionEffect> = [];
  const params = buildManifestParameterScope(context);

  for (const declaredEffect of declaredEffects) {
    const effect = resolveValue(declaredEffect, params) as GameManifestDeterministicEffect;
    if (effect.when && !evaluateEffectCondition(state, preActionState, effect.when, params)) {
      continue;
    }

    // Effect means a schema-validated operation from the manifest, not code.
    // This keeps UI/runtime command cleanup declarative and game-agnostic.
    switch (effect.op) {
      case "runtime.server.request": {
        const uiState = ensureUiState(state);
        uiState.serverRequested = true;
        uiState.lastCapabilityFamily = capabilityFamily;
        uiState.lastCapability = context.manifestAction.capability ?? effect.op;
        runtimeEffects.push({
          kind: "runtime",
          target: "server",
          value: "requested",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op
          }
        });
        break;
      }
      case "timeline.set": {
        const publicState = ensureObject(state.public);
        const timeline = ensureObject(publicState.timeline);
        const changedFields: Record<string, unknown> = {};

        if (effect.line !== undefined) {
          timeline.line = effect.line;
          changedFields.line = effect.line;
        }
        if (effect.stepIndex !== undefined) {
          const stepIndex = coerceManifestNumber(effect.stepIndex);
          timeline.stepIndex = stepIndex;
          timeline.step_index = stepIndex;
          changedFields.stepIndex = stepIndex;
        }
        if (effect.stageId !== undefined) {
          timeline.stageId = effect.stageId;
          timeline.stage_id = effect.stageId;
          changedFields.stageId = effect.stageId;
        }
        if (effect.screenId !== undefined) {
          timeline.screenId = effect.screenId;
          timeline.screen_id = effect.screenId;
          changedFields.screenId = effect.screenId;
        }
        if (effect.activeInfoId !== undefined) {
          timeline.activeInfoId = effect.activeInfoId;
          changedFields.activeInfoId = effect.activeInfoId;
        }
        if (effect.canAdvance !== undefined) {
          const canAdvance = coerceManifestBoolean(effect.canAdvance);
          timeline.canAdvance = canAdvance;
          changedFields.canAdvance = canAdvance;
        }

        publicState.timeline = timeline;
        state.public = publicState;
        runtimeEffects.push({
          kind: "state",
          target: "public.timeline",
          value: "set",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            fields: changedFields
          }
        });
        break;
      }
      case "random.roll": {
        const result = applyRandomRoll(state, effect);
        const logEntry = {
          actionId: context.actionId,
          kind: "random.roll",
          dice: effect.dice,
          result,
          at: context.now.toISOString()
        };
        appendLogEntry(state, logEntry);
        runtimeEffects.push({
          kind: "random",
          target: effect.storePath,
          value: result,
          data: { op: effect.op, dice: effect.dice }
        });
        runtimeEffects.push({ kind: "log", target: "public.log", data: logEntry });
        break;
      }
      case "deck.shuffle":
      case "deck.draw": {
        const result = applyDeckEffect(state, effect);
        runtimeEffects.push({
          kind: "state",
          target: effect.op === "deck.draw" ? effect.storePath : `secret.decks.${effect.deckId}`,
          value: effect.op,
          data: { op: effect.op, ...result }
        });
        break;
      }
      case "metric.add": {
        const target = applyMetricChange(state, {
          metricId: effect.metricId,
          delta: effect.delta,
          scope: effect.scope,
          playerId: effect.playerId
        }, params);
        runtimeEffects.push({
          kind: "state",
          target,
          value: "add",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            delta: effect.delta
          }
        });
        break;
      }
      case "metric.set": {
        const target = applyMetricSet(state, effect, params);
        runtimeEffects.push({
          kind: "state",
          target,
          value: "set",
          data: { op: effect.op, metricId: effect.metricId, value: effect.value }
        });
        break;
      }
      case "turn.next": {
        const nextTurn = applyTurnNext(state, turnPhases);
        runtimeEffects.push({
          kind: "turn",
          target: "public.turn",
          value: "next",
          data: { op: effect.op, ...nextTurn }
        });
        break;
      }
      case "turn.phase.set": {
        applyTurnPhase(state, effect.phase, turnPhases);
        runtimeEffects.push({
          kind: "turn",
          target: "public.turn.phase",
          value: effect.phase,
          data: { op: effect.op }
        });
        break;
      }
      case "metric.transfer": {
        const target = applyMetricTransfer(state, effect, params);
        runtimeEffects.push({
          kind: "state",
          target,
          value: "metric.transfer",
          data: { op: effect.op, from: effect.from, to: effect.to, amount: effect.amount }
        });
        break;
      }
      case "transport.road.build":
      case "transport.waypoint.build":
      case "transport.vehicle.move":
      case "transport.vehicle.attach":
      case "transport.vehicle.detach":
      case "transport.cargo.load":
      case "transport.cargo.deliver": {
        const result = applyTransportEffect({
          state,
          effect,
          params,
          resolvedRefs: context.resolvedRefs ?? {},
          networkModels,
          objectModels
        });
        runtimeEffects.push({
          kind: "state",
          target: `transport.${effect.networkId}`,
          value: effect.op,
          data: { op: effect.op, ...result }
        });
        break;
      }
      case "ranking.compute": {
        const result = applyRankingEffect(state, effect);
        runtimeEffects.push({
          kind: "state",
          target: effect.storePath,
          value: effect.op,
          data: { op: effect.op, ...result }
        });
        break;
      }
      case "state.patch": {
        for (const patch of effect.patches) {
          applyStatePatchEffect(state, patch);
        }
        runtimeEffects.push({
          kind: "state",
          target: "state",
          value: "patch",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            patchCount: effect.patches.length
          }
        });
        break;
      }
      case "flag.set": {
        const current = ensureObject(readJsonPointer(state, effect.path));
        for (const [key, value] of Object.entries(effect.values)) {
          current[key] = value;
        }
        setJsonPointerValue(state, effect.path, current);
        runtimeEffects.push({
          kind: "state",
          target: effect.path,
          value: "flag.set",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            values: effect.values
          }
        });
        break;
      }
      case "counter.add": {
        const current = readJsonPointer(state, effect.path);
        const delta = coerceManifestNumber(effect.delta);
        setJsonPointerValue(state, effect.path, (Number(current) || 0) + delta);
        runtimeEffects.push({
          kind: "state",
          target: effect.path,
          value: "counter.add",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            delta
          }
        });
        break;
      }
      case "collection.append": {
        const current = readJsonPointer(state, effect.path);
        const collection = Array.isArray(current) ? [...current] : [];
        collection.push(effect.value);
        setJsonPointerValue(state, effect.path, collection);
        runtimeEffects.push({
          kind: "state",
          target: effect.path,
          value: "collection.append",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            value: effect.value
          }
        });
        break;
      }
      case "object.create": {
        const collection = ensureObjectStateCollection(state, effect.visibility, effect.collection);
        const objectId = String(effect.objectId);
        if (collection[objectId] !== undefined) {
          throw new Error(`Object "${effect.collection}.${objectId}" already exists in ${effect.visibility} state`);
        }

        const facets = buildInitialObjectFacets(
          objectModels,
          effect.objectType,
          effect.collection,
          isObjectRecord(effect.facets) ? effect.facets : undefined
        );
        const attributes = isObjectRecord(effect.attributes) ? effect.attributes : {};
        collection[objectId] = {
          objectType: effect.objectType,
          facets,
          attributes
        } satisfies GameManifestObjectState;
        runtimeEffects.push({
          kind: "state",
          target: `${effect.visibility}.objects.${effect.collection}.${objectId}`,
          value: "object.create",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            objectType: effect.objectType
          }
        });
        break;
      }
      case "object.state.set": {
        const objectId = String(effect.objectId);
        const instance = readObjectInstance(state, {
          visibility: effect.visibility,
          collection: effect.collection,
          objectId
        });
        if (!instance) {
          throw new Error(`Object "${effect.collection}.${objectId}" does not exist in ${effect.visibility} state`);
        }

        assertFacetValueAllowed(
          objectModels,
          instance.objectType,
          effect.collection,
          effect.facet,
          effect.value
        );
        instance.facets = {
          ...(isObjectRecord(instance.facets) ? instance.facets : {}),
          [effect.facet]: effect.value
        };
        runtimeEffects.push({
          kind: "state",
          target: `${effect.visibility}.objects.${effect.collection}.${objectId}.facets.${effect.facet}`,
          value: "object.state.set",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            facet: effect.facet,
            nextValue: effect.value
          }
        });
        break;
      }
      case "object.attribute.patch": {
        const objectId = String(effect.objectId);
        const instance = readObjectInstance(state, {
          visibility: effect.visibility,
          collection: effect.collection,
          objectId
        });
        if (!instance) {
          throw new Error(`Object "${effect.collection}.${objectId}" does not exist in ${effect.visibility} state`);
        }

        instance.attributes = isObjectRecord(instance.attributes) ? instance.attributes : {};
        for (const patch of effect.patches) {
          applyObjectAttributePatch(instance.attributes, patch);
        }
        runtimeEffects.push({
          kind: "state",
          target: `${effect.visibility}.objects.${effect.collection}.${objectId}.attributes`,
          value: "object.attribute.patch",
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            patchCount: effect.patches.length
          }
        });
        break;
      }
      case "ui.panel.open": {
        const uiState = ensureUiState(state);
        uiState.activePanel = effect.panelId;
        uiState.lastCapabilityFamily = capabilityFamily;
        uiState.lastCapability = context.manifestAction.capability ?? effect.op;
        runtimeEffects.push({
          kind: "ui",
          target: "panel",
          value: effect.panelId,
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op
          }
        });
        break;
      }
      case "ui.screen.open": {
        const uiState = ensureUiState(state);
        uiState.activeScreen = effect.screenId;
        if (effect.layoutId !== undefined) {
          uiState.activeLayout = effect.layoutId;
        }
        uiState.lastCapabilityFamily = capabilityFamily;
        uiState.lastCapability = context.manifestAction.capability ?? effect.op;
        runtimeEffects.push({
          kind: "ui",
          target: "screen",
          value: effect.screenId,
          data: {
            capability: context.manifestAction.capability,
            family: capabilityFamily,
            op: effect.op,
            ...(effect.layoutId !== undefined ? { layoutId: effect.layoutId } : {})
          }
        });
        break;
      }
      case "log.append": {
        const metricsAfter = effect.auditMetrics ? readMetricSnapshot(state) : undefined;
        const logEntry = appendStructuredLogEntry(
          state,
          context,
          effect,
          metadata.provenance,
          capabilityFamily,
          effect.auditMetrics ? metricsBefore : undefined,
          metricsAfter
        );
        runtimeEffects.push({ kind: "log", target: "public.log", data: logEntry });
        break;
      }
    }
  }

  return runtimeEffects;
};

const buildManifestActionTransition = (
  context: RuntimeActionContext<RuntimeState>,
  capabilityFamily: CapabilityFamily,
  templates?: GameManifestTemplateMap,
  objectModels?: GameManifestObjectModelMap,
  networkModels?: GameManifestTransportNetworkModelMap,
  turnPhases?: ReadonlyArray<string>
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

  const guardFailures = evaluateManifestGuard(context.state, metadata, buildManifestParameterScope(context));
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
  const metricsBefore = readMetricSnapshot(nextState);

  let declaredEffects: Array<RuntimeActionEffect>;
  try {
    declaredEffects = applyManifestEffects(
      nextState,
      context,
      metadata,
      capabilityFamily,
      context.state,
      metricsBefore,
      objectModels,
      networkModels,
      turnPhases
    );
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "RUNTIME_ACTION_EFFECT_FAILED",
        message: error instanceof Error ? error.message : `Action "${context.actionId}" effect failed`
      }
    };
  }

  const fallbackEffect: RuntimeActionEffect = {
    kind: "runtime",
    target: "deterministic",
    value: context.actionId,
    data: {
      capability: context.manifestAction.capability,
      family: capabilityFamily
    }
  };
  const effect = declaredEffects.find((item) => item.kind !== "log") ?? fallbackEffect;

  setRuntimeMetadata(nextState, context, effect, capabilityFamily);

  const effects: Array<RuntimeActionEffect> = declaredEffects.length > 0 ? declaredEffects : [fallbackEffect];

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
    return (context) => buildManifestActionTransition(
      context,
      capabilityFamily,
      options.templates,
      options.objectModels,
      options.networkModels,
      options.turnPhases
    );
  }

  return (context) => buildTransition(context, capabilityFamily);
}

export function resolveActionCapabilityFamily(
  capabilityFamily?: string,
  capability?: string
): CapabilityFamily {
  return resolveCapabilityFamily(capabilityFamily, capability);
}
