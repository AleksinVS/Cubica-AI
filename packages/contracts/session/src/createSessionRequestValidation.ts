import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import type { CreateSessionRequest } from "./generated/create-session-request.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const schema = JSON.parse(readFileSync(
  new URL("./generated/create-session-request.schema.json", import.meta.url),
  "utf8"
)) as object;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(schema) as ValidateFunction<CreateSessionRequest>;

/** OpenAPI owns the complete untrusted create-session envelope shape. */
export function validateCreateSessionRequestShape(value: unknown): value is CreateSessionRequest {
  return validate(value);
}

export function createSessionRequestValidationErrors(): string {
  return (validate.errors ?? [])
    .map((error) => {
      if (error.keyword === "additionalProperties") {
        const property = (error.params as { additionalProperty?: string }).additionalProperty;
        return property === undefined ? "unsupported field" : `unsupported field "${property}"`;
      }
      if (error.keyword === "required") {
        const property = (error.params as { missingProperty?: string }).missingProperty;
        return property === undefined ? "required field is missing" : `${property} is required`;
      }
      return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
    })
    .join("; ");
}
