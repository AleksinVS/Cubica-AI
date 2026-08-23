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
    "description": "Creation-only durable capability bound by runtime to exactly one invite participant. Seat and player metadata are intentionally omitted because unauthenticated client metadata is not identity proof.",
    "type": "object",
    "required": [
      "credential"
    ],
    "properties": {
      "credential": {
        "type": "string",
        "pattern": "^ses_[A-Za-z0-9_-]{43}$"
      }
    },
    "additionalProperties": false
  }
} as const;
