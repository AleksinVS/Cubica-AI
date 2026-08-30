/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=agent-control
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

/**
 * Derived blocking outcome for the current immutable agent participant and authoritative active actor.
 */
export interface AgentControl {
  /**
   * Non-empty player identifier that cannot address JavaScript object prototype properties.
   */
  playerId: string;
  status: "paused" | "facilitatorTakeover";
  reasonCode: "runtimeUnavailable" | "invalidAttemptLimit" | "fallbackUnavailable" | "stepLimit";
}
