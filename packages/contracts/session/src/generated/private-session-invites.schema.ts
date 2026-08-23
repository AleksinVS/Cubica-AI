/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const privateSessionInvitesSchema = {
  "type": "array",
  "minItems": 1,
  "items": {
    "description": "Creation-only durable capability for exactly one invite-bound seat.",
    "type": "object",
    "required": [
      "seatId",
      "playerId",
      "credential"
    ],
    "properties": {
      "seatId": {
        "type": "string",
        "minLength": 1
      },
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
      "credential": {
        "type": "string",
        "pattern": "^ses_[A-Za-z0-9_-]{43}$"
      }
    },
    "additionalProperties": false
  }
} as const;
