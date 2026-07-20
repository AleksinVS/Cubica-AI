import { performance } from "node:perf_hooks";
import type {
  DispatchActionInput,
  DispatchActionResponse,
  SessionRecord,
  TransportRoadPreviewRequest,
  TransportRoadPreviewResponse
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import type { SessionStorePort } from "@cubica/contracts-session";
import { loadImmutableGameBundle } from "../content/manifestLoader.ts";
import { projectPlayerSessionState } from "../session/playerSessionProjection.ts";
import { dispatchRuntimeAction } from "./actionDispatcher.ts";
import { projectSessionActionAvailability } from "./actionAvailability.ts";
import {
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError
} from "../session/sessionStoreErrors.ts";
import {
  hashSessionCredential,
  resolveSessionActor,
  resolveSessionViewerActor
} from "../session/sessionAuthentication.ts";
import { previewRuntimeTransportRoad } from "./transportRoadPreview.ts";
import { processPendingSystemSchedules } from "./systemScheduler.ts";
import {
  BoundedInMemoryCommandAdmissionController,
  type CommandAdmissionController
} from "./commandAdmission.ts";

type RuntimeState = Record<string, unknown>;

export interface RuntimeServiceDispatchOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  accessToken: string;
  input: DispatchActionInput;
}

export interface RuntimeServiceDispatchResult {
  response: DispatchActionResponse<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
  /**
   * Internal observability only. The HTTP adapter converts these bounded
   * aggregate durations into `Server-Timing`; the JSON response deliberately
   * receives only `response`, so no runtime identifiers or implementation
   * details cross the public contract.
   */
  timings: RuntimeServiceDispatchTimings;
}

/**
 * Coarse action latency buckets. They intentionally contain durations only:
 * no session/action ids, parameters, SQL, object counts or secret state.
 *
 * Scheduler and reload are absent when the external action did not commit, so
 * the post-commit scheduler pass was not attempted.
 */
export interface RuntimeServiceDispatchTimings {
  dispatchMs: number;
  schedulerMs?: number;
  reloadMs?: number;
  projectionMs: number;
  actionAvailabilityMs: number;
  totalMs: number;
}

export interface RuntimeServiceTransportRoadPreviewOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  accessToken: string;
  input: TransportRoadPreviewRequest;
}

export class RuntimeService {
  private readonly admissionController: CommandAdmissionController;

  constructor(
    admissionController: CommandAdmissionController = new BoundedInMemoryCommandAdmissionController()
  ) {
    this.admissionController = admissionController;
  }

