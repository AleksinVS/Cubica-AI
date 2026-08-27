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
  subscribeToSessionEvents,
  consumePrivateInviteFragment,
  recoverGuestSeat
} from "./runtime-client";

const originalEventSource = window.EventSource;

describe("runtime-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "EventSource", { configurable: true, value: originalEventSource });
    window.history.replaceState({}, "", "/");
  });

  it("refreshes once for the initial GET and for a named version event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(runtimeSnapshotResponse("session-events", 1));
    const source = installEventSource();
    const onSnapshot = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const subscription = subscribeToSessionEvents("session-events", onSnapshot);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runtime/sessions/session-events");

    source.emit("version");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalled();
    subscription.stop();
  });

  it("posts guest recovery to the typed endpoint and exposes runtime errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ seatId: "p2", playerId: "p2", inviteToken: "opaque", expiresAt: "2026-08-25T12:00:00.000Z" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not eligible" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(recoverGuestSeat("session/1", "p2")).resolves.toMatchObject({ seatId: "p2" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runtime/sessions/session%2F1/seat-recovery-invites");
    await expect(recoverGuestSeat("session/1", "p2")).rejects.toMatchObject({ statusCode: 403, message: "not eligible" });
  });

  it("coalesces events received during a deferred full GET", async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValue(runtimeSnapshotResponse("session-events", 2));
    const source = installEventSource();
    vi.stubGlobal("fetch", fetchMock);
    const subscription = subscribeToSessionEvents("session-events", vi.fn());

    source.emit("version");
    source.emit("message");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(runtimeSnapshotResponse("session-events", 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    subscription.stop();
  });

  it("refreshes after EventSource errors and suppresses callbacks after stop", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(runtimeSnapshotResponse("session-events", 1))
      .mockResolvedValueOnce(runtimeSnapshotResponse("session-events", 2));
    const source = installEventSource();
    const onSnapshot = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const subscription = subscribeToSessionEvents("session-events", onSnapshot);

    await new Promise((resolve) => setTimeout(resolve, 0));
    source.emitError();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    subscription.stop();
    expect(source.close).toHaveBeenCalledTimes(1);
    source.emit("version");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("suppresses an in-flight callback after stop", async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first);
    const source = installEventSource();
    const onSnapshot = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const subscription = subscribeToSessionEvents("session-events", onSnapshot);

    subscription.stop();
    resolveFirst(runtimeSnapshotResponse("session-events", 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("does not require EventSource support", () => {
    vi.stubGlobal("EventSource", undefined);
    Object.defineProperty(window, "EventSource", { configurable: true, value: undefined });
    expect(() => subscribeToSessionEvents("session-events", vi.fn())).not.toThrow();
  });

  it("clears a complete invite fragment synchronously", () => {
    window.history.replaceState({}, "", "/play?mode=private#sessionId=s1&inviteToken=tok");
    const invite = consumePrivateInviteFragment();
    expect(invite).toEqual({ sessionId: "s1", inviteToken: "tok" });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/play?mode=private");
  });

  it("clears a partial invite fragment but keeps unrelated anchors", () => {
    window.history.replaceState({}, "", "/play#inviteToken=tok");
    expect(consumePrivateInviteFragment()).toBeNull();
    expect(window.location.hash).toBe("");

    window.history.replaceState({}, "", "/play#board");
    expect(consumePrivateInviteFragment()).toBeNull();
    expect(window.location.hash).toBe("#board");
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

type FakeEventSource = {
  onmessage: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener: (name: string, listener: () => void) => void;
  emit: (name: string) => void;
  emitError: () => void;
  close: ReturnType<typeof vi.fn>;
};

function installEventSource(): FakeEventSource {
  let latestSource: TestEventSource | null = null;
  class TestEventSource {
    onmessage: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, () => void>();
    close = vi.fn();

    constructor(_url: string) {
      latestSource = this;
    }

    addEventListener(name: string, listener: () => void): void {
      this.listeners.set(name, listener);
    }

    emit(name: string): void {
      if (name === "message") this.onmessage?.();
      this.listeners.get(name)?.();
    }

    emitError(): void {
      this.onerror?.();
    }
  }

  vi.stubGlobal("EventSource", TestEventSource);
  Object.defineProperty(window, "EventSource", {
    configurable: true,
    value: TestEventSource
  });
  // The instance is created by subscribeToSessionEvents, so expose a proxy
  // that resolves after the caller constructs its subscription.
  return {
    get onmessage() { return latestSource?.onmessage ?? null; },
    set onmessage(listener: (() => void) | null) { if (latestSource) latestSource.onmessage = listener; },
    get onerror() { return latestSource?.onerror ?? null; },
    set onerror(listener: (() => void) | null) { if (latestSource) latestSource.onerror = listener; },
    addEventListener: (name, listener) => latestSource?.addEventListener(name, listener),
    emit: (name) => latestSource?.emit(name),
    emitError: () => latestSource?.emitError(),
    get close() { return latestSource?.close ?? vi.fn(); }
  };
}

function runtimeSnapshotResponse(sessionId: string, stateVersion: number): Response {
  return new Response(JSON.stringify({
    sessionId,
    gameId: "runtime-fixture",
    participants: [],
    version: { sessionId, stateVersion, lastEventSequence: stateVersion },
    state: { public: {}, secret: {} },
    actionAvailability: []
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
