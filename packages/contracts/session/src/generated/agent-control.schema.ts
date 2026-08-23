/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const agentControlSchema = {
  "description": "Derived blocking outcome for the current immutable agent participant and authoritative active actor.",
  "type": "object",
  "required": [
    "playerId",
    "status",
    "reasonCode"
  ],
  "properties": {
    "playerId": {
      "description": "Non-empty player identifier that cannot address JavaScript object prototype properties.",
      "type": "string",
      "minLength": 1,
      "not": {
        "enum": [
          "__proto__",
          "constructor",
          "prototype"
        ]
      }
    },
    "status": {
      "enum": [
        "paused",
        "facilitatorTakeover"
      ]
    },
    "reasonCode": {
      "enum": [
        "runtimeUnavailable",
        "invalidAttemptLimit",
        "fallbackUnavailable",
        "stepLimit"
      ]
    }
  },
  "additionalProperties": false
} as const;
