/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-preview-content-refresh-response
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export interface EditorPreviewContentRefreshResponse {
  source: "cubica-player-web";
  type: "previewContentRefreshResult";
  protocolVersion: 1;
  requestId: string;
  sessionId: string;
  revision: string;
  ok: boolean;
  requiresRestart?: boolean;
  error?: string;
}
