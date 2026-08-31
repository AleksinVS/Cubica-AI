/**
 * Project-scoped Git workspace helpers for editor sessions.
 *
 * A worktree is an isolated working directory linked to the same Git history.
 * The editor uses it to accumulate unsaved AI/user edits without mutating the
 * main project checkout until Save creates a normal Git commit.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { type EditorChangeSet } from "@cubica/editor-engine";

import { EditorRepositoryError } from "./editor-repository";
import { withEditorSessionLease } from "./editor-session-lease";
import {
  EDITOR_VERSION_CHANGE_FACTS_MAX,
  EDITOR_VERSION_CHANGE_SUMMARY_MAX_LENGTH,
  EDITOR_VERSION_COMMENT_MAX_LENGTH,
  EDITOR_VERSION_PAGE_LIMIT_MAX,
  type EditorVersionChangeFact,
  type EditorVersionChangeKind,
  type EditorVersionDetails,
  type EditorVersionKind,
  type EditorVersionPage,
  type EditorVersionSummary
} from "./editor-version-contracts";

const execFileAsync = promisify(execFile);
const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
const gameIdPattern = /^[a-z0-9][a-z0-9-]*$/u;
const defaultGitAuthorName = "Cubica Editor";
const defaultGitAuthorEmail = "editor@cubica.local";
const versionMetadataPrefix = "Cubica-Editor-Version: ";
const versionMetadataSchemaVersion = 1;

export interface ProjectGitSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseCommit: string;
  /** Durable author version visible when this isolated draft was opened. */
  readonly currentVersionId?: string;
}

export interface ProjectGitStatusSummary {
  readonly isDirty: boolean;
  readonly changedPaths: readonly string[];
}

export interface ProjectGitSessionGcResult extends ProjectGitStatusSummary {
  readonly existed: boolean;
  readonly wouldRemove: boolean;
  readonly removed: boolean;
}

type ProjectGitSessionGcCrashPoint =
  | "after-quarantine-rename"
  | "after-deleting-journal"
  | "after-content-empty"
  | "after-dirty-restore-rename"
  | "after-git-metadata-prune";

interface ProjectGitSessionGcTestHooks {
  readonly crashAt?: ProjectGitSessionGcCrashPoint;
  readonly afterFinalIdentityCheck?: (input: { readonly quarantinePath: string }) => Promise<void>;
  readonly beforeTargetOpen?: (input: { readonly targetPath: string }) => Promise<void>;
  readonly afterQuarantineRenameBeforeStatus?: (input: { readonly quarantinePath: string }) => Promise<void>;
}

interface ProjectGitSessionGcOptions {
  readonly dryRun: boolean;
  readonly removeDirty: boolean;
  /** Deterministic fault injection for focused filesystem-safety tests only. */
  readonly testHooks?: ProjectGitSessionGcTestHooks;
}

export interface ProjectGitWorktreeSummary {
  readonly worktreePath: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface CreateProjectGitSessionInput {
  readonly projectRoot: string;
  readonly gameId: string;
  readonly sessionId?: string;
  readonly baseRef?: string;
}

export interface SaveProjectGitSessionInput {
  readonly worktreePath: string;
  readonly message: string;
  readonly allowedPaths: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
  /** Required for durable project-history promotion; omitted by legacy helpers. */
  readonly projectRoot?: string;
  /** Required together with `projectRoot` for durable promotion. */
  readonly gameId?: string;
  /** The durable version observed by the session, or null before the first Save. */
  readonly expectedHead?: string | null;
  readonly authorComment?: string;
  readonly changeFacts?: readonly EditorVersionChangeFact[];
  readonly versionKind?: EditorVersionKind;
  readonly restoredFromVersionId?: string;
}

export interface ProjectGitCommitResult {
  readonly committed: boolean;
  readonly commitHash?: string;
  readonly versionId?: string;
  readonly version?: EditorVersionSummary;
  readonly changedPaths: readonly string[];
}

export interface RestoreSavedVersionInput extends SaveProjectGitSessionInput {
  readonly sourceRef: string;
}

interface StoredEditorVersionMetadata {
  readonly schemaVersion: 1;
  readonly kind: EditorVersionKind;
  readonly authorComment?: string;
  readonly changeFacts: readonly EditorVersionChangeFact[];
  readonly restoredFromVersionId?: string;
}

/** Safe expected failures returned by the public history route. */
export class EditorVersionStoreError extends EditorRepositoryError {
  constructor(
    message: string,
    statusCode: 400 | 404 | 409,
    readonly code:
      | "invalid_request"
      | "invalid_cursor"
      | "session_not_found"
      | "version_not_found"
      | "version_conflict"
      | "session_dirty"
      | "session_incompatible"
  ) {
    super(message, statusCode);
    this.name = "EditorVersionStoreError";
  }
}

export interface PluginValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly string[];
  readonly touchedPluginPaths: readonly string[];
}

export async function createProjectGitSession(input: CreateProjectGitSessionInput): Promise<ProjectGitSession> {
  validateGameId(input.gameId);
  const projectRoot = await resolveProjectGitRoot(input.projectRoot);
  const sessionId = input.sessionId ?? createSessionId(input.gameId);
  validateSessionId(sessionId);
  const branchName = `editor/session/${sessionId}`;
  // A new draft always starts from the current platform revision. Durable
  // author history contains only project content and must never freeze platform
  // files at the revision that happened to exist when the author pressed Save.
  const baseRef = input.baseRef ?? "HEAD";
  const platformCommit = (await git(projectRoot, ["rev-parse", baseRef])).trim();
  const currentVersionId = await readProjectVersionHead(projectRoot, input.gameId);
  const worktreePath = path.join(projectRoot, ".tmp", "editor-worktrees", sessionId);

  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(projectRoot, ["worktree", "add", "-b", branchName, worktreePath, platformCommit]);

  if (currentVersionId !== undefined) {
    const allowedPaths = allowedSavePathsForGame({ gameId: input.gameId });
    await restoreAllowedSnapshot({
      worktreePath,
      sourceRef: currentVersionId,
      allowedPaths
    });
    const hydratedPaths = await stagedChangedPaths(worktreePath);
    if (hydratedPaths.length > 0) {
      // This internal baseline combines today's platform with the last durable
      // author snapshot. It lives only on the disposable session branch and is
      // intentionally absent from the user-visible author-version chain.
      await git(worktreePath, ["commit", "-m", "Hydrate durable author version"], gitAuthorEnv({}));
    }
  }

  const baseCommit = (await git(worktreePath, ["rev-parse", "HEAD"])).trim();

  return {
    sessionId,
    projectRoot,
    worktreePath,
    branchName,
    baseCommit,
    currentVersionId
  };
}

/** Internal durable reference for one game in the current project repository. */
export function projectVersionRefForGame(gameId: string): string {
  validateGameId(gameId);
  return `refs/cubica/editor/author-versions/${gameId}`;
}

/** Reads the durable author head without accepting a client-provided ref. */
export async function readProjectVersionHead(projectRoot: string, gameId: string): Promise<string | undefined> {
  const resolvedProjectRoot = await resolveProjectGitRoot(projectRoot);
  const refName = projectVersionRefForGame(gameId);
  try {
    // `for-each-ref` returns an empty successful result for one absent exact
    // ref, while repository/access/process failures remain non-zero. This is
    // more portable than relying on version-specific `show-ref` exit codes.
    const result = await execFileAsync("git", ["for-each-ref", "--format=%(objectname)", "--count=1", refName], {
      cwd: resolvedProjectRoot,
      env: process.env,
      maxBuffer: 1024 * 1024
    });
    const versionId = result.stdout.trim();
    return versionId === "" ? undefined : versionId;
  } catch (error) {
    throw new EditorRepositoryError("Durable author history could not be read.", 500);
  }
}

