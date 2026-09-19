/** Filesystem isolation for one unpublished editor mutation preview. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { EditorRepositoryError } from "./editor-repository";
import type { PlayerWebPluginBundleForRuntime } from "./project-plugin-validation";

const maxCandidateGameBytes = 128 * 1024 * 1024;
const maxCandidatePluginBytes = 16 * 1024 * 1024;
const rootNamePattern = /^[a-f0-9-]{36}$/u;

interface CurrentPreviewState {
  readonly current?: string;
  readonly pending?: {
    readonly root: string;
    readonly pluginBundles: readonly PlayerWebPluginBundleForRuntime[];
  };
}

export interface EditorCurrentPreviewRoot {
  readonly repoRoot: string;
  readonly discard: () => Promise<void>;
  readonly stage: (pluginBundles: readonly PlayerWebPluginBundleForRuntime[]) => Promise<void>;
  readonly commit: () => Promise<void>;
}

/**
 * A stable runtime source ID points to one complete root at a time. `pending`
 * survives an ambiguous reload failure so the old and new roots remain intact
 * until the next request can retry registration under the session lease.
 */
export async function recoverPendingEditorCurrentPreview(input: {
  readonly repoRoot: string;
  readonly sessionId: string;
}): Promise<({
  readonly repoRoot: string;
  readonly pluginBundles: readonly PlayerWebPluginBundleForRuntime[];
  readonly commit: () => Promise<void>;
}) | undefined> {
  const parent = currentPreviewParent(input.repoRoot, input.sessionId);
  const state = await readCurrentPreviewState(parent);
  const pending = state.pending;
  if (pending === undefined) return undefined;
  const pendingRoot = path.join(parent, pending.root);
  await requireCurrentRoot(pendingRoot);
  return {
    repoRoot: pendingRoot,
    pluginBundles: pending.pluginBundles,
    commit: () => commitCurrentPreview(parent, pending.root)
  };
}

/** Copies one selected game without changing the root currently registered by runtime-api. */
export async function createEditorCurrentPreview(input: {
  readonly repoRoot: string;
  readonly sessionId: string;
  readonly gameId: string;
}): Promise<EditorCurrentPreviewRoot> {
  validateCandidateGameId(input.gameId);
  const parent = currentPreviewParent(input.repoRoot, input.sessionId);
  await mkdir(parent, { recursive: true });
  const state = await readCurrentPreviewState(parent);
  if (state.pending !== undefined) {
    throw new EditorRepositoryError("A current preview registration is still pending recovery.", 503);
  }
  if (state.current !== undefined) await requireCurrentRoot(path.join(parent, state.current));
  await removeOtherRoots(parent, state.current);
  const generation = randomUUID();
  const root = path.join(parent, generation);
  try {
    await copySelectedGame(input.repoRoot, input.gameId, root);
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  let staged = false;
  return {
    repoRoot: root,
    discard: async () => {
      if (!staged) await rm(root, { recursive: true, force: true });
    },
    stage: async (pluginBundles) => {
      // Preserve the root even if the durable state write reports an
      // ambiguous failure after its rename; recovery will inspect state.json.
      staged = true;
      await writeCurrentPreviewState(parent, {
        current: state.current,
        pending: { root: generation, pluginBundles }
      });
    },
    commit: () => commitCurrentPreview(parent, generation)
  };
}

export interface EditorMutationCandidate {
  readonly repoRoot: string;
  readonly contentSourceId: string;
  readonly discard: () => Promise<void>;
  readonly retirePrevious: () => Promise<void>;
}

/** A fresh root keeps candidate generated files away from the currently playing build. */
export async function createEditorMutationCandidate(input: {
  readonly repoRoot: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly preserveRoot?: string;
}): Promise<EditorMutationCandidate> {
  validateCandidateGameId(input.gameId);

  const sessionHash = createHash("sha256").update(input.sessionId).digest("hex").slice(0, 32);
  const parent = path.join(input.repoRoot, ".tmp", "editor-mutation-previews", sessionHash);
  const generation = randomUUID();
  const root = path.join(parent, generation);
  try {
    await mkdir(parent, { recursive: true });
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && path.join(parent, entry.name) !== input.preserveRoot) {
        await rm(path.join(parent, entry.name), { recursive: true, force: true });
      }
    }
    await copySelectedGame(input.repoRoot, input.gameId, root);
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof EditorRepositoryError) throw error;
    throw new EditorRepositoryError(error instanceof Error ? `Mutation preview isolation failed: ${error.message}` : "Mutation preview isolation failed.", 500);
  }

  return {
    repoRoot: root,
    contentSourceId: `candidate-${sessionHash}-${generation}`,
    discard: () => rm(root, { recursive: true, force: true }),
    retirePrevious: async () => {
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== path.basename(root)) {
          await rm(path.join(parent, entry.name), { recursive: true, force: true });
        }
      }
    }
  };
}

