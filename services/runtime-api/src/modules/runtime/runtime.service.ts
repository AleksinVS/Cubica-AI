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
    const credentialSha256 = hashSessionCredential(options.accessToken);
    const { snapshot, result, receipt, bundle, actorPlayerId, sessionRole, committedState } = await dispatchRuntimeAction({
      sessionStore: options.sessionStore,
      credentialSha256,
      input: options.input,
      admissionController: this.admissionController
    });
    let responseSnapshot = snapshot;
    let responseActorPlayerId = actorPlayerId;
    let responseSessionRole = sessionRole;
    if (committedState) {
      try {
        // This is a distinct post-commit pass. A scheduler failure must not
        // turn an already committed external command into a transport error.
        await processPendingSystemSchedules(options.sessionStore, snapshot.sessionId);
      } catch (error) {
        console.error(
          `[system-scheduler] bounded pass failed for session ${snapshot.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }

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
      }
    }

    return {
      response: {
        sessionId: responseSnapshot.sessionId,
        version: responseSnapshot.version,
        state: projectPlayerSessionState({
          state: responseSnapshot.state,
          stateModel: bundle.manifest.mechanics.stateModel,
          ...(responseActorPlayerId === undefined ? {} : { actorPlayerId: responseActorPlayerId })
        }),
        actionAvailability: projectSessionActionAvailability(responseSnapshot, bundle, {
          ...(responseActorPlayerId === undefined ? {} : { actorPlayerId: responseActorPlayerId }),
          sessionRole: responseSessionRole
        }),
        receipt
      },
      result
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
