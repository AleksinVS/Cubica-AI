/**
 * Accessible action projection for the Cards Money Trains board.
 *
 * The provider is intentionally independent from Phaser. It copies actions
 * already published in the authoritative session so the host can expose its
 * ordinary keyboard controls before or without creating the visual scene.
 */

import type {
  AccessibleBoardAction,
  AccessibleBoardActionsProvider
} from "@cubica/player-web/plugin-api";

import { projectBoardSession } from "./board-state.ts";

/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (
  action: ReturnType<typeof projectBoardSession>["availableActions"][number]
): AccessibleBoardAction => ({
  id: action.id,
  label: action.label,
  actionId: action.actionId,
  ...(action.description === undefined ? {} : { description: action.description }),
  ...(action.params === undefined ? {} : { params: { ...action.params } }),
  ...(action.disabled === undefined ? {} : { disabled: action.disabled })
});

/**
 * Return only actions present in the authoritative player-facing snapshot.
 * The plugin does not derive topology or gameplay permission in the browser.
 */
export const provideCardsMoneyTrainsAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => projectBoardSession(session).availableActions.map(toAccessibleAction);
