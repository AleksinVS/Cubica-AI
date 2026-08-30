/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=session-participant
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

/**
 * Stable immutable server-owned seat binding. Private-invite seats move from invited to joined; seatId, playerId and kind remain immutable, and agents cannot use network join states.
 */
export interface SessionParticipant {
  seatId: string;
  /**
   * Non-empty player identifier that cannot address JavaScript object prototype properties.
   */
  playerId: string;
  kind: "human" | "agent";
  joinState: "local" | "invited" | "joined";
}
