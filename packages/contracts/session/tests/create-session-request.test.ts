import fs from "node:fs";
import {
  validateCreateSessionRequestShape,
  type CreateSessionRequest
} from "../src/index.ts";

const openApi = JSON.parse(fs.readFileSync(new URL(
  "../../../../docs/architecture/runtime-api-openapi.yaml",
  import.meta.url
), "utf8")) as {
  components: { schemas: Record<string, any> };
};

describe("create-session request contract parity", () => {
  it("keeps omitted access mode backward-compatible with local creation", () => {
    const schema = openApi.components.schemas.CreateSessionRequest;
    expect(schema.required).toEqual(["gameId"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.agentSeatCount).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 64
    });
    expect(schema.properties.accessMode).toMatchObject({
      enum: ["local", "private-invite"],
      default: "local"
    });
    expect(schema.properties.participantCount).toMatchObject({ type: "integer", minimum: 1 });

    const request = { gameId: "neutral-game", participantCount: 3, agentSeatCount: 1 } satisfies CreateSessionRequest;
    expect(request.participantCount).toBe(3);
    expect(request.agentSeatCount).toBe(1);
  });

  it("executes the generated shape for omitted, zero and positive counts", () => {
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game" })).toBe(true);
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game", accessMode: "local" })).toBe(true);
    expect(validateCreateSessionRequestShape({
      gameId: "neutral-game",
      accessMode: "local",
      agentSeatCount: 1
    })).toBe(true);
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game", accessMode: "private-invite" })).toBe(true);
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game", agentSeatCount: 0 })).toBe(true);
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game", agentSeatCount: 1 })).toBe(true);
    expect(validateCreateSessionRequestShape({ gameId: "neutral-game", participantCount: 3 })).toBe(true);
    for (const invalid of [
      { gameId: "neutral-game", participantCount: 0 },
      { gameId: "neutral-game", participantCount: 1.5 },
      { gameId: "neutral-game", agentSeatCount: -1 },
      { gameId: "neutral-game", agentSeatCount: 1.5 },
      { gameId: "neutral-game", agentSeatCount: 65 },
      { gameId: "neutral-game", accessMode: "public" },
      { gameId: "neutral-game", accessMode: "private-invite", agentSeatCount: 1 },
      { gameId: "neutral-game", accessMode: "private-invite", contentSourceId: "preview-source" },
      { gameId: "neutral-game", participants: [] }
    ]) {
      expect(validateCreateSessionRequestShape(invalid)).toBe(false);
    }
  });
});
