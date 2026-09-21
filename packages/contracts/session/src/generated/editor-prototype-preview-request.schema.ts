/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorPrototypePreviewRequestSchema = {
  "type": "object",
  "required": [
    "gameId",
    "filePath",
    "sourcePointer",
    "prototypePointer",
    "expectedVersion"
  ],
  "properties": {
    "gameId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "filePath": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "sourcePointer": {
      "type": "string",
      "pattern": "^/root/.+"
    },
    "prototypePointer": {
      "type": "string",
      "pattern": "^/_definitions/[^/]+$"
    },
    "expectedVersion": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "sessionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "additionalProperties": false
} as const;
