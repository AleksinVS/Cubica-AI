import { validateEditorPrototypePreviewRequest } from "@cubica/contracts-session";
import { compilePrototypeForEditor } from "@/lib/compiler-workflow";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { EditorRepositoryError, openAuthoringFile } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!validateEditorPrototypePreviewRequest(body)) {
      return Response.json({ error: "Некорректный запрос предпросмотра прототипа." }, { status: 400 });
    }
    const session = await repoRootForSession(body.sessionId, body.gameId);
    const repoRoot = session.repoRoot ?? configuredEditorProjectRoot();
    const document = await openAuthoringFile({ gameId: body.gameId, filePath: body.filePath, repoRoot });
    if (document.versionHash !== body.expectedVersion) {
      throw new EditorRepositoryError("Файл изменился. Обновите контекст перед открытием прототипа.", 409);
    }
    const component = await compilePrototypeForEditor({ ...body, text: document.text, repoRoot });
    return Response.json({ component });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось открыть прототип." }, {
      status: error instanceof EditorRepositoryError ? error.statusCode : error instanceof SyntaxError ? 400 : 500
    });
  }
}
