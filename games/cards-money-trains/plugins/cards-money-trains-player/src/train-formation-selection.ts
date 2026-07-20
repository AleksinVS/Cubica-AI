/**
 * Game-local input shaping for refresh-safe train formation.
 *
 * The browser sends only one public wagon id. Runtime owns the current
 * locomotive, every eligibility check, the persisted selection marker and the
 * final atomic group attachment.
 */

import type { BoardVehicleView } from "./board-state.ts";

export const TRAIN_WAGON_SELECT_ACTION_ID = "movement.train.wagon.select";
export const TRAIN_WAGON_UNSELECT_ACTION_ID = "movement.train.wagon.unselect";
export const TRAIN_ATTACH_SELECTED_ACTION_ID = "movement.train.attach.selected";

/** Copy one public wagon reference into the exact scalar Game Intent payload. */
export function trainWagonSelectionParams(
  wagonId: string
): Readonly<{ wagonId: string }> {
  return { wagonId };
}

/**
 * Project the correct explicit intent from the authoritative persisted marker.
 *
 * This does not decide whether the wagon is eligible. It only distinguishes a
 * marker already owned by the current locomotive from every other public state;
 * Runtime remains the sole legality authority and rejects stale snapshots.
 */
export function trainWagonSelectionActionId(
  wagon: Pick<BoardVehicleView, "formationTargetLocomotiveId">,
  currentLocomotiveId: string | null
): typeof TRAIN_WAGON_SELECT_ACTION_ID | typeof TRAIN_WAGON_UNSELECT_ACTION_ID {
  return isTrainWagonSelectedForCurrent(wagon, currentLocomotiveId)
    ? TRAIN_WAGON_UNSELECT_ACTION_ID
    : TRAIN_WAGON_SELECT_ACTION_ID;
}

/** Decide only whether to paint the persisted current-locomotive selection. */
export function isTrainWagonSelectedForCurrent(
  wagon: Pick<BoardVehicleView, "formationTargetLocomotiveId">,
  currentLocomotiveId: string | null
): boolean {
  return currentLocomotiveId !== null
    && wagon.formationTargetLocomotiveId === currentLocomotiveId;
}
