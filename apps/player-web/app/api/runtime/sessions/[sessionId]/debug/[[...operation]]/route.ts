import { NextResponse, type NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../../../_shared";

type RouteContext = {
  params: Promise<{ sessionId: string; operation?: string[] }>;
};

/** Only the accepted debugger operations may cross this authenticated BFF boundary. */
async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sessionId, operation = [] } = await context.params;
  const [first] = operation;
  // AB3: the browser must not save or restore rendered checkpoints until the
  // complete preview package has an approved durable lifetime.
  const allowed =
    (request.method === "GET" && operation.length === 0) ||
    (request.method === "POST" && operation.length === 1 && ["pause", "resume"].includes(first));
  if (!allowed) return NextResponse.json({ error: "Unknown debug operation." }, { status: 404 });

  const path = `/sessions/${encodeURIComponent(sessionId)}/debug${operation.map(part => `/${encodeURIComponent(part)}`).join("")}`;
  const init: RequestInit = { method: request.method, cache: "no-store" };
  if (request.method === "POST") {
    const bounded = await readBoundedBrowserRuntimeBody(request, 4096);
    if (!bounded.ok) return bounded.response;
    init.body = bounded.body;
    init.headers = { "Content-Type": "application/json" };
  }
  return forwardAuthenticatedRuntimeRequest(request, sessionId, path, init);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
