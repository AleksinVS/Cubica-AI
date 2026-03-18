import { useEffect, useState } from "react";
import type { SessionOptions } from "@cubica/sdk-core";
import { createRouterClient } from "../adapters/routerClient";

export interface SessionState<TState = unknown> {
  status: "idle" | "connecting" | "ready" | "error";
  data: TState | null;
  error?: Error;
}

export function useCubicaSession<TState = unknown>(sessionId: string | null, options: SessionOptions) {
  const [state, setState] = useState<SessionState<TState>>({ status: "idle", data: null });

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (!sessionId) {
        setState({ status: "idle", data: null });
        return;
      }

      setState({ status: "connecting", data: null });

      try {
        const client = await createRouterClient(options);
        const freshState = await client.fetchState(sessionId);
        if (!cancelled) {
          setState({ status: "ready", data: freshState as TState });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: "error", data: null, error: error as Error });
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
    };
  }, [sessionId, options]);

  return state;
}