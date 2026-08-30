import { readFileSync } from "node:fs";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { CreateSessionRequest } from "./generated/create-session-request.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const schema = JSON.parse(readFileSync(
  new URL("./generated/create-session-request.schema.json", import.meta.url),
  "utf8"
)) as object;

// The generated schema is an inlined projection of the canonical OpenAPI
// component. Ajv is the sole executor of its structural rules at this boundary.
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(schema) as ValidateFunction<CreateSessionRequest>;

export function validateCreateSessionRequestShape(value: unknown): value is CreateSessionRequest {
  return validate(value);
}

/** Return the errors from the immediately preceding validation call. */
export function getCreateSessionRequestValidationErrors(): readonly ErrorObject[] {
  return validate.errors ?? [];
}
