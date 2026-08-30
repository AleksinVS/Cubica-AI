const __pluginApi = globalThis.__cubicaPlayerPluginApiModule;
if (!__pluginApi) { throw new Error('Cubica player plugin API is not available.'); }
const __pluginModules = new Map();
const __pluginCache = new Map();
function __pluginDefine(id, factory) { __pluginModules.set(id, factory); }
function __pluginRequire(id) {
  if (id === '@cubica/player-web/plugin-api') return __pluginApi;
  if (__pluginCache.has(id)) return __pluginCache.get(id).exports;
  const factory = __pluginModules.get(id);
  if (!factory) throw new Error(`Plugin module not found: ${id}`);
  const module = { exports: {} };
  __pluginCache.set(id, module);
  factory(module.exports, module);
  return module.exports;
}
__pluginDefine("src/index.ts", (exports, module) => {
"use strict";
/**
 * Public entrypoint for the explicitly test-only Cards Money Trains plugin.
 *
 * The plugin registers an engine-independent action projection and one Phaser
 * scene factory. Phaser remains platform-owned and is injected into the scene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCardsMoneyTrainsScene = exports.provideCardsMoneyTrainsAccessibleBoardActions = exports.projectBoardSession = exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = exports.CARDS_MONEY_TRAINS_GAME_ID = void 0;
exports.activate = activate;
const scene_ts_1 = __pluginRequire("src/scene.ts");
const registration_ts_1 = __pluginRequire("src/registration.ts");
var registration_ts_2 = __pluginRequire("src/registration.ts");
Object.defineProperty(exports, "CARDS_MONEY_TRAINS_GAME_ID", { enumerable: true, get: function () { return registration_ts_2.CARDS_MONEY_TRAINS_GAME_ID; } });
Object.defineProperty(exports, "CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID", { enumerable: true, get: function () { return registration_ts_2.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID; } });
var board_state_ts_1 = __pluginRequire("src/board-state.ts");
Object.defineProperty(exports, "projectBoardSession", { enumerable: true, get: function () { return board_state_ts_1.projectBoardSession; } });
var accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
Object.defineProperty(exports, "provideCardsMoneyTrainsAccessibleBoardActions", { enumerable: true, get: function () { return accessible_actions_ts_1.provideCardsMoneyTrainsAccessibleBoardActions; } });
var scene_ts_2 = __pluginRequire("src/scene.ts");
Object.defineProperty(exports, "createCardsMoneyTrainsScene", { enumerable: true, get: function () { return scene_ts_2.createCardsMoneyTrainsScene; } });
/** Register both independent host controls and the Phaser scene. */
function activate(api) {
    return (0, registration_ts_1.registerCardsMoneyTrainsPlayer)(api, scene_ts_1.createCardsMoneyTrainsScene);
}

});
__pluginDefine("src/scene.ts", (exports, module) => {
"use strict";
/**
 * Phaser scene for the public Cards Money Trains board projection.
 *
 * The scene is intentionally a renderer and input adapter. It derives no
 * legal moves, costs, region crossings, balances, or topology. Highlights and
 * action payloads must already be present in the runtime-owned public snapshot.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCardsMoneyTrainsScene = void 0;
const plugin_api_1 = __pluginRequire("@cubica/player-web/plugin-api");
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const camera_math_ts_1 = __pluginRequire("src/camera-math.ts");
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
const construction_selection_ts_1 = __pluginRequire("src/construction-selection.ts");
const movement_selection_ts_1 = __pluginRequire("src/movement-selection.ts");
const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const BOARD_PADDING = 72;
const CAMERA_WORLD = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_STEP = 1.15;
const edgeColor = (edge) => {
    if (edge.visualState === "blocked")
        return 0xc94c4c;
    if (edge.visualState === "building")
        return 0xe0a33a;
    return 0x374b59;
};
const nodeColor = (node) => node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;
const errorText = (error) => error instanceof Error ? error.message : "Действие отклонено runtime";
/** Build a scene instance exclusively from platform-injected Phaser. */
const createCardsMoneyTrainsScene = (context) => {
    const Phaser = context.Phaser;
    let currentSession = context.session;
    let currentActionDraft = null;
    let currentSpatialPreview = null;
    let currentStateVersion = context.session.version.stateVersion;
    let lastError = null;
    let disposed = false;
    class CardsMoneyTrainsScene extends Phaser.Scene {
        /**
         * Phaser does not mark a scene active until its `create` callback returns.
         * A dedicated readiness flag lets that callback paint its first frame while
         * still preventing snapshot updates after shutdown from touching managers
         * that Phaser has already released.
         */
        projectionReady = false;
        cameraInteractionReady = false;
        overviewActive = true;
        cameraViewport = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
        dragState = null;
        /** Prevent overlapping zones of one bent road from dispatching twice. */
        pendingHighlights = new Set();
        constructor() {
            super({ key: `cards-money-trains:${context.sceneId}` });
        }
        preload() {
            // Resolve only a declared ADR-063 asset id. The scene never reads a file
            // path or accepts a mutable URL from game state.
            this.load.image("cards-money-trains-board", context.assets.url("board-guinea-optimized"));
        }
        create() {
            if (disposed)
                return;
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
            if (!this.projectionReady || disposed)
                return;
            this.children.removeAll(true);
            const projection = (0, board_state_ts_1.projectBoardSession)(currentSession);
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
                this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "Ожидаются авторские узлы, координаты и начальная сеть", { color: "#24343d", fontFamily: "sans-serif", fontSize: "26px", align: "center" })
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
        drawLocomotiveOrder(projection) {
            if (projection.phase !== "operations" || projection.locomotiveOrder.length === 0)
                return;
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
                this.add.text(panelX + 18, panelY + 48 + index * 31, `${index + 1}. ${entry.ownerLabel} · ${entry.nodeLabel}`, {
                    color: "#f8f2e7",
                    fontFamily: "sans-serif",
                    fontSize: "17px",
                    wordWrap: { width: panelWidth - 36 }
                }).setDepth(901).setScrollFactor(0);
            });
            if (hiddenCount > 0) {
                this.add.text(panelX + 18, panelY + 48 + visible.length * 31, `Ещё ${hiddenCount}`, { color: "#d6c7aa", fontFamily: "sans-serif", fontSize: "15px" }).setDepth(901).setScrollFactor(0);
            }
        }
        /**
         * Stop late callbacks and release camera listeners before Phaser releases
         * scene managers. DOM action controls live in the host and remain separate.
         */
        stopProjection() {
            this.projectionReady = false;
            if (!this.cameraInteractionReady)
                return;
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
            if (!this.projectionReady)
                return;
            this.overviewActive = true;
            this.applyCameraView((0, camera_math_ts_1.overviewCameraView)(this.currentViewport(), CAMERA_WORLD));
        }
        /** Zoom around the viewport centre; factors above one mean zooming in. */
        zoomBy(factor) {
            if (!this.projectionReady || !Number.isFinite(factor) || factor <= 0)
                return;
            const viewport = this.currentViewport();
            this.applyZoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, factor);
        }
        configureCameraInteraction() {
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
        currentViewport() {
            const camera = this.cameras.main;
            return { width: Math.max(1, camera.width), height: Math.max(1, camera.height) };
        }
        currentCameraView() {
            const camera = this.cameras.main;
            return { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom };
        }
        applyCameraView(view) {
            this.cameras.main.setZoom(view.zoom).setScroll(view.scrollX, view.scrollY);
        }
        applyZoomAt(point, factor) {
            const viewport = this.currentViewport();
            const current = this.currentCameraView();
            const minimumZoom = (0, camera_math_ts_1.fitCameraZoom)(viewport, CAMERA_WORLD);
            const next = (0, camera_math_ts_1.zoomCameraViewAtPoint)(current, point, current.zoom * factor, viewport, CAMERA_WORLD, { min: minimumZoom, max: MAX_CAMERA_ZOOM });
            this.overviewActive = false;
            this.applyCameraView(next);
        }
        handleWheel = (pointer, _currentlyOver, _deltaX, deltaY) => {
            if (deltaY === 0)
                return;
            this.applyZoomAt({ x: pointer.x, y: pointer.y }, deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
        };
        handlePointerDown = (pointer, currentlyOver) => {
            // Interactive road and node targets keep their click behavior; only an
            // empty part of the mock world may initiate camera panning.
            if (currentlyOver.length > 0)
                return;
            this.dragState = { pointerId: pointer.id, x: pointer.x, y: pointer.y };
        };
        handlePointerMove = (pointer) => {
            const previous = this.dragState;
            if (!previous || previous.pointerId !== pointer.id || !pointer.isDown)
                return;
            const delta = { x: pointer.x - previous.x, y: pointer.y - previous.y };
            this.dragState = { pointerId: pointer.id, x: pointer.x, y: pointer.y };
            if (delta.x === 0 && delta.y === 0)
                return;
            this.overviewActive = false;
            this.applyCameraView((0, camera_math_ts_1.panCameraViewBy)(this.currentCameraView(), delta, this.currentViewport(), CAMERA_WORLD));
        };
        handlePointerUp = (pointer) => {
            if (this.dragState?.pointerId === pointer.id)
                this.dragState = null;
        };
        cancelDrag = () => {
            this.dragState = null;
        };
        handleResize = () => {
            if (!this.cameraInteractionReady)
                return;
            const previousViewport = this.cameraViewport;
            const nextViewport = this.currentViewport();
            this.cameraViewport = nextViewport;
            this.cameras.main.setBounds(CAMERA_WORLD.x, CAMERA_WORLD.y, CAMERA_WORLD.width, CAMERA_WORLD.height);
            if (this.overviewActive) {
                this.applyCameraView((0, camera_math_ts_1.overviewCameraView)(nextViewport, CAMERA_WORLD));
                return;
            }
            this.applyCameraView((0, camera_math_ts_1.resizeCameraView)(this.currentCameraView(), previousViewport, nextViewport, CAMERA_WORLD));
        };
        coordinateMapper(projection) {
            const bounds = projection.bounds;
            if (!bounds)
                return (_point) => ({
                    x: DESIGN_WIDTH / 2,
                    y: DESIGN_HEIGHT / 2
                });
            const width = Math.max(1, bounds.maxX - bounds.minX);
            const height = Math.max(1, bounds.maxY - bounds.minY);
            const scale = Math.min((DESIGN_WIDTH - BOARD_PADDING * 2) / width, (DESIGN_HEIGHT - BOARD_PADDING * 2) / height);
            const renderedWidth = width * scale;
            const renderedHeight = height * scale;
            const offsetX = (DESIGN_WIDTH - renderedWidth) / 2;
            const offsetY = (DESIGN_HEIGHT - renderedHeight) / 2;
            return (value) => ({
                x: offsetX + (value.x - bounds.minX) * scale,
                y: offsetY + (value.y - bounds.minY) * scale
            });
        }
        drawEdges(graphics, projection, toScreen) {
            const edgeHighlights = new Map(projection.highlights
                .filter((item) => item.targetType === "edge")
                .map((item) => [item.targetId, item]));
            const canSelectWaypoint = projection.availableActions.some((action) => action.actionId === construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID && action.disabled !== true);
            const selectedWaypointEdgeId = currentActionDraft?.actionId === construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID
                && typeof currentActionDraft.params.edgeId === "string"
                ? currentActionDraft.params.edgeId
                : null;
            const selectedVehicleId = currentActionDraft?.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID
                && typeof currentActionDraft.params.vehicleId === "string"
                ? currentActionDraft.params.vehicleId
                : null;
            const canSelectMovementEdge = selectedVehicleId !== null
                && projection.vehicles.some((vehicle) => vehicle.kind === "locomotive" && vehicle.id === selectedVehicleId)
                && projection.availableActions.some((action) => action.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID && action.disabled !== true);
            const selectedMovementEdgeId = canSelectMovementEdge
                && currentActionDraft?.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID
                && typeof currentActionDraft.params.edgeId === "string"
                ? currentActionDraft.params.edgeId
                : null;
            for (const edge of projection.edges) {
                const points = edge.points.map(toScreen);
                const highlight = edgeHighlights.get(edge.id);
                const waypointSelected = selectedWaypointEdgeId === edge.id;
                const movementSelected = selectedMovementEdgeId === edge.id;
                const selected = waypointSelected || movementSelected;
                graphics.lineStyle(selected ? 11 : highlight ? 9 : 5, movementSelected ? 0x315ccf : waypointSelected ? 0x1f8f6a : edgeColor(edge), 0.95);
                for (let index = 1; index < points.length; index += 1) {
                    const from = points[index - 1];
                    const to = points[index];
                    if (!from || !to)
                        continue;
                    const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
                    if (length === 0)
                        continue;
                    graphics.lineBetween(from.x, from.y, to.x, to.y);
                    if ((!canSelectWaypoint && !canSelectMovementEdge && !highlight?.actionId)
                        || context.isInteractionPending())
                        continue;
                    const hitArea = this.add.zone((from.x + to.x) / 2, (from.y + to.y) / 2, length, 48);
                    hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
                    hitArea.setInteractive({ useHandCursor: true });
                    hitArea.on("pointerdown", (pointer, _localX, _localY, event) => {
                        event?.stopPropagation?.();
                        if (canSelectWaypoint) {
                            this.selectWaypointDraft(edge, points, pointer);
                        }
                        else if (canSelectMovementEdge) {
                            const next = (0, movement_selection_ts_1.selectMovementDraftEdge)(currentActionDraft, edge.id);
                            if (next)
                                this.publishActionDraft(next);
                        }
                        else if (highlight) {
                            this.dispatchHighlight(highlight);
                        }
                    });
                }
            }
        }
        drawNodes(graphics, projection, toScreen) {
            const highlights = new Map(projection.highlights
                .filter((item) => item.targetType === "node")
                .map((item) => [item.targetId, item]));
            const canSelectRoad = projection.availableActions.some((action) => action.actionId === construction_selection_ts_1.ROAD_BUILD_ACTION_ID && action.disabled !== true);
            const selectedNodeIds = new Set();
            if (currentActionDraft?.actionId === construction_selection_ts_1.ROAD_BUILD_ACTION_ID) {
                const fromNodeId = currentActionDraft.params.fromNodeId;
                const toNodeId = currentActionDraft.params.toNodeId;
                if (typeof fromNodeId === "string")
                    selectedNodeIds.add(fromNodeId);
                if (typeof toNodeId === "string")
                    selectedNodeIds.add(toNodeId);
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
                            this.publishActionDraft((0, construction_selection_ts_1.selectRoadDraftNode)(currentActionDraft, node.id));
                        }
                        else if (highlight) {
                            this.dispatchHighlight(highlight);
                        }
                    });
                }
            }
        }
        /** Paint the server calculation as a temporary overlay, never as a road. */
        drawSpatialPreview(graphics, toScreen) {
            const points = currentSpatialPreview?.points.map(toScreen) ?? [];
            if (points.length < 2)
                return;
            graphics.lineStyle(11, 0x1c9e85, 0.94);
            for (let index = 1; index < points.length; index += 1) {
                const from = points[index - 1];
                const to = points[index];
                if (from && to)
                    graphics.lineBetween(from.x, from.y, to.x, to.y);
            }
            graphics.fillStyle(0xfff3b0, 1);
            const first = points[0];
            const last = points.at(-1);
            if (first)
                graphics.fillCircle(first.x, first.y, 9);
            if (last)
                graphics.fillCircle(last.x, last.y, 9);
        }
        /** Project a road click into a draft; cost and legality stay server-owned. */
        selectWaypointDraft(edge, screenPoints, pointer) {
            pointer.updateWorldPoint(this.cameras.main);
            // `coordinateMapper` applies one uniform scale, so normalized cumulative
            // distance is identical in canonical and rendered world coordinates.
            const positionT = (0, plugin_api_1.closestPositionTOnPolyline)({ x: pointer.worldX, y: pointer.worldY }, screenPoints);
            if (positionT === null)
                return;
            this.publishActionDraft((0, construction_selection_ts_1.selectWaypointDraftPosition)(currentActionDraft, edge.id, positionT));
        }
        /** Keep the visual selection local while mirroring it into the DOM form. */
        publishActionDraft(draft) {
            currentActionDraft = draft;
            context.onActionDraftChange(draft);
            this.renderProjection();
        }
        dispatchHighlight(highlight) {
            const pendingKey = `${highlight.targetType}:${highlight.targetId}:${highlight.actionId ?? ""}`;
            if (!highlight.actionId
                || context.isInteractionPending()
                || this.pendingHighlights.has(pendingKey))
                return;
            this.pendingHighlights.add(pendingKey);
            void context.dispatchAction(highlight.actionId, { ...highlight.params })
                .then(() => { lastError = null; })
                .catch((error) => {
                // The scene never applies an optimistic topology mutation. Runtime
                // refusal leaves the current snapshot in place and only adds feedback.
                lastError = errorText(error);
                this.renderProjection();
            })
                .finally(() => { this.pendingHighlights.delete(pendingKey); });
        }
        drawVehicles(projection, toScreen) {
            const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
            const offsets = new Map();
            const canSelectMovementVehicle = projection.availableActions.some((action) => action.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID && action.disabled !== true);
            const selectedVehicleId = currentActionDraft?.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID
                && typeof currentActionDraft.params.vehicleId === "string"
                ? currentActionDraft.params.vehicleId
                : null;
            for (const vehicle of projection.vehicles) {
                if (!vehicle.nodeId)
                    continue;
                const node = nodes.get(vehicle.nodeId);
                if (!node)
                    continue;
                const position = toScreen(node.position);
                const offset = offsets.get(vehicle.nodeId) ?? 0;
                offsets.set(vehicle.nodeId, offset + 1);
                const markerX = position.x - 20 + offset * 24;
                const markerY = position.y + 32;
                const selected = selectedVehicleId === vehicle.id;
                this.add.circle(markerX, markerY, selected ? 17 : 14, selected ? 0xe9f0ff : 0xfffaf0, 0.96).setStrokeStyle(selected ? 5 : 2, selected ? 0x315ccf : 0x354957, 1);
                this.add.text(markerX, markerY, vehicle.kind === "locomotive" ? "◆" : "■", {
                    color: vehicle.kind === "locomotive"
                        ? selected ? "#183d9f" : "#273f8f"
                        : "#8f5a27",
                    fontFamily: "sans-serif",
                    fontSize: selected ? "23px" : "20px"
                }).setOrigin(0.5);
                if (vehicle.kind === "locomotive"
                    && canSelectMovementVehicle
                    && !context.isInteractionPending()) {
                    // The marker remains comfortably selectable after the map camera is
                    // zoomed out. Clicking it only updates the shared local draft.
                    const hitArea = this.add.zone(markerX, markerY, 52, 52);
                    hitArea.setInteractive({ useHandCursor: true });
                    hitArea.on("pointerdown", (_pointer, _localX, _localY, event) => {
                        event?.stopPropagation?.();
                        this.publishActionDraft((0, movement_selection_ts_1.selectMovementDraftVehicle)(currentActionDraft, vehicle.id));
                    });
                }
            }
        }
    }
    const scene = new CardsMoneyTrainsScene();
    return {
        scene,
        updateSession(session) {
            if (disposed)
                return;
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
            if (disposed)
                return;
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
        getAccessibleActions: accessible_actions_ts_1.provideCardsMoneyTrainsAccessibleBoardActions
    };
};
exports.createCardsMoneyTrainsScene = createCardsMoneyTrainsScene;

});
__pluginDefine("src/accessible-actions.ts", (exports, module) => {
"use strict";
/**
 * Accessible action projection for the Cards Money Trains test-only board.
 *
 * The provider is intentionally independent from Phaser. It copies actions
 * already published in the authoritative session so the host can expose its
 * ordinary keyboard controls before or without creating the visual scene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCardsMoneyTrainsAccessibleBoardActions = void 0;
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
const movement_selection_ts_1 = __pluginRequire("src/movement-selection.ts");
const selectOptions = (values) => values.map((value) => ({ value: value.id, label: value.label ?? value.id }));
const contributionLabel = (name, projection) => {
    const prefix = name.replace(/Contribution$/u, "").toLowerCase();
    const team = projection.teams.find((candidate) => candidate.id.toLowerCase().includes(prefix) || candidate.label.toLowerCase().includes(prefix));
    return team ? `Вклад: ${team.label}` : `Вклад: ${prefix}`;
};
/** Human-readable public label for one explicitly active transport unit. */
const vehicleLabel = (vehicle, projection) => {
    const team = projection.teams.find((candidate) => candidate.id === vehicle.ownerTeamId);
    const node = projection.nodes.find((candidate) => candidate.id === vehicle.nodeId);
    return [
        team?.label ?? vehicle.ownerTeamId ?? "Без владельца",
        node?.label ?? vehicle.nodeId ?? "Вне станции",
        "активен",
        vehicle.id
    ].join(" · ");
};
const cargoStatusLabel = (status) => {
    if (status === "available")
        return "доступен";
    if (status === "in_transit")
        return "в пути";
    if (status === "delivered")
        return "доставлен";
    return status ? `статус: ${status}` : "статус не указан";
};
/** Describe one public order while leaving all route and status checks to runtime. */
const cargoLabel = (cargo, projection) => {
    const from = projection.nodes.find((node) => node.id === cargo.fromNodeId);
    const to = projection.nodes.find((node) => node.id === cargo.toNodeId);
    const route = `${from?.label ?? cargo.fromNodeId ?? "?"} → ${to?.label ?? cargo.toNodeId ?? "?"}`;
    const payout = cargo.payout === null ? "выплата не указана" : `выплата ${cargo.payout}`;
    return `${route} · ${cargoStatusLabel(cargo.status)} · ${payout} · ${cargo.id}`;
};
/** Public endpoint labels for a road; openness remains a runtime concern. */
const edgeLabel = (edge, projection) => {
    const from = projection.nodes.find((node) => node.id === edge.fromNodeId);
    const to = projection.nodes.find((node) => node.id === edge.toNodeId);
    return `${from?.label ?? edge.fromNodeId} — ${to?.label ?? edge.toNodeId}`;
};
/** Build a normal keyboard form from public board choices, never from rules. */
const actionFields = (action, projection) => {
    const contributionFields = Object.entries(action.params ?? {})
        .filter(([name, value]) => name.endsWith("Contribution") && typeof value === "number")
        .map(([name, value]) => ({
        name,
        label: contributionLabel(name, projection),
        kind: "number",
        required: true,
        min: 0,
        step: 1,
        defaultValue: value
    }));
    if (action.actionId === "construction.road.build") {
        const options = selectOptions(projection.nodes);
        if (options.length < 2)
            return undefined;
        return [
            { name: "fromNodeId", label: "Первая станция", kind: "select", required: true, options },
            { name: "toNodeId", label: "Вторая станция", kind: "select", required: true, options },
            ...contributionFields
        ];
    }
    if (action.actionId === "construction.waypoint.build") {
        if (projection.edges.length === 0)
            return undefined;
        return [
            {
                name: "edgeId",
                label: "Существующая дорога",
                kind: "select",
                required: true,
                options: selectOptions(projection.edges.map((edge) => ({
                    id: edge.id,
                    label: edgeLabel(edge, projection)
                })))
            },
            {
                name: "positionT",
                label: "Положение на дороге (от 0 до 1)",
                kind: "number",
                required: true,
                min: 0.01,
                max: 0.99,
                step: 0.01
            },
            ...contributionFields
        ];
    }
    if (action.actionId === movement_selection_ts_1.LOCOMOTIVE_MOVE_ACTION_ID) {
        return [
            {
                name: "vehicleId",
                label: "Активный локомотив",
                kind: "select",
                required: true,
                options: selectOptions(projection.vehicles
                    .filter((vehicle) => vehicle.kind === "locomotive")
                    .map((vehicle) => ({
                    id: vehicle.id,
                    label: vehicleLabel(vehicle, projection)
                })))
            },
            {
                name: "edgeId",
                label: "Дорога",
                kind: "select",
                required: true,
                options: selectOptions(projection.edges.map((edge) => ({
                    id: edge.id,
                    label: edgeLabel(edge, projection)
                })))
            }
        ];
    }
    if (action.actionId === "mock.cargo.load.white") {
        return [
            {
                name: "wagonId",
                label: "Активный вагон",
                kind: "select",
                required: true,
                options: selectOptions(projection.vehicles
                    .filter((vehicle) => vehicle.kind === "wagon")
                    .map((vehicle) => ({
                    id: vehicle.id,
                    label: vehicleLabel(vehicle, projection)
                })))
            },
            {
                name: "cargoId",
                label: "Предложенный груз",
                kind: "select",
                required: true,
                options: selectOptions(projection.cargoOfferIds.map((id) => {
                    const cargo = projection.cargoOrders.find((candidate) => candidate.id === id);
                    return {
                        id,
                        label: cargo ? cargoLabel(cargo, projection) : id
                    };
                }))
            }
        ];
    }
    if (action.actionId === "mock.operations.attach.white"
        || action.actionId === "mock.operations.detach.white") {
        return [
            {
                name: "vehicleId",
                label: "Активный локомотив",
                kind: "select",
                required: true,
                options: selectOptions(projection.vehicles
                    .filter((vehicle) => vehicle.kind === "locomotive")
                    .map((vehicle) => ({
                    id: vehicle.id,
                    label: vehicleLabel(vehicle, projection)
                })))
            },
            {
                name: "wagonId",
                label: "Активный вагон",
                kind: "select",
                required: true,
                options: selectOptions(projection.vehicles
                    .filter((vehicle) => vehicle.kind === "wagon")
                    .map((vehicle) => ({
                    id: vehicle.id,
                    label: vehicleLabel(vehicle, projection)
                })))
            }
        ];
    }
    if (action.actionId === "mock.cargo.deliver") {
        return [
            {
                name: "wagonId",
                label: "Активный вагон",
                kind: "select",
                required: true,
                options: selectOptions(projection.vehicles
                    .filter((vehicle) => vehicle.kind === "wagon")
                    .map((vehicle) => ({
                    id: vehicle.id,
                    label: vehicleLabel(vehicle, projection)
                })))
            },
            {
                name: "cargoId",
                label: "Публичный грузовой заказ",
                kind: "select",
                required: true,
                // Deliberately include every public status. Runtime alone decides
                // whether a selected order is currently deliverable.
                options: selectOptions(projection.cargoOrders.map((cargo) => ({
                    id: cargo.id,
                    label: cargoLabel(cargo, projection)
                })))
            }
        ];
    }
    return undefined;
};
/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (action, projection) => {
    const fields = actionFields(action, projection);
    return {
        id: action.id,
        label: action.label,
        actionId: action.actionId,
        ...(action.description === undefined ? {} : { description: action.description }),
        ...(action.params === undefined ? {} : { params: { ...action.params } }),
        ...(fields === undefined ? {} : { fields }),
        ...(action.actionId === "construction.road.build" ? {
            preview: {
                kind: "transport-road",
                endpointParameters: { from: "fromNodeId", to: "toNodeId" }
            }
        } : {}),
        ...(action.disabled === undefined ? {} : { disabled: action.disabled })
    };
};
/**
 * Return only actions present in the authoritative player-facing snapshot.
 * Phase and availability filtering come from the server projection reader.
 */
const provideCardsMoneyTrainsAccessibleBoardActions = (session) => {
    const projection = (0, board_state_ts_1.projectBoardSession)(session);
    return projection.availableActions.map((action) => toAccessibleAction(action, projection));
};
exports.provideCardsMoneyTrainsAccessibleBoardActions = provideCardsMoneyTrainsAccessibleBoardActions;

});
__pluginDefine("src/board-state.ts", (exports, module) => {
"use strict";
/**
 * Public-snapshot projection for the Cards Money Trains Phaser scene.
 *
 * This module deliberately contains no gameplay validation. Runtime provides
 * authoritative nodes, edges, highlights, and accessible actions; the plugin
 * only normalizes those public values into a safe rendering model.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectBoardSession = projectBoardSession;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
const point = (value) => {
    if (!isRecord(value))
        return null;
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    return x === null || y === null ? null : { x, y };
};
/** Reject a planned route as a whole when any coordinate is unsafe. */
const polyline = (value) => {
    if (!Array.isArray(value) || value.length < 2)
        return null;
    const points = value.map(point);
    return points.every((item) => item !== null) ? points : null;
};
const objectCollection = (publicState, collectionId) => {
    const objects = isRecord(publicState.objects) ? publicState.objects : {};
    return isRecord(objects[collectionId]) ? objects[collectionId] : {};
};
const readNodes = (publicState) => Object.entries(objectCollection(publicState, "networkNodes")).flatMap(([id, raw]) => {
    if (!isRecord(raw))
        return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const position = point(attributes.position);
    if (!position)
        return [];
    const facets = isRecord(raw.facets) ? raw.facets : {};
    return [{
            id,
            label: text(attributes.label) ?? id,
            objectType: text(raw.objectType) ?? "transport.node",
            position,
            visualState: text(facets.availability) ?? "open"
        }];
});
const readEdges = (publicState, nodes) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return Object.entries(objectCollection(publicState, "networkEdges")).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        const attributes = isRecord(raw.attributes) ? raw.attributes : {};
        const fromNodeId = text(attributes.fromNodeId);
        const toNodeId = text(attributes.toNodeId);
        if (!fromNodeId || !toNodeId)
            return [];
        const geometry = isRecord(attributes.geometry) ? attributes.geometry : {};
        const plannedPoints = polyline(geometry.polyline);
        const legacyFrom = point(geometry.from) ?? byId.get(fromNodeId)?.position ?? null;
        const legacyTo = point(geometry.to) ?? byId.get(toNodeId)?.position ?? null;
        const fallbackPoints = legacyFrom && legacyTo ? [legacyFrom, legacyTo] : null;
        const points = plannedPoints ?? fallbackPoints;
        if (!points)
            return [];
        const from = points[0];
        const to = points.at(-1);
        if (!from || !to)
            return [];
        const facets = isRecord(raw.facets) ? raw.facets : {};
        return [{
                id,
                fromNodeId,
                toNodeId,
                points,
                from,
                to,
                visualState: text(facets.state) ?? "open"
            }];
    });
};
const readVehicles = (publicState) => {
    const read = (collectionId, kind) => Object.entries(objectCollection(publicState, collectionId)).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        const attributes = isRecord(raw.attributes) ? raw.attributes : {};
        const facets = isRecord(raw.facets) ? raw.facets : {};
        const availability = text(facets.availability);
        // The scene and its DOM alternative may offer only objects which the
        // public snapshot explicitly marks active. Missing or unfamiliar facet
        // values fail closed instead of becoming selectable by browser guesswork.
        if (availability !== "active")
            return [];
        return [{
                id,
                kind,
                nodeId: text(attributes.nodeId),
                ownerTeamId: text(attributes.ownerTeamId)
            }];
    });
    return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};
