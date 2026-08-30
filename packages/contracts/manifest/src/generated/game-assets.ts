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
   * Image assets owned by the game (ADR-063).
   *
   * @minItems 1
   */
  assets: [GameAssetEntry, ...GameAssetEntry[]];
  /**
   * Optional game-owned CSS assets (ADR-091). Kept in a dedicated section because their validation (asset-token image references instead of SVG sanitization) and delivery differ from images, while sharing one asset-id namespace resolved by asset:<id>.
   *
   * @minItems 1
   */
  stylesheets?: [StylesheetAssetEntry, ...StylesheetAssetEntry[]];
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
/**
 * This interface was referenced by `GameAssetsSchemaDefs`'s JSON-Schema
 * via the `definition` "StylesheetAssetEntry".
 */
export interface StylesheetAssetEntry {
  id: string;
  file: string;
  kind: "css";
  origin: AuthoredInRepoOrigin | ThirdPartyOrigin;
}
