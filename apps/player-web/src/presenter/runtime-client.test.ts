import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNewSession,
  createNewSessionWithOptions,
  dispatchAction,
  getGameReadiness,
  previewTransportRoad,
  runAgentTurn,
  RuntimeClientError,
  shouldRetainPendingRuntimeCommand,
  subscribeSessionVersions
} from "./runtime-client";

describe("runtime-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends only the explicitly selected agent-seat count when creating a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-agent",
      gameId: "neutral-game",
      participants: [],
      version: { sessionId: "session-agent", stateVersion: 0, lastEventSequence: 0 },
      state: { public: {}, secret: {} },
      actionAvailability: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createNewSessionWithOptions({
      gameId: "neutral-game",
      contentSourceId: "preview-source",
      agentSeatCount: 2
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      gameId: "neutral-game",
      contentSourceId: "preview-source",
      agentSeatCount: 2
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("participantCount");
  });

  it("omits agentSeatCount for an explicitly human-only session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-human",
      gameId: "neutral-game",
      participants: [],
      version: { sessionId: "session-human", stateVersion: 0, lastEventSequence: 0 },
      state: { public: {}, secret: {} },
      actionAvailability: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createNewSessionWithOptions({ gameId: "neutral-game" });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ gameId: "neutral-game" });
    expect(body).not.toHaveProperty("participantCount");
    expect(body).not.toHaveProperty("agentSeatCount");
  });

  it("keeps session boot usable when the browser environment has no EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    const onVersion = vi.fn();

    const unsubscribe = subscribeSessionVersions("session-1", onVersion);

    expect(unsubscribe).toBeTypeOf("function");
    expect(() => unsubscribe()).not.toThrow();
    expect(onVersion).not.toHaveBeenCalled();
  });

  it("parses only valid version events and closes the EventSource subscription", () => {
    const listeners = new Map<string, EventListener>();
    const close = vi.fn();
    const openedUrls: string[] = [];
    class EventSourceStub {
      constructor(url: string | URL) {
        openedUrls.push(String(url));
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, typeof listener === "function"
          ? listener
          : (event) => listener.handleEvent(event));
      }

      close() {
        close();
      }
    }
    vi.stubGlobal("EventSource", EventSourceStub);
    const onVersion = vi.fn();

    const unsubscribe = subscribeSessionVersions("session/one", onVersion);
    const emitOpen = () => listeners.get("open")?.(new Event("open"));
    const emitVersion = (data: string) => listeners.get("version")?.(
      new MessageEvent("version", { data })
    );
    emitVersion("{");
    emitVersion(JSON.stringify({ stateVersion: -1, lastEventSequence: 0 }));
    // Ordering belongs to GamePresenter. The transport forwards every valid
    // cursor, including one that may be stale relative to local state.
    emitVersion(JSON.stringify({ stateVersion: 0, lastEventSequence: 0 }));
    emitVersion(JSON.stringify({ stateVersion: 2, lastEventSequence: 4 }));
    emitOpen();
    emitVersion(JSON.stringify({ stateVersion: 2, lastEventSequence: 4 }));
    unsubscribe();

    expect(openedUrls).toEqual(["/api/runtime/sessions/session%2Fone/events"]);
    expect(onVersion.mock.calls).toEqual([
      [{ stateVersion: 0, lastEventSequence: 0 }, true],
      [{ stateVersion: 2, lastEventSequence: 4 }, false],
      [{ stateVersion: 2, lastEventSequence: 4 }, true]
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves runtime-api error bodies for failed session creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Game requires Agent Runtime but it is not configured" }),
      { status: 503, statusText: "Service Unavailable" }
    )));

    await expect(createNewSession("ai-driven-choice")).rejects.toMatchObject({
      name: "RuntimeClientError",
      message: "Game requires Agent Runtime but it is not configured",
      statusCode: 503
    });
  });

  it("sends the selected participant count only when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-players",
      gameId: "neutral-game",
      participants: [],
      version: { sessionId: "session-players", stateVersion: 0, lastEventSequence: 0 },
      state: { public: {}, secret: {} },
      actionAvailability: []
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await createNewSession("neutral-game", 3);

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      gameId: "neutral-game",
      participantCount: 3
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

  it("sends one immutable action envelope without actor or legacy payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: {}, secret: {} }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAction({
      sessionId: "session-1",
      actionId: "property.buy",
      commandId: "cli_Dw3q01VZBq7cY9Jy6jLQ9w",
      expectedStateVersion: 1,
      params: { cellId: "harbor-row" }
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      expectedStateVersion: 1,
      actionId: "property.buy",
      commandId: "cli_Dw3q01VZBq7cY9Jy6jLQ9w",
      params: { cellId: "harbor-row" }
    });
  });

  it("uses an empty params object for a parameterless manifest action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: {}, secret: {} }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      expectedStateVersion: 1,
      params: {}
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      expectedStateVersion: 1,
      actionId: "turn.roll",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      params: {}
    });
  });

  it("preserves HTTP 409 so the presenter can refresh without repeating the action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Session changed after version 1; reload it before retrying." }),
      { status: 409, statusText: "Conflict" }
    )));

    await expect(dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      expectedStateVersion: 1,
      params: {}
    })).rejects.toMatchObject({
      name: "RuntimeClientError",
      statusCode: 409,
      terminal: true,
      retryable: false,
      message: "Session changed after version 1; reload it before retrying."
    });
  });

  it.each([408, 429, 500, 503])("marks HTTP %s as retryable for exact-envelope recovery", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Transient runtime response" }),
      { status }
    )));

    const error = await dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      expectedStateVersion: 1,
      params: {}
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "RuntimeClientError",
      statusCode: status,
      terminal: false,
      retryable: true
    });
    expect(shouldRetainPendingRuntimeCommand(error)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 413])("marks deterministic HTTP %s as terminal for the outbox", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Stable runtime response" }),
      { status }
    )));

    const error = await dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      expectedStateVersion: 1,
      params: {}
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "RuntimeClientError",
      statusCode: status,
      terminal: true,
      retryable: false
    });
    expect(shouldRetainPendingRuntimeCommand(error)).toBe(false);
  });

  it("retains a command after a network exception with no HTTP outcome", () => {
    expect(shouldRetainPendingRuntimeCommand(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("treats an admitted rejected receipt as a terminal command result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      receipt: {
        status: "rejected",
        rejectionCode: "ACTION_UNAVAILABLE"
      }
    }), { status: 200 })));

    await expect(dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_CCCCCCCCCCCCCCCCCCCCCC",
      expectedStateVersion: 1,
      params: {}
    })).rejects.toMatchObject({
      name: "RuntimeClientError",
      terminal: true,
      retryable: false,
      message: "ACTION_UNAVAILABLE"
    });
  });

  it("does not read removed message and code fields from a rejected receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      receipt: {
        status: "rejected",
        code: "LEGACY_CODE",
        message: "Legacy receipt message"
      }
    }), { status: 200 })));

    await expect(dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_DDDDDDDDDDDDDDDDDDDDDD",
      expectedStateVersion: 1,
      params: {}
    })).rejects.toMatchObject({
      name: "RuntimeClientError",
      terminal: true,
      retryable: false,
      message: "Action \"turn.roll\" was rejected"
    });
  });

  it("does not revive removed receipt fields in a non-success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt: {
        status: "rejected",
        code: "LEGACY_CODE",
        message: "Legacy receipt message"
      }
    }), { status: 409, statusText: "Conflict" })));

    await expect(dispatchAction({
      sessionId: "session-1",
      actionId: "turn.roll",
      commandId: "cli_EEEEEEEEEEEEEEEEEEEEEE",
      expectedStateVersion: 1,
      params: {}
    })).rejects.toMatchObject({
      name: "RuntimeClientError",
      terminal: true,
      retryable: false,
      message: "Action \"turn.roll\" failed"
    });
  });

  it("requests a read-only road preview with only the typed preview input", async () => {
    const previewResponse = {
      sessionId: "session-1",
      actionId: "transport.road.build",
      usedStateVersion: 4,
      paramsFingerprint: `sha256:${"1".repeat(64)}`,
      definitionHash: `sha256:${"2".repeat(64)}`,
      networkId: "main",
      fromNodeId: "terminal-east",
      toNodeId: "terminal-west",
      polyline: [{ x: 10, y: 20 }, { x: 90, y: 20 }],
      regionSequence: ["east", "west"],
      regionSegments: 2,
      planning: {
        mode: "region-segment-minimum" as const,
        algorithmVersion: "1",
        geometryVersion: "map-v1",
        geometryHash: "sha256:fixture",
        boundaryPolicy: "lowest-region-id"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(previewResponse),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(previewTransportRoad({
      sessionId: "session-1",
      expectedStateVersion: 4,
      actionId: "transport.road.build",
      params: {
        fromNodeId: "terminal-east",
        toNodeId: "terminal-west"
      }
    })).resolves.toEqual(previewResponse);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime/action-previews/transport-road",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      expectedStateVersion: 4,
      actionId: "transport.road.build",
      params: {
        fromNodeId: "terminal-east",
        toNodeId: "terminal-west"
      }
    });
  });

  it("sends Agent Turn as an idempotent params envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: {}, secret: {} },
      actionAvailability: [],
      agentTurn: { surface: null }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runAgentTurn({
      sessionId: "session-1",
      actionId: "choice.accept",
      commandId: "cli_BBBBBBBBBBBBBBBBBBBBBB",
      expectedStateVersion: 1,
      params: { choiceId: "green" }
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-1",
      actionId: "choice.accept",
      commandId: "cli_BBBBBBBBBBBBBBBBBBBBBB",
      expectedStateVersion: 1,
      params: { choiceId: "green" }
    });
  });
});
