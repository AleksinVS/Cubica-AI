import { NextRequest } from "next/server";
import { runtimeCredentialCookieName, requestRuntime } from "../../../_shared";

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const credential = request.cookies.get(runtimeCredentialCookieName(sessionId))?.value;
  if (!credential) return new Response("Unauthorized", { status: 401 });
  const upstream = await requestRuntime(`/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "GET", headers: { Authorization: `Bearer ${credential}`, Accept: "text/event-stream" }, signal: request.signal
  });
  if (!upstream.ok) {
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get("Retry-After");
      headers.set("Retry-After", retryAfter !== null && /^[1-9][0-9]{0,8}$/u.test(retryAfter)
        ? retryAfter
        : "1");
    }
    return new Response(JSON.stringify({ error: "Session event stream is unavailable." }), {
      status: upstream.status,
      headers
    });
  }
  const headers = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  return new Response(upstream.body, { status: upstream.status, headers });
}