/**
 * Project every public cargo order without filtering by gameplay status.
 *
 * Availability, route and delivery checks belong to the authoritative
 * Mechanics plan. The browser needs only public facts for understandable
 * labels and therefore never inspects a secret deck or guesses legality.
 */
const readCargoOrders = (publicState) => Object.entries(objectCollection(publicState, "cargoOrders")).flatMap(([id, raw]) => {
    if (!isRecord(raw))
        return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const facets = isRecord(raw.facets) ? raw.facets : {};
    return [{
            id,
            fromNodeId: text(attributes.fromNodeId),
            toNodeId: text(attributes.toNodeId),
            status: text(facets.status),
            payout: finiteNumber(attributes.payout)
        }];
});
/** Read only the two IDs which the public deck projection explicitly offers. */
const readCargoOfferIds = (publicState) => {
    const decks = isRecord(publicState.decks) ? publicState.decks : {};
    const cargo = isRecord(decks.cargo) ? decks.cargo : {};
    const offer = isRecord(cargo.offer) ? cargo.offer : {};
    return [offer.firstCardId, offer.secondCardId].flatMap((value) => text(value) ?? []);
};
const readTeams = (publicState, vehicles) => {
    if (!isRecord(publicState.teams))
        return [];
    return Object.entries(publicState.teams).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        return [{
                id,
                label: text(raw.label) ?? id,
                type: text(raw.type) ?? "team",
                coins: finiteNumber(raw.coins),
                // Counts are a presentation-only aggregation over objects already
                // present in the public snapshot. They do not decide ownership or rules.
                locomotives: vehicles.filter((vehicle) => vehicle.ownerTeamId === id && vehicle.kind === "locomotive").length,
                wagons: vehicles.filter((vehicle) => vehicle.ownerTeamId === id && vehicle.kind === "wagon").length
            }];
    });
};
/**
 * Present the saved runtime order without recalculating any tie-break in UI.
 *
 * Missing labels fall back to stable ids so an incomplete mock snapshot stays
 * diagnosable, while malformed list entries are ignored rather than guessed.
 */
