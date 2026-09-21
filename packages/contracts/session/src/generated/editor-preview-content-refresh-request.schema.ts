/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorPreviewContentRefreshRequestSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "protocolVersion",
    "requestId",
    "sessionId",
    "revision"
  ],
  "properties": {
    "source": {
      "const": "cubica-editor-web"
    },
    "type": {
      "const": "refreshPreviewContent"
    },
    "protocolVersion": {
      "const": 1
    },
    "requestId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "sessionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "revision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "additionalProperties": false
} as const;
