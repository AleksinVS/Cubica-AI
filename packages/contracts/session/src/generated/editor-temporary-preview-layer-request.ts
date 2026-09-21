/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-temporary-preview-layer-request
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export interface EditorTemporaryPreviewLayerRequest {
  source: "cubica-editor-web";
  type: "temporaryPreviewLayer";
  protocolVersion: 1;
  requestId: string;
  sessionId: string;
  compileRevision: string;
  scene: {
    screenId?: string;
    stepIndex?: number;
    activeInfoId?: string;
  };
  sequence: number;
  /**
   * @maxItems 100
   */
  patches: {
    operationId: string;
    runtimePointer: string;
    ownerRuntimePointer: string;
    property: "html" | "caption" | "text" | "title" | "summary" | "width" | "height" | "transform";
    value: string | number;
  }[];
}
