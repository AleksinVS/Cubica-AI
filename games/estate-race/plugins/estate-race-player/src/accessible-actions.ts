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

export const ESTATE_AUCTION_BID_MAX = Number.MAX_SAFE_INTEGER;

/** Structural input guard only; server rules decide whether a bid is legal. */
export const isStructurallyValidEstateAuctionBid = (value: unknown): value is number =>
  typeof value === "number"
  && Number.isSafeInteger(value)
  && value >= 0
  && value <= ESTATE_AUCTION_BID_MAX;

const auctionBidFields = [{
  name: "amount",
  label: "Сумма ставки",
  kind: "number" as const,
  required: true,
  min: 0,
  max: ESTATE_AUCTION_BID_MAX,
  step: 1
}];

/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (
  action: ReturnType<typeof projectEstateRaceSession>["availableActions"][number]
): AccessibleBoardAction => ({
  id: action.id,
  label: action.label,
  actionId: action.actionId,
  ...(action.description === undefined ? {} : { description: action.description }),
  ...(action.actionId === "property.auction.bid"
    ? {}
    : action.params === undefined ? {} : { params: { ...action.params } }),
  ...(action.actionId === "property.auction.bid" ? { fields: auctionBidFields } : {}),
  ...(action.disabled === undefined ? {} : { disabled: action.disabled })
});

/**
 * Return only actions present in the authoritative player-facing snapshot.
 * No legality, price, phase, or turn rule is inferred in the browser.
 */
export const provideEstateRaceAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => projectEstateRaceSession(session).availableActions.map(toAccessibleAction);
