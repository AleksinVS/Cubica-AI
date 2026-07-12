import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeEditorSession,
  createEditorSession,
  garbageCollectEditorSessions,
  markEditorSessionSaved,
  planEditorSessionUpgrade,
  readEditorSession,
  repoRootForSession,
  touchEditorSession,
  type EditorSessionDocument
} from "./editor-session-store";
import { openAuthoringFile, saveAuthoringFile } from "./editor-repository";
import { allowedSavePathsForGame, saveProjectGitSession } from "./project-git-workspace";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-session-store-tests");
const workspaceRoot = path.resolve(process.cwd(), "../..");
const metadataRoot = path.join(workspaceRoot, ".tmp", "editor-sessions");

describe("editor session store", () => {
  const createdSessionIds = new Set<string>();

  beforeEach(async () => {
    createdSessionIds.clear();
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(path.join(repoRoot, "games", "simple-choice", "authoring"), { recursive: true });
    await writeFile(path.join(repoRoot, "PROJECT_STRUCTURE.yaml"), "test: true\n", "utf8");
    await writeFile(path.join(repoRoot, "games", "simple-choice", "authoring", "game.authoring.json"), "{\"title\":\"Old\"}\n", "utf8");
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.name", "Test"]);
    await git(repoRoot, ["config", "user.email", "test@example.local"]);
    await git(repoRoot, ["add", "PROJECT_STRUCTURE.yaml", "games/simple-choice/authoring/game.authoring.json"]);
    await git(repoRoot, ["commit", "-m", "Initial project"]);
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await closeEditorSession(sessionId).catch(() => undefined);
    }
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("creates a reusable worktree-backed session for repository adapters", async () => {
    const opened = await createTestSession();
    expect(opened.session.branchName).toMatch(/^editor\/session\//u);
    expect(opened.files.map((file) => file.filePath)).toEqual(["game.authoring.json"]);

    const sessionRoot = await repoRootForSession(opened.session.sessionId, "simple-choice");
    expect(sessionRoot.repoRoot).toContain(".tmp/editor-worktrees/");

    const document = await openAuthoringFile({
      gameId: "simple-choice",
      filePath: "game.authoring.json",
      repoRoot: sessionRoot.repoRoot
    });
    await saveAuthoringFile({
      gameId: "simple-choice",
      filePath: "game.authoring.json",
      text: "{\"title\":\"Session\"}\n",
      versionHash: document.versionHash,
      repoRoot: sessionRoot.repoRoot
    });

    const mainDocument = await openAuthoringFile({
      gameId: "simple-choice",
      filePath: "game.authoring.json",
      repoRoot
    });
    expect(mainDocument.text).toBe("{\"title\":\"Old\"}\n");

    await closeEditorSession(opened.session.sessionId);
    createdSessionIds.delete(opened.session.sessionId);
  });

  it("reuses a compatible active session by default and supports explicit new drafts", async () => {
    const first = await createTestSession("reuse-user");
    const second = await createTestSession("reuse-user");
    const forced = await createTestSession("reuse-user", true);

    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(second.session.reused).toBe(true);
    expect(forced.session.sessionId).not.toBe(first.session.sessionId);
    expect(forced.session.reused).toBe(false);

    const sessions = [first.session.sessionId, forced.session.sessionId];
    for (const sessionId of sessions) {
      await closeEditorSession(sessionId);
      createdSessionIds.delete(sessionId);
    }
  });

  it("stores v3 lifecycle metadata and records dirty versus saved state", async () => {
    const opened = await createTestSession("dirty-user");
    const session = await readEditorSession(opened.session.sessionId);

    expect(session.schemaVersion).toBe(3);
    expect(session.platformReleaseId).toBe("local-dev");
    expect(session.pluginApiVersion).toBe("1.0");
    expect(session.status).toBe("active");

    const filePath = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");
    await writeFile(filePath, "{\"title\":\"Dirty\"}\n", "utf8");

    const dirty = await touchEditorSession(session.sessionId);
    expect(dirty.status).toBe("dirty");
    expect(dirty.dirtySummary.changedPaths).toEqual(["games/simple-choice/authoring/game.authoring.json"]);

    const commit = await saveProjectGitSession({
      worktreePath: session.worktreePath,
      message: "Save dirty test",
      allowedPaths: allowedSavePathsForGame({ gameId: "simple-choice" })
    });
    const saved = await markEditorSessionSaved({
      sessionId: session.sessionId,
      commitHash: commit.commitHash
    });

    expect(saved.status).toBe("saved");
    expect(saved.dirtySummary.isDirty).toBe(false);
    expect(saved.lastSavedCommit).toBe(commit.commitHash);

    await closeEditorSession(session.sessionId);
    createdSessionIds.delete(session.sessionId);
  });

  it("opens a new clean session from durable content after close, branch cleanup, and Git GC", async () => {
    const opened = await createTestSession("durable-user", true);
    const session = await readEditorSession(opened.session.sessionId);
    const authoringPath = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");
    await writeFile(authoringPath, "{\"title\":\"Durable\"}\n", "utf8");
    const commit = await saveProjectGitSession({
      projectRoot: repoRoot,
      gameId: "simple-choice",
      worktreePath: session.worktreePath,
      expectedHead: null,
      message: "Save durable session",
      allowedPaths: allowedSavePathsForGame({ gameId: "simple-choice" })
    });
    await markEditorSessionSaved({
      sessionId: session.sessionId,
      commitHash: commit.commitHash,
      versionId: commit.versionId
    });

    await closeEditorSession(session.sessionId);
    createdSessionIds.delete(session.sessionId);
    await expect(git(repoRoot, ["rev-parse", "--verify", `refs/heads/${session.branchName}`])).rejects.toBeDefined();
    expect((await git(repoRoot, ["rev-parse", "--verify", "refs/cubica/editor/author-versions/simple-choice"])).trim())
      .toBe(commit.versionId);
    await garbageCollectEditorSessions({ dryRun: false });
    await git(repoRoot, ["gc", "--prune=now"]);

    await writeFile(path.join(repoRoot, "PROJECT_STRUCTURE.yaml"), "test: platform-v2\n", "utf8");
    await git(repoRoot, ["add", "PROJECT_STRUCTURE.yaml"]);
    await git(repoRoot, ["commit", "-m", "Update neutral platform file"]);

    const reopened = await createTestSession("durable-user", true);
    const reopenedDocument = await readEditorSession(reopened.session.sessionId);
    expect(await readFile(path.join(reopenedDocument.worktreePath, "PROJECT_STRUCTURE.yaml"), "utf8")).toBe("test: platform-v2\n");
    expect(await readFile(path.join(reopenedDocument.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json"), "utf8"))
      .toBe("{\"title\":\"Durable\"}\n");
    expect(reopened.session.currentVersionId).toBe(commit.versionId);
    expect(reopened.session.dirtySummary.isDirty).toBe(false);
  });

  it("plans an upgrade when stored platform metadata is incompatible", async () => {
    const opened = await createTestSession("upgrade-user");
    const session = await readEditorSession(opened.session.sessionId);
    await writeSessionMetadata({
      ...session,
      platformReleaseId: "old-release",
      pluginApiVersion: "0.9"
    });

    const plan = await planEditorSessionUpgrade({ sessionId: session.sessionId });

    expect(plan.dryRun).toBe(true);
    expect(plan.requiresUpgrade).toBe(true);
    expect(plan.ok).toBe(false);
    expect(plan.diagnostics.join("\n")).toContain("Run session upgrade before preview");

    await closeEditorSession(session.sessionId);
    createdSessionIds.delete(session.sessionId);
  });

  it("garbage-collects expired clean sessions and keeps close idempotent", async () => {
    const opened = await createTestSession("gc-user");
    const session = await readEditorSession(opened.session.sessionId);
    const expired = new Date(Date.now() - 60_000).toISOString();
    await writeSessionMetadata({
      ...session,
      status: "expired",
      expiresAt: expired,
      updatedAt: expired,
      lastUsedAt: expired
    });

    const dryRun = await garbageCollectEditorSessions({ dryRun: true });
    expect(dryRun.removedSessions).toContain(session.sessionId);

    const applied = await garbageCollectEditorSessions({ dryRun: false });
    expect(applied.removedSessions).toContain(session.sessionId);
    createdSessionIds.delete(session.sessionId);

    const secondClose = await closeEditorSession(session.sessionId);
    expect(secondClose.ok).toBe(true);
    expect(secondClose.removed).toBe(false);
  });

  it("rechecks Git status under the lease and preserves an expired session with newly-dirty files", async () => {
    const opened = await createTestSession("stale-gc-user", true);
    const session = await readEditorSession(opened.session.sessionId);
    const expired = new Date(Date.now() - 60_000).toISOString();
    await writeSessionMetadata({
      ...session,
      status: "expired",
      expiresAt: expired,
      updatedAt: expired,
      lastUsedAt: expired,
      dirtySummary: { isDirty: false, changedPaths: [], checkedAt: expired }
    });
    const authoringPath = path.join(session.worktreePath, "games", "simple-choice", "authoring", "game.authoring.json");
    await writeFile(authoringPath, "{\"title\":\"Unsaved after metadata snapshot\"}\n", "utf8");

    const applied = await garbageCollectEditorSessions({ dryRun: false });

    expect(applied.removedSessions).not.toContain(session.sessionId);
    expect(applied.skippedDirtySessions).toContain(session.sessionId);
    expect(await readFile(authoringPath, "utf8")).toContain("Unsaved after metadata snapshot");
    const retained = await readEditorSession(session.sessionId);
    expect(retained.status).toBe("dirty");
    expect(retained.dirtySummary.isDirty).toBe(true);
  });

  async function createTestSession(userId = "test-user", forceNew = false) {
    const opened = await createEditorSession({ gameId: "simple-choice", repoRoot, userId, forceNew });
    createdSessionIds.add(opened.session.sessionId);
    return opened;
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout;
}

async function writeSessionMetadata(session: EditorSessionDocument): Promise<void> {
  await writeFile(
    path.join(metadataRoot, `${session.sessionId}.json`),
    `${JSON.stringify(session, null, 2)}\n`,
    "utf8"
  );
}
