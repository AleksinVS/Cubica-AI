import Ajv2020Lib from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { CreateSessionRequest } from "./generated/create-session-request.ts";
import { createSessionRequestSchema } from "./generated/create-session-request.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(createSessionRequestSchema as object) as ValidateFunction<CreateSessionRequest>;

/** OpenAPI owns the complete untrusted create-session envelope shape. */
export function validateCreateSessionRequestShape(value: unknown): value is CreateSessionRequest {
  return validate(value);
}

export function getCreateSessionRequestValidationErrors(): ReadonlyArray<ErrorObject> {
  return validate.errors ?? [];
}
