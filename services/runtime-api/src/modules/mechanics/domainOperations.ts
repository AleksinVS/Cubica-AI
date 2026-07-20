/**
 * Exact, version-locked graph and relation primitives.
 *
 * Each operation owns only a bounded algorithm or an invariant-preserving
 * structural mutation. Prices, resources, gameplay lifecycle, cargo meaning
 * and scoring formulas stay in the published transaction that composes these
 * primitives.
 */
import type {
  GameManifestObjectFacetValue,
  GameManifestObjectModelMap,
  GameManifestTransportNetworkModel
} from "@cubica/contracts-manifest";
import {
  chooseSessionValue,
  readSessionRandomStream,
  writeSessionRandomStream,
  type SessionRandomState,
  type SessionRandomStreamsState
} from "../runtime/sessionRandom.ts";
import {
  prepareMinimumRegionRoadCandidates,
  regionRoadRandomStreamId
} from "../runtime/regionRoadPlanner.ts";
import { charge, measureBoundedJson } from "./budget.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";
import { MechanicsExecutionError } from "./errors.ts";
import { evaluateExpression } from "./expressionEvaluator.ts";
import {
  canonicalGraphPoint,
  canonicalizeGraphRegions,
  closedGraphRegionMembership,
  graphEdgeGeometryFingerprint,
  graphPointsEqual,
  GRAPH_EDGE_POSITION_PROOF_VERSION,
  GraphGeometryError,
  readEffectiveGraphPolyline,
  splitGraphPolyline,
  type GraphPoint,
  type GraphPolylineSplit
} from "./graphGeometry.ts";
import {
  collectionEntries,
  isRecord,
  readEndpoint,
  writeEndpoint
} from "./stateModel.ts";
import type { JsonRecord, MechanicsExecutionContext, Step } from "./types.ts";

type DomainStep = Extract<Step, {
  op:
    | "graph.regions.route.plan"
    | "graph.edge.position.inspect"
    | "graph.edge.split"
    | "graph.entity.traverse"
    | "graph.shortestPath"
    | "relation.attach"
    | "relation.detach";
}>;
type Point = GraphPoint;
type RegionRoadCandidate = ReturnType<typeof prepareMinimumRegionRoadCandidates>["candidates"][number];
type PolylineSplit = GraphPolylineSplit;

interface GraphEdgePositionInspection {
  proofVersion: typeof GRAPH_EDGE_POSITION_PROOF_VERSION;
  networkId: string;
  edge: {
    id: string;
    geometryFingerprint: string;
  };
  normalizedPosition: number;
  point: Point;
  pointRegionIds: Array<string>;
  endpoints: {
    from: { id: string; point: Point; regionIds: Array<string> };
    to: { id: string; point: Point; regionIds: Array<string> };
    regionIds: Array<string>;
  };
}

/**
 * Provenance marker for proof objects created by this exact executor process.
 *
 * The marker is intentionally not serializable. A client can copy the visible
 * fields but cannot place its object in this set, so split never accepts a
 * body-supplied lookalike as an inspection result.
 */
const serverGraphInspectionProofs = new WeakSet<object>();

/** Dispatch one operation from the module registry's non-core domain set. */
export function executeDomainOperation(step: DomainStep, context: MechanicsExecutionContext): unknown {
  switch (step.op) {
    case "graph.regions.route.plan": return planRegionRoute(step, context);
    case "graph.edge.position.inspect": return inspectEdgePosition(step, context);
    case "graph.edge.split": return splitEdge(step, context);
    case "graph.entity.traverse": return traverseEntity(step, context);
    case "graph.shortestPath": return shortestPath(step, context);
    case "relation.attach": return changeRelation(step, context, true);
    case "relation.detach": return changeRelation(step, context, false);
  }
}

function inspectEdgePosition(
  step: Extract<DomainStep, { op: "graph.edge.position.inspect" }>,
  context: MechanicsExecutionContext
): GraphEdgePositionInspection {
  const model = requireNetwork(step.networkId, context);
  const nodes = requireMapCollection(context, model.nodeCollection);
  const edges = requireMapCollection(context, model.edgeCollection);
  const edgeId = identifier(evaluateExpression(step.edge, context), "edge", step.id);
  const normalizedPosition = finiteNumber(
    evaluateExpression(step.position, context),
    "edge position",
    step.id
  );
  const edge = requireNetworkObject(edges, edgeId, step.networkId, "edge", step.id);
  const endpoints = edgeEndpoints(edge, step.id);
  const from = objectPoint(
    requireNetworkObject(nodes, endpoints.fromNodeId, step.networkId, "node", step.id),
    "from node",
    step.id
  );
  const to = objectPoint(
    requireNetworkObject(nodes, endpoints.toNodeId, step.networkId, "node", step.id),
    "to node",
    step.id
  );
  const attributes = objectAttributes(edge);
  const points = geometryForStep(step.id, () =>
    readEffectiveGraphPolyline(attributes.geometry, from, to));
  const split = geometryForStep(step.id, () =>
    splitGraphPolyline(points, normalizedPosition));

  // Polygon simplicity is checked here as a fail-closed runtime defence. The
  // semantic checker performs the same bounded validation before publication.
  const canonicalRegions = geometryForStep(step.id, () =>
    canonicalizeGraphRegions(model.regions));
  charge(context, "algorithmWork", graphRegionInspectionWork(model.regions) + points.length);
  const pointRegionIds = closedGraphRegionMembership(split.point, canonicalRegions);
  const fromRegionIds = closedGraphRegionMembership(from, canonicalRegions);
  const toRegionIds = closedGraphRegionMembership(to, canonicalRegions);
  const endpointRegionIds = [...new Set([...fromRegionIds, ...toRegionIds])]
    .sort(compareCanonicalIds);

  const routePlanUsage = measureBoundedJson(attributes.routePlan ?? null, {
    maxBytes: context.limits.maxIntermediateValueBytes,
    maxDepth: context.limits.maxJsonDepth,
    maxNodes: context.limits.maxJsonNodes,
    maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes
  }, "MECHANICS_GRAPH_GEOMETRY_INVALID");
  charge(context, "algorithmWork", routePlanUsage.nodes + points.length);
  const result: GraphEdgePositionInspection = {
    proofVersion: GRAPH_EDGE_POSITION_PROOF_VERSION,
    networkId: step.networkId,
    edge: {
      id: edgeId,
      geometryFingerprint: graphEdgeGeometryFingerprint({
        networkId: step.networkId,
        edgeId,
        fromNodeId: endpoints.fromNodeId,
        toNodeId: endpoints.toNodeId,
        from,
        to,
        polyline: points,
        routePlan: attributes.routePlan
      })
    },
    normalizedPosition,
    point: split.point,
    pointRegionIds,
    endpoints: {
      from: { id: endpoints.fromNodeId, point: from, regionIds: fromRegionIds },
      to: { id: endpoints.toNodeId, point: to, regionIds: toRegionIds },
      regionIds: endpointRegionIds
    }
  };
  serverGraphInspectionProofs.add(result);
  return result;
}

