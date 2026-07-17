/**
 * Trusted delivery path for one protected system-schedule occurrence.
 *
 * This module is intentionally not an HTTP controller. Authority comes from
 * `SessionStorePort.withSystemCommandTransaction`, which loads the pinned
 * schedule under the session lock. A `sys_` string presented through the
 * public credential path never reaches this boundary.
 */
import type {
  DispatchActionInput,
  PublicSessionCommandReceipt,
  SessionEventRecord,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import {
  loadImmutableGameBundle,
  loadImmutableGameBundleForReceipt
} from "../content/manifestLoader.ts";
import { RequestValidationError } from "../errors.ts";
import {
  createAppliedCommandReceipt,
  createDurableCommandResult,
  createRejectedCommandReceipt,
  createSystemCommandFingerprint
} from "../session/commandIdentity.ts";
import {
  CommandIdReusedError,
  SessionStoreUnavailableError
} from "../session/sessionStoreErrors.ts";
import {
  executeProtectedSystemIntentCandidate
} from "./actionDispatcher.ts";
import { getRegisteredActionDefinition } from "./actionRegistry.ts";

type RuntimeState = Record<string, unknown>;

export interface DispatchRuntimeSystemActionOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  sessionId: string;
  scheduleId: string;
  occurrence: number;
  commandId: string;
}

export interface DispatchRuntimeSystemActionOutcome {
  status: "applied" | "rejected" | "deferred";
  snapshot: SessionRecord<RuntimeState>;
  receipt?: PublicSessionCommandReceipt;
  result?: RuntimeActionResult<RuntimeState>;
}

/**
 * Re-check and execute one occurrence. Receipt lookup, trigger evaluation,
 * state mutation and occurrence consumption all happen under one store lock.
 */
