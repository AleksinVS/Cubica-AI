/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const sessionParticipantsSchema = {
  "type": "array",
  "minItems": 1,
  "items": {
    "description": "Stable immutable server-owned seat binding. Invite-bound human participants use exactly the private-invite join binding; no presence or mutable join lifecycle is represented here.",
    "type": "object",
    "required": [
      "seatId",
      "playerId",
      "kind",
      "joinState"
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
      "kind": {
        "enum": [
          "human",
          "agent"
        ]
      },
      "joinState": {
        "enum": [
          "local",
          "private-invite"
        ]
      }
    },
    "allOf": [
      {
        "not": {
          "required": [
            "kind",
            "joinState"
          ],
          "properties": {
            "kind": {
              "const": "agent"
            },
            "joinState": {
              "const": "private-invite"
            }
          }
        }
      }
    ],
    "additionalProperties": false
  }
} as const;
