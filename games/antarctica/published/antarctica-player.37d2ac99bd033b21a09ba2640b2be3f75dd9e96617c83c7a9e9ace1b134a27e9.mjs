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
 * Public entrypoint for the Antarctica player-web plugin.
 *
 * The platform calls activate() with a small capability object. The plugin then
 * registers its contribution points without importing player-web internals.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANTARCTICA_PLAYER_PLUGIN_ID = exports.createAntarcticaConfig = exports.ANTARCTICA_GAME_CONFIG_DATA = void 0;
exports.activate = activate;
const config_data_1 = __pluginRequire("src/config-data.ts");
const register_1 = __pluginRequire("src/register.ts");
var config_data_2 = __pluginRequire("src/config-data.ts");
Object.defineProperty(exports, "ANTARCTICA_GAME_CONFIG_DATA", { enumerable: true, get: function () { return config_data_2.ANTARCTICA_GAME_CONFIG_DATA; } });
var register_2 = __pluginRequire("src/register.ts");
Object.defineProperty(exports, "createAntarcticaConfig", { enumerable: true, get: function () { return register_2.createAntarcticaConfig; } });
__exportStar(__pluginRequire("src/contracts.ts"), exports);
__exportStar(__pluginRequire("src/state-resolvers.ts"), exports);
exports.ANTARCTICA_PLAYER_PLUGIN_ID = "antarctica-player";
function activate(api) {
    api.registerGameConfigData(config_data_1.ANTARCTICA_GAME_CONFIG_DATA);
    api.registerGameConfigFactory(config_data_1.ANTARCTICA_GAME_CONFIG_DATA.gameId, register_1.createAntarcticaConfig);
}

});
__pluginDefine("src/config-data.ts", (exports, module) => {
"use strict";
/**
 * Serializable player configuration for Antarctica.
 *
 * The data contains only JSON-compatible values, so Next.js can pass it through
 * the Server Component to Client Component boundary. Functional resolvers are
 * registered separately through the plugin API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANTARCTICA_GAME_CONFIG_DATA = void 0;
exports.ANTARCTICA_GAME_CONFIG_DATA = {
    gameId: "antarctica",
    playerId: "player-web",
    storageKey: "cubica-antarctica-session-id",
    fallbackMetrics: [
        { id: "score", caption: "Остаток дней", aliases: ["score", "days", "time"], sidebarImage: "/images/left-sidebar/days.png", topbarImage: "/images/top-sidebar/days-top.png" },
        { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "/images/left-sidebar/znania.png", topbarImage: "/images/top-sidebar/znaniya.png" },
        { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "/images/left-sidebar/doverie.png", topbarImage: "/images/top-sidebar/doverie.png" },
        { id: "lid", caption: "Энергия", aliases: ["lid", "energy"], sidebarImage: "/images/left-sidebar/energia.png", topbarImage: "/images/top-sidebar/energia.png" },
        { id: "man", caption: "Контроль", aliases: ["man", "control"], sidebarImage: "/images/left-sidebar/kontrol.png", topbarImage: "/images/top-sidebar/kontrol.png" },
        { id: "stat", caption: "Статус", aliases: ["stat", "status"], sidebarImage: "/images/left-sidebar/status.png", topbarImage: "/images/top-sidebar/status.png" },
        { id: "cont", caption: "Контакт", aliases: ["cont", "contact"], sidebarImage: "/images/left-sidebar/kontakt.png", topbarImage: "/images/top-sidebar/kontakt.png" },
        { id: "constr", caption: "Конструктив", aliases: ["constr", "constructive"], sidebarImage: "/images/left-sidebar/konstruktiv.png", topbarImage: "/images/top-sidebar/konstruktiv.png" }
    ],
    topbarScreenKeys: [
        "55..60",
        "61..66",
        "67..70"
    ],
    metricBackgroundImages: {
        score: "/images/top-sidebar/days-top.png",
        pro: "/images/top-sidebar/znaniya.png",
        rep: "/images/top-sidebar/doverie.png",
        energy: "/images/top-sidebar/energia.png",
        lid: "/images/top-sidebar/energia.png",
        control: "/images/top-sidebar/kontrol.png",
        man: "/images/top-sidebar/kontrol.png",
        status: "/images/top-sidebar/status.png",
        stat: "/images/top-sidebar/status.png",
        contact: "/images/top-sidebar/kontakt.png",
        cont: "/images/top-sidebar/kontakt.png",
        constructive: "/images/top-sidebar/konstruktiv.png",
        constr: "/images/top-sidebar/konstruktiv.png"
    }
};

});
__pluginDefine("src/register.ts", (exports, module) => {
"use strict";
/**
 * Antarctica player-web resolver factory.
 *
 * The factory turns serializable game config data into a full runtime config
 * with functions. It is exported for the plugin entrypoint and tests; it does
 * not register itself by module side effect.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAntarcticaConfig = void 0;
const plugin_api_1 = __pluginRequire("@cubica/player-web/plugin-api");
const state_resolvers_1 = __pluginRequire("src/state-resolvers.ts");
const createAntarcticaConfig = (data) => {
    const topbarScreenKeys = new Set(data.topbarScreenKeys);
    return {
        gameId: data.gameId,
        playerId: data.playerId,
        storageKey: data.storageKey,
        fallbackMetrics: data.fallbackMetrics,
        topbarScreenKeys,
        metricBackgroundImages: data.metricBackgroundImages,
        resolveBoardScreenKey(stepIndex) {
            if (stepIndex === null)
                return null;
            if (stepIndex === 30)
                return "55..60";
            if (stepIndex === 32)
                return "61..66";
            if (stepIndex === 34)
                return "67..70";
            if (stepIndex === 36)
                return "67..70";
            return null;
        },
        resolveScreenKey(screenId, stepIndex, infoId, runtimeUi, gameUi) {
            if (screenId === "S2") {
                const boardKey = this.resolveBoardScreenKey?.(stepIndex) ?? null;
                if (boardKey && gameUi?.screens[boardKey]) {
                    return boardKey;
                }
                return null;
            }
            if (screenId === "S1") {
                if (runtimeUi.activeScreen === "left-sidebar" && gameUi?.screens["S1_LEFT"]) {
                    return "S1_LEFT";
                }
                if (infoId && gameUi?.screens[infoId]) {
                    return infoId;
                }
                if (infoId) {
                    return null;
                }
                if (gameUi?.screens["S1"]) {
                    return "S1";
                }
                return null;
            }
            if (screenId && gameUi?.screens[screenId]) {
                return screenId;
            }
            return null;
        },
        resolveLayoutMode(screenKey, runtimeUi, gameState) {
            const { currentBoard, currentInfo } = gameState;
            if (runtimeUi.activeScreen === "topbar") {
                return "topbar";
            }
            if (runtimeUi.activeScreen === "left-sidebar") {
                return "leftsidebar";
            }
            if (screenKey && this.topbarScreenKeys.has(screenKey)) {
                return "topbar";
            }
            if (currentBoard) {
                return "topbar";
            }
            if (currentInfo && currentInfo.id !== "i0") {
                return "topbar";
            }
            return "topbar";
        },
        resolveGameState(content, session) {
            const publicState = session?.state?.public;
            const gameContent = (0, state_resolvers_1.resolveAntarcticaContent)(content);
            const currentInfo = (0, state_resolvers_1.resolveCurrentInfoEntry)(gameContent, publicState);
            const currentBoard = (0, state_resolvers_1.resolveCurrentBoard)(gameContent, publicState);
            const currentTeamSelection = (0, state_resolvers_1.resolveCurrentTeamSelectionScene)(gameContent, publicState);
            const cardFlags = (0, state_resolvers_1.readCardFlags)(session);
            const selectedCardId = (0, state_resolvers_1.readSelectedCardId)(session);
            const boardCards = (0, state_resolvers_1.resolveBoardCards)(gameContent, currentBoard, cardFlags);
            const teamFlags = (0, state_resolvers_1.readTeamFlags)(session);
            const teamSelectionState = (0, state_resolvers_1.readTeamSelection)(session);
            const canAdvance = (0, state_resolvers_1.readCanAdvance)(session);
            const fallbackActions = (0, state_resolvers_1.getFallbackActionEntries)(content);
            const selectedMemberIds = teamSelectionState.selectedMemberIds ?? [];
            const pickCount = teamSelectionState.pickCount ?? 0;
            const selectedTeamMemberIds = selectedMemberIds.length > 0
                ? selectedMemberIds
                : Object.keys(teamFlags).filter((memberId) => teamFlags[memberId]?.selected);
            const selectedCard = selectedCardId && boardCards.length > 0
                ? boardCards.find((card) => card.cardId === selectedCardId) ?? null
                : null;
            return {
                currentInfo,
                currentBoard,
                currentTeamSelection,
                cardFlags,
                selectedCardId,
                selectedCard,
                boardCards,
                teamFlags,
                selectedMemberIds: selectedTeamMemberIds,
                pickCount,
                canAdvance,
                fallbackActions
            };
        },
        resolveMetrics(metrics) {
            if (typeof metrics.time === "number" && !("score" in metrics)) {
                metrics.score = 60 - metrics.time;
            }
            return metrics;
        },
        resolveHintText(content, gameState) {
            return (0, state_resolvers_1.resolveLastInfoHintText)((0, state_resolvers_1.resolveAntarcticaContent)(content), gameState);
        },
        createManifestActionAdapter(content, gameState, dispatchAction, onError) {
            return (0, plugin_api_1.createManifestActionAdapter)({
                gameContent: (0, state_resolvers_1.resolveAntarcticaContent)(content),
                resolveActionId(command, payload) {
                    if (command === plugin_api_1.ManifestAction.REQUEST_SERVER && payload.cardId) {
                        const cardId = String(payload.cardId);
                        const card = gameState.boardCards.find((candidate) => candidate.cardId === cardId);
                        if (card) {
                            return card.selectActionId;
                        }
                    }
                    if (command === plugin_api_1.ManifestAction.ADVANCE && payload.advanceActionId) {
                        return String(payload.advanceActionId);
                    }
                    if (command === plugin_api_1.ManifestAction.REQUEST_SERVER && payload.actionId) {
                        return String(payload.actionId);
                    }
                    return null;
                },
                dispatchAction,
                onError
            });
        }
    };
};
exports.createAntarcticaConfig = createAntarcticaConfig;

});
__pluginDefine("src/state-resolvers.ts", (exports, module) => {
"use strict";
/**
 * Antarctica-specific state resolvers.
 *
 * These functions know the shape of Antarctica content: boards, info entries,
 * cards and team-selection scenes. Generic helpers still come from the public
 * player plugin API facade.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFallbackActionEntries = void 0;
exports.resolveAntarcticaContent = resolveAntarcticaContent;
exports.resolveCurrentInfoEntry = resolveCurrentInfoEntry;
exports.resolveCurrentBoard = resolveCurrentBoard;
exports.resolveCurrentTeamSelectionScene = resolveCurrentTeamSelectionScene;
exports.resolveBoardCards = resolveBoardCards;
exports.resolveLastInfoHintText = resolveLastInfoHintText;
exports.readCardFlags = readCardFlags;
exports.readTeamFlags = readTeamFlags;
exports.readTeamSelection = readTeamSelection;
exports.readCanAdvance = readCanAdvance;
exports.readSelectedCardId = readSelectedCardId;
const plugin_api_1 = __pluginRequire("@cubica/player-web/plugin-api");
Object.defineProperty(exports, "getFallbackActionEntries", { enumerable: true, get: function () { return plugin_api_1.getFallbackActionEntries; } });
/**
 * Extracts Antarctica-specific content from the generic player DTO.
 */
function resolveAntarcticaContent(content) {
    return (0, plugin_api_1.resolveGameContent)(content);
}
/**
 * Resolves the current info screen from timeline state.
 */
function resolveCurrentInfoEntry(gameContent, publicState) {
    if (!gameContent) {
        return null;
    }
    const timeline = publicState?.timeline;
    const stepIndex = (0, plugin_api_1.readStepIndex)(timeline);
    const screenId = (0, plugin_api_1.readScreenId)(timeline);
    const activeInfoId = timeline?.activeInfoId;
    if (stepIndex === null || !screenId || !activeInfoId) {
        if (stepIndex === null || !screenId) {
            return null;
        }
        const entriesForStep = gameContent.infos.filter((entry) => entry.stepIndex === stepIndex && entry.screenId === screenId);
        return entriesForStep.length === 1 ? entriesForStep[0] : null;
    }
    const explicitMatch = gameContent.infos.find((entry) => entry.id === activeInfoId && entry.stepIndex === stepIndex && entry.screenId === screenId) ?? null;
    if (explicitMatch) {
        return explicitMatch;
    }
    const entriesForStep = gameContent.infos.filter((entry) => entry.stepIndex === stepIndex && entry.screenId === screenId);
    return entriesForStep.length === 1 ? entriesForStep[0] : null;
}
/**
 * Resolves the current board from timeline state.
 */
function resolveCurrentBoard(gameContent, publicState) {
    if (!gameContent) {
        return null;
    }
    const timeline = publicState?.timeline;
    const stepIndex = (0, plugin_api_1.readStepIndex)(timeline);
    const screenId = (0, plugin_api_1.readScreenId)(timeline);
    if (stepIndex === null || !screenId) {
        return null;
    }
    return gameContent.boards.find((board) => board.stepIndex === stepIndex && board.screenId === screenId) ?? null;
}
/**
 * Resolves the current team-selection scene from timeline state.
 */
function resolveCurrentTeamSelectionScene(gameContent, publicState) {
    if (!gameContent?.teamSelections) {
        return null;
    }
    const timeline = publicState?.timeline;
    const stepIndex = (0, plugin_api_1.readStepIndex)(timeline);
    const screenId = (0, plugin_api_1.readScreenId)(timeline);
    if (stepIndex === null || !screenId) {
        return null;
    }
    return (gameContent.teamSelections.find((scene) => scene.stepIndex === stepIndex && scene.screenId === screenId) ?? null);
}
/**
 * Resolves visible cards for the current board by card ids and session flags.
 */
function resolveBoardCards(gameContent, board, cardFlags) {
    if (!gameContent || !board) {
        return [];
    }
    const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
    return board.cardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card) => {
        if (!card) {
            return false;
        }
        const contentAvailable = card.available;
        const cardState = cardFlags?.[card.cardId];
        return contentAvailable !== false && cardState?.available !== false;
    });
}
/**
 * Antarctica hint fallback: when no dedicated hint is open, show the last story
 * info screen the player has reached. This is game-specific presentation logic.
 */
