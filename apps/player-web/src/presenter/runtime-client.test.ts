import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNewSession,
  dispatchAction,
  getGameReadiness,
  RuntimeClientError
} from "./runtime-client";

describe("runtime-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves runtime-api error bodies for failed session creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Game requires Agent Runtime but it is not configured" }),
      { status: 503, statusText: "Service Unavailable" }
    )));

    await expect(createNewSession("ai-driven-choice", "player-web")).rejects.toMatchObject({
      name: "RuntimeClientError",
      message: "Game requires Agent Runtime but it is not configured",
      statusCode: 503
    });
  });

  it("returns game readiness payload even when runtime-api responds with 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        ready: false,
        service: "runtime-api",
        gameId: "ai-driven-choice",
        executionMode: "ai-driven",
        dependencies: {
          agentRuntime: {
            status: "error",
            required: true,
            mode: "missing",
            runtimeId: "mock",
            failurePolicy: "pause",
            reason: "Mock Agent Runtime requires CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true."
          }
        }
      }),
      { status: 503, statusText: "Service Unavailable" }
    )));

    const readiness = await getGameReadiness("ai-driven-choice", "preview-source");

    expect(readiness.statusCode).toBe(503);
    expect(readiness.ready).toBe(false);
    expect(readiness.dependencies.agentRuntime?.failurePolicy).toBe("pause");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/runtime/games/ai-driven-choice/readiness?contentSourceId=preview-source"
    );
  });

  it("throws a typed error when readiness does not return JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "upstream failure",
      { status: 502, statusText: "Bad Gateway" }
    )));

    await expect(getGameReadiness("ai-driven-choice")).rejects.toBeInstanceOf(RuntimeClientError);
  });

  it("sends deterministic action input as validated params and legacy payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: {}, secret: {} }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAction("session-1", "p2", "property.buy", 1, { cellId: "harbor-row" });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      expectedStateVersion: 1,
      playerId: "p2",
      actionId: "property.buy",
      params: { cellId: "harbor-row" },
      payload: { cellId: "harbor-row" }
    });
  });

  it("omits params for a parameterless manifest action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: {}, secret: {} }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAction("session-1", "p1", "turn.roll", 1);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      expectedStateVersion: 1,
      playerId: "p1",
      actionId: "turn.roll",
      payload: {}
    });
  });

  it("preserves HTTP 409 so the presenter can refresh without repeating the action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Session changed after version 1; reload it before retrying." }),
      { status: 409, statusText: "Conflict" }
    )));

    await expect(dispatchAction("session-1", "p1", "turn.roll", 1)).rejects.toMatchObject({
      name: "RuntimeClientError",
      statusCode: 409,
      message: "Session changed after version 1; reload it before retrying."
    });
  });
});