/**
 * Checks whether a clean session already contains one durable author snapshot.
 *
 * This is used only to recover from a metadata-write failure after the durable
 * ref was successfully promoted. Comparing allowlisted paths prevents the
 * platform portion of the session commit from affecting reconciliation.
 */
export async function doesProjectGitSessionMatchVersion(input: {
  readonly projectRoot: string;
  readonly worktreePath: string;
  readonly versionId: string;
  readonly allowedPaths: readonly string[];
}): Promise<boolean> {
  await resolveProjectGitRoot(input.projectRoot);
  const worktreePath = await resolveExistingDirectory(input.worktreePath);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  validateOpaqueVersionId(input.versionId, false);
  try {
    await execFileAsync("git", [
      "diff",
      "--quiet",
      input.versionId,
      "HEAD",
      "--",
      ...allowedPaths
    ], {
      cwd: worktreePath,
      env: process.env,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch (error) {
    if (gitExitCode(error) === 1) {
      return false;
    }
    throw new EditorRepositoryError("Editor session version could not be reconciled.", 500);
  }
}

export async function removeProjectGitSession(
  session: Pick<ProjectGitSession, "projectRoot" | "worktreePath"> & { readonly branchName?: string }
): Promise<void> {
  const result = await removeProjectGitSessionForGarbageCollection(session, {
    dryRun: false,
    removeDirty: true
  });
  if (result.existed && !result.removed) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
}

/**
 * Inspects and, when policy permits, removes one editor worktree as one cleanup
 * transaction. Apply mode journals the original session identity, atomically
 * moves the validated directory to a sibling quarantine entry, then removes
 * content only through pinned directory descriptors. Git never receives the
 * mutable filesystem target; after the empty directory is gone it only prunes
 * its administrative record. The journal lets a later pass resume every phase.
 */
export async function removeProjectGitSessionForGarbageCollection(
  session: Pick<ProjectGitSession, "projectRoot" | "worktreePath"> & { readonly branchName?: string },
  options: ProjectGitSessionGcOptions
): Promise<ProjectGitSessionGcResult> {
  const projectRoot = await resolveProjectGitRoot(session.projectRoot);
  return withEditorSessionLease({
    repoRoot: projectRoot,
    sessionId: "project-git-cleanup",
    operation: "project-git-cleanup"
  }, () => removeProjectGitSessionForGarbageCollectionUnderProjectLease(session, options, projectRoot));
}

async function removeProjectGitSessionForGarbageCollectionUnderProjectLease(
  session: Pick<ProjectGitSession, "projectRoot" | "worktreePath"> & { readonly branchName?: string },
  options: ProjectGitSessionGcOptions,
  projectRoot: string
): Promise<ProjectGitSessionGcResult> {
  const originalPath = path.resolve(session.worktreePath);
  const sessionId = path.basename(originalPath);
  validateSessionId(sessionId);
  const expectedBranch = normalizeDisposableSessionBranch(session.branchName ?? `editor/session/${sessionId}`, originalPath);
  if (expectedBranch === undefined) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
  const journal = await readEditorWorktreeGcJournal(projectRoot, sessionId);
  if (journal !== undefined) {
    assertEditorWorktreeGcJournal(journal);
  }

  const quarantinePath = `${originalPath}.gc`;
  const originalExists = await pathEntryExists(originalPath);
  const quarantineExists = await pathEntryExists(quarantinePath);
  if (originalExists && quarantineExists) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }

  if (journal !== undefined && !originalExists && !quarantineExists) {
    if (journal.phase !== "deleting" || journal.status === undefined) {
      throw new EditorRepositoryError("Editor worktree cleanup journal is incomplete.", 500);
    }
    const status = journal.status;
    if (options.dryRun) {
      return { existed: true, ...status, wouldRemove: true, removed: false };
    }
    await finalizeRemovedEditorWorktree(projectRoot, expectedBranch);
    await maybeInjectGcCrash(options, "after-git-metadata-prune");
    await removeEditorWorktreeGcJournal(projectRoot, sessionId);
    return { existed: true, ...status, wouldRemove: true, removed: true };
  }

  if (!originalExists && !quarantineExists) {
    if (!options.dryRun) {
      await finalizeRemovedEditorWorktree(projectRoot, expectedBranch);
    }
    return { existed: false, isDirty: false, changedPaths: [], wouldRemove: true, removed: false };
  }

  if (journal?.phase === "deleting" && !quarantineExists) {
    throw new EditorRepositoryError("Editor worktree cleanup journal does not match its quarantine.", 500);
  }
  const opened = await openAndValidateEditorWorktree({
    projectRoot,
    originalPath,
    activePath: quarantineExists ? quarantinePath : originalPath,
    expectedBranch,
    journal,
    testHooks: options.testHooks
  });
  try {
    if (opened.binding === "deleted-empty") {
      const status = journal?.status;
      if (status === undefined) {
        throw new EditorRepositoryError("Editor worktree cleanup journal is incomplete.", 500);
      }
      if (options.dryRun) {
        return { existed: true, ...status, wouldRemove: true, removed: false };
      }
      await removeOpenedDirectoryEntry(opened);
      await finalizeRemovedEditorWorktree(projectRoot, expectedBranch);
      await maybeInjectGcCrash(options, "after-git-metadata-prune");
      await removeEditorWorktreeGcJournal(projectRoot, sessionId);
      return { existed: true, ...status, wouldRemove: true, removed: true };
    }
    if (options.dryRun) {
      const status = await getProjectGitStatusSummaryByHandle(opened.targetHandle);
      return {
        existed: true,
        ...status,
        wouldRemove: options.removeDirty || !status.isDirty,
        removed: false
      };
    }

    if (journal === undefined) {
      await writeEditorWorktreeGcJournal(projectRoot, {
        schemaVersion: 1,
        phase: "prepared",
        ...opened.identity
      }, sessionId);
    }
    if (!quarantineExists) {
      await quarantineOpenedEditorWorktree(opened, quarantinePath);
      await writeEditorWorktreeGcJournal(projectRoot, {
        schemaVersion: 1,
        phase: "quarantined",
        ...opened.identity
      }, sessionId);
      await maybeInjectGcCrash(options, "after-quarantine-rename");
      await options.testHooks?.afterQuarantineRenameBeforeStatus?.({ quarantinePath });
    }

    const status = await getProjectGitStatusSummaryByHandle(opened.targetHandle);
    if (status.isDirty && !options.removeDirty) {
      await restoreOpenedEditorWorktree(opened);
      await maybeInjectGcCrash(options, "after-dirty-restore-rename");
      await removeEditorWorktreeGcJournal(projectRoot, sessionId);
      return { existed: true, ...status, wouldRemove: false, removed: false };
    }

    await writeEditorWorktreeGcJournal(projectRoot, {
      schemaVersion: 1,
      phase: "deleting",
      ...opened.identity,
      status
    }, sessionId);
    await maybeInjectGcCrash(options, "after-deleting-journal");
    await assertOpenedWorktreeBinding(opened, projectRoot, expectedBranch);
    await options.testHooks?.afterFinalIdentityCheck?.({ quarantinePath: opened.activePath });
    await removeDirectoryContentsByHandle(opened.targetHandle);
    await maybeInjectGcCrash(options, "after-content-empty");
    await assertOpenedEditorWorktreeIdentity(opened);
    await removeOpenedDirectoryEntry(opened);
    await finalizeRemovedEditorWorktree(projectRoot, expectedBranch);
    await maybeInjectGcCrash(options, "after-git-metadata-prune");
    await removeEditorWorktreeGcJournal(projectRoot, sessionId);
    return { existed: true, ...status, wouldRemove: true, removed: true };
  } finally {
    await opened.targetHandle.close().catch(() => undefined);
    await opened.rootHandle.close().catch(() => undefined);
  }
}

export async function pruneProjectGitWorktrees(projectRoot: string): Promise<void> {
  const resolvedProjectRoot = await resolveProjectGitRoot(projectRoot);
  await withEditorSessionLease({
    repoRoot: resolvedProjectRoot,
    sessionId: "project-git-cleanup",
    operation: "project-git-prune"
  }, () => git(resolvedProjectRoot, ["worktree", "prune"]).then(() => undefined).catch(() => undefined));
}

/**
 * Returns the current Git status for an editor worktree.
 *
 * The editor session store uses this as the source of truth for whether a
 * session is dirty (contains uncommitted changes). This avoids guessing from
 * editor actions and also catches plugin/layout changes written by tooling.
 */
export async function getProjectGitStatusSummary(worktreePath: string): Promise<ProjectGitStatusSummary> {
  const resolvedWorktreePath = await resolveExistingDirectory(worktreePath);
  const output = await git(resolvedWorktreePath, ["status", "--porcelain=v1", "-z"]);
  const changedPaths = parsePorcelainStatusPaths(output);

  return {
    isDirty: changedPaths.length > 0,
    changedPaths
  };
}

/**
 * Lists Git worktrees in porcelain format for lifecycle cleanup.
 *
 * Porcelain output is a stable machine-readable format documented by Git. The
 * session GC uses it to distinguish linked editor worktrees from the main
 * checkout and from arbitrary directories under `.tmp`.
 */
export async function listProjectGitWorktrees(projectRoot: string): Promise<readonly ProjectGitWorktreeSummary[]> {
  const resolvedProjectRoot = await resolveProjectGitRoot(projectRoot);
  const output = await git(resolvedProjectRoot, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(output);
}

export async function saveProjectGitSession(input: SaveProjectGitSessionInput): Promise<ProjectGitCommitResult> {
  const worktreePath = await resolveExistingDirectory(input.worktreePath);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  if (allowedPaths.length === 0) {
    throw new EditorRepositoryError("Save commit requires at least one allowed path.", 400);
  }

  const stageablePaths: string[] = [];
  for (const allowedPath of allowedPaths) {
    const tracked = await git(worktreePath, ["ls-tree", "--name-only", "HEAD", "--", allowedPath]).catch(() => "");
    if (await pathExists(path.join(worktreePath, allowedPath)) || tracked.trim() !== "") {
      stageablePaths.push(allowedPath);
    }
  }
  if (stageablePaths.length === 0) {
    return { committed: false, changedPaths: [] };
  }

  // `git add -A` records deletions as well as writes. Passing only allowed
  // prefixes keeps the index policy-bounded even when a whole file was removed.
  await git(worktreePath, ["add", "-A", "--", ...stageablePaths]);
  const changedPaths = await stagedChangedPaths(worktreePath);
  if (changedPaths.length === 0) {
    return { committed: false, changedPaths: [] };
  }

  const allowedSet = new Set(allowedPaths);
  const disallowed = changedPaths.filter((changedPath) => !isPathAllowedByPrefixes(changedPath, allowedSet));
  if (disallowed.length > 0) {
    throw new EditorRepositoryError(`Save commit contains paths outside the allowed project policy: ${disallowed.join(", ")}`, 400);
  }

  const previousSessionHead = (await git(worktreePath, ["rev-parse", "HEAD"])).trim();
  await git(worktreePath, ["commit", "-m", input.message], gitAuthorEnv(input));
  const commitHash = (await git(worktreePath, ["rev-parse", "HEAD"])).trim();

  const durableRequested = input.projectRoot !== undefined || input.gameId !== undefined;
  if (!durableRequested) {
    return {
      committed: true,
      commitHash,
      changedPaths
    };
  }
  if (input.projectRoot === undefined || input.gameId === undefined) {
    await git(worktreePath, ["reset", "--mixed", previousSessionHead]);
    throw new EditorVersionStoreError("Durable Save requires both projectRoot and gameId.", 400, "invalid_request");
  }

  try {
    const promoted = await promoteDurableProjectVersion({
      projectRoot: input.projectRoot,
      gameId: input.gameId,
      snapshotRef: commitHash,
      expectedHead: input.expectedHead ?? null,
      allowedPaths,
      authorName: input.authorName,
      authorEmail: input.authorEmail,
      authorComment: input.authorComment,
      changeFacts: input.changeFacts,
      versionKind: input.versionKind ?? "save",
      restoredFromVersionId: input.restoredFromVersionId
    });
    return {
      committed: true,
      commitHash,
      versionId: promoted.versionId,
      version: promoted.version,
      changedPaths
    };
  } catch (error) {
    // The local commit is not a durable Save until compare-and-swap promotion
    // succeeds. On conflict, move the disposable session branch back while
    // preserving the user's files as dirty changes so no work is lost.
    await git(worktreePath, ["reset", "--mixed", previousSessionHead]).catch(() => undefined);
    throw error;
  }
}

export async function restoreSavedVersion(input: RestoreSavedVersionInput): Promise<ProjectGitCommitResult> {
  const worktreePath = await resolveExistingDirectory(input.worktreePath);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  if (allowedPaths.length === 0) {
    throw new EditorRepositoryError("Rollback commit requires at least one allowed path.", 400);
  }

  await restoreAllowedSnapshot({ worktreePath, sourceRef: input.sourceRef, allowedPaths });
  return saveProjectGitSession(input);
}

export async function listProjectVersionHistory(input: {
  readonly projectRoot: string;
  readonly gameId: string;
  readonly allowedPaths: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
}): Promise<Omit<EditorVersionPage, "dirtySummary">> {
  const projectRoot = await resolveProjectGitRoot(input.projectRoot);
  validateGameId(input.gameId);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EDITOR_VERSION_PAGE_LIMIT_MAX) {
    throw new EditorVersionStoreError(`History limit must be between 1 and ${EDITOR_VERSION_PAGE_LIMIT_MAX}.`, 400, "invalid_request");
  }

  const currentVersionId = await readProjectVersionHead(projectRoot, input.gameId);
  if (currentVersionId === undefined) {
    if (input.cursor !== undefined) {
      throw new EditorVersionStoreError("History cursor is no longer valid.", 409, "version_conflict");
    }
    return { versions: [], currentVersionId: null };
  }

  const cursor = input.cursor === undefined ? { head: currentVersionId, offset: 0 } : decodeHistoryCursor(input.cursor);
  if (cursor.head !== currentVersionId) {
    throw new EditorVersionStoreError("History changed while the next page was loading. Reload the list.", 409, "version_conflict");
  }

  const output = await git(projectRoot, [
    "rev-list",
    "--first-parent",
    `--max-count=${limit + 1}`,
    `--skip=${cursor.offset}`,
    currentVersionId
  ]);
  const ids = output.split("\n").filter((item) => item !== "");
  const pageIds = ids.slice(0, limit);
  const versions: EditorVersionSummary[] = [];
  for (const versionId of pageIds) {
    versions.push(await readVersionSummary(projectRoot, versionId, allowedPaths));
  }

  return {
    versions,
    currentVersionId,
    nextCursor: ids.length > limit
      ? encodeHistoryCursor({ head: currentVersionId, offset: cursor.offset + pageIds.length })
      : undefined
  };
}

export async function readProjectVersionDetails(input: {
  readonly projectRoot: string;
  readonly gameId: string;
  readonly versionId: string;
  readonly allowedPaths: readonly string[];
}): Promise<EditorVersionDetails> {
  const projectRoot = await resolveProjectGitRoot(input.projectRoot);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  await assertReachableProjectVersion(projectRoot, input.gameId, input.versionId);
  const summary = await readVersionSummary(projectRoot, input.versionId, allowedPaths);
  const actualChanges = await readVersionFileChanges(projectRoot, input.versionId, allowedPaths);
  const metadata = await readVersionMetadata(projectRoot, input.versionId);

  return {
    ...summary,
    changes: mergeChangeFacts(actualChanges, metadata.changeFacts)
  };
}

/**
 * Restores an allowlisted author snapshot and creates a new durable version.
 *
 * The caller must pass the version it displayed to the user. Both the dirty
 * check and compare-and-swap check are repeated here immediately before files
 * change, so a stale browser cannot silently replace newer work.
 */
export async function restoreDurableProjectVersion(input: {
  readonly projectRoot: string;
  readonly gameId: string;
  readonly worktreePath: string;
  readonly versionId: string;
  readonly expectedHead: string | null;
  readonly allowedPaths: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
}): Promise<ProjectGitCommitResult> {
  const projectRoot = await resolveProjectGitRoot(input.projectRoot);
  const worktreePath = await resolveExistingDirectory(input.worktreePath);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  const status = await getProjectGitStatusSummary(worktreePath);
  if (status.isDirty) {
    throw new EditorVersionStoreError("Save unsaved changes before restoring a version.", 409, "session_dirty");
  }

  const currentHead = await readProjectVersionHead(projectRoot, input.gameId);
  if ((currentHead ?? null) !== input.expectedHead) {
    throw new EditorVersionStoreError("Version history changed. Reload before restoring.", 409, "version_conflict");
  }
  await assertReachableProjectVersion(projectRoot, input.gameId, input.versionId);
  const previousSessionHead = (await git(worktreePath, ["rev-parse", "HEAD"])).trim();

  try {
    await restoreAllowedSnapshot({ worktreePath, sourceRef: input.versionId, allowedPaths });
    const result = await saveProjectGitSession({
      worktreePath,
      projectRoot,
      gameId: input.gameId,
      expectedHead: input.expectedHead,
      message: "Restore saved author version",
      allowedPaths,
      authorName: input.authorName,
      authorEmail: input.authorEmail,
      versionKind: "restore",
      restoredFromVersionId: input.versionId
    });
    if (!result.committed || result.versionId === undefined) {
      throw new EditorVersionStoreError("The selected version already matches the current project state.", 400, "invalid_request");
    }
    return result;
  } catch (error) {
    // Restore started from a clean worktree, so a failed CAS must leave it byte-
    // for-byte at the original session revision, not as a new dirty draft.
    await git(worktreePath, ["reset", "--hard", previousSessionHead]).catch(() => undefined);
    throw error;
  }
}

export function allowedSavePathsForGame(input: {
  readonly gameId: string;
  readonly includeGeneratedArtifacts?: boolean;
  readonly includePlugins?: boolean;
}): readonly string[] {
  validateGameId(input.gameId);
  // Assets (`games/<id>/assets`) are author-editable project files (ADR-009):
  // uploads land in the worktree and must commit on Save alongside authoring.
  const base = [`games/${input.gameId}/authoring`, `games/${input.gameId}/assets`];
  if (input.includeGeneratedArtifacts === true) {
    base.push(`games/${input.gameId}/game.manifest.json`, `games/${input.gameId}/game.manifest.source-map.json`, `games/${input.gameId}/ui`);
  }

  if (input.includePlugins === true) {
    base.push(`games/${input.gameId}/plugins`);
  }

  return base;
}

export function validatePluginChangeSetBoundary(input: {
  readonly gameId: string;
  readonly changeSet: EditorChangeSet;
}): PluginValidationResult {
  validateGameId(input.gameId);
  const diagnostics: string[] = [];
  const touchedPluginPaths: string[] = [];
  const pluginRoot = `games/${input.gameId}/plugins/`;
  const platformRoots = ["apps/", "services/", "packages/", "SDK/", "scripts/"];

  const touchedPaths = collectChangeSetFilePaths(input.changeSet).map(normalizeProjectRelativePath);
  for (const filePath of touchedPaths) {
    if (platformRoots.some((root) => filePath.startsWith(root))) {
      diagnostics.push(`ChangeSet touches platform path outside project boundary: ${filePath}`);
    }

    if (filePath.startsWith(pluginRoot)) {
      touchedPluginPaths.push(filePath);
    }
  }

  if (touchedPluginPaths.length > 0) {
    const hasPluginManifest = touchedPluginPaths.some((filePath) => filePath.endsWith("plugin.json"));
    if (!hasPluginManifest) {
      diagnostics.push("Plugin ChangeSet must include or preserve a plugin.json manifest validation target.");
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    touchedPluginPaths
  };
}

function collectChangeSetFilePaths(changeSet: EditorChangeSet): readonly string[] {
  return [
    ...changeSet.jsonPatches.map((patch) => patch.filePath),
    ...(changeSet.textPatches ?? []).map((patch) => patch.filePath),
    ...(changeSet.fileCreates ?? []).map((item) => item.filePath),
    ...(changeSet.fileDeletes ?? []).map((item) => item.filePath),
    ...(changeSet.fileRenames ?? []).flatMap((item) => [item.fromFilePath, item.toFilePath])
  ];
}

export async function resolveProjectGitRoot(projectRoot: string): Promise<string> {
  const root = await resolveExistingDirectory(projectRoot);
  const topLevel = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  return realpath(topLevel);
}

async function resolveExistingDirectory(directory: string): Promise<string> {
  const resolved = await realpath(directory);
  const directoryStat = await stat(resolved);
  if (!directoryStat.isDirectory()) {
    throw new EditorRepositoryError("Project workspace path is not a directory.", 400);
  }

  return resolved;
}

/** True when `absolutePath` exists on disk (any file type), false on ENOENT. */
async function pathExists(absolutePath: string): Promise<boolean> {
  return stat(absolutePath).then(
    () => true,
    () => false
  );
}

async function stagedChangedPaths(worktreePath: string): Promise<readonly string[]> {
  const output = await git(worktreePath, ["diff", "--cached", "--name-only", "-z"]);
  return output.split("\0").filter((item) => item !== "");
}

function parsePorcelainStatusPaths(output: string): readonly string[] {
  const entries = output.split("\0").filter((entry) => entry !== "");
  const paths: string[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) {
      continue;
    }

    const statusCode = entry.slice(0, 2);
    paths.push(normalizeProjectRelativePath(entry.slice(3)));
    if ((statusCode.includes("R") || statusCode.includes("C")) && index + 1 < entries.length) {
      index += 1;
    }
  }

  return paths.sort();
}

function parseWorktreeList(output: string): readonly ProjectGitWorktreeSummary[] {
  const records = output.split(/\n\s*\n/u).map((record) => record.trim()).filter((record) => record !== "");
  const worktrees: ProjectGitWorktreeSummary[] = [];

  for (const record of records) {
    const lines = record.split("\n");
    const firstLine = lines[0];
    if (!firstLine.startsWith("worktree ")) {
      continue;
    }

    let head: string | undefined;
    let branch: string | undefined;
    let detached = false;
    let bare = false;
    let locked = false;
    let prunable = false;

    for (const line of lines.slice(1)) {
      if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      } else if (line === "detached") {
        detached = true;
      } else if (line === "bare") {
        bare = true;
      } else if (line.startsWith("locked")) {
        locked = true;
      } else if (line.startsWith("prunable")) {
        prunable = true;
      }
    }

    worktrees.push({
      worktreePath: firstLine.slice("worktree ".length),
      head,
      branch,
      detached,
      bare,
      locked,
      prunable
    });
  }

  return worktrees;
}

async function promoteDurableProjectVersion(input: {
  readonly projectRoot: string;
  readonly gameId: string;
  readonly snapshotRef: string;
  readonly expectedHead: string | null;
  readonly allowedPaths: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly authorComment?: string;
  readonly changeFacts?: readonly EditorVersionChangeFact[];
  readonly versionKind: EditorVersionKind;
  readonly restoredFromVersionId?: string;
}): Promise<{ readonly versionId: string; readonly version: EditorVersionSummary }> {
  const projectRoot = await resolveProjectGitRoot(input.projectRoot);
  validateGameId(input.gameId);
  validateOpaqueVersionId(input.expectedHead, true);
  const currentHead = await readProjectVersionHead(projectRoot, input.gameId);
  if ((currentHead ?? null) !== input.expectedHead) {
    throw new EditorVersionStoreError("Version history changed. Reload before saving again.", 409, "version_conflict");
  }

  const tree = await buildAllowedSnapshotTree(projectRoot, input.snapshotRef, input.allowedPaths);
  const previousTree = input.expectedHead === null
    ? await buildEmptyTree(projectRoot)
    : (await git(projectRoot, ["show", "-s", "--format=%T", input.expectedHead])).trim();
  const actualChanges = await diffTrees(projectRoot, previousTree, tree, input.allowedPaths);
  if (actualChanges.length === 0) {
    throw new EditorVersionStoreError("Save does not contain authoring changes.", 400, "invalid_request");
  }

  const metadata = normalizeVersionMetadata({
    kind: input.versionKind,
    authorComment: input.authorComment,
    changeFacts: input.changeFacts,
    restoredFromVersionId: input.restoredFromVersionId,
    actualChanges,
    allowedPaths: input.allowedPaths
  });
  const subject = input.versionKind === "restore" ? "Restore author version" : "Save author version";
  const args = ["commit-tree", tree];
  if (input.expectedHead !== null) {
    args.push("-p", input.expectedHead);
  }
  args.push("-m", subject, "-m", `${versionMetadataPrefix}${encodeVersionMetadata(metadata)}`);
  const versionId = (await git(projectRoot, args, gitAuthorEnv(input))).trim();
  const refName = projectVersionRefForGame(input.gameId);

  // Build the public result before the atomic ref update. Once update-ref
  // succeeds there are no required fallible reads left, so callers cannot see
  // a failed Save for a version that was already durably committed.
  const version = await readVersionSummary(projectRoot, versionId, input.allowedPaths);
  try {
    await git(projectRoot, ["update-ref", refName, versionId, input.expectedHead ?? "0".repeat(versionId.length)]);
  } catch {
    throw new EditorVersionStoreError("Version history changed while saving. Reload before retrying.", 409, "version_conflict");
  }

  return {
    versionId,
    version
  };
}

async function buildAllowedSnapshotTree(
  projectRoot: string,
  snapshotRef: string,
  allowedPaths: readonly string[]
): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(projectRoot, ".tmp", "editor-version-index-"));
  const indexPath = path.join(temporaryDirectory, "index");
  const env = { GIT_INDEX_FILE: indexPath };

  try {
    await git(projectRoot, ["read-tree", snapshotRef], env);
    const tracked = (await git(projectRoot, ["ls-files", "-z"], env)).split("\0").filter((item) => item !== "");
    const allowedSet = new Set(allowedPaths);
    const disallowed = tracked.filter((filePath) => !isPathAllowedByPrefixes(filePath, allowedSet));
    for (const batch of chunk(disallowed, 200)) {
      await git(projectRoot, ["update-index", "--force-remove", "--", ...batch], env);
    }
    return (await git(projectRoot, ["write-tree"], env)).trim();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function buildEmptyTree(projectRoot: string): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(projectRoot, ".tmp", "editor-empty-index-"));
  const indexPath = path.join(temporaryDirectory, "index");
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    await git(projectRoot, ["read-tree", "--empty"], env);
    return (await git(projectRoot, ["write-tree"], env)).trim();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function restoreAllowedSnapshot(input: {
  readonly worktreePath: string;
  readonly sourceRef: string;
  readonly allowedPaths: readonly string[];
}): Promise<void> {
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  const sourceFiles = await listTrackedPaths(input.worktreePath, input.sourceRef, allowedPaths);
  const currentFiles = await listTrackedPaths(input.worktreePath, "HEAD", allowedPaths);
  const sourceSet = new Set(sourceFiles);
  const removedFiles = currentFiles.filter((filePath) => !sourceSet.has(filePath));

  for (const batch of chunk(removedFiles, 200)) {
    await git(input.worktreePath, ["rm", "-f", "--ignore-unmatch", "--", ...batch]);
  }
  for (const batch of chunk(sourceFiles, 200)) {
    // Checkout with a tree-ish and paths updates both the index and worktree.
    await git(input.worktreePath, ["checkout", input.sourceRef, "--", ...batch]);
  }
}

