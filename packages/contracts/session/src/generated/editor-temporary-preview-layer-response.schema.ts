/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorTemporaryPreviewLayerResponseSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "protocolVersion",
    "requestId",
    "sessionId",
    "sequence",
    "ok"
  ],
  "properties": {
    "source": {
      "const": "cubica-player-web"
    },
    "type": {
      "const": "temporaryPreviewLayerResult"
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
    "sequence": {
      "type": "integer",
      "minimum": 0
    },
    "ok": {
      "type": "boolean"
    },
    "error": {
      "type": "string",
      "maxLength": 500
    }
  },
  "additionalProperties": false
} as const;
