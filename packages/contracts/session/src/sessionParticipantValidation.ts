import { readFileSync } from "node:fs";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { SessionParticipant } from "./generated/session-participant.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const schema = JSON.parse(readFileSync(
  new URL("./generated/session-participants.schema.json", import.meta.url),
  "utf8"
)) as object;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(schema) as ValidateFunction<ReadonlyArray<SessionParticipant>>;

/** Validate only the public shape owned by the canonical OpenAPI component. */
export function validateSessionParticipantsShape(
  value: unknown
): value is ReadonlyArray<SessionParticipant> {
  return validate(value);
}
