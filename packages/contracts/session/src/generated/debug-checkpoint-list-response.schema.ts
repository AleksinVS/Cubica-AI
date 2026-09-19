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
          "sourceStateVersion",
          "compatibility"
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
          "sourceStateVersion": {
            "type": "integer",
            "minimum": 0
          },
          "compatibility": {
            "type": "string",
            "enum": [
              "compatible",
              "incompatible",
              "unavailable"
            ]
          },
          "compatibilityReason": {
            "type": "string",
            "enum": [
              "state-model",
              "participants",
              "schedule",
              "storage-bindings",
              "content-unavailable",
              "rules-unavailable",
              "runtime-policy"
            ]
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;
