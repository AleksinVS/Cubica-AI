/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const saveDebugCheckpointRequestSchema = {
  "type": "object",
  "required": [
    "label"
  ],
  "properties": {
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    }
  },
  "additionalProperties": false
} as const;
