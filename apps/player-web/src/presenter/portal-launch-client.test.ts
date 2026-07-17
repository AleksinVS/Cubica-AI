/** Focused test for the browser-safe portal launch exchange. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPortalLaunchSession } from "./portal-launch-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("portal launch client", () => {
  it("uses the same-origin BFF without browser actor or bearer material", async () => {
    const runtimeSession = {
      sessionId: "session-portal",
      gameId: "neutral",
      version: { sessionId: "session-portal", stateVersion: 0, lastEventSequence: 0 },
      state: { public: {}, secret: {} },
      actionAvailability: []
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      runtimeSession
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(bindPortalLaunchSession({ token: "launch-token", counter: "3" }))
      .resolves.toEqual(runtimeSession);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/runtime-session");
    expect(JSON.parse(String(request.body))).toEqual({
      token: "launch-token",
      counter: "3"
    });
    expect(String(request.body)).not.toContain("playerId");
    expect(String(request.body)).not.toContain("credential");
  });
});