function planRegionRoute(
  step: Extract<DomainStep, { op: "graph.regions.route.plan" }>,
  context: MechanicsExecutionContext
): unknown {
  const model = requireNetwork(step.networkId, context);
  const nodes = requireMapCollection(context, model.nodeCollection);
  const edges = requireMapCollection(context, model.edgeCollection);
  const fromNodeId = identifier(evaluateExpression(step.fromNode, context), "from node");
  const toNodeId = identifier(evaluateExpression(step.toNode, context), "to node");
  if (fromNodeId === toNodeId) fail("MECHANICS_GRAPH_SELF_EDGE", "A graph edge requires two distinct nodes", step.id);
  const fromNode = requireNetworkObject(nodes, fromNodeId, step.networkId, "node", step.id);
  const toNode = requireNetworkObject(nodes, toNodeId, step.networkId, "node", step.id);
  assertFacetAllowed(fromNode, model.nodeStateFacet, model.buildableNodeStates, "from node", step.id);
  assertFacetAllowed(toNode, model.nodeStateFacet, model.buildableNodeStates, "to node", step.id);
  if (scanCollectionValues(context, edges).some((candidate) => {
    if (!isRecord(candidate)) return false;
    // A collection may host several declared graphs. Edges in another graph
    // neither conflict with this pair nor have to share this model's shape.
    if (objectAttributes(candidate).networkId !== step.networkId) return false;
    const endpoints = edgeEndpoints(candidate, step.id);
    return (endpoints.fromNodeId === fromNodeId && endpoints.toNodeId === toNodeId) ||
      (endpoints.fromNodeId === toNodeId && endpoints.toNodeId === fromNodeId);
  })) fail("MECHANICS_GRAPH_EDGE_EXISTS", "The selected nodes are already connected", step.id);

  const from = objectPoint(fromNode, "from node", step.id);
  const to = objectPoint(toNode, "to node", step.id);
  const planned = model.roadPlanning
    ? prepareMinimumRegionRoadCandidates({
        model,
        from,
        to,
        excludedRegionIds: readExcludedRegionIds(model, context),
        workMeter: {
          charge: (units) => charge(context, "algorithmWork", units)
        }
      })
    : undefined;
  const selected = selectRoadCandidate(planned?.candidates, context, step.id, step.networkId);
  const regionSegments = selected?.value.regionSequence.length ?? countLineRegions(from, to, model);
  if (regionSegments < 1) fail("MECHANICS_GRAPH_ROUTE_INVALID", "A graph edge must cross at least one declared region", step.id);
  const geometry = selected
    ? { from, to, polyline: structuredClone(selected.value.points) }
    : { from, to };
  let routePlan: JsonRecord | undefined;
  if (selected && model.roadPlanning) {
    routePlan = {
      mode: model.roadPlanning.mode,
      algorithmVersion: model.roadPlanning.algorithmVersion,
      geometryVersion: model.roadPlanning.geometryVersion,
      geometryHash: model.roadPlanning.geometryHash,
      boundaryPolicy: model.roadPlanning.boundaryPolicy,
      regionSequence: [...selected.value.regionSequence],
      passages: structuredClone(selected.value.passages),
      tieBreak: {
        policy: model.roadPlanning.tieBreak,
        candidateCount: planned?.candidates.length ?? 1,
        selectedCandidateIndex: selected.index,
        ...(selected.randomBefore && selected.randomAfter
          ? {
              randomCounterBefore: selected.randomBefore.counter,
              randomCounterAfter: selected.randomAfter.counter
            }
          : {})
      }
    };
  }
  return {
    fromNodeId,
    toNodeId,
    geometry,
    regionSegments,
    ...(routePlan === undefined ? {} : { routePlan })
  };
}