function resolveLastInfoHintText(gameContent, gameState) {
    if (gameState.currentInfo?.body || gameState.currentInfo?.title) {
        return [gameState.currentInfo.title, gameState.currentInfo.body].filter(Boolean).join("\n\n");
    }
    const currentStepIndex = gameState.currentBoard?.stepIndex ?? gameState.currentTeamSelection?.stepIndex;
    if (!gameContent || typeof currentStepIndex !== "number") {
        return null;
    }
    const lastInfo = gameContent.infos
        .filter((entry) => entry.stepIndex <= currentStepIndex)
        .sort((left, right) => left.stepIndex - right.stepIndex)
        .at(-1);
    if (!lastInfo?.body && !lastInfo?.title) {
        return null;
    }
    return [lastInfo.title, lastInfo.body].filter(Boolean).join("\n\n");
}
function readCardFlags(session) {
    return (0, plugin_api_1.readCardFlags)(session);
}
function readTeamFlags(session) {
    return (0, plugin_api_1.readTeamFlags)(session);
}
function readTeamSelection(session) {
    return (0, plugin_api_1.readTeamSelection)(session);
}
function readCanAdvance(session) {
    return (0, plugin_api_1.readCanAdvance)(session);
}
function readSelectedCardId(session) {
    return (0, plugin_api_1.readSelectedCardId)(session);
}

});
__pluginDefine("src/contracts.ts", (exports, module) => {
"use strict";
/**
 * Antarctica player plugin contracts.
 *
 * These types describe the game-specific content projection used by the
 * Antarctica presentation layer. They intentionally live inside the game plugin
 * because the shared player only needs generic manifest/session contracts.
 */
Object.defineProperty(exports, "__esModule", { value: true });

});
const __entry = __pluginRequire("src/index.ts");
export const activate = __entry.activate;
export default __entry;
