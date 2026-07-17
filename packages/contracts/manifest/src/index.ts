/**
 * Cubica Manifest Contracts
 * Version: 1.3.0
 *
 * Bounded contract surface for game manifest structures, player-facing content projections,
 * and UI component types used by runtime-api and player-web consumers.
 *
 * Versioning policy:
 * - Additive changes only (new types, new optional fields) — non-breaking for current consumers
 * - No removal or renaming of existing exported types without Architect escalation
 * - All breaking changes require a new ADR
 *
 * Consumer mapping:
 * - `runtime-api` content module: uses `GameManifest`, `ManifestBundle`, `GameManifestActionDefinition`
 * - `runtime-api` player-content API: uses `PlayerFacingContent`, `GamePlayerUiContent`
 * - `player-web` renderer: uses `GamePlayerUiContent`, `GamePlayerS1UiContent` (deprecated), `GameUiComponent` types
 */

export type {
  AuthoredInRepoOrigin,
  GameAssetEntry,
  RootGameAssets,
  ThirdPartyOrigin
} from "./generated/game-assets.ts";
export type * from "./generated/mechanics-plan.ts";
export type * from "./generated/game-intent.ts";

/**
 * Generic game state type. Game plugins extend this with their own
 * game-specific state shape (e.g. AntarcticaGameState).
 * The platform layer never assumes a specific shape — only plugins do.
 */
export type GameState = Record<string, unknown>;

export type * from "./generated/game-manifest.ts";
import type {
  GameManifest,
  GameManifestAgentFailurePolicy,
  GameManifestExecutionMode,
  GameManifestId,
  GameManifestLocale,
  GameManifestObjectModelMap,
  GameManifestObjectFacetValue,
  GameManifestPlayerConfig,
  GameManifestTraining,
  GameManifestVersion
} from "./generated/game-manifest.ts";
import type {
  GameManifestActionParamsSchema,
  GameManifestSessionRole
} from "./generated/game-intent.ts";

/** Repository or delivery reference to one published game bundle. */
export interface ManifestBundleRef {
  gameId: GameManifestId;
  version?: GameManifestVersion;
  channel?: string;
}

/** A participant reference resolved by runtime, never treated as a client-controlled state path. */
export type GameManifestPlayerRef = string | { fromPath: string };

/** Convenient public name for the state object generated from the manifest schema. */
export type GameManifestState = GameManifest["state"];

/**
 * Runtime shape of one object instance stored in session state.
 *
 * This is a derived state value rather than a manifest document definition;
 * its facet values reuse the schema-generated manifest scalar contract.
 */
export interface GameManifestObjectState {
  objectType: string;
  facets: Record<string, GameManifestObjectFacetValue>;
  attributes?: Record<string, unknown>;
}

export type GameManifestObjectStateCollection = Record<string, GameManifestObjectState>;
export type GameManifestObjectStateMap = Record<string, GameManifestObjectStateCollection>;

/** Derived ranking result used by presenters and tests, not a manifest input shape. */
export interface GameManifestRankingGroup {
  id: string;
  participantIds: Array<string>;
}

/** Derived ranking source descriptor used by game-owned presentation helpers. */
export interface GameManifestRankingAssetSource {
  collectionPath: string;
  ownerAttribute: string;
  valueAttribute: string;
}

export interface ManifestBundle<
  TManifest extends GameManifest = GameManifest,
  TUiManifest = Record<string, unknown>
> {
  gameId: GameManifestId;
  manifest: TManifest;
  uiManifest?: TUiManifest;
}

export interface PlayerFacingAction {
  actionId: string;
  displayName: string;
  capabilityFamily: string | null;
  capability: string | null;
  paramsSchema?: GameManifestActionParamsSchema;
  allowedSessionRoles?: Array<GameManifestSessionRole>;
}

export interface PlayerFacingMockup {
  id: string;
  name: string;
  description: string;
  type: string;
  imagePath: string;
}

export interface CustomGameContent {
  [key: string]: unknown;
}

/**
 * Bounded S1 UI component types supported by the manifest-driven renderer.
 * Only these component types are allowed in the player-web S1 delivery slice.
 */
export type GameUiComponentType =
  | "screenComponent"
  | "areaComponent"
  | "gameVariableComponent"
  | "cardComponent"
  | "buttonComponent"
  | "richTextComponent"
  | "imageComponent"
  | "interactiveBoardSurface";

