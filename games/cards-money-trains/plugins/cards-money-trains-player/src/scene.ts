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
  type CanonicalPoint
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
  buildFacilitatorTeamSummaries,
  facilitatorTeamSummaryLabel,
  isFacilitatorHudPhase,
  readFinalReflectionGuide
} from "./facilitator-hud.ts";
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

const edgeColor = (edge: BoardEdgeView) => {
  if (edge.visualState === "blocked") return 0xc94c4c;
  if (edge.visualState === "building") return 0xe0a33a;
  return 0x374b59;
};

const nodeColor = (node: BoardNodeView) =>
  node.objectType === "transport.waypoint" ? 0xe5a338 : 0xf4ead5;

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
    private facilitatorHudExpanded = true;
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

      if (finalReflectionGuide) {
        body.setText([
          `Подготовка команд: ${finalReflectionGuide.preparationMinutes.min}–${finalReflectionGuide.preparationMinutes.max} минут`,
          `Выступление каждой команды: до ${finalReflectionGuide.presentationMinutesMax} минут`,
          "",
          ...finalReflectionGuide.questions.map(
            (question, index) => `${index + 1}. ${question}`
          ),
          "",
          `После выступлений сформулируйте ${finalReflectionGuide.conclusionCount.min}–${finalReflectionGuide.conclusionCount.max} общих вывода.`
        ]);
      }
      this.layoutReflectionGuidePanel();
    }

    /** Refresh resources from the current public snapshot without rule inference. */
    private reconcileFacilitatorHud(projection: BoardProjection) {
      const visible = isFacilitatorHudPhase(projection.phase);
      this.facilitatorHudLayer?.setVisible(visible);
      if (!visible) {
        this.hideReflectionGuide();
        return;
      }

      const summaries = buildFacilitatorTeamSummaries(projection);
      const teamText = summaries.length === 0
        ? "Команды пока не созданы"
        : summaries.map(facilitatorTeamSummaryLabel).join("\n");
      if (this.facilitatorHudTeams?.text !== teamText) {
        this.facilitatorHudTeams?.setText(teamText);
      }
      this.facilitatorTeamCount = summaries.length;
      this.layoutFacilitatorHud();
    }

    /** Keep the team list compact while preserving one visible row per team. */
    private layoutFacilitatorHud() {
      const layer = this.facilitatorHudLayer;
      const surface = this.facilitatorHudSurface;
      const input = this.facilitatorHudInput;
      const toggle = this.facilitatorHudToggle;
      const teams = this.facilitatorHudTeams;
      const methodology = this.facilitatorMethodologyButton;
      if (!layer || !surface || !input || !toggle || !teams || !methodology) return;

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
    private showReflectionGuide() {
      if (!finalReflectionGuide || !this.reflectionGuideLayer) return;
      this.hideCountryInformation();
      this.layoutReflectionGuidePanel();
      this.reflectionGuideLayer.setVisible(true);
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
      this.countryPanelLayer?.setScale(1 / zoom);
      this.countryCatalogueButton?.setScale(1 / zoom);
      this.facilitatorHudLayer?.setScale(1 / zoom);
      this.reflectionGuideLayer?.setScale(1 / zoom);
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
        graphics.lineStyle(selected ? 12 : highlight ? 10 : 6, selected ? 0x1f8f6a : edgeColor(edge), 0.95);
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1];
          const to = points[index];
          if (!from || !to) continue;
          const length = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
          // A repeated portal is harmless route data but cannot form a useful
          // line or hit target, so it is intentionally skipped.
          if (length === 0) continue;
          graphics.lineBetween(from.x, from.y, to.x, to.y);
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
        if (label.text !== node.label) label.setText(node.label);

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

    /** Open immutable country content without dispatching a runtime command. */
    private showCountryInformation(countryId: string) {
      const country = countriesById.get(countryId);
      if (!country || !this.countryPanelLayer) return;
      this.hideReflectionGuide();
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
