/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const debugCheckpointListResponseSchema = {
  "type": "object",
  "required": [
    "checkpoints"
  ],
  "properties": {
    "checkpoints": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "required": [
          "checkpointId",
          "label",
          "createdAt",
          "expiresAt",
          "sourceStateVersion"
        ],
        "properties": {
          "checkpointId": {
            "type": "string",
            "format": "uuid"
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time"
          },
          "sourceStateVersion": {
            "type": "integer",
            "minimum": 0
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;