async function listTrackedPaths(
  cwd: string,
  ref: string,
  allowedPaths: readonly string[]
): Promise<readonly string[]> {
  const output = await git(cwd, ["ls-tree", "-r", "--name-only", "-z", ref, "--", ...allowedPaths]);
  return output.split("\0").filter((item) => item !== "").map(normalizeProjectRelativePath).sort();
}

async function assertReachableProjectVersion(projectRoot: string, gameId: string, versionId: string): Promise<void> {
  validateGameId(gameId);
  validateOpaqueVersionId(versionId, false);
  const currentHead = await readProjectVersionHead(projectRoot, gameId);
  if (currentHead === undefined) {
    throw new EditorVersionStoreError("Saved version was not found.", 404, "version_not_found");
  }
  const reachable = await git(projectRoot, ["merge-base", "--is-ancestor", versionId, currentHead])
    .then(() => true)
    .catch(() => false);
  if (!reachable) {
    throw new EditorVersionStoreError("Saved version was not found.", 404, "version_not_found");
  }

  // Only commits with our validated metadata are public author versions. This
  // rejects arbitrary reachable Git objects even if a caller guesses an id.
  await readVersionMetadata(projectRoot, versionId).catch(() => {
    throw new EditorVersionStoreError("Saved version was not found.", 404, "version_not_found");
  });
}

