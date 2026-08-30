import type { NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../../_shared";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/seat-recovery-invites`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bounded.body
    }
  );
}
