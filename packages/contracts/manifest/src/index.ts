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
  lineIndex?: number;
  stepIndex?: number;
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
    stepIndex?: number;
    canAdvance?: boolean;
  };
  stateConditions?: Array<GameManifestDeterministicStateCondition>;
  [key: string]: unknown;
}

export interface GameManifestDeterministicMetricDelta {
  metricId: string;
  delta: number;
}

export type GameManifestDeterministicMetricOperator = ">" | "<" | "==";

/**
 * Bounded metric comparison used by explicit deterministic card-local hooks.
 */
export interface GameManifestDeterministicMetricCondition {
  metricId: string;
  operator: GameManifestDeterministicMetricOperator;
  threshold: number;
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
  targetStepIndex: number;
  targetStageId?: string;
  targetScreenId?: string;
  targetInfoId?: string;
  timelineCanAdvance?: boolean;
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
}

export interface GameManifestDeterministicStatePatch {
  op: "add" | "replace" | "remove" | "increment" | "append";
  path: string;
  value?: unknown;
}

export interface GameManifestDeterministicStateUpdate {
  timelineCanAdvance?: boolean;
  // Explicit timeline coordinates for deterministic transitions (for example intro info step -> next screen).
  timelineStepIndex?: number;
  timelineStageId?: string;
  timelineScreenId?: string;
  activeInfoId?: string;
  selectedCardId?: string;
  statePatches?: Array<GameManifestDeterministicStatePatch>;
}

export interface GameManifestDeterministicActionMetadata {
  provenance: Array<GameManifestDeterministicSourceRef>;
  guard: GameManifestDeterministicGuard;
  metricDeltas: Array<GameManifestDeterministicMetricDelta>;
  conditionalMetricBonuses?: Array<GameManifestDeterministicConditionalMetricBonus>;
  conditionalStateBonuses?: Array<GameManifestDeterministicConditionalStateBonus>;
  conditionalInfoVariant?: GameManifestDeterministicConditionalInfoVariant;
  conditionalLineSwitch?: GameManifestDeterministicConditionalLineSwitch;
  log: GameManifestDeterministicLogMetadata;
  stateUpdate: GameManifestDeterministicStateUpdate;
}

export interface GameManifestActionDefinition {
  handlerType: "script" | "ui" | "ai" | "system" | "unknown" | string;
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
  | "buttonComponent";

/**
 * Props for screenComponent in S1 layout.
 */
export interface GameUiScreenComponentProps {
  cssClass?: string;
  backgroundImage?: string;
}

/**
 * Props for areaComponent (layout container) in S1.
 */
export interface GameUiAreaComponentProps {
  cssClass?: string;
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
}

/**
 * Props for cardComponent (interactive card) in S1.
 */
export interface GameUiCardComponentProps {
  text?: string;
}

/**
 * Props for buttonComponent (action button) in S1.
 */
export interface GameUiButtonComponentProps {
  caption: string;
}

/**
 * Union of all supported S1 component props shapes.
 */
export type GameUiComponentProps =
  | GameUiScreenComponentProps
  | GameUiAreaComponentProps
  | GameUiGameVariableComponentProps
  | GameUiCardComponentProps
  | GameUiButtonComponentProps;

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
  /** The root screenComponent of the screen. */
  root: GameUiComponent;
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


