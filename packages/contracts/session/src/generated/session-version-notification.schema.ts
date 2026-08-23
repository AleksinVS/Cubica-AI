/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const sessionVersionNotificationSchema = {
  "description": "Minimal SSE notification that tells a client to reload its authenticated personal projection over REST.",
  "type": "object",
  "required": [
    "stateVersion",
    "lastEventSequence"
  ],
  "properties": {
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
} as const;
