/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-debug-bridge-request
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export type EditorDebugBridgeRequest =
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "status";
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "list";
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "pause";
      payload: {
        expectedStateVersion: number;
      };
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "resume";
      payload: {
        expectedStateVersion: number;
      };
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "save";
      payload: {
        label: string;
      };
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "delete";
      checkpointId: string;
    }
  | {
      source: "cubica-editor-web";
      type: "debugSession";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      operation: "restore";
      checkpointId: string;
    };
