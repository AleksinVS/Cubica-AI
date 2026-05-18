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

/**
 * Generic game state type. Game plugins extend this with their own
 * game-specific state shape (e.g. AntarcticaGameState).
 * The platform layer never assumes a specific shape — only plugins do.
 */
export type GameState = Record<string, unknown>;

export type GameManifestId = string;
export type GameManifestVersion = string;
export type GameManifestLocale = string;
export type GameManifestPath = string;

export interface ManifestBundleRef {
  gameId: GameManifestId;
  version?: GameManifestVersion;
  channel?: string;
}

export interface GameManifestDocumentRef {
  path: GameManifestPath;
  kind?: string;
  title?: string;
  note?: string;
}

export interface GameManifestDesignArtifactRef {
  path: GameManifestPath;
  kind: "mockup" | "wireframe" | "concept" | "storyboard" | "reference" | "asset" | string;
  title?: string;
  note?: string;
}

export interface GameManifestCompetency {
  id: string;
  name: string;
  description?: string;
}

export interface GameManifestTraining {
  format: "single" | "group" | "facilitated" | string;
  duration?: {
    minMinutes?: number;
    maxMinutes?: number;
  };
  competencies?: Array<GameManifestCompetency>;
}

export interface GameManifestMeta {
  id: GameManifestId;
  version: GameManifestVersion;
  name: string;
  description: string;
  author?: string;
  schemaVersion: string;
  minEngineVersion?: string;
  tags?: Array<string>;
  training?: GameManifestTraining;
  references?: Array<GameManifestDocumentRef>;
}

export interface GameManifestPlayerConfig {
  min: number;
  max: number;
}

export interface GameManifestSettings {
  mode: string;
  locale: GameManifestLocale;
}

export interface GameManifestConfig {
  players: GameManifestPlayerConfig;
  settings: GameManifestSettings;
}

export interface GameManifestContent {
  scenario?: GameManifestDocumentRef;
  scripts?: Array<GameManifestDocumentRef>;
  design?: {
    mockups?: Array<GameManifestDesignArtifactRef>;
    references?: Array<GameManifestDesignArtifactRef>;
  };
  methodology?: {
    participants?: GameManifestDocumentRef;
    facilitators?: GameManifestDocumentRef;
  };
  /** Game-specific content is keyed by gameId. */
  [key: string]: unknown;
}

export interface GameManifestEngineConfig {
  systemPrompt: string;
  modelConfig?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    seed?: number;
  };
}

export interface GameManifestState<TPublicState = Record<string, unknown>, TSecretState = Record<string, unknown>> {
  public: TPublicState;
  secret?: TSecretState;
}

/**
 * Links deterministic metadata back to the exact legacy artifact used for extraction.
 */
export interface GameManifestDeterministicSourceRef {
  sourceKind: "legacy-opening-card" | string;
  sourceFile: GameManifestPath;
  legacyCardId: string;
  lineIndex?: number | string;
  stepIndex?: number | string;
}

/**
 * Minimal guard shape for deterministic opening-card and team-selection slices.
 */
export interface GameManifestDeterministicStateCondition {
  path: string;
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=" | "exists" | "not_exists";
  value?: unknown;
}

export interface GameManifestDeterministicGuard {
  timeline?: {
    line?: string;
    stepIndex?: number | string;
    canAdvance?: boolean | string;
  };
  stateConditions?: Array<GameManifestDeterministicStateCondition>;
  jsonLogic?: JsonLogicExpression;
  [key: string]: unknown;
}

/**
 * JsonLogic expression — a recursive JSON structure evaluated by json-logic-js.
 * JsonLogic is a small JSON-based rules format; operator arguments can be a
 * single value (`{"var":"public.metrics.pro"}`) or a list of nested values.
 */
export type JsonLogicExpression =
  | string
  | number
  | boolean
  | null
  | { [operator: string]: JsonLogicExpression | Array<JsonLogicExpression> };

export interface GameManifestDeterministicMetricDelta {
  metricId: string;
  delta: number | string | JsonLogicExpression;
}

export type GameManifestDeterministicMetricOperator = ">" | "<" | "==";

/**
 * Bounded metric comparison used by explicit deterministic card-local hooks.
 */
export interface GameManifestDeterministicMetricCondition {
  metricId: string;
  operator: GameManifestDeterministicMetricOperator;
  threshold: number | string;
}

/**
 * Local post-base metric bonus for explicit deterministic cards.
 */
export interface GameManifestDeterministicConditionalMetricBonus {
  when: GameManifestDeterministicMetricCondition;
  metricDeltas: Array<GameManifestDeterministicMetricDelta>;
}

export interface GameManifestDeterministicConditionalStateBonus {
  when: Array<GameManifestDeterministicStateCondition>;
  metricDeltas: Array<GameManifestDeterministicMetricDelta>;
}

/**
 * Local pre-base line switch for explicit deterministic cards.
 */
export interface GameManifestDeterministicConditionalLineSwitch {
  when: GameManifestDeterministicMetricCondition;
  targetLine: string;
  targetStepIndex: number | string;
  targetStageId?: string;
  targetScreenId?: string;
  targetInfoId?: string;
  timelineCanAdvance?: boolean | string;
}

/**
 * Local info variant switch used when entering an info block.
 */
export interface GameManifestDeterministicConditionalInfoVariant {
  when: GameManifestDeterministicMetricCondition;
  activeInfoId: string;
}

export interface GameManifestDeterministicLogMetadata {
  kind: string;
  summary: string;
  stageId?: string;
  cardId?: string;
  memberId?: string;
  /** Back (flipped/result) text of the card, shown in the journal after the choice is made. */
  backText?: string;
}

