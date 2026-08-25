/* eslint-disable */
/** GENERATED FILE — DO NOT EDIT BY HAND. */
export const sessionVersionNotificationSchema = {
  "type": "object",
  "required": [
    "stateVersion",
    "lastEventSequence"
  ],
  "properties": {
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
} as const;