export async function dispatchRuntimeSystemAction(
  options: DispatchRuntimeSystemActionOptions
): Promise<DispatchRuntimeSystemActionOutcome> {
  return options.sessionStore.withSystemCommandTransaction<DispatchRuntimeSystemActionOutcome>({
    sessionId: options.sessionId,
    scheduleId: options.scheduleId,
    occurrence: options.occurrence,
    commandId: options.commandId
  }, async ({ currentSession: current, principal, bundle: storedBundle, schedule, existingReceipt }) => {
    const bundle = existingReceipt === undefined
      ? loadImmutableGameBundle(storedBundle)
      : loadImmutableGameBundleForReceipt(storedBundle);
    const fingerprint = createSystemCommandFingerprint({
      sessionId: current.sessionId,
      scheduleId: schedule.scheduleId,
      occurrence: options.occurrence,
      actionId: schedule.actionId,
      params: schedule.params,
      bundleHash: schedule.bundleHash,
      definitionHash: schedule.definitionHash
    });

    if (existingReceipt) {
      if (existingReceipt.actionId !== schedule.actionId || existingReceipt.fingerprint !== fingerprint) {
        throw new CommandIdReusedError(options.commandId);
      }
      return {
        scheduleDisposition: "defer",
        result: {
          status: existingReceipt.status,
          snapshot: current,
          receipt: existingReceipt.publicReceipt
        }
      };
    }

    const definition = getRegisteredActionDefinition(bundle, schedule.actionId);
    if (!definition || definition.invocation !== "system" ||
        definition.definitionHash !== schedule.definitionHash ||
        current.bundleHash !== schedule.bundleHash) {
      throw new SessionStoreUnavailableError();
    }

    const command = systemReceiptCommand(current, schedule.actionId, options.commandId, schedule.params);
    const targetPlan = bundle.manifest.mechanics.plans[definition.binding.planRef];
    if (!targetPlan) throw new SessionStoreUnavailableError();

    let executed: Awaited<ReturnType<typeof executeProtectedSystemIntentCandidate>>;
    try {
      executed = await executeProtectedSystemIntentCandidate({
        bundle,
        state: current.state,
        sessionId: current.sessionId,
        actionId: schedule.actionId,
        params: schedule.params,
        sessionRole: principal.role,
        scheduleId: schedule.scheduleId,
        trigger: schedule.trigger as never,
        now: new Date()
      });
    } catch (error) {
      if (!(error instanceof RequestValidationError)) throw error;

      // Authorization, parameter and live-reference checks are repeated at
      // delivery time. A deterministic failure is terminal for this
      // occurrence; leaving it pending would create a poison schedule that
      // blocks every later bounded pass.
      const receipt = createRejectedCommandReceipt({
        command,
        principal,
        current,
        fingerprint,
        definitionHash: definition.definitionHash,
        planHash: targetPlan.planHash,
        rejectionCode: "SYSTEM_INTENT_ADMISSION_REJECTED",
        durableResult: createDurableCommandResult("game-intent", {
          ok: false,
          error: {
            code: "SYSTEM_INTENT_ADMISSION_REJECTED",
            message: "The protected system intent no longer passes runtime admission."
          }
        })
      });
      return {
        scheduleDisposition: "skip",
        receipt,
        result: {
          status: "rejected",
          snapshot: current,
          receipt: receipt.publicReceipt,
          result: {
            ok: false,
            error: {
              code: "SYSTEM_INTENT_ADMISSION_REJECTED",
              message: "The protected system intent no longer passes runtime admission."
            }
          }
        }
      };
    }
    if (!executed.triggerPassed && schedule.falsePolicy === "defer") {
      return {
        scheduleDisposition: "defer",
        result: { status: "deferred", snapshot: current }
      };
    }
    if (!executed.triggerPassed) {
      const receipt = createRejectedCommandReceipt({
        command,
        principal,
        current,
        fingerprint,
        definitionHash: definition.definitionHash,
        planHash: targetPlan.planHash,
        rejectionCode: "SYSTEM_SCHEDULE_TRIGGER_SKIPPED",
        durableResult: createDurableCommandResult("game-intent", {
          ok: false,
          error: {
            code: "SYSTEM_SCHEDULE_TRIGGER_SKIPPED",
            message: "The protected system trigger was false."
          }
        })
      });
      return {
        scheduleDisposition: "skip",
        receipt,
        result: {
          status: "rejected",
          snapshot: current,
          receipt: receipt.publicReceipt,
          result: {
            ok: false,
            error: {
              code: "SYSTEM_SCHEDULE_TRIGGER_SKIPPED",
              message: "The protected system trigger was false."
            }
          }
        }
      };
    }
    if (!executed.result.ok || !executed.candidateState) {
      const receipt = createRejectedCommandReceipt({
        command,
        principal,
        current,
        fingerprint,
        definitionHash: definition.definitionHash,
        planHash: executed.planHash,
        rejectionCode: executed.result.error?.code ?? "SYSTEM_INTENT_REJECTED",
        durableResult: createDurableCommandResult("game-intent", {
          ok: false,
          ...(executed.result.error === undefined ? {} : { error: structuredClone(executed.result.error) })
        })
      });
      return {
        scheduleDisposition: "skip",
        receipt,
        result: {
          status: "rejected",
          snapshot: current,
          receipt: receipt.publicReceipt,
          result: executed.result
        }
      };
    }
    if ((executed.result.systemScheduleMutations?.length ?? 0) > 0) {
      // The first scheduler version forbids system intents from creating or
      // cancelling more schedules. This makes recursive trigger chains
      // impossible even if a malformed bundle bypassed publication checks.
      throw new SessionStoreUnavailableError();
    }

    const eventRefs = Array.from({ length: executed.events.length }, (_, index) =>
      `${current.sessionId}:${current.version.lastEventSequence + index + 1}`);
    const snapshot: SessionRecord<RuntimeState> = {
      ...current,
      state: executed.candidateState,
      version: {
        sessionId: current.sessionId,
        stateVersion: current.version.stateVersion + 1,
        lastEventSequence: current.version.lastEventSequence + executed.events.length
      },
      updatedAt: new Date()
    };
    const receipt = createAppliedCommandReceipt({
      command,
      principal,
      before: current,
      after: snapshot,
      fingerprint,
      definitionHash: definition.definitionHash,
      planHash: executed.planHash,
      eventRefs,
      ...(executed.result.mechanicsAudit === undefined
        ? {}
        : { mechanicsAudit: executed.result.mechanicsAudit }),
      durableResult: createDurableCommandResult("game-intent", { ok: true })
    });
    const events: Array<SessionEventRecord> = executed.events.map((event, index) => ({
      eventId: eventRefs[index],
      sessionId: current.sessionId,
      sequence: current.version.lastEventSequence + index + 1,
      receiptId: receipt.receiptId,
      commandId: options.commandId,
      actionId: schedule.actionId,
      principalId: principal.principalId,
      audience: event.audience,
      eventType: event.eventType,
      summary: structuredClone(event.summary),
      data: structuredClone(event.data),
      createdAt: snapshot.updatedAt
    }));
    return {
      scheduleDisposition: "apply",
      updatedSession: snapshot,
      receipt,
      events,
      result: {
        status: "applied",
        snapshot,
        receipt: receipt.publicReceipt,
        result: executed.result
      }
    };
  });
}

function systemReceiptCommand(
  current: SessionRecord<RuntimeState>,
  actionId: string,
  commandId: string,
  params: Record<string, string | number | boolean>
): DispatchActionInput {
  return {
    sessionId: current.sessionId,
    actionId,
    commandId,
    // Receipt helpers share one shape with external commands. The value is
    // audit-local only: system fingerprints and store admission never read it.
    expectedStateVersion: current.version.stateVersion,
    params: structuredClone(params)
  };
}
