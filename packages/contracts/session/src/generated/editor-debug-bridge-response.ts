/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-debug-bridge-response
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

export type EditorDebugBridgeResponse =
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "status";
      data: {
        sessionId: string;
        paused: boolean;
        version: {
          sessionId: string;
          stateVersion: number;
          lastEventSequence: number;
        };
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "list";
      data: {
        /**
         * @maxItems 20
         */
        checkpoints: {
          checkpointId: string;
          label: string;
          createdAt: string;
          sourceStateVersion: number;
          compatibility: "compatible" | "incompatible" | "unavailable";
          compatibilityReason?:
            | "state-model"
            | "participants"
            | "schedule"
            | "storage-bindings"
            | "content-unavailable"
            | "rules-unavailable"
            | "runtime-policy";
        }[];
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "pause";
      data: {
        sessionId: string;
        paused: boolean;
        version: {
          sessionId: string;
          stateVersion: number;
          lastEventSequence: number;
        };
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "resume";
      data: {
        sessionId: string;
        paused: boolean;
        version: {
          sessionId: string;
          stateVersion: number;
          lastEventSequence: number;
        };
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "save";
      data: {
        checkpointId: string;
        label: string;
        createdAt: string;
        sourceStateVersion: number;
        compatibility: "compatible" | "incompatible" | "unavailable";
        compatibilityReason?:
          | "state-model"
          | "participants"
          | "schedule"
          | "storage-bindings"
          | "content-unavailable"
          | "rules-unavailable"
          | "runtime-policy";
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "delete";
      data: null;
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: true;
      operation: "restore";
      data: {
        sessionId: string;
        paused: boolean;
        version: {
          sessionId: string;
          stateVersion: number;
          lastEventSequence: number;
        };
      };
    }
  | {
      source: "cubica-player-web";
      type: "debugSessionResult";
      protocolVersion: 1;
      requestId: string;
      sessionId: string;
      ok: false;
      error: string;
    };
