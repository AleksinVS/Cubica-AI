/**
 * Lifecycle and accessible-input tests for the generic Phaser board host.
 * Phaser is mocked at the package boundary so these tests verify player-web's
 * ownership contract without depending on WebGL support in the DOM test host.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import { createEmptyGameAssetResolver } from "@/lib/game-asset-resolver";
import { registerPhaserSceneFactory } from "@/plugins/phaser-scene-registry";
import { InteractiveBoardSurface } from "./interactive-board-surface";

const phaserMock = vi.hoisted(() => {
  const lifecycle: string[] = [];
  const configs: unknown[] = [];

  class Scene {}
  class Game {
    readonly scale = { refresh: vi.fn() };

    constructor(config: unknown) {
      configs.push(config);
      lifecycle.push("game:create");
    }

    destroy(removeCanvas: boolean) {
      lifecycle.push(`game:destroy:${removeCanvas}`);
    }
  }

  return { lifecycle, configs, Scene, Game };
});

vi.mock("phaser", () => ({
  AUTO: "AUTO",
  Scale: { FIT: "FIT", CENTER_BOTH: "CENTER_BOTH" },
  Scene: phaserMock.Scene,
  Game: phaserMock.Game
}));

const content: PlayerFacingContent = {
  gameId: "neutral-board",
  version: "1.0.0",
  name: "Neutral board",
  description: "Neutral board fixture",
  locale: "ru",
  playerConfig: { min: 1, max: 1 },
  actions: [],
  mockups: []
};
const assets = createEmptyGameAssetResolver();

function session(sequence: number): GameSession {
  return {
    sessionId: "session-1",
    gameId: content.gameId,
    version: {
      sessionId: "session-1",
      stateVersion: sequence,
      lastEventSequence: sequence
    },
    state: { public: { sequence } }
  };
}

afterEach(() => {
  phaserMock.lifecycle.splice(0);
  phaserMock.configs.splice(0);
});

describe("InteractiveBoardSurface", () => {
  it("mounts once, updates the handle, and destroys plugin resources before Phaser", async () => {
    const updateSession = vi.fn();
    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession,
      destroy() {
        phaserMock.lifecycle.push("handle:destroy");
      },
      getAccessibleActions(current) {
        return [{
          id: `advance-${current.version.lastEventSequence}`,
          label: "Перейти к соседнему узлу",
          actionId: "board.move",
          params: { targetNodeId: "node-b" }
        }];
      }
    }));

    const view = render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main", designWidth: 1400, designHeight: 1000 }}
        dispatchAction={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: "Перейти к соседнему узлу" });
    expect(phaserMock.configs).toHaveLength(1);
    expect(updateSession).toHaveBeenCalledWith(session(0));

    view.rerender(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(1)}
        assets={assets}
        manifestProps={{ sceneId: "main", designWidth: 1400, designHeight: 1000 }}
        dispatchAction={vi.fn()}
      />
    );
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith(session(1)));
    expect(phaserMock.configs).toHaveLength(1);

    view.unmount();
    expect(phaserMock.lifecycle.slice(-2)).toEqual(["handle:destroy", "game:destroy:true"]);
    disposeRegistration();
  });

  it("dispatches the DOM alternative and reports a rejected runtime action", async () => {
    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession() {},
      destroy() {},
      getAccessibleActions() {
        return [{
          id: "move-a-b",
          label: "Переместить объект в узел Б",
          description: "Доступная клавиатурная альтернатива перетаскиванию.",
          actionId: "board.move",
          params: { objectId: "vehicle-a", targetNodeId: "node-b" }
        }];
      }
    }));
    const dispatchAction = vi.fn().mockRejectedValue(new Error("Целевой узел закрыт."));

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main", accessibleLabel: "Поле нейтральной игры" }}
        dispatchAction={dispatchAction}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Переместить объект в узел Б" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Целевой узел закрыт.");
    expect(dispatchAction).toHaveBeenCalledWith("board.move", {
      objectId: "vehicle-a",
      targetNodeId: "node-b"
    });
    disposeRegistration();
  });

  it("shows a diagnostic instead of a blank canvas when no factory is registered", () => {
    render(
      <InteractiveBoardSurface
        gameId="missing-board"
        content={{ ...content, gameId: "missing-board" }}
        session={{ ...session(0), gameId: "missing-board" }}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn()}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("Игра не предоставила сцену");
  });
});
