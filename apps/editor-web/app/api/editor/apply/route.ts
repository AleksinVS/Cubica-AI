/** Preview/confirm/direct editor mutation boundary (ADR-105). */
import { type NextRequest } from "next/server";

import {
  executeEditorMutation,
  mutationErrorResponse,
  validateEditorMutationRequest
} from "@/lib/editor-mutation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!validateEditorMutationRequest(body)) {
      return Response.json({ error: "Invalid editor mutation request." }, { status: 400 });
    }
    const result = await executeEditorMutation(body, request.headers.get("origin") ?? undefined);
    return Response.json(result.body, result.status === undefined ? undefined : { status: result.status });
  } catch (error) {
    const result = mutationErrorResponse(error);
    return Response.json(result.body, { status: result.status ?? 500 });
  }
}
