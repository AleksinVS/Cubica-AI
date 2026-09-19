/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorDebugBridgeRequestSchema = {
  "oneOf": [
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "status"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "list"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation",
        "payload"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "pause"
        },
        "payload": {
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
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation",
        "payload"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "resume"
        },
        "payload": {
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
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation",
        "payload"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "save"
        },
        "payload": {
          "type": "object",
          "required": [
            "label"
          ],
          "properties": {
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation",
        "checkpointId"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "delete"
        },
        "checkpointId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "operation",
        "checkpointId"
      ],
      "properties": {
        "source": {
          "const": "cubica-editor-web"
        },
        "type": {
          "const": "debugSession"
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
        "operation": {
          "const": "restore"
        },
        "checkpointId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      "additionalProperties": false
    }
  ]
} as const;