/**
 * Layout policy selected declaratively by a UI screen or panel.
 * `map-first` gives the spatial board the whole workspace while the remaining
 * semantic zones are rendered as platform-owned layers above it.
 */
export type GameUiLayoutMode = "leftsidebar" | "topbar" | "map-first" | "auto";

/**
 * Stable semantic roles available to direct zones of a map-first screen.
 * The role describes purpose, not CSS coordinates or stacking order; those
 * remain owned by the delivery channel so the same manifest can adapt safely.
 */
export type GameUiWorkspaceSlot =
  | "board"
  | "status"
  | "primary-panel"
  | "context-panel"
  | "action-tray"
  | "floating-controls"
  | "overlay";

/**
 * Props for screenComponent in S1 layout.
 */
export interface GameUiScreenComponentProps {
  cssClass?: string;
  backgroundImage?: string;
  /** Visual mode override at screen level. Components inherit unless they override. */
  visualMode?: "image" | "style" | "auto";
  /**
   * Declarative flag (ADR-055): when true, the renderer draws the extra
   * decorative background layer (`.additional-background`) for this screen.
   *
   * This replaces the renderer's former game-specific branch
   * `cssClass.includes("info-screen-shell")`. Keying a decorative layer off a
   * particular game's CSS class name made the generic renderer know one game;
   * the intent is now declared in the UI manifest instead. (`props` is an open
   * object in ui-manifest.schema.json, like `backgroundImage`/`caption`, so no
   * schema change is required — this field documents the contract.)
   */
  decorativeBackground?: boolean;
}

/**
 * Props for areaComponent (layout container) in S1.
 */
export interface GameUiAreaComponentProps {
  cssClass?: string;
  /**
   * Semantic placement for a direct areaComponent child of a map-first screen
   * root. It is invalid on nested areas and in all other layout modes.
   */
  workspaceSlot?: GameUiWorkspaceSlot;
  /**
   * Declarative topbar-layout CSS modifier(s) (ADR-055): applied by the generic
   * renderer only when the screen is in topbar layout mode. This replaces the
   * renderer's former game-specific mapping from structural class names to
   * `topbar-*` classes — the manifest now declares which modifier a given area
   * needs, so the generic renderer knows no game. Space-separated for multiple.
   * (`props` is an open object in ui-manifest.schema.json, so no schema change.)
   */
  topbarCssClass?: string;
  /** Visual mode override at area level. */
  visualMode?: "image" | "style" | "auto";
  /** Reference to a design artifact image for "image" visualMode. */
  designImageRef?: string;
}

/**
 * Props for gameVariableComponent (metric display) in S1 sidebar.
 */
export interface GameUiGameVariableComponentProps {
  /**
   * Gameplay metric id. When provided, the renderer can read label,
   * description and value from player-facing metricViews.
   */
  metricId?: string;
  /**
   * UI-only caption override. Gameplay metric labels should come from the
   * game manifest catalog through metricViews.
   */
  caption?: string;
  description?: string;
  backgroundImage?: string;
  /**
   * Optional binding expression for the metric value, e.g.
   * "{{game.state.public.metrics.remainingDays}}". If omitted, the renderer
   * uses metricViews[metricId].value or metrics[metricId].
   */
  value?: string;
  /**
   * Layout variant for the metric display.
   * - "default": standard size
   * - "prominent": larger display (e.g., primary time/resource metric)
   * Replaces id-based visual checks — games should set this
   * on metrics that need special visual treatment.
   */
  layout?: "default" | "prominent";
}

/**
 * Props for cardComponent (interactive card) in S1.
 */
export interface GameUiCardComponentProps {
  /** Simple text (backward compatible, single-field rendering). */
  text?: string;
  /** Card title for multi-field rendering. */
  title?: string;
  /** Card summary for multi-field rendering (front face text). */
  summary?: string;
  /** Back (flipped/result) text shown after the card is selected. */
  backText?: string;
  /** Chip labels displayed as metadata tags. */
  chips?: Array<string>;
  /** Label for the select/choose button inside the card. */
  selectLabel?: string;
  /** Visual state for CSS class selection. */
  visualState?: "default" | "selected" | "locked" | "resolved" | string;
  /** Presenter-derived visibility flag. Components obey it but do not derive it. */
  visible?: boolean | string;
  /** Presenter-derived interactivity flag. Components obey it but do not derive it. */
  interactive?: boolean | string;
}