function splitEdge(
  step: Extract<DomainStep, { op: "graph.edge.split" }>,
  context: MechanicsExecutionContext
): unknown {
  const proof = requireGraphInspectionProof(step.proof.stepId, step.networkId, context, step.id);
  const model = requireNetwork(step.networkId, context);
  const nodes = requireMapCollection(context, model.nodeCollection);
  const edges = requireMapCollection(context, model.edgeCollection);
  const edgeId = identifier(proof.edge.id, "inspected edge", step.id);
  const proofEdgeCandidate = edges[edgeId];
  if (!isRecord(proofEdgeCandidate) ||
      objectAttributes(proofEdgeCandidate).networkId !== step.networkId) {
    fail(
      "MECHANICS_GRAPH_PROOF_STALE",
      "The inspected edge no longer exists in the inspected network",
      step.id
    );
  }
  const edge = requireNetworkObject(edges, edgeId, step.networkId, "edge", step.id);
  assertFacetAllowed(edge, model.edgeStateFacet, model.splittableEdgeStates, "edge", step.id);
  const position = finiteNumber(proof.normalizedPosition, "inspected edge position", step.id);

  const endpoints = edgeEndpoints(edge, step.id);
  for (const endpointId of [endpoints.fromNodeId, endpoints.toNodeId]) {
    const candidate = nodes[endpointId];
    if (!isRecord(candidate) || objectAttributes(candidate).networkId !== step.networkId) {
      fail(
        "MECHANICS_GRAPH_PROOF_STALE",
        "An inspected edge endpoint no longer exists in the inspected network",
        step.id
      );
    }
  }
  const from = objectPoint(nodes[endpoints.fromNodeId] as JsonRecord, "from node", step.id);
  const to = objectPoint(nodes[endpoints.toNodeId] as JsonRecord, "to node", step.id);
  const attributes = isRecord(edge.attributes) ? edge.attributes : {};
  const points = geometryForProofRevalidation(step.id, () =>
    readEffectiveGraphPolyline(attributes.geometry, from, to));
  const split = geometryForProofRevalidation(step.id, () =>
    splitGraphPolyline(points, position));
  const currentFingerprint = graphEdgeGeometryFingerprint({
    networkId: step.networkId,
    edgeId,
    fromNodeId: endpoints.fromNodeId,
    toNodeId: endpoints.toNodeId,
    from,
    to,
    polyline: points,
    routePlan: attributes.routePlan
  });
  charge(context, "algorithmWork", points.length * 2);
  if (currentFingerprint !== proof.edge.geometryFingerprint ||
      !graphPointsEqual(split.point, proof.point)) {
    fail(
      "MECHANICS_GRAPH_PROOF_STALE",
      "The inspected edge geometry or normalized position changed before split",
      step.id
    );
  }
  // Route-plan parsing can only influence the child edge payload. Perform it
  // after the full fingerprint check so a changed plan is classified as a
  // stale proof and no untrusted changed value is interpreted prematurely.
  const splitRoutePlan = splitStoredRoutePlan(
    attributes.routePlan,
    points.length,
    split,
    edgeId,
    step.id
  );

  // Every proof-dependent check above happens before allocation advances the
  // sequence or any graph object is created/deleted.
  const nodeId = allocateCollectionId(nodes, `${step.networkId}:node`, model, context, step.id);
  const firstEdgeId = allocateCollectionId(edges, `${step.networkId}:edge`, model, context, step.id);
  // Reserve the first generated id explicitly. Copying the complete edge map
  // here would perform a hidden full-collection traversal outside the runtime
  // scan budget.
  const secondEdgeId = allocateCollectionId(
    edges,
    `${step.networkId}:edge`,
    model,
    context,
    step.id,
    new Set([firstEdgeId])
  );
  const nodeState = model.buildableNodeStates[0];
  nodes[nodeId] = {
    objectType: model.waypointObjectType,
    facets: initialFacets(context.objectModels, model.waypointObjectType, model.nodeCollection, model.nodeStateFacet, nodeState),
    attributes: {
      networkId: step.networkId,
      position: split.point
    }
  };
  const makeEdge = (
    fromNodeId: string,
    toNodeId: string,
    polyline: Array<Point>,
    childRoutePlan?: JsonRecord
  ): JsonRecord => ({
    objectType: typeof edge.objectType === "string" ? edge.objectType : model.edgeObjectType,
    facets: isRecord(edge.facets) ? structuredClone(edge.facets) : {},
    attributes: {
      ...structuredClone(attributes),
      networkId: step.networkId,
      fromNodeId,
      toNodeId,
      geometry: { from: polyline[0], to: polyline.at(-1), polyline },
      splitFromEdgeId: edgeId,
      ...(childRoutePlan
        ? { routePlan: childRoutePlan, regionSegments: (childRoutePlan.passages as Array<unknown>).length }
        : {})
    }
  });
  edges[firstEdgeId] = makeEdge(endpoints.fromNodeId, nodeId, split.first, splitRoutePlan.first);
  edges[secondEdgeId] = makeEdge(nodeId, endpoints.toNodeId, split.second, splitRoutePlan.second);
  delete edges[edgeId];
  charge(context, "writes", 7);
  return { nodeId, edgeIds: [firstEdgeId, secondEdgeId], replacedEdgeId: edgeId };
}

