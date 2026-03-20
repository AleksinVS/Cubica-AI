import type {
  DispatchActionInput,
  DispatchActionResponse,
  SessionRecord
} from "@cubica/contracts-session";
import type { RuntimeActionResult } from "@cubica/contracts-runtime";
import type { SessionStorePort } from "@cubica/contracts-session";
import { contentService } from "../content/contentService.ts";
import { dispatchRuntimeAction } from "./actionDispatcher.ts";

type RuntimeState = Record<string, unknown>;

export interface RuntimeServiceDispatchOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  gameId: string;
  input: DispatchActionInput;
}

export interface RuntimeServiceDispatchResult {
  response: DispatchActionResponse<RuntimeState>;
  result: RuntimeActionResult<RuntimeState>;
}

export class RuntimeService {
  async dispatch(options: RuntimeServiceDispatchOptions): Promise<RuntimeServiceDispatchResult> {
    const bundle = await contentService.getBundle(options.gameId);

    const { snapshot, result } = await dispatchRuntimeAction({
      sessionStore: options.sessionStore,
      bundle,
      input: options.input
    });

    return {
      response: {
        sessionId: snapshot.sessionId,
        version: snapshot.version,
        state: snapshot.state
      },
      result
    };
  }
}
