/**
 * Browser-side idempotency support for gameplay commands.
 *
 * An outbox is a small journal of a command whose HTTP outcome is not known
 * yet. Keeping the complete immutable envelope lets the Presenter retry a
 * lost request without accidentally turning one click into a second payment,
 * draw, move, or other gameplay transition.
 */

export const CLIENT_COMMAND_ID_PATTERN = /^cli_[A-Za-z0-9_-]{22}$/u;

export type ClientCommandId = `cli_${string}`;

export interface RuntimeActionEnvelope {
  readonly sessionId: string;
  readonly actionId: string;
  readonly commandId: ClientCommandId;
  readonly expectedStateVersion: number;
  readonly params: Record<string, unknown>;
}

export interface RuntimeAgentTurnEnvelope {
  readonly sessionId: string;
  readonly actionId: string;
  readonly commandId: ClientCommandId;
  readonly expectedStateVersion: number;
  readonly params: Record<string, unknown>;
}

export type PendingRuntimeCommand =
  | {
      readonly endpoint: "action";
      readonly envelope: RuntimeActionEnvelope;
    }
  | {
      readonly endpoint: "agent-turn";
      readonly envelope: RuntimeAgentTurnEnvelope;
    };

const OUTBOX_PREFIX = "cubica:runtime-command-outbox:";

/**
 * Generates the public client command profile required by the runtime.
 *
 * Exactly 16 cryptographically random bytes become 22 base64url characters;
 * padding is removed and no game meaning is encoded into the identifier.
 */
export function generateClientCommandId(
  randomSource: Pick<Crypto, "getRandomValues"> = globalThis.crypto
): ClientCommandId {
  if (!randomSource || typeof randomSource.getRandomValues !== "function") {
    throw new Error("A cryptographically secure random source is required for gameplay commands.");
  }

  const bytes = randomSource.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const encoded = globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  const commandId = `cli_${encoded}` as ClientCommandId;

  // This guard catches a broken/random-source polyfill before the command can
  // enter the persistent outbox with an identifier the server must reject.
  if (!CLIENT_COMMAND_ID_PATTERN.test(commandId)) {
    throw new Error("Generated gameplay command ID has an invalid external-client shape.");
  }

  return commandId;
}

export function createRuntimeActionEnvelope(input: {
  readonly sessionId: string;
  readonly actionId: string;
  readonly expectedStateVersion: number;
  readonly params?: Record<string, unknown>;
}): RuntimeActionEnvelope {
  return {
    sessionId: input.sessionId,
    actionId: input.actionId,
    commandId: generateClientCommandId(),
    expectedStateVersion: input.expectedStateVersion,
    params: input.params ?? {}
  };
}

export function createRuntimeAgentTurnEnvelope(input: {
  readonly sessionId: string;
  readonly actionId: string;
  readonly expectedStateVersion: number;
  readonly params?: Record<string, unknown>;
}): RuntimeAgentTurnEnvelope {
  return {
    sessionId: input.sessionId,
    actionId: input.actionId,
    commandId: generateClientCommandId(),
    expectedStateVersion: input.expectedStateVersion,
    params: input.params ?? {}
  };
}

/** Saves before network dispatch so a page close cannot lose the command. */
export function savePendingRuntimeCommand(command: PendingRuntimeCommand): void {
  const storage = browserLocalStorage();
  if (storage === null) {
    throw new Error("Persistent command outbox is unavailable in this browser.");
  }

  storage.setItem(outboxKey(command.envelope.sessionId), JSON.stringify(command));
}

export function loadPendingRuntimeCommand(sessionId: string): PendingRuntimeCommand | null {
  const storage = browserLocalStorage();
  if (storage === null) {
    return null;
  }

  const key = outboxKey(sessionId);
  const raw = storage.getItem(key);
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isPendingRuntimeCommand(parsed, sessionId)) {
      return parsed;
    }
  } catch {
    // A truncated/corrupted local record cannot be retried safely. Removing it
    // is preferable to inventing missing command identity or parameters.
  }

  storage.removeItem(key);
  return null;
}

export function clearPendingRuntimeCommand(sessionId: string): void {
  browserLocalStorage()?.removeItem(outboxKey(sessionId));
}

/**
 * A repeated click is a transport retry only when its published action and
 * schema-validated parameters match the pending logical command exactly.
 */
export function pendingCommandMatchesAction(
  pending: PendingRuntimeCommand,
  actionId: string,
  params: Record<string, unknown>
): pending is Extract<PendingRuntimeCommand, { endpoint: "action" }> {
  return pending.endpoint === "action" &&
    pending.envelope.actionId === actionId &&
    canonicalJson(pending.envelope.params) === canonicalJson(params);
}

export function pendingCommandMatchesAgentTurn(
  pending: PendingRuntimeCommand,
  actionId: string,
  params: Record<string, unknown>
): pending is Extract<PendingRuntimeCommand, { endpoint: "agent-turn" }> {
  return pending.endpoint === "agent-turn" &&
    pending.envelope.actionId === actionId &&
    canonicalJson(pending.envelope.params) === canonicalJson(params);
}

function browserLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function outboxKey(sessionId: string): string {
  return `${OUTBOX_PREFIX}${encodeURIComponent(sessionId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingRuntimeCommand(value: unknown, sessionId: string): value is PendingRuntimeCommand {
  if (!isRecord(value) || (value.endpoint !== "action" && value.endpoint !== "agent-turn")) {
    return false;
  }
  if (!isRecord(value.envelope)) {
    return false;
  }

  const envelope = value.envelope;
  const hasValidActionId = typeof envelope.actionId === "string" && envelope.actionId.trim() !== "";
  return envelope.sessionId === sessionId &&
    hasValidActionId &&
    typeof envelope.commandId === "string" &&
    CLIENT_COMMAND_ID_PATTERN.test(envelope.commandId) &&
    Number.isSafeInteger(envelope.expectedStateVersion) &&
    Number(envelope.expectedStateVersion) >= 0 &&
    isRecord(envelope.params);
}

/** Canonical object-key ordering is enough for JSON-shaped action params. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
