/**
 * Server-side registry for editor worktree sessions.
 *
 * A worktree is a separate Git working copy used by the editor as an isolated
 * draft area. Session metadata is stored in `.tmp/editor-sessions` so stateless
 * Next.js route handlers can resolve the same draft without keeping process
 * memory. The metadata is tooling-only and must never be committed.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createProjectGitSession,
  getProjectGitStatusSummary,
  listProjectGitWorktrees,
  pruneProjectGitWorktrees,
  removeProjectGitSession,
  resolveProjectGitRoot,
  type ProjectGitSession
} from "./project-git-workspace";
import {
  EditorRepositoryError,
  listAuthoringFiles,
  type AuthoringListResult
} from "./editor-repository";
import { EDITOR_CACHE_DEFAULT_MAX_BYTES, garbageCollectEditorCache } from "./editor-file-cache";
import { retainPreviewCheckpoints } from "./preview-checkpoint-retention";

export type EditorSessionStatus = "active" | "idle" | "dirty" | "saved" | "closed" | "expired" | "orphaned";

export interface EditorSessionDirtySummary {
  readonly isDirty: boolean;
  readonly changedPaths: readonly string[];
  readonly checkedAt: string;
}

export interface EditorSessionDocument extends ProjectGitSession {
  readonly schemaVersion: 2;
  readonly userId: string;
  readonly projectId: string;
  readonly gameId: string;
  readonly platformReleaseId: string;
  readonly pluginApiVersion: string;
  readonly status: EditorSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string;
  readonly dirtySummary: EditorSessionDirtySummary;
  readonly lastSavedCommit?: string;
  readonly label?: string;
}

export interface EditorPlatformReleaseDescriptor {
  readonly platformReleaseId: string;
  readonly pluginApiVersion: string;
}

export interface EditorSessionPublic {
  readonly sessionId: string;
  readonly gameId: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly platformReleaseId: string;
  readonly pluginApiVersion: string;
  readonly status: EditorSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string;
  readonly dirtySummary: EditorSessionDirtySummary;
  readonly reused: boolean;
}

export interface CreateEditorSessionResult extends AuthoringListResult {
  readonly session: EditorSessionPublic;
}

export interface CloseEditorSessionResult {
  readonly ok: true;
  readonly sessionId: string;
  readonly removed: boolean;
  readonly diagnostics: readonly string[];
}

export interface EditorSessionCompatibilityResult {
  readonly ok: boolean;
  readonly requiresUpgrade: boolean;
  readonly diagnostics: readonly string[];
  readonly current: EditorPlatformReleaseDescriptor;
  readonly session: EditorPlatformReleaseDescriptor;
}

export interface EditorSessionUpgradePlan {
  readonly ok: boolean;
  readonly sessionId: string;
  readonly dryRun: true;
  readonly requiresUpgrade: boolean;
  readonly current: EditorPlatformReleaseDescriptor;
  readonly session: EditorPlatformReleaseDescriptor;
  readonly diagnostics: readonly string[];
}

export interface EditorSessionGarbageCollectResult {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly removedSessions: readonly string[];
  readonly removedMetadata: readonly string[];
  readonly removedWorktrees: readonly string[];
  readonly removedPluginBundles: readonly string[];
  readonly removedPreviewTraces: readonly string[];
  /** Auto-checkpoints (`<traceFile>#<sequence>`) trimmed by the per-session retention (ADR-057 §9.3). */
  readonly trimmedCheckpoints: readonly string[];
  /** Level-2/3 editor-cache files evicted by the size/LRU sweep (editor-preview-first-ux §10). */
  readonly removedCacheEntries: readonly string[];
  readonly skippedDirtySessions: readonly string[];
  readonly diagnostics: readonly string[];
}

