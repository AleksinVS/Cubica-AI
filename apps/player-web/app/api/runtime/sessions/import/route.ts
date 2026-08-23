import { validatePrivateSessionInvitesShape, type PrivateSessionInvite } from "@cubica/contracts-session";
import { NextResponse } from "next/server";
import { requestRuntime, runtimeCredentialCookieIsSecure, setRuntimeCredentialCookie, readBoundedBrowserRuntimeBody } from "../../_shared";

export async function POST(request: Request) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  let body: unknown;
  try { body = JSON.parse(bounded.body); } catch { return NextResponse.json({ error: "Invalid invite link." }, { status: 400 }); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const sessionId = input.sessionId;
  const inviteValue = input.invite;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 256 || !validatePrivateSessionInvitesShape([inviteValue])) {
    return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  }
  const invite = inviteValue as PrivateSessionInvite;
  const credential = invite.credential;
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET", headers: { Authorization: `Bearer ${credential}` }
  });
  if (!upstream.ok) return NextResponse.json({ error: "Invite link is not available." }, { status: upstream.status === 429 || upstream.status >= 500 ? upstream.status : 401 });
  let snapshot: Record<string, unknown>;
  try { snapshot = await upstream.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invite link is not available." }, { status: 502 }); }
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];
  const matched = participants.some((participant) => participant && typeof participant === "object" &&
    (participant as Record<string, unknown>).seatId === invite.seatId &&
    (participant as Record<string, unknown>).playerId === invite.playerId &&
    (participant as Record<string, unknown>).joinState === "private-invite");
  if (!matched) return NextResponse.json({ error: "Invite link is not available." }, { status: 401 });
  const { credential: _credential, privateInvites: _privateInvites, ...safeSnapshot } = snapshot;
  const response = NextResponse.json(safeSnapshot, { headers: { "Cache-Control": "no-store" } });
  setRuntimeCredentialCookie(response, sessionId, credential, { secure: runtimeCredentialCookieIsSecure(request) });
  return response;
}