const readLocomotiveOrder = (publicState, nodes, teams) => {
    const session = isRecord(publicState.session) ? publicState.session : {};
    if (!Array.isArray(session.locomotiveOrder))
        return [];
    const locomotives = objectCollection(publicState, "locomotives");
    const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
    const teamLabels = new Map(teams.map((team) => [team.id, team.label]));
    return session.locomotiveOrder.flatMap((rawId) => {
        const id = text(rawId);
        if (!id)
            return [];
        const locomotive = isRecord(locomotives[id]) ? locomotives[id] : {};
        const attributes = isRecord(locomotive.attributes) ? locomotive.attributes : {};
        const ownerTeamId = text(attributes.ownerTeamId);
        const nodeId = text(attributes.nodeId);
        return [{
                id,
                ownerLabel: ownerTeamId ? teamLabels.get(ownerTeamId) ?? ownerTeamId : "команда не указана",
                nodeLabel: nodeId ? nodeLabels.get(nodeId) ?? nodeId : "станция не указана"
            }];
    });
};
const readLog = (publicState) => {
    if (!Array.isArray(publicState.log))
        return [];
    return publicState.log.flatMap((raw, index) => {
        if (!isRecord(raw))
            return [];
        const summary = text(raw.summary);
        if (!summary)
            return [];
        return [{
                id: text(raw.id) ?? `log-entry-${index}`,
                kind: text(raw.kind) ?? "event",
                summary
            }];
    });
};
const readHighlights = (board) => {
    if (!Array.isArray(board.highlights))
        return [];
    return board.highlights.flatMap((raw, index) => {
        if (!isRecord(raw))
            return [];
        const targetType = raw.targetType === "node" || raw.targetType === "edge" ? raw.targetType : null;
        const targetId = text(raw.targetId);
        if (!targetType || !targetId)
            return [];
        return [{
                id: text(raw.id) ?? `highlight-${index}`,
                targetType,
                targetId,
                actionId: text(raw.actionId),
                params: isRecord(raw.params) ? raw.params : {}
            }];
    });
};
const readActionPhases = (value) => {
    if (typeof value === "string") {
        return text(value) ? [value] : undefined;
    }
    if (!Array.isArray(value))
        return undefined;
    const phases = value.flatMap((item) => text(item) ?? []);
    return phases.length > 0 ? phases : undefined;
};
const serverUnavailableReason = (reasonCode) => {
    if (reasonCode === "role_not_allowed")
        return "Действие недоступно для роли ведущего.";
    if (reasonCode === "runtime_unsupported")
        return "Действие не поддерживается игровой системой.";
    return "Действие недоступно в текущем состоянии игры.";
};
const readActionAvailability = (value) => {
    const entries = Array.isArray(value) ? value : [];
    return new Map(entries.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.actionId !== "string")
            return [];
        return [[entry.actionId, entry]];
    }));
};
const readActions = (board, currentPhase, availability) => {
    if (!Array.isArray(board.availableActions))
        return [];
    return board.availableActions.flatMap((raw, index) => {
        if (!isRecord(raw))
            return [];
        const actionId = text(raw.actionId);
        const label = text(raw.label);
        if (!actionId || !label)
            return [];
        const projectedAvailability = availability.get(actionId);
        const serverDisabled = projectedAvailability?.status === "unavailable";
        const authoredDisabledReason = text(raw.disabledReason) ?? text(raw.reason) ?? undefined;
        const disabledReason = serverDisabled
            ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
            : raw.disabled === true ? authoredDisabledReason : undefined;
        const phases = readActionPhases(raw.phase);
        // `phase` is authored by the server-side manifest. The client only applies
        // that explicit presentation filter; it never derives phase eligibility.
        if (phases && !phases.includes(currentPhase))
            return [];
        return [{
                id: text(raw.id) ?? `board-action-${index}`,
                label,
                description: text(raw.description) ?? disabledReason,
                actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true || serverDisabled,
                disabledReason,
                section: text(raw.section) ?? undefined,
                phases
            }];
    });
};
const groupActions = (actions) => {
    const groups = new Map();
    for (const action of actions) {
        // Missing metadata stays in one neutral bucket. The client does not infer a
        // gameplay category from action ids or labels.
        const section = action.section ?? "actions";
        const group = groups.get(section) ?? [];
        group.push(action);
        groups.set(section, group);
    }
    return [...groups].map(([id, groupedActions]) => ({ id, actions: groupedActions }));
};
const readBounds = (board, nodes) => {
    if (isRecord(board.canonicalBounds)) {
        const minX = finiteNumber(board.canonicalBounds.minX);
        const minY = finiteNumber(board.canonicalBounds.minY);
        const maxX = finiteNumber(board.canonicalBounds.maxX);
        const maxY = finiteNumber(board.canonicalBounds.maxY);
        if (minX !== null && minY !== null && maxX !== null && maxY !== null && maxX > minX && maxY > minY) {
            return { minX, minY, maxX, maxY };
        }
    }
    if (nodes.length === 0)
        return null;
    const xs = nodes.map((node) => node.position.x);
    const ys = nodes.map((node) => node.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
        minX,
        minY,
        maxX: maxX === minX ? minX + 1 : maxX,
        maxY: maxY === minY ? minY + 1 : maxY
    };
};
const readDeckPresentation = (publicState, nodes) => {
    const decks = isRecord(publicState.decks) ? publicState.decks : {};
    const news = isRecord(decks.news) ? decks.news : {};
    const cargo = isRecord(decks.cargo) ? decks.cargo : {};
    const offer = isRecord(cargo.offer) ? cargo.offer : {};
    const newsCards = objectCollection(publicState, "newsCards");
    const cargoCards = objectCollection(publicState, "cargoCards");
    const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
    const newsId = text(news.currentCardId);
    const newsCard = newsId && isRecord(newsCards[newsId]) ? newsCards[newsId] : {};
    const newsAttributes = isRecord(newsCard.attributes) ? newsCard.attributes : {};
    const cargoOfferLabels = [offer.firstCardId, offer.secondCardId].flatMap((rawId) => {
        const id = text(rawId);
        if (!id || !isRecord(cargoCards[id]))
            return [];
        const attributes = isRecord(cargoCards[id].attributes) ? cargoCards[id].attributes : {};
        const fromId = text(attributes.fromNodeId);
        const toId = text(attributes.toNodeId);
        if (!fromId || !toId)
            return [id];
        return [`${nodeLabels.get(fromId) ?? fromId} → ${nodeLabels.get(toId) ?? toId}`];
    });
    return {
        currentNewsSummary: text(newsAttributes.summary),
        cargoOfferLabels
    };
};
/** Convert a player-facing session snapshot into a deterministic board view. */
function projectBoardSession(session) {
    const state = isRecord(session.state) ? session.state : {};
    const publicState = isRecord(state.public) ? state.public : {};
    const board = isRecord(publicState.board) ? publicState.board : {};
    const sessionState = isRecord(publicState.session) ? publicState.session : {};
    const constructionState = isRecord(publicState.construction) ? publicState.construction : {};
    const phase = text(sessionState.phase) ?? "unknown";
    const nodes = readNodes(publicState);
    const vehicles = readVehicles(publicState);
    const teams = readTeams(publicState, vehicles);
    const cargoOrders = readCargoOrders(publicState);
    const availableActions = readActions(board, phase, readActionAvailability(session.actionAvailability));
    const deckPresentation = readDeckPresentation(publicState, nodes);
    return {
        nodes,
        edges: readEdges(publicState, nodes),
        vehicles,
        cargoOrders,
        cargoOfferIds: readCargoOfferIds(publicState),
        teams,
        locomotiveOrder: readLocomotiveOrder(publicState, nodes, teams),
        highlights: readHighlights(board),
        availableActions,
        actionSections: groupActions(availableActions),
        log: readLog(publicState),
        bounds: readBounds(board, nodes),
        phase,
        status: text(sessionState.status) ?? "unknown",
        constructionMode: text(constructionState.mode),
        contentMode: text(sessionState.contentMode) ?? "unknown",
        ...deckPresentation,
        turnNumber: finiteNumber(sessionState.turnNumber) ?? 0
    };
}

});
__pluginDefine("src/movement-selection.ts", (exports, module) => {
"use strict";
/**
 * Temporary movement-selection helpers for the mock game-owned plugin.
 *
 * They shape map clicks into the same scalar action draft that the accessible
 * DOM form uses. They do not decide whether a locomotive may traverse a road:
 * the authoritative runtime validates ownership, adjacency, road state,
 * capacity, and action points when the facilitator submits the form.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCOMOTIVE_MOVE_ACTION_ID = void 0;
exports.selectMovementDraftVehicle = selectMovementDraftVehicle;
exports.selectMovementDraftEdge = selectMovementDraftEdge;
exports.LOCOMOTIVE_MOVE_ACTION_ID = "mock.locomotive.move";
/**
 * Select an active locomotive and clear a road chosen for another locomotive.
 *
 * A second click on the same marker cancels the local movement choice. `null`
 * values are deliberate draft tombstones: they prevent an authored default
 * from silently returning in the controlled DOM form.
 */
function selectMovementDraftVehicle(current, vehicleId) {
    const params = current?.actionId === exports.LOCOMOTIVE_MOVE_ACTION_ID
        ? { ...current.params }
        : {};
    const selectedVehicleId = typeof params.vehicleId === "string" ? params.vehicleId : null;
    if (selectedVehicleId === vehicleId) {
        params.vehicleId = null;
        params.edgeId = null;
    }
    else {
        params.vehicleId = vehicleId;
        params.edgeId = null;
    }
    return { actionId: exports.LOCOMOTIVE_MOVE_ACTION_ID, params };
}
/**
 * Add an existing road only after a locomotive has been selected.
 *
 * Returning the unchanged draft when no locomotive is selected keeps a road
 * click from inventing a partial command with ambiguous subject.
 */
function selectMovementDraftEdge(current, edgeId) {
    if (current?.actionId !== exports.LOCOMOTIVE_MOVE_ACTION_ID
        || typeof current.params.vehicleId !== "string") {
        return current;
    }
    return {
        actionId: exports.LOCOMOTIVE_MOVE_ACTION_ID,
        params: { ...current.params, edgeId }
    };
}

});
__pluginDefine("src/camera-math.ts", (exports, module) => {
"use strict";
/**
 * Pure camera calculations for the Cards Money Trains mock world.
 *
 * This is deliberately game-owned rather than platform-owned: the host only
 * supplies Phaser, while this mock plugin proves the same public camera
 * behaviour with replaceable test content. The calculations stay browser-free
 * so they can be verified without WebGL or a DOM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitCameraZoom = fitCameraZoom;
exports.clampCameraView = clampCameraView;
exports.overviewCameraView = overviewCameraView;
exports.zoomCameraViewAtPoint = zoomCameraViewAtPoint;
exports.panCameraViewBy = panCameraViewBy;
exports.resizeCameraView = resizeCameraView;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const safeDimension = (value) => Math.max(1, value);
/** Return the largest undistorted zoom that still shows the complete world. */
function fitCameraZoom(viewport, world) {
    return Math.min(safeDimension(viewport.width) / safeDimension(world.width), safeDimension(viewport.height) / safeDimension(world.height));
}
/** Match Phaser's centred-camera bounds for one axis. */
function clampScrollAxis(value, viewportSize, worldStart, worldSize, zoom) {
    const visibleSize = safeDimension(viewportSize) / zoom;
    const minScroll = worldStart + (visibleSize - safeDimension(viewportSize)) / 2;
    const maxScroll = minScroll + Math.max(0, worldSize - visibleSize);
    return clamp(value, minScroll, maxScroll);
}
/** Clamp a view to the declared world without changing its zoom. */
function clampCameraView(view, viewport, world) {
    const zoom = Math.max(Number.EPSILON, view.zoom);
    return {
        scrollX: clampScrollAxis(view.scrollX, viewport.width, world.x, world.width, zoom),
        scrollY: clampScrollAxis(view.scrollY, viewport.height, world.y, world.height, zoom),
        zoom
    };
}
/** Build the reproducible “show the whole map” view. */
function overviewCameraView(viewport, world) {
    const zoom = fitCameraZoom(viewport, world);
    return clampCameraView({
        scrollX: world.x + world.width / 2 - viewport.width / 2,
        scrollY: world.y + world.height / 2 - viewport.height / 2,
        zoom
    }, viewport, world);
}
/** Zoom around a screen point while keeping its world coordinate stable. */
function zoomCameraViewAtPoint(view, pointer, requestedZoom, viewport, world, limits) {
    const zoom = clamp(requestedZoom, limits.min, limits.max);
    const originX = viewport.width / 2;
    const originY = viewport.height / 2;
    const worldX = view.scrollX + originX + (pointer.x - originX) / view.zoom;
    const worldY = view.scrollY + originY + (pointer.y - originY) / view.zoom;
    return clampCameraView({
        scrollX: worldX - originX - (pointer.x - originX) / zoom,
        scrollY: worldY - originY - (pointer.y - originY) / zoom,
        zoom
    }, viewport, world);
}
/** Move the world with a drag gesture, expressed in screen pixels. */
function panCameraViewBy(view, screenDelta, viewport, world) {
    return clampCameraView({
        scrollX: view.scrollX - screenDelta.x / view.zoom,
        scrollY: view.scrollY - screenDelta.y / view.zoom,
        zoom: view.zoom
    }, viewport, world);
}
/** Preserve the world point at the viewport centre after a logical resize. */
function resizeCameraView(view, previousViewport, nextViewport, world) {
    const centreX = view.scrollX + previousViewport.width / 2;
    const centreY = view.scrollY + previousViewport.height / 2;
    return clampCameraView({
        scrollX: centreX - nextViewport.width / 2,
        scrollY: centreY - nextViewport.height / 2,
        zoom: view.zoom
    }, nextViewport, world);
}

});
__pluginDefine("src/construction-selection.ts", (exports, module) => {
"use strict";
/**
 * Temporary construction-selection helpers for the mock game-owned plugin.
 *
 * They only shape canvas input into an action draft. Runtime remains the sole
 * authority for whether the selected nodes, edge, and position are legal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAYPOINT_BUILD_ACTION_ID = exports.ROAD_BUILD_ACTION_ID = void 0;
exports.selectRoadDraftNode = selectRoadDraftNode;
exports.selectWaypointDraftPosition = selectWaypointDraftPosition;
exports.ROAD_BUILD_ACTION_ID = "construction.road.build";
exports.WAYPOINT_BUILD_ACTION_ID = "construction.waypoint.build";
/** Select the first/second road endpoint, then start a fresh pair. */
function selectRoadDraftNode(current, nodeId) {
    const params = current?.actionId === exports.ROAD_BUILD_ACTION_ID ? { ...current.params } : {};
    const fromNodeId = typeof params.fromNodeId === "string" ? params.fromNodeId : null;
    const toNodeId = typeof params.toNodeId === "string" ? params.toNodeId : null;
    if (!fromNodeId || toNodeId) {
        params.fromNodeId = nodeId;
        // `null` is a local tombstone: it prevents a stale authored default from
        // reappearing in the controlled DOM form while the second node is unset.
        params.toNodeId = null;
    }
    else if (fromNodeId === nodeId) {
        params.fromNodeId = null;
        params.toNodeId = null;
    }
    else {
        params.toNodeId = nodeId;
    }
    return { actionId: exports.ROAD_BUILD_ACTION_ID, params };
}
/** Select a road and a normalized point on its already projected polyline. */
function selectWaypointDraftPosition(current, edgeId, positionT) {
    const params = current?.actionId === exports.WAYPOINT_BUILD_ACTION_ID ? { ...current.params } : {};
    params.edgeId = edgeId;
    params.positionT = positionT;
    return { actionId: exports.WAYPOINT_BUILD_ACTION_ID, params };
}

});
__pluginDefine("src/registration.ts", (exports, module) => {
"use strict";
/**
 * Engine-independent registration of test-only Cards Money Trains contributions.
 *
 * The entrypoint injects the Phaser scene factory. Keeping registration
 * separate lets ordinary Node tests verify API compatibility without loading
 * the browser-only plugin facade as an executable module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = exports.CARDS_MONEY_TRAINS_GAME_ID = void 0;
exports.registerCardsMoneyTrainsPlayer = registerCardsMoneyTrainsPlayer;
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
exports.CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains-mock";
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-mock-player";
/** Register the DOM projection and the injected visual scene as one lifetime. */
function registerCardsMoneyTrainsPlayer(api, sceneFactory) {
    const disposeActions = api.registerAccessibleBoardActionsProvider?.(exports.CARDS_MONEY_TRAINS_GAME_ID, accessible_actions_ts_1.provideCardsMoneyTrainsAccessibleBoardActions) ?? (() => { });
    const disposeScene = api.registerPhaserSceneFactory(exports.CARDS_MONEY_TRAINS_GAME_ID, sceneFactory);
    return () => {
        disposeScene();
        disposeActions();
    };
}

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
