/**
 * Integration tests for durable author history against a neutral temporary Git
 * repository. The fixture intentionally has no production game names or rules.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  allowedSavePathsForGame,
  createProjectGitSession,
  EditorVersionStoreError,
  getProjectGitStatusSummary,
  listProjectVersionHistory,
  readProjectVersionDetails,
  removeProjectGitSession,
  restoreDurableProjectVersion,
  saveProjectGitSession
} from "./project-git-workspace";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-version-history-tests");
const gameId = "neutral-game";
const authoringRoot = path.join(repoRoot, "games", gameId, "authoring");
const mainFile = path.join("games", gameId, "authoring", "game.authoring.json");
const optionalFile = path.join("games", gameId, "authoring", "optional.authoring.json");
const platformFile = "platform.txt";

describe("durable editor version history", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(authoringRoot, { recursive: true });
    await writeFile(path.join(repoRoot, mainFile), "{\"value\":0}\n", "utf8");
    await writeFile(path.join(repoRoot, optionalFile), "{\"optional\":true}\n", "utf8");
    await writeFile(path.join(repoRoot, platformFile), "platform-v1\n", "utf8");
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.name", "Test"]);
    await git(repoRoot, ["config", "user.email", "test@example.local"]);
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "Initial neutral fixture"]);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("keeps saved content through close and GC while a new session uses the latest platform", async () => {
    const first = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-first" });
    await writeFile(path.join(first.worktreePath, mainFile), "{\"value\":1}\n", "utf8");
    const saved = await saveProjectGitSession({
      projectRoot: repoRoot,
      gameId,
      worktreePath: first.worktreePath,
      expectedHead: null,
      message: "First durable save",
      allowedPaths: allowedPaths(),
      authorName: "Neutral Author",
      authorComment: "Первая устойчивая версия",
      changeFacts: [{
        kind: "updated",
        filePath: mainFile,
        summary: "Обновлён нейтральный документ",
        source: "user"
      }]
    });
    expect(saved.versionId).toMatch(/^[0-9a-f]{40}$/u);
    const savedDetails = await readProjectVersionDetails({
      projectRoot: repoRoot,
      gameId,
      versionId: saved.versionId!,
      allowedPaths: allowedPaths()
    });
    expect(savedDetails.authorComment).toBe("Первая устойчивая версия");
    expect(savedDetails.changes).toContainEqual(expect.objectContaining({
      summary: "Обновлён нейтральный документ",
      source: "user"
    }));

    await removeProjectGitSession(first);
    await expect(git(repoRoot, ["rev-parse", "--verify", `refs/heads/${first.branchName}`])).rejects.toBeDefined();
    expect((await git(repoRoot, ["rev-parse", "--verify", `refs/cubica/editor/author-versions/${gameId}`])).trim())
      .toBe(saved.versionId);
    await git(repoRoot, ["gc", "--prune=now"]);

    await writeFile(path.join(repoRoot, platformFile), "platform-v2\n", "utf8");
    await git(repoRoot, ["add", platformFile]);
    await git(repoRoot, ["commit", "-m", "Update platform"]);

    const reopened = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-reopened" });
    expect(await readFile(path.join(reopened.worktreePath, platformFile), "utf8")).toBe("platform-v2\n");
    expect(await readFile(path.join(reopened.worktreePath, mainFile), "utf8")).toBe("{\"value\":1}\n");
    expect((await getProjectGitStatusSummary(reopened.worktreePath)).isDirty).toBe(false);
    expect(reopened.currentVersionId).toBe(saved.versionId);
    await removeProjectGitSession(reopened);
  });

  it("paginates newest-first with an opaque cursor and detects concurrent promotion", async () => {
    const primary = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-primary" });
    const concurrent = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-concurrent" });
    let expectedHead: string | null = null;
    const ids: string[] = [];

    for (let value = 1; value <= 3; value += 1) {
      await writeFile(path.join(primary.worktreePath, mainFile), `{\"value\":${value}}\n`, "utf8");
      const saved = await durableSave(primary, expectedHead, `Save ${value}`);
      expectedHead = saved.versionId ?? null;
      ids.push(saved.versionId!);
    }

    const firstPage = await listProjectVersionHistory({
      projectRoot: repoRoot,
      gameId,
      allowedPaths: allowedPaths(),
      limit: 1
    });
    const secondPage = await listProjectVersionHistory({
      projectRoot: repoRoot,
      gameId,
      allowedPaths: allowedPaths(),
      limit: 1,
      cursor: firstPage.nextCursor
    });
    expect(firstPage.versions.map((version) => version.versionId)).toEqual(ids.slice().reverse().slice(0, 1));
    expect(secondPage.versions.map((version) => version.versionId)).toEqual(ids.slice().reverse().slice(1, 2));
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.nextCursor).not.toContain(ids[0]);

    await writeFile(path.join(concurrent.worktreePath, mainFile), "{\"value\":99}\n", "utf8");
    await expect(durableSave(concurrent, null, "Stale concurrent save")).rejects.toMatchObject({
      statusCode: 409,
      code: "version_conflict"
    });
    expect((await getProjectGitStatusSummary(concurrent.worktreePath)).isDirty).toBe(true);

    await removeProjectGitSession(primary);
    await removeProjectGitSession(concurrent);
  }, 15_000);

  it("rejects unreachable versions and dirty restore without changing files", async () => {
    const session = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-safe-restore" });
    await writeFile(path.join(session.worktreePath, mainFile), "{\"value\":1}\n", "utf8");
    const saved = await durableSave(session, null, "Save before dirty restore");
    const unrelated = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();

    await expect(readProjectVersionDetails({
      projectRoot: repoRoot,
      gameId,
      versionId: unrelated,
      allowedPaths: allowedPaths()
    })).rejects.toMatchObject({ statusCode: 404, code: "version_not_found" });

    await writeFile(path.join(session.worktreePath, mainFile), "{\"value\":2}\n", "utf8");
    await expect(restoreDurableProjectVersion({
      projectRoot: repoRoot,
      gameId,
      worktreePath: session.worktreePath,
      versionId: saved.versionId!,
      expectedHead: saved.versionId!,
      allowedPaths: allowedPaths()
    })).rejects.toMatchObject({ statusCode: 409, code: "session_dirty" });
    expect(await readFile(path.join(session.worktreePath, mainFile), "utf8")).toBe("{\"value\":2}\n");
    await removeProjectGitSession(session);
  });

  it("restores a deleted allowed file as a new version and retains the original history", async () => {
    const session = await createProjectGitSession({ projectRoot: repoRoot, gameId, sessionId: "neutral-delete-restore" });
    await writeFile(path.join(session.worktreePath, mainFile), "{\"value\":1}\n", "utf8");
    const first = await durableSave(session, null, "Version with optional file");

    await rm(path.join(session.worktreePath, optionalFile));
    const second = await durableSave(session, first.versionId!, "Delete optional file");
    const deletedDetails = await readProjectVersionDetails({
      projectRoot: repoRoot,
      gameId,
      versionId: second.versionId!,
      allowedPaths: allowedPaths()
    });
    expect(deletedDetails.changes).toContainEqual(expect.objectContaining({ kind: "deleted", filePath: optionalFile }));

    const restored = await restoreDurableProjectVersion({
      projectRoot: repoRoot,
      gameId,
      worktreePath: session.worktreePath,
      versionId: first.versionId!,
      expectedHead: second.versionId!,
      allowedPaths: allowedPaths()
    });
    expect(await readFile(path.join(session.worktreePath, optionalFile), "utf8")).toBe("{\"optional\":true}\n");

    const history = await listProjectVersionHistory({
      projectRoot: repoRoot,
      gameId,
      allowedPaths: allowedPaths(),
      limit: 10
    });
    expect(history.versions.map((version) => version.versionId)).toEqual([
      restored.versionId,
      second.versionId,
      first.versionId
    ]);
    expect(history.versions[0]).toMatchObject({ kind: "restore", restoredFromVersionId: first.versionId });
    await removeProjectGitSession(session);
  });
});

function allowedPaths() {
  return allowedSavePathsForGame({ gameId });
}

function durableSave(
  session: Awaited<ReturnType<typeof createProjectGitSession>>,
  expectedHead: string | null,
  message: string
) {
  return saveProjectGitSession({
    projectRoot: repoRoot,
    gameId,
    worktreePath: session.worktreePath,
    expectedHead,
    message,
    allowedPaths: allowedPaths(),
    authorName: "Neutral Author"
  });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout;
}
