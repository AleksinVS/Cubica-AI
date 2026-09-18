import type { NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../../../../_shared";

type RouteContext = { params: Promise<{ sessionId: string; artifactId: string }> };

/** Confirms the exact output hash without exposing the runtime credential to JavaScript. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId, artifactId } = await context.params;
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/ai-debriefs/${encodeURIComponent(artifactId)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bounded.body
    }
  );
}
