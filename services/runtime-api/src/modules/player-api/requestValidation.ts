import type {
  CreateSessionRequest,
  DispatchActionInput,
  RestorePreviewSessionRequest
} from "@cubica/contracts-session";
import type { AgentTurnRequest } from "../ai/agentRuntime.ts";
import { RequestValidationError } from "../errors.ts";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SAFE_GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_CONTENT_SOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
// These names are inherited or otherwise special on ordinary JavaScript
// objects. Accepting one as a player id or client parameter can turn an object
// lookup into a write outside the intended session-state branch.
const FORBIDDEN_OBJECT_PROPERTY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const assertRecord: (value: unknown, path: string) => asserts value is JsonRecord = (value, path) => {
  if (!isRecord(value)) {
    throw new RequestValidationError(`${path} must be an object`);
  }
};

export const assertGameId: (value: unknown, path: string) => asserts value is string = (value, path) => {
  if (typeof value !== "string" || !SAFE_GAME_ID_PATTERN.test(value)) {
    throw new RequestValidationError(`${path} must match ${SAFE_GAME_ID_PATTERN}`);
  }
};

const assertOptionalString: (value: unknown, path: string) => void = (value, path) => {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new RequestValidationError(`${path} must be a non-empty string`);
  }
};

const assertOptionalPlayerId: (value: unknown, path: string) => void = (value, path) => {
  assertOptionalString(value, path);
  if (typeof value === "string" && FORBIDDEN_OBJECT_PROPERTY_NAMES.has(value)) {
    throw new RequestValidationError(`${path} uses forbidden property name "${value}"`);
  }
};

const assertNonNegativeInteger: (value: unknown, path: string) => asserts value is number = (value, path) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RequestValidationError(`${path} must be a non-negative integer`);
  }
};

export const assertContentSourceId: (value: unknown, path: string) => asserts value is string = (value, path) => {
  if (typeof value !== "string" || !SAFE_CONTENT_SOURCE_ID_PATTERN.test(value)) {
    throw new RequestValidationError(`${path} must match ${SAFE_CONTENT_SOURCE_ID_PATTERN}`);
  }
};

const assertRequiredString: (value: unknown, path: string) => asserts value is string = (value, path) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(`${path} is required and must be a non-empty string`);
  }
};

export const parseCreateSessionRequest = (body: unknown): CreateSessionRequest => {
  // WHY: `gameId` is REQUIRED to create a session. The manifest/content
  // pipeline cannot resolve a game without it, and the downstream service used
  // to throw a plain `Error` for a missing id which `httpServer.ts` maps to a
  // misleading HTTP 500. Validating it here (the request-validation layer)
  // surfaces the client mistake as a proper HTTP 400 instead. An undefined body
  // is treated the same as a body with no `gameId`.
  assertRecord(body ?? {}, "POST /sessions body");
  const record = (body ?? {}) as JsonRecord;

  // Reject a missing/empty id with a clear "required" message. Any present but
  // malformed id (wrong type, unsafe characters) still falls through to
  // `assertGameId`, which reports the "must match <pattern>" contract.
  if (record.gameId === undefined || record.gameId === null || record.gameId === "") {
    throw new RequestValidationError("gameId is required and must be a non-empty string");
  }
  assertGameId(record.gameId, "gameId");
  assertOptionalPlayerId(record.playerId, "playerId");
  if (record.contentSourceId !== undefined) {
    assertContentSourceId(record.contentSourceId, "contentSourceId");
  }

  return record as CreateSessionRequest;
};

export const parseDispatchActionRequest = (body: unknown): DispatchActionInput => {
  assertRecord(body, "POST /actions body");
  assertRequiredString(body.sessionId, "sessionId");
  assertNonNegativeInteger(body.expectedStateVersion, "expectedStateVersion");
  assertRequiredString(body.actionId, "actionId");
  assertOptionalPlayerId(body.playerId, "playerId");
  if (body.params !== undefined) {
    assertRecord(body.params, "params");
    for (const key of Object.keys(body.params)) {
      if (FORBIDDEN_OBJECT_PROPERTY_NAMES.has(key)) {
        throw new RequestValidationError(`params contains forbidden property name "${key}"`);
      }
    }
  }
  if (body.sessionRole !== undefined || body.role !== undefined) {
    throw new RequestValidationError("Session role is derived by runtime and cannot be supplied by the client");
  }

  return body as unknown as DispatchActionInput;
};

export const parseAgentTurnRequest = (body: unknown): AgentTurnRequest => {
  assertRecord(body, "POST /agent-turns body");
  assertRequiredString(body.sessionId, "sessionId");
  assertOptionalPlayerId(body.playerId, "playerId");
  assertOptionalString(body.actionId, "actionId");

  return {
    sessionId: body.sessionId,
    playerId: typeof body.playerId === "string" ? body.playerId : undefined,
    actionId: typeof body.actionId === "string" ? body.actionId : undefined,
    payload: body.payload
  };
};

export const parseRestorePreviewSessionRequest = (
  body: unknown
): RestorePreviewSessionRequest<Record<string, unknown>> => {
  assertRecord(body, "POST /sessions/:id/preview-restore body");
  const state = body.state;
  const version = body.version;
  assertRecord(state, "state");
  assertRecord(version, "version");
  assertNonNegativeInteger(version.stateVersion, "version.stateVersion");
  assertNonNegativeInteger(version.lastEventSequence, "version.lastEventSequence");
  if (body.targetEventSequence !== undefined) {
    assertNonNegativeInteger(body.targetEventSequence, "targetEventSequence");
    if (body.targetEventSequence !== version.lastEventSequence) {
      throw new RequestValidationError(
        "targetEventSequence must match version.lastEventSequence for preview restore"
      );
    }
  }
  assertOptionalString(body.reason, "reason");

  return {
    state,
    version: {
      stateVersion: version.stateVersion,
      lastEventSequence: version.lastEventSequence
    },
    targetEventSequence: body.targetEventSequence,
    reason: typeof body.reason === "string" ? body.reason : undefined
  };
};
