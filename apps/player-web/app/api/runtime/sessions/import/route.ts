import { validatePrivateSessionInvitesShape, type PrivateSessionInvite } from "@cubica/contracts-session";
import { NextRequest, NextResponse } from "next/server";
import {
  readBoundedBrowserRuntimeBody,
  requestRuntime,
  runtimeCredentialCookieIsSecure,
  runtimeCredentialCookieName,
  setRuntimeCredentialCookie
} from "../../_shared";

export async function POST(request: NextRequest) {
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
  const existingCredential = request.cookies.get(runtimeCredentialCookieName(sessionId))?.value;
  if (existingCredential !== undefined && existingCredential !== credential) {
    return NextResponse.json(
      { error: "This browser already controls the session with a different credential." },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET", headers: { Authorization: `Bearer ${credential}` }
  });
  if (!upstream.ok) return NextResponse.json({ error: "Invite link is not available." }, { status: upstream.status === 429 || upstream.status >= 500 ? upstream.status : 401 });
  let snapshot: Record<string, unknown>;
  try { snapshot = await upstream.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invite link is not available." }, { status: 502 }); }
  const { credential: _credential, privateInvites: _privateInvites, ...safeSnapshot } = snapshot;
  const response = NextResponse.json(safeSnapshot, { headers: { "Cache-Control": "no-store" } });
  setRuntimeCredentialCookie(response, sessionId, credential, { secure: runtimeCredentialCookieIsSecure(request) });
  return response;
}