const sessionSchemaVersion = 2;
const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
const defaultUserId = "local-developer";
const defaultPlatformReleaseId = "local-dev";
const supportedPlayerPluginApiVersion = "1.0";
const cleanSessionTtlMs = readPositiveIntegerEnv("CUBICA_EDITOR_CLEAN_SESSION_TTL_MS", 24 * 60 * 60 * 1000);
const dirtySessionTtlMs = readPositiveIntegerEnv("CUBICA_EDITOR_DIRTY_SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000);
const generatedArtifactTtlMs = readPositiveIntegerEnv("CUBICA_EDITOR_GENERATED_ARTIFACT_TTL_MS", 24 * 60 * 60 * 1000);
const editorCacheMaxBytes = readPositiveIntegerEnv("CUBICA_EDITOR_CACHE_MAX_BYTES", EDITOR_CACHE_DEFAULT_MAX_BYTES);
// Retention for auto-checkpoints (runtime preview snapshots) per editor session
// (ADR-057 §9.3 "последние N на сессию"). The trace files themselves live under
// `.tmp/editor-playthroughs/`; older-than-N snapshots are trimmed on each GC pass.
const playthroughCheckpointsPerSession = readPositiveIntegerEnv("CUBICA_EDITOR_PLAYTHROUGH_CHECKPOINTS_PER_SESSION", 20);

export async function createEditorSession(input: {
  readonly gameId?: string | null;
  readonly repoRoot?: string;
  readonly userId?: string | null;
  readonly forceNew?: boolean;
  readonly label?: string | null;
}): Promise<CreateEditorSessionResult> {
  const initialList = await listAuthoringFiles({ gameId: input.gameId, repoRoot: input.repoRoot });
  const projectRoot = await resolveProjectGitRoot(input.repoRoot ?? process.cwd());
  const userId = normalizeUserId(input.userId);
  const platform = currentEditorPlatformRelease();

  if (input.forceNew !== true) {
    const existing = await findReusableSession({
      gameId: initialList.gameId,
      projectRoot,
      userId,
      platform
    });

    if (existing !== undefined) {
      const touched = await touchEditorSession(existing.sessionId);
      const sessionList = await listAuthoringFiles({
        gameId: touched.gameId,
        repoRoot: touched.worktreePath
      });

      return {
        ...sessionList,
        session: toPublicSession(touched, true)
      };
    }
  }

  const gitSession = await createProjectGitSession({
    projectRoot,
    gameId: initialList.gameId
  });
  const now = new Date().toISOString();
  const session: EditorSessionDocument = {
    ...gitSession,
    schemaVersion: sessionSchemaVersion,
    userId,
    projectId: projectRoot,
    gameId: initialList.gameId,
    platformReleaseId: platform.platformReleaseId,
    pluginApiVersion: platform.pluginApiVersion,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    expiresAt: expiresAt(now, false),
    dirtySummary: cleanDirtySummary(now),
    label: normalizeOptionalLabel(input.label)
  };

  await writeSessionDocument(session);

  const sessionList = await listAuthoringFiles({
    gameId: session.gameId,
    repoRoot: session.worktreePath
  });

  return {
    ...sessionList,
    session: toPublicSession(session, false)
  };
}

export async function listEditorSessions(input: {
  readonly gameId?: string | null;
  readonly userId?: string | null;
  readonly includeExpired?: boolean;
} = {}): Promise<{ readonly sessions: readonly EditorSessionPublic[] }> {
  const userId = input.userId === undefined || input.userId === null ? undefined : normalizeUserId(input.userId);
  const documents = await readAllSessionDocuments();
  const sessions = documents
    .filter((session) => input.gameId === undefined || input.gameId === null || input.gameId === "" || session.gameId === input.gameId)
    .filter((session) => userId === undefined || session.userId === userId)
    .filter((session) => input.includeExpired === true || !isExpired(session, new Date()))
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
    .map((session) => toPublicSession(session, false));

  return { sessions };
}

export async function readEditorSession(sessionId: string): Promise<EditorSessionDocument> {
  validateSessionId(sessionId);
  const repoRoot = await resolveRepositoryRoot();
  const filePath = sessionDocumentPath(repoRoot, sessionId);
  const text = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) {
      throw new EditorRepositoryError("Editor session was not found.", 404);
    }

    throw error;
  });
  const parsed = JSON.parse(text) as Partial<EditorSessionDocument> & Record<string, unknown>;
  const { session, migrated } = normalizeSessionDocument(parsed);

  if (session.sessionId !== sessionId) {
    throw new EditorRepositoryError("Editor session metadata id does not match the requested session.", 500);
  }
  if (migrated) {
    await writeSessionDocument(session);
  }

  return session;
}

