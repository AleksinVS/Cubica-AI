/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorDebugBridgeResponseSchema = {
  "oneOf": [
    {
      "type": "object",
      "required": [
        "source",
        "type",
        "protocolVersion",
        "requestId",
        "sessionId",
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "status"
        },
        "data": {
          "type": "object",
          "required": [
            "sessionId",
            "paused",
            "version"
          ],
          "properties": {
            "sessionId": {
              "type": "string"
            },
            "paused": {
              "type": "boolean"
            },
            "version": {
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "list"
        },
        "data": {
          "type": "object",
          "required": [
            "checkpoints"
          ],
          "properties": {
            "checkpoints": {
              "type": "array",
              "maxItems": 20,
              "items": {
                "type": "object",
                "required": [
                  "checkpointId",
                  "label",
                  "createdAt",
                  "expiresAt",
                  "sourceStateVersion"
                ],
                "properties": {
                  "checkpointId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "label": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 120
                  },
                  "createdAt": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "expiresAt": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "sourceStateVersion": {
                    "type": "integer",
                    "minimum": 0
                  }
                },
                "additionalProperties": false
              }
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "pause"
        },
        "data": {
          "type": "object",
          "required": [
            "sessionId",
            "paused",
            "version"
          ],
          "properties": {
            "sessionId": {
              "type": "string"
            },
            "paused": {
              "type": "boolean"
            },
            "version": {
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "resume"
        },
        "data": {
          "type": "object",
          "required": [
            "sessionId",
            "paused",
            "version"
          ],
          "properties": {
            "sessionId": {
              "type": "string"
            },
            "paused": {
              "type": "boolean"
            },
            "version": {
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "save"
        },
        "data": {
          "type": "object",
          "required": [
            "checkpointId",
            "label",
            "createdAt",
            "expiresAt",
            "sourceStateVersion"
          ],
          "properties": {
            "checkpointId": {
              "type": "string",
              "format": "uuid"
            },
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            },
            "sourceStateVersion": {
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "delete"
        },
        "data": {
          "type": "null"
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
        "ok",
        "operation",
        "data"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": true
        },
        "operation": {
          "const": "restore"
        },
        "data": {
          "type": "object",
          "required": [
            "sessionId",
            "paused",
            "version"
          ],
          "properties": {
            "sessionId": {
              "type": "string"
            },
            "paused": {
              "type": "boolean"
            },
            "version": {
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
        "ok",
        "error"
      ],
      "properties": {
        "source": {
          "const": "cubica-player-web"
        },
        "type": {
          "const": "debugSessionResult"
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
        "ok": {
          "const": false
        },
        "error": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "additionalProperties": false
    }
  ]
} as const;
