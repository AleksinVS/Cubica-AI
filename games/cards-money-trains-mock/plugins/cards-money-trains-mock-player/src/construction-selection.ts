/**
 * Temporary construction-selection helpers for the mock game-owned plugin.
 *
 * They only shape canvas input into an action draft. Runtime remains the sole
 * authority for whether the selected nodes, edge, and position are legal.
 */

import type { InteractiveBoardActionDraft } from "@cubica/player-web/plugin-api";

export const ROAD_BUILD_ACTION_ID = "construction.road.build";
export const WAYPOINT_BUILD_ACTION_ID = "construction.waypoint.build";

/** Select the first/second road endpoint, then start a fresh pair. */
export function selectRoadDraftNode(
  current: InteractiveBoardActionDraft | null,
  nodeId: string
): InteractiveBoardActionDraft {
  const params = current?.actionId === ROAD_BUILD_ACTION_ID ? { ...current.params } : {};
  const fromNodeId = typeof params.fromNodeId === "string" ? params.fromNodeId : null;
  const toNodeId = typeof params.toNodeId === "string" ? params.toNodeId : null;

  if (!fromNodeId || toNodeId) {
    params.fromNodeId = nodeId;
    // `null` is a local tombstone: it prevents a stale authored default from
    // reappearing in the controlled DOM form while the second node is unset.
    params.toNodeId = null;
  } else if (fromNodeId === nodeId) {
    params.fromNodeId = null;
    params.toNodeId = null;
  } else {
    params.toNodeId = nodeId;
  }

  return { actionId: ROAD_BUILD_ACTION_ID, params };
}

/** Select a road and a normalized point on its already projected polyline. */
export function selectWaypointDraftPosition(
  current: InteractiveBoardActionDraft | null,
  edgeId: string,
  positionT: number
): InteractiveBoardActionDraft {
  const params = current?.actionId === WAYPOINT_BUILD_ACTION_ID ? { ...current.params } : {};
  params.edgeId = edgeId;
  params.positionT = positionT;
  return { actionId: WAYPOINT_BUILD_ACTION_ID, params };
}
