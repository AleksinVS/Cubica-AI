import { readFileSync } from "node:fs";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { AgentControl } from "./generated/agent-control.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const schema = JSON.parse(readFileSync(
  new URL("./generated/agent-control.schema.json", import.meta.url),
  "utf8"
)) as object;
const validate = new Ajv2020({ allErrors: true, strict: true })
  .compile(schema) as ValidateFunction<AgentControl>;

/** Validate the complete public shape owned by the canonical OpenAPI component. */
export function validateAgentControlShape(value: unknown): value is AgentControl {
  return validate(value);
}