/**
 * Props for buttonComponent (action button) in S1.
 */
export interface GameUiButtonComponentProps {
  caption: string;
  /** Semantic variant: "action" for primary, "helper" for journal/hint, "nav" for arrows. */
  variant?: "action" | "helper" | "nav" | string;
  /** Whether the button is disabled. */
  disabled?: boolean;
}

/**
 * Props for richTextComponent (HTML body text) in S1.
 * Renders HTML via dangerouslySetInnerHTML when the string contains "<",
 * otherwise wraps in a <p> tag.
 */
export interface GameUiRichTextComponentProps {
  /** HTML or plain-text body to render. Supports {{...}} expression binding. */
  html: string;
  /** Optional CSS class for styling context. */
  cssClass?: string;
}

/**
 * Props for imageComponent (illustrations / decorative images) in S1.
 * Renders as <img> by default, or as a background-image div when cssClass
 * contains "illustration" or "decoration" (for layout integration).
 */
export interface GameUiImageComponentProps {
  /** URL of the image to display. */
  src: string;
  /** Alt text for accessibility. */
  alt?: string;
  /** Optional CSS class for styling context. */
  cssClass?: string;
}

/** Props for a Phaser-backed board whose authoritative state still lives in runtime-api. */
export interface GameUiInteractiveBoardSurfaceProps {
  sceneId: string;
  designWidth?: number;
  designHeight?: number;
  accessibleLabel?: string;
  interactions?: {
    modeActionId?: string;
    selectActionId?: string;
  };
}

/**
 * Union of all supported S1 component props shapes.
 */
export type GameUiComponentProps =
  | GameUiScreenComponentProps
  | GameUiAreaComponentProps
  | GameUiGameVariableComponentProps
  | GameUiCardComponentProps
  | GameUiButtonComponentProps
  | GameUiRichTextComponentProps
  | GameUiImageComponentProps
  | GameUiInteractiveBoardSurfaceProps;

/**
 * Action descriptor for interactive S1 UI components.
 * Used by cardComponent and buttonComponent to define on-click behavior.
 */
export interface GameUiComponentAction {
  command: string;
  payload: Record<string, unknown>;
}

/**
 * A single UI component in the S1 manifest tree.
 * Children are nested components for container types (screenComponent, areaComponent).
 */
export interface GameUiComponent<
  TProps extends GameUiComponentProps = GameUiComponentProps
> {
  type: GameUiComponentType;
  id?: string;
  /**
   * Optional conditional rendering expression.
   *
   * The manifest renderer resolves this against gameState and local item
   * context. Falsy values skip the component without changing layout state.
   */
  if?: string;
  /**
   * Structural containers may omit component-specific options; renderers must
   * treat that omission as an empty object. The JSON Schema requires `props`
   * and the minimum meaningful field for built-in leaf components (for
   * example, `caption` for a button and `html` for rich text). This broad base
   * interface stays optional because the concrete prop requirement depends on
   * the discriminating `type` value and custom extension components remain
   * schema-defined by their own contracts.
   */
  props?: TProps;
  children?: Array<GameUiComponent>;
  /** Interactive actions for cardComponent and buttonComponent. */
  actions?: {
    onClick?: GameUiComponentAction;
  };
  /**
   * Template for iterating over a collection from game state.
   * When present, the component's children are rendered once for each item
   * in the resolved collection, with a local context bound to the current item.
   */
  itemTemplate?: GameUiItemTemplate;
  /**
   * Visual rendering mode for this component.
   * - "image": renders using a design mockup image as background-image.
   * - "style": renders using CSS classes and inline styles (default).
   * - "auto": renderer decides based on available design data (default).
   */
  visualMode?: "image" | "style" | "auto";
  /**
   * Reference to a design artifact (mockup image) for "image" visualMode.
   * The renderer resolves this against designArtifacts in the UI manifest.
   */
  designImageRef?: string;
}

/**
 * Template configuration for iterating over a collection.
 * The component renders its children for each item in the collection,
 * with local context available for data binding expressions.
 */
