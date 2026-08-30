import type { NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../_shared";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  return forwardAuthenticatedRuntimeRequest(request, sessionId, `/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET"
  });
}

/**
 * Restores an editor-preview session through the same credential boundary as
 * ordinary player actions. The parent editor never receives the bearer: it
 * asks the trusted iframe, and this same-origin BFF reads the HttpOnly cookie.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/preview-restore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bounded.body
    }
  );
}
