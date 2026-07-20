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
const board_transition_ts_1 = __pluginRequire("src/board-transition.ts");
const construction_selection_ts_1 = __pluginRequire("src/construction-selection.ts");
const country_presentation_ts_1 = __pluginRequire("src/country-presentation.ts");
const facilitator_hud_ts_1 = __pluginRequire("src/facilitator-hud.ts");
const motion_path_ts_1 = __pluginRequire("src/motion-path.ts");
const movement_selection_ts_1 = __pluginRequire("src/movement-selection.ts");
const news_presentation_ts_1 = __pluginRequire("src/news-presentation.ts");
const semantic_render_key_ts_1 = __pluginRequire("src/semantic-render-key.ts");
const team_palette_ts_1 = __pluginRequire("src/team-palette.ts");
const train_formation_selection_ts_1 = __pluginRequire("src/train-formation-selection.ts");
const vehicle_presentation_ts_1 = __pluginRequire("src/vehicle-presentation.ts");
const vehicle_layout_ts_1 = __pluginRequire("src/vehicle-layout.ts");
// The normative authoring data, source PNG and review annotations all use this
// exact plane. Keeping the renderer one-to-one prevents a correct imported
// coordinate from drifting away from the marker printed on the author map.
const DESIGN_WIDTH = 5079;
const DESIGN_HEIGHT = 3627;
const BOARD_PADDING = 0;
const CAMERA_WORLD = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_STEP = 1.15;
const LOCOMOTIVE_ORDER_BADGE_OFFSET = { x: 12, y: -13 };
const TRAIN_SELECTION_BADGE_OFFSET = { x: -13, y: -13 };
const NUMBERED_TERMINAL_ID_PATTERN = /^terminal-(?:[1-9]|1\d|2[0-3])$/;
const edgeColor = (edge) => {
    if (edge.visualState === "blocked")
        return 0xc94c4c;
    if (edge.visualState === "building")
        return 0xe0a33a;
    return 0x374b59;
};
const nodeColor = (node) => node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;
const errorText = (error) => error instanceof Error ? error.message : "Действие отклонено runtime";
/** Identify the immutable runtime revision that may change the board projection. */
const sessionRevisionKey = (session) => `${session.sessionId}:${session.version.stateVersion}`;
/** Build a scene instance exclusively from platform-injected Phaser. */
const createCardsMoneyTrainsScene = (context) => {
    const Phaser = context.Phaser;
    const contentData = context.content.content?.data;
    const countryContent = contentData !== null
        && typeof contentData === "object"
        && !Array.isArray(contentData)
        ? contentData.countries
        : undefined;
    const facilitatedSessionContent = contentData !== null
        && typeof contentData === "object"
        && !Array.isArray(contentData)
        ? contentData.facilitatedSession
        : undefined;
    const countries = (0, country_presentation_ts_1.readCountryCatalogue)(countryContent);
    const countriesById = new Map(countries.map((country) => [country.id, country]));
    const finalReflectionGuide = (0, facilitator_hud_ts_1.readFinalReflectionGuide)(facilitatedSessionContent);
    let currentSession = context.session;
    let renderedSessionRevision = sessionRevisionKey(currentSession);
    let currentActionDraft = null;
    let currentSpatialPreview = null;
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
        /**
         * The author map is immutable during a session, while roads, markers and
         * temporary previews change. Keeping separate persistent layers avoids
         * decoding and recreating the 5079×3627 background for every small update.
         */
        semanticLayer = null;
        motionLayer = null;
        vehicleLayer = null;
        semanticGraphics = null;
        previewGraphics = null;
        errorBanner = null;
        emptyStateText = null;
        /**
         * One persistent heads-up display (HUD), meaning a viewport-fixed visual
         * layer. It is isolated from the semantic network so opening a narrative
         * never rebuilds the map, roads or input zones.
         */
        countryPanelLayer = null;
        countryPanelBackdrop = null;
        countryPanelSurface = null;
        countryPanelInput = null;
        countryPanelTitle = null;
        countryPanelDescription = null;
        countryPanelClose = null;
        countryPanelPrevious = null;
        countryPanelNext = null;
        countryPanelPosition = null;
        /**
         * A viewport-fixed catalogue entry point is intentionally separate from
         * country polygons. One authored country has no numbered terminal, and the
         * polygons are still awaiting visual approval.
         */
        countryCatalogueButton = null;
        activeCountry = null;
        /** Compact team resources stay fixed above the map at discussion boundaries. */
        facilitatorHudLayer = null;
        facilitatorHudSurface = null;
        facilitatorHudInput = null;
        facilitatorHudToggle = null;
        facilitatorHudTeams = null;
        facilitatorMethodologyButton = null;
        facilitatorHudExpanded = true;
        /** Full reflection text is a local read-only overlay opened from the HUD. */
        reflectionGuideLayer = null;
        reflectionGuideBackdrop = null;
        reflectionGuideSurface = null;
        reflectionGuideInput = null;
        reflectionGuideTitle = null;
        reflectionGuideBody = null;
        reflectionGuideClose = null;
        facilitatorTeamCount = 0;
        currentProjection = null;
        lastSemanticRenderKey = null;
        lastMovementPresentationRenderKey = null;
        /** Text textures and input registrations are reconciled by stable IDs. */
        nodeLabels = new Map();
        edgeHitZones = new Map();
        nodeHitZones = new Map();
        edgeHitBindings = new Map();
        nodeHitBindings = new Map();
        vehicleMarkers = new Map();
        /** Small persistent server-order labels, reconciled independently of roads. */
        locomotiveOrderBadges = new Map();
        /** Persisted server-side wagon selections rendered independently of trains. */
        trainSelectionBadges = new Map();
        /** Input is registered once per persistent marker and only enabled as needed. */
        interactiveWagonMarkers = new Set();
        /** One reusable ring marks the current server-selected locomotive. */
        currentLocomotiveIndicator = null;
        /** Avoid regenerating Phaser text textures when ownership color is unchanged. */
        vehicleMarkerColors = new Map();
        activeVehicleMotions = new Map();
        /** Short explanatory tweens are cancelled together on a newer snapshot. */
        transientTweens = new Set();
        /** Static reduced-motion notices also expire and must be cancelled at shutdown. */
        transientTimers = new Set();
        /**
         * DOM draft updates and authoritative snapshots can arrive in one React
         * commit. Coalescing a draft repaint into a microtask lets the later
         * authoritative render supersede it instead of rebuilding the network twice.
         */
        semanticRenderScheduled = false;
        /** Prevent overlapping zones of one bent road from dispatching twice. */
        pendingHighlights = new Set();
        /** One bent road has several zones, but one click may dispatch only once. */
        pendingMovementEdges = new Set();
        /** Prevent a repeated pointer event from sending two selection intents. */
        pendingTrainWagons = new Set();
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
            this.createPersistentLayers();
            this.configureCameraInteraction();
            this.renderProjection();
        }
        /**
         * Create the expensive immutable map and the three independently updated
         * layers once. Phaser owns their destruction when the scene shuts down.
         */
        createPersistentLayers() {
            const background = this.add.graphics();
            background.fillStyle(0xf3ead8, 1);
            background.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
            if (this.textures.exists("cards-money-trains-board")) {
                this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "cards-money-trains-board")
                    .setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT);
            }
            this.semanticLayer = this.add.container(0, 0);
            this.motionLayer = this.add.container(0, 0);
            this.vehicleLayer = this.add.container(0, 0);
            this.semanticGraphics = this.add.graphics();
            this.semanticLayer.add(this.semanticGraphics);
            this.previewGraphics = this.add.graphics();
            this.currentLocomotiveIndicator = this.add.graphics();
            // The ring is painted once and only moved or hidden on later snapshots.
            // This is cheaper and calmer than a permanent attention-grabbing tween.
            this.currentLocomotiveIndicator.fillStyle(0xfff3a5, 0.5);
            this.currentLocomotiveIndicator.fillCircle(0, 0, 16);
            this.currentLocomotiveIndicator.lineStyle(4, 0xd06424, 1);
            this.currentLocomotiveIndicator.strokeCircle(0, 0, 18);
            this.currentLocomotiveIndicator.setVisible(false);
            this.vehicleLayer.add(this.currentLocomotiveIndicator);
            this.errorBanner = this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 34, "", {
                color: "#ffffff",
                backgroundColor: "#9e2f2f",
                padding: { x: 28, y: 18 },
                fontFamily: "sans-serif",
                fontSize: "60px"
            }).setOrigin(0.5, 1).setVisible(false);
            this.createCountryInformationPanel();
            this.createFacilitatorHud();
        }
        /**
         * Create one reusable information panel above the map.
         *
         * `scrollFactor = 0` removes camera panning from this container. The
         * inverse zoom applied by `syncHudTransform` also cancels camera scaling,
         * so the panel keeps a stable physical size while the world is explored.
         */
        createCountryInformationPanel() {
            const layer = this.add.container(0, 0)
                .setDepth(2_000)
                .setScrollFactor(0)
                .setVisible(false);
            const backdrop = this.add.zone(0, 0, 1, 1).setInteractive();
            const surface = this.add.graphics();
            const panelInput = this.add.zone(0, 0, 1, 1).setInteractive();
            const title = this.add.text(0, 0, "", {
                color: "#fff4dc",
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "28px"
            });
            const description = this.add.text(0, 0, "", {
                color: "#f8f2e7",
                fontFamily: "sans-serif",
                fontSize: "18px",
                lineSpacing: 5
            });
            const close = this.add.text(0, 0, "×", {
                color: "#fff4dc",
                backgroundColor: "#793d35",
                padding: { x: 13, y: 5 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "28px"
            }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
            const previous = this.add.text(0, 0, "‹", {
                color: "#fff4dc",
                backgroundColor: "#334c58",
                padding: { x: 14, y: 5 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "25px"
            }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
            const next = this.add.text(0, 0, "›", {
                color: "#fff4dc",
                backgroundColor: "#334c58",
                padding: { x: 14, y: 5 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "25px"
            }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
            const position = this.add.text(0, 0, "", {
                color: "#d8cfbd",
                fontFamily: "sans-serif",
                fontSize: "14px"
            }).setOrigin(0.5, 1);
            // The dimmed backdrop closes the panel, while the panel surface itself
            // only absorbs input. Both stop propagation before it reaches map zones.
            backdrop.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.hideCountryInformation();
            });
            panelInput.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
            });
            close.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.hideCountryInformation();
            });
            previous.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.showAdjacentCountry(-1);
            });
            next.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.showAdjacentCountry(1);
            });
            layer.add([
                backdrop,
                surface,
                panelInput,
                title,
                description,
                close,
                previous,
                next,
                position
            ]);
            this.countryPanelLayer = layer;
            this.countryPanelBackdrop = backdrop;
            this.countryPanelSurface = surface;
            this.countryPanelInput = panelInput;
            this.countryPanelTitle = title;
            this.countryPanelDescription = description;
            this.countryPanelClose = close;
            this.countryPanelPrevious = previous;
            this.countryPanelNext = next;
            this.countryPanelPosition = position;
            const catalogueButton = this.add.text(0, 0, "Страны", {
                color: "#fff4dc",
                backgroundColor: "#172b36",
                padding: { x: 16, y: 9 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "17px"
            })
                .setOrigin(1, 0)
                .setDepth(1_900)
                .setScrollFactor(0)
                .setInteractive({ useHandCursor: true });
            catalogueButton.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                const firstCountry = (0, country_presentation_ts_1.countryAtOffset)(countries, null, 0);
                if (firstCountry)
                    this.showCountryInformation(firstCountry.id);
            });
            this.countryCatalogueButton = catalogueButton;
            this.layoutCountryInformationPanel();
            this.syncHudTransform();
        }
        /**
         * Create the compact facilitator summary and its read-only methodology panel.
         *
         * Both containers use the same scroll-factor and inverse-zoom technique as
         * the country catalogue, so map pan and zoom never move or resize controls.
         */
        createFacilitatorHud() {
            const layer = this.add.container(0, 0)
                .setDepth(1_900)
                .setScrollFactor(0)
                .setVisible(false);
            const surface = this.add.graphics();
            const input = this.add.zone(0, 0, 1, 1).setInteractive();
            const toggle = this.add.text(0, 0, "Команды ▾", {
                color: "#fff4dc",
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "17px"
            }).setInteractive({ useHandCursor: true });
            const teams = this.add.text(0, 0, "", {
                color: "#f8f2e7",
                fontFamily: "sans-serif",
                fontSize: "14px",
                lineSpacing: 5
            });
            const methodology = this.add.text(0, 0, "Методика", {
                color: "#14262f",
                backgroundColor: "#f1dfb8",
                padding: { x: 12, y: 7 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "14px"
            })
                .setOrigin(1, 0)
                .setVisible(finalReflectionGuide !== null)
                .setInteractive({ useHandCursor: true });
            input.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
            });
            toggle.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.facilitatorHudExpanded = !this.facilitatorHudExpanded;
                toggle.setText(this.facilitatorHudExpanded ? "Команды ▾" : "Команды ▸");
                this.layoutFacilitatorHud();
            });
            methodology.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.showReflectionGuide();
            });
            layer.add([surface, input, toggle, teams, methodology]);
            this.facilitatorHudLayer = layer;
            this.facilitatorHudSurface = surface;
            this.facilitatorHudInput = input;
            this.facilitatorHudToggle = toggle;
            this.facilitatorHudTeams = teams;
            this.facilitatorMethodologyButton = methodology;
            this.createReflectionGuidePanel();
            this.layoutFacilitatorHud();
            this.syncHudTransform();
        }
        /** Create one reusable modal for the immutable final-reflection guide. */
        createReflectionGuidePanel() {
            const layer = this.add.container(0, 0)
                .setDepth(2_100)
                .setScrollFactor(0)
                .setVisible(false);
            const backdrop = this.add.zone(0, 0, 1, 1).setInteractive();
            const surface = this.add.graphics();
            const input = this.add.zone(0, 0, 1, 1).setInteractive();
            const title = this.add.text(0, 0, "Итоговая рефлексия", {
                color: "#fff4dc",
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "28px"
            });
            const body = this.add.text(0, 0, "", {
                color: "#f8f2e7",
                fontFamily: "sans-serif",
                fontSize: "18px",
                lineSpacing: 6
            });
            const close = this.add.text(0, 0, "×", {
                color: "#fff4dc",
                backgroundColor: "#793d35",
                padding: { x: 13, y: 5 },
                fontFamily: "sans-serif",
                fontStyle: "bold",
                fontSize: "28px"
            }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
            backdrop.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.hideReflectionGuide();
            });
            input.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
            });
            close.on("pointerdown", (_pointer, _localX, _localY, event) => {
                event?.stopPropagation?.();
                this.hideReflectionGuide();
            });
            layer.add([backdrop, surface, input, title, body, close]);
            this.reflectionGuideLayer = layer;
            this.reflectionGuideBackdrop = backdrop;
            this.reflectionGuideSurface = surface;
            this.reflectionGuideInput = input;
            this.reflectionGuideTitle = title;
            this.reflectionGuideBody = body;
            this.reflectionGuideClose = close;
            if (finalReflectionGuide) {
                body.setText([
                    `Подготовка команд: ${finalReflectionGuide.preparationMinutes.min}–${finalReflectionGuide.preparationMinutes.max} минут`,
                    `Выступление каждой команды: до ${finalReflectionGuide.presentationMinutesMax} минут`,
                    "",
                    ...finalReflectionGuide.questions.map((question, index) => `${index + 1}. ${question}`),
                    "",
                    `После выступлений сформулируйте ${finalReflectionGuide.conclusionCount.min}–${finalReflectionGuide.conclusionCount.max} общих вывода.`
                ]);
            }
            this.layoutReflectionGuidePanel();
        }
        /** Refresh resources from the current public snapshot without rule inference. */
        reconcileFacilitatorHud(projection) {
            const visible = (0, facilitator_hud_ts_1.isFacilitatorHudPhase)(projection.phase);
            this.facilitatorHudLayer?.setVisible(visible);
            if (!visible) {
                this.hideReflectionGuide();
                return;
            }
            const summaries = (0, facilitator_hud_ts_1.buildFacilitatorTeamSummaries)(projection);
            const teamText = summaries.length === 0
                ? "Команды пока не созданы"
                : summaries.map(facilitator_hud_ts_1.facilitatorTeamSummaryLabel).join("\n");
            if (this.facilitatorHudTeams?.text !== teamText) {
                this.facilitatorHudTeams?.setText(teamText);
            }
            this.facilitatorTeamCount = summaries.length;
            this.layoutFacilitatorHud();
        }
        /** Keep the team list compact while preserving one visible row per team. */
        layoutFacilitatorHud() {
            const layer = this.facilitatorHudLayer;
            const surface = this.facilitatorHudSurface;
            const input = this.facilitatorHudInput;
            const toggle = this.facilitatorHudToggle;
            const teams = this.facilitatorHudTeams;
            const methodology = this.facilitatorMethodologyButton;
            if (!layer || !surface || !input || !toggle || !teams || !methodology)
                return;
            const viewport = this.currentViewport();
            const panelX = 16;
            const panelY = 16;
            const panelWidth = Math.min(520, Math.max(280, viewport.width - 32));
            const listHeight = Math.max(31, this.facilitatorTeamCount * 24 + 10);
            const panelHeight = 46 + (this.facilitatorHudExpanded ? listHeight : 0);
            surface.clear();
            surface.fillStyle(0x172b36, 0.95);
            surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);
            surface.lineStyle(1, 0xf1dfb8, 0.72);
            surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);
            input
                .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
                .setSize(panelWidth, panelHeight, true);
            toggle.setPosition(panelX + 14, panelY + 13);
            methodology.setPosition(panelX + panelWidth - 10, panelY + 8);
            teams
                .setPosition(panelX + 14, panelY + 50)
                .setFixedSize(panelWidth - 28, listHeight)
                .setVisible(this.facilitatorHudExpanded);
            this.syncHudTransform();
        }
        /** Open only local immutable guidance; no Runtime command is dispatched. */
        showReflectionGuide() {
            if (!finalReflectionGuide || !this.reflectionGuideLayer)
                return;
            this.hideCountryInformation();
            this.layoutReflectionGuidePanel();
            this.reflectionGuideLayer.setVisible(true);
        }
        /** Close the local methodology surface without touching session state. */
        hideReflectionGuide() {
            this.reflectionGuideLayer?.setVisible(false);
        }
        /** Fit the five confirmed questions into the current map viewport. */
        layoutReflectionGuidePanel() {
            const layer = this.reflectionGuideLayer;
            const backdrop = this.reflectionGuideBackdrop;
            const surface = this.reflectionGuideSurface;
            const input = this.reflectionGuideInput;
            const title = this.reflectionGuideTitle;
            const body = this.reflectionGuideBody;
            const close = this.reflectionGuideClose;
            if (!layer || !backdrop || !surface || !input || !title || !body || !close)
                return;
            const viewport = this.currentViewport();
            const panelWidth = Math.min(820, Math.max(280, viewport.width - 32));
            const panelHeight = Math.min(640, Math.max(300, viewport.height - 32));
            const panelX = (viewport.width - panelWidth) / 2;
            const panelY = (viewport.height - panelHeight) / 2;
            const bodyWidth = Math.max(210, panelWidth - 48);
            const bodyHeight = Math.max(180, panelHeight - 112);
            backdrop
                .setPosition(viewport.width / 2, viewport.height / 2)
                .setSize(viewport.width, viewport.height, true);
            surface.clear();
            surface.fillStyle(0x071319, 0.72);
            surface.fillRect(0, 0, viewport.width, viewport.height);
            surface.fillStyle(0x172b36, 0.98);
            surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
            surface.lineStyle(2, 0xf1dfb8, 0.9);
            surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
            input
                .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
                .setSize(panelWidth, panelHeight, true);
            title
                .setPosition(panelX + 24, panelY + 22)
                .setWordWrapWidth(Math.max(150, panelWidth - 100), true);
            close.setPosition(panelX + panelWidth - 16, panelY + 12);
            body
                .setPosition(panelX + 24, panelY + 80)
                .setWordWrapWidth(bodyWidth, true)
                .setFixedSize(bodyWidth, bodyHeight)
                .setFontSize(viewport.width < 520 || viewport.height < 500 ? 14 : 18);
            this.syncHudTransform();
        }
        /**
         * Release scene-owned listeners before Phaser tears down its managers.
         * Ordinary DOM actions are registered separately and do not depend on this
         * lifecycle or on the camera being available.
         */
        stopProjection() {
            this.projectionReady = false;
            this.stopActiveVehicleMotions(false);
            this.stopTransientAnimations();
            this.semanticRenderScheduled = false;
            this.currentProjection = null;
            this.lastSemanticRenderKey = null;
            this.lastMovementPresentationRenderKey = null;
            this.semanticLayer = null;
            this.motionLayer = null;
            this.vehicleLayer = null;
            this.semanticGraphics = null;
            this.previewGraphics = null;
            this.currentLocomotiveIndicator = null;
            this.errorBanner = null;
            this.emptyStateText = null;
            this.countryPanelLayer = null;
            this.countryPanelBackdrop = null;
            this.countryPanelSurface = null;
            this.countryPanelInput = null;
            this.countryPanelTitle = null;
            this.countryPanelDescription = null;
            this.countryPanelClose = null;
            this.countryPanelPrevious = null;
            this.countryPanelNext = null;
            this.countryPanelPosition = null;
            this.countryCatalogueButton = null;
            this.activeCountry = null;
            this.facilitatorHudLayer = null;
            this.facilitatorHudSurface = null;
            this.facilitatorHudInput = null;
            this.facilitatorHudToggle = null;
            this.facilitatorHudTeams = null;
            this.facilitatorMethodologyButton = null;
            this.reflectionGuideLayer = null;
            this.reflectionGuideBackdrop = null;
            this.reflectionGuideSurface = null;
            this.reflectionGuideInput = null;
            this.reflectionGuideTitle = null;
            this.reflectionGuideBody = null;
            this.reflectionGuideClose = null;
            this.facilitatorTeamCount = 0;
            this.nodeLabels.clear();
            this.edgeHitZones.clear();
            this.nodeHitZones.clear();
            this.edgeHitBindings.clear();
            this.nodeHitBindings.clear();
            this.vehicleMarkers.clear();
            this.locomotiveOrderBadges.clear();
            this.trainSelectionBadges.clear();
            this.interactiveWagonMarkers.clear();
            this.vehicleMarkerColors.clear();
            this.pendingHighlights.clear();
            this.pendingMovementEdges.clear();
            this.pendingTrainWagons.clear();
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
            this.syncHudTransform();
        }
        /** Keep viewport-fixed content at one physical scale under camera zoom. */
        syncHudTransform() {
            const zoom = Math.max(0.01, this.cameras.main.zoom);
            this.countryPanelLayer?.setScale(1 / zoom);
            this.countryCatalogueButton?.setScale(1 / zoom);
            this.facilitatorHudLayer?.setScale(1 / zoom);
            this.reflectionGuideLayer?.setScale(1 / zoom);
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
            this.layoutCountryInformationPanel();
            this.layoutFacilitatorHud();
            this.layoutReflectionGuidePanel();
            if (this.overviewActive) {
                this.applyCameraView((0, camera_math_ts_1.overviewCameraView)(nextViewport, CAMERA_WORLD));
                return;
            }
            this.applyCameraView((0, camera_math_ts_1.resizeCameraView)(this.currentCameraView(), previousViewport, nextViewport, CAMERA_WORLD));
        };
        renderProjection() {
            if (!this.projectionReady)
                return;
            // A newer confirmed revision supersedes any visual transition still in
            // flight. Fast-forwarding to its previous final state prevents a backlog
            // from making the facilitator watch stale history.
            this.stopActiveVehicleMotions(true);
            this.stopTransientAnimations();
            const previousProjection = this.currentProjection;
            const projection = (0, board_state_ts_1.projectBoardSession)(currentSession);
            const transitions = (0, board_transition_ts_1.deriveBoardTransitions)(previousProjection, projection);
            this.currentProjection = projection;
            this.reconcileFacilitatorHud(projection);
            this.renderSemanticProjection(projection);
            const nextMovementPresentationKey = (0, semantic_render_key_ts_1.movementPresentationRenderKey)(projection);
            const movementPresentationChanged = nextMovementPresentationKey !== this.lastMovementPresentationRenderKey;
            this.lastMovementPresentationRenderKey = nextMovementPresentationKey;
            const toScreen = this.coordinateMapper(projection);
            this.reconcileVehicles(previousProjection, projection, transitions, toScreen, movementPresentationChanged);
            this.animateStructuralTransitions(projection, transitions, toScreen);
            this.animateVehicleRelationTransitions(previousProjection, projection, transitions, toScreen);
            this.renderSpatialPreview();
            this.renderErrorFeedback();
        }
        /**
         * Rebuild only roads, nodes and their input zones.
         *
         * The immutable map, persistent vehicle markers, preview and error layers
         * are deliberately left alone. This method is also used for a local form
         * draft, which must not cancel a confirmed movement animation.
         */
        renderSemanticProjection(projection = this.currentProjection) {
            this.semanticRenderScheduled = false;
            if (!this.projectionReady || !projection)
                return;
            const semanticLayer = this.semanticLayer;
            const graphics = this.semanticGraphics;
            if (!semanticLayer || !graphics)
                return;
            const nextRenderKey = (0, semantic_render_key_ts_1.semanticRenderKey)(projection, currentActionDraft);
            if (nextRenderKey === this.lastSemanticRenderKey)
                return;
            graphics.clear();
            // Roads and nodes are semantic session data, so they must render above
            // the decorative map rather than being muted underneath its texture.
            const toScreen = this.coordinateMapper(projection);
            this.drawEdges(graphics, projection, toScreen);
            this.drawNodes(graphics, projection, toScreen);
            if (projection.nodes.length === 0) {
                if (!this.emptyStateText) {
                    this.emptyStateText = this.add.text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, "Ожидаются авторские узлы, координаты и начальная сеть", { color: "#24343d", fontFamily: "sans-serif", fontSize: "84px", align: "center" }).setOrigin(0.5);
                    semanticLayer.add(this.emptyStateText);
                }
                this.emptyStateText.setVisible(true);
            }
            else {
                this.emptyStateText?.setVisible(false);
            }
            // Record success only after all display objects and input bindings agree.
            // A render exception must remain retryable for the same authoritative key.
            this.lastSemanticRenderKey = nextRenderKey;
        }
        /**
         * Coalesce a local draft repaint with an authoritative snapshot arriving in
         * the same task. This changes only rendering frequency, never draft state.
         */
        scheduleSemanticProjection() {
            if (this.semanticRenderScheduled)
                return;
            this.semanticRenderScheduled = true;
            queueMicrotask(() => {
                if (!this.semanticRenderScheduled || !this.projectionReady)
                    return;
                this.semanticRenderScheduled = false;
                this.renderSemanticProjection();
            });
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
            const semanticLayer = this.semanticLayer;
            if (!semanticLayer)
                return;
            const edgeHighlights = new Map(projection.highlights
                .filter((item) => item.targetType === "edge")
                .map((item) => [item.targetId, item]));
            const canSelectWaypoint = projection.availableActions.some((action) => action.actionId === construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID && action.disabled !== true);
            const canTraverse = projection.availableActions.some((action) => action.actionId === movement_selection_ts_1.MOVEMENT_TRAVERSE_ACTION_ID && action.disabled !== true);
            const selectedEdgeId = currentActionDraft?.actionId === construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID
                && typeof currentActionDraft.params.edgeId === "string"
                ? currentActionDraft.params.edgeId
                : null;
            const retainedZoneKeys = new Set();
            for (const edge of projection.edges) {
                const points = edge.points.map(toScreen);
                const highlight = edgeHighlights.get(edge.id);
                const selected = selectedEdgeId === edge.id;
                graphics.lineStyle(selected ? 12 : highlight ? 10 : 6, selected ? 0x1f8f6a : edgeColor(edge), 0.95);
                for (let index = 1; index < points.length; index += 1) {
                    const from = points[index - 1];
                    const to = points[index];
                    if (!from || !to)
                        continue;
                    const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
                    // A repeated portal is harmless route data but cannot form a useful
                    // line or hit target, so it is intentionally skipped.
                    if (length === 0)
                        continue;
                    graphics.lineBetween(from.x, from.y, to.x, to.y);
                    if (!canSelectWaypoint && !highlight?.actionId && !canTraverse)
                        continue;
                    const zoneKey = `${edge.id}\u0000${index}`;
                    retainedZoneKeys.add(zoneKey);
                    this.edgeHitBindings.set(zoneKey, {
                        edge,
                        points,
                        highlight,
                        canSelectWaypoint,
                        canTraverse
                    });
                    let hitArea = this.edgeHitZones.get(zoneKey);
                    if (!hitArea) {
                        hitArea = this.add.zone(0, 0, 1, 28);
                        semanticLayer.add(hitArea);
                        hitArea.setInteractive({ useHandCursor: true });
                        hitArea.on("pointerdown", (pointer, _localX, _localY, event) => {
                            // The stable listener reads the newest binding instead of capturing
                            // a stale snapshot each time the same road is reconciled.
                            event?.stopPropagation?.();
                            if (context.isInteractionPending())
                                return;
                            const binding = this.edgeHitBindings.get(zoneKey);
                            if (!binding)
                                return;
                            // Mutually exclusive phases normally leave one branch enabled.
                            // The explicit priority is nevertheless fail-safe for a malformed
                            // snapshot: construction draft, server highlight, then movement.
                            if (binding.canSelectWaypoint) {
                                this.selectWaypointDraft(binding.edge, binding.points, pointer);
                            }
                            else if (binding.highlight) {
                                this.dispatchHighlight(binding.highlight);
                            }
                            else if (binding.canTraverse) {
                                // The map chooses only one public edge reference. Runtime owns
                                // the current locomotive and every movement legality check.
                                this.dispatchMovementTraverse(binding.edge.id);
                            }
                        });
                        this.edgeHitZones.set(zoneKey, hitArea);
                    }
                    hitArea
                        .setPosition((from.x + to.x) / 2, (from.y + to.y) / 2)
                        .setSize(length, 28, true)
                        .setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
                }
            }
            for (const [zoneKey, hitArea] of this.edgeHitZones) {
                if (retainedZoneKeys.has(zoneKey))
                    continue;
                hitArea.destroy();
                this.edgeHitZones.delete(zoneKey);
                this.edgeHitBindings.delete(zoneKey);
            }
        }
        drawNodes(graphics, projection, toScreen) {
            const semanticLayer = this.semanticLayer;
            if (!semanticLayer)
                return;
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
            const retainedNodeIds = new Set();
            const retainedZoneIds = new Set();
            for (const node of projection.nodes) {
                retainedNodeIds.add(node.id);
                const position = toScreen(node.position);
                const highlight = highlights.get(node.id);
                const country = node.countryId ? countriesById.get(node.countryId) : undefined;
                const hasCountryInformation = Boolean(country
                    && node.objectType === "transport.terminal"
                    && NUMBERED_TERMINAL_ID_PATTERN.test(node.id));
                const selected = selectedNodeIds.has(node.id);
                graphics.fillStyle(nodeColor(node), 1);
                graphics.lineStyle(selected ? 9 : highlight ? 7 : 4, selected || highlight ? 0x2d8f6f : 0x263b46, 1);
                graphics.fillCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);
                graphics.strokeCircle(position.x, position.y, node.objectType === "transport.waypoint" ? 15 : 23);
                let label = this.nodeLabels.get(node.id);
                if (!label) {
                    label = this.add.text(0, 0, "", {
                        color: "#17252d",
                        backgroundColor: "#fffaf0cc",
                        padding: { x: 5, y: 3 },
                        fontFamily: "sans-serif",
                        fontSize: "18px"
                    }).setOrigin(0.5, 1);
                    semanticLayer.add(label);
                    this.nodeLabels.set(node.id, label);
                }
                label.setPosition(position.x, position.y - 34);
                if (label.text !== node.label)
                    label.setText(node.label);
                if (canSelectRoad || highlight?.actionId || hasCountryInformation) {
                    retainedZoneIds.add(node.id);
                    this.nodeHitBindings.set(node.id, {
                        nodeId: node.id,
                        highlight,
                        canSelectRoad,
                        countryId: hasCountryInformation ? node.countryId : null
                    });
                    // Selection targets cover the marker itself instead of only its text,
                    // so a station remains practical under zoom and on touch screens.
                    let hitArea = this.nodeHitZones.get(node.id);
                    if (!hitArea) {
                        hitArea = this.add.zone(0, 0, 56, 56);
                        semanticLayer.add(hitArea);
                        hitArea.setInteractive({ useHandCursor: true });
                        hitArea.on("pointerdown", (_pointer, _localX, _localY, event) => {
                            event?.stopPropagation?.();
                            if (context.isInteractionPending())
                                return;
                            const binding = this.nodeHitBindings.get(node.id);
                            if (!binding)
                                return;
                            const intent = (0, country_presentation_ts_1.resolveNodePointerIntent)({
                                canSelectRoad: binding.canSelectRoad,
                                hasServerHighlightAction: Boolean(binding.highlight?.actionId),
                                hasCountryInformation: Boolean(binding.countryId && countriesById.has(binding.countryId))
                            });
                            if (intent === "road-selection") {
                                this.publishActionDraft((0, construction_selection_ts_1.selectRoadDraftNode)(currentActionDraft, binding.nodeId));
                            }
                            else if (intent === "server-highlight" && binding.highlight) {
                                this.dispatchHighlight(binding.highlight);
                            }
                            else if (intent === "country-information"
                                && binding.countryId) {
                                this.showCountryInformation(binding.countryId);
                            }
                        });
                        this.nodeHitZones.set(node.id, hitArea);
                    }
                    hitArea.setPosition(position.x, position.y).setSize(56, 56, true);
                }
            }
            for (const [nodeId, label] of this.nodeLabels) {
                if (retainedNodeIds.has(nodeId))
                    continue;
                label.destroy();
                this.nodeLabels.delete(nodeId);
            }
            for (const [nodeId, hitArea] of this.nodeHitZones) {
                if (retainedZoneIds.has(nodeId))
                    continue;
                hitArea.destroy();
                this.nodeHitZones.delete(nodeId);
                this.nodeHitBindings.delete(nodeId);
            }
        }
        /** Open immutable country content without dispatching a runtime command. */
        showCountryInformation(countryId) {
            const country = countriesById.get(countryId);
            if (!country || !this.countryPanelLayer)
                return;
            this.hideReflectionGuide();
            this.activeCountry = country;
            if (this.countryPanelTitle?.text !== country.title) {
                this.countryPanelTitle?.setText(country.title);
            }
            if (this.countryPanelDescription?.text !== country.description) {
                this.countryPanelDescription?.setText(country.description);
            }
            const countryIndex = countries.findIndex((candidate) => candidate.id === country.id);
            this.countryPanelPosition?.setText(countryIndex === -1 ? "" : `${countryIndex + 1} из ${countries.length}`);
            this.layoutCountryInformationPanel();
            this.countryPanelLayer.setVisible(true);
        }
        /** Browse immutable descriptions; no game command or map inference occurs. */
        showAdjacentCountry(offset) {
            const country = (0, country_presentation_ts_1.countryAtOffset)(countries, this.activeCountry?.id ?? null, offset);
            if (country)
                this.showCountryInformation(country.id);
        }
        /** Close only the local information surface; game state is untouched. */
        hideCountryInformation() {
            this.countryPanelLayer?.setVisible(false);
            this.activeCountry = null;
        }
        /**
         * Fit the complete author narrative into the current facilitator viewport.
         *
         * Font size is bounded between 10 and 18 pixels. The estimate intentionally
         * errs on the compact side; `setFixedSize` is a final overflow guard for an
         * unexpectedly narrow host.
         */
        layoutCountryInformationPanel() {
            const layer = this.countryPanelLayer;
            const backdrop = this.countryPanelBackdrop;
            const surface = this.countryPanelSurface;
            const panelInput = this.countryPanelInput;
            const title = this.countryPanelTitle;
            const description = this.countryPanelDescription;
            const close = this.countryPanelClose;
            const previous = this.countryPanelPrevious;
            const next = this.countryPanelNext;
            const position = this.countryPanelPosition;
            if (!layer
                || !backdrop
                || !surface
                || !panelInput
                || !title
                || !description
                || !close
                || !previous
                || !next
                || !position)
                return;
            const viewport = this.currentViewport();
            const panelWidth = Math.min(780, Math.max(260, viewport.width - 32));
            const panelHeight = Math.max(220, viewport.height - 32);
            const panelX = (viewport.width - panelWidth) / 2;
            const panelY = Math.max(8, (viewport.height - panelHeight) / 2);
            const descriptionWidth = Math.max(180, panelWidth - 48);
            const descriptionHeight = Math.max(80, panelHeight - 166);
            backdrop
                .setPosition(viewport.width / 2, viewport.height / 2)
                .setSize(viewport.width, viewport.height, true);
            surface.clear();
            surface.fillStyle(0x071319, 0.72);
            surface.fillRect(0, 0, viewport.width, viewport.height);
            surface.fillStyle(0x172b36, 0.97);
            surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
            surface.lineStyle(2, 0xf1dfb8, 0.9);
            surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
            panelInput
                .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
                .setSize(panelWidth, panelHeight, true);
            title
                .setPosition(panelX + 24, panelY + 22)
                .setWordWrapWidth(Math.max(120, panelWidth - 106), true);
            close.setPosition(panelX + panelWidth - 16, panelY + 12);
            previous.setPosition(panelX + 24, panelY + panelHeight - 18);
            next.setPosition(panelX + panelWidth - 24, panelY + panelHeight - 18);
            position.setPosition(panelX + panelWidth / 2, panelY + panelHeight - 24);
            description
                .setPosition(panelX + 24, panelY + 80)
                .setWordWrapWidth(descriptionWidth, true)
                .setFixedSize(descriptionWidth, descriptionHeight);
            const narrativeLength = this.activeCountry?.description.length ?? 0;
            let fontSize = 18;
            while (fontSize > 10) {
                const approximateCharactersPerLine = Math.max(20, Math.floor(descriptionWidth / (fontSize * 0.54)));
                const approximateLines = Math.ceil(narrativeLength / approximateCharactersPerLine);
                if (approximateLines * fontSize * 1.32 <= descriptionHeight)
                    break;
                fontSize -= 1;
            }
            description.setFontSize(fontSize);
            this.countryCatalogueButton
                ?.setPosition(viewport.width - 18, 18);
            this.syncHudTransform();
        }
        /**
         * Paint the server calculation as a temporary overlay, never as a road.
         * This layer is cleared independently while the map and hit targets remain.
         */
        renderSpatialPreview() {
            const graphics = this.previewGraphics;
            const projection = this.currentProjection;
            if (!graphics || !projection)
                return;
            graphics.clear();
            const toScreen = this.coordinateMapper(projection);
            const points = currentSpatialPreview?.points.map(toScreen) ?? [];
            if (points.length < 2)
                return;
            graphics.lineStyle(14, 0x1c9e85, 0.92);
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
                graphics.fillCircle(first.x, first.y, 13);
            if (last)
                graphics.fillCircle(last.x, last.y, 13);
        }
        /** Update rejected-action feedback without rebuilding any board objects. */
        renderErrorFeedback() {
            const banner = this.errorBanner;
            if (!banner)
                return;
            banner.setText(lastError ?? "").setVisible(lastError !== null);
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
            this.renderSemanticProjection();
        }
        dispatchHighlight(highlight) {
            const pendingKey = `${highlight.targetType}:${highlight.targetId}:${highlight.actionId ?? ""}`;
            if (!highlight.actionId
                || context.isInteractionPending()
                || this.pendingHighlights.has(pendingKey))
                return;
            this.pendingHighlights.add(pendingKey);
            void context.dispatchAction(highlight.actionId, { ...highlight.params })
                .then(() => {
                lastError = null;
                this.renderErrorFeedback();
            })
                .catch((error) => {
                // The scene never applies an optimistic topology mutation. Runtime
                // refusal leaves the current snapshot in place and only adds feedback.
                lastError = errorText(error);
                this.renderErrorFeedback();
            })
                .finally(() => { this.pendingHighlights.delete(pendingKey); });
        }
        /**
         * Dispatch one server-validated traversal from an existing road hit zone.
         *
         * We do not send a locomotive id and do not filter incident roads locally.
         * A rejected edge leaves the confirmed scene untouched and uses the same
         * facilitator-visible error feedback as every other map action.
         */
        dispatchMovementTraverse(edgeId) {
            if (context.isInteractionPending()
                || this.pendingMovementEdges.size > 0)
                return;
            this.pendingMovementEdges.add(edgeId);
            void context.dispatchAction(movement_selection_ts_1.MOVEMENT_TRAVERSE_ACTION_ID, (0, movement_selection_ts_1.movementTraverseParams)(edgeId))
                .then(() => {
                lastError = null;
                this.renderErrorFeedback();
            })
                .catch((error) => {
                lastError = errorText(error);
                this.renderErrorFeedback();
            })
                .finally(() => { this.pendingMovementEdges.delete(edgeId); });
        }
        /**
         * Select or unselect one wagon from its persisted public marker.
         *
         * No node, ownership, attachment, capacity or action-point rule is repeated
         * here. A stale click is harmless because Runtime validates the complete
         * current snapshot before changing the marker.
         */
        dispatchTrainWagonSelection(wagonId) {
            const projection = this.currentProjection;
            const wagon = projection?.vehicles.find((vehicle) => vehicle.id === wagonId && vehicle.kind === "wagon");
            if (!projection
                || !wagon
                || context.isInteractionPending()
                || this.pendingTrainWagons.size > 0)
                return;
            const actionId = (0, train_formation_selection_ts_1.trainWagonSelectionActionId)(wagon, projection.currentLocomotiveId);
            const publishedAction = projection.availableActions.find((action) => action.actionId === actionId);
            if (!publishedAction || publishedAction.disabled === true)
                return;
            this.pendingTrainWagons.add(wagonId);
            void context.dispatchAction(actionId, (0, train_formation_selection_ts_1.trainWagonSelectionParams)(wagonId))
                .then(() => {
                lastError = null;
                this.renderErrorFeedback();
            })
                .catch((error) => {
                lastError = errorText(error);
                this.renderErrorFeedback();
            })
                .finally(() => { this.pendingTrainWagons.delete(wagonId); });
        }
        /**
         * Calculate stable marker positions for all vehicles sharing a node.
         *
         * The pure layout keeps confirmed attachments close together and separates
         * independent vehicles without inferring ownership or legal train makeup.
         */
        vehiclePositions(projection, toScreen) {
            return (0, vehicle_layout_ts_1.layoutVehiclePositions)({
                vehicles: projection.vehicles,
                nodePositions: new Map(projection.nodes.map((node) => [node.id, toScreen(node.position)]))
            });
        }
        /** Keep vehicle objects alive so a confirmed node change can be animated. */
        reconcileVehicles(previous, projection, transitions, toScreen, movementPresentationChanged) {
            const vehicleLayer = this.vehicleLayer;
            if (!vehicleLayer)
                return;
            const nextById = new Map(projection.vehicles.map((vehicle) => [vehicle.id, vehicle]));
            const teamsById = new Map(projection.teams.map((team) => [team.id, team]));
            const nextPositions = this.vehiclePositions(projection, toScreen);
            // The server already resolved all gameplay tie-breakers. The client maps
            // that authoritative order to small numbers and never sorts by local
            // coordinates, balances or ownership facts.
            const locomotiveOrderNumbers = new Map(projection.locomotiveOrder.map((locomotiveId, index) => [locomotiveId, index + 1]));
            const previousPositions = previous
                ? this.vehiclePositions(previous, toScreen)
                : new Map();
            const movementById = new Map(transitions
                .filter((item) => item.kind === "vehicle-moved")
                .map((item) => [item.vehicleId, item]));
            const attachmentLayoutChanged = transitions.some((item) => item.kind === "vehicle-attachment-changed");
            const currentVehicle = projection.currentLocomotiveId
                ? nextById.get(projection.currentLocomotiveId)
                : undefined;
            const hasRenderableCurrent = currentVehicle?.kind === "locomotive"
                && nextPositions.has(currentVehicle.id);
            this.currentLocomotiveIndicator?.setVisible(hasRenderableCurrent);
            const hasTrainSelectionAction = projection.availableActions.some((action) => (action.actionId === train_formation_selection_ts_1.TRAIN_WAGON_SELECT_ACTION_ID
                || action.actionId === train_formation_selection_ts_1.TRAIN_WAGON_UNSELECT_ACTION_ID)
                && action.disabled !== true);
            for (const [vehicleId, marker] of this.vehicleMarkers) {
                if (!nextById.has(vehicleId) || !nextPositions.has(vehicleId)) {
                    marker.destroy();
                    this.vehicleMarkers.delete(vehicleId);
                    this.interactiveWagonMarkers.delete(vehicleId);
                    this.vehicleMarkerColors.delete(vehicleId);
                    const badge = this.locomotiveOrderBadges.get(vehicleId);
                    badge?.destroy();
                    this.locomotiveOrderBadges.delete(vehicleId);
                    const selectionBadge = this.trainSelectionBadges.get(vehicleId);
                    selectionBadge?.destroy();
                    this.trainSelectionBadges.delete(vehicleId);
                }
            }
            for (const [vehicleId, badge] of this.locomotiveOrderBadges) {
                const vehicle = nextById.get(vehicleId);
                if (!locomotiveOrderNumbers.has(vehicleId)
                    || vehicle?.kind !== "locomotive"
                    || !nextPositions.has(vehicleId)) {
                    badge.destroy();
                    this.locomotiveOrderBadges.delete(vehicleId);
                }
            }
            for (const [vehicleId, badge] of this.trainSelectionBadges) {
                const vehicle = nextById.get(vehicleId);
                if (vehicle?.kind !== "wagon"
                    || vehicle.formationTargetLocomotiveId !== projection.currentLocomotiveId
                    || projection.currentLocomotiveId === null
                    || !nextPositions.has(vehicleId)) {
                    badge.destroy();
                    this.trainSelectionBadges.delete(vehicleId);
                }
            }
            for (const vehicle of projection.vehicles) {
                const finalPosition = nextPositions.get(vehicle.id);
                if (!finalPosition)
                    continue;
                const fallbackColor = vehicle.kind === "locomotive" ? "#273f8f" : "#8f5a27";
                const ownerColor = (0, team_palette_ts_1.teamMarkerColor)(vehicle.ownerTeamId ? teamsById.get(vehicle.ownerTeamId)?.colorId : undefined, fallbackColor);
                let marker = this.vehicleMarkers.get(vehicle.id);
                const isNewMarker = marker === undefined;
                if (!marker) {
                    marker = this.add.text(0, 0, (0, vehicle_presentation_ts_1.vehicleGlyph)(vehicle), {
                        color: ownerColor,
                        fontFamily: "sans-serif",
                        fontSize: "20px"
                    }).setOrigin(0.5);
                    marker.setName(`vehicle:${vehicle.id}`);
                    vehicleLayer.add(marker);
                    this.vehicleMarkers.set(vehicle.id, marker);
                    this.vehicleMarkerColors.set(vehicle.id, ownerColor);
                    if (vehicle.kind === "wagon") {
                        marker.on("pointerdown", () => {
                            this.dispatchTrainWagonSelection(vehicle.id);
                        });
                    }
                }
                else {
                    const nextGlyph = (0, vehicle_presentation_ts_1.vehicleGlyph)(vehicle);
                    // Phaser regenerates a text texture on setText, so do it only when
                    // loading or delivery actually changes the persistent glyph.
                    if (marker.text !== nextGlyph)
                        marker.setText(nextGlyph);
                    if (this.vehicleMarkerColors.get(vehicle.id) !== ownerColor) {
                        marker.setColor(ownerColor);
                        this.vehicleMarkerColors.set(vehicle.id, ownerColor);
                    }
                }
                if (vehicle.kind === "wagon" && hasTrainSelectionAction) {
                    if (!this.interactiveWagonMarkers.has(vehicle.id)) {
                        marker.setInteractive({ useHandCursor: true });
                        this.interactiveWagonMarkers.add(vehicle.id);
                    }
                }
                else if (this.interactiveWagonMarkers.delete(vehicle.id)) {
                    marker.disableInteractive();
                }
                const isSelectedForCurrent = vehicle.kind === "wagon"
                    && (0, train_formation_selection_ts_1.isTrainWagonSelectedForCurrent)(vehicle, projection.currentLocomotiveId);
                if (isSelectedForCurrent && !this.trainSelectionBadges.has(vehicle.id)) {
                    const badge = this.add.text(0, 0, "✓", {
                        color: "#ffffff",
                        backgroundColor: "#18785d",
                        padding: { x: 3, y: 1 },
                        fontFamily: "sans-serif",
                        fontSize: "12px"
                    }).setOrigin(0.5);
                    badge.setName(`train-selection:${vehicle.id}`);
                    vehicleLayer.add(badge);
                    this.trainSelectionBadges.set(vehicle.id, badge);
                }
                const orderNumber = vehicle.kind === "locomotive"
                    ? locomotiveOrderNumbers.get(vehicle.id)
                    : undefined;
                if (orderNumber !== undefined) {
                    let badge = this.locomotiveOrderBadges.get(vehicle.id);
                    if (!badge) {
                        badge = this.add.text(0, 0, String(orderNumber), {
                            color: "#fff8dc",
                            backgroundColor: "#263640",
                            padding: { x: 3, y: 1 },
                            fontFamily: "sans-serif",
                            fontSize: "12px"
                        }).setOrigin(0.5);
                        badge.setName(`locomotive-order:${vehicle.id}`);
                        vehicleLayer.add(badge);
                        this.locomotiveOrderBadges.set(vehicle.id, badge);
                    }
                    else if (movementPresentationChanged && badge.text !== String(orderNumber)) {
                        // Text textures are regenerated only when the server order changes.
                        badge.setText(String(orderNumber));
                    }
                }
                const movement = movementById.get(vehicle.id);
                const path = movement?.path?.map(toScreen) ?? null;
                const previousPosition = previousPositions.get(vehicle.id);
                if (!isNewMarker
                    && movement
                    && path
                    && path.length >= 2
                    && previousPosition
                    && !this.prefersReducedMotion()) {
                    this.animateVehicleAlongPath(marker, vehicle.id, path, previousPosition, finalPosition);
                    continue;
                }
                if (!isNewMarker
                    && attachmentLayoutChanged
                    && previousPosition
                    && !this.prefersReducedMotion()
                    && (previousPosition.x !== finalPosition.x || previousPosition.y !== finalPosition.y)) {
                    this.animateVehicleToPosition(marker, vehicle.id, previousPosition, finalPosition);
                }
                else {
                    this.setVehiclePresentationPosition(vehicle.id, marker, finalPosition);
                }
            }
        }
        /**
         * Move one vehicle marker together with its server-order decorations.
         *
         * Co-located locomotives already have distinct final positions from the
         * stable layout, so their badges and current ring cannot collapse onto the
         * same station centre.
         */
        setVehiclePresentationPosition(vehicleId, marker, position) {
            marker.setPosition(position.x, position.y);
            this.locomotiveOrderBadges.get(vehicleId)?.setPosition(position.x + LOCOMOTIVE_ORDER_BADGE_OFFSET.x, position.y + LOCOMOTIVE_ORDER_BADGE_OFFSET.y);
            this.trainSelectionBadges.get(vehicleId)?.setPosition(position.x + TRAIN_SELECTION_BADGE_OFFSET.x, position.y + TRAIN_SELECTION_BADGE_OFFSET.y);
            if (this.currentProjection?.currentLocomotiveId === vehicleId) {
                this.currentLocomotiveIndicator?.setPosition(position.x, position.y);
            }
        }
        /** Animate only a confirmed composition-layout change, never a game move. */
        animateVehicleToPosition(marker, vehicleId, previousPosition, finalPosition) {
            this.setVehiclePresentationPosition(vehicleId, marker, previousPosition);
            let tween;
            tween = this.tweens.add({
                targets: marker,
                x: finalPosition.x,
                y: finalPosition.y,
                duration: 260,
                ease: "Sine.easeInOut",
                onUpdate: () => {
                    this.setVehiclePresentationPosition(vehicleId, marker, { x: marker.x, y: marker.y });
                },
                onComplete: () => {
                    this.setVehiclePresentationPosition(vehicleId, marker, finalPosition);
                    if (this.activeVehicleMotions.get(vehicleId)?.tween === tween) {
                        this.activeVehicleMotions.delete(vehicleId);
                    }
                }
            });
            this.activeVehicleMotions.set(vehicleId, { tween, marker, finalPosition });
        }
        /**
         * Move one persistent marker along confirmed road geometry at constant
         * visual speed. The DOM has already applied the final numbers and remains
         * usable; this tween is explanatory feedback only.
         */
        animateVehicleAlongPath(marker, vehicleId, path, previousPosition, finalPosition) {
            const pathStart = path[0];
            const pathEnd = path.at(-1);
            if (!pathStart || !pathEnd) {
                this.setVehiclePresentationPosition(vehicleId, marker, finalPosition);
                return;
            }
            const startOffset = {
                x: previousPosition.x - pathStart.x,
                y: previousPosition.y - pathStart.y
            };
            const finalOffset = {
                x: finalPosition.x - pathEnd.x,
                y: finalPosition.y - pathEnd.y
            };
            this.setVehiclePresentationPosition(vehicleId, marker, previousPosition);
            let tween;
            tween = this.tweens.addCounter({
                from: 0,
                to: 1,
                duration: (0, motion_path_ts_1.movementDurationMs)(path),
                // Distance interpolation already normalizes the full polyline. Linear
                // easing therefore gives the promised constant visual speed.
                ease: "Linear",
                onUpdate: (activeTween) => {
                    const progress = activeTween.getValue() ?? 1;
                    const position = (0, motion_path_ts_1.pointAtPolylineProgress)(path, progress);
                    if (!position)
                        return;
                    this.setVehiclePresentationPosition(vehicleId, marker, {
                        x: position.x + startOffset.x + (finalOffset.x - startOffset.x) * progress,
                        y: position.y + startOffset.y + (finalOffset.y - startOffset.y) * progress
                    });
                },
                onComplete: () => {
                    this.setVehiclePresentationPosition(vehicleId, marker, finalPosition);
                    if (this.activeVehicleMotions.get(vehicleId)?.tween === tween) {
                        this.activeVehicleMotions.delete(vehicleId);
                    }
                }
            });
            this.activeVehicleMotions.set(vehicleId, { tween, marker, finalPosition });
        }
        /**
         * Stop stale motion either by snapping to the last confirmed target or by
         * simply releasing resources during scene shutdown.
         */
        stopActiveVehicleMotions(fastForward) {
            for (const [vehicleId, { tween, marker, finalPosition }] of this.activeVehicleMotions) {
                tween.stop();
                tween.remove();
                if (fastForward && marker.active) {
                    this.setVehiclePresentationPosition(vehicleId, marker, finalPosition);
                }
            }
            this.activeVehicleMotions.clear();
        }
        /**
         * Cancel every non-authoritative visual effect before a newer snapshot.
         *
         * Destroying only its display object leaves a Phaser tween or timer alive.
         * Tracking both prevents callbacks from touching already replaced markers
         * and avoids accumulating transition work during rapid facilitator input.
         */
        stopTransientAnimations() {
            for (const tween of this.transientTweens) {
                tween.stop();
                tween.remove();
            }
            this.transientTweens.clear();
            for (const timer of this.transientTimers) {
                timer.remove(false);
            }
            this.transientTimers.clear();
            this.motionLayer?.removeAll(true);
            for (const marker of this.vehicleMarkers.values()) {
                if (marker.active)
                    marker.setScale(1);
            }
        }
        /**
         * Briefly emphasize confirmed construction and availability changes.
         *
         * The underlying semantic layer already contains the final server state.
         * This overlay fades away and therefore cannot become a second source of
         * topology or availability.
         */
        animateStructuralTransitions(projection, transitions, toScreen) {
            const layer = this.motionLayer;
            if (!layer)
                return;
            if (this.prefersReducedMotion()) {
                this.renderReducedMotionSummary(transitions);
                return;
            }
            const edges = new Map(projection.edges.map((edge) => [edge.id, edge]));
            const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
            const teams = new Map(projection.teams.map((team) => [team.id, team]));
            let feedbackRow = 0;
            for (const transition of transitions) {
                if (transition.kind === "news-changed" || transition.kind === "team-coins-changed") {
                    const camera = this.cameras.main;
                    const label = transition.kind === "news-changed"
                        ? (0, news_presentation_ts_1.newsBannerLabel)(projection.currentNews?.id === transition.toNewsId
                            ? projection.currentNews
                            : null, transition.toNewsId)
                        : `${teams.get(transition.teamId)?.label ?? transition.teamId}: `
                            + `${transition.delta > 0 ? "+" : ""}${transition.delta}`;
                    const banner = this.add.text(camera.midPoint.x, camera.midPoint.y - (camera.height / camera.zoom) * 0.32
                        + feedbackRow * (54 / camera.zoom), label, {
                        color: "#fff7d6",
                        backgroundColor: transition.kind === "news-changed" ? "#273f8fee" : "#513b16ee",
                        padding: { x: 18, y: 10 },
                        fontFamily: "sans-serif",
                        fontSize: "38px"
                    }).setOrigin(0.5).setScale(1 / camera.zoom);
                    feedbackRow += 1;
                    layer.add(banner);
                    let tween;
                    tween = this.tweens.add({
                        targets: banner,
                        alpha: { from: 0, to: 1 },
                        duration: 160,
                        yoyo: true,
                        hold: 140,
                        ease: "Sine.easeOut",
                        onComplete: () => {
                            this.transientTweens.delete(tween);
                            banner.destroy();
                        }
                    });
                    this.transientTweens.add(tween);
                    continue;
                }
                if (transition.kind === "edge-added") {
                    const edge = edges.get(transition.edgeId);
                    if (edge)
                        this.animateConfirmedRoadTrace(layer, edge.points.map(toScreen), edgeColor(edge));
                    continue;
                }
                if (transition.kind === "node-added") {
                    const node = nodes.get(transition.nodeId);
                    if (node)
                        this.animateConfirmedNodePulse(layer, toScreen(node.position));
                    continue;
                }
                const graphics = this.add.graphics();
                let visible = false;
                if (transition.kind === "edge-visual-state-changed") {
                    const edge = edges.get(transition.edgeId);
                    const points = edge?.points.map(toScreen) ?? [];
                    graphics.lineStyle(18, edge ? edgeColor(edge) : 0x1c9e85, 0.95);
                    for (let index = 1; index < points.length; index += 1) {
                        const from = points[index - 1];
                        const to = points[index];
                        if (from && to) {
                            graphics.lineBetween(from.x, from.y, to.x, to.y);
                            visible = true;
                        }
                    }
                }
                else if (transition.kind === "node-visual-state-changed") {
                    const node = nodes.get(transition.nodeId);
                    if (node) {
                        const point = toScreen(node.position);
                        graphics.lineStyle(12, 0x1c9e85, 0.95);
                        graphics.strokeCircle(point.x, point.y, 42);
                        visible = true;
                    }
                }
                if (!visible) {
                    graphics.destroy();
                    continue;
                }
                layer.add(graphics);
                let tween;
                tween = this.tweens.add({
                    targets: graphics,
                    alpha: { from: 0.95, to: 0 },
                    duration: 450,
                    ease: "Sine.easeOut",
                    onComplete: () => {
                        this.transientTweens.delete(tween);
                        graphics.destroy();
                    }
                });
                this.transientTweens.add(tween);
            }
        }
        /** Trace a newly confirmed road progressively over its final semantic line. */
        animateConfirmedRoadTrace(layer, points, color) {
            if (points.length < 2)
                return;
            const graphics = this.add.graphics();
            layer.add(graphics);
            let tween;
            tween = this.tweens.addCounter({
                from: 0,
                to: 1,
                duration: 450,
                ease: "Sine.easeInOut",
                onUpdate: (activeTween) => {
                    const prefix = (0, motion_path_ts_1.polylinePrefixAtProgress)(points, activeTween.getValue() ?? 1);
                    graphics.clear();
                    graphics.lineStyle(18, color, 0.98);
                    for (let index = 1; index < prefix.length; index += 1) {
                        const from = prefix[index - 1];
                        const to = prefix[index];
                        if (from && to)
                            graphics.lineBetween(from.x, from.y, to.x, to.y);
                    }
                },
                onComplete: () => {
                    this.transientTweens.delete(tween);
                    graphics.destroy();
                }
            });
            this.transientTweens.add(tween);
        }
        /** Pulse a newly confirmed waypoint around its exact server-owned position. */
        animateConfirmedNodePulse(layer, point) {
            const graphics = this.add.graphics();
            graphics.lineStyle(12, 0x1c9e85, 0.98);
            graphics.strokeCircle(0, 0, 42);
            graphics.setPosition(point.x, point.y).setScale(0.55);
            layer.add(graphics);
            let tween;
            tween = this.tweens.add({
                targets: graphics,
                alpha: { from: 1, to: 0 },
                scaleX: 1.35,
                scaleY: 1.35,
                duration: 450,
                ease: "Sine.easeOut",
                onComplete: () => {
                    this.transientTweens.delete(tween);
                    graphics.destroy();
                }
            });
            this.transientTweens.add(tween);
        }
        /**
         * Reduced-motion users receive one static, time-bounded explanation instead
         * of movement, scaling or fading. The final server state is already visible.
         */
        renderReducedMotionSummary(transitions) {
            const layer = this.motionLayer;
            if (!layer || transitions.length === 0)
                return;
            const labels = new Set();
            for (const transition of transitions) {
                if (transition.kind === "vehicle-moved")
                    labels.add("техника перемещена");
                else if (transition.kind === "vehicle-cargo-changed")
                    labels.add("груз изменён");
                else if (transition.kind === "vehicle-attachment-changed")
                    labels.add("состав изменён");
                else if (transition.kind === "team-coins-changed")
                    labels.add("баланс изменён");
                else if (transition.kind === "news-changed")
                    labels.add("открыта новость");
                else if (transition.kind.startsWith("edge-") || transition.kind.startsWith("node-")) {
                    labels.add("сеть изменена");
                }
                else if (transition.kind === "vehicle-added" || transition.kind === "vehicle-removed") {
                    labels.add("состав техники изменён");
                }
            }
            if (labels.size === 0)
                return;
            const camera = this.cameras.main;
            const banner = this.add.text(camera.midPoint.x, camera.midPoint.y - (camera.height / camera.zoom) * 0.32, `Состояние обновлено: ${[...labels].join(", ")}`, {
                color: "#fff7d6",
                backgroundColor: "#273f8fee",
                padding: { x: 18, y: 10 },
                fontFamily: "sans-serif",
                fontSize: "38px"
            }).setOrigin(0.5).setScale(1 / camera.zoom);
            layer.add(banner);
            let timer;
            timer = this.time.delayedCall(1400, () => {
                this.transientTimers.delete(timer);
                banner.destroy();
            });
            this.transientTimers.add(timer);
        }
        /**
         * Explain confirmed coupling and cargo changes with short local feedback.
         *
         * Cargo markers use only public cargo endpoints and the already confirmed
         * wagon relation. Missing facts degrade to a marker pulse rather than a
         * fabricated origin or destination.
         */
        animateVehicleRelationTransitions(previous, projection, transitions, toScreen) {
            const layer = this.motionLayer;
            if (!layer || this.prefersReducedMotion())
                return;
            const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
            const previousCargo = new Map((previous?.cargos ?? []).map((cargo) => [cargo.id, cargo]));
            const nextCargo = new Map((projection.cargos ?? []).map((cargo) => [cargo.id, cargo]));
            for (const transition of transitions) {
                const marker = "vehicleId" in transition
                    ? this.vehicleMarkers.get(transition.vehicleId)
                    : undefined;
                if (!marker)
                    continue;
                if (transition.kind === "vehicle-attachment-changed") {
                    marker.setScale(1.45);
                    let tween;
                    tween = this.tweens.add({
                        targets: marker,
                        scaleX: 1,
                        scaleY: 1,
                        duration: 260,
                        ease: "Back.easeOut",
                        onComplete: () => {
                            this.transientTweens.delete(tween);
                        }
                    });
                    this.transientTweens.add(tween);
                    continue;
                }
                if (transition.kind !== "vehicle-cargo-changed")
                    continue;
                const loadingCargo = transition.toCargoId
                    ? nextCargo.get(transition.toCargoId)
                    : undefined;
                const deliveredCargo = transition.fromCargoId
                    ? previousCargo.get(transition.fromCargoId) ?? nextCargo.get(transition.fromCargoId)
                    : undefined;
                const endpointNodeId = loadingCargo?.fromNodeId ?? deliveredCargo?.toNodeId ?? null;
                const endpointNode = endpointNodeId ? nodes.get(endpointNodeId) : undefined;
                if (!endpointNode) {
                    marker.setScale(1.35);
                    let tween;
                    tween = this.tweens.add({
                        targets: marker,
                        scaleX: 1,
                        scaleY: 1,
                        duration: 240,
                        ease: "Sine.easeOut",
                        onComplete: () => {
                            this.transientTweens.delete(tween);
                        }
                    });
                    this.transientTweens.add(tween);
                    continue;
                }
                const endpoint = toScreen(endpointNode.position);
                const isLoading = loadingCargo !== undefined;
                const token = this.add.text(isLoading ? endpoint.x : marker.x, isLoading ? endpoint.y : marker.y, "●", {
                    color: "#f2c866",
                    fontFamily: "sans-serif",
                    fontSize: "28px",
                    stroke: "#513b16",
                    strokeThickness: 3
                }).setOrigin(0.5);
                layer.add(token);
                let tween;
                tween = this.tweens.add({
                    targets: token,
                    x: isLoading ? marker.x : endpoint.x,
                    y: isLoading ? marker.y : endpoint.y,
                    alpha: { from: 1, to: 0.25 },
                    duration: 320,
                    ease: "Sine.easeInOut",
                    onComplete: () => {
                        this.transientTweens.delete(tween);
                        token.destroy();
                    }
                });
                this.transientTweens.add(tween);
            }
        }
        /** Respect the operating-system accessibility preference on every update. */
        prefersReducedMotion() {
            return typeof window !== "undefined"
                && typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }
    }
    const scene = new CardsMoneyTrainsScene();
    return {
        scene,
        updateSession(session) {
            const nextRevision = sessionRevisionKey(session);
            if (nextRevision === renderedSessionRevision)
                return;
            currentSession = session;
            renderedSessionRevision = nextRevision;
            lastError = null;
            scene.renderProjection();
        },
        updateActionDraft(draft) {
            currentActionDraft = draft;
            scene.scheduleSemanticProjection();
        },
        updateSpatialPreview(preview) {
            currentSpatialPreview = preview;
            scene.renderSpatialPreview();
        },
        destroy() {
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
 * Accessible action projection for the Cards Money Trains board.
 *
 * The provider is intentionally independent from Phaser. It copies actions
 * already published in the authoritative session so the host can expose its
 * ordinary keyboard controls before or without creating the visual scene.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCardsMoneyTrainsAccessibleBoardActions = void 0;
const board_state_ts_1 = __pluginRequire("src/board-state.ts");
const movement_selection_ts_1 = __pluginRequire("src/movement-selection.ts");
const train_formation_selection_ts_1 = __pluginRequire("src/train-formation-selection.ts");
const team_palette_ts_1 = __pluginRequire("src/team-palette.ts");
const CARGO_LOAD_ACTION_ID = "cargo.load";
const CARGO_PHASE_FINISH_ACTION_ID = "cargo.phase.finish";
const CARGO_DELIVER_ACTION_ID = "settlement.cargo.deliver";
const SETTLEMENT_PHASE_FINISH_ACTION_ID = "settlement.phase.finish";
const CARGO_OFFER_DRAW_ACTION_ID = "cargo.offer.draw";
const CARGO_OFFER_SELECT_ACTION_ID = "cargo.offer.select";
const CARGO_OFFER_SKIP_ACTION_ID = "cargo.offer.skip";
const CARGO_QUEUE_PREPARE_ACTION_ID = "cargo.queue.prepare";
const CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID = "construction.contribution.set";
const CONSTRUCTION_ACTION_IDS = new Set([
    CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID,
    "construction.mode.road",
    "construction.mode.waypoint",
    "construction.road.build",
    "construction.waypoint.build",
    "construction.phase.finish"
]);
const CARGO_OFFER_ACTION_IDS = new Set([
    CARGO_OFFER_DRAW_ACTION_ID,
    CARGO_OFFER_SELECT_ACTION_ID,
    CARGO_OFFER_SKIP_ACTION_ID
]);
const ADD_LOGISTICS_COMPANY_ACTION_ID = "session.setup.team.add.logistics-company";
const ADD_LOCOMOTIVE_GUILD_ACTION_ID = "session.setup.team.add.locomotive-guild";
const ADD_TEAM_ACTION_IDS = new Set([
    ADD_LOGISTICS_COMPANY_ACTION_ID,
    ADD_LOCOMOTIVE_GUILD_ACTION_ID
]);
const SETUP_WAGON_PLACE_ACTION_ID = "session.setup.place.wagon";
const SETUP_LOCOMOTIVE_PLACE_ACTION_ID = "session.setup.place.locomotive";
const MAINTENANCE_LOCOMOTIVE_ACTION_ID = "maintenance.pay.locomotive";
const MAINTENANCE_WAGON_ACTION_ID = "maintenance.pay.wagon";
const MAINTENANCE_CARGO_ACTION_ID = "maintenance.pay.held-cargo";
const EXPLICIT_FORM_ACTION_IDS = new Set([
    ...ADD_TEAM_ACTION_IDS,
    SETUP_WAGON_PLACE_ACTION_ID,
    SETUP_LOCOMOTIVE_PLACE_ACTION_ID,
    MAINTENANCE_LOCOMOTIVE_ACTION_ID,
    MAINTENANCE_WAGON_ACTION_ID,
    MAINTENANCE_CARGO_ACTION_ID
]);
const PARAMETERLESS_LIFECYCLE_ACTION_IDS = new Set([
    "cards.lifecycle.initialize",
    "session.setup.finalize",
    "session.play.start",
    "maintenance.phase.finish",
    "news.lifecycle.first-turn.skip",
    "news.lifecycle.draw",
    "news.lifecycle.stagnation"
]);
const selectOptions = (values) => values.map((value) => ({ value: value.id, label: value.label ?? value.id }));
/**
 * Reuse the plugin's closed visual palette instead of declaring another color
 * vocabulary for the form. Runtime's action schema remains authoritative for
 * whether the submitted color is accepted and still unused.
 */
const teamColorOptions = selectOptions(team_palette_ts_1.TEAM_MARKER_COLOR_IDS.map((colorId) => ({ id: colorId })));
/**
 * Name every public edge by its projected endpoint labels.
 *
 * This is an input aid, not a legality filter: closed, non-incident or otherwise
 * invalid choices remain visible and are rejected authoritatively by Runtime.
 */
const edgeSelectOptions = (projection) => selectOptions(projection.edges.map((edge) => ({
    id: edge.id,
    label: `${projection.nodes.find((node) => node.id === edge.fromNodeId)?.label ?? edge.fromNodeId}`
        + ` — ${projection.nodes.find((node) => node.id === edge.toNodeId)?.label ?? edge.toNodeId}`
})));
/** All public wagons remain input aids; Runtime filters stale or illegal choices. */
const wagonSelectOptions = (projection) => selectOptions(projection.vehicles
    .filter((vehicle) => vehicle.kind === "wagon")
    .map((vehicle) => ({ id: vehicle.id, label: vehicle.id })));
/** All public locomotives remain input aids; Runtime owns placement legality. */
const locomotiveSelectOptions = (projection) => selectOptions(projection.vehicles
    .filter((vehicle) => vehicle.kind === "locomotive")
    .map((vehicle) => ({ id: vehicle.id, label: vehicle.id })));
/**
 * Every public network node is a safe placement input aid.
 *
 * This deliberately avoids duplicating current station capacity, team order,
 * closure and setup-phase rules in the browser. Runtime rejects stale or
 * illegal choices from an otherwise public node list.
 */
const stationSelectOptions = (projection) => selectOptions(projection.nodes);
/**
 * Offer decks exist only for the numbered terminals 1–23.
 *
 * The exact ID shape deliberately excludes the separate 3,14 terminal and the
 * 9¾ waypoint. Options still come from the current public node projection, so
 * an absent or malformed terminal is never invented by the browser.
 */
const terminalDeckSelectOptions = (projection) => selectOptions(projection.nodes
    .filter((node) => node.objectType === "transport.terminal"
    && /^terminal-(?:[1-9]|1[0-9]|2[0-3])$/u.test(node.id))
    .sort((left, right) => Number(left.id.slice("terminal-".length))
    - Number(right.id.slice("terminal-".length))));
const cargoLabel = (cargo, nodeLabels) => {
    const origin = cargo.fromNodeId
        ? nodeLabels.get(cargo.fromNodeId) ?? cargo.fromNodeId
        : "неизвестный пункт";
    const destination = cargo.toNodeId
        ? nodeLabels.get(cargo.toNodeId) ?? cargo.toNodeId
        : "неизвестный пункт";
    const payout = cargo.payout === null ? "" : ` · ${cargo.payout} монет`;
    return `${origin} → ${destination}${payout}`;
};
/**
 * Name only publicly available cargo by its public route and published payout.
 *
 * The filtering prevents a large hidden deck from becoming a selector. It does
 * not prove that a specific wagon can load the order in the current snapshot.
 */
const availableCargoSelectOptions = (projection) => {
    const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
    return selectOptions((projection.cargos ?? [])
        .filter((cargo) => cargo.status === "available")
        .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};
/**
 * Maintenance may refer to a cargo already held by a wagon.
 *
 * Only cargo present in the public projection can enter this selector; hidden
 * deck cards remain excluded by `projectBoardSession`. Runtime still decides
 * whether the selected cargo actually owes maintenance.
 */
const visibleCargoSelectOptions = (projection) => {
    const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
    return selectOptions((projection.cargos ?? [])
        .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};
/**
 * The two open cards are already public `offered` entities.
 *
 * Filtering that public presentation state keeps hidden deck contents out of
 * the browser. It does not decide whether either card can still be selected.
 */
const offeredCargoSelectOptions = (projection) => {
    const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
    return selectOptions((projection.cargos ?? [])
        .filter((cargo) => cargo.status === "offered")
        .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};
/** Build a normal keyboard form from public board choices, never from rules. */
const actionFields = (action, projection) => {
    if (ADD_TEAM_ACTION_IDS.has(action.actionId)) {
        return [{
                name: "name",
                label: "Название команды",
                kind: "text",
                required: true,
                minLength: 1,
                maxLength: 80,
                pattern: ".*\\S.*"
            }, {
                name: "colorId",
                label: "Цвет команды",
                kind: "select",
                required: true,
                options: teamColorOptions
            }];
    }
    if (action.actionId === SETUP_WAGON_PLACE_ACTION_ID) {
        return [{
                name: "wagonId",
                label: "Вагон",
                kind: "select",
                required: true,
                options: wagonSelectOptions(projection)
            }, {
                name: "stationId",
                label: "Станция или полустанок",
                kind: "select",
                required: true,
                options: stationSelectOptions(projection)
            }];
    }
    if (action.actionId === SETUP_LOCOMOTIVE_PLACE_ACTION_ID) {
        return [{
                name: "locomotiveId",
                label: "Локомотив",
                kind: "select",
                required: true,
                options: locomotiveSelectOptions(projection)
            }, {
                name: "stationId",
                label: "Станция или полустанок",
                kind: "select",
                required: true,
                options: stationSelectOptions(projection)
            }];
    }
    if (action.actionId === MAINTENANCE_LOCOMOTIVE_ACTION_ID) {
        return [{
                name: "locomotiveId",
                label: "Локомотив",
                kind: "select",
                required: true,
                options: locomotiveSelectOptions(projection)
            }];
    }
    if (action.actionId === MAINTENANCE_WAGON_ACTION_ID) {
        return [{
                name: "wagonId",
                label: "Вагон",
                kind: "select",
                required: true,
                options: wagonSelectOptions(projection)
            }];
    }
    if (action.actionId === MAINTENANCE_CARGO_ACTION_ID) {
        return [{
                name: "cargoId",
                label: "Удерживаемый груз",
                kind: "select",
                required: true,
                options: visibleCargoSelectOptions(projection)
            }];
    }
    if (action.actionId === CARGO_OFFER_DRAW_ACTION_ID
        || action.actionId === CARGO_OFFER_SKIP_ACTION_ID) {
        return [{
                name: "terminalId",
                label: "Терминал",
                kind: "select",
                required: true,
                options: terminalDeckSelectOptions(projection)
            }];
    }
    if (action.actionId === CARGO_OFFER_SELECT_ACTION_ID) {
        return [{
                name: "terminalId",
                label: "Терминал",
                kind: "select",
                required: true,
                options: terminalDeckSelectOptions(projection)
            }, {
                name: "cargoId",
                label: "Открытая грузовая карта",
                kind: "select",
                required: true,
                options: offeredCargoSelectOptions(projection)
            }];
    }
    if (action.actionId === CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID) {
        return [{
                name: "teamId",
                label: "Команда",
                kind: "select",
                required: true,
                options: selectOptions(projection.teams.map((team) => ({ id: team.id, label: team.label })))
            }, {
                name: "amount",
                label: "Сумма вклада",
                kind: "number",
                required: true,
                min: 0,
                step: 1
            }];
    }
    if (action.actionId === "construction.road.build") {
        const options = selectOptions(projection.nodes);
        if (options.length < 2)
            return undefined;
        return [
            { name: "fromNodeId", label: "Первая станция", kind: "select", required: true, options },
            { name: "toNodeId", label: "Вторая станция", kind: "select", required: true, options }
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
                options: edgeSelectOptions(projection)
            },
            {
                name: "positionT",
                label: "Положение на дороге (от 0 до 1)",
                kind: "number",
                required: true,
                min: 0.01,
                max: 0.99,
                step: 0.01
            }
        ];
    }
    if (action.actionId === movement_selection_ts_1.MOVEMENT_TRAVERSE_ACTION_ID) {
        return [{
                name: "edgeId",
                label: "Дорога для движения",
                kind: "select",
                required: true,
                // Options always come from this exact public snapshot. There is no
                // fixture enum and no attempt to guess the current locomotive's routes.
                options: edgeSelectOptions(projection)
            }];
    }
    if (action.actionId === train_formation_selection_ts_1.TRAIN_WAGON_SELECT_ACTION_ID
        || action.actionId === train_formation_selection_ts_1.TRAIN_WAGON_UNSELECT_ACTION_ID) {
        return [{
                name: "wagonId",
                label: action.actionId === train_formation_selection_ts_1.TRAIN_WAGON_SELECT_ACTION_ID
                    ? "Вагон для отметки"
                    : "Вагон для снятия отметки",
                kind: "select",
                required: true,
                // Every public wagon remains visible. This is an accessible input list,
                // not a duplicate browser-side implementation of formation rules.
                options: wagonSelectOptions(projection)
            }];
    }
    if (action.actionId === CARGO_LOAD_ACTION_ID) {
        return [
            {
                name: "wagonId",
                label: "Вагон",
                kind: "select",
                required: true,
                options: wagonSelectOptions(projection)
            },
            {
                name: "cargoId",
                label: "Груз",
                kind: "select",
                required: true,
                options: availableCargoSelectOptions(projection)
            }
        ];
    }
    if (action.actionId === CARGO_DELIVER_ACTION_ID) {
        return [{
                name: "wagonId",
                label: "Вагон с доставленным грузом",
                kind: "select",
                required: true,
                // Cargo, payout and beneficiary are derived authoritatively by Runtime.
                options: wagonSelectOptions(projection)
            }];
    }
    return undefined;
};
/** Cargo workflows accept only their explicit form fields, never hidden defaults. */
const omitsFixedParams = (actionId) => EXPLICIT_FORM_ACTION_IDS.has(actionId)
    || PARAMETERLESS_LIFECYCLE_ACTION_IDS.has(actionId)
    || actionId.startsWith("news.effect.apply.")
    || actionId.startsWith("news.cargo-addition.apply.")
    || actionId.startsWith("news.apply.")
    || CARGO_OFFER_ACTION_IDS.has(actionId)
    || actionId === CARGO_QUEUE_PREPARE_ACTION_ID
    || actionId === CARGO_LOAD_ACTION_ID
    || actionId === CARGO_DELIVER_ACTION_ID
    || actionId === CARGO_PHASE_FINISH_ACTION_ID
    || actionId === SETTLEMENT_PHASE_FINISH_ACTION_ID
    || CONSTRUCTION_ACTION_IDS.has(actionId);
/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (action, projection) => {
    const fields = actionFields(action, projection);
    return {
        id: action.id,
        label: action.label,
        actionId: action.actionId,
        ...(action.description === undefined ? {} : { description: action.description }),
        ...(action.params === undefined || omitsFixedParams(action.actionId)
            ? {}
            : { params: { ...action.params } }),
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
 * The plugin does not derive topology or gameplay permission in the browser.
 */
const provideCardsMoneyTrainsAccessibleBoardActions = (session) => {
    const projection = (0, board_state_ts_1.projectBoardSession)(session);
    return projection.availableActions
        // A large manifest can publish many facilitator actions at once. Runtime's
        // current verdict is the authoritative way to keep the keyboard form
        // useful: proven-unavailable actions disappear, parameter-dependent ones
        // stay visible so the facilitator can supply their fields. Older snapshots
        // have no verdict and retain the previous presentation behavior.
        .filter((action) => action.availabilityStatus !== "unavailable")
        .map((action) => toAccessibleAction(action, projection));
};
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
const country_presentation_ts_1 = __pluginRequire("src/country-presentation.ts");
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
/** Keep the UI parser aligned with the manifest's bounded locomotive-order type. */
const MAX_LOCOMOTIVE_ORDER_ITEMS = 64;
/**
 * Sanitize only the server-published movement view.
 *
 * De-duplication is defensive rendering, not game logic: the first occurrence
 * keeps the authoritative order while malformed repeats cannot create several
 * badges for one locomotive.
 */
const readMovement = (publicState) => {
    const movement = isRecord(publicState.movement) ? publicState.movement : {};
    const rawOrder = Array.isArray(movement.locomotiveOrder) ? movement.locomotiveOrder : [];
    const seen = new Set();
    const locomotiveOrder = [];
    for (const rawId of rawOrder) {
        const id = text(rawId);
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        locomotiveOrder.push(id);
        if (locomotiveOrder.length === MAX_LOCOMOTIVE_ORDER_ITEMS)
            break;
    }
    const candidateCurrent = text(movement.currentLocomotiveId);
    return {
        locomotiveOrder,
        currentLocomotiveId: candidateCurrent && seen.has(candidateCurrent) ? candidateCurrent : null
    };
};
const point = (value) => {
    if (!isRecord(value))
        return null;
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    return x === null || y === null ? null : { x, y };
};
/**
 * Read one complete polyline only when every coordinate is finite.
 * Falling back as a whole avoids drawing a partly corrupted server route.
 */
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
            visualState: text(facets.availability) ?? "open",
            countryId: (0, country_presentation_ts_1.readCountryId)(attributes.countryId)
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
        // New server-planned roads publish a polyline. Older snapshots publish
        // only explicit endpoints, and the oldest ones rely on node positions.
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
        return [{
                id,
                kind,
                nodeId: text(attributes.nodeId),
                ownerTeamId: text(attributes.ownerTeamId),
                attachedVehicleId: text(attributes.attachedVehicleId),
                cargoId: text(attributes.cargoId),
                formationTargetLocomotiveId: text(attributes.formationTargetLocomotiveId)
            }];
    });
    return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};
const VISIBLE_CARGO_STATUSES = new Set([
    "offered",
    "available",
    "in_transit",
    "delivered"
]);
const isVisibleCargoStatus = (value) => VISIBLE_CARGO_STATUSES.has(value);
/**
 * Publish only cargo that the game model marks visible.
 *
 * This is a presentation boundary, not a legality check. In particular, the
 * `available` subset is used only to keep the load selector useful; Runtime
 * still decides whether a chosen wagon/order pair is legal in the current turn.
 */
const readCargo = (publicState) => Object.entries(objectCollection(publicState, "cargoOrders")).flatMap(([id, raw]) => {
    if (!isRecord(raw))
        return [];
    const facets = isRecord(raw.facets) ? raw.facets : {};
    const status = text(facets.status);
    if (!status || !isVisibleCargoStatus(status))
        return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    return [{
            id,
            status,
            fromNodeId: text(attributes.fromNodeId),
            toNodeId: text(attributes.toNodeId),
            payout: finiteNumber(attributes.payout)
        }];
});
const readTeams = (publicState) => {
    return Object.entries(objectCollection(publicState, "teams")).flatMap(([id, raw]) => {
        if (!isRecord(raw))
            return [];
        const attributes = isRecord(raw.attributes) ? raw.attributes : {};
        const colorId = text(attributes.colorId);
        return [{
                id,
                label: text(attributes.label) ?? id,
                type: text(attributes.type) ?? "team",
                coins: finiteNumber(attributes.coins),
                ...(colorId ? { colorId } : {})
            }];
    });
};
/** Read only the currently revealed card; absent content safely falls back to its id. */
const readCurrentNews = (publicState, currentNewsId) => {
    if (!currentNewsId)
        return null;
    const raw = objectCollection(publicState, "newsCards")[currentNewsId];
    if (!isRecord(raw)) {
        return { id: currentNewsId, number: null, text: null };
    }
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    return {
        id: currentNewsId,
        number: finiteNumber(attributes.number),
        text: text(attributes.text)
    };
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
/** Accept only the three statuses defined by the public session contract. */
const readAvailabilityStatus = (value) => value === "available"
    || value === "unavailable"
    || value === "parameter-dependent"
    ? value
    : undefined;
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
        const availabilityStatus = readAvailabilityStatus(projectedAvailability?.status);
        const serverDisabled = availabilityStatus === "unavailable";
        const authoredDisabledReason = text(raw.disabledReason) ?? text(raw.reason) ?? undefined;
        return [{
                id: text(raw.id) ?? `board-action-${index}`,
                label,
                description: serverDisabled
                    ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
                    : text(raw.description) ?? undefined,
                actionId,
                params: isRecord(raw.params) ? raw.params : undefined,
                disabled: raw.disabled === true || serverDisabled,
                ...(availabilityStatus === undefined ? {} : { availabilityStatus })
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
    const newsState = isRecord(publicState.news) ? publicState.news : {};
    const currentNewsId = text(newsState.currentCardId);
    const nodes = readNodes(publicState);
    const movement = readMovement(publicState);
    return {
        nodes,
        edges: readEdges(publicState, nodes),
        vehicles: readVehicles(publicState),
        cargos: readCargo(publicState),
        teams: readTeams(publicState),
        highlights: readHighlights(board),
        availableActions: readActions(board, readActionAvailability(session.actionAvailability)),
        bounds: readBounds(board, nodes),
        phase: text(sessionState.phase) ?? "unknown",
        turnNumber: finiteNumber(sessionState.turnNumber) ?? 0,
        ...movement,
        currentNewsId,
        currentNews: readCurrentNews(publicState, currentNewsId)
    };
}

});
__pluginDefine("src/country-presentation.ts", (exports, module) => {
"use strict";
/**
 * Safe, game-owned presentation helpers for the Guinea country catalogue.
 *
 * Country narratives come from immutable player-facing content, not from the
 * mutable session snapshot. This module only bounds and sanitizes that public
 * content for rendering; it neither infers country geometry nor changes game
 * state when a facilitator opens an information panel.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCountryId = readCountryId;
exports.readCountryCatalogue = readCountryCatalogue;
exports.countryAtOffset = countryAtOffset;
exports.resolveNodePointerIntent = resolveNodePointerIntent;
const MAX_COUNTRIES = 10;
const MAX_COUNTRY_ID_LENGTH = 64;
const MAX_COUNTRY_TITLE_LENGTH = 80;
const MAX_COUNTRY_DESCRIPTION_LENGTH = 4_000;
const COUNTRY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedText = (value, maximumLength) => {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maximumLength
        ? normalized
        : null;
};
/** Sanitize the short public-state reference before it enters a render key. */
function readCountryId(value) {
    const id = boundedText(value, MAX_COUNTRY_ID_LENGTH);
    return id && COUNTRY_ID_PATTERN.test(id) ? id : null;
}
/**
 * Read at most ten complete catalogue records from public manifest content.
 *
 * The catalog schema is validated before publication. These defensive checks
 * protect the browser from a stale or malformed package without replacing that
 * JSON Schema source of truth. Invalid or duplicate records are omitted as a
 * whole, so the panel never mixes fields from different countries.
 */
function readCountryCatalogue(value) {
    if (!isRecord(value) || !Array.isArray(value.countries))
        return Object.freeze([]);
    const seenIds = new Set();
    const countries = [];
    for (const raw of value.countries.slice(0, MAX_COUNTRIES)) {
        if (!isRecord(raw))
            continue;
        const id = readCountryId(raw.id);
        const title = boundedText(raw.title, MAX_COUNTRY_TITLE_LENGTH);
        const description = boundedText(raw.description, MAX_COUNTRY_DESCRIPTION_LENGTH);
        if (!id
            || seenIds.has(id)
            || !title
            || !description)
            continue;
        seenIds.add(id);
        countries.push(Object.freeze({ id, title, description }));
    }
    return Object.freeze(countries);
}
/**
 * Move through the already bounded catalogue without coupling navigation to
 * map geometry. Wrapping keeps the compact two-button panel useful on narrow
 * facilitator screens and also exposes the country that has no terminal.
 */
function countryAtOffset(countries, currentCountryId, offset) {
    if (countries.length === 0 || !Number.isSafeInteger(offset))
        return null;
    const currentIndex = currentCountryId === null
        ? -1
        : countries.findIndex((country) => country.id === currentCountryId);
    const normalizedStart = currentIndex === -1 ? 0 : currentIndex;
    const targetIndex = ((normalizedStart + offset) % countries.length + countries.length) % countries.length;
    return countries[targetIndex] ?? null;
}
/**
 * Keep the established map-click priority explicit and browser-testable.
 *
 * Construction selection wins first, then a server-published action. A
 * country panel is therefore only an informational fallback for an otherwise
 * idle numbered terminal.
 */
function resolveNodePointerIntent(input) {
    if (input.canSelectRoad)
        return "road-selection";
    if (input.hasServerHighlightAction)
        return "server-highlight";
    if (input.hasCountryInformation)
        return "country-information";
    return "none";
}

});
__pluginDefine("src/movement-selection.ts", (exports, module) => {
"use strict";
/**
 * Game-local input shaping for one locomotive traversal.
 *
 * The map chooses only a public road reference. Runtime owns the current
 * locomotive and validates incidence, availability, capacity and action points;
 * keeping those facts out of this helper prevents a second client-side ruleset.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOVEMENT_TRAVERSE_ACTION_ID = void 0;
exports.movementTraverseParams = movementTraverseParams;
exports.MOVEMENT_TRAVERSE_ACTION_ID = "movement.locomotive.traverse";
/** Copy the selected public edge id into the exact bounded action payload. */
function movementTraverseParams(edgeId) {
    return { edgeId };
}

});
__pluginDefine("src/train-formation-selection.ts", (exports, module) => {
"use strict";
/**
 * Game-local input shaping for refresh-safe train formation.
 *
 * The browser sends only one public wagon id. Runtime owns the current
 * locomotive, every eligibility check, the persisted selection marker and the
 * final atomic group attachment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRAIN_ATTACH_SELECTED_ACTION_ID = exports.TRAIN_WAGON_UNSELECT_ACTION_ID = exports.TRAIN_WAGON_SELECT_ACTION_ID = void 0;
exports.trainWagonSelectionParams = trainWagonSelectionParams;
exports.trainWagonSelectionActionId = trainWagonSelectionActionId;
exports.isTrainWagonSelectedForCurrent = isTrainWagonSelectedForCurrent;
exports.TRAIN_WAGON_SELECT_ACTION_ID = "movement.train.wagon.select";
exports.TRAIN_WAGON_UNSELECT_ACTION_ID = "movement.train.wagon.unselect";
exports.TRAIN_ATTACH_SELECTED_ACTION_ID = "movement.train.attach.selected";
/** Copy one public wagon reference into the exact scalar Game Intent payload. */
function trainWagonSelectionParams(wagonId) {
    return { wagonId };
}
/**
 * Project the correct explicit intent from the authoritative persisted marker.
 *
 * This does not decide whether the wagon is eligible. It only distinguishes a
 * marker already owned by the current locomotive from every other public state;
 * Runtime remains the sole legality authority and rejects stale snapshots.
 */
function trainWagonSelectionActionId(wagon, currentLocomotiveId) {
    return isTrainWagonSelectedForCurrent(wagon, currentLocomotiveId)
        ? exports.TRAIN_WAGON_UNSELECT_ACTION_ID
        : exports.TRAIN_WAGON_SELECT_ACTION_ID;
}
/** Decide only whether to paint the persisted current-locomotive selection. */
function isTrainWagonSelectedForCurrent(wagon, currentLocomotiveId) {
    return currentLocomotiveId !== null
        && wagon.formationTargetLocomotiveId === currentLocomotiveId;
}

});
__pluginDefine("src/team-palette.ts", (exports, module) => {
"use strict";
/**
 * Closed, high-contrast ownership palette for Cards Money Trains markers.
 *
 * Color IDs come from the game's bounded setup parameter. Keeping the mapping
 * inside the game plugin avoids leaking this game's visual vocabulary into the
 * generic Player host. Unknown or historic IDs use the vehicle-kind fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEAM_MARKER_COLOR_IDS = void 0;
exports.teamMarkerColor = teamMarkerColor;
const TEAM_MARKER_COLORS = {
    cobalt: "#2256a5",
    orange: "#a94f16",
    emerald: "#126b4c",
    magenta: "#9b286d",
    cyan: "#116b80",
    amber: "#8a5a00",
    violet: "#6139ad",
    lime: "#587417",
    rose: "#a9334b",
    navy: "#263b68",
    coral: "#a94332",
    charcoal: "#353535"
};
/** Resolve one bounded setup color without trusting arbitrary CSS from state. */
function teamMarkerColor(colorId, fallback) {
    return colorId && Object.prototype.hasOwnProperty.call(TEAM_MARKER_COLORS, colorId)
        ? TEAM_MARKER_COLORS[colorId]
        : fallback;
}
/** Exposed only to focused tests that prove every accepted setup id is mapped. */
exports.TEAM_MARKER_COLOR_IDS = Object.freeze(Object.keys(TEAM_MARKER_COLORS));

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
__pluginDefine("src/board-transition.ts", (exports, module) => {
"use strict";
/**
 * Derives visual transition facts between two confirmed board projections.
 *
 * The runtime remains the only source of gameplay truth. This module neither
 * validates actions nor changes game state: it compares public snapshots by
 * stable entity IDs and describes what a renderer may animate. Keeping that
 * boundary explicit prevents animation timing from affecting game rules.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveBoardTransitions = deriveBoardTransitions;
const byId = (items) => new Map(items.map((item) => [item.id, item]));
const clonePoints = (points) => points.map(({ x, y }) => ({ x, y }));
/**
 * Find a path only when the final confirmed topology contains exactly one
 * road between the old and new nodes. Roads in this game are bidirectional,
 * therefore a reverse movement receives the reversed edge polyline.
 */
const uniqueMovementPath = (edges, fromNodeId, toNodeId) => {
    const candidates = edges.filter((edge) => (edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)
        || (edge.fromNodeId === toNodeId && edge.toNodeId === fromNodeId));
    if (candidates.length !== 1)
        return null;
    const [edge] = candidates;
    if (!edge)
        return null;
    const points = clonePoints(edge.points);
    return edge.fromNodeId === fromNodeId ? points : [...points].reverse();
};
const transitionEntityId = (transition) => {
    switch (transition.kind) {
        case "vehicle-moved":
        case "vehicle-added":
        case "vehicle-removed":
        case "vehicle-attachment-changed":
        case "vehicle-cargo-changed":
            return transition.vehicleId;
        case "edge-added":
        case "edge-visual-state-changed":
            return transition.edgeId;
        case "node-added":
        case "node-visual-state-changed":
            return transition.nodeId;
        case "team-coins-changed":
            return transition.teamId;
        case "news-changed":
            return transition.toNewsId;
    }
};
/**
 * Compare Unicode code units instead of relying on the host locale. Locale
 * collation may differ between browsers and servers, while this ordering must
 * remain identical for the same pair of snapshots.
 */
const compareStableText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
/**
 * Compare two confirmed projections and return deterministic visual facts.
 *
 * The first snapshot is rendered directly: replaying its accumulated history
 * would produce misleading animations after loading or reconnecting. Events
 * are sorted by `kind`, then stable entity ID, so the same snapshots always
 * yield the same sequence regardless of collection insertion order.
 */
function deriveBoardTransitions(previous, next) {
    if (previous === null)
        return [];
    const transitions = [];
    const previousVehicles = byId(previous.vehicles);
    const nextVehicles = byId(next.vehicles);
    const previousEdges = byId(previous.edges);
    const previousNodes = byId(previous.nodes);
    const previousTeams = byId(previous.teams);
    for (const vehicle of next.vehicles) {
        const before = previousVehicles.get(vehicle.id);
        if (!before) {
            transitions.push({
                kind: "vehicle-added",
                vehicleId: vehicle.id,
                vehicle
            });
            continue;
        }
        // A route is meaningful only between two actual nodes. Appearing on or
        // leaving the map is a placement change, not a guessed movement animation.
        if (before.nodeId && vehicle.nodeId && before.nodeId !== vehicle.nodeId) {
            transitions.push({
                kind: "vehicle-moved",
                vehicleId: vehicle.id,
                fromNodeId: before.nodeId,
                toNodeId: vehicle.nodeId,
                path: uniqueMovementPath(next.edges, before.nodeId, vehicle.nodeId)
            });
        }
        const beforeAttachment = before.attachedVehicleId ?? null;
        const nextAttachment = vehicle.attachedVehicleId ?? null;
        if (beforeAttachment !== nextAttachment) {
            transitions.push({
                kind: "vehicle-attachment-changed",
                vehicleId: vehicle.id,
                fromVehicleId: beforeAttachment,
                toVehicleId: nextAttachment
            });
        }
        const beforeCargo = before.cargoId ?? null;
        const nextCargo = vehicle.cargoId ?? null;
        if (beforeCargo !== nextCargo) {
            transitions.push({
                kind: "vehicle-cargo-changed",
                vehicleId: vehicle.id,
                fromCargoId: beforeCargo,
                toCargoId: nextCargo
            });
        }
    }
    for (const vehicle of previous.vehicles) {
        if (!nextVehicles.has(vehicle.id)) {
            transitions.push({
                kind: "vehicle-removed",
                vehicleId: vehicle.id,
                vehicle
            });
        }
    }
    for (const edge of next.edges) {
        const before = previousEdges.get(edge.id);
        if (!before) {
            transitions.push({
                kind: "edge-added",
                edgeId: edge.id,
                edge
            });
        }
        else if (before.visualState !== edge.visualState) {
            transitions.push({
                kind: "edge-visual-state-changed",
                edgeId: edge.id,
                fromVisualState: before.visualState,
                toVisualState: edge.visualState
            });
        }
    }
    for (const node of next.nodes) {
        const before = previousNodes.get(node.id);
        if (!before) {
            transitions.push({
                kind: "node-added",
                nodeId: node.id,
                node
            });
        }
        else if (before.visualState !== node.visualState) {
            transitions.push({
                kind: "node-visual-state-changed",
                nodeId: node.id,
                fromVisualState: before.visualState,
                toVisualState: node.visualState
            });
        }
    }
    for (const team of next.teams) {
        const before = previousTeams.get(team.id);
        if (before && before.coins !== null && team.coins !== null && before.coins !== team.coins) {
            transitions.push({
                kind: "team-coins-changed",
                teamId: team.id,
                fromCoins: before.coins,
                toCoins: team.coins,
                delta: team.coins - before.coins
            });
        }
    }
    const previousNewsId = previous.currentNewsId ?? null;
    const nextNewsId = next.currentNewsId ?? null;
    if (nextNewsId !== null && previousNewsId !== nextNewsId) {
        transitions.push({
            kind: "news-changed",
            fromNewsId: previousNewsId,
            toNewsId: nextNewsId
        });
    }
    return transitions.sort((left, right) => {
        const byKind = compareStableText(left.kind, right.kind);
        return byKind !== 0
            ? byKind
            : compareStableText(transitionEntityId(left), transitionEntityId(right));
    });
}

});
__pluginDefine("src/construction-selection.ts", (exports, module) => {
"use strict";
/**
 * Temporary construction-selection helpers for the game-owned board plugin.
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
__pluginDefine("src/facilitator-hud.ts", (exports, module) => {
"use strict";
/**
 * Read-only presentation helpers for the facilitator heads-up display.
 *
 * A heads-up display (HUD) is a small viewport-fixed layer above the map. The
 * helpers below consume only the already public board projection and immutable
 * game content. They never decide ownership, calculate game rules, or dispatch
 * an action.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFacilitatorHudPhase = isFacilitatorHudPhase;
exports.buildFacilitatorTeamSummaries = buildFacilitatorTeamSummaries;
exports.readFinalReflectionGuide = readFinalReflectionGuide;
exports.facilitatorTeamSummaryLabel = facilitatorTeamSummaryLabel;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedText = (value, maximumLength) => {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maximumLength
        ? normalized
        : null;
};
/**
 * The facilitator summary exists only at safe discussion boundaries.
 *
 * This is a visibility rule for the game-owned renderer, not a legality rule:
 * Runtime remains the sole authority for actions available in either phase.
 */
function isFacilitatorHudPhase(phase) {
    return phase === "reporting" || phase === "methodology-pause";
}
/**
 * Count only vehicles whose current public owner is an existing team.
 *
 * Equipment returned to the market has `ownerTeamId = null` and is therefore
 * deliberately absent. Unknown owner ids are also ignored rather than being
 * silently assigned to a team by the browser.
 */
function buildFacilitatorTeamSummaries(projection) {
    const counts = new Map(projection.teams.map((team) => [
        team.id,
        { locomotives: 0, wagons: 0 }
    ]));
    for (const vehicle of projection.vehicles) {
        if (!vehicle.ownerTeamId)
            continue;
        const teamCounts = counts.get(vehicle.ownerTeamId);
        if (!teamCounts)
            continue;
        if (vehicle.kind === "locomotive")
            teamCounts.locomotives += 1;
        if (vehicle.kind === "wagon")
            teamCounts.wagons += 1;
    }
    return Object.freeze(projection.teams.map((team) => {
        const teamCounts = counts.get(team.id) ?? { locomotives: 0, wagons: 0 };
        return Object.freeze({
            id: team.id,
            label: team.label,
            coins: team.coins,
            locomotives: teamCounts.locomotives,
            wagons: teamCounts.wagons
        });
    }));
}
/**
 * Defensively read the confirmed final-reflection material from immutable
 * `facilitatedSession` content. The manifest schema remains the publication
 * source of truth; this bounded parser protects a browser using stale content.
 */
function readFinalReflectionGuide(facilitatedSessionContent) {
    if (!isRecord(facilitatedSessionContent))
        return null;
    const raw = facilitatedSessionContent.finalReflectionGuide;
    if (!isRecord(raw) || raw.workflowStatus !== "pending-author-answers") {
        return null;
    }
    const preparation = raw.preparationMinutes;
    const conclusions = raw.conclusionCount;
    const presentationMinutesMax = raw.presentationMinutesMax;
    if (!isRecord(preparation)
        || preparation.min !== 5
        || preparation.max !== 15
        || presentationMinutesMax !== 2
        || !isRecord(conclusions)
        || conclusions.min !== 2
        || conclusions.max !== 3
        || !Array.isArray(raw.questions)
        || raw.questions.length !== 5) {
        return null;
    }
    const questions = raw.questions.map((question) => boundedText(question, 240));
    if (questions.some((question) => question === null))
        return null;
    return Object.freeze({
        workflowStatus: "pending-author-answers",
        preparationMinutes: Object.freeze({ min: 5, max: 15 }),
        presentationMinutesMax: 2,
        conclusionCount: Object.freeze({ min: 2, max: 3 }),
        questions: Object.freeze(questions)
    });
}
/** Format compact utility copy without turning an absent balance into zero. */
function facilitatorTeamSummaryLabel(summary) {
    const coins = summary.coins === null ? "—" : String(summary.coins);
    return `${summary.label} · ${coins} мон. · Л ${summary.locomotives} · В ${summary.wagons}`;
}

});
__pluginDefine("src/motion-path.ts", (exports, module) => {
"use strict";
/**
 * Pure geometry helpers for confirmed board movement animations.
 *
 * These helpers know nothing about vehicles, legal routes or Phaser. Runtime
 * has already selected the route; the renderer only samples its public
 * polyline at a normalized visual progress.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.polylineLength = polylineLength;
exports.pointAtPolylineProgress = pointAtPolylineProgress;
exports.polylinePrefixAtProgress = polylinePrefixAtProgress;
exports.movementDurationMs = movementDurationMs;
const clampProgress = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
/** Return the total Euclidean length of a public road polyline. */
function polylineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to)
            continue;
        total += Math.hypot(to.x - from.x, to.y - from.y);
    }
    return total;
}
/**
 * Sample a polyline by travelled distance rather than by segment number.
 *
 * Equal progress therefore means equal visual speed even when a server route
 * contains segments with very different lengths.
 */
function pointAtPolylineProgress(points, rawProgress) {
    const first = points[0];
    if (!first)
        return null;
    const last = points.at(-1) ?? first;
    const progress = clampProgress(rawProgress);
    const total = polylineLength(points);
    if (total === 0 || progress === 0)
        return { ...first };
    if (progress === 1)
        return { ...last };
    const targetDistance = total * progress;
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to)
            continue;
        const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
        if (segmentLength === 0)
            continue;
        if (travelled + segmentLength >= targetDistance) {
            const local = (targetDistance - travelled) / segmentLength;
            return {
                x: from.x + (to.x - from.x) * local,
                y: from.y + (to.y - from.y) * local
            };
        }
        travelled += segmentLength;
    }
    return { ...last };
}
/**
 * Return the visible prefix of a polyline at normalized travelled distance.
 *
 * Construction uses this for an explanatory route trace. The final road is
 * already present in the confirmed semantic layer; this helper only controls
 * how much of the temporary highlight is visible on the current frame.
 */
function polylinePrefixAtProgress(points, rawProgress) {
    const first = points[0];
    if (!first)
        return [];
    const progress = clampProgress(rawProgress);
    if (progress === 0)
        return [{ ...first }];
    if (progress === 1)
        return points.map((point) => ({ ...point }));
    const total = polylineLength(points);
    if (total === 0)
        return [{ ...first }];
    const targetDistance = total * progress;
    const prefix = [{ ...first }];
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to)
            continue;
        const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
        if (segmentLength === 0)
            continue;
        if (travelled + segmentLength >= targetDistance) {
            const local = (targetDistance - travelled) / segmentLength;
            prefix.push({
                x: from.x + (to.x - from.x) * local,
                y: from.y + (to.y - from.y) * local
            });
            return prefix;
        }
        prefix.push({ ...to });
        travelled += segmentLength;
    }
    return prefix;
}
/** Keep movement readable without making a long route block the facilitator. */
function movementDurationMs(points) {
    return Math.round(Math.min(900, Math.max(300, polylineLength(points) * 0.45)));
}

});
__pluginDefine("src/news-presentation.ts", (exports, module) => {
"use strict";
/**
 * Human-readable, bounded label for the current news transition.
 *
 * The complete author text remains in the public snapshot. The map banner keeps
 * only a short orientation cue so it cannot cover the facilitator's workspace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.newsBannerLabel = newsBannerLabel;
const MAX_NEWS_SUMMARY_LENGTH = 110;
/** Format a revealed card and safely fall back to its stable id. */
function newsBannerLabel(news, fallbackId) {
    const heading = news?.number !== null && news?.number !== undefined
        ? `Новость №${news.number}`
        : `Новость: ${fallbackId}`;
    const normalizedText = news?.text?.replace(/\s+/gu, " ").trim() ?? "";
    if (normalizedText === "")
        return heading;
    const summary = normalizedText.length <= MAX_NEWS_SUMMARY_LENGTH
        ? normalizedText
        : `${normalizedText.slice(0, MAX_NEWS_SUMMARY_LENGTH - 1).trimEnd()}…`;
    return `${heading}: ${summary}`;
}

});
__pluginDefine("src/semantic-render-key.ts", (exports, module) => {
"use strict";
/**
 * Builds a compact identity for the part of a board projection that is painted
 * by the semantic network layer.
 *
 * Money, news, cargo and vehicle-only snapshots must not rebuild road labels or
 * Phaser input zones. Conversely, every value captured by a road/node click
 * handler is included here so an equal key is a safe reason to keep the current
 * display objects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticRenderKey = semanticRenderKey;
exports.movementPresentationRenderKey = movementPresentationRenderKey;
const construction_selection_ts_1 = __pluginRequire("src/construction-selection.ts");
const movement_selection_ts_1 = __pluginRequire("src/movement-selection.ts");
const actionEnabled = (projection, actionId) => projection.availableActions.some((action) => action.actionId === actionId && action.disabled !== true);
/**
 * Return a deterministic JSON key for roads, nodes and their current controls.
 *
 * The projection is already a bounded public runtime view. JSON serialization
 * is substantially cheaper than destroying and recreating Phaser text textures
 * and input registrations, while preserving exact finite coordinates.
 */
function semanticRenderKey(projection, draft) {
    const selectedRoadNodes = draft?.actionId === construction_selection_ts_1.ROAD_BUILD_ACTION_ID
        ? [draft.params.fromNodeId ?? null, draft.params.toNodeId ?? null]
        : null;
    const selectedWaypoint = draft?.actionId === construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID
        // The exact position is displayed by the independent server preview. The
        // semantic layer only highlights which existing edge owns the draft.
        ? draft.params.edgeId ?? null
        : null;
    return JSON.stringify({
        nodes: projection.nodes.map((node) => [
            node.id,
            node.label,
            node.objectType,
            node.position.x,
            node.position.y,
            node.visualState,
            // The country reference is captured by the persistent node input
            // binding, so a content-linking update must reconcile that binding.
            node.countryId
        ]),
        edges: projection.edges.map((edge) => [
            edge.id,
            edge.fromNodeId,
            edge.toNodeId,
            edge.visualState,
            edge.points.map((point) => [point.x, point.y])
        ]),
        highlights: projection.highlights.map((highlight) => [
            highlight.targetType,
            highlight.targetId,
            highlight.actionId,
            highlight.params
        ]),
        canSelectRoad: actionEnabled(projection, construction_selection_ts_1.ROAD_BUILD_ACTION_ID),
        canSelectWaypoint: actionEnabled(projection, construction_selection_ts_1.WAYPOINT_BUILD_ACTION_ID),
        // Traverse availability alone controls whether existing road hit zones
        // dispatch the game-local movement action. Current/order remain isolated in
        // `movementPresentationRenderKey` and never rebuild the network.
        canTraverse: actionEnabled(projection, movement_selection_ts_1.MOVEMENT_TRAVERSE_ACTION_ID),
        selectedRoadNodes,
        selectedWaypoint
    });
}
/**
 * Build the smallest identity needed by locomotive order decorations.
 *
 * This key deliberately excludes the network, money and other public objects.
 * A server change from one current locomotive to the next can therefore update
 * the small vehicle badges and indicator without rebuilding roads, node labels
 * or Phaser input zones.
 */
function movementPresentationRenderKey(projection) {
    return JSON.stringify([
        projection.locomotiveOrder,
        projection.currentLocomotiveId
    ]);
}

});
__pluginDefine("src/vehicle-presentation.ts", (exports, module) => {
"use strict";
/**
 * Pure presentation helpers for confirmed public vehicle state.
 *
 * Keeping the durable wagon glyph outside Phaser makes it testable without
 * constructing a canvas or duplicating any gameplay rule in the browser.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleGlyph = void 0;
/** Keep a loaded wagon visibly distinct after its short cargo animation ends. */
const vehicleGlyph = (vehicle) => vehicle.kind === "locomotive" ? "◆" : vehicle.cargoId ? "▣" : "■";
exports.vehicleGlyph = vehicleGlyph;

});
__pluginDefine("src/vehicle-layout.ts", (exports, module) => {
"use strict";
/**
 * Pure layout for transport markers sharing one station.
 *
 * Attached wagons are kept visually close to their locomotive. Independent
 * vehicles receive a larger gap, so coupling and uncoupling remain visible in
 * the final confirmed state even when animation is disabled.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutVehiclePositions = layoutVehiclePositions;
const TRAIN_MEMBER_GAP = 18;
const INDEPENDENT_GROUP_GAP = 40;
/** Return deterministic marker positions without deriving any gameplay rule. */
function layoutVehiclePositions({ vehicles, nodePositions }) {
    const vehiclesByNode = new Map();
    for (const vehicle of vehicles) {
        if (!vehicle.nodeId || !nodePositions.has(vehicle.nodeId))
            continue;
        const current = vehiclesByNode.get(vehicle.nodeId) ?? [];
        current.push(vehicle);
        vehiclesByNode.set(vehicle.nodeId, current);
    }
    const positions = new Map();
    for (const [nodeId, colocated] of vehiclesByNode) {
        const node = nodePositions.get(nodeId);
        if (!node)
            continue;
        const byId = new Map(colocated.map((vehicle) => [vehicle.id, vehicle]));
        const attachedByTarget = new Map();
        for (const vehicle of colocated) {
            const targetId = vehicle.attachedVehicleId ?? null;
            if (!targetId || !byId.has(targetId))
                continue;
            const attached = attachedByTarget.get(targetId) ?? [];
            attached.push(vehicle);
            attachedByTarget.set(targetId, attached);
        }
        const groupedIds = new Set();
        const groups = [];
        for (const vehicle of colocated) {
            if (groupedIds.has(vehicle.id) || byId.has(vehicle.attachedVehicleId ?? ""))
                continue;
            const group = [vehicle, ...(attachedByTarget.get(vehicle.id) ?? [])];
            for (const member of group)
                groupedIds.add(member.id);
            groups.push(group);
        }
        // Malformed cycles or chains are still rendered deterministically instead
        // of disappearing. Runtime remains responsible for relation validity.
        for (const vehicle of colocated) {
            if (!groupedIds.has(vehicle.id)) {
                groupedIds.add(vehicle.id);
                groups.push([vehicle]);
            }
        }
        const totalWidth = groups.reduce((sum, group, index) => sum
            + Math.max(0, group.length - 1) * TRAIN_MEMBER_GAP
            + (index === groups.length - 1 ? 0 : INDEPENDENT_GROUP_GAP), 0);
        let cursor = node.x - totalWidth / 2;
        for (const [groupIndex, group] of groups.entries()) {
            for (const [memberIndex, vehicle] of group.entries()) {
                positions.set(vehicle.id, {
                    x: cursor + memberIndex * TRAIN_MEMBER_GAP,
                    y: node.y + 22
                });
            }
            cursor += Math.max(0, group.length - 1) * TRAIN_MEMBER_GAP;
            if (groupIndex < groups.length - 1)
                cursor += INDEPENDENT_GROUP_GAP;
        }
    }
    return positions;
}

});
__pluginDefine("src/registration.ts", (exports, module) => {
"use strict";
/**
 * Engine-independent registration of Cards Money Trains player contributions.
 *
 * The entrypoint injects the Phaser scene factory. Keeping registration
 * separate lets ordinary Node tests verify API compatibility without loading
 * the browser-only plugin facade as an executable module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = exports.CARDS_MONEY_TRAINS_GAME_ID = void 0;
exports.registerCardsMoneyTrainsPlayer = registerCardsMoneyTrainsPlayer;
const accessible_actions_ts_1 = __pluginRequire("src/accessible-actions.ts");
exports.CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains";
exports.CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-player";
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
