'use client';

import { useCallback, useEffect, useState } from "react";
import { applyJsonMergePatch, applyJsonPatch } from "@cubica/sdk-core";
import type { JsonPatchOperation, JsonValue, ViewCommand } from "@cubica/sdk-core";

export interface ViewStatePayload<TState = unknown> {
  state?: TState | null;
  /**
   * JSON Merge Patch (RFC 7396) — базовый формат патча состояния.
   * Исторически поле называлось `updates`; оно оставлено как алиас.
   */
  mergePatch?: Record<string, unknown>;
  updates?: Record<string, unknown>;

  /**
   * JSON Patch (RFC 6902) — опциональный формат патча (список операций).
   * Используйте его только если нужен точечный контроль над удалением/перемещением по путям.
   */
  jsonPatch?: JsonPatchOperation[];
}

export interface ViewStateDataSource<TState = unknown> {
  loadInitial(options: { sessionId?: string | null }): Promise<ViewStatePayload<TState>>;
  sendCommand?: (command: ViewCommand, context: { sessionId?: string | null }) => Promise<ViewStatePayload<TState>>;
}

export interface UseViewStateOptions<TState = unknown> {
  sessionId?: string | null;
  dataSource: ViewStateDataSource<TState>;
}

export interface ViewStateController<TState = unknown> {
  status: "idle" | "loading" | "ready" | "error";
  state: TState | null;
  error?: string | null;
  replaceState: (next: TState | null) => void;
  applyPatch: (patch: Record<string, unknown>) => void;
  dispatchCommand: (command: ViewCommand) => Promise<TState | null>;
}

/**
 * Manages a view state backed by a pluggable data source (local fixtures or Router).
 * The hook keeps reducer-like helpers (`replaceState`, `applyPatch`) that callers
 * can pass into presenter code.
 */
export function useViewState<TState = unknown>(options: UseViewStateOptions<TState>): ViewStateController<TState> {
  const { sessionId = null, dataSource } = options;
  const [state, setState] = useState<TState | null>(null);
  const [status, setStatus] = useState<ViewStateController<TState>["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    dataSource.loadInitial({ sessionId })
      .then(({ state: loadedState, mergePatch, updates, jsonPatch }) => {
        if (cancelled) {
          return;
        }
        let nextState = (loadedState ?? null) as TState | null;
        const effectiveMergePatch = mergePatch ?? updates;

        if (jsonPatch && nextState) {
          nextState = applyJsonPatch(nextState as JsonValue, jsonPatch) as TState;
        } else if (effectiveMergePatch && nextState) {
          nextState = applyJsonMergePatch(nextState as JsonValue, effectiveMergePatch as JsonValue) as TState;
        }
        setState(nextState);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load view state";
        setError(message);
        setStatus("error");
        setState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, sessionId]);

  const replaceState = useCallback((next: TState | null) => {
    setState(next);
  }, []);

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => {
      if (!prev) {
        return prev;
      }
      return applyJsonMergePatch(prev as JsonValue, patch as JsonValue) as TState;
    });
  }, []);

  const dispatchCommand = useCallback(async (command: ViewCommand) => {
    if (!dataSource.sendCommand) {
      throw new Error("Data source does not support commands");
    }
    const response = await dataSource.sendCommand(command, { sessionId });
    const nextState = response.state ?? null;

    if (nextState !== null) {
      setState(nextState as TState);
      return nextState as TState;
    }

    if (response.jsonPatch) {
      setState((prev) => {
        if (!prev) {
          return prev;
        }
        return applyJsonPatch(prev as JsonValue, response.jsonPatch!) as TState;
      });
    } else if (response.mergePatch ?? response.updates) {
      const patch = (response.mergePatch ?? response.updates) as Record<string, unknown>;
      setState((prev) => {
        if (!prev) {
          return prev;
        }
        return applyJsonMergePatch(prev as JsonValue, patch as JsonValue) as TState;
      });
    }

    return nextState as TState;
  }, [dataSource, sessionId]);

  return {
    status,
    state,
    error,
    replaceState,
    applyPatch,
    dispatchCommand
  };
}
