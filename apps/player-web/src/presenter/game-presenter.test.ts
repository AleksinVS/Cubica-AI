/**
 * Focused tests for participant attribution and duplicate-action protection at
 * the player-web/runtime boundary.
 *
 * Hotseat games use one browser for several local participants, so gameplay
 * actions must follow the active participant from the latest authoritative
 * snapshot instead of keeping the launch identity forever.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import { createDefaultGameConfig, createDefaultGameConfigData } from "./game-config";
import { GamePresenter, resolveRuntimeActorPlayerId } from "./game-presenter";
import { ReactViewGateway } from "./react-view-gateway";

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
});

describe("resolveRuntimeActorPlayerId", () => {
  it("follows the authoritative hotseat turn when it switches from p1 to p2", () => {
    expect(resolveRuntimeActorPlayerId(turnSession("p1"), "player-web")).toBe("p1");
    expect(resolveRuntimeActorPlayerId(turnSession("p2"), "player-web")).toBe("p2");
  });

  it("keeps the configured player id for games without a valid turn actor", () => {
    expect(resolveRuntimeActorPlayerId(null, "player-web")).toBe("player-web");
    expect(resolveRuntimeActorPlayerId(turnSession(""), "player-web")).toBe("player-web");
  });

  it("preserves a personal participant identity when another player is active", () => {
    const session = turnSession("p2", {
      p1: { metrics: { cash: 900 } },
      p2: { metrics: { cash: 900 } }
    });

    expect(resolveRuntimeActorPlayerId(session, "p1")).toBe("p1");
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

function fetchRequestVersions(fetchMock: ReturnType<typeof vi.fn>): number[] {
  return fetchMock.mock.calls.map(([, request]) => {
    const body = JSON.parse(String((request as RequestInit | undefined)?.body ?? "{}")) as {
      expectedStateVersion?: unknown;
    };
    return Number(body.expectedStateVersion);
  });
}
