import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { SessionParticipant } from "./generated/session-participant.ts";
import { sessionParticipantsSchema } from "./generated/session-participants.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(sessionParticipantsSchema as object) as ValidateFunction<ReadonlyArray<SessionParticipant>>;

/** Validate only the public shape owned by the canonical OpenAPI component. */
export function validateSessionParticipantsShape(
  value: unknown
): value is ReadonlyArray<SessionParticipant> {
  return validate(value);
}
