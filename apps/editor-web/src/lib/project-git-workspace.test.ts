import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  removeProjectGitSession,
  restoreSavedVersion,
  saveProjectGitSession,
  validatePluginChangeSetBoundary
} from "./project-git-workspace";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), ".tmp", "project-git-workspace-tests");

describe("project Git workspace", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
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
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout;
}