async function readVersionSummary(
  projectRoot: string,
  versionId: string,
  allowedPaths: readonly string[]
): Promise<EditorVersionSummary> {
  const output = await git(projectRoot, ["show", "-s", "--format=%H%x00%aI%x00%an%x00%B", versionId]);
  const [resolvedId = "", createdAt = "", authorName = "", ...bodyParts] = output.split("\0");
  const metadata = parseVersionMetadata(bodyParts.join("\0"));
  const actualChanges = await readVersionFileChanges(projectRoot, versionId, allowedPaths);
  const changes = mergeChangeFacts(actualChanges, metadata.changeFacts);

  return {
    versionId: resolvedId.trim(),
    kind: metadata.kind,
    createdAt: createdAt.trim(),
    authorName: authorName.trim(),
    summary: summarizeVersion(metadata.kind, changes),
    authorComment: metadata.authorComment,
    changedFileCount: new Set(actualChanges.map((change) => change.filePath)).size,
    restoredFromVersionId: metadata.restoredFromVersionId
  };
}

async function readVersionMetadata(projectRoot: string, versionId: string): Promise<StoredEditorVersionMetadata> {
  const body = await git(projectRoot, ["show", "-s", "--format=%B", versionId]);
  return parseVersionMetadata(body);
}

function parseVersionMetadata(body: string): StoredEditorVersionMetadata {
  const line = body.split("\n").find((item) => item.startsWith(versionMetadataPrefix));
  if (line === undefined) {
    throw new Error("Version metadata is absent.");
  }
  const decoded = Buffer.from(line.slice(versionMetadataPrefix.length), "base64url").toString("utf8");
  const parsed = JSON.parse(decoded) as Partial<StoredEditorVersionMetadata>;
  if (
    parsed.schemaVersion !== versionMetadataSchemaVersion ||
    (parsed.kind !== "save" && parsed.kind !== "restore") ||
    !Array.isArray(parsed.changeFacts)
  ) {
    throw new Error("Version metadata is invalid.");
  }
  return {
    schemaVersion: 1,
    kind: parsed.kind,
    authorComment: typeof parsed.authorComment === "string" ? parsed.authorComment : undefined,
    changeFacts: parsed.changeFacts.filter(isEditorVersionChangeFact),
    restoredFromVersionId: typeof parsed.restoredFromVersionId === "string" ? parsed.restoredFromVersionId : undefined
  };
}

