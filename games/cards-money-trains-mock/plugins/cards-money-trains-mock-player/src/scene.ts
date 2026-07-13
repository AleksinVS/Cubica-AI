/**
 * Phaser scene for the public Cards Money Trains board projection.
 *
 * The scene is intentionally a renderer and input adapter. It derives no
 * legal moves, costs, region crossings, balances, or topology. Highlights and
 * action payloads must already be present in the runtime-owned public snapshot.
 */

import type {
  InteractiveBoardSceneHandle,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@cubica/player-web/plugin-api";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
import {
  fitCameraZoom,
  overviewCameraView,
  panCameraViewBy,
  resizeCameraView,
  zoomCameraViewAtPoint,
  type CameraSize,
  type CameraView
} from "./camera-math.ts";
import {
  projectBoardSession,
  type BoardEdgeView,
  type BoardHighlightView,
  type BoardNodeView,
  type BoardProjection,
  type CanonicalPoint
} from "./board-state.ts";

const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const BOARD_PADDING = 72;
const CAMERA_WORLD = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT } as const;
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_STEP = 1.15;

/** Minimal pointer shape used by camera input without importing Phaser. */
type CameraPointer = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly isDown: boolean;
};

const edgeColor = (edge: BoardEdgeView) => {
  if (edge.visualState === "blocked") return 0xc94c4c;
  if (edge.visualState === "building") return 0xe0a33a;
  return 0x374b59;
};

const nodeColor = (node: BoardNodeView) =>
  node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;

const errorText = (error: unknown) => error instanceof Error ? error.message : "Действие отклонено runtime";

