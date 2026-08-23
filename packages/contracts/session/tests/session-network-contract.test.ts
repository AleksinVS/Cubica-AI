import fs from "node:fs";
import {
  validatePrivateSessionInvitesShape,
  validateSessionVersionNotificationShape,
  type GetSessionResponse,
  type PrivateSessionInvite,
  type SessionVersionNotification
} from "../src/index.ts";

type ExpectNever<T extends never> = T;
type GetSessionSecretKeys = ExpectNever<
  Extract<keyof GetSessionResponse, "credential" | "privateInvites">
>;

const openApi = JSON.parse(fs.readFileSync(new URL(
  "../../../../docs/architecture/runtime-api-openapi.yaml",
  import.meta.url
), "utf8")) as {
  paths: Record<string, any>;
  components: { schemas: Record<string, any> };
};

describe("private session and version notification contract", () => {
  it("exposes invite credentials only on the direct creation response", () => {
    const created = openApi.components.schemas.CreatedSessionResponse;
    expect(created.properties.privateInvites.$ref).toBe(
      "#/components/schemas/PrivateSessionInvites"
    );

    for (const laterResponse of [
      "ActionResponse",
      "AgentTurnResponse",
      "RestorePreviewSessionResponse",
      "SessionResponse"
    ]) {
      expect(openApi.components.schemas[laterResponse].properties).not.toHaveProperty("credential");
      expect(openApi.components.schemas[laterResponse].properties).not.toHaveProperty("privateInvites");
    }
  });

  it("keeps invite entries closed and seat-neutral", () => {
    const invite = {
      seatId: "seat-neutral-7",
      playerId: "actor-neutral-7",
      credential: `ses_${"a".repeat(43)}`
    } satisfies PrivateSessionInvite;
    expect(validatePrivateSessionInvitesShape([invite])).toBe(true);
    expect(validatePrivateSessionInvitesShape([])).toBe(false);
    expect(validatePrivateSessionInvitesShape([{ ...invite, extra: true }])).toBe(false);
    expect(validatePrivateSessionInvitesShape([{ ...invite, credential: "short" }])).toBe(false);
  });

  it("defines an authenticated one-way SSE endpoint with a bounded closed payload", () => {
    const stream = openApi.paths["/sessions/{sessionId}/events"].get;
    expect(stream.security).toEqual([{ SessionBearer: [] }]);
    expect(stream.responses["200"].content["text/event-stream"].schema.$ref).toBe(
      "#/components/schemas/SessionVersionNotification"
    );

    const notification = {
      stateVersion: 3,
      lastEventSequence: 8
    } satisfies SessionVersionNotification;
    expect(validateSessionVersionNotificationShape(notification)).toBe(true);
    for (const invalid of [
      { stateVersion: -1, lastEventSequence: 0 },
      { stateVersion: 0.5, lastEventSequence: 0 },
      { stateVersion: 0, lastEventSequence: -1 },
      { stateVersion: 0, lastEventSequence: 0, state: {} },
      { stateVersion: 0 }
    ]) {
      expect(validateSessionVersionNotificationShape(invalid)).toBe(false);
    }
  });
});