function encodeVersionMetadata(metadata: StoredEditorVersionMetadata): string {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

function normalizeVersionMetadata(input: {
  readonly kind: EditorVersionKind;
  readonly authorComment?: string;
  readonly changeFacts?: readonly EditorVersionChangeFact[];
  readonly restoredFromVersionId?: string;
  readonly actualChanges: readonly EditorVersionChangeFact[];
  readonly allowedPaths: readonly string[];
}): StoredEditorVersionMetadata {
  const authorComment = input.authorComment?.trim();
  if (authorComment !== undefined && authorComment.length > EDITOR_VERSION_COMMENT_MAX_LENGTH) {
    throw new EditorVersionStoreError(`Author comment must not exceed ${EDITOR_VERSION_COMMENT_MAX_LENGTH} characters.`, 400, "invalid_request");
  }
  if ((input.changeFacts?.length ?? 0) > EDITOR_VERSION_CHANGE_FACTS_MAX) {
    throw new EditorVersionStoreError(`Save accepts at most ${EDITOR_VERSION_CHANGE_FACTS_MAX} change facts.`, 400, "invalid_request");
  }
  if (input.restoredFromVersionId !== undefined) {
    validateOpaqueVersionId(input.restoredFromVersionId, false);
  }

  const allowedSet = new Set(input.allowedPaths);
  const actualPaths = new Set(input.actualChanges.flatMap((change) => [change.filePath, change.previousFilePath].filter((item): item is string => item !== undefined)));
  const normalizedFacts = (input.changeFacts ?? []).map((fact) => {
    if (!isEditorVersionChangeFact(fact)) {
      throw new EditorVersionStoreError("Save contains an invalid change fact.", 400, "invalid_request");
    }
    const filePath = normalizeProjectRelativePath(fact.filePath);
    const previousFilePath = fact.previousFilePath === undefined ? undefined : normalizeProjectRelativePath(fact.previousFilePath);
    if (
      !isPathAllowedByPrefixes(filePath, allowedSet) ||
      (previousFilePath !== undefined && !isPathAllowedByPrefixes(previousFilePath, allowedSet)) ||
      (!actualPaths.has(filePath) && (previousFilePath === undefined || !actualPaths.has(previousFilePath)))
    ) {
      throw new EditorVersionStoreError("Save change facts must describe changed authoring files only.", 400, "invalid_request");
    }
    return {
      ...fact,
      filePath,
      previousFilePath,
      summary: fact.summary.trim()
    };
  });

  return {
    schemaVersion: 1,
    kind: input.kind,
    authorComment: authorComment === "" ? undefined : authorComment,
    changeFacts: normalizedFacts.length > 0 ? normalizedFacts : input.actualChanges,
    restoredFromVersionId: input.restoredFromVersionId
  };
}

async function readVersionFileChanges(
  projectRoot: string,
  versionId: string,
  allowedPaths: readonly string[]
): Promise<readonly EditorVersionChangeFact[]> {
  const parent = (await git(projectRoot, ["rev-parse", `${versionId}^`]).catch(() => "")).trim();
  const tree = (await git(projectRoot, ["show", "-s", "--format=%T", versionId])).trim();
  const previousTree = parent === ""
    ? await buildEmptyTree(projectRoot)
    : (await git(projectRoot, ["show", "-s", "--format=%T", parent])).trim();
  return diffTrees(projectRoot, previousTree, tree, allowedPaths);
}

async function diffTrees(
  projectRoot: string,
  previousTree: string,
  nextTree: string,
  allowedPaths: readonly string[]
): Promise<readonly EditorVersionChangeFact[]> {
  const output = await git(projectRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    "--no-renames",
    previousTree,
    nextTree,
    "--",
    ...allowedPaths
  ]);
  const entries = output.split("\0").filter((item) => item !== "");
  const allowedSet = new Set(allowedPaths);
  const changes: EditorVersionChangeFact[] = [];
  for (let index = 0; index + 1 < entries.length; index += 2) {
    const status = entries[index];
    const filePath = normalizeProjectRelativePath(entries[index + 1]);
    if (!isPathAllowedByPrefixes(filePath, allowedSet)) {
      throw new EditorVersionStoreError("Saved version contains a path outside the authoring policy.", 404, "version_not_found");
    }
    const kind = status.startsWith("A") ? "created" : status.startsWith("D") ? "deleted" : "updated";
    changes.push({
      kind,
      filePath,
      summary: fallbackChangeSummary(kind, filePath),
      source: "system"
    });
  }
  return changes;
}

