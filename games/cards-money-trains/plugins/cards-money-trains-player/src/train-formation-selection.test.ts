/** Focused tests for train-formation input shaping without importing Phaser. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAIN_ATTACH_SELECTED_ACTION_ID,
  TRAIN_WAGON_SELECT_ACTION_ID,
  TRAIN_WAGON_UNSELECT_ACTION_ID,
  isTrainWagonSelectedForCurrent,
  trainWagonSelectionActionId,
  trainWagonSelectionParams
} from "./train-formation-selection.ts";

test("uses three explicit bounded action ids and one scalar wagon parameter", () => {
  assert.equal(TRAIN_WAGON_SELECT_ACTION_ID, "movement.train.wagon.select");
  assert.equal(TRAIN_WAGON_UNSELECT_ACTION_ID, "movement.train.wagon.unselect");
  assert.equal(TRAIN_ATTACH_SELECTED_ACTION_ID, "movement.train.attach.selected");
  assert.deepEqual(trainWagonSelectionParams("wagon-public"), {
    wagonId: "wagon-public"
  });
});

test("selects or unselects from the persisted marker without guessing legality", () => {
  assert.equal(
    isTrainWagonSelectedForCurrent(
      { formationTargetLocomotiveId: "locomotive-current" },
      "locomotive-current"
    ),
    true
  );
  assert.equal(
    isTrainWagonSelectedForCurrent(
      { formationTargetLocomotiveId: "locomotive-current" },
      null
    ),
    false
  );
  assert.equal(
    trainWagonSelectionActionId(
      { formationTargetLocomotiveId: null },
      "locomotive-current"
    ),
    TRAIN_WAGON_SELECT_ACTION_ID
  );
  assert.equal(
    trainWagonSelectionActionId(
      { formationTargetLocomotiveId: "locomotive-current" },
      "locomotive-current"
    ),
    TRAIN_WAGON_UNSELECT_ACTION_ID
  );
  assert.equal(
    trainWagonSelectionActionId(
      { formationTargetLocomotiveId: "locomotive-other" },
      "locomotive-current"
    ),
    TRAIN_WAGON_SELECT_ACTION_ID
  );
  assert.equal(
    trainWagonSelectionActionId(
      { formationTargetLocomotiveId: "locomotive-current" },
      null
    ),
    TRAIN_WAGON_SELECT_ACTION_ID
  );
});
