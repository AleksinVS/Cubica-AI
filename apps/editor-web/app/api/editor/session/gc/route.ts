/**
 * Runs editor session garbage collection.
 *
 * Garbage collection means controlled cleanup of expired editor metadata,
 * linked Git worktrees and generated preview artifacts. Requests default to
 * dry-run mode so an operator can inspect the impact before applying cleanup.
 */
import { garbageCollectEditorSessions } from "@/lib/editor-session-store";
import { EditorRepositoryError } from "@/lib/editor-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<{
      readonly dryRun: boolean;
      readonly removeDirty: boolean;
    }>;

    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      throw new EditorRepositoryError("Session GC dryRun must be a boolean when provided.", 400);
    }
    if (body.removeDirty !== undefined && typeof body.removeDirty !== "boolean") {
      throw new EditorRepositoryError("Session GC removeDirty must be a boolean when provided.", 400);
    }

    return Response.json(await garbageCollectEditorSessions({
      dryRun: body.dryRun,
      removeDirty: body.removeDirty
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor session GC failure." }, { status: 500 });
}
