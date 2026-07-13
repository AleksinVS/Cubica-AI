/**
 * Focused tests for participant attribution at the player-web/runtime boundary.
 *
 * Hotseat games use one browser for several local participants, so gameplay
 * actions must follow the active participant from the latest authoritative
 * snapshot instead of keeping the launch identity forever.
 */

import { describe, expect, it } from "vitest";

import type { GameSession } from "@/types/game-state";
import { resolveRuntimeActorPlayerId } from "./game-presenter";

const turnSession = (activePlayerId: unknown): GameSession => ({
  sessionId: "session-hotseat",
  gameId: "turn-fixture",
  version: {
    sessionId: "session-hotseat",
    stateVersion: 1,
    lastEventSequence: 0
  },
  actionAvailability: [],
  state: {
    public: {
      turn: { activePlayerId }
    },
    secret: {}
  }
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
});
