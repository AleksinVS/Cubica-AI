import {
  browserSessionResponse,
  readBoundedBrowserRuntimeBody,
  requestRuntime,
  runtimeCredentialCookieIsSecure
} from "../_shared";
import { NextResponse } from "next/server";
import { validateCreateSessionRequestShape } from "@cubica/contracts-session";

export async function POST(request: Request) {
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const body = bounded.body;
  let parsed: unknown;
  try { parsed = JSON.parse(body) as unknown; } catch {
    return NextResponse.json({ error: "Session creation request is invalid." }, { status: 400 });
  }
  if (!validateCreateSessionRequestShape(parsed)) {
    return NextResponse.json({ error: "Session creation request is invalid." }, { status: 400 });
  }

  const upstream = await requestRuntime("/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  });
  return browserSessionResponse(upstream, { secureCookie: runtimeCredentialCookieIsSecure(request) });
}
