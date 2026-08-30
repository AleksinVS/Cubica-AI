/**
 * Temporary movement-selection helpers for the mock game-owned plugin.
 *
 * They shape map clicks into the same scalar action draft that the accessible
 * DOM form uses. They do not decide whether a locomotive may traverse a road:
 * the authoritative runtime validates ownership, adjacency, road state,
 * capacity, and action points when the facilitator submits the form.
 */

import type { InteractiveBoardActionDraft } from "@cubica/player-web/plugin-api";

export const LOCOMOTIVE_MOVE_ACTION_ID = "mock.locomotive.move";

/**
 * Select an active locomotive and clear a road chosen for another locomotive.
 *
 * A second click on the same marker cancels the local movement choice. `null`
 * values are deliberate draft tombstones: they prevent an authored default
 * from silently returning in the controlled DOM form.
 */
export function selectMovementDraftVehicle(
  current: InteractiveBoardActionDraft | null,
  vehicleId: string
): InteractiveBoardActionDraft {
  const params = current?.actionId === LOCOMOTIVE_MOVE_ACTION_ID
    ? { ...current.params }
    : {};
  const selectedVehicleId = typeof params.vehicleId === "string" ? params.vehicleId : null;

  if (selectedVehicleId === vehicleId) {
    params.vehicleId = null;
    params.edgeId = null;
  } else {
    params.vehicleId = vehicleId;
    params.edgeId = null;
  }

  return { actionId: LOCOMOTIVE_MOVE_ACTION_ID, params };
}

/**
 * Add an existing road only after a locomotive has been selected.
 *
 * Returning the unchanged draft when no locomotive is selected keeps a road
 * click from inventing a partial command with ambiguous subject.
 */
export function selectMovementDraftEdge(
  current: InteractiveBoardActionDraft | null,
  edgeId: string
): InteractiveBoardActionDraft | null {
  if (
    current?.actionId !== LOCOMOTIVE_MOVE_ACTION_ID
    || typeof current.params.vehicleId !== "string"
  ) {
    return current;
  }

  return {
    actionId: LOCOMOTIVE_MOVE_ACTION_ID,
    params: { ...current.params, edgeId }
  };
}