export async function touchEditorSession(sessionId: string): Promise<EditorSessionDocument> {
  const session = await readEditorSession(sessionId);
  assertSessionCanBeUsed(session);
  const now = new Date().toISOString();
  const dirtySummary = await readDirtySummary(session, now);
  const next: EditorSessionDocument = {
    ...session,
    status: dirtySummary.isDirty ? "dirty" : session.lastSavedCommit === undefined ? "active" : "saved",
    updatedAt: now,
    lastUsedAt: now,
    expiresAt: expiresAt(now, dirtySummary.isDirty),
    dirtySummary
  };

  await writeSessionDocument(next);
  return next;
}

export async function markEditorSessionSaved(input: {
  readonly sessionId: string;
  readonly commitHash?: string;
}): Promise<EditorSessionDocument> {
  const session = await readEditorSession(input.sessionId);
  assertSessionCanBeUsed(session);
  const now = new Date().toISOString();
  const next: EditorSessionDocument = {
    ...session,
    status: "saved",
    updatedAt: now,
    lastUsedAt: now,
    expiresAt: expiresAt(now, false),
    dirtySummary: cleanDirtySummary(now),
    lastSavedCommit: input.commitHash ?? session.lastSavedCommit
  };

  await writeSessionDocument(next);
  return next;
}

export async function closeEditorSession(sessionId: string): Promise<CloseEditorSessionResult> {
  validateSessionId(sessionId);
  const repoRoot = await resolveRepositoryRoot();
  const diagnostics: string[] = [];

  const session = await readEditorSession(sessionId).catch((error: unknown) => {
    if (error instanceof EditorRepositoryError && error.statusCode === 404) {
      return undefined;
    }
    throw error;
  });

  if (session === undefined) {
    diagnostics.push("Editor session metadata was already absent.");
    await removeProjectGitSession({
      projectRoot: repoRoot,
      worktreePath: path.join(repoRoot, ".tmp", "editor-worktrees", sessionId)
    });
    await rm(sessionDocumentPath(repoRoot, sessionId), { force: true });
    return { ok: true, sessionId, removed: false, diagnostics };
  }

  const closedAt = new Date().toISOString();
  await writeSessionDocument({
    ...session,
    status: "closed",
    updatedAt: closedAt,
    lastUsedAt: closedAt,
    expiresAt: closedAt
  });
  await removeProjectGitSession(session).catch(async (error: unknown) => {
    diagnostics.push(error instanceof Error ? error.message : "Failed to remove editor session worktree.");
    await rm(session.worktreePath, { recursive: true, force: true }).catch(() => undefined);
  });
  await rm(sessionDocumentPath(repoRoot, sessionId), { force: true });
  return { ok: true, sessionId, removed: true, diagnostics };
}

export async function repoRootForSession(
  sessionId: string | undefined,
  gameId: string | undefined
): Promise<{ readonly repoRoot?: string; readonly session?: EditorSessionDocument }> {
  if (sessionId === undefined || sessionId === "") {
    return {};
  }

  const session = await touchEditorSession(sessionId);
  if (gameId !== undefined && gameId !== "" && session.gameId !== gameId) {
    throw new EditorRepositoryError("Editor session does not belong to the requested game.", 409);
  }

  return {
    repoRoot: session.worktreePath,
    session
  };
}

export function toPublicSession(session: EditorSessionDocument, reused = false): EditorSessionPublic {
  return {
    sessionId: session.sessionId,
    gameId: session.gameId,
    branchName: session.branchName,
    baseCommit: session.baseCommit,
    platformReleaseId: session.platformReleaseId,
    pluginApiVersion: session.pluginApiVersion,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    dirtySummary: session.dirtySummary,
    reused
  };
}

