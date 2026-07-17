import type { SessionSnapshot } from "@/lib/game-content-resolvers";
import type { CubicaAgentTurnResult } from "@cubica/contracts-ai";
import type {
  TransportRoadPreviewResponse
} from "@cubica/contracts-session";
import type {
  RuntimeActionEnvelope,
  RuntimeAgentTurnEnvelope
} from "@/presenter/command-outbox";

export type ActionSnapshot = SessionSnapshot;

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

type PublicCommandReceipt = {
  readonly status?: unknown;
  readonly rejectionCode?: unknown;
};

export class RuntimeClientError extends Error {
  readonly statusCode: number;
  readonly statusText: string;
  /** Runtime explicitly confirmed that retrying this command is unnecessary. */
  readonly terminal: boolean;
  /** The server asked the client to retry, or failed before a stable answer. */
  readonly retryable: boolean;

  constructor(message: string, options: {
    statusCode: number;
    statusText: string;
    terminal?: boolean;
    retryable?: boolean;
  }) {
    super(message);
    this.name = "RuntimeClientError";
    this.statusCode = options.statusCode;
    this.statusText = options.statusText;
    this.terminal = options.terminal === true;
    this.retryable = options.retryable === true && !this.terminal;
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
  let terminal = false;
  if (text.trim().length > 0) {
    try {
      const payload = JSON.parse(text) as {
        error?: unknown;
        message?: unknown;
        terminal?: unknown;
        receipt?: PublicCommandReceipt;
      };
      const candidate = typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : typeof payload.receipt?.rejectionCode === "string"
            ? payload.receipt.rejectionCode
            : undefined;
      // A syntactically valid but unknown JSON error shape must not revive
      // removed receipt fields through its serialized representation.
      message = candidate ?? fallback;
      terminal = payload.terminal === true || payload.receipt?.status === "rejected";
    } catch {
      message = text;
    }
  }

  return new RuntimeClientError(message, {
    statusCode: response.status,
    statusText: response.statusText,
    // Once an HTTP response exists, only the explicit transient profiles are
    // eligible for an automatic replay of the same immutable command. Stable
    // client errors (including 400/401/403/404/409/413) must not poison the
    // persistent outbox across every later page load.
    terminal: terminal || !isRetryableRuntimeStatus(response.status),
    retryable: isRetryableRuntimeStatus(response.status)
  });
}

/**
 * Decides whether an immutable command must remain in the browser outbox.
 *
 * A non-HTTP exception means the browser cannot know whether runtime admitted
 * the command, so exact-command replay is required. HTTP 408, 429 and 5xx are
 * explicitly retryable. Every other received HTTP result is deterministic and
 * releases the outbox; an admitted rejected receipt is terminal as well.
 */
export function shouldRetainPendingRuntimeCommand(error: unknown): boolean {
  return !(error instanceof RuntimeClientError) || error.retryable;
}

function isRetryableRuntimeStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/** Converts an admitted HTTP 200 rejection into the same terminal error path. */
async function parseCommandResponse<T extends object>(
  response: Response,
  fallback: string
): Promise<T> {
  const payload = await parseJson<T & { readonly receipt?: PublicCommandReceipt }>(response);
  if (payload.receipt?.status === "rejected") {
    const message = typeof payload.receipt.rejectionCode === "string"
      ? payload.receipt.rejectionCode
      : fallback;
    throw new RuntimeClientError(message, {
      statusCode: response.status,
      statusText: response.statusText,
      terminal: true
    });
  }
  return payload;
}

/**
 * Создаёт новую игровую сессию через runtime-api.
 */
export async function createNewSession(gameId: string): Promise<SessionSnapshot> {
  return createNewSessionWithOptions({ gameId });
}

export async function createNewSessionWithOptions(input: {
  readonly gameId: string;
  readonly contentSourceId?: string;
}): Promise<SessionSnapshot> {
  const response = await fetch("/api/runtime/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      gameId: input.gameId,
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
  const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}`, {
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw await readRuntimeError(response, `Failed to resume session: ${response.status}`);
  }
  return parseJson<SessionSnapshot>(response);
}

/**
 * Отправляет игровое действие в runtime-api и возвращает обновлённое состояние.
 */
export async function dispatchAction(
  envelope: RuntimeActionEnvelope
): Promise<ActionSnapshot> {
  const response = await fetch("/api/runtime/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    // The immutable envelope is reused byte-for-byte for network retries.
    // Actor identity is intentionally absent and comes from BFF authentication.
    body: JSON.stringify(envelope)
  });
  if (!response.ok) {
    throw await readRuntimeError(response, `Action "${envelope.actionId}" failed`);
  }
  return parseCommandResponse<ActionSnapshot>(response, `Action "${envelope.actionId}" was rejected`);
}

/**
 * Requests a non-authoritative road calculation for one immutable snapshot.
 *
 * The preview has its own read-only endpoint instead of sharing the mutating
 * action path. That separation prevents a route estimate from paying money,
 * advancing the session version or consuming authoritative randomness.
 */
export interface RuntimeTransportRoadPreviewRequest {
  readonly sessionId: string;
  readonly expectedStateVersion: number;
  readonly actionId: string;
  readonly params: Record<string, unknown>;
}

export async function previewTransportRoad(
  input: RuntimeTransportRoadPreviewRequest
): Promise<TransportRoadPreviewResponse> {
  const response = await fetch("/api/runtime/action-previews/transport-road", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await readRuntimeError(response, `Road preview for action "${input.actionId}" failed`);
  }
  return parseJson<TransportRoadPreviewResponse>(response);
}

/**
 * Runs one AI-driven Agent Turn through the runtime-api.
 *
 * The browser sends player intent only. Runtime-api builds the authoritative
 * Agent Turn input, validates its selected published Game Intent and executes
 * that intent through authoritative mechanics before this client sees the
 * returned `CubicaSurface`.
 */
export async function runAgentTurn(
  envelope: RuntimeAgentTurnEnvelope
): Promise<AgentTurnSnapshot> {
  const response = await fetch("/api/runtime/agent-turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(envelope)
  });
  if (!response.ok) {
    throw await readRuntimeError(
      response,
      `Agent Turn "${envelope.actionId}" failed`
    );
  }
  return parseCommandResponse<AgentTurnSnapshot>(response, `Agent Turn "${envelope.actionId}" was rejected`);
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
