/**
 * Focused tests for idempotent command delivery and snapshot ownership at the
 * player-web/runtime boundary.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import { createDefaultGameConfig, createDefaultGameConfigData } from "./game-config";
import { GamePresenter } from "./game-presenter";
import { ReactViewGateway } from "./react-view-gateway";
import {
  loadPendingRuntimeCommand,
  savePendingRuntimeCommand
} from "./command-outbox";

const turnSession = (
  activePlayerId: unknown,
  players?: Record<string, unknown>
): GameSession => ({
  sessionId: "session-hotseat",
  gameId: "turn-fixture",
  version: {
    sessionId: "session-hotseat",
    stateVersion: 1,
    lastEventSequence: 0
  },
  actionAvailability: [],
  state: {
    ...(players === undefined ? {} : { players }),
    public: {
      turn: { activePlayerId }
    },
    secret: {}
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("GamePresenter session recovery", () => {
  it.each([401, 404])("replaces an inaccessible local session after HTTP %s and clears its outbox", async (status) => {
    const content = neutralContent("neutral-session-recovery");
    const config = createDefaultGameConfig(createDefaultGameConfigData(content));
    const freshSession: GameSession = {
      ...turnSession("p1"),
      sessionId: "session-fresh",
      gameId: content.gameId,
      version: {
        sessionId: "session-fresh",
        stateVersion: 0,
        lastEventSequence: 0
      }
    };
    window.localStorage.setItem(config.storageKey, "session-stale");
    savePendingRuntimeCommand({
      endpoint: "action",
      envelope: {
        sessionId: "session-stale",
        actionId: "turn.roll",
        commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
        expectedStateVersion: 3,
        params: {}
      }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Session is inaccessible" }), { status }))
      .mockResolvedValueOnce(runtimeResponse(freshSession, 0));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config
    });
    await presenter.boot();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/runtime/sessions/session-stale",
      "/api/runtime/sessions"
    ]);
    expect(window.localStorage.getItem(config.storageKey)).toBe("session-fresh");
    expect(loadPendingRuntimeCommand("session-stale")).toBeNull();
    expect(presenter.sessionSnapshot?.sessionId).toBe("session-fresh");
  });

  it("uses only the portal rebind flow when launch parameters are present", async () => {
    const content = neutralContent("neutral-portal-rebind");
    const config = createDefaultGameConfig(createDefaultGameConfigData(content));
    const portalSession: GameSession = {
      ...turnSession("p1"),
      sessionId: "session-portal",
      gameId: content.gameId,
      version: {
        sessionId: "session-portal",
        stateVersion: 0,
        lastEventSequence: 0
      }
    };
    window.history.replaceState({}, "", "/?launchToken=opaque-token&launchCounter=7");
    window.localStorage.setItem(config.storageKey, "unrelated-local-session");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      runtimeSession: portalSession
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config
    });
    await presenter.boot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/portal/runtime-session");
    expect(window.localStorage.getItem(config.storageKey)).toBe("unrelated-local-session");
    expect(presenter.sessionSnapshot?.sessionId).toBe("session-portal");
  });
});

describe("GamePresenter board action serialization", () => {
  it("sends one request per state version and unlocks after the response", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-board",
      version: "1.0.0",
      name: "Neutral board",
      description: "Neutral presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1", { p1: { metrics: {} } }),
      gameId: content.gameId
    };
    let resolveFirstResponse: (response: Response) => void = () => undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(runtimeResponse(initialSession, 3));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    // This test starts after boot so it can isolate one user gesture without
    // coupling the serialization invariant to session-creation transport.
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    const first = presenter.handleBoardAction("board.move", { target: "b" });
    const duplicate = presenter.handleBoardAction("board.move", { target: "b" });

    await expect(duplicate).rejects.toThrow("Дождитесь завершения");
    resolveFirstResponse(runtimeResponse(initialSession, 2));
    await first;
    await presenter.handleBoardAction("board.move", { target: "c" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchRequestVersions(fetchMock)).toEqual([1, 2]);
  });

  it("retries an uncertain result with the original envelope", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-retry",
      version: "1.0.0",
      name: "Neutral retry",
      description: "Neutral retry fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(runtimeResponse(initialSession, 2));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" })).rejects.toThrow("Failed to fetch");
    await expect(presenter.handleBoardAction("board.move", { target: "b" })).resolves.toBeUndefined();

    const bodies = fetchMock.mock.calls.map(([, request]) =>
      JSON.parse(String((request as RequestInit).body)) as Record<string, unknown>
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).not.toHaveProperty("playerId");
    expect(bodies[0]).not.toHaveProperty("payload");
    expect(bodies[0]?.commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
  });

  it("clears the outbox after a deterministic client error", async () => {
    const content = neutralContent("neutral-terminal-outcome");
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Invalid action parameters" }),
      { status: 400 }
    )));
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" }))
      .rejects.toThrow("Invalid action parameters");

    expect(loadPendingRuntimeCommand(initialSession.sessionId)).toBeNull();
  });

  it("keeps and exactly retries the outbox after a transient HTTP response", async () => {
    const content = neutralContent("neutral-transient-outcome");
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Runtime temporarily unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(runtimeResponse(initialSession, 2));
    vi.stubGlobal("fetch", fetchMock);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" }))
      .rejects.toThrow("Runtime temporarily unavailable");
    expect(loadPendingRuntimeCommand(initialSession.sessionId)).not.toBeNull();
    await expect(presenter.handleBoardAction("board.move", { target: "b" })).resolves.toBeUndefined();

    const bodies = fetchMock.mock.calls.map(([, request]) => String((request as RequestInit).body));
    expect(bodies[0]).toBe(bodies[1]);
    expect(loadPendingRuntimeCommand(initialSession.sessionId)).toBeNull();
  });

  it("replaces the local snapshot instead of merge-patching removed keys", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-snapshot",
      version: "1.0.0",
      name: "Neutral snapshot",
      description: "Neutral snapshot fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId,
      state: { public: { obsolete: true }, secret: {} }
    };
    const nextSession: GameSession = {
      ...initialSession,
      version: { ...initialSession.version, stateVersion: 2, lastEventSequence: 1 },
      state: { public: { current: true }, secret: {} }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(runtimeResponse(nextSession, 2)));

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await presenter.handleBoardAction("state.replace");

    expect(presenter.sessionSnapshot?.state).toEqual({ public: { current: true }, secret: {} });
  });
});

describe("GamePresenter road preview", () => {
  it("uses the current version without claiming an actor or changing local state", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-road-preview",
      version: "1.0.0",
      name: "Neutral road preview",
      description: "Read-only presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 2 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p2", { p1: { metrics: {} }, p2: { metrics: {} } }),
      gameId: content.gameId,
      version: {
        sessionId: "session-hotseat",
        stateVersion: 7,
        lastEventSequence: 6
      }
    };
    const previewResponse = {
      sessionId: initialSession.sessionId,
      actionId: "transport.road.build",
      usedStateVersion: 7,
      paramsFingerprint: `sha256:${"1".repeat(64)}`,
      definitionHash: `sha256:${"2".repeat(64)}`,
      networkId: "main",
      fromNodeId: "east",
      toNodeId: "west",
      polyline: [{ x: 90, y: 50 }, { x: 10, y: 50 }],
      regionSequence: ["east", "west"],
      regionSegments: 2,
      candidateCount: 1,
      planning: {
        mode: "region-segment-minimum" as const,
        algorithmVersion: "1",
        geometryVersion: "fixture-v1",
        geometryHash: "sha256:fixture",
        boundaryPolicy: "lowest-region-id"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(previewResponse),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);
    const sessionBefore = presenter.sessionSnapshot;

    await expect(presenter.previewTransportRoad("transport.road.build", {
      fromNodeId: "east",
      toNodeId: "west"
    })).resolves.toEqual(previewResponse);

    expect(presenter.sessionSnapshot).toBe(sessionBefore);
    expect(presenter.playerState.isPending).toBe(false);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-hotseat",
      expectedStateVersion: 7,
      actionId: "transport.road.build",
      params: {
        fromNodeId: "east",
        toNodeId: "west"
      }
    });
  });
});

describe("GamePresenter declarative layout", () => {
  it("uses the selected screen map-first layout before routing fallbacks", () => {
    const content: PlayerFacingContent = {
      gameId: "spatial-fixture",
      version: "1.0.0",
      name: "Spatial fixture",
      description: "Neutral map-first presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const gameUi: GamePlayerUiContent = {
      id: "spatial-fixture.ui.web",
      version: "1.0.0",
      gameId: content.gameId,
      entryPoint: "workspace",
      screens: {
        workspace: {
          type: "screen",
          title: "Workspace",
          layoutMode: "map-first",
          root: {
            type: "screenComponent",
            props: {},
            children: [{
              type: "areaComponent",
              props: { workspaceSlot: "board" },
              children: []
            }]
          }
        }
      }
    };
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      gameUi,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", {
      ...turnSession("p1"),
      gameId: content.gameId,
      state: {
        public: { timeline: { screenId: "workspace" } },
        secret: {}
      }
    } satisfies GameSession);

    expect(presenter.playerState.screenKey).toBe("workspace");
    expect(presenter.playerState.layoutMode).toBe("map-first");
  });
});

function runtimeResponse(session: GameSession, stateVersion: number): Response {
  return new Response(JSON.stringify({
    ...session,
    version: {
      ...session.version,
      stateVersion,
      lastEventSequence: stateVersion
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function neutralContent(gameId: string): PlayerFacingContent {
  return {
    gameId,
    version: "1.0.0",
    name: "Neutral fixture",
    description: "Presenter transport fixture",
    locale: "ru",
    playerConfig: { min: 1, max: 1 },
    actions: [],
    mockups: []
  };
}

function fetchRequestVersions(fetchMock: ReturnType<typeof vi.fn>): number[] {
  return fetchMock.mock.calls.map(([, request]) => {
    const body = JSON.parse(String((request as RequestInit | undefined)?.body ?? "{}")) as {
      expectedStateVersion?: unknown;
    };
    return Number(body.expectedStateVersion);
  });
}
