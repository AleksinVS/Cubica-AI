import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { AgentControl } from "./generated/agent-control.ts";
import { agentControlSchema } from "./generated/agent-control.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(agentControlSchema as object) as ValidateFunction<AgentControl>;

/** Validate the complete public shape owned by the canonical OpenAPI component. */
export function validateAgentControlShape(value: unknown): value is AgentControl {
  return validate(value);
}
