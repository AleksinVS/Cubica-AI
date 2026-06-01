/**
 * Server-side registry for editor worktree sessions.
 *
 * Session metadata is stored in `.tmp/editor-sessions` so independent Next.js
 * route handlers can resolve the same worktree without keeping process-local
 * state. The metadata is tooling-only and must never be committed.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createProjectGitSession,
  removeProjectGitSession,
  type ProjectGitSession
} from "./project-git-workspace";
import {
  EditorRepositoryError,
  listAuthoringFiles,
  type AuthoringListResult
} from "./editor-repository";

export interface EditorSessionDocument extends ProjectGitSession {
  readonly gameId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EditorSessionPublic {
  readonly sessionId: string;
  readonly gameId: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEditorSessionResult extends AuthoringListResult {
  readonly session: EditorSessionPublic;
}

const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;

export async function createEditorSession(input: {
  readonly gameId?: string | null;
  readonly repoRoot?: string;
}): Promise<CreateEditorSessionResult> {
  const initialList = await listAuthoringFiles({ gameId: input.gameId, repoRoot: input.repoRoot });
  const gitSession = await createProjectGitSession({
    projectRoot: input.repoRoot ?? process.cwd(),
    gameId: initialList.gameId
  });
  const now = new Date().toISOString();
  const session: EditorSessionDocument = {
    ...gitSession,
    gameId: initialList.gameId,
    createdAt: now,
    updatedAt: now
  };

  await writeSessionDocument(session);

  const sessionList = await listAuthoringFiles({
    gameId: session.gameId,
    repoRoot: session.worktreePath
  });

  return {
    ...sessionList,
    session: toPublicSession(session)
  };
}

export async function readEditorSession(sessionId: string): Promise<EditorSessionDocument> {
  validateSessionId(sessionId);
  const repoRoot = await resolveRepositoryRoot();
  const text = await readFile(sessionDocumentPath(repoRoot, sessionId), "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) {
      throw new EditorRepositoryError("Editor session was not found.", 404);
    }

    throw error;
  });
  const parsed = JSON.parse(text) as Partial<EditorSessionDocument>;
  if (
    typeof parsed.sessionId !== "string" ||
    typeof parsed.gameId !== "string" ||
    typeof parsed.projectRoot !== "string" ||
    typeof parsed.worktreePath !== "string" ||
    typeof parsed.branchName !== "string" ||
    typeof parsed.baseCommit !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    throw new EditorRepositoryError("Editor session metadata is invalid.", 500);
  }

  validateSessionId(parsed.sessionId);
  return parsed as EditorSessionDocument;
}

export async function closeEditorSession(sessionId: string): Promise<{ readonly ok: true; readonly sessionId: string }> {
  const session = await readEditorSession(sessionId);
  await removeProjectGitSession(session);
  await rm(sessionDocumentPath(await resolveRepositoryRoot(), sessionId), { force: true });
  return { ok: true, sessionId };
}

export async function repoRootForSession(
  sessionId: string | undefined,
  gameId: string | undefined
): Promise<{ readonly repoRoot?: string; readonly session?: EditorSessionDocument }> {
  if (sessionId === undefined || sessionId === "") {
    return {};
  }

  const session = await readEditorSession(sessionId);
  if (gameId !== undefined && gameId !== "" && session.gameId !== gameId) {
    throw new EditorRepositoryError("Editor session does not belong to the requested game.", 409);
  }

  return {
    repoRoot: session.worktreePath,
    session
  };
}

export function toPublicSession(session: EditorSessionDocument): EditorSessionPublic {
  return {
    sessionId: session.sessionId,
    gameId: session.gameId,
    branchName: session.branchName,
    baseCommit: session.baseCommit,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

async function writeSessionDocument(session: EditorSessionDocument): Promise<void> {
  const filePath = sessionDocumentPath(await resolveRepositoryRoot(), session.sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function resolveRepositoryRoot(): Promise<string> {
  let current = process.cwd();
  for (;;) {
    try {
      await stat(path.join(current, "PROJECT_STRUCTURE.yaml"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return process.cwd();
      }
      current = parent;
    }
  }
}

function sessionDocumentPath(repoRoot: string, sessionId: string): string {
  validateSessionId(sessionId);
  return path.join(repoRoot, ".tmp", "editor-sessions", `${sessionId}.json`);
}

function validateSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId) || sessionId.includes("..")) {
    throw new EditorRepositoryError("Session id must be a safe editor session segment.", 400);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}