export interface GameUiItemTemplate {
  /**
   * Expression resolving to an array in the game state.
   * Examples: "{{state.public.cards}}", "{{currentBoard.cardIds}}"
   */
  collection: string;
  /**
   * Name of the local context variable for each item.
   * Used in binding expressions like "{{card.title}}".
   */
  itemKey: string;
  /**
   * Optional filter expression. Items for which this expression
   * resolves to falsy are excluded from rendering.
   */
  filter?: string;
}

/**
 * Screen definition for the game UI manifest entry.
 * Each screen has a root component tree and a screenId key for runtime selection.
 * This is the bounded UI shape served through the runtime-owned player-content boundary.
 */
export interface GameUiScreenDefinition {
  type: "screen";
  title: string;
  layoutId?: string;
  /**
   * Explicit layout mode for this screen.
   * When specified, the renderer uses this directly instead of heuristic resolution.
   * When absent or "auto", the renderer falls back to convention-based layout selection.
   */
  layoutMode?: GameUiLayoutMode;
  /**
   * Design region annotations from mockup files.
   * Provides layout hints (direction, padding, gap, alignment) from design artifacts.
   * The renderer may use these for CSS class mapping and spacing when available.
   */
  designRegions?: DesignRegion[];
  /** The root screenComponent of the screen. */
  root: GameUiComponent;
}

/**
 * Panel definition for transient UI layers such as journals, hints or
 * inventory overlays. Panels are not timeline screens; the Presenter opens
 * them through UI state and the renderer draws their root component tree.
 */
export interface GameUiPanelDefinition {
  type: "panel";
  title?: string;
  mode: "overlay" | "drawer" | "inline";
  layoutId?: string;
  /**
   * Explicit layout mode for this panel. Most web panels use topbar because
   * they sit above the current game screen instead of replacing timeline state.
   */
  layoutMode?: GameUiLayoutMode;
  designRegions?: DesignRegion[];
  root: GameUiComponent;
}

/**
 * A design region from a mockup file, providing layout hints
 * that bridge the design-view gap.
 */
export interface DesignRegion {
  /** Unique identifier matching a region in the design.json mockup. */
  id: string;
  /** Semantic role of this region (e.g., "metric-area", "card-area", "controls"). */
  type: string;
  /** Optional human-readable description. */
  description?: string;
  /** Layout hints from the design mockup. */
  layout?: {
    /** Layout direction: horizontal or vertical stacking. */
    direction?: "row" | "column";
    /** Padding in pixels. */
    padding?: number;
    /** Gap between items in pixels. */
    gap?: number;
    /** Alignment of items within the region. */
    align?: "start" | "center" | "end" | "stretch";
  };
  /** Optional style overrides from the design mockup. */
  style?: Record<string, unknown>;
}

/**
 * Design artifact reference stored in the UI manifest.
 */
export interface GameUiDesignArtifactRef {
  id: string;
  type: string;
  sourceRef?: {
    file?: string;
  };
}

/**
 * Bounded multi-screen UI content served through the player-facing content API.
 * Contains S1 entry screen and bounded opening-tail screens for manifest-driven rendering.
 * Asset references (image paths) are served as data, not embedded constants.
 *
 * Screen selection contract:
 * - Runtime snapshot field `timeline.screenId` selects the current screen from `screens`.
 * - Runtime snapshot field `timeline.activeInfoId` disambiguates variant info screens (e.g., i19 vs i19_1).
 * - When `timeline.screenId` is not in `screens`, the player falls back to the action catalog.
 * - The `entryPoint` field holds the canonical entry screen id (e.g. "S1" for web).
 */
