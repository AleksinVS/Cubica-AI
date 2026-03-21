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
 * Local pre-base line switch for explicit deterministic cards.
 */
export interface GameManifestDeterministicConditionalLineSwitch {
  when: GameManifestDeterministicMetricCondition;
  targetLine: string;
  targetStepIndex: number;
  targetStageId?: string;
  targetScreenId?: string;
  timelineCanAdvance?: boolean;
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
}