/** Build a scene instance exclusively from platform-injected Phaser. */
export const createCardsMoneyTrainsScene: PhaserSceneFactory = (
  context: PhaserSceneContext
): InteractiveBoardSceneHandle => {
  const Phaser = context.Phaser;
  let currentSession = context.session;
  let lastError: string | null = null;
  let disposed = false;

  class CardsMoneyTrainsScene extends Phaser.Scene {
    /**
     * Phaser does not mark a scene active until its `create` callback returns.
     * A dedicated readiness flag lets that callback paint its first frame while
     * still preventing snapshot updates after shutdown from touching managers
     * that Phaser has already released.
     */
    private projectionReady = false;
    private cameraInteractionReady = false;
    private overviewActive = true;
    private cameraViewport: CameraSize = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
    private dragState: { pointerId: number; x: number; y: number } | null = null;
    /** Prevent overlapping zones of one bent road from dispatching twice. */
    private readonly pendingHighlights = new Set<string>();

    constructor() {
      super({ key: `cards-money-trains:${context.sceneId}` });
    }

    preload() {
      // Resolve only a declared ADR-063 asset id. The scene never reads a file
      // path or accepts a mutable URL from game state.
      this.load.image("cards-money-trains-board", context.assets.url("board-guinea-optimized"));
    }

    create() {
      if (disposed) return;
      this.projectionReady = true;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.stopProjection();
      });
      this.cameras.main.setBackgroundColor("#e8decb");
      // One restrained entrance confirms that the working surface is ready.
      // Phaser owns the tween and removes it with the scene lifecycle.
      this.cameras.main.fadeIn(180, 232, 222, 203);
      this.configureCameraInteraction();
      this.renderProjection();
    }

    renderProjection() {
      if (!this.projectionReady || disposed) return;
      this.children.removeAll(true);
      const projection = projectBoardSession(currentSession);
      const background = this.add.graphics();

      background.fillStyle(0xe8decb, 1);
      background.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

      if (this.textures.exists("cards-money-trains-board")) {
        // In map-first mode the scene is the map, not a miniature board inside
        // a second page. Text, actions and the journal stay in accessible DOM
        // panels owned by the generic player workspace.
        this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "cards-money-trains-board")
          .setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT)
          .setAlpha(0.88);
      }

      // Dynamic geometry must remain above the decorative raster. Keeping it
      // in a separate display object avoids washing roads out under the map.
      const graphics = this.add.graphics();
      const toScreen = this.coordinateMapper(projection);
      this.drawEdges(graphics, projection, toScreen);
      this.drawNodes(graphics, projection, toScreen);
      this.drawVehicles(projection, toScreen);

      // The warning is game content, not a control panel. Keeping it compact
      // makes the test package unmistakable without sacrificing the map-first
      // composition that the package is meant to prove.
      this.add.text(DESIGN_WIDTH / 2, 24, "MOCK · ТЕСТОВЫЕ ДАННЫЕ · НЕ ПУБЛИКОВАТЬ", {
        color: "#fff8e9",
        backgroundColor: "#8b2f2fdd",
        padding: { x: 14, y: 8 },
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "20px"
      }).setOrigin(0.5, 0);

      if (projection.nodes.length === 0) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2,
          "Ожидаются авторские узлы, координаты и начальная сеть",
          { color: "#24343d", fontFamily: "sans-serif", fontSize: "26px", align: "center" })
          .setOrigin(0.5);
      }

      if (lastError) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 34, lastError, {
          color: "#ffffff",
          backgroundColor: "#9e2f2f",
          padding: { x: 14, y: 8 },
          fontFamily: "sans-serif",
          fontSize: "18px",
          wordWrap: { width: DESIGN_WIDTH - BOARD_PADDING * 2 }
        }).setOrigin(0.5, 1);
      }
    }

    /**
     * Stop late callbacks and release camera listeners before Phaser releases
     * scene managers. DOM action controls live in the host and remain separate.
     */
    stopProjection() {
      this.projectionReady = false;
      if (!this.cameraInteractionReady) return;
      this.cameraInteractionReady = false;
      this.dragState = null;
      this.input.off("wheel", this.handleWheel);
      this.input.off("pointerdown", this.handlePointerDown);
      this.input.off("pointermove", this.handlePointerMove);
      this.input.off("pointerup", this.handlePointerUp);
      this.input.off("pointerupoutside", this.handlePointerUp);
      this.input.off("gameout", this.cancelDrag);
      this.scale.off("resize", this.handleResize);
    }

    /** Return to the complete-world overview exposed by the host DOM control. */
    fitToView() {
      if (!this.projectionReady) return;
      this.overviewActive = true;
      this.applyCameraView(overviewCameraView(this.currentViewport(), CAMERA_WORLD));
    }

    /** Zoom around the viewport centre; factors above one mean zooming in. */
    zoomBy(factor: number) {
      if (!this.projectionReady || !Number.isFinite(factor) || factor <= 0) return;
      const viewport = this.currentViewport();
      this.applyZoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, factor);
    }

    private configureCameraInteraction() {
      const camera = this.cameras.main;
      camera.setBounds(CAMERA_WORLD.x, CAMERA_WORLD.y, CAMERA_WORLD.width, CAMERA_WORLD.height);
      this.cameraViewport = this.currentViewport();
      this.cameraInteractionReady = true;
      this.fitToView();
      this.input.on("wheel", this.handleWheel);
      this.input.on("pointerdown", this.handlePointerDown);
      this.input.on("pointermove", this.handlePointerMove);
      this.input.on("pointerup", this.handlePointerUp);
      this.input.on("pointerupoutside", this.handlePointerUp);
      this.input.on("gameout", this.cancelDrag);
      this.scale.on("resize", this.handleResize);
    }

    private currentViewport(): CameraSize {
      const camera = this.cameras.main;
      return { width: Math.max(1, camera.width), height: Math.max(1, camera.height) };
    }

    private currentCameraView(): CameraView {
      const camera = this.cameras.main;
      return { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom };
    }

    private applyCameraView(view: CameraView) {
      this.cameras.main.setZoom(view.zoom).setScroll(view.scrollX, view.scrollY);
    }

    private applyZoomAt(point: { x: number; y: number }, factor: number) {
      const viewport = this.currentViewport();
      const current = this.currentCameraView();
      const minimumZoom = fitCameraZoom(viewport, CAMERA_WORLD);
      const next = zoomCameraViewAtPoint(
        current,
        point,
        current.zoom * factor,
        viewport,
        CAMERA_WORLD,
        { min: minimumZoom, max: MAX_CAMERA_ZOOM }
      );
      this.overviewActive = false;
      this.applyCameraView(next);
    }

    private readonly handleWheel = (
      pointer: CameraPointer,
      _currentlyOver: readonly unknown[],
      _deltaX: number,
      deltaY: number
    ) => {
      if (deltaY === 0) return;
      this.applyZoomAt(
        { x: pointer.x, y: pointer.y },
        deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      );
    };

    private readonly handlePointerDown = (
      pointer: CameraPointer,
      currentlyOver: readonly unknown[]
    ) => {
      // Interactive road and node targets keep their click behavior; only an
      // empty part of the mock world may initiate camera panning.
      if (currentlyOver.length > 0) return;
      this.dragState = { pointerId: pointer.id, x: pointer.x, y: pointer.y };
    };

    private readonly handlePointerMove = (pointer: CameraPointer) => {
      const previous = this.dragState;
      if (!previous || previous.pointerId !== pointer.id || !pointer.isDown) return;
      const delta = { x: pointer.x - previous.x, y: pointer.y - previous.y };
      this.dragState = { pointerId: pointer.id, x: pointer.x, y: pointer.y };
      if (delta.x === 0 && delta.y === 0) return;
      this.overviewActive = false;
      this.applyCameraView(panCameraViewBy(
        this.currentCameraView(),
        delta,
        this.currentViewport(),
        CAMERA_WORLD
      ));
    };

    private readonly handlePointerUp = (pointer: CameraPointer) => {
      if (this.dragState?.pointerId === pointer.id) this.dragState = null;
    };

    private readonly cancelDrag = () => {
      this.dragState = null;
    };

    private readonly handleResize = () => {
      if (!this.cameraInteractionReady) return;
      const previousViewport = this.cameraViewport;
      const nextViewport = this.currentViewport();
      this.cameraViewport = nextViewport;
      this.cameras.main.setBounds(
        CAMERA_WORLD.x,
        CAMERA_WORLD.y,
        CAMERA_WORLD.width,
        CAMERA_WORLD.height
      );
      if (this.overviewActive) {
        this.applyCameraView(overviewCameraView(nextViewport, CAMERA_WORLD));
        return;
      }
      this.applyCameraView(resizeCameraView(
        this.currentCameraView(),
        previousViewport,
        nextViewport,
        CAMERA_WORLD
      ));
    };

    private coordinateMapper(projection: BoardProjection) {
      const bounds = projection.bounds;
      if (!bounds) return (_point: CanonicalPoint) => ({
        x: DESIGN_WIDTH / 2,
        y: DESIGN_HEIGHT / 2
      });
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min(
        (DESIGN_WIDTH - BOARD_PADDING * 2) / width,
        (DESIGN_HEIGHT - BOARD_PADDING * 2) / height
      );
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;
      const offsetX = (DESIGN_WIDTH - renderedWidth) / 2;
      const offsetY = (DESIGN_HEIGHT - renderedHeight) / 2;
      return (value: CanonicalPoint) => ({
        x: offsetX + (value.x - bounds.minX) * scale,
        y: offsetY + (value.y - bounds.minY) * scale
      });
    }

    private drawEdges(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const edgeHighlights = new Map(
        projection.highlights
          .filter((item): item is BoardHighlightView => item.targetType === "edge")
          .map((item) => [item.targetId, item])
      );
      for (const edge of projection.edges) {
        const points = edge.points.map(toScreen);
        const highlight = edgeHighlights.get(edge.id);
        graphics.lineStyle(highlight ? 9 : 5, edgeColor(edge), 0.95);
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1];
          const to = points[index];
          if (!from || !to) continue;
          const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
          if (length === 0) continue;
          graphics.lineBetween(from.x, from.y, to.x, to.y);
          if (!highlight?.actionId || context.isInteractionPending()) continue;
          const hitArea = this.add.zone(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            length,
            48
          );
          hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", (
            _pointer: unknown,
            _localX: number,
            _localY: number,
            event: { stopPropagation?: () => void } | undefined
          ) => {
            event?.stopPropagation?.();
            this.dispatchHighlight(highlight);
          });
        }
      }
    }

    private drawNodes(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const highlights = new Map(
        projection.highlights
          .filter((item): item is BoardHighlightView => item.targetType === "node")
          .map((item) => [item.targetId, item])
      );
      for (const node of projection.nodes) {
        const position = toScreen(node.position);
        const highlight = highlights.get(node.id);
        graphics.fillStyle(nodeColor(node), 1);
        graphics.lineStyle(highlight ? 7 : 4, highlight ? 0x2d8f6f : 0x263b46, 1);
        graphics.fillCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);
        graphics.strokeCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);

        this.add.text(position.x, position.y - 34, node.label, {
          color: "#17252d",
          backgroundColor: "#fffaf0cc",
          padding: { x: 5, y: 3 },
          fontFamily: "sans-serif",
          fontSize: "18px"
        }).setOrigin(0.5, 1);

        if (highlight?.actionId && !context.isInteractionPending()) {
          // The transparent zone is at least 52×52 design pixels, which keeps
          // the target usable on touch after the FIT scale is applied.
          const hitArea = this.add.zone(position.x, position.y, 52, 52);
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", () => this.dispatchHighlight(highlight));
        }
      }
    }

    private dispatchHighlight(highlight: BoardHighlightView) {
      const pendingKey = `${highlight.targetType}:${highlight.targetId}:${highlight.actionId ?? ""}`;
      if (
        !highlight.actionId
        || context.isInteractionPending()
        || this.pendingHighlights.has(pendingKey)
      ) return;
      this.pendingHighlights.add(pendingKey);
      void context.dispatchAction(highlight.actionId, { ...highlight.params })
        .then(() => { lastError = null; })
        .catch((error: unknown) => {
          // The scene never applies an optimistic topology mutation. Runtime
          // refusal leaves the current snapshot in place and only adds feedback.
          lastError = errorText(error);
          this.renderProjection();
        })
        .finally(() => { this.pendingHighlights.delete(pendingKey); });
    }

    private drawVehicles(
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
      const offsets = new Map<string, number>();
      for (const vehicle of projection.vehicles) {
        if (!vehicle.nodeId) continue;
        const node = nodes.get(vehicle.nodeId);
        if (!node) continue;
        const position = toScreen(node.position);
        const offset = offsets.get(vehicle.nodeId) ?? 0;
        offsets.set(vehicle.nodeId, offset + 1);
        this.add.text(position.x - 20 + offset * 20, position.y + 22,
          vehicle.kind === "locomotive" ? "◆" : "■", {
            color: vehicle.kind === "locomotive" ? "#273f8f" : "#8f5a27",
            fontFamily: "sans-serif",
            fontSize: "20px"
          });
      }
    }

  }

  const scene = new CardsMoneyTrainsScene();
  return {
    scene,
    updateSession(session) {
      if (disposed) return;
      currentSession = session;
      lastError = null;
      scene.renderProjection();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      lastError = null;
      scene.stopProjection();
      if (scene.sys?.isActive()) {
        scene.children.removeAll(true);
      }
    },
    fitToView() {
      scene.fitToView();
    },
    zoomBy(factor) {
      scene.zoomBy(factor);
    },
    getAccessibleActions: provideCardsMoneyTrainsAccessibleBoardActions
  };
};