function currentPreviewParent(repoRoot: string, sessionId: string): string {
  const sessionHash = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return path.join(repoRoot, ".tmp", "editor-current-previews", sessionHash);
}

function validateCandidateGameId(gameId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(gameId)) {
    throw new EditorRepositoryError("Invalid gameId for isolated editor preview.", 400);
  }
}

async function copySelectedGame(repoRoot: string, gameId: string, root: string): Promise<void> {
  const gameRoot = path.join(repoRoot, "games", gameId);
  const sourceBytes = await measuredRegularTreeBytes(gameRoot);
  if (sourceBytes > maxCandidateGameBytes) {
    throw new EditorRepositoryError("Preview game exceeds the 128 MiB isolation limit.", 413);
  }
  await cp(gameRoot, path.join(root, "games", gameId), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE
  });
}

async function readCurrentPreviewState(parent: string): Promise<CurrentPreviewState> {
  let text: string;
  try {
    text = await readFile(path.join(parent, "state.json"), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return {};
    throw error;
  }
  try {
    const value = JSON.parse(text) as CurrentPreviewState;
    if (value === null || typeof value !== "object" ||
      (value.current !== undefined && (typeof value.current !== "string" || !rootNamePattern.test(value.current))) ||
      (value.pending !== undefined && (
        value.pending === null || typeof value.pending !== "object" ||
        typeof value.pending.root !== "string" || !rootNamePattern.test(value.pending.root) ||
        !Array.isArray(value.pending.pluginBundles)
      ))) throw new Error("invalid state");
    return value;
  } catch {
    throw new EditorRepositoryError("Current preview root state needs recovery before replacement.", 503);
  }
}

async function writeCurrentPreviewState(parent: string, state: CurrentPreviewState): Promise<void> {
  await mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `state.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(JSON.stringify(state), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path.join(parent, "state.json"));
    const directory = await open(parent, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function commitCurrentPreview(parent: string, rootName: string): Promise<void> {
  const state = await readCurrentPreviewState(parent);
  if (state.pending?.root !== rootName) {
    throw new EditorRepositoryError("Current preview registration changed before commit.", 409);
  }
  await writeCurrentPreviewState(parent, { current: rootName });
  await removeOtherRoots(parent, rootName);
}

async function removeOtherRoots(parent: string, preservedRootName: string | undefined): Promise<void> {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== preservedRootName) {
      await rm(path.join(parent, entry.name), { recursive: true, force: true });
    }
  }
}

async function requireCurrentRoot(root: string): Promise<void> {
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new EditorRepositoryError("Registered editor preview root is missing; recovery is required.", 503);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function measuredRegularTreeBytes(root: string): Promise<number> {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const details = await lstat(current);
    if (details.isSymbolicLink() || (!details.isDirectory() && !details.isFile())) {
      throw new EditorRepositoryError("Mutation preview game contains unsupported filesystem entries.", 400);
    }
    if (details.isDirectory()) {
      for (const name of await readdir(current)) pending.push(path.join(current, name));
    } else {
      total += details.size;
      if (total > maxCandidateGameBytes) return total;
    }
  }
  return total;
}

/** Copies validated plugin bundle bytes into the isolated root used by runtime-api. */
export async function copyCandidatePluginBundles(input: {
  readonly sourceRoot: string;
  readonly candidateRoot: string;
  readonly relativeFilePaths: readonly string[];
}): Promise<void> {
  let copiedBytes = 0;
  for (const relativeFilePath of input.relativeFilePaths) {
    if (path.isAbsolute(relativeFilePath) || relativeFilePath.split(/[\\/]/u).some((segment) => segment === "..")) {
      throw new EditorRepositoryError("Plugin bundle path escapes the preview worktree.", 400);
    }
    const source = path.join(input.sourceRoot, relativeFilePath);
    const target = path.join(input.candidateRoot, relativeFilePath);
    const sourceDetails = await lstat(source);
    if (!sourceDetails.isFile() || copiedBytes + sourceDetails.size > maxCandidatePluginBytes) {
      throw new EditorRepositoryError("Mutation preview plugin bundle limit exceeded or bundle is not a regular file.", 413);
    }
    copiedBytes += sourceDetails.size;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
