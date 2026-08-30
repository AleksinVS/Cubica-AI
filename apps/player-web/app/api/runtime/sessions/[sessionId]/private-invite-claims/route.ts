import type { NextRequest } from "next/server";
import {
  browserPrivateInviteClaimResponse,
  readBoundedBrowserRuntimeBody,
  requestRuntime,
  runtimeCredentialCookieIsSecure,
  runtimeCredentialCookieName
} from "../../../_shared";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const currentCredential = request.cookies.get(runtimeCredentialCookieName(sessionId))?.value;
  const headers = new Headers({ "Content-Type": "application/json" });
  if (currentCredential !== undefined) {
    headers.set("Authorization", `Bearer ${currentCredential}`);
  }
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}/private-invite-claims`, {
    method: "POST",
    headers,
    body: bounded.body
  });
  return browserPrivateInviteClaimResponse(upstream, sessionId, { secureCookie: runtimeCredentialCookieIsSecure(request) });
}
