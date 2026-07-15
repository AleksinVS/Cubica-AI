import type {
  DispatchActionInput,
  DispatchActionResponse,
  SessionRecord,
  TransportRoadPreviewRequest,
  TransportRoadPreviewResponse
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import type { SessionStorePort } from "@cubica/contracts-session";
import { contentService } from "../content/contentService.ts";
import { projectPlayerSessionState } from "../session/playerSessionProjection.ts";
import { dispatchRuntimeAction } from "./actionDispatcher.ts";
import { projectSessionActionAvailability } from "./actionAvailability.ts";
import { NotFoundError } from "../errors.ts";
import { SessionVersionConflictError } from "../session/sessionStoreErrors.ts";
import { previewRuntimeTransportRoad } from "./transportRoadPreview.ts";

type RuntimeState = Record<string, unknown>;

export interface RuntimeServiceDispatchOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  gameId: string;
  contentSourceId?: string;
  input: DispatchActionInput;
}

export interface RuntimeServiceDispatchResult {
  response: DispatchActionResponse<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
}

export interface RuntimeServiceTransportRoadPreviewOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  input: TransportRoadPreviewRequest;
}

export class RuntimeService {
  async dispatch(options: RuntimeServiceDispatchOptions): Promise<RuntimeServiceDispatchResult> {
    const bundle = await contentService.getBundle(options.gameId, options.contentSourceId);

    const { snapshot, result } = await dispatchRuntimeAction({
      sessionStore: options.sessionStore,
      bundle,
      input: options.input
    });

    return {
      response: {
        sessionId: snapshot.sessionId,
        version: snapshot.version,
        state: projectPlayerSessionState(snapshot.state),
        actionAvailability: projectSessionActionAvailability(snapshot, bundle)
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
    if (!snapshot) {
      throw new NotFoundError(`Session "${options.input.sessionId}" was not found`);
    }
    if (snapshot.version.stateVersion !== options.input.expectedStateVersion) {
      throw new SessionVersionConflictError(
        snapshot.sessionId,
        options.input.expectedStateVersion
      );
    }
    const bundle = await contentService.getBundle(snapshot.gameId, snapshot.contentSourceId);
    return previewRuntimeTransportRoad({ snapshot, bundle, input: options.input });
  }
}
