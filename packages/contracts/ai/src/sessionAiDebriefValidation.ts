import Ajv2020Lib from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormatsLib from "ajv-formats";
import type {
  SessionAiDebriefArtifact,
  SessionAiDebriefConfirmRequest,
  SessionAiDebriefGenerateRequest
} from "./generated/session-ai-debrief.ts";
import { sessionAiDebriefSchema } from "./generated/session-ai-debrief.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validateArtifact = ajv.compile(sessionAiDebriefSchema as object) as
  ValidateFunction<SessionAiDebriefArtifact>;
const validateGenerateRequest = ajv.compile({
  $schema: sessionAiDebriefSchema.$schema,
  $defs: sessionAiDebriefSchema.$defs,
  $ref: "#/$defs/SessionAiDebriefGenerateRequest"
} as object) as ValidateFunction<SessionAiDebriefGenerateRequest>;
const validateConfirmRequest = ajv.compile({
  $schema: sessionAiDebriefSchema.$schema,
  $defs: sessionAiDebriefSchema.$defs,
  $ref: "#/$defs/SessionAiDebriefConfirmRequest"
} as object) as ValidateFunction<SessionAiDebriefConfirmRequest>;

export function validateSessionAiDebriefArtifact(
  value: unknown
): value is SessionAiDebriefArtifact {
  return validateArtifact(value);
}

export function validateSessionAiDebriefGenerateRequest(
  value: unknown
): value is SessionAiDebriefGenerateRequest {
  return validateGenerateRequest(value);
}

export function validateSessionAiDebriefConfirmRequest(
  value: unknown
): value is SessionAiDebriefConfirmRequest {
  return validateConfirmRequest(value);
}

export function getSessionAiDebriefValidationErrors(
  kind: "artifact" | "generate-request" | "confirm-request"
): ReadonlyArray<ErrorObject> | null | undefined {
  if (kind === "artifact") return validateArtifact.errors;
  if (kind === "generate-request") return validateGenerateRequest.errors;
  return validateConfirmRequest.errors;
}
