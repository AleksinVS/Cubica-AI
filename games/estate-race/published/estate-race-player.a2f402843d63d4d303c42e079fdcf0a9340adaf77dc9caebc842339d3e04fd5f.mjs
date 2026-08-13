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
 * Editorial Phaser surface for the Estate Race public field.
 *
 * The scene paints an authoritative snapshot and forwards only actions already
 * exposed by Runtime API. It never calculates movement, prices, ownership,
 * legality or the winner.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEstateRaceScene = exports.estateRaceOverviewCameraView = exports.clampEstateRaceCameraView = exports.clampEstateRaceZoom = exports.fitEstateRaceOverviewZoom = void 0;
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 1000;
const CAMERA_WORLD = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_STEP = 1.15;
const safeDimension = (value) => Number.isFinite(value) && value > 0 ? value : 1;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** Largest undistorted zoom that keeps the complete Estate Race board visible. */
const fitEstateRaceOverviewZoom = (viewport) => Math.min(safeDimension(viewport.width) / CAMERA_WORLD.width, safeDimension(viewport.height) / CAMERA_WORLD.height);
exports.fitEstateRaceOverviewZoom = fitEstateRaceOverviewZoom;
/** Camera zoom is never allowed below the recoverable complete-board overview. */
const clampEstateRaceZoom = (viewport, requestedZoom) => {
    const overviewZoom = (0, exports.fitEstateRaceOverviewZoom)(viewport);
    const finiteRequest = Number.isFinite(requestedZoom) ? requestedZoom : overviewZoom;
    return clamp(finiteRequest, overviewZoom, Math.max(MAX_CAMERA_ZOOM, overviewZoom));
};
exports.clampEstateRaceZoom = clampEstateRaceZoom;
const clampScrollAxis = (value, viewportSize, worldStart, worldSize, zoom) => {
    const safeViewport = safeDimension(viewportSize);
    const visibleSize = safeViewport / zoom;
    if (visibleSize >= worldSize) {
        // Phaser scroll is measured before zoom around the viewport centre. Lock
        // a smaller world to that centre rather than letting its spare axis drift.
        return worldStart + worldSize / 2 - safeViewport / 2;
    }
    const minimum = worldStart + (visibleSize - safeViewport) / 2;
    const maximum = minimum + worldSize - visibleSize;
    return clamp(value, minimum, maximum);
};
/** Clamp a camera view to the immutable 1400 by 1000 board world. */
const clampEstateRaceCameraView = (view, viewport) => {
    const zoom = (0, exports.clampEstateRaceZoom)(viewport, view.zoom);
    return {
        scrollX: clampScrollAxis(view.scrollX, viewport.width, CAMERA_WORLD.x, CAMERA_WORLD.width, zoom),
        scrollY: clampScrollAxis(view.scrollY, viewport.height, CAMERA_WORLD.y, CAMERA_WORLD.height, zoom),
        zoom
    };
};
exports.clampEstateRaceCameraView = clampEstateRaceCameraView;
/** Deterministic initial/reset view used on scene creation and resize. */
const estateRaceOverviewCameraView = (viewport) => (0, exports.clampEstateRaceCameraView)({
    scrollX: CAMERA_WORLD.x + CAMERA_WORLD.width / 2 - safeDimension(viewport.width) / 2,
    scrollY: CAMERA_WORLD.y + CAMERA_WORLD.height / 2 - safeDimension(viewport.height) / 2,
    zoom: (0, exports.fitEstateRaceOverviewZoom)(viewport)
}, viewport);
exports.estateRaceOverviewCameraView = estateRaceOverviewCameraView;
const zoomEstateRaceCameraAt = (view, point, requestedZoom, viewport) => {
    const zoom = (0, exports.clampEstateRaceZoom)(viewport, requestedZoom);
    const originX = safeDimension(viewport.width) / 2;
    const originY = safeDimension(viewport.height) / 2;
    const currentZoom = (0, exports.clampEstateRaceZoom)(viewport, view.zoom);
    const worldX = view.scrollX + originX + (point.x - originX) / currentZoom;
    const worldY = view.scrollY + originY + (point.y - originY) / currentZoom;
    return (0, exports.clampEstateRaceCameraView)({
        scrollX: worldX - originX - (point.x - originX) / zoom,
        scrollY: worldY - originY - (point.y - originY) / zoom,
        zoom
    }, viewport);
};
const panEstateRaceCamera = (view, screenDelta, viewport) => (0, exports.clampEstateRaceCameraView)({
    scrollX: view.scrollX - screenDelta.x / view.zoom,
    scrollY: view.scrollY - screenDelta.y / view.zoom,
    zoom: view.zoom
}, viewport);
const COLOR = {
    paper: 0xf2ead9,
    paperLight: 0xfaf5e9,
    paperShade: 0xe4d9c4,
    green: 0x173f37,
    greenSoft: 0x315d51,
    greenMuted: 0x6d8279,
    copper: 0xb56f3c,
    ink: 0x20322e,
    quiet: 0x66736d,
    warning: 0x8a4d37
};
// Participant colors remain functional map markers; copper is the only
// decorative accent in the editorial palette.
const PLAYER_COLORS = [0x173f37, 0xb56f3c, 0x55766d, 0x294f61, 0x76684d, 0x6e5551];
const phaseLabel = {
    setup: "определение порядка",
    roll: "бросок",
    acquire: "решение о покупке",
    rent: "расчёт аренды",
    tax: "обязательный сбор",
    resolve: "событие клетки",
    blocked: "ожидание доступного действия",
    finish: "завершение хода",
    auction: "аукцион",
    buildingWindow: "заявки на строения",
    buildingAuction: "аукцион строений",
    jail: "выход из заключения",
    tradeDraft: "подготовка сделки",
    tradeResponse: "ответ на сделку",
    tradeClaim: "передача карты",
    obligation: "обязательство",
    liquidationMortgage: "восстановление платёжеспособности",
    liquidationClaim: "завершение ликвидации",
    terminal: "партия завершена"
};
const parameterFormActionIds = new Set([
    "property.auction.bid",
    "property.build",
    "property.build.request",
    "property.build.auction.bid",
    "property.sell",
    "property.mortgage",
    "property.redeem",
    "trade.open",
    "trade.cash.set",
    "trade.asset.set",
    "trade.asset.remove",
    "trade.card.offer",
    "trade.card.request",
    "bankruptcy.declare"
]);
const canvasCanDispatch = (action) => !parameterFormActionIds.has(action.actionId);
const errorText = (error) => error instanceof Error ? error.message : "Действие отклонено сервером";
const tokenPosition = (cell, playerIndex) => ({
    x: cell.x - 30 + (playerIndex % 3) * 30,
    y: cell.y + cell.height / 2 - 19 - Math.floor(playerIndex / 3) * 27
});
const money = (value) => `${value.toLocaleString("ru-RU")} монет`;
/** Build a scene solely from platform-injected Phaser. */
const createEstateRaceScene = (context) => {
    const Phaser = context.Phaser;
    let currentSession = context.session;
    let previousProjection = null;
    let lastError = null;
    class EstateRaceScene extends Phaser.Scene {
        projectionReady = false;
        cameraInteractionReady = false;
        dragState = null;
        constructor() {
            super({ key: `estate-race:${context.sceneId}` });
        }
        create() {
            this.projectionReady = true;
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                this.projectionReady = false;
                this.stopCameraInteraction();
            });
            this.cameras.main.setBackgroundColor("#f2ead9");
            this.configureCameraInteraction();
            this.renderProjection(true);
        }
        /** Return to the complete-board overview exposed by the host DOM control. */
        fitToView() {
            if (!this.projectionReady)
                return;
            this.applyCameraView((0, exports.estateRaceOverviewCameraView)(this.currentViewport()));
        }
        /** Zoom around the viewport centre; factors above one mean zooming in. */
        zoomBy(factor) {
            if (!this.projectionReady || !Number.isFinite(factor) || factor <= 0)
                return;
            const viewport = this.currentViewport();
            this.applyZoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, factor);
        }
        configureCameraInteraction() {
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
        stopCameraInteraction() {
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
        currentViewport() {
            const camera = this.cameras.main;
            return {
                width: safeDimension(camera.width),
                height: safeDimension(camera.height)
            };
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
            this.applyCameraView(zoomEstateRaceCameraAt(current, point, current.zoom * factor, viewport));
        }
        handleWheel = (pointer, _currentlyOver, _deltaX, deltaY) => {
            if (deltaY === 0)
                return;
            this.applyZoomAt({ x: pointer.x, y: pointer.y }, deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
        };
        handlePointerDown = (pointer, currentlyOver) => {
            // Camera input starts only on empty map space. Cell and action hit zones
            // keep their established gameplay dispatch without competing gestures.
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
            this.applyCameraView(panEstateRaceCamera(this.currentCameraView(), delta, this.currentViewport()));
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
            // A resized map-first workspace establishes a new complete overview.
            // This keeps the board recoverable after rotation or fullscreen changes.
            this.fitToView();
        };
        renderProjection(initial = false) {
            if (!this.projectionReady)
                return;
            const projection = (0, board_state_ts_1.projectEstateRaceSession)(currentSession);
            this.children.removeAll(true);
            const graphics = this.add.graphics();
            this.drawPaper(graphics);
            this.drawCentre(projection, initial);
            for (const cell of projection.cells)
                this.drawCell(graphics, cell, projection, initial);
            this.drawPlayers(projection, initial);
            this.drawParticipantLedger(projection);
            if (lastError) {
                this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 18, lastError, {
                    color: "#fffaf0",
                    backgroundColor: "#8a4d37",
                    padding: { x: 18, y: 10 },
                    fontFamily: "Arial, sans-serif",
                    fontSize: "18px"
                }).setOrigin(0.5, 1).setDepth(20);
            }
            previousProjection = projection;
        }
        prefersReducedMotion() {
            return typeof window !== "undefined"
                && typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }
        drawPaper(graphics) {
            graphics.fillStyle(COLOR.paper, 1);
            graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
            // Sparse registration lines suggest an editorial map without competing
            // with the forty-cell route.
            graphics.lineStyle(1, COLOR.greenMuted, 0.12);
            for (let x = 28; x < DESIGN_WIDTH; x += 64)
                graphics.lineBetween(x, 0, x, DESIGN_HEIGHT);
            for (let y = 28; y < DESIGN_HEIGHT; y += 64)
                graphics.lineBetween(0, y, DESIGN_WIDTH, y);
            graphics.lineStyle(3, COLOR.green, 0.85);
            graphics.strokeRoundedRect(24, 24, DESIGN_WIDTH - 48, DESIGN_HEIGHT - 48, 18);
            graphics.lineStyle(1, COLOR.copper, 0.75);
            graphics.strokeRoundedRect(34, 34, DESIGN_WIDTH - 68, DESIGN_HEIGHT - 68, 14);
        }
        drawCentre(projection, initial) {
            const sheet = this.add.rectangle(700, 500, 930, 640, COLOR.paperLight, 0.98)
                .setStrokeStyle(2, COLOR.green, 0.82);
            if (initial && !this.prefersReducedMotion()) {
                sheet.setAlpha(0);
                this.tweens.add({ targets: sheet, alpha: 0.98, duration: 320, ease: "Cubic.Out" });
            }
            this.add.text(700, 252, "ESTATE RACE", {
                color: "#173f37",
                fontFamily: "Georgia, serif",
                fontSize: "48px",
                fontStyle: "bold",
                letterSpacing: 7
            }).setOrigin(0.5);
            this.add.text(700, 294, "ЭКОНОМИЧЕСКАЯ СТРАТЕГИЯ", {
                color: "#b56f3c",
                fontFamily: "Arial, sans-serif",
                fontSize: "14px",
                fontStyle: "bold",
                letterSpacing: 3
            }).setOrigin(0.5);
            const activePlayer = this.playerLabel(projection, projection.activePlayerId);
            const phase = phaseLabel[projection.phase] ?? projection.phase;
            this.add.text(700, 341, `ХОД ${projection.turnNumber}  ·  ${activePlayer}  ·  ${phase}`, {
                color: "#315d51",
                fontFamily: "Arial, sans-serif",
                fontSize: "19px",
                fontStyle: "bold"
            }).setOrigin(0.5);
            this.add.rectangle(700, 372, 660, 1, COLOR.copper, 0.8);
            this.drawDecisionContext(projection);
            this.drawEconomyLine(projection);
            const action = projection.availableActions.find((item) => !item.disabled);
            if (action)
                this.drawPrimaryAction(action);
        }
        drawDecisionContext(projection) {
            const phaseChanged = previousProjection !== null && previousProjection.phase !== projection.phase;
            const context = this.decisionCopy(projection);
            const eyebrow = this.add.text(700, 402, context.eyebrow.toUpperCase(), {
                color: "#b56f3c",
                fontFamily: "Arial, sans-serif",
                fontSize: "13px",
                fontStyle: "bold",
                letterSpacing: 2
            }).setOrigin(0.5);
            const title = this.add.text(700, 446, context.title, {
                color: context.warning ? "#8a4d37" : "#20322e",
                align: "center",
                fontFamily: "Georgia, serif",
                fontSize: "28px",
                fontStyle: "bold",
                wordWrap: { width: 650 }
            }).setOrigin(0.5);
            const body = this.add.text(700, 505, context.body, {
                color: "#52615b",
                align: "center",
                fontFamily: "Arial, sans-serif",
                fontSize: "17px",
                lineSpacing: 6,
                wordWrap: { width: 660 }
            }).setOrigin(0.5);
            if (phaseChanged && !this.prefersReducedMotion()) {
                for (const item of [eyebrow, title, body])
                    item.setAlpha(0);
                this.tweens.add({
                    targets: [eyebrow, title, body],
                    alpha: 1,
                    y: "+=0",
                    duration: 220,
                    ease: "Sine.Out"
                });
            }
        }
        decisionCopy(projection) {
            if (projection.outcome.status === "terminal") {
                const winner = this.playerLabel(projection, projection.outcome.winnerPlayerId);
                return {
                    eyebrow: "Итог подтверждён сервером",
                    title: `Партия завершена · ${winner}`,
                    body: projection.outcome.reason === "last-active-player"
                        ? "Последний активный участник остаётся в игре."
                        : "Результат получен из подтверждённой игровой проекции."
                };
            }
            if (projection.phase === "terminal") {
                return {
                    eyebrow: "Итог недоступен",
                    title: "Сервер не подтвердил корректный результат",
                    body: "Интерфейс не определяет победителя самостоятельно.",
                    warning: true
                };
            }
            if (projection.auction.cellId !== null || projection.phase === "auction") {
                const cell = projection.cells.find((item) => item.id === projection.auction.cellId);
                const next = projection.auction.minimumNextBid === null ? "не объявлена" : money(projection.auction.minimumNextBid);
                return {
                    eyebrow: "Аукцион",
                    title: cell?.label ?? projection.auction.cellId ?? "Объект не объявлен",
                    body: `Текущая ставка ${money(projection.auction.currentBid)} · следующая ${next}\nЛидер: ${this.playerLabel(projection, projection.auction.leaderPlayerId)}`
                };
            }
            if (projection.phase === "buildingWindow") {
                return {
                    eyebrow: "Развитие собственности",
                    title: "Открыто окно заявок",
                    body: `Тип строения: ${projection.buildingWindow.unitKind ?? "не объявлен"} · ход продолжит ${this.playerLabel(projection, projection.buildingWindow.resumePlayerId)}`
                };
            }
            if (projection.phase === "buildingAuction") {
                return {
                    eyebrow: "Аукцион строений",
                    title: `Текущая ставка ${money(projection.buildingAuction.currentBid)}`,
                    body: `Шаг ${money(projection.buildingAuction.minimumIncrement)} · лидер ${this.playerLabel(projection, projection.buildingAuction.leaderPlayerId)}`
                };
            }
            if (projection.trade.status !== "idle") {
                const trade = projection.trade;
                return {
                    eyebrow: "Сделка",
                    title: `${this.playerLabel(projection, trade.proposerPlayerId)} → ${this.playerLabel(projection, trade.targetPlayerId)}`,
                    body: `Предлагается ${money(trade.offeredCash)} · запрашивается ${money(trade.requestedCash)}\nСтатус: ${trade.status}`
                };
            }
            if (projection.obligation.status !== "idle") {
                const debt = projection.obligation;
                return {
                    eyebrow: "Обязательство",
                    title: `${this.playerLabel(projection, debt.debtorPlayerId)} · ${money(debt.amount)}`,
                    body: `Причина: ${debt.reason ?? "не объявлена"} · получатель ${this.playerLabel(projection, debt.creditorPlayerId)}`,
                    warning: true
                };
            }
            if (projection.liquidation.status !== "idle") {
                const liquidation = projection.liquidation;
                const cell = projection.cells.find((item) => item.id === liquidation.pendingCellId);
                return {
                    eyebrow: "Восстановление платёжеспособности",
                    title: this.playerLabel(projection, liquidation.debtorPlayerId),
                    body: `Статус: ${liquidation.status} · объект ${cell?.shortLabel ?? liquidation.pendingCellId ?? "не объявлен"}`,
                    warning: true
                };
            }
            const active = projection.players.find((player) => player.id === projection.activePlayerId);
            if (active?.inJail || projection.phase === "jail") {
                return {
                    eyebrow: "Заключение",
                    title: `${active?.label ?? "Активный участник"} выбирает способ выхода`,
                    body: `Подтверждённые попытки: ${active?.jailAttempts ?? 0}/3. Способы выхода показывает только сервер.`
                };
            }
            const activeCell = active === undefined
                ? null
                : projection.cells.find((cell) => cell.index === active.position) ?? null;
            if ((projection.phase === "acquire" || projection.phase === "rent") && activeCell !== null) {
                const owner = this.playerLabel(projection, activeCell.ownerPlayerId);
                return {
                    eyebrow: projection.phase === "acquire" ? "Решение о собственности" : "Арендное обязательство",
                    title: activeCell.label,
                    body: `Цена ${activeCell.price === null ? "—" : money(activeCell.price)} · аренда ${activeCell.rent === null ? "—" : money(activeCell.rent)} · владелец ${owner}`
                };
            }
            if (projection.lastCardId !== null) {
                return {
                    eyebrow: "Открытая карта",
                    title: projection.lastCardId,
                    body: "Показан последний публичный результат; будущий порядок колоды скрыт."
                };
            }
            if (projection.lastRoll !== null) {
                return {
                    eyebrow: "Подтверждённый бросок",
                    title: projection.lastRoll.values.map((value) => `〔${value}〕`).join("  "),
                    body: `Сумма ${projection.lastRoll.total}${projection.lastRoll.isDouble ? " · дубль" : ""}`
                };
            }
            return {
                eyebrow: "Начало партии",
                title: "Поле готово",
                body: "Дождитесь действия, объявленного сервером для текущего участника."
            };
        }
        drawEconomyLine(projection) {
            this.add.rectangle(700, 594, 660, 1, COLOR.greenMuted, 0.35);
            this.add.text(700, 615, `БАНК СТРОЕНИЙ  ·  ДОМА ${projection.bankBuildings.housesAvailable}/32  ·  ОТЕЛИ ${projection.bankBuildings.hotelsAvailable}/12`, {
                color: "#53665f",
                fontFamily: "Arial, sans-serif",
                fontSize: "13px",
                fontStyle: "bold",
                letterSpacing: 1
            }).setOrigin(0.5);
        }
        drawPrimaryAction(action) {
            const needsForm = !canvasCanDispatch(action);
            const y = 667;
            if (needsForm) {
                this.add.text(700, y - 5, action.label, {
                    color: "#173f37",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "19px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
                this.add.text(700, y + 22, "Заполните доступную форму под полем", {
                    color: "#66736d",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "13px"
                }).setOrigin(0.5);
                return;
            }
            const button = this.add.rectangle(700, y, 360, 58, COLOR.green, 1)
                .setStrokeStyle(2, COLOR.copper, 0.9)
                .setInteractive({ useHandCursor: true });
            this.add.text(700, y, action.label, {
                color: "#fffaf0",
                fontFamily: "Arial, sans-serif",
                fontSize: "19px",
                fontStyle: "bold"
            }).setOrigin(0.5);
            button.on("pointerover", () => button.setFillStyle(COLOR.greenSoft, 1));
            button.on("pointerout", () => button.setFillStyle(COLOR.green, 1));
            button.on("pointerdown", () => this.dispatchAction(action));
        }
        drawCell(graphics, cell, projection, initial) {
            const purchasable = cell.kind === "estate" || cell.kind === "transit" || cell.kind === "utility";
            const fill = cell.kind === "start"
                ? 0xd6e2d7
                : cell.kind === "tax" || cell.kind === "go-to-jail"
                    ? 0xe7d0c1
                    : cell.kind === "event" || cell.kind === "fund"
                        ? 0xe0e5df
                        : purchasable ? COLOR.paperLight : COLOR.paperShade;
            const auctionCell = projection.phase === "auction" && projection.auction.cellId === cell.id;
            graphics.fillStyle(fill, 1);
            graphics.lineStyle(auctionCell ? 5 : 2, auctionCell ? COLOR.copper : COLOR.green, auctionCell ? 1 : 0.72);
            graphics.fillRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 8);
            graphics.strokeRoundedRect(cell.x - cell.width / 2, cell.y - cell.height / 2, cell.width, cell.height, 8);
            if (purchasable) {
                graphics.fillStyle(COLOR.copper, cell.mortgaged ? 0.25 : 0.9);
                graphics.fillRect(cell.x - cell.width / 2 + 7, cell.y - cell.height / 2 + 7, cell.width - 14, 5);
            }
            this.add.text(cell.x, cell.y - (cell.height >= 100 ? 29 : 13), cell.shortLabel, {
                color: "#20322e",
                align: "center",
                fontFamily: "Georgia, serif",
                fontSize: cell.height >= 100 ? "12px" : "11px",
                fontStyle: purchasable ? "bold" : "normal",
                wordWrap: { width: cell.width - 18 }
            }).setOrigin(0.5);
            const detail = purchasable
                ? `${cell.price ?? "—"} · ${cell.rent ?? "—"}`
                : cell.kind === "tax" ? `сбор ${cell.taxAmount ?? "—"}` : `№ ${cell.index}`;
            this.add.text(cell.x, cell.y + (cell.height >= 100 ? 17 : 12), detail, {
                color: "#66736d",
                fontFamily: "Arial, sans-serif",
                fontSize: "9px"
            }).setOrigin(0.5);
            if (cell.improvementTier > 0) {
                const marker = cell.improvementTier === 5 ? "ОТЕЛЬ" : `${"▪".repeat(cell.improvementTier)} ДОМ`;
                this.add.text(cell.x, cell.y + cell.height / 2 - 24, marker, {
                    color: "#173f37",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "9px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
            }
            if (cell.mortgaged) {
                this.add.text(cell.x, cell.y - cell.height / 2 + 12, "ЗАЛОГ", {
                    color: "#8a4d37",
                    backgroundColor: "#faf5e9",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "9px",
                    fontStyle: "bold",
                    padding: { x: 4, y: 2 }
                }).setOrigin(0.5);
            }
            if (cell.tradeSide !== null || cell.liquidationPending) {
                this.add.text(cell.x, cell.y + cell.height / 2 - 13, cell.liquidationPending ? "ЛИКВИДАЦИЯ" : "В СДЕЛКЕ", {
                    color: "#8a4d37",
                    fontFamily: "Arial, sans-serif",
                    fontSize: "8px",
                    fontStyle: "bold"
                }).setOrigin(0.5);
            }
            if (cell.ownerPlayerId) {
                const ownerIndex = projection.players.findIndex((player) => player.id === cell.ownerPlayerId);
                const ribbon = this.add.rectangle(cell.x, cell.y + cell.height / 2 - 6, cell.width - 16, 8, PLAYER_COLORS[Math.max(0, ownerIndex)] ?? PLAYER_COLORS[0], 1);
                const previousOwner = previousProjection?.cells.find((item) => item.id === cell.id)?.ownerPlayerId;
                if (!initial && previousOwner !== cell.ownerPlayerId && !this.prefersReducedMotion()) {
                    ribbon.setAlpha(0);
                    this.tweens.add({ targets: ribbon, alpha: 1, duration: 220, ease: "Sine.Out" });
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
                const current = tokenPosition(cell, index);
                const token = this.add.circle(current.x, current.y, player.active ? 12 : 10, PLAYER_COLORS[index] ?? PLAYER_COLORS[0], 1).setStrokeStyle(player.active ? 4 : 3, COLOR.paperLight, 1).setDepth(10);
                const previousPlayer = previousProjection?.players.find((item) => item.id === player.id);
                const previousCell = previousProjection?.cells.find((item) => item.index === previousPlayer?.position);
                if (!initial
                    && !this.prefersReducedMotion()
                    && previousPlayer
                    && previousCell
                    && previousPlayer.position !== player.position) {
                    const from = tokenPosition(previousCell, index);
                    token.setPosition(from.x, from.y);
                    const track = (0, board_state_ts_1.traceEstateTokenPath)(projection.cells, previousPlayer.position, player.position);
                    this.tweens.add({
                        targets: token,
                        x: track.map((item) => tokenPosition(item, index).x),
                        y: track.map((item) => tokenPosition(item, index).y),
                        duration: Math.max(260, track.length * 95),
                        interpolation: "linear",
                        ease: "Cubic.InOut"
                    });
                }
            });
        }
        drawParticipantLedger(projection) {
            if (projection.players.length === 0)
                return;
            const width = 820 / projection.players.length;
            projection.players.forEach((player, index) => {
                const x = 290 + width / 2 + index * width;
                this.add.circle(x, 753, 6, PLAYER_COLORS[index] ?? PLAYER_COLORS[0], 1);
                this.add.text(x + 12, 744, `${player.label}${player.active ? " · ход" : ""}`, {
                    color: player.active ? "#173f37" : "#52615b",
                    fontFamily: "Arial, sans-serif",
                    fontSize: projection.players.length > 4 ? "11px" : "13px",
                    fontStyle: player.active ? "bold" : "normal"
                }).setOrigin(0, 0.5);
                this.add.text(x + 12, 765, `${money(player.cash)}${player.inJail ? ` · заключение ${player.jailAttempts}/3` : ""}`, {
                    color: "#66736d",
                    fontFamily: "Arial, sans-serif",
                    fontSize: projection.players.length > 4 ? "10px" : "11px"
                }).setOrigin(0, 0.5);
            });
        }
        playerLabel(projection, playerId) {
            if (playerId === null)
                return "не объявлен";
            return projection.players.find((player) => player.id === playerId)?.label ?? playerId;
        }
        dispatchAction(action) {
            if (action.disabled || !canvasCanDispatch(action))
                return;
            void context.dispatchAction(action.actionId, { ...(action.params ?? {}) })
                .then(() => { lastError = null; })
                .catch((error) => {
                // Runtime refusal leaves the last confirmed board intact.
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
            scene.stopCameraInteraction();
            if (scene.sys?.isActive())
                scene.children.removeAll(true);
        },
        fitToView() {
            scene.fitToView();
        },
        zoomBy(factor) {
            scene.zoomBy(factor);
        },
        getAccessibleActions: accessible_actions_ts_1.provideEstateRaceAccessibleBoardActions
    };
};
exports.createEstateRaceScene = createEstateRaceScene;

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
