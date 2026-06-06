/**
 * Compiles one game's ADR-030 authoring manifests into runtime manifests.
 *
 * `checkOnly` preserves CI-style drift checking without writing generated
 * files. Normal compile writes only when compiler and runtime schema
 * diagnostics are clean.
 */
import { compileGameForEditor } from "@/lib/compiler-workflow";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { repoRootForSession, touchEditorSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { validateAndBundleProjectPlugins } from "@/lib/project-plugin-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly checkOnly: boolean;
      readonly sessionId: string;
    }>;

    if (typeof body.gameId !== "string") {
      throw new EditorRepositoryError("Compile requests require gameId.", 400);
    }

    const { repoRoot, session } = await repoRootForSession(body.sessionId, body.gameId);
    const workflowRepoRoot = repoRoot ?? configuredEditorProjectRoot();
    const compile = await compileGameForEditor({
      gameId: body.gameId,
      checkOnly: body.checkOnly === true,
      repoRoot: workflowRepoRoot
    });

    if (!compile.ok || session === undefined) {
      if (session !== undefined) {
        await touchEditorSession(session.sessionId);
      }
      return Response.json(compile);
    }

    const pluginValidation = await validateAndBundleProjectPlugins({
      gameId: body.gameId,
      repoRoot: session.worktreePath
    });

    await touchEditorSession(session.sessionId);

    return Response.json({
      ...compile,
      ok: compile.ok && pluginValidation.ok,
      diagnostics: [...compile.diagnostics, ...pluginValidation.diagnostics],
      pluginValidation
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor compile failure." }, { status: 500 });
}
