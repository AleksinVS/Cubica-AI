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
exports.createEstateRaceScene = exports.provideEstateRaceAccessibleBoardActions = exports.projectEstateRaceSession = exports.ESTATE_RACE_PLAYER_PLUGIN_ID = exports.ESTATE_RACE_GAME_ID = void 0;
exports.activate = activate;
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const scene_ts_1 = __pluginRequire("src/scene.ts");
exports.ESTATE_RACE_GAME_ID = "estate-race";
exports.ESTATE_RACE_PLAYER_PLUGIN_ID = "estate-race-player";
var board_state_ts_1 = __pluginRequire("src/board-state.ts");
Object.defineProperty(exports, "projectEstateRaceSession", { enumerable: true, get: function () { return board_state_ts_1.projectEstateRaceSession; } });
var accessible_actions_ts_2 = __pluginRequire("src/accessible-actions.ts");
Object.defineProperty(exports, "provideEstateRaceAccessibleBoardActions", { enumerable: true, get: function () { return accessible_actions_ts_2.provideEstateRaceAccessibleBoardActions; } });
var scene_ts_2 = __pluginRequire("src/scene.ts");
Object.defineProperty(exports, "createEstateRaceScene", { enumerable: true, get: function () { return scene_ts_2.createEstateRaceScene; } });
/** Register both independent host controls and the Phaser scene. */
function activate(api) {
    // Optional chaining keeps a newly published API 2.0 bundle loadable by an
    // older API 2.0 host. Such a host falls back to the deprecated scene callback.
    const disposeActions = api.registerAccessibleBoardActionsProvider?.(exports.ESTATE_RACE_GAME_ID, accessible_actions_ts_1.provideEstateRaceAccessibleBoardActions) ?? (() => { });
    const disposeScene = api.registerPhaserSceneFactory(exports.ESTATE_RACE_GAME_ID, scene_ts_1.createEstateRaceScene);
    return () => {
        // Dispose in reverse registration order so neither contribution from an
        // older preview bundle can remove a newer bundle's registration.
        disposeScene();
        disposeActions();
    };
}

});
__pluginDefine("src/accessible-actions.ts", (exports, module) => {
"use strict";
/**
 * Accessible action projection for the Estate Race board.
 *
 * This provider deliberately reads the same server-owned public projection as
 * the Phaser scene. Keeping it independent from scene construction lets the
 * host render keyboard controls even when the visual engine is unavailable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideEstateRaceAccessibleBoardActions = exports.isStructurallyValidEstateAuctionBid = exports.ESTATE_AUCTION_BID_MAX = void 0;
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
exports.ESTATE_AUCTION_BID_MAX = Number.MAX_SAFE_INTEGER;
/** Structural input guard only; server rules decide whether a bid is legal. */
const isStructurallyValidEstateAuctionBid = (value) => typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= exports.ESTATE_AUCTION_BID_MAX;
exports.isStructurallyValidEstateAuctionBid = isStructurallyValidEstateAuctionBid;
const auctionBidFields = [{
        name: "amount",
        label: "Сумма ставки",
        kind: "number",
        required: true,
        min: 0,
        max: exports.ESTATE_AUCTION_BID_MAX,
        step: 1
    }];
const buildingUnitKindFields = [{
        name: "unitKind",
        label: "Тип строения",
        kind: "select",
        required: true,
        options: [
            { value: "house", label: "Дом" },
            { value: "hotel", label: "Отель" }
        ]
    }];
const buildingRequestFields = [{
        name: "cellId",
        label: "Идентификатор участка",
        kind: "text",
        required: true,
        minLength: 1,
        maxLength: 128
    }];
const tradeTargetFields = [{
        name: "targetPlayerId",
        label: "Участник сделки",
        kind: "text",
        required: true,
        minLength: 1,
        maxLength: 128
    }];
const tradeCashFields = [
    { name: "offeredCash", label: "Предлагаемые деньги", kind: "number", required: true, min: 0, max: exports.ESTATE_AUCTION_BID_MAX, step: 1 },
    { name: "requestedCash", label: "Запрашиваемые деньги", kind: "number", required: true, min: 0, max: exports.ESTATE_AUCTION_BID_MAX, step: 1 }
];
const tradeAssetFields = [
    { name: "cellId", label: "Идентификатор объекта", kind: "text", required: true, minLength: 1, maxLength: 128 },
    { name: "side", label: "Сторона сделки", kind: "text", required: true, minLength: 1, maxLength: 16 }
];
const tradeCellFields = [{
        name: "cellId",
        label: "Идентификатор объекта",
        kind: "text",
        required: true,
        minLength: 1,
        maxLength: 128
    }];
const tradeCardFields = [{
        name: "cardId",
        label: "Идентификатор карты",
        kind: "text",
        required: true,
        minLength: 1,
        maxLength: 128
    }];
const bankruptcyCardFields = [
    { name: "heldCardId", label: "Первая удерживаемая карта", kind: "text", required: false, defaultValue: "", maxLength: 32 },
    { name: "heldCardId2", label: "Вторая удерживаемая карта", kind: "text", required: false, defaultValue: "", maxLength: 32 }
];
const parameterFormFields = {
    "property.auction.bid": auctionBidFields,
    "property.build": buildingUnitKindFields,
    "property.build.request": buildingRequestFields,
    "property.build.auction.bid": auctionBidFields,
    "property.sell": buildingRequestFields,
    "property.mortgage": buildingRequestFields,
    "property.redeem": buildingRequestFields,
    "trade.open": tradeTargetFields,
    "trade.cash.set": tradeCashFields,
    "trade.asset.set": tradeAssetFields,
    "trade.asset.remove": tradeCellFields,
    "trade.card.offer": tradeCardFields,
    "trade.card.request": tradeCardFields,
    "bankruptcy.declare": bankruptcyCardFields
};
/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (action) => ({
    id: action.id,
    label: action.label,
    actionId: action.actionId,
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(parameterFormFields[action.actionId] === undefined && action.params !== undefined
        ? { params: { ...action.params } }
        : {}),
    ...(parameterFormFields[action.actionId] === undefined
        ? {}
        : { fields: parameterFormFields[action.actionId] }),
    ...(action.disabled === undefined ? {} : { disabled: action.disabled })
});
/**
 * Return only actions present in the authoritative player-facing snapshot.
 * No legality, price, phase, or turn rule is inferred in the browser.
 */
const provideEstateRaceAccessibleBoardActions = (session) => (0, board_state_ts_1.projectEstateRaceSession)(session).availableActions.map(toAccessibleAction);
exports.provideEstateRaceAccessibleBoardActions = provideEstateRaceAccessibleBoardActions;

});
__pluginDefine("src/board-state.ts", (exports, module) => {
"use strict";
/**
 * Safe public-snapshot projection for the Estate Race field.
 *
 * Projection means a read-only view prepared for drawing. The functions below
 * deliberately do not decide whether buying, paying or finishing is legal.
 * Runtime API publishes both board controls and canonical action availability;
 * the plugin only combines and displays those server-owned declarations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.traceEstateTokenPath = traceEstateTokenPath;
exports.projectEstateRaceSession = projectEstateRaceSession;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value, fallback) => typeof value === "string" && value.trim().length > 0 ? value : fallback;
const optionalText = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
const readOutcome = (publicState, state, phase) => {
    const outcome = isRecord(publicState.outcome) ? publicState.outcome : null;
    if (outcome?.status === "active")
        return { status: "active", winnerPlayerId: null, reason: "none" };
    const winnerPlayerId = optionalText(outcome?.winnerPlayerId);
    const rawPlayers = isRecord(state.players) ? state.players : {};
    const activePlayerIds = Object.entries(rawPlayers).flatMap(([playerId, rawPlayer]) => isRecord(rawPlayer) && rawPlayer.status === "active" ? [playerId] : []);
    if (phase === "terminal"
        && outcome?.status === "terminal"
        && outcome.reason === "last-active-player"
        && winnerPlayerId !== null
        && activePlayerIds.length === 1
        && activePlayerIds[0] === winnerPlayerId) {
        return {
            status: "terminal",
            winnerPlayerId,
            reason: outcome.reason
        };
    }
    // Malformed terminal data must not become a client-side result or winner.
    return { status: "active", winnerPlayerId: null, reason: "none" };
};
const improvementTier = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 5 ? value : 0;
const bankCount = (value, maximum) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : 0;
const readCells = (publicState) => {
    const objects = isRecord(publicState.objects) ? publicState.objects : {};
    const cells = isRecord(objects.boardCells) ? objects.boardCells : {};
    return Object.entries(cells).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        const attributes = isRecord(raw.attributes) ? raw.attributes : {};
        const supportedKinds = new Set([
            "start", "estate", "transit", "utility", "event", "fund", "tax", "neutral", "jail", "go-to-jail"
        ]);
        const kind = typeof attributes.kind === "string" && supportedKinds.has(attributes.kind)
            ? attributes.kind
            : "neutral";
        return [{
                id,
                index: finiteNumber(attributes.index),
                label: text(attributes.label, id),
                shortLabel: text(attributes.shortLabel, text(attributes.label, id)),
                kind,
                group: typeof attributes.group === "string" ? attributes.group : null,
                x: finiteNumber(attributes.x),
                y: finiteNumber(attributes.y),
                width: finiteNumber(attributes.width, 220),
                height: finiteNumber(attributes.height, 140),
                price: typeof attributes.price === "number" ? attributes.price : null,
                rent: typeof attributes.rent === "number" ? attributes.rent : null,
                rentScale: Array.isArray(attributes.rentScale)
                    ? attributes.rentScale.filter((value) => typeof value === "number" && Number.isFinite(value))
                    : [],
                improvementTier: improvementTier(attributes.improvementTier),
                mortgaged: attributes.mortgaged === true,
                tradeSide: optionalText(attributes.tradeSide),
                liquidationPending: attributes.liquidationPending === true,
                taxAmount: typeof attributes.taxAmount === "number" ? attributes.taxAmount : null,
                ownerPlayerId: typeof attributes.ownerPlayerId === "string" ? attributes.ownerPlayerId : null
            }];
    }).sort((left, right) => left.index - right.index);
};
const readPlayers = (state, activePlayerId, actorPlayerId) => {
    const players = isRecord(state.players) ? state.players : {};
    return Object.entries(players).flatMap(([id, raw], index) => {
        if (!isRecord(raw))
            return [];
        const metrics = isRecord(raw.metrics) ? raw.metrics : {};
        const objects = isRecord(raw.objects) ? raw.objects : {};
        const flags = isRecord(raw.flags) ? raw.flags : {};
        const canReadPrivate = actorPlayerId === id;
        return [{
                id,
                label: `Игрок ${index + 1}`,
                cash: finiteNumber(metrics.cash),
                position: finiteNumber(metrics.position),
                active: id === activePlayerId,
                inJail: isRecord(raw.flags) && raw.flags.inJail === true,
                jailAttempts: finiteNumber(metrics.jailAttempts),
                heldExitCardId: canReadPrivate ? optionalText(objects.heldExitCardId) : null,
                heldExitCardId2: canReadPrivate ? optionalText(objects.heldExitCardId2) : null,
                bidderStatus: optionalText(objects.bidderStatus) ?? optionalText(flags.bidderStatus),
                buildingRequestCellId: optionalText(objects.buildingRequestCellId),
                buildingRequestUnitKind: optionalText(objects.buildingRequestUnitKind)
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
        if (!isRecord(raw) || typeof raw.actionId !== "string" || typeof raw.label !== "string")
            return [];
        const projectedAvailability = availability.get(raw.actionId);
        const serverDisabled = projectedAvailability?.status === "unavailable";
        const authoredDisabledReason = typeof raw.disabledReason === "string"
            ? raw.disabledReason
            : typeof raw.reason === "string" ? raw.reason : undefined;
        return [{
                id: text(raw.id, `action-${index}`),
                label: raw.label,
                description: serverDisabled
                    ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
                    : typeof raw.description === "string" ? raw.description : undefined,
                actionId: raw.actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true || serverDisabled
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
const readAuction = (publicState) => {
    const auction = isRecord(publicState.auction) ? publicState.auction : {};
    return {
        resumePlayerId: optionalText(auction.resumePlayerId),
        cellId: optionalText(auction.cellId),
        currentBid: finiteNumber(auction.currentBid),
        minimumIncrement: finiteNumber(auction.minimumIncrement),
        // Do not derive a minimum from currentBid/minimumIncrement. The runtime
        // remains the only authority for a next-bid threshold.
        minimumNextBid: typeof auction.minimumNextBid === "number" && Number.isFinite(auction.minimumNextBid)
            ? auction.minimumNextBid
            : null,
        leaderPlayerId: optionalText(auction.leaderPlayerId)
    };
};
const readBuildingBank = (publicState) => {
    const bank = isRecord(publicState.bankBuildings) ? publicState.bankBuildings : {};
    return {
        housesAvailable: bankCount(bank.housesAvailable, 32),
        hotelsAvailable: bankCount(bank.hotelsAvailable, 12)
    };
};
const readBuildingWindow = (publicState) => {
    const window = isRecord(publicState.buildingWindow) ? publicState.buildingWindow : {};
    return {
        resumePlayerId: optionalText(window.resumePlayerId),
        unitKind: optionalText(window.unitKind)
    };
};
const readTrade = (publicState) => {
    const trade = isRecord(publicState.trade) ? publicState.trade : {};
    return {
        status: text(trade.status, "idle"),
        proposerPlayerId: optionalText(trade.proposerPlayerId),
        targetPlayerId: optionalText(trade.targetPlayerId),
        resumePlayerId: optionalText(trade.resumePlayerId),
        offeredCash: finiteNumber(trade.offeredCash),
        requestedCash: finiteNumber(trade.requestedCash),
        offeredCardId: optionalText(trade.offeredCardId),
        requestedCardId: optionalText(trade.requestedCardId),
        claimCardId: optionalText(trade.claimCardId),
        claimPlayerId: optionalText(trade.claimPlayerId)
    };
};
const readObligation = (publicState) => {
    const obligation = isRecord(publicState.obligation) ? publicState.obligation : {};
    return {
        status: text(obligation.status, "idle"),
        debtorPlayerId: optionalText(obligation.debtorPlayerId),
        creditorKind: optionalText(obligation.creditorKind),
        creditorPlayerId: optionalText(obligation.creditorPlayerId),
        amount: finiteNumber(obligation.amount),
        perPartyAmount: finiteNumber(obligation.perPartyAmount),
        reason: optionalText(obligation.reason),
        resumePlayerId: optionalText(obligation.resumePlayerId)
    };
};
const readLiquidation = (publicState) => {
    const liquidation = isRecord(publicState.liquidation) ? publicState.liquidation : {};
    return {
        status: text(liquidation.status, "idle"),
        resumePlayerId: optionalText(liquidation.resumePlayerId),
        debtorPlayerId: optionalText(liquidation.debtorPlayerId),
        creditorPlayerId: optionalText(liquidation.creditorPlayerId),
        pendingCellId: optionalText(liquidation.pendingCellId),
        claimCardId: optionalText(liquidation.claimCardId),
        claimCardId2: optionalText(liquidation.claimCardId2)
    };
};
/**
 * Build the shortest display-only route between two confirmed positions.
 * Snapshots do not carry movement direction, so choosing the shorter arc
 * avoids presenting a backward card as a long forward lap without inferring
 * or changing any gameplay result.
 */
function traceEstateTokenPath(cells, fromPosition, toPosition) {
    if (cells.length === 0 || fromPosition === toPosition)
        return [];
    const byIndex = new Map(cells.map((cell) => [cell.index, cell]));
    const forwardSteps = (toPosition - fromPosition + cells.length) % cells.length;
    const backwardSteps = (fromPosition - toPosition + cells.length) % cells.length;
    const direction = backwardSteps < forwardSteps ? -1 : 1;
    const stepCount = Math.min(forwardSteps, backwardSteps);
    return Array.from({ length: stepCount }, (_, step) => {
        const index = (fromPosition + direction * (step + 1) + cells.length) % cells.length;
        return byIndex.get(index);
    }).filter((cell) => cell !== undefined);
}
/** Convert a player-facing session snapshot to deterministic drawing data. */
function projectEstateRaceSession(session) {
    const state = isRecord(session.state) ? session.state : {};
    const publicState = isRecord(state.public) ? state.public : {};
    const board = isRecord(publicState.board) ? publicState.board : {};
    const turn = isRecord(publicState.turn) ? publicState.turn : {};
    const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : null;
    const phase = text(turn.phase, "setup");
    const actorPlayerId = typeof session.actorPlayerId === "string"
        ? session.actorPlayerId
        : typeof state.actorPlayerId === "string" ? state.actorPlayerId : null;
    const players = readPlayers(state, activePlayerId, actorPlayerId);
    return {
        cells: readCells(publicState),
        players,
        // A terminal snapshot is actionless even if a stale board payload still
        // contains controls. The client never manufactures a terminal action.
        availableActions: phase === "terminal"
            ? []
            : readActions(board, readActionAvailability(session.actionAvailability)),
        activePlayerId,
        phase,
        turnNumber: finiteNumber(turn.turnNumber),
        lastRoll: readRoll(board),
        lastCardId: optionalText(board.lastCardId),
        auction: readAuction(publicState),
        bankBuildings: readBuildingBank(publicState),
        buildingWindow: readBuildingWindow(publicState),
        buildingAuction: (() => {
            const auction = isRecord(publicState.buildingAuction) ? publicState.buildingAuction : {};
            return {
                resumePlayerId: null,
                cellId: null,
                currentBid: finiteNumber(auction.currentBid),
                minimumIncrement: finiteNumber(auction.minimumIncrement),
                minimumNextBid: null,
                leaderPlayerId: optionalText(auction.leaderPlayerId)
            };
        })(),
        trade: readTrade(publicState),
        obligation: readObligation(publicState),
        liquidation: readLiquidation(publicState),
        outcome: readOutcome(publicState, state, phase)
    };
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
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const PLAYER_COLORS = [0x245f52, 0xb56f3c, 0x735b87, 0x3c6f91, 0x9b7332, 0x934c54];
const phaseLabel = {
    setup: "определение порядка",
    roll: "бросок",
    acquire: "покупка",
    rent: "рента",
    tax: "налог",
    resolve: "эффект клетки",
    blocked: "следующий срез",
    finish: "завершение",
    auction: "аукцион",
    buildingWindow: "окно заявок",
    buildingAuction: "аукцион строений",
    jail: "тюрьма",
    terminal: "завершено"
};
const errorText = (error) => error instanceof Error ? error.message : "Действие отклонено сервером";
const tokenPosition = (cell, playerIndex) => ({
    x: cell.x - 32 + (playerIndex % 3) * 32,
    y: cell.y + cell.height / 2 - 18 - Math.floor(playerIndex / 3) * 28
});
// These commands require a DOM form to collect declared parameters. The
// canvas must not guess a cell or unit kind and must never submit an empty
// request that the server would reject.
const canvasCanDispatch = (action) => action.actionId !== "property.build.request"
    && action.actionId !== "property.auction.bid"
    && action.actionId !== "property.build.auction.bid";
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
            const projection = (0, board_state_ts_1.projectEstateRaceSession)(currentSession);
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
            this.add.text(680, 455, `Банк строений · дома ${projection.bankBuildings.housesAvailable}/32 · отели ${projection.bankBuildings.hotelsAvailable}/12`, {
                color: "#495c55",
                fontFamily: "Arial, sans-serif",
                fontSize: "17px"
            }).setOrigin(0.5);
            if (projection.outcome.status === "terminal") {
                this.drawOutcomeSummary(projection);
            }
            else if (projection.phase === "terminal") {
                this.add.text(680, 505, "Итог игры недоступен: сервер не подтвердил корректный результат.", {
                    color: "#8d3d36",
                    align: "center",
                    wordWrap: { width: 600 },
                    fontFamily: "Arial, sans-serif",
                    fontSize: "20px"
                }).setOrigin(0.5);
            }
            else if (projection.phase === "buildingWindow") {
                this.drawBuildingWindowSummary(projection);
            }
            else if (projection.phase === "buildingAuction") {
                this.drawBuildingAuctionSummary(projection);
            }
            else if (projection.phase === "auction") {
                this.drawAuctionSummary(projection);
            }
            else if (projection.lastRoll) {
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
            if (projection.phase === "blocked") {
                this.add.text(680, 535, "Эта клетка ещё не активирована в текущем срезе игры. Действий нет.", {
                    color: "#8d3d36",
                    align: "center",
                    wordWrap: { width: 540 },
                    fontFamily: "Arial, sans-serif",
                    fontSize: "20px"
                }).setOrigin(0.5);
            }
            if (projection.outcome.status !== "terminal"
                && projection.phase !== "terminal"
                && projection.phase !== "blocked"
                && projection.phase !== "auction") {
                this.drawCardAndJailSummary(projection);
            }
            if (projection.outcome.status !== "terminal")
                this.drawS5Summary(projection);
            // A bid requires the numeric DOM form. Never dispatch an empty bid from
            // the canvas; the server remains the authority for the submitted amount.
            const action = projection.availableActions.find((item) => !item.disabled && canvasCanDispatch(item));
            if (action)
                this.drawPrimaryAction(action);
        }
        drawAuctionSummary(projection) {
            const auction = projection.auction;
            const auctionCell = auction.cellId === null
                ? null
                : projection.cells.find((cell) => cell.id === auction.cellId);
            const minimumNextBid = auction.minimumNextBid === null ? "—" : auction.minimumNextBid;
            const lines = [
                `Аукцион · ${auctionCell?.shortLabel ?? auction.cellId ?? "объект не объявлен"}`,
                `Текущая ставка: ${auction.currentBid}`,
                `Минимальная следующая ставка: ${minimumNextBid}`,
                `Минимальный шаг: ${auction.minimumIncrement}`,
                `Лидер: ${auction.leaderPlayerId ?? "нет"}`,
                `Ход вернётся: ${auction.resumePlayerId ?? "не объявлено"}`
            ];
            this.add.text(680, 485, lines.join("\n"), {
                color: "#173a34",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "21px",
                lineSpacing: 7,
                wordWrap: { width: 600 }
            }).setOrigin(0.5);
        }
        drawOutcomeSummary(projection) {
            const winnerId = projection.outcome.winnerPlayerId;
            const winner = winnerId === null
                ? null
                : projection.players.find((player) => player.id === winnerId);
            const winnerLabel = winner?.label ?? winnerId;
            const result = winnerLabel === null
                ? "Победитель не объявлен"
                : `Победитель: ${winnerLabel}`;
            this.add.text(680, 505, ["Игра завершена", result].join("\n"), {
                color: "#173a34",
                align: "center",
                fontFamily: "Georgia, serif",
                fontSize: "30px",
                fontStyle: "bold",
                lineSpacing: 12,
                wordWrap: { width: 600 }
            }).setOrigin(0.5);
            this.add.text(680, 590, projection.outcome.reason === "last-active-player"
                ? "Последний активный участник"
                : "Результат подтверждён сервером", {
                color: "#495c55",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "18px",
                wordWrap: { width: 560 }
            }).setOrigin(0.5);
        }
        drawBuildingWindowSummary(projection) {
            const window = projection.buildingWindow;
            this.add.text(680, 505, [
                `Окно заявок · ${window.unitKind ?? "тип не объявлен"}`,
                `Продолжит ход: ${window.resumePlayerId ?? "не объявлено"}`
            ].join("\n"), {
                color: "#173a34",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "21px",
                lineSpacing: 7
            }).setOrigin(0.5);
        }
        drawBuildingAuctionSummary(projection) {
            const auction = projection.buildingAuction;
            this.add.text(680, 505, [
                "Аукцион строений",
                `Текущая ставка: ${auction.currentBid}`,
                `Минимальный шаг: ${auction.minimumIncrement}`,
                `Лидер: ${auction.leaderPlayerId ?? "нет"}`
            ].join("\n"), {
                color: "#173a34",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "21px",
                lineSpacing: 7
            }).setOrigin(0.5);
        }
        drawS5Summary(projection) {
            const lines = [];
            if (projection.trade.status !== "idle") {
                const trade = projection.trade;
                lines.push(`Сделка: ${trade.status} · ${trade.proposerPlayerId ?? "—"} → ${trade.targetPlayerId ?? "—"}`);
                lines.push(`Деньги: ${trade.offeredCash} / ${trade.requestedCash}`);
            }
            if (projection.obligation.status !== "idle") {
                const debt = projection.obligation;
                lines.push(`Обязательство: ${debt.status} · должник ${debt.debtorPlayerId ?? "—"} · ${debt.amount}`);
                lines.push(`Причина: ${debt.reason ?? "—"} · получатель ${debt.creditorPlayerId ?? debt.creditorKind ?? "—"}`);
            }
            if (projection.liquidation.status !== "idle") {
                const liquidation = projection.liquidation;
                lines.push(`Ликвидация: ${liquidation.status}`);
                if (liquidation.pendingCellId !== null)
                    lines.push(`Ожидает клетку: ${liquidation.pendingCellId}`);
            }
            if (lines.length === 0)
                return;
            this.add.text(680, 695, lines.join("\n"), {
                color: "#8d3d36",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "16px",
                lineSpacing: 4,
                wordWrap: { width: 600 }
            }).setOrigin(0.5);
        }
        drawCardAndJailSummary(projection) {
            const activePlayer = projection.players.find((player) => player.id === projection.activePlayerId);
            const heldPlayer = projection.players.find((player) => player.heldExitCardId !== null || player.heldExitCardId2 !== null);
            const heldCards = heldPlayer === undefined
                ? []
                : [heldPlayer.heldExitCardId, heldPlayer.heldExitCardId2]
                    .filter((cardId) => cardId !== null);
            const lines = [
                projection.lastCardId === null ? null : `Последняя открытая карта: ${projection.lastCardId}`,
                activePlayer?.inJail
                    ? `Попытки выхода: ${activePlayer.jailAttempts}/3`
                    : null,
                heldPlayer === undefined || heldCards.length === 0
                    ? null
                    : `${heldPlayer.label}: карты выхода ${heldCards.join(", ")}`
            ].filter((line) => line !== null);
            if (lines.length === 0)
                return;
            this.add.text(680, 550, lines.join("\n"), {
                color: "#495c55",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "17px",
                lineSpacing: 5,
                wordWrap: { width: 580 }
            }).setOrigin(0.5);
        }
        drawPrimaryAction(action) {
            const button = this.add.rectangle(680, 620, 360, 68, 0x245f52, 1)
                .setStrokeStyle(2, 0xf4e8cf, 0.65)
                .setInteractive({ useHandCursor: true });
            this.add.text(680, 620, action.label, {
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
            const fill = estate
                ? 0xf2e5ca
                : cell.kind === "start"
                    ? 0xb9d2c2
                    : cell.kind === "tax" || cell.kind === "go-to-jail"
                        ? 0xd9b5a7
                        : cell.kind === "event" || cell.kind === "fund"
                            ? 0xc8d4df
                            : 0xded7c5;
            graphics.fillStyle(fill, 1);
            const auctionCell = projection.phase === "auction" && projection.auction.cellId === cell.id;
            graphics.lineStyle(auctionCell ? 6 : estate ? 4 : 2, auctionCell ? 0x245f52 : estate ? 0xb56f3c : 0x6f8178, 0.95);
            graphics.fillRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
            graphics.strokeRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 12);
            this.add.text(cell.x, cell.y - 30, cell.shortLabel, {
                color: "#183a34",
                align: "center",
                fontFamily: "Georgia, serif",
                fontSize: estate ? "13px" : "12px",
                fontStyle: estate ? "bold" : "normal",
                wordWrap: { width: cell.width - 24 }
            }).setOrigin(0.5);
            const detail = estate || cell.kind === "transit" || cell.kind === "utility"
                ? `${cell.price ?? "—"} · рента ${cell.rent ?? "—"}`
                : cell.kind === "tax" ? `сбор ${cell.taxAmount ?? "—"}` : `клетка ${cell.index}`;
            this.add.text(cell.x, cell.y + 20, detail, {
                color: "#65716c",
                fontFamily: "Arial, sans-serif",
                fontSize: "10px"
            }).setOrigin(0.5);
            if (estate && cell.improvementTier > 0) {
                const marker = cell.improvementTier === 5
                    ? "★ ОТЕЛЬ"
                    : `${"■".repeat(cell.improvementTier)} ДОМА`;
                this.add.text(cell.x, cell.y + 42, marker, {
                    color: cell.improvementTier === 5 ? "#8d3d36" : "#245f52",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "11px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
            }
            if (cell.mortgaged) {
                this.add.text(cell.x, cell.y - cell.height / 2 + 12, "ЗАЛОЖЕНО", {
                    color: "#8d3d36",
                    backgroundColor: "#fff1e4",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "10px",
                    fontStyle: "bold",
                    padding: { x: 5, y: 3 }
                }).setOrigin(0.5);
            }
            if (cell.tradeSide !== null) {
                this.add.text(cell.x, cell.y + cell.height / 2 - 30, `СДЕЛКА: ${cell.tradeSide}`, {
                    color: "#735b87",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "9px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
            }
            if (cell.liquidationPending) {
                this.add.text(cell.x, cell.y + cell.height / 2 - 30, "ЛИКВИДАЦИЯ", {
                    color: "#8d3d36",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "9px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
            }
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
            if (cellAction && !cellAction.disabled && canvasCanDispatch(cellAction)) {
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
                const currentTokenPosition = tokenPosition(cell, index);
                const token = this.add.circle(currentTokenPosition.x, currentTokenPosition.y, player.active ? 12 : 10, PLAYER_COLORS[index] ?? PLAYER_COLORS[0], 1).setStrokeStyle(4, 0xfff7e4, 1);
                const previousPlayer = previousProjection?.players.find((item) => item.id === player.id);
                const previousCell = previousProjection?.cells.find((item) => item.index === previousPlayer?.position);
                if (!initial && previousPlayer && previousCell && previousPlayer.position !== player.position) {
                    const previousTokenPosition = tokenPosition(previousCell, index);
                    token.setPosition(previousTokenPosition.x, previousTokenPosition.y);
                    const track = (0, board_state_ts_1.traceEstateTokenPath)(projection.cells, previousPlayer.position, player.position);
                    this.tweens.add({
                        targets: token,
                        // Tweening through every crossed cell keeps the token on the
                        // cyclic track instead of cutting diagonally across the board.
                        x: track.map((item) => tokenPosition(item, index).x),
                        y: track.map((item) => tokenPosition(item, index).y),
                        duration: Math.max(360, track.length * 130),
                        interpolation: "linear",
                        ease: "Cubic.InOut"
                    });
                }
            });
        }
        drawStatus(projection) {
            projection.players.forEach((player, index) => {
                const spacing = 1100 / Math.max(1, projection.players.length - 1);
                const x = projection.players.length === 1 ? 700 : 150 + index * spacing;
                const jailStatus = player.inJail ? ` · в тюрьме (${player.jailAttempts}/3)` : "";
                const heldStatus = player.heldExitCardId === null ? "" : " · карта выхода";
                this.add.text(x, 975, `${player.label}${player.active ? " · ходит" : ""}${jailStatus}${heldStatus}   ${player.cash} монет`, {
                    color: player.active ? "#fff4d8" : "#b9c7c2",
                    fontFamily: "Arial, sans-serif",
                    fontSize: player.active ? "16px" : "14px",
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
        getAccessibleActions: accessible_actions_ts_1.provideEstateRaceAccessibleBoardActions
    };
};
exports.createEstateRaceScene = createEstateRaceScene;

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
