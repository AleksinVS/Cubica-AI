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
  AUTHOR_STATION_DISC,
  AUTHOR_STATION_GREEN,
  AUTHOR_STATION_LABEL_INK,
  AUTHOR_STATION_LABEL_SIZE,
  AUTHOR_STATION_STYLE,
  AUTHOR_TRACK_INK,
  AUTHOR_TRACK_STYLE,
  printedNodeLabel,
  railwayTrackShapes,
  stationGearOutline
} from "./author-network-style.ts";
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
  type CanonicalPoint,
  type MethodologyPauseView
} from "./board-state.ts";
import {
  deriveBoardTransitions,
  type BoardTransition,
  type VehicleMovedTransition
} from "./board-transition.ts";
import {
  ROAD_BUILD_ACTION_ID,
  WAYPOINT_BUILD_ACTION_ID,
  selectRoadDraftNode,
  selectWaypointDraftPosition
} from "./construction-selection.ts";
import {
  countryAtOffset,
  readCountryCatalogue,
  resolveNodePointerIntent,
  type CountryContentView
} from "./country-presentation.ts";
import {
  ECONOMY_CREDIT_ACTION_ID,
  ECONOMY_DEBIT_ACTION_ID,
  economyDraftLabel,
  economyTeamLabel,
  parseEconomyDraftInput,
  projectEconomyCorrector
} from "./economy-corrector.ts";
import {
  buildFacilitatorTeamSummaries,
  facilitatorTeamSummaryLabel,
  isFacilitatorHudPhase,
  readFinalReflectionGuide,
  selectMethodologyPause
} from "./facilitator-hud.ts";
import {
  finalStandingLabel,
  type FinalRankingView
} from "./final-results-presentation.ts";
import {
  movementDurationMs,
  pointAtPolylineProgress,
  polylinePrefixAtProgress
} from "./motion-path.ts";
import {
  MOVEMENT_TRAVERSE_ACTION_ID,
  movementTraverseParams
} from "./movement-selection.ts";
import { newsBannerLabel } from "./news-presentation.ts";
import {
  movementPresentationRenderKey,
  semanticRenderKey
} from "./semantic-render-key.ts";
import { teamMarkerColor } from "./team-palette.ts";
import {
  TRAIN_WAGON_SELECT_ACTION_ID,
  TRAIN_WAGON_UNSELECT_ACTION_ID,
  isTrainWagonSelectedForCurrent,
  trainWagonSelectionActionId,
  trainWagonSelectionParams
} from "./train-formation-selection.ts";
import { vehicleGlyph } from "./vehicle-presentation.ts";
import { layoutVehiclePositions } from "./vehicle-layout.ts";

// The normative authoring data, source PNG and review annotations all use this
// exact plane. Keeping the renderer one-to-one prevents a correct imported
// coordinate from drifting away from the marker printed on the author map.
const DESIGN_WIDTH = 5079;
const DESIGN_HEIGHT = 3627;
const BOARD_PADDING = 0;
const CAMERA_WORLD = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT } as const;
const MAX_CAMERA_ZOOM = 3;
const WHEEL_ZOOM_STEP = 1.15;
const LOCOMOTIVE_ORDER_BADGE_OFFSET = { x: 12, y: -13 } as const;
const TRAIN_SELECTION_BADGE_OFFSET = { x: -13, y: -13 } as const;
const NUMBERED_TERMINAL_ID_PATTERN = /^terminal-(?:[1-9]|1\d|2[0-3])$/;
const AUTHOR_BASE_NODE_IDS = new Set([
  ...Array.from({ length: 23 }, (_, index) => `terminal-${index + 1}`),
  "terminal-3-14",
  "waypoint-9-3-4"
]);

// The author board uses a restrained printed palette. Network state must stay
// legible without turning the warm map into a generic technical graph. The
// open colours are measured from the author's own drawing of the initial
// network; see `author-network-style.ts`.
const TRACK_OPEN_COLOR = AUTHOR_TRACK_INK;
const TRACK_BLOCKED_COLOR = 0xb6403b;
const TRACK_BUILDING_COLOR = 0xb77a22;
const TRACK_SELECTED_COLOR = 0x16865a;
const TERMINAL_CONNECTED_COLOR = AUTHOR_STATION_GREEN;
const TERMINAL_BLOCKED_COLOR = 0xb6403b;
const TERMINAL_BUILDING_COLOR = 0xb77a22;
const TERMINAL_INNER_COLOR = AUTHOR_STATION_DISC;

/** Phaser text styles take a CSS colour, while shapes take a number. */
const cssColor = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

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

/** Phaser input event surface used to keep HUD clicks away from the map. */
type StopPropagationEvent = {
  stopPropagation?: () => void;
};

type EconomyDraft = {
  credit: number | null;
  debit: number | null;
};

const edgeColor = (edge: BoardEdgeView) => {
  if (edge.visualState === "blocked") return TRACK_BLOCKED_COLOR;
  if (edge.visualState === "building") return TRACK_BUILDING_COLOR;
  return TRACK_OPEN_COLOR;
};

/** Reduce long manifest labels to the short marks printed on the board. */
const nodePresentationLabel = (node: BoardNodeView) =>
  printedNodeLabel(node.id, node.label);

/** Choose a state colour without inferring whether the move itself is legal. */
const nodeMarkerColor = (node: BoardNodeView) => {
  if (node.visualState === "blocked") return TERMINAL_BLOCKED_COLOR;
  if (node.visualState === "building") return TERMINAL_BUILDING_COLOR;
  return TERMINAL_CONNECTED_COLOR;
};

const errorText = (error: unknown) => error instanceof Error ? error.message : "Действие отклонено runtime";

/** Identify the immutable runtime revision that may change the board projection. */
const sessionRevisionKey = (session: PhaserSceneContext["session"]) =>
  `${session.sessionId}:${session.version.stateVersion}`;

