/* eslint-disable */
/** GENERATED FILE — DO NOT EDIT BY HAND. */
export const privateInviteClaimRequestSchema = {
  "type": "object",
  "required": [
    "inviteToken"
  ],
  "properties": {
    "inviteToken": {
      "type": "string",
      "pattern": "^inv_[A-Za-z0-9_-]{43}$"
    }
  },
  "additionalProperties": false
} as const;
