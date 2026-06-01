/**
 * Opens and closes Git worktree-backed editor sessions.
 *
 * A session is an isolated branch/worktree where the browser can accumulate
 * authoring edits. Normal Save creates a Git commit in that session instead of
 * writing directly into the main checkout.
 */
import { createEditorSession, closeEditorSession } from "@/lib/editor-session-store";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<{
      readonly gameId: string | null;
    }>;

    if (body.gameId !== undefined && body.gameId !== null && typeof body.gameId !== "string") {
      throw new EditorRepositoryError("Editor session gameId must be a string when provided.", 400);
    }

    return Response.json(await createEditorSession({ gameId: body.gameId, repoRoot: configuredEditorProjectRoot() }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly sessionId: string;
    }>;

    if (typeof body.sessionId !== "string") {
      throw new EditorRepositoryError("Close session requests require sessionId.", 400);
    }

    return Response.json(await closeEditorSession(body.sessionId));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor session failure." }, { status: 500 });
}
