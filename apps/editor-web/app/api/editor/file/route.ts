/**
 * Opens and saves one repository-backed authoring JSON file.
 *
 * PUT uses a version hash so the editor refuses to overwrite newer disk
 * content. The shared repository adapter enforces path traversal and symlink
 * escape checks before any file read or write.
 */
import {
  inferEditorEntityDocumentChannel,
  inferEditorEntityDocumentKind,
  type JsonValue
} from "@cubica/editor-engine";

import { EditorRepositoryError, listAuthoringFiles, openAuthoringFile, saveAuthoringFile } from "@/lib/editor-repository";
import {
  markEditorSessionSaved,
  repoRootForSession,
  touchEditorSession,
  withEditorSessionMutationLease
} from "@/lib/editor-session-store";
import { EditorSessionLeaseError } from "@/lib/editor-session-lease";
import {
  allowedSavePathsForGame,
  EditorVersionStoreError,
  saveProjectGitSession
} from "@/lib/project-git-workspace";
import { type EditorVersionChangeFact } from "@/lib/editor-version-contracts";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { validateAndBundleProjectPlugins } from "@/lib/project-plugin-validation";
import { loadProjectionEnvelopeWithCache } from "@/lib/editor-project-cache";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * One authoring document shipped to the client as part of the project-level
 * projection payload (ADR-057 §4.1): its path, full text, and the GAME-AGNOSTIC
 * classification (`documentKind`/`channel`) derived from its `_manifestType` /
 * `_channel` header. Only game + ui documents participate in the projection.
 */
interface ProjectionDocumentPayload {
  readonly filePath: string;
  readonly text: string;
  readonly documentKind: "game" | "ui";
  readonly channel?: string;
}

