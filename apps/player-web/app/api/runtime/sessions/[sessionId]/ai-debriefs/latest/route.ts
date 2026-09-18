import type { NextRequest } from "next/server";
import { forwardAuthenticatedRuntimeRequest } from "../../../../_shared";

type RouteContext = { params: Promise<{ sessionId: string }> };

/** Reads only the latest completed facilitator debrief through the HttpOnly credential. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/ai-debriefs/latest`,
    { method: "GET" }
  );
}
