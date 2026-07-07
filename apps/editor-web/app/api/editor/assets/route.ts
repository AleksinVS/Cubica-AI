/**
 * Lists and uploads game assets (ADR-009; ADR-057 §4/§9.4; design-spec §3.6).
 *
 * - GET  returns the game's assets (type, size, usage counter, orphan flag) for
 *   the asset library. It reads from the session worktree when a session is
 *   given, else from the configured project root, so the library also works
 *   without an open editing session.
 * - POST uploads one asset (base64) into the session worktree assets tree
 *   (`games/<id>/assets/...`) so it commits together with the author's other
 *   edits on the next Save. Like the fixtures/apply routes, the write lands ONLY
 *   in the per-author worktree and never in the shared root (ADR-057 §5).
 */
import { EditorRepositoryError } from "@/lib/editor-repository";
import { listGameAssets, writeGameAsset } from "@/lib/editor-asset-store";
import { repoRootForSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const gameId = requireQueryParam(request, "gameId");
    const session = await repoRootForSession(request.nextUrl.searchParams.get("sessionId") ?? undefined, gameId);
    const repoRoot = session.repoRoot ?? configuredEditorProjectRoot();
    if (repoRoot === undefined) {
      throw new EditorRepositoryError("Asset listing requires a configured project root or a session.", 400);
    }

    const result = await listGameAssets({ gameId, repoRoot });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly sessionId: string;
      readonly filePath: string;
      readonly contentBase64: string;
    }>;

    if (typeof body.gameId !== "string" || typeof body.filePath !== "string" || typeof body.contentBase64 !== "string") {
      throw new EditorRepositoryError("Uploading an asset requires gameId, filePath, and base64 content.", 400);
    }

    const session = await repoRootForSession(body.sessionId, body.gameId);
    // Uploaded assets must land in the session worktree so Save commits them;
    // refuse to write into the shared project root, which is not a per-author tree.
    const repoRoot = session.session?.worktreePath;
    if (repoRoot === undefined) {
      throw new EditorRepositoryError("Uploading an asset requires an editor session worktree.", 400);
    }

    const asset = await writeGameAsset({
      gameId: body.gameId,
      repoRoot,
      relativePath: body.filePath,
      contentBase64: body.contentBase64
    });

    return Response.json({ ok: true, asset });
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
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected asset route failure." }, { status: 500 });
}
