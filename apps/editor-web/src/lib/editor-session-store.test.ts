import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeEditorSession, createEditorSession, repoRootForSession } from "./editor-session-store";
import { openAuthoringFile, saveAuthoringFile } from "./editor-repository";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-session-store-tests");

describe("editor session store", () => {
  beforeEach(async () => {
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
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("creates a reusable worktree-backed session for repository adapters", async () => {
    const opened = await createEditorSession({ gameId: "simple-choice", repoRoot });
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
  });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout;
}
