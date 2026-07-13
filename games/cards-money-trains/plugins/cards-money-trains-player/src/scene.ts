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

    constructor() {
      super({ key: `cards-money-trains:${context.sceneId}` });
    }

    preload() {
      // Resolve only a declared ADR-063 asset id. The scene never reads a file
      // path or accepts a mutable URL from game state.
      this.load.image("cards-money-trains-board", context.assets.url("board-guinea-optimized"));
    }

    create() {
      this.projectionReady = true;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.stopProjection();
      });
      this.cameras.main.setBackgroundColor("#f3ead8");
      this.configureCameraInteraction();
      this.renderProjection();
    }

    /**
     * Release scene-owned listeners before Phaser tears down its managers.
     * Ordinary DOM actions are registered separately and do not depend on this
     * lifecycle or on the camera being available.
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
      // A drag starts only on empty world space. Interactive nodes and road
      // zones keep their existing click behavior and are never stolen by pan.
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

    renderProjection() {
      if (!this.projectionReady) return;
      this.children.removeAll(true);
      const projection = projectBoardSession(currentSession);
      const background = this.add.graphics();

      background.fillStyle(0xf3ead8, 1);
      background.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

      if (this.textures.exists("cards-money-trains-board")) {
        this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "cards-money-trains-board")
          .setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT)
          .setAlpha(0.82);
      }

      // Roads and nodes are semantic session data, so they must render above
      // the decorative map rather than being muted underneath its texture.
      const graphics = this.add.graphics();
      const toScreen = this.coordinateMapper(projection);
      this.drawEdges(graphics, projection, toScreen);
      this.drawNodes(graphics, projection, toScreen);
      this.drawVehicles(projection, toScreen);
      this.drawTeamSummary(projection);

      if (projection.nodes.length === 0) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2,
          "Ожидаются авторские узлы, координаты и начальная сеть",
          { color: "#24343d", fontFamily: "sans-serif", fontSize: "28px", align: "center" })
          .setOrigin(0.5);
      }

      this.add.text(34, 24, `Ход ${projection.turnNumber} · этап: ${projection.phase}`, {
        color: "#17252d",
        backgroundColor: "#fffaf0dd",
        padding: { x: 12, y: 8 },
        fontFamily: "sans-serif",
        fontSize: "22px"
      });

      if (lastError) {
        this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 34, lastError, {
          color: "#ffffff",
          backgroundColor: "#9e2f2f",
          padding: { x: 14, y: 8 },
          fontFamily: "sans-serif",
          fontSize: "20px"
        }).setOrigin(0.5, 1);
      }
    }

    private coordinateMapper(projection: BoardProjection) {
      const bounds = projection.bounds;
      if (!bounds) return (_point: CanonicalPoint) => ({ x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
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
        const from = toScreen(edge.from);
        const to = toScreen(edge.to);
        const highlight = edgeHighlights.get(edge.id);
        graphics.lineStyle(highlight ? 10 : 6, edgeColor(edge), 0.95);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
        if (highlight?.actionId) {
          const hitArea = this.add.zone(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y),
            28
          );
          hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", () => this.dispatchHighlight(highlight));
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

        const label = this.add.text(position.x, position.y - 34, node.label, {
          color: "#17252d",
          backgroundColor: "#fffaf0cc",
          padding: { x: 5, y: 3 },
          fontFamily: "sans-serif",
          fontSize: "18px"
        }).setOrigin(0.5, 1);

        if (highlight?.actionId) {
          label.setInteractive({ useHandCursor: true });
          label.on("pointerdown", () => this.dispatchHighlight(highlight));
        }
      }
    }

    private dispatchHighlight(highlight: BoardHighlightView) {
      if (!highlight.actionId) return;
      void context.dispatchAction(highlight.actionId, { ...highlight.params })
        .then(() => { lastError = null; })
        .catch((error: unknown) => {
          // The scene never applies an optimistic topology mutation. Runtime
          // refusal leaves the current snapshot in place and only adds feedback.
          lastError = errorText(error);
          this.renderProjection();
        });
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

    private drawTeamSummary(projection: BoardProjection) {
      if (projection.teams.length === 0) return;
      const lines = projection.teams.map((team) =>
        `${team.label}: ${team.coins === null ? "—" : team.coins} мон.`
      );
      this.add.text(DESIGN_WIDTH - 28, 24, lines.join("\n"), {
        color: "#17252d",
        backgroundColor: "#fffaf0dd",
        padding: { x: 12, y: 8 },
        fontFamily: "sans-serif",
        fontSize: "18px",
        align: "right"
      }).setOrigin(1, 0);
    }
  }

  const scene = new CardsMoneyTrainsScene();
  return {
    scene,
    updateSession(session) {
      currentSession = session;
      lastError = null;
      scene.renderProjection();
    },
    destroy() {
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