function mergeChangeFacts(
  actualChanges: readonly EditorVersionChangeFact[],
  storedFacts: readonly EditorVersionChangeFact[]
): readonly EditorVersionChangeFact[] {
  const actualPaths = new Set(actualChanges.map((change) => change.filePath));
  const accepted = storedFacts.filter((fact) => actualPaths.has(fact.filePath) || (fact.previousFilePath !== undefined && actualPaths.has(fact.previousFilePath)));
  if (accepted.length === 0) {
    return actualChanges;
  }
  const covered = new Set(accepted.flatMap((fact) => [fact.filePath, fact.previousFilePath].filter((item): item is string => item !== undefined)));
  return [...accepted, ...actualChanges.filter((change) => !covered.has(change.filePath))];
}

function summarizeVersion(kind: EditorVersionKind, changes: readonly EditorVersionChangeFact[]): string {
  if (kind === "restore") {
    return changes.length === 1 ? "Восстановлена 1 авторская правка" : `Восстановлено авторских правок: ${changes.length}`;
  }
  if (changes.length === 1) {
    return changes[0].summary;
  }
  return `Изменено авторских файлов: ${new Set(changes.map((change) => change.filePath)).size}`;
}

function fallbackChangeSummary(kind: EditorVersionChangeKind, filePath: string): string {
  if (kind === "created") return `Создан файл ${filePath}`;
  if (kind === "deleted") return `Удалён файл ${filePath}`;
  if (kind === "renamed") return `Переименован файл ${filePath}`;
  return `Изменён файл ${filePath}`;
}

function isEditorVersionChangeFact(value: unknown): value is EditorVersionChangeFact {
  if (typeof value !== "object" || value === null) return false;
  const fact = value as Partial<EditorVersionChangeFact>;
  return (
    (fact.kind === "created" || fact.kind === "updated" || fact.kind === "deleted" || fact.kind === "renamed") &&
    typeof fact.filePath === "string" &&
    (fact.previousFilePath === undefined || typeof fact.previousFilePath === "string") &&
    typeof fact.summary === "string" &&
    fact.summary.trim() !== "" &&
    fact.summary.length <= EDITOR_VERSION_CHANGE_SUMMARY_MAX_LENGTH &&
    (fact.source === "user" || fact.source === "assistant" || fact.source === "system")
  );
}

function encodeHistoryCursor(cursor: { readonly head: string; readonly offset: number }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeHistoryCursor(cursor: string): { readonly head: string; readonly offset: number } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { readonly head?: unknown; readonly offset?: unknown };
    if (typeof parsed.head !== "string" || !/^[0-9a-f]{40,64}$/u.test(parsed.head) || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) {
      throw new Error("invalid");
    }
    return { head: parsed.head, offset: parsed.offset as number };
  } catch {
    throw new EditorVersionStoreError("History cursor is invalid.", 400, "invalid_cursor");
  }
}

