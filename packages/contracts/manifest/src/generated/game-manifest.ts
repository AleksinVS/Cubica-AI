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

/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifest".
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "RootGameManifest".
 */
export type GameManifest = {
  [k: string]: unknown;
} & {
  actions: GameManifestActionMap;
  config: GameManifestConfig;
  content?: GameManifestContent;
  engine?: GameManifestEngineConfig;
  executionMode?: GameManifestExecutionMode;
  agentRuntime?: GameManifestAgentRuntimeConfig;
  meta: GameManifestMeta;
  objectModels?: GameManifestObjectModelMap;
  state: GameManifestState3Calias942026824741387426494202682402184393Cstring2Cunknown3E2Calias942026824741387426494202682402184393Cstring2Cunknown3E3E;
  /**
   * Reusable deterministic logic templates. Actions reference these via templateId.
   */
  templates?: {
    [k: string]: GameManifestTemplateDefinition;
  };
};
/**
 * A schema-validated runtime effect. Effects are data, not executable plugin code.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicEffect".
 */
export type GameManifestDeterministicEffect =
  | {
      op: "runtime.server.request";
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      [k: string]: unknown;
    }
  | {
      delta: number | string | JsonLogicExpression;
      metricId: string;
      op: "metric.add";
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      op: "state.patch";
      /**
       * @minItems 1
       */
      patches: [GameManifestDeterministicStatePatch, ...GameManifestDeterministicStatePatch[]];
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      op: "flag.set";
      path: string;
      values: {
        [k: string]: boolean;
      };
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      delta: number | string;
      op: "counter.add";
      path: string;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      op: "collection.append";
      path: string;
      value: unknown;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      attributes?: {
        [k: string]: unknown;
      };
      collection: string;
      facets?: {
        [k: string]: GameManifestObjectFacetValue;
      };
      objectId: string | number;
      objectType: string;
      op: "object.create";
      visibility: GameManifestObjectVisibility;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      collection: string;
      facet: string;
      objectId: string | number;
      op: "object.state.set";
      value: GameManifestObjectFacetValue;
      visibility: GameManifestObjectVisibility;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      collection: string;
      objectId: string | number;
      op: "object.attribute.patch";
      /**
       * @minItems 1
       */
      patches: [GameManifestObjectAttributePatch, ...GameManifestObjectAttributePatch[]];
      visibility: GameManifestObjectVisibility;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      op: "ui.panel.open";
      panelId: string;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      layoutId?: string;
      op: "ui.screen.open";
      screenId: string;
      when?: GameManifestDeterministicEffectCondition;
    }
  | {
      backText?: string;
      cardId?: string;
      data?: {
        [k: string]: unknown;
      };
      displayMode?: string;
      entityType?: string;
      kind: string;
      memberId?: string;
      op: "log.append";
      stageId?: string;
      summary: string;
      target?: "public.log";
      when?: GameManifestDeterministicEffectCondition;
      /**
       * If true, runtime-api stores metric snapshots before and after this action in the appended log entry.
       */
      auditMetrics?: boolean;
    };
/**
 * A schema-validated condition for a single manifest effect. Conditions are data, not executable game code.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicEffectCondition".
 */
export type GameManifestDeterministicEffectCondition =
  | {
      metric: GameManifestDeterministicMetricCondition;
      readFrom?: "current" | "preAction";
    }
  | {
      state: GameManifestDeterministicStateCondition;
      readFrom?: "current" | "preAction";
    }
  | {
      collectionCount: {
        countAtLeast: number | string;
        equals?: unknown;
        field: string;
        /**
         * @minItems 1
         */
        ids: [string, ...string[]];
        path: string;
      };
      readFrom?: "current" | "preAction";
    }
  | {
      /**
       * @minItems 1
       */
      all: [GameManifestDeterministicEffectCondition, ...GameManifestDeterministicEffectCondition[]];
    }
  | {
      /**
       * @minItems 1
       */
      any: [GameManifestDeterministicEffectCondition, ...GameManifestDeterministicEffectCondition[]];
    }
  | {
      not: GameManifestDeterministicEffectCondition;
    };
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicMetricOperator".
 */
export type GameManifestDeterministicMetricOperator = ">" | "<" | "==";
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
 * via the `definition` "GameManifestObjectFacetValue".
 */
export type GameManifestObjectFacetValue = string | number | boolean;
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectVisibility".
 */
export type GameManifestObjectVisibility = "public" | "secret";
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestPath".
 */
export type GameManifestPath = string;
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
 * via the `definition` "GameManifestObjectScope".
 */
export type GameManifestObjectScope = "session";

