import { NextResponse, type NextRequest } from "next/server";
import {
  browserSessionResponse,
  runtimeCredentialCookieIsSecure,
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../../../_shared";

type RouteContext = {
  params: Promise<{ sessionId: string; operation?: string[] }>;
};

/** Only the accepted debugger operations may cross this authenticated BFF boundary. */
async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sessionId, operation = [] } = await context.params;
  const [first, checkpointId, last] = operation;
  const isRestore = request.method === "POST" && operation.length === 3 &&
    first === "checkpoints" && checkpointId.length > 0 && last === "restore";
  const allowed =
    (request.method === "GET" && operation.length === 0) ||
    (request.method === "POST" && operation.length === 1 && ["pause", "resume"].includes(first)) ||
    (["GET", "POST"].includes(request.method) && operation.length === 1 && first === "checkpoints") ||
    (request.method === "DELETE" && operation.length === 2 && first === "checkpoints" && checkpointId.length > 0) ||
    isRestore;
  if (!allowed) return NextResponse.json({ error: "Unknown debug operation." }, { status: 404 });

  const path = `/sessions/${encodeURIComponent(sessionId)}/debug${operation.map(part => `/${encodeURIComponent(part)}`).join("")}`;
  const init: RequestInit = { method: request.method, cache: "no-store" };
  if (request.method === "POST") {
    const bounded = await readBoundedBrowserRuntimeBody(request, 4096);
    if (!bounded.ok) return bounded.response;
    init.body = bounded.body;
    init.headers = { "Content-Type": "application/json" };
  }
  return forwardAuthenticatedRuntimeRequest(request, sessionId, path, init, isRestore
    ? upstream => browserSessionResponse(upstream, { secureCookie: runtimeCredentialCookieIsSecure(request) })
    : undefined);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
