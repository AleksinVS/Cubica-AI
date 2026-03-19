import type { CreateSessionRequest, DispatchActionInput } from "@cubica/contracts-session";
import { RequestValidationError } from "../errors.ts";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertRecord: (value: unknown, path: string) => asserts value is JsonRecord = (value, path) => {
  if (!isRecord(value)) {
    throw new RequestValidationError(`${path} must be an object`);
  }
};

const assertOptionalString: (value: unknown, path: string) => void = (value, path) => {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new RequestValidationError(`${path} must be a non-empty string`);
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
  assertOptionalString(body.gameId, "gameId");
  assertOptionalString(body.playerId, "playerId");

  return body as CreateSessionRequest;
};

export const parseDispatchActionRequest = (body: unknown): DispatchActionInput => {
  assertRecord(body, "POST /actions body");
  assertRequiredString(body.sessionId, "sessionId");
  assertRequiredString(body.actionId, "actionId");
  assertOptionalString(body.playerId, "playerId");

  return body as unknown as DispatchActionInput;
};
