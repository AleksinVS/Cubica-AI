import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { PrivateSessionInvite } from "./generated/private-session-invite.ts";
import { privateSessionInvitesSchema } from "./generated/private-session-invites.schema.ts";
import type { SessionVersionNotification } from "./generated/session-version-notification.ts";
import { sessionVersionNotificationSchema } from "./generated/session-version-notification.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const ajv = new Ajv2020({ allErrors: true, strict: true });

const validatePrivateInvites = ajv.compile(privateSessionInvitesSchema as object) as ValidateFunction<
  ReadonlyArray<PrivateSessionInvite>
>;

const validateVersionNotification = ajv.compile(
  sessionVersionNotificationSchema as object
) as ValidateFunction<SessionVersionNotification>;

/** Validate the creation-only private invite collection owned by OpenAPI. */
export function validatePrivateSessionInvitesShape(
  value: unknown
): value is ReadonlyArray<PrivateSessionInvite> {
  return validatePrivateInvites(value);
}

/** Validate the complete payload allowed on the session SSE stream. */
export function validateSessionVersionNotificationShape(
  value: unknown
): value is SessionVersionNotification {
  return validateVersionNotification(value);
}
