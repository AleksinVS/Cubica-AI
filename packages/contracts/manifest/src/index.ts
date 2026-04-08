/**
 * Cubica Manifest Contracts
 * Version: 1.2.0
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
 * - `runtime-api` player-content API: uses `PlayerFacingContent`, `AntarcticaPlayerUiContent`
 * - `player-web` renderer: uses `AntarcticaPlayerUiContent`, `AntarcticaPlayerS1UiContent` (deprecated), `AntarcticaUiComponent` types
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
  antarctica?: AntarcticaPlayerContent;
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
 * Minimal guard shape for the first Antarctica opening-card and team-selection slices.
 */
export interface GameManifestDeterministicGuard {
  timeline?: {
    line?: string;
    stepIndex?: number;
    canAdvance?: boolean;
  };
  opening?: {
    selectedCardIdAbsent?: boolean;
    selectedCardIdEquals?: string;
  };
  card?: {
    id: string;
    selected?: boolean;
    resolved?: boolean;
    locked?: boolean;
    available?: boolean;
  };
  teamSelection?: {
    pickCountLessThan?: number;
    pickCountEquals?: number;
  };
  team?: {
    memberId: string;
    selected?: boolean;
  };
  board?: {
    cardIds: Array<string>;
    resolvedCountAtLeast?: number;
  };
}

export interface GameManifestDeterministicMetricDelta {
  metricId: string;
  delta: number;
}

export type GameManifestDeterministicMetricOperator = ">" | "<" | "==";

/**
 * Bounded metric comparison used by explicit Antarctica card-local hooks.
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

/**
 * Local bonus gated by previously known card state.
 */
