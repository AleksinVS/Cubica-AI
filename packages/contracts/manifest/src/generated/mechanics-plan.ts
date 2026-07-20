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
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "sha256".
 */
export type Sha256 = string;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "valueType".
 */
export type ValueType =
  | {
      kind: "boolean";
    }
  | {
      kind: "string";
      maxUtf8Bytes?: number;
    }
  | {
      kind: "integer";
      minimum: number;
      maximum: number;
    }
  | {
      kind: "finite-number";
      minimum: number;
      maximum: number;
    }
  | {
      kind: "decimal";
      scale: number;
      minimum: string;
      maximum: string;
    }
  | {
      kind: "enum";
      /**
       * @minItems 1
       * @maxItems 512
       */
      values: [string | number | boolean, ...(string | number | boolean)[]];
    }
  | {
      kind: "json";
      maxDepth: number;
      maxNodes: number;
      maxUtf8Bytes: number;
    }
  | {
      kind: "record";
      fields: {
        [k: string]: {
          typeRef: Identifier;
          optional: boolean;
        };
      };
    }
  | {
      kind: "list" | "set";
      itemType: Identifier;
      maxItems: number;
    }
  | {
      kind: "option";
      itemType: Identifier;
    }
  | {
      kind: "map";
      valueType: Identifier;
      maxProperties: number;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "storageSegment".
 */
export type StorageSegment =
  | string
  | {
      context: "actor";
    }
  | {
      binding: Identifier;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "collectionModel".
 */
export type CollectionModel = EntityCollectionModel | RecordCollectionModel;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "collectionField".
 */
export type CollectionField = StoredEntityCollectionField | DerivedCollectionField;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "recordCollectionField".
 */
export type RecordCollectionField = StoredRecordCollectionField | DerivedCollectionField;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "valueExpression".
 */
export type ValueExpression =
  | LiteralExpression
  | ParamExpression
  | ActorExpression
  | StateReadExpression
  | EntityReadExpression
  | ResultExpression
  | ItemReadExpression
  | ArithmeticExpression
  | CoalesceExpression;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "jsonValue".
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stepId".
 */
export type StepId = string;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "itemReadExpression".
 */
export type ItemReadExpression = ItemFieldReadExpression | ItemIdentityReadExpression;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "step".
 */
export type Step = EntitiesEachStep | NonIterationStep;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "nonIterationStep".
 */
export type NonIterationStep =
  | AssertStep
  | SelectEntitiesStep
  | OrderEntitiesStep
  | NextCollectionIdStep
  | SequenceNextStep
  | StatePatchStep
  | NumberAddStep
  | ResourceTransferStep
  | CollectionAppendStep
  | EntityCreateStep
  | EntityFacetSetStep
  | EntityAttributesPatchStep
  | EntitiesUpdateStep
  | EventEmitStep
  | RandomRollStep
  | DeckShuffleStep
  | DeckDrawStep
  | DeckExtractStep
  | DeckReturnStep
  | DeckInsertStep
  | TurnPhaseStep
  | GraphRegionRouteStep
  | GraphEdgePositionInspectStep
  | GraphSplitEdgeStep
  | GraphEntityMoveStep
  | GraphShortestPathStep
  | RelationAttachStep
  | RelationDetachStep
  | SystemScheduleRegisterStep
  | SystemScheduleCancelStep
  | EntityScoreStep
  | StableRankingStep;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "predicate".
 */
export type Predicate =
  | ConstantPredicate
  | CompositePredicate
  | NotPredicate
  | ComparePredicate
  | ExistsPredicate
  | ActorActivePredicate
  | TurnPhasePredicate
  | EntityMatchesPredicate
  | CollectionCountPredicate
  | SetDisjointPredicate;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderSource".
 */
export type EntityOrderSource =
  | {
      kind: "current-field";
      field: Identifier;
    }
  | {
      kind: "related-field";
      referenceField: Identifier;
      collection: Identifier;
      field: Identifier;
    }
  | EntityOrderAggregateSource;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderAggregateSource".
 */
export type EntityOrderAggregateSource =
  | {
      kind: "related-aggregate";
      collection: Identifier;
      join: EntityOrderJoin;
      aggregate: "count";
    }
  | {
      kind: "related-aggregate";
      collection: Identifier;
      join: EntityOrderJoin;
      aggregate: "sum" | "min" | "max";
      valueField: Identifier;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderJoinCurrent".
 */
export type EntityOrderJoinCurrent =
  | {
      kind: "stable-id";
    }
  | {
      kind: "field";
      field: Identifier;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderTieBreak".
 */
export type EntityOrderTieBreak =
  | {
      kind: "canonical-id";
    }
  | {
      kind: "seeded-random";
      stream: Identifier;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "statePatch".
 */
export type StatePatch =
  | {
      operation: "remove";
      target: StateRef;
    }
  | {
      operation: "set" | "increment" | "append";
      target: StateRef;
      value: ValueExpression;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "resourceEndpoint".
 */
export type ResourceEndpoint =
  | {
      kind: "bank";
    }
  | {
      kind: "state";
      target: StateRef;
    }
  | {
      kind: "entity-field";
      entity: EntityRef;
      field: Identifier;
    };
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "attributePatch".
 */
export type AttributePatch =
  | {
      operation: "remove";
      /**
       * @minItems 1
       * @maxItems 16
       */
      path:
        | [Identifier]
        | [Identifier, Identifier]
        | [Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ];
    }
  | {
      operation: "set-add";
      /**
       * @minItems 1
       * @maxItems 1
       */
      path: [Identifier];
      value: ValueExpression;
    }
  | {
      operation: "set" | "increment" | "append";
      /**
       * @minItems 1
       * @maxItems 16
       */
      path:
        | [Identifier]
        | [Identifier, Identifier]
        | [Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ]
        | [
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier,
            Identifier
          ];
      value: ValueExpression;
    };
/**
 * A package-declared deck selected either by its legacy literal id or by one bounded action parameter.
 *
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckReference".
 */
export type DeckReference = Identifier | ParamExpression;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "randomStreamId".
 */
export type RandomStreamId = string;
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "jsonPropertyName".
 */
export type JsonPropertyName = string;
/**
 * @maxItems 512
 *
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphRegionIdSet".
 */
export type GraphRegionIdSet = Identifier[];

/**
 * Canonical, bounded and transactional gameplay program embedded in an immutable game bundle.
 */
export interface CubicaMechanicsIRV1Alpha1 {
  apiVersion: "cubica.dev/mechanics/v1alpha1";
  budgetProfile: "turn-based-standard-v1" | "turn-based-large-v1";
  moduleLock: ModuleLock;
  stateModel: StateModel;
  plans: {
    [k: string]: Plan;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "moduleLock".
 */
export interface ModuleLock {
  [k: string]: {
    moduleId: Identifier;
    moduleVersion: string;
    artifactHash: Sha256;
    algorithmVersions?: {
      [k: string]: string;
    };
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stateModel".
 */
export interface StateModel {
  types: {
    [k: string]: ValueType;
  };
  endpoints: {
    [k: string]: StateEndpoint;
  };
  collections: {
    [k: string]: CollectionModel;
  };
  events: {
    [k: string]: EventModel;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stateEndpoint".
 */
export interface StateEndpoint {
  audienceRef: "public" | "actor" | "server";
  storage: StorageLocation;
  valueType: Identifier;
  access: "read-only" | "read-write";
  /**
   * projection-only exposes a labelled player view but cannot be referenced by Mechanics expressions.
   */
  usage?: "mechanics" | "projection-only";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "storageLocation".
 */
export interface StorageLocation {
  root: "public" | "secret" | "players";
  /**
   * @minItems 0
   * @maxItems 32
   */
  segments: StorageSegment[];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityCollectionModel".
 */
export interface EntityCollectionModel {
  itemShape?: "entity";
  audienceRef: "public" | "actor" | "server";
  storage: StorageLocation;
  capacity: number;
  stableKey: "map-key" | "id-field";
  /**
   * @minItems 1
   * @maxItems 256
   */
  itemTypes: [Identifier, ...Identifier[]];
  fields: {
    [k: string]: CollectionField;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "storedEntityCollectionField".
 */
export interface StoredEntityCollectionField {
  storage: {
    kind: "facet" | "attribute";
    name: Identifier;
  };
  valueType: Identifier;
  access: "read-only" | "read-write";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "derivedCollectionField".
 */
export interface DerivedCollectionField {
  source: {
    kind: "nested-field";
    field: Identifier;
    /**
     * @minItems 1
     * @maxItems 16
     */
    path:
      | [Identifier]
      | [Identifier, Identifier]
      | [Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ];
  };
  valueType: Identifier;
  access: "read-only";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "recordCollectionModel".
 */
export interface RecordCollectionModel {
  itemShape: "record";
  audienceRef: "public" | "actor" | "server";
  storage: StorageLocation;
  capacity: number;
  stableKey: "map-key" | "id-field";
  fields: {
    [k: string]: RecordCollectionField;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "storedRecordCollectionField".
 */
export interface StoredRecordCollectionField {
  storage: {
    kind: "path";
    /**
     * @minItems 1
     * @maxItems 16
     */
    path:
      | [Identifier]
      | [Identifier, Identifier]
      | [Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ]
      | [
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier,
          Identifier
        ];
  };
  valueType: Identifier;
  access: "read-only" | "read-write";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "eventModel".
 */
export interface EventModel {
  audienceRef: "public" | "actor" | "server";
  payloadType: Identifier;
  journalEndpoint?: StateRef;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stateRef".
 */
export interface StateRef {
  endpoint: Identifier;
  /**
   * Typed values for dynamic storage segments declared by the referenced endpoint.
   */
  bindings?: {
    [k: string]: ValueExpression;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "literalExpression".
 */
export interface LiteralExpression {
  op: "value.literal";
  value: JsonValue;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "paramExpression".
 */
export interface ParamExpression {
  op: "value.param";
  name: Identifier;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "actorExpression".
 */
export interface ActorExpression {
  op: "value.actor";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stateReadExpression".
 */
export interface StateReadExpression {
  op: "value.state";
  ref: StateRef;
  readFrom?: "current" | "preAction";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityReadExpression".
 */
export interface EntityReadExpression {
  op: "value.entity";
  entity: EntityRef;
  field: Identifier;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityRef".
 */
export interface EntityRef {
  collection: Identifier;
  entityId: ValueExpression;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "resultExpression".
 */
export interface ResultExpression {
  op: "value.result";
  stepId: StepId;
  /**
   * @maxItems 16
   */
  path?:
    | []
    | [Identifier]
    | [Identifier, Identifier]
    | [Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "itemFieldReadExpression".
 */
export interface ItemFieldReadExpression {
  op: "value.item";
  area: "facet" | "attribute";
  field: Identifier;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "itemIdentityReadExpression".
 */
export interface ItemIdentityReadExpression {
  op: "value.item";
  area: "identity";
  field: "id";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "arithmeticExpression".
 */
export interface ArithmeticExpression {
  op:
    | "number.add"
    | "number.subtract"
    | "number.multiply"
    | "number.divide"
    | "number.modulo"
    | "number.min"
    | "number.max";
  /**
   * @minItems 2
   * @maxItems 32
   */
  items: [ValueExpression, ValueExpression, ...ValueExpression[]];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "coalesceExpression".
 */
export interface CoalesceExpression {
  op: "value.coalesce";
  /**
   * @minItems 1
   * @maxItems 16
   */
  items:
    | [ValueExpression]
    | [ValueExpression, ValueExpression]
    | [ValueExpression, ValueExpression, ValueExpression]
    | [ValueExpression, ValueExpression, ValueExpression, ValueExpression]
    | [ValueExpression, ValueExpression, ValueExpression, ValueExpression, ValueExpression]
    | [ValueExpression, ValueExpression, ValueExpression, ValueExpression, ValueExpression, ValueExpression]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ]
    | [
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression,
        ValueExpression
      ];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "plan".
 */
export interface Plan {
  planHash: Sha256;
  transaction: {
    /**
     * @minItems 1
     * @maxItems 512
     */
    steps: [Step, ...Step[]];
  };
}
/**
 * Execute one bounded body for every member of a prior typed selection in canonical identifier order.
 *
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entitiesEachStep".
 */
export interface EntitiesEachStep {
  id: StepId;
  kind: "command";
  op: "core.entities.each";
  selection: EntitySelectionResultRef;
  /**
   * Existing Mechanics operations executed in an iteration-local result scope. Nested core.entities.each is rejected by the semantic checker.
   *
   * @minItems 1
   * @maxItems 16
   */
  body:
    | [NonIterationStep]
    | [NonIterationStep, NonIterationStep]
    | [NonIterationStep, NonIterationStep, NonIterationStep]
    | [NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep]
    | [NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep]
    | [NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep, NonIterationStep]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ]
    | [
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep,
        NonIterationStep
      ];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entitySelectionResultRef".
 */
export interface EntitySelectionResultRef {
  op: "value.result";
  stepId: StepId;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "assertStep".
 */
export interface AssertStep {
  id: StepId;
  kind: "assert";
  op: "core.assert";
  predicate: Predicate;
  errorCode: string;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "constantPredicate".
 */
export interface ConstantPredicate {
  op: "predicate.constant";
  value: boolean;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "compositePredicate".
 */
export interface CompositePredicate {
  op: "predicate.all" | "predicate.any";
  /**
   * @minItems 1
   * @maxItems 64
   */
  items: [Predicate, ...Predicate[]];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "notPredicate".
 */
export interface NotPredicate {
  op: "predicate.not";
  item: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "comparePredicate".
 */
export interface ComparePredicate {
  op: "predicate.compare";
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  left: ValueExpression;
  right: ValueExpression;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "existsPredicate".
 */
export interface ExistsPredicate {
  op: "predicate.exists";
  value: ValueExpression;
  exists: boolean;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "actorActivePredicate".
 */
export interface ActorActivePredicate {
  op: "predicate.actor.active";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "turnPhasePredicate".
 */
export interface TurnPhasePredicate {
  op: "predicate.turn.phase";
  phase: ValueExpression;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityMatchesPredicate".
 */
export interface EntityMatchesPredicate {
  op: "predicate.entity.matches";
  entity: EntityRef;
  objectType?: Identifier;
  facets?: {
    [k: string]: ValueExpression;
  };
  attributes?: {
    [k: string]: ValueExpression;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "collectionCountPredicate".
 */
export interface CollectionCountPredicate {
  op: "predicate.collection.count";
  collection: Identifier;
  /**
   * @minItems 1
   * @maxItems 512
   */
  ids: [ValueExpression, ...ValueExpression[]];
  /**
   * @minItems 1
   * @maxItems 16
   */
  field:
    | [Identifier]
    | [Identifier, Identifier]
    | [Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier, Identifier]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ]
    | [
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier,
        Identifier
      ];
  equals: ValueExpression;
  countAtLeast: ValueExpression;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "setDisjointPredicate".
 */
export interface SetDisjointPredicate {
  op: "predicate.set.disjoint";
  left: ValueExpression;
  right: ValueExpression;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "selectEntitiesStep".
 */
export interface SelectEntitiesStep {
  id: StepId;
  kind: "query";
  op: "core.entities.select";
  selector: EntitySelector;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entitySelector".
 */
export interface EntitySelector {
  collection: Identifier;
  within?: EntitySelectionResultRef;
  /**
   * @minItems 1
   * @maxItems 64
   */
  objectTypes?: [Identifier, ...Identifier[]];
  facets?: {
    [k: string]: ValueExpression;
  };
  attributes?: {
    [k: string]:
      | ValueExpression
      | {
          operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "notContains" | "isEmpty" | "notEmpty";
          value: ValueExpression;
        };
  };
  cardinality: {
    min: number;
    max: number;
  };
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "orderEntitiesStep".
 */
export interface OrderEntitiesStep {
  id: StepId;
  kind: "command";
  op: "core.entities.order";
  selection: EntitySelectionResultRef;
  /**
   * @minItems 1
   * @maxItems 32
   */
  keys: [EntityOrderKey, ...EntityOrderKey[]];
  tieBreak: EntityOrderTieBreak;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderKey".
 */
export interface EntityOrderKey {
  source: EntityOrderSource;
  direction: "ascending" | "descending";
  missing: "error" | "first" | "last";
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityOrderJoin".
 */
export interface EntityOrderJoin {
  current: EntityOrderJoinCurrent;
  relatedField: Identifier;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "nextCollectionIdStep".
 */
export interface NextCollectionIdStep {
  id: StepId;
  kind: "command";
  op: "core.collection.id.allocate";
  collection: Identifier;
  sequence: StateRef;
  prefix: Identifier;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "sequenceNextStep".
 */
export interface SequenceNextStep {
  id: StepId;
  kind: "query";
  op: "core.sequence.next";
  items: ValueExpression;
  current: ValueExpression;
  exclude?: {
    collection: Identifier;
    field: Identifier;
    /**
     * @minItems 1
     * @maxItems 64
     */
    values: [ValueExpression, ...ValueExpression[]];
  };
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "statePatchStep".
 */
export interface StatePatchStep {
  id: StepId;
  kind: "command";
  op: "core.state.patch";
  /**
   * @minItems 1
   * @maxItems 128
   */
  patches: [StatePatch, ...StatePatch[]];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "numberAddStep".
 */
export interface NumberAddStep {
  id: StepId;
  kind: "command";
  op: "core.number.add";
  target: StateRef;
  delta: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "resourceTransferStep".
 */
export interface ResourceTransferStep {
  id: StepId;
  kind: "command";
  op: "core.resource.transfer";
  from: ResourceEndpoint;
  to: ResourceEndpoint;
  amount: ValueExpression;
  onInsufficient: "fail";
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "collectionAppendStep".
 */
export interface CollectionAppendStep {
  id: StepId;
  kind: "command";
  op: "core.collection.append";
  target: StateRef;
  value: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityCreateStep".
 */
export interface EntityCreateStep {
  id: StepId;
  kind: "command";
  op: "core.entity.create";
  visibility: "public" | "secret";
  collection: Identifier;
  entityId: ValueExpression;
  objectType: Identifier;
  facets?: {
    [k: string]: ValueExpression;
  };
  attributes?: {
    [k: string]: ValueExpression;
  };
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityFacetSetStep".
 */
export interface EntityFacetSetStep {
  id: StepId;
  kind: "command";
  op: "core.entity.facet.set";
  entity: EntityRef;
  facet: Identifier;
  value: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityAttributesPatchStep".
 */
export interface EntityAttributesPatchStep {
  id: StepId;
  kind: "command";
  op: "core.entity.attributes.patch";
  entity: EntityRef;
  /**
   * @minItems 1
   * @maxItems 64
   */
  patches: [AttributePatch, ...AttributePatch[]];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entitiesUpdateStep".
 */
export interface EntitiesUpdateStep {
  id: StepId;
  kind: "command";
  op: "core.entities.update";
  selection: EntitySelectionResultRef;
  facetValues?: {
    [k: string]: ValueExpression;
  };
  attributeValues?: {
    [k: string]: ValueExpression;
  };
  attributeSetRemovals?: {
    [k: string]: ValueExpression;
  };
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "eventEmitStep".
 */
export interface EventEmitStep {
  id: StepId;
  kind: "command";
  op: "core.event.emit";
  eventType: Identifier;
  summary: ValueExpression;
  audience: "public" | "actor" | "server";
  data?: {
    [k: string]: ValueExpression;
  };
  auditMetrics?: boolean;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "randomRollStep".
 */
export interface RandomRollStep {
  id: StepId;
  kind: "command";
  op: "random.dice.roll";
  dice: string;
  /**
   * Stable named random stream; its counter advances independently from every other stream.
   */
  stream: string;
  target: StateRef;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckShuffleStep".
 */
export interface DeckShuffleStep {
  id: StepId;
  kind: "command";
  op: "deck.shuffle";
  deckId: Identifier;
  sourceCollection: Identifier;
  /**
   * Stable named random stream pinned into deck state for later automatic reshuffles.
   */
  stream: string;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckDrawStep".
 */
export interface DeckDrawStep {
  id: StepId;
  kind: "command";
  op: "deck.draw";
  deckId: DeckReference;
  target: StateRef;
  /**
   * A reshuffle reuses the named stream pinned by the deck.shuffle operation that created the deck.
   */
  onEmpty: "reshuffle-discard" | "fail";
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckExtractStep".
 */
export interface DeckExtractStep {
  id: StepId;
  kind: "command";
  op: "deck.extract";
  deckId: DeckReference;
  /**
   * The top is the first order item or the last discard item.
   */
  source: "order" | "discard";
  /**
   * Optional explicit item identifier; when omitted, the source top is extracted.
   */
  card?:
    | LiteralExpression
    | ParamExpression
    | ActorExpression
    | StateReadExpression
    | EntityReadExpression
    | ResultExpression
    | ItemReadExpression
    | ArithmeticExpression
    | CoalesceExpression;
  target?: StateRef;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckReturnStep".
 */
export interface DeckReturnStep {
  id: StepId;
  kind: "command";
  op: "deck.return";
  deckId: DeckReference;
  card: ValueExpression;
  destination: "discard" | "order-top" | "order-bottom";
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "deckInsertStep".
 */
export interface DeckInsertStep {
  id: StepId;
  kind: "command";
  op: "deck.insert";
  deckId: DeckReference;
  sourceCollection: Identifier;
  card: ValueExpression;
  destination: "held" | "discard" | "order-top" | "order-bottom";
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "turnPhaseStep".
 */
export interface TurnPhaseStep {
  id: StepId;
  kind: "command";
  op: "turn.phase.select";
  phase: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphRegionRouteStep".
 */
export interface GraphRegionRouteStep {
  id: StepId;
  kind: "command";
  op: "graph.regions.route.plan";
  networkId: Identifier;
  fromNode: ValueExpression;
  toNode: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphEdgePositionInspectStep".
 */
export interface GraphEdgePositionInspectStep {
  id: StepId;
  kind: "algorithm";
  op: "graph.edge.position.inspect";
  networkId: Identifier;
  edge: ValueExpression;
  position: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphSplitEdgeStep".
 */
export interface GraphSplitEdgeStep {
  id: StepId;
  kind: "command";
  op: "graph.edge.split";
  networkId: Identifier;
  proof: GraphInspectionProofRef;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphInspectionProofRef".
 */
export interface GraphInspectionProofRef {
  op: "value.result";
  stepId: StepId;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphEntityMoveStep".
 */
export interface GraphEntityMoveStep {
  id: StepId;
  kind: "command";
  op: "graph.entity.traverse";
  networkId: Identifier;
  entity: ValueExpression;
  edge: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphShortestPathStep".
 */
export interface GraphShortestPathStep {
  id: StepId;
  kind: "algorithm";
  op: "graph.shortestPath";
  networkId: Identifier;
  fromNode: ValueExpression;
  toNode: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "relationAttachStep".
 */
export interface RelationAttachStep {
  id: StepId;
  kind: "command";
  op: "relation.attach";
  networkId: Identifier;
  primary: ValueExpression;
  /**
   * @minItems 1
   * @maxItems 64
   */
  related: [ValueExpression, ...ValueExpression[]];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "relationDetachStep".
 */
export interface RelationDetachStep {
  id: StepId;
  kind: "command";
  op: "relation.detach";
  networkId: Identifier;
  primary: ValueExpression;
  /**
   * @minItems 1
   * @maxItems 64
   */
  related: [ValueExpression, ...ValueExpression[]];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "systemScheduleRegisterStep".
 */
export interface SystemScheduleRegisterStep {
  id: StepId;
  kind: "command";
  op: "system.schedule.register";
  actionId: Identifier;
  params: {
    [k: string]: ValueExpression;
  };
  trigger: Predicate;
  falsePolicy: "defer" | "skip";
  maxOccurrences: number;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "systemScheduleCancelStep".
 */
export interface SystemScheduleCancelStep {
  id: StepId;
  kind: "command";
  op: "system.schedule.cancel";
  scheduleId: ValueExpression;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "entityScoreStep".
 */
export interface EntityScoreStep {
  id: StepId;
  kind: "query";
  op: "core.entities.score";
  entities: StateRef;
  /**
   * @minItems 1
   * @maxItems 512
   */
  entityIds: [ValueExpression, ...ValueExpression[]];
  baseField: Identifier;
  /**
   * @maxItems 64
   */
  relatedSources: ScoreRelatedSource[];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "scoreRelatedSource".
 */
export interface ScoreRelatedSource {
  collection: Identifier;
  ownerField: Identifier;
  valueField: Identifier;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "stableRankingStep".
 */
export interface StableRankingStep {
  id: StepId;
  kind: "algorithm";
  op: "core.ranking.stable";
  scores: ValueExpression;
  /**
   * @minItems 1
   * @maxItems 64
   */
  groups: [RankingGroup, ...RankingGroup[]];
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "rankingGroup".
 */
export interface RankingGroup {
  id: Identifier;
  /**
   * @minItems 1
   * @maxItems 128
   */
  entityIds: [ValueExpression, ...ValueExpression[]];
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "baseStepProperties".
 */
export interface BaseStepProperties {
  id?: StepId;
  when?: Predicate;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "mechanicsCanonicalPoint".
 */
export interface MechanicsCanonicalPoint {
  x: number;
  y: number;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphEdgePositionEndpointInspection".
 */
export interface GraphEdgePositionEndpointInspection {
  id: Identifier;
  point: MechanicsCanonicalPoint;
  regionIds: GraphRegionIdSet;
}
/**
 * This interface was referenced by `CubicaMechanicsIRV1Alpha1`'s JSON-Schema
 * via the `definition` "graphEdgePositionInspectionResult".
 */
export interface GraphEdgePositionInspectionResult {
  proofVersion: "graph-edge-position-proof/v1";
  networkId: Identifier;
  edge: {
    id: Identifier;
    geometryFingerprint: string;
  };
  normalizedPosition: number;
  point: MechanicsCanonicalPoint;
  pointRegionIds: GraphRegionIdSet;
  endpoints: {
    from: GraphEdgePositionEndpointInspection;
    to: GraphEdgePositionEndpointInspection;
    regionIds: GraphRegionIdSet;
  };
}