export interface GameManifestSchemaDefs {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestActionMap".
 */
export interface GameManifestActionMap {
  [k: string]: GameManifestActionDefinition;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestActionDefinition".
 */
export interface GameManifestActionDefinition {
  capability?: string;
  capabilityFamily?: string;
  description?: string;
  deterministic?: GameManifestDeterministicActionMetadata;
  displayName?: string;
  function?: string;
  handlerType: string;
  /**
   * Action-specific deterministic overrides merged on top of the resolved template. Used when a template-based action needs extra effects.
   */
  overrides?: {
    deterministic?: GameManifestDeterministicActionMetadata;
  };
  params?: {
    [k: string]: unknown;
  };
  payloadSchema?: {
    [k: string]: unknown;
  };
  raw?: {
    [k: string]: unknown;
  };
  tags?: string[];
  templateId?: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicActionMetadata".
 */
export interface GameManifestDeterministicActionMetadata {
  /**
   * Small manifest-declared operations that runtime-api can validate and apply without executing arbitrary game code.
   */
  effects?: GameManifestDeterministicEffect[];
  guard?: GameManifestDeterministicGuard;
  provenance?: GameManifestDeterministicSourceRef[];
}
/**
 * Bounded metric comparison used by explicit deterministic card-local hooks.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicMetricCondition".
 */
export interface GameManifestDeterministicMetricCondition {
  metricId: string;
  operator: GameManifestDeterministicMetricOperator;
  threshold: number | string;
}
/**
 * Minimal guard shape for deterministic opening-card and team-selection slices.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicStateCondition".
 */
export interface GameManifestDeterministicStateCondition {
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=" | "exists" | "not_exists";
  path: string;
  value?: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicStatePatch".
 */
export interface GameManifestDeterministicStatePatch {
  op: "add" | "replace" | "remove" | "increment" | "append";
  path: string;
  value?: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectAttributePatch".
 */
export interface GameManifestObjectAttributePatch {
  op: "add" | "replace" | "remove" | "increment" | "append";
  path: string;
  value?: unknown;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicGuard".
 */
export interface GameManifestDeterministicGuard {
  collectionCount?:
    | GameManifestDeterministicCollectionCount
    | [GameManifestDeterministicCollectionCount, ...GameManifestDeterministicCollectionCount[]];
  jsonLogic?: JsonLogicExpression;
  opening?: {
    selectedCardIdAbsent?: boolean;
    selectedCardIdEquals?: string | number;
  };
  object?: GameManifestObjectStateGuard | [GameManifestObjectStateGuard, ...GameManifestObjectStateGuard[]];
  stateConditions?: GameManifestDeterministicStateCondition[];
  timeline?: {
    canAdvance?: boolean | string;
    line?: string;
    stepIndex?: number | string;
  };
  [k: string]: unknown;
}
/**
 * Generic collection-count check: counts items in a collection whose field equals a value and requires a threshold. Shared by deterministic effect conditions and guards (ADR-041 §7.2).
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicCollectionCount".
 */
export interface GameManifestDeterministicCollectionCount {
  countAtLeast: number | string;
  equals?: unknown;
  field: string;
  /**
   * @minItems 1
   */
  ids: [string, ...string[]];
  path: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectStateGuard".
 */
export interface GameManifestObjectStateGuard {
  attributes?: {
    [k: string]: unknown;
  };
  collection: string;
  facets?: {
    [k: string]: GameManifestObjectFacetValue;
  };
  objectId: string | number;
  objectType?: string;
  visibility?: GameManifestObjectVisibility;
}
/**
 * Links deterministic metadata back to the exact legacy artifact used for extraction.
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestDeterministicSourceRef".
 */
export interface GameManifestDeterministicSourceRef {
  legacyCardId: string;
  lineIndex?: number | string;
  sourceFile: GameManifestPath;
  sourceKind: string;
  stepIndex?: number | string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestConfig".
 */
export interface GameManifestConfig {
  players: GameManifestPlayerConfig;
  settings: GameManifestSettings;
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
  /**
   * Game-specific content is keyed by gameId.
   */
  [k: string]: {
    [k: string]: unknown;
  };
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
  runtimeId?: string;
  required: boolean;
  allowedCapabilities: string[];
  allowedTools?: string[];
  surfaceCatalog: string[];
  failurePolicy: GameManifestAgentFailurePolicy;
  deterministicFallbackActionId?: string;
  contextExposurePolicy?: {
    publicState: boolean;
    secretState?: "none" | "role-scoped";
    manifestProjection?: string[];
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
  actionIdFrom?: string;
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
 * via the `definition` "GameManifestState<alias-942026824-74138-74264-942026824-0-218439<string,unknown>,alias-942026824-74138-74264-942026824-0-218439<string,unknown>>".
 */
export interface GameManifestState3Calias942026824741387426494202682402184393Cstring2Cunknown3E2Calias942026824741387426494202682402184393Cstring2Cunknown3E3E {
  public: {
    [k: string]: unknown;
  };
  secret?: {
    [k: string]: unknown;
  };
}
/**
 * A reusable template for deterministic action logic. Referenced by actions via templateId. Same structure as GameManifestActionDefinition but handlerType is not required (provided by the action).
 *
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestTemplateDefinition".
 */
export interface GameManifestTemplateDefinition {
  deterministic: GameManifestDeterministicActionMetadata;
  handlerType?: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectState".
 */
export interface GameManifestObjectState {
  attributes?: {
    [k: string]: unknown;
  };
  facets: {
    [k: string]: GameManifestObjectFacetValue;
  };
  objectType: string;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectStateCollection".
 */
export interface GameManifestObjectStateCollection {
  [k: string]: GameManifestObjectState;
}
/**
 * This interface was referenced by `GameManifestSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestObjectStateMap".
 */
export interface GameManifestObjectStateMap {
  [k: string]: GameManifestObjectStateCollection;
}
