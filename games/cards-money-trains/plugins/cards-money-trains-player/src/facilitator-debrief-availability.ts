import type { FacilitatorDebriefAvailabilityProvider } from "@cubica/player-web/plugin-api";

import { projectBoardSession } from "./board-state.ts";

/**
 * Exposes the debrief affordance only after the existing authoritative final
 * results projection has accepted a completed session. This provider does not
 * duplicate final-result validation or grant runtime authorization.
 */
export const provideCardsMoneyTrainsFacilitatorDebriefAvailability: FacilitatorDebriefAvailabilityProvider = (
  session
) => {
  const projection = projectBoardSession(session);
  return projection.finalResults !== null && projection.finalResults !== undefined;
};
