import fs from "node:fs";
import {
  validateAgentControlShape,
  type AgentControl
} from "../src/index.ts";

const openApi = JSON.parse(fs.readFileSync(new URL(
  "../../../../docs/architecture/runtime-api-openapi.yaml",
  import.meta.url
), "utf8")) as {
  components: { schemas: Record<string, any> };
};

describe("agent control contract parity", () => {
  it("keeps the generated type backed by the exact approved OpenAPI component", () => {
    const schema = openApi.components.schemas.AgentControl;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["playerId", "status", "reasonCode"]);
    expect(schema.properties.status.enum).toEqual(["paused", "facilitatorTakeover"]);
    expect(schema.properties.reasonCode.enum).toEqual([
      "runtimeUnavailable",
      "invalidAttemptLimit",
      "fallbackUnavailable",
      "stepLimit"
    ]);

    const value = {
      playerId: "p2",
      status: "paused",
      reasonCode: "stepLimit"
    } satisfies AgentControl;
    expect(value.playerId).toBe("p2");
  });

  it("is optional on create, get and action response shapes", () => {
    for (const schemaName of ["CreatedSessionResponse", "SessionResponse", "ActionResponse"]) {
      const response = openApi.components.schemas[schemaName];
      expect(response.required).not.toContain("agentControl");
      expect(response.properties.agentControl.$ref).toBe("#/components/schemas/AgentControl");
    }
  });

  it("executes the generated closed shape and rejects every malformed dimension", () => {
    expect(validateAgentControlShape({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode: "runtimeUnavailable"
    })).toBe(true);

    for (const malformed of [
      null,
      {},
      { playerId: "p2", status: "paused" },
      { playerId: "p2", status: "pause", reasonCode: "runtimeUnavailable" },
      { playerId: "p2", status: "paused", reasonCode: "providerError" },
      { playerId: "__proto__", status: "paused", reasonCode: "stepLimit" },
      { playerId: "p2", status: "paused", reasonCode: "stepLimit", diagnostics: [] }
    ]) {
      expect(validateAgentControlShape(malformed)).toBe(false);
    }
  });
});
