/**
 * Bounded internal driver for protected system schedules.
 *
 * The driver takes one stable snapshot of pending schedules and attempts at
 * most one occurrence from each. It never recursively drains schedules created
 * by a system action, and the publication/runtime contracts forbid such nested
 * mutations altogether.
 */
import type { SessionStorePort } from "@cubica/contracts-session";
import { createSystemCommandId } from "../session/commandIdentity.ts";
import {
  dispatchRuntimeSystemAction,
  type DispatchRuntimeSystemActionOutcome
} from "./systemActionDispatcher.ts";

type RuntimeState = Record<string, unknown>;

export interface ProcessSystemSchedulesResult {
  sessionId: string;
  attempted: number;
  outcomes: ReadonlyArray<DispatchRuntimeSystemActionOutcome>;
}

/**
 * Process one bounded pass after a committed state/trusted-time update.
 *
 * A false `defer` trigger remains pending and is retried only after a later
 * notification. Exact duplicate notifications are safe because the store
 * checks the deterministic receipt before occurrence state.
 */
export async function processPendingSystemSchedules(
  sessionStore: SessionStorePort<RuntimeState>,
  sessionId: string,
  limit = 64
): Promise<ProcessSystemSchedulesResult> {
  const schedules = await sessionStore.listPendingSystemSchedules(sessionId, limit);
  const outcomes: Array<DispatchRuntimeSystemActionOutcome> = [];
  for (const schedule of schedules) {
    const occurrence = schedule.nextOccurrence;
    outcomes.push(await dispatchRuntimeSystemAction({
      sessionStore,
      sessionId,
      scheduleId: schedule.scheduleId,
      occurrence,
      commandId: createSystemCommandId(sessionId, schedule.scheduleId, occurrence)
    }));
  }
  return {
    sessionId,
    attempted: schedules.length,
    outcomes
  };
}