function validateOpaqueVersionId(versionId: string | null, allowNull: boolean): void {
  if (versionId === null && allowNull) return;
  if (typeof versionId !== "string" || !/^[0-9a-f]{40,64}$/u.test(versionId)) {
    throw new EditorVersionStoreError("Saved version id is invalid.", 400, "invalid_request");
  }
}

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

interface OpenedEditorWorktree {
  readonly originalPath: string;
  activePath: string;
  readonly rootHandle: FileHandle;
  readonly targetHandle: FileHandle;
  readonly identity: EditorWorktreeIdentity;
  readonly binding: "valid" | "deleted-empty";
}

interface EditorWorktreeIdentity {
  readonly targetDev: string;
  readonly targetIno: string;
}

type EditorWorktreeGcPhase =
  | "prepared"
  | "quarantined"
  | "deleting";

interface EditorWorktreeGcJournal {
  readonly schemaVersion: 1;
  readonly phase: EditorWorktreeGcPhase;
  readonly targetDev: string;
  readonly targetIno: string;
  readonly status?: ProjectGitStatusSummary;
}

async function openAndValidateEditorWorktree(input: {
  readonly projectRoot: string;
  readonly originalPath: string;
  readonly activePath: string;
  readonly expectedBranch: string;
  readonly journal?: EditorWorktreeGcJournal;
  readonly testHooks?: ProjectGitSessionGcTestHooks;
}): Promise<OpenedEditorWorktree> {
  const allowedRoot = path.join(input.projectRoot, ".tmp", "editor-worktrees");
  if (
    path.dirname(input.originalPath) !== allowedRoot ||
    path.dirname(input.activePath) !== allowedRoot ||
    (input.activePath !== input.originalPath && input.activePath !== `${input.originalPath}.gc`)
  ) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
  const rootHandle = await open(allowedRoot, flags).catch(() => {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  });
  let targetHandle: FileHandle | undefined;
  try {
    const canonicalRoot = await realpath(allowedRoot);
    if (canonicalRoot !== path.resolve(allowedRoot)) {
      throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
    }
    const [rootIdentity, canonicalRootIdentity] = await Promise.all([
      rootHandle.stat(),
      lstat(canonicalRoot)
    ]);
    if (!sameFileIdentity(rootIdentity, canonicalRootIdentity) || canonicalRootIdentity.isSymbolicLink()) {
      throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
    }
    await input.testHooks?.beforeTargetOpen?.({ targetPath: input.activePath });
    const rootPath = await descriptorDirectoryPath(rootHandle);
    targetHandle = await open(path.join(rootPath, path.basename(input.activePath)), flags);
    const targetIdentity = await targetHandle.stat();
    const identity = fileIdentity(targetIdentity);
    if (
      !targetIdentity.isDirectory() ||
      (input.journal !== undefined && !sameStoredFileIdentity(input.journal, identity))
    ) {
      throw new EditorRepositoryError("Editor worktree cleanup identity does not match its journal.", 500);
    }
    const opened: OpenedEditorWorktree = {
      originalPath: input.originalPath,
      activePath: input.activePath,
      rootHandle,
      targetHandle,
      identity,
      binding: "valid"
    };
    await assertOpenedEditorWorktreeIdentity(opened);
    try {
      await assertOpenedWorktreeBinding(opened, input.projectRoot, input.expectedBranch);
    } catch (error) {
      const emptyAfterAuthorizedDeletion =
        input.journal?.phase === "deleting" &&
        (await readdir(await descriptorDirectoryPath(targetHandle))).length === 0;
      if (!emptyAfterAuthorizedDeletion) {
        throw error;
      }
      await assertRegisteredWorktreeBranch(input.projectRoot, input.originalPath, input.expectedBranch);
      return { ...opened, binding: "deleted-empty" };
    }
    return opened;
  } catch (error) {
    await targetHandle?.close().catch(() => undefined);
    await rootHandle.close().catch(() => undefined);
    throw error;
  }
}

async function quarantineOpenedEditorWorktree(opened: OpenedEditorWorktree, quarantinePath: string): Promise<void> {
  await assertOpenedEditorWorktreeIdentity(opened);
  const rootPath = await descriptorDirectoryPath(opened.rootHandle);
  await rename(
    path.join(rootPath, path.basename(opened.originalPath)),
    path.join(rootPath, path.basename(quarantinePath))
  );
  opened.activePath = quarantinePath;
  await assertOpenedEditorWorktreeIdentity(opened);
}

async function restoreOpenedEditorWorktree(opened: OpenedEditorWorktree): Promise<void> {
  await assertOpenedEditorWorktreeIdentity(opened);
  if (await pathEntryExists(opened.originalPath)) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
  const rootPath = await descriptorDirectoryPath(opened.rootHandle);
  await rename(
    path.join(rootPath, path.basename(opened.activePath)),
    path.join(rootPath, path.basename(opened.originalPath))
  );
  opened.activePath = opened.originalPath;
  await assertOpenedEditorWorktreeIdentity(opened);
}

async function removeDirectoryContentsByHandle(directoryHandle: FileHandle): Promise<void> {
  const directoryPath = await descriptorDirectoryPath(directoryHandle, true);
  // GNU rm follows only this command-line directory (the pinned descriptor).
  // Descendant symlinks are unlinked, never traversed. It reports EPERM when it
  // reaches the descriptor entry itself, so the authoritative success check is
  // that the still-open directory is empty afterwards.
  await execFileAsync("rm", ["-rf", "--one-file-system", "--", `${directoryPath}/`], {
    env: process.env,
    maxBuffer: 1024 * 1024
  }).catch(() => undefined);
  const remainingEntries = await readdir(await descriptorDirectoryPath(directoryHandle));
  if (remainingEntries.length !== 0) {
    throw new EditorRepositoryError("Descriptor-bound editor cleanup is unavailable on this host.", 500);
  }
}

async function descriptorDirectoryPath(handle: FileHandle, forChildProcess = false): Promise<string> {
  const identity = await handle.stat();
  const candidates = forChildProcess
    ? [`/proc/${process.pid}/fd/${handle.fd}`]
    : [`/proc/self/fd/${handle.fd}`, `/dev/fd/${handle.fd}`];
  for (const candidate of candidates) {
    const candidateIdentity = await stat(candidate).catch(() => undefined);
    if (candidateIdentity !== undefined && sameFileIdentity(identity, candidateIdentity)) {
      return candidate;
    }
  }
  throw new EditorRepositoryError("Descriptor-bound editor cleanup is unavailable on this host.", 500);
}

async function removeOpenedDirectoryEntry(opened: OpenedEditorWorktree): Promise<void> {
  const rootPath = await descriptorDirectoryPath(opened.rootHandle);
  const anchoredTarget = path.join(rootPath, path.basename(opened.activePath));
  const currentIdentity = await lstat(anchoredTarget);
  const targetIdentity = await opened.targetHandle.stat();
  if (!sameFileIdentity(targetIdentity, currentIdentity) || currentIdentity.isSymbolicLink()) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
  // Only the now-empty top directory is removed by name. Recursive deletion
  // above stayed bound to directory descriptors and never followed this path.
  await rmdir(anchoredTarget);
}

async function assertOpenedEditorWorktreeIdentity(opened: OpenedEditorWorktree): Promise<void> {
  const rootPath = await descriptorDirectoryPath(opened.rootHandle);
  const [targetIdentity, currentTargetIdentity] = await Promise.all([
    opened.targetHandle.stat(),
    lstat(path.join(rootPath, path.basename(opened.activePath)))
  ]).catch(() => {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  });
  if (
    !sameFileIdentity(targetIdentity, currentTargetIdentity) ||
    !currentTargetIdentity.isDirectory() ||
    currentTargetIdentity.isSymbolicLink()
  ) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
}