function traverseEntity(
  step: Extract<DomainStep, { op: "graph.entity.traverse" }>,
  context: MechanicsExecutionContext
): unknown {
  const model = requireNetwork(step.networkId, context);
  const movement = model.movement;
  if (!movement) fail("MECHANICS_GRAPH_MOVEMENT_UNDECLARED", "The graph has no movement declaration", step.id);
  const assetId = identifier(evaluateExpression(step.entity, context), "entity", step.id);
  const edgeId = identifier(evaluateExpression(step.edge, context), "edge", step.id);
  const assets = requireMapCollection(context, movement.vehicleCollection);
  const edges = requireMapCollection(context, model.edgeCollection);
  const nodes = requireMapCollection(context, model.nodeCollection);
  const asset = requireNetworkObject(assets, assetId, step.networkId, "asset", step.id);
  const edge = requireNetworkObject(edges, edgeId, step.networkId, "edge", step.id);
  if (!movement.vehicleObjectTypes.includes(String(asset.objectType))) fail("MECHANICS_GRAPH_ASSET_TYPE", "Asset type cannot traverse this graph", step.id);
  if (movement.vehicleStateFacet && movement.movableVehicleStates) {
    assertFacetAllowed(asset, movement.vehicleStateFacet, movement.movableVehicleStates, "asset", step.id);
  }
  assertFacetAllowed(edge, model.edgeStateFacet, movement.traversableEdgeStates, "edge", step.id);
  const attrs = objectAttributes(asset);
  const currentNodeId = identifier(attrs[movement.locationAttribute], "asset location", step.id);
  const currentNode = requireNetworkObject(nodes, currentNodeId, step.networkId, "source node", step.id);
  // A node closure applies in both directions: checking only the destination
  // would let a vehicle escape from, or transit through, a closed node.
  assertFacetAllowed(currentNode, model.nodeStateFacet, movement.traversableNodeStates, "source node", step.id);
  const endpoints = edgeEndpoints(edge, step.id);
  const destinationNodeId = endpoints.fromNodeId === currentNodeId ? endpoints.toNodeId
    : endpoints.toNodeId === currentNodeId ? endpoints.fromNodeId : undefined;
  if (!destinationNodeId) fail("MECHANICS_GRAPH_EDGE_NOT_INCIDENT", "Edge is not incident to the asset location", step.id);
  const destination = requireNetworkObject(nodes, destinationNodeId, step.networkId, "destination node", step.id);
  assertFacetAllowed(destination, model.nodeStateFacet, movement.traversableNodeStates, "destination node", step.id);
  const capacityAssets = requireMapCollection(context, movement.capacityCollection);
  const occupancy = scanCollectionEntries(context, capacityAssets).filter(([id, value]) => {
    if (!isRecord(value) || !movement.capacityObjectTypes.includes(String(value.objectType))) return false;
    // Collection keys are local to a collection. An object in a separate
    // capacity collection may legitimately have the same key as the moving
    // vehicle and must still occupy the destination.
    if (movement.capacityCollection === movement.vehicleCollection && id === assetId) return false;
    const capacityAttributes = objectAttributes(value);
    const capacityNetworkId = capacityAttributes.networkId;
    if (typeof capacityNetworkId !== "string") {
      fail(
        "MECHANICS_GRAPH_CAPACITY_NETWORK_MISSING",
        "A capacity object has no declared network identity",
        step.id
      );
    }
    // A shared physical collection may contain objects from several declared
    // graphs. Only objects belonging to this graph consume its capacity.
    if (capacityNetworkId !== step.networkId) return false;
    // Capacity may intentionally depend on lifecycle state: an object can be
    // stored at a node for market/reserve purposes without physically
    // occupying the movement slot. When no facet policy is declared, retain
    // the conservative legacy meaning that every matching object occupies it.
    if (movement.capacityStateFacet && movement.capacityOccupyingStates) {
      const capacityState = objectFacets(value)[movement.capacityStateFacet];
      if (capacityState === undefined) {
        fail(
          "MECHANICS_GRAPH_CAPACITY_STATE_MISSING",
          `A capacity object has no declared facet "${movement.capacityStateFacet}"`,
          step.id
        );
      }
      if (!movement.capacityOccupyingStates.includes(capacityState as GameManifestObjectFacetValue)) return false;
    }
    return capacityAttributes[movement.capacityLocationAttribute] === destinationNodeId;
  }).length;
  if (occupancy >= movement.maxVehiclesPerNode) fail("MECHANICS_GRAPH_CAPACITY", "Destination capacity is exhausted", step.id);
  attrs[movement.locationAttribute] = destinationNodeId;
  const related = requireMapCollection(context, movement.coupledCollection);
  const movedRelatedIds: Array<string> = [];
  for (const [id, value] of scanCollectionEntries(context, related)) {
    if (!isRecord(value) || objectAttributes(value)[movement.coupledVehicleAttribute] !== assetId) continue;
    objectAttributes(value)[movement.coupledLocationAttribute] = destinationNodeId;
    movedRelatedIds.push(id);
  }
  charge(context, "writes", 1 + movedRelatedIds.length);
  return { entityId: assetId, edgeId, fromNodeId: currentNodeId, toNodeId: destinationNodeId, relatedIds: movedRelatedIds };
}

