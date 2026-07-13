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
 * Public entrypoint for the Cards Money Trains player-web plugin.
 *
 * The plugin registers an engine-independent action projection and one Phaser
 * scene factory. Phaser remains platform-owned and is injected into the scene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCardsMoneyTrainsScene = exports.provideCardsMoneyTrainsAccessibleBoardActions = exports.projectBoardSession = exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = exports.CARDS_MONEY_TRAINS_GAME_ID = void 0;
exports.activate = activate;
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const scene_ts_1 = __pluginRequire("src/scene.ts");
exports.CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains";
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-player";
var board_state_ts_1 = __pluginRequire("src/board-state.ts");
Object.defineProperty(exports, "projectBoardSession", { enumerable: true, get: function () { return board_state_ts_1.projectBoardSession; } });
var accessible_actions_ts_2 = __pluginRequire("src/accessible-actions.ts");
Object.defineProperty(exports, "provideCardsMoneyTrainsAccessibleBoardActions", { enumerable: true, get: function () { return accessible_actions_ts_2.provideCardsMoneyTrainsAccessibleBoardActions; } });
var scene_ts_2 = __pluginRequire("src/scene.ts");
Object.defineProperty(exports, "createCardsMoneyTrainsScene", { enumerable: true, get: function () { return scene_ts_2.createCardsMoneyTrainsScene; } });
/** Register both independent host controls and the Phaser scene. */
function activate(api) {
    // Feature detection preserves API 2.0 compatibility with a cached older
    // host, where the scene callback remains the deliberately limited fallback.
    const disposeActions = api.registerAccessibleBoardActionsProvider?.(exports.CARDS_MONEY_TRAINS_GAME_ID, accessible_actions_ts_1.provideCardsMoneyTrainsAccessibleBoardActions) ?? (() => { });
    const disposeScene = api.registerPhaserSceneFactory(exports.CARDS_MONEY_TRAINS_GAME_ID, scene_ts_1.createCardsMoneyTrainsScene);
    return () => {
        // Registrations are ownership-aware; reverse disposal is safe during hot
        // preview replacement and keeps both contributions scoped to this bundle.
        disposeScene();
        disposeActions();
    };
}

});
__pluginDefine("src/accessible-actions.ts", (exports, module) => {
"use strict";
/**
 * Accessible action projection for the Cards Money Trains board.
 *
 * The provider is intentionally independent from Phaser. It copies actions
 * already published in the authoritative session so the host can expose its
 * ordinary keyboard controls before or without creating the visual scene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCardsMoneyTrainsAccessibleBoardActions = void 0;
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (action) => ({
    id: action.id,
    label: action.label,
    actionId: action.actionId,
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.params === undefined ? {} : { params: { ...action.params } }),
    ...(action.disabled === undefined ? {} : { disabled: action.disabled })
});
/**
 * Return only actions present in the authoritative player-facing snapshot.
 * The plugin does not derive topology or gameplay permission in the browser.
 */
const provideCardsMoneyTrainsAccessibleBoardActions = (session) => (0, board_state_ts_1.projectBoardSession)(session).availableActions.map(toAccessibleAction);
exports.provideCardsMoneyTrainsAccessibleBoardActions = provideCardsMoneyTrainsAccessibleBoardActions;

});
__pluginDefine("src/board-state.ts", (exports, module) => {
"use strict";
/**
 * Public-snapshot projection for the Cards Money Trains Phaser scene.
 *
 * This module deliberately contains no gameplay validation. Runtime provides
 * authoritative nodes, edges, highlights, controls and canonical action
 * availability; the plugin only combines those public values into a safe view.
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
        const from = point(geometry.from) ?? byId.get(fromNodeId)?.position ?? null;
        const to = point(geometry.to) ?? byId.get(toNodeId)?.position ?? null;
        if (!from || !to)
            return [];
        const facets = isRecord(raw.facets) ? raw.facets : {};
        return [{
                id,
                fromNodeId,
                toNodeId,
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
        return [{
                id,
                kind,
                nodeId: text(attributes.nodeId),
                ownerTeamId: text(attributes.ownerTeamId)
            }];
    });
    return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};
const readTeams = (publicState) => {
    if (!isRecord(publicState.teams))
        return [];
    return Object.entries(publicState.teams).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        return [{
                id,
                label: text(raw.label) ?? id,
                type: text(raw.type) ?? "team",
                coins: finiteNumber(raw.coins)
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
const serverUnavailableReason = (reasonCode) => {
    if (reasonCode === "role_not_allowed")
        return "Действие недоступно для текущей роли.";
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
const readActions = (board, availability) => {
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
        return [{
                id: text(raw.id) ?? `board-action-${index}`,
                label,
                description: serverDisabled
                    ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
                    : text(raw.description) ?? undefined,
                actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true || serverDisabled
            }];
    });
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
/** Convert a player-facing session snapshot into a deterministic board view. */
function projectBoardSession(session) {
    const state = isRecord(session.state) ? session.state : {};
    const publicState = isRecord(state.public) ? state.public : {};
    const board = isRecord(publicState.board) ? publicState.board : {};
    const sessionState = isRecord(publicState.session) ? publicState.session : {};
    const nodes = readNodes(publicState);
    return {
        nodes,
        edges: readEdges(publicState, nodes),
        vehicles: readVehicles(publicState),
        teams: readTeams(publicState),
        highlights: readHighlights(board),
        availableActions: readActions(board, readActionAvailability(session.actionAvailability)),
        bounds: readBounds(board, nodes),
        phase: text(sessionState.phase) ?? "unknown",
        turnNumber: finiteNumber(sessionState.turnNumber) ?? 0
    };
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
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const camera_math_ts_1 = __pluginRequire("src/camera-math.ts");
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
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
    let lastError = null;
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
            // A drag starts only on empty world space. Interactive nodes and road
            // zones keep their existing click behavior and are never stolen by pan.
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
        renderProjection() {
            if (!this.projectionReady)
                return;
            this.children.removeAll(true);
            const projection = (0, board_state_ts_1.projectBoardSession)(currentSession);
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
                this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "Ожидаются авторские узлы, координаты и начальная сеть", { color: "#24343d", fontFamily: "sans-serif", fontSize: "28px", align: "center" })
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
        coordinateMapper(projection) {
            const bounds = projection.bounds;
            if (!bounds)
                return (_point) => ({ x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
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
            for (const edge of projection.edges) {
                const from = toScreen(edge.from);
                const to = toScreen(edge.to);
                const highlight = edgeHighlights.get(edge.id);
                graphics.lineStyle(highlight ? 10 : 6, edgeColor(edge), 0.95);
                graphics.lineBetween(from.x, from.y, to.x, to.y);
                if (highlight?.actionId) {
                    const hitArea = this.add.zone((from.x + to.x) / 2, (from.y + to.y) / 2, Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y), 28);
                    hitArea.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
                    hitArea.setInteractive({ useHandCursor: true });
                    hitArea.on("pointerdown", () => this.dispatchHighlight(highlight));
                }
            }
        }
        drawNodes(graphics, projection, toScreen) {
            const highlights = new Map(projection.highlights
                .filter((item) => item.targetType === "node")
                .map((item) => [item.targetId, item]));
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
        dispatchHighlight(highlight) {
            if (!highlight.actionId)
                return;
            void context.dispatchAction(highlight.actionId, { ...highlight.params })
                .then(() => { lastError = null; })
                .catch((error) => {
                // The scene never applies an optimistic topology mutation. Runtime
                // refusal leaves the current snapshot in place and only adds feedback.
                lastError = errorText(error);
                this.renderProjection();
            });
        }
        drawVehicles(projection, toScreen) {
            const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
            const offsets = new Map();
            for (const vehicle of projection.vehicles) {
                if (!vehicle.nodeId)
                    continue;
                const node = nodes.get(vehicle.nodeId);
                if (!node)
                    continue;
                const position = toScreen(node.position);
                const offset = offsets.get(vehicle.nodeId) ?? 0;
                offsets.set(vehicle.nodeId, offset + 1);
                this.add.text(position.x - 20 + offset * 20, position.y + 22, vehicle.kind === "locomotive" ? "◆" : "■", {
                    color: vehicle.kind === "locomotive" ? "#273f8f" : "#8f5a27",
                    fontFamily: "sans-serif",
                    fontSize: "20px"
                });
            }
        }
        drawTeamSummary(projection) {
            if (projection.teams.length === 0)
                return;
            const lines = projection.teams.map((team) => `${team.label}: ${team.coins === null ? "—" : team.coins} мон.`);
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
        getAccessibleActions: accessible_actions_ts_1.provideCardsMoneyTrainsAccessibleBoardActions
    };
};
exports.createCardsMoneyTrainsScene = createCardsMoneyTrainsScene;

});
__pluginDefine("src/camera-math.ts", (exports, module) => {
"use strict";
/**
 * Pure camera calculations for the Cards Money Trains world.
 *
 * Phaser owns rendering and input, while this module owns deterministic
 * geometry only. Keeping the calculations browser-free makes pointer-centred
 * zoom, bounded panning, overview reset, and resize preservation cheap to
 * verify without starting WebGL or a DOM.
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
/**
 * Match Phaser's centred-camera bounds for one axis.
 *
 * Phaser zooms around the viewport centre, so `scrollX = 0` is only the
 * world's left edge at zoom 1. The offset below is what prevents blank space
 * from appearing at other zoom levels when `Camera.setBounds` is also active.
 */
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
/**
 * Zoom around a screen point while keeping the same world point underneath it.
 */
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
/**
 * Preserve the world point at the viewport centre after a logical resize.
 */
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
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
