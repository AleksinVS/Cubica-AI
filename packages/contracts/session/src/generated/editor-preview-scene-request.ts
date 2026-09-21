/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-preview-scene-request
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export interface EditorPreviewSceneRequest {
  source: "cubica-editor-web";
  type: "showPreviewScene";
  protocolVersion: 1;
  requestId: string;
  sessionId: string;
  selector: null | {
    screenKey?: string;
    screenId?: string;
    stepIndex?: number;
    activeInfoId?: string;
    focusRuntimePointer?: string;
  };
}
