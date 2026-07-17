import { browserSessionResponse, readBoundedBrowserRuntimeBody, requestRuntime } from "../_shared";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const body = bounded.body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.hasOwn(parsed, "playerId")) {
      return NextResponse.json({ error: "playerId is not accepted by the runtime BFF." }, { status: 400 });
    }
  } catch {
    // Runtime remains the canonical JSON/schema validator for this request.
  }

  const upstream = await requestRuntime("/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  });
  return browserSessionResponse(upstream);
}
