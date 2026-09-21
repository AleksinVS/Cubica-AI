/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Derived from the canonical OpenAPI component in
 * docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 */
export const editorPreviewPrototypeRequestSchema = {
  "type": "object",
  "required": [
    "source",
    "type",
    "protocolVersion",
    "requestId",
    "sessionId",
    "runtimePointer",
    "component"
  ],
  "properties": {
    "source": {
      "const": "cubica-editor-web"
    },
    "type": {
      "const": "showPreviewPrototype"
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
    "runtimePointer": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "component": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/definitions/uiComponent"
        }
      ]
    }
  },
  "additionalProperties": false,
  "definitions": {
    "uiComponent": {
      "type": "object",
      "description": "Описание UI-компонента в декларативном формате Hybrid SDUI.",
      "required": [
        "type"
      ],
      "properties": {
        "type": {
          "anyOf": [
            {
              "$ref": "#/definitions/uiComponentType"
            },
            {
              "type": "string",
              "description": "Кастомный тип компонента (widget:*, extension:* или другой).",
              "pattern": "^[a-zA-Z][a-zA-Z0-9_:-]*$"
            }
          ],
          "description": "Тип компонента: стандартный (screenComponent, buttonComponent и др.) или кастомный (widget:inventory, extension:rpg-stats)."
        },
        "id": {
          "type": "string",
          "description": "Optional stable identifier of this component instance."
        },
        "if": {
          "type": "string",
          "description": "Optional conditional rendering expression evaluated by the presenter."
        },
        "props": {
          "type": "object",
          "description": "Component-specific properties, may include data bindings like {{state.public.hp}}.",
          "properties": {
            "workspaceSlot": {
              "$ref": "#/definitions/workspaceSlot"
            }
          }
        },
        "style": {
          "$ref": "#/definitions/uiStyle"
        },
        "actions": {
          "$ref": "#/definitions/uiActions"
        },
        "layout_id": {
          "type": "string",
          "description": "Optional reference to a layout entry that describes visual design for this component. DEPRECATED: Use design_artifact_id."
        },
        "design_artifact_id": {
          "type": "string",
          "description": "ID дизайн-артефакта из секции design_artifacts.registry, описывающего визуальный дизайн этого компонента."
        },
        "controller_id": {
          "type": "string",
          "description": "Optional identifier of a UI-level controller in the UI library."
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/uiComponent"
          }
        },
        "designImageRef": {
          "type": "string"
        },
        "itemTemplate": {
          "$ref": "#/definitions/uiItemTemplate"
        },
        "visualMode": {
          "enum": [
            "image",
            "style",
            "auto"
          ],
          "type": "string"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "if": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "required": [
                  "workspaceSlot"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "type": {
                "const": "areaComponent"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "buttonComponent"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "required": [
                  "caption"
                ],
                "properties": {
                  "caption": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "richTextComponent"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "required": [
                  "html"
                ],
                "properties": {
                  "html": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "imageComponent"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "required": [
                  "src"
                ],
                "properties": {
                  "src": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "gameVariableComponent"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "anyOf": [
                  {
                    "required": [
                      "metricId"
                    ],
                    "properties": {
                      "metricId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "required": [
                      "caption"
                    ],
                    "properties": {
                      "caption": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "required": [
                      "value"
                    ],
                    "properties": {
                      "value": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "cardComponent"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "type": "object",
                "properties": {
                  "backText": {
                    "description": "Public content of the card's back face. When this field is present and visualState resolves to 'resolved', the common card renderer shows this content as the active face."
                  },
                  "visualState": {
                    "description": "Presenter-derived visual state. The value 'resolved' shows backText when backText is present; this presentation state does not itself perform a game action or reveal secret server data."
                  }
                },
                "anyOf": [
                  {
                    "required": [
                      "text"
                    ],
                    "properties": {
                      "text": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "required": [
                      "title"
                    ],
                    "properties": {
                      "title": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "required": [
                      "summary"
                    ],
                    "properties": {
                      "summary": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "required": [
                      "backText"
                    ],
                    "properties": {
                      "backText": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "interactiveBoardSurface"
              }
            },
            "required": [
              "type"
            ]
          },
          "then": {
            "required": [
              "props"
            ],
            "properties": {
              "props": {
                "$ref": "#/definitions/interactiveBoardSurfaceProps"
              }
            }
          }
        }
      ]
    },
    "uiComponentType": {
      "type": "string",
      "description": "Стандартные типы UI-компонентов платформы Cubica. Viewer должен поддерживать все перечисленные типы.",
      "enum": [
        "screenComponent",
        "areaComponent",
        "cardComponent",
        "gameVariableComponent",
        "buttonComponent",
        "textComponent",
        "richTextComponent",
        "inputComponent",
        "imageComponent",
        "helperComponent",
        "interactiveBoardSurface"
      ]
    },
    "workspaceSlot": {
      "type": "string",
      "description": "Semantic placement owned by the generic map-first workspace. Games select a role; the player decides its physical position and stacking.",
      "enum": [
        "board",
        "status",
        "primary-panel",
        "context-panel",
        "action-tray",
        "floating-controls",
        "overlay"
      ]
    },
    "uiStyle": {
      "type": "object",
      "properties": {
        "width": {
          "type": [
            "string",
            "number"
          ]
        },
        "height": {
          "type": [
            "string",
            "number"
          ]
        },
        "padding": {
          "type": [
            "string",
            "number"
          ]
        },
        "margin": {
          "type": [
            "string",
            "number"
          ]
        },
        "background": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "fontSize": {
          "type": [
            "string",
            "number"
          ]
        },
        "fontWeight": {
          "type": [
            "string",
            "number"
          ]
        },
        "border": {
          "type": "string"
        },
        "borderRadius": {
          "type": [
            "string",
            "number"
          ]
        },
        "gap": {
          "type": [
            "string",
            "number"
          ]
        },
        "flex": {
          "type": [
            "integer",
            "string"
          ]
        },
        "flexDirection": {
          "enum": [
            "row",
            "column",
            "row-reverse",
            "column-reverse"
          ]
        },
        "justifyContent": {
          "type": "string"
        },
        "alignItems": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    "uiActions": {
      "type": "object",
      "description": "UI-level event handlers mapping events like 'onClick' to Presenter commands or explicit runtime action requests.",
      "patternProperties": {
        "^on[A-Z][a-zA-Z]+$": {
          "type": "object",
          "required": [
            "command"
          ],
          "properties": {
            "command": {
              "type": "string",
              "description": "Identifier of the command to send to the Presenter, for example showPanel, closePanel, advance or requestServer."
            },
            "payload": {
              "type": "object",
              "description": "Optional JSON payload with parameters for this invocation."
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "uiItemTemplate": {
      "type": "object",
      "description": "Declarative collection iteration for manifest-rendered components.",
      "required": [
        "collection",
        "itemKey"
      ],
      "properties": {
        "collection": {
          "type": "string"
        },
        "filter": {
          "type": "string"
        },
        "itemKey": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "interactiveBoardSurfaceProps": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "sceneId": {
          "type": "string",
          "minLength": 1
        },
        "designWidth": {
          "type": "integer",
          "minimum": 320,
          "maximum": 100000,
          "description": "Ширина логической координатной плоскости сцены, а не физического canvas или окна браузера. Клиент обязан ограничивать размер поверхности вывода независимо от этого значения.",
          "default": 1400
        },
        "designHeight": {
          "type": "integer",
          "minimum": 320,
          "maximum": 100000,
          "description": "Высота логической координатной плоскости сцены, а не физического canvas или окна браузера. Клиент обязан ограничивать размер поверхности вывода независимо от этого значения.",
          "default": 1000
        },
        "accessibleLabel": {
          "type": "string"
        },
        "interactions": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "modeActionId": {
              "type": "string"
            },
            "selectActionId": {
              "type": "string"
            }
          }
        }
      },
      "required": [
        "sceneId"
      ]
    }
  }
} as const;
