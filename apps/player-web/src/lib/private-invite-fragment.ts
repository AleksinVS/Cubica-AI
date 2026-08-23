import type { PrivateSessionInvite } from "@cubica/contracts-session";
import { validatePrivateSessionInvitesShape } from "@cubica/contracts-session";

export type PrivateInviteFragment = { readonly sessionId: string; readonly invite: PrivateSessionInvite };

export function buildPrivateInviteFragment(value: PrivateInviteFragment): string {
  const params = new URLSearchParams({
    sessionId: value.sessionId,
    seatId: value.invite.seatId,
    playerId: value.invite.playerId,
    credential: value.invite.credential
  });
  return `#invite?${params.toString()}`;
}

export function parsePrivateInviteFragment(hash: string): PrivateInviteFragment | null {
  if (!hash.startsWith("#invite?")) return null;
  const params = new URLSearchParams(hash.slice("#invite?".length));
  const sessionId = params.get("sessionId");
  const invite = {
    seatId: params.get("seatId"),
    playerId: params.get("playerId"),
    credential: params.get("credential")
  };
  if (!sessionId || Object.values(invite).some((item) => item === null)) return null;
  if (sessionId.length > 256 || !validatePrivateSessionInvitesShape([invite as PrivateSessionInvite])) return null;
  return { sessionId, invite: invite as PrivateSessionInvite };
}
