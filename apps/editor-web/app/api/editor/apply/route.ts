/**
 * Persists the SIBLING facets of a multi-document EditorChangeSet into the
 * session worktree (ADR-057 §4.10, §5; Phase 6.2a, part A).
 *
 * An entity operation (create / rename / delete) is an ATOMIC cross-manifest
 * change: it touches the game manifest and the channel UI manifest at once. The
 * ACTIVE document is applied in the browser (in-memory + undo journal) exactly as
 * today; the OTHER touched documents ("siblings") are not open in Monaco, so this
 * route writes them into the author's worktree. The client has already dry-run
 * and validated EVERY touched document before calling this route, so a blocking
 * error here means only a filesystem/worktree failure — never invalid content.
 *
 * Like the fixtures route (ADR-057 §9.3), the write lands ONLY in the per-author
 * worktree and commits together with the rest of the author's edits on the next
 * Save (ADR-052); it is never committed here and never touches the shared root.
 */
import { EditorRepositoryError, applyAuthoringFilesToWorktree } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly sessionId: string;
      readonly files: readonly { readonly filePath: string; readonly text: string }[];
    }>;

    if (typeof body.gameId !== "string" || !Array.isArray(body.files)) {
      throw new EditorRepositoryError("Applying an entity operation requires gameId and a files array.", 400);
    }
    for (const file of body.files) {
      if (typeof file?.filePath !== "string" || typeof file?.text !== "string") {
        throw new EditorRepositoryError("Each applied file requires a filePath and text.", 400);
      }
    }

    const session = await repoRootForSession(body.sessionId, body.gameId);
    // Sibling facets must land in the session worktree so Save commits them; refuse
    // to write into the shared project root, which is not a per-author worktree.
    const repoRoot = session.session?.worktreePath;
    if (repoRoot === undefined) {
      throw new EditorRepositoryError("Applying an entity operation requires an editor session worktree.", 400);
    }

    const applied = await applyAuthoringFilesToWorktree({
      gameId: body.gameId,
      repoRoot,
      files: body.files
    });

    return Response.json({ ok: true, ...applied });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected apply route failure." }, { status: 500 });
}
