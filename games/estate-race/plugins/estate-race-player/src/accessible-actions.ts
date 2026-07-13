/**
 * Accessible action projection for the Estate Race board.
 *
 * This provider deliberately reads the same server-owned public projection as
 * the Phaser scene. Keeping it independent from scene construction lets the
 * host render keyboard controls even when the visual engine is unavailable.
 */

import type {
  AccessibleBoardAction,
  AccessibleBoardActionsProvider
} from "@cubica/player-web/plugin-api";

import { projectEstateRaceSession } from "./board-state.ts";

/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (
  action: ReturnType<typeof projectEstateRaceSession>["availableActions"][number]
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
 * No legality, price, phase, or turn rule is inferred in the browser.
 */
export const provideEstateRaceAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => projectEstateRaceSession(session).availableActions.map(toAccessibleAction);
