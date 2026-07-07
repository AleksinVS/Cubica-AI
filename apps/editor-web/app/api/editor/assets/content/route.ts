/**
 * Streams one game asset's bytes for the library thumbnail/preview (design-spec
 * §3.6 "сетка с превью"). Read-only: it resolves a single file inside
 * `games/<id>/assets/` (guarded against path traversal) and returns it with the
 * matching content type, from the session worktree when a session is given, else
 * the configured project root. It never streams anything outside the assets tree.
 */
import { readFile } from "node:fs/promises";

import { EditorRepositoryError } from "@/lib/editor-repository";
import { resolveGameAssetFile } from "@/lib/editor-asset-store";
import { repoRootForSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

/** Content type by extension for the small set of asset kinds the library shows. */
const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8"
};

export async function GET(request: NextRequest) {
  try {
    const gameId = requireQueryParam(request, "gameId");
    const relativePath = requireQueryParam(request, "path");
    const session = await repoRootForSession(request.nextUrl.searchParams.get("sessionId") ?? undefined, gameId);
    const repoRoot = session.repoRoot ?? configuredEditorProjectRoot();
    if (repoRoot === undefined) {
      throw new EditorRepositoryError("Asset content requires a configured project root or a session.", 400);
    }

    const resolved = await resolveGameAssetFile({ gameId, repoRoot, relativePath });
    const bytes = await readFile(resolved.absolutePath);
    const ext = resolved.name.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof EditorRepositoryError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected asset content failure." }, { status: 500 });
  }
}

function requireQueryParam(request: NextRequest, name: string): string {
  const value = request.nextUrl.searchParams.get(name);
  if (value === null || value === "") {
    throw new EditorRepositoryError(`Missing query parameter: ${name}`, 400);
  }
  return value;
}