export interface GamePlayerUiContent {
  /** UI manifest identifier. */
  id: string;
  /** UI manifest version. */
  version: string;
  /** The game id this UI is for. */
  gameId: string;
  /**
   * Canonical entry-point screen id for the opening flow (e.g. "S1" for web).
   * Used when no runtime snapshot is available yet (initial load).
   */
  entryPoint: string;
  /**
   * All available screen definitions keyed by screenId.
   * Covers S1 (opening entry) and bounded opening-tail screens:
   * - S1: opening entry screen with left-sidebar layout
   * - Screens 55..60 (stepIndex 30), 61..66 (stepIndex 32), 67..68 (stepIndex 34), 69..70 (stepIndex 36)
   * - Info screens i17, i18, i19, i19_1, i20, i21
   *
   * Screen selection is driven by runtime snapshot field `timeline.screenId`.
   * Variant info screens (i19 vs i19_1) are disambiguated by `timeline.activeInfoId`.
   */
  screens: Record<string, GameUiScreenDefinition>;
  /**
   * Transient UI panels keyed by panel id. Panels are game-defined UI variants
   * rendered by the platform's generic manifest renderer; they are not scenario
   * screens and do not affect timeline routing.
   */
  panels?: Record<string, GameUiPanelDefinition>;
  /**
   * Data-driven screen routing entries.
   * When provided, the generic screen router matches runtime state
   * (screenId, stepIndex, activeInfoId) against these entries to resolve
   * screen keys. Games can omit this and provide resolveScreenKey in
   * their plugin config instead.
   */
  screenRouting?: Array<ScreenRoutingEntry>;
  /** Metric specifications for fallback metric display. */
  metricSpecs?: Array<MetricConfigSpec>;
  /** Design artifact registry from the UI manifest (for reference/metadata). */
  designArtifacts?: Record<string, GameUiDesignArtifactRef>;
}

/**
 * @deprecated Use GamePlayerUiContent instead. Kept for S1-only consumers.
 * Bounded S1 UI content served through the player-facing content API.
 * Contains only the S1 screen definition needed for the opening screen renderer.
 * Asset references (image paths) are served as data, not embedded constants.
 */
export interface GamePlayerS1UiContent extends GamePlayerUiContent {
  /**
   * S1 screen definition with full component tree.
   * @deprecated Use screens["S1"] instead for multi-screen support.
   */
  screen: GameUiScreenDefinition;
}

/**
 * Metadata for a loaded content bundle served through the player-facing content API.
 * Includes version information for both the game manifest and UI manifest.
 */
export interface GameContentBundleMetadata {
  gameId: GameManifestId;
  manifestVersion: GameManifestVersion;
  uiManifestVersion?: string;
  loadedAt: string; // ISO timestamp
}

/**
 * A single screen routing rule. Maps runtime state conditions
 * (screenId, stepIndex range, active infoId) to a UI screen key.
 *
 * This replaces hard-coded step→screen mappings in game plugins,
 * making screen routing data-driven and manifest-defined.
 */
export interface ScreenRoutingEntry {
  /** Target screen key in the UI manifest (e.g., "55..60", "S1_LEFT"). */
  screenKey: string;
  /** Match conditions. All conditions must be satisfied for this entry to apply. */
  conditions: {
    /** Runtime screenId to match (e.g., "S2"). */
    screenId?: string;
    /** Step index to match exactly. */
    stepIndex?: number;
    /** Step index range (inclusive start, exclusive end). */
    stepIndexRange?: { from: number; to: number };
    /** Active info ID to match (e.g., "i19", "i19_1"). */
    activeInfoId?: string;
    /** Layout preference when this routing applies. */
    layoutMode?: GameUiLayoutMode;
  };
}

/**
 * Player-facing content DTO served through the runtime-owned content API.
 * This DTO is the public surface that `runtime-api` projects for `player-web` consumers.
 * Contains game metadata, available actions, mockups, and optional game-specific content.
 *
 * The `content` field carries game-specific gameplay content keyed by gameId.
 * The `ui` field carries the multi-screen UI manifest projection for manifest-driven rendering.
 * Screen selection is driven by runtime snapshot fields (`timeline.screenId`, `timeline.activeInfoId`),
 * not by UI-side heuristics.
 */