async function assertOpenedWorktreeBinding(
  opened: OpenedEditorWorktree,
  projectRoot: string,
  expectedBranch: string
): Promise<void> {
  if (!sameStoredFileIdentity(opened.identity, fileIdentity(await opened.targetHandle.stat()))) {
    throw new EditorRepositoryError("Editor worktree cleanup identity changed.", 500);
  }
  const descriptorPath = await descriptorDirectoryPath(opened.targetHandle, true);
  const actualBranch = (await git(descriptorPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  await assertRegisteredWorktreeBranch(projectRoot, opened.originalPath, expectedBranch);
  if (actualBranch !== expectedBranch) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
}

async function assertRegisteredWorktreeBranch(
  projectRoot: string,
  originalPath: string,
  expectedBranch: string
): Promise<void> {
  const registered = await listProjectGitWorktrees(projectRoot);
  const registeredBranch = registered
    .find((item) => path.resolve(item.worktreePath) === originalPath)
    ?.branch?.replace(/^refs\/heads\//u, "");
  if (registeredBranch !== expectedBranch) {
    throw new EditorRepositoryError("Editor worktree failed the cleanup safety policy.", 500);
  }
}

async function getProjectGitStatusSummaryByHandle(targetHandle: FileHandle): Promise<ProjectGitStatusSummary> {
  const descriptorPath = await descriptorDirectoryPath(targetHandle, true);
  const output = await git(descriptorPath, ["status", "--porcelain=v1", "-z"]);
  const changedPaths = parsePorcelainStatusPaths(output);
  return {
    isDirty: changedPaths.length > 0,
    changedPaths
  };
}

async function readEditorWorktreeGcJournal(
  projectRoot: string,
  sessionId: string
): Promise<EditorWorktreeGcJournal | undefined> {
  const journalPath = editorWorktreeGcJournalPath(projectRoot, sessionId);
  const text = await readFile(journalPath, "utf8").catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as EditorWorktreeGcJournal;
  } catch {
    throw new EditorRepositoryError("Editor worktree cleanup journal is invalid.", 500);
  }
}

async function writeEditorWorktreeGcJournal(
  projectRoot: string,
  journal: EditorWorktreeGcJournal,
  sessionId: string
): Promise<void> {
  const directory = path.join(projectRoot, ".tmp", "editor-worktree-gc");
  await mkdir(directory, { recursive: true });
  const journalPath = editorWorktreeGcJournalPath(projectRoot, sessionId);
  const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, journalPath);
}

async function removeEditorWorktreeGcJournal(projectRoot: string, sessionId: string): Promise<void> {
  await rm(editorWorktreeGcJournalPath(projectRoot, sessionId), { force: true });
}

function editorWorktreeGcJournalPath(projectRoot: string, sessionId: string): string {
  validateSessionId(sessionId);
  return path.join(projectRoot, ".tmp", "editor-worktree-gc", `${sessionId}.json`);
}

function assertEditorWorktreeGcJournal(journal: EditorWorktreeGcJournal): void {
  const validPhase =
    journal.phase === "prepared" ||
    journal.phase === "quarantined" ||
    journal.phase === "deleting";
  const validStatus = journal.status === undefined || (
    typeof journal.status.isDirty === "boolean" &&
    Array.isArray(journal.status.changedPaths) &&
    journal.status.changedPaths.every((item) => typeof item === "string")
  );
  if (
    journal.schemaVersion !== 1 ||
    !validPhase ||
    typeof journal.targetDev !== "string" ||
    journal.targetDev === "" ||
    typeof journal.targetIno !== "string" ||
    journal.targetIno === "" ||
    !validStatus ||
    (journal.phase === "deleting" && journal.status === undefined)
  ) {
    throw new EditorRepositoryError("Editor worktree cleanup journal is invalid.", 500);
  }
}

function sameFileIdentity(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint }
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileIdentity(value: { readonly dev: number | bigint; readonly ino: number | bigint }): EditorWorktreeIdentity {
  return { targetDev: String(value.dev), targetIno: String(value.ino) };
}

function sameStoredFileIdentity(left: EditorWorktreeIdentity, right: EditorWorktreeIdentity): boolean {
  return left.targetDev === right.targetDev && left.targetIno === right.targetIno;
}

async function pathEntryExists(filePath: string): Promise<boolean> {
  return lstat(filePath).then(
    () => true,
    (error: unknown) => isMissingPathError(error) ? false : Promise.reject(error)
  );
}

async function deleteDisposableSessionBranch(projectRoot: string, branchName: string): Promise<void> {
  // Worktree branches are drafts, not history. Deleting only the exact,
  // validated `editor/session/<sessionId>` ref preserves durable author history.
  const registered = await listProjectGitWorktrees(projectRoot);
  if (registered.some((item) => item.branch === `refs/heads/${branchName}`)) {
    throw new EditorRepositoryError("Editor worktree Git metadata is still registered.", 500);
  }
  await git(projectRoot, ["update-ref", "-d", `refs/heads/${branchName}`]);
}

async function finalizeRemovedEditorWorktree(projectRoot: string, branchName: string): Promise<void> {
  await pruneProjectGitWorktrees(projectRoot);
  await deleteDisposableSessionBranch(projectRoot, branchName);
}

async function maybeInjectGcCrash(
  options: ProjectGitSessionGcOptions,
  point: ProjectGitSessionGcCrashPoint
): Promise<void> {
  if (options.testHooks?.crashAt === point) {
    throw new EditorRepositoryError(`Injected editor worktree GC crash at ${point}.`, 500);
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

async function git(cwd: string, args: readonly string[], env: Record<string, string | undefined> = {}): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      maxBuffer: 10 * 1024 * 1024
    });
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git command failed.";
    throw new EditorRepositoryError(message, 500);
  }
}

function gitExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function gitAuthorEnv(input: Pick<SaveProjectGitSessionInput, "authorName" | "authorEmail">): Record<string, string> {
  const name = input.authorName ?? defaultGitAuthorName;
  const email = input.authorEmail ?? defaultGitAuthorEmail;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email
  };
}

function normalizeProjectRelativePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new EditorRepositoryError("Project path contains an invalid character.", 400);
  }

  const normalized = filePath.replaceAll("\\", "/").replace(/^\/+/u, "");
  if (
    normalized === "" ||
    path.isAbsolute(filePath) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new EditorRepositoryError("Project paths must be safe relative paths.", 400);
  }

  return normalized;
}

function isPathAllowedByPrefixes(filePath: string, allowedPaths: ReadonlySet<string>): boolean {
  for (const allowedPath of allowedPaths) {
    if (filePath === allowedPath || filePath.startsWith(`${allowedPath}/`)) {
      return true;
    }
  }

  return false;
}

function createSessionId(gameId: string): string {
  return `${gameId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId) || sessionId.includes("..")) {
    throw new EditorRepositoryError("Session id must be a safe branch/worktree segment.", 400);
  }
}

function normalizeDisposableSessionBranch(branchName: string, worktreePath: string): string | undefined {
  const sessionId = path.basename(worktreePath);
  if (!sessionIdPattern.test(sessionId) || sessionId.includes("..")) {
    return undefined;
  }
  const expected = `editor/session/${sessionId}`;
  return branchName === expected ? expected : undefined;
}

function validateGameId(gameId: string): void {
  if (!gameIdPattern.test(gameId)) {
    throw new EditorRepositoryError("Game id must be a safe repository segment.", 400);
  }
}
