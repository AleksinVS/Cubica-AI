/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const debugSessionControlRequestSchema = {
  "type": "object",
  "required": [
    "expectedStateVersion"
  ],
  "properties": {
    "expectedStateVersion": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false
} as const;
