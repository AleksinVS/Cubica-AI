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

export interface GameAssetsSchemaDefs {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `GameAssetsSchemaDefs`'s JSON-Schema
 * via the `definition` "RootGameAssets".
 */
export interface RootGameAssets {
  gameId: string;
  /**
   * @minItems 1
   * @maxItems 64
   */
  assets: [GameAssetEntry, ...GameAssetEntry[]];
}
/**
 * This interface was referenced by `GameAssetsSchemaDefs`'s JSON-Schema
 * via the `definition` "GameAssetEntry".
 */
export interface GameAssetEntry {
  id: string;
  file: string;
  kind: "image";
  origin: AuthoredInRepoOrigin | ThirdPartyOrigin;
}
/**
 * This interface was referenced by `GameAssetsSchemaDefs`'s JSON-Schema
 * via the `definition` "AuthoredInRepoOrigin".
 */
export interface AuthoredInRepoOrigin {
  type: "authored-in-repo";
}
/**
 * This interface was referenced by `GameAssetsSchemaDefs`'s JSON-Schema
 * via the `definition` "ThirdPartyOrigin".
 */
export interface ThirdPartyOrigin {
  type: "third-party";
  license: string;
  source: string;
}
