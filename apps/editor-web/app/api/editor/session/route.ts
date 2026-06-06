/**
 * Opens and closes Git worktree-backed editor sessions.
 *
 * A session is an isolated branch/worktree where the browser can accumulate
 * authoring edits. Normal Save creates a Git commit in that session instead of
 * writing directly into the main checkout.
 */
import { createEditorSession, closeEditorSession, listEditorSessions } from "@/lib/editor-session-store";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listEditorSessions({
      gameId: request.nextUrl.searchParams.get("gameId"),
      userId: request.nextUrl.searchParams.get("userId"),
      includeExpired: request.nextUrl.searchParams.get("includeExpired") === "1"
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<{
      readonly gameId: string | null;
      readonly userId: string | null;
      readonly forceNew: boolean;
      readonly label: string | null;
    }>;

    if (body.gameId !== undefined && body.gameId !== null && typeof body.gameId !== "string") {
      throw new EditorRepositoryError("Editor session gameId must be a string when provided.", 400);
    }
    if (body.userId !== undefined && body.userId !== null && typeof body.userId !== "string") {
      throw new EditorRepositoryError("Editor session userId must be a string when provided.", 400);
    }
    if (body.forceNew !== undefined && typeof body.forceNew !== "boolean") {
      throw new EditorRepositoryError("Editor session forceNew must be a boolean when provided.", 400);
    }
    if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
      throw new EditorRepositoryError("Editor session label must be a string when provided.", 400);
    }

    return Response.json(await createEditorSession({
      gameId: body.gameId,
      repoRoot: configuredEditorProjectRoot(),
      userId: body.userId,
      forceNew: body.forceNew,
      label: body.label
    }));
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
