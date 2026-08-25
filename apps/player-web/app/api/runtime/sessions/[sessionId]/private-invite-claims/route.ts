import { NextResponse, type NextRequest } from "next/server";
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
  if (request.cookies.get(runtimeCredentialCookieName(sessionId)) !== undefined) {
    return NextResponse.json(
      { error: "Runtime session credential already exists for this session." },
      { status: 409 }
    );
  }
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}/private-invite-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bounded.body
  });
  return browserPrivateInviteClaimResponse(upstream, sessionId, { secureCookie: runtimeCredentialCookieIsSecure(request) });
}