function changeRelation(
  step: Extract<DomainStep, { op: "relation.attach" | "relation.detach" }>,
  context: MechanicsExecutionContext,
  attach: boolean
): unknown {
  const model = requireNetwork(step.networkId, context);
  const movement = model.movement;
  if (!movement?.compatibleCouplings || movement.maxCoupledVehicles === undefined) {
    fail("MECHANICS_RELATION_UNDECLARED", "The graph has no compatible relation declaration", step.id);
  }
  const primaryId = identifier(evaluateExpression(step.primary, context), "primary asset", step.id);
  const relatedIds = step.related.map((value) => identifier(evaluateExpression(value, context), "related asset", step.id));
  if (new Set(relatedIds).size !== relatedIds.length) fail("MECHANICS_RELATION_DUPLICATE", "Related assets must be unique", step.id);
  const primaryCollection = requireMapCollection(context, movement.vehicleCollection);
  const relatedCollection = requireMapCollection(context, movement.coupledCollection);
  const primary = requireNetworkObject(primaryCollection, primaryId, step.networkId, "primary asset", step.id);
  const primaryAttrs = objectAttributes(primary);
  const nodeId = identifier(primaryAttrs[movement.locationAttribute], "primary asset location", step.id);
  const compatibility = movement.compatibleCouplings.find((rule) => rule.vehicleObjectType === primary.objectType);
  if (!compatibility) fail("MECHANICS_RELATION_INCOMPATIBLE", "Primary asset does not accept relations", step.id);
  const selected = relatedIds.map((id) => {
    const related = requireNetworkObject(relatedCollection, id, step.networkId, "related asset", step.id);
    if (!compatibility.coupledObjectTypes.includes(String(related.objectType))) {
      fail("MECHANICS_RELATION_INCOMPATIBLE", "Related asset type is incompatible", step.id);
    }
    const attrs = objectAttributes(related);
    if (attrs[movement.coupledLocationAttribute] !== nodeId) fail("MECHANICS_RELATION_LOCATION", "Related assets must share the primary location", step.id);
    const current = attrs[movement.coupledVehicleAttribute];
    if (attach ? current !== null && current !== undefined : current !== primaryId) {
      fail("MECHANICS_RELATION_STATE", attach ? "Related asset is already attached" : "Related asset is not attached to this primary", step.id);
    }
    return attrs;
  });
  if (attach) {
    const existing = scanCollectionValues(context, relatedCollection).filter((value) =>
      isRecord(value) && objectAttributes(value)[movement.coupledVehicleAttribute] === primaryId).length;
    if (existing + selected.length > movement.maxCoupledVehicles) fail("MECHANICS_RELATION_CAPACITY", "Relation capacity would be exceeded", step.id);
  }
  for (const attrs of selected) attrs[movement.coupledVehicleAttribute] = attach ? primaryId : null;
  charge(context, "writes", selected.length);
  return { primaryId, relatedIds };
}

function shortestPath(
  step: Extract<DomainStep, { op: "graph.shortestPath" }>,
  context: MechanicsExecutionContext
): unknown {
  const model = requireNetwork(step.networkId, context);
  const fromNodeId = identifier(evaluateExpression(step.fromNode, context), "path start", step.id);
  const toNodeId = identifier(evaluateExpression(step.toNode, context), "path end", step.id);
  const route = shortestOpenRoute(model, step.networkId, fromNodeId, toNodeId, context, step.id);
  return { ...route, length: route.edgeIds.length };
}

function shortestOpenRoute(
  model: GameManifestTransportNetworkModel,
  networkId: string,
  origin: string,
  destination: string,
  context: MechanicsExecutionContext,
  stepId: string
): { edgeIds: Array<string>; nodeIds: Array<string> } {
  const movement = model.movement;
  if (!movement) fail("MECHANICS_GRAPH_MOVEMENT_UNDECLARED", "Route settlement requires movement rules", stepId);
  const nodes = requireMapCollection(context, model.nodeCollection);
  const originNode = requireNetworkObject(nodes, origin, networkId, "route origin", stepId);
  const destinationNode = requireNetworkObject(nodes, destination, networkId, "route destination", stepId);
  assertFacetAllowed(originNode, model.nodeStateFacet, movement.traversableNodeStates, "route origin", stepId);
  assertFacetAllowed(destinationNode, model.nodeStateFacet, movement.traversableNodeStates, "route destination", stepId);
  if (origin === destination) return { edgeIds: [], nodeIds: [origin] };
  const edges = requireMapCollection(context, model.edgeCollection);
  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const [edgeId, candidate] of scanCollectionEntries(context, edges)
    .sort(([left], [right]) => compareCanonicalIds(left, right))) {
    if (!isRecord(candidate)) continue;
    if (objectAttributes(candidate).networkId !== networkId) continue;
    const facets = objectFacets(candidate);
    if (!movement.traversableEdgeStates.includes(facets[model.edgeStateFacet] as GameManifestObjectFacetValue)) continue;
    const endpoints = edgeEndpoints(candidate, stepId);
    const fromNode = requireNetworkObject(nodes, endpoints.fromNodeId, networkId, "route node", stepId);
    const toNode = requireNetworkObject(nodes, endpoints.toNodeId, networkId, "route node", stepId);
    if (!movement.traversableNodeStates.includes(objectFacets(fromNode)[model.nodeStateFacet] as GameManifestObjectFacetValue) ||
        !movement.traversableNodeStates.includes(objectFacets(toNode)[model.nodeStateFacet] as GameManifestObjectFacetValue)) continue;
    adjacency.set(endpoints.fromNodeId, [...(adjacency.get(endpoints.fromNodeId) ?? []), { nodeId: endpoints.toNodeId, edgeId }]);
    adjacency.set(endpoints.toNodeId, [...(adjacency.get(endpoints.toNodeId) ?? []), { nodeId: endpoints.fromNodeId, edgeId }]);
  }
  const queue = [origin];
  const seen = new Set(queue);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  while (queue.length > 0 && !seen.has(destination)) {
    const node = queue.shift() as string;
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next.nodeId)) continue;
      seen.add(next.nodeId);
      previous.set(next.nodeId, { nodeId: node, edgeId: next.edgeId });
      queue.push(next.nodeId);
    }
  }
  if (!seen.has(destination)) fail("MECHANICS_GRAPH_ROUTE_UNAVAILABLE", "No traversable route connects inventory endpoints", stepId);
  const edgeIds: Array<string> = [];
  const nodeIds = [destination];
  let cursor = destination;
  while (cursor !== origin) {
    const previousStep = previous.get(cursor);
    if (!previousStep) fail("MECHANICS_GRAPH_ROUTE_UNAVAILABLE", "Route reconstruction failed", stepId);
    edgeIds.push(previousStep.edgeId);
    cursor = previousStep.nodeId;
    nodeIds.push(cursor);
  }
  return { edgeIds: edgeIds.reverse(), nodeIds: nodeIds.reverse() };
}

