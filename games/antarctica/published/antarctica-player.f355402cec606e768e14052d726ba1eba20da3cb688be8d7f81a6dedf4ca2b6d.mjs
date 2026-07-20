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
/**
 * TSK-20260719 R7 (ARC-008): metric captions, aliases and images now live in
 * the game manifest (`games/antarctica/authoring/ui/web.authoring.json`
 * `metric_specs`, compiled into `ui.manifest.json`), not in this file. The
 * manifest is the single source of truth; this file only carries the
 * unavoidable minimum described below.
 *
 * Why a minimum still exists here, instead of zero:
 * - `PlayerPluginApi.registerGameConfigData()` (see
 *   `apps/player-web/src/plugins/player-plugin-api.ts`) receives a plain,
 *   pre-built `GameConfigData` object at plugin activation time. `activate()`
 *   has no access to `PlayerFacingContent`/the compiled manifest, so this
 *   module cannot derive `fallbackMetrics` from `metric_specs` at runtime.
 * - Once registered, `resolveRegisteredGameConfigData()` (see
 *   `apps/player-web/src/presenter/game-config-registry.ts`) *replaces* the
 *   manifest-derived server default wholesale — it does not merge field by
 *   field. So whatever this file omits is simply absent, not backfilled from
 *   the manifest.
 * - The plugin bundler (`scripts/manifest-tools/build-player-web-plugin-bundles.cjs`)
 *   only allows imports from inside the plugin's own root, so this file
 *   cannot import the compiled `ui.manifest.json` to read `metric_specs` back
 *   out at build time either.
 * - `SafeModeRenderer` (`apps/player-web/src/components/safe-mode-renderer.tsx`)
 *   is the one remaining real consumer: it is the generic fallback path used
 *   when the manifest does not describe the current screen, and it renders
 *   metric badges strictly from this array (see R4b finding). Without a
 *   caption here, a safe-mode screen would show zero metric badges instead of
 *   a degraded-but-labeled one.
 *
 * What was cut to reach this minimum:
 * - `sidebarImage`/`topbarImage` are left empty. The normal (non-safe-mode)
 *   path no longer needs them: every `gameVariableComponent` in the manifest
 *   already carries its own `asset:<id>` `backgroundImage` prop (migrated in
 *   R4b), and `resolveMetricBackgroundImage()` only consults this
 *   `metricBackgroundImages` dictionary as a topbar override — with the
 *   dictionary empty, it falls through to the manifest's own value. Safe-mode
 *   badges lose their icon but keep their caption/value, which is an
 *   acceptable degradation for a rarely-hit safety net.
 * - `metricBackgroundImages` is now empty for the same reason: the topbar
 *   override it used to provide is exactly what the manifest's per-component
 *   `asset:<id>` background images already supply.
 */
