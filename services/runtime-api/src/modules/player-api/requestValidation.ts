import type {
  CreateSessionRequest,
  DispatchActionInput,
  RestorePreviewSessionRequest,
  TransportRoadPreviewRequest
} from "@cubica/contracts-session";
import {
  getCreateSessionRequestValidationErrors,
  validateCreateSessionRequestShape
} from "@cubica/contracts-session";
import type { AgentTurnRequest } from "../ai/agentRuntime.ts";
import { RequestValidationError } from "../errors.ts";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SAFE_GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_CONTENT_SOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
// These names are inherited or otherwise special on ordinary JavaScript
// objects. Accepting one as a client parameter can turn an object lookup into
// a write outside the intended session-state branch.
const FORBIDDEN_OBJECT_PROPERTY_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const runtimeCommandSchema = JSON.parse(readFileSync(
  path.join(repositoryRoot, "docs", "architecture", "schemas", "runtime-command.schema.json"),
  "utf8"
)) as object;
// Draft 2020-12 uses a separate Ajv implementation and must not be mixed into
// older-draft schema instances used by manifest/content validation.
const runtimeCommandAjv = new Ajv2020({ allErrors: true, strict: true });
const validateRuntimeCommand = runtimeCommandAjv.compile(runtimeCommandSchema) as ValidateFunction<DispatchActionInput>;

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
  // WHY: `gameId` is REQUIRED to create a session. The manifest/content
  // pipeline cannot resolve a game without it, and the downstream service used
  // to throw a plain `Error` for a missing id which `httpServer.ts` maps to a
  // misleading HTTP 500. Validating it here (the request-validation layer)
  // surfaces the client mistake as a proper HTTP 400 instead. An undefined body
  // is treated the same as a body with no `gameId`.
  const candidate = body ?? {};
  if (validateCreateSessionRequestShape(candidate)) return candidate;

  const errors = getCreateSessionRequestValidationErrors();
  const additionalProperty = errors.find((error) => error.keyword === "additionalProperties")
    ?.params?.additionalProperty;
  if (typeof additionalProperty === "string") {
    throw new RequestValidationError(`Session creation contains unsupported field "${additionalProperty}"`);
  }

  const requiredProperty = errors.find((error) => error.keyword === "required")
    ?.params?.missingProperty;
  if (requiredProperty === "gameId") {
    throw new RequestValidationError("gameId is required and must be a non-empty string");
  }

  const record = isRecord(candidate) ? candidate : undefined;
  const gameIdError = errors.find((error) => error.instancePath === "/gameId");
  if (gameIdError) {
    if (record?.gameId === null || record?.gameId === "") {
      throw new RequestValidationError("gameId is required and must be a non-empty string");
    }
    if (gameIdError.keyword === "pattern") {
      throw new RequestValidationError(`gameId must match /${String(gameIdError.params.pattern)}/`);
    }
    throw new RequestValidationError("gameId must match the canonical game identifier pattern");
  }

  const contentSourceIdError = errors.find((error) => error.instancePath === "/contentSourceId");
  if (contentSourceIdError) {
    if (contentSourceIdError.keyword === "pattern") {
      throw new RequestValidationError(
        `contentSourceId must match /${String(contentSourceIdError.params.pattern)}/`
      );
    }
    throw new RequestValidationError("contentSourceId must match the canonical content source identifier pattern");
  }

  if (errors.some((error) => error.instancePath === "/participantCount")) {
    throw new RequestValidationError("participantCount must be a positive integer");
  }
  if (errors.some((error) => error.instancePath === "/agentSeatCount")) {
    throw new RequestValidationError("agentSeatCount must be an integer between 0 and 64");
  }

  const rootTypeError = errors.find((error) => error.instancePath === "" && error.keyword === "type");
  if (rootTypeError) {
    throw new RequestValidationError("POST /sessions body must be an object");
  }

  const details = errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
  throw new RequestValidationError(`POST /sessions body does not match request schema: ${details}`);
};

export const parseDispatchActionRequest = (body: unknown): DispatchActionInput => {
  return parseRuntimeCommand(body, "POST /actions body");
};

function parseRuntimeCommand(body: unknown, label: string): DispatchActionInput {
  if (!validateRuntimeCommand(body)) {
    const details = (validateRuntimeCommand.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new RequestValidationError(`${label} does not match runtime command schema: ${details}`);
  }
  return body;
}

/** Validate the fixed envelope; action-specific endpoint schemas run after content lookup. */
export const parseTransportRoadPreviewRequest = (body: unknown): TransportRoadPreviewRequest => {
  assertRecord(body, "POST /action-previews/transport-road body");
  const allowedKeys = new Set(["sessionId", "expectedStateVersion", "actionId", "params"]);
  const unexpectedKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) {
    throw new RequestValidationError(`Transport road preview contains unsupported field "${unexpectedKey}"`);
  }
  assertRequiredString(body.sessionId, "sessionId");
  assertNonNegativeInteger(body.expectedStateVersion, "expectedStateVersion");
  assertRequiredString(body.actionId, "actionId");
  assertRecord(body.params, "params");
  for (const key of Object.keys(body.params)) {
    if (FORBIDDEN_OBJECT_PROPERTY_NAMES.has(key)) {
      throw new RequestValidationError(`params contains forbidden property name "${key}"`);
    }
  }
  return body as unknown as TransportRoadPreviewRequest;
};

export const parseAgentTurnRequest = (body: unknown): AgentTurnRequest => {
  return parseRuntimeCommand(body, "POST /agent-turns body");
};

export const parseRestorePreviewSessionRequest = (
  body: unknown
): RestorePreviewSessionRequest<Record<string, unknown>> => {
  assertRecord(body, "POST /sessions/:id/preview-restore body");
  const allowedKeys = new Set(["state", "version", "targetEventSequence", "reason"]);
  const unexpectedKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) {
    throw new RequestValidationError(`Preview restore contains unsupported field "${unexpectedKey}"`);
  }
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