function requireNetwork(networkId: string, context: MechanicsExecutionContext): GameManifestTransportNetworkModel {
  const model = context.networkModels?.[networkId];
  if (!model) fail("MECHANICS_GRAPH_UNKNOWN", `Graph "${networkId}" is not declared`);
  return model;
}

function requireMapCollection(context: MechanicsExecutionContext, collectionId: string): JsonRecord {
  const collection = collectionEntries(context, collectionId);
  if (Array.isArray(collection.raw)) fail("MECHANICS_COLLECTION_SHAPE", `Collection "${collectionId}" must use map-key storage`);
  return collection.raw;
}

/**
 * Charge a complete state-collection traversal before filtering or sorting.
 *
 * Domain operations often inspect entries that they ultimately ignore (for
 * example an asset owned by another participant). Charging the materialized
 * entry list up front ensures rejected/non-matching candidates still consume
 * budget and prevents a zero-result scan from being treated as free. Static
 * geometry inside the separately bounded road planner is intentionally not an
 * entity scan and therefore does not use this counter.
 */
function scanCollectionEntries(
  context: MechanicsExecutionContext,
  collection: JsonRecord
): Array<[string, unknown]> {
  const entries = Object.entries(collection);
  charge(context, "scannedEntities", entries.length);
  return entries;
}

/** Same counted traversal for call sites that need values rather than ids. */
function scanCollectionValues(
  context: MechanicsExecutionContext,
  collection: JsonRecord
): Array<unknown> {
  return scanCollectionEntries(context, collection).map(([, value]) => value);
}

function requireNetworkObject(
  collection: JsonRecord,
  id: string,
  networkId: string,
  label: string,
  stepId?: string
): JsonRecord {
  const object = isRecord(collection[id]) ? collection[id] : undefined;
  if (!object || objectAttributes(object).networkId !== networkId) fail("MECHANICS_GRAPH_RESOURCE_UNAVAILABLE", `${label} is unavailable`, stepId);
  return object;
}

function objectAttributes(object: JsonRecord): JsonRecord {
  if (!isRecord(object.attributes)) object.attributes = {};
  return object.attributes as JsonRecord;
}

function objectFacets(object: JsonRecord): JsonRecord {
  if (!isRecord(object.facets)) object.facets = {};
  return object.facets as JsonRecord;
}

function assertFacetAllowed(object: JsonRecord, facet: string, allowed: Array<GameManifestObjectFacetValue>, label: string, stepId: string): void {
  if (!allowed.includes(objectFacets(object)[facet] as GameManifestObjectFacetValue)) {
    fail("MECHANICS_GRAPH_STATE", `${label} is not in an allowed state`, stepId);
  }
}

function initialFacets(
  models: GameManifestObjectModelMap | undefined,
  objectType: string,
  collection: string,
  overrideFacet: string,
  overrideValue: GameManifestObjectFacetValue
): JsonRecord {
  const model = models?.[objectType];
  if (!model || model.collection !== collection) fail("MECHANICS_OBJECT_MODEL_UNKNOWN", `Object type "${objectType}" is not declared for collection "${collection}"`);
  if (!model.facets[overrideFacet]?.values.includes(overrideValue)) fail("MECHANICS_OBJECT_FACET_INVALID", `Object facet "${overrideFacet}" rejects its module state`);
  return {
    ...Object.fromEntries(Object.entries(model.facets).map(([id, facet]) => [id, facet.initial])),
    [overrideFacet]: overrideValue
  };
}

function selectRoadCandidate(
  candidates: ReturnType<typeof prepareMinimumRegionRoadCandidates>["candidates"] | undefined,
  context: MechanicsExecutionContext,
  stepId: string,
  networkId: string
): {
  value: RegionRoadCandidate;
  index: number;
  randomBefore?: SessionRandomState;
  randomAfter?: SessionRandomState;
} | undefined {
  if (candidates === undefined) return undefined;
  if (candidates.length === 0) fail("MECHANICS_GRAPH_ROUTE_UNAVAILABLE", "Road planner returned no route candidate", stepId);
  if (candidates.length === 1) return { value: candidates[0], index: 0 };
  const streams = requireRandomStreams(context, stepId);
  const streamId = regionRoadRandomStreamId(networkId);
  const random = readSessionRandomStream(streams, streamId);
  const selected = chooseSessionValue(random, candidates);
  context.random = writeSessionRandomStream(streams, streamId, selected.random);
  persistRandom(context);
  return { ...selected, randomBefore: random, randomAfter: selected.random };
}

function requireRandomStreams(context: MechanicsExecutionContext, stepId: string): SessionRandomStreamsState {
  if (context.random) return context.random;
  const secret = isRecord(context.state.secret) ? context.state.secret : undefined;
  if (!secret || !isRecord(secret.random)) fail("MECHANICS_RANDOM_STATE_MISSING", "Graph tie-breaking requires runtime random state", stepId);
  context.random = secret.random as unknown as SessionRandomStreamsState;
  return context.random;
}

function persistRandom(context: MechanicsExecutionContext): void {
  if (!isRecord(context.state.secret)) context.state.secret = {};
  (context.state.secret as JsonRecord).random = context.random;
  charge(context, "writes");
}

