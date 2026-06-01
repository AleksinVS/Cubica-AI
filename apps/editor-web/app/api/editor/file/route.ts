/**
 * Opens and saves one repository-backed authoring JSON file.
 *
 * PUT uses a version hash so the editor refuses to overwrite newer disk
 * content. The shared repository adapter enforces path traversal and symlink
 * escape checks before any file read or write.
 */
import { EditorRepositoryError, openAuthoringFile, saveAuthoringFile } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";
import { allowedSavePathsForGame, saveProjectGitSession } from "@/lib/project-git-workspace";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { validateAndBundleProjectPlugins } from "@/lib/project-plugin-validation";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const gameId = requireQueryParam(request, "gameId");
    const filePath = requireQueryParam(request, "filePath");
    const session = await repoRootForSession(request.nextUrl.searchParams.get("sessionId") ?? undefined, gameId);
    return Response.json(await openAuthoringFile({ gameId, filePath, repoRoot: session.repoRoot ?? configuredEditorProjectRoot() }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly filePath: string;
      readonly text: string;
      readonly versionHash: string;
      readonly sessionId: string;
      readonly commitMessage: string;
    }>;

    if (
      typeof body.gameId !== "string" ||
      typeof body.filePath !== "string" ||
      typeof body.text !== "string" ||
      typeof body.versionHash !== "string"
    ) {
      throw new EditorRepositoryError("Save requests require gameId, filePath, text, and versionHash.", 400);
    }

    const session = await repoRootForSession(body.sessionId, body.gameId);
    const saved = await saveAuthoringFile({
      gameId: body.gameId,
      filePath: body.filePath,
      text: body.text,
      versionHash: body.versionHash,
      repoRoot: session.repoRoot ?? configuredEditorProjectRoot()
    });

    if (session.session === undefined) {
      return Response.json(saved);
    }

    const pluginValidation = await validateAndBundleProjectPlugins({
      gameId: body.gameId,
      repoRoot: session.session.worktreePath
    });
    if (!pluginValidation.ok) {
      return Response.json({
        ...saved,
        sessionId: session.session.sessionId,
        pluginValidation
      }, { status: 422 });
    }

    const commit = await saveProjectGitSession({
      worktreePath: session.session.worktreePath,
      message: body.commitMessage ?? `Save ${body.gameId}/${body.filePath}`,
      allowedPaths: allowedSavePathsForGame({ gameId: body.gameId })
    });

    return Response.json({
      ...saved,
      sessionId: session.session.sessionId,
      commit,
      pluginValidation
    });
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

  return Response.json({ error: "Unexpected editor repository failure." }, { status: 500 });
}
