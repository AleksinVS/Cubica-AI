import type { NextRequest } from "next/server";
import { proxyRuntimeEventStream, requestRuntime, runtimeCredentialCookieName } from "../../../_shared";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const credential = request.cookies.get(runtimeCredentialCookieName(sessionId))?.value;
  if (!credential) return NextResponse.json({ error: "Runtime session credential is missing." }, { status: 401 });
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "GET",
    headers: { Authorization: `Bearer ${credential}`, Accept: "text/event-stream" }
  });
  return proxyRuntimeEventStream(upstream);
}
