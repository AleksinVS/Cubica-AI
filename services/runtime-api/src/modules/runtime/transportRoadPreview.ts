/**
 * Read-only preview of a published region-edge Mechanics command.
 *
 * Preview validates the same immutable action, role, resource references and
 * leading Mechanics assertions as authoritative dispatch. It never executes
 * payments or graph mutation and never advances the session random stream.
 */
import type {
  GameManifestTransportNetworkModel,
  Plan
} from "@cubica/contracts-manifest";
import type {
  SessionRecord,
  TransportRoadPreviewRequest,
  TransportRoadPreviewResponse
} from "@cubica/contracts-session";
import type { GameBundle } from "../content/manifestLoader.ts";
import { hashCanonicalJson } from "../content/canonicalJson.ts";
import { executeMechanicsTransaction } from "../mechanics/index.ts";
import { isRecord } from "../mechanics/stateModel.ts";
import { RequestValidationError } from "../errors.ts";
import {
  chooseSessionValue,
  readSessionRandomStream,
  type SessionRandomStreamsState
} from "./sessionRandom.ts";
import {
  prepareMinimumRegionRoadCandidates,
  regionRoadRandomStreamId
} from "./regionRoadPlanner.ts";
import {
  resolveActionReferences,
  validateActionReferenceParameterSubset
} from "./actionParameters.ts";
import { getRegisteredActionDefinition } from "./actionRegistry.ts";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type RegionRouteStep = {
  id: string;
  kind: "command";
  op: "graph.regions.route.plan";
  networkId: string;
  fromNode: { op: "value.param"; name: string };
  toNode: { op: "value.param"; name: string };
};

/** Produce a safe, non-authoritative preview from one immutable snapshot. */
export const previewRuntimeTransportRoad = (options: {
  snapshot: SessionRecord<RuntimeState>;
  bundle: GameBundle;
  actorPlayerId?: string;
  sessionRole: "player" | "facilitator" | "assistant" | "observer";
  input: TransportRoadPreviewRequest;
}): TransportRoadPreviewResponse => {
  try {
    return previewOrThrow(options);
  } catch (error) {
    if (error instanceof RequestValidationError) throw error;
    // Geometry, assertions and state-shape diagnostics may expose protected
    // implementation detail, so public callers receive one stable error.
    throw new RequestValidationError(
      `Action "${options.input.actionId}" cannot be previewed for the selected endpoints in the current session state`
    );
  }
};

function previewOrThrow(options: {
  snapshot: SessionRecord<RuntimeState>;
  bundle: GameBundle;
  actorPlayerId?: string;
  sessionRole: "player" | "facilitator" | "assistant" | "observer";
  input: TransportRoadPreviewRequest;
}): TransportRoadPreviewResponse {
  const { snapshot, bundle, input } = options;
  const definition = getRegisteredActionDefinition(bundle, input.actionId);
  if (!definition) throw new RequestValidationError(`Action "${input.actionId}" is not defined for this game`);
  const sessionRole = options.sessionRole;
  if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
    throw new RequestValidationError(`Action "${input.actionId}" is not available to the current session role`);
  }
  const plan = bundle.manifest.mechanics.plans[definition.binding.planRef];
  if (!plan) throw new RequestValidationError(`Action "${input.actionId}" has no published Mechanics plan`);
  const graphSteps = plan.transaction.steps.filter(
    (step) => (step as { op: string }).op === "graph.regions.route.plan"
  ) as unknown as Array<RegionRouteStep>;
  if (graphSteps.length !== 1) {
    throw new RequestValidationError(`Action "${input.actionId}" does not declare one previewable region-edge command`);
  }
  const graphStep = graphSteps[0];
  const graphIndex = plan.transaction.steps.indexOf(graphStep);
  const assertionPrefix = plan.transaction.steps.slice(0, graphIndex);
  if (assertionPrefix.some((step) => step.op !== "core.assert")) {
    throw new RequestValidationError(`Action "${input.actionId}" mutates state before its previewable graph command`);
  }
  if (graphStep.fromNode.op !== "value.param" || graphStep.toNode.op !== "value.param") {
    throw new RequestValidationError(`Action "${input.actionId}" must bind preview endpoints to declared parameters`);
  }

  const model = bundle.manifest.networkModels?.[graphStep.networkId];
  if (!model || model.visibility !== "public" || !model.roadPlanning) {
    throw new RequestValidationError(`Action "${input.actionId}" does not expose a public authoritative road plan`);
  }
  const endpointNames = [graphStep.fromNode.name, graphStep.toNode.name];
  const params = validateActionReferenceParameterSubset(definition, input.params, endpointNames, {
    requiredVisibility: "public"
  });
  const refs = resolveActionReferences(definition, params, snapshot.state, endpointNames);
  if (refs[endpointNames[0]]?.network !== graphStep.networkId || refs[endpointNames[1]]?.network !== graphStep.networkId) {
    throw new RequestValidationError(`Action "${input.actionId}" endpoint references do not belong to its declared graph`);
  }

  if (assertionPrefix.length > 0) {
    const assertionPlan: Plan = {
      ...plan,
      transaction: { steps: assertionPrefix as Plan["transaction"]["steps"] }
    };
    executeMechanicsTransaction({
      mechanics: bundle.manifest.mechanics,
      plan: assertionPlan,
      state: snapshot.state,
      params,
      actorContext: { actorPlayerId: options.actorPlayerId, sessionRole },
      networkModels: bundle.manifest.networkModels,
      objectModels: bundle.manifest.objectModels,
      turnPhases: bundle.manifest.config.turnModel?.phases
    });
  }

  const nodes = readStaticMapCollection(snapshot.state, bundle, model.nodeCollection);
  const edges = readStaticMapCollection(snapshot.state, bundle, model.edgeCollection);
  const fromNodeId = refs[endpointNames[0]].id;
  const toNodeId = refs[endpointNames[1]].id;
  if (fromNodeId === toNodeId) throw new Error("Self edge");
  const fromNode = requireNetworkObject(nodes, fromNodeId, graphStep.networkId);
  const toNode = requireNetworkObject(nodes, toNodeId, graphStep.networkId);
  assertFacet(fromNode, model.nodeStateFacet, model.buildableNodeStates);
  assertFacet(toNode, model.nodeStateFacet, model.buildableNodeStates);
  for (const candidate of Object.values(edges)) {
    if (!isRecord(candidate)) continue;
    const attrs = objectAttributes(candidate);
    if ((attrs.fromNodeId === fromNodeId && attrs.toNodeId === toNodeId) ||
        (attrs.fromNodeId === toNodeId && attrs.toNodeId === fromNodeId)) throw new Error("Duplicate edge");
  }
  const from = objectPoint(fromNode);
  const to = objectPoint(toNode);
  const prepared = prepareMinimumRegionRoadCandidates({
    model,
    from,
    to,
    excludedRegionIds: readExcludedRegionIds(snapshot.state, bundle, model)
  });
  const selected = prepared.candidates.length > 1
    ? chooseSessionValue(
        readSessionRandomStream(readRandomStreams(snapshot.state), regionRoadRandomStreamId(graphStep.networkId)),
        prepared.candidates
      ).value
    : prepared.candidates[0];
  const regionSegments = selected.regionSequence.length;
  return {
    sessionId: snapshot.sessionId,
    actionId: input.actionId,
    usedStateVersion: snapshot.version.stateVersion,
    paramsFingerprint: `sha256:${hashCanonicalJson(params)}`,
    definitionHash: definition.definitionHash,
    networkId: graphStep.networkId,
    fromNodeId,
    toNodeId,
    polyline: structuredClone(selected.points),
    regionSequence: [...selected.regionSequence],
    regionSegments,
    candidateCount: prepared.candidates.length,
    planning: {
      mode: model.roadPlanning.mode,
      algorithmVersion: model.roadPlanning.algorithmVersion,
      geometryVersion: model.roadPlanning.geometryVersion,
      geometryHash: model.roadPlanning.geometryHash,
      boundaryPolicy: model.roadPlanning.boundaryPolicy
    }
  };
}