export function currentEditorPlatformRelease(): EditorPlatformReleaseDescriptor {
  return {
    platformReleaseId: process.env.CUBICA_PLATFORM_RELEASE_ID ?? defaultPlatformReleaseId,
    pluginApiVersion: process.env.CUBICA_PLAYER_PLUGIN_API_VERSION ?? supportedPlayerPluginApiVersion
  };
}

export function evaluateEditorSessionCompatibility(session: EditorSessionDocument): EditorSessionCompatibilityResult {
  const current = currentEditorPlatformRelease();
  const sessionDescriptor = {
    platformReleaseId: session.platformReleaseId,
    pluginApiVersion: session.pluginApiVersion
  };
  const diagnostics: string[] = [];

  if (majorVersion(session.pluginApiVersion) !== majorVersion(current.pluginApiVersion)) {
    diagnostics.push(
      `Editor session uses player plugin API ${session.pluginApiVersion}, but the current platform supports ${current.pluginApiVersion}. Run session upgrade before preview.`
    );
  }

  if (session.platformReleaseId !== current.platformReleaseId) {
    diagnostics.push(
      `Editor session was created for platform release "${session.platformReleaseId}", but current release is "${current.platformReleaseId}". Run session upgrade before preview.`
    );
  }

  return {
    ok: diagnostics.length === 0,
    requiresUpgrade: diagnostics.length > 0,
    diagnostics,
    current,
    session: sessionDescriptor
  };
}

export async function planEditorSessionUpgrade(input: {
  readonly sessionId: string;
}): Promise<EditorSessionUpgradePlan> {
  const session = await readEditorSession(input.sessionId);
  const compatibility = evaluateEditorSessionCompatibility(session);
  const diagnostics = compatibility.requiresUpgrade
    ? [
        ...compatibility.diagnostics,
        "Upgrade dry-run requires compile, plugin validation and preview readiness checks before metadata can be switched."
      ]
    : ["Editor session already matches the current platform release."];

  return {
    ok: !compatibility.requiresUpgrade,
    sessionId: session.sessionId,
    dryRun: true,
    requiresUpgrade: compatibility.requiresUpgrade,
    current: compatibility.current,
    session: compatibility.session,
    diagnostics
  };
}

/**
 * Garbage collection is the controlled cleanup of expired session resources.
 *
 * Dry-run mode reports what would be removed. Apply mode removes metadata,
 * Git worktrees, stale preview traces and old generated preview plugin bundles.
 */
