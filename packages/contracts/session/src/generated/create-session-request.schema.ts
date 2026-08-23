/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const createSessionRequestSchema = {
  "type": "object",
  "required": [
    "gameId"
  ],
  "properties": {
    "gameId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
    },
    "contentSourceId": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$"
    },
    "participantCount": {
      "type": "integer",
      "minimum": 1,
      "description": "Optional participant count. Runtime checks this against the published manifest bounds for both local and private-invite sessions."
    },
    "accessMode": {
      "type": "string",
      "enum": [
        "local",
        "private-invite"
      ],
      "default": "local",
      "description": "Session access model. Omitted remains the backward-compatible local controller mode."
    },
    "agentSeatCount": {
      "type": "integer",
      "minimum": 0,
      "maximum": 64,
      "description": "Requested local agent seats. Runtime assigns the last N server-derived seats; omitted is equivalent to zero."
    }
  },
  "allOf": [
    {
      "not": {
        "required": [
          "accessMode",
          "agentSeatCount"
        ],
        "properties": {
          "accessMode": {
            "type": "string",
            "const": "private-invite"
          },
          "agentSeatCount": {
            "type": "integer",
            "minimum": 1
          }
        }
      }
    },
    {
      "not": {
        "required": [
          "accessMode",
          "contentSourceId"
        ],
        "properties": {
          "accessMode": {
            "type": "string",
            "const": "private-invite"
          },
          "contentSourceId": {}
        }
      }
    }
  ],
  "additionalProperties": false
} as const;
