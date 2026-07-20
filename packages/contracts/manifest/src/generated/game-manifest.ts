/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical JSON Schema in docs/architecture/schemas/ (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   npm run generate:contracts
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */
import type {GameIntentCatalog} from "./game-intent.ts";
import type {CubicaMechanicsIRV1Alpha1} from "./mechanics-plan.ts";


/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestConfig".
 */
export type GameManifestConfig = {
  [k: string]: unknown;
} & {
  players: GameManifestPlayerConfig;
  settings: GameManifestSettings;
  sessionMode?: "standard" | "facilitated";
  /**
   * Explicit publication gate. False prevents new runtime sessions while authoring content is incomplete.
   */
  runtimeReady?: boolean;
  /**
   * Bounded internal reasons explaining why runtimeReady is false.
   *
   * @minItems 1
   * @maxItems 64
   */
  runtimeBlockers?: [string, ...string[]];
  turnModel?: GameManifestTurnModel;
};
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestLocale".
 */
export type GameManifestLocale = string;
/**
 * Canonical metric metadata. State metrics read authoritative state; computed metrics are player-facing derived values.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestMetricDefinition".
 */
export type GameManifestMetricDefinition = GameManifestStateMetricDefinition | GameManifestComputedMetricDefinition;
/**
 * Recursive JsonLogic expression. Operators map either to one nested expression, for example {"var":"public.metrics.pro"}, or to an array of nested expressions.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "JsonLogicExpression".
 */
export type JsonLogicExpression =
  | string
  | number
  | boolean
  | null
  | {
      [k: string]: JsonLogicExpression | JsonLogicExpression[];
    };
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestPath".
 */
export type GameManifestPath = string;
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestExecutionMode".
 */
export type GameManifestExecutionMode = "deterministic" | "hybrid" | "ai-driven";
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestAgentFailurePolicy".
 */
export type GameManifestAgentFailurePolicy = "pause" | "retry" | "deterministicFallback" | "facilitatorTakeover";
/**
 * Cubica Manifest Contracts Version: 1.3.0
 *
 * Bounded contract surface for game manifest structures, player-facing content projections, and UI component types used by runtime-api and player-web consumers.
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
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestId".
 */
export type GameManifestId = string;
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestVersion".
 */
export type GameManifestVersion = string;
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectFacetValue".
 */
export type GameManifestObjectFacetValue = string | number | boolean;
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectScope".
 */
export type GameManifestObjectScope = "session";
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectVisibility".
 */
export type GameManifestObjectVisibility = "public" | "secret";
/**
 * Bounded identifier safe for use as an own object key or JSON Pointer segment.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestSafeIdentifier".
 */
export type GameManifestSafeIdentifier = string;

export interface GameManifestSchemaDefs {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifest".
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "RootGameManifest".
 */
export interface GameManifest {
  /**
   * Published Game Intent catalog. Its complete structure is validated by the separate JSON Schema 2020-12 contract.
   */
  actions: GameIntentCatalog;
  config: GameManifestConfig;
  content?: GameManifestContent;
  engine?: GameManifestEngineConfig;
  executionMode?: GameManifestExecutionMode;
  agentRuntime?: GameManifestAgentRuntimeConfig;
  meta: GameManifestMeta;
  objectModels?: GameManifestObjectModelMap;
  networkModels?: GameManifestTransportNetworkModelMap;
  state: GameManifestState3Calias942026824741387426494202682402184393Cstring2Cunknown3E2Calias942026824741387426494202682402184393Cstring2Cunknown3E3E;
  /**
   * Canonical Mechanics IR bundle. Its complete structure is validated by the separate JSON Schema 2020-12 contract.
   */
  mechanics: CubicaMechanicsIRV1Alpha1;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestPlayerConfig".
 */
export interface GameManifestPlayerConfig {
  max: number;
  min: number;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestSettings".
 */
export interface GameManifestSettings {
  locale: GameManifestLocale;
  mode: string;
}
/**
 * Ordered phases used by deterministic turn-based games. The first phase starts every turn.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTurnModel".
 */
export interface GameManifestTurnModel {
  /**
   * @minItems 1
   */
  phases: [string, ...string[]];
}
/**
 * Known platform content fields plus game-specific content keyed by gameId.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestContent".
 */
export interface GameManifestContent {
  data?: GameManifestContentData;
  design?: {
    mockups?: GameManifestDesignArtifactRef[];
    references?: GameManifestDesignArtifactRef[];
  };
  methodology?: {
    facilitators?: GameManifestDocumentRef;
    participants?: GameManifestDocumentRef;
  };
  scenario?: GameManifestDocumentRef;
  scripts?: GameManifestDocumentRef[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestContentData".
 */
export interface GameManifestContentData {
  /**
   * Canonical gameplay metric catalog owned by the game manifest.
   */
  metrics?: GameManifestMetricDefinition[];
  /**
   * Game-owned rule constants available to computed metric expressions.
   */
  rules?: {
    dayLimit?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestStateMetricDefinition".
 */
export interface GameManifestStateMetricDefinition {
  aliases?: string[];
  description?: string;
  format?: string;
  kind: "state";
  label: string;
  metricId: string;
  /**
   * Dot path inside runtime state, for example public.metrics.time.
   */
  statePath: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestComputedMetricDefinition".
 */
export interface GameManifestComputedMetricDefinition {
  aliases?: string[];
  computed: {
    expression: JsonLogicExpression;
  };
  description?: string;
  format?: string;
  kind: "computed";
  label: string;
  metricId: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDesignArtifactRef".
 */
export interface GameManifestDesignArtifactRef {
  kind: string;
  note?: string;
  path: GameManifestPath;
  title?: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDocumentRef".
 */
export interface GameManifestDocumentRef {
  kind?: string;
  note?: string;
  path: GameManifestPath;
  title?: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestEngineConfig".
 */
export interface GameManifestEngineConfig {
  modelConfig?: {
    maxTokens?: number;
    seed?: number;
    temperature?: number;
    topP?: number;
  };
  systemPrompt: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestAgentRuntimeConfig".
 */
export interface GameManifestAgentRuntimeConfig {
  agentId: string;
  /**
   * Published Game Intent dispatched to start an AI-driven or hybrid interaction. The compiler verifies that this action exists in the same immutable manifest.
   */
  initialActionId: string;
  runtimeId?: string;
  required: boolean;
  allowedCapabilities: string[];
  allowedTools?: string[];
  surfaceCatalog: string[];
  failurePolicy: GameManifestAgentFailurePolicy;
  deterministicFallbackActionId?: string;
  contextExposurePolicy: {
    /**
     * Current fail-closed profile exposes the player-facing public projection. Other profiles require a schema and projector extension.
     */
    publicState: true;
    /**
     * Secret state is not exposed to Agent Runtime until a role-scoped projector is implemented and reviewed.
     */
    secretState: "none";
    /**
     * @minItems 2
     * @maxItems 2
     */
    manifestProjection: ["/meta" | "/actions", "/meta" | "/actions"];
  };
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestMeta".
 */
export interface GameManifestMeta {
  author?: string;
  description: string;
  id: GameManifestId;
  minEngineVersion?: string;
  name: string;
  references?: GameManifestDocumentRef[];
  schemaVersion: string;
  tags?: string[];
  training?: GameManifestTraining;
  version: GameManifestVersion;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTraining".
 */
export interface GameManifestTraining {
  competencies?: GameManifestCompetency[];
  duration?: {
    maxMinutes?: number;
    minMinutes?: number;
  };
  format: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestCompetency".
 */
export interface GameManifestCompetency {
  description?: string;
  id: string;
  name: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectModelMap".
 */
export interface GameManifestObjectModelMap {
  [k: string]: GameManifestObjectModel;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectModel".
 */
export interface GameManifestObjectModel {
  collection: string;
  facets: {
    [k: string]: GameManifestObjectFacetModel;
  };
  idField?: string;
  scope: GameManifestObjectScope;
  view?: {
    facets?: {
      [k: string]: GameManifestObjectViewRule;
    };
  };
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectFacetModel".
 */
export interface GameManifestObjectFacetModel {
  initial: GameManifestObjectFacetValue;
  /**
   * @minItems 1
   */
  values: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectViewRule".
 */
export interface GameManifestObjectViewRule {
  fields?: {
    [k: string]: string;
  };
  interactive?: boolean;
  selectLabelFrom?: string;
  summaryFrom?: string;
  textFrom?: string;
  titleFrom?: string;
  visible?: boolean;
  visualState?: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportNetworkModelMap".
 */
export interface GameManifestTransportNetworkModelMap {
  [k: string]: GameManifestTransportNetworkModel;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportNetworkModel".
 */
export interface GameManifestTransportNetworkModel {
  visibility: GameManifestObjectVisibility;
  nodeCollection: string;
  edgeCollection: string;
  waypointObjectType: string;
  edgeObjectType: string;
  edgeStateFacet: string;
  nodeStateFacet: string;
  /**
   * @minItems 1
   */
  buildableNodeStates: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  /**
   * @minItems 1
   */
  splittableEdgeStates: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  builtEdgeState: GameManifestObjectFacetValue;
  sequenceEndpoint: GameManifestSafeIdentifier;
  /**
   * @minItems 1
   * @maxItems 512
   */
  regions: [GameManifestTransportRegion, ...GameManifestTransportRegion[]];
  roadPlanning?: GameManifestTransportRoadPlanning;
  movement?: GameManifestTransportMovementModel;
}
/**
 * Bounded simple polygon. A final point equal to the first is an optional explicit closure and is not counted as an additional canonical vertex.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportRegion".
 */
export interface GameManifestTransportRegion {
  id: string;
  /**
   * @minItems 3
   * @maxItems 513
   */
  polygon: [
    GameManifestCanonicalPoint,
    GameManifestCanonicalPoint,
    GameManifestCanonicalPoint,
    ...GameManifestCanonicalPoint[]
  ];
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestCanonicalPoint".
 */
export interface GameManifestCanonicalPoint {
  x: number;
  y: number;
}
/**
 * Explicit opt-in contract for authoritative minimum-region road planning. The navigation graph and hash are compiler-derived from canonical region polygons.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportRoadPlanning".
 */
export interface GameManifestTransportRoadPlanning {
  mode: "region-segment-minimum";
  algorithmVersion: "region-segment-minimum-v1";
  geometryVersion: string;
  geometryHash: string;
  tieBreak: "session-random";
  boundaryPolicy: "lowest-region-id";
  excludedRegionIdsEndpoint?: GameManifestSafeIdentifier;
  navigationGraph: {
    /**
     * @maxItems 4096
     */
    portals: GameManifestTransportRoadPortal[];
  };
}
/**
 * One compiler-derived positive-length shared boundary between two transport regions.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportRoadPortal".
 */
export interface GameManifestTransportRoadPortal {
  id: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  regionIds: [string, string];
  from: GameManifestCanonicalPoint;
  to: GameManifestCanonicalPoint;
}
/**
 * Declarative rules for moving authoritative vehicles through one network edge.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTransportMovementModel".
 */
export interface GameManifestTransportMovementModel {
  vehicleCollection: string;
  /**
   * @minItems 1
   */
  vehicleObjectTypes: [string, ...string[]];
  vehicleStateFacet?: string;
  /**
   * @minItems 1
   */
  movableVehicleStates?: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  locationAttribute: string;
  /**
   * @minItems 1
   */
  traversableNodeStates: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  /**
   * @minItems 1
   */
  traversableEdgeStates: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  capacityCollection: string;
  /**
   * @minItems 1
   */
  capacityObjectTypes: [string, ...string[]];
  capacityLocationAttribute: string;
  capacityStateFacet?: string;
  /**
   * @minItems 1
   */
  capacityOccupyingStates?: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  maxVehiclesPerNode: number;
  coupledCollection: string;
  /**
   * @minItems 1
   */
  coupledObjectTypes: [string, ...string[]];
  coupledStateFacet?: string;
  /**
   * @minItems 1
   */
  couplableVehicleStates?: [GameManifestObjectFacetValue, ...GameManifestObjectFacetValue[]];
  coupledVehicleAttribute: string;
  coupledLocationAttribute: string;
  /**
   * @minItems 1
   */
  compatibleCouplings?: [
    {
      vehicleObjectType: string;
      /**
       * @minItems 1
       */
      coupledObjectTypes: [string, ...string[]];
    },
    ...{
      vehicleObjectType: string;
      /**
       * @minItems 1
       */
      coupledObjectTypes: [string, ...string[]];
    }[]
  ];
  maxCoupledVehicles?: number;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestState<alias-942026824-74138-74264-942026824-0-218439<string,unknown>,alias-942026824-74138-74264-942026824-0-218439<string,unknown>>".
 */
export interface GameManifestState3Calias942026824741387426494202682402184393Cstring2Cunknown3E2Calias942026824741387426494202682402184393Cstring2Cunknown3E3E {
  public: {
    [k: string]: unknown;
  };
  secret?: {
    [k: string]: unknown;
  };
  playersTemplate?: GameManifestPlayersTemplate;
}
/**
 * Template expanded by runtime into state.players for every local participant.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestPlayersTemplate".
 */
export interface GameManifestPlayersTemplate {
  flags?: {
    [k: string]: boolean;
  };
  metrics: {
    [k: string]: number;
  };
  objects?: {
    [k: string]: unknown;
  };
  status?: "active" | "eliminated";
  visibility?: {
    flags?: "public" | "private";
    metrics?: "public" | "private";
  };
}
