import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { createDefaultGameConfigData } from "@/presenter/game-config";
import { GamePlayer } from "./game-player";

const content: PlayerFacingContent = {
  gameId: "neutral-agent-control-ui",
  version: "1.0.0",
  name: "Neutral control fixture",
  description: "Generic player control fixture",
  locale: "ru",
  playerConfig: { min: 1, max: 1 },
  actions: [{
    actionId: "turn.advance",
    displayName: "Обычное действие",
    capabilityFamily: null,
    capability: null
  }],
  mockups: []
};

const participants = [
  { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "local" as const },
  { seatId: "p2", playerId: "p2", kind: "agent" as const, joinState: "local" as const }
];

function snapshot(agentControl?: unknown) {
  return {
    sessionId: "agent-control-ui-session",
    gameId: content.gameId,
    participants,
    version: {
      sessionId: "agent-control-ui-session",
      stateVersion: 0,
      lastEventSequence: 0
    },
    state: { public: {}, secret: {} },
    actionAvailability: [],
    ...(agentControl === undefined ? {} : { agentControl })
  };
}

function renderPlayer(agentControl?: unknown) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/runtime/sessions") {
      return Promise.resolve(new Response(JSON.stringify(snapshot(agentControl)), { status: 200 }));
    }
    if (url === "/api/runtime/actions") {
      return Promise.resolve(new Response(JSON.stringify(snapshot()), { status: 200 }));
    }
    if (url === "/api/runtime/sessions/agent-control-ui-session") {
      return Promise.resolve(new Response(JSON.stringify(snapshot()), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <GamePlayer
      config={createDefaultGameConfigData(content)}
      runtimeApiUrl="http://localhost:3001"
      content={content}
      mockups={[]}
    />
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("GamePlayer agent-control safety boundary", () => {
  it.each([
    ["malformed", { playerId: "p2", status: "facilitatorTakeover", reasonCode: "stepLimit", extra: true }],
    ["paused", { playerId: "p2", status: "paused", reasonCode: "runtimeUnavailable" }]
  ])("does not expose ordinary actions for %s control and refreshes only through GET", async (_label, control) => {
    const fetchMock = renderPlayer(control);

    await waitFor(() => expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Выбрать" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime/sessions/agent-control-ui-session",
      expect.objectContaining({ credentials: "same-origin" })
    ));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/runtime/actions", expect.anything());
  });

  it("keeps the ordinary action callable during facilitator takeover", async () => {
    const fetchMock = renderPlayer({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode: "invalidAttemptLimit"
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Выбрать" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Управление передано ведущему" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime/actions",
      expect.anything()
    ));
  });
});
