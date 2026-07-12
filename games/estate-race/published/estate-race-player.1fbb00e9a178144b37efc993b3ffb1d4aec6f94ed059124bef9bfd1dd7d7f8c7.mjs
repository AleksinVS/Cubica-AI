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
 * Public entrypoint for the Estate Race player-web field.
 *
 * The platform injects Phaser and owns its lifecycle. This game-local module
 * registers only a renderer/input adapter and never mutates balances, turns or
 * ownership optimistically.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEstateRaceScene = exports.projectEstateRaceSession = exports.ESTATE_RACE_PLAYER_PLUGIN_ID = exports.ESTATE_RACE_GAME_ID = void 0;
exports.activate = activate;
const scene_1 = __pluginRequire("src/scene.ts");
exports.ESTATE_RACE_GAME_ID = "estate-race";
exports.ESTATE_RACE_PLAYER_PLUGIN_ID = "estate-race-player";
var board_state_1 = __pluginRequire("src/board-state.ts");
Object.defineProperty(exports, "projectEstateRaceSession", { enumerable: true, get: function () { return board_state_1.projectEstateRaceSession; } });
var scene_2 = __pluginRequire("src/scene.ts");
Object.defineProperty(exports, "createEstateRaceScene", { enumerable: true, get: function () { return scene_2.createEstateRaceScene; } });
/** Register this game's scene and return its narrowly scoped disposer. */
function activate(api) {
    return api.registerPhaserSceneFactory(exports.ESTATE_RACE_GAME_ID, scene_1.createEstateRaceScene);
}

});
__pluginDefine("src/scene.ts", (exports, module) => {
"use strict";
/**
 * Phaser renderer for the Estate Race public field.
 *
 * The scene paints the authoritative snapshot and forwards only actions that
 * Runtime API already exposed. Balance, rent, movement and ownership rules are
 * intentionally absent from this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEstateRaceScene = void 0;
const board_state_1 = __pluginRequire("src/board-state.ts");
const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const PLAYER_COLORS = [0x245f52, 0xb56f3c];
const phaseLabel = {
    roll: "бросок",
    acquire: "покупка",
    rent: "рента",
    finish: "завершение"
};
const errorText = (error) => error instanceof Error ? error.message : "Действие отклонено сервером";
/** Build a scene solely from platform-injected Phaser. */
const createEstateRaceScene = (context) => {
    const Phaser = context.Phaser;
    let currentSession = context.session;
    let previousProjection = null;
    let lastError = null;
    class EstateRaceScene extends Phaser.Scene {
        projectionReady = false;
        constructor() {
            super({ key: `estate-race:${context.sceneId}` });
        }
        create() {
            this.projectionReady = true;
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                this.projectionReady = false;
            });
            this.cameras.main.setBackgroundColor("#13211f");
            this.renderProjection(true);
        }
        renderProjection(initial = false) {
            if (!this.projectionReady)
                return;
            const projection = (0, board_state_1.projectEstateRaceSession)(currentSession);
            this.children.removeAll(true);
            const graphics = this.add.graphics();
            graphics.fillStyle(0x13211f, 1);
            graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
            graphics.lineStyle(2, 0x42635d, 0.55);
            for (let x = 24; x < DESIGN_WIDTH; x += 36)
                graphics.lineBetween(x, 0, x, DESIGN_HEIGHT);
            for (let y = 24; y < DESIGN_HEIGHT; y += 36)
                graphics.lineBetween(0, y, DESIGN_WIDTH, y);
            this.drawCentre(projection);
            for (const cell of projection.cells)
                this.drawCell(graphics, cell, projection, initial);
            this.drawPlayers(projection, initial);
            this.drawStatus(projection);
            if (lastError) {
                this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 22, lastError, {
                    color: "#fff7e8",
                    backgroundColor: "#8d3d36",
                    padding: { x: 16, y: 9 },
                    fontFamily: "Georgia, serif",
                    fontSize: "20px"
                }).setOrigin(0.5, 1);
            }
            previousProjection = projection;
        }
        drawCentre(projection) {
            const plaque = this.add.rectangle(680, 475, 690, 380, 0xe8dfca, 1)
                .setStrokeStyle(5, 0xb56f3c, 0.75);
            if (!previousProjection) {
                plaque.setAlpha(0);
                this.tweens.add({ targets: plaque, alpha: 1, duration: 420, ease: "Cubic.Out" });
            }
            this.add.text(680, 370, "ESTATE RACE", {
                color: "#173a34",
                fontFamily: "Georgia, serif",
                fontSize: "54px",
                fontStyle: "bold",
                letterSpacing: 5
            }).setOrigin(0.5);
            this.add.text(680, 425, `Ход ${projection.turnNumber} · ${phaseLabel[projection.phase] ?? projection.phase}`, {
                color: "#495c55",
                fontFamily: "Arial, sans-serif",
                fontSize: "22px"
            }).setOrigin(0.5);
            if (projection.lastRoll) {
                const dice = projection.lastRoll.values.map((value) => `[ ${value} ]`).join("   ");
                this.add.text(680, 485, `${dice}\nсумма ${projection.lastRoll.total}`, {
                    color: "#173a34",
                    align: "center",
                    fontFamily: "Georgia, serif",
                    fontSize: "30px",
                    lineSpacing: 8
                }).setOrigin(0.5);
            }
            else {
                this.add.text(680, 485, "Кости ждут первого броска", {
                    color: "#66746d",
                    fontFamily: "Georgia, serif",
                    fontSize: "24px"
                }).setOrigin(0.5);
            }
            const action = projection.availableActions.find((item) => !item.disabled);
            if (action)
                this.drawPrimaryAction(action);
        }
        drawPrimaryAction(action) {
            const button = this.add.rectangle(680, 595, 360, 68, 0x245f52, 1)
                .setStrokeStyle(2, 0xf4e8cf, 0.65)
                .setInteractive({ useHandCursor: true });
            this.add.text(680, 595, action.label, {
                color: "#fff9e9",
                fontFamily: "Arial, sans-serif",
                fontSize: "23px",
                fontStyle: "bold"
            }).setOrigin(0.5);
            button.on("pointerover", () => button.setFillStyle(0x327565, 1));
            button.on("pointerout", () => button.setFillStyle(0x245f52, 1));
            button.on("pointerdown", () => this.dispatchAction(action));
        }
        drawCell(graphics, cell, projection, initial) {
            const estate = cell.kind === "estate";
            const fill = estate ? 0xf2e5ca : cell.kind === "start" ? 0xb9d2c2 : 0xded7c5;
            graphics.fillStyle(fill, 1);
            graphics.lineStyle(estate ? 4 : 2, estate ? 0xb56f3c : 0x6f8178, 0.95);
            graphics.fillRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
            graphics.strokeRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
            this.add.text(cell.x, cell.y - 30, cell.shortLabel, {
                color: "#183a34",
                align: "center",
                fontFamily: "Georgia, serif",
                fontSize: estate ? "22px" : "19px",
                fontStyle: estate ? "bold" : "normal",
                wordWrap: { width: cell.width - 24 }
            }).setOrigin(0.5);
            const detail = estate ? `${cell.price} · рента ${cell.rent}` : `клетка ${cell.index}`;
            this.add.text(cell.x, cell.y + 20, detail, {
                color: "#65716c",
                fontFamily: "Arial, sans-serif",
                fontSize: "15px"
            }).setOrigin(0.5);
            if (cell.ownerPlayerId) {
                const ownerIndex = projection.players.findIndex((player) => player.id === cell.ownerPlayerId);
                const ribbon = this.add.rectangle(cell.x, cell.y + cell.height / 2 - 12, cell.width - 22, 18, PLAYER_COLORS[Math.max(0, ownerIndex)] ?? PLAYER_COLORS[0], 1);
                const previousOwner = previousProjection?.cells.find((item) => item.id === cell.id)?.ownerPlayerId;
                if (!initial && previousOwner !== cell.ownerPlayerId) {
                    ribbon.setAlpha(0);
                    this.tweens.add({ targets: ribbon, alpha: 1, duration: 360, ease: "Sine.Out" });
                }
            }
            const cellAction = projection.availableActions.find((action) => action.params?.cellId === cell.id);
            if (cellAction && !cellAction.disabled) {
                const hit = this.add.zone(cell.x, cell.y, cell.width, cell.height)
                    .setInteractive({ useHandCursor: true });
                hit.on("pointerdown", () => this.dispatchAction(cellAction));
            }
        }
        drawPlayers(projection, initial) {
            projection.players.forEach((player, index) => {
                const cell = projection.cells.find((item) => item.index === player.position);
                if (!cell)
                    return;
                const token = this.add.circle(cell.x - 30 + index * 60, cell.y + cell.height / 2 - 32, player.active ? 17 : 14, PLAYER_COLORS[index] ?? PLAYER_COLORS[0], 1).setStrokeStyle(4, 0xfff7e4, 1);
                const previousPlayer = previousProjection?.players.find((item) => item.id === player.id);
                const previousCell = previousProjection?.cells.find((item) => item.index === previousPlayer?.position);
                if (!initial && previousPlayer && previousCell && previousPlayer.position !== player.position) {
                    token.setPosition(previousCell.x - 30 + index * 60, previousCell.y + previousCell.height / 2 - 32);
                    const stepCount = (player.position - previousPlayer.position + projection.cells.length) % projection.cells.length;
                    const track = Array.from({ length: stepCount }, (_, step) => projection.cells.find((item) => item.index === (previousPlayer.position + step + 1) % projection.cells.length)).filter((item) => item !== undefined);
                    this.tweens.add({
                        targets: token,
                        // Tweening through every crossed cell keeps the token on the
                        // cyclic track instead of cutting diagonally across the board.
                        x: track.map((item) => item.x - 30 + index * 60),
                        y: track.map((item) => item.y + item.height / 2 - 32),
                        duration: Math.max(360, track.length * 130),
                        interpolation: "linear",
                        ease: "Cubic.InOut"
                    });
                }
            });
        }
        drawStatus(projection) {
            projection.players.forEach((player, index) => {
                const x = index === 0 ? 420 : 940;
                this.add.text(x, 975, `${player.label}${player.active ? " · ходит" : ""}   ${player.cash} монет`, {
                    color: player.active ? "#fff4d8" : "#b9c7c2",
                    fontFamily: "Arial, sans-serif",
                    fontSize: player.active ? "22px" : "19px",
                    fontStyle: player.active ? "bold" : "normal"
                }).setOrigin(0.5, 1);
            });
        }
        dispatchAction(action) {
            if (action.disabled)
                return;
            void context.dispatchAction(action.actionId, { ...(action.params ?? {}) })
                .then(() => { lastError = null; })
                .catch((error) => {
                // Runtime refusal must not mutate the board; only transient feedback
                // is rendered over the last confirmed snapshot.
                lastError = errorText(error);
                this.renderProjection();
            });
        }
    }
    const scene = new EstateRaceScene();
    return {
        scene,
        updateSession(session) {
            currentSession = session;
            lastError = null;
            scene.renderProjection();
        },
        destroy() {
            lastError = null;
            previousProjection = null;
            if (scene.sys?.isActive())
                scene.children.removeAll(true);
        },
        getAccessibleActions(session) {
            return (0, board_state_1.projectEstateRaceSession)(session).availableActions.map((action) => ({ ...action }));
        }
    };
};
exports.createEstateRaceScene = createEstateRaceScene;

});
__pluginDefine("src/board-state.ts", (exports, module) => {
"use strict";
/**
 * Safe public-snapshot projection for the Estate Race field.
 *
 * Projection means a read-only view prepared for drawing. The functions below
 * deliberately do not decide whether buying, paying or finishing is legal:
 * Runtime API publishes the current `availableActions`, and the plugin merely
 * displays and dispatches those declarations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectEstateRaceSession = projectEstateRaceSession;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value, fallback) => typeof value === "string" && value.trim().length > 0 ? value : fallback;
const readCells = (publicState) => {
    const objects = isRecord(publicState.objects) ? publicState.objects : {};
    const cells = isRecord(objects.boardCells) ? objects.boardCells : {};
    return Object.entries(cells).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        const attributes = isRecord(raw.attributes) ? raw.attributes : {};
        const kind = attributes.kind === "start" || attributes.kind === "estate" || attributes.kind === "landmark"
            ? attributes.kind
            : "landmark";
        return [{
                id,
                index: finiteNumber(attributes.index),
                label: text(attributes.label, id),
                shortLabel: text(attributes.shortLabel, text(attributes.label, id)),
                kind,
                x: finiteNumber(attributes.x),
                y: finiteNumber(attributes.y),
                width: finiteNumber(attributes.width, 220),
                height: finiteNumber(attributes.height, 140),
                price: typeof attributes.price === "number" ? attributes.price : null,
                rent: typeof attributes.rent === "number" ? attributes.rent : null,
                ownerPlayerId: typeof attributes.ownerPlayerId === "string" ? attributes.ownerPlayerId : null
            }];
    }).sort((left, right) => left.index - right.index);
};
const readPlayers = (state, activePlayerId) => {
    const players = isRecord(state.players) ? state.players : {};
    return Object.entries(players).flatMap(([id, raw], index) => {
        if (!isRecord(raw))
            return [];
        const metrics = isRecord(raw.metrics) ? raw.metrics : {};
        return [{
                id,
                label: `Игрок ${index + 1}`,
                cash: finiteNumber(metrics.cash),
                position: finiteNumber(metrics.position),
                active: id === activePlayerId
            }];
    });
};
const readActions = (board) => {
    if (!Array.isArray(board.availableActions))
        return [];
    return board.availableActions.flatMap((raw, index) => {
        if (!isRecord(raw) || typeof raw.actionId !== "string" || typeof raw.label !== "string")
            return [];
        return [{
                id: text(raw.id, `action-${index}`),
                label: raw.label,
                description: typeof raw.description === "string" ? raw.description : undefined,
                actionId: raw.actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true
            }];
    });
};
const readRoll = (board) => {
    if (!isRecord(board.lastRoll) || !Array.isArray(board.lastRoll.values))
        return null;
    const values = board.lastRoll.values.filter((value) => typeof value === "number" && Number.isSafeInteger(value));
    const total = finiteNumber(board.lastRoll.total, values.reduce((sum, value) => sum + value, 0));
    return { values, total, isDouble: board.lastRoll.isDouble === true };
};
/** Convert a player-facing session snapshot to deterministic drawing data. */
function projectEstateRaceSession(session) {
    const state = isRecord(session.state) ? session.state : {};
    const publicState = isRecord(state.public) ? state.public : {};
    const board = isRecord(publicState.board) ? publicState.board : {};
    const turn = isRecord(publicState.turn) ? publicState.turn : {};
    const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : null;
    return {
        cells: readCells(publicState),
        players: readPlayers(state, activePlayerId),
        availableActions: readActions(board),
        activePlayerId,
        phase: text(turn.phase, "setup"),
        turnNumber: finiteNumber(turn.turnNumber),
        lastRoll: readRoll(board)
    };
}

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