function readStaticMapCollection(state: RuntimeState, bundle: GameBundle, collectionId: string): JsonRecord {
  const collection = bundle.manifest.mechanics.stateModel.collections[collectionId];
  if (!collection || collection.stableKey !== "map-key") throw new Error("Preview collection is not a declared map");
  const value = readStaticStorage(state, collection.storage.root, collection.storage.segments);
  if (!isRecord(value)) throw new Error("Preview collection is unavailable");
  return value;
}

function readExcludedRegionIds(
  state: RuntimeState,
  bundle: GameBundle,
  model: GameManifestTransportNetworkModel
): Array<string> {
  const endpointId = model.roadPlanning?.excludedRegionIdsEndpoint;
  if (!endpointId) return [];
  const endpoint = bundle.manifest.mechanics.stateModel.endpoints[endpointId];
  const type = endpoint && bundle.manifest.mechanics.stateModel.types[endpoint.valueType];
  const itemType = type && (type.kind === "list" || type.kind === "set")
    ? bundle.manifest.mechanics.stateModel.types[type.itemType]
    : undefined;
  const expectedAudience = model.visibility === "public" ? "public" : "server";
  if (!endpoint || endpoint.audienceRef !== expectedAudience || !itemType || itemType.kind !== "string") {
    throw new Error("Preview excluded-regions endpoint violates its typed binding");
  }
  const value = readStaticStorage(state, endpoint.storage.root, endpoint.storage.segments);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    throw new Error("Preview excluded-regions endpoint must contain unique strings");
  }
  return value as Array<string>;
}

function readStaticStorage(
  state: RuntimeState,
  root: "public" | "secret" | "players",
  segments: ReadonlyArray<string | { context: "actor" } | { binding: string }>
): unknown {
  let value: unknown = state[root];
  for (const segment of segments) {
    if (typeof segment !== "string" || !isRecord(value)) throw new Error("Preview requires static public storage");
    value = value[segment];
  }
  return value;
}

function requireNetworkObject(collection: JsonRecord, id: string, networkId: string): JsonRecord {
  const object = isRecord(collection[id]) ? collection[id] : undefined;
  if (!object || objectAttributes(object).networkId !== networkId) throw new Error("Graph resource is unavailable");
  return object;
}

function objectAttributes(object: JsonRecord): JsonRecord {
  return isRecord(object.attributes) ? object.attributes : {};
}

function assertFacet(object: JsonRecord, facet: string, allowed: ReadonlyArray<unknown>): void {
  const facets = isRecord(object.facets) ? object.facets : {};
  if (!allowed.includes(facets[facet])) throw new Error("Graph resource state is unavailable");
}

function objectPoint(object: JsonRecord): { x: number; y: number } {
  const position = objectAttributes(object).position;
  if (!isRecord(position) || typeof position.x !== "number" || !Number.isFinite(position.x) ||
      typeof position.y !== "number" || !Number.isFinite(position.y)) throw new Error("Graph position is invalid");
  return { x: position.x, y: position.y };
}

function readRandomStreams(state: RuntimeState): SessionRandomStreamsState {
  const secret = isRecord(state.secret) ? state.secret : undefined;
  if (!secret || !isRecord(secret.random)) throw new Error("Preview tie-breaking random state is unavailable");
  return structuredClone(secret.random) as unknown as SessionRandomStreamsState;
}
