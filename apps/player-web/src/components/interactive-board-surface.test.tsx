/**
 * Lifecycle and accessible-input tests for the generic Phaser board host.
 * Phaser is mocked at the package boundary so these tests verify player-web's
 * ownership contract without depending on WebGL support in the DOM test host.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import { createEmptyGameAssetResolver } from "@/lib/game-asset-resolver";
import {
  registerAccessibleBoardActionsProvider,
  registerPhaserSceneFactory
} from "@/plugins/phaser-scene-registry";
import { InteractiveBoardSurface } from "./interactive-board-surface";

const phaserMock = vi.hoisted(() => {
  const lifecycle: string[] = [];
  const configs: unknown[] = [];
  const scales: Array<{ refresh: ReturnType<typeof vi.fn>; setParentSize: ReturnType<typeof vi.fn> }> = [];

  class Scene {}
  class Game {
    readonly scale = { refresh: vi.fn(), setParentSize: vi.fn() };

    constructor(config: unknown) {
      configs.push(config);
      scales.push(this.scale);
      lifecycle.push("game:create");
    }

    destroy(removeCanvas: boolean) {
      lifecycle.push(`game:destroy:${removeCanvas}`);
    }
  }

  return { lifecycle, configs, scales, Scene, Game };
});

vi.mock("phaser", () => ({
  AUTO: "AUTO",
  Scale: { FIT: "FIT", RESIZE: "RESIZE", CENTER_BOTH: "CENTER_BOTH", NO_CENTER: "NO_CENTER" },
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
    state: { public: { sequence } },
    actionAvailability: []
  };
}

afterEach(() => {
  phaserMock.lifecycle.splice(0);
  phaserMock.configs.splice(0);
  phaserMock.scales.splice(0);
  vi.unstubAllGlobals();
});

describe("InteractiveBoardSurface", () => {
  it("mounts once, updates the handle, and destroys plugin resources before Phaser", async () => {
    const updateSession = vi.fn();
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, (current) => ([{
      id: `advance-${current.version.lastEventSequence}`,
      label: `Перейти к соседнему узлу · ${current.version.lastEventSequence}`,
      actionId: "board.move",
      params: { targetNodeId: "node-b" }
    }]));
    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession,
      destroy() {
        phaserMock.lifecycle.push("handle:destroy");
      },
      getAccessibleActions(current) {
        return [{
          id: `legacy-${current.version.lastEventSequence}`,
          label: "Устаревший callback сцены",
          actionId: "legacy.move"
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

    await screen.findByRole("button", { name: "Перейти к соседнему узлу · 0" });
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
    await screen.findByRole("button", { name: "Перейти к соседнему узлу · 1" });
    expect(phaserMock.configs).toHaveLength(1);

    view.unmount();
    expect(phaserMock.lifecycle.slice(-2)).toEqual(["handle:destroy", "game:destroy:true"]);
    disposeRegistration();
    disposeProvider();
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

  it("collects a plugin-declared parameter form before dispatching a board action", async () => {
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, () => ([{
      id: "build-road",
      label: "Построить дорогу",
      actionId: "transport.road.build",
      params: { fixedContribution: 2 },
      fields: [
        {
          name: "fromNodeId",
          label: "Начальная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-a", label: "Станция А" },
            { value: "node-b", label: "Станция Б" }
          ]
        },
        {
          name: "toNodeId",
          label: "Конечная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-b", label: "Станция Б" },
            { value: "node-c", label: "Станция В" }
          ]
        },
        {
          name: "variableContribution",
          label: "Вклад",
          kind: "number",
          required: true,
          min: 0,
          step: 1,
          defaultValue: 3
        }
      ]
    }]));
    const dispatchAction = vi.fn().mockResolvedValue(undefined);

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
      />
    );

    fireEvent.change(await screen.findByLabelText("Начальная станция"), {
      target: { value: "node-a" }
    });
    fireEvent.change(screen.getByLabelText("Конечная станция"), {
      target: { value: "node-c" }
    });
    fireEvent.change(screen.getByLabelText("Вклад"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Построить дорогу" }));

    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith("transport.road.build", {
      fixedContribution: 2,
      fromNodeId: "node-a",
      toNodeId: "node-c",
      variableContribution: 4
    }));
    disposeProvider();
  });

  it("synchronizes a canvas draft with the DOM form and clears it on a new state version", async () => {
    let publishCanvasDraft: ((draft: {
      actionId: string;
      params: Readonly<Record<string, string | number | boolean | null>>;
    } | null) => void) | undefined;
    const updateActionDraft = vi.fn();
    const disposeScene = registerPhaserSceneFactory(content.gameId, (context) => {
      publishCanvasDraft = context.onActionDraftChange;
      return {
        scene: new context.Phaser.Scene(),
        updateSession() {},
        updateActionDraft,
        destroy() {}
      };
    });
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, () => ([{
      id: "build-road",
      label: "Построить дорогу",
      actionId: "construction.road.build",
      // These defaults reproduce the temporary mock payload which must not
      // reappear after the canvas starts a new endpoint pair.
      params: { fromNodeId: "node-a", toNodeId: "node-b", contribution: 2 },
      fields: [
        {
          name: "fromNodeId",
          label: "Начальная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-a", label: "Станция А" },
            { value: "node-b", label: "Станция Б" },
            { value: "node-c", label: "Станция В" }
          ]
        },
        {
          name: "toNodeId",
          label: "Конечная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-a", label: "Станция А" },
            { value: "node-b", label: "Станция Б" },
            { value: "node-c", label: "Станция В" }
          ]
        },
        {
          name: "contribution",
          label: "Вклад",
          kind: "number",
          required: true,
          defaultValue: 2
        }
      ]
    }]));

    const view = render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn()}
      />
    );

    const fromNode = await screen.findByLabelText("Начальная станция") as HTMLSelectElement;
    const toNode = screen.getByLabelText("Конечная станция") as HTMLSelectElement;
    expect(fromNode.value).toBe("node-a");
    expect(toNode.value).toBe("node-b");

    act(() => publishCanvasDraft?.({
      actionId: "construction.road.build",
      params: { fromNodeId: "node-c", toNodeId: null }
    }));
    expect(fromNode.value).toBe("node-c");
    expect(toNode.value).toBe("");

    fireEvent.change(toNode, { target: { value: "node-a" } });
    expect(updateActionDraft).toHaveBeenLastCalledWith({
      actionId: "construction.road.build",
      params: { fromNodeId: "node-c", toNodeId: "node-a" }
    });

    view.rerender(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(1)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn()}
      />
    );
    await waitFor(() => expect(updateActionDraft).toHaveBeenLastCalledWith(null));
    expect(fromNode.value).toBe("node-a");
    expect(toNode.value).toBe("node-b");

    view.unmount();
    disposeScene();
    disposeProvider();
  });

  it("previews only selected road endpoints and invalidates the overlay after an edit", async () => {
    const updateSpatialPreview = vi.fn();
    const disposeScene = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession() {},
      updateSpatialPreview,
      destroy() {}
    }));
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, () => ([{
      id: "build-road",
      label: "Построить дорогу",
      actionId: "construction.road.build",
      params: { carriersContribution: 2 },
      preview: {
        kind: "transport-road",
        endpointParameters: { from: "fromNodeId", to: "toNodeId" }
      },
      fields: [
        {
          name: "fromNodeId",
          label: "Начальная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-a", label: "Станция А" },
            { value: "node-b", label: "Станция Б" }
          ]
        },
        {
          name: "toNodeId",
          label: "Конечная станция",
          kind: "select",
          required: true,
          options: [
            { value: "node-b", label: "Станция Б" },
            { value: "node-c", label: "Станция В" }
          ]
        },
        {
          name: "carriersContribution",
          label: "Вклад перевозчиков",
          kind: "number",
          required: true,
          defaultValue: 2
        }
      ]
    }]));
    const previewTransportRoad = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      actionId: "construction.road.build",
      usedStateVersion: 0,
      networkId: "main",
      fromNodeId: "node-a",
      toNodeId: "node-c",
      polyline: [{ x: 10, y: 20 }, { x: 40, y: 30 }, { x: 90, y: 20 }],
      regionSequence: ["left", "right"],
      regionSegments: 2,
      cost: 4,
      candidateCount: 2,
      planning: {
        mode: "region-segment-minimum",
        algorithmVersion: "1",
        geometryVersion: "fixture-v1",
        geometryHash: "sha256:fixture",
        boundaryPolicy: "lowest-region-id"
      }
    });
    const dispatchAction = vi.fn().mockResolvedValue(undefined);

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
        previewTransportRoad={previewTransportRoad}
      />
    );

    fireEvent.change(await screen.findByLabelText("Начальная станция"), {
      target: { value: "node-a" }
    });
    fireEvent.change(screen.getByLabelText("Конечная станция"), {
      target: { value: "node-c" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Рассчитать маршрут" }));

    await waitFor(() => expect(previewTransportRoad).toHaveBeenCalledWith(
      "construction.road.build",
      { fromNodeId: "node-a", toNodeId: "node-c" }
    ));
    expect((await screen.findByRole("status")).textContent).toContain("Стоимость: 4 монет");
    expect(updateSpatialPreview).toHaveBeenLastCalledWith({
      actionId: "construction.road.build",
      points: [{ x: 10, y: 20 }, { x: 40, y: 30 }, { x: 90, y: 20 }]
    });
    expect((screen.getByRole("button", { name: "Построить дорогу" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Конечная станция"), {
      target: { value: "node-b" }
    });
    expect(updateSpatialPreview).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByRole("button", { name: "Построить дорогу" }) as HTMLButtonElement).disabled).toBe(true);
    expect(dispatchAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Конечная станция"), {
      target: { value: "node-c" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Рассчитать маршрут" }));
    await waitFor(() => expect(previewTransportRoad).toHaveBeenCalledTimes(2));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Построить дорогу" }));
    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith(
      "construction.road.build",
      {
        carriersContribution: 2,
        fromNodeId: "node-a",
        toNodeId: "node-c"
      }
    ));

    disposeScene();
    disposeProvider();
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

  it("keeps DOM actions usable when Phaser scene initialization fails", async () => {
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, () => ([{
      id: "safe-fallback",
      label: "Доступное действие без Phaser",
      actionId: "board.safe-action"
    }]));
    const disposeScene = registerPhaserSceneFactory(content.gameId, () => ({
      // The invalid scene reproduces a failed engine/plugin initialization
      // after the independent DOM projection has already been registered.
      scene: {},
      updateSession() {},
      destroy() {}
    }));
    const dispatchAction = vi.fn().mockResolvedValue(undefined);

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
      />
    );

    const action = await screen.findByRole("button", { name: "Доступное действие без Phaser" });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("несовместимую сцену Phaser");

    fireEvent.click(action);
    await waitFor(() => expect(dispatchAction).toHaveBeenCalledWith("board.safe-action", {}));

    disposeScene();
    disposeProvider();
  });

  it("updates DOM actions when an already mounted Phaser scene rejects a snapshot", async () => {
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, (current) => ([{
      id: `safe-${current.version.lastEventSequence}`,
      label: `Независимое действие · ${current.version.lastEventSequence}`,
      actionId: "board.safe-action"
    }]));
    const disposeScene = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession(current) {
        if (current.version.lastEventSequence === 1) {
          throw new Error("Сцена не приняла новый снимок");
        }
      },
      destroy() {}
    }));
    const dispatchAction = vi.fn().mockRejectedValue(new Error("Старое отклонение действия"));

    const view = render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Независимое действие · 0" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Старое отклонение действия");
    view.rerender(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(1)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
      />
    );

    await screen.findByRole("button", { name: "Независимое действие · 1" });
    expect(screen.getByRole("alert").textContent).toContain("Сцена не приняла новый снимок");

    view.unmount();
    disposeScene();
    disposeProvider();
  });

  it("clears a provider diagnostic after a newer snapshot projects successfully", async () => {
    const disposeProvider = registerAccessibleBoardActionsProvider(content.gameId, (current) => {
      if (current.version.lastEventSequence === 0) {
        throw new Error("Поставщик не построил действия");
      }
      return [{
        id: "recovered-action",
        label: "Действие восстановлено",
        actionId: "board.recovered-action"
      }];
    });
    const disposeScene = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession() {},
      destroy() {}
    }));

    const view = render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Поставщик не построил действия"
    );
    view.rerender(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(1)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole("button", { name: "Действие восстановлено" });
    expect(screen.queryByRole("alert")).toBeNull();

    view.unmount();
    disposeScene();
    disposeProvider();
  });

  it("blocks DOM and scene dispatch while a previous action is pending", async () => {
    let sceneDispatch: (() => Promise<void>) | undefined;
    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => {
      sceneDispatch = () => context.dispatchAction("board.move");
      return {
        scene: new context.Phaser.Scene(),
        updateSession() {},
        destroy() {},
        getAccessibleActions() {
          return [{ id: "move", label: "Переместить", actionId: "board.move" }];
        }
      };
    });
    const dispatchAction = vi.fn();

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={dispatchAction}
        isPending
      />
    );

    expect((await screen.findByRole("button", { name: "Переместить" }) as HTMLButtonElement).disabled).toBe(true);
    await expect(sceneDispatch?.()).rejects.toThrow("Дождитесь завершения");
    expect(dispatchAction).not.toHaveBeenCalled();
    disposeRegistration();
  });

  it("exposes map camera commands as ordinary DOM controls", async () => {
    const zoomBy = vi.fn();
    const fitToView = vi.fn();
    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession() {},
      destroy() {},
      zoomBy,
      fitToView
    }));

    render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn()}
        layoutMode="map-first"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Увеличить карту" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать всю карту" }));

    expect(zoomBy).toHaveBeenCalledWith(1.2);
    expect(fitToView).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-layout-mode="map-first"]')).toBeDefined();
    expect(phaserMock.configs.at(-1)).toMatchObject({
      scale: { mode: "RESIZE", autoCenter: "NO_CENTER" }
    });
    disposeRegistration();
  });

  it("applies observed host dimensions before refreshing a resizable canvas", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe() {}
      unobserve() {}
      disconnect() {
        disconnect();
      }
    });

    const disposeRegistration = registerPhaserSceneFactory(content.gameId, (context) => ({
      scene: new context.Phaser.Scene(),
      updateSession() {},
      destroy() {}
    }));

    const view = render(
      <InteractiveBoardSurface
        gameId={content.gameId}
        content={content}
        session={session(0)}
        assets={assets}
        manifestProps={{ sceneId: "main" }}
        dispatchAction={vi.fn()}
        layoutMode="map-first"
      />
    );

    await waitFor(() => expect(resizeCallback).toBeDefined());
    resizeCallback?.([
      { contentRect: { width: 1920, height: 1080 } } as ResizeObserverEntry
    ], {} as ResizeObserver);

    expect(phaserMock.scales.at(-1)?.setParentSize).toHaveBeenCalledWith(1920, 1080);
    expect(phaserMock.scales.at(-1)?.refresh).not.toHaveBeenCalled();

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    disposeRegistration();
  });
});
