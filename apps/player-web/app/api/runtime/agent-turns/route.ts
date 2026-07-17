import { NextResponse, type NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  inspectBrowserSessionBody,
  readBoundedBrowserRuntimeBody
} from "../_shared";

/**
 * Browser-safe proxy for Agent Turn requests.
 *
 * The browser supplies only an immutable intent envelope. Its runtime bearer
 * remains in the session-specific HttpOnly cookie and is attached here.
 */
export async function POST(request: NextRequest) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const body = bounded.body;
  const inspected = inspectBrowserSessionBody(body);
  if (!inspected.ok) {
    return NextResponse.json({ error: inspected.error }, { status: 400 });
  }

  return forwardAuthenticatedRuntimeRequest(request, inspected.sessionId, "/agent-turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}