export async function garbageCollectEditorSessions(input: {
  readonly dryRun?: boolean;
  readonly removeDirty?: boolean;
} = {}): Promise<EditorSessionGarbageCollectResult> {
  const dryRun = input.dryRun !== false;
  const removeDirty = input.removeDirty === true;
  const now = new Date();
  const repoRoot = await resolveRepositoryRoot();
  const documents = await readAllSessionDocuments();
  const documentIds = new Set(documents.map((session) => session.sessionId));
  const removedSessions: string[] = [];
  const removedMetadata: string[] = [];
  const removedWorktrees: string[] = [];
  const skippedDirtySessions: string[] = [];
  const diagnostics: string[] = [];

  for (const session of documents) {
    const worktreeExists = await directoryExists(session.worktreePath);
    const sessionExpired = isExpired(session, now);
    const removable =
      session.status === "closed" ||
      session.status === "expired" ||
      session.status === "orphaned" ||
      sessionExpired ||
      !worktreeExists;

    if (!removable) {
      continue;
    }
    if (session.dirtySummary.isDirty && !removeDirty && worktreeExists) {
      skippedDirtySessions.push(session.sessionId);
      continue;
    }

    removedSessions.push(session.sessionId);
    if (!dryRun) {
      await removeProjectGitSession(session).catch((error: unknown) => {
        diagnostics.push(error instanceof Error ? error.message : `Failed to remove worktree for ${session.sessionId}.`);
      });
      await rm(sessionDocumentPath(repoRoot, session.sessionId), { force: true });
    }
    removedMetadata.push(session.sessionId);
    if (worktreeExists) {
      removedWorktrees.push(session.worktreePath);
    }
  }

  const projectRoots = new Set<string>([repoRoot, ...documents.map((session) => session.projectRoot)]);
  for (const projectRoot of projectRoots) {
    const worktrees = await listProjectGitWorktrees(projectRoot).catch(() => []);
    for (const worktree of worktrees) {
      if (!isEditorWorktreePath(projectRoot, worktree.worktreePath)) {
        continue;
      }
      const sessionId = path.basename(worktree.worktreePath);
      if (documentIds.has(sessionId)) {
        continue;
      }

      removedWorktrees.push(worktree.worktreePath);
      if (!dryRun) {
        await removeProjectGitSession({ projectRoot, worktreePath: worktree.worktreePath }).catch((error: unknown) => {
          diagnostics.push(error instanceof Error ? error.message : `Failed to remove orphan worktree ${worktree.worktreePath}.`);
        });
      }
    }
  }

  const removedPluginBundles = await cleanupGeneratedFiles({
    root: path.join(repoRoot, ".tmp", "editor-plugin-bundles"),
    olderThan: new Date(now.getTime() - generatedArtifactTtlMs),
    dryRun
  });
  const retainedSessionIds = new Set(documents.map((session) => session.sessionId).filter((sessionId) => !removedSessions.includes(sessionId)));
  const removedPreviewTraces = await cleanupPreviewTraces({
    root: path.join(repoRoot, ".tmp", "editor-playthroughs"),
    activeSessionIds: retainedSessionIds,
    olderThan: new Date(now.getTime() - dirtySessionTtlMs),
    dryRun
  });
  // Retention of auto-checkpoints (ADR-057 §9.3): after whole stale trace files
  // are removed above, cap the number of runtime snapshots kept per surviving
  // session to the newest N, rewriting the affected trace files. Dropping .tmp
  // snapshots is always safe — the editor can re-snapshot from a replay.
  const trimmedCheckpoints = await retainPreviewCheckpoints({
    root: path.join(repoRoot, ".tmp", "editor-playthroughs"),
    activeSessionIds: retainedSessionIds,
    keepPerSession: playthroughCheckpointsPerSession,
    dryRun
  });

  // Size/LRU sweep of the whole editor cache tree (Level-2 per-file snapshots and
  // Level-3 compile entries). Runs on the same GC cycle as session cleanup so the
  // one-shot cache cannot grow without bound (editor-preview-first-ux §10).
  const removedCacheEntries = await garbageCollectEditorCache({
    cacheRoot: path.join(repoRoot, ".tmp", "editor-cache"),
    maxBytes: editorCacheMaxBytes,
    dryRun
  });

  if (!dryRun) {
    for (const projectRoot of projectRoots) {
      await pruneProjectGitWorktrees(projectRoot).catch(() => undefined);
    }
  }

  return {
    ok: true,
    dryRun,
    removedSessions,
    removedMetadata,
    removedWorktrees: uniqueSorted(removedWorktrees),
    removedPluginBundles,
    removedPreviewTraces,
    trimmedCheckpoints,
    removedCacheEntries,
    skippedDirtySessions,
    diagnostics
  };
}

async function findReusableSession(input: {
  readonly gameId: string;
  readonly projectRoot: string;
  readonly userId: string;
  readonly platform: EditorPlatformReleaseDescriptor;
}): Promise<EditorSessionDocument | undefined> {
  const now = new Date();
  const candidates = await readAllSessionDocuments();
  const matching = [];

  for (const session of candidates) {
    if (
      session.gameId !== input.gameId ||
      session.projectRoot !== input.projectRoot ||
      session.userId !== input.userId ||
      session.platformReleaseId !== input.platform.platformReleaseId ||
      session.pluginApiVersion !== input.platform.pluginApiVersion ||
      session.status === "closed" ||
      session.status === "expired" ||
      session.status === "orphaned" ||
      isExpired(session, now)
    ) {
      continue;
    }
    if (!(await directoryExists(session.worktreePath))) {
      continue;
    }
    matching.push(session);
  }

  return matching.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))[0];
}

