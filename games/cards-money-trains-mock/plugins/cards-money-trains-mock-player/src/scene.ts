/**
 * Phaser scene for the public Cards Money Trains board projection.
 *
 * The scene is intentionally a renderer and input adapter. It derives no
 * legal moves, costs, region crossings, balances, or topology. Highlights and
 * action payloads must already be present in the runtime-owned public snapshot.
 */

import type {
  InteractiveBoardActionDraft,
  InteractiveBoardSceneHandle,
  InteractiveBoardSpatialPreview,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@cubica/player-web/plugin-api";
import { closestPositionTOnPolyline } from "@cubica/player-web/plugin-api";

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
import {
  ROAD_BUILD_ACTION_ID,
  WAYPOINT_BUILD_ACTION_ID,
  selectRoadDraftNode,
  selectWaypointDraftPosition
} from "./construction-selection.ts";
import {
  LOCOMOTIVE_MOVE_ACTION_ID,
  selectMovementDraftEdge,
  selectMovementDraftVehicle
} from "./movement-selection.ts";

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

/** Pointer coordinates translated through the currently zoomed map camera. */
type BoardSelectionPointer = CameraPointer & {
  readonly worldX: number;
  readonly worldY: number;
  updateWorldPoint(camera: unknown): unknown;
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
  let currentActionDraft: InteractiveBoardActionDraft | null = null;
  let currentSpatialPreview: InteractiveBoardSpatialPreview | null = null;
  let currentStateVersion = context.session.version.stateVersion;
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
      this.drawSpatialPreview(graphics, toScreen);
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

      this.drawLocomotiveOrder(projection);

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
     * Show the authoritative order as a small heads-up panel over the map.
     *
     * A heads-up panel is a compact information layer fixed to the viewport.
     * It reads the list already saved by runtime and never repeats gameplay
     * sorting in the browser. Six rows are enough for the mock while keeping
     * the map itself the dominant working surface.
     */
    private drawLocomotiveOrder(projection: BoardProjection) {
      if (projection.phase !== "operations" || projection.locomotiveOrder.length === 0) return;
      const visible = projection.locomotiveOrder.slice(0, 6);
      const hiddenCount = projection.locomotiveOrder.length - visible.length;
      const panelWidth = 390;
      const panelX = DESIGN_WIDTH - panelWidth - 28;
      const panelY = 76;
      const panelHeight = 58 + visible.length * 31 + (hiddenCount > 0 ? 26 : 0);

      this.add.graphics()
        .setDepth(900)
        .setScrollFactor(0)
        .fillStyle(0x172b36, 0.9)
        .fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 14)
        .lineStyle(2, 0xf1dfb8, 0.8)
        .strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 14);

      this.add.text(panelX + 18, panelY + 14, "Очередь локомотивов", {
        color: "#fff4dc",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "20px"
      }).setDepth(901).setScrollFactor(0);

      visible.forEach((entry, index) => {
        this.add.text(
          panelX + 18,
          panelY + 48 + index * 31,
          `${index + 1}. ${entry.ownerLabel} · ${entry.nodeLabel}`,
          {
            color: "#f8f2e7",
            fontFamily: "sans-serif",
            fontSize: "17px",
            wordWrap: { width: panelWidth - 36 }
          }
        ).setDepth(901).setScrollFactor(0);
      });

      if (hiddenCount > 0) {
        this.add.text(
          panelX + 18,
          panelY + 48 + visible.length * 31,
          `Ещё ${hiddenCount}`,
          { color: "#d6c7aa", fontFamily: "sans-serif", fontSize: "15px" }
        ).setDepth(901).setScrollFactor(0);
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
      const canSelectWaypoint = projection.availableActions.some((action) =>
        action.actionId === WAYPOINT_BUILD_ACTION_ID && action.disabled !== true);
      const selectedWaypointEdgeId = currentActionDraft?.actionId === WAYPOINT_BUILD_ACTION_ID
        && typeof currentActionDraft.params.edgeId === "string"
        ? currentActionDraft.params.edgeId
        : null;
      const selectedVehicleId = currentActionDraft?.actionId === LOCOMOTIVE_MOVE_ACTION_ID
        && typeof currentActionDraft.params.vehicleId === "string"
        ? currentActionDraft.params.vehicleId
        : null;
      const canSelectMovementEdge = selectedVehicleId !== null
        && projection.vehicles.some((vehicle) =>
          vehicle.kind === "locomotive" && vehicle.id === selectedVehicleId)
        && projection.availableActions.some((action) =>
          action.actionId === LOCOMOTIVE_MOVE_ACTION_ID && action.disabled !== true);
      const selectedMovementEdgeId = canSelectMovementEdge
        && currentActionDraft?.actionId === LOCOMOTIVE_MOVE_ACTION_ID
        && typeof currentActionDraft.params.edgeId === "string"
        ? currentActionDraft.params.edgeId
        : null;
      for (const edge of projection.edges) {
        const points = edge.points.map(toScreen);
        const highlight = edgeHighlights.get(edge.id);
        const waypointSelected = selectedWaypointEdgeId === edge.id;
        const movementSelected = selectedMovementEdgeId === edge.id;
        const selected = waypointSelected || movementSelected;
        graphics.lineStyle(
          selected ? 11 : highlight ? 9 : 5,
          movementSelected ? 0x315ccf : waypointSelected ? 0x1f8f6a : edgeColor(edge),
          0.95
        );
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1];
          const to = points[index];
          if (!from || !to) continue;
          const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
          if (length === 0) continue;
          graphics.lineBetween(from.x, from.y, to.x, to.y);
          if (
            (!canSelectWaypoint && !canSelectMovementEdge && !highlight?.actionId)
            || context.isInteractionPending()
          ) continue;
          const hitArea = this.add.zone(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            length,
            48
          );
          hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", (
            pointer: BoardSelectionPointer,
            _localX: number,
            _localY: number,
            event: { stopPropagation?: () => void } | undefined
          ) => {
            event?.stopPropagation?.();
            if (canSelectWaypoint) {
              this.selectWaypointDraft(edge, points, pointer);
            } else if (canSelectMovementEdge) {
              const next = selectMovementDraftEdge(currentActionDraft, edge.id);
              if (next) this.publishActionDraft(next);
            } else if (highlight) {
              this.dispatchHighlight(highlight);
            }
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
      const canSelectRoad = projection.availableActions.some((action) =>
        action.actionId === ROAD_BUILD_ACTION_ID && action.disabled !== true);
      const selectedNodeIds = new Set<string>();
      if (currentActionDraft?.actionId === ROAD_BUILD_ACTION_ID) {
        const fromNodeId = currentActionDraft.params.fromNodeId;
        const toNodeId = currentActionDraft.params.toNodeId;
        if (typeof fromNodeId === "string") selectedNodeIds.add(fromNodeId);
        if (typeof toNodeId === "string") selectedNodeIds.add(toNodeId);
      }
      for (const node of projection.nodes) {
        const position = toScreen(node.position);
        const highlight = highlights.get(node.id);
        const selected = selectedNodeIds.has(node.id);
        graphics.fillStyle(nodeColor(node), 1);
        graphics.lineStyle(selected ? 9 : highlight ? 7 : 4, selected || highlight ? 0x2d8f6f : 0x263b46, 1);
        graphics.fillCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);
        graphics.strokeCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);

        this.add.text(position.x, position.y - 34, node.label, {
          color: "#17252d",
          backgroundColor: "#fffaf0cc",
          padding: { x: 5, y: 3 },
          fontFamily: "sans-serif",
          fontSize: "18px"
        }).setOrigin(0.5, 1);

        if ((canSelectRoad || highlight?.actionId) && !context.isInteractionPending()) {
          // The transparent zone is at least 52×52 design pixels, which keeps
          // the target usable on touch after the FIT scale is applied.
          const hitArea = this.add.zone(position.x, position.y, 52, 52);
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", () => {
            if (canSelectRoad) {
              this.publishActionDraft(selectRoadDraftNode(currentActionDraft, node.id));
            } else if (highlight) {
              this.dispatchHighlight(highlight);
            }
          });
        }
      }
    }

    /** Paint the server calculation as a temporary overlay, never as a road. */
    private drawSpatialPreview(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const points = currentSpatialPreview?.points.map(toScreen) ?? [];
      if (points.length < 2) return;
      graphics.lineStyle(11, 0x1c9e85, 0.94);
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (from && to) graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
      graphics.fillStyle(0xfff3b0, 1);
      const first = points[0];
      const last = points.at(-1);
      if (first) graphics.fillCircle(first.x, first.y, 9);
      if (last) graphics.fillCircle(last.x, last.y, 9);
    }

    /** Project a road click into a draft; cost and legality stay server-owned. */
    private selectWaypointDraft(
      edge: BoardEdgeView,
      screenPoints: readonly CanonicalPoint[],
      pointer: BoardSelectionPointer
    ) {
      pointer.updateWorldPoint(this.cameras.main);
      // `coordinateMapper` applies one uniform scale, so normalized cumulative
      // distance is identical in canonical and rendered world coordinates.
      const positionT = closestPositionTOnPolyline(
        { x: pointer.worldX, y: pointer.worldY },
        screenPoints
      );
      if (positionT === null) return;
      this.publishActionDraft(selectWaypointDraftPosition(
        currentActionDraft,
        edge.id,
        positionT
      ));
    }

    /** Keep the visual selection local while mirroring it into the DOM form. */
    private publishActionDraft(draft: InteractiveBoardActionDraft) {
      currentActionDraft = draft;
      context.onActionDraftChange(draft);
      this.renderProjection();
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
      const canSelectMovementVehicle = projection.availableActions.some((action) =>
        action.actionId === LOCOMOTIVE_MOVE_ACTION_ID && action.disabled !== true);
      const selectedVehicleId = currentActionDraft?.actionId === LOCOMOTIVE_MOVE_ACTION_ID
        && typeof currentActionDraft.params.vehicleId === "string"
        ? currentActionDraft.params.vehicleId
        : null;
      for (const vehicle of projection.vehicles) {
        if (!vehicle.nodeId) continue;
        const node = nodes.get(vehicle.nodeId);
        if (!node) continue;
        const position = toScreen(node.position);
        const offset = offsets.get(vehicle.nodeId) ?? 0;
        offsets.set(vehicle.nodeId, offset + 1);
        const markerX = position.x - 20 + offset * 24;
        const markerY = position.y + 32;
        const selected = selectedVehicleId === vehicle.id;
        this.add.circle(
          markerX,
          markerY,
          selected ? 17 : 14,
          selected ? 0xe9f0ff : 0xfffaf0,
          0.96
        ).setStrokeStyle(selected ? 5 : 2, selected ? 0x315ccf : 0x354957, 1);
        this.add.text(markerX, markerY,
          vehicle.kind === "locomotive" ? "◆" : "■", {
            color: vehicle.kind === "locomotive"
              ? selected ? "#183d9f" : "#273f8f"
              : "#8f5a27",
            fontFamily: "sans-serif",
            fontSize: selected ? "23px" : "20px"
          }).setOrigin(0.5);

        if (
          vehicle.kind === "locomotive"
          && canSelectMovementVehicle
          && !context.isInteractionPending()
        ) {
          // The marker remains comfortably selectable after the map camera is
          // zoomed out. Clicking it only updates the shared local draft.
          const hitArea = this.add.zone(markerX, markerY, 52, 52);
          hitArea.setInteractive({ useHandCursor: true });
          hitArea.on("pointerdown", (
            _pointer: CameraPointer,
            _localX: number,
            _localY: number,
            event: { stopPropagation?: () => void } | undefined
          ) => {
            event?.stopPropagation?.();
            this.publishActionDraft(selectMovementDraftVehicle(currentActionDraft, vehicle.id));
          });
        }
      }
    }

  }

  const scene = new CardsMoneyTrainsScene();
  return {
    scene,
    updateSession(session) {
      if (disposed) return;
      const nextStateVersion = session.version.stateVersion;
      const snapshotChanged = nextStateVersion !== currentStateVersion;
      currentStateVersion = nextStateVersion;
      currentSession = session;
      lastError = null;
      if (snapshotChanged && currentActionDraft !== null) {
        // Every authoritative state change invalidates the local canvas/DOM
        // choice. This mirrors the generic host rule and closes the short
        // interval before React propagates its own cleared draft back here.
        currentActionDraft = null;
        context.onActionDraftChange(null);
      }
      scene.renderProjection();
    },
    updateActionDraft(draft) {
      currentActionDraft = draft;
      scene.renderProjection();
    },
    updateSpatialPreview(preview) {
      currentSpatialPreview = preview;
      scene.renderProjection();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      currentActionDraft = null;
      currentSpatialPreview = null;
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
