import fs from "node:fs";
import type { SessionParticipant } from "../src/index.ts";

const openApi = JSON.parse(fs.readFileSync(new URL(
  "../../../../docs/architecture/runtime-api-openapi.yaml",
  import.meta.url
), "utf8")) as {
  components: { schemas: Record<string, any> };
};

describe("session participant contract parity", () => {
  it("keeps the generated type backed by the exact closed OpenAPI component", () => {
    const schema = openApi.components.schemas.SessionParticipant;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["seatId", "playerId", "kind", "joinState"]);
    expect(schema.properties.kind.enum).toEqual(["human", "agent"]);
    expect(schema.properties.joinState.const).toBe("local");

    const participant = {
      seatId: "seat-a",
      playerId: "actor-a",
      kind: "human",
      joinState: "local"
    } satisfies SessionParticipant;
    expect(participant.playerId).toBe("actor-a");
  });

  it("requires participants on every current session snapshot response", () => {
    for (const name of [
      "ActionResponse",
      "AgentTurnResponse",
      "CreatedSessionResponse",
      "RestorePreviewSessionResponse",
      "SessionResponse"
    ]) {
      const schema = openApi.components.schemas[name];
      expect(schema.required).toContain("participants");
      expect(schema.properties.participants.$ref).toBe("#/components/schemas/SessionParticipants");
    }
  });
});
