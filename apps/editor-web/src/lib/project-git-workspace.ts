/**
 * Project-scoped Git workspace helpers for editor sessions.
 *
 * A worktree is an isolated working directory linked to the same Git history.
 * The editor uses it to accumulate unsaved AI/user edits without mutating the
 * main project checkout until Save creates a normal Git commit.
 */
import { execFile } from "node:child_process";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { type EditorChangeSet } from "@cubica/editor-engine";

import { EditorRepositoryError } from "./editor-repository";

const execFileAsync = promisify(execFile);
const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
const gameIdPattern = /^[a-z0-9][a-z0-9-]*$/u;
const defaultGitAuthorName = "Cubica Editor";
const defaultGitAuthorEmail = "editor@cubica.local";

export interface ProjectGitSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseCommit: string;
}

export interface ProjectGitStatusSummary {
  readonly isDirty: boolean;
  readonly changedPaths: readonly string[];
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
}

export interface ProjectGitCommitResult {
  readonly committed: boolean;
  readonly commitHash?: string;
  readonly changedPaths: readonly string[];
}

export interface RestoreSavedVersionInput extends SaveProjectGitSessionInput {
  readonly sourceRef: string;
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
  const baseRef = input.baseRef ?? "HEAD";
  const baseCommit = (await git(projectRoot, ["rev-parse", baseRef])).trim();
  const worktreePath = path.join(projectRoot, ".tmp", "editor-worktrees", sessionId);

  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(projectRoot, ["worktree", "add", "-b", branchName, worktreePath, baseCommit]);

  return {
    sessionId,
    projectRoot,
    worktreePath,
    branchName,
    baseCommit
  };
}

export async function removeProjectGitSession(session: Pick<ProjectGitSession, "projectRoot" | "worktreePath">): Promise<void> {
  const projectRoot = await resolveProjectGitRoot(session.projectRoot);
  await git(projectRoot, ["worktree", "remove", "--force", session.worktreePath]).catch(async () => {
    await rm(session.worktreePath, { recursive: true, force: true });
  });
  await pruneProjectGitWorktrees(projectRoot);
}

export async function pruneProjectGitWorktrees(projectRoot: string): Promise<void> {
  const resolvedProjectRoot = await resolveProjectGitRoot(projectRoot);
  await git(resolvedProjectRoot, ["worktree", "prune"]).catch(() => undefined);
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

  await git(worktreePath, ["add", "--", ...allowedPaths]);
  const changedPaths = await stagedChangedPaths(worktreePath);
  if (changedPaths.length === 0) {
    return { committed: false, changedPaths: [] };
  }

  const allowedSet = new Set(allowedPaths);
  const disallowed = changedPaths.filter((changedPath) => !isPathAllowedByPrefixes(changedPath, allowedSet));
  if (disallowed.length > 0) {
    throw new EditorRepositoryError(`Save commit contains paths outside the allowed project policy: ${disallowed.join(", ")}`, 400);
  }

  await git(worktreePath, ["commit", "-m", input.message], gitAuthorEnv(input));
  const commitHash = (await git(worktreePath, ["rev-parse", "HEAD"])).trim();
  return {
    committed: true,
    commitHash,
    changedPaths
  };
}

export async function restoreSavedVersion(input: RestoreSavedVersionInput): Promise<ProjectGitCommitResult> {
  const worktreePath = await resolveExistingDirectory(input.worktreePath);
  const allowedPaths = input.allowedPaths.map(normalizeProjectRelativePath);
  if (allowedPaths.length === 0) {
    throw new EditorRepositoryError("Rollback commit requires at least one allowed path.", 400);
  }

  await git(worktreePath, ["restore", "--source", input.sourceRef, "--", ...allowedPaths]);
  return saveProjectGitSession(input);
}

export function allowedSavePathsForGame(input: {
  readonly gameId: string;
  readonly includeGeneratedArtifacts?: boolean;
  readonly includePlugins?: boolean;
}): readonly string[] {
  validateGameId(input.gameId);
  const base = [`games/${input.gameId}/authoring`];
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

function validateGameId(gameId: string): void {
  if (!gameIdPattern.test(gameId)) {
    throw new EditorRepositoryError("Game id must be a safe repository segment.", 400);
  }
}
