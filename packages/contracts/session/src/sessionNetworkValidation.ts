import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import type { ValidateFunction } from "ajv";
import type { PrivateSessionInvite } from "./generated/private-session-invite.ts";
import { privateSessionInvitesSchema } from "./generated/private-session-invites.schema.ts";
import type { PrivateInviteClaimRequest } from "./generated/private-invite-claim-request.ts";
import { privateInviteClaimRequestSchema } from "./generated/private-invite-claim-request.schema.ts";
import type { SessionVersionNotification } from "./generated/session-version-notification.ts";
import { sessionVersionNotificationSchema } from "./generated/session-version-notification.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateInvites = ajv.compile(privateSessionInvitesSchema as object) as ValidateFunction<ReadonlyArray<PrivateSessionInvite>>;
const validateClaim = ajv.compile(privateInviteClaimRequestSchema as object) as ValidateFunction<PrivateInviteClaimRequest>;
const validateNotification = ajv.compile(sessionVersionNotificationSchema as object) as ValidateFunction<SessionVersionNotification>;

export function validatePrivateSessionInvitesShape(value: unknown): value is ReadonlyArray<PrivateSessionInvite> {
  return validateInvites(value);
}

export function validatePrivateInviteClaimRequestShape(value: unknown): value is PrivateInviteClaimRequest {
  return validateClaim(value);
}

export function validateSessionVersionNotificationShape(value: unknown): value is SessionVersionNotification {
  return validateNotification(value);
}
