import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNewSession,
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
});
