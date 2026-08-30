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
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestSessionRole".
 */
export type GameManifestSessionRole = "player" | "facilitator" | "assistant" | "observer";
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestActionParamPropertySchema".
 */
export type GameManifestActionParamPropertySchema =
  GameManifestStringActionParamSchema | GameManifestNumericActionParamSchema | GameManifestBooleanActionParamSchema;
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameIntentReferenceVisibility".
 */
export type GameIntentReferenceVisibility = "public" | "secret";
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameIntentJsonPropertyName".
 */
export type GameIntentJsonPropertyName = string;
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameIntentSha256".
 */
export type GameIntentSha256 = string;
/**
 * Bounded identifier safe for use as an own object key or JSON Pointer segment.
 *
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameIntentSafeIdentifier".
 */
export type GameIntentSafeIdentifier = string;

export interface GameIntentSchemaDefs {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameIntentCatalog".
 */
export interface GameIntentCatalog {
  [k: string]: GameManifestActionDefinition;
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestActionDefinition".
 */
export interface GameManifestActionDefinition {
  capability?: string;
  capabilityFamily?: string;
  description?: string;
  displayName?: string;
  function?: string;
  /**
   * Trusted admission path: external intents are user/model selectable; system intents are scheduler-only.
   */
  invocation: "external" | "system";
  /**
   * @minItems 1
   */
  allowedSessionRoles?: [GameManifestSessionRole, ...GameManifestSessionRole[]];
  paramsSchema?: GameManifestActionParamsSchema;
  tags?: string[];
  definitionHash: GameIntentSha256;
  binding: {
    kind: "mechanics-plan";
    planRef: GameIntentSafeIdentifier;
  };
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestActionParamsSchema".
 */
export interface GameManifestActionParamsSchema {
  type: "object";
  additionalProperties: false;
  properties: {
    [k: string]: GameManifestActionParamPropertySchema;
  };
  /**
   * @maxItems 16
   */
  required?:
    | []
    | [GameIntentJsonPropertyName]
    | [GameIntentJsonPropertyName, GameIntentJsonPropertyName]
    | [GameIntentJsonPropertyName, GameIntentJsonPropertyName, GameIntentJsonPropertyName]
    | [GameIntentJsonPropertyName, GameIntentJsonPropertyName, GameIntentJsonPropertyName, GameIntentJsonPropertyName]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ]
    | [
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName,
        GameIntentJsonPropertyName
      ];
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestStringActionParamSchema".
 */
export interface GameManifestStringActionParamSchema {
  type: "string";
  minLength?: number;
  maxLength: number;
  /**
   * @minItems 1
   */
  enum?: [string, ...string[]];
  const?: string;
  pattern?: string;
  "x-cubica-ref"?: GameManifestCubicaReference;
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestCubicaReference".
 */
export interface GameManifestCubicaReference {
  kind: "object" | "action-resource";
  collection: string;
  network?: string;
  /**
   * @minItems 1
   */
  allowedTypes?: [string, ...string[]];
  visibility: GameIntentReferenceVisibility;
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestNumericActionParamSchema".
 */
export interface GameManifestNumericActionParamSchema {
  type: "integer" | "number";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  /**
   * @minItems 1
   */
  enum?: [number, ...number[]];
}
/**
 * This interface was referenced by `GameIntentSchemaDefs`'s JSON-Schema
 * via the `definition` "GameManifestBooleanActionParamSchema".
 */
export interface GameManifestBooleanActionParamSchema {
  type: "boolean";
}