  async dispatch(options: RuntimeServiceDispatchOptions): Promise<RuntimeServiceDispatchResult> {
    const totalStartedAt = performance.now();
    const credentialSha256 = hashSessionCredential(options.accessToken);
    const dispatchStartedAt = performance.now();
    const { snapshot, result, receipt, bundle, actorPlayerId, sessionRole, committedState } = await dispatchRuntimeAction({
      sessionStore: options.sessionStore,
      credentialSha256,
      input: options.input,
      admissionController: this.admissionController
    });
    const dispatchMs = elapsedMilliseconds(dispatchStartedAt);
    let responseSnapshot = snapshot;
    let responseActorPlayerId = actorPlayerId;
    let responseSessionRole = sessionRole;
    let schedulerMs: number | undefined;
    let reloadMs: number | undefined;
    if (committedState) {
      const schedulerStartedAt = performance.now();
      // A failed pass may have committed an earlier schedule before a later
      // failure, so it must still reload. Only an explicit zero-attempt result
      // proves that the just-committed external snapshot is already current.
      let reloadAfterScheduler = true;
      try {
        // This is a distinct post-commit pass. A scheduler failure must not
        // turn an already committed external command into a transport error.
        const schedulerResult = await processPendingSystemSchedules(
          options.sessionStore,
          snapshot.sessionId
        );
        reloadAfterScheduler = schedulerResult.attempted > 0;
      } catch (error) {
        console.error(
          `[system-scheduler] bounded pass failed for session ${snapshot.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        schedulerMs = elapsedMilliseconds(schedulerStartedAt);
      }

      if (reloadAfterScheduler) {
        const reloadStartedAt = performance.now();
        try {
          // Earlier schedules may already have committed before a later one in
          // the bounded pass failed. Reload independently of the pass outcome,
          // then resolve the viewer again because a system intent may have
          // switched the active hot-seat actor.
          const [latestSnapshot, latestPrincipal] = await Promise.all([
            options.sessionStore.getSession(snapshot.sessionId),
            options.sessionStore.authenticateSession({
              sessionId: snapshot.sessionId,
              credentialSha256
            })
          ]);
          if (latestSnapshot !== null && latestPrincipal !== null) {
            responseSnapshot = latestSnapshot;
            responseActorPlayerId = resolveSessionViewerActor(latestSnapshot, latestPrincipal);
            responseSessionRole = latestPrincipal.role;
          }
        } catch (error) {
          console.error(
            `[system-scheduler] current snapshot reload failed for session ${snapshot.sessionId}:`,
            error instanceof Error ? error.message : String(error)
          );
        } finally {
          reloadMs = elapsedMilliseconds(reloadStartedAt);
        }
      }
    }

    const projectionStartedAt = performance.now();
    const projectedState = projectPlayerSessionState({
      state: responseSnapshot.state,
      stateModel: bundle.manifest.mechanics.stateModel,
      ...(responseActorPlayerId === undefined ? {} : { actorPlayerId: responseActorPlayerId })
    });
    const projectionMs = elapsedMilliseconds(projectionStartedAt);

    const actionAvailabilityStartedAt = performance.now();
    const actionAvailability = projectSessionActionAvailability(responseSnapshot, bundle, {
      ...(responseActorPlayerId === undefined ? {} : { actorPlayerId: responseActorPlayerId }),
      sessionRole: responseSessionRole
    });
    const actionAvailabilityMs = elapsedMilliseconds(actionAvailabilityStartedAt);

    return {
      response: {
        sessionId: responseSnapshot.sessionId,
        version: responseSnapshot.version,
        state: projectedState,
        actionAvailability,
        receipt
      },
      result,
      timings: {
        dispatchMs,
        ...(schedulerMs === undefined ? {} : { schedulerMs }),
        ...(reloadMs === undefined ? {} : { reloadMs }),
        projectionMs,
        actionAvailabilityMs,
        totalMs: elapsedMilliseconds(totalStartedAt)
      }
    };
  }

  /**
   * Read one immutable snapshot and calculate a non-authoritative road plan.
   * No store lock is required because no write occurs; the exact requested
   * version and returned `usedStateVersion` make staleness explicit.
   */
  async previewTransportRoad(
    options: RuntimeServiceTransportRoadPreviewOptions
  ): Promise<TransportRoadPreviewResponse> {
    const snapshot = await options.sessionStore.getSession(options.input.sessionId);
    const principal = await options.sessionStore.authenticateSession({
      sessionId: options.input.sessionId,
      credentialSha256: hashSessionCredential(options.accessToken)
    });
    if (!snapshot || !principal) {
      throw new SessionAuthenticationError();
    }
    if (snapshot.version.stateVersion !== options.input.expectedStateVersion) {
      throw new SessionVersionConflictError(
        snapshot.sessionId,
        options.input.expectedStateVersion
      );
    }
    const storedBundle = await options.sessionStore.getImmutableBundle(snapshot.bundleHash);
    if (storedBundle === null) {
      throw new SessionStoreUnavailableError();
    }
    const bundle = loadImmutableGameBundle(storedBundle);
    return previewRuntimeTransportRoad({
      snapshot,
      bundle,
      actorPlayerId: resolveSessionActor(snapshot, principal),
      sessionRole: principal.role,
      input: options.input
    });
  }
}

/**
 * Convert a monotonic clock delta to the only shape accepted by downstream
 * observability. A clock anomaly must never produce NaN, infinity or a
 * negative `Server-Timing` duration.
 */
function elapsedMilliseconds(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}
