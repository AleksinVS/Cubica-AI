import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EditorChangeSet } from "@cubica/editor-engine";

import {
  allowedSavePathsForGame,
  createProjectGitSession,
  getProjectGitStatusSummary,
  listProjectGitWorktrees,
  pruneProjectGitWorktrees,
  removeProjectGitSession,
  removeProjectGitSessionForGarbageCollection,
  restoreSavedVersion,
  saveProjectGitSession,
  validatePluginChangeSetBoundary
} from "./project-git-workspace";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), ".tmp", "project-git-workspace-tests");
const protectedRoot = path.resolve(process.cwd(), ".tmp", "project-git-workspace-protected");

describe("project Git workspace", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(protectedRoot, { recursive: true, force: true });
    await mkdir(path.join(repoRoot, "games", "simple-choice", "authoring"), { recursive: true });
    await writeFile(path.join(repoRoot, "games", "simple-choice", "authoring", "game.authoring.json"), "{\"title\":\"Old\"}\n", "utf8");
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.name", "Test"]);
    await git(repoRoot, ["config", "user.email", "test@example.local"]);
    await git(repoRoot, ["add", "games/simple-choice/authoring/game.authoring.json"]);
    await git(repoRoot, ["commit", "-m", "Initial project"]);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(protectedRoot, { recursive: true, force: true });
  });

  it("creates a session worktree and saves allowed project changes as a commit", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-test"
    });

    await writeFile(
      path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json"),
      "{\"title\":\"New\"}\n",
      "utf8"
    );

    const result = await saveProjectGitSession({
      worktreePath: session.worktreePath,
      message: "Save editor session",
      allowedPaths: allowedSavePathsForGame({ gameId: "simple-choice" })
    });

    expect(result.committed).toBe(true);
    expect(result.changedPaths).toEqual(["games/simple-choice/authoring/game.authoring.json"]);
    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/u);

    const worktrees = await listProjectGitWorktrees(repoRoot);
    expect(worktrees.some((worktree) => worktree.worktreePath === session.worktreePath)).toBe(true);

    await removeProjectGitSession(session);
  });

  it("reports dirty paths for an editor worktree", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-status"
    });

    await writeFile(
      path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json"),
      "{\"title\":\"Dirty\"}\n",
      "utf8"
    );

    const status = await getProjectGitStatusSummary(session.worktreePath);
    expect(status.isDirty).toBe(true);
    expect(status.changedPaths).toEqual(["games/simple-choice/authoring/game.authoring.json"]);

    await removeProjectGitSession(session);
  });

  it("rolls back a saved version through a new restore commit", async () => {
    const initialCommit = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-rollback"
    });
    const filePath = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");

    await writeFile(filePath, "{\"title\":\"Saved\"}\n", "utf8");
    const saved = await saveProjectGitSession({
      worktreePath: session.worktreePath,
      message: "Save changed title",
      allowedPaths: allowedSavePathsForGame({ gameId: "simple-choice" })
    });
    expect(saved.committed).toBe(true);

    const restored = await restoreSavedVersion({
      worktreePath: session.worktreePath,
      sourceRef: initialCommit,
      message: "Restore previous title",
      allowedPaths: allowedSavePathsForGame({ gameId: "simple-choice" })
    });

    expect(restored.committed).toBe(true);
    expect(restored.commitHash).not.toBe(saved.commitHash);
    expect(await readFile(filePath, "utf8")).toBe("{\"title\":\"Old\"}\n");

    await removeProjectGitSession(session);
  });

  it("validates plugin ChangeSet boundaries before project save", () => {
    const pluginChangeSet: EditorChangeSet = {
      id: "plugin-change",
      summary: "Edit plugin",
      jsonPatches: [{ filePath: "games/simple-choice/plugins/demo/plugin.json", operations: [] }],
      textPatches: [{ filePath: "games/simple-choice/plugins/demo/src/index.ts", description: "edit" }],
      fileCreates: [],
      fileDeletes: [],
      fileRenames: []
    };
    const platformChangeSet: EditorChangeSet = {
      id: "platform-change",
      summary: "Bad edit",
      jsonPatches: [],
      textPatches: [{ filePath: "services/runtime-api/src/game-specific.ts", description: "bad" }]
    };

    expect(validatePluginChangeSetBoundary({ gameId: "simple-choice", changeSet: pluginChangeSet })).toMatchObject({
      ok: true,
      touchedPluginPaths: [
        "games/simple-choice/plugins/demo/plugin.json",
        "games/simple-choice/plugins/demo/src/index.ts"
      ]
    });
    expect(validatePluginChangeSetBoundary({ gameId: "simple-choice", changeSet: platformChangeSet }).ok).toBe(false);
  });

  it("refuses recursive cleanup outside the registered editor-worktree root", async () => {
    const protectedDirectory = path.join(repoRoot, "protected-content");
    const protectedFile = path.join(protectedDirectory, "keep.txt");
    await mkdir(protectedDirectory, { recursive: true });
    await writeFile(protectedFile, "must survive\n", "utf8");

    await expect(removeProjectGitSession({
      projectRoot: repoRoot,
      worktreePath: protectedDirectory,
      branchName: "editor/session/protected-content"
    })).rejects.toMatchObject({ statusCode: 500 });
    expect(await readFile(protectedFile, "utf8")).toBe("must survive\n");
  });

  it("rejects cleanup when the project .tmp ancestor is an external symlink", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-tmp-symlink"
    });
    const externalTmp = path.join(protectedRoot, "external-tmp");
    await mkdir(protectedRoot, { recursive: true });
    await rename(path.join(repoRoot, ".tmp"), externalTmp);
    await symlink(externalTmp, path.join(repoRoot, ".tmp"), "dir");
    const externalSessionFile = path.join(
      externalTmp,
      "editor-worktrees",
      session.sessionId,
      "games",
      "simple-choice",
      "authoring",
      "game.authoring.json"
    );

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true
    })).rejects.toMatchObject({ statusCode: 500 });
    expect(await readFile(externalSessionFile, "utf8")).toBe("{\"title\":\"Old\"}\n");
  });

  it("keeps external content when the target is swapped after final identity validation", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-final-swap"
    });
    const protectedFile = path.join(protectedRoot, "keep.txt");
    await mkdir(protectedRoot, { recursive: true });
    await writeFile(protectedFile, "must survive\n", "utf8");

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: {
        afterFinalIdentityCheck: async ({ quarantinePath }) => {
          await rename(quarantinePath, `${quarantinePath}.displaced`);
          await symlink(protectedRoot, quarantinePath, "dir");
        }
      }
    })).rejects.toMatchObject({ statusCode: 500 });

    expect(await readFile(protectedFile, "utf8")).toBe("must survive\n");
  });

  it("opens and validates one inode when the registered path is replaced before open", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-open-swap"
    });
    const displaced = `${session.worktreePath}.displaced`;
    const replacementFile = path.join(session.worktreePath, "keep.txt");

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: {
        beforeTargetOpen: async ({ targetPath }) => {
          await rename(targetPath, displaced);
          await mkdir(targetPath);
          await writeFile(replacementFile, "replacement survives\n", "utf8");
        }
      }
    })).rejects.toMatchObject({ statusCode: 500 });

    expect(await readFile(replacementFile, "utf8")).toBe("replacement survives\n");
    expect(await readFile(
      path.join(displaced, "games", "simple-choice", "authoring", "game.authoring.json"),
      "utf8"
    )).toBe("{\"title\":\"Old\"}\n");
  });

  it("checks dirty status through the pinned inode when its quarantine path is swapped", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-pre-status-swap"
    });
    const dirtyFile = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");
    await writeFile(dirtyFile, "{\"title\":\"dirty original\"}\n", "utf8");
    const protectedFile = path.join(protectedRoot, "keep.txt");
    await mkdir(protectedRoot, { recursive: true });
    await writeFile(protectedFile, "external survives\n", "utf8");
    let displaced = "";

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: false,
      testHooks: {
        afterQuarantineRenameBeforeStatus: async ({ quarantinePath }) => {
          displaced = `${quarantinePath}.dirty-original`;
          await rename(quarantinePath, displaced);
          await symlink(protectedRoot, quarantinePath, "dir");
        }
      }
    })).rejects.toMatchObject({ statusCode: 500 });

    expect(await readFile(protectedFile, "utf8")).toBe("external survives\n");
    expect(await readFile(
      path.join(displaced, "games", "simple-choice", "authoring", "game.authoring.json"),
      "utf8"
    )).toContain("dirty original");
  });

  it("resumes cleanup after a crash immediately following quarantine rename", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-crash-quarantine"
    });

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: { crashAt: "after-quarantine-rename" }
    })).rejects.toMatchObject({ statusCode: 500 });
    const interruptedWorktree = (await listProjectGitWorktrees(repoRoot))
      .find((item) => item.branch === `refs/heads/${session.branchName}`);
    expect(interruptedWorktree?.worktreePath).toBe(session.worktreePath);

    const resumed = await removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true
    });
    expect(resumed.removed).toBe(true);
    await expect(readFile(
      path.join(repoRoot, ".tmp", "editor-worktree-gc", `${session.sessionId}.json`),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("recovers a dirty worktree after a crash following restore rename", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-crash-restore"
    });
    const dirtyFile = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");
    await writeFile(dirtyFile, "{\"title\":\"still dirty\"}\n", "utf8");

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: false,
      testHooks: { crashAt: "after-dirty-restore-rename" }
    })).rejects.toMatchObject({ statusCode: 500 });
    expect(await readFile(dirtyFile, "utf8")).toContain("still dirty");

    const resumed = await removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: false
    });
    expect(resumed.removed).toBe(false);
    expect(resumed.isDirty).toBe(true);
    expect(await readFile(dirtyFile, "utf8")).toContain("still dirty");
    await removeProjectGitSession(session);
  }, 15_000);

  it("finalizes the journal after a crash following Git metadata prune", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-crash-prune"
    });

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: { crashAt: "after-git-metadata-prune" }
    })).rejects.toMatchObject({ statusCode: 500 });

    const resumed = await removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true
    });
    expect(resumed).toMatchObject({ existed: true, removed: true, wouldRemove: true });
    await expect(git(repoRoot, ["rev-parse", "--verify", `refs/heads/${session.branchName}`])).rejects.toBeDefined();
  }, 15_000);

  it("recovers after procfd content deletion before the empty directory is removed", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-crash-empty"
    });
    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: { crashAt: "after-content-empty" }
    })).rejects.toMatchObject({ statusCode: 500 });
    expect(await readdir(`${session.worktreePath}.gc`)).toEqual([]);

    const resumed = await removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true
    });
    expect(resumed).toMatchObject({ existed: true, removed: true, wouldRemove: true });
    await expect(git(repoRoot, ["rev-parse", "--verify", `refs/heads/${session.branchName}`])).rejects.toBeDefined();
  }, 15_000);

  it("rejects a replacement quarantine whose inode differs from the deleting journal", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-journal-inode"
    });
    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true,
      testHooks: { crashAt: "after-deleting-journal" }
    })).rejects.toMatchObject({ statusCode: 500 });

    const quarantinePath = `${session.worktreePath}.gc`;
    const displaced = `${quarantinePath}.displaced`;
    const replacementFile = path.join(quarantinePath, "keep.txt");
    await rename(quarantinePath, displaced);
    await mkdir(quarantinePath);
    await writeFile(replacementFile, "replacement survives\n", "utf8");

    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: true
    })).rejects.toMatchObject({ statusCode: 500 });
    expect(await readFile(replacementFile, "utf8")).toBe("replacement survives\n");
    expect(await readFile(
      path.join(displaced, "games", "simple-choice", "authoring", "game.authoring.json"),
      "utf8"
    )).toBe("{\"title\":\"Old\"}\n");
  });

  it("ignores a saved clean report and retains newly dirty quarantine content", async () => {
    const session = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-stale-clean"
    });
    await expect(removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: false,
      testHooks: { crashAt: "after-deleting-journal" }
    })).rejects.toMatchObject({ statusCode: 500 });
    const quarantinedFile = path.join(
      `${session.worktreePath}.gc`,
      "games",
      "simple-choice",
      "authoring",
      "game.authoring.json"
    );
    await writeFile(quarantinedFile, "{\"title\":\"dirty after clean report\"}\n", "utf8");

    const resumed = await removeProjectGitSessionForGarbageCollection(session, {
      dryRun: false,
      removeDirty: false
    });
    expect(resumed).toMatchObject({ removed: false, isDirty: true, wouldRemove: false });
    expect(await readFile(
      path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json"),
      "utf8"
    )).toContain("dirty after clean report");
    await removeProjectGitSession(session);
  }, 15_000);

  it("serializes quarantine and project-wide Git prune", async () => {
    const first = await createProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      sessionId: "simple-choice-project-lease-a"
    });
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstEnteredPromise = new Promise<void>((resolve) => { firstEntered = resolve; });
    const releaseFirstPromise = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstRemoval = removeProjectGitSessionForGarbageCollection(first, {
      dryRun: false,
      removeDirty: true,
      testHooks: {
        afterQuarantineRenameBeforeStatus: async () => {
          firstEntered();
          await releaseFirstPromise;
        }
      }
    });
    await firstEnteredPromise;
    const concurrentPrune = pruneProjectGitWorktrees(repoRoot);
    const pruneCompletedWhileQuarantined = await Promise.race([
      concurrentPrune.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150))
    ]);
    expect(pruneCompletedWhileQuarantined).toBe(false);

    releaseFirst();
    await expect(firstRemoval).resolves.toMatchObject({ removed: true });
    await expect(concurrentPrune).resolves.toBeUndefined();
  }, 15_000);
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout;
}
