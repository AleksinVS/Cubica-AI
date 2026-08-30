/**
 * Builds a compact identity for the part of a board projection that is painted
 * by the semantic network layer.
 *
 * Money, news, cargo and vehicle-only snapshots must not rebuild road labels or
 * Phaser input zones. Conversely, every value captured by a road/node click
 * handler is included here so an equal key is a safe reason to keep the current
 * display objects.
 */

import type { BoardProjection } from "./board-state.ts";
import {
  ROAD_BUILD_ACTION_ID,
  WAYPOINT_BUILD_ACTION_ID
} from "./construction-selection.ts";
import { MOVEMENT_TRAVERSE_ACTION_ID } from "./movement-selection.ts";

type SemanticDraft = Readonly<{
  actionId: string;
  params: Readonly<Record<string, unknown>>;
}> | null;

const actionEnabled = (projection: BoardProjection, actionId: string): boolean =>
  projection.availableActions.some((action) =>
    action.actionId === actionId && action.disabled !== true);

/**
 * Return a deterministic JSON key for roads, nodes and their current controls.
 *
 * The projection is already a bounded public runtime view. JSON serialization
 * is substantially cheaper than destroying and recreating Phaser text textures
 * and input registrations, while preserving exact finite coordinates.
 */
export function semanticRenderKey(
  projection: BoardProjection,
  draft: SemanticDraft
): string {
  const selectedRoadNodes = draft?.actionId === ROAD_BUILD_ACTION_ID
    ? [draft.params.fromNodeId ?? null, draft.params.toNodeId ?? null]
    : null;
  const selectedWaypoint = draft?.actionId === WAYPOINT_BUILD_ACTION_ID
    // The exact position is displayed by the independent server preview. The
    // semantic layer only highlights which existing edge owns the draft.
    ? draft.params.edgeId ?? null
    : null;

  return JSON.stringify({
    nodes: projection.nodes.map((node) => [
      node.id,
      node.label,
      node.objectType,
      node.position.x,
      node.position.y,
      node.visualState,
      // The country reference is captured by the persistent node input
      // binding, so a content-linking update must reconcile that binding.
      node.countryId
    ]),
    edges: projection.edges.map((edge) => [
      edge.id,
      edge.fromNodeId,
      edge.toNodeId,
      edge.visualState,
      edge.points.map((point) => [point.x, point.y])
    ]),
    highlights: projection.highlights.map((highlight) => [
      highlight.targetType,
      highlight.targetId,
      highlight.actionId,
      highlight.params
    ]),
    canSelectRoad: actionEnabled(projection, ROAD_BUILD_ACTION_ID),
    canSelectWaypoint: actionEnabled(projection, WAYPOINT_BUILD_ACTION_ID),
    // Traverse availability alone controls whether existing road hit zones
    // dispatch the game-local movement action. Current/order remain isolated in
    // `movementPresentationRenderKey` and never rebuild the network.
    canTraverse: actionEnabled(projection, MOVEMENT_TRAVERSE_ACTION_ID),
    selectedRoadNodes,
    selectedWaypoint
  });
}

/**
 * Build the smallest identity needed by locomotive order decorations.
 *
 * This key deliberately excludes the network, money and other public objects.
 * A server change from one current locomotive to the next can therefore update
 * the small vehicle badges and indicator without rebuilding roads, node labels
 * or Phaser input zones.
 */
export function movementPresentationRenderKey(projection: BoardProjection): string {
  return JSON.stringify([
    projection.locomotiveOrder,
    projection.currentLocomotiveId
  ]);
}
