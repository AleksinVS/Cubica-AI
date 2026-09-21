/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorPreviewSceneRequestSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "protocolVersion",
    "requestId",
    "sessionId",
    "selector"
  ],
  "properties": {
    "source": {
      "const": "cubica-editor-web"
    },
    "type": {
      "const": "showPreviewScene"
    },
    "protocolVersion": {
      "const": 1
    },
    "requestId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "sessionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "selector": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "minProperties": 1,
          "properties": {
            "screenKey": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "screenId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "stepIndex": {
              "type": "integer",
              "minimum": 0
            },
            "activeInfoId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "focusRuntimePointer": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            }
          },
          "additionalProperties": false
        }
      ]
    }
  },
  "additionalProperties": false
} as const;
