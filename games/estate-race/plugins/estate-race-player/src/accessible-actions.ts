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

const buildingUnitKindFields = [{
  name: "unitKind",
  label: "Тип строения",
  kind: "select" as const,
  required: true,
  options: [
    { value: "house", label: "Дом" },
    { value: "hotel", label: "Отель" }
  ]
}];

const buildingRequestFields = [{
  name: "cellId",
  label: "Идентификатор участка",
  kind: "text" as const,
  required: true,
  minLength: 1,
  maxLength: 128
}];

const tradeTargetFields = [{
  name: "targetPlayerId",
  label: "Участник сделки",
  kind: "text" as const,
  required: true,
  minLength: 1,
  maxLength: 128
}];

const tradeCashFields = [
  { name: "offeredCash", label: "Предлагаемые деньги", kind: "number" as const, required: true, min: 0, max: ESTATE_AUCTION_BID_MAX, step: 1 },
  { name: "requestedCash", label: "Запрашиваемые деньги", kind: "number" as const, required: true, min: 0, max: ESTATE_AUCTION_BID_MAX, step: 1 }
];

const tradeAssetFields = [
  { name: "cellId", label: "Идентификатор объекта", kind: "text" as const, required: true, minLength: 1, maxLength: 128 },
  { name: "side", label: "Сторона сделки", kind: "text" as const, required: true, minLength: 1, maxLength: 16 }
];

const tradeCellFields = [{
  name: "cellId",
  label: "Идентификатор объекта",
  kind: "text" as const,
  required: true,
  minLength: 1,
  maxLength: 128
}];

const tradeCardFields = [{
  name: "cardId",
  label: "Идентификатор карты",
  kind: "text" as const,
  required: true,
  minLength: 1,
  maxLength: 128
}];

const bankruptcyCardFields = [
  { name: "heldCardId", label: "Первая удерживаемая карта", kind: "text" as const, required: false, defaultValue: "", maxLength: 32 },
  { name: "heldCardId2", label: "Вторая удерживаемая карта", kind: "text" as const, required: false, defaultValue: "", maxLength: 32 }
];

/**
 * Parameter forms are the only way these actions can be submitted from the
 * ordinary DOM path. Their server-projected `params` are intentionally not
 * forwarded: the form supplies the declared scalar and Runtime validates it
 * against the published action schema and current state.
 * Bankruptcy uses explicit empty-string defaults because its closed schema
 * requires both card slots even when the actor holds no card.
 */
type ParameterFormFields = NonNullable<AccessibleBoardAction["fields"]>;

const parameterFormFields: Readonly<Record<string, ParameterFormFields>> = {
  "property.auction.bid": auctionBidFields,
  "property.build": buildingUnitKindFields,
  "property.build.request": buildingRequestFields,
  "property.build.auction.bid": auctionBidFields,
  "property.sell": buildingRequestFields,
  "property.mortgage": buildingRequestFields,
  "property.redeem": buildingRequestFields,
  "trade.open": tradeTargetFields,
  "trade.cash.set": tradeCashFields,
  "trade.asset.set": tradeAssetFields,
  "trade.asset.remove": tradeCellFields,
  "trade.card.offer": tradeCardFields,
  "trade.card.request": tradeCardFields,
  "bankruptcy.declare": bankruptcyCardFields
};

/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (
  action: ReturnType<typeof projectEstateRaceSession>["availableActions"][number]
): AccessibleBoardAction => ({
  id: action.id,
  label: action.label,
  actionId: action.actionId,
  ...(action.description === undefined ? {} : { description: action.description }),
  ...(parameterFormFields[action.actionId] === undefined && action.params !== undefined
    ? { params: { ...action.params } }
    : {}),
  ...(parameterFormFields[action.actionId] === undefined
    ? {}
    : { fields: parameterFormFields[action.actionId] }),
  ...(action.disabled === undefined ? {} : { disabled: action.disabled })
});

/**
 * Return only actions present in the authoritative player-facing snapshot.
 * No legality, price, phase, or turn rule is inferred in the browser.
 */
export const provideEstateRaceAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => projectEstateRaceSession(session).availableActions.map(toAccessibleAction);
