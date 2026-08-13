import type { NextRequest } from "next/server";
import { forwardAuthenticatedRuntimeDownloadRequest } from "../../../_shared";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

/** Downloads the runtime-built public journal through the session credential. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  return forwardAuthenticatedRuntimeDownloadRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/public-journal`
  );
}
