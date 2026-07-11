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
 * The plugin registers one Phaser scene factory and returns its scoped
 * disposer. Phaser remains platform-owned and is injected into the factory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCardsMoneyTrainsScene = exports.projectBoardSession = exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = exports.CARDS_MONEY_TRAINS_GAME_ID = void 0;
exports.activate = activate;
const scene_1 = __pluginRequire("src/scene.ts");
exports.CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains";
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-player";
var board_state_1 = __pluginRequire("src/board-state.ts");
Object.defineProperty(exports, "projectBoardSession", { enumerable: true, get: function () { return board_state_1.projectBoardSession; } });
var scene_2 = __pluginRequire("src/scene.ts");
Object.defineProperty(exports, "createCardsMoneyTrainsScene", { enumerable: true, get: function () { return scene_2.createCardsMoneyTrainsScene; } });
/** Register the game-owned scene and return the registration disposer. */
function activate(api) {
    return api.registerPhaserSceneFactory(exports.CARDS_MONEY_TRAINS_GAME_ID, scene_1.createCardsMoneyTrainsScene);
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
const board_state_1 = __pluginRequire("src/board-state.ts");
const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const BOARD_PADDING = 72;
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
                this.projectionReady = false;
            });
            this.cameras.main.setBackgroundColor("#f3ead8");
            this.renderProjection();
        }
        renderProjection() {
            if (!this.projectionReady)
                return;
            this.children.removeAll(true);
            const projection = (0, board_state_1.projectBoardSession)(currentSession);
            const graphics = this.add.graphics();
            graphics.fillStyle(0xf3ead8, 1);
            graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
            if (this.textures.exists("cards-money-trains-board")) {
                this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "cards-money-trains-board")
                    .setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT)
                    .setAlpha(0.82);
            }
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
            if (scene.sys?.isActive()) {
                scene.children.removeAll(true);
            }
        },
        getAccessibleActions(session) {
            return (0, board_state_1.projectBoardSession)(session).availableActions.map((action) => ({ ...action }));
        }
    };
};
exports.createCardsMoneyTrainsScene = createCardsMoneyTrainsScene;

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
const readActions = (board) => {
    if (!Array.isArray(board.availableActions))
        return [];
    return board.availableActions.flatMap((raw, index) => {
        if (!isRecord(raw))
            return [];
        const actionId = text(raw.actionId);
        const label = text(raw.label);
        if (!actionId || !label)
            return [];
        return [{
                id: text(raw.id) ?? `board-action-${index}`,
                label,
                description: text(raw.description) ?? undefined,
                actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true
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
        availableActions: readActions(board),
        bounds: readBounds(board, nodes),
        phase: text(sessionState.phase) ?? "unknown",
        turnNumber: finiteNumber(sessionState.turnNumber) ?? 0
    };
}

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