async function readAllSessionDocuments(): Promise<readonly EditorSessionDocument[]> {
  const repoRoot = await resolveRepositoryRoot();
  const directory = sessionsDirectory(repoRoot);
  const entries = await readdir(directory).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });
  const sessions: EditorSessionDocument[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const sessionId = entry.slice(0, -".json".length);
    if (!sessionIdPattern.test(sessionId)) {
      continue;
    }
    const session = await readEditorSession(sessionId).catch(() => undefined);
    if (session !== undefined) {
      sessions.push(session);
    }
  }

  return sessions;
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

function normalizeSessionDocument(
  parsed: Partial<EditorSessionDocument> & Record<string, unknown>
): { readonly session: EditorSessionDocument; readonly migrated: boolean } {
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
  const now = parsed.updatedAt;
  const current = currentEditorPlatformRelease();
  const dirtySummary = isDirtySummary(parsed.dirtySummary)
    ? parsed.dirtySummary
    : cleanDirtySummary(now);
  const status = isSessionStatus(parsed.status)
    ? parsed.status
    : dirtySummary.isDirty ? "dirty" : "active";
  const lastUsedAt = typeof parsed.lastUsedAt === "string" ? parsed.lastUsedAt : parsed.updatedAt;
  const expires = typeof parsed.expiresAt === "string"
    ? parsed.expiresAt
    : expiresAt(lastUsedAt, dirtySummary.isDirty);

  const session: EditorSessionDocument = {
    sessionId: parsed.sessionId,
    projectRoot: parsed.projectRoot,
    worktreePath: parsed.worktreePath,
    branchName: parsed.branchName,
    baseCommit: parsed.baseCommit,
    schemaVersion: sessionSchemaVersion,
    userId: typeof parsed.userId === "string" ? parsed.userId : defaultUserId,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : parsed.projectRoot,
    gameId: parsed.gameId,
    platformReleaseId: typeof parsed.platformReleaseId === "string" ? parsed.platformReleaseId : current.platformReleaseId,
    pluginApiVersion: typeof parsed.pluginApiVersion === "string" ? parsed.pluginApiVersion : current.pluginApiVersion,
    status,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    lastUsedAt,
    expiresAt: expires,
    dirtySummary,
    lastSavedCommit: typeof parsed.lastSavedCommit === "string" ? parsed.lastSavedCommit : undefined,
    label: typeof parsed.label === "string" ? parsed.label : undefined
  };

  return {
    session,
    migrated:
      parsed.schemaVersion !== sessionSchemaVersion ||
      parsed.userId !== session.userId ||
      parsed.projectId !== session.projectId ||
      parsed.platformReleaseId !== session.platformReleaseId ||
      parsed.pluginApiVersion !== session.pluginApiVersion ||
      parsed.status !== session.status ||
      parsed.lastUsedAt !== session.lastUsedAt ||
      parsed.expiresAt !== session.expiresAt ||
      !isDirtySummary(parsed.dirtySummary)
  };
}

async function readDirtySummary(session: EditorSessionDocument, checkedAt: string): Promise<EditorSessionDirtySummary> {
  if (!(await directoryExists(session.worktreePath))) {
    await writeSessionDocument({
      ...session,
      status: "orphaned",
      updatedAt: checkedAt,
      lastUsedAt: checkedAt,
      expiresAt: checkedAt
    });
    throw new EditorRepositoryError("Editor session worktree is missing.", 410);
  }

  const summary = await getProjectGitStatusSummary(session.worktreePath);
  return {
    isDirty: summary.isDirty,
    changedPaths: summary.changedPaths,
    checkedAt
  };
}

async function cleanupGeneratedFiles(input: {
  readonly root: string;
  readonly olderThan: Date;
  readonly dryRun: boolean;
}): Promise<readonly string[]> {
  const files = await collectFiles(input.root);
  const removed: string[] = [];

  for (const filePath of files) {
    const fileStat = await stat(filePath).catch(() => undefined);
    if (fileStat === undefined || fileStat.mtime > input.olderThan) {
      continue;
    }
    removed.push(filePath);
    if (!input.dryRun) {
      await rm(filePath, { force: true });
    }
  }

  return removed.sort();
}

