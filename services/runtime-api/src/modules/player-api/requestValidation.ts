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
  if (body === undefined) {
    return {};
  }

  assertRecord(body, "POST /sessions body");
  if (body.gameId !== undefined) {
    assertGameId(body.gameId, "gameId");
  }
  assertOptionalString(body.playerId, "playerId");
  if (body.contentSourceId !== undefined) {
    assertContentSourceId(body.contentSourceId, "contentSourceId");
  }

  return body as CreateSessionRequest;
};

export const parseDispatchActionRequest = (body: unknown): DispatchActionInput => {
  assertRecord(body, "POST /actions body");
  assertRequiredString(body.sessionId, "sessionId");
  assertRequiredString(body.actionId, "actionId");
  assertOptionalString(body.playerId, "playerId");

  return body as unknown as DispatchActionInput;
};

export const parseAgentTurnRequest = (body: unknown): AgentTurnRequest => {
  assertRecord(body, "POST /agent-turns body");
  assertRequiredString(body.sessionId, "sessionId");
  assertOptionalString(body.playerId, "playerId");
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
