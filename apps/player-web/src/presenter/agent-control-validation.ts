import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import agentControlSchema from "../../../../packages/contracts/session/src/generated/agent-control.schema.json";
import type { AgentControl } from "@cubica/contracts-session";
import type { NormalizedAgentControl } from "@/presenter/types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(agentControlSchema) as ValidateFunction<AgentControl>;

/**
 * Normalizes the optional server projection without allowing malformed data to
 * become an authorization or takeover signal in the player UI.
 */
export function normalizeAgentControl(value: unknown): NormalizedAgentControl {
  if (value === undefined) {
    return { kind: "absent" };
  }
  return validate(value)
    ? { kind: "valid", value: value as AgentControl }
    : { kind: "invalid" };
}