export async function GET(request: NextRequest) {
  try {
    const gameId = requireQueryParam(request, "gameId");
    const filePath = requireQueryParam(request, "filePath");
    const session = await repoRootForSession(request.nextUrl.searchParams.get("sessionId") ?? undefined, gameId);
    const repoRoot = session.repoRoot ?? configuredEditorProjectRoot();
    const document = await openAuthoringFile({ gameId, filePath, repoRoot });

    // Project-level projection payload (ADR-057 §4.1, Phase 3.a). Gather EVERY
    // authoring document of the game that participates in the projection — the
    // game authoring manifest plus each ui/<channel> manifest — so the client can
    // build one cross-document entity projection (game meaning + UI facets by
    // channel). The composition comes from the existing file listing and the
    // classification is by document TYPE (game/ui), never by hardcoded names.
    // Best-effort: any failure omits the extra fields and the client rebuilds a
    // single-document projection exactly as before.
    const project = await collectProjectionDocuments({
      gameId,
      repoRoot,
      activeFilePath: document.filePath,
      activeText: document.text
    }).catch(() => undefined);

    // Warm-start piggyback (ADR-057 §4.13 "Уровень 2"): ship the serialized project
    // projection alongside the text so the client hydrates its first view model
    // instead of rebuilding it. Best-effort for the same reason as above.
    const projection =
      project === undefined
        ? undefined
        : await loadProjectionEnvelopeWithCache({
            documents: project.documents.map((entry) => ({ filePath: entry.filePath, text: entry.text })),
            activeChannel: project.activeChannel
          }).catch(() => undefined);

    // The client already holds the active document via `text`, so ship only the
    // SIBLING documents (its own text is not duplicated on the wire).
    const projectionDocuments = project?.documents.filter((entry) => entry.filePath !== document.filePath);

    return Response.json({
      ...document,
      ...(projectionDocuments !== undefined ? { projectionDocuments } : {}),
      ...(project !== undefined ? { activeChannel: project.activeChannel } : {}),
      ...(projection !== undefined ? { projection } : {})
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Lists the game's authoring files and returns every one that participates in the
 * entity projection (game + ui documents), each with its text and game-agnostic
 * classification, plus the ACTIVE channel derived from the opened document (the
 * channel of the open UI document, or undefined when a game document is open).
 * Reuses the already-read active text instead of re-reading it from disk.
 */
async function collectProjectionDocuments(input: {
  readonly gameId: string;
  readonly repoRoot: string | undefined;
  readonly activeFilePath: string;
  readonly activeText: string;
}): Promise<{ readonly documents: readonly ProjectionDocumentPayload[]; readonly activeChannel: string | undefined }> {
  const list = await listAuthoringFiles({ gameId: input.gameId, repoRoot: input.repoRoot });
  const documents: ProjectionDocumentPayload[] = [];
  let activeChannel: string | undefined;

  for (const file of list.files) {
    const text =
      file.filePath === input.activeFilePath
        ? input.activeText
        : (await openAuthoringFile({ gameId: input.gameId, filePath: file.filePath, repoRoot: input.repoRoot })).text;
    const json = safeParseJson(text);
    const documentKind = inferEditorEntityDocumentKind(json);
    if (documentKind !== "game" && documentKind !== "ui") {
      continue;
    }
    const channel = inferEditorEntityDocumentChannel(json);
    documents.push({ filePath: file.filePath, text, documentKind, ...(channel !== undefined ? { channel } : {}) });
    if (file.filePath === input.activeFilePath && documentKind === "ui") {
      activeChannel = channel;
    }
  }

  return { documents, activeChannel };
}

function safeParseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
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
      readonly authorComment: string;
      readonly changeFacts: readonly EditorVersionChangeFact[];
      readonly expectedHead: string | null;
    }>;

    if (
      typeof body.gameId !== "string" ||
      typeof body.filePath !== "string" ||
      typeof body.text !== "string" ||
      typeof body.versionHash !== "string" ||
      typeof body.sessionId !== "string" ||
      body.sessionId === ""
    ) {
      throw new EditorRepositoryError("Save requests require gameId, filePath, text, versionHash, and sessionId.", 400);
    }
    if (body.authorComment !== undefined && typeof body.authorComment !== "string") {
      throw new EditorRepositoryError("Save authorComment must be a string when provided.", 400);
    }
    if (body.changeFacts !== undefined && !Array.isArray(body.changeFacts)) {
      throw new EditorRepositoryError("Save changeFacts must be an array when provided.", 400);
    }
    if (body.expectedHead !== undefined && body.expectedHead !== null && typeof body.expectedHead !== "string") {
      throw new EditorRepositoryError("Save expectedHead must be a version id or null.", 400);
    }

    return await withEditorSessionMutationLease(body.sessionId, "save", async () => {
      const session = await repoRootForSession(body.sessionId, body.gameId);
      if (session.session === undefined || session.repoRoot === undefined) {
        throw new EditorRepositoryError("Save requires an active editor session.", 400);
      }
      const saved = await saveAuthoringFile({
        gameId: body.gameId!,
        filePath: body.filePath!,
        text: body.text!,
        versionHash: body.versionHash!,
        repoRoot: session.repoRoot
      });

      const pluginValidation = await validateAndBundleProjectPlugins({
        gameId: body.gameId!,
        repoRoot: session.session.worktreePath
      });
      if (!pluginValidation.ok) {
        await touchEditorSession(session.session.sessionId);
        return Response.json({
          ...saved,
          sessionId: session.session.sessionId,
          pluginValidation
        }, { status: 422 });
      }

      const commit = await saveProjectGitSession({
        worktreePath: session.session.worktreePath,
        projectRoot: session.session.projectRoot,
        gameId: body.gameId!,
        expectedHead: body.expectedHead === undefined ? session.session.currentVersionId ?? null : body.expectedHead,
        message: body.commitMessage ?? `Save ${body.gameId}/${body.filePath}`,
        allowedPaths: allowedSavePathsForGame({ gameId: body.gameId! }),
        authorName: session.session.userId,
        authorComment: body.authorComment,
        changeFacts: body.changeFacts?.map((fact) => ({
          ...fact,
          filePath: toProjectAuthoringPath(body.gameId!, fact.filePath),
          previousFilePath: fact.previousFilePath === undefined
            ? undefined
            : toProjectAuthoringPath(body.gameId!, fact.previousFilePath)
        }))
      });
      if (!commit.committed || commit.versionId === undefined || commit.version === undefined) {
        throw new EditorVersionStoreError("Save does not contain authoring changes.", 400, "invalid_request");
      }
      const sessionMetadataSyncCode = await markEditorSessionSaved({
        sessionId: session.session.sessionId,
        commitHash: commit.commitHash,
        versionId: commit.versionId
      }).then(() => undefined).catch(() => "metadata_sync_failed" as const);

      return Response.json({
        ...saved,
        sessionId: session.session.sessionId,
        commit,
        version: commit.version,
        pluginValidation,
        sessionMetadataSynchronized: sessionMetadataSyncCode === undefined,
        ...(sessionMetadataSyncCode === undefined ? {} : { sessionMetadataSyncCode })
      });
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

/** Browser journals use paths relative to `authoring/`; Git policy uses project paths. */
function toProjectAuthoringPath(gameId: string, filePath: string): string {
  return filePath.startsWith(`games/${gameId}/`)
    ? filePath
    : `games/${gameId}/authoring/${filePath.replace(/^\/+/, "")}`;
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    if (error.statusCode >= 500) {
      return Response.json({ error: "Unexpected editor repository failure." }, { status: 500 });
    }
    return Response.json({
      error: error.message,
      ...(error instanceof EditorVersionStoreError || error instanceof EditorSessionLeaseError ? { code: error.code } : {})
    }, { status: error.statusCode });
  }

  return Response.json({ error: "Unexpected editor repository failure." }, { status: 500 });
}
