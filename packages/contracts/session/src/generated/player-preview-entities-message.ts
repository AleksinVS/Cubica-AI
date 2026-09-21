/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=player-preview-entities-message
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export interface PlayerPreviewEntitiesMessage {
  source: "cubica-player-web";
  type: "previewEntities";
  version: 2;
  context: {
    sessionId: string;
    sessionVersion: {
      sessionId: string;
      stateVersion: number;
      lastEventSequence: number;
    };
    compileRevision: string;
    screenKey?: string;
    prototypePreview?: {
      runtimePointer: string;
      requestId: string;
    };
    scene: {
      screenId?: string;
      stepIndex?: number;
      activeInfoId?: string;
    };
  };
  /**
   * @maxItems 10000
   */
  entities: {
    entityId: string;
    runtimePointer: string;
    contentRuntimePointer?: string;
    label?: string;
    semanticRole?: string;
    layer?: string;
    zIndex?: number;
    renderOrder?: number;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    visible?: boolean;
    selectable?: boolean;
    displayText?: string;
    textBinding?: {
      prop: "html" | "caption" | "text" | "value";
      expression: string;
      contentRuntimePointer?: string;
      metricId?: string;
      metricRuntimePointer?: string;
      ruleRuntimePointer?: string;
    };
  }[];
}
