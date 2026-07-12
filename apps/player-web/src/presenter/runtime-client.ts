import type { SessionSnapshot } from "@/lib/game-content-resolvers";
import type { CubicaAgentTurnResult } from "@cubica/contracts-ai";

export type ActionSnapshot = SessionSnapshot;

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export class RuntimeClientError extends Error {
  readonly statusCode: number;
  readonly statusText: string;

  constructor(message: string, options: { statusCode: number; statusText: string }) {
    super(message);
    this.name = "RuntimeClientError";
    this.statusCode = options.statusCode;
    this.statusText = options.statusText;
  }

  get status(): number {
    return this.statusCode;
  }
}

export type AgentTurnSnapshot = Omit<SessionSnapshot, "gameId"> & {
  readonly agentTurn: CubicaAgentTurnResult;
};

export type GameReadinessSnapshot = {
  readonly statusCode: number;
  readonly ready: boolean;
  readonly service: string;
  readonly gameId: string;
  readonly contentSourceId?: string;
  readonly executionMode?: "deterministic" | "hybrid" | "ai-driven";
  readonly dependencies: {
    readonly agentRuntime?: {
      readonly status: "ok" | "error";
      readonly required: boolean;
      readonly mode: "not-required" | "configured" | "missing";
      readonly agentId?: string;
      readonly runtimeId?: string;
      readonly failurePolicy?: "pause" | "retry" | "deterministicFallback" | "facilitatorTakeover";
      readonly deterministicFallbackActionId?: string;
      readonly reason?: string;
    };
    readonly gameContent?: {
      readonly status: "ok" | "error";
      readonly gameId: string;
      readonly message?: string;
    };
    readonly [dependencyName: string]: unknown;
  };
};

async function readRuntimeError(response: Response, fallback: string): Promise<RuntimeClientError> {
  const text = await response.text();
  let message = fallback;
  if (text.trim().length > 0) {
    try {
      const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
      const candidate = typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : undefined;
      message = candidate ?? text;
    } catch {
      message = text;
    }
  }

  return new RuntimeClientError(message, {
    statusCode: response.status,
    statusText: response.statusText
  });
}

/**
 * Создаёт новую игровую сессию через runtime-api.
 */
export async function createNewSession(gameId: string, playerId: string): Promise<SessionSnapshot> {
  return createNewSessionWithOptions({ gameId, playerId });
}

export async function createNewSessionWithOptions(input: {
  readonly gameId: string;
  readonly playerId: string;
  readonly contentSourceId?: string;
}): Promise<SessionSnapshot> {
  const response = await fetch("/api/runtime/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gameId: input.gameId,
      playerId: input.playerId,
      ...(input.contentSourceId === undefined ? {} : { contentSourceId: input.contentSourceId })
    })
  });
  if (!response.ok) {
    throw await readRuntimeError(response, `Failed to create session: ${response.status}`);
  }
  return parseJson<SessionSnapshot>(response);
}

/**
 * Возобновляет существующую сессию по её идентификатору.
 */
export async function resumeSession(sessionId: string): Promise<SessionSnapshot> {
  const response = await fetch(`/api/runtime/sessions/${sessionId}`);
  if (!response.ok) {
    throw await readRuntimeError(response, `Failed to resume session: ${response.status}`);
  }
  return parseJson<SessionSnapshot>(response);
}

/**
 * Отправляет игровое действие в runtime-api и возвращает обновлённое состояние.
 */
export async function dispatchAction(
  sessionId: string,
  playerId: string,
  actionId: string,
  expectedStateVersion: number,
  payload: Record<string, unknown> = {}
): Promise<ActionSnapshot> {
  const response = await fetch("/api/runtime/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, expectedStateVersion, playerId, actionId, payload })
  });
  if (!response.ok) {
    throw await readRuntimeError(response, `Action "${actionId}" failed`);
  }
  return parseJson<ActionSnapshot>(response);
}

/**
 * Runs one AI-driven Agent Turn through the runtime-api.
 *
 * The browser sends player intent only. Runtime-api builds the authoritative
 * Agent Turn input, validates the Agent Runtime result and persists accepted
 * effects before this client sees the returned `CubicaSurface`.
 */
export async function runAgentTurn(
  sessionId: string,
  playerId: string,
  actionId?: string,
  payload: unknown = {}
): Promise<AgentTurnSnapshot> {
  const response = await fetch("/api/runtime/agent-turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, playerId, actionId, payload })
  });
  if (!response.ok) {
    throw await readRuntimeError(response, actionId === undefined ? "Agent Turn failed" : `Agent Turn "${actionId}" failed`);
  }
  return parseJson<AgentTurnSnapshot>(response);
}

/**
 * Reads game-specific runtime readiness without treating HTTP 503 as an
 * exception. For AI-driven games 503 is a valid player state: Agent Runtime is
 * required, but currently unavailable.
 */
export async function getGameReadiness(gameId: string, contentSourceId?: string): Promise<GameReadinessSnapshot> {
  const query = new URLSearchParams();
  if (contentSourceId !== undefined) {
    query.set("contentSourceId", contentSourceId);
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const response = await fetch(`/api/runtime/games/${encodeURIComponent(gameId)}/readiness${suffix}`);
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as Omit<GameReadinessSnapshot, "statusCode">;
    return {
      ...payload,
      statusCode: response.status
    };
  } catch {
    if (!response.ok) {
      return Promise.reject(new RuntimeClientError(text || `Failed to check game readiness: ${response.status}`, {
        statusCode: response.status,
        statusText: response.statusText
      }));
    }
    throw new RuntimeClientError("Game readiness response must be valid JSON.", {
      statusCode: response.status,
      statusText: response.statusText
    });
  }
}
