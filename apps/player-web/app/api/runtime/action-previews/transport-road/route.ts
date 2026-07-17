import { NextResponse, type NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  inspectBrowserSessionBody,
  readBoundedBrowserRuntimeBody
} from "../../_shared";

/** Read-only road preview authenticated for exactly one runtime session. */
export async function POST(request: NextRequest) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const body = bounded.body;
  const inspected = inspectBrowserSessionBody(body);
  if (!inspected.ok) {
    return NextResponse.json({ error: inspected.error }, { status: 400 });
  }

  return forwardAuthenticatedRuntimeRequest(request, inspected.sessionId, "/action-previews/transport-road", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}