exports.ANTARCTICA_GAME_CONFIG_DATA = {
    gameId: "antarctica",
    storageKey: "cubica-antarctica-session-id",
    // TSK-20260719 R4b: resolved through the game asset channel (ADR-063) by
    // the platform's resolveThemeBackgroundStyle, not a baked-in path.
    themeBackgroundImage: "asset:arctic-background",
    // Kept in sync by hand with `metric_specs` captions/aliases in
    // games/antarctica/authoring/ui/web.authoring.json (see module comment
    // above for why this cannot be derived automatically).
    fallbackMetrics: [
        { id: "remainingDays", caption: "Остаток дней", aliases: ["remainingDays", "days"], sidebarImage: "", topbarImage: "" },
        { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "", topbarImage: "" },
        { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "", topbarImage: "" },
        { id: "lid", caption: "Энергия", aliases: ["lid", "energy"], sidebarImage: "", topbarImage: "" },
        { id: "man", caption: "Контроль", aliases: ["man", "control"], sidebarImage: "", topbarImage: "" },
        { id: "stat", caption: "Статус", aliases: ["stat", "status"], sidebarImage: "", topbarImage: "" },
        { id: "cont", caption: "Контакт", aliases: ["cont", "contact"], sidebarImage: "", topbarImage: "" },
        { id: "constr", caption: "Конструктив", aliases: ["constr", "constructive"], sidebarImage: "", topbarImage: "" }
    ],
    topbarScreenKeys: [
        "board-topbar",
        "info-topbar"
    ],
    // TSK-20260719 R7: emptied — the topbar override this dictionary used to
    // provide is redundant now that every gameVariableComponent in the
    // manifest declares its own asset:<id> backgroundImage directly (R4b).
    metricBackgroundImages: {}
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
const state_resolvers_1 = __pluginRequire("src/state-resolvers.ts");
const BOARD_TOPBAR_SCREEN_KEY = "board-topbar";
const INFO_TOPBAR_SCREEN_KEY = "info-topbar";
const LEFT_SIDEBAR_SCREEN_KEY = "S1_LEFT";
const ENTRY_SCREEN_KEY = "S1";
// Antarctica uses S2 for several scenario scenes. Only these step indexes are
// board scenes, so the shared board UI variant must not capture team selection.
const ANTARCTICA_BOARD_STEP_INDEXES = new Set([9, 11, 13, 17, 19, 21, 23, 26, 28, 30, 32, 34, 36]);
const createAntarcticaConfig = (data) => {
    const topbarScreenKeys = new Set(data.topbarScreenKeys);
    return {
        gameId: data.gameId,
        storageKey: data.storageKey,
        fallbackMetrics: data.fallbackMetrics,
        topbarScreenKeys,
        metricBackgroundImages: data.metricBackgroundImages,
        themeBackgroundImage: data.themeBackgroundImage,
        resolveBoardScreenKey(stepIndex) {
            return stepIndex !== null && ANTARCTICA_BOARD_STEP_INDEXES.has(stepIndex) ? BOARD_TOPBAR_SCREEN_KEY : null;
        },
        resolveScreenKey(screenId, stepIndex, infoId, gameUi) {
            if (screenId === "S2") {
                const boardKey = this.resolveBoardScreenKey?.(stepIndex) ?? null;
                if (boardKey && gameUi?.screens[boardKey]) {
                    return boardKey;
                }
                return null;
            }
            if (screenId === "S1") {
                // ADR-093: the leftsidebar variant is a design-time choice declared in
                // the UI manifest (default_layout_mode), not a server-side UI flag.
                if (gameUi?.defaultLayoutMode === "leftsidebar" && gameUi?.screens[LEFT_SIDEBAR_SCREEN_KEY]) {
                    return LEFT_SIDEBAR_SCREEN_KEY;
                }
                if (infoId && gameUi?.screens[INFO_TOPBAR_SCREEN_KEY]) {
                    return INFO_TOPBAR_SCREEN_KEY;
                }
                if (infoId) {
                    return null;
                }
                if (gameUi?.screens[ENTRY_SCREEN_KEY]) {
                    return ENTRY_SCREEN_KEY;
                }
                return null;
            }
            if (screenId && gameUi?.screens[screenId]) {
                return screenId;
            }
            return null;
        },
        resolveLayoutMode(screenKey) {
            // Every Antarctica screen declares its own layout_mode, so the presenter
            // uses that directly (ADR-093); this remains only as a safety fallback.
            // The leftsidebar design variant maps to the leftsidebar layout, every
            // other screen uses topbar.
            if (screenKey === LEFT_SIDEBAR_SCREEN_KEY) {
                return "leftsidebar";
            }
            return "topbar";
        },
        resolveGameState(content, session) {
            const publicState = session?.state?.public;
            const gameContent = (0, state_resolvers_1.resolveAntarcticaContent)(content);
            const currentInfo = (0, state_resolvers_1.resolveCurrentInfoEntry)(gameContent, publicState);
            const currentBoard = (0, state_resolvers_1.resolveCurrentBoard)(gameContent, publicState);
            const currentTeamSelection = (0, state_resolvers_1.resolveCurrentTeamSelectionScene)(gameContent, publicState);
            const cardObjects = (0, state_resolvers_1.readCardObjects)(session);
            const selectedCardId = (0, state_resolvers_1.readSelectedCardId)(session);
            const boardCards = (0, state_resolvers_1.resolveBoardCards)(gameContent, currentBoard, cardObjects);
            const teamFlags = (0, state_resolvers_1.readTeamFlags)(session);
            const teamSelectionState = (0, state_resolvers_1.readTeamSelection)(session);
            const canAdvance = (0, state_resolvers_1.readCanAdvance)(session);
            const fallbackActions = (0, state_resolvers_1.getFallbackActionEntries)(content);
            const journalMetricSpecs = (0, state_resolvers_1.resolveJournalMetricSpecs)(content, data.fallbackMetrics);
            const journalEntries = (0, state_resolvers_1.resolveJournalEntries)(gameContent, publicState, journalMetricSpecs);
            const resolvedHintText = (0, state_resolvers_1.resolveLastInfoHintText)(gameContent, { currentInfo, currentBoard, currentTeamSelection }) ??
                content.description ??
                "Подсказка пока не загружена";
            const selectedMemberIds = teamSelectionState.selectedMemberIds ?? [];
            const pickCount = teamSelectionState.pickCount ?? 0;
            const selectedTeamMemberIds = selectedMemberIds.length > 0
                ? selectedMemberIds
                : Object.keys(teamFlags).filter((memberId) => teamFlags[memberId]?.selected);
            const selectedCard = selectedCardId && boardCards.length > 0
                ? boardCards.find((card) => card.cardId === selectedCardId) ?? null
                : null;
            // Forward navigation arrow on card/board screens (W2-B / ADR-055): the
            // arrow advances the current board step when the game allows it. The
            // advance plan is the resolved card's advanceActionId — the same action
            // the "Продолжить" continue button carries once the board can advance.
            // We gate on both canAdvance (timeline flag) and the presence of that
            // action so a click never dispatches an empty action id.
            const forwardAdvanceActionId = canAdvance && selectedCard?.advanceActionId ? selectedCard.advanceActionId : "";
            const forwardNavDisabled = forwardAdvanceActionId.length === 0;
            return {
                currentInfo,
                currentBoard,
                currentTeamSelection,
                cardObjects,
                selectedCardId,
                selectedCard,
                boardCards,
                teamFlags,
                selectedMemberIds: selectedTeamMemberIds,
                pickCount,
                canAdvance,
                forwardAdvanceActionId,
                forwardNavDisabled,
                journalEntries,
                hasJournalEntries: journalEntries.length > 0,
                journalIsEmpty: journalEntries.length === 0,
                journalEmptyMessage: "Пока нет записей о выбранных карточках.",
                hintText: resolvedHintText,
                hasHintText: resolvedHintText.trim().length > 0,
                fallbackActions
            };
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
exports.resolveJournalMetricSpecs = resolveJournalMetricSpecs;
exports.resolveCurrentInfoEntry = resolveCurrentInfoEntry;
exports.resolveCurrentBoard = resolveCurrentBoard;
exports.resolveCurrentTeamSelectionScene = resolveCurrentTeamSelectionScene;
exports.resolveBoardCards = resolveBoardCards;
exports.resolveJournalEntries = resolveJournalEntries;
exports.resolveLastInfoHintText = resolveLastInfoHintText;
exports.readCardObjects = readCardObjects;
exports.readTeamFlags = readTeamFlags;
exports.readTeamSelection = readTeamSelection;
exports.readCanAdvance = readCanAdvance;
exports.readSelectedCardId = readSelectedCardId;
const plugin_api_1 = __pluginRequire("@cubica/player-web/plugin-api");
Object.defineProperty(exports, "getFallbackActionEntries", { enumerable: true, get: function () { return plugin_api_1.getFallbackActionEntries; } });
/**
 * Reads the Antarctica-shaped public state from a session snapshot.
 *
 * We go through the generic readPublicState accessor so the plugin never
 * reaches into the raw snapshot structure directly, then cast to the
 * game-owned shape.
 */
function readAntarcticaPublicState(session) {
    return (0, plugin_api_1.readPublicState)(session);
}
/** Reads a nested record value, returning `undefined` for non-record inputs. */
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
/**
 * Flattens a runtime log entry into the shape the journal projection expects.
 *
 * Why this exists: the runtime `core.event.emit` step keeps game-defined data
 * nested under `entry.data` so a generic Presenter never has to guess which
 * arbitrary field names are platform journal metadata. A real Antarctica card
 * resolution therefore arrives as
 * `{ eventType, audience, summary, data: { cardId, entityType, displayMode, … } }`.
 * The previous flat lookups (`entry.cardId`) always missed, so every card entry
 * was filtered out and the journal rendered empty. We prefer any top-level field
 * (mock/legacy flat form) and fall back to the nested `data` field so both
 * shapes work.
 */
function normalizeLogEntry(entry) {
    const data = asRecord(entry.data) ?? {};
    const readString = (key) => {
        const flat = entry[key];
        if (typeof flat === "string") {
            return flat;
        }
        const nested = data[key];
        return typeof nested === "string" ? nested : undefined;
    };
    return {
        at: readString("at"),
        cardId: readString("cardId"),
        displayMode: readString("displayMode"),
        entityType: readString("entityType"),
        frontText: readString("frontText"),
        backText: readString("backText"),
        // The runtime keeps `summary` at the top level; it carries the card
        // resolution ("back") text, so we treat it as a back-text fallback below.
        summary: readString("summary"),
        metricsBefore: asRecord(entry.metricsBefore) ?? asRecord(data.metricsBefore),
        metricsAfter: asRecord(entry.metricsAfter) ?? asRecord(data.metricsAfter),
        metricChanges: Array.isArray(entry.metricChanges)
            ? entry.metricChanges
            : Array.isArray(data.metricChanges)
                ? data.metricChanges
                : undefined
    };
}
/**
 * Extracts Antarctica-specific content from the generic player DTO.
 */
function resolveAntarcticaContent(content) {
    return (0, plugin_api_1.resolveGameContent)(content);
}
function isMetricDefinition(value) {
    return (!!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.metricId === "string" &&
        typeof value.label === "string" &&
        (value.kind === "state" || value.kind === "computed"));
}
/**
 * Builds metric summary specs for the moves journal from game-owned metadata.
 *
 * The journal summarizes authoritative runtime metric changes. Computed values
 * such as remainingDays are intentionally excluded because runtime logs contain
 * changes to the source metric `time`, not to independently stored projection
 * values.
 */
function resolveJournalMetricSpecs(content, fallbackMetrics) {
    const contentData = content.content?.data;
    const metrics = contentData && typeof contentData === "object" && !Array.isArray(contentData)
        ? contentData.metrics
        : undefined;
    if (!Array.isArray(metrics)) {
        return fallbackMetrics;
    }
    const stateMetrics = metrics
        .filter(isMetricDefinition)
        .filter((metric) => metric.kind === "state")
        .map((metric) => ({
        id: metric.metricId,
        caption: metric.label,
        description: metric.description,
        aliases: [metric.metricId, ...(metric.aliases ?? [])],
        sidebarImage: "",
        topbarImage: ""
    }));
    return stateMetrics.length > 0 ? stateMetrics : fallbackMetrics;
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
 * Maps a card's orthogonal state facets (ADR-041) to a single presentation
 * `visualState` for the renderer (the ADR-094 flip signal).
 *
 * A resolved card shows its back (flip). Precedence: `resolved` wins over
 * `selected`, which wins over `locked`; otherwise the card is in its default
 * (front) state. This mirrors, for this plugin's board-card projection, the
 * generic object-model view rule `resolution.resolved -> visualState: "resolved"`.
 */
function resolveCardVisualState(cardState) {
    const facets = cardState?.facets;
    if (!facets) {
        return "default";
    }
    if (facets.resolution === "resolved") {
        return "resolved";
    }
    if (facets.selection === "selected") {
        return "selected";
    }
    if (facets.availability === "locked") {
        return "locked";
    }
    return "default";
}
/**
 * Resolves visible cards for the current board by card ids and session object state.
 *
 * Each visible card carries a `visualState` projected from its state facets so the
 * renderer can flip a resolved card to its back face (ADR-094). The card content
 * already includes the `backText` (the outcome) that the back face shows.
 */
function resolveBoardCards(gameContent, board, cardObjects) {
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
        const cardState = cardObjects?.[card.cardId];
        // Hidden cards are not visible
        if (cardState?.facets?.availability === "hidden") {
            return false;
        }
        return contentAvailable !== false;
    })
        .map((card) => ({
        ...card,
        visualState: resolveCardVisualState(cardObjects?.[card.cardId])
    }));
}
function isCardJournalEntry(entry) {
    const hasVisibleCardText = Boolean(entry.frontText || entry.backText || entry.summary);
    const isCardEntry = entry.displayMode === "card" || entry.entityType === "card";
    return Boolean(entry.cardId && (isCardEntry || hasVisibleCardText));
}
function metricValue(metrics, spec) {
    if (!metrics) {
        return null;
    }
    for (const key of [spec.id, ...spec.aliases]) {
        const value = metrics[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}
function formatSignedDelta(delta) {
    return delta > 0 ? `+${delta}` : String(delta);
}
/**
 * Builds a caption lookup keyed by both the metric id and each declared alias.
 *
 * The runtime `metricChanges` block keys metrics by their canonical `metricId`
 * (for example `time`), while game-owned specs may also list aliases; matching
 * on either keeps captions coming from the catalog/`metric_specs` rather than
 * being hard-coded in the template.
 */
function buildMetricCaptions(metricSpecs) {
    const captions = new Map();
    for (const spec of metricSpecs) {
        captions.set(spec.id, spec.caption);
        for (const alias of spec.aliases) {
            captions.set(alias, spec.caption);
        }
    }
    return captions;
}
/**
 * Builds the per-metric badge rows shown under one journal entry (ADR-092).
 *
 * Prefers the authoritative `metricChanges` block (before/after of the whole
 * turn); falls back to the legacy `metricsBefore/After` snapshots for mock
 * entries. Every declared public metric is emitted (matching the reference
 * journal, which shows all metrics), and `hasDelta` marks the ones that actually
 * changed so the template can hide the delta superscript for unchanged metrics.
 */
function resolveMetricRows(entry, metricSpecs) {
    const captions = buildMetricCaptions(metricSpecs);
    if (Array.isArray(entry.metricChanges) && entry.metricChanges.length > 0) {
        return entry.metricChanges
            .filter((change) => typeof change.metricId === "string")
            .map((change) => {
            const before = typeof change.before === "number" ? change.before : 0;
            const after = typeof change.after === "number" ? change.after : before;
            const delta = after - before;
            return {
                caption: captions.get(change.metricId) ?? change.metricId,
                value: after,
                previousValue: before,
                delta: formatSignedDelta(delta),
                hasDelta: delta !== 0
            };
        });
    }
    // Legacy/mock fallback: derive rows from full before/after metric snapshots.
    const rows = [];
    for (const spec of metricSpecs) {
        const before = metricValue(entry.metricsBefore, spec);
        const after = metricValue(entry.metricsAfter, spec);
        if (before === null && after === null) {
            continue;
        }
        const beforeValue = before ?? 0;
        const afterValue = after ?? beforeValue;
        const delta = afterValue - beforeValue;
        rows.push({
            caption: spec.caption,
            value: afterValue,
            previousValue: beforeValue,
            delta: formatSignedDelta(delta),
            hasDelta: delta !== 0
        });
    }
    return rows;
}
/**
 * One-line textual metric summary (changed metrics only), kept for accessibility
 * and any consumer that wants a compact string rather than the badge rows.
 */
function resolveMetricSummary(rows) {
    return rows
        .filter((row) => row.hasDelta)
        .map((row) => `${row.caption}: ${row.delta}`)
        .join(" · ");
}
/**
 * Builds the game-defined journal projection used by the UI manifest panel.
 *
 * The platform should not know Antarctica journal semantics. This projection
 * keeps only visible card choices and resolves card texts from game content.
 */
function resolveJournalEntries(gameContent, publicState, metricSpecs) {
    if (!gameContent || !Array.isArray(publicState?.log)) {
        return [];
    }
    const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
    return publicState.log
        .filter((entry) => !!entry && typeof entry === "object")
        // Flatten the runtime `{ summary, data: { … } }` envelope before filtering so
        // the card fields (nested under `data`) are visible to the projection.
        .map((entry) => normalizeLogEntry(entry))
        .filter(isCardJournalEntry)
        .map((entry) => {
        const cardId = entry.cardId ?? "";
        const card = cardsById.get(cardId);
        const frontText = entry.frontText ?? card?.summary ?? "";
        // The runtime emits the card resolution ("back") text as the top-level
        // `summary`; keep the explicit `backText` and card content as fallbacks.
        const backText = entry.backText ?? entry.summary ?? card?.backText ?? "";
        const metricRows = resolveMetricRows(entry, metricSpecs);
        const metricSummary = resolveMetricSummary(metricRows);
        if (!frontText && !backText) {
            return null;
        }
        return {
            frontText,
            backText,
            metricSummary,
            hasMetricSummary: metricSummary.length > 0,
            metricRows,
            hasMetricRows: metricRows.length > 0,
            at: entry.at ?? ""
        };
    })
        .filter((entry) => entry !== null);
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
/**
 * Reads Antarctica card object state (`public.objects.cards`) from the snapshot.
 */
function readCardObjects(session) {
    return readAntarcticaPublicState(session)?.objects?.cards ?? {};
}
/**
 * Reads Antarctica team flags (`public.flags.team`) from the snapshot.
 */
function readTeamFlags(session) {
    return readAntarcticaPublicState(session)?.flags?.team ?? {};
}
/**
 * Reads Antarctica team-selection state (`public.teamSelection`) from the snapshot.
 */
function readTeamSelection(session) {
    return readAntarcticaPublicState(session)?.teamSelection ?? {};
}
/**
 * canAdvance is a generic timeline flag; the plugin re-exports the platform
 * accessor unchanged so game code keeps a single import surface.
 */
function readCanAdvance(session) {
    return (0, plugin_api_1.readCanAdvance)(session);
}
/**
 * Reads the Antarctica selected go-card id (`public.opening.selectedCardId`).
 *
 * The selected card drives visible UI, so it is public game state. Keeping it
 * outside `secret` also lets the runtime omit the whole secret branch from
 * every player-facing snapshot.
 */
function readSelectedCardId(session) {
    return readAntarcticaPublicState(session)?.opening?.selectedCardId ?? null;
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