function readExcludedRegionIds(model: GameManifestTransportNetworkModel, context: MechanicsExecutionContext): Array<string> {
  const endpoint = model.roadPlanning?.excludedRegionIdsEndpoint;
  if (!endpoint) return [];
  const value = readNetworkEndpoint(context, endpoint, model, ["list", "set"]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    fail("MECHANICS_GRAPH_EXCLUDED_REGIONS_INVALID", "Excluded region ids must be a unique string list");
  }
  return value as Array<string>;
}

function allocateCollectionId(
  collection: JsonRecord,
  prefix: string,
  model: GameManifestTransportNetworkModel,
  context: MechanicsExecutionContext,
  stepId: string,
  reservedIds: ReadonlySet<string> = new Set()
): string {
  let sequence = finiteInteger(
    readNetworkEndpoint(context, model.sequenceEndpoint, model, ["integer"], true),
    "graph id sequence",
    stepId
  );
  if (sequence < 0) fail("MECHANICS_GRAPH_SEQUENCE_INVALID", "Graph id sequence cannot be negative", stepId);
  let id: string;
  do {
    sequence += 1;
    id = `${prefix}:${sequence}`;
  } while (collection[id] !== undefined || reservedIds.has(id));
  writeEndpoint(context, model.sequenceEndpoint, sequence);
  return id;
}

function readNetworkEndpoint(
  context: MechanicsExecutionContext,
  endpointId: string,
  model: GameManifestTransportNetworkModel,
  typeKinds: Array<string>,
  writable = false,
  requiredAudience?: "public" | "server"
): unknown {
  const endpoint = context.stateModel.endpoints[endpointId];
  const expectedAudience = requiredAudience ?? (model.visibility === "public" ? "public" : "server");
  const type = endpoint ? context.stateModel.types[endpoint.valueType] : undefined;
  if (!endpoint || endpoint.audienceRef !== expectedAudience || !type || !typeKinds.includes(type.kind) ||
      (writable && endpoint.access !== "read-write")) {
    fail("MECHANICS_GRAPH_ENDPOINT_BINDING_INVALID", `Graph endpoint "${endpointId}" violates its typed binding`);
  }
  return readEndpoint(context, endpointId);
}

function edgeEndpoints(edge: JsonRecord, stepId?: string): { fromNodeId: string; toNodeId: string } {
  const attrs = objectAttributes(edge);
  return {
    fromNodeId: identifier(attrs.fromNodeId, "edge from-node", stepId),
    toNodeId: identifier(attrs.toNodeId, "edge to-node", stepId)
  };
}

function objectPoint(object: JsonRecord, label: string, stepId?: string): Point {
  return geometryForStep(stepId, () =>
    canonicalGraphPoint(objectAttributes(object).position, label));
}

function requireGraphInspectionProof(
  stepId: string,
  networkId: string,
  context: MechanicsExecutionContext,
  consumerStepId: string
): GraphEdgePositionInspection {
  const candidate = context.results.get(stepId);
  if (!isRecord(candidate) || !serverGraphInspectionProofs.has(candidate) ||
      candidate.proofVersion !== GRAPH_EDGE_POSITION_PROOF_VERSION ||
      candidate.networkId !== networkId ||
      !isRecord(candidate.edge) ||
      typeof candidate.edge.id !== "string" ||
      typeof candidate.edge.geometryFingerprint !== "string" ||
      typeof candidate.normalizedPosition !== "number" ||
      !isRecord(candidate.point)) {
    fail(
      "MECHANICS_GRAPH_PROOF_INVALID",
      "Edge split requires a whole server-origin inspection result from the same network",
      consumerStepId
    );
  }
  return candidate as unknown as GraphEdgePositionInspection;
}

function geometryForStep<T>(stepId: string | undefined, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof GraphGeometryError) {
      throw new MechanicsExecutionError(error.code, error.message, stepId);
    }
    throw error;
  }
}

/**
 * A proof establishes that geometry was valid earlier in this transaction.
 * Any geometry failure during its second read is therefore state drift, not a
 * new client input error, and is reported through the stable stale-proof code.
 */
function geometryForProofRevalidation<T>(
  stepId: string | undefined,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof GraphGeometryError) {
      throw new MechanicsExecutionError(
        "MECHANICS_GRAPH_PROOF_STALE",
        "The inspected graph geometry changed before mutation",
        stepId
      );
    }
    throw error;
  }
}

/** Conservative deterministic cost for polygon validation plus three memberships. */
function graphRegionInspectionWork(
  regions: ReadonlyArray<GameManifestTransportNetworkModel["regions"][number]>
): number {
  return regions.reduce((sum, region) => {
    const canonicalCount = region.polygon.length > 1 &&
      isRecord(region.polygon[0]) &&
      isRecord(region.polygon.at(-1)) &&
      region.polygon[0].x === region.polygon.at(-1)?.x &&
      region.polygon[0].y === region.polygon.at(-1)?.y
      ? region.polygon.length - 1
      : region.polygon.length;
    // Simple-polygon validation is quadratic per polygon; the three linear
    // passes classify the inspected point and both endpoint points.
    return sum + canonicalCount * canonicalCount + canonicalCount * 3;
  }, 0);
}

