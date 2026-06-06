/**
 * Plans an editor session upgrade to the current platform release.
 *
 * The current implementation is intentionally dry-run only: it reports why a
 * session needs upgrade and keeps the old worktree untouched until compile,
 * plugin validation and preview checks are wired into an apply flow.
 */
import { planEditorSessionUpgrade } from "@/lib/editor-session-store";
import { EditorRepositoryError } from "@/lib/editor-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly sessionId: string;
    }>;

    if (typeof body.sessionId !== "string" || body.sessionId.trim() === "") {
      throw new EditorRepositoryError("Session upgrade dry-run requires sessionId.", 400);
    }

    return Response.json(await planEditorSessionUpgrade({ sessionId: body.sessionId }));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor session upgrade failure." }, { status: 500 });
}