export interface GameManifestDeterministicStatePatch {
  op: "add" | "replace" | "remove" | "increment" | "append";
  path: string;
  value?: unknown;
}

export interface GameManifestDeterministicStateUpdate {
  timelineCanAdvance?: boolean | string;
  // Explicit timeline coordinates for deterministic transitions (for example intro info step -> next screen).
  timelineStepIndex?: number | string;
  timelineStageId?: string;
  timelineScreenId?: string;
  activeInfoId?: string;
  selectedCardId?: string;
  statePatches?: Array<GameManifestDeterministicStatePatch>;
}

export interface GameManifestDeterministicActionMetadata {
  provenance?: Array<GameManifestDeterministicSourceRef>;
  guard?: GameManifestDeterministicGuard;
  metricDeltas?: Array<GameManifestDeterministicMetricDelta>;
  conditionalMetricBonuses?: Array<GameManifestDeterministicConditionalMetricBonus>;
  conditionalCardBonuses?: Array<any>;
  conditionalStateBonuses?: Array<GameManifestDeterministicConditionalStateBonus>;
  conditionalInfoVariant?: GameManifestDeterministicConditionalInfoVariant;
  conditionalLineSwitch?: GameManifestDeterministicConditionalLineSwitch;
  log?: GameManifestDeterministicLogMetadata;
  stateUpdate?: GameManifestDeterministicStateUpdate;
  /** If true, the runtime will skip creating a log entry for this action. */
  excludeFromLog?: boolean;
  [key: string]: unknown;
}

export interface GameManifestActionDefinition {
  handlerType: "script" | "ui" | "ai" | "system" | "unknown" | string;
  templateId?: string;
  params?: Record<string, unknown>;
  capabilityFamily?: string;
  capability?: string;
  function?: string;
  displayName?: string;
  description?: string;
  tags?: Array<string>;
  payloadSchema?: Record<string, unknown>;
  deterministic?: GameManifestDeterministicActionMetadata;
  raw?: Record<string, unknown>;
}

export type GameManifestActionMap = Record<string, GameManifestActionDefinition>;

export type GameManifestTemplateMap = Record<string, Partial<GameManifestActionDefinition>>;

export interface GameManifest<
  TPublicState = Record<string, unknown>,
  TSecretState = Record<string, unknown>,
  TActions extends GameManifestActionMap = GameManifestActionMap
> {
  meta: GameManifestMeta;
  config: GameManifestConfig;
  content?: GameManifestContent;
  engine?: GameManifestEngineConfig;
  state: GameManifestState<TPublicState, TSecretState>;
  actions: TActions;
  templates?: GameManifestTemplateMap;
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
  | "imageComponent";

/**
 * Props for screenComponent in S1 layout.
 */
export interface GameUiScreenComponentProps {
  cssClass?: string;
  backgroundImage?: string;
  /** Visual mode override at screen level. Components inherit unless they override. */
  visualMode?: "image" | "style" | "auto";
}

/**
 * Props for areaComponent (layout container) in S1.
 */
export interface GameUiAreaComponentProps {
  cssClass?: string;
  /** Visual mode override at area level. */
  visualMode?: "image" | "style" | "auto";
  /** Reference to a design artifact image for "image" visualMode. */
  designImageRef?: string;
}

/**
 * Props for gameVariableComponent (metric display) in S1 sidebar.
 */
export interface GameUiGameVariableComponentProps {
  caption: string;
  description?: string;
  backgroundImage?: string;
  /**
   * Binding expression for the metric value, e.g. "{{game.state.public.metrics.score}}".
   * The renderer resolves this against the session snapshot at display time.
   */
  value: string;
  /**
   * Layout variant for the metric display.
   * - "default": standard size
   * - "prominent": larger display (e.g., primary score metric)
   * Replaces the previous id-based "score" check — games should set this
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
  | GameUiImageComponentProps;

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
  props: TProps;
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
  layoutMode?: "leftsidebar" | "topbar" | "auto";
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
    layoutMode?: "leftsidebar" | "topbar";
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
  actions: Array<PlayerFacingAction>;
  mockups: Array<PlayerFacingMockup>;
  /** Game-specific gameplay content keyed by gameId. */
  content?: Record<string, unknown>;
  /** Multi-screen UI manifest projection for manifest-driven rendering. */
  ui?: GamePlayerUiContent;
}

/**
 * Metric specification for fallback metric display.
 * Describes a single metric with its ID, display caption, and value binding.
 * This replaces the player-web-specific FallbackMetricSpec and makes metric
 * configuration part of the manifest data, derivable without hardcoded config.
 */
export interface MetricConfigSpec {
  /** Metric identifier (e.g., "time", "score", "pro"). */
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
  /** Layout variant: "prominent" for primary score metric, "default" for others. */
  layout?: "default" | "prominent";
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
  /** Show the move history panel. */
  SHOW_HISTORY: "showHistory",
  /** Show the hint panel. */
  SHOW_HINT: "showHint",
  /** Dismiss an active panel (history, hint, etc.). */
  DISMISS_PANEL: "dismiss_panel",
  /** Request a server action (most common game action). */
  REQUEST_SERVER: "requestServer",
  /** Advance the game timeline (info screens, selections). */
  ADVANCE: "advance",
  /** Reset the game session. */
  RESET_GAME: "reset_game",
  /** Switch to a left-sidebar layout screen. */
  SHOW_LEFT_SIDEBAR: "showScreenWithLeftSideBar",
} as const;

export type ManifestActionType = (typeof ManifestAction)[keyof typeof ManifestAction];