function splitStoredRoutePlan(
  rawRoutePlan: unknown,
  pointCount: number,
  split: PolylineSplit,
  replacedEdgeId: string,
  stepId: string
): { first?: JsonRecord; second?: JsonRecord } {
  if (rawRoutePlan === undefined) return {};
  if (!isRecord(rawRoutePlan) || !Array.isArray(rawRoutePlan.passages)) {
    fail("MECHANICS_GRAPH_ROUTE_PLAN_INVALID", "Stored route plan is malformed", stepId);
  }
  const assignments = Array<string | undefined>(pointCount - 1).fill(undefined);
  for (const passage of rawRoutePlan.passages) {
    if (!isRecord(passage) || typeof passage.regionId !== "string" ||
        !Number.isSafeInteger(passage.fromPointIndex) || !Number.isSafeInteger(passage.toPointIndex) ||
        (passage.fromPointIndex as number) < 0 ||
        (passage.toPointIndex as number) <= (passage.fromPointIndex as number) ||
        (passage.toPointIndex as number) >= pointCount) {
      fail("MECHANICS_GRAPH_ROUTE_PLAN_INVALID", "Stored route passage is malformed", stepId);
    }
    for (let index = passage.fromPointIndex as number; index < (passage.toPointIndex as number); index += 1) {
      if (assignments[index] !== undefined) fail("MECHANICS_GRAPH_ROUTE_PLAN_INVALID", "Stored route passages overlap", stepId);
      assignments[index] = passage.regionId;
    }
  }
  if (assignments.some((regionId) => regionId === undefined)) {
    fail("MECHANICS_GRAPH_ROUTE_PLAN_INVALID", "Stored route passages do not cover the complete polyline", stepId);
  }
  const firstAssignments = split.splitVertexIndex === undefined
    ? assignments.slice(0, split.splitSegmentIndex + 1)
    : assignments.slice(0, split.splitVertexIndex);
  const secondAssignments = split.splitVertexIndex === undefined
    ? assignments.slice(split.splitSegmentIndex)
    : assignments.slice(split.splitVertexIndex);
  const makeChild = (childAssignments: Array<string | undefined>): JsonRecord => {
    if (childAssignments.length === 0 || childAssignments.some((regionId) => regionId === undefined)) {
      fail("MECHANICS_GRAPH_ROUTE_PLAN_INVALID", "Split edge must retain a complete route plan", stepId);
    }
    const ids = childAssignments as Array<string>;
    const passages: Array<{ regionId: string; fromPointIndex: number; toPointIndex: number }> = [];
    let start = 0;
    for (let index = 1; index <= ids.length; index += 1) {
      if (index < ids.length && ids[index] === ids[start]) continue;
      passages.push({ regionId: ids[start], fromPointIndex: start, toPointIndex: index });
      start = index;
    }
    return {
      ...structuredClone(rawRoutePlan),
      regionSequence: passages.map((passage) => passage.regionId),
      passages,
      ...(isRecord(rawRoutePlan.costRule) && rawRoutePlan.costRule.kind === "per-region-segment"
        ? {
            costRule: {
              ...structuredClone(rawRoutePlan.costRule),
              segmentCount: passages.length
            }
          }
        : {}),
      splitFromEdgeId: replacedEdgeId
    };
  };
  return { first: makeChild(firstAssignments), second: makeChild(secondAssignments) };
}

function countLineRegions(from: Point, to: Point, model: GameManifestTransportNetworkModel): number {
  let count = 0;
  for (const region of model.regions) {
    const boundaries = [0, 1];
    for (let index = 0; index < region.polygon.length; index += 1) {
      const position = segmentIntersectionPosition(
        from,
        to,
        region.polygon[index],
        region.polygon[(index + 1) % region.polygon.length]
      );
      if (position !== undefined) boundaries.push(position);
    }
    const sorted = [...new Set(boundaries.map((value) => Math.round(value * 1e9) / 1e9))]
      .sort((left, right) => left - right);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const midpoint = (sorted[index] + sorted[index + 1]) / 2;
      if (pointInPolygon(interpolate(from, to, midpoint), region.polygon)) count += 1;
    }
  }
  return count;
}

function pointInPolygon(point: Point, polygon: ReadonlyArray<Point>): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return false;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentIntersectionPosition(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const offset = subtract(c, a);
  const position = cross(offset, s) / denominator;
  const boundaryPosition = cross(offset, r) / denominator;
  return position > 0 && position < 1 && boundaryPosition >= 0 && boundaryPosition <= 1
    ? position
    : undefined;
}

const subtract = (left: Point, right: Point): Point => ({ x: left.x - right.x, y: left.y - right.y });
const cross = (left: Point, right: Point): number => left.x * right.y - left.y * right.x;
const interpolate = (left: Point, right: Point, position: number): Point => ({
  x: left.x + (right.x - left.x) * position,
  y: left.y + (right.y - left.y) * position
});
function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  if (Math.abs(cross(subtract(point, from), subtract(to, from))) > 1e-9) return false;
  return point.x >= Math.min(from.x, to.x) - 1e-9 && point.x <= Math.max(from.x, to.x) + 1e-9 &&
    point.y >= Math.min(from.y, to.y) - 1e-9 && point.y <= Math.max(from.y, to.y) + 1e-9;
}

function identifier(value: unknown, label: string, stepId?: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ||
      value === "__proto__" || value === "constructor" || value === "prototype") {
    fail("MECHANICS_IDENTIFIER_INVALID", `${label} must be a safe non-empty identifier`, stepId);
  }
  return value;
}

function finiteNumber(value: unknown, label: string, stepId?: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("MECHANICS_NUMBER_REQUIRED", `${label} must be finite`, stepId);
  return value;
}

function finiteInteger(value: unknown, label: string, stepId?: string): number {
  if (!Number.isSafeInteger(value)) fail("MECHANICS_INTEGER_REQUIRED", `${label} must be a safe integer`, stepId);
  return value as number;
}

function fail(code: string, message: string, stepId?: string): never {
  throw new MechanicsExecutionError(code, message, stepId);
}