/** Build a scene instance exclusively from platform-injected Phaser. */
export const createCardsMoneyTrainsScene: PhaserSceneFactory = (
  context: PhaserSceneContext
): InteractiveBoardSceneHandle => {
  const Phaser = context.Phaser;
  const contentData = context.content.content?.data;
  const countryContent = contentData !== null
    && typeof contentData === "object"
    && !Array.isArray(contentData)
      ? (contentData as Record<string, unknown>).countries
      : undefined;
  const facilitatedSessionContent = contentData !== null
    && typeof contentData === "object"
    && !Array.isArray(contentData)
      ? (contentData as Record<string, unknown>).facilitatedSession
      : undefined;
  const countries = readCountryCatalogue(countryContent);
  const countriesById = new Map(countries.map((country) => [country.id, country]));
  const finalReflectionGuide = readFinalReflectionGuide(facilitatedSessionContent);
  let currentSession = context.session;
  let renderedSessionRevision = sessionRevisionKey(currentSession);
  let currentActionDraft: InteractiveBoardActionDraft | null = null;
  let currentSpatialPreview: InteractiveBoardSpatialPreview | null = null;
  let lastError: string | null = null;

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
    /**
     * The author map is immutable during a session, while roads, markers and
     * temporary previews change. Keeping separate persistent layers avoids
     * decoding and recreating the 5079×3627 background for every small update.
     */
    private semanticLayer: InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private motionLayer: InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private vehicleLayer: InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private semanticGraphics: InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private previewGraphics: InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private errorBanner: InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private emptyStateText: InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    /**
     * One persistent heads-up display (HUD), meaning a viewport-fixed visual
     * layer. It is isolated from the semantic network so opening a narrative
     * never rebuilds the map, roads or input zones.
     */
    private countryPanelLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private countryPanelBackdrop:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private countryPanelSurface:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private countryPanelInput:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private countryPanelTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private countryPanelDescription:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private countryPanelClose:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private countryPanelPrevious:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private countryPanelNext:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private countryPanelPosition:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    /**
     * A viewport-fixed catalogue entry point is intentionally separate from
     * country polygons. One authored country has no numbered terminal, and the
     * polygons are still awaiting visual approval.
     */
    private countryCatalogueButton:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private activeCountry: CountryContentView | null = null;
    /** Compact team resources stay fixed above the map at discussion boundaries. */
    private facilitatorHudLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private facilitatorHudSurface:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private facilitatorHudInput:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private facilitatorHudToggle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private facilitatorHudTeams:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private facilitatorMethodologyButton:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private facilitatorFinalResultsButton:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private facilitatorEconomyButton:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private facilitatorHudExpanded = true;
    private selectedMethodologyPause: MethodologyPauseView | null = null;
    /** Full reflection text is a local read-only overlay opened from the HUD. */
    private reflectionGuideLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private reflectionGuideBackdrop:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private reflectionGuideSurface:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private reflectionGuideInput:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private reflectionGuideTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private reflectionGuideBody:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private reflectionGuideClose:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    /** Server-calculated results stay in a local, viewport-fixed modal. */
    private finalResultsLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private finalResultsBackdrop:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private finalResultsSurface:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private finalResultsInput:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private finalResultsTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsFormula:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsLogisticsTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsLogisticsBody:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsGuildTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsGuildBody:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private finalResultsClose:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    /**
     * A completed result opens once. Closing it is a local user preference, so
     * unrelated snapshot revisions must not force the modal open again.
     */
    private autoOpenedFinalResultsKey: string | null = null;
    /** Local table drafts are not game state and never change balances directly. */
    private economyCorrectorLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private economyCorrectorBackdrop:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private economyCorrectorSurface:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    private economyCorrectorInput:
      InstanceType<typeof Phaser.GameObjects.Zone> | null = null;
    private economyCorrectorTitle:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private economyCorrectorHint:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private economyCorrectorHeaders:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private economyCorrectorRowsLayer:
      InstanceType<typeof Phaser.GameObjects.Container> | null = null;
    private economyCorrectorClose:
      InstanceType<typeof Phaser.GameObjects.Text> | null = null;
    private readonly economyDrafts = new Map<string, EconomyDraft>();
    private readonly economyRowStatuses = new Map<string, string>();
    private economyDispatchInFlight = false;
    private facilitatorTeamCount = 0;
    private currentProjection: BoardProjection | null = null;
    private lastSemanticRenderKey: string | null = null;
    private lastMovementPresentationRenderKey: string | null = null;
    /** Text textures and input registrations are reconciled by stable IDs. */
    private readonly nodeLabels = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Text>
    >();
    private readonly edgeHitZones = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Zone>
    >();
    private readonly nodeHitZones = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Zone>
    >();
    private readonly edgeHitBindings = new Map<string, {
      edge: BoardEdgeView;
      points: readonly CanonicalPoint[];
      highlight: BoardHighlightView | undefined;
      canSelectWaypoint: boolean;
      canTraverse: boolean;
    }>();
    private readonly nodeHitBindings = new Map<string, {
      nodeId: string;
      highlight: BoardHighlightView | undefined;
      canSelectRoad: boolean;
      countryId: string | null;
    }>();
    private readonly vehicleMarkers = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Text>
    >();
    /** Small persistent server-order labels, reconciled independently of roads. */
    private readonly locomotiveOrderBadges = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Text>
    >();
    /** Persisted server-side wagon selections rendered independently of trains. */
    private readonly trainSelectionBadges = new Map<
      string,
      InstanceType<typeof Phaser.GameObjects.Text>
    >();
    /** Input is registered once per persistent marker and only enabled as needed. */
    private readonly interactiveWagonMarkers = new Set<string>();
    /** One reusable ring marks the current server-selected locomotive. */
    private currentLocomotiveIndicator:
      InstanceType<typeof Phaser.GameObjects.Graphics> | null = null;
    /** Avoid regenerating Phaser text textures when ownership color is unchanged. */
    private readonly vehicleMarkerColors = new Map<string, string>();
    private readonly activeVehicleMotions = new Map<string, {
      tween: InstanceType<typeof Phaser.Tweens.Tween>;
      marker: InstanceType<typeof Phaser.GameObjects.Text>;
      finalPosition: CanonicalPoint;
    }>();
    /** Short explanatory tweens are cancelled together on a newer snapshot. */
    private readonly transientTweens = new Set<InstanceType<typeof Phaser.Tweens.Tween>>();
    /** Static reduced-motion notices also expire and must be cancelled at shutdown. */
    private readonly transientTimers = new Set<InstanceType<typeof Phaser.Time.TimerEvent>>();
    /**
     * DOM draft updates and authoritative snapshots can arrive in one React
     * commit. Coalescing a draft repaint into a microtask lets the later
     * authoritative render supersede it instead of rebuilding the network twice.
     */
    private semanticRenderScheduled = false;
    /** Prevent overlapping zones of one bent road from dispatching twice. */
    private readonly pendingHighlights = new Set<string>();
    /** One bent road has several zones, but one click may dispatch only once. */
    private readonly pendingMovementEdges = new Set<string>();
    /** Prevent a repeated pointer event from sending two selection intents. */
    private readonly pendingTrainWagons = new Set<string>();

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
    private createPersistentLayers() {
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
    private createCountryInformationPanel() {
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
      backdrop.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideCountryInformation();
      });
      panelInput.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
      });
      close.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideCountryInformation();
      });
      previous.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.showAdjacentCountry(-1);
      });
      next.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
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
      catalogueButton.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        const firstCountry = countryAtOffset(countries, null, 0);
        if (firstCountry) this.showCountryInformation(firstCountry.id);
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
    private createFacilitatorHud() {
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
      const finalResults = this.add.text(0, 0, "Итоги", {
        color: "#14262f",
        backgroundColor: "#f1dfb8",
        padding: { x: 12, y: 7 },
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "14px"
      })
        .setOrigin(1, 0)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });
      const economy = this.add.text(0, 0, "Деньги", {
        color: "#14262f",
        backgroundColor: "#f1dfb8",
        padding: { x: 12, y: 7 },
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "14px"
      })
        .setOrigin(1, 0)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });

      input.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
      });
      toggle.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.facilitatorHudExpanded = !this.facilitatorHudExpanded;
        toggle.setText(this.facilitatorHudExpanded ? "Команды ▾" : "Команды ▸");
        this.layoutFacilitatorHud();
      });
      methodology.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.showReflectionGuide();
      });
      finalResults.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.showFinalResults();
      });
      economy.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.showEconomyCorrector();
      });

      layer.add([
        surface,
        input,
        toggle,
        teams,
        methodology,
        finalResults,
        economy
      ]);
      this.facilitatorHudLayer = layer;
      this.facilitatorHudSurface = surface;
      this.facilitatorHudInput = input;
      this.facilitatorHudToggle = toggle;
      this.facilitatorHudTeams = teams;
      this.facilitatorMethodologyButton = methodology;
      this.facilitatorFinalResultsButton = finalResults;
      this.facilitatorEconomyButton = economy;
      this.createReflectionGuidePanel();
      this.createFinalResultsPanel();
      this.createEconomyCorrectorPanel();
      this.layoutFacilitatorHud();
      this.syncHudTransform();
    }

    /** Create one reusable modal for the immutable final-reflection guide. */
    private createReflectionGuidePanel() {
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

      backdrop.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideReflectionGuide();
      });
      input.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
      });
      close.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
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

      this.populateReflectionGuide();
      this.layoutReflectionGuidePanel();
    }

    /**
     * Create one reusable final-results surface.
     *
     * The panel never recalculates scores. Its rows are rendered only from the
     * bounded, internally consistent projection prepared in board-state.
     */
    private createFinalResultsPanel() {
      const layer = this.add.container(0, 0)
        .setDepth(2_200)
        .setScrollFactor(0)
        .setVisible(false);
      const backdrop = this.add.zone(0, 0, 1, 1).setInteractive();
      const surface = this.add.graphics();
      const input = this.add.zone(0, 0, 1, 1).setInteractive();
      const title = this.add.text(0, 0, "Итоги партии", {
        color: "#fff4dc",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "28px"
      });
      const formula = this.add.text(0, 0, "", {
        color: "#d9e7df",
        fontFamily: "sans-serif",
        fontSize: "16px",
        lineSpacing: 4
      });
      const rankingTitleStyle = {
        color: "#f1dfb8",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "19px"
      } as const;
      const rankingBodyStyle = {
        color: "#f8f2e7",
        fontFamily: "sans-serif",
        fontSize: "17px",
        lineSpacing: 6
      } as const;
      const logisticsTitle = this.add.text(0, 0, "Перевозчики", rankingTitleStyle);
      const logisticsBody = this.add.text(0, 0, "", rankingBodyStyle);
      const guildTitle = this.add.text(0, 0, "Паровозные гильдии", rankingTitleStyle);
      const guildBody = this.add.text(0, 0, "", rankingBodyStyle);
      const close = this.add.text(0, 0, "×", {
        color: "#fff4dc",
        backgroundColor: "#793d35",
        padding: { x: 13, y: 5 },
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "28px"
      }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

      backdrop.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideFinalResults();
      });
      input.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
      });
      close.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideFinalResults();
      });

      layer.add([
        backdrop,
        surface,
        input,
        title,
        formula,
        logisticsTitle,
        logisticsBody,
        guildTitle,
        guildBody,
        close
      ]);
      this.finalResultsLayer = layer;
      this.finalResultsBackdrop = backdrop;
      this.finalResultsSurface = surface;
      this.finalResultsInput = input;
      this.finalResultsTitle = title;
      this.finalResultsFormula = formula;
      this.finalResultsLogisticsTitle = logisticsTitle;
      this.finalResultsLogisticsBody = logisticsBody;
      this.finalResultsGuildTitle = guildTitle;
      this.finalResultsGuildBody = guildBody;
      this.finalResultsClose = close;
      this.layoutFinalResultsPanel();
    }

    /**
     * Create the game-owned table requested by the author.
     *
     * Native numeric prompts edit local cells because Phaser canvas text is not
     * an HTML form control. The existing host DOM forms remain the keyboard and
     * assistive-technology fallback, while every change from this panel still
     * travels through `context.dispatchAction`.
     */
    private createEconomyCorrectorPanel() {
      const layer = this.add.container(0, 0)
        .setDepth(2_200)
        .setScrollFactor(0)
        .setVisible(false);
      const backdrop = this.add.zone(0, 0, 1, 1).setInteractive();
      const surface = this.add.graphics();
      const input = this.add.zone(0, 0, 1, 1).setInteractive();
      const title = this.add.text(0, 0, "Начисления и списания", {
        color: "#fff4dc",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "28px"
      });
      const hint = this.add.text(
        0,
        0,
        "Нажмите ячейку, введите сумму и примените строку. "
          + "Начисление и списание выполняются последовательно, не атомарно.",
        {
          color: "#d9e7df",
          fontFamily: "sans-serif",
          fontSize: "15px",
          lineSpacing: 3
        }
      );
      const headers = this.add.text(
        0,
        0,
        "Команда / баланс",
        {
          color: "#f1dfb8",
          fontFamily: "sans-serif",
          fontStyle: "bold",
          fontSize: "14px"
        }
      );
      const rowsLayer = this.add.container(0, 0);
      const close = this.add.text(0, 0, "×", {
        color: "#fff4dc",
        backgroundColor: "#793d35",
        padding: { x: 13, y: 5 },
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: "28px"
      }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

      backdrop.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideEconomyCorrector();
      });
      input.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
      });
      close.on("pointerdown", (
        _pointer: unknown,
        _localX: number,
        _localY: number,
        event: StopPropagationEvent | undefined
      ) => {
        event?.stopPropagation?.();
        this.hideEconomyCorrector();
      });

      layer.add([
        backdrop,
        surface,
        input,
        title,
        hint,
        headers,
        rowsLayer,
        close
      ]);
      this.economyCorrectorLayer = layer;
      this.economyCorrectorBackdrop = backdrop;
      this.economyCorrectorSurface = surface;
      this.economyCorrectorInput = input;
      this.economyCorrectorTitle = title;
      this.economyCorrectorHint = hint;
      this.economyCorrectorHeaders = headers;
      this.economyCorrectorRowsLayer = rowsLayer;
      this.economyCorrectorClose = close;
      this.layoutEconomyCorrectorPanel();
    }

    /** Refresh resources from the current public snapshot without rule inference. */
    private reconcileFacilitatorHud(projection: BoardProjection) {
      const finalResults = projection.finalResults ?? null;
      const economyCorrector = projectEconomyCorrector(projection);
      this.selectedMethodologyPause = selectMethodologyPause(projection);
      const visible =
        isFacilitatorHudPhase(projection.phase)
        || finalResults !== null
        || economyCorrector !== null;
      this.facilitatorHudLayer?.setVisible(visible);
      this.facilitatorFinalResultsButton?.setVisible(finalResults !== null);
      this.facilitatorEconomyButton?.setVisible(economyCorrector !== null);
      this.facilitatorMethodologyButton?.setVisible(
        finalReflectionGuide !== null || this.selectedMethodologyPause !== null
      );
      if (!visible) {
        this.hideReflectionGuide();
        this.hideFinalResults();
        this.hideEconomyCorrector();
        return;
      }
      if (!finalResults) this.hideFinalResults();
      if (!economyCorrector) this.hideEconomyCorrector();

      const summaries = buildFacilitatorTeamSummaries(projection);
      const teamText = summaries.length === 0
        ? "Команды пока не созданы"
        : summaries.map(facilitatorTeamSummaryLabel).join("\n");
      if (this.facilitatorHudTeams?.text !== teamText) {
        this.facilitatorHudTeams?.setText(teamText);
      }
      this.facilitatorTeamCount = summaries.length;
      this.layoutFacilitatorHud();
      if (this.reflectionGuideLayer?.visible) {
        this.populateReflectionGuide();
        this.layoutReflectionGuidePanel();
      }
      if (economyCorrector) {
        const activeTeamIds = new Set(
          economyCorrector.rows.map((row) => row.teamId)
        );
        for (const teamId of this.economyDrafts.keys()) {
          if (!activeTeamIds.has(teamId)) this.economyDrafts.delete(teamId);
        }
        for (const teamId of this.economyRowStatuses.keys()) {
          if (!activeTeamIds.has(teamId)) {
            this.economyRowStatuses.delete(teamId);
          }
        }
        if (this.economyCorrectorLayer?.visible) {
          this.layoutEconomyCorrectorPanel();
        }
      }

      if (finalResults) {
        const resultKey =
          `${currentSession.sessionId}:${finalResults.completedTurn}`;
        if (this.autoOpenedFinalResultsKey !== resultKey) {
          this.autoOpenedFinalResultsKey = resultKey;
          this.showFinalResults();
        } else if (this.finalResultsLayer?.visible) {
          // A durable finished snapshot may be refreshed after reconnection.
          // Update visible copy without overriding a user's closed modal.
          this.populateFinalResults();
          this.layoutFinalResultsPanel();
        }
      }
    }

    /** Keep the team list compact while preserving one visible row per team. */
    private layoutFacilitatorHud() {
      const layer = this.facilitatorHudLayer;
      const surface = this.facilitatorHudSurface;
      const input = this.facilitatorHudInput;
      const toggle = this.facilitatorHudToggle;
      const teams = this.facilitatorHudTeams;
      const methodology = this.facilitatorMethodologyButton;
      const finalResults = this.facilitatorFinalResultsButton;
      const economy = this.facilitatorEconomyButton;
      if (
        !layer
        || !surface
        || !input
        || !toggle
        || !teams
        || !methodology
        || !finalResults
        || !economy
      ) return;

      const viewport = this.currentViewport();
      const panelX = 16;
      const panelY = 16;
      const panelWidth = Math.min(520, Math.max(280, viewport.width - 32));
      const listHeight = Math.max(31, this.facilitatorTeamCount * 24 + 10);
      const visibleButtons = [methodology, economy, finalResults].filter(
        (button) => button.visible
      );
      const controlsWidth = visibleButtons.reduce(
        (total, button) => total + button.width + 8,
        0
      );
      const controlsNeedSecondRow = controlsWidth > panelWidth - 130;
      const headerHeight = controlsNeedSecondRow ? 82 : 46;
      const panelHeight =
        headerHeight + (this.facilitatorHudExpanded ? listHeight : 0);

      surface.clear();
      surface.fillStyle(0x172b36, 0.95);
      surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);
      surface.lineStyle(1, 0xf1dfb8, 0.72);
      surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);
      input
        .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
        .setSize(panelWidth, panelHeight, true);
      toggle.setPosition(panelX + 14, panelY + 13);
      let nextButtonX = panelX + panelWidth - 10;
      const buttonY = panelY + (controlsNeedSecondRow ? 44 : 8);
      for (const button of [finalResults, economy, methodology]) {
        if (!button.visible) continue;
        button.setPosition(nextButtonX, buttonY);
        nextButtonX -= button.width + 8;
      }
      teams
        .setPosition(panelX + 14, panelY + headerHeight + 4)
        .setFixedSize(panelWidth - 28, listHeight)
        .setVisible(this.facilitatorHudExpanded);
      this.syncHudTransform();
    }

    /** Open only local immutable guidance; no Runtime command is dispatched. */
    private showReflectionGuide() {
      if (
        (!finalReflectionGuide && !this.selectedMethodologyPause)
        || !this.reflectionGuideLayer
      ) return;
      this.hideCountryInformation();
      this.hideFinalResults();
      this.hideEconomyCorrector();
      this.populateReflectionGuide();
      this.layoutReflectionGuidePanel();
      this.reflectionGuideLayer.setVisible(true);
    }

    /** Combine current public pause guidance with the immutable final guide. */
    private populateReflectionGuide() {
      const title = this.reflectionGuideTitle;
      const body = this.reflectionGuideBody;
      if (!title || !body) return;
      const pause = this.selectedMethodologyPause;
      title.setText(pause?.title ?? "Итоговая рефлексия");
      const pauseLines = pause ? [
        pause.timing,
        "",
        ...pause.prompts.map((prompt, index) => `${index + 1}. ${prompt}`)
      ] : [];
      const finalLines = finalReflectionGuide ? [
        ...(pauseLines.length > 0 ? ["", "Итоговая рефлексия"] : []),
        `Подготовка команд: ${finalReflectionGuide.preparationMinutes.min}–${finalReflectionGuide.preparationMinutes.max} минут`,
        `Выступление каждой команды: до ${finalReflectionGuide.presentationMinutesMax} минут`,
        "",
        ...finalReflectionGuide.questions.map(
          (question, index) => `${index + 1}. ${question}`
        ),
        "",
        `После выступлений сформулируйте ${finalReflectionGuide.conclusionCount.min}–${finalReflectionGuide.conclusionCount.max} общих вывода.`
      ] : [];
      body.setText([...pauseLines, ...finalLines]);
    }

    /** Close the local methodology surface without touching session state. */
    private hideReflectionGuide() {
      this.reflectionGuideLayer?.setVisible(false);
    }

    /** Fit the five confirmed questions into the current map viewport. */
    private layoutReflectionGuidePanel() {
      const layer = this.reflectionGuideLayer;
      const backdrop = this.reflectionGuideBackdrop;
      const surface = this.reflectionGuideSurface;
      const input = this.reflectionGuideInput;
      const title = this.reflectionGuideTitle;
      const body = this.reflectionGuideBody;
      const close = this.reflectionGuideClose;
      if (!layer || !backdrop || !surface || !input || !title || !body || !close) return;

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

    /** Convert already projected standings into compact, non-authoritative copy. */
    private rankingText(ranking: FinalRankingView): string {
      if (ranking.standings.length === 0) return "Нет участников";
      return ranking.standings.map(finalStandingLabel).join("\n");
    }

    /** Update labels only when a complete final projection is available. */
    private populateFinalResults() {
      const results = this.currentProjection?.finalResults;
      if (!results) return;
      this.finalResultsTitle?.setText(
        `Итоги партии · ход ${results.completedTurn}`
      );
      this.finalResultsFormula?.setText(
        "Итог = монеты − непогашенные займы + стоимость техники.\n"
        + `Зафиксированные цены: вагон — ${results.purchasePrice.wagon}, `
        + `локомотив — ${results.purchasePrice.locomotive}.`
      );
      this.finalResultsLogisticsBody?.setText(
        this.rankingText(results.rankings["logistics-companies"])
      );
      this.finalResultsGuildBody?.setText(
        this.rankingText(results.rankings["locomotive-guilds"])
      );
    }

    /** Open the read-only final result without dispatching any game action. */
    private showFinalResults() {
      if (!this.currentProjection?.finalResults || !this.finalResultsLayer) return;
      this.hideCountryInformation();
      this.hideReflectionGuide();
      this.hideEconomyCorrector();
      this.populateFinalResults();
      this.layoutFinalResultsPanel();
      this.finalResultsLayer.setVisible(true);
    }

    /** Close only the local overlay; the durable server result remains intact. */
    private hideFinalResults() {
      this.finalResultsLayer?.setVisible(false);
    }

    /**
     * Fit two bounded ranking groups into the current viewport.
     *
     * Wide viewports use two columns. Narrow viewports stack both groups and
     * reduce row text only as far as 10 px, which keeps all twelve supported
     * teams visible without changing the server order.
     */
    private layoutFinalResultsPanel() {
      const layer = this.finalResultsLayer;
      const backdrop = this.finalResultsBackdrop;
      const surface = this.finalResultsSurface;
      const input = this.finalResultsInput;
      const title = this.finalResultsTitle;
      const formula = this.finalResultsFormula;
      const logisticsTitle = this.finalResultsLogisticsTitle;
      const logisticsBody = this.finalResultsLogisticsBody;
      const guildTitle = this.finalResultsGuildTitle;
      const guildBody = this.finalResultsGuildBody;
      const close = this.finalResultsClose;
      if (
        !layer
        || !backdrop
        || !surface
        || !input
        || !title
        || !formula
        || !logisticsTitle
        || !logisticsBody
        || !guildTitle
        || !guildBody
        || !close
      ) return;

      const viewport = this.currentViewport();
      const panelWidth = Math.min(940, Math.max(160, viewport.width - 24));
      const panelHeight = Math.min(680, Math.max(220, viewport.height - 24));
      const panelX = (viewport.width - panelWidth) / 2;
      const panelY = (viewport.height - panelHeight) / 2;
      const contentX = panelX + 24;
      const contentWidth = Math.max(80, panelWidth - 48);
      const contentTop = panelY + 134;
      const compact = panelWidth < 700;

      backdrop
        .setPosition(viewport.width / 2, viewport.height / 2)
        .setSize(viewport.width, viewport.height, true);
      surface.clear();
      surface.fillStyle(0x071319, 0.74);
      surface.fillRect(0, 0, viewport.width, viewport.height);
      surface.fillStyle(0x172b36, 0.985);
      surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      surface.lineStyle(2, 0xf1dfb8, 0.9);
      surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      input
        .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
        .setSize(panelWidth, panelHeight, true);
      title
        .setPosition(contentX, panelY + 20)
        .setFontSize(panelWidth < 420 ? 22 : 28)
        .setWordWrapWidth(Math.max(150, contentWidth - 56), true);
      close.setPosition(panelX + panelWidth - 14, panelY + 12);
      formula
        .setPosition(contentX, panelY + 62)
        .setFontSize(panelWidth < 420 ? 12 : 16)
        .setWordWrapWidth(contentWidth, true)
        .setFixedSize(contentWidth, 66);

      const finalResults = this.currentProjection?.finalResults;
      const logisticsRows =
        finalResults?.rankings["logistics-companies"].standings.length ?? 0;
      const guildRows =
        finalResults?.rankings["locomotive-guilds"].standings.length ?? 0;
      if (!compact) {
        const gap = 24;
        const columnWidth = (contentWidth - gap) / 2;
        const bodyHeight = Math.max(80, panelHeight - 184);
        logisticsTitle.setPosition(contentX, contentTop);
        logisticsBody
          .setPosition(contentX, contentTop + 32)
          .setFontSize(17)
          .setFixedSize(columnWidth, bodyHeight);
        guildTitle.setPosition(contentX + columnWidth + gap, contentTop);
        guildBody
          .setPosition(contentX + columnWidth + gap, contentTop + 32)
          .setFontSize(17)
          .setFixedSize(columnWidth, bodyHeight);
      } else {
        const totalRows = Math.max(2, logisticsRows + guildRows);
        const availableRowsHeight = Math.max(100, panelHeight - 206);
        const fontSize = Math.max(
          10,
          Math.min(16, Math.floor((availableRowsHeight - 54) / totalRows) - 4)
        );
        const rowHeight = fontSize + 10;
        const logisticsHeight = Math.max(rowHeight, logisticsRows * rowHeight);
        const guildY = contentTop + 26 + logisticsHeight + 12;
        logisticsTitle.setPosition(contentX, contentTop).setFontSize(17);
        logisticsBody
          .setPosition(contentX, contentTop + 26)
          .setFontSize(fontSize)
          .setFixedSize(contentWidth, logisticsHeight);
        guildTitle.setPosition(contentX, guildY).setFontSize(17);
        guildBody
          .setPosition(contentX, guildY + 26)
          .setFontSize(fontSize)
          .setFixedSize(
            contentWidth,
            Math.max(rowHeight, panelY + panelHeight - guildY - 42)
          );
      }
      this.syncHudTransform();
    }

    /** Return or initialize the two local cells for one public team row. */
    private economyDraft(teamId: string): EconomyDraft {
      const existing = this.economyDrafts.get(teamId);
      if (existing) return existing;
      const draft: EconomyDraft = { credit: null, debit: null };
      this.economyDrafts.set(teamId, draft);
      return draft;
    }

    /** Re-check current published actions immediately before every dispatch. */
    private economyActionAvailable(actionId: string): boolean {
      return this.currentProjection?.availableActions.some((action) =>
        action.actionId === actionId && action.disabled !== true
      ) ?? false;
    }

    /**
     * Edit a single local amount through the browser's bounded numeric prompt.
     *
     * Cancel leaves the previous value untouched; an empty response clears it.
     * Invalid input never reaches Runtime and remains visible as a row message.
     */
    private editEconomyDraft(
      teamId: string,
      field: keyof EconomyDraft,
      teamLabel: string
    ) {
      const actionId = field === "credit"
        ? ECONOMY_CREDIT_ACTION_ID
        : ECONOMY_DEBIT_ACTION_ID;
      if (!this.economyActionAvailable(actionId) || this.economyDispatchInFlight) {
        return;
      }
      const draft = this.economyDraft(teamId);
      const operation = field === "credit" ? "Начисление" : "Списание";
      const input = typeof window === "undefined"
        ? null
        : window.prompt(
            `${operation} для команды «${teamLabel}»\n`
              + "Введите целое число от 0 до 1 000 000. "
              + "Пустое поле очистит черновик.",
            draft[field] === null ? "" : String(draft[field])
          );
      const parsed = parseEconomyDraftInput(input);
      if (parsed.kind === "cancel") return;
      if (parsed.kind === "invalid") {
        this.economyRowStatuses.set(teamId, parsed.message);
        this.layoutEconomyCorrectorPanel();
        return;
      }
      draft[field] = parsed.kind === "clear" ? null : parsed.amount;
      this.economyRowStatuses.delete(teamId);
      this.layoutEconomyCorrectorPanel();
    }

    /**
     * Apply the currently available cells in a deterministic sequence.
     *
     * Each successful command clears only its own cell. If the second command
     * is refused after the first succeeds, the second draft remains for retry;
     * this makes the deliberately non-atomic behavior explicit to the user.
     */
    private async applyEconomyRow(teamId: string) {
      if (this.economyDispatchInFlight) return;
      const view = this.currentProjection
        ? projectEconomyCorrector(this.currentProjection)
        : null;
      const row = view?.rows.find((candidate) => candidate.teamId === teamId);
      const draft = this.economyDrafts.get(teamId);
      if (!view || !row || !draft) return;

      const operations = [
        {
          field: "credit" as const,
          actionId: ECONOMY_CREDIT_ACTION_ID,
          available: view.creditAvailable,
          progress: "Начисление…",
          success: "Начисление применено."
        },
        {
          field: "debit" as const,
          actionId: ECONOMY_DEBIT_ACTION_ID,
          available: view.debitAvailable,
          progress: "Списание…",
          success: "Списание применено."
        }
      ].filter((operation) =>
        operation.available && draft[operation.field] !== null
      );
      if (operations.length === 0) {
        this.economyRowStatuses.set(teamId, "Введите доступную сумму.");
        this.layoutEconomyCorrectorPanel();
        return;
      }
      if (context.isInteractionPending()) {
        this.economyRowStatuses.set(
          teamId,
          "Дождитесь завершения предыдущего действия."
        );
        this.layoutEconomyCorrectorPanel();
        return;
      }

      this.economyDispatchInFlight = true;
      try {
        for (const operation of operations) {
          const amount = draft[operation.field];
          if (amount === null) continue;
          if (!this.economyActionAvailable(operation.actionId)) {
            this.economyRowStatuses.set(
              teamId,
              `${operation.field === "credit" ? "Начисление" : "Списание"} `
                + "больше недоступно."
            );
            return;
          }
          this.economyRowStatuses.set(teamId, operation.progress);
          this.layoutEconomyCorrectorPanel();
          try {
            await context.dispatchAction(operation.actionId, { teamId, amount });
          } catch (error: unknown) {
            const boundedMessage = errorText(error)
              .replace(/\s+/gu, " ")
              .slice(0, 160);
            this.economyRowStatuses.set(
              teamId,
              `Отклонено: ${boundedMessage}`
            );
            return;
          }
          draft[operation.field] = null;
          this.economyRowStatuses.set(teamId, operation.success);
          this.layoutEconomyCorrectorPanel();
        }
      } finally {
        this.economyDispatchInFlight = false;
        this.layoutEconomyCorrectorPanel();
      }
    }

    /** Open the local drafts table without changing the authoritative session. */
    private showEconomyCorrector() {
      if (
        !this.currentProjection
        || !projectEconomyCorrector(this.currentProjection)
        || !this.economyCorrectorLayer
      ) return;
      this.hideCountryInformation();
      this.hideReflectionGuide();
      this.hideFinalResults();
      this.layoutEconomyCorrectorPanel();
      this.economyCorrectorLayer.setVisible(true);
    }

    /** Closing keeps bounded drafts so an accidental click loses no input. */
    private hideEconomyCorrector() {
      this.economyCorrectorLayer?.setVisible(false);
    }

    /**
     * Draw the current bounded table over the viewport.
     *
     * All row objects are inexpensive local text controls and are rebuilt only
     * while this small overlay changes. The map's persistent layers stay intact.
     */
    private layoutEconomyCorrectorPanel() {
      const layer = this.economyCorrectorLayer;
      const backdrop = this.economyCorrectorBackdrop;
      const surface = this.economyCorrectorSurface;
      const input = this.economyCorrectorInput;
      const title = this.economyCorrectorTitle;
      const hint = this.economyCorrectorHint;
      const headers = this.economyCorrectorHeaders;
      const rowsLayer = this.economyCorrectorRowsLayer;
      const close = this.economyCorrectorClose;
      if (
        !layer
        || !backdrop
        || !surface
        || !input
        || !title
        || !hint
        || !headers
        || !rowsLayer
        || !close
      ) return;

      const view = this.currentProjection
        ? projectEconomyCorrector(this.currentProjection)
        : null;
      const viewport = this.currentViewport();
      const panelWidth = Math.min(960, Math.max(200, viewport.width - 24));
      const panelHeight = Math.min(700, Math.max(260, viewport.height - 24));
      const panelX = (viewport.width - panelWidth) / 2;
      const panelY = (viewport.height - panelHeight) / 2;
      const contentX = panelX + 20;
      const contentWidth = Math.max(120, panelWidth - 40);
      const contentTop = panelY + 126;
      const rowCount = Math.max(1, view?.rows.length ?? 0);
      const availableRowsHeight = Math.max(80, panelHeight - 154);
      const rowHeight = Math.max(
        24,
        Math.min(43, Math.floor(availableRowsHeight / rowCount))
      );
      const compact = panelWidth < 620;
      const teamWidth = contentWidth * (compact ? 0.38 : 0.42);
      const cellWidth = contentWidth * (compact ? 0.18 : 0.17);
      const actionWidth = Math.max(
        54,
        contentWidth - teamWidth - cellWidth * 2 - 18
      );
      const creditX = contentX + teamWidth + 6;
      const debitX = creditX + cellWidth + 6;
      const actionX = debitX + cellWidth + 6;

      backdrop
        .setPosition(viewport.width / 2, viewport.height / 2)
        .setSize(viewport.width, viewport.height, true);
      surface.clear();
      surface.fillStyle(0x071319, 0.74);
      surface.fillRect(0, 0, viewport.width, viewport.height);
      surface.fillStyle(0x172b36, 0.985);
      surface.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      surface.lineStyle(2, 0xf1dfb8, 0.9);
      surface.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      input
        .setPosition(panelX + panelWidth / 2, panelY + panelHeight / 2)
        .setSize(panelWidth, panelHeight, true);
      title
        .setPosition(contentX, panelY + 18)
        .setFontSize(compact ? 21 : 28)
        .setWordWrapWidth(Math.max(100, contentWidth - 52), true);
      close.setPosition(panelX + panelWidth - 14, panelY + 10);
      hint
        .setPosition(contentX, panelY + 58)
        .setFontSize(compact ? 11 : 15)
        .setWordWrapWidth(contentWidth, true)
        .setFixedSize(contentWidth, 50);
      headers
        .setPosition(contentX, panelY + 108)
        .setFontSize(compact ? 10 : 14)
        .setText("Команда / баланс");

      rowsLayer.removeAll(true);
      const headerStyle = {
        color: "#f1dfb8",
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: compact ? "10px" : "14px"
      } as const;
      const creditHeader = this.add.text(
        creditX + cellWidth / 2,
        panelY + 108,
        "Начислить",
        headerStyle
      ).setOrigin(0.5, 0);
      const debitHeader = this.add.text(
        debitX + cellWidth / 2,
        panelY + 108,
        "Списать",
        headerStyle
      ).setOrigin(0.5, 0);
      const actionHeader = this.add.text(
        actionX + actionWidth / 2,
        panelY + 108,
        "Действие",
        headerStyle
      ).setOrigin(0.5, 0);
      rowsLayer.add([creditHeader, debitHeader, actionHeader]);

      for (const [index, row] of (view?.rows ?? []).entries()) {
        const y = contentTop + index * rowHeight;
        const draft = this.economyDraft(row.teamId);
        const status = this.economyRowStatuses.get(row.teamId) ?? "";
        const balance = row.coins === null ? "—" : String(row.coins);
        const label = this.add.text(
          contentX,
          y,
          `${economyTeamLabel(row.label, compact ? 18 : 32)} · ${balance} мон.`
            + (status ? `\n${status}` : ""),
          {
            color: "#f8f2e7",
            fontFamily: "sans-serif",
            fontSize: compact || rowHeight < 34 ? "10px" : "13px",
            lineSpacing: 0
          }
        ).setFixedSize(Math.max(40, teamWidth - 4), rowHeight);

        const creditEnabled =
          view?.creditAvailable === true && !this.economyDispatchInFlight;
        const debitEnabled =
          view?.debitAvailable === true && !this.economyDispatchInFlight;
        const credit = this.add.text(
          creditX + cellWidth / 2,
          y,
          creditEnabled
            ? economyDraftLabel(draft.credit)
            : `${economyDraftLabel(draft.credit)} · н/д`,
          {
            color: "#fffdf4",
            backgroundColor: creditEnabled ? "#25704d" : "#5d6464",
            padding: { x: 5, y: 5 },
            fontFamily: "sans-serif",
            fontSize: compact ? "10px" : "13px"
          }
        ).setOrigin(0.5, 0);
        if (creditEnabled) {
          credit.setInteractive({ useHandCursor: true });
          credit.on("pointerdown", (
            _pointer: unknown,
            _localX: number,
            _localY: number,
            event: StopPropagationEvent | undefined
          ) => {
            event?.stopPropagation?.();
            this.editEconomyDraft(row.teamId, "credit", row.label);
          });
        }

        const debit = this.add.text(
          debitX + cellWidth / 2,
          y,
          debitEnabled
            ? economyDraftLabel(draft.debit)
            : `${economyDraftLabel(draft.debit)} · н/д`,
          {
            color: "#fffdf4",
            backgroundColor: debitEnabled ? "#8a4137" : "#5d6464",
            padding: { x: 5, y: 5 },
            fontFamily: "sans-serif",
            fontSize: compact ? "10px" : "13px"
          }
        ).setOrigin(0.5, 0);
        if (debitEnabled) {
          debit.setInteractive({ useHandCursor: true });
          debit.on("pointerdown", (
            _pointer: unknown,
            _localX: number,
            _localY: number,
            event: StopPropagationEvent | undefined
          ) => {
            event?.stopPropagation?.();
            this.editEconomyDraft(row.teamId, "debit", row.label);
          });
        }

        const mayApply =
          !this.economyDispatchInFlight
          && (
            (view?.creditAvailable === true && draft.credit !== null)
            || (view?.debitAvailable === true && draft.debit !== null)
          );
        const apply = this.add.text(
          actionX + actionWidth / 2,
          y,
          "Применить",
          {
            color: "#14262f",
            backgroundColor: "#f1dfb8",
            padding: { x: compact ? 5 : 9, y: 5 },
            fontFamily: "sans-serif",
            fontStyle: "bold",
            fontSize: compact ? "9px" : "12px"
          }
        ).setOrigin(0.5, 0).setAlpha(mayApply ? 1 : 0.42);
        if (mayApply) {
          apply.setInteractive({ useHandCursor: true });
          apply.on("pointerdown", (
            _pointer: unknown,
            _localX: number,
            _localY: number,
            event: StopPropagationEvent | undefined
          ) => {
            event?.stopPropagation?.();
            void this.applyEconomyRow(row.teamId);
          });
        }
        rowsLayer.add([label, credit, debit, apply]);
      }
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
      this.facilitatorFinalResultsButton = null;
      this.facilitatorEconomyButton = null;
      this.reflectionGuideLayer = null;
      this.reflectionGuideBackdrop = null;
      this.reflectionGuideSurface = null;
      this.reflectionGuideInput = null;
      this.reflectionGuideTitle = null;
      this.reflectionGuideBody = null;
      this.reflectionGuideClose = null;
      this.finalResultsLayer = null;
      this.finalResultsBackdrop = null;
      this.finalResultsSurface = null;
      this.finalResultsInput = null;
      this.finalResultsTitle = null;
      this.finalResultsFormula = null;
      this.finalResultsLogisticsTitle = null;
      this.finalResultsLogisticsBody = null;
      this.finalResultsGuildTitle = null;
      this.finalResultsGuildBody = null;
      this.finalResultsClose = null;
      this.autoOpenedFinalResultsKey = null;
      this.economyCorrectorLayer = null;
      this.economyCorrectorBackdrop = null;
      this.economyCorrectorSurface = null;
      this.economyCorrectorInput = null;
      this.economyCorrectorTitle = null;
      this.economyCorrectorHint = null;
      this.economyCorrectorHeaders = null;
      this.economyCorrectorRowsLayer = null;
      this.economyCorrectorClose = null;
      this.economyDrafts.clear();
      this.economyRowStatuses.clear();
      this.economyDispatchInFlight = false;
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
      this.syncHudTransform();
    }

    /** Keep viewport-fixed content at one physical scale under camera zoom. */
    private syncHudTransform() {
      const zoom = Math.max(0.01, this.cameras.main.zoom);
      const viewport = this.currentViewport();
      const desiredCatalogueX = viewport.width - 140;
      const desiredCatalogueY = 18;
      this.countryPanelLayer?.setScale(1 / zoom);
      this.countryCatalogueButton
        ?.setScale(1 / zoom)
        // A standalone object has no zero-position container to absorb camera
        // zoom. Phaser scales its anchor around the camera centre, so convert
        // the desired screen point back into that centred coordinate system.
        // The 140 px reserve keeps it beside Player Web's “Контекст” button.
        .setPosition(
          viewport.width / 2 + (desiredCatalogueX - viewport.width / 2) / zoom,
          viewport.height / 2 + (desiredCatalogueY - viewport.height / 2) / zoom
      );
      this.facilitatorHudLayer?.setScale(1 / zoom);
      this.reflectionGuideLayer?.setScale(1 / zoom);
      this.finalResultsLayer?.setScale(1 / zoom);
      this.economyCorrectorLayer?.setScale(1 / zoom);
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
      // A drag starts only on empty world space. Interactive nodes and road
      // zones keep their existing click behavior and are never stolen by pan.
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
      this.layoutCountryInformationPanel();
      this.layoutFacilitatorHud();
      this.layoutReflectionGuidePanel();
      this.layoutFinalResultsPanel();
      this.layoutEconomyCorrectorPanel();
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

    renderProjection() {
      if (!this.projectionReady) return;
      // A newer confirmed revision supersedes any visual transition still in
      // flight. Fast-forwarding to its previous final state prevents a backlog
      // from making the facilitator watch stale history.
      this.stopActiveVehicleMotions(true);
      this.stopTransientAnimations();
      const previousProjection = this.currentProjection;
      const projection = projectBoardSession(currentSession);
      const transitions = deriveBoardTransitions(previousProjection, projection);
      this.currentProjection = projection;
      this.reconcileFacilitatorHud(projection);
      this.renderSemanticProjection(projection);
      const nextMovementPresentationKey = movementPresentationRenderKey(projection);
      const movementPresentationChanged =
        nextMovementPresentationKey !== this.lastMovementPresentationRenderKey;
      this.lastMovementPresentationRenderKey = nextMovementPresentationKey;
      const toScreen = this.coordinateMapper(projection);
      this.reconcileVehicles(
        previousProjection,
        projection,
        transitions,
        toScreen,
        movementPresentationChanged
      );
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
      if (!this.projectionReady || !projection) return;
      const semanticLayer = this.semanticLayer;
      const graphics = this.semanticGraphics;
      if (!semanticLayer || !graphics) return;
      const nextRenderKey = semanticRenderKey(projection, currentActionDraft);
      if (nextRenderKey === this.lastSemanticRenderKey) return;
      graphics.clear();

      // Roads and nodes are semantic session data, so they must render above
      // the decorative map rather than being muted underneath its texture.
      const toScreen = this.coordinateMapper(projection);
      this.drawEdges(graphics, projection, toScreen);
      this.drawNodes(graphics, projection, toScreen);
      if (projection.nodes.length === 0) {
        if (!this.emptyStateText) {
          this.emptyStateText = this.add.text(
            DESIGN_WIDTH / 2,
            DESIGN_HEIGHT / 2,
            "Ожидаются авторские узлы, координаты и начальная сеть",
            { color: "#24343d", fontFamily: "sans-serif", fontSize: "84px", align: "center" }
          ).setOrigin(0.5);
          semanticLayer.add(this.emptyStateText);
        }
        this.emptyStateText.setVisible(true);
      } else {
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
      if (this.semanticRenderScheduled) return;
      this.semanticRenderScheduled = true;
      queueMicrotask(() => {
        if (!this.semanticRenderScheduled || !this.projectionReady) return;
        this.semanticRenderScheduled = false;
        this.renderSemanticProjection();
      });
    }

    private coordinateMapper(projection: BoardProjection) {
      const bounds = projection.bounds;
      if (!bounds) return (_point: CanonicalPoint) => ({ x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
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
      const semanticLayer = this.semanticLayer;
      if (!semanticLayer) return;
      const edgeHighlights = new Map(
        projection.highlights
          .filter((item): item is BoardHighlightView => item.targetType === "edge")
          .map((item) => [item.targetId, item])
      );
      const canSelectWaypoint = projection.availableActions.some((action) =>
        action.actionId === WAYPOINT_BUILD_ACTION_ID && action.disabled !== true);
      const canTraverse = projection.availableActions.some((action) =>
        action.actionId === MOVEMENT_TRAVERSE_ACTION_ID && action.disabled !== true);
      const selectedEdgeId = currentActionDraft?.actionId === WAYPOINT_BUILD_ACTION_ID
        && typeof currentActionDraft.params.edgeId === "string"
          ? currentActionDraft.params.edgeId
          : null;
      const retainedZoneKeys = new Set<string>();
      for (const edge of projection.edges) {
        const points = edge.points.map(toScreen);
        const highlight = edgeHighlights.get(edge.id);
        const selected = selectedEdgeId === edge.id;
        const trackColor = selected || highlight ? TRACK_SELECTED_COLOR : edgeColor(edge);
        if (selected || highlight) {
          // A translucent halo preserves the railway texture while making the
          // complete selectable route visible against country boundaries.
          graphics.lineStyle(selected ? 42 : 36, trackColor, 0.24);
          for (let index = 1; index < points.length; index += 1) {
            const from = points[index - 1];
            const to = points[index];
            if (from && to) graphics.lineBetween(from.x, from.y, to.x, to.y);
          }
        }
        this.drawRailwayPolyline(graphics, points, trackColor);
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1];
          const to = points[index];
          if (!from || !to) continue;
          const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
          // A repeated portal is harmless route data but cannot form a useful
          // hit target, so it is intentionally skipped. Nothing is drawn here:
          // the visible road is exactly the rails and sleepers painted above,
          // and a stroke along the centre line would fill the gap between the
          // rails that the author's drawing keeps open.
          if (length === 0) continue;
          if (!canSelectWaypoint && !highlight?.actionId && !canTraverse) continue;
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
            hitArea.on("pointerdown", (
              pointer: BoardSelectionPointer,
              _localX: number,
              _localY: number,
              event: { stopPropagation?: () => void } | undefined
            ) => {
              // The stable listener reads the newest binding instead of capturing
              // a stale snapshot each time the same road is reconciled.
              event?.stopPropagation?.();
              if (context.isInteractionPending()) return;
              const binding = this.edgeHitBindings.get(zoneKey);
              if (!binding) return;
              // Mutually exclusive phases normally leave one branch enabled.
              // The explicit priority is nevertheless fail-safe for a malformed
              // snapshot: construction draft, server highlight, then movement.
              if (binding.canSelectWaypoint) {
                this.selectWaypointDraft(binding.edge, binding.points, pointer);
              } else if (binding.highlight) {
                this.dispatchHighlight(binding.highlight);
              } else if (binding.canTraverse) {
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
        if (retainedZoneKeys.has(zoneKey)) continue;
        hitArea.destroy();
        this.edgeHitZones.delete(zoneKey);
        this.edgeHitBindings.delete(zoneKey);
      }
    }

    /**
     * Draw a road with the author's own rails-and-sleepers language.
     *
     * The delivery map carries no railway at all, so this is the only place a
     * road becomes visible: the ten roads of the author's initial network and
     * every road created, closed or split during a session are painted the
     * same way, from runtime-owned polylines. The picture therefore never
     * becomes the source of gameplay truth, and a closed road simply stops
     * being drawn instead of being covered up.
     *
     * The shapes come from the shared measured style module, which the
     * offline check tool draws with as well.
     */
    private drawRailwayPolyline(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      points: readonly CanonicalPoint[],
      color: number
    ) {
      const shapes = railwayTrackShapes(points);

      // Sleepers sit under both rails, matching the printed track motif.
      graphics.lineStyle(AUTHOR_TRACK_STYLE.sleeperWidth, color, 1);
      for (const sleeper of shapes.sleepers) {
        graphics.lineBetween(
          sleeper.from.x,
          sleeper.from.y,
          sleeper.to.x,
          sleeper.to.y
        );
      }

      // Two continuous rails make bends and multi-region polylines readable.
      graphics.lineStyle(AUTHOR_TRACK_STYLE.railWidth, color, 1);
      for (const rail of shapes.rails) {
        for (let index = 1; index < rail.length; index += 1) {
          const from = rail[index - 1];
          const to = rail[index];
          if (from && to) graphics.lineBetween(from.x, from.y, to.x, to.y);
        }
      }
    }

    private drawNodes(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const semanticLayer = this.semanticLayer;
      if (!semanticLayer) return;
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
      const connectedNodeIds = new Set(
        projection.edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId])
      );
      const retainedNodeIds = new Set<string>();
      const retainedZoneIds = new Set<string>();
      for (const node of projection.nodes) {
        retainedNodeIds.add(node.id);
        const position = toScreen(node.position);
        const highlight = highlights.get(node.id);
        const country = node.countryId ? countriesById.get(node.countryId) : undefined;
        const hasCountryInformation = Boolean(
          country
          && node.objectType === "transport.terminal"
          && NUMBERED_TERMINAL_ID_PATTERN.test(node.id)
        );
        const selected = selectedNodeIds.has(node.id);
        const isConnected = connectedNodeIds.has(node.id);
        const isAuthorBaseNode = AUTHOR_BASE_NODE_IDS.has(node.id);
        // An author station that no road reaches yet keeps the neutral grey
        // symbol already printed on the map; painting a marker over it would
        // announce a connection the network does not have. Every other case —
        // a station on the network, a changed state, a selection, or a point
        // created during the session — is painted from runtime data.
        const shouldPaintMarker =
          isConnected
          || node.visualState !== "open"
          || selected
          || Boolean(highlight)
          || !isAuthorBaseNode;
        if (shouldPaintMarker) {
          this.drawNodeMarker(graphics, node, position, {
            selected,
            highlighted: Boolean(highlight)
          });
        }

        let label = this.nodeLabels.get(node.id);
        if (!label) {
          label = this.add.text(0, 0, "", {
            color: cssColor(AUTHOR_STATION_LABEL_INK),
            fontFamily: "Georgia, serif",
            fontStyle: "bold",
            fontSize: `${AUTHOR_STATION_LABEL_SIZE}px`,
            align: "center"
          }).setOrigin(0.5);
          semanticLayer.add(label);
          this.nodeLabels.set(node.id, label);
        }
        const presentationLabel = nodePresentationLabel(node);
        label
          .setPosition(position.x, position.y + 1)
          .setVisible(shouldPaintMarker)
          // A single printed digit is measured directly from the author board;
          // longer marks are shrunk proportionally so they still fit the disc.
          .setFontSize(
            node.objectType === "transport.waypoint"
              ? Math.round(AUTHOR_STATION_LABEL_SIZE * 0.6)
              : presentationLabel.length > 2
                ? Math.round(AUTHOR_STATION_LABEL_SIZE * 0.64)
                : presentationLabel.length === 2
                  ? Math.round(AUTHOR_STATION_LABEL_SIZE * 0.83)
                  : AUTHOR_STATION_LABEL_SIZE
          );
        if (label.text !== presentationLabel) label.setText(presentationLabel);

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
            hitArea.on("pointerdown", (
              _pointer: unknown,
              _localX: number,
              _localY: number,
              event: StopPropagationEvent | undefined
            ) => {
              event?.stopPropagation?.();
              if (context.isInteractionPending()) return;
              const binding = this.nodeHitBindings.get(node.id);
              if (!binding) return;
              const intent = resolveNodePointerIntent({
                canSelectRoad: binding.canSelectRoad,
                hasServerHighlightAction: Boolean(binding.highlight?.actionId),
                hasCountryInformation: Boolean(
                  binding.countryId && countriesById.has(binding.countryId)
                )
              });
              if (intent === "road-selection") {
                this.publishActionDraft(
                  selectRoadDraftNode(currentActionDraft, binding.nodeId)
                );
              } else if (intent === "server-highlight" && binding.highlight) {
                this.dispatchHighlight(binding.highlight);
              } else if (
                intent === "country-information"
                && binding.countryId
              ) {
                this.showCountryInformation(binding.countryId);
              }
            });
            this.nodeHitZones.set(node.id, hitArea);
          }
          hitArea.setPosition(position.x, position.y).setSize(56, 56, true);
        }
      }
      for (const [nodeId, label] of this.nodeLabels) {
        if (retainedNodeIds.has(nodeId)) continue;
        label.destroy();
        this.nodeLabels.delete(nodeId);
      }
      for (const [nodeId, hitArea] of this.nodeHitZones) {
        if (retainedZoneIds.has(nodeId)) continue;
        hitArea.destroy();
        this.nodeHitZones.delete(nodeId);
        this.nodeHitBindings.delete(nodeId);
      }
    }

    /**
     * Paint a station above its incident tracks.
     *
     * Numbered terminals use the gear silhouette printed on the source map.
     * Special points use a compact round marker. Open but disconnected author
     * terminals are intentionally not repainted: their neutral grey symbols
     * already belong to the immutable map texture.
     */
    private drawNodeMarker(
      graphics: InstanceType<typeof Phaser.GameObjects.Graphics>,
      node: BoardNodeView,
      position: CanonicalPoint,
      state: Readonly<{ selected: boolean; highlighted: boolean }>
    ) {
      const color = nodeMarkerColor(node);
      if (state.selected || state.highlighted) {
        graphics.lineStyle(state.selected ? 10 : 8, TRACK_SELECTED_COLOR, 0.62);
        graphics.strokeCircle(position.x, position.y, 61);
      }

      if (node.objectType === "transport.waypoint" || node.id === "terminal-3-14") {
        // A half-stop is a plain disc on the author board, without a ring.
        graphics.fillStyle(color, 1);
        graphics.fillCircle(
          position.x,
          position.y,
          AUTHOR_STATION_STYLE.waypointRadius
        );
        return;
      }

      const outline = stationGearOutline(position);
      graphics.beginPath();
      outline.forEach((vertex, index) => {
        if (index === 0) graphics.moveTo(vertex.x, vertex.y);
        else graphics.lineTo(vertex.x, vertex.y);
      });
      graphics.closePath();
      graphics.fillStyle(color, 1);
      graphics.fillPath();

      // The light disc carries the printed number; on the author board it has
      // no outline of its own, the gear ring around it provides the edge.
      graphics.fillStyle(TERMINAL_INNER_COLOR, 1);
      graphics.fillCircle(position.x, position.y, AUTHOR_STATION_STYLE.discRadius);
    }

    /** Open immutable country content without dispatching a runtime command. */
    private showCountryInformation(countryId: string) {
      const country = countriesById.get(countryId);
      if (!country || !this.countryPanelLayer) return;
      this.hideReflectionGuide();
      this.hideFinalResults();
      this.hideEconomyCorrector();
      this.activeCountry = country;
      if (this.countryPanelTitle?.text !== country.title) {
        this.countryPanelTitle?.setText(country.title);
      }
      if (this.countryPanelDescription?.text !== country.description) {
        this.countryPanelDescription?.setText(country.description);
      }
      const countryIndex = countries.findIndex((candidate) => candidate.id === country.id);
      this.countryPanelPosition?.setText(
        countryIndex === -1 ? "" : `${countryIndex + 1} из ${countries.length}`
      );
      this.layoutCountryInformationPanel();
      this.countryPanelLayer.setVisible(true);
    }

    /** Browse immutable descriptions; no game command or map inference occurs. */
    private showAdjacentCountry(offset: number) {
      const country = countryAtOffset(countries, this.activeCountry?.id ?? null, offset);
      if (country) this.showCountryInformation(country.id);
    }

    /** Close only the local information surface; game state is untouched. */
    private hideCountryInformation() {
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
    private layoutCountryInformationPanel() {
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
      if (
        !layer
        || !backdrop
        || !surface
        || !panelInput
        || !title
        || !description
        || !close
        || !previous
        || !next
        || !position
      ) return;

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
        const approximateCharactersPerLine = Math.max(
          20,
          Math.floor(descriptionWidth / (fontSize * 0.54))
        );
        const approximateLines = Math.ceil(
          narrativeLength / approximateCharactersPerLine
        );
        if (approximateLines * fontSize * 1.32 <= descriptionHeight) break;
        fontSize -= 1;
      }
      description.setFontSize(fontSize);
      this.syncHudTransform();
    }

    /**
     * Paint the server calculation as a temporary overlay, never as a road.
     * This layer is cleared independently while the map and hit targets remain.
     */
    renderSpatialPreview() {
      const graphics = this.previewGraphics;
      const projection = this.currentProjection;
      if (!graphics || !projection) return;
      graphics.clear();
      const toScreen = this.coordinateMapper(projection);
      const points = currentSpatialPreview?.points.map(toScreen) ?? [];
      if (points.length < 2) return;
      graphics.lineStyle(14, 0x1c9e85, 0.92);
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (from && to) graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
      graphics.fillStyle(0xfff3b0, 1);
      const first = points[0];
      const last = points.at(-1);
      if (first) graphics.fillCircle(first.x, first.y, 13);
      if (last) graphics.fillCircle(last.x, last.y, 13);
    }

    /** Update rejected-action feedback without rebuilding any board objects. */
    renderErrorFeedback() {
      const banner = this.errorBanner;
      if (!banner) return;
      banner.setText(lastError ?? "").setVisible(lastError !== null);
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
      this.renderSemanticProjection();
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
        .then(() => {
          lastError = null;
          this.renderErrorFeedback();
        })
        .catch((error: unknown) => {
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
    private dispatchMovementTraverse(edgeId: string) {
      if (
        context.isInteractionPending()
        || this.pendingMovementEdges.size > 0
      ) return;
      this.pendingMovementEdges.add(edgeId);
      void context.dispatchAction(
        MOVEMENT_TRAVERSE_ACTION_ID,
        movementTraverseParams(edgeId)
      )
        .then(() => {
          lastError = null;
          this.renderErrorFeedback();
        })
        .catch((error: unknown) => {
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
    private dispatchTrainWagonSelection(wagonId: string) {
      const projection = this.currentProjection;
      const wagon = projection?.vehicles.find(
        (vehicle) => vehicle.id === wagonId && vehicle.kind === "wagon"
      );
      if (
        !projection
        || !wagon
        || context.isInteractionPending()
        || this.pendingTrainWagons.size > 0
      ) return;
      const actionId = trainWagonSelectionActionId(
        wagon,
        projection.currentLocomotiveId
      );
      const publishedAction = projection.availableActions.find(
        (action) => action.actionId === actionId
      );
      if (!publishedAction || publishedAction.disabled === true) return;

      this.pendingTrainWagons.add(wagonId);
      void context.dispatchAction(actionId, trainWagonSelectionParams(wagonId))
        .then(() => {
          lastError = null;
          this.renderErrorFeedback();
        })
        .catch((error: unknown) => {
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
    private vehiclePositions(
      projection: BoardProjection,
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ): ReadonlyMap<string, CanonicalPoint> {
      return layoutVehiclePositions({
        vehicles: projection.vehicles,
        nodePositions: new Map(projection.nodes.map((node) => [node.id, toScreen(node.position)]))
      });
    }

    /** Keep vehicle objects alive so a confirmed node change can be animated. */
    private reconcileVehicles(
      previous: BoardProjection | null,
      projection: BoardProjection,
      transitions: readonly BoardTransition[],
      toScreen: (point: CanonicalPoint) => CanonicalPoint,
      movementPresentationChanged: boolean
    ) {
      const vehicleLayer = this.vehicleLayer;
      if (!vehicleLayer) return;
      const nextById = new Map(projection.vehicles.map((vehicle) => [vehicle.id, vehicle]));
      const teamsById = new Map(projection.teams.map((team) => [team.id, team]));
      const nextPositions = this.vehiclePositions(projection, toScreen);
      // The server already resolved all gameplay tie-breakers. The client maps
      // that authoritative order to small numbers and never sorts by local
      // coordinates, balances or ownership facts.
      const locomotiveOrderNumbers = new Map(
        projection.locomotiveOrder.map((locomotiveId, index) => [locomotiveId, index + 1])
      );
      const previousPositions = previous
        ? this.vehiclePositions(previous, toScreen)
        : new Map<string, CanonicalPoint>();
      const movementById = new Map(
        transitions
          .filter((item): item is VehicleMovedTransition => item.kind === "vehicle-moved")
          .map((item) => [item.vehicleId, item])
      );
      const attachmentLayoutChanged = transitions.some((item) =>
        item.kind === "vehicle-attachment-changed");
      const currentVehicle = projection.currentLocomotiveId
        ? nextById.get(projection.currentLocomotiveId)
        : undefined;
      const hasRenderableCurrent = currentVehicle?.kind === "locomotive"
        && nextPositions.has(currentVehicle.id);
      this.currentLocomotiveIndicator?.setVisible(hasRenderableCurrent);
      const hasTrainSelectionAction = projection.availableActions.some(
        (action) =>
          (
            action.actionId === TRAIN_WAGON_SELECT_ACTION_ID
            || action.actionId === TRAIN_WAGON_UNSELECT_ACTION_ID
          )
          && action.disabled !== true
      );

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
        if (
          !locomotiveOrderNumbers.has(vehicleId)
          || vehicle?.kind !== "locomotive"
          || !nextPositions.has(vehicleId)
        ) {
          badge.destroy();
          this.locomotiveOrderBadges.delete(vehicleId);
        }
      }
      for (const [vehicleId, badge] of this.trainSelectionBadges) {
        const vehicle = nextById.get(vehicleId);
        if (
          vehicle?.kind !== "wagon"
          || vehicle.formationTargetLocomotiveId !== projection.currentLocomotiveId
          || projection.currentLocomotiveId === null
          || !nextPositions.has(vehicleId)
        ) {
          badge.destroy();
          this.trainSelectionBadges.delete(vehicleId);
        }
      }

      for (const vehicle of projection.vehicles) {
        const finalPosition = nextPositions.get(vehicle.id);
        if (!finalPosition) continue;
        const fallbackColor = vehicle.kind === "locomotive" ? "#273f8f" : "#8f5a27";
        const ownerColor = teamMarkerColor(
          vehicle.ownerTeamId ? teamsById.get(vehicle.ownerTeamId)?.colorId : undefined,
          fallbackColor
        );
        let marker = this.vehicleMarkers.get(vehicle.id);
        const isNewMarker = marker === undefined;
        if (!marker) {
          marker = this.add.text(0, 0, vehicleGlyph(vehicle), {
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
        } else {
          const nextGlyph = vehicleGlyph(vehicle);
          // Phaser regenerates a text texture on setText, so do it only when
          // loading or delivery actually changes the persistent glyph.
          if (marker.text !== nextGlyph) marker.setText(nextGlyph);
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
        } else if (this.interactiveWagonMarkers.delete(vehicle.id)) {
          marker.disableInteractive();
        }

        const isSelectedForCurrent =
          vehicle.kind === "wagon"
          && isTrainWagonSelectedForCurrent(
            vehicle,
            projection.currentLocomotiveId
          );
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
          } else if (movementPresentationChanged && badge.text !== String(orderNumber)) {
            // Text textures are regenerated only when the server order changes.
            badge.setText(String(orderNumber));
          }
        }

        const movement = movementById.get(vehicle.id);
        const path = movement?.path?.map(toScreen) ?? null;
        const previousPosition = previousPositions.get(vehicle.id);
        if (
          !isNewMarker
          && movement
          && path
          && path.length >= 2
          && previousPosition
          && !this.prefersReducedMotion()
        ) {
          this.animateVehicleAlongPath(marker, vehicle.id, path, previousPosition, finalPosition);
          continue;
        }
        if (
          !isNewMarker
          && attachmentLayoutChanged
          && previousPosition
          && !this.prefersReducedMotion()
          && (previousPosition.x !== finalPosition.x || previousPosition.y !== finalPosition.y)
        ) {
          this.animateVehicleToPosition(marker, vehicle.id, previousPosition, finalPosition);
        } else {
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
    private setVehiclePresentationPosition(
      vehicleId: string,
      marker: InstanceType<typeof Phaser.GameObjects.Text>,
      position: CanonicalPoint
    ) {
      marker.setPosition(position.x, position.y);
      this.locomotiveOrderBadges.get(vehicleId)?.setPosition(
        position.x + LOCOMOTIVE_ORDER_BADGE_OFFSET.x,
        position.y + LOCOMOTIVE_ORDER_BADGE_OFFSET.y
      );
      this.trainSelectionBadges.get(vehicleId)?.setPosition(
        position.x + TRAIN_SELECTION_BADGE_OFFSET.x,
        position.y + TRAIN_SELECTION_BADGE_OFFSET.y
      );
      if (this.currentProjection?.currentLocomotiveId === vehicleId) {
        this.currentLocomotiveIndicator?.setPosition(position.x, position.y);
      }
    }

    /** Animate only a confirmed composition-layout change, never a game move. */
    private animateVehicleToPosition(
      marker: InstanceType<typeof Phaser.GameObjects.Text>,
      vehicleId: string,
      previousPosition: CanonicalPoint,
      finalPosition: CanonicalPoint
    ) {
      this.setVehiclePresentationPosition(vehicleId, marker, previousPosition);
      let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
      tween = this.tweens.add({
        targets: marker,
        x: finalPosition.x,
        y: finalPosition.y,
        duration: 260,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          this.setVehiclePresentationPosition(
            vehicleId,
            marker,
            { x: marker.x, y: marker.y }
          );
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
    private animateVehicleAlongPath(
      marker: InstanceType<typeof Phaser.GameObjects.Text>,
      vehicleId: string,
      path: readonly CanonicalPoint[],
      previousPosition: CanonicalPoint,
      finalPosition: CanonicalPoint
    ) {
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

      let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
      tween = this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: movementDurationMs(path),
        // Distance interpolation already normalizes the full polyline. Linear
        // easing therefore gives the promised constant visual speed.
        ease: "Linear",
        onUpdate: (activeTween: InstanceType<typeof Phaser.Tweens.Tween>) => {
          const progress = activeTween.getValue() ?? 1;
          const position = pointAtPolylineProgress(path, progress);
          if (!position) return;
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
    private stopActiveVehicleMotions(fastForward: boolean) {
      for (const [
        vehicleId,
        { tween, marker, finalPosition }
      ] of this.activeVehicleMotions) {
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
    private stopTransientAnimations() {
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
        if (marker.active) marker.setScale(1);
      }
    }

    /**
     * Briefly emphasize confirmed construction and availability changes.
     *
     * The underlying semantic layer already contains the final server state.
     * This overlay fades away and therefore cannot become a second source of
     * topology or availability.
     */
    private animateStructuralTransitions(
      projection: BoardProjection,
      transitions: readonly BoardTransition[],
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const layer = this.motionLayer;
      if (!layer) return;
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
            ? newsBannerLabel(
                projection.currentNews?.id === transition.toNewsId
                  ? projection.currentNews
                  : null,
                transition.toNewsId
              )
            : `${teams.get(transition.teamId)?.label ?? transition.teamId}: `
              + `${transition.delta > 0 ? "+" : ""}${transition.delta}`;
          const banner = this.add.text(
            camera.midPoint.x,
            camera.midPoint.y - (camera.height / camera.zoom) * 0.32
              + feedbackRow * (54 / camera.zoom),
            label,
            {
              color: "#fff7d6",
              backgroundColor: transition.kind === "news-changed" ? "#273f8fee" : "#513b16ee",
              padding: { x: 18, y: 10 },
              fontFamily: "sans-serif",
              fontSize: "38px"
            }
          ).setOrigin(0.5).setScale(1 / camera.zoom);
          feedbackRow += 1;
          layer.add(banner);
          let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
          if (edge) this.animateConfirmedRoadTrace(layer, edge.points.map(toScreen), edgeColor(edge));
          continue;
        }
        if (transition.kind === "node-added") {
          const node = nodes.get(transition.nodeId);
          if (node) this.animateConfirmedNodePulse(layer, toScreen(node.position));
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
        } else if (transition.kind === "node-visual-state-changed") {
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
        let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
    private animateConfirmedRoadTrace(
      layer: InstanceType<typeof Phaser.GameObjects.Container>,
      points: readonly CanonicalPoint[],
      color: number
    ) {
      if (points.length < 2) return;
      const graphics = this.add.graphics();
      layer.add(graphics);
      let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
      tween = this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 450,
        ease: "Sine.easeInOut",
        onUpdate: (activeTween: InstanceType<typeof Phaser.Tweens.Tween>) => {
          const prefix = polylinePrefixAtProgress(points, activeTween.getValue() ?? 1);
          graphics.clear();
          graphics.lineStyle(18, color, 0.98);
          for (let index = 1; index < prefix.length; index += 1) {
            const from = prefix[index - 1];
            const to = prefix[index];
            if (from && to) graphics.lineBetween(from.x, from.y, to.x, to.y);
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
    private animateConfirmedNodePulse(
      layer: InstanceType<typeof Phaser.GameObjects.Container>,
      point: CanonicalPoint
    ) {
      const graphics = this.add.graphics();
      graphics.lineStyle(12, 0x1c9e85, 0.98);
      graphics.strokeCircle(0, 0, 42);
      graphics.setPosition(point.x, point.y).setScale(0.55);
      layer.add(graphics);
      let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
    private renderReducedMotionSummary(transitions: readonly BoardTransition[]) {
      const layer = this.motionLayer;
      if (!layer || transitions.length === 0) return;
      const labels = new Set<string>();
      for (const transition of transitions) {
        if (transition.kind === "vehicle-moved") labels.add("техника перемещена");
        else if (transition.kind === "vehicle-cargo-changed") labels.add("груз изменён");
        else if (transition.kind === "vehicle-attachment-changed") labels.add("состав изменён");
        else if (transition.kind === "team-coins-changed") labels.add("баланс изменён");
        else if (transition.kind === "news-changed") labels.add("открыта новость");
        else if (transition.kind.startsWith("edge-") || transition.kind.startsWith("node-")) {
          labels.add("сеть изменена");
        } else if (transition.kind === "vehicle-added" || transition.kind === "vehicle-removed") {
          labels.add("состав техники изменён");
        }
      }
      if (labels.size === 0) return;
      const camera = this.cameras.main;
      const banner = this.add.text(
        camera.midPoint.x,
        camera.midPoint.y - (camera.height / camera.zoom) * 0.32,
        `Состояние обновлено: ${[...labels].join(", ")}`,
        {
          color: "#fff7d6",
          backgroundColor: "#273f8fee",
          padding: { x: 18, y: 10 },
          fontFamily: "sans-serif",
          fontSize: "38px"
        }
      ).setOrigin(0.5).setScale(1 / camera.zoom);
      layer.add(banner);
      let timer!: InstanceType<typeof Phaser.Time.TimerEvent>;
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
    private animateVehicleRelationTransitions(
      previous: BoardProjection | null,
      projection: BoardProjection,
      transitions: readonly BoardTransition[],
      toScreen: (point: CanonicalPoint) => CanonicalPoint
    ) {
      const layer = this.motionLayer;
      if (!layer || this.prefersReducedMotion()) return;
      const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
      const previousCargo = new Map((previous?.cargos ?? []).map((cargo) => [cargo.id, cargo]));
      const nextCargo = new Map((projection.cargos ?? []).map((cargo) => [cargo.id, cargo]));

      for (const transition of transitions) {
        const marker = "vehicleId" in transition
          ? this.vehicleMarkers.get(transition.vehicleId)
          : undefined;
        if (!marker) continue;

        if (transition.kind === "vehicle-attachment-changed") {
          marker.setScale(1.45);
          let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
        if (transition.kind !== "vehicle-cargo-changed") continue;

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
          let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
        const token = this.add.text(
          isLoading ? endpoint.x : marker.x,
          isLoading ? endpoint.y : marker.y,
          "●",
          {
            color: "#f2c866",
            fontFamily: "sans-serif",
            fontSize: "28px",
            stroke: "#513b16",
            strokeThickness: 3
          }
        ).setOrigin(0.5);
        layer.add(token);
        let tween!: InstanceType<typeof Phaser.Tweens.Tween>;
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
    private prefersReducedMotion() {
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
      if (nextRevision === renderedSessionRevision) return;
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
    getAccessibleActions: provideCardsMoneyTrainsAccessibleBoardActions
  };
};