export interface PlayerFacingContent {
  gameId: GameManifestId;
  version: GameManifestVersion;
  name: string;
  description: string;
  locale: GameManifestLocale;
  playerConfig: GameManifestPlayerConfig;
  training?: GameManifestTraining;
  /**
   * Public gameplay execution mode.
   *
   * Player channels use this only to choose the transport boundary:
   * deterministic actions still go through `/actions`, while AI-driven games
   * request validated Agent Turns through `/agent-turns`.
   */
  executionMode?: GameManifestExecutionMode;
  /**
   * Public Agent Runtime declaration.
   *
   * This intentionally omits prompt/context exposure policy details. The
   * browser only needs to know whether Agent Runtime is required and how to
   * present a pause/retry state when it is unavailable.
   */
  agentRuntime?: PlayerFacingAgentRuntimeConfig;
  actions: Array<PlayerFacingAction>;
  mockups: Array<PlayerFacingMockup>;
  /** Runtime object models used by generic Presenter projection. */
  objectModels?: GameManifestObjectModelMap;
  /** Game-specific gameplay content keyed by gameId. */
  content?: Record<string, unknown>;
  /** Multi-screen UI manifest projection for manifest-driven rendering. */
  ui?: GamePlayerUiContent;
  /**
   * Browser-loadable player-web plugin bundles.
   *
   * Preview bundles are scoped to one editor content source. Published bundles
   * are immutable artifacts created by the publish pipeline. In both cases
   * runtime-api only passes references and never executes browser plugin code.
   */
  pluginBundles?: Array<PlayerWebPluginBundleReference>;
}

export interface PlayerFacingAgentRuntimeConfig {
  agentId?: string;
  /** Published Game Intent the player channel sends for the first AI turn. */
  initialActionId: string;
  runtimeId?: string;
  required: boolean;
  failurePolicy: GameManifestAgentFailurePolicy;
  deterministicFallbackActionId?: string;
  surfaceCatalog: Array<string>;
}

export type PlayerWebPluginBundleScope = "preview" | "published";

/**
 * Browser-loadable project-local plugin module.
 *
 * `url` is relative to runtime-api. The browser must resolve it against the
 * runtime-api origin and cache/import by `contentHash`, rather than reading
 * editor worktree paths or project source files directly.
 */
export interface PlayerWebPluginBundleReference {
  pluginId: string;
  gameId: GameManifestId;
  apiVersion: string;
  target: "player-web";
  scope: PlayerWebPluginBundleScope;
  contentHash: string;
  /** Optional Subresource Integrity-style digest for published artifacts. */
  integrity?: string;
  url: string;
}

/**
 * Metric specification for fallback metric display.
 * Describes a single metric with its ID, display caption, and value binding.
 * This replaces the player-web-specific FallbackMetricSpec and makes metric
 * configuration part of the manifest data, derivable without hardcoded config.
 */
export interface MetricConfigSpec {
  /** Metric identifier (e.g., "time", "remainingDays", "pro"). */
  id: string;
  /** Display caption (e.g., "Остаток дней", "Баллы"). */
  caption: string;
  /** Optional description. */
  description?: string;
  /** Value binding expression (e.g., "{{game.state.public.metrics.time}}"). */
  value: string;
  /** Alternate identifiers for metric lookup (aliases). */
  aliases?: Array<string>;
  /** Background images for different layout modes. */
  images?: {
    sidebar?: string;
    topbar?: string;
  };
  /** Layout variant: "prominent" for primary metric, "default" for others. */
  layout?: "default" | "prominent";
}

export interface GameMetricView {
  /** Stable gameplay metric id. */
  metricId: string;
  /** Canonical label from the game manifest metric catalog. */
  label: string;
  /** Optional canonical description from the game manifest metric catalog. */
  description?: string;
  /** Raw value prepared for player-facing renderers. */
  value: unknown;
  /** String form for renderers that do not apply their own formatting. */
  formattedValue: string;
  /** Source kind from the metric catalog. */
  kind: "state" | "computed";
  /** State path for state-backed metrics. */
  statePath?: string;
}

/**
 * Platform-level action command constants.
 *
 * These are the canonical command strings used in onClick actions
 * across manifest-driven and convention-based rendering.
 * Use these constants instead of bare string literals to ensure
 * consistency and discoverability.
 */
export const ManifestAction = {
  /** Show a manifest-defined UI panel. */
  SHOW_PANEL: "showPanel",
  /** Close the active manifest-defined UI panel. */
  CLOSE_PANEL: "closePanel",
  /** Dismiss an active panel (history, hint, etc.). */
  DISMISS_PANEL: "dismiss_panel",
  /** Request a server action (most common game action). */
  REQUEST_SERVER: "requestServer",
  /** Advance the game timeline (info screens, selections). */
  ADVANCE: "advance",
  /** Reset the game session. */
  RESET_GAME: "reset_game",
} as const;

export type ManifestActionType = (typeof ManifestAction)[keyof typeof ManifestAction];
