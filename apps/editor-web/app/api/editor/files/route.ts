/**
 * Lists repository-backed authoring files available to editor-web.
 *
 * The route exposes only editable source files below `games/<gameId>/authoring`;
 * generated runtime manifests are deliberately unreachable from this API.
 */
import { listAuthoringFiles, EditorRepositoryError } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const gameId = request.nextUrl.searchParams.get("gameId");
    const sessionId = request.nextUrl.searchParams.get("sessionId") ?? undefined;
    const session = await repoRootForSession(sessionId, gameId ?? undefined);
    const result = await listAuthoringFiles({ gameId, repoRoot: session.repoRoot ?? configuredEditorProjectRoot() });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: "Unexpected editor repository failure." }, { status: 500 });
}
