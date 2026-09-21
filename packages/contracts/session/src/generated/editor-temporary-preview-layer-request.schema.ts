/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorTemporaryPreviewLayerRequestSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "protocolVersion",
    "requestId",
    "sessionId",
    "compileRevision",
    "scene",
    "sequence",
    "patches"
  ],
  "properties": {
    "source": {
      "const": "cubica-editor-web"
    },
    "type": {
      "const": "temporaryPreviewLayer"
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
    "compileRevision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "scene": {
      "type": "object",
      "properties": {
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
        }
      },
      "additionalProperties": false
    },
    "sequence": {
      "type": "integer",
      "minimum": 0
    },
    "patches": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "type": "object",
        "required": [
          "operationId",
          "runtimePointer",
          "ownerRuntimePointer",
          "property",
          "value"
        ],
        "properties": {
          "operationId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "runtimePointer": {
            "type": "string",
            "pattern": "^/",
            "maxLength": 1000
          },
          "ownerRuntimePointer": {
            "type": "string",
            "pattern": "^/",
            "maxLength": 1000
          },
          "property": {
            "type": "string",
            "enum": [
              "html",
              "caption",
              "text",
              "title",
              "summary",
              "width",
              "height",
              "transform"
            ]
          },
          "value": {
            "oneOf": [
              {
                "type": "string",
                "maxLength": 10000
              },
              {
                "type": "number",
                "minimum": 1,
                "maximum": 16384
              }
            ]
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;
