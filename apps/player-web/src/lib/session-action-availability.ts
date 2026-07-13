/**
 * Delivery-side helpers for server-projected action availability.
 *
 * The server owns the decision; this module only translates stable reason
 * codes into Russian interface copy. Missing projection data is tolerated for
 * an older cached server response, while runtime dispatch remains authoritative.
 */

import type { SessionActionAvailability } from "@cubica/contracts-session";
import type { GameSession } from "@/types/game-state";

export function findSessionActionAvailability(
  session: GameSession | undefined,
  actionId: string
): SessionActionAvailability | undefined {
  return session?.actionAvailability?.find((item) => item.actionId === actionId);
}

export function isSessionActionUnavailable(
  session: GameSession | undefined,
  actionId: string
): boolean {
  return findSessionActionAvailability(session, actionId)?.status === "unavailable";
}

export function sessionActionUnavailableReason(
  session: GameSession | undefined,
  actionId: string
): string | undefined {
  const availability = findSessionActionAvailability(session, actionId);
  if (availability?.status !== "unavailable") return undefined;
  switch (availability.reasonCode) {
    case "role_not_allowed":
      return "Действие недоступно для вашей роли в этой сессии.";
    case "state_condition_failed":
      return "Действие недоступно в текущем состоянии игры.";
    case "runtime_unsupported":
      return "Действие не поддерживается текущей версией игровой системы.";
    default:
      return "Действие сейчас недоступно.";
  }
}
