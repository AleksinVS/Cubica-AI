import { NextResponse, type NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  inspectBrowserSessionBody,
  readBoundedBrowserRuntimeBody
} from "../_shared";

/** Proxies one immutable gameplay command using its session credential. */
export async function POST(request: NextRequest) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const body = bounded.body;
  const inspected = inspectBrowserSessionBody(body);
  if (!inspected.ok) {
    return NextResponse.json({ error: inspected.error }, { status: 400 });
  }

  return forwardAuthenticatedRuntimeRequest(request, inspected.sessionId, "/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}
