/**
 * Validates the currently edited authoring manifest text.
 *
 * This route intentionally does not write generated runtime manifests. It
 * compiles only in memory after syntax/schema checks pass, then maps runtime
 * schema diagnostics back through the compiler source map.
 */
import { EditorRepositoryError } from "@/lib/editor-repository";
import { validateAuthoringForEditor } from "@/lib/compiler-workflow";
import { repoRootForSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly filePath: string;
      readonly text: string;
      readonly sessionId: string;
    }>;

    if (typeof body.gameId !== "string" || typeof body.filePath !== "string" || typeof body.text !== "string") {
      throw new EditorRepositoryError("Validate requests require gameId, filePath, and text.", 400);
    }

    const { repoRoot } = await repoRootForSession(body.sessionId, body.gameId);
    return Response.json(
      await validateAuthoringForEditor({
        gameId: body.gameId,
        filePath: body.filePath,
        text: body.text,
        repoRoot: repoRoot ?? configuredEditorProjectRoot()
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor validation failure." }, { status: 500 });
}
