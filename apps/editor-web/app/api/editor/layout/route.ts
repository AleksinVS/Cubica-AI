/**
 * Opens and persists editor-only graph layout companion files.
 *
 * The caller names the authoring JSON file, not an arbitrary layout path. The
 * repository adapter derives `editor.layout.json` or `ui/<channel>.layout.json`
 * and applies the same traversal and symlink guards used for authoring files.
 */
import { EditorRepositoryError, openEditorLayout, saveEditorLayout, type EditorLayoutDocumentBody } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const gameId = requireQueryParam(request, "gameId");
    const authoringFilePath = requireQueryParam(request, "filePath");
    const session = await repoRootForSession(request.nextUrl.searchParams.get("sessionId") ?? undefined, gameId);
    return Response.json(await openEditorLayout({ gameId, authoringFilePath, repoRoot: session.repoRoot ?? configuredEditorProjectRoot() }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly filePath: string;
      readonly layout: EditorLayoutDocumentBody;
      readonly versionHash: string;
      readonly sessionId: string;
    }>;

    if (typeof body.gameId !== "string" || typeof body.filePath !== "string" || body.layout === undefined) {
      throw new EditorRepositoryError("Layout save requests require gameId, filePath, and layout.", 400);
    }

    if (body.versionHash !== undefined && typeof body.versionHash !== "string") {
      throw new EditorRepositoryError("Layout versionHash must be a string when provided.", 400);
    }

    return Response.json(
      await saveEditorLayout({
        gameId: body.gameId,
        authoringFilePath: body.filePath,
        layout: body.layout,
        versionHash: body.versionHash,
        repoRoot: (await repoRootForSession(body.sessionId, body.gameId)).repoRoot ?? configuredEditorProjectRoot()
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function requireQueryParam(request: NextRequest, name: string): string {
  const value = request.nextUrl.searchParams.get(name);
  if (value === null || value === "") {
    throw new EditorRepositoryError(`Missing query parameter: ${name}`, 400);
  }

  return value;
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: "Unexpected editor layout repository failure." }, { status: 500 });
}
