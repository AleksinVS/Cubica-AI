/**
 * Lists and pins editor state fixtures (ADR-057 §4.9, §9.3; design-spec §2.5,
 * §3.3).
 *
 * - GET  returns the game's pinned fixtures, each flagged `stale` when its
 *   captured manifest hash no longer matches the current manifests.
 * - POST pins the current preview state as a new fixture, writing it into the
 *   session worktree authoring tree (`games/<id>/authoring/fixtures/<id>.json`)
 *   so it commits together with the author's other edits on Save.
 *
 * The route never sends fixture state into runtime: applying a fixture to the
 * preview reuses the existing preview-only restore endpoint on the client, so no
 * new runtime contract is introduced here (ADR-057 §5 invariant).
 */
import { EditorRepositoryError } from "@/lib/editor-repository";
import { listStateFixtures, writeStateFixture } from "@/lib/editor-fixture-store";
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
      throw new EditorRepositoryError("Fixture listing requires a configured project root or a session.", 400);
    }

    const result = await listStateFixtures({ gameId, repoRoot });
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
      readonly id: string;
      readonly label: string;
      readonly state: Record<string, unknown>;
      readonly screenRef: string;
      readonly stepRef: string;
      readonly sourceTraceRef: string;
      readonly note: string;
    }>;

    if (typeof body.gameId !== "string" || typeof body.id !== "string" || typeof body.label !== "string") {
      throw new EditorRepositoryError("Pinning a fixture requires gameId, id, and label.", 400);
    }
    if (typeof body.state !== "object" || body.state === null || Array.isArray(body.state)) {
      throw new EditorRepositoryError("Pinning a fixture requires a state object snapshot.", 400);
    }

    const session = await repoRootForSession(body.sessionId, body.gameId);
    // Fixtures must land in the session worktree so Save commits them; refuse to
    // write into the shared project root, which is not a per-author worktree.
    const repoRoot = session.session?.worktreePath;
    if (repoRoot === undefined) {
      throw new EditorRepositoryError("Pinning a fixture requires an editor session worktree.", 400);
    }

    const fixture = await writeStateFixture({
      gameId: body.gameId,
      repoRoot,
      id: body.id,
      label: body.label,
      state: body.state,
      screenRef: body.screenRef,
      stepRef: body.stepRef,
      sourceTraceRef: body.sourceTraceRef,
      note: body.note
    });

    return Response.json({ ok: true, fixture });
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
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected fixture route failure." }, { status: 500 });
}
