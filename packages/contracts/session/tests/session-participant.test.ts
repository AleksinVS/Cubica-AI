import fs from "node:fs";
import {
  validateSessionParticipantsShape,
  type SessionParticipant
} from "../src/index.ts";

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
    expect(schema.properties.joinState.enum).toEqual(["local", "private-invite"]);

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

  it("executes the generated canonical shape at the package boundary", () => {
    expect(validateSessionParticipantsShape([{
      seatId: "seat-a",
      playerId: "actor-a",
      kind: "human",
      joinState: "local"
    }])).toBe(true);
    expect(validateSessionParticipantsShape([{
      seatId: "seat-b",
      playerId: "actor-b",
      kind: "human",
      joinState: "private-invite"
    }])).toBe(true);
    expect(validateSessionParticipantsShape([{
      seatId: "seat-a",
      playerId: "__proto__",
      kind: "human",
      joinState: "local"
    }])).toBe(false);
    expect(validateSessionParticipantsShape([{
      seatId: "seat-a",
      playerId: "actor-a",
      kind: "human",
      joinState: "local",
      extra: true
    }])).toBe(false);
    expect(validateSessionParticipantsShape([{
      seatId: "seat-a",
      playerId: "actor-a",
      kind: "human",
      joinState: "pending"
    }])).toBe(false);
    expect(validateSessionParticipantsShape([{
      seatId: "seat-a",
      playerId: "actor-a",
      kind: "agent",
      joinState: "private-invite"
    }])).toBe(false);
  });
});
