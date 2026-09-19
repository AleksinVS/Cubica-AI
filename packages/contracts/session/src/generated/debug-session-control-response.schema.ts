/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const debugSessionControlResponseSchema = {
  "type": "object",
  "required": [
    "sessionId",
    "paused",
    "version"
  ],
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "paused": {
      "type": "boolean"
    },
    "version": {
      "type": "object",
      "required": [
        "sessionId",
        "stateVersion",
        "lastEventSequence"
      ],
      "properties": {
        "sessionId": {
          "type": "string"
        },
        "stateVersion": {
          "type": "integer",
          "minimum": 0
        },
        "lastEventSequence": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
} as const;