async function cleanupPreviewTraces(input: {
  readonly root: string;
  readonly activeSessionIds: ReadonlySet<string>;
  readonly olderThan: Date;
  readonly dryRun: boolean;
}): Promise<readonly string[]> {
  const files = await collectFiles(input.root);
  const removed: string[] = [];

  for (const filePath of files) {
    if (!filePath.endsWith(".json")) {
      continue;
    }
    const text = await readFile(filePath, "utf8").catch(() => undefined);
    const fileStat = await stat(filePath).catch(() => undefined);
    if (text === undefined || fileStat === undefined) {
      continue;
    }
    const parsed = JSON.parse(text) as { readonly editorSessionId?: unknown };
    const editorSessionId = typeof parsed.editorSessionId === "string" ? parsed.editorSessionId : undefined;
    const staleBySession = editorSessionId !== undefined && !input.activeSessionIds.has(editorSessionId);
    const staleByAge = fileStat.mtime <= input.olderThan;
    if (!staleBySession && !staleByAge) {
      continue;
    }

    removed.push(filePath);
    if (!input.dryRun) {
      await rm(filePath, { force: true });
    }
  }

  return removed.sort();
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function assertSessionCanBeUsed(session: EditorSessionDocument): void {
  const now = new Date();
  if (session.status === "closed") {
    throw new EditorRepositoryError("Editor session is closed.", 410);
  }
  if (session.status === "orphaned") {
    throw new EditorRepositoryError("Editor session worktree is missing.", 410);
  }
  if (session.status === "expired" || isExpired(session, now)) {
    throw new EditorRepositoryError("Editor session has expired and must be upgraded or reopened.", 410);
  }
}

function isExpired(session: EditorSessionDocument, now: Date): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
}

async function directoryExists(directory: string): Promise<boolean> {
  const itemStat = await stat(directory).catch(() => undefined);
  return itemStat?.isDirectory() === true;
}

function cleanDirtySummary(checkedAt: string): EditorSessionDirtySummary {
  return {
    isDirty: false,
    changedPaths: [],
    checkedAt
  };
}

function expiresAt(anchorIso: string, dirty: boolean): string {
  const anchorMs = Date.parse(anchorIso);
  const base = Number.isFinite(anchorMs) ? anchorMs : Date.now();
  return new Date(base + (dirty ? dirtySessionTtlMs : cleanSessionTtlMs)).toISOString();
}

function sessionsDirectory(repoRoot: string): string {
  return path.join(repoRoot, ".tmp", "editor-sessions");
}

function sessionDocumentPath(repoRoot: string, sessionId: string): string {
  validateSessionId(sessionId);
  return path.join(sessionsDirectory(repoRoot), `${sessionId}.json`);
}

function normalizeUserId(userId: string | null | undefined): string {
  const normalized = userId?.trim();
  return normalized === undefined || normalized === "" ? defaultUserId : normalized;
}

function normalizeOptionalLabel(label: string | null | undefined): string | undefined {
  const normalized = label?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized.slice(0, 120);
}

function isDirtySummary(value: unknown): value is EditorSessionDirtySummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EditorSessionDirtySummary>;
  return (
    typeof candidate.isDirty === "boolean" &&
    Array.isArray(candidate.changedPaths) &&
    candidate.changedPaths.every((changedPath) => typeof changedPath === "string") &&
    typeof candidate.checkedAt === "string"
  );
}

function isSessionStatus(value: unknown): value is EditorSessionStatus {
  return (
    value === "active" ||
    value === "idle" ||
    value === "dirty" ||
    value === "saved" ||
    value === "closed" ||
    value === "expired" ||
    value === "orphaned"
  );
}

function isEditorWorktreePath(projectRoot: string, worktreePath: string): boolean {
  const expectedRoot = path.join(projectRoot, ".tmp", "editor-worktrees");
  const relative = path.relative(expectedRoot, worktreePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function majorVersion(version: string): string {
  return version.split(".", 1)[0] ?? version;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function validateSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId) || sessionId.includes("..")) {
    throw new EditorRepositoryError("Session id must be a safe editor session segment.", 400);
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}
