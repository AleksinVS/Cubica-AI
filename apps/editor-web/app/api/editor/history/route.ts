/**
 * Dynamic HTTP boundary for durable author-version history.
 *
 * The browser sends only opaque version ids and cursors. All Git references,
 * reachability checks and allowlisted path restoration stay on the Node.js
 * server, and expected failures are translated to stable public error codes.
 */
import { type NextRequest } from "next/server";

import { type EditorVersionRestoreRequest } from "@/lib/editor-version-contracts";
import { EditorRepositoryError } from "@/lib/editor-repository";
import {
  evaluateEditorSessionCompatibility,
  markEditorSessionSaved,
  touchEditorSession,
  withEditorSessionMutationLease
} from "@/lib/editor-session-store";
import { EditorSessionLeaseError } from "@/lib/editor-session-lease";
import {
  allowedSavePathsForGame,
  EditorVersionStoreError,
  listProjectVersionHistory,
  readProjectVersionDetails,
  restoreDurableProjectVersion
} from "@/lib/project-git-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const sessionId = requireQueryParam(request, "sessionId");
    const session = await readUsableSession(sessionId);
    const allowedPaths = allowedSavePathsForGame({ gameId: session.gameId });
    const versionId = request.nextUrl.searchParams.get("versionId");

    if (versionId !== null && versionId !== "") {
      return noStoreJson(await readProjectVersionDetails({
        projectRoot: session.projectRoot,
        gameId: session.gameId,
        versionId,
        allowedPaths
      }));
    }

    const limitValue = request.nextUrl.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    const page = await listProjectVersionHistory({
      projectRoot: session.projectRoot,
      gameId: session.gameId,
      allowedPaths,
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit
    });

    return noStoreJson({
      ...page,
      dirtySummary: session.dirtySummary
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => undefined)) as Partial<EditorVersionRestoreRequest> | undefined;
    if (
      body === undefined ||
      typeof body.sessionId !== "string" ||
      typeof body.versionId !== "string" ||
      !isOpaqueVersionId(body.versionId) ||
      body.expectedHead === undefined ||
      (body.expectedHead !== null && (typeof body.expectedHead !== "string" || !isOpaqueVersionId(body.expectedHead)))
    ) {
      throw new EditorVersionStoreError(
        "Restore requests require sessionId, versionId, and expectedHead.",
        400,
        "invalid_request"
      );
    }

    return await withEditorSessionMutationLease(body.sessionId, "restore", async () => {
      const session = await readUsableSession(body.sessionId!);
      if (session.dirtySummary.isDirty) {
        throw new EditorVersionStoreError("Save unsaved changes before restoring a version.", 409, "session_dirty");
      }
      const compatibility = evaluateEditorSessionCompatibility(session);
      if (!compatibility.ok) {
        throw new EditorVersionStoreError("The session must be upgraded before restoring history.", 409, "session_incompatible");
      }

      const restored = await restoreDurableProjectVersion({
        projectRoot: session.projectRoot,
        gameId: session.gameId,
        worktreePath: session.worktreePath,
        versionId: body.versionId!,
        expectedHead: body.expectedHead!,
        allowedPaths: allowedSavePathsForGame({ gameId: session.gameId }),
        authorName: session.userId
      });
      if (restored.versionId === undefined || restored.version === undefined) {
        throw new EditorVersionStoreError("Restore did not create a durable version.", 409, "version_conflict");
      }

      const sessionMetadataSyncCode = await markEditorSessionSaved({
        sessionId: session.sessionId,
        commitHash: restored.commitHash,
        versionId: restored.versionId
      }).then(() => undefined).catch(() => "metadata_sync_failed" as const);

      return noStoreJson({
        version: restored.version,
        currentVersionId: restored.versionId,
        restoredVersionId: body.versionId,
        changedPaths: restored.changedPaths,
        sessionMetadataSynchronized: sessionMetadataSyncCode === undefined,
        ...(sessionMetadataSyncCode === undefined ? {} : { sessionMetadataSyncCode })
      });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Supports both SHA-1 and SHA-256 repositories while keeping ids opaque. */
function isOpaqueVersionId(value: string): boolean {
  return /^[0-9a-f]{40,64}$/u.test(value);
}

async function readUsableSession(sessionId: string) {
  try {
    return await touchEditorSession(sessionId);
  } catch (error) {
    if (error instanceof EditorRepositoryError && (error.statusCode === 404 || error.statusCode === 410)) {
      throw new EditorVersionStoreError("Editor session was not found.", 404, "session_not_found");
    }
    throw error;
  }
}

function requireQueryParam(request: NextRequest, name: string): string {
  const value = request.nextUrl.searchParams.get(name);
  if (value === null || value === "") {
    throw new EditorVersionStoreError(`Missing query parameter: ${name}.`, 400, "invalid_request");
  }
  return value;
}

function noStoreJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorVersionStoreError) {
    return noStoreJson({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  if (error instanceof EditorSessionLeaseError) {
    return noStoreJson({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  if (error instanceof EditorRepositoryError) {
    if (error.statusCode >= 500) {
      return noStoreJson({ error: "Unexpected editor history failure." }, { status: 500 });
    }
    const status = error.statusCode === 404 || error.statusCode === 410 ? 404 : error.statusCode === 409 ? 409 : 400;
    return noStoreJson({
      error: status === 404 ? "Editor session was not found." : error.message,
      code: status === 404 ? "session_not_found" : status === 409 ? "version_conflict" : "invalid_request"
    }, { status });
  }
  return noStoreJson({ error: "Unexpected editor history failure." }, { status: 500 });
}