export interface GameManifestDeterministicConditionalCardBonus {
  whenCard: {
    cardId: string;
    selected?: boolean;
    resolved?: boolean;
    locked?: boolean;
    available?: boolean;
  };
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

export interface GameManifestDeterministicStateUpdate {
  timelineCanAdvance?: boolean;
  // Explicit timeline coordinates for deterministic transitions (for example intro info step -> next screen).
  timelineStepIndex?: number;
  timelineStageId?: string;
  timelineScreenId?: string;
  activeInfoId?: string;
  selectedCardId?: string;
  boardThreshold?: {
    cardIds: Array<string>;
    resolvedCountAtLeast: number;
    timelineCanAdvance?: boolean;
  };
  cardFlags?: {
    cardId: string;
    selected?: boolean;
    resolved?: boolean;
    locked?: boolean;
    available?: boolean;
  };
  boardCardUnlock?: {
    cardIds: Array<string>;
    resolvedCountAtLeast: number;
    unlockCardId: string;
  };
  boardEntryAltCardSwap?: {
    when: GameManifestDeterministicMetricCondition;
    baseCardId: string;
    altCardId: string;
  };
  teamFlags?: {
    memberId: string;
    selected?: boolean;
  };
  teamSelection?: {
    pickCountDelta?: number;
    selectedMemberIdsAppend?: string;
  };
}

export interface GameManifestDeterministicActionMetadata {
  provenance: Array<GameManifestDeterministicSourceRef>;
  guard: GameManifestDeterministicGuard;
  metricDeltas: Array<GameManifestDeterministicMetricDelta>;
  conditionalMetricBonuses?: Array<GameManifestDeterministicConditionalMetricBonus>;
  conditionalCardBonuses?: Array<GameManifestDeterministicConditionalCardBonus>;
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

export interface AntarcticaPlayerInfoEntry {
  id: string;
  stepIndex: number;
  screenId: string;
  title: string;
  body: string;
  advanceActionId: string;
  advanceLabel?: string;
}

export interface AntarcticaPlayerTeamSelectionMember {
  memberId: string;
  name: string;
  summary: string;
  selectActionId: string;
  selectLabel?: string;
}

export interface AntarcticaPlayerTeamSelectionScene {
  id: string;
  stepIndex: number;
  screenId: string;
  title: string;
  body: string;
  requiredPickCount: number;
  confirmActionId: string;
  confirmLabel?: string;
  members: Array<AntarcticaPlayerTeamSelectionMember>;
}

export interface AntarcticaPlayerBoardCard {
  cardId: string;
  title: string;
  summary: string;
  selectActionId: string;
  selectLabel?: string;
  advanceActionId?: string;
  advanceLabel?: string;
}

export interface AntarcticaPlayerBoard {
  id: string;
  title?: string;
  body?: string;
  stepIndex: number;
  screenId: string;
  cardIds: Array<string>;
}

export interface AntarcticaPlayerContent {
  infos: Array<AntarcticaPlayerInfoEntry>;
  boards: Array<AntarcticaPlayerBoard>;
  teamSelections?: Array<AntarcticaPlayerTeamSelectionScene>;
  cards: Array<AntarcticaPlayerBoardCard>;
}

/**
 * Bounded S1 UI component types supported by the manifest-driven renderer.
 * Only these component types are allowed in the player-web S1 delivery slice.
 */
export type AntarcticaUiComponentType =
  | "screenComponent"
  | "areaComponent"
  | "gameVariableComponent"
  | "cardComponent"
  | "buttonComponent";

/**
 * Props for screenComponent in S1 layout.
 */
export interface AntarcticaUiScreenComponentProps {
  cssClass?: string;
  backgroundImage?: string;
}

/**
 * Props for areaComponent (layout container) in S1.
 */
export interface AntarcticaUiAreaComponentProps {
  cssClass?: string;
}

/**
 * Props for gameVariableComponent (metric display) in S1 sidebar.
 */
export interface AntarcticaUiGameVariableComponentProps {
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
export interface AntarcticaUiCardComponentProps {
  text?: string;
}

/**
 * Props for buttonComponent (action button) in S1.
 */
export interface AntarcticaUiButtonComponentProps {
  caption: string;
}

/**
 * Union of all supported S1 component props shapes.
 */
export type AntarcticaUiComponentProps =
  | AntarcticaUiScreenComponentProps
  | AntarcticaUiAreaComponentProps
  | AntarcticaUiGameVariableComponentProps
  | AntarcticaUiCardComponentProps
  | AntarcticaUiButtonComponentProps;

/**
 * Action descriptor for interactive S1 UI components.
 * Used by cardComponent and buttonComponent to define on-click behavior.
 */
export interface AntarcticaUiComponentAction {
  command: string;
  payload: Record<string, unknown>;
}

/**
 * A single UI component in the S1 manifest tree.
 * Children are nested components for container types (screenComponent, areaComponent).
 */
export interface AntarcticaUiComponent<
  TProps extends AntarcticaUiComponentProps = AntarcticaUiComponentProps
> {
  type: AntarcticaUiComponentType;
  id?: string;
  props: TProps;
  children?: Array<AntarcticaUiComponent>;
  /** Interactive actions for cardComponent and buttonComponent. */
  actions?: {
    onClick?: AntarcticaUiComponentAction;
  };
}

/**
 * Screen definition for the Antarctica UI manifest entry.
 * Each screen has a root component tree and a screenId key for runtime selection.
 * This is the bounded UI shape served through the runtime-owned player-content boundary.
 */
export interface AntarcticaUiScreenDefinition {
  type: "screen";
  title: string;
  layoutId?: string;
  /** The root screenComponent of the screen. */
  root: AntarcticaUiComponent;
}

/**
 * Design artifact reference stored in the UI manifest.
 */
export interface AntarcticaUiDesignArtifactRef {
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
 * - The `entryPoint` field holds the canonical entry screen id ("S1" for Antarctica web).
 */
export interface AntarcticaPlayerUiContent {
  /** UI manifest identifier. */
  id: string;
  /** UI manifest version. */
  version: string;
  /** The game id this UI is for. */
  gameId: string;
  /**
   * Canonical entry-point screen id for the opening flow (always "S1" for Antarctica web).
   * Used when no runtime snapshot is available yet (initial load).
   */
  entryPoint: string;
  /**
   * All available screen definitions keyed by screenId.
   * Covers S1 (opening entry) and bounded opening-tail screens:
   * - S1: opening entry screen with left-sidebar layout
   * - Screens 55..60 (stepIndex 30), 61..66 (stepIndex 32), 67..70 (stepIndex 34)
   * - Info screens i17, i18, i19, i19_1, i20, i21
   *
   * Screen selection is driven by runtime snapshot field `timeline.screenId`.
   * Variant info screens (i19 vs i19_1) are disambiguated by `timeline.activeInfoId`.
   */
  screens: Record<string, AntarcticaUiScreenDefinition>;
  /** Design artifact registry from the UI manifest (for reference/metadata). */
  designArtifacts?: Record<string, AntarcticaUiDesignArtifactRef>;
}

/**
 * @deprecated Use AntarcticaPlayerUiContent instead. Kept for S1-only consumers.
 * Bounded S1 UI content served through the player-facing content API.
 * Contains only the S1 screen definition needed for the opening screen renderer.
 * Asset references (image paths) are served as data, not embedded constants.
 */
export interface AntarcticaPlayerS1UiContent extends AntarcticaPlayerUiContent {
  /**
   * S1 screen definition with full component tree.
   * @deprecated Use screens["S1"] instead for multi-screen support.
   */
  screen: AntarcticaUiScreenDefinition;
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
 * For Antarctica, the `antarcticaUi` field carries manifest-driven UI screen definitions.
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
  /** Antarctica-specific gameplay content (boards, info entries, cards). */
  antarctica?: AntarcticaPlayerContent;
  /**
   * Antarctica-specific multi-screen UI manifest data for manifest-driven rendering.
   * When present, enables UI-based rendering for in-scope screens.
   * Fallback to action catalog for screens not covered by the UI manifest.
   */
  antarcticaUi?: AntarcticaPlayerUiContent;
}

/**
 * Extended PlayerFacingContent for Antarctica with full UI manifest support.
 * This type explicitly documents the Antarctica UI contract surface.
 *
 * @deprecated Use `PlayerFacingContent` with `antarcticaUi` field instead.
 */
export interface AntarcticaPlayerFacingContent extends PlayerFacingContent {
  /** Antarctica gameplay content projection. */
  antarctica?: AntarcticaPlayerContent;
  /** Multi-screen UI manifest data for manifest-driven rendering. */
  antarcticaUi?: AntarcticaPlayerUiContent;
}


