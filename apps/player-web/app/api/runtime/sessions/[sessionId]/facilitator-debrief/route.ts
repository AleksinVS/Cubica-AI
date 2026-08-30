import { NextResponse, type NextRequest } from "next/server";
import {
  forwardAuthenticatedRuntimeRequest,
  readBoundedBrowserRuntimeBody
} from "../../../_shared";
import { validateFacilitatorDebriefGenerationRequestShape } from "@cubica/contracts-session/facilitator-debrief";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const MAX_SESSION_ID_LENGTH = 128;

function validateSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === "string" &&
    sessionId.trim().length > 0 &&
    sessionId.length <= MAX_SESSION_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(sessionId);
}

async function readSessionId(context: RouteContext): Promise<string | NextResponse> {
  const { sessionId } = await context.params;
  if (!validateSessionId(sessionId)) {
    return NextResponse.json({ error: "A valid sessionId is required." }, { status: 400 });
  }
  return sessionId;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const sessionId = await readSessionId(context);
  if (sessionId instanceof NextResponse) return sessionId;

  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/facilitator-debrief`,
    { method: "GET" }
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const sessionId = await readSessionId(context);
  if (sessionId instanceof NextResponse) return sessionId;

  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.body) as unknown;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!validateFacilitatorDebriefGenerationRequestShape(parsed)) {
    return NextResponse.json(
      { error: "Request body must contain only a non-negative integer expectedStateVersion." },
      { status: 400 }
    );
  }

  // Canonicalizing the validated object prevents duplicate keys or incidental
  // whitespace from crossing the BFF boundary as a different request body.
  return forwardAuthenticatedRuntimeRequest(
    request,
    sessionId,
    `/sessions/${encodeURIComponent(sessionId)}/facilitator-debrief`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    }
  );
}
