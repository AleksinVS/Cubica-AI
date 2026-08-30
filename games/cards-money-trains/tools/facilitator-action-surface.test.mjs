/**
 * Read-only guard for the facilitator's complete action surface.
 *
 * The checked-in authoring files are the source under test. The guard does not
 * depend on a compiled manifest schema: it follows only the stable semantic
 * fields needed to prove that every ordinary facilitator action has a visible
 * entry point and that board descriptors cannot silently drift from actions.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gameAuthoringUrl = new URL(
  "../authoring/game.authoring.json",
  import.meta.url
);
const webAuthoringUrl = new URL(
  "../authoring/ui/web.authoring.json",
  import.meta.url
);

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

/**
 * Collect string action references from any nested UI component.
 *
 * Recursive discovery keeps this test independent of concrete component types
 * and layout nesting while still requiring the explicit `actionId` contract.
 */
const collectActionIds = (value, result = new Set()) => {
  if (Array.isArray(value)) {
    for (const item of value) collectActionIds(item, result);
    return result;
  }
  if (value === null || typeof value !== "object") return result;

  for (const [key, child] of Object.entries(value)) {
    if (key === "actionId" && typeof child === "string") result.add(child);
    collectActionIds(child, result);
  }
  return result;
};

const loadActionSurface = async () => {
  const [gameAuthoring, webAuthoring] = await Promise.all([
    readJson(gameAuthoringUrl),
    readJson(webAuthoringUrl)
  ]);
  const actions = gameAuthoring.root.logic.actions;
  const boardActions = gameAuthoring.root.state.public.board.availableActions;
  return {
    actions,
    boardActions,
    boardActionIds: new Set(boardActions.map((action) => action.actionId)),
    uiActionIds: collectActionIds(webAuthoring)
  };
};

/**
 * Technical actions are internal regression hooks. Every other external
 * facilitator action is part of the ordinary game and therefore needs a
 * player-facing board descriptor, except the three dedicated finish controls
 * which live explicitly in the authored web layout.
 */
test("publishes every ordinary facilitator action through the board or finish controls", async () => {
  const { actions, boardActionIds, uiActionIds } = await loadActionSurface();
  const facilitatorActions = actions.filter((action) =>
    action.allowedSessionRoles?.includes("facilitator")
    && !action.id.startsWith("technical."));

  const missing = facilitatorActions
    .map((action) => action.id)
    .filter((actionId) =>
      !boardActionIds.has(actionId)
      && !(actionId.startsWith("session.finish.") && uiActionIds.has(actionId)));

  assert.deepEqual(
    missing,
    [],
    "ordinary facilitator actions must have a board or explicit finish control"
  );

  for (const actionId of [
    "session.finish.request",
    "session.finish.cancel",
    "session.finish.confirm"
  ]) {
    assert.ok(
      uiActionIds.has(actionId),
      `${actionId} must remain an explicit actionId in web authoring`
    );
  }
});

test("keeps board action ids unique and linked to external actions", async () => {
  const { actions, boardActions, boardActionIds } = await loadActionSurface();
  const externalActionIds = new Set(actions.map((action) => action.id));
  const duplicateActionIds = [...new Set(boardActions
    .map((action) => action.actionId)
    .filter((actionId, index, all) => all.indexOf(actionId) !== index))];
  const unknownActionIds = [...boardActionIds]
    .filter((actionId) => !externalActionIds.has(actionId));

  assert.deepEqual(
    duplicateActionIds,
    [],
    "one facilitator action must not create duplicate board forms"
  );
  assert.deepEqual(
    unknownActionIds,
    [],
    "every board descriptor must reference a declared external action"
  );
});

test("retains the critical lifecycle and progressive-tax action surface", async () => {
  const { actions, boardActionIds } = await loadActionSurface();
  const externalActionIds = new Set(actions.map((action) => action.id));
  const criticalActionIds = [
    "cards.lifecycle.initialize",
    "session.setup.team.add.logistics-company",
    "session.setup.team.add.locomotive-guild",
    "session.setup.finalize",
    "session.setup.place.wagon",
    "session.setup.place.locomotive",
    "session.play.start",
    "maintenance.pay.locomotive",
    "maintenance.pay.wagon",
    "maintenance.pay.held-cargo",
    "maintenance.phase.finish",
    "news.lifecycle.first-turn.skip",
    "news.lifecycle.draw",
    "news.lifecycle.stagnation",
    "news.effect.apply.14"
  ];

  for (const actionId of criticalActionIds) {
    assert.ok(
      externalActionIds.has(actionId),
      `${actionId} must remain an external game action`
    );
    assert.ok(
      boardActionIds.has(actionId),
      `${actionId} must remain published on the facilitator board`
    );
  }
});
