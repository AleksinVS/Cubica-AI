/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const playerPreviewEntitiesMessageSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "version",
    "context",
    "entities"
  ],
  "properties": {
    "source": {
      "const": "cubica-player-web"
    },
    "type": {
      "const": "previewEntities"
    },
    "version": {
      "const": 2
    },
    "context": {
      "type": "object",
      "required": [
        "sessionId",
        "sessionVersion",
        "compileRevision",
        "scene"
      ],
      "properties": {
        "sessionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "sessionVersion": {
          "type": "object",
          "required": [
            "sessionId",
            "stateVersion",
            "lastEventSequence"
          ],
          "properties": {
            "sessionId": {
              "type": "string"
            },
            "stateVersion": {
              "type": "integer",
              "minimum": 0
            },
            "lastEventSequence": {
              "type": "integer",
              "minimum": 0
            }
          },
          "additionalProperties": false
        },
        "compileRevision": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "screenKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "prototypePreview": {
          "type": "object",
          "required": [
            "runtimePointer",
            "requestId"
          ],
          "properties": {
            "runtimePointer": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            },
            "requestId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            }
          },
          "additionalProperties": false
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
        }
      },
      "additionalProperties": false
    },
    "entities": {
      "type": "array",
      "maxItems": 10000,
      "items": {
        "type": "object",
        "required": [
          "entityId",
          "runtimePointer",
          "bounds"
        ],
        "properties": {
          "entityId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "runtimePointer": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "contentRuntimePointer": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "label": {
            "type": "string"
          },
          "semanticRole": {
            "type": "string"
          },
          "layer": {
            "type": "string"
          },
          "zIndex": {
            "type": "number"
          },
          "renderOrder": {
            "type": "integer",
            "minimum": 0
          },
          "bounds": {
            "type": "object",
            "required": [
              "x",
              "y",
              "width",
              "height"
            ],
            "properties": {
              "x": {
                "type": "number"
              },
              "y": {
                "type": "number"
              },
              "width": {
                "type": "number"
              },
              "height": {
                "type": "number"
              }
            },
            "additionalProperties": false
          },
          "visible": {
            "type": "boolean"
          },
          "selectable": {
            "type": "boolean"
          },
          "displayText": {
            "type": "string",
            "maxLength": 500
          },
          "textBinding": {
            "type": "object",
            "required": [
              "prop",
              "expression"
            ],
            "properties": {
              "prop": {
                "type": "string",
                "enum": [
                  "html",
                  "caption",
                  "text",
                  "value"
                ]
              },
              "expression": {
                "type": "string",
                "maxLength": 512
              },
              "contentRuntimePointer": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "metricId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "metricRuntimePointer": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "ruleRuntimePointer": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;
